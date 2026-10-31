import { CART_MAX, HOLD_MS, OFFER_MS, isAgeEligible, type ErrorCode, type Hold, type Registration, type Tone, type WaitlistEntry } from '@parks/shared';
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

interface SectionRow {
  id: string;
  capacity: number;
  program_id: string;
  min_age: number;
  max_age: number;
  price_cents: number;
  label: string;
  registration_opens_at: Date | null;
}

async function lockSection(c: Db, sectionId: string): Promise<SectionRow> {
  const { rows } = await c.query<SectionRow>(
    `SELECT s.id, s.capacity, s.program_id, p.min_age, p.max_age, p.price_cents, p.registration_opens_at,
            p.name || ' · ' || s.day_label AS label
       FROM sections s JOIN programs p ON p.id = s.program_id
      WHERE s.id = $1
        FOR UPDATE OF s`,
    [sectionId],
  );
  if (!rows[0]) throw new BookingError('not_found', 'That section does not exist.', 404);
  return rows[0];
}

async function lockFamily(c: Db, familyId: string): Promise<void> {
  const { rowCount } = await c.query('SELECT 1 FROM families WHERE id = $1 FOR UPDATE', [familyId]);
  if (!rowCount) throw new BookingError('not_found', 'Unknown family.', 404);
}

