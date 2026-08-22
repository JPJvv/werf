# User Stories & Acceptance Criteria

Format: `US-xxx` · story · acceptance criteria in Gherkin · linked FRs.

**These ACs are the test specifications.** Claude Code should be able to write a passing test from an AC without asking a question. Where an AC is ambiguous, that is a defect in this document — fix the AC, then write the test.

This is not the full backlog (118 FRs → ~140 stories). It is the **hard, load-bearing, or easily-got-wrong** ones, specified to the depth that makes them buildable unattended. The routine CRUD stories follow the same pattern and are generated per phase.

---

## Epic: Onboarding & enterprise adaptation

### US-001 · Select farming type at onboarding

> **As a** new farm owner
> **I want** to tell Werf what kind of farming I do
> **So that** I only see the parts of the system that apply to me

**FRs:** FR-002, FR-003

```gherkin
Scenario: Livestock-only farm never sees crop features
  Given I am registering a new farm business
  When I select enterprise type "Beef cattle" and no crop types
  And I complete onboarding
  Then the navigation contains "Livestock", "Camps", "Labour", "Finance", "Compliance"
  And the navigation does NOT contain "Blocks", "Sprays", "Harvest"
  And the dashboard shows livestock widgets only
  And the term "camp" is used, not "block"

Scenario: Mixed farm sees both
  Given I am registering a new farm business
  When I select "Beef cattle" and "Row crops"
  Then the navigation contains both "Camps" and "Blocks"
  And the dashboard shows a per-enterprise profitability widget

Scenario: Adding an enterprise later is additive and lossless
  Given my farm has enterprise type "Beef cattle" with 400 animals and 2 years of history
  When I add enterprise type "Row crops"
  Then crop navigation appears immediately
  And all 400 animals and their full history remain intact and unchanged
  And no data migration is required
  And no re-onboarding is required

Scenario: Removing an enterprise hides but never deletes
  Given my farm has "Row crops" with 3 plantings recorded
  When I remove enterprise type "Row crops"
  Then crop navigation disappears
  And the 3 plantings still exist in the database
  And re-adding "Row crops" restores full access to them
```

---

## Epic: Offline capture

### US-010 · Record a calving in a camp with no signal

> **As a** farm manager
> **I want** to record a calving while standing in the camp with no signal
> **So that** I don't have to remember it until I get back to the house

**FRs:** FR-104, FR-101, SRS-5, SRS-6, NFR-101, NFR-007

```gherkin
Scenario: Full offline capture
  Given the device has no network connection
  And I am logged in with a valid offline session
  When I record a calving with dam "COW-0142", calf sex "female",
       birth weight 34kg, ease score 1, occurred 2 hours ago
  Then the calf appears in the herd list immediately
  And the dam's calving history shows the event
  And the sync indicator shows "1 pending"
  And no error is shown
  And the write commits in under 50ms

Scenario: Durability across app restart
  Given I recorded a calving offline
  When I close the browser completely
  And I reopen the app, still offline
  Then the calving is still there
  And the sync indicator still shows "1 pending"

Scenario: Durability across device reboot
  Given I recorded a calving offline
  When the device reboots
  And I reopen the app, still offline
  Then the calving is still there

Scenario: Sync on reconnection
  Given I have 1 pending calving
  When the device regains connectivity
  Then the record syncs within 30 seconds
  And the indicator shows "synced"
  And the record is visible to the owner on another device within 60 seconds

Scenario: occurred_at is preserved across a long offline period
  Given I recorded a calving offline with occurred_at = 2026-03-01T06:00:00+02:00
  And the device stays offline for 7 days
  When the device syncs on 2026-03-08
  Then the stored occurred_at is 2026-03-01T04:00:00Z
  And created_at reflects 2026-03-01 (when I wrote it)
  And synced_at reflects 2026-03-08
  And the calving reports for March show it on 1 March, not 8 March
```

> The last scenario is the one everybody gets wrong. Three timestamps, three meanings, and the report must use the right one.

---

## Epic: Wages 🇿🇦

### US-020 · Piece work must not fall below the minimum wage

> **As a** farm owner
> **I want** the system to stop me paying below the minimum wage on piece rates
> **So that** I don't end up at the CCMA

**FRs:** FR-306, FR-307, FR-304 · **See:** [legal-compliance.md §2.4](../00-business/legal-compliance.md)

