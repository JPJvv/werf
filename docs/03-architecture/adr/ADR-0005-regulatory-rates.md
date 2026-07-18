# ADR-0005 · Regulated values are data with effective dates, never constants

**Status:** Accepted · **Date:** 2026-07 · **Deciders:** Tech lead, product
**Amended by:** [ADR-0006](ADR-0006-multi-jurisdiction.md) — rates gain a `jurisdiction` dimension

## Context

Werf calculates wages against the South African national minimum wage, the BCEA earnings threshold, deduction caps, and UIF ceilings. It enforces pre-harvest intervals and medicine withdrawal periods.

**Every one of these numbers changes, and most change annually on a schedule set by a Minister.** The minimum wage changes each March. The BCEA threshold changes each April. Chemical registrations change whenever they change.

The obvious implementation — `const MINIMUM_WAGE = 30.23` — is wrong in three separate ways, and it is wrong the moment it is written.

## Decision

**Every regulated value lives in a `regulatory_rates` table with `effective_from` and `effective_to`, and is resolved by the date the event occurred.**

```sql
CREATE TABLE regulatory_rates (
  id uuid PRIMARY KEY,
  jurisdiction char(2) NOT NULL DEFAULT 'ZA',   -- ADR-0006
  code text NOT NULL,               -- 'NMW_FARM', 'BCEA_THRESHOLD', 'UIF_CEILING'
  value numeric(14,4) NOT NULL,
  unit text NOT NULL,               -- 'ZAR_PER_HOUR', 'ZAR_PER_YEAR'
  effective_from date NOT NULL,
  effective_to date,                -- NULL = current
  gazette_reference text NOT NULL,  -- 'GG 54075, 2026-02-03'  ← NOT NULL is deliberate
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (jurisdiction, code, effective_from)
);
```

```ts
// Always. Every time.
const rate = await rates.lookup(farm.jurisdiction, 'NMW_FARM', shift.occurredAt);
```

**The jurisdiction dimension is [ADR-0006](ADR-0006-multi-jurisdiction.md), and it changes nothing about the principle here.** A regulated value is identified by *who regulates it*, *what it is*, and *when it applied*. We had two of the three. The third was always implicit — it was `'ZA'`, we just weren't writing it down. Now we are.

## Why the obvious way is wrong three times

1. **It is wrong retroactively.** Re-running a February payslip in July must use February's rate. A constant gives today's rate to yesterday's work. That is not a rounding error; it is a wrong legal document.
2. **It is wrong prospectively.** The March increase requires a code change, a build, a test cycle, and a deploy — on a deadline set by someone else, published maybe three weeks ahead. Miss it and *every farm on the platform underpays every worker* from 1 March. That is the highest-severity non-outage incident this product can have.
3. **It is wrong within a single pay period.** A weekly cycle spanning 1 March contains shifts at two different rates. A constant cannot express this. **This happens every single year and is not an edge case.**

Point 3 is the one that settles it. Even a perfectly-maintained constant, updated on time, still produces a wrong payslip in the first week of March. The lookup must be per-shift, by date. There is no version of the constant that works.

## The rules

1. **Lookup is by `occurred_at`, never `now()`.** A code review that sees `rates.lookup(j, code, new Date())` in payroll rejects the PR.
1b. **Jurisdiction comes from the farm, never from the user, the browser, or a default.** `rates.lookup(farm.jurisdiction, ...)`. A farm in the Free State is governed by South African law regardless of whether its owner is logged in from London.
2. **`gazette_reference` is NOT NULL.** Every rate traces to a published source. When a labour lawyer or an inspector asks "why did you pay R28.79", the answer is a Gazette number, not "that is what was in the code".
3. **A lint rule flags numeric literals near `wage`, `rate`, `threshold`, `minimum`, `withdrawal`, `cap`** in `packages/domain`. It has false positives. Each is suppressed individually with a comment saying why the number is not regulated. **That friction is the feature** — it forces the question every time.
4. **Rates are seeded by migration and editable via admin UI (FR-615), never by a deploy.** February must not need a release.
5. **Rates sync to the client, read-only**, so the withdrawal-period check works in the crush with no signal.
6. **A missing rate is an error, never a default.** `lookup()` throws if no rate covers the date. A silent fallback to the newest rate is how you underpay someone for a year without noticing.
7. **The annual update is a scheduled job with an owner and a runbook**, not a wiki page. February and April are calendar entries. See [maintenance-runbook.md](../../05-operations/maintenance-runbook.md).

Rule 6 deserves defending, because it looks unfriendly. A payroll run that fails loudly with "no NMW_FARM rate covers 2027-03-15 — has the March gazette been loaded?" is a five-minute fix. A payroll run that quietly uses 2026's rate for 2027 work is a class action.

## Scope

`NMW_FARM`, `NMW_GENERAL`, `BCEA_THRESHOLD`, `UIF_RATE_EMPLOYEE`, `UIF_RATE_EMPLOYER`, `UIF_CEILING`, `DEDUCTION_CAP_ACCOMMODATION`, `DEDUCTION_CAP_FOOD`, `OVERTIME_MULTIPLIER`, `SUNDAY_MULTIPLIER`, `PUBLIC_HOLIDAY_MULTIPLIER`, `OVERTIME_WEEKLY_CAP_HOURS`, `ORDINARY_WEEKLY_HOURS`, `ANNUAL_LEAVE_DAYS`, `SICK_LEAVE_DAYS_PER_CYCLE`, `PUBLIC_HOLIDAYS` (dated rows, including once-off proclaimed days).

Related, same principle, separate tables because they are per-product not per-date: `chemical_products` (PHI, re-entry), `veterinary_products` (meat/milk withdrawal), `notifiable_diseases`.

## Consequences

| | |
|---|---|
| ➕ | Retroactive correctness — a 2024 payslip recalculates at 2024 rates, forever |
| ➕ | The annual update is a data change, not a release |
| ➕ | Every calculation traces to a Gazette |
| ➕ | Mid-period rate changes work by construction |
| ➕ | Auditable |
| ➖ | Every calculation carries a lookup — cache per run |
| ➖ | Rates must sync to the client |
| ➖ | Someone must actually watch the Gazette |
| ➖ | The lint rule will annoy people |

The last downside is the point. Annoyance at the moment of writing a constant is orders of magnitude cheaper than a CCMA case.

## Revisit if

Never. This decision does not have a revisit condition — the underlying reality (ministers change numbers on schedules we do not control, and old work must be valued at old rates) is not going to change.
