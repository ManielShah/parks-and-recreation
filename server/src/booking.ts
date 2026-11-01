import {
  AUTO_PROMOTION_CUTOFF_MS, CART_MAX, HOLD_MS, autoOfferExpiry, formatDuration, isAgeEligible,
  type ErrorCode, type Hold, type Registration, type Tone, type WaitlistEntry,
} from '@parks/shared';
import { pool, tx, type Db } from './db.js';

export class BookingError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public status = 409,
  ) {
    super(message);
  }
}

// Lock order, everywhere: family -> child -> sections (ascending id). The sweeper only
// takes section locks, so no two code paths can wait on each other in a cycle.

/**
 * How family and child rows are locked. NO KEY UPDATE still makes two requests for the same
 * family or child wait for each other, but unlike FOR UPDATE it doesn't block the KEY SHARE
 * lock Postgres takes when a row referencing the family is inserted. With FOR UPDATE, a
 * request holding a section and inserting an offer for family F (section -> F) deadlocked
 * against F's own request (F -> section): found by the independent review.
 */
export const ROW_LOCK = 'FOR NO KEY UPDATE';

const RETRYABLE = new Set(['40P01', '40001']); // deadlock_detected, serialization_failure
const MAX_ATTEMPTS = 3;

interface SectionRow {
  id: string;
  capacity: number;
  program_id: string;
  min_age: number;
  max_age: number;
  price_cents: number;
  label: string;
  registration_opens_at: Date | null;
  starts_at: Date;
  last_call_until: Date | null;
}

const SECTION_SELECT = `
  SELECT s.id, s.capacity, s.program_id, s.starts_at, s.last_call_until,
         p.min_age, p.max_age, p.price_cents, p.registration_opens_at,
         p.name || ' · ' || s.day_label AS label
    FROM sections s JOIN programs p ON p.id = s.program_id
   WHERE s.id = $1`;

async function lockSection(c: Db, sectionId: string): Promise<SectionRow> {
  const { rows } = await c.query<SectionRow>(`${SECTION_SELECT} FOR UPDATE OF s`, [sectionId]);
  if (!rows[0]) throw new BookingError('not_found', 'That section does not exist.', 404);
  return rows[0];
}

/**
 * Run a booking change in a transaction. Unlike plain tx, a request that fails a check
 * (a BookingError) still commits the settling it did first: settleSection ends with
 * SAVEPOINT settled, and we roll back only to there. Before this, a failed request rolled
 * back everything, so an expired offer it had just passed to the next family was un-passed
 * and the spot sat idle until the sweeper's next pass.
 */
async function bookingTx<T>(fn: (c: Db) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const c = await pool.connect();
    let broken: Error | undefined;
    try {
      await c.query('BEGIN');
      const out = await fn(c);
      await c.query('COMMIT');
      return out;
    } catch (err) {
      if (!(err instanceof BookingError) || !(await keepSettled(c))) {
        await c.query('ROLLBACK').catch((e: Error) => { broken = e; });
      }
      // Lock ordering should prevent deadlocks; if Postgres still reports one, the whole
      // transaction was rolled back and is safe to run again.
      const code = (err as { code?: string }).code;
      if (code && RETRYABLE.has(code) && attempt < MAX_ATTEMPTS) continue;
      throw err;
    } finally {
      // A connection whose rollback failed is in an unknown state: drop it rather than reuse it.
      c.release(broken);
    }
  }
}

async function keepSettled(c: Db): Promise<boolean> {
  try {
    await c.query('ROLLBACK TO SAVEPOINT settled');
  } catch {
    return false; // No section was settled yet: a full rollback is right.
  }
  try {
    await c.query('COMMIT');
    return true;
  } catch (err) {
    console.error('could not keep settled waitlist changes after a failed request', err);
    return false;
  }
}

type EventName = 'joined' | 'left' | 'offered' | 'accepted' | 'declined' | 'expired' | 'last_call' | 'claimed';

