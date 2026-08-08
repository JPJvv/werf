# Legal & Compliance Specification — 🇿🇦 ZA jurisdiction pack

**This document is normative.** Where it conflicts with any other document in this pack, this one wins. Where it conflicts with the Government Gazette, the Gazette wins and this document is a defect.

> **Scope: South Africa only.** This is the `ZA` jurisdiction pack. Everything below implements the interfaces in [ADR-0006](../03-architecture/adr/ADR-0006-multi-jurisdiction.md) — `PayrollRules`, `AnimalIdentityRules`, `TheftEvidenceRules`, `PrivacyRegime`, `ComplianceRuleset` — and lives in `packages/domain/*/jurisdictions/za/`.
>
> **This is the one place South African statute names belong.** BCEA, POPIA, SD13, UIF, SARS, SAPS, SIZA, CIPC — here, in `jurisdictions/za/`, and in ZA user-facing copy. Nowhere else. A `bceaThreshold` field in `packages/core` is a defect, because it puts a South African statute in the contract every future country must implement.
>
> A second country gets its own pack. **Do not write one speculatively** — a guessed Namibian pack makes tests pass against law nobody has read.

---

## 0. Read this before writing a line of payroll or compliance code

> **Every figure in this document has an expiry date.**
>
> The national minimum wage changes every March. The BCEA earnings threshold changes every April. UIF ceilings change. Withdrawal periods change when a product is reregistered. The numbers below were correct in July 2026 and are provided so you understand the *shape* of each calculation — never so you can type them into a source file.
>
> **The rule:** every regulated value lives in the `regulatory_rates` table with `effective_from` and `effective_to`, and is looked up by the date the event occurred. A regulated constant in code is a defect at code review, even if the value is currently correct.
>
> **Before the labour phase (currently Phase 5) begins, re-verify every figure in §2 against the current Government Gazette.** Claude Code should treat "the number in the blueprint" as a hint, not a fact.
>
> ⚠️ Keyed to **the labour phase**, not to a number, on purpose. This document said "Phase 3" while the roadmap renumbered labour to Phase 5 and gave Phase 3 to offline sync — which silently pointed the Gazette re-verification, the practitioner review and the DPIA at a phase where nobody would be looking at a payslip. Re-key rather than renumber the next time the roadmap moves.

**We are not lawyers and neither is this document.** It is an engineering specification informed by public sources. Before the labour module ships to a paying customer, a qualified South African labour law practitioner must review the calculation engine and the generated documents. Budget for this in the labour phase (currently Phase 5).

---

## 1. POPIA — Protection of Personal Information Act 4 of 2013

### 1.1 Our role

Werf is an **operator** (processor) for the farm's employee data, and a **responsible party** (controller) for the farmer's own account data. This dual role must be reflected in the terms of service and in two separate privacy notices. The farmer is the responsible party for their workers' information; we process it on their documented instruction. Section 21 requires that relationship to be governed by a **written contract** — this is the Data Processing Addendum, and it is a launch blocker, not a nice-to-have.

### 1.2 The eight conditions, mapped to build tasks

| Condition | What it means here | Build requirement |
|---|---|---|
| Accountability (s8) | We can show compliance | Audit log on every personal-data access; DPIA before the labour phase (currently Phase 5) |
| Processing limitation (s9–12) | Minimum necessary, lawful basis, consent where required | Field-level justification register; no speculative data collection |
| Purpose specification (s13–14) | Collected for a stated purpose, retained no longer than needed | Retention policy per table (§1.6) |
| Further processing limitation (s15) | Don't repurpose | No analytics on worker data without separate consent; no model training on customer data |
| Information quality (s16) | Accurate, complete | Validation at capture; worker can request correction |
| Openness (s17–18) | Notify the data subject | Worker-facing privacy notice **in a language they understand** — English and Afrikaans at minimum; PAIA manual published |
| Security safeguards (s19–22) | Appropriate technical and organisational measures; breach notification | §1.5 and [security.md](../05-operations/security.md) |
| Data subject participation (s23–25) | Access, correction, deletion | Self-service export; worker data subject request workflow |

