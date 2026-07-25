# Functional Requirements

Numbered catalogue. Every FR is a build target and must have a covering automated test. `P` = priority: **1** = MVP (Phase 1–3), **2** = launch (Phase 4–5), **3** = post-launch (Phase 6+).

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

### Delegation & task management

> Three working roles, one chain: **owner → manager → worker**. The chain governs who may assign work and who may administer whom. It does **not** govern who may see money or health data — those are separate grants, and conflating them is how a manager ends up reading a sick note.

| ID | Requirement | P |
|---|---|---|
| FR-321 | 📶 **Delegation chain**: an owner assigns to managers and workers; a manager assigns to workers; a worker assigns to nobody. Every task records who assigned it and when | 2 |
| FR-322 | **A user may administer only roles strictly below their own.** An owner manages managers and workers; a manager manages workers; nobody creates or elevates a peer or a superior. Only an owner creates another owner | 1 |
| FR-323 | 🇿🇦 **Administering a user account is not administering an employee record.** A manager may add a worker, reset their PIN, and assign them work; a manager may **never** see or edit ID number, banking details, wage rate, or payslips. Those stay owner + bookkeeper | 1 |
| FR-324 | 📶 **To-do list per user**, with day / week / month views across the calendar year. Recurring tasks (weekly dip, monthly meter read) generate instances | 2 |
| FR-325 | 📶 Task carries: title, description, due date, assignee or team, priority, enterprise/camp/block, and completion state with `completed_at` | 2 |
| FR-326 | 📶 **Progress view**: an owner sees task state across managers and workers; a manager sees their own workers. Task **status**, not a productivity score — see the note below | 2 |
| FR-327 | Task templates and seasonal work plans; generate a season's tasks from a template | 3 |

> ⚠️ **FR-326 is a work tracker, not a performance-management system.** It shows what is assigned, what is done, and what is overdue. It does **not** rank workers, compute output scores, or produce a metric that could be used as evidence in a dismissal without the worker ever having seen it. Performance management in South Africa has LRA procedural requirements that a dashboard does not satisfy and must not appear to. See [ADR-0010](../03-architecture/adr/ADR-0010-worker-monitoring.md).

### Worker self-service 🇿🇦

> Farm workers are the least-powerful data subjects in this system and the ones with the least access to their own records. Every requirement here gives a worker something about **themselves**.

| ID | Requirement | P |
|---|---|---|
| FR-328 | 📶 Worker self-view, extending FR-319: own hours, own payslips, own leave balances, own tasks, own captured locations. **Nothing about anyone else** | 2 |
| FR-329 | 📶 **Leave request**: worker applies, manager or owner approves or declines with a reason, balance updates. Works offline and queues | 2 |
| FR-330 | 🇿🇦 **Payslip query**: a worker raises a question against a specific payslip line; it routes to the owner/bookkeeper with the payslip attached, and the thread is retained as a record | 2 |
| FR-331 | 🇿🇦 **Grievance mechanism** (SIZA Social Standard requirement 6): a worker lodges a grievance, **optionally anonymously**, and it is retained with its resolution. Required for the SIZA pack (FR-320) | 2 |
| FR-332 | 🇿🇦 **A grievance is never visible to the person it names.** If a worker grieves about their manager, that manager cannot see it, cannot be notified of it, and cannot infer it from a count. A grievance against the owner routes to a designated alternate recipient | **1** |
| FR-333 | 🇿🇦 **Sick note / medical certificate upload**: worker photographs or uploads a certificate against a sick-leave request. **Health data — POPIA s26.** Restricted to owner + H&S role, encrypted at rest, **never synced to a device** | 2 |
| FR-334 | 🇿🇦 **An approver sees the decision, not the diagnosis.** A manager approving sick leave sees dates, "certificate on file", and the issuing practitioner's registration status — never the certificate image, never the condition | **1** |
| FR-335 | 📶 Document register: contracts, certificates, licences, training records, induction records — per employee, per farm, with expiry and renewal reminders. The document evidence base the SIZA and GlobalGAP packs draw on | 2 |
| FR-336 | Worker acknowledgement of a document (contract, policy, safety briefing), recorded with timestamp and the language it was presented in | 2 |

