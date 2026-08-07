# Compliance Register — regulated figures and their verification status

> **Purpose.** One place to see every regulated figure the code depends on, its source, when it
> was last verified, and when it must be re-checked. This exists so a session does **not** re-read
> the Government Gazette every time it touches regulated code — the figures change on known dates,
> not daily. It operationalises [`legal-compliance.md`](legal-compliance.md) §2.2 (the figures) and
> §7 (the annual cycle). It is the ENGINEERING ledger; the farm-facing `compliance_obligations`
> table (§6) is a separate, in-app thing.

**Established 2026-07-30 by JP.** See STATUS.md §6 (compliance operating model).

---

## The operating model — how to build regulated code without a Gazette in every session

1. **Build the mechanism now, verify the figures later.** The *code* (date-versioned
   `regulatory_rates`, lookup by `occurred_at`, jurisdiction-from-the-farm, the `PayrollRules` seam,
   "never hardcode a regulated number") needs no Gazette to build or test. Build it with the
   last-known figures marked below.
2. **Every regulated figure is DATA, never a literal.** It lives in `regulatory_rates`
   (date-versioned) or a reference table (`veterinary_products`, chemical registers). A magic number
   in code is a defect even when it is today's correct value — `.claude/rules/domain.md`.
3. **Provenance + a verified flag travel with the figure.** A `regulatory_rates` row carries its
   source and a `verified_at`. **The PRODUCTION seed refuses any `PLACEHOLDER` / unverified row; the
   dev and test seed allow them.** So a whole phase can be built and tested against placeholders and
   green tests, and an unverified figure *physically cannot reach a real payslip.* (This gate is a
   Phase-5-opening slice — see the roadmap. Until it exists, "do not deploy" is enforced by review,
   not by code.)
4. **Verification is batched and trigger-based, not per-session.** Re-verify a figure when its
   `next_review` passes or a phase closes; a backstop sweep runs every ~4 sessions. One batched
   Gazette pass, then update this table AND the rate row's `verified_at`.
5. **A `compliance-checker` pass is about RULES, not figures.** `pnpm verify` cannot tell you
   overtime was classified against the wrong day's rate. Run one owner-triggered pass on the first
   payroll slice (even with placeholder figures), then batched per-phase. See `AGENTS.md` for the
   owner-triggered review policy.

**Status values**
- `VERIFIED` — checked against the cited Gazette/Act on `verified_at`; safe to deploy.
- `PLACEHOLDER` — a stand-in for building/testing. **Must not deploy.**
- `CITED` — a real published figure copied from `legal-compliance.md` §2.2 with its source, but not
  independently re-verified this cycle. Treat as **verify-before-deploy**.
- `STALE` — past `next_review`; re-check before use.

---

## Register — the figures

> Values below are copied from `legal-compliance.md` §2.2 (dated July 2026), which itself says
> "VERIFY BEFORE USE." None has been independently re-verified against the Gazette in this cycle, so
> all wage/threshold figures are `CITED`. Withdrawal periods are reference data resolved per product
> registration and are structurally sound (see the note under the table).

