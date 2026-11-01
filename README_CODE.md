# Code Guide — Cedar Valley Parks & Recreation

**For engineers reviewing or extending the implementation.** This document explains how to run it, find the business rules, and reason about correctness. For the take-home's product decisions, pushback, deferrals, and AI process, start with [the submission README](README.md).

> **Prototype, not production:** Payment and SMS/email are simulated; there is no real family authentication. The UI still has some “charged” and “sent” copy from the prototype. Do not use real payment information or deploy these demo settings.

## 1. Run and test

**Requirements:** Node 20+, PostgreSQL 16; or Docker for a local database.

~~~sh
docker compose up -d              # if PostgreSQL is not running locally
cp .env.example .env
npm ci
npm run db:seed                    # runs migrations and loads the demo
npm run dev
~~~

Open **http://localhost:5173**. The API runs on **http://localhost:4000**; Vite proxies `/api`. For an in-browser, preconfigured alternative, use [GitHub Codespaces](https://codespaces.new/ManielShah/parks-and-recreation?quickstart=1).

~~~sh
createdb -U parks parks_test       # one-time test DB creation
npm run typecheck
npm test                           # API/integration tests, real PostgreSQL
npx playwright install chromium    # once
npm run e2e                        # real browser + API + database
npm run build
~~~

The API test script uses `TEST_DATABASE_URL` (default: `postgres://parks:parks@localhost:5432/parks_test`). Tests reseed their database; **never point tests at data you need to keep**. GitHub Actions runs typecheck, API tests, and Playwright on pushes and PRs; see [`.github/workflows/e2e.yml`](.github/workflows/e2e.yml).

## 2. Reading order

| Start here | What to look for |
|---|---|
| [`shared/src/index.ts`](shared/src/index.ts) | Types and common rules: `offerWindowMs`, `autoOfferExpiry`, ages, constants |
| [`server/src/booking.ts`](server/src/booking.ts) | All write-side business operations: holds, checkout, cancellation, waitlist, staff last call |
| [`server/migrations/`](server/migrations/) | Tables, capacity constraint trigger, event audit, per-section age limits |
| [`server/src/app.ts`](server/src/app.ts) | Express route handlers and request validation |
| [`server/src/state.ts`](server/src/state.ts) | Read models for the catalog and the signed-in/demo family's view |
| [`server/src/sweeper.ts`](server/src/sweeper.ts) | Background expiration, promotions and reminders |
| [`server/src/outbox.ts`](server/src/outbox.ts) | Stub SMS/email delivery (logs and marks delivered) |
| [`server/src/staff.ts`](server/src/staff.ts) | Staff overview of sections, offers, waitlist and audit events |
| [`client/src/domain/model.ts`](client/src/domain/model.ts) | Client-derived eligibility, section availability and actions |
| [`client/src/screens/`](client/src/screens/) | Browse, Program Detail, Checkout, Confirmation, My Registrations |
| [`client/src/components/OfferBanner.tsx`](client/src/components/OfferBanner.tsx) | Family's expiring offer and staff last-call claim UI |
| [`server/test/`](server/test/), [`e2e/`](e2e/) | Concurrency, timing, regression and browser-level behavior |

The `shared`, `server`, and `client` directories are npm workspaces; there is **no separate microservices stack**.

## 3. Request and inventory lifecycle

~~~text
Browser (React) -> Express routes -> booking.ts -> PostgreSQL
                            |              |
                            |              +-- registrations / holds / waitlist_entries
                            |              +-- waitlist_events (audit)
                            |              +-- notifications (transactional outbox)
                            |
                            +-> state.ts -> family-scoped view

sweeper.ts -> expire holds -> offer next person -> outbox.ts (logs notices)
~~~

A section is one bookable time with its own `capacity`, `starts_at`, `min_age`, `max_age`, and waitlist. The program holds shared catalog/pricing and registration-opening information. The prototype stores an integer child age rather than birth date, so it does not recalculate age at class start.

**Inventory invariant:**

~~~text
active registrations + unexpired cart/offer holds <= section capacity
~~~

The application enforces that under a **section-row `FOR UPDATE` lock**. A deferred database constraint trigger is a second guard when inserting/updating registrations or holds. Note that the trigger counts *all stored holds* at commit, so expired holds must be removed as part of settlement. It is not a general-purpose guard for arbitrary direct SQL changes to `sections.capacity`.