### Safety 🇿🇦

| ID | Requirement | P |
|---|---|---|
| FR-340 | 📶 **Lone-worker panic alert**: a worker triggers it, and their current location goes to the owner and manager immediately, with escalation if unacknowledged. **Worker-initiated always**; it is the only feature that sends a worker's location without a work record attached, and the worker is the one who sends it | 2 |
| FR-341 | Panic alert queues offline and fires on reconnect, with the original trigger time preserved and clearly shown as delayed | 2 |
| FR-342 | An employer cannot silently disable panic alerting; a change is visible to the worker | 3 |

> **What is deliberately absent from this section: continuous worker location, live staff maps, and geofence alerts on people.** Three independent reasons — a PWA cannot do reliable background geolocation, POPIA minimality is not satisfied when event-stamped location serves the same purpose, and worker surveillance contradicts the SIZA compliance the product sells. Fully argued in [ADR-0010](../03-architecture/adr/ADR-0010-worker-monitoring.md). **Geofences attach to animals and assets, never people.**

### Field reporting & photo evidence 🧪

> Marked 🧪 **experimental**: ships behind a feature flag to pilot farms first (Phase 5), and earns its place or is removed. The capture is easy; whether it survives contact with a farm that has 40 workers and a data cap is the open question.

| ID | Requirement | P |
|---|---|---|
| FR-337 | 📶 **Photo report**: a worker photographs a problem — broken fence, sick animal, blocked pipe, damaged gate — adds a note and a category, and it routes to their manager and the owner as a task. Captured offline, uploaded when there is signal, **never blocking the capture** | 2 |
| FR-338 | 📶 **Completion photo**: a task may require a photo of the finished work to close. The evidence is of the **work**, not the worker | 2 |
| FR-339 | Photo reports feed the GlobalGAP and SIZA evidence base (FR-606…608) — a dated, located, attributed photo of a corrective action is exactly what a control point asks for | 3 |

