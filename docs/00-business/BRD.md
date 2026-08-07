# Business Requirements Document

**Project:** Werf — Farm Management Platform for South Africa
**Version:** 1.0 · July 2026
**Status:** Approved for build

---

## 1. Executive summary

South African farmers run their operations on paper, WhatsApp, and Excel, or on software that solves one slice of the problem. The commercial farmer who needs GlobalGAP spray records buys Donkerhoek Data. The stud breeder who needs pedigree buys BenguFarm. Neither handles wages. Neither handles stock theft. Neither works on a phone in a camp with one bar of signal. The farmer running 400 head of cattle *and* 200 hectares of maize *and* eleven seasonal workers has no single product to buy.

Werf is that product: an offline-first web application, installable on any phone, where the farmer selects their farming type at onboarding and gets a system shaped to their operation — with South African labour law, animal identification law, stock theft procedure, and export audit requirements built into the core rather than bolted on.

**The wedge is compliance.** Record-keeping is a nice-to-have that farmers postpone. A Department of Employment and Labour inspection, a GlobalGAP audit, or a stolen-cattle case at the SAPS is not postponable. Werf earns its subscription on the days those things happen and retains on the days between.

---

## 2. Business context

### 2.1 The market

| Segment | Size | Characteristics | Willingness to pay |
|---|---|---|---|
| Large commercial | ~2,600 | Export-oriented, audit-bound, already buy software, multiple enterprises | High (R1,500–5,000/mo) |
| Commercial | ~40,000 | Mixed enterprises, employ 5–50 people, BCEA-exposed, mostly on paper/Excel | Medium (R300–1,200/mo) |
| Smallholder, market-connected | ~270,000 | Sell produce, need records for buyers/finance, phone-first | Low (R0–150/mo) |
| Smallholder, subsistence | ~2.1m | Do not sell, feature phones common | None (not a v1 target) |

Source: Stats SA Census of Agricultural Households; commercial farm counts from the Census of Commercial Agriculture. Figures are directional and should be re-verified before any investor-facing use.

**v1 target:** the ~40,000 commercial farmers, with the ~2,600 large commercial as the reference customers whose requirements (multi-farm, audit, RBAC) pull the product upmarket. The market-connected smallholder segment is a Phase 7 expansion via a free tier, not a v1 focus — serving them properly needs USSD/SMS and a different unit economic model.

### 2.2 Why now

- **Compliance pressure is rising, not falling.** Minimum wage increases annually and is enforced; the sectoral determination for farm workers carries specific record-keeping obligations; export markets (EU citrus, wine, fruit) have hardened on GlobalGAP and SIZA social audits.
- **Stock theft is a material P&L line.** Industry bodies put the national cost in the order of R1.4 billion a year. Branding and record-keeping are both the legal requirement and the practical first step to recovery.
- **Smartphone penetration among commercial farmers is effectively universal**, but rural connectivity is not. This is precisely the gap an offline-first PWA fills and a cloud-only SaaS does not.
- **The incumbents are not moving.** The SA-native tools are desktop-heritage products with mobile companions bolted on. The global tools have no commercial reason to build South African labour law.

### 2.3 Competitive position

| | Global all-in-one (Farmbrite) | Global livestock (AgriWebb, Herdwatch) | SA livestock (BenguFarm, HerdMASTER) | SA crop (Donkerhoek, AgNote) | **Werf** |
|---|---|---|---|---|---|
| All farm types | ✅ | ❌ | ❌ | ❌ | ✅ |
| Mobile-first + offline | Partial | ✅ | ❌ | ❌ | ✅ |
| SA labour law payroll | ❌ | ❌ | ❌ | Partial | ✅ |
| Animal ID Act / stock theft | ❌ | ❌ | Partial | ❌ | ✅ |
| GlobalGAP + SIZA | ❌ | ❌ | ❌ | ✅ | ✅ |
| Stud/genetic depth | ❌ | Partial | ✅ | ❌ | ❌ (integrate) |
| Auction/marketplace | ❌ | ❌ | ❌ | ❌ | ❌ (integrate) |

