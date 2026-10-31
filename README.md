# Cedar Valley Parks & Recreation: program registration

Families browse winter programs, hold spots in a cart, check out, and join waitlists.

- `client/`: React + TypeScript (Vite). The UI follows the "Rec Program Registration" design.
- `server/`: Node + TypeScript (Express) API on Postgres.
- `shared/`: types and booking constants used by both.

## How booking works

| Rule | Value |
| --- | --- |
| A spot added to a cart is held for | 5 minutes (`HOLD_MS`) |
| Spots one family can hold at once | 3 (`CART_MAX`) |
| A waitlist offer stays open for | 2 hours (`OFFER_MS`) |
| Sections per program a child can be in | 1 (registered, held or waitlisted) |

Every taken spot is either an active `registrations` row or an unexpired `holds` row. A hold is either a cart hold or a waitlist offer.

**Concurrent requests.** Every change runs in a transaction that locks the section row (`SELECT … FOR UPDATE`). It then recounts open spots before writing anything. Simultaneous requests for the same section queue up behind that lock, so a section can never be oversold. Locks are always taken in the same order: family, then child, then section. The family lock enforces the cart limit and the child lock enforces one section per program. Because the order is fixed, two requests can never deadlock on each other.

**Expiry and the waitlist.** Holds expire at `expires_at`. When a hold expires or a spot frees up, the section is "settled" inside its lock:
1. Expired holds are deleted, and their families get a notice.
2. Each open spot is offered to the next family on the waitlist, as an offer hold for 2 hours.
3. Once the waitlist is empty, the spot opens to everyone.

Settling runs before every change to a section, and a background sweeper runs it every second (`SWEEP_INTERVAL_MS`). So a freed spot always goes to the waitlist before anyone else can cart it. The sweeper uses `SKIP LOCKED`, so several API servers can run it safely at the same time.

Accepting an offer turns it into a normal 5-minute cart hold. Nobody is charged until they check out.

`server/test/booking.test.ts` covers these rules against a real Postgres. It includes 25 families racing for the last spot, mixed adds, removes and checkouts on one section, the cart limit under parallel requests, and offers passing down the waitlist as they expire.

## Running locally

You need Node 20+ and Postgres 16. If you don't have Postgres, `docker compose up -d` starts one.

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

Open http://localhost:5173. The API runs on :4000, and Vite proxies `/api` to it.

Tests use a separate database (`parks_test` by default; override with `TEST_DATABASE_URL`):

```bash
createdb -U parks parks_test
```

```bash
npm test
```

`db:seed` wipes the database and reloads the demo catalog. The API applies new migrations from `server/migrations/` when it starts.

## Prototype controls

With `ENABLE_DEV_TOOLS=true`, the API exposes `/api/dev/*` and the site shows the design's prototype panel. It lets you skip the clock ahead, simulate another family dropping out or carting a spot, and reset the demo. Keep this off in production.

## Not built yet

- **Sign-in.** The API identifies the family from an `X-Family-Id` header and defaults to the seeded demo family. See `familyOf` in `server/src/app.ts`.
- **Payments.** Checkout registers the held spots without charging a card. See `checkout` in `server/src/booking.ts`.
- **Text and email delivery.** Notices are queued in `notifications`. `server/src/outbox.ts` logs them and marks them delivered; connect a provider there.
- **Live updates.** The client polls `/api/state` every 2 seconds. Server-sent events would make updates faster.
