<div align="center">

# 🌲 Cedar Valley Parks & Recreation

**Program registration that never overbooks a class and never lets a freed seat sit idle.**

![React](https://img.shields.io/badge/React_18-TypeScript-1D5FD1?style=flat-square&logo=react&logoColor=white)
![Postgres](https://img.shields.io/badge/Postgres_16-row_locks-13362C?style=flat-square&logo=postgresql&logoColor=white)
![Tests](https://img.shields.io/badge/tests-38_passing-1E6B3E?style=flat-square)

</div>

Families browse programs, hold a seat while they check out, and join a first-come-first-served waitlist. A freed seat
is offered to the next family in line, with less time to accept as the class gets closer. Staff take over in the
last minutes before class.

## Quick start

Needs Node 20+ and Postgres 16 (`docker compose up -d` starts one).

```bash
cp .env.example .env
```

```bash
npm install
```

```bash
npm run db:seed
```

```bash
npm run dev
```

The family site runs at http://localhost:5173 and the staff view at http://localhost:5173/staff. The **Prototype
controls** panel moves a class's start time (25 h, 3 h, 1 h, 15 min) so you can watch offer windows shrink and staff
take over.

Tests run against a real Postgres:

```bash
createdb -U parks parks_test
```

```bash
npm test
```

## Priorities

| | Change | Done | Evidence |
|---|---|---|---|
| **P0** | [Concurrency and overbooking prevention](#concurrency-and-overbooking) | ✅ | 25 families racing for one seat; cancellations, walk-ins and acceptances at once |
| **P0** | [Dynamic waitlist expiration](#dynamic-waitlist-expiration) | ✅ | A test per window band and boundary |
| **P0** | [Fix expired-offer transaction bug](#the-expired-offer-transaction-bug) | ✅ | Reproduced with a failing test, then fixed |
| **P0** | [Waitlist fairness](#waitlist-fairness) | ✅ | Strict FIFO; walk-ins can't take a waitlist seat |
| **P1** | [Last-minute waitlist optimization](#last-minute-optimization) | ✅ | Staff last call: simultaneous claims, exactly one wins |
| **P1** | [Waitlist audit trail](#audit-trail) | ✅ | Events recorded in order, in the same transaction |
| **P1** | [Clarify simulated payments and notifications](#whats-simulated) | ✅ | Table below, and labels in the app |
| **P1** | [README and agentic development](#agentic-development) | ✅ | Tradeoffs, independent AI review, bugs and corrections |

---

## P0

### Concurrency and overbooking

Registrations, cancellations, waitlist acceptances and last-call claims all go through one rule: **lock the
section's row, settle it, recount, then write.**

1. `SELECT … FOR UPDATE` on the section. Simultaneous requests queue instead of failing. This holds across several API servers.
2. Inside the lock, expired holds are released and freed seats go to the waitlist.
3. Seats are recounted (active registrations + live holds), and the request proceeds only if one is free.
4. At commit, a deferred database trigger re-counts the section and rejects the transaction if it would be over capacity. This is a backstop against future bugs.

Two families clicking two open seats both get one. Twenty-five clicking the last seat: one gets it, and the other 24
are told it just filled up. Locks are always taken family → child → section, so requests can't deadlock.

### Dynamic waitlist expiration

Each section has `starts_at`, its first class. The offer window depends on how far away it is:

| Time until the first class | Time to accept |
|---|---|
| More than 24 hours | 2 hours |
| 2–24 hours | 30 minutes |
| 20 minutes–2 hours | 10 minutes |
| Under 20 minutes | No automatic offer: staff decide |

When an offer expires, the seat goes straight to the next family. Their window is worked out again from the current
time, so offers speed up as class approaches. No automatic offer can still be open in the last 10 minutes. From
`/staff`, staff can override at any time by offering the seat to the next family with a window they choose.
The rules live in `offerWindowMs` and `autoOfferExpiry` (`shared/src/index.ts`).

### The expired-offer transaction bug

- **Cause.** A request that touched a section first released its expired offers and offered the seat to the next family. If the request then failed its own check (for example, accepting an offer that had just expired), throwing the error rolled back *everything*, including that handoff. The seat sat idle until the next background sweep.
- **Fix.** Settling ends with `SAVEPOINT settled`. On a booking error, `bookingTx` rolls back only to the savepoint and commits, so the handoff survives the failed request.
- **Proof.** Two regression tests: accepting after expiry hands the seat on with no sweep, and a failed add-to-cart keeps the expirations it processed.

### Waitlist fairness

- **Strict FIFO.** Each freed seat is offered to **one** family, the first in line. Nobody else is contacted, and two families can never both accept the same seat.
- **The waitlist keeps priority.** While anyone is waiting, an open seat can't be added to the cart of a family who isn't on the waitlist.
- **Balancing fairness and seat use.** Shrinking windows keep the line moving near class time. Breaking line order (last call, below) is a staff decision, not automatic.

## P1

### Last-minute optimization

Under 20 minutes out, staff can send a **last call**: every waitlisted family is notified, and the first to claim the
seat gets it (and is charged). Concurrent claims queue on the section lock, so exactly one wins. It's refused while
automatic offers are still running, so it never jumps the line when the line can still work.

### Audit trail

`waitlist_events` records every join, leave, offer, accept, decline, expiry, last call and claim. Each event stores
who did it (family, system or staff) and when the offer expires. Events are written in the same transaction as the
change, so the trail can't disagree with the data. The staff view shows the latest 50.

### What's simulated

| | Real today | Simulated, and where the integration goes |
|---|---|---|
| **Payments** | A registration exists only after *Pay*, *Accept and pay* or *Claim and pay*. Never automatically | No card is charged ("Saved card ending 4242 (demo)"). Hooks: `checkout`, `registerFromWaitlist` |
| **Texts and emails** | Every notice is queued in `notifications` with SMS and email flags | Nothing is sent. `server/src/outbox.ts` logs each one |
| **Sign-in** | | Families: `X-Family-Id` header. Staff: shared `STAFF_TOKEN` (open in dev when unset) |

## Tradeoffs

| Choice | Gain | Cost |
|---|---|---|
| Row lock per section | Simple, correct, requests wait instead of failing | Hot sections serialize (fine at rec-department scale) |
| FIFO by default, last call by staff | Families keep their place | A seat can sit while someone holds an offer, and staff must act in the last 20 minutes |
| Open seats reserved for the waitlist | Nobody skips the line | If staff don't act near class time, a seat can go unused |
| Charge only on accept | No surprise charges | We declined the design's "Register and charge me automatically" mode |
| 2-second polling | Simple | A family can see a seat that was just taken, click, and lose (safely) |
| "Under 20 min" + "stop 10 min before" | We read 10 minutes as a hard cap no automatic offer may cross | Staff overrides are exempt by design |

## Agentic development

Built with Claude Code, from the design artifact to the database. How the work was checked:

- **Concurrency is tested for real.** Parallel requests run against a real Postgres, with no mocks.
- **Bugs get a failing test first.** The expired-offer bug and the review's findings (all but the sweeper one) were reproduced with a test that failed before the fix.
- **Browser checks.** Every flow was clicked through with Playwright at desktop and phone widths.
- **Independent AI review.** A separate agent with fresh context reviewed the booking code read-only against the rules above. It confirmed no overbooking, line-skipping or privacy leak, and that the savepoint fix is correct. It found three bugs the tests had missed.

### Bugs found and corrections

| Bug | Found by | Correction |
|---|---|---|
| Failed requests rolled back expired-offer handoffs | Stakeholder priority | Savepoint (above) |
| Deadlock: inserting an offer for a family clashed with that family's own row lock | Independent review | Family and child rows locked `FOR NO KEY UPDATE`; deadlocks retried |
| An unknown family ID left a read-only transaction on a pooled connection, breaking the next request | Independent review | Roll back before returning |
| One failing section stopped the whole background sweep | Independent review | Each section swept on its own, with a lock timeout |
| Offers weren't shortened when a class moved earlier | Independent review | Re-capped to the new 10-minute cutoff |
| Once automatic offers stop near class time, a walk-in could have taken a seat the waitlist was owed | Designing the staff-managed window | Waitlist priority check, with a test |
| The page showed other families' hold timers | Stakeholder | Server sends only a "taken" count |
| The design charged waitlisted families without acceptance | Requirement review | Pushed back; removed from code and design |

## Not yet built

- **Real payments, texts, and family and staff sign-in.**
- **Losing the race for the last seat.** Offer "Join the waitlist — you'd be #1" right in the "just filled up" message, and push live updates instead of polling.
- **Smaller items.** A cancellation and refund policy (shown as *[TO BE CONFIRMED]*); toasts that cover the *Accept and pay* button; updating the design to match charge-on-accept, hidden holds and the staff view.

## Where to look

```
server/src/booking.ts    every booking rule: holds, checkout, waitlist, offers, staff overrides
shared/src/index.ts      offer windows (offerWindowMs, autoOfferExpiry), shared types
server/migrations/       schema: starts_at, capacity trigger, audit trail
server/test/             38 tests against Postgres, including regression tests for the bugs above
client/src/              React screens (family site and /staff), components, design tokens
```
