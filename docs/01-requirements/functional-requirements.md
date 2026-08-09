# Functional Requirements

Numbered catalogue. Every FR is a build target and must have a covering automated test. `P` =
priority: **1** = MVP, **2** = launch, **3** = post-launch. Priority is a product commitment, not a
phase number; the authoritative build sequence is the delivery roadmap.

Legend: 📶 = must work fully offline · 🔒 = server-authoritative (online only) · 🇿🇦 = South-Africa-specific differentiator

---

## FR-0xx · Platform & Onboarding

| ID | Requirement | P |
|---|---|---|
| FR-001 | Register a farm business with name, registration number (optional), contact, and physical address | 1 |
| FR-002 | 🇿🇦 Select one or more enterprise types at onboarding; UI, navigation, terminology, dashboards, and compliance obligations adapt at runtime | 1 |
| FR-003 | Add/remove enterprise types at any time, additively and reversibly, with no migration and no data loss | 1 |
| FR-004 | Create multiple farms under one business; switch active farm without re-login | 1 |
| FR-005 | Invite users by email or phone; assign per-farm role | 1 |
| FR-006 | 📶 Authenticate; session persists offline for a configurable window (default 30 days) | 1 |
| FR-006a | Google OpenID Connect is the primary connected sign-in. Provider/session refresh credentials remain server-side or in an HttpOnly host cookie; no session credential is stored in localStorage/IndexedDB/SQLite. Passkey remains the phishing-resistant alternative and step-up path. See [ADR-0011](../03-architecture/adr/ADR-0011-google-first-bff-authentication.md) | 1 |
| FR-007 | 📶 Install as a PWA from the browser with an install prompt at the right moment (not on first paint) | 1 |
| FR-008 | Switch language between English and Afrikaans per user | 1 |
| FR-016 | **Light / dark / match-my-phone theme, per user.** Default **light**; does NOT follow `prefers-color-scheme` unless chosen — a dark surface under midday sun is a mirror | 1 |
| FR-017 | 🇿🇦 **Home is a grid of ≥96px tiles, generated from `farm.enterprise_types`.** Fixed order, never personalised. Each tile carries one live number or one attention badge | 1 |
| FR-018 | Farm carries a `jurisdiction` (ISO 3166-1 alpha-2), locked to `ZA` in v1 by a CHECK constraint. No country selector in the UI | 1 |
| FR-019 | Every regulated lookup resolves by `(jurisdiction, code, occurred_at)`. Jurisdiction comes from the **farm**, never the user or the browser | 1 |
| FR-009 | 📶 See sync status persistently and non-modally: synced / N pending / syncing / error | 1 |
| FR-010 | 📶 Guided first-run: create the first camp/block, first animal/planting, first employee | 1 |
| FR-011 | Time-limited, resource-scoped external access grant (vet, auditor) with automatic expiry | 2 |
| FR-012 | Self-service full data export (CSV + JSON), delivered by expiring signed link within 24h | 2 |
| FR-013 | Import from CSV with column mapping; named importers for BenguFarm, Farmbrite, Logix, generic Excel | 2 |
| FR-014 | **Two-factor authentication — mandatory for `owner` and `bookkeeper`, optional for `manager`.** Passkey (WebAuthn) preferred; **TOTP** the universal fallback. **SMS is never a second factor** — SIM swap is industrialised in SA, and SMS is the one factor that fails with no signal. See [ADR-0007](../03-architecture/adr/ADR-0007-authentication.md) | **1** |
| FR-014a | Recovery codes: 10, single-use, argon2id-hashed, shown once, printable. Copy says *put them in the safe*, not *screenshot them* | **1** |
| FR-014b | Support-channel 2FA reset: identity verification + **48-hour delay** + email to every farm admin. The delay is the control — an instant reset makes 2FA decorative | 2 |
| FR-014c | Register and revoke multiple passkeys per user, labelled by device | 2 |
| FR-015 | 📶 Global search across animals, blocks, employees, events by tag, name, or ID | 2 |

