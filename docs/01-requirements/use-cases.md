# Use Cases

Detailed actor flows for the paths where getting it wrong costs a customer. Routine CRUD is not documented here — it follows the standard pattern in [user-stories.md](user-stories.md).

Format: UC-xxx, with main flow, alternates (A), and exceptions (E).

---

## UC-001 · Onboard a new farm business

**Primary actor:** Farm owner
**Preconditions:** None. This is first contact.
**Postcondition:** A configured farm, an installed PWA, and one real record captured.
**Trigger:** Sign-up.

### Main flow

1. Owner lands on the sign-up page, enters email/phone and password.
2. System sends OTP; owner verifies.
3. System asks for farm business name and province.
4. **System asks: "What do you farm?"** Owner multi-selects from Beef cattle, Dairy, Sheep, Goats, Pigs, Poultry, Game, Row crops, Vegetables, Orchards, Vineyards, Other.
5. System asks farm scale (head count band, hectare band). *Used only to size the sync payload and pick sensible defaults — never to gate features.*
6. System configures modules, navigation, terminology, and dashboard from the selection.
7. System prompts PWA install **with a reason**: "Install Werf so it works without signal."
8. System runs a guided first record: create your first camp → add your first animal (or: create your first block → record your first planting).
9. System shows the dashboard, populated with the one real record just created.

### Alternates

- **A4.1 — Owner selects both livestock and crop types.** System configures both module sets and adds the per-enterprise profitability widget to the dashboard.
- **A4.2 — Owner selects "Other".** System asks for a free-text description, configures a generic module set (animals + blocks + labour + finance), and logs the response for product research. This is a data source, not a dead end.
- **A7.1 — Browser does not support install** (older iOS). System continues without install and shows a one-time note that the app works best installed. Never blocks.
- **A8.1 — Owner skips the guided record.** System shows an empty dashboard with a single clear next action. Skipping is allowed; nagging is not.

### Exceptions

- **E2.1 — OTP not received.** Resend after 60s; fall back to email if phone fails; escalate to support after 3 failures.
- **E4.1 — No enterprise type selected.** Cannot proceed. This is the one hard gate in onboarding, because everything downstream depends on it.

> **Design note.** Step 4 is the highest-leverage moment in the product. Everything after it is shaped by that answer. It must be one screen, plain language ("What do you farm?" not "Select enterprise types"), and impossible to get wrong. Step 3 asking for province before step 4 is deliberate: province drives controlled-area rules for dipping and movement, and asking later feels like an interrogation.

---

## UC-010 · Record a treatment and enforce the withdrawal period

**Primary actor:** Farm manager or herdsman
**Preconditions:** Animal exists; product reference data is synced locally.
**Postcondition:** Treatment recorded; withdrawal period computed and enforced locally.
**Trigger:** An animal needs treating.

### Main flow

1. Actor scans or types the animal's tag, or picks from a mob.
2. System shows the animal with its recent health history.
3. Actor selects "Treat".
4. Actor selects a product from the farm's medicine inventory.
5. **System reads the meat and milk withdrawal periods from the local product reference table.**
6. Actor enters dose, route, and reason. System pre-fills dose from the product's label rate × the animal's last known weight, and the actor confirms or corrects.
7. Actor confirms.
8. System, locally:
   - writes the treatment event with `occurred_at`,
   - computes `meat_clear_date = occurred_at + meat_withdrawal_days`,
   - computes `milk_clear_date = occurred_at + milk_withdrawal_days`,
   - sets a withdrawal flag on the animal,
   - decrements medicine inventory by the dose,
   - queues the write for sync.
9. System confirms in under 50ms and returns to the animal.

### Alternates

- **A4.1 — Product not in inventory.** Actor can add it inline from the chemical reference table. If it is not in the reference table either, allow free-text entry **with a warning that withdrawal cannot be enforced** and a flag on the record. Never block a treatment because our reference data is incomplete — the animal is standing in the crush.
- **A6.1 — No recent weight.** System asks for an estimated weight for dosing, marks it as estimated, and does not store it as a weight record.
- **A8.1 — Group treatment.** Steps 1–7 apply to a selected mob; step 8 writes one event per animal with a shared `batch_id`. Inventory decrements once, by the total.

### Exceptions

