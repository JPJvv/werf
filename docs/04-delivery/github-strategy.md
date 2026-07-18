# GitHub Strategy

**Goal:** everything committed to GitHub, publicly, so the work is visible to potential employers — without giving away the moat, leaking a secret, or breaching POPIA in public.

Those goals are in tension. This document resolves them.

---

## 1. The tension, stated plainly

**The case for public:** a year of commit history on a real, complex, well-documented product is worth more to a hiring manager than any CV bullet. It is *evidence*. For someone with a strong degree and no formal corporate experience, it is the single most effective thing you can build.

**The case against:** the entire competitive thesis of this product is *"nobody has built South African labour law, stock theft procedure, animal identification, and export audit into a farm app."* A public MIT-licensed repo is a competitor's head start, handed over free.

**The resolution:** public repository, **defensive licence**, and a clear-eyed view of what is actually being given away.

Because here is the thing worth being honest about: **the code is not the moat.** Any competent developer can read `packages/domain/payroll` and reimplement it in a fortnight. What they cannot copy is the reading of the Gazette, the labour-law review, the pilot farms, the auditor relationships, the trust, and the ongoing obligation to ship a rate change every February forever. The moat is the *maintenance commitment*, not the source.

Publishing the source costs you less than you think. Publishing your `.env` costs you everything. Get the second one right and the first is a good trade.

---

## 2. Licence — AGPL-3.0

```
LICENSE          → AGPL-3.0
```

| Option | What it means | Verdict |
|---|---|---|
| **MIT / Apache-2.0** | Anyone forks and sells it | ❌ Hands the product to a competitor |
| **AGPL-3.0** | Network copyleft — a competitor running a modified Werf as a SaaS **must publish their changes** | ✅ **Recommended** |
| **BSL / FSL** | Source-available; restricts production use; converts to open source after 2–4 years | ⚠️ Strong protection, but not OSI-approved — some employers read it as "not really open source" |
| **All rights reserved, public repo** | Visible, no rights granted | ⚠️ Legal and simple, but reads as defensive and gets you no open-source credit |

**AGPL-3.0 is the right answer for both goals at once.** It is an OSI-approved licence, so it counts as open source in every conversation you will have about it — and its network clause means a SaaS competitor who forks Werf has to publish their South African compliance work back to you. That is a genuinely hostile licence to a competitor and a completely friendly one to an employer.

Note the one thing it does **not** protect: a farm running Werf internally, unmodified, owes you nothing. That is fine — that is a customer you did not have.

Add `NOTICE` and keep copyright in your name. You need to own it outright if you ever want to relicense or sell.

---

## 3. What never goes in the repo

This list is the difference between an asset and an incident.

| ❌ Never | Why |
|---|---|
| `.env`, `.env.local`, `.env.production` | Obvious, and it is *always* the obvious one |
| Any AWS key, database URL, or PII encryption key | See above |
| `infra/secrets/**` | |
| **Real farm data. Real worker data. Real ID numbers.** | **A public repo with a seed file containing one real SA ID number is a POPIA breach, in public, permanently, with a s22 notification obligation** |
| A production database dump, even "anonymised" | Anonymised-by-hand is not anonymised |
| Photos of real animals with GPS EXIF | That is a stock theft map with coordinates |
| Customer names, pilot farm names, real payslips | |

**Belt and braces:**
- `gitleaks` in CI ([ci-cd.md §2](ci-cd.md)) — already there
- `gitleaks` as a pre-commit hook — catches it before it is history
- `.claude/settings.json` denies `Read(./.env)` — a secret in Claude's context is a secret in a transcript
- Seed data is **synthetic**, generated, obviously fake: `Test Farm 1`, `9001010000001` (invalid checksum, deliberately)

> **The one that will actually happen:** you will not commit `.env`. You will commit a screenshot in the README showing the dashboard with a real pilot farmer's name on it. Check the images too.

**If a secret does land in a commit:** rotating it is mandatory and rewriting history is not sufficient — assume it is compromised the moment it is pushed, because GitHub's event firehose is scraped continuously by people who are very good at this. Rotate first, then clean up.