---

## FR-1xx · Livestock

### Core records

| ID | Requirement | P |
|---|---|---|
| FR-101 | 📶 Create an individual animal: species, breed, sex, DOB, visual tag, EID, dam, sire, source, photo | 1 |
| FR-102 | 📶 Create a group/mob/flock and manage animals as a group without individual records | 1 |
| FR-103 | 📶 Move animals between groups and camps; full movement history retained | 1 |
| FR-104 | 📶 Record a birth (calving/lambing/kidding/farrowing) with ease score, birth weight, dam, and multiples | 1 |
| FR-105 | 📶 Record a death with cause; animal transitions to `dead`, retained forever, excluded from live counts | 1 |
| FR-106 | 📶 Record a sale or purchase with counterparty, price, and weight | 1 |
| FR-107 | 📶 Species-specific attributes via validated JSONB (`horn_status` for cattle; `wool_class` for sheep) | 1 |
| FR-108 | 📶 Attach photos to any animal; stored locally, uploaded on sync, never blocking | 1 |
| FR-109 | 📶 Multiple identifiers per animal: visual tag, EID, brand, tattoo, national ID; unique per farm per type | 1 |
| FR-110 | 📶 Pedigree: sire/dam links, ancestor tree, automatic breed-percentage calculation | 2 |
| FR-111 | 📶 Record weaning with weight and age | 1 |
| FR-112 | 📶 Batch operations: apply an event to a selected group in one action | 1 |
| FR-113 | 📶 Every event is scoped to the herd it concerns — the enterprise/species (cattle, sheep, pigs, poultry) or the specific animal/mob it applies to — so a mixed farm files and filters events by the right herd. Capture requires a herd/species selection when the event is not already tied to one animal | 1 |

### Breeding

| ID | Requirement | P |
|---|---|---|
| FR-120 | 📶 Record mating/service: natural or AI, sire, date, or a bull-in/bull-out period | 1 |
| FR-121 | 📶 Record pregnancy diagnosis with method and result; system projects due date from species gestation | 1 |
| FR-122 | 📶 Breeding season/campaign grouping with conception rate, calving %, and calving spread | 2 |
| FR-123 | 📶 Reminders: expected calving, pregnancy test due, weaning due | 2 |
| FR-124 | Import EBVs/genetics from SA Stud Book (Logix) and BREEDPLAN | 3 |

### Health

| ID | Requirement | P |
|---|---|---|
| FR-130 | 📶 Record a treatment: product, batch, dose, route, administered by, reason | 1 |
| FR-131 | 📶 **Automatic withdrawal period**: from product reference data, compute and display meat/milk withdrawal; block or hard-warn on sale/slaughter within it | 1 |
| FR-132 | 📶 Record a vaccination against a programme; show which animals are due/overdue | 1 |
| FR-133 | 📶 🇿🇦 Record dip/tick treatment (required in controlled areas) | 1 |
| FR-134 | 📶 Record an injury or condition with observations, treatment plan, and outcome | 2 |
| FR-135 | 📶 🇿🇦 Flag a notifiable disease from the reference list; prompt the reporting obligation with the state vet contact; do **not** report on the farmer's behalf | 2 |
| FR-136 | 📶 Medicine inventory: stock on hand, batch, expiry; treatments decrement; expiry warnings | 2 |
| FR-137 | Vet read-only access to treatment history for a scoped herd, time-limited | 2 |

### Weights & performance

| ID | Requirement | P |
|---|---|---|
| FR-140 | 📶 Record a weight against an animal or a group | 1 |
| FR-141 | 📶 Compute ADG between any two weights; chart the curve | 1 |
| FR-142 | 📶 Weigh session: sequential capture optimised for the crush — one animal per screen, one thumb, no scrolling | 1 |
| FR-143 | Bluetooth EID reader and scale-head integration via Web Bluetooth, with manual fallback always present | 3 |
| FR-144 | 📶 Project sale weight and date from current ADG | 3 |