- **E5.1 — Product reference data is stale** (older than 30 days). Record the treatment, flag the record `reference_data_stale`, and prompt a sync. Never block.
- **E8.1 — Insufficient inventory.** Warn, allow override with a reason (the physical stock is right there; our count is what's wrong), and flag for stock take.

> **Design note.** Every exception here resolves toward "record it anyway, flag it, move on." The animal does not wait for our data model. A system that blocks a treatment because of a reference-data gap will be abandoned within a week, and correctly so.

---

## UC-020 · Run a monthly payroll 🇿🇦

**Primary actor:** Bookkeeper or owner
**Preconditions:** Attendance captured; employees configured; **online** (this operation is server-authoritative).
**Postcondition:** Approved payroll run; payslips; audit trail; compliance warnings surfaced and dispositioned.
**Trigger:** End of pay period.

### Main flow

1. Actor selects "Run payroll" and a period.
2. **System checks it is online.** If not: "Payroll needs a connection so we can be certain of the current wage rates. Your attendance records are safe." Offer to notify when online.
3. System lists employees with hours captured, and flags any with missing or suspicious attendance.
4. Actor reviews and corrects attendance gaps.
5. Actor confirms.
6. **System calculates, per employee, per shift**, resolving `regulatory_rates` by the **date each shift occurred**:
   - classify ordinary / overtime / Sunday / public holiday hours,
   - value each at the applicable rate and multiplier,
   - add piece work; **top up to the minimum floor if the piece outcome falls short**,
   - add allowances,
   - apply deductions with statutory caps,
   - compute UIF against the ceiling in force,
   - compute net.
7. **System presents a draft with compliance warnings first**, above the numbers:
   - overtime over 10h/week,
   - deductions capped,
   - piece rates topped up,
   - net below floor → **run blocked**,
   - any employee paid below minimum → **run blocked**.
8. Actor dispositions each warning (acknowledge, or go fix the underlying record).
9. Actor approves.
10. System generates payslips in each employee's language, writes an immutable audit row per employee, locks the period against further attendance edits, and produces the EFT batch and UIF export.

### Alternates

- **A6.1 — Period spans a wage increase** (any weekly cycle across 1 March). Each shift is valued at the rate in force on its own date. The payslip shows both rates as separate lines. This is the normal case every March, not an edge case.
- **A6.2 — Employee earns above the BCEA threshold.** Overtime and Sunday premiums do not apply by statute. The system applies the contract terms instead, and states on the payslip which basis was used.
- **A9.1 — Correction run for a prior period.** Rates resolve to that period's dates. A correction produces a supplementary payslip and never overwrites the original.

### Exceptions

- **E7.1 — Net below the statutory floor after deductions.** **Reject the run.** Do not clamp, do not warn-and-proceed. Name the employee and the offending deduction. A human decides.
- **E7.2 — An employee has no attendance at all.** Warn; allow exclusion with a reason (leave, absent, terminated); never pay zero silently.
- **E10.1 — Payslip generation fails for one employee.** The whole run is atomic: roll back, report, do not part-generate. A payroll where 39 of 40 people were paid is worse than one where nobody was.

> **Design note.** Step 7 is the product. Every payroll system computes a number. Werf's job is to tell the farmer, *before* they approve, that the number is going to cause a problem. The warnings go above the numbers, not in a collapsed panel below.
>
> **Step 2 deserves defending.** This is the one place we break the offline promise. The reason: a payslip computed against a stale rate table is a legal document that is wrong, and it is worse than a payslip that is late. Attendance capture — the part that happens in the field — stays fully offline. Only the calculation, which happens in an office at month end, requires a connection.

---

## UC-030 · Respond to a stock theft 🇿🇦

**Primary actor:** Farm owner or manager
**Preconditions:** Animals recorded with identifiers and photos; brand registered in the system.
**Postcondition:** Missing status recorded with evidentiary timestamp and GPS; evidence pack ready for SAPS.
**Trigger:** Animals are missing at a count.

### Main flow

1. Actor does a count and finds a shortfall.
2. Actor opens the mob, selects the missing animals.
3. Actor selects "Mark missing".
4. **System captures GPS and timestamp automatically** — this is evidence, not metadata — and prompts for last-known location and last-seen date.
5. System sets status `missing` **locally, offline**, with the captured GPS and timestamp.
6. Actor requests a Stock Theft Evidence Pack.
7. If offline: the request queues and the system says so plainly.
8. When online, the server generates a PDF containing, per animal: photograph, visual tag, EID, brand mark, distinguishing features; plus the brand registration certificate reference, the ownership chain from acquisition, the last-seen GPS/timestamp, 12 months of movement history, treatment history establishing continuous possession, and an empty SAPS case number field.
9. Actor takes the pack to the Stock Theft Unit.
10. Actor enters the SAPS case number, which attaches to the incident.

### Alternates

- **A5.1 — Animals recovered.** Status returns to `alive` with a recovery event. The incident stays open with the recovery recorded. Never delete the incident — the pattern matters, and a second theft from the same camp is the thing worth knowing.
- **A8.1 — An animal has no photograph.** Generate the pack anyway, with a prominent gap notice. Then prompt the farmer to photograph the rest of the herd, because the next theft is the one this fixes.

### Exceptions

- **E4.1 — GPS unavailable.** Record the timestamp, accept a manually selected camp, and flag the record as `location_manual`. Do not block. A missing-animal record with no GPS is still evidence; no record at all is nothing.

> **Design note.** Step 4 is where the value is. The difference between "some cattle went missing sometime last week" and "12 animals, brand ABC, last recorded at these coordinates at 05:30 on 2 April, with these photographs and this ownership chain" is the difference between a docket that closes and one that doesn't.
>
> And note what is **not** here: nowhere does this flow ask who the farmer thinks did it. That field would be used, it would be wrong sometimes, and it would create defamation exposure for our customer and POPIA s26 criminal-behaviour processing exposure for us. Record facts. Let the SAPS investigate.

---

## UC-040 · Pass a GlobalGAP audit 🇿🇦

**Primary actor:** Farm owner / compliance manager
**Secondary actor:** External auditor
**Preconditions:** A season of crop records; GlobalGAP module enabled.
**Postcondition:** An evidence pack the auditor accepts; non-conformances tracked to closure.
**Trigger:** Scheduled audit, or an unannounced one.

### Main flow

1. Actor opens Compliance → GlobalGAP.
2. **System shows the checklist with each control point already mapped to evidence in the system**, and a completeness percentage. Green = evidence exists; amber = partial; red = missing.
3. Actor works the red and amber items. Each links directly to the screen where the gap is fixed.
4. Actor generates the evidence pack.
5. System produces: spray history per block with actives and PHIs, fertiliser records, harvest and traceability records, worker H&S records, training records, risk assessments, and the checklist with evidence references.
6. Actor gives the auditor a time-limited, read-only external grant, or hands over the PDF.
7. Auditor raises non-conformances.
8. Actor records each with an owner, a corrective action, and a due date.
9. System tracks to closure and evidences the closure.

### Alternates

- **A6.1 — Auditor prefers their own portal.** Export in the required format. Do not fight the auditor's process.
- **A2.1 — SIZA audit instead.** Same flow, different checklist, and **most of the evidence comes free from the labour module** because paying people correctly is most of what SIZA asks about.

### Exceptions

- **E5.1 — A PHI override exists in the period.** It appears in the pack as a declared non-conformance with its recorded reason. **Do not hide it.** An auditor who finds a concealed override fails the farm; an auditor who finds a declared one with a documented reason and a corrective action sees a functioning system.

> **Design note.** Step 2 is the whole feature. Audit prep today is a fortnight of a person's life assembling a lever-arch file. If Werf turns that into an afternoon of closing amber items, the subscription pays for itself in one audit cycle — and that is the sentence the salesperson says.

---

## UC-050 · A device comes back after a week offline

**Primary actor:** System (no human trigger)
**Preconditions:** A device has been offline with queued writes.
**Postcondition:** All writes applied or explicitly queued for human review. Zero silent loss.
**Trigger:** Connectivity returns.

### Main flow

1. Client detects connectivity.
2. Client authenticates; refresh token still valid (30-day offline session window).
3. Client uploads its write queue in `occurred_at` order.
4. Server applies each write, resolving per the rules in [offline-sync.md](../03-architecture/offline-sync.md).
5. Server returns a per-write result: applied / conflict-resolved / rejected.
6. Client downloads changes since its last checkpoint.
7. Client resolves against local state.
8. Client shows: "Synced. 47 records uploaded. 2 need your attention."
9. Actor reviews the 2 in a dedicated queue.

### Alternates

- **A3.1 — Connection drops mid-sync.** Resume from the last acknowledged checkpoint. Never restart the whole upload — on EDGE, a restart means it never completes.
- **A2.1 — Refresh token expired** (offline > 30 days). **Do not discard the queue.** Prompt for re-authentication, hold the queue, and upload after login. Discarding a farmer's month of work because a token expired is the single worst thing this system could do.

### Exceptions

- **E4.1 — A write references an entity deleted server-side.** Do not drop it. Raise it as a review item with full context.
- **E4.2 — A write fails validation** because server rules changed while offline. Accept it into a quarantine table, flag for review, and never discard.
- **E7.1 — Storage quota exceeded during download.** Sync the most recent window, warn, and offer to reduce the local retention window. Degrade the *read* set, never the *write* queue.

> **Design note.** Every exception here resolves toward "keep the data, tell the human." The system may be confused; it may not be lossy. A farmer who discovers Werf silently dropped a week of records tells every farmer at the co-op, and they are right to.

---

## Actor summary

| Actor | Use cases |
|---|---|
| Farm owner | UC-001, UC-020, UC-030, UC-040 |
| Farm manager | UC-010, UC-030 |
| Herdsman / worker | UC-010 |
| Bookkeeper | UC-020 |
| External auditor | UC-040 |
| Vet | UC-010 (read) |
| SAPS | UC-030 (recipient) |
| System | UC-050 |