```gherkin
Background:
  Given regulatory_rates contains NMW_FARM = 30.23 effective from 2026-03-01
  And regulatory_rates contains NMW_FARM = 28.79 effective 2025-03-01 to 2026-02-28

Scenario: Piece rate below the floor is topped up, visibly
  Given employee "Thabo" worked 8 hours on 2026-03-15
  And he picked 40 crates at a piece rate of R4.00 per crate
  When I run payroll for March 2026
  Then his piece earnings are R160.00
  And the minimum for 8 hours is R241.84
  And a top-up line of R81.84 appears on the payslip
  And gross pay is R241.84
  And a compliance warning "Piece rate below minimum wage — topped up" is shown BEFORE I approve

Scenario: Piece rate above the floor is paid as earned
  Given employee "Thabo" worked 8 hours on 2026-03-15
  And he picked 80 crates at R4.00 per crate
  When I run payroll for March 2026
  Then gross pay is R320.00
  And no top-up line appears
  And no compliance warning is raised

Scenario: The rate is resolved by the date worked, not today
  Given today is 2026-07-17
  And employee "Thabo" worked 8 hours on 2026-02-15
  When I run a correction payroll for February 2026
  Then the minimum applied is R28.79/hour, not R30.23
  And the minimum for 8 hours is R230.32

Scenario: A period spanning the annual increase uses both rates
  Given employee "Thabo" worked 8 hours on 2026-02-27
  And employee "Thabo" worked 8 hours on 2026-03-02
  When I run payroll for the period 2026-02-25 to 2026-03-05
  Then the 27 February shift is valued at R28.79/hour
  And the 2 March shift is valued at R30.23/hour
  And the payslip shows both rates as separate lines
```

> The last scenario is why the lookup is per-shift, not per-payroll-run. A weekly pay cycle straddles 1 March every single year.

### US-021 · Deduction caps

**FRs:** FR-306, FR-307

```gherkin
Scenario: Accommodation deduction capped at 10%
  Given employee "Sipho" has gross pay of R5,000.00 for March 2026
  And an accommodation deduction of R800.00 is configured
  When I run payroll
  Then the accommodation deduction applied is R500.00
  And a warning "Accommodation deduction capped at 10% of wage" is shown before approval

Scenario: Combined deductions cannot push net below the floor
  Given employee "Sipho" has gross pay of R5,000.00
  And accommodation R500 and food R500 and a garnishee of R4,200 are configured
  When I run payroll
  Then the payroll run is REJECTED with "Deductions would reduce net pay below the statutory minimum"
  And no payslip is generated
  And the deductions are NOT silently clamped
```

> ⚠️ **SUPERSEDED FOR PHASE 5 (ADR-0014, owner decision 2026-08-22): payroll is ADVISORY, not
> blocking.** Under ADR-0014 this case is a conspicuous must-acknowledge WARNING shown before
> approval and the run is STILL generated — not rejected. The deductions are still not silently
> clamped, and the calculation is unchanged. This scenario is rewritten to the advisory behaviour in
> Phase 5 sub-phase 5e, after the external labour-law review (5i). See
> `docs/03-architecture/adr/ADR-0014-advisory-payroll.md`.

> Rejecting is correct here. Silently clamping a garnishee produces a wrong payslip and a legal problem downstream. Make the human decide.

### US-022 · Overtime cap

```gherkin
Scenario: Overtime beyond the cap is paid AND flagged
  Given employee "Maria" worked 45 ordinary hours plus 14 overtime hours in the week of 2026-03-09
  When I run payroll
  Then all 14 overtime hours are paid at 1.5×
  And a compliance warning "Overtime exceeded the 10 hour weekly limit by 4 hours" is shown
  And the payroll run is NOT blocked
```

> Note the asymmetry with US-021. Excess overtime is the *employer's* violation of the BCEA hours limit — but the worker still worked those hours and must be paid. Never withhold pay to enforce a rule against the employer. Pay, then flag.

### US-023 · The inspector at the gate

> **As a** farm owner facing an unannounced labour inspection
> **I want** to produce my employment records immediately
> **So that** the inspection ends well

**FRs:** FR-309

```gherkin
Scenario: One button, inspector-ready
  Given my farm has 23 employees with 18 months of attendance and payroll history
  When I generate the "BCEA Employment Records" report for the last 3 years
  Then a PDF is produced within 30 seconds
  And it contains, for every employee: name, occupation, time worked, remuneration paid
  And employees under 18 show their date of birth
  And former employees within the 3-year retention window are included
  And the report is available in English and Afrikaans
```