/** Append to the waitlist audit trail, in the same transaction as the change it describes. */
async function record(
  c: Db, now: Date, sectionId: string, event: EventName, actor: 'family' | 'system' | 'staff',
  who: { family_id?: string | null; child_id?: string | null } = {}, extra: { offerExpiresAt?: Date; detail?: string } = {},
): Promise<void> {
  await c.query(
    `INSERT INTO waitlist_events (section_id, family_id, child_id, event, actor, offer_expires_at, detail, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [sectionId, who.family_id ?? null, who.child_id ?? null, event, actor, extra.offerExpiresAt ?? null, extra.detail ?? null, now],
  );
}

async function lockFamily(c: Db, familyId: string): Promise<void> {
  const { rowCount } = await c.query(`SELECT 1 FROM families WHERE id = $1 ${ROW_LOCK}`, [familyId]);
  if (!rowCount) throw new BookingError('not_found', 'Unknown family.', 404);
}

async function lockChild(c: Db, familyId: string, childId: string): Promise<{ id: string; name: string; age: number }> {
  const { rows } = await c.query<{ id: string; name: string; age: number }>(
    `SELECT id, name, age FROM children WHERE id = $1 AND family_id = $2 ${ROW_LOCK}`,
    [childId, familyId],
  );
  if (!rows[0]) throw new BookingError('not_found', 'That child is not on your account.', 404);
  return rows[0];
}

async function sectionIdOf(c: Db, table: 'holds' | 'waitlist_entries' | 'registrations', id: string, familyId: string): Promise<string> {
  const { rows } = await c.query<{ section_id: string }>(
    `SELECT section_id FROM ${table} WHERE id = $1 AND family_id = $2`,
    [id, familyId],
  );
  if (!rows[0]) throw new BookingError('not_found', 'Not found.', 404);
  return rows[0].section_id;
}

async function childName(c: Db, childId: string | null): Promise<string> {
  if (!childId) return 'Your child';
  const { rows } = await c.query<{ name: string }>('SELECT name FROM children WHERE id = $1', [childId]);
  return rows[0]?.name ?? 'Your child';
}

async function notify(c: Db, familyId: string, tone: Tone, message: string, external = false): Promise<void> {
  await c.query(
    'INSERT INTO notifications (family_id, tone, message, send_sms, send_email) VALUES ($1, $2, $3, $4, $4)',
    [familyId, tone, message, external],
  );
}

/** Spots not taken by an active registration or an unexpired hold. Caller holds the section lock. */
async function openSpots(c: Db, s: SectionRow, now: Date): Promise<number> {
  const { rows } = await c.query<{ taken: string }>(
    `SELECT (SELECT count(*) FROM registrations WHERE section_id = $1 AND withdrawn_at IS NULL)
          + (SELECT count(*) FROM holds WHERE section_id = $1 AND expires_at > $2) AS taken`,
    [s.id, now],
  );
  return s.capacity - Number(rows[0]!.taken);
}

async function waitlistLength(c: Db, sectionId: string): Promise<number> {
  const { rows } = await c.query<{ n: string }>('SELECT count(*) AS n FROM waitlist_entries WHERE section_id = $1', [sectionId]);
  return Number(rows[0]!.n);
}

/** Take the first family in line (strict FIFO by entry id). Caller holds the section lock. */
async function popWaitlist(c: Db, sectionId: string): Promise<{ family_id: string; child_id: string | null } | null> {
  const { rows } = await c.query<{ family_id: string; child_id: string | null }>(
    `DELETE FROM waitlist_entries
      WHERE id = (SELECT id FROM waitlist_entries WHERE section_id = $1 ORDER BY id LIMIT 1)
      RETURNING family_id, child_id`,
    [sectionId],
  );
  return rows[0] ?? null;
}

/** Reserve a spot for one family and tell them how long they have. Nothing is charged until they accept. */
async function makeOffer(
  c: Db, s: SectionRow, to: { family_id: string; child_id: string | null }, expiresAt: Date, actor: 'system' | 'staff', now: Date,
): Promise<void> {
  await c.query(
    `INSERT INTO holds (section_id, family_id, child_id, kind, expires_at) VALUES ($1, $2, $3, 'offer', $4)`,
    [s.id, to.family_id, to.child_id, expiresAt],
  );
  await notify(
    c, to.family_id, 'good',
    `Text and email sent: a spot opened for ${await childName(c, to.child_id)} in ${s.label}. You have ${formatDuration(expiresAt.getTime() - now.getTime())} to accept it. Your card is charged ${dollars(s.price_cents)} only if you accept.`,
    true,
  );
  await record(c, now, s.id, 'offered', actor, to, { offerExpiresAt: expiresAt });
}

/**
 * Offer every open spot to the head of the waitlist, one family at a time. The window
 * depends on how soon class starts (see offerWindowMs). Under 20 minutes out, or during a
 * staff last call, nothing is offered automatically: staff assign the spot instead.
 * Caller holds the section lock.
 */
async function promoteWaitlist(c: Db, s: SectionRow, now: Date): Promise<void> {
  if (s.last_call_until && now < s.last_call_until) return;
  const expiry = autoOfferExpiry(s.starts_at.getTime(), now.getTime());
  if (expiry === null) return;
  while ((await openSpots(c, s, now)) > 0) {
    const next = await popWaitlist(c, s.id);
    if (!next) return;
    await makeOffer(c, s, next, new Date(expiry), 'system', now);
  }
}

/**
 * Release this section's expired holds and pass freed spots to the waitlist.
 * Runs under the section lock before every change, and from the background sweeper,
 * so a spot is never handed to a new cart while someone is still waiting for it.
 */
async function settleSection(c: Db, s: SectionRow, now: Date): Promise<void> {
  const { rows: expired } = await c.query<{ family_id: string; child_id: string | null; kind: string; expires_at: Date }>(
    'DELETE FROM holds WHERE section_id = $1 AND expires_at <= $2 RETURNING family_id, child_id, kind, expires_at',
    [s.id, now],
  );
  for (const h of expired) {
    if (h.kind === 'offer') await record(c, now, s.id, 'expired', 'system', h, { offerExpiresAt: h.expires_at });
    if (!h.child_id) continue;
    const name = await childName(c, h.child_id);
    await notify(
      c, h.family_id, 'warn',
      h.kind === 'offer'
        ? `Your waitlist offer for ${name} in ${s.label} expired, so the spot was released.`
        : `Your 5-minute hold on ${s.label} for ${name} ran out, so the spot was released.`,
    );
  }
  await promoteWaitlist(c, s, now);
  // Everything above stands even if the request that called us then fails a check (see bookingTx).
  await c.query('SAVEPOINT settled');
}

function dollars(cents: number): string {
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}

function assertOpen(s: SectionRow, now: Date): void {
  if (s.registration_opens_at && now < s.registration_opens_at) {
    throw new BookingError('not_open', 'Registration for this program has not opened yet.');
  }
}

/** A child may be in only one section of a program, in any state. Caller holds the child lock. */
async function assertChildFree(c: Db, childId: string, programId: string, now: Date): Promise<void> {
  const { rows } = await c.query<{ state: string }>(
    `SELECT 'registered' AS state FROM registrations r JOIN sections s ON s.id = r.section_id
       WHERE r.child_id = $1 AND s.program_id = $2 AND r.withdrawn_at IS NULL
     UNION ALL
     SELECT 'held' FROM holds h JOIN sections s ON s.id = h.section_id
       WHERE h.child_id = $1 AND s.program_id = $2 AND h.expires_at > $3
     UNION ALL
     SELECT 'waitlisted' FROM waitlist_entries w JOIN sections s ON s.id = w.section_id
       WHERE w.child_id = $1 AND s.program_id = $2
     LIMIT 1`,
    [childId, programId, now],
  );
  if (rows[0]) throw new BookingError('already_involved', `This child is already ${rows[0].state} in this program.`);
}

function toHold(r: { id: string; section_id: string; kind: 'cart' | 'offer'; child_id: string | null; expires_at: Date }): Hold {
  return { id: String(r.id), sectionId: r.section_id, kind: r.kind, childId: r.child_id, expiresAt: r.expires_at.getTime() };
}

const HOLD_COLUMNS = 'id, section_id, kind, child_id, expires_at';

export async function addToCart(familyId: string, sectionId: string, childId: string, now: Date): Promise<{ hold: Hold; lastSpot: boolean }> {
  return bookingTx(async (c) => {
    await lockFamily(c, familyId);
    const child = await lockChild(c, familyId, childId);
    const s = await lockSection(c, sectionId);
    await settleSection(c, s, now);
    assertOpen(s, now);

    if (!isAgeEligible(child.age, { minAge: s.min_age, maxAge: s.max_age })) {
      throw new BookingError('not_eligible', `${child.name} is outside this program's age range.`);
    }
    await assertChildFree(c, child.id, s.program_id, now);

    const { rows: cart } = await c.query<{ n: string }>(
      `SELECT count(*) AS n FROM holds WHERE family_id = $1 AND kind = 'cart' AND expires_at > $2`,
      [familyId, now],
    );
    if (Number(cart[0]!.n) >= CART_MAX) throw new BookingError('cart_full', `Your cart can hold ${CART_MAX} spots at a time.`);

    const open = await openSpots(c, s, now);
    if (open <= 0) throw new BookingError('section_full', 'That section just filled up. You can join the waitlist.');
    // A spot can be open with families still waiting only when it's being assigned by staff
    // close to class start. The waitlist keeps its priority: walk-ins can't take it.
    if ((await waitlistLength(c, s.id)) > 0) {
      throw new BookingError('waitlist_priority', 'Families on the waitlist get this spot first. You can join the waitlist.');
    }

    const { rows } = await c.query(
      `INSERT INTO holds (section_id, family_id, child_id, kind, expires_at) VALUES ($1, $2, $3, 'cart', $4) RETURNING ${HOLD_COLUMNS}`,
      [s.id, familyId, child.id, new Date(now.getTime() + HOLD_MS)],
    );
    return { hold: toHold(rows[0]), lastSpot: open === 1 };
  });
}

