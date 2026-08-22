# ADR-0014 · Payroll is advisory, not blocking

**Status:** Accepted | **Date:** 2026-08-22 | **Decider:** JP van Vuuren (product owner)
**Extends:** [ADR-0013](ADR-0013-farmer-controlled-logbook.md) (farmer-controlled logbook) into the
labour module.

## Context

[ADR-0013](ADR-0013-farmer-controlled-logbook.md) reset the product boundary: Werf is a private
farmer-controlled logbook, planner and **calculator**, not an authority. Its explicit supersession
clause named crop/veterinary product resolution and hard withdrawal/PHI blocks, scoped to Phases
3–4. It did not mention payroll.

Phase 5 (labour & wages) is where that boundary is tested hardest. The specification as written
makes the payroll engine a partial enforcement system: `legal-compliance.md §2.4` step 4 and user
story US-021 both require the system to **reject** a payroll run when deductions would push net pay
below the statutory floor, generating no payslip. That is a hard block — the same shape ADR-0013
removed elsewhere — sitting in the most legally consequential module in the product.

The question put to the owner: does ADR-0013's "logbook, not authority" extend to the payroll
engine, or does payroll's nature as a statutory document justify keeping the block?

The recommendation on record (from the implementer and the advisor) was to **keep the block**, on
the reasoning that a payroll run is not a record of a fact that happened — it is a document Werf
generates — and refusing to emit a knowingly-unlawful payslip is Werf declining its own act, not
overriding the farmer.

## Decision

**The owner chose advisory-only. Payroll warns; it never blocks.**

- **Attendance and piece-work CAPTURE never blocks and always works offline.** They are records of
  a fact that happened — exactly the class ADR-0013 protects. No `if (!navigator.onLine) throw`, no
  validation that refuses to record a shift.
- **The payroll ENGINE computes exactly and completely.** Deduction caps still cap. The piece-rate
  floor still tops up, as a visible payslip line. Overtime above the weekly cap is still paid in
  full. A net-below-floor outcome is still *detected*.
- **Every issue is surfaced as a conspicuous warning shown BEFORE approval, and the run is still
  generated.** Nothing in the engine rejects a run. The net-below-floor case, which the prior spec
  rejected, becomes a first-class, must-acknowledge warning like the others.
- **Every warning carries its statute and the date-resolved rate + gazette reference** it was
  measured against, so the owner can check it rather than trust it. "Advisory, not blocking" is
  about *who decides*, never about *whether the number is right*.

What does not change: the calculation is the most careful, highest-coverage code in the repo; every
rate is resolved by the date the work was done ([ADR-0005](ADR-0005-regulatory-rates.md)); no
regulated constant lives in code; every payslip is a real BCEA s33 document; money is integer cents.

## Superseded statements

The following statements mandated the opposite and were rewritten to advisory during the Phase 5
planning correction on 2026-08-22:

- `docs/01-requirements/user-stories.md` — US-021 scenario 2 ("the payroll run is REJECTED … no
  payslip is generated").
- `docs/00-business/legal-compliance.md` — §2.4 step 4 ("Reject the payroll run, do not clamp
  silently") and step 3's reject-on-floor constraint. This is the normative legal document; it is
  rewritten only after the external review below has considered the decision, not before.
- `.claude/rules/domain.md` — "Net below the statutory floor → REJECT the whole run."

## The safety valve

⛔ **This decision is itself a question for the external labour-law review** (Phase 5 sub-phase 5i,
blocker B-1). An advisory-only engine that will generate a payslip the BCEA makes unlawful is
precisely the judgement a qualified practitioner should bless or overturn. The review must be asked
about it explicitly, and its answer governs — if the practitioner says the block is legally required,
this ADR is revisited before 5e ships to production.

## Consequences

| | |
|---|---|
| ➕ | Internally consistent with ADR-0013: Werf never refuses the farmer's decision |
| ➕ | A run is never stuck; the owner is always shown the problem and always in control |
| ➕ | The engine stays a pure calculator + warning set — simpler than calculate-then-gate |
| ➖ | Werf can generate a payslip that is unlawful if the owner ignores a warning |
| ➖ | The wedge ("prevent the CCMA case") now depends on the owner heeding a warning, not on a gate |
| ➖ | The normative legal text and generated documents require qualified external review |

## Revisit if

The external labour-law review says a hard block is legally required · the owner reverses the
decision · a customer buys a separate professionally-maintained compliance product where blocking is
the contracted behaviour.
