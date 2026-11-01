import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { HOLD_MS, OFFER_MS } from '@parks/shared';
import * as booking from '../src/booking.js';
import { BookingError } from '../src/booking.js';
import { createApp } from '../src/app.js';
import { pool } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { seed } from '../src/seed.js';
import { getState } from '../src/state.js';
import { sweepOnce } from '../src/sweeper.js';
import { clock } from '../src/clock.js';

// Runs against DATABASE_URL (the npm script points it at parks_test). Each test reseeds.

async function makeFamilies(n: number, age = 7): Promise<{ family: string; child: string }[]> {
  const out = [];
  for (let i = 0; i < n; i++) {
    const family = `f${i}`;
    const child = `f${i}-kid`;
    await pool.query('INSERT INTO families (id, name) VALUES ($1, $1)', [family]);
    await pool.query('INSERT INTO children (id, family_id, name, age) VALUES ($1, $2, $1, $3)', [child, family, age]);
    out.push({ family, child });
  }
  return out;
}

async function taken(sectionId: string, now: Date): Promise<{ regs: number; holds: number; capacity: number }> {
  const { rows } = await pool.query(
    `SELECT capacity,
            (SELECT count(*)::int FROM registrations WHERE section_id = $1 AND withdrawn_at IS NULL) AS regs,
            (SELECT count(*)::int FROM holds WHERE section_id = $1 AND expires_at > $2) AS holds
       FROM sections WHERE id = $1`,
    [sectionId, now],
  );
  return rows[0];
}

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

/** Move a section's first class to `ms` after `from` (default: now on the test clock). */
async function startsIn(sectionId: string, ms: number, from = clock.now()): Promise<void> {
  await pool.query('UPDATE sections SET starts_at = $2 WHERE id = $1', [sectionId, new Date(from.getTime() + ms)]);
}

/** Fill art-sat (9 of 10 seeded) so the next family has to wait. */
async function fillArtSat(): Promise<void> {
  await pool.query(`INSERT INTO registrations (section_id, family_id, confirmation, price_cents) VALUES ('art-sat', 'community', 'X-fill', 0)`);
}

async function offerFor(family: string, sectionId = 'art-sat') {
  return (await getState(family))!.sections.find((s) => s.sectionId === sectionId)!.holds.find((h) => h.kind === 'offer');
}

const codeOf = (r: PromiseSettledResult<unknown>) =>
  r.status === 'rejected' ? (r.reason instanceof BookingError ? r.reason.code : String(r.reason)) : 'ok';

before(async () => {
  await migrate(pool);
});
beforeEach(async () => {
  clock.reset();
  await seed(pool);
});
after(async () => {
  await pool.end();
});