> ⚠️ **Two constraints on FR-337/338, both easy to get wrong.**
>
> **1. Photograph the work, not the person.** A photo identifying a worker is personal information, and one that incidentally captures colleagues is worse — they never agreed to anything. Capture guidance says *show the fence, not the person who fixed it*, and the completion-photo requirement must never be satisfiable only by photographing a human being.
>
> **2. EXIF is a location channel, and it is the back door into [ADR-0010](../03-architecture/adr/ADR-0010-worker-monitoring.md).** Every phone photo carries GPS coordinates and a timestamp. Retaining them silently would rebuild exactly the worker-location stream we refused, through a feature nobody flagged as tracking. **The rule: location is retained only where the photo attaches to a work record that already captures location with the worker's knowledge, and is stripped otherwise.** Not a preference — the decision that keeps ADR-0010 true in practice rather than only on paper.

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
| FR-412 | 📶 Fuel cost allocated to enterprise, camp, block, or activity from the fuel log — feeds FR-405 cost of production. Capture lives in [FR-5xx Fleet & fuel](#fleet--fuel); this is the money side of it | 2 |

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

### Fleet & fuel

> Diesel is typically the second or third largest cash cost on a South African farm, it is bought in bulk and held on the property, and it is the input most often stolen. It is also the one input that pays a statutory refund back — see [FR-616…619](#fr-6xx--compliance-) and [legal-compliance.md §5.1](../00-business/legal-compliance.md).
>
> **The whole capture path is 📶.** A farmer fills a tractor at a farm tank in a shed with no signal. If dispensing requires a network, the log is fiction and the refund claim fails at audit.

| ID | Requirement | P |
|---|---|---|
| FR-509 | 📶 **Vehicle & machine register**: registration/fleet number, type (tractor, bakkie, truck, harvester, pump, genset), make, model, tank capacity, and whether it is metered by **odometer**, **hour meter**, or **neither**. Extends the equipment register (FR-504) rather than duplicating it | 2 |
| FR-510 | 📶 **Fuel reserve register**: one or more bulk tanks per farm, each with fuel type, capacity, location, and current calculated balance. A farm may have several (main diesel, workshop petrol, remote camp) | 2 |
| FR-511 | 📶 **Record a bulk delivery** into a reserve: supplier, litres, price per litre, invoice reference, photographed delivery note, and the dip/meter reading before and after. This is the *"fuel reserves are filled up"* action and it must be one screen | 2 |
| FR-512 | 📶 **Record a dispense** from a reserve to a vehicle, implement, or activity: litres, meter reading (odometer km or engine hours), operator, and destination — vehicle *and* the enterprise/camp/block the work was for. Litres and meter reading are the only two mandatory fields | 2 |
| FR-513 | 📶 **Record a direct purchase** — fuel bought at a filling station straight into a vehicle, never touching a reserve. Same record, no tank movement | 2 |
| FR-514 | 📶 **Running tank balance**, computed from deliveries minus dispenses, shown on the tile. Low-reserve warning at a per-tank threshold | 2 |
| FR-515 | 📶 **Dip / stock-take reconciliation**: enter a measured tank reading, system computes variance against the calculated balance, and the variance is recorded as an event with a reason. **Variance is recorded against the tank, never against a named person** — the same rule as FR-603. A shrinkage report that names an employee is an accusation, and it carries the identical defamation and POPIA s26 exposure | 2 |
| FR-516 | 📶 Consumption metrics per vehicle: ℓ/100km, ℓ/engine-hour, ℓ/hectare worked; trend against that vehicle's own history. A machine drifting off its own baseline is the signal — a leak, a worn injector, or a siphon | 3 |
| FR-517 | 📶 Fuel attributed to enterprise, camp, block, or activity at the moment of dispensing, so cost-of-production (FR-405) and the eligible/non-eligible split (FR-616) both fall out of one capture, not a reconstruction at year end | 2 |
| FR-518 | Fuel and fleet costs flow to the expense ledger (FR-402) without re-keying; a delivery is an expense and a dispense is an allocation | 2 |

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
| FR-616 | 🇿🇦 **SARS diesel refund logbook** (Customs & Excise Act 91 of 1964, Schedule 6 Part 3, Note 6): every litre classified **eligible** or **non-eligible** at capture, with the activity, the vehicle, and the meter reading that substantiates it. Distillate fuel used on a public road is not eligible; a farm that also does contract haulage must separate the two, and the separation must exist in the record, not in an explanation | 2 |
| FR-617 | 🇿🇦 **Diesel refund return generation** for a tax period: eligible litres, non-eligible litres, the refundable amount, and the supporting logbook as an annexure. Farmer submits; we generate. **We never file on their behalf** | 2 |
| FR-618 | 🇿🇦 **Five-year retention hold** on fuel records, from date of use or date of the refund return, whichever is later. Longer than the BCEA 3-year hold and it overrides a deletion request the same way (see [legal-compliance.md §1.6](../00-business/legal-compliance.md)) | 2 |
| FR-619 | 🇿🇦 Diesel refund percentages and levy rates resolve from `regulatory_rates` by `occurred_at` — **never a constant**. The onland farming percentage moved from 80% to 100% on 1 April 2026 and the levies change most February budgets. A return spanning a change must apply both rates to their own litres, exactly as a pay period spanning 1 March applies both wages | 2 |

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
| FR-806 | 📶 **Scheduled husbandry alerts**: vaccination and booster due, dip interval, dosing, pregnancy test due, calving/lambing window, weaning age, withdrawal expiry. Derived from the animal's own event history plus the protocol, **computed on the device** | 2 |
| FR-807 | 📶 **The alert engine runs locally, not as a server cron.** An alert that needs a network to fire is useless to a farmer in a dead zone, which is the farmer most likely to miss a booster. Server-side scheduling is a *second* channel for the same alert, never the only one | 2 |
| FR-808 | 📶 Vaccination protocol per herd/species: product, interval, booster offset, age triggers. Seeded with sensible SA defaults, editable per farm | 2 |
| FR-809 | 📶 Operational alerts: task overdue, document/licence expiring, low inventory (FR-503), low fuel reserve (FR-514), stock-take due | 2 |
| FR-810 | Alert acknowledgement and snooze, per user, retained — so "nobody told me" is answerable | 3 |

> **FR-806 due-dates obey the `occurred_at` rule.** A booster is due relative to *when the first dose was given on the farm*, not when the row synced. A device that was offline for three weeks computes the same due date as one that was not, because both read the same `occurred_at`.

---

## FR-9xx · Market & input prices

> **What this is.** A read-only board of the prices that decide whether a farming year worked: what the farmer sells (SAFEX grain, carcass classes, weaners) and what they buy (diesel). It exists so that a decision to sell, hold, or fill the tank is made against a number rather than a rumour at the co-op.
>
> **What this is not.** It is not a marketplace and it is not advice. See the boundary note below — both limits are deliberate and both are load-bearing.
>
> **Every requirement here is 🔒 online-only by nature and every one must degrade to a cached last-known value.** Price data is the one thing in this product that genuinely cannot be produced offline, which makes FR-904 the requirement that keeps the rest honest.

| ID | Requirement | P |
|---|---|---|
| FR-901 | 🔒 **Fuel price card**: current DMRE/DMPR pump price for diesel (0.05% and 0.005%) and petrol, by coastal/inland pricing zone, with the movement since last adjustment. Official, monthly, government-published — the one feed with no licensing question | 3 |
| FR-902 | 🔒 **SAFEX grain prices**: white maize, yellow maize, wheat, soybeans, sunflower — spot/nearby contract, movement, and the contract month. **Subject to a JSE market data agreement** ([ADR-0009](../03-architecture/adr/ADR-0009-market-data-feeds.md)) | 3 |
| FR-903 | 🔒 **Red meat prices**: beef and mutton carcass classes (A2/A3, B2/B3, C2/C3), weaner calf and feeder lamb, weekly. **Subject to a source agreement** with RMAA/AMT — this data is published weekly in arrears and the dashboard must say so | 3 |
| FR-904 | 📶 **Last-known value with an explicit "as at" timestamp on every price, always visible — not on hover, not in a tooltip.** A stale price presented as current is worse than no price, because a farmer will act on it. Offline shows the cached value, greyed, with its age in days | 3 |
| FR-905 | **Data only. No recommendation, no signal, no "good time to sell".** Rendering a price is publishing information; suggesting a course of action on a financial instrument is advice under FAIS and we are not an authorised FSP. This is a code-review rejection criterion, not a copy guideline. See [legal-compliance.md §5.2](../00-business/legal-compliance.md) | 3 |
| FR-906 | The board shows only what this farm actually farms, derived from `farm.enterprise_types` — the same rule as the home grid (FR-017). A sheep farmer does not need a soybean contract | 3 |
| FR-907 | Price alert: notify when a watched commodity crosses a farmer-set threshold. The alert states the price and nothing else (FR-905 applies to notifications too) | 3 |
| FR-908 | Every price series carries its **source, licence, and update cadence** in the UI, and the attribution the source contractually requires | 3 |

**Boundary — read this before extending the section.** The roadmap deliberately excludes marketplaces and auctions; SwiftVEE has the liquidity and we would lose. A price board is on the correct side of that line because it moves information, not livestock or money. It stops being on the correct side the moment it lets someone place, accept, or broker an order. If a feature request starts with "and then they could just sell it from here", the answer is the integration in Phase 6, not this section.

---

## Traceability

Every FR maps to ≥1 user story and ≥1 automated test. The matrix is **generated** — `pnpm test:trace` fails CI if a P1 or P2 FR has no covering test. See [testing-strategy.md](../04-delivery/testing-strategy.md).

**Count:** 174 FRs. P1: 70 · P2: 75 · P3: 29.

**Jurisdiction note.** Every FR marked 🇿🇦 is South African law and lives behind a jurisdiction interface ([ADR-0006](../03-architecture/adr/ADR-0006-multi-jurisdiction.md)). v1 registers exactly one implementation, `ZA`. **Do not implement a second jurisdiction speculatively** — a guessed `NA` makes tests pass against fiction and calcifies the abstraction around a country nobody has researched.
