import type pg from 'pg';
import { HOLD_MS } from '@parks/shared';
import { clock } from './clock.js';

/** Stands in for every family that isn't the signed-in one: seeded enrollment, waitlists and simulated activity. */
export const COMMUNITY_FAMILY = 'community';
export const DEMO_FAMILY = 'demo';

interface SeedSection {
  id: string;
  day: string;
  time: string;
  /** First class: days after the session's first Monday, and local start time. */
  start: { day: number; hour: number; minute?: number };
  /** Narrower age range for this section only; omitted means the program's range applies. */
  ages?: [number, number];
  enrolled: number;
  waitlist?: number;
}

interface SeedProgram {
  id: string;
  name: string;
  category: string;
  minAge: number;
  maxAge: number;
  location: string;
  price: number;
  dates: string;
  description: string;
  /** Class size for every section of the program. */
  capacity: number;
  capacityNote: string;
  /** Registration opens this long after seeding, or on the given day at 9 am. */
  opensInMs?: number;
  opensInDays?: number;
  sections: SeedSection[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** First Monday on or after January 4 of next year: the start of the next winter session. */
function nextWinterMonday(now: Date): Date {
  const d = new Date(now.getFullYear() + 1, 0, 4);
  while (d.getDay() !== 1) d.setDate(d.getDate() + 1);
  return d;
}

function firstClass(sessionStart: Date, start: SeedSection['start']): Date {
  const d = new Date(sessionStart);
  d.setDate(d.getDate() + start.day);
  d.setHours(start.hour, start.minute ?? 0, 0, 0);
  return d;
}

export const SEED_PROGRAMS: SeedProgram[] = [
  {
    id: 'tots', name: 'Tiny Tumblers', category: 'Gymnastics', minAge: 3, maxAge: 5,
    capacity: 8, capacityNote: '2 coaches, 4 kids each',
    location: 'Central Rec Gym', price: 70, dates: 'Jan 9 – Feb 27',
    description: 'Rolls, balance beams and soft landings for preschoolers. A parent or caregiver stays on deck for the first two classes.',
    sections: [
      { id: 'tots-fri', day: 'Fridays', time: '10:00–10:45 am', ages: [3, 4], start: { day: 4, hour: 10 }, enrolled: 5 },
      { id: 'tots-sat', day: 'Saturdays', time: '9:00–9:45 am', start: { day: 5, hour: 9 }, enrolled: 4 },
    ],
  },
  {
    id: 'swim1', name: 'Swim Level 1', category: 'Aquatics', minAge: 4, maxAge: 6,
    capacity: 4, capacityNote: 'Beginners need an instructor within arm’s reach',
    location: 'Northside Aquatic Center', price: 85, dates: 'Jan 5 – Feb 23',
    description: 'Water comfort, floating and kicking with support. For kids who are new to lessons.',
    sections: [
      { id: 'swim1-mon', day: 'Mondays', time: '4:00–4:45 pm', start: { day: 0, hour: 16 }, enrolled: 2 },
      { id: 'swim1-wed', day: 'Wednesdays', time: '4:00–4:45 pm', start: { day: 2, hour: 16 }, enrolled: 4, waitlist: 1 },
    ],
  },
  {
    id: 'swim2', name: 'Swim Level 2', category: 'Aquatics', minAge: 6, maxAge: 8,
    capacity: 6, capacityNote: '1 instructor per 6 swimmers',
    location: 'Northside Aquatic Center', price: 85, dates: 'Jan 6 – Feb 28',
    description: 'Front and back glides, rhythmic breathing, and swimming 5 yards on their own. Kids should be comfortable putting their face in the water.',
    sections: [
      { id: 'swim2-tue', day: 'Tuesdays', time: '4:00–5:00 pm', ages: [6, 7], start: { day: 1, hour: 16 }, enrolled: 3 },
      { id: 'swim2-thu', day: 'Thursdays', time: '4:00–5:00 pm', start: { day: 3, hour: 16 }, enrolled: 5 },
      { id: 'swim2-sat', day: 'Saturdays', time: '10:00–11:00 am', ages: [7, 8], start: { day: 5, hour: 10 }, enrolled: 6, waitlist: 2 },
    ],
  },
  {
    id: 'art', name: 'Art Studio: Clay & Paint', category: 'Arts', minAge: 5, maxAge: 10,
    capacity: 10, capacityNote: 'Limited by studio tables and kiln space',
    location: 'Oak Street Arts Studio', price: 95, dates: 'Jan 7 – Feb 28',
    description: 'Hand-building with clay, then glazing and painting what they made. All materials included. Wear clothes that can get messy.',
    sections: [
      { id: 'art-wed', day: 'Wednesdays', time: '3:30–5:00 pm', ages: [5, 7], start: { day: 2, hour: 15, minute: 30 }, enrolled: 3 },
      { id: 'art-sat', day: 'Saturdays', time: '1:00–2:30 pm', start: { day: 5, hour: 13 }, enrolled: 9 },
    ],
  },
  {
    id: 'bball', name: 'Youth Basketball Camp', category: 'Sports', minAge: 9, maxAge: 12,
    capacity: 16, capacityNote: '2 coaches, 8 players each, one court', opensInMs: 3 * 60 * 1000,
    location: 'Central Rec Gym', price: 140, dates: 'Winter break, Mon–Fri',
    description: 'A week of dribbling, passing and small-sided games. Bring a water bottle and court shoes.',
    sections: [
      { id: 'bball-w1', day: 'Jan 5–9', time: 'Mon–Fri, 9 am–12 pm', ages: [9, 10], start: { day: 0, hour: 9 }, enrolled: 0 },
      { id: 'bball-w2', day: 'Jan 12–16', time: 'Mon–Fri, 9 am–12 pm', ages: [11, 12], start: { day: 7, hour: 9 }, enrolled: 0 },
    ],
  },
  {
    id: 'climb', name: 'Teen Climbing', category: 'Sports', minAge: 13, maxAge: 17,
    capacity: 6, capacityNote: '1 belay instructor per 3 climbers, 2 instructors', opensInDays: 14,
    location: 'Central Rec Climbing Wall', price: 110, dates: 'Jan 8 – Feb 26',
    description: 'Top-rope climbing with certified staff, plus knots and belay basics. Harness and shoes provided.',
    sections: [{ id: 'climb-thu', day: 'Thursdays', time: '6:00–7:30 pm', start: { day: 3, hour: 18 }, enrolled: 0 }],
  },
];

/** Wipe all data and load the winter catalog plus the demo family. Development and tests only. */
export async function seed(pool: pg.Pool): Promise<void> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('TRUNCATE registration_reminders, notifications, waitlist_entries, holds, registrations, sections, programs, children, families RESTART IDENTITY CASCADE');
    await c.query("SELECT setval('confirmation_seq', 20417, false)");

    await c.query('INSERT INTO families (id, name) VALUES ($1, $2), ($3, $4)', [
      DEMO_FAMILY, 'Demo family', COMMUNITY_FAMILY, 'Other families',
    ]);
    await c.query(
      `INSERT INTO children (id, family_id, name, age) VALUES ('maya', $1, 'Maya', 7), ('leo', $1, 'Leo', 10)`,
      [DEMO_FAMILY],
    );

    const now = clock.now().getTime();
    const sessionStart = nextWinterMonday(clock.now());
    for (const [pi, p] of SEED_PROGRAMS.entries()) {
      let opensAt: Date | null = null;
      if (p.opensInMs) opensAt = new Date(now + p.opensInMs);
      if (p.opensInDays) {
        opensAt = new Date(now + p.opensInDays * DAY_MS);
        opensAt.setHours(9, 0, 0, 0);
      }
      await c.query(
        `INSERT INTO programs (id, name, category, min_age, max_age, location, price_cents, dates_label, description,
                               capacity_note, registration_opens_at, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [p.id, p.name, p.category, p.minAge, p.maxAge, p.location, p.price * 100, p.dates, p.description,
          p.capacityNote, opensAt, pi],
      );
      for (const [si, s] of p.sections.entries()) {
        if (s.ages && (s.ages[0] < p.minAge || s.ages[1] > p.maxAge)) {
          throw new Error(`${s.id}: ages ${s.ages.join('–')} fall outside ${p.id}'s ${p.minAge}–${p.maxAge}`);
        }
        await c.query(
          `INSERT INTO sections (id, program_id, day_label, time_label, capacity, starts_at, min_age, max_age, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [s.id, p.id, s.day, s.time, p.capacity, firstClass(sessionStart, s.start), s.ages?.[0] ?? null, s.ages?.[1] ?? null, si],
        );
        for (let i = 0; i < s.enrolled; i++) {
          await c.query(
            `INSERT INTO registrations (section_id, family_id, confirmation, price_cents)
             VALUES ($1, $2, 'CV-SEED-' || $1 || '-' || $3, $4)`,
            [s.id, COMMUNITY_FAMILY, i, p.price * 100],
          );
        }
        for (let i = 0; i < (s.waitlist ?? 0); i++) {
          await c.query('INSERT INTO waitlist_entries (section_id, family_id) VALUES ($1, $2)', [s.id, COMMUNITY_FAMILY]);
        }
      }
    }

    // Another family is already checking out with the last Thursday swim spot.
    await c.query(
      `INSERT INTO holds (section_id, family_id, kind, expires_at) VALUES ('swim2-thu', $1, 'cart', $2)`,
      [COMMUNITY_FAMILY, new Date(clock.now().getTime() + HOLD_MS / 2)],
    );
    await c.query('COMMIT');
  } catch (err) {
    await c.query('ROLLBACK');
    throw err;
  } finally {
    c.release();
  }
}