### 1.3 Special personal information (s26) — the sharp edge

Section 26 prohibits processing special personal information unless a s27 or s28–33 exception applies. In a farm system, the following are special personal information:

| Data | Why special | v1 decision |
|---|---|---|
| **Biometric data** (fingerprint, face) | s26 explicit | **DO NOT COLLECT FROM WORKERS IN V1.** Attendance uses worker PIN + optional GPS. Biometric clock-in is the obvious feature and it is a trap: it requires explicit consent, and consent obtained from a farm worker by their employer is of questionable voluntariness given the power asymmetry. If we build it later, it needs a full DPIA and a genuine non-biometric alternative offered without disadvantage.<br><br>**Note the asymmetry with owner passkeys** ([ADR-0007](../03-architecture/adr/ADR-0007-authentication.md)): an owner choosing to use *their own phone's* fingerprint to protect *their own account* is free consent, and the biometric never leaves their device — WebAuthn sends us a public key, not a fingerprint. A worker required to fingerprint into *their employer's* tablet to get paid is a different thing entirely. Same technology, opposite consent posture. |
| **Race / ethnic origin** | s26 explicit | Collect **only** where an employment-equity or B-BBEE report legally requires it, with the legal basis recorded, and never as a default field. |
| **Health information** | s26 explicit | Injury-on-duty records are health data. Restrict to owner + designated H&S role. Never syncs to a general worker device. |
| **Criminal behaviour** | s26 explicit | Stock theft incidents may name suspects. **Record facts, not accusations.** A "suspect" field is a defamation and POPIA risk. Record what was observed and what was reported to SAPS, with the case number. |
| **Trade union membership** | s26 explicit | Deduction of union dues reveals membership. Restrict visibility to payroll role only. |

**SA ID numbers** are not "special" under s26, but they are a national identifier with high abuse potential. Treat as special in practice: encrypt at rest with a separate key, mask in all UI (`•••••••••1234`), never log, never include in exports unless the export's purpose requires it.

### 1.4 Transborder flows (s72) — and what residency actually requires

Section 72 restricts transfer of personal information to a third party in a foreign country unless one of these grounds applies: the recipient is subject to a law, binding corporate rules, or binding agreement providing an adequate level of protection substantially similar to POPIA; the data subject consents; the transfer is necessary for performance of a contract with the data subject or in their interest; or it is for the data subject's benefit and consent could not reasonably be obtained.

**Be precise about this, because the internet is not:** POPIA does **not** impose a blanket data-residency requirement. Offshore hosting is lawful if a s72 ground is properly established. Plenty of South African businesses lawfully run on offshore cloud.

**So why do we host in South Africa anyway?** Three reasons, none of them "the law says so":

1. **Risk posture.** We process employee data, including health and potentially union-membership-revealing data, on behalf of thousands of small responsible parties who have no capacity to run their own s72 analysis. Keeping the data in the Republic removes s72 from their compliance surface entirely. That is a feature we sell.
2. **Latency.** Round-trip from rural South Africa to eu-west-1 is >150ms. To af-south-1 it is a fraction of that. For a sync engine on a marginal connection, this matters.
3. **Trust.** "Your workers' data never leaves South Africa" is a sentence that closes deals in this market.

The consequence is architectural: **Supabase Cloud does not offer a South African region** (they explicitly withdrew af-south-1 support for new projects). We therefore self-host. See [ADR-0002](../03-architecture/adr/ADR-0002-data-residency.md).

Where we *do* transfer offshore — error tracking, email delivery, any AI feature — we must either establish a s72 ground or scrub personal information before it leaves. Sentry must be configured to strip PII; that is a code requirement, not a settings checkbox.

### 1.5 Breach notification (s22)

