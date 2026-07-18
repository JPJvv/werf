# ADR-0006 · SA-locked, jurisdiction-ready

**Status:** Accepted · **Date:** 2026-07 · **Deciders:** Tech lead, product
**Supersedes nothing. Amends:** [ADR-0002](ADR-0002-data-residency.md), [ADR-0005](ADR-0005-regulatory-rates.md)

## Context

v1 ships to South Africa only. Every differentiator in the product is South African law: BCEA and Sectoral Determination 13, the Animal Identification Act, the Stock Theft Act, POPIA, GlobalGAP-as-implemented-here. That is deliberate — the localisation *is* the moat ([BRD](../../00-business/BRD.md)).

But the ambition is Namibia, Botswana, and beyond. So the question is not *"should we support multiple countries?"* — it is **"what do we build today so that the second country is a two-week job instead of a six-month rewrite?"**

## Decision

**Build the seams. Do not build the abstraction.**

Concretely: every regulated thing carries a `jurisdiction` (ISO 3166-1 alpha-2). Every jurisdiction-specific rule lives behind a named interface with **exactly one implementation: `ZA`**. The UI shows no country selector. The registry contains one entry.

```ts
// packages/domain/payroll/index.ts
const registry: Record<Jurisdiction, PayrollRules> = { ZA: zaPayrollRules };
//                                                     ^^ the only entry in v1

export function calculatePayroll(input: PayrollInput): PayrollResult {
  const rules = registry[input.farm.jurisdiction];
  if (!rules) throw new UnsupportedJurisdictionError(input.farm.jurisdiction);
  return rules.calculate(input);
}
```

## Why not just add a `country` column and be done

Because the naive version does not work, and it is worth being precise about why.

**South African payroll is not "a rate × hours" with a different number.** It is a *structure*: BCEA hour classification, sectoral determinations, statutory deduction caps, UIF, an earnings threshold that switches off overtime entitlement. Namibia's Labour Act 11 of 2007 has a different structure. Australia has modern awards, which are a different structure again.

You cannot parameterise your way from one to the other. `minimumWage: 30.23` → `minimumWage: 18.00` gets you a wrong Namibian payslip, not a Namibian payslip.

So the seam has to be at the **rules**, not at the **numbers**. That is a strategy interface, not a config value.

## Why not build a rules engine

The tempting move — a DSL, a rules table, a plugin system, something where adding Namibia is a data change.

**No.** An abstraction built against one implementation is almost always the wrong abstraction. You discover what actually varies when you add the second one, and by then you have built the wrong seams and you are refactoring *and* migrating simultaneously. This is the single most common way "future-proof" architecture becomes technical debt.

And the cost lands in the worst possible place: a rules engine is indirection in the most legally-sensitive code in the system. `packages/domain/payroll` is where a bug means a farm worker is underpaid for a year. It should be the most boringly readable code in the repo — pure functions, table-driven tests, obvious. A DSL interpreter is the opposite of that.

## What we build ✅ and what we refuse ❌

| ✅ Build now — cheap today, brutal later | ❌ Refuse — pay for it when the second country is real |
|---|---|
| `jurisdiction` column on `regulatory_rates`, `farms`, reference data | A rules DSL |
| `rates.lookup(jurisdiction, code, date)` signature | A plugin loader |
| `PayrollRules` / `ComplianceRuleset` / `PrivacyRegime` interfaces, one impl each | Guessing what Namibia needs |
| `packages/domain/*/jurisdictions/za/` directory structure | A country picker in the UI |
| Naming discipline (below) | Multi-region infrastructure |
| Region as a Terraform variable | Currency abstraction (ZAR only; the Rand is not a "locale setting" in v1) |

**The asymmetry is the whole argument.** Adding a `jurisdiction` column to `regulatory_rates` costs one line today. Adding it in year three, to a partitioned `events` table across 10,000 farms with 500,000 events each, is a migration nobody survives. Building a rules engine costs six weeks today and is probably wrong. So: columns yes, engine no.

## The naming rule — the cheapest and most-violated one

**Never let a South African concept name a generic thing.**

```ts
// ❌ packages/core — a SA statute in the shared contract
interface PayrollConfig { bceaThreshold: Money; sectoralDetermination: string; }

// ✅ packages/core — the interface is jurisdiction-neutral
interface PayrollRules {
  earningsThreshold(at: Date): Money;   // ZA calls this BCEA; NA calls it something else
  classifyShift(shift: Shift): ShiftClass;
  statutoryDeductionCaps(at: Date): DeductionCaps;
}

// ✅ packages/domain/payroll/jurisdictions/za — SA names live HERE and only here
const ZA_CODES = { threshold: 'BCEA_THRESHOLD', minimumWage: 'NMW_FARM' } as const;
```