### Grazing & feed

| ID | Requirement | P |
|---|---|---|
| FR-150 | 📶 Define camps with GPS boundaries, hectares, and carrying capacity | 1 |
| FR-151 | 📶 Move a mob to a camp; system records grazing days, stocking rate, and rest days | 1 |
| FR-152 | 📶 Camp rest-period tracking; warn on premature return | 2 |
| FR-153 | 📶 Record feed put out per camp/group; deduct from feed inventory; cost to enterprise | 2 |
| FR-154 | 📶 Grazing plan: forward rotation schedule | 3 |

---

## FR-2xx · Crops

| ID | Requirement | P |
|---|---|---|
| FR-201 | 📶 Define a block: GPS boundary, hectares, soil type, irrigation type | 1 |
| FR-202 | 📶 Split a block into sub-blocks without losing history | 2 |
| FR-203 | 📶 Record a planting: crop, cultivar, date, density, seed source, expected harvest | 1 |
| FR-204 | 📶 🇿🇦 Record a spray to GlobalGAP standard: **registered product, active ingredient(s)**, rate, water volume, operator, equipment, weather at application, target pest | 1 |
| FR-205 | 📶 🇿🇦 **Block harvest within the pre-harvest interval at the point of capture.** Override requires a written reason and is audited. Catching this at audit time is too late — the fruit is already rejected | 1 |
| FR-206 | 📶 Record fertiliser application including fertigation | 1 |
| FR-207 | 📶 Record a harvest: quantity, grade, destination, date | 1 |
| FR-208 | 📶 Capture soil/leaf/fruit analysis results | 2 |
| FR-209 | 📶 Pest/disease scouting with GPS, photo, severity | 2 |
| FR-210 | 📶 Crop rotation history per block; warn on rotation-rule violation | 2 |
| FR-211 | 🇿🇦 Auditor-ready spray history report per block, per season | 1 |
| FR-212 | Weather integration: current, forecast, rainfall record per farm | 2 |
| FR-213 | 📶 Manual rainfall capture per rain gauge: how much (mm) and when. Modelled as a farm/land-scoped `rainfall` event (not animal-scoped), so grazing and cropping both read it. Cross-cutting — relevant to livestock too | 1 |
| FR-214 | Packhouse intake-to-dispatch tracking with traceability to block | 3 |
| FR-215 | Satellite/NDVI block health imagery | 3 |
| FR-216 | 📶 Irrigation event record with volume | 2 |

---

## FR-3xx · Labour & Wages 🇿🇦

> This module is the wedge. See [legal-compliance.md §2](../00-business/legal-compliance.md) before writing any of it. **Every rate is looked up by date. No exceptions.**

| ID | Requirement | P |
|---|---|---|
| FR-301 | Employee record: name, ID number (encrypted, masked), job title, start date, contract type, wage rate, banking | 1 |
| FR-302 | 🇿🇦 Generate BCEA s29 written particulars of employment, in the employee's language | 1 |
| FR-303 | 📶 Record attendance: start/end, worker PIN, optional GPS. **No biometrics in v1** — see legal-compliance §1.3 | 1 |
| FR-304 | 📶 Record piece work: units, rate, worker, block/camp | 1 |
| FR-305 | 📶 Assign a task to a worker or team; worker marks complete; time attributed to enterprise | 2 |
| FR-306 | 🇿🇦 **Payroll run**: 🔒 ordinary/overtime/Sunday/public-holiday classification, piece-rate top-up to the minimum floor, capped deductions, UIF — all resolved against the rates in force **on the date the work was done** | 1 |
| FR-307 | 🇿🇦 **Compliance warnings surfaced before approval**, never after: overtime over the 10h cap, deduction capped, piece rate topped up, net below floor | 1 |
| FR-308 | 🇿🇦 Generate a BCEA s33-compliant payslip in the employee's language | 1 |
| FR-309 | 🇿🇦 **BCEA s31 record**: name, occupation, time worked, remuneration — one button, 3-year retention, inspector-ready | 1 |
| FR-310 | Leave: annual (21 days / 1 per 17 worked), sick (30 per 36 months), family responsibility (3), maternity (4 months); accrual, balance, application, approval | 2 |
| FR-311 | Seasonal worker onboarding: bulk add, short-form contract, end-date | 1 |
| FR-312 | UIF declaration export | 2 |
| FR-313 | SARS-compatible payroll export | 2 |
| FR-314 | Labour cost allocated to enterprise, camp, or block from attendance and task records | 1 |
| FR-315 | Team management: group workers; assign and pay by team | 2 |
| FR-316 | Bank payment file export (EFT batch) | 2 |
| FR-317 | 🇿🇦 Injury-on-duty register; **health data restricted** to owner + H&S role | 2 |
| FR-318 | 🇿🇦 Age verification at hire; block under-15; flag 15–17 for restricted-work rules | 1 |
| FR-319 | 📶 Worker self-view: own hours, own payslips. Nothing else. | 3 |
| FR-320 | 🇿🇦 **SIZA social evidence pack** generated from labour records | 2 |

