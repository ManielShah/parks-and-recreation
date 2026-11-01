<div align="center">

# 🌲 Cedar Valley Parks & Recreation

**Fair registration, capacity-safe booking, and faster waitlist fulfillment — without surprise charges.**

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

### The product decision

**A waitlist should do three things at once: treat families fairly, fill seats before class starts, and never sell the same seat twice.** For a payments-driven platform, an unfilled high-demand spot is a lost opportunity for the department and potential transaction revenue for Rec. But filling it by charging an unsuspecting parent is not the right tradeoff.

My MVP policy is **FIFO offers, reserved for one family at a time, with a deadline that shrinks as class start approaches**. Parents explicitly accept before a simulated payment and enrollment. This is a considered alternative to the stakeholder's *automatic promotion + automatic charge* request, **not** a claim that the request was part of the agreed core requirements.

**Example — a class starts at 4:00 PM:** if a seat opens at 3:30 PM, the first waiting family receives an offer until 3:40 PM. If it expires, the next eligible family can receive a 10-minute offer, ending at 3:50 PM. Under 20 minutes to start, *new automatic offers stop*; the seat remains reserved for the waitlist, and staff can use a targeted offer or a first-to-claim last call. Staff intervention is implemented, but an **unattended last-minute fallback is not**—see [D2](#what-i-deferred-and-why).

### Requirements and proof

| Take-home consideration | Implemented behavior | Evidence |
|---|---|---|
| Browse programs and register a child | React catalog, section selection, 5-minute cart hold, checkout, My registrations | `client/src/`; browser tests |
| Sections with limited capacity | Section-row transactions plus deferred database capacity checks; cart holds and registrations count against capacity | `server/src/booking.ts`, migration `004`; concurrent booking tests |
| Full sections have waitlists | Section-specific FIFO queue, join/leave, single-family offers, accept/decline/expiry | `waitlist_entries`, `holds`, `waitlist_events` |
| Age-gated sections | Age ranges live on sections; all-ages sections supported | Migration `006`; API and browser tests |
| Household registration | One family can select multiple children and hold up to three seats; duplicate enrollment in one section is blocked | Child/family validation and cart tests |
| Registration opens at a specified time | Server-side opening check plus reminders | `registration_opens_at`; tests |
| Automatic promotion request | Auto-*offer* and reserve when a spot frees, **not auto-enroll/auto-charge** | See product pushback below |
| Sibling discount request | **Deferred**, with pricing questions documented | [D6](#what-i-deferred-and-why) |

### Safety and fairness are enforced server-side

- **Concurrency and overbooking:** Booking changes lock a section row, recalculate availability inside a transaction, and use a deferred PostgreSQL capacity constraint as a backstop. Tests race 25 families for the final spot and mix withdrawals, waitlist claims and new requests.
- **Queue integrity:** Normal promotion is FIFO. A walk-in cannot take an open spot while eligible waitlist entries remain. An intentional *staff-triggered* last call is the exception and is recorded.
- **Recoverability:** Expired holds are settled before booking decisions; an expired offer rejected by the API still commits the transfer to the next person. A sweeper processes remaining expirations and retries sections independently.
- **Audit and privacy:** Join, offer, accept, decline, expiry and last-call events are logged. Other families' hold details are not exposed to the parent-facing API.

### Offer policy in this prototype

| Time before first class | Automated offer | Who can act |
|---|---|---|
| More than 24 hours | Up to 2 hours | Parent accepts or declines |
| 2–24 hours | Up to 30 minutes | Parent accepts or declines |
| 20 minutes–2 hours | Up to 10 minutes | Parent accepts or declines |
| Under 20 minutes | No new automated offer | Staff chooses FIFO offer or last call |

Automatic offers never extend past **10 minutes before start**. Staff can deliberately override that limit; this is an operational exception, not an automatic promise. Times refer to the **first session start**, not each meeting of a multiweek class.

### What I would measure

**Correctness:** overbooking incidents (target zero), duplicate enrollments, and invalid priority bypasses. **Business/experience:** cancellation-to-replacement time, paid-seat utilization, offer acceptance/expiry, waitlist conversion, and how often a section reaches start time with a seat open and people waiting. These are proposed production metrics; the prototype does **not** capture real payments or revenue.

## What I deferred and why

The IDs below also appear in [the roadmap](#what-id-do-next-with-more-time). These are **not** features silently claimed as complete.

| ID | Deferred | Reason / prerequisite |
|---|---|---|
| **D1** | Real payments, SMS/email and identity | Simulated flows demonstrate business logic, not production integrations. Real charging needs payment idempotency, failure recovery, refunds and explicit customer consent; sign-in must replace `X-Family-Id` and the shared staff token |
| **D2** | Staff UI and unattended last-minute escalation | Staff override and last-call **APIs are implemented**, but staff currently need API access. Under 20 minutes, an unattended waitlist may leave a seat empty. Automatic escalation or a time-limited broadcast needs a department-approved fairness policy |
| **D3** | One-tap waitlist join after losing the last-seat race | The error explains that the class filled, but the parent must join separately. A streamlined, consent-based action would reduce abandonment; queue position is earned only when the join request succeeds |
| **D4** | Live availability updates | Two-second polling is sufficient for this demo; it can show briefly stale availability. The server still rejects the losing booking safely |
| **D5** | Cancellation/refund policy and refunds | The policy is unresolved; the UI says `[TO BE CONFIRMED]`. Withdrawal frees capacity, but no money is refunded |
| **D6** | Sibling discounts | Explicitly out of MVP. Clarify whether 10%/20% applies per order, section, program, or household, and what happens if siblings join via different waitlist offers |
| **D7** | Joining after a class has started | `starts_at` is the first meeting. Late enrollment may require instructor approval and prorating; this is separate from last-minute waitlist offers |
| **D8** | Final production polish and reliability | Queue simultaneous toasts, keep notifications clear of the acceptance button, **mark simulated payment and delivery in the UI itself**, harden and load-test sweeps and peak registration |
| **D9** | High-demand opening-time admission policy | Today's direct registration is a database-safe race. A lottery or bounded admission window may improve equity, but changes who gets priority and should be validated with departments first |

## What I'd push back on and why

These are explicit product decisions, not missing functionality presented as accidental omissions.

1. **Automatic enrollment and charging on promotion — push back; propose explicit acceptance.** This *is* a stakeholder request. It could reduce vacancies, but also creates surprise charges, schedule conflicts and disputes, especially for families on multiple waitlists. The implementation offers and temporarily holds a spot, then charges **only in the simulated acceptance flow**. I would seek product/stakeholder approval for this departure, and measure conversion and unfilled-seat rates. I would not quietly enable auto-charge.
2. **Showing another family's cart countdown — reject and already changed.** The original design revealed other families' temporary holds. The UI and API now show only aggregate taken capacity. Families need to know whether a seat is available, not who is holding it.
3. **Requiring staff to notice every last-minute vacancy — push back on the operating assumption.** The current under-20-minute handoff prioritizes human judgment, but can leave demand unserved when staff are unavailable. [D2](#what-i-deferred-and-why) is an explicit follow-up: agree when to trigger an automatic last call, who is notified and whether first-to-claim is acceptable. Staff-initiated last call is already built and intentionally relaxes FIFO.
4. **Using identical deadlines for every class — reject and already changed.** Two hours when class starts in 30 minutes wastes inventory. The implemented windows shrink with time, with a 10-minute automatic cutoff and a documented staff exception.
5. **Equating first-click-wins with fairness at a popular registration opening — defer the policy decision.** Transaction locks stop overselling, not inequity from network speed. [D9](#what-i-deferred-and-why) considers a lottery only if the department wants a different opening-time allocation policy.

## What I'd do next with more time

Ordered by **launch risk first**, then expected impact on filled seats and family experience. Each item maps to the deferred work above; none reverses a deliberate pushback without product signoff.

1. **Make it launch-safe — D1.** Integrate authenticated families/staff, payment capture and refunds, and durable SMS/email delivery. Use idempotency and reconciliation rather than treating a database transaction as an external payment transaction.
2. **Keep last-minute seats from going unused — D2.** Ship the staff UI; agree on a fallback when staff are absent and test whether opt-in last-call broadcasts actually improve conversion without harming trust.
3. **Close prototype gaps — D8.** Correct in-app “charged/sent” language, toast overlap, and hardening; add peak-load and background-sweeper fault tests.
4. **Reduce abandonment at the last-seat race — D3.** Add a consent-based one-tap waitlist CTA, with the actual queue position confirmed by the server.
5. **Finalize cancellation economics — D5.** Define withdrawal deadlines, refund rules and how a released seat is re-offered.
6. **Improve freshness — D4.** Replace polling with server-sent events when it meaningfully improves the experience.
7. **Validate registration-opening fairness — D9.** Prototype a limited lottery/admission window if departments consider speed-based allocation unfair.
8. **Expand policy breadth — D6 and D7.** Implement approved sibling pricing and mid-session enrollment after defining their financial and eligibility rules.

---

## Tools & Process

### Tools

| Tool | How I used it |
|---|---|
| **Claude design canvas** | The source design: an interactive prototype of the registration flow, which went through several iterations |
| **Claude Code** (cloud session) | Read the design, then built the React client, Express API, Postgres schema and tests. It ran the app and drove a headless browser with Playwright to check each flow at desktop and phone widths, then turned those checks into the end-to-end tests that run on every push |
| **A second Claude agent as reviewer** | Given only the code and the business rules, with fresh context and read-only access, and told to find ways to break it |
| **ChatGPT (README reviewer)** | Reviewed the latest repository and compared the README against the supplied brief; clarified stakeholder pushback versus requirements, real versus simulated integrations, and aligned deferrals with the roadmap |\n| **Postgres + Node's test runner** | Tested parallel booking requests against a real database; CI runs the regression suite |

How I worked with it:
- **Requirements came from me in plain language; the AI turned them into code and tests.** Bugs were reproduced with a failing test before being fixed.
- **I checked its work by asking it to confirm specific rules.** That's how the conflict between the design and my "no charge without acceptance" requirement surfaced.

### Where I overrode or corrected the AI

- **It built the design's auto-charge option without questioning it.** When I asked it to confirm that nobody is charged without accepting within 2 hours, it admitted the option broke that rule. I had it removed from the code and the design.
- **It built "accept, then pay at checkout" as two steps.** I changed it to charge at the moment of acceptance.
- **It implemented the design's "held for another family" dots and countdowns.** I had them removed. It then also stopped the API from sending that data at all, so it can't be found by inspecting the page.
- **"Can two families book the last seat?"** Its answer, that the database lock makes it safe, was correct but incomplete. I pointed out that the 24 losing families still *saw* an open seat and expected to get it. That user-experience gap is now first on the next-steps list.
- **Smaller corrections:**
  - Some of its own tests had wrong expectations, or failed now and then because they read the clock twice. It caught and fixed these itself.

### Bugs I found testing it myself

Every automated test was passing when I clicked through the site in Codespaces. These are what I still found:

| What I hit | Cause | Fix |
|---|---|---|
| **The site wouldn't load in Codespaces** ("unable to handle this request") | Vite listened only on `localhost`, and port 5173 had to be forwarded as HTTP | It loaded once I re-forwarded 5173 as HTTP in the Ports tab. The dev container now binds Vite to all addresses, keeps it on a fixed port, and waits for Postgres before seeding |
| **Programs still had age limits.** I'd asked for ages per section; cards still said "Ages 3–5" | It kept a program-level range that sections fell back to. Its first fix still showed a program "summary" age, and it passed every test | Ages now live only on sections (migration `006`), and a section can be open to all ages. No program shows an age |
| **"Maya is already registered"** when adding her to Swim 2 Thursdays, with a seat open | A one-section-per-program rule it carried over from the design without asking | The rule is now per section: never the same section twice, any other day is fine. API and browser regression tests |
| **Hard to find classes Maya and Leo could take together** | Only two sections fit both kids, and each had one seat left | Pick several kids on the browse page to see programs that take them together; sections they all fit are tagged "Maya & Leo can both join"; the demo data has more all-ages sections |

**What this taught me:** the AI's tests checked what it had built, not what I meant. A fix can pass every test and still
miss the point, as the first age fix did. Clicking through the real site myself caught that.

### Asking the AI to break it

I gave the second agent the business rules and asked it to find overbooking, line-skipping, deadlocks, data leaks and
stuck seats. It wrote probe scripts against a scratch database. It confirmed for the tested normal booking flows:
- no overbooking, unapproved line-skipping, or leakage of another family's holds (staff-authorized last call intentionally changes FIFO)
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