---

## 4. What employers actually look at

Worth understanding, because it changes what you optimise.

A reviewer spends **90 seconds** on your GitHub. They are not reading your payroll engine. In that time they form a judgement from:

| What they see | What it tells them | Where yours stands |
|---|---|---|
| **Commit history shape** | Do they work consistently, or is this a weekend that died? | Twelve months of phase-tagged commits ✅ |
| **README** | Can they explain a complex thing simply? | This pack's README is the artifact ✅ |
| **`docs/`** | **Do they think before they type?** | 36 documents, 5 ADRs → ✅ **this is the differentiator** |
| **CI badge** | Do they test, or do they hope? | Green, with an offline suite ✅ |
| **Commit messages** | Discipline | Conventional, FR-referenced ✅ |
| **Issues / PRs** | Do they work like a professional or like a student? | Use them. See §6. |
| Lines of code | Almost nothing | — |

**The ADRs are the thing.** Almost nobody writes them. A reviewer who opens `ADR-0003-sync-engine.md` and finds a decision, the alternatives, the honest cost, and a documented exit strategy has learned more about you than a whole take-home would tell them — because that is the artifact of *engineering judgement*, which is the thing they are actually hiring for and the thing they cannot assess from a CRUD app.

For the graduate-programme applications specifically: this repo answers "tell me about a time you handled ambiguity / made a technical trade-off / dealt with compliance requirements" with a **link**. That is a substantially stronger answer than a story.

---

## 5. Making the commits count

**GitHub only shows green squares for commits authored by an email on your GitHub account.** If Claude Code commits with a different author, the work happens and your contribution graph stays empty. This catches people out.

```bash
git config user.name  "Your Name"
git config user.email "your-github-email@example.com"   # ← must be on your GitHub account
```

Check with `git log --format='%an <%ae>'` after your first Claude Code session. If it is not you, fix it before you have 200 commits to rewrite.

**On attribution and honesty:** Claude Code adds a `Co-Authored-By: Claude` trailer by default. **Leave it.** Two reasons — one principled, one practical.

The principled one: it is true.

The practical one: **it does not diminish you, and hiding it would.** Every engineer worth hiring in 2026 uses AI assistance; the interesting question is not *whether* you used it but *whether you directed it well*. This pack — the ADRs, the phase gates, the `/goal` conditions, the decision to keep a human on Phase 3 — is a portfolio of *how to direct it*, which is a scarcer skill than typing. Meanwhile a reviewer who suspects concealed AI authorship stops evaluating your work and starts evaluating your honesty, and you lose either way.

Own it. It reads as current, not as cheating.

---

## 6. Working like it is a real project, because it is

| Practice | Why it shows |
|---|---|
| **Branch per sub-phase** — `phase-2/livestock-core` | Structured work |
| **PR per sub-phase, even solo** | You understand review even without a reviewer |
| **PR description = what changed, which gate criteria pass** | Communication |
| **Conventional commits with FR refs** — `feat(livestock): add weaning capture (FR-111)` | Traceability |
| **Issues for the phase checklist** | Planning |
| **Milestones for phases** | Delivery |
| **CI required on `main`** | Discipline |
| **Tag releases** — `v0.1.0-phase-1` | Shipping |

A solo PR that you merge yourself looks pointless and is not. It produces a reviewable diff, a description, a CI run, and a record — which is exactly the artifact a reviewer opens.

**Write PR descriptions for a stranger.** In six months, at an interview, someone may open one. `"stuff"` is a real answer to a question you did not want asked.

---

## 7. Repository setup

```bash
gh repo create werf --public --description "Offline-first farm management for South Africa"
```

```
werf/
├── README.md              ← the 90 seconds. Screenshot, thesis, stack, status.
├── LICENSE                ← AGPL-3.0
├── NOTICE                 ← copyright, yours
├── CONTRIBUTING.md        ← even solo: it says you thought about it
├── SECURITY.md            ← how to report a vuln. Employers notice this.
├── .github/
│   ├── workflows/         ← ci-cd.md
│   ├── ISSUE_TEMPLATE/
│   └── pull_request_template.md
├── CLAUDE.md              ← ✅ commit it. It is engineering documentation.
├── .claude/               ← ✅ commit it. rules/, agents/, hooks/
├── docs/                  ← ⭐ the differentiator
└── ...
```