---

## FR-4xx · Finance

| ID | Requirement | P |
|---|---|---|
| FR-401 | 📶 Record income against an enterprise | 1 |
| FR-402 | 📶 Record an expense against an enterprise, camp, or block; attach a photographed receipt | 1 |
| FR-403 | Chart of accounts, farm-appropriate, with sensible SA defaults | 1 |
| FR-404 | P&L per enterprise for any period | 1 |
| FR-405 | Cost of production per unit (per kg beef, per tonne maize, per carton fruit) | 2 |
| FR-406 | Budget per enterprise; actual vs budget | 2 |
| FR-407 | Livestock gross margin: opening + births + purchases − deaths − sales = closing, valued | 2 |
| FR-408 | Invoice generation, branded | 2 |
| FR-409 | Export to accounting software (Xero/Sage/QuickBooks CSV) | 2 |
| FR-410 | Livestock inventory reconciliation and valuation | 2 |
| FR-411 | Cash flow forecast from budget and known commitments | 3 |
| FR-412 | 📶 Fuel/diesel usage per vehicle and enterprise (diesel rebate matters here) | 2 |

---

## FR-5xx · Inventory & Assets

| ID | Requirement | P |
|---|---|---|
| FR-501 | 📶 Input inventory: chemicals, fertiliser, feed, medicine — stock, batch, expiry, location | 1 |
| FR-502 | 📶 Inventory auto-decrements on use (spray, treatment, feed) | 1 |
| FR-503 | 📶 Low-stock and expiry warnings | 2 |
| FR-504 | 📶 Equipment register: make, model, serial, purchase, value | 2 |
| FR-505 | 📶 Maintenance schedule by hours or date; due/overdue | 2 |
| FR-506 | 📶 Equipment check-out with GPS | 3 |
| FR-507 | 📶 Stock take with variance report | 2 |
| FR-508 | 🇿🇦 Chemical reference data: registered product, registration number, actives, PHI, re-entry interval — versioned, synced from a maintained source | 1 |

---

## FR-6xx · Compliance 🇿🇦

> Every requirement here is a differentiator no global competitor has. See [legal-compliance.md](../00-business/legal-compliance.md).