---

## Epic: Compliance 🇿🇦

### US-030 · Pre-harvest interval enforcement

> **As a** table-grape farmer
> **I want** to be stopped from harvesting inside the withholding period
> **So that** my export container isn't rejected

**FRs:** FR-205, FR-204, FR-508

```gherkin
Scenario: Harvest inside PHI is blocked at capture
  Given block "B12" was sprayed with a product having a 21-day pre-harvest interval on 2026-03-01
  When I try to record a harvest on block "B12" on 2026-03-15
  Then the capture is BLOCKED
  And the message names the product, the spray date, and the earliest safe harvest date of 2026-03-22
  And I cannot proceed without an override

Scenario: Override is possible but expensive
  Given the harvest is blocked by a PHI
  When I choose "Override"
  Then I must select a reason from a list and enter free text
  And the override is recorded in the audit log with my user ID and timestamp
  And the block is flagged on the GlobalGAP checklist as a non-conformance
  And the farm owner is notified

Scenario: Harvest after PHI proceeds normally
  Given block "B12" was sprayed with a 21-day PHI product on 2026-03-01
  When I record a harvest on 2026-03-23
  Then the harvest is recorded with no warning
```

### US-031 · Stock theft evidence pack

> **As a** farmer who has lost cattle
> **I want** a complete evidence pack for the Stock Theft Unit
> **So that** the case can actually be investigated

**FRs:** FR-603, FR-605, FR-601

```gherkin
Scenario: Mark missing, generate pack
  Given 12 cattle are recorded on my farm with brand mark "ABC"
  And each has a photo and a movement history
  When I mark them missing at 2026-04-02 05:30 with GPS at the camp gate
  And I generate a Stock Theft Evidence Pack
  Then a PDF is produced containing, for each animal:
       photo, visual tag, EID, brand mark, distinguishing features
  And it contains the brand registration certificate reference
  And it contains the ownership chain from acquisition to present
  And it contains the last-seen record with GPS and timestamp
  And it contains movement history for the last 12 months
  And it contains treatment history establishing continuous possession
  And it contains an empty field for the SAPS case number
  And it contains NO field for naming a suspect

Scenario: The pack works offline-first
  Given I am in a camp with no signal
  When I mark 12 cattle missing
  Then the missing status is recorded locally with the date I entered
  And an available GPS point is included but never required
  And the evidence pack generation is queued
  And I am told plainly: "Evidence pack will be generated when you have signal"
```

> Generation is server-side because it needs the brand certificate and PDF rendering. Marking missing is local because that is the time-critical fact; GPS is optional supporting detail.

### US-032 · Withdrawal period on sale

**FRs:** FR-131, FR-130

```gherkin
Scenario: Selling inside a farmer-entered meat interval shows a reminder
  Given animal "STR-0088" was treated on 2026-06-01 with a product having a 28-day meat withdrawal
  When I try to record a sale of "STR-0088" on 2026-06-15
  Then Werf shows the treatment date, entered interval, and reminder date of 2026-06-29
  And the farmer can still record the sale

Scenario: The reminder works offline
  Given the device is offline
  And the farmer's product and interval snapshot is stored locally
  When I try to sell "STR-0088" inside the withdrawal period
  Then the reminder appears locally, without a server round trip
  And recording the sale remains available
```

> The reminder is a calculator using the farmer's own inputs. It is not approval and never reports
> the decision elsewhere (ADR-0013).

---

## Epic: Sync & conflict

### US-040 · Two devices record the same event

> **As a** farm owner
> **I want** the system to never silently lose or silently duplicate a record
> **So that** I can trust my herd count

**FRs:** SRS-8, SRS-9

