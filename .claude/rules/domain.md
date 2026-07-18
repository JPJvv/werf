---
paths: ["packages/domain/**"]
---
# Domain rules — payroll and compliance

READ docs/00-business/legal-compliance.md BEFORE writing any code here.
The figures in it decay annually. If today is materially later than July 2026,
assume §2.2 is wrong and say so rather than coding against it.

## Absolute

- NEVER hardcode a regulated value. Minimum wage, BCEA threshold, UIF ceiling,
  deduction caps, withdrawal periods, PHI days — all via
  `rates.lookup(jurisdiction, code, occurredAt)`.
  A literal is a defect at review even if the value is correct today.

- ALWAYS look up by the date the event OCCURRED, never `new Date()`:
    rates.lookup(farm.jurisdiction, 'NMW_FARM', shift.occurredAt)   ✅
    rates.lookup(farm.jurisdiction, 'NMW_FARM', new Date())         ❌ pays Feb work at March's rate

- Jurisdiction comes from THE FARM. Never the user, the browser locale, or a default.
  A Free State farm is governed by SA law regardless of where its owner logs in from.

- NO SOUTH AFRICAN CONCEPT MAY NAME A GENERIC THING. This is ADR-0006 and it is
  the rule that gets violated first, because `bceaThreshold` is a natural thing to
  type when SA is the only country you have.
    packages/core:                interface PayrollRules { earningsThreshold(...) }  ✅
    packages/core:                interface PayrollConfig { bceaThreshold: Money }   ❌
    jurisdictions/za/codes.ts:    const ZA = { threshold: 'BCEA_THRESHOLD' }         ✅
  BCEA / POPIA / SD13 / UIF / SARS / SAPS / SIZA appear ONLY in
  packages/domain/*/jurisdictions/za/, in docs/00-business/legal-compliance.md,
  and in ZA user-facing copy. Nowhere else.

- DO NOT implement a second jurisdiction. No `NA` stub, no example impl, no
  "reference jurisdiction for testing". A guessed second country makes tests pass
  against fiction and calcifies the interface around law nobody has read.
  One implementation: ZA. Until there is a real country with a real customer.

- A missing rate THROWS. Never fall back to the newest rate. A loud failure is a
  five-minute fix; a silent fallback underpays a farm for a year.

- This package has NO I/O. No database, no HTTP, no clock — the date is injected.
  If you are importing Drizzle here, the design has gone wrong.

- Money is integer cents in TypeScript, numeric(14,2) in Postgres. Never a float.
  Never in a test either: expect(gross).toBe(24184), not 241.84.

## Payroll (see legal-compliance.md §2.4 for the full algorithm)

- Piece rate below the minimum floor → TOP UP, and the top-up is a visible payslip line.
- Overtime above the weekly cap → PAID IN FULL and flagged. Never withheld. It is the
  employer's breach of the hours rule; the worker still worked those hours.
- Deductions capped at the statutory limit → warn.
- Net below the statutory floor → REJECT the whole run. Never clamp silently.
- Warnings are returned data, not logs. They render above the numbers.
- Every warning carries a gazetteReference. When the farmer asks "says who?",
  the answer is a Gazette number.
- A pay period spanning 1 March uses BOTH rates, per shift. This happens every year.

## Compliance

- Withdrawal and PHI dates are computed AT CAPTURE and stored, never computed on read.
  The rule that applied is the rule at the time of the event.
- No `suspect` field on theft records. Ever. Defamation exposure for our customer,
  POPIA s26 criminal-behaviour processing exposure for us. Record facts.

## Tests

- Table-driven, from the worked examples in legal-compliance.md §2.4.
- Every scenario in docs/01-requirements/user-stories.md US-02x has a test.
- Every case cites its source: a §, a US-, or a Gazette number. A test without a
  source cannot be maintained — in three years nobody knows if the expected value
  is law or a typo.
- Coverage ≥95% here. Higher than anywhere else in the repo, on purpose.
- Never mock our own code. If a test needs a mock of another domain function,
  the boundary is wrong.
