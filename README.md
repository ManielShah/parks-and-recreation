<div align="center">

# 🌲 Cedar Valley Parks & Recreation

**Program registration that never overbooks a class and never lets a freed seat sit idle.**

![React](https://img.shields.io/badge/React_18-TypeScript-1D5FD1?style=flat-square&logo=react&logoColor=white)
![Postgres](https://img.shields.io/badge/Postgres_16-row_locks-13362C?style=flat-square&logo=postgresql&logoColor=white)
[![Tests](https://github.com/ManielShah/parks-and-recreation/actions/workflows/e2e.yml/badge.svg)](https://github.com/ManielShah/parks-and-recreation/actions/workflows/e2e.yml)

[What I built](#what-i-built-and-why) · [Deferred](#what-i-deferred-and-why) · [Push back](#what-id-push-back-on-and-why) · [Next](#what-id-do-next-with-more-time) · [Tools & Process](#tools--process)

</div>

## Try it without a local server

- **See it tested.** Every push runs the 42 API tests and 9 end-to-end tests in a real browser on GitHub Actions. Open the [latest run](https://github.com/ManielShah/parks-and-recreation/actions/workflows/e2e.yml) and download **playwright-report** for a video of each flow: browse and check out, section age limits, a waitlist offer accepted and paid, offer windows shrinking as class approaches, and the seat held for the waitlist in the last 20 minutes.
- **Click through it yourself.** [![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/ManielShah/parks-and-recreation?quickstart=1) starts Postgres, seeds the demo and opens the site in your browser. It takes a few minutes the first time. Run `npm test` in its terminal for the API tests.

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

The site runs at http://localhost:5173. The **Prototype controls** panel simulates other families, skips the clock,
and moves a class's start time so you can watch the waitlist rules change.

Tests run against a real Postgres, not mocks:

```bash
createdb -U parks parks_test
```

```bash
npm test
```

End-to-end tests in a browser (starts the site itself if it isn't running):

```bash
npx playwright install chromium
```

```bash
npm run e2e
```

> [!NOTE]
> Payments, texts and emails are **simulated**. No card is charged and nothing is sent: notices are queued in an
> outbox table and printed to the server log.

---

## What I built and why

A family-facing registration site built from the provided design, on a React + TypeScript front end and a Postgres
back end:
- browse programs, pick a child, and choose a section. Age limits are set per section (say, a 9–10 week and an 11–12 week of a basketball camp), and a section can be open to all ages. A child can take more than one section of a program, never the same one twice
- hold a seat in a cart for 5 minutes, then check out
- join a waitlist when a section is full
- manage everything under *My registrations*

Behind it is the part that's hard to get right: **what happens when many families want the same seat.**

| What | Why |
|---|---|
| **Every booking change locks the section's row, recounts seats, then writes.** A database trigger re-checks capacity at commit | Registrations, cancellations and waitlist acceptances can arrive at the same instant. Requests queue instead of failing: two families clicking two open seats both get one, and 25 clicking the last seat get exactly one winner. The trigger means even a future bug can't commit an overbooked class |
| **A strict first-come-first-served waitlist.** Each freed seat is offered to one family at a time, and nobody else can take it meanwhile | Families who waited longest go first, and two families can never both accept the same seat |
| **Offer windows shrink as class approaches.** 2 hours when the class is over a day away, then 30 minutes, then 10. Under 20 minutes, staff decide | A 2-hour window the night before class means an empty seat. Shorter windows keep the line moving, and the window is set from each section's real `starts_at` |
| **Staff overrides** (API: `POST /api/staff/sections/:id/offer` and `/last-call`). Offer a seat to the next family with any window, or send a *last call* where the first waitlisted family to claim it wins | The last minutes before class need a human: strict order or fill the seat? A last call trades fairness for seat use, so a person makes that call. Families see last calls in the app |
| **Charge only on acceptance.** *Accept and pay* registers and charges in one step; an ignored offer costs nothing | Families should never be charged for something they didn't confirm |
| **Families can't see each other.** Other families' carts and offers reach the browser only as a "taken" count | Countdowns like "someone has this seat for 2:29" invite gaming and anxiety, and leak other families' activity |
| **An audit trail.** Every join, offer, accept, decline, expiry and claim is recorded with who did it, in the same transaction as the change | Disputes ("I never got an offer!") need a record that can't disagree with the data |
| **Shared design tokens and components** (`Button`, `Card`, `CapacityDots`, `OfferBanner`, …) | The design kept changing. New versions mostly touch tokens and a few components, not every screen |

## What I deferred and why

None of these change the agreed rules (capacity, first-come-first-served, offer windows, charge only on acceptance,
privacy between families). Each one builds on them.

| Deferred | Why |
|---|---|
| **Real payments, texts, emails and sign-in** | Integrations, not product logic. Each has a clear seam: payment hooks in `checkout` and `registerFromWaitlist`, the delivery outbox in `server/src/outbox.ts`, families identified by an `X-Family-Id` header and staff by a shared `STAFF_TOKEN` |
| **A staff screen** | A nice-to-have. The staff overrides the requirements call for exist as API endpoints (`/api/staff/overview`, `/offer`, `/last-call`) with tests; a screen on top of them can come later |
| **Joining the waitlist when you lose the race for the last seat** | Today the family sees "That section just filled up" and joins the waitlist themselves. A one-tap or automatic join is better for them, but needs a product decision (consent, notifications) |
| **Live updates** (server-sent events) | Polling every 2 seconds was enough to prove the rules. The cost: a family can see a seat that was just taken, click, and lose. They lose safely, with no double booking and no charge, but it's disappointing |
| **A cancellation and refund policy** | Undecided, so the site says *[TO BE CONFIRMED]* rather than inventing one. Withdrawing frees the seat; refunds aren't built |
| **Sibling discount** | A nice-to-have, not core to registering safely. It touches pricing, checkout totals and refunds, and needs rules first (which sibling gets it, and whether it applies across programs and to waitlist acceptances). Prices are stored per registration, so it can be added without changing past orders |
| **Late registration after a session starts** | `starts_at` is the first class only. Joining a class already under way needs its own rules (pro-rating, instructor approval) |
| **Polish and extra hardening** | Two notices arriving together show only the newest, and a toast can cover the *Accept and pay* button. The sweeper's skip-a-failing-section path has no test. No load test yet |

## What I'd push back on and why

- **The design's "Register and charge me automatically" waitlist option.** *I did push back, and it's removed from the code and the design.* It charged families the moment a seat opened, without them accepting. That contradicts the rule that nobody is charged unless they accept their offer in time, and an unexpected charge is the fastest way to lose a family's trust.
- **Showing families that someone else is holding a seat, with a countdown.** *Also changed.* It leaks other families' activity and encourages refreshing and pouncing.
- **"Staff-managed under 20 minutes" depending on someone watching.** If nobody is at the desk, a seat with people waiting goes empty. I'd ask whether a last call should start automatically at 20 minutes, with staff able to cancel it.
- **The two timing rules overlap.** The window table says staff take over under 20 minutes, while another requirement says automatic offers stop 10 minutes before class. I treated 10 minutes as a hard cap that no automatic offer may cross, and I'd confirm that reading.
- **First-click-wins when registration opens for popular classes.** Whoever has the fastest connection wins. For high-demand openings I'd propose a short lottery window, with everyone else going onto the waitlist in draw order.

## What I'd do next with more time

The deferred list above, in the order I'd tackle it:

1. **Real integrations.** A payment provider that charges a saved card on accept (a declined card rolls the acceptance back), SMS and email delivery, and family and staff sign-in. Without these it can't launch.
2. **Polish and extra hardening.** Queue notification toasts so none are lost or cover *Accept and pay*, test the sweeper's failure path, and load-test a busy registration opening.
3. **A staff screen** for the existing overrides, so staff don't need the API in the last minutes before class.
4. **Joining the waitlist when you lose the race:** "Join the waitlist — you'd be #1" in the "just filled up" message, joined in the same request so nobody gets ahead of you.
5. **Live updates** via server-sent events, so a taken seat disappears from every screen almost at once.
6. **Cancellation and refunds**, once the policy is decided.
7. **Sibling discount**, once its rules are agreed.
8. **Late registration** for sessions already under way.

---

## Tools & Process

### Tools

| Tool | How I used it |
|---|---|
| **Claude design canvas** | The source design: an interactive prototype of the registration flow, which went through several iterations |
| **Claude Code** (cloud session) | Read the design, then built the React client, Express API, Postgres schema and tests. It ran the app and drove a headless browser with Playwright to check each flow at desktop and phone widths, then turned those checks into the end-to-end tests that run on every push |
| **A second Claude agent as reviewer** | Given only the code and the business rules, with fresh context and read-only access, and told to find ways to break it |
| **Postgres + Node's test runner** | Every concurrency claim is tested by firing real parallel requests at a real database |

How I worked with it:
- **Requirements came from me in plain language; the AI turned them into code and tests.** Bugs were reproduced with a failing test before being fixed.
- **I checked its work by asking it to confirm specific rules.** That's how the conflict between the design and my "no charge without acceptance" requirement surfaced.

### Where I overrode or corrected the AI

- **It built the design's auto-charge option without questioning it.** When I asked it to confirm that nobody is charged without accepting within 2 hours, it admitted the option broke that rule. I had it removed from the code and the design.
- **It built "accept, then pay at checkout" as two steps.** I changed it to charge at the moment of acceptance.
- **It implemented the design's "held for another family" dots and countdowns.** I had them removed. It then also stopped the API from sending that data at all, so it can't be found by inspecting the page.
- **"Can two families book the last seat?"** Its answer, that the database lock makes it safe, was correct but incomplete. I pointed out that the 24 losing families still *saw* an open seat and expected to get it. That user-experience gap is now first on the next-steps list.
- **Testing it by hand in Codespaces, I found two bugs its tests had missed.** Age limits still lived on programs even though I'd asked for them per section, and a child registered for one day of a program couldn't add another day (a rule it had carried over from the design without asking). Both are fixed, with regression tests.
- **Smaller corrections:**
  - Some of its own tests had wrong expectations, or failed now and then because they read the clock twice. It caught and fixed these itself.

### Asking the AI to break it

I gave the second agent the business rules and asked it to find overbooking, line-skipping, deadlocks, data leaks and
stuck seats. It wrote probe scripts against a scratch database. It confirmed:
- no way to overbook a class, skip the line, or see another family's holds
- the fix for the expired-offer bug is correct

It found **three real bugs that my 32 tests at the time had missed**:

| What it found | How it broke | What I did |
|---|---|---|
| **Deadlocks** | Saving an offer for a family needs a lock that clashes with the lock that family's own request holds. A parent accepting one child's offer while a withdrawal promoted their other child got "deadlock detected" | Locked family and child rows `FOR NO KEY UPDATE`, which doesn't clash, and retry deadlocks as a safety net. Regression test added |
| **A broken pooled connection** | Asking for an unknown family left a read-only transaction open, so the next unrelated booking on that connection failed | Rolled back before returning. Regression test added |
| **A fragile background sweep** | One failing section stopped expirations for every other section until the next pass | Each section is now swept separately, with a lock timeout |
| Smaller issues | Offers not shortened when a class moved earlier; a broken connection reused; a silent failure; a misleading notice | All fixed; the first has a regression test |

The bug I fixed just before the review was found the same way: I reproduced it with a failing test first. A request
that handed an expired offer's seat to the next family, then failed its own check, rolled the handoff back, so the
seat sat idle. A savepoint now keeps that work.

**What the review taught me:** "always lock in this order" was written in a code comment, but Postgres takes locks
the code never asks for. Reasoning about the code wasn't enough; probing it against a real database was.

---

<details>
<summary><b>Where to look in the code</b></summary>

```
server/src/booking.ts    every booking rule: holds, checkout, waitlist, offers, staff overrides
shared/src/index.ts      offer windows (offerWindowMs, autoOfferExpiry), shared types
server/migrations/       schema: starts_at, capacity trigger, audit trail
server/test/             42 tests against Postgres, including regression tests for the bugs above
e2e/                     9 browser tests of the main flows (Playwright); .github/workflows runs both on every push
client/src/              React screens, components, design tokens
```

</details>