export async function removeFromCart(familyId: string, holdId: string, now: Date): Promise<void> {
  await bookingTx(async (c) => {
    const s = await lockSection(c, await sectionIdOf(c, 'holds', holdId, familyId));
    await c.query(`DELETE FROM holds WHERE id = $1 AND family_id = $2 AND kind = 'cart'`, [holdId, familyId]);
    await settleSection(c, s, now);
  });
}

export async function joinWaitlist(familyId: string, sectionId: string, childId: string, now: Date): Promise<WaitlistEntry> {
  return bookingTx(async (c) => {
    const child = await lockChild(c, familyId, childId);
    const s = await lockSection(c, sectionId);
    await settleSection(c, s, now);
    assertOpen(s, now);

    if (!isAgeEligible(child.age, { minAge: s.min_age, maxAge: s.max_age })) {
      throw new BookingError('not_eligible', `${child.name} is outside this program's age range.`);
    }
    await assertChildFree(c, child.id, s.program_id, now);
    if ((await openSpots(c, s, now)) > 0 && (await waitlistLength(c, s.id)) === 0) {
      throw new BookingError('spots_open', 'A spot is open in this section. Add it to your cart instead.');
    }

    const { rows } = await c.query<{ id: string }>(
      'INSERT INTO waitlist_entries (section_id, family_id, child_id) VALUES ($1, $2, $3) RETURNING id',
      [s.id, familyId, child.id],
    );
    const { rows: pos } = await c.query<{ n: string }>(
      'SELECT count(*) AS n FROM waitlist_entries WHERE section_id = $1 AND id <= $2',
      [s.id, rows[0]!.id],
    );
    await record(c, now, s.id, 'joined', 'family', { family_id: familyId, child_id: child.id }, { detail: `#${pos[0]!.n} in line` });
    return { id: String(rows[0]!.id), sectionId: s.id, childId: child.id, position: Number(pos[0]!.n), claimableUntil: null };
  });
}