**Commit `CLAUDE.md` and `.claude/`.** They are not embarrassing; they are a demonstration that you can specify a system well enough for something else to build it. `.claude/rules/domain.md` — forty lines of South African labour-law guardrails written so an AI cannot get a payslip wrong — is one of the more interesting files in this repository, and it is the kind of thing that gets a follow-up question in an interview.

Do **not** commit `.claude/gate-off`. That is the escape hatch from the Stop hook, and it is in `.gitignore` for a reason.

**Branch protection on `main`:** require CI green, require a PR. Yes, even solo. It stops a 2am force-push from becoming the thing you explain in an interview.

---

## 8. The README is the interview

You get 90 seconds. Spend them:

```markdown
# Werf

Offline-first farm management for South African farmers.
Livestock, crops, or both — one app, works with no signal.

[CI badge] [licence badge]

![screenshot]

## Why

Global farm software doesn't know what Sectoral Determination 13 is.
South African farm software is desktop-era and single-domain.
Nobody has shipped offline-first, all-farm-type, with SA labour law,
stock theft procedure, and export audit in the core.

## What's interesting here

- **Offline-first, genuinely** — the local SQLite is the source of truth;
  the server is a replication peer. A farmer can work for six weeks with
  no signal and lose nothing. [docs/03-architecture/offline-sync.md]
- **Regulated values are data, not constants** — the minimum wage changes
  every March, and a February payslip must forever recalculate at February's
  rate. [docs/03-architecture/adr/ADR-0005-regulatory-rates.md]
- **Three-layer tenancy** — sync rules, RLS, and API guards, with a test
  suite that proves they agree. [docs/03-architecture/adr/ADR-0003-sync-engine.md]

## Stack
React 19 · TypeScript · PowerSync · NestJS · Postgres 16 + PostGIS · AWS af-south-1

## Status
Phase 2 of 8. See [docs/04-delivery/roadmap.md].

## Docs
36 documents from BRD to runbook: [docs/](docs/)
```

**"What's interesting here" is the highest-leverage section on the page.** It tells a reviewer, in three bullets, that you have thought about hard problems — and it links to the proof. Most portfolio READMEs describe features. Describe the *problems*.

---

## 9. Where this fits your other applications

If you are applying to graduate programmes on a data/analytics track, this repository is doing different work than a churn-prediction notebook, and the two are complementary rather than competing:

| Notebook portfolio | This repository |
|---|---|
| I can build a model | **I can ship a system** |
| I know pandas and XGBoost | I know schemas, migrations, tenancy, offline sync |
| I can analyse data | I can be *responsible* for data |
| Weekend project | 12 months of consistent commits |
| — | **Regulatory compliance, handled explicitly** |

That last row is the one that lands at a telco. A company running BCEA payroll for thousands of staff, under POPIA, with regulated data — someone who has *already thought about* effective-dated regulatory rates and three-layer tenancy is speaking their language before the interview starts.

Lead with the notebooks for the analytics-specific screen. Have this in your back pocket for "tell me about something you built" — and then let them open the ADRs.

---

## 10. Phase 0 checklist

```
□ gh repo create werf --public
□ LICENSE = AGPL-3.0; NOTICE with your copyright
□ git config user.email = your GitHub email     ← or no green squares
□ Verify: git log --format='%an <%ae>' after the first Claude Code session
□ .gitignore: .env*, *.pem, infra/secrets/, .claude/gate-off
□ gitleaks pre-commit hook
□ Branch protection on main: CI required, PR required
□ README with a screenshot and "What's interesting here"
□ SECURITY.md
□ Issue templates, PR template
□ Milestones for phases 0–7
□ Seed data synthetic and obviously fake — invalid ID checksums
□ Commit CLAUDE.md and .claude/
```