| ID | Requirement | P |
|---|---|---|
| FR-601 | 🇿🇦 **Branding register** (Animal Identification Act 6 of 2002): registered mark (≤3 chars), certificate reference, mark type, body position | 1 |
| FR-602 | 🇿🇦 Link every animal to its mark; flag animals unmarked past the prescribed window after acquisition | 1 |
| FR-603 | 🇿🇦 **Stock theft evidence pack**: one action → PDF with identification, ownership chain, brand certificate, last-seen GPS + timestamp, movement history, treatment history, SAPS case number field. **Facts only — no "suspect" field** (defamation + POPIA s26 exposure) | 1 |
| FR-604 | 🇿🇦 Removal certificate for stock moving off-property | 2 |
| FR-605 | 🇿🇦 Mark an animal missing; timestamped, GPS-anchored | 1 |
| FR-606 | 🇿🇦 GlobalGAP IFA checklist engine: control points mapped to existing evidence, completeness %, non-conformances with owner and due date | 2 |
| FR-607 | 🇿🇦 SIZA checklist engine, drawing on the labour module | 2 |
| FR-608 | 🇿🇦 One-click auditor evidence pack per standard | 2 |
| FR-609 | 🇿🇦 **Compliance obligations register**: what this farm owes, when, and whether the evidence exists | 2 |
| FR-610 | 🇿🇦 Notifiable disease reference list, versioned | 2 |
| FR-611 | 🇿🇦 Movement permit record for controlled areas | 3 |
| FR-612 | Full traceability: from a harvested carton or a carcass back to block/animal, input, and operator | 2 |
| FR-613 | 🇿🇦 QR ownership verification: scan → verify ownership and missing status | 3 |
| FR-614 | 🇿🇦 **`regulatory_rates` table**: every regulated value with `effective_from`/`effective_to`, looked up by event date | 1 |
| FR-615 | 🇿🇦 Admin UI for updating regulatory rates without a deploy | 2 |

---

## FR-7xx · Reporting & Analytics

| ID | Requirement | P |
|---|---|---|
| FR-701 | 📶 Role-appropriate dashboard: owner sees money, manager sees today's work, worker sees their tasks | 1 |
| FR-702 | 📶 Enterprise-type-appropriate widgets | 1 |
| FR-703 | Report library: statutory, operational, financial | 1 |
| FR-704 | Export any report to PDF and CSV | 1 |
| FR-705 | 📶 Herd/flock summary: counts by class, age, camp | 1 |
| FR-706 | Reproduction report: conception, calving %, calving spread, weaning % | 2 |
| FR-707 | 📶 Growth report: ADG by group, cohort comparison | 2 |
| FR-708 | Yield report per block, per cultivar, per season | 2 |
| FR-709 | Labour cost per enterprise, per hectare, per head | 2 |
| FR-710 | Custom date range on every report | 1 |
| FR-711 | Scheduled report email | 3 |
| FR-712 | Opt-in anonymised peer benchmarking | 3 |

---

## FR-8xx · Notifications

| ID | Requirement | P |
|---|---|---|
| FR-801 | 📶 In-app task/alert list, works offline | 1 |
| FR-802 | Web push for time-critical items (withdrawal expiry, calving due, overdue task) | 2 |
| FR-803 | Per-user, per-category notification preferences | 2 |
| FR-804 | Email digest | 3 |
| FR-805 | 🇿🇦 SMS fallback for users without smartphones | 3 |

---

## Traceability

Every FR maps to ≥1 user story and ≥1 automated test. `pnpm test:trace` (`scripts/test-trace.mjs`) reports which FRs are named by a test title.

> **⚠️ It does NOT fail CI, and this line used to claim it did.** It is report-only and exits 0; `--strict` makes it exit 1, and nothing in CI passes `--strict`. It also measures only whether a test *names* an FR, not whether it exercises one. Baseline at the end of Phase 2 is 40 of 146 — mostly phases 3–7, which are unbuilt. See [testing-strategy.md](../04-delivery/testing-strategy.md).

**Count:** 125 FRs. P1: 66 · P2: 43 · P3: 16.

**Jurisdiction note.** Every FR marked 🇿🇦 is South African law and lives behind a jurisdiction interface ([ADR-0006](../03-architecture/adr/ADR-0006-multi-jurisdiction.md)). v1 registers exactly one implementation, `ZA`. **Do not implement a second jurisdiction speculatively** — a guessed `NA` makes tests pass against fiction and calcifies the abstraction around a country nobody has researched.