Where there are reasonable grounds to believe personal information has been accessed or acquired by an unauthorised person, notify **the Information Regulator** and **each affected data subject** as soon as reasonably possible after discovery. Notification to the data subject must be in writing and must describe the possible consequences and the measures we intend to take.

This means: a breach runbook, a pre-drafted notification template, a way to identify affected data subjects *fast*, and a decision-maker on call. See [maintenance-runbook.md § Security incident](../05-operations/maintenance-runbook.md).

### 1.6 Retention

| Data | Retention | Driver |
|---|---|---|
| Employment records (name, job, hours, remuneration) | **3 years** minimum from date of entry | BCEA s31 |
| Payslips and payroll calculations | 5 years | SARS |
| Animal treatment records | 5 years (some export markets require longer) | Veterinary/food safety; check the specific market |
| Spray records | 3 years minimum; GlobalGAP audit cycle | GlobalGAP IFA |
| Stock theft incident records | Indefinite while case open; 7 years after | Evidentiary |
| Account/billing | 5 years | Companies Act, SARS |
| Deleted farm's data | 30-day soft delete, then hard purge, except where a retention obligation above applies | POPIA s14 |

Note the tension: POPIA s14 says delete when the purpose is served; BCEA s31 says keep for three years. The statutory retention wins. Encode this — do not let a "delete my account" button destroy records the farmer is legally required to hold.

---

## 2. Labour law — BCEA and Sectoral Determination 13

### 2.1 What applies to a farm worker

Farm workers are covered by the **Basic Conditions of Employment Act 75 of 1997** and by **Sectoral Determination 13: Farm Worker Sector**, which sets sector-specific terms. The **National Minimum Wage Act 9 of 2018** sets the wage floor.

### 2.2 The figures — as at July 2026, and already decaying

> ⚠️ **VERIFY BEFORE USE.** These are shape-of-the-calculation examples. Re-check the Gazette.

| Item | Value (July 2026) | Source | Changes |
|---|---|---|---|
| National minimum wage (incl. farm workers) | **R30.23/hour**, effective 1 March 2026 (up from R28.79) | Government Gazette No. 54075, published 3 February 2026 by the Minister of Employment and Labour | Annually, each March |
| BCEA earnings threshold | **R269,600.90/year** (R22,466.74/month), effective 1 May 2026 (up from R261,748.45) | Government Notice 7384, Government Gazette 54544, 17 April 2026 | Annually, each April |
| Ordinary hours | 45/week; 9/day (5-day week) or 8/day (6-day week) | BCEA s9 | Rarely |
| Overtime | Max 10 hours/week; paid at **1.5×** | BCEA s10 | Rarely |
| Sunday work | 2× (or 1.5× if ordinarily works Sundays) | BCEA s16 | Rarely |
| Public holiday | 2× if not ordinarily worked | BCEA s18 | Rarely |
| Night work | Allowance + transport, 18:00–06:00 | BCEA s17 | Rarely |
| Annual leave | 21 consecutive days / 1 day per 17 worked | BCEA s20 | Rarely |
| Sick leave | 30 days per 36-month cycle (6-day week) | BCEA s22 | Rarely |
| Maternity leave | 4 consecutive months | BCEA s25 | Rarely |
| Family responsibility leave | 3 days/year | BCEA s27 | Rarely |
| Deduction: accommodation | Max **10%** of wage, conditions apply | Sectoral Determination 13 | Occasionally |
| Deduction: food | Max **10%** of wage | Sectoral Determination 13 | Occasionally |
| UIF | 1% employee + 1% employer, subject to a monthly ceiling | UIF Act | Ceiling changes |

**The earnings threshold matters and is widely misunderstood.** An employee earning *above* the threshold loses the statutory entitlement to overtime pay, Sunday pay, and certain other BCEA sections. Below it, they retain them. A farm manager on R25,000/month is above the threshold as of May 2026; the same person was below it in April. **This is exactly why the rate lookup must be by date.**

### 2.3 Record-keeping obligations (BCEA s29, s31)

The employer **must** keep, for **at least three years** from the date of last entry, a record containing at minimum:

- Employee's name and occupation
- Time worked by each employee
- Remuneration paid to each employee
- Date of birth of any employee under 18
- Any other prescribed information

A labour inspector may demand these **without notice**. This is the single highest-value report in the system: *"Show me your records"* → one button → a PDF that satisfies the inspector.

**Written particulars of employment (BCEA s29)** must be supplied to the employee when employment begins, in writing, covering the full prescribed list (employer/employee details, place of work, date of commencement, job title and duties, ordinary hours and days, wage and rate, overtime rate, payment interval, deductions, leave, notice period). Werf generates this. It must be generated in a language the employee understands.

**Payslip (BCEA s33)** must show: employer and employee details, period, ordinary and overtime hours, wage rate and overtime rate, number of hours at each rate, details of any other pay, gross, each deduction itemised, and net.

### 2.4 The payroll calculation, specified

```
For each employee, for each pay period:

  1. Resolve applicable rules by the FARM'S JURISDICTION and the
     DATE THE WORK WAS DONE:
       j          := farm.jurisdiction          -- 'ZA'. From the FARM, never the user.
       rate       := regulatory_rates.lookup(j, 'NMW_FARM', shift.occurred_at)
       threshold  := regulatory_rates.lookup(j, 'BCEA_THRESHOLD', period.end_date)
       uif_ceil   := regulatory_rates.lookup(j, 'UIF_CEILING', period.end_date)

  2. Classify each shift:
       ordinary   := hours up to daily/weekly ordinary limit
       overtime   := hours beyond ordinary, capped at 10/week
                     (hours beyond the cap are STILL PAID — flag a
                      compliance warning, never silently drop them)
       sunday     := shift on Sunday
       holiday    := shift on a gazetted public holiday

  3. Compute gross:
       gross := ordinary_hours × max(contract_rate, rate)
              + overtime_hours × max(contract_rate, rate) × 1.5
              + sunday_hours   × max(contract_rate, rate) × sunday_multiplier
              + holiday_hours  × max(contract_rate, rate) × 2.0
              + piece_work_units × piece_rate
              + allowances

       CONSTRAINT: gross / total_hours >= rate.
       Piece work does not exempt the employer from the minimum wage.
       If the piece-rate outcome falls below the floor, TOP UP to the floor
       and record the top-up as a distinct line. This is the single most
       common wage compliance failure on South African farms and the
       system must make it impossible.

  4. Deductions:
       accommodation := min(requested, gross × 0.10)   [if conditions met]
       food          := min(requested, gross × 0.10)   [if conditions met]
       uif           := min(gross, uif_ceil) × 0.01
       other         := only with written consent, subject to BCEA s34

       CONSTRAINT: total deductions must not reduce net below the
       statutory floor. Reject the payroll run, do not clamp silently.

  5. net := gross - deductions

  6. Emit: payslip (s33 fields), audit row, and any compliance warnings.
```

**Warnings are first-class output, not console noise.** If overtime exceeded 10 hours, if a deduction was capped, if a piece rate was topped up — the farmer sees it before they approve the run. The system's job is to prevent the CCMA case, not to compute the number.

### 2.5 What we deliberately do not do

Werf is **not** a registered payroll bureau. We calculate, we generate payslips, we export to SARS/UIF-compatible formats. We do **not** file returns on the farmer's behalf, do not act as tax agent, and every generated document carries: *"Werf assists with wage calculation. The employer remains responsible for compliance with the BCEA, the National Minimum Wage Act, and all applicable sectoral determinations."*

---

## 3. Animal identification & stock theft

### 3.1 Animal Identification Act 6 of 2002

- Owners of cattle, sheep, goats, and pigs must register an identification mark with the Registrar and mark their animals with it.
- The registered mark is up to **three characters**.
- Marking methods: tattoo, freeze brand, or hot-iron brand, depending on species and age.
- Animals acquired must be marked **within a prescribed period** of acquisition.
- Marks are recorded in the national Animal Identification System (AIS).