The last two rows are deliberate. BenguFarm's stud-book integration and SwiftVEE's auction liquidity are twenty-year and R173-million moats respectively. Werf integrates with them; it does not attack them.

---

## 3. Business objectives

| ID | Objective | Measure | Target (12 months post-launch) |
|---|---|---|---|
| BO-1 | Become the record of truth for the farm | Weekly active farms / paying farms | ≥ 70% |
| BO-2 | Win on compliance, not features | Farms that pass a real GlobalGAP/SIZA audit or DoL inspection using only Werf reports | ≥ 25 documented |
| BO-3 | Prove offline works | Sync success rate for sessions initiated offline | ≥ 99.5% |
| BO-4 | Reach commercial farmers | Paying farms | 400 |
| BO-5 | Sustainable unit economics | Gross margin per farm | ≥ 75% |
| BO-6 | Earn the "flagship" claim | Net revenue retention | ≥ 100% |

BO-2 is the one that matters. If it is met, BO-4 follows. If features ship but BO-2 does not move, the product is a worse Farmbrite with a Rand price.

---

## 4. Stakeholders

| Stakeholder | Interest | Influence on requirements |
|---|---|---|
| Farm owner | Profit per enterprise, staying out of trouble, knowing what's on the farm | Primary. Owns the subscription decision. |
| Farm manager | Getting the day's work recorded without a fight | Primary. Kills the product if data entry is slow. |
| Farm worker / handler | Being paid correctly; not being made to fight software | Secondary but decisive — they are the capture point for most events. |
| Bookkeeper | Payslips, UIF, SARS, month-end | Primary for the labour and finance modules. |
| Auditor (GlobalGAP/SIZA) | Evidence, traceability, corrective actions | Defines the compliance module's output format. |
| Veterinarian | Treatment history, withdrawal periods | Read access; influences the health data model. |
| SAPS / Stock Theft Unit | Ownership proof, movement records | Defines the evidence pack format. |
| Buyer / abattoir / packhouse | Traceability, food safety declarations | Defines the export/dispatch data. |
| Anthropic Claude Code | Building the thing | Defines the documentation format (see roadmap). |

---

## 5. Business requirements

### 5.1 Core

| ID | Requirement | Rationale |
|---|---|---|
| BR-1 | A farmer selects their farming type(s) at onboarding, and the system adapts — modules, dashboard, terminology — without exposing irrelevant features | The all-type promise. A sheep farmer must never see a spray record. |
| BR-2 | Every function that a person performs in a field, camp, or crush must work with no network connection | Non-negotiable. Rural SA connectivity is the environment, not an edge case. |
| BR-3 | The system must produce, on demand, the records that a DoL inspector, a GlobalGAP auditor, a SIZA auditor, or a SAPS officer will ask for | The wedge. |
| BR-4 | Wage calculation must be correct against the sectoral determination in force on the date the work was done | Legal exposure. Retrospective recalculation at today's rate is a compliance failure. |
| BR-5 | Personal information must be processed lawfully under POPIA, with special attention to employee biometric and identity data | Legal exposure, and workers are the least-powerful data subjects in this system. |
| BR-6 | The farmer owns their data and can export all of it, in a usable format, at any time, without asking us | Trust. Also POPIA s23/s24. |
| BR-7 | The system must be usable by someone with low digital literacy, in English or Afrikaans, on a mid-range Android phone, in sunlight, with gloves on | The actual use environment. |
| BR-8 | Profitability must be attributable per enterprise, per camp, per block | The reason an owner pays. Records without financial insight is homework. |
| BR-9 | v1 serves South Africa only, but no architectural decision may make a second country a rewrite | The localisation *is* the moat — so we build for it fully. But the ambition is SADC, and the seams cost one line today and a migration across 10,000 partitioned farms in year three. [ADR-0006](../03-architecture/adr/ADR-0006-multi-jurisdiction.md) |
| BR-10 | Accounts holding wages, banking, or worker PII require a second factor that works with no signal | POPIA, and the fact that our users are in dead zones. **This rules SMS out** — SIM swap is industrialised in SA and SMS needs the exact thing our users lack. [ADR-0007](../03-architecture/adr/ADR-0007-authentication.md) |

