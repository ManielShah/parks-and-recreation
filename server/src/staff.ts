import type { StaffOverviewResponse } from '@parks/shared';
import { pool } from './db.js';
import { clock } from './clock.js';

/** Every section's seats, offers and line, plus the latest waitlist audit events. Read-only. */
export async function getStaffOverview(): Promise<StaffOverviewResponse> {
  const now = clock.now();
  const [sections, offers, waitlist, events] = await Promise.all([
    pool.query(
      `SELECT s.id, p.name AS program_name, s.day_label, s.time_label, s.starts_at, s.capacity, s.last_call_until,
              (SELECT count(*)::int FROM registrations r WHERE r.section_id = s.id AND r.withdrawn_at IS NULL) AS registered,
              (SELECT count(*)::int FROM holds h WHERE h.section_id = s.id AND h.kind = 'cart' AND h.expires_at > $1) AS in_carts
         FROM sections s JOIN programs p ON p.id = s.program_id
        ORDER BY s.starts_at, s.id`,
      [now],
    ),
    pool.query(
      `SELECT h.section_id, f.name AS family_name, c.name AS child_name, h.expires_at
         FROM holds h JOIN families f ON f.id = h.family_id LEFT JOIN children c ON c.id = h.child_id
        WHERE h.kind = 'offer' AND h.expires_at > $1 ORDER BY h.expires_at`,
      [now],
    ),
    pool.query(
      `SELECT w.section_id, f.name AS family_name, c.name AS child_name,
              row_number() OVER (PARTITION BY w.section_id ORDER BY w.id)::int AS position
         FROM waitlist_entries w JOIN families f ON f.id = w.family_id LEFT JOIN children c ON c.id = w.child_id
        ORDER BY w.section_id, w.id`,
    ),
    pool.query(
      `SELECT e.id, e.created_at, e.section_id, p.name || ' · ' || s.day_label AS section_label, e.event, e.actor,
              f.name AS family_name, c.name AS child_name, e.offer_expires_at, e.detail
         FROM waitlist_events e
         JOIN sections s ON s.id = e.section_id JOIN programs p ON p.id = s.program_id
         LEFT JOIN families f ON f.id = e.family_id LEFT JOIN children c ON c.id = e.child_id
        ORDER BY e.id DESC LIMIT 50`,
    ),
  ]);

  return {
    serverNow: now.getTime(),
    sections: sections.rows.map((s) => ({
      sectionId: s.id,
      programName: s.program_name,
      day: s.day_label,
      time: s.time_label,
      startsAt: s.starts_at.getTime(),
      capacity: s.capacity,
      registered: s.registered,
      inCarts: s.in_carts,
      offers: offers.rows
        .filter((o) => o.section_id === s.id)
        .map((o) => ({ familyName: o.family_name, childName: o.child_name, expiresAt: o.expires_at.getTime() })),
      waitlist: waitlist.rows
        .filter((w) => w.section_id === s.id)
        .map((w) => ({ position: w.position, familyName: w.family_name, childName: w.child_name })),
      lastCallUntil: s.last_call_until && s.last_call_until > now ? s.last_call_until.getTime() : null,
    })),
    events: events.rows.map((e) => ({
      id: String(e.id),
      at: e.created_at.getTime(),
      sectionId: e.section_id,
      sectionLabel: e.section_label,
      event: e.event,
      actor: e.actor,
      familyName: e.family_name,
      childName: e.child_name,
      offerExpiresAt: e.offer_expires_at ? e.offer_expires_at.getTime() : null,
      detail: e.detail,
    })),
  };
}