describe('concurrent booking requests', () => {
  test('many families racing for the last spot: exactly one gets it', async () => {
    const families = await makeFamilies(25);
    const now = clock.now();
    // art-sat is seeded with 9 of 10 spots taken.
    const results = await Promise.allSettled(families.map((f) => booking.addToCart(f.family, 'art-sat', f.child, now)));
    const codes = results.map(codeOf);
    assert.equal(codes.filter((c) => c === 'ok').length, 1);
    assert.equal(codes.filter((c) => c === 'section_full').length, 24);
    const t = await taken('art-sat', now);
    assert.equal(t.regs + t.holds, t.capacity);
  });

  test('a busy section never goes over capacity with mixed adds, removes and checkouts', async () => {
    const families = await makeFamilies(30);
    const now = clock.now();
    // art-wed: 3 of 10 taken.
    await Promise.allSettled(
      families.map(async (f, i) => {
        const { hold } = await booking.addToCart(f.family, 'art-wed', f.child, now);
        if (i % 3 === 0) await booking.removeFromCart(f.family, hold.id, now);
        else await booking.checkout(f.family, [hold.id], now);
      }),
    );
    const t = await taken('art-wed', now);
    assert.ok(t.regs + t.holds <= t.capacity, `over capacity: ${JSON.stringify(t)}`);
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM registrations WHERE section_id = 'art-wed' AND family_id <> 'community'`);
    assert.equal(rows[0].n, t.regs - 3);
  });

  test('one child cannot be booked into two sections of a program at once', async () => {
    const [f] = await makeFamilies(1);
    const now = clock.now();
    const results = await Promise.allSettled([
      booking.addToCart(f!.family, 'art-wed', f!.child, now),
      booking.addToCart(f!.family, 'art-sat', f!.child, now),
    ]);
    assert.deepEqual(results.map(codeOf).sort(), ['already_involved', 'ok']);
  });

  test('a family can hold at most 3 spots, even when requests arrive together', async () => {
    const [f] = await makeFamilies(1);
    const kids = ['a', 'b', 'c', 'd', 'e'];
    for (const k of kids) await pool.query('INSERT INTO children (id, family_id, name, age) VALUES ($1, $2, $1, 7)', [k, f!.family]);
    const now = clock.now();
    const results = await Promise.allSettled(kids.map((k) => booking.addToCart(f!.family, 'art-wed', k, now)));
    // art-wed has 7 open spots, so the cart limit is what stops the 4th and 5th.
    assert.equal(results.map(codeOf).filter((c) => c === 'ok').length, 3);
  });

  test('two families joining a waitlist at once get distinct places in line', async () => {
    const families = await makeFamilies(10);
    const now = clock.now();
    // swim2-sat is full with 2 already waiting.
    const entries = await Promise.all(families.map((f) => booking.joinWaitlist(f.family, 'swim2-sat', f.child, now)));
    assert.deepEqual(entries.map((e) => e.position).sort((a, b) => a - b), [3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });
});

describe('holds and waitlist timing', () => {
  test('an expired cart hold frees the spot when nobody is waiting', async () => {
    const [a, b] = await makeFamilies(2);
    const t0 = clock.now();
    await booking.addToCart(a!.family, 'art-sat', a!.child, t0);
    await assert.rejects(booking.addToCart(b!.family, 'art-sat', b!.child, t0), { code: 'section_full' });

    clock.advance(HOLD_MS);
    await sweepOnce();
    await booking.addToCart(b!.family, 'art-sat', b!.child, clock.now());

    const { rows } = await pool.query(`SELECT message FROM notifications WHERE family_id = $1`, [a!.family]);
    assert.match(rows[0].message, /ran out/);
  });

  test('a freed spot is offered down the waitlist, and comes back when the line runs out', async () => {
    const [a, b, c] = await makeFamilies(3);
    const now = () => clock.now();
    // Fill art-sat and put both families in line.
    await pool.query(`INSERT INTO registrations (section_id, family_id, confirmation, price_cents) VALUES ('art-sat', 'community', 'X-1', 0)`);
    await booking.joinWaitlist(a!.family, 'art-sat', a!.child, now());
    await booking.joinWaitlist(b!.family, 'art-sat', b!.child, now());

    // Someone drops: A gets a 2-hour offer, B stays in line, and nobody else can take it.
    const dropAt = now();
    await booking.simulateDropout('art-sat', 'community', dropAt);
    const offerA = (await getState(a!.family))!.sections.find((s) => s.sectionId === 'art-sat')!.holds.find((h) => h.kind === 'offer')!;
    assert.equal(offerA.kind, 'offer');
    assert.equal(offerA.expiresAt - dropAt.getTime(), OFFER_MS);
    await assert.rejects(booking.addToCart(c!.family, 'art-sat', c!.child, now()), { code: 'section_full' });

    // A lets it lapse: it moves to B.
    clock.advance(OFFER_MS);
    await sweepOnce();
    const stateB = (await getState(b!.family))!;
    assert.equal(stateB.sections.find((s) => s.sectionId === 'art-sat')!.holds.find((h) => h.kind === 'offer')?.kind, 'offer');
    assert.equal(stateB.waitlist.length, 0);

    // B declines and the line is empty: the spot is open to anyone.
    const offerB = stateB.sections.find((s) => s.sectionId === 'art-sat')!.holds.find((h) => h.kind === 'offer')!;
    await booking.declineOffer(b!.family, offerB.id, now());
    await booking.addToCart(c!.family, 'art-sat', c!.child, now());
  });

  test('accepting an offer registers the child and charges in one step', async () => {
    const [a] = await makeFamilies(1);
    await booking.joinWaitlist(a!.family, 'swim2-sat', a!.child, clock.now());
    // Two community families are ahead, so the third dropout reaches family A.
    await booking.simulateDropout('swim2-sat', 'community', clock.now());
    await booking.simulateDropout('swim2-sat', 'community', clock.now());
    await booking.simulateDropout('swim2-sat', 'community', clock.now());
    const offer = (await getState(a!.family))!.sections.find((s) => s.sectionId === 'swim2-sat')!.holds.find((h) => h.kind === 'offer')!;
    const order = await booking.acceptOffer(a!.family, offer.id, clock.now());
    assert.equal(order.registrations.length, 1);
    assert.equal(order.totalCents, 8500);
    assert.equal(order.registrations[0]!.fromWaitlist, true);
    assert.match(order.registrations[0]!.confirmation, /^CV-\d+$/);
    // Straight to registered: nothing left in the cart or on offer.
    const state = (await getState(a!.family))!;
    assert.equal(state.sections.find((s) => s.sectionId === 'swim2-sat')!.holds.length, 0);
    assert.equal(state.registrations.length, 1);
  });

  test('an offer cannot be accepted after it expires', async () => {
    const [a] = await makeFamilies(1);
    await pool.query(`INSERT INTO registrations (section_id, family_id, confirmation, price_cents) VALUES ('art-sat', 'community', 'X-1', 0)`);
    await booking.joinWaitlist(a!.family, 'art-sat', a!.child, clock.now());
    await booking.simulateDropout('art-sat', 'community', clock.now());
    const offer = (await getState(a!.family))!.sections.find((s) => s.sectionId === 'art-sat')!.holds.find((h) => h.kind === 'offer')!;
    clock.advance(OFFER_MS + 1);
    await assert.rejects(booking.acceptOffer(a!.family, offer.id, clock.now()), { code: 'expired' });
  });

  test('checkout refuses when the cart changed under the family', async () => {
    const [a] = await makeFamilies(1);
    const { hold } = await booking.addToCart(a!.family, 'art-wed', a!.child, clock.now());
    clock.advance(HOLD_MS);
    await assert.rejects(booking.checkout(a!.family, [hold.id], clock.now()), { code: 'expired' });
  });
});

describe('dynamic offer windows', () => {
  for (const [label, until, window] of [
    ['more than 24 hours out: 2 hours', 25 * HOUR, 2 * HOUR],
    ['2–24 hours out: 30 minutes', 3 * HOUR, 30 * MIN],
    ['20 minutes–2 hours out: 10 minutes', HOUR, 10 * MIN],
    ['exactly 20 minutes out: 10 minutes, ending at the 10-minute cutoff', 20 * MIN, 10 * MIN],
  ] as const) {
    test(label, async () => {
      const [a] = await makeFamilies(1);
      await fillArtSat();
      await booking.joinWaitlist(a!.family, 'art-sat', a!.child, clock.now());
      const at = clock.now();
      await startsIn('art-sat', until, at);
      await booking.simulateDropout('art-sat', 'community', at);
      assert.equal((await offerFor(a!.family))!.expiresAt - at.getTime(), window);
    });
  }

  test('under 20 minutes out, nothing is offered automatically and the spot stays with the waitlist', async () => {
    const [a, walkIn] = await makeFamilies(2);
    await fillArtSat();
    await booking.joinWaitlist(a!.family, 'art-sat', a!.child, clock.now());
    await startsIn('art-sat', 15 * MIN);
    await booking.simulateDropout('art-sat', 'community', clock.now());
    await sweepOnce();

    assert.equal(await offerFor(a!.family), undefined);
    assert.equal((await getState(a!.family))!.waitlist.length, 1);
    // FIFO: the open seat isn't up for grabs while families are waiting for it.
    await assert.rejects(booking.addToCart(walkIn!.family, 'art-sat', walkIn!.child, clock.now()), { code: 'waitlist_priority' });
  });

  test('an expired offer moves to the next family, with a window recomputed for the new time', async () => {
    const [a, b, c] = await makeFamilies(3);
    await fillArtSat();
    for (const f of [a, b, c]) await booking.joinWaitlist(f!.family, 'art-sat', f!.child, clock.now());
    const at = clock.now();
    await startsIn('art-sat', 2 * HOUR + 40 * MIN, at);
    await booking.simulateDropout('art-sat', 'community', at);
    const offerA = (await offerFor(a!.family))!;
    assert.equal(offerA.expiresAt - at.getTime(), 30 * MIN);

    // A lets it lapse (2 h 10 min to go): B is offered 30 minutes from that moment.
    await booking.sweepSection('art-sat', new Date(offerA.expiresAt));
    assert.equal(await offerFor(a!.family), undefined);
    const offerB = (await offerFor(b!.family))!;
    assert.equal(offerB.expiresAt - offerA.expiresAt, 30 * MIN);

    // B lets it lapse (1 h 40 min to go): C gets only 10 minutes.
    await booking.sweepSection('art-sat', new Date(offerB.expiresAt));
    assert.equal((await offerFor(c!.family))!.expiresAt - offerB.expiresAt, 10 * MIN);
  });
});

describe('staff overrides near class start', () => {
  test('staff can offer the spot to the next family, even inside the last 10 minutes', async () => {
    const [a, b] = await makeFamilies(2);
    await fillArtSat();
    await booking.joinWaitlist(a!.family, 'art-sat', a!.child, clock.now());
    await booking.joinWaitlist(b!.family, 'art-sat', b!.child, clock.now());
    const at = clock.now();
    await startsIn('art-sat', 5 * MIN, at);
    await booking.simulateDropout('art-sat', 'community', at);
    assert.equal(await offerFor(a!.family), undefined);

    await booking.staffOffer('art-sat', 3 * MIN, at);
    assert.equal((await offerFor(a!.family))!.expiresAt - at.getTime(), 3 * MIN);
    assert.equal(await offerFor(b!.family), undefined, 'still first in line first');

    const { rows } = await pool.query(`SELECT actor FROM waitlist_events WHERE event = 'offered' ORDER BY id DESC LIMIT 1`);
    assert.equal(rows[0].actor, 'staff');
  });

  test('last call: everyone waiting is told, and of simultaneous claims exactly one wins', async () => {
    const families = await makeFamilies(4);
    await fillArtSat();
    const entries: { id: string }[] = [];
    for (const f of families) entries.push(await booking.joinWaitlist(f.family, 'art-sat', f.child, clock.now()));
    await startsIn('art-sat', 15 * MIN);
    await booking.simulateDropout('art-sat', 'community', clock.now());

    assert.equal(await booking.staffLastCall('art-sat', 10 * MIN, clock.now()), 4);
    const results = await Promise.allSettled(families.map((f, i) => booking.claimSpot(f.family, entries[i]!.id, clock.now())));
    assert.deepEqual(results.map(codeOf).sort(), ['ok', 'section_full', 'section_full', 'section_full']);
    const t = await taken('art-sat', clock.now());
    assert.equal(t.regs + t.holds, t.capacity);
  });

  test('last call is refused while automatic offers are still running (the spot is already offered)', async () => {
    const [a] = await makeFamilies(1);
    await fillArtSat();
    await booking.joinWaitlist(a!.family, 'art-sat', a!.child, clock.now());
    await startsIn('art-sat', 3 * HOUR);
    await assert.rejects(booking.staffLastCall('art-sat', 10 * MIN, clock.now()), { code: 'section_full' });
  });
});

describe('waitlist audit trail', () => {
  test('records joins, offers, declines, expirations and acceptances in order', async () => {
    const [a, b, c] = await makeFamilies(3);
    await fillArtSat();
    for (const f of [a, b, c]) await booking.joinWaitlist(f!.family, 'art-sat', f!.child, clock.now());
    await booking.simulateDropout('art-sat', 'community', clock.now());
    await booking.declineOffer(a!.family, (await offerFor(a!.family))!.id, clock.now());
    clock.advance(OFFER_MS);
    await sweepOnce();
    await booking.acceptOffer(c!.family, (await offerFor(c!.family))!.id, clock.now());

    const { rows } = await pool.query(
      `SELECT event, actor, family_id FROM waitlist_events WHERE section_id = 'art-sat' ORDER BY id`,
    );
    assert.deepEqual(rows.map((r) => `${r.event}:${r.actor}:${r.family_id}`), [
      `joined:family:${a!.family}`, `joined:family:${b!.family}`, `joined:family:${c!.family}`,
      `offered:system:${a!.family}`, `declined:family:${a!.family}`,
      `offered:system:${b!.family}`, `expired:system:${b!.family}`,
      `offered:system:${c!.family}`, `accepted:family:${c!.family}`,
    ]);
  });
});

describe('capacity guarantees', () => {
  test('the database refuses any write that would put a section over capacity', async () => {
    await fillArtSat();
    await assert.rejects(
      pool.query(`INSERT INTO registrations (section_id, family_id, confirmation, price_cents) VALUES ('art-sat', 'community', 'X-over', 0)`),
      /over capacity/,
    );
  });

  test('cancellations, walk-ins and waitlist acceptances at once never overbook or skip the line', async () => {
    const waiting = await makeFamilies(5);
    await fillArtSat();
    for (const f of waiting) await booking.joinWaitlist(f.family, 'art-sat', f.child, clock.now());
    const walkIns = await Promise.all(Array.from({ length: 10 }, async (_, i) => {
      await pool.query('INSERT INTO families (id, name) VALUES ($1, $1)', [`walk${i}`]);
      await pool.query('INSERT INTO children (id, family_id, name, age) VALUES ($1, $2, $1, 7)', [`walk${i}-kid`, `walk${i}`]);
      return { family: `walk${i}`, child: `walk${i}-kid` };
    }));

    // Three families cancel while ten walk-ins try to grab the freed seats.
    await Promise.allSettled([
      ...[1, 2, 3].map(() => booking.simulateDropout('art-sat', 'community', clock.now())),
      ...walkIns.map((w) => booking.addToCart(w.family, 'art-sat', w.child, clock.now())),
    ]);
    // Everyone offered accepts at once, while two more families cancel.
    const offered = [];
    for (const f of waiting) {
      const o = await offerFor(f.family);
      if (o) offered.push({ f, o });
    }
    assert.equal(offered.length, 3);
    await Promise.allSettled([
      ...offered.map(({ f, o }) => booking.acceptOffer(f.family, o.id, clock.now())),
      ...[1, 2].map(() => booking.simulateDropout('art-sat', 'community', clock.now())),
    ]);

    const t = await taken('art-sat', clock.now());
    assert.ok(t.regs + t.holds <= t.capacity, JSON.stringify(t));
    const { rows } = await pool.query(
      `SELECT family_id FROM registrations WHERE section_id = 'art-sat' AND withdrawn_at IS NULL AND family_id LIKE 'walk%'`,
    );
    assert.equal(rows.length, 0, 'no walk-in got a seat while families were waiting');
  });
});

describe('independent review findings (regressions)', () => {
  test('two siblings on one waitlist: accepting one offer while a withdrawal promotes the other does not deadlock', async () => {
    // Family F's kids k1 and k2 are both waiting; k1 has an offer. G withdraws (which offers k2 a
    // spot, touching F's family row) at the same moment F accepts k1's offer (which locks F first).
    await pool.query(`INSERT INTO families (id, name) VALUES ('F', 'F'), ('G', 'G')`);
    await pool.query(`INSERT INTO children (id, family_id, name, age) VALUES ('k1', 'F', 'k1', 8), ('k2', 'F', 'k2', 8), ('g1', 'G', 'g1', 8)`);
    const { rows: reg } = await pool.query(
      `INSERT INTO registrations (section_id, family_id, child_id, confirmation, price_cents) VALUES ('art-sat', 'G', 'g1', 'X-g', 0) RETURNING id`,
    );
    await booking.joinWaitlist('F', 'art-sat', 'k1', clock.now());
    await booking.joinWaitlist('F', 'art-sat', 'k2', clock.now());
    await booking.simulateDropout('art-sat', 'community', clock.now());
    const offer = (await offerFor('F'))!;

    // Hold the section so both requests queue on it in a known order: withdraw first, then accept.
    const blocker = await pool.connect();
    await blocker.query('BEGIN');
    await blocker.query(`SELECT 1 FROM sections WHERE id = 'art-sat' FOR UPDATE`);
    const withdrawal = booking.withdraw('G', String(reg[0].id), clock.now());
    await new Promise((r) => setTimeout(r, 100));
    const acceptance = booking.acceptOffer('F', offer.id, clock.now());
    await new Promise((r) => setTimeout(r, 100));
    await blocker.query('COMMIT');
    blocker.release();

    const results = await Promise.allSettled([withdrawal, acceptance]);
    assert.deepEqual(results.map(codeOf), ['ok', 'ok']);
  });

  test("a family's own lock never blocks the sweeper from offering that family a spot", async () => {
    const [a, b] = await makeFamilies(2);
    await fillArtSat();
    await booking.joinWaitlist(a!.family, 'art-sat', a!.child, clock.now());
    await booking.joinWaitlist(b!.family, 'art-sat', b!.child, clock.now());
    await booking.simulateDropout('art-sat', 'community', clock.now());

    // A request from family A holds A's row (as acceptOffer does) while the sweeper expires A's offer.
    const request = await pool.connect();
    await request.query('BEGIN');
    await request.query(`SELECT 1 FROM families WHERE id = $1 ${booking.ROW_LOCK}`, [a!.family]);
    const sweep = booking.sweepSection('art-sat', new Date(clock.now().getTime() + OFFER_MS)).then(() => 'done');
    const outcome = await Promise.race([sweep, new Promise((r) => setTimeout(() => r('blocked'), 2000))]);
    await request.query('COMMIT');
    request.release();
    await sweep;
    assert.equal(outcome, 'done');
  });

  test('asking for an unknown family leaves no open transaction on a pooled connection', async () => {
    const [f] = await makeFamilies(1);
    for (let i = 0; i < 25; i++) assert.equal(await getState('nobody'), null);
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND state LIKE 'idle in transaction%'`,
    );
    assert.equal(rows[0].n, 0);
    await booking.addToCart(f!.family, 'art-wed', f!.child, clock.now());
  });

  test('a checkout across two sections keeps both waitlist promotions when it fails', async () => {
    const [f, w1, w2] = await makeFamilies(3);
    await pool.query(`INSERT INTO children (id, family_id, name, age) VALUES ('f-kid2', $1, 'kid2', 7)`, [f!.family]);
    await pool.query(
      `INSERT INTO registrations (section_id, family_id, confirmation, price_cents) VALUES ('swim2-tue', 'community', 'X-t1', 0), ('swim2-tue', 'community', 'X-t2', 0)`,
    );
    const h1 = await booking.addToCart(f!.family, 'art-sat', f!.child, clock.now());
    const h2 = await booking.addToCart(f!.family, 'swim2-tue', 'f-kid2', clock.now());
    await booking.joinWaitlist(w1!.family, 'art-sat', w1!.child, clock.now());
    await booking.joinWaitlist(w2!.family, 'swim2-tue', w2!.child, clock.now());

    clock.advance(HOLD_MS);
    await assert.rejects(booking.checkout(f!.family, [h1.hold.id, h2.hold.id], clock.now()), { code: 'expired' });
    assert.equal((await offerFor(w1!.family, 'art-sat'))?.kind, 'offer');
    assert.equal((await offerFor(w2!.family, 'swim2-tue'))?.kind, 'offer');
  });

  test('moving a class earlier pulls open offers back inside the 10-minute cutoff', async () => {
    const [a] = await makeFamilies(1);
    await fillArtSat();
    await booking.joinWaitlist(a!.family, 'art-sat', a!.child, clock.now());
    const at = clock.now();
    await booking.simulateDropout('art-sat', 'community', at); // 2-hour offer: class is weeks away
    await booking.setSectionStart('art-sat', new Date(at.getTime() + 15 * MIN), at);
    assert.ok((await offerFor(a!.family))!.expiresAt <= at.getTime() + 5 * MIN);
  });
});