```gherkin
Scenario: Concurrent edits to different fields both survive
  Given animal "COW-0142" is synced to device A and device B
  And both devices go offline
  When device A sets the animal's camp to "Camp 3"
  And device B sets the animal's body condition score to 3.5
  And both devices sync
  Then the animal is in "Camp 3" AND has body condition score 3.5
  And no audit conflict row is written

Scenario: Concurrent edits to the same field resolve by occurred_at, audibly
  Given animal "COW-0142" is synced to device A and device B, both offline
  When device A sets camp to "Camp 3" with occurred_at 09:00
  And device B sets camp to "Camp 5" with occurred_at 11:00
  And both sync (device A syncs second)
  Then the animal is in "Camp 5"
  And an audit row records the conflict, both values, and the resolution rule applied

Scenario: The same real-world birth recorded twice is queued, never merged
  Given the manager records a calving for dam "COW-0142" on device A, offline
  And the herdsman records the same calving for dam "COW-0142" on device B, offline
  When both sync
  Then TWO calf records exist
  And a "Possible duplicate" review item is raised naming both
  And neither is auto-deleted
  And the herd count reflects both until a human resolves it

Scenario: Death always wins over sale
  Given animal "STR-0088" is on device A and device B, both offline
  When device A records a sale at 14:00
  And device B records a death at 10:00
  And both sync
  Then the animal's status is "dead"
  And the sale is flagged for review, not deleted
  And an audit row explains the state-machine resolution
```

> The last one looks like a bug and is not. An animal that died cannot have been sold; the sale record is almost certainly a data-entry error or a different animal. But we don't *know* that — so we resolve the status deterministically and hand the contradiction to a human.

---

## Epic: Field UX

### US-050 · Weigh session in the crush

> **As a** herdsman weighing 200 animals
> **I want** to capture each weight in one tap
> **So that** I'm not the bottleneck at the crush

**FRs:** FR-142, FR-140, NFR-402, NFR-410

```gherkin
Scenario: Sequential capture, one thumb
  Given I start a weigh session for mob "Weaners 2026"
  Then the screen shows ONE animal at a time
  And the numeric entry field is focused with a large numeric keypad
  And "Save & Next" is a full-width button in the bottom third of the screen
  And every touch target is at least 48×48 CSS pixels
  When I enter 218 and tap "Save & Next"
  Then the weight is committed locally in under 50ms
  And the next animal appears with the field focused
  And no scrolling is required at any point

Scenario: The session survives an interruption
  Given I am 47 animals into a 200-animal weigh session
  When the browser is killed
  And I reopen the app
  Then the session offers to resume at animal 48
  And the 47 weights are intact

Scenario: A mis-entry is correctable without leaving the flow
  Given I entered 2180 instead of 218
  When the weight is more than 3 standard deviations from the mob mean
  Then an inline warning appears: "2180kg looks unusual for this mob"
  And I can accept it or correct it without leaving the session
```

> The outlier warning is not validation — a 2180kg animal is possible in principle. It is a nudge at the moment of the mistake, which is the only moment it is cheap to fix.

---

## Epic: Roles & privacy

### US-060 · A worker cannot see the money

**FRs:** SRS-13, FR-005

```gherkin
Scenario: Worker role sees no financial data
  Given I am logged in as a user with role "worker" on farm "Rietfontein"
  Then the navigation contains no "Finance" item
  And a direct URL to /finance returns 403
  And the API returns 403 for any /finance endpoint
  And the local SQLite database on my device contains NO rows from financial tables

Scenario: The three-layer defence actually has three layers
  Given a deliberately permissive PowerSync sync rule is deployed for the animals table
  When a user on farm A syncs
  Then Postgres RLS still prevents rows from farm B reaching them
  And the tenancy test suite FAILS, alerting us to the misconfiguration
```

> That second scenario is a test we write against ourselves. Sync rules and RLS are two separate systems that must agree, and the failure mode is silent cross-tenant leakage. The test makes it loud.

### US-061 · External vet access expires

**FRs:** FR-011, FR-137, SRS-14

```gherkin
Scenario: Scoped, time-limited grant
  Given I grant vet "Dr Nel" access to herd "Bulls" treatment history for 30 days
  Then Dr Nel can view treatment history for animals in "Bulls"
  And Dr Nel cannot view any other herd
  And Dr Nel cannot view financial, labour, or crop data
  And on day 31 the access is revoked automatically
  And Dr Nel's local database is purged of farm data on next connection
```

---

## Story map → phase

| Epic | Phase |
|---|---|
| Platform, auth, sync foundation | 1 |
| Onboarding & enterprise adaptation | 1 |
| Livestock core, offline capture | 2 |
| Crops core | 2 |
| Labour & wages 🇿🇦 | 3 |
| Finance & inventory | 4 |
| Compliance 🇿🇦 | 4 |
| Reporting, import/export, hardening | 5 |
| Integrations | 6 |
| Intelligence | 7 |

Full detail: [roadmap.md](../04-delivery/roadmap.md).