export async function leaveWaitlist(familyId: string, entryId: string, now: Date): Promise<void> {
  await bookingTx(async (c) => {
    const s = await lockSection(c, await sectionIdOf(c, 'waitlist_entries', entryId, familyId));
    const { rows } = await c.query<{ family_id: string; child_id: string | null }>(
      'DELETE FROM waitlist_entries WHERE id = $1 AND family_id = $2 RETURNING family_id, child_id',
      [entryId, familyId],
    );
    if (rows[0]) await record(c, now, s.id, 'left', 'family', rows[0]);
  });
}

/** Ask to be texted and emailed when a program's registration opens. */
export async function setReminder(familyId: string, programId: string, on: boolean): Promise<void> {
  const { rowCount } = await pool.query('SELECT 1 FROM programs WHERE id = $1', [programId]);
  if (!rowCount) throw new BookingError('not_found', 'That program does not exist.', 404);
  if (on) {
    await pool.query(
      'INSERT INTO registration_reminders (family_id, program_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [familyId, programId],
    );
  } else {
    await pool.query('DELETE FROM registration_reminders WHERE family_id = $1 AND program_id = $2', [familyId, programId]);
  }
}

/** Notify every family waiting on a program whose registration has now opened. */
export async function sendOpeningReminders(now: Date): Promise<number> {
  return tx(async (c) => {
    const { rows } = await c.query<{ family_id: string; name: string }>(
      `UPDATE registration_reminders r SET notified_at = $1
         FROM programs p
        WHERE p.id = r.program_id AND r.notified_at IS NULL AND p.registration_opens_at <= $1
        RETURNING r.family_id, p.name`,
      [now],
    );
    for (const r of rows) {
      await notify(c, r.family_id, 'good', `Registration for ${r.name} is open now. We sent you a text and email.`, true);
    }
    return rows.length;
  });
}

