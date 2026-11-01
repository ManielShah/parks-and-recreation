<div align="center">

# 🌲 Cedar Valley Parks & Recreation

**Program registration that never overbooks a class and never lets a freed seat sit idle.**

![React](https://img.shields.io/badge/React_18-TypeScript-1D5FD1?style=flat-square&logo=react&logoColor=white)
![Postgres](https://img.shields.io/badge/Postgres_16-row_locks-13362C?style=flat-square&logo=postgresql&logoColor=white)
![Tests](https://img.shields.io/badge/tests-38_passing-1E6B3E?style=flat-square)

</div>

Families browse programs, hold a seat while they check out, and join a first-come-first-served waitlist. Each freed
seat is offered to the next family in line, with less time to accept as the class gets closer.

> [!NOTE]
> Payments, texts and emails are **simulated**. No card is charged and nothing is sent: notices go to an outbox table
> and the server log.

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
controls** panel skips the clock, simulates other families, and moves a class's start time so you can watch the
waitlist rules change.

```bash
createdb -U parks parks_test
```

```bash
npm test
```

## The guarantees

| | How |
|---|---|
| **Never over capacity** | Every booking change locks the section's row in Postgres and recounts seats before writing. A database trigger re-checks at commit as a backstop. |
| **Simultaneous clicks are safe** | Requests queue on the lock and each recounts when its turn comes. Two families, two seats: both get one. Twenty-five families, one seat: exactly one does, and the rest are told it just filled up. |
| **Freed seats move fast** | Expired holds are released, and the seat offered to the next family, inside the same transaction as any request that touches the section. A 1-second background sweep covers quiet sections. |
| **The line is fair** | Offers go strictly in waitlist order. While anyone is waiting, an open seat can't be taken by a family who isn't on the waitlist. |
| **No surprise charges** | A waitlisted family is charged only when they press *Accept and pay* (or claim during a last call). |
| **Families can't see each other** | Other families' holds and offers reach the browser only as a "taken" count, with no timers. |

## Waitlist offer windows

| Time until the first class (`sections.starts_at`) | Time to accept |
|---|---|
| More than 24 hours | 2 hours |
| 2–24 hours | 30 minutes |
| 20 minutes–2 hours | 10 minutes |
| Under 20 minutes | No automatic offer: **staff decide** |

No automatic offer is ever open in the last 10 minutes. Staff can override from `/staff` at any time:
- offer the seat to the next family, with a window they choose
- or send a **last call**, where everyone waiting is notified and the first to claim gets the seat

Every join, offer, accept, decline, expiry and claim is recorded in an audit trail (`waitlist_events`).

## Key decisions

- **Row locks, not optimistic retries.** They're easy to reason about, and requests wait rather than fail. Hot sections serialize, which is fine at a city rec department's scale.
- **Strict line order by default; last call only by staff choice.** Fairness comes first, and the shrinking windows limit empty seats. Notifying everyone at once fills seats faster but breaks line order, so a person decides.
- **No auto-charge mode.** An earlier design had "Register and charge me automatically". We pushed back, because it charged families without them accepting, and removed it from the code and the design.
- **Interpreting "under 20 minutes" alongside "stop 10 minutes before".** Automatic offers end at 20 minutes out. The 10-minute rule is a hard cap that no automatic offer can cross. Staff overrides are exempt.

## How it was built and checked

Built with Claude Code from the design artifact to the database.
- **Concurrency is tested for real.** Requests are fired in parallel at a real Postgres, with no mocks.
- **Bugs get a failing test first.** Each bug below except the sweeper one was reproduced with a failing test before it was fixed.
- **An independent review.** A separate agent with fresh context reviewed the booking code without changing it. It found three real bugs the tests had missed:
  1. **Deadlocks.** Inserting a row that references a family took a lock that clashed with the family-row lock, so a family accepting one child's offer while a withdrawal promoted their other child deadlocked. Fixed by locking family and child rows `FOR NO KEY UPDATE`, with a retry as a safety net.
  2. **A broken database connection.** Looking up an unknown family left a read-only transaction open on a pooled connection, which broke the next request to use it. Fixed by rolling back first.
  3. **A fragile sweeper.** One failing section stopped the whole background sweep. Each section is now swept on its own.
- **Bug found before the review: expired offers.** A request that released an expired offer and then failed its own check rolled the release back, so the seat sat idle until the next background sweep. Fixed with a savepoint that keeps that work.

## Not yet built

- **Real payments, texts and sign-in.** The payment hooks are in `registerFromWaitlist` and `checkout`, delivery is in `server/src/outbox.ts`, and families are currently identified by an `X-Family-Id` header.
- **Losing the race for the last seat.** A family can see a seat as open, click, and find it gone. Next step: offer "Join the waitlist — you'd be #1" in that message (or join automatically), and push live updates instead of 2-second polling.
- **Smaller items.** A cancellation and refund policy (shown as *[TO BE CONFIRMED]*); toasts that cover the *Accept and pay* button; bringing the design up to date with charge-on-accept, hidden holds and the staff view.

## Where to look

```
server/src/booking.ts    every booking rule: holds, checkout, waitlist, offers, staff overrides
shared/src/index.ts      offer windows (offerWindowMs, autoOfferExpiry), shared types
server/migrations/       schema, including the capacity trigger and audit trail
server/test/             38 tests against Postgres
client/src/              React screens, components and design tokens
```
