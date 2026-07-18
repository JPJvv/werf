# Werf — Farm Management Platform for South Africa

**Working codename:** Werf (Afrikaans: the farmyard — the operational heart of a farm).

> ⚠️ **"OX OS" was assessed and is not recommended.** Two live software trademarks (Open-Xchange's `OX`, which explicitly covers *computer operating systems*; and `OXOS`, owned by a $45M-funded US company that also owns oxos.com). More importantly, **an ox is a livestock animal and this product's central promise is all-farm-types** — the name contradicts the differentiator. Full assessment, alternatives, and the CIPC filing process: **[naming.md](docs/00-business/naming.md)**.
>
> The codename is isolated so a rename stays a ten-second job. Do it once, when a CIPC search is clean — not before.

**What this is:** the complete specification, architecture, and delivery pack for an offline-first, installable web application (PWA) that lets any South African farmer — livestock, crops, or mixed — run their farm admin: animal records, field records, labour and wages, finances, and compliance.

**Who this is for:** a small development team (or one developer plus Claude Code) building this from zero to production.

---

## The one-paragraph thesis

Global farm software (Farmbrite, AgriWebb, Herdwatch) is feature-rich but has no idea what the Animal Identification Act, Sectoral Determination 13, or SIZA are. South African software (BenguFarm, Donkerhoek Data, HerdMASTER) knows the local rules but is desktop-era, single-domain, and not mobile-first. Nobody has shipped an offline-first, all-farm-type product with South African labour, stock-theft, animal-ID, and export-audit logic in the core. **That gap is the product.**

---

## Screenshots

<!-- SCREENSHOT SLOT — replace when Phase 1 (app shell) lands.
     Home grid (light + dark), an offline write, and a compliance pack export.
     Store under docs/assets/screenshots/ and reference with relative paths. -->

_Coming with the Phase 1 app shell. The home grid, an offline capture flow, and a compliance export — light and dark._

---

## What's interesting here

The load-bearing engineering decisions, for anyone reading the repo to judge the work rather than use the product:

- **Offline is the default state, not the error state.** Reads and writes hit local SQLite (PowerSync over OPFS) always; the sync engine moves deltas to Postgres. There is no "you're offline" failure path on a write — if a code path throws when the network is off, that is the bug.
- **No regulated number is ever hardcoded.** Minimum wage, the BCEA threshold, the UIF ceiling, deduction caps — all live in a `regulatory_rates` table keyed by effective date and looked up by *when the event occurred*, never `now()`. Recalculating a two-year-old payslip yields the two-year-old wage, because that is a legal requirement, not a nicety.
- **Tenancy is enforced twice, on purpose.** Every domain row carries `farm_id`; Postgres RLS and PowerSync sync rules are written and tested *independently*, because sync bypasses PostgREST — a permissive sync rule leaks across farms even when RLS is perfect. There is a test that fails if the two disagree.
- **Money is integer cents in TypeScript and `numeric(14,2)` in Postgres** — a branded `Money` type, never a JS float.
- **Built offline-native from the ID up:** client-generated UUIDv7 (the client can't ask a server for a key), soft-delete tombstones (a hard `DELETE` breaks replication and destroys the audit trail compliance needs), and a deliberate split between `occurred_at` (when it happened on the farm) and `created_at` (when it synced) — which can differ by a week.
- **Security choices that reflect the context, not the defaults:** no SMS second factor (SIM-swap is industrialised in SA and SMS dies with no signal — TOTP and passkeys both work offline); no worker biometrics (POPIA s26 consent posture); data resident in `af-south-1` because there is no South African cloud region for the usual managed options.
- **The design tokens carry the theme, not the components.** No `theme === 'dark' ? …` anywhere — a token whose value changes under `[data-theme]` is the only place the theme lives. Light is the default and does **not** follow the OS at noon in a cattle crush.

Each of these is enforced in `CLAUDE.md` and, where it matters, by a Claude Code review agent (`compliance-checker`, `sync-auditor`) and the `pnpm verify` gate.

---

## How to read this pack

Read in this order. Each document assumes the ones above it.

| # | Document | What it answers |
|---|---|---|
| 1 | [BRD](docs/00-business/BRD.md) | Why build this, for whom, what success means |
| 2 | [SRS](docs/01-requirements/SRS.md) | What the system is, end to end |
| 3 | [Functional Requirements](docs/01-requirements/functional-requirements.md) | The numbered feature backlog (FR-xxx) |
| 4 | [Non-Functional Requirements](docs/01-requirements/non-functional-requirements.md) | Performance, security, scalability budgets (NFR-xxx) |
| 5 | [User Stories & Acceptance Criteria](docs/01-requirements/user-stories.md) | Story-level work items with Gherkin ACs |
| 6 | [Use Cases](docs/01-requirements/use-cases.md) | Step-by-step actor flows for the hard paths |
| 7 | [UX & Design System](docs/02-design/ux-design-system.md) | Screens, tokens, interaction rules, field-use constraints |
| 8 | [Architecture](docs/03-architecture/architecture.md) | System, container, and sync diagrams; the stack and why |
| 9 | [ADRs](docs/03-architecture/adr/) | The load-bearing decisions, with the alternatives we rejected |
| 10 | [Database Schema](docs/03-architecture/database-schema.md) | Full DDL, RLS, indexes, the sync-safe patterns |
| 11 | [API Specification](docs/03-architecture/api-specification.md) | OpenAPI contract |
| 12 | [Offline & Sync Design](docs/03-architecture/offline-sync.md) | The hardest part of the system, specified |
| 13 | [Roadmap](docs/04-delivery/roadmap.md) | 8 phases, gates, what ships when |
| 14 | [Claude Code Playbook](docs/04-delivery/claude-code-playbook.md) | **How to run this build with minimal interaction** |
| 15 | [Phase Checklists](docs/04-delivery/phase-checklists.md) | The executable per-phase task lists |
| 16 | [Testing Strategy](docs/04-delivery/testing-strategy.md) | The verification loop that makes autonomy safe |
| 17 | [CI/CD](docs/04-delivery/ci-cd.md) | Pipelines, environments, release process |
| 18 | [Security](docs/05-operations/security.md) | Threat model, controls, secrets |
| 19 | [Deployment Guide](docs/05-operations/deployment-guide.md) | Infrastructure, from laptop to production |
| 20 | [Monitoring & Logging](docs/05-operations/monitoring-logging.md) | Observability, SLOs, alerting |
| 21 | [Maintenance Runbook](docs/05-operations/maintenance-runbook.md) | Incidents, backups, the annual compliance cycle |
| 22 | [Legal & Compliance](docs/00-business/legal-compliance.md) | 🇿🇦 The **ZA jurisdiction pack**: POPIA, BCEA, Animal ID Act, GlobalGAP/SIZA |
| 23 | [User Guide](docs/06-users/user-guide.md) | End-user documentation (also the in-app help source) |
| 24 | [Naming & Trademark](docs/00-business/naming.md) | The codename, the OX OS assessment, CIPC filing |
| 25 | [GitHub Strategy](docs/04-delivery/github-strategy.md) | Public repo, AGPL, commit attribution, what employers see |

---

## Quickstart for Claude Code

```bash
git init werf && cd werf
# copy this pack in, then:
chmod +x .claude/hooks/*.sh
claude
```

The `.claude/` configuration ships ready to use — no setup session needed:

| | |
|---|---|
| `settings.json` | Permissions (`.env` reads denied, migration edits denied) + hooks |
| `rules/domain.md` | The payroll and compliance guardrails. **The highest-value file in the repo.** |
| `rules/frontend.md` · `rules/db.md` | Path-scoped, loaded only when Claude touches those paths |
| `agents/compliance-checker.md` | Adversarial review for SA legal correctness |
| `agents/sync-auditor.md` · `agents/reviewer.md` | Tenancy/offline audit · phase-checklist review |
| `hooks/verify-gate.sh` | Stop hook — blocks a turn until `pnpm verify` passes |
| `hooks/guard-migrations.sh` | Blocks edits to applied migrations |
| `loop.md` | The default `/loop` prompt |

First session:

```
Read README.md, CLAUDE.md, and docs/04-delivery/phase-checklists.md § Phase 0.
Plan the scaffold. Do not write code yet.
```

Then work phase by phase. Every phase has an exit gate — a command that must pass.
**That command is what makes unattended runs safe.** See the
[Claude Code Playbook](docs/04-delivery/claude-code-playbook.md) for the `/goal`,
auto-mode, and Stop-hook loops that let a phase run while you sleep — and for the
honest account of which phases you should not do that to.

---

## Scope guardrails

**In scope, v1:** livestock records, crop/field records, labour & wages, finances, inventory, compliance packs (Animal ID, stock theft, GlobalGAP/SIZA), offline-first PWA, light + dark themes, English + Afrikaans, 2FA (passkey/TOTP).

**Locked to South Africa, built to open.** v1 serves one jurisdiction (`ZA`) — the localisation *is* the moat. But every regulated rule sits behind a named interface and every regulated row carries a `jurisdiction`, so the second country is a directory and a registry entry rather than a rewrite. What we deliberately did **not** build: a rules engine, a DSL, a plugin loader, or a speculative second country. See [ADR-0006](docs/03-architecture/adr/ADR-0006-multi-jurisdiction.md).

**Explicitly out of scope, v1:** IoT/collar hardware, drone imagery, marketplace/auctions, lending, accounting general ledger, isiZulu/isiXhosa localisation, USSD/SMS channel, AI weight estimation. Each has a home in Phase 7+ or an integration partner. See [Roadmap § Deliberate exclusions](docs/04-delivery/roadmap.md#deliberate-exclusions).

---

## A standing warning about the numbers in this pack

Every wage rate, threshold, and regulatory citation in these documents was accurate when written (July 2026) but **all of them change annually**. The minimum wage changes each March. The BCEA earnings threshold changes each April. Treat every such figure as a value in a database table with an effective date, never a constant in code. This rule is load-bearing and is repeated in [CLAUDE.md](CLAUDE.md), [legal-compliance.md](docs/00-business/legal-compliance.md), and [maintenance-runbook.md](docs/05-operations/maintenance-runbook.md) on purpose.

**Before writing the payroll engine, re-verify current rates against the Government Gazette.** The blueprint tells you the shape of the calculation; it cannot tell you today's number.