/**
 * Accepting a waitlist offer registers the child and charges the family's saved card in one step.
 * This is the only point a waitlisted family is charged; an offer left to expire costs nothing.
 */
export async function acceptOffer(familyId: string, holdId: string, now: Date): Promise<{ registrations: Registration[]; totalCents: number }> {
  return bookingTx(async (c) => {
    await lockFamily(c, familyId);
    const s = await lockSection(c, await sectionIdOf(c, 'holds', holdId, familyId));
    // Settling first releases this offer if it has run out and hands the spot on; that
    // survives the 'expired' error below.
    await settleSection(c, s, now);
    const { rows } = await c.query<{ child_id: string | null }>(
      `DELETE FROM holds WHERE id = $1 AND family_id = $2 AND kind = 'offer' RETURNING child_id`,
      [holdId, familyId],
    );
    if (!rows[0]) throw new BookingError('expired', 'This offer has expired.');
    const reg = await registerFromWaitlist(c, s, familyId, rows[0].child_id, now);
    await record(c, now, s.id, 'accepted', 'family', { family_id: familyId, child_id: rows[0].child_id });
    return {
      registrations: [reg],
      totalCents: s.price_cents,
    };
  });
}

/** Register a waitlisted family's child and charge them. Payment is simulated; a real charge goes here. */
async function registerFromWaitlist(c: Db, s: SectionRow, familyId: string, childId: string | null, now: Date): Promise<Registration> {
  // A declined card should throw here, rolling the whole acceptance back.
  const { rows } = await c.query<{ id: string; confirmation: string }>(
    `INSERT INTO registrations (section_id, family_id, child_id, confirmation, price_cents, from_waitlist, created_at)
     VALUES ($1, $2, $3, 'CV-' || nextval('confirmation_seq'), $4, true, $5) RETURNING id, confirmation`,
    [s.id, familyId, childId, s.price_cents, now],
  );
  return {
    id: String(rows[0]!.id), sectionId: s.id, childId: childId ?? '', confirmation: rows[0]!.confirmation,
    priceCents: s.price_cents, fromWaitlist: true,
  };
}

export async function declineOffer(familyId: string, holdId: string, now: Date): Promise<void> {
  await bookingTx(async (c) => {
    const s = await lockSection(c, await sectionIdOf(c, 'holds', holdId, familyId));
    const { rows } = await c.query<{ family_id: string; child_id: string | null }>(
      `DELETE FROM holds WHERE id = $1 AND family_id = $2 AND kind = 'offer' AND expires_at > $3 RETURNING family_id, child_id`,
      [holdId, familyId, now],
    );
    if (rows[0]) await record(c, now, s.id, 'declined', 'family', rows[0]);
    await settleSection(c, s, now);
  });
}

/**
 * Turn every cart hold into a registration. The client sends the hold ids it showed the
 * family, so nobody pays for a different set than they saw. Payment is simulated for now.
 */