describe('expired-offer transaction bug (regression)', () => {
  test('accepting an expired offer still passes the spot to the next family, without waiting for the sweeper', async () => {
    const [a, b] = await makeFamilies(2);
    await pool.query(`INSERT INTO registrations (section_id, family_id, confirmation, price_cents) VALUES ('art-sat', 'community', 'X-1', 0)`);
    await booking.joinWaitlist(a!.family, 'art-sat', a!.child, clock.now());
    await booking.joinWaitlist(b!.family, 'art-sat', b!.child, clock.now());
    await booking.simulateDropout('art-sat', 'community', clock.now());
    const offer = (await getState(a!.family))!.sections.find((s) => s.sectionId === 'art-sat')!.holds[0]!;

    clock.advance(OFFER_MS + 1);
    await assert.rejects(booking.acceptOffer(a!.family, offer.id, clock.now()), { code: 'expired' });
    // No sweepOnce() here: the failed request itself must have handed the spot on.
    const bHolds = (await getState(b!.family))!.sections.find((s) => s.sectionId === 'art-sat')!.holds;
    assert.equal(bHolds[0]?.kind, 'offer');
  });

  test('a request that fails a check still keeps the expirations it processed', async () => {
    const [a, b, walkIn] = await makeFamilies(3);
    await fillArtSat();
    await booking.joinWaitlist(a!.family, 'art-sat', a!.child, clock.now());
    await booking.joinWaitlist(b!.family, 'art-sat', b!.child, clock.now());
    await booking.simulateDropout('art-sat', 'community', clock.now());
    clock.advance(OFFER_MS);
    // A walk-in's add-to-cart settles the section (A's offer lapses, B is offered), then fails.
    await assert.rejects(booking.addToCart(walkIn!.family, 'art-sat', walkIn!.child, clock.now()), { code: 'section_full' });
    assert.equal((await offerFor(b!.family))?.kind, 'offer');
  });
});