| Code / figure | Value (as cited) | Status | Source | verified_at | next_review | Used by |
|---|---|---|---|---|---|---|
| `NMW_FARM` national minimum wage | R30.23 / hour (eff. 1 Mar 2026) | CITED | Gov. Gazette No. 54075, 3 Feb 2026 | — | **2027-02** (watch Feb gazette, deploy before 1 Mar) | Phase 5 payroll |
| `BCEA_THRESHOLD` earnings threshold | R269,600.90 / yr (R22,466.74 / mo, eff. 1 May 2026) | CITED | GN 7384, Gazette 54544, 17 Apr 2026 | — | **2027-04** (watch Apr gazette, deploy before 1 May) | Phase 5 payroll (gates overtime/Sunday entitlement) |
| `UIF_CEILING` monthly UIF ceiling | not yet captured | PLACEHOLDER | UIF Act (ceiling gazetted separately) | — | **capture before Phase 5 payroll** | Phase 5 payroll (1% ee + 1% er, capped) |
| Overtime multiplier | 1.5× (max 10 h/week) | CITED | BCEA s10 | — | on amendment (rare) | Phase 5 payroll |
| Sunday work | 2× (1.5× if ordinarily Sundays) | CITED | BCEA s16 | — | on amendment (rare) | Phase 5 payroll |
| Public holiday | 2× if not ordinarily worked | CITED | BCEA s18 | — | on amendment (rare) | Phase 5 payroll |
| Deduction cap: accommodation | max 10% of wage | CITED | Sectoral Determination 13 | — | occasionally | Phase 5 payroll (warn on exceed) |
| Deduction cap: food | max 10% of wage | CITED | Sectoral Determination 13 | — | occasionally | Phase 5 payroll (warn on exceed) |
| Leave entitlements (annual / sick / maternity / family) | per §2.2 | CITED | BCEA s20/s22/s25/s27 | — | on amendment (rare) | Phase 5 leave module |
| Public holidays list (per year, incl. proclaimed once-off) | not yet captured | PLACEHOLDER | proclamations | — | **each year, ongoing** | Phase 5 payroll |
| Meat/milk withdrawal periods (FR-131) | per veterinary product registration | STRUCTURAL — resolved from `veterinary_products` by registration + treatment date, never hardcoded | product registrations (Act 36/1947); species figures Merck Vet Manual | n/a (per-product reference data) | when a registration is re-gazetted | **Phase 2 (live)** — sale/slaughter/tally guards |
| Animal-ID marking window (FR-602/stock theft) | not yet captured as dated reference data | PLACEHOLDER | Animal Identification Act 6 of 2002 | — | before B5 (unmarked-past-window flag) | Phase 2 B5 (blocked on this) |
| Pre-harvest intervals (PHI) | per chemical registration | STRUCTURAL — reference data, resolved by registration + date | chemical registers | n/a | when re-gazetted | Phase 4+ spray capture |

**Why the withdrawal periods are not a `CITED` figure:** the code never stores a withdrawal *number*
— it stores the product's registration and resolves the period from `veterinary_products` by the
registration in force on the treatment day (ADR-0005). So the "figure" is reference data keyed by
registration, and the gate is that the reference data is seeded from real registrations, not that a
constant is right. This is the pattern every regulated figure should reach.

---

## Verification cadence — the checklist to run

Run the batched sweep **when a `next_review` passes, before any phase deploy, or every ~4 sessions
as a backstop** — whichever comes first. Do NOT do this every session.

- [ ] **February** — watch for the NMW gazette; update `NMW_FARM` + `verified_at`; deploy before 1 March. (§7: a missed February = every farm underpays every worker from 1 March. Highest-severity non-outage incident.)
- [ ] **April** — watch for the BCEA threshold gazette; update `BCEA_THRESHOLD`; deploy before 1 May.
- [ ] **Before Phase 5 payroll opens** — capture `UIF_CEILING` and the current-year public-holiday list; run one owner-triggered `compliance-checker` pass on the first payroll slice.
- [ ] **Before Phase 2 B5** — capture the animal-ID marking window as dated reference data.
- [ ] **Every ~4 sessions** — scan this table for `STALE`/`PLACEHOLDER` rows whose phase is now in play; re-verify against the Gazette in one batch; update `verified_at`.
- [ ] **Before any deploy** — no `PLACEHOLDER`/`CITED` row remains for that phase's figures (once the seed gate exists, this is enforced by code).

---

## Change log

| Date | Change |
|---|---|
| 2026-07-30 | Register created (JP's compliance operating model). Seeded from `legal-compliance.md` §2.2; all wage/threshold figures marked `CITED` (re-verify before payroll deploy). No figure independently re-verified this cycle. |