export async function checkout(familyId: string, holdIds: string[], now: Date): Promise<{ registrations: Registration[]; totalCents: number }> {
  return bookingTx(async (c) => {
    await lockFamily(c, familyId);
    const { rows: sectionRows } = await c.query<{ section_id: string }>(
      `SELECT DISTINCT section_id FROM holds WHERE family_id = $1 AND kind = 'cart' ORDER BY section_id`,
      [familyId],
    );
    const sections = new Map<string, SectionRow>();
    for (const { section_id } of sectionRows) {
      const s = await lockSection(c, section_id);
      await settleSection(c, s, now);
      sections.set(s.id, s);
    }

    const { rows: holds } = await c.query<{ id: string; section_id: string; child_id: string | null }>(
      `SELECT id, section_id, child_id FROM holds WHERE family_id = $1 AND kind = 'cart' AND expires_at > $2 ORDER BY id`,
      [familyId, now],
    );
    const live = holds.map((h) => String(h.id)).sort();
    const wanted = [...new Set(holdIds)].sort();
    if (!live.length) throw new BookingError('expired', 'Your cart is empty. Holds last 5 minutes.');
    if (live.join() !== wanted.join()) {
      throw new BookingError('cart_changed', 'Your cart changed since you last looked. Check it and try again.');
    }

    const registrations: Registration[] = [];
    let totalCents = 0;
    for (const h of holds) {
      const s = sections.get(h.section_id)!;
      // Swap the hold for a registration. Payment is simulated; a real charge goes here.
      await c.query('DELETE FROM holds WHERE id = $1', [h.id]);
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO registrations (section_id, family_id, child_id, confirmation, price_cents)
         VALUES ($1, $2, $3, 'CV-' || nextval('confirmation_seq'), $4) RETURNING id, confirmation`,
        [s.id, familyId, h.child_id, s.price_cents],
      );
      const r = rows[0] as unknown as { id: string; confirmation: string };
      registrations.push({
        id: String(r.id), sectionId: s.id, childId: h.child_id ?? '', confirmation: r.confirmation, priceCents: s.price_cents,
        fromWaitlist: false,
      });
      totalCents += s.price_cents;
    }
    return { registrations, totalCents };
  });
}

export async function withdraw(familyId: string, registrationId: string, now: Date): Promise<void> {
  await bookingTx(async (c) => {
    const s = await lockSection(c, await sectionIdOf(c, 'registrations', registrationId, familyId));
    const { rowCount } = await c.query(
      'UPDATE registrations SET withdrawn_at = $3 WHERE id = $1 AND family_id = $2 AND withdrawn_at IS NULL',
      [registrationId, familyId, now],
    );
    if (!rowCount) throw new BookingError('not_found', 'That registration was already withdrawn.', 404);
    await settleSection(c, s, now);
  });
}

/** Settle one section from outside a request (the sweeper). Skips sections a request is busy with. */
export async function sweepSection(sectionId: string, now: Date): Promise<void> {
  await tx(async (c) => {
    // Never let the background sweeper sit behind a request for long; it tries again next tick.
    await c.query(`SET LOCAL lock_timeout = '2s'`);
    const { rows } = await c.query<SectionRow>(`${SECTION_SELECT} FOR UPDATE OF s SKIP LOCKED`, [sectionId]);
    if (rows[0]) await settleSection(c, rows[0], now);
  });
}

// --- Staff overrides: close to class start, when automatic offers have stopped ---

const STAFF_MAX_WINDOW_MS = 2 * 60 * 60 * 1000;

async function staffSection(c: Db, sectionId: string, now: Date): Promise<SectionRow> {
  const s = await lockSection(c, sectionId);
  await settleSection(c, s, now);
  if ((await openSpots(c, s, now)) <= 0) throw new BookingError('section_full', 'There is no open spot in this section.');
  if ((await waitlistLength(c, s.id)) === 0) throw new BookingError('invalid', 'Nobody is on the waitlist for this section.');
  return s;
}

/** Offer the open spot to the next family in line, with a window staff choose. Works at any time, including the last 10 minutes. */
export async function staffOffer(sectionId: string, windowMs: number, now: Date): Promise<void> {
  if (windowMs <= 0 || windowMs > STAFF_MAX_WINDOW_MS) throw new BookingError('invalid', 'Choose a window of up to 2 hours.', 400);
  await bookingTx(async (c) => {
    const s = await staffSection(c, sectionId, now);
    const next = (await popWaitlist(c, s.id))!;
    await makeOffer(c, s, next, new Date(now.getTime() + windowMs), 'staff', now);
  });
}

/**
 * Last call: tell every family on the waitlist a spot is open; the first to claim it gets it.
 * Trades strict line order for filling a seat that would otherwise go empty, so it's a staff
 * decision, and only once automatic offers have stopped.
 */
export async function staffLastCall(sectionId: string, windowMs: number, now: Date): Promise<number> {
  if (windowMs <= 0 || windowMs > STAFF_MAX_WINDOW_MS) throw new BookingError('invalid', 'Choose a window of up to 2 hours.', 400);
  return bookingTx(async (c) => {
    const s = await staffSection(c, sectionId, now);
    if (autoOfferExpiry(s.starts_at.getTime(), now.getTime()) !== null) {
      throw new BookingError('invalid', 'Automatic offers are still running for this section; the next family in line will be offered the spot.');
    }
    const until = new Date(now.getTime() + windowMs);
    await c.query('UPDATE sections SET last_call_until = $2 WHERE id = $1', [s.id, until]);
    const { rows: families } = await c.query<{ family_id: string }>(
      'SELECT DISTINCT family_id FROM waitlist_entries WHERE section_id = $1',
      [s.id],
    );
    for (const f of families) {
      await notify(
        c, f.family_id, 'good',
        `Last call: a spot is open in ${s.label}. The first family on the waitlist to claim it gets it, within the next ${formatDuration(windowMs)}. Your card is charged ${dollars(s.price_cents)} only if you claim it.`,
        true,
      );
    }
    await record(c, now, s.id, 'last_call', 'staff', {}, { offerExpiresAt: until, detail: `${families.length} families notified` });
    return families.length;
  });
}

/** Claim an open spot during a last call. Concurrent claims queue on the section lock; the first wins. */
export async function claimSpot(familyId: string, entryId: string, now: Date): Promise<{ registrations: Registration[]; totalCents: number }> {
  return bookingTx(async (c) => {
    await lockFamily(c, familyId);
    const s = await lockSection(c, await sectionIdOf(c, 'waitlist_entries', entryId, familyId));
    await settleSection(c, s, now);
    if (!s.last_call_until || now >= s.last_call_until) throw new BookingError('expired', 'This last call has ended.');
    if ((await openSpots(c, s, now)) <= 0) throw new BookingError('section_full', 'This spot has already been taken.');
    const { rows } = await c.query<{ child_id: string | null }>(
      'DELETE FROM waitlist_entries WHERE id = $1 AND family_id = $2 RETURNING child_id',
      [entryId, familyId],
    );
    if (!rows[0]) throw new BookingError('not_found', 'You are no longer on this waitlist.', 404);
    const reg = await registerFromWaitlist(c, s, familyId, rows[0].child_id, now);
    await record(c, now, s.id, 'claimed', 'family', { family_id: familyId, child_id: rows[0].child_id });
    return { registrations: [reg], totalCents: s.price_cents };
  });
}

// --- Simulated activity from other families (dev tools) ---

export async function simulateDropout(sectionId: string, familyId: string, now: Date): Promise<boolean> {
  return bookingTx(async (c) => {
    const s = await lockSection(c, sectionId);
    const { rowCount } = await c.query(
      `UPDATE registrations SET withdrawn_at = $3
        WHERE id = (SELECT id FROM registrations WHERE section_id = $1 AND family_id = $2 AND withdrawn_at IS NULL LIMIT 1)`,
      [sectionId, familyId, now],
    );
    await settleSection(c, s, now);
    return Boolean(rowCount);
  });
}

export async function simulateCartHold(sectionId: string, familyId: string, now: Date): Promise<boolean> {
  return bookingTx(async (c) => {
    const s = await lockSection(c, sectionId);
    await settleSection(c, s, now);
    if ((await openSpots(c, s, now)) <= 0 || (await waitlistLength(c, s.id)) > 0) return false;
    await c.query(
      `INSERT INTO holds (section_id, family_id, kind, expires_at) VALUES ($1, $2, 'cart', $3)`,
      [sectionId, familyId, new Date(now.getTime() + HOLD_MS)],
    );
    return true;
  });
}

/**
 * Move a section's first class (dev tools; the only way starts_at changes), then re-run the
 * waitlist under the new timing. Open offers are pulled back inside the new 10-minute cutoff
 * so no offer outlives it. That includes staff offers: a reschedule resets what staff set.
 */
export async function setSectionStart(sectionId: string, startsAt: Date, now: Date): Promise<void> {
  await bookingTx(async (c) => {
    const s = await lockSection(c, sectionId);
    await c.query('UPDATE sections SET starts_at = $2, last_call_until = NULL WHERE id = $1', [sectionId, startsAt]);
    await c.query(
      `UPDATE holds SET expires_at = LEAST(expires_at, $2) WHERE section_id = $1 AND kind = 'offer'`,
      [sectionId, new Date(startsAt.getTime() - AUTO_PROMOTION_CUTOFF_MS)],
    );
    await settleSection(c, { ...s, starts_at: startsAt, last_call_until: null }, now);
  });
}