**Build requirement:** a `branding_registers` table per farm holding the registered mark, registration certificate reference, mark type, and body position. Every animal record links to the mark it carries. An unmarked animal past the prescribed window raises a compliance flag.

### 3.2 Stock Theft Act 57 of 1959

The Act creates a **reverse onus** in specific circumstances: a person found in possession of stock who cannot give a satisfactory account of their possession commits an offence. The practical consequence for a farmer is that **documentation is the defence and the recovery mechanism**.

Documents that matter:
- **Removal certificate** — required when stock is moved off the property.
- **Proof of ownership** — brand registration + individual animal records + photographs.
- **Transport documentation**.

**Build requirement — the Evidence Pack.** One action produces a single PDF containing: animal identification (photo, marks, tags, distinguishing features), ownership chain (acquisition record → current), the registered brand certificate, last-seen record with GPS and timestamp, movement history, treatment history establishing continuous possession, and space for the SAPS case number. This document is what a farmer hands to the Stock Theft Unit.

**And a hard rule:** record observations and facts. Do **not** build a "suspect" field. A farmer typing a neighbour's name into a suspect field creates a defamation exposure for them and a POPIA s26 criminal-behaviour processing problem for us. Record: what was found, when, where, what was reported, the case number.

### 3.3 LITS-SA

The Livestock Identification and Traceability System for South Africa is a national programme to enable individual-animal traceability. It is not fully mandatory across all species today, but export markets and disease control (notably post-FMD movement control) are pushing hard in that direction.

**Build requirement:** design the animal data model to accommodate a national unique identifier and full movement history from day one, even before it is legally required. Retrofitting traceability into a herd of 5,000 animals with three years of history is a migration nobody survives. The column costs nothing today.

### 3.4 Animal Diseases Act 35 of 1984

Controlled and notifiable diseases must be reported. Dip/tick records are required in controlled areas. Movement permits are required in and out of controlled areas.

**Build requirement:** a notifiable disease list in `regulatory_rates`-style reference data (it changes); when a health event matches, the system prompts the reporting obligation with the relevant state vet contact. We prompt; we do not report on the farmer's behalf.

---

## 4. Export & food safety compliance

### 4.1 GlobalG.A.P. Integrated Farm Assurance

Applies to fruit, vegetables, and increasingly livestock for export. Requires: traceable production units, spray records with active ingredients and pre-harvest intervals, fertiliser records, risk assessments, worker health & safety, hygiene, and evidence of corrective actions. Audits are annual, announced or unannounced, against a checklist with Major Musts, Minor Musts, and Recommendations.

**Build requirement:** a checklist engine that maps control points to evidence already in the system, shows completeness, tracks non-conformances and corrective actions with owners and due dates, and exports the whole thing as an auditor-ready pack.

### 4.2 SIZA — Sustainability Initiative of South Africa

The South African social and environmental standard, widely required by EU/UK retailers, covering labour practice, health and safety, and environmental management. Aligned with (but distinct from) GlobalGAP's GRASP.

**This is where Werf's design pays off.** SIZA social audits ask for exactly the labour records the payroll module already holds — contracts, hours, wages, deductions, leave, age verification. A farm running Werf's labour module has already produced most of a SIZA evidence pack as a by-product of paying people. Make that explicit: one button, "Generate SIZA evidence pack".

### 4.3 The pesticide register

Spray records must name the **registered** product and the **active ingredient**, and honour the **pre-harvest interval** (PHI). Products are registered under Act 36 of 1947 and registrations change.

**Build requirement:** a `chemical_products` reference table (product, registration number, actives, crop, PHI, re-entry interval), synced from a maintained source, versioned. Spraying a block within the PHI of its planned harvest date must be **blocked at capture** with an override that requires a reason and is audited. Catching this at audit time is too late — the fruit is already rejected.

---

## 5. Other