`BCEA`, `SD13`, `POPIA`, `UIF`, `SARS`, `CIPC`, `SAPS`, `SIZA` may appear in `jurisdictions/za/`, in `docs/00-business/legal-compliance.md`, and in user-facing ZA copy. **Nowhere else.** A `bceaThreshold` field in `packages/core` is a defect at review, because it is a South African statute sitting in the contract every future country must implement.

This rule costs nothing and it is the one that will be violated first, because `bceaThreshold` is a perfectly natural thing to type when South Africa is the only country you have.

## What varies, mapped

| Concern | Interface | ZA implementation |
|---|---|---|
| Wage & hours | `PayrollRules` | BCEA + Sectoral Determination 13 + NMW Act |
| Animal identity | `AnimalIdentityRules` | Animal Identification Act 6 of 2002 (≤3-char mark) |
| Theft procedure | `TheftEvidenceRules` | Stock Theft Act 57 of 1959 → SAPS evidence pack |
| Privacy | `PrivacyRegime` | POPIA (s26 special categories, s22 breach, s31 retention) |
| Chemical registration | reference data + `jurisdiction` | Act 36 of 1947 registrations, PHIs |
| Veterinary withdrawal | reference data + `jurisdiction` | SA registrations |
| Export audit | `ComplianceRuleset` | GlobalGAP IFA + SIZA |
| Public holidays | dated reference data + `jurisdiction` | ZA gazetted, incl. once-off proclaimed days |
| Currency | — | **ZAR, hardcoded in v1.** Deliberately not abstracted. |
| Language | i18n | en-ZA, af-ZA |
| **Data residency** | jurisdiction property | af-south-1 — see below |

**`PrivacyRegime` is the one people forget.** POPIA is not GDPR. Retention periods differ, breach notification timing differs, and the definition of a special category differs (POPIA s26 includes criminal behaviour; GDPR Art. 9 does not, it is handled under Art. 10). Hardcoding "3 years" for employment records because BCEA s31 says so is a South African statute leaking into shared code — same defect as `bceaThreshold`.

## Data residency, amended

[ADR-0002](ADR-0002-data-residency.md) picks af-south-1 because our data subjects are South African. Multi-country makes residency **a property of the jurisdiction**, not a constant.

| Second country | Residency answer | Difficulty |
|---|---|---|
| Namibia, Botswana, Zimbabwe | af-south-1. No local region exists; no local residency law requires otherwise. | ✅ Easy |
| Kenya | Kenya's Data Protection Act 2019 has localisation provisions. Needs analysis. | ⚠️ Real work |
| Australia, EU | ap-southeast-2 / eu-central-1. Multi-region, and GDPR is a different regime entirely. | ❌ A project |

**So:** region is a Terraform variable, not a hardcoded string. That is all we do now. **The first non-SADC country triggers a re-read of ADR-0002, not a config change** — and that is the correct outcome, because it is a decision, not a deployment.

## Consequences

| | |
|---|---|
| ➕ | Second country ≈ one directory + one registry entry + reference data |
| ➕ | The expensive-to-add-later columns exist from day one |
| ➕ | Payroll stays boring, readable, table-driven — no DSL in the legally-dangerous code |
| ➕ | No speculative abstraction to unwind when reality arrives |
| ➕ | [ADR-0005](ADR-0005-regulatory-rates.md) gains a dimension without changing its principle |
| ➖ | Every rate lookup carries a jurisdiction argument that is always `'ZA'` in v1 |
| ➖ | An interface with one implementation looks like over-engineering, and reviewers will say so |
| ➖ | The naming rule needs enforcing by review; no lint rule catches `bceaThreshold` |
| ➖ | The `jurisdiction` column is dead weight until it isn't |

The second row is worth sitting with. `PayrollRules` with only `zaPayrollRules` behind it *is* a smell by normal standards — YAGNI says delete it. The counter-argument is specific rather than general: **the thing YAGNI protects you from is guessing at abstractions. This is not a guess.** We know a second country is coming, we know payroll structure varies by country because that is a fact about labour law and not a prediction, and we know the interface boundary (calculate a payslip from shifts) because we have already built it once. That is the narrow case where the seam is justified.

If we are wrong and the second country never comes, the cost is one indirection and an unused column. That is a cheap wrong.

## The rule that keeps this honest

**Do not implement a second jurisdiction speculatively.** No `NA` stub, no `example` implementation, no "reference jurisdiction" for testing. One implementation, `ZA`, until a real country with a real customer is a real decision.

The moment someone adds `NA: namibiaPayrollRules` with guessed rules, the tests start passing against fiction and the abstraction calcifies around a country nobody has researched. Add the second jurisdiction when there is a second jurisdiction — and expect the interface to change when you do, because that is when you find out what actually varies.

## Revisit if

The second real country arrives (**expect to change the interfaces then — that is the point**) · A jurisdiction needs to vary something not behind an interface · The `jurisdiction` argument is still `'ZA'` everywhere in three years (then this was wrong, and the cost was one indirection).