async function lockChild(c: Db, familyId: string, childId: string): Promise<{ id: string; name: string; age: number }> {
  const { rows } = await c.query<{ id: string; name: string; age: number }>(
    'SELECT id, name, age FROM children WHERE id = $1 AND family_id = $2 FOR UPDATE',
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

/**
 * Offer every open spot to the head of the waitlist, one family at a time, for 2 hours.
 * Nothing is charged here: a family is charged only if they accept. Caller holds the section lock.
 */
async function promoteWaitlist(c: Db, s: SectionRow, now: Date): Promise<void> {
  while ((await openSpots(c, s, now)) > 0) {
    const { rows } = await c.query<{ family_id: string; child_id: string | null }>(
      `DELETE FROM waitlist_entries
        WHERE id = (SELECT id FROM waitlist_entries WHERE section_id = $1 ORDER BY id LIMIT 1)
        RETURNING family_id, child_id`,
      [s.id],
    );
    const next = rows[0];
    if (!next) return;
    await c.query(
      `INSERT INTO holds (section_id, family_id, child_id, kind, expires_at) VALUES ($1, $2, $3, 'offer', $4)`,
      [s.id, next.family_id, next.child_id, new Date(now.getTime() + OFFER_MS)],
    );
    await notify(
      c, next.family_id, 'good',
      `Text and email sent: a spot opened for ${await childName(c, next.child_id)} in ${s.label}. You have 2 hours to accept it. Your card is charged ${dollars(s.price_cents)} only if you accept.`,
      true,
    );
  }
}

/**
 * Release this section's expired holds and pass freed spots to the waitlist.
 * Runs under the section lock before every change, and from the background sweeper,
 * so a spot is never handed to a new cart while someone is still waiting for it.
 */
async function settleSection(c: Db, s: SectionRow, now: Date): Promise<void> {
  const { rows: expired } = await c.query<{ family_id: string; child_id: string | null; kind: string }>(
    'DELETE FROM holds WHERE section_id = $1 AND expires_at <= $2 RETURNING family_id, child_id, kind',
    [s.id, now],
  );
  for (const h of expired) {
    if (!h.child_id) continue;
    const name = await childName(c, h.child_id);
    await notify(
      c, h.family_id, 'warn',
      h.kind === 'offer'
        ? `Your waitlist offer for ${name} in ${s.label} expired after 2 hours, so it went to the next family in line.`
        : `Your 5-minute hold on ${s.label} for ${name} ran out, so the spot was released.`,
    );
  }
  await promoteWaitlist(c, s, now);
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
  return tx(async (c) => {
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

    const { rows } = await c.query(
      `INSERT INTO holds (section_id, family_id, child_id, kind, expires_at) VALUES ($1, $2, $3, 'cart', $4) RETURNING ${HOLD_COLUMNS}`,
      [s.id, familyId, child.id, new Date(now.getTime() + HOLD_MS)],
    );
    return { hold: toHold(rows[0]), lastSpot: open === 1 };
  });
}

export async function removeFromCart(familyId: string, holdId: string, now: Date): Promise<void> {
  await tx(async (c) => {
    const s = await lockSection(c, await sectionIdOf(c, 'holds', holdId, familyId));
    await c.query(`DELETE FROM holds WHERE id = $1 AND family_id = $2 AND kind = 'cart'`, [holdId, familyId]);
    await settleSection(c, s, now);
  });
}

export async function joinWaitlist(familyId: string, sectionId: string, childId: string, now: Date): Promise<WaitlistEntry> {
  return tx(async (c) => {
    const child = await lockChild(c, familyId, childId);
    const s = await lockSection(c, sectionId);
    await settleSection(c, s, now);
    assertOpen(s, now);

    if (!isAgeEligible(child.age, { minAge: s.min_age, maxAge: s.max_age })) {
      throw new BookingError('not_eligible', `${child.name} is outside this program's age range.`);
    }
    await assertChildFree(c, child.id, s.program_id, now);
    if ((await openSpots(c, s, now)) > 0) {
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
    return { id: String(rows[0]!.id), sectionId: s.id, childId: child.id, position: Number(pos[0]!.n) };
  });
}

export async function leaveWaitlist(familyId: string, entryId: string): Promise<void> {
  await tx(async (c) => {
    await lockSection(c, await sectionIdOf(c, 'waitlist_entries', entryId, familyId));
    await c.query('DELETE FROM waitlist_entries WHERE id = $1 AND family_id = $2', [entryId, familyId]);
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
  return tx(async (c) => {
    await lockFamily(c, familyId);
    const s = await lockSection(c, await sectionIdOf(c, 'holds', holdId, familyId));
    const { rows } = await c.query<{ child_id: string | null }>(
      `DELETE FROM holds WHERE id = $1 AND family_id = $2 AND kind = 'offer' AND expires_at > $3 RETURNING child_id`,
      [holdId, familyId, now],
    );
    if (!rows[0]) {
      await settleSection(c, s, now);
      throw new BookingError('expired', 'This offer has expired and went to the next family in line.');
    }
    // Payment is simulated: charge the saved card here, and throw (rolling back) if it's declined.
    const { rows: reg } = await c.query<{ id: string; confirmation: string }>(
      `INSERT INTO registrations (section_id, family_id, child_id, confirmation, price_cents, from_waitlist, created_at)
       VALUES ($1, $2, $3, 'CV-' || nextval('confirmation_seq'), $4, true, $5) RETURNING id, confirmation`,
      [s.id, familyId, rows[0].child_id, s.price_cents, now],
    );
    return {
      registrations: [{
        id: String(reg[0]!.id), sectionId: s.id, childId: rows[0].child_id ?? '', confirmation: reg[0]!.confirmation,
        priceCents: s.price_cents, fromWaitlist: true,
      }],
      totalCents: s.price_cents,
    };
  });
}

export async function declineOffer(familyId: string, holdId: string, now: Date): Promise<void> {
  await tx(async (c) => {
    const s = await lockSection(c, await sectionIdOf(c, 'holds', holdId, familyId));
    await c.query(`DELETE FROM holds WHERE id = $1 AND family_id = $2 AND kind = 'offer'`, [holdId, familyId]);
    await settleSection(c, s, now);
  });
}

/**
 * Turn every cart hold into a registration. The client sends the hold ids it showed the
 * family, so nobody pays for a different set than they saw. Payment is simulated for now.
 */
export async function checkout(familyId: string, holdIds: string[], now: Date): Promise<{ registrations: Registration[]; totalCents: number }> {
  return tx(async (c) => {
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
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO registrations (section_id, family_id, child_id, confirmation, price_cents)
         VALUES ($1, $2, $3, 'CV-' || nextval('confirmation_seq'), $4) RETURNING id, confirmation`,
        [s.id, familyId, h.child_id, s.price_cents],
      );
      await c.query('DELETE FROM holds WHERE id = $1', [h.id]);
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
  await tx(async (c) => {
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
    const { rows } = await c.query<SectionRow>(
      `SELECT s.id, s.capacity, s.program_id, p.min_age, p.max_age, p.price_cents, p.registration_opens_at,
              p.name || ' · ' || s.day_label AS label
         FROM sections s JOIN programs p ON p.id = s.program_id
        WHERE s.id = $1
          FOR UPDATE OF s SKIP LOCKED`,
      [sectionId],
    );
    if (rows[0]) await settleSection(c, rows[0], now);
  });
}

// --- Simulated activity from other families (dev tools) ---

export async function simulateDropout(sectionId: string, familyId: string, now: Date): Promise<boolean> {
  return tx(async (c) => {
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
  return tx(async (c) => {
    const s = await lockSection(c, sectionId);
    await settleSection(c, s, now);
    if ((await openSpots(c, s, now)) <= 0) return false;
    await c.query(
      `INSERT INTO holds (section_id, family_id, kind, expires_at) VALUES ($1, $2, 'cart', $3)`,
      [sectionId, familyId, new Date(now.getTime() + HOLD_MS)],
    );
    return true;
  });
}
