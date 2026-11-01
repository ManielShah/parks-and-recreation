import type { CatalogResponse, Category, Program, StateResponse } from '@parks/shared';
import { pool } from './db.js';
import { clock } from './clock.js';
import { config } from './config.js';

export async function getCatalog(): Promise<CatalogResponse> {
  const { rows: programs } = await pool.query(
    `SELECT id, name, category, min_age, max_age, location, price_cents, dates_label, description,
            capacity_note, registration_opens_at
       FROM programs ORDER BY sort_order, id`,
  );
  const { rows: sections } = await pool.query(
    'SELECT id, program_id, day_label, time_label, capacity, starts_at, min_age, max_age FROM sections ORDER BY sort_order, id',
  );
  return {
    programs: programs.map((p): Program => ({
      id: p.id, name: p.name, category: p.category as Category, minAge: p.min_age, maxAge: p.max_age,
      location: p.location, priceCents: p.price_cents, dates: p.dates_label, description: p.description,
      capacityNote: p.capacity_note, registrationOpensAt: p.registration_opens_at ? p.registration_opens_at.getTime() : null,
      sections: sections
        .filter((s) => s.program_id === p.id)
        .map((s) => ({
          id: s.id, programId: s.program_id, day: s.day_label, time: s.time_label, capacity: s.capacity,
          startsAt: s.starts_at.getTime(), minAge: s.min_age, maxAge: s.max_age,
        })),
    })),
  };
}

/**
 * Everything one family's screen needs, read in a single snapshot. Other families' cart holds and
 * waitlist offers are folded into `taken`: nobody sees that another family is eyeing a spot, or for how long.
 */
export async function getState(familyId: string): Promise<StateResponse | null> {
  const now = clock.now();
  const c = await pool.connect();
  try {
    await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const { rows: fam } = await c.query('SELECT id, name FROM families WHERE id = $1', [familyId]);
    if (!fam[0]) {
      // Close the transaction before the connection goes back to the pool (found by the independent review).
      await c.query('ROLLBACK');
      return null;
    }

    const [kids, sections, taken, holds, waitlist, regs, waits, notices, reminders] = await Promise.all([
      c.query('SELECT id, name, age FROM children WHERE family_id = $1 ORDER BY age, name', [familyId]),
      c.query('SELECT id, capacity, last_call_until FROM sections ORDER BY id'),
      c.query(
        `SELECT section_id, count(*)::int AS n FROM (
           SELECT section_id FROM registrations WHERE withdrawn_at IS NULL
           UNION ALL
           SELECT section_id FROM holds WHERE family_id <> $1 AND expires_at > $2) t
          GROUP BY section_id`,
        [familyId, now],
      ),
      c.query(
        `SELECT id, section_id, kind, child_id, expires_at FROM holds
          WHERE family_id = $1 AND expires_at > $2 ORDER BY id`,
        [familyId, now],
      ),
      c.query('SELECT section_id, count(*)::int AS n FROM waitlist_entries GROUP BY section_id'),
      c.query(
        `SELECT id, section_id, child_id, confirmation, price_cents, from_waitlist FROM registrations
          WHERE family_id = $1 AND withdrawn_at IS NULL ORDER BY id`,
        [familyId],
      ),
      c.query(
        `SELECT id, section_id, child_id, position FROM (
           SELECT id, section_id, family_id, child_id, row_number() OVER (PARTITION BY section_id ORDER BY id)::int AS position
             FROM waitlist_entries) w
          WHERE family_id = $1 ORDER BY id`,
        [familyId],
      ),
      c.query(
        'SELECT id, tone, message, created_at FROM notifications WHERE family_id = $1 AND seen_at IS NULL ORDER BY id',
        [familyId],
      ),
      c.query('SELECT program_id FROM registration_reminders WHERE family_id = $1 AND notified_at IS NULL', [familyId]),
    ]);
    await c.query('COMMIT');

    const count = (rows: { section_id: string; n: number }[], id: string) => rows.find((r) => r.section_id === id)?.n ?? 0;
    // A waitlisted family can claim a spot while a staff last call is running and a spot is free.
    const claimableUntil = (sectionId: string): number | null => {
      const s = sections.rows.find((r) => r.id === sectionId);
      if (!s?.last_call_until || s.last_call_until <= now) return null;
      const mine = holds.rows.filter((h) => h.section_id === sectionId).length;
      return s.capacity - count(taken.rows, sectionId) - mine > 0 ? s.last_call_until.getTime() : null;
    };
    return {
      serverNow: now.getTime(),
      family: { id: fam[0].id, name: fam[0].name },
      kids: kids.rows,
      sections: sections.rows.map((s) => ({
        sectionId: s.id,
        capacity: s.capacity,
        taken: count(taken.rows, s.id),
        waitlistLength: count(waitlist.rows, s.id),
        holds: holds.rows
          .filter((h) => h.section_id === s.id)
          .map((h) => ({ id: String(h.id), sectionId: h.section_id, kind: h.kind, childId: h.child_id, expiresAt: h.expires_at.getTime() })),
      })),
      registrations: regs.rows.map((r) => ({
        id: String(r.id), sectionId: r.section_id, childId: r.child_id, confirmation: r.confirmation, priceCents: r.price_cents,
        fromWaitlist: r.from_waitlist,
      })),
      waitlist: waits.rows.map((w) => ({ id: String(w.id), sectionId: w.section_id, childId: w.child_id, position: w.position,
        claimableUntil: claimableUntil(w.section_id),
      })),
      notices: notices.rows.map((n) => ({ id: String(n.id), tone: n.tone, message: n.message, createdAt: n.created_at.getTime() })),
      reminders: reminders.rows.map((r) => r.program_id),
      dev: { enabled: config.devTools, clockOffsetMs: clock.offsetMs() },
    };
  } catch (err) {
    await c.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    c.release();
  }
}

export async function markNoticesSeen(familyId: string, upToId: string): Promise<void> {
  await pool.query('UPDATE notifications SET seen_at = now() WHERE family_id = $1 AND id <= $2 AND seen_at IS NULL', [familyId, upToId]);
}