### 5.2 Constraints

| ID | Constraint | Source |
|---|---|---|
| BC-1 | Personal information of South African data subjects, particularly special personal information, is hosted in South Africa | POPIA s72 risk posture (see [legal-compliance.md](legal-compliance.md) — residency is a risk decision, not a statutory mandate) |
| BC-2 | Pricing is in Rand, with local payment rails | Market reality. Card-in-USD is a conversion killer. |
| BC-3 | The application must be installable without an app store | Distribution: PWA sidesteps Play Store friction and lets us ship daily. |
| BC-4 | Total data footprint per sync must suit a metered mobile connection | Data cost is a real objection in rural SA. |
| BC-5 | No feature may require a hardware purchase to be useful | Hardware (EID readers, scales) is a Phase 6 enhancement, never a dependency. |

---

## 6. Success criteria and the gate we will not cross

**Launch gate (end of Phase 5):** three pilot farms — one livestock, one crop, one mixed — have used Werf as their only record system for a full month, including a pay cycle, and one has passed a real external audit or inspection on Werf output alone.

If that gate is not met, we do not launch. We fix. A farm management product that loses a farmer's data or gets a payslip wrong does not get a second chance in a community this tightly networked — and word travels faster at a Nampo stand than any marketing budget can outrun.

---

## 7. Assumptions

| ID | Assumption | If wrong |
|---|---|---|
| BA-1 | Commercial farmers will pay R300–1,200/mo for compliance certainty | Pricing model collapses; pivot to per-head or per-hectare |
| BA-2 | Offline-first is a genuine differentiator, not a hygiene factor | Lose the technical moat; compete on features against Farmbrite |
| BA-3 | Regulatory complexity is a moat, not a burden | Global players localise; we lose in 24 months |
| BA-4 | A PWA is sufficient — no native app needed for v1 | Push notification and hardware limits force a native shell |
| BA-5 | We can integrate rather than rebuild (Stud Book, SwiftVEE, PayFast) | Roadmap extends by 6+ months |

BA-2 and BA-3 are the load-bearing ones. Both should be tested with real farmers in Phase 1, not assumed through to launch.

---

## 8. Risks

| ID | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| BRK-1 | Payroll calculates a wage wrong; farmer underpays; CCMA case | Medium | Severe | Rates in data with effective dates; table-driven tests against gazetted examples; qualified labour-law review before Phase 5 ships; in-app disclaimer that Werf assists but the employer remains responsible |
| BRK-2 | Sync conflict silently loses a record | Medium | Severe | Conflict resolution specified and tested; never silent — always an audit row; see [offline-sync.md](../03-architecture/offline-sync.md) |
| BRK-3 | POPIA breach involving worker biometrics/ID numbers | Low | Severe | Do not collect biometrics in v1 (PIN + GPS attendance instead); encrypt ID numbers at rest; s22 breach runbook |
| BRK-4 | Farmbrite or AgriWebb localises for SA | Low | High | Compliance depth compounds; integrate locally faster than they can |
| BRK-5 | Regulatory figures go stale and payroll drifts | **High** | High | Annual maintenance cycle is a scheduled, owned, tested task — see [maintenance-runbook.md](../05-operations/maintenance-runbook.md) |
| BRK-6 | Solo/small team cannot sustain the surface area | High | High | Phase gates; ruthless v1 scope; integrate over build |

BRK-5 is rated High likelihood deliberately. Every farm software product that has died in this market died partly of this. The March wage change is not a maintenance task; it is a release with a deadline set by the Minister.

---

## 9. Out of scope for v1

Marketplace/auctions · lending/fintech · IoT collars and gateways · drone/satellite imagery · full accounting general ledger · isiZulu/isiXhosa localisation · USSD/SMS channel · AI weight estimation · muzzle-ID biometrics · feedlot ration formulation · irrigation scheduling.

Each of these is a real need. None is the wedge. See [Roadmap § Deliberate exclusions](../04-delivery/roadmap.md#deliberate-exclusions) for where they land.
