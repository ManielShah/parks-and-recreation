<div align="center">

# 🌲 Cedar Valley Parks & Recreation
### Rec Technologies — Take-Home Submission

**Fair access. No overbooking. More filled seats.**

A working family registration experience, with a particular focus on what happens when a high-demand class fills up and a place becomes available.

[**Try the demo**](https://codespaces.new/ManielShah/parks-and-recreation?quickstart=1) · [**View CI and browser tests**](https://github.com/ManielShah/parks-and-recreation/actions/workflows/e2e.yml) · [**Read the code**](README_CODE.md)

</div>

---

## At a glance

**The problem:** A parks department needs to register children into limited-capacity sections. When classes fill, families need a fair waitlist, the department needs to avoid vacant seats, and simultaneous requests must never create an overbooking.

**My product choice:** Rather than automatically enrolling and charging the next family, **reserve an offered seat for the earliest waitlisted child, shorten the claim window as the class approaches, and charge only after the parent explicitly accepts**. Under 20 minutes to start, staff can choose either a targeted FIFO offer or a first-to-claim last call. This is intentional pushback on a stakeholder proposal, not an assertion that the proposal was never requested.

**My engineering choice:** Keep inventory allocation inside PostgreSQL transactions. Section-row locks plus a deferred capacity constraint protect against races across checkout, cancellations, waitlist offers, and claims. The hardest paths are exercised against real PostgreSQL, not an in-memory approximation.

> **Demo limitation:** Card charges and SMS/email delivery are **simulated**. No money moves and no message is sent externally. Some prototype UI copy says “paid” or “sent”; that text is not evidence of a real integration. See [what I deferred](#what-i-deferred-and-why).

## What I built and why

| Requirement or consideration | Implementation |
|---|---|
| Browse programs and register children | React catalog, household child selection, multiple section choices, five-minute cart holds, checkout and My registrations |
| Section capacity | Transactionally enforced booking capacity; separate waitlists per section |
| Age-gated sections | Age restrictions live on sections, including sections open to all ages |
| Household registration | Multiple children from the same household; independently tracked enrollments and waitlist positions |
| Waitlist fairness | FIFO offers in normal operation; waitlist priority prevents walk-ins from bypassing families who are waiting |
| Registration opening time | Server-enforced `registration_opens_at`, with optional reminders |
| Automatic waitlist promotion | Automatic **offer and reservation**, not automatic charge/enrollment; parents accept or decline |
| Sibling discounts | Deliberately deferred; pricing scope and behavior across separately accepted offers need clarification |

### The design decision: fairness vs. seat utilization

A two-hour waitlist offer is reasonable days before class, but not when a high-demand class begins in 30 minutes. A vacated place is also a missed registration opportunity for both the department and a payments-driven platform.

| First class starts in | Automatic claim window |
|---|---|
| More than 24 hours | Up to 2 hours |
| 2–24 hours | Up to 30 minutes |
| 20 minutes–2 hours | Up to 10 minutes |
| Less than 20 minutes | Staff-managed, with optional last call |

**Example:** A 4:00 PM class loses a student at 3:30 PM. The first family has until 3:40 PM to accept. If they don't, the next family gets a chance until 3:50 PM. Automatic offers never extend past 10 minutes before class. Staff can deliberately override this policy.

Normal offers preserve FIFO; a **staff-triggered last call** lets remaining waitlisted families compete for an available seat near class start, where the alternative may be an unfilled place. This exception is explicit and auditable. A fully automatic last-minute fallback is **not** implemented.

### What makes the implementation trustworthy

- **Concurrency:** A section lock serializes conflicting updates; availability is recalculated inside the transaction. A database constraint rejects over-capacity writes as a second safeguard.
- **Fairness:** A freed seat is offered down that section's queue; new families cannot jump past someone waiting. The audit log records join, offer, accept, decline, expiry, and claim events.
- **Recovery:** Expired reservations release inventory. A previously discovered rollback bug was fixed so a rejected expired claim cannot undo the next family's promotion.
- **Privacy:** Parents see whether capacity is taken, not other families' temporary holds or claim timers.
- **Validation:** CI runs **42 API tests and 9 browser tests** covering real database races, FIFO behavior, expiry boundaries, last-minute offers, age eligibility and the parent flow. [See CI](https://github.com/ManielShah/parks-and-recreation/actions/workflows/e2e.yml).

To follow the implementation, schema, APIs, and test cases, see [README_CODE.md](README_CODE.md).

## See the experience

[**Open the live-in-Codespaces demo**](https://codespaces.new/ManielShah/parks-and-recreation?quickstart=1). The repository configures PostgreSQL and seeds a household with **Maya** and **Leo**, plus other families already enrolled or waitlisted.

A useful five-step walkthrough:

1. Browse **Swim Level 2 → Saturdays**, which starts full, and waitlist Maya.
2. Use **Prototype controls** to simulate cancellations; earlier families receive offers first.
3. Watch Maya receive a timed offer, then accept and see the registration confirmation.
4. Reset; move the first class start to **1 hour away** and observe a **10-minute** offer.
5. Move it to **15 minutes away**: no new automatic offer is made. The seat remains protected for the waitlist until staff intervene.

For local commands, API examples, and the staff endpoints, see the [technical README](README_CODE.md#1-run-and-test).

## What I'd push back on and why

1. **Auto-enroll and charge the next waitlisted family.** This is a real stakeholder request, but it risks surprise charges and schedule conflicts. I implemented automatic **invitations**, not automatic **purchases**. I'd validate this decision with departments and track offer acceptance and unfilled-seat rates before committing to a billing policy.
2. **Always hold a seat for two hours.** A fixed deadline loses seats near the start of class; dynamic windows are implemented instead.
3. **Assume staff can always intervene in the final minutes.** Staff offers and last-call APIs work, but unattended seats may still go empty. [D2](#what-i-deferred-and-why) is a proposed automated fallback that needs explicit fairness and consent rules.
4. **Reveal another family's hold or countdown.** Availability matters; another household's temporary behavior is private. The API exposes aggregate capacity instead.
5. **Treat fastest click as the definition of fairness.** Database locks avoid overbooking at popular opening times, but don't equalize connection speed. [D9](#what-i-deferred-and-why) is a possible lottery/admission design, not something I would add without policy agreement.

## What I deferred and why

Every deferral below maps to a next step. **Sibling pricing is deferred intentionally; enhanced age modeling is not blocking this take-home.**

| ID | Deferred | Reason |
|---|---|---|
| **D1** | Real payments, SMS/email, and sign-in | External integrations require payment idempotency/reconciliation, robust delivery, and real household/staff authentication |
| **D2** | Staff UI + unattended last-minute escalation | Staff APIs exist; automatic last call would change fairness and needs an agreed policy |
| **D3** | One-tap waitlist join after losing a final-seat race | Requires an explicit consent/notification decision and confirmation of actual queue position |
| **D4** | Live updates | Two-second polling can show momentarily stale availability; server-side allocation remains authoritative |
| **D5** | Refund and cancellation policy | Unresolved business rules; withdrawal releases capacity, but no refund is processed |
| **D6** | Sibling discounts | Define the scope of “second/third child,” including separately accepted offers and cancellations |
| **D7** | Registration after a course begins | Needs prorating, instructor approval, and recurring-session rules |
| **D8** | Prototype UX and production hardening | UI payment/SMS copy, overlapping toasts, operational load and resilience |
| **D9** | Lottery/admission windows for popular openings | Changes who gets priority; should be supported by department policy |

## What I'd do next with more time

| Order | Next step | Deferred item |
|---|---|---|
| 1 | Integrate secure sign-in, idempotent payments, delivery/retries, and reconciliation | D1 |
| 2 | Give staff a queue-management screen; test opt-in, unattended last-call escalation to reduce missed enrollments | D2 |
| 3 | Correct simulated-transaction copy in the UI; load-test peak openings and background recovery | D8 |
| 4 | Offer one-tap waitlist signup after a lost final-seat race | D3 |
| 5 | Agree on cancellation/refund policy before implementing refunds | D5 |
| 6 | Add live updates when polling becomes a meaningful UX limitation | D4 |
| 7 | Validate lottery/admission-window fairness with departments | D9 |
| 8 | Add approved sibling pricing and mid-course enrollment rules | D6, D7 |

**What I would measure:** zero overbooking and unauthorized queue bypasses; waitlist-to-registration conversion; cancellation-to-refill time; offer expiry/decline rates; paid-seat utilization; and how many high-demand sections start with open seats while families remain queued. These are **proposed production measures**, not metrics measured by the prototype.

## Tools & Process

The take-home asks not only what AI produced, but what I challenged and changed. I used AI to speed implementation **and** as an adversarial reviewer; I owned the final product tradeoffs.

| Tool | Role |
|---|---|
| **Claude design canvas** | Iterative source design/prototype for the family experience |
| **Claude Code** | Implemented the React/Express/PostgreSQL flow and tests from requirements and review feedback; exercised browser flows |
| **Second Claude agent (independent review)** | Read the rules and code with fresh context, probed for overbooking, deadlocks, queue bypass, data leaks, and stuck seats |
| **ChatGPT** | Reviewed the repository documentation and aligned requirement interpretation, business tradeoffs, deferrals, and next steps |
| **PostgreSQL tests + Playwright** | Independent, executable checks against an actual database and browser; GitHub Actions runs both |

### Where I corrected or overrode the AI

- **Automatic charge:** The initial design/implementation included “register and charge automatically.” I challenged the consent and trust implications and removed it in favor of explicit acceptance.
- **Accept then checkout:** I changed a two-step offer flow to **accept and register in one action** (payment remains mocked).
- **Privacy:** I rejected “another family is holding this seat” UI with a visible countdown and removed that information from family-facing API responses.
- **Requirements over implementation:** The first age-range change still showed program ages, and a child was blocked from joining a second section of the same program. Manual browser testing exposed both despite passing tests. I had ages moved to sections and allowed multiple distinct sections.

### I asked another AI to try to break the system

The independent agent used probe scripts on a scratch PostgreSQL database. Its review surfaced issues missed by the original test set:

| Finding | Correction |
|---|---|
| A concurrent withdrawal and sibling-offer acceptance could deadlock | Changed family/child row locking to `FOR NO KEY UPDATE` and added retry protection + regression tests |
| An unknown-family read could leave a pooled transaction open | Added explicit rollback and a regression test |
| One failing section could interrupt the sweeper's work on other sections | Isolated per-section sweeps and added a lock timeout |
| An expired-offer API error could roll back promotion to the next family | Added savepoint-based settlement and a regression test |
| Rescheduling could leave an offer outside the new cutoff | Adjusted offers when start time changes and tested that path |

I also tested the demo manually in Codespaces. I caught a port-forwarding issue that prevented access, an incorrect age display, and a misleading “already registered” restriction. These were corrected before submission.

**Lesson:** AI-generated tests initially validated *what was built*, not necessarily *what the product meant*. Deliberate human review of the real user journey—and an adversarial second agent—caught both product mistakes and database failures.

---

**Technical implementation:** [README_CODE.md](README_CODE.md) · **Automated tests:** [GitHub Actions](https://github.com/ManielShah/parks-and-recreation/actions/workflows/e2e.yml)
