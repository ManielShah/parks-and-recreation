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
    'SELECT id, program_id, day_label, time_label, capacity FROM sections ORDER BY sort_order, id',
  );
  return {
    programs: programs.map((p): Program => ({
      id: p.id, name: p.name, category: p.category as Category, minAge: p.min_age, maxAge: p.max_age,
      location: p.location, priceCents: p.price_cents, dates: p.dates_label, description: p.description,
      capacityNote: p.capacity_note, registrationOpensAt: p.registration_opens_at ? p.registration_opens_at.getTime() : null,
      sections: sections
        .filter((s) => s.program_id === p.id)
        .map((s) => ({ id: s.id, programId: s.program_id, day: s.day_label, time: s.time_label, capacity: s.capacity })),
    })),
  };
}

/**
 * Everything one family's screen needs, read in a single snapshot. Other families' holds are
 * included so the family sees spots in carts, but without who holds them.
 */
export async function getState(familyId: string): Promise<StateResponse | null> {
  const now = clock.now();
  const c = await pool.connect();
  try {
    await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const { rows: fam } = await c.query('SELECT id, name FROM families WHERE id = $1', [familyId]);
    if (!fam[0]) return null;

    const [kids, sections, enrolled, holds, waitlist, regs, waits, notices, reminders] = await Promise.all([
      c.query('SELECT id, name, age FROM children WHERE family_id = $1 ORDER BY age, name', [familyId]),
      c.query('SELECT id, capacity FROM sections ORDER BY id'),
      c.query(`SELECT section_id, count(*)::int AS n FROM registrations WHERE withdrawn_at IS NULL GROUP BY section_id`),
      c.query(
        `SELECT id, section_id, family_id = $1 AS mine, kind, child_id, accepted, expires_at
           FROM holds WHERE expires_at > $2 ORDER BY id`,
        [familyId, now],
      ),
      c.query('SELECT section_id, count(*)::int AS n FROM waitlist_entries GROUP BY section_id'),
      c.query(
        `SELECT id, section_id, child_id, confirmation, price_cents, auto_registered FROM registrations
          WHERE family_id = $1 AND withdrawn_at IS NULL ORDER BY id`,
        [familyId],
      ),
      c.query(
        `SELECT id, section_id, child_id, position, auto_register FROM (
           SELECT id, section_id, family_id, child_id, auto_register, row_number() OVER (PARTITION BY section_id ORDER BY id)::int AS position
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
    return {
      serverNow: now.getTime(),
      family: { id: fam[0].id, name: fam[0].name },
      kids: kids.rows,
      sections: sections.rows.map((s) => ({
        sectionId: s.id,
        capacity: s.capacity,
        enrolled: count(enrolled.rows, s.id),
        waitlistLength: count(waitlist.rows, s.id),
        holds: holds.rows
          .filter((h) => h.section_id === s.id)
          .map((h) => ({
            id: h.mine ? String(h.id) : '',
            sectionId: h.section_id,
            mine: h.mine,
            kind: h.kind,
            childId: h.mine ? h.child_id : null,
            accepted: h.mine ? h.accepted : false,
            expiresAt: h.expires_at.getTime(),
          })),
      })),
      registrations: regs.rows.map((r) => ({
        id: String(r.id), sectionId: r.section_id, childId: r.child_id, confirmation: r.confirmation, priceCents: r.price_cents,
        autoRegistered: r.auto_registered,
      })),
      waitlist: waits.rows.map((w) => ({ id: String(w.id), sectionId: w.section_id, childId: w.child_id, position: w.position, autoRegister: w.auto_register })),
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