describe('charging waitlisted families', () => {
  test('nobody on the waitlist is registered or charged without accepting, even as offers lapse', async () => {
    const families = await makeFamilies(3);
    await pool.query(`INSERT INTO registrations (section_id, family_id, confirmation, price_cents) VALUES ('art-sat', 'community', 'X-1', 0)`);
    for (const f of families) await booking.joinWaitlist(f.family, 'art-sat', f.child, clock.now());
    await booking.simulateDropout('art-sat', 'community', clock.now());

    // Each family in turn gets the offer and lets it lapse.
    for (const f of families) {
      const offers = (await getState(f.family))!.sections.find((s) => s.sectionId === 'art-sat')!.holds;
      assert.equal(offers.length, 1);
      assert.equal(offers[0]!.kind, 'offer');
      clock.advance(OFFER_MS);
      await sweepOnce();
    }
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM registrations WHERE family_id = ANY($1) AND withdrawn_at IS NULL`,
      [families.map((f) => f.family)],
    );
    assert.equal(rows[0].n, 0);
  });
});

describe('registration opening times', () => {
  test('nobody can cart or waitlist before registration opens, and reminders go out when it does', async () => {
    const [a] = await makeFamilies(1, 10);
    // bball is seeded to open 3 minutes from now.
    await assert.rejects(booking.addToCart(a!.family, 'bball-w1', a!.child, clock.now()), { code: 'not_open' });
    await booking.setReminder(a!.family, 'bball', true);
    assert.deepEqual((await getState(a!.family))!.reminders, ['bball']);

    clock.advance(3 * 60 * 1000);
    await sweepOnce();
    const state = (await getState(a!.family))!;
    assert.deepEqual(state.reminders, []);
    assert.match(state.notices.at(-1)!.message, /Youth Basketball Camp is open now/);
    await booking.addToCart(a!.family, 'bball-w1', a!.child, clock.now());
  });
});

describe('HTTP API', () => {
  test('another family’s waitlist offer is invisible too', async () => {
    const [w] = await makeFamilies(1);
    await fillArtSat();
    await booking.joinWaitlist(w!.family, 'art-sat', w!.child, clock.now());
    await booking.simulateDropout('art-sat', 'community', clock.now());
    const res = await request(createApp()).get('/api/state').set('x-family-id', 'demo').expect(200);
    const sat = res.body.sections.find((s: { sectionId: string }) => s.sectionId === 'art-sat');
    assert.deepEqual(sat.holds, []);
    assert.equal(sat.taken, 10);
    assert.ok(!JSON.stringify(res.body).includes(w!.family));
  });

  test('another family’s hold shows only as a taken spot, with no timer', async () => {
    const app = createApp();
    const res = await request(app).get('/api/state').set('x-family-id', 'demo').expect(200);
    // swim2-thu: 5 registered plus another family's cart hold, out of 6.
    const thu = res.body.sections.find((s: { sectionId: string }) => s.sectionId === 'swim2-thu');
    assert.deepEqual(thu.holds, []);
    assert.equal(thu.taken, 6);
    assert.ok(!JSON.stringify(res.body).includes('expiresAt'), 'no hold timers for a family with no holds');
  });

  test('accepting an offer over HTTP returns the paid registration', async () => {
    const app = createApp();
    await pool.query(`INSERT INTO registrations (section_id, family_id, confirmation, price_cents) VALUES ('art-sat', 'community', 'X-1', 0)`);
    await request(app).post('/api/waitlist').send({ sectionId: 'art-sat', childId: 'maya' }).expect(201);
    await booking.simulateDropout('art-sat', 'community', clock.now());
    const state = await request(app).get('/api/state').expect(200);
    const offer = state.body.sections.find((s: { sectionId: string }) => s.sectionId === 'art-sat').holds[0];
    const res = await request(app).post(`/api/offers/${offer.id}/accept`).expect(201);
    assert.equal(res.body.totalCents, 9500);
  });

  test('add to cart, then the error shape for a full section', async () => {
    const app = createApp();
    await request(app).post('/api/cart').send({ sectionId: 'swim2-tue', childId: 'maya' }).expect(201);
    const res = await request(app).post('/api/cart').send({ sectionId: 'swim1-wed', childId: 'maya' }).expect(409);
    assert.equal(res.body.error.code, 'not_eligible');
  });
});