### A normal registration

1. `POST /api/cart` locks the family, child, then section, settles any expired holds, validates opening time and the child's section age, and rejects duplicates.
2. With no waitlist priority conflict and available capacity, it creates a **5-minute `cart` hold**.
3. `POST /api/checkout` checks that the requested hold IDs exactly match the family's live cart, then replaces the holds with registrations transactionally.
4. `POST /api/registrations/:id/withdraw` releases the seat and calls the waitlist settlement/promotion path.

### The waitlist path

1. `POST /api/waitlist` puts a child on that section's queue. The queue is **FIFO by entry ID**, not a household-wide queue.
2. A cancellation or hold expiration frees capacity. `settleSection` removes expired holds and runs `promoteWaitlist`.
3. While automatic promotion is allowed, `popWaitlist` removes the earliest entry, and `makeOffer` creates a single-family **`offer` hold**. The offer consumes capacity until accepted or expired.
4. `POST /api/offers/:id/accept` converts a live offer to a registration. `decline` releases it so the next family can be offered the seat.
5. A periodic sweeper settles untouched expired holds; each section is processed independently, with a lock timeout.
6. A **staff-initiated last call** is an explicit exception to FIFO. It notifies the remaining queue; the first successful `POST /api/waitlist/:id/claim` obtains the seat under the section lock.

New walk-ins cannot use an open seat while there are waitlist entries waiting for staff action. A family's position is no longer in the active queue once they receive an offer; their history remains in `waitlist_events`.

### Dynamic offer deadlines

These functions live in [`shared/src/index.ts`](shared/src/index.ts):

| Time to section's first meeting | Automatic invitation lifetime |
|---|---|
| More than 24 hours | 2 hours |
| 2–24 hours | 30 minutes |
| 20 minutes–2 hours | 10 minutes |
| Under 20 minutes | None: staff decides |

`autoOfferExpiry()` additionally caps every **automatic** offer at **10 minutes before class**. Staff can deliberately create a different deadline. The prototype does not run unattended automatic last calls or late-session enrollment.

### Concurrency details worth reviewing

- `bookingTx` in [`booking.ts`](server/src/booking.ts) wraps changes in a PostgreSQL transaction and retries selected transient failures. Family/child locks use `FOR NO KEY UPDATE` to avoid conflicts with foreign-key `KEY SHARE` locks encountered during offers.
- `settleSection` creates a **savepoint**. If a subsequent validation raises `BookingError`, `bookingTx` can roll back the attempted action while committing the expired-hold cleanup and next waitlist offer. This fixes the “expired accept rolls back promotion” bug.
- Releasing one seat and claiming it concurrently both acquire the section lock. Capacity is recounted inside the transaction; stale browser availability cannot force an overbooking.
- The waitlist has **no automatic billing**. `registerFromWaitlist` and checkout simulate the charge with a database registration; a real payment service needs authorization/capture, idempotency, and reconciliation across service boundaries.

## 4. Schema map

| Table | Purpose |
|---|---|
| `families`, `children` | Household and participant records; demo family selected with `X-Family-Id` |
| `programs` | Catalog metadata, prices, `registration_opens_at` |
| `sections` | Capacity, first-class `starts_at`, section age limits, `last_call_until` |
| `registrations` | Confirmed enrollment, paid amount recorded (simulated), withdrawal state |
| `holds` | Short-lived `cart` or `offer` inventory reservations |
| `waitlist_entries` | Active queue (FIFO by ID) |
| `waitlist_events` | Append-only-like event history for joins, offers, declines, expirations, claims |
| `notifications` | Family notices and unsent SMS/email outbox rows |
| `registration_reminders` | Requests to be notified when a program opens |

Migrations run in order: [001](server/migrations/001_init.sql) initializes the domain; [002](server/migrations/002_class_size_openings_auto_register.sql) adds opening times/reminders; [003](server/migrations/003_charge_on_accept.sql) removes auto-charge; [004](server/migrations/004_start_times_audit_capacity.sql) adds start times, events and the constraint trigger; [005](server/migrations/005_section_age_limits.sql) adds section limits; [006](server/migrations/006_ages_on_sections_only.sql) migrates ages to sections only.