| Instrument | Relevance | Build requirement |
|---|---|---|
| **Consumer Protection Act 68 of 2008** | Our own T&Cs, cancellation, plain language | Plain-language T&Cs; no auto-renewal traps |
| **Electronic Communications and Transactions Act 25 of 2002** | Electronic signatures on contracts/payslips | s13 advanced e-signature not required for employment contracts; ordinary e-signature + audit trail suffices — but record the signing event properly |
| **Companies Act 71 of 2008** | Our own records | Out of product scope |
| **Occupational Health and Safety Act 85 of 1993** | Injury on duty; farm H&S | IOD register; health data restrictions per §1.3 |
| **Compensation for Occupational Injuries and Diseases Act** | IOD reporting | Generate the report; farmer submits |
| **PAIA (Act 2 of 2000)** | Access-to-information manual | Publish ours; s51 manual |

---

## 6. Compliance obligations register (build this as a table, not a document)

The system needs a live `compliance_obligations` table so the *farm* can see what it owes and when. Seed:

| Obligation | Trigger | Frequency | Evidence in Werf |
|---|---|---|---|
| Mark acquired animals | Animal acquisition | Per event, within prescribed window | `animals.brand_applied_at` |
| Keep employment records | Employment | Continuous, 3-year retention | Labour module |
| Issue written particulars | New hire | Per hire | Generated contract |
| Issue payslip | Each pay period | Per period | Payroll module |
| Pay ≥ minimum wage | Each pay period | Per period | Payroll engine constraint |
| Submit UIF declaration | Monthly | Monthly | UIF export |
| Dip records (controlled areas) | Location-dependent | Per schedule | Health events |
| Report notifiable disease | Diagnosis | Per event | Health event → prompt |
| Removal certificate | Stock movement off-property | Per movement | Movement record |
| Honour pre-harvest interval | Spray → harvest | Per event | Spray capture block |
| GlobalGAP audit | Certification cycle | Annual | Checklist engine |
| SIZA audit | Buyer requirement | Annual | Labour module → evidence pack |

---

## 7. The annual compliance cycle — an engineering obligation

This is not a legal appendix. It is a **recurring release with a legislated deadline**, and it is owned by engineering.

| When | What | Owner |
|---|---|---|
| **February** | Watch for the NMW gazette. Update `regulatory_rates`. Test. Deploy before 1 March. | Backend |
| **March** | New wage rate live. Verify a real payroll run against a hand-calculated example. | Backend + QA |
| **April** | Watch for the BCEA threshold gazette. Update. Deploy before 1 May. | Backend |
| **Ongoing** | Public holidays for the following year (including any proclaimed once-off days — elections have created these before). | Backend |
| **Ongoing** | Chemical registrations and PHIs. | Data |
| **Ongoing** | Notifiable disease list. | Data |
| **Annually** | Review GlobalGAP/SIZA checklist versions against the current standard. | Product |
| **Annually** | POPIA review: retention, DPIA refresh, operator contracts. | Legal + Eng |

A missed February deadline means every farm on Werf underpays every worker from 1 March. That is the highest-severity non-outage incident this product can have. Put it in the on-call calendar, not a wiki.

---

## 8. Sources

Primary sources should be consulted directly; these were the basis for this document as at July 2026.

- Protection of Personal Information Act 4 of 2013 — see the Information Regulator's site for guidance notes, including the pending guidance on transborder flows
- Basic Conditions of Employment Act 75 of 1997; Sectoral Determination 13: Farm Worker Sector
- National Minimum Wage Act 9 of 2018; Government Gazette No. 54075 (3 February 2026)
- Government Notice 7384, Government Gazette 54544 (17 April 2026) — BCEA earnings threshold
- Animal Identification Act 6 of 2002; Stock Theft Act 57 of 1959; Animal Diseases Act 35 of 1984
- GlobalG.A.P. IFA standard (current version); SIZA Social and Environmental standards
- Agricultural Remedies Act 36 of 1947 (pesticide registration)

**Currency check:** if today's date is materially later than July 2026, assume §2.2 is wrong and re-verify before writing code.
