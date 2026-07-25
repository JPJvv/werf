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

## Worker privacy, monitoring & voice (see legal-compliance.md §5.3, §5.4, ADR-0010)

- NO BACKGROUND LOCATION. Ever. Location is acquired only when the user takes an
  action that records one, and is written only as part of a work record —
  attendance, task, event, photo. There is no location table and no location stream.

- NO screen reconstructs one person's movements over time. The per-record data
  exists; the PRODUCT must not assemble it into a track. If you are writing a query
  that groups locations by user and orders by time, stop — that is ADR-0010 being
  relitigated in code.

- Geofences attach to ANIMALS and ASSETS, never people.

- A GRIEVANCE IS INVISIBLE TO THE PERSON IT NAMES. Not filtered in the UI —
  excluded by the RLS policy, with no notification and no count that changes.
  An inference channel defeats it as completely as a read does.

- Anonymous means anonymous END TO END: no employee id, no created_by, no audit_log
  row pinning the insert to a session, no device identifier. If any of those cannot
  be dropped, the UI says "confidential", never "anonymous". Overclaiming here
  gets a worker identified.

- MEDICAL CERTIFICATES ARE POPIA s26 HEALTH DATA. Same posture as injury_records:
  owner + H&S only, encrypted, never synced to a device. The approver sees dates
  and "certificate on file" — never the image, never the condition. A leave screen
  that shows the manager the note is a s26 breach wearing an HR workflow.

- ADMINISTERING A USER ACCOUNT ≠ ADMINISTERING AN EMPLOYEE RECORD. A manager may
  add a worker, reset a PIN, assign work. A manager may NEVER read wage rate,
  ID number, banking, or payslips. Two grants that look like one.

- Task dashboards show STATUS, not productivity scores or rankings. A dismissal
  cannot rest on a metric the worker never saw (LRA procedural fairness).

- Photo EXIF: strip location UNLESS the photo attaches to a work record that
  already captures location with the worker's knowledge. Retaining it silently
  rebuilds the tracking ADR-0010 refused, through a feature nobody called tracking.

## Fuel & the diesel refund (see legal-compliance.md §5.1)

- The diesel refund levies and percentage are REGULATED VALUES. No exceptions:
    rates.lookup(farm.jurisdiction, 'DIESEL_REFUND_PCT_ONLAND', txn.occurredAt)  ✅
    const REFUND_PCT = 1.0                                                       ❌
  The onland percentage moved 80% → 100% on 2026-04-01 and the levies move in
  most February budgets.

- A refund return spanning a rate change applies BOTH rates, PER LITRE, by the
  date that litre was burnt. Never one percentage against a period total. This is
  the same shape as a pay period spanning 1 March and it fails the same way —
  confidently, in the farmer's favour, which is the direction SARS audits.

- SARS / Customs & Excise naming lives ONLY in jurisdictions/za/, per ADR-0006.
  A diesel refund module is a ZA implementation behind a generic interface,
  not a `SarsDieselService` in packages/core.

- Fuel volume is INTEGER MILLILITRES. Fuel unit price is INTEGER TENTHS OF A CENT
  per litre (R21.95/ℓ = 21950). Totals are Money cents, rounded once. No floats,
  same reasoning as money — a litre becomes a rand becomes a refund claim.

- Tank balances are DERIVED from signed transactions, never a stored counter.
  A counter and a ledger will disagree, and the ledger is the one SARS reads.

- A dip variance is a fact about a TANK, never an allegation about a PERSON.
  No employee on a `dip_adjustment`, no employee in a shrinkage report. Identical
  reasoning to the theft `suspect` rule above, and asserted by test in both places.

## Market prices (see legal-compliance.md §5.2)

- Render the number. NEVER a recommendation, signal, score, or "good time to sell".
  Grain futures are financial products under FAIS; we are not an authorised FSP.
  This is a review rejection, not a copy preference. A moving-average crossover
  presented as a signal is advice; a complex chart presented as data is not.

- Every price carries its `asAt` in the visible layout — not a tooltip. A price
  without its date is a liability, because a farmer will act on it.

## Tests

- Table-driven, from the worked examples in legal-compliance.md §2.4.
- Every scenario in docs/01-requirements/user-stories.md US-02x has a test.
- Every case cites its source: a §, a US-, or a Gazette number. A test without a
  source cannot be maintained — in three years nobody knows if the expected value
  is law or a typo.
- Coverage ≥95% here. Higher than anywhere else in the repo, on purpose.
- Never mock our own code. If a test needs a mock of another domain function,
  the boundary is wrong.