## 5. HTTP API map

Authentication is **simulated**. The family defaults to `demo` unless `X-Family-Id` is provided; there is no real access control on family routes.

| Method | Endpoint | Behavior |
|---|---|---|
| GET | `/api/catalog` | Programs and sections |
| GET | `/api/state` | Current household, bookings, holds, waitlist, notices |
| POST / DELETE | `/api/cart` / `/api/cart/:id` | Create/remove five-minute hold |
| POST | `/api/checkout` | Convert live cart holds to registrations |
| POST / DELETE | `/api/waitlist` / `/api/waitlist/:id` | Join/leave queue |
| POST | `/api/offers/:id/accept` | Accept offered seat |
| POST | `/api/offers/:id/decline` | Decline and reoffer |
| POST | `/api/waitlist/:id/claim` | First-claim win during staff last call |
| POST | `/api/registrations/:id/withdraw` | Cancel a registration |
| PUT / DELETE | `/api/programs/:id/reminder` | Subscribe/unsubscribe opening reminder |
| GET | `/api/staff/overview` | Staff queue/seat/audit view |
| POST | `/api/staff/sections/:id/offer` | Staff offer to FIFO head; body `{"minutes": 3}` |
| POST | `/api/staff/sections/:id/last-call` | Notify queue of first-to-claim last call |

Staff routes are enabled when `STAFF_TOKEN` is set or dev tools are enabled. With a token configured, staff requests need `X-Staff-Token`. Without a token, **dev mode exposes staff routes without authentication**. Do not enable developer controls in production.

The dev-only endpoints include `/api/dev/advance`, `/api/dev/section-start`, `/api/dev/dropout`, `/api/dev/rival-hold`, and `/api/dev/reset`. Definitions and validation live in `server/src/app.ts`.

## 6. Demo script

The **Prototype controls** panel appears with `ENABLE_DEV_TOOLS=true`, and has Reset, Skip time, Dropout, Rival hold, and first-class-start shortcuts.

1. Open **Swim Level 2 → Saturdays**. It is seeded full, with two families already waiting.
2. Waitlist **Maya**; observe her queue position.
3. Trigger **A family drops Swim 2 · Saturdays** three times. Two prior families get offers; Maya then sees an **Accept and pay** invitation with a deadline.
4. Accept it; inspect **My registrations** and the confirmation.
5. Reset. Move the class start to **1 h** or **15 min** and repeat a dropout to see 10-minute offers or a staff-managed queue.
6. Inspect `/api/staff/overview` or call the staff offer/last-call endpoints to demonstrate the final-minute tradeoff.

These are simulations. The UI's payment/email copy should not be interpreted as a real charge or delivered message.

## 7. Test and debugging map

- [`server/test/booking.test.ts`](server/test/booking.test.ts): 25-way last-seat race; parallel mixed actions; duplicate enrollments; queue order; offer acceptance/decline/expiry; no walk-in bypass; staff last-call concurrent claims; audit; transaction/deadlock regressions.
- [`server/test/offer-window.test.ts`](server/test/offer-window.test.ts): exact offer-window boundaries and 10-minute automatic cutoff.
- [`e2e/registration.spec.ts`](e2e/registration.spec.ts): real-browser registration, section ages, siblings, offered seats, dynamic timers and privacy.
- [`.github/workflows/e2e.yml`](.github/workflows/e2e.yml): PostgreSQL-backed CI, Playwright videos and report artifacts.

**If a spot looks unavailable:** inspect active registrations and holds for that section, the section's `starts_at`, its `last_call_until`, and queued `waitlist_entries`. The `waitlist_events` history explains what was offered and why. Check the background sweeper and its log if an expired offer has not advanced.

## 8. Known boundaries / not launch-ready

There is no payment gateway, outbound email/SMS provider, real sign-in, refund flow, staff web UI, or automatic under-20-minute fallback. Polling can lag; toasts may overlap controls; a section's time currently means its **first meeting**, not every recurring session. Child eligibility uses stored integer ages. Discounts are intentionally deferred. Review [the submission README](README.md#what-i-deferred-and-why) for the product rationale and prioritized roadmap.
