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
