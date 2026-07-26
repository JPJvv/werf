# Claude Code Playbook

How to run this build with minimal interaction — and an honest account of which phases you should
*not* run unattended.

## The idea

Every phase has an **exit gate**: a single command (`pnpm verify`) that must exit 0. The Stop hook
(`.claude/hooks/verify-gate.sh`) refuses to end a turn until it passes. That is what makes an
unattended run safe — Claude cannot declare victory on broken code.

## The loops

- **`/loop`** — the default working prompt (`.claude/loop.md`). Works the current phase one checklist
  item at a time, verifying and committing after each.
- **`/goal <condition>`** — keep looping until a stated condition is true (e.g. "all Phase 1 checklist
  items are checked and `pnpm verify` is green"). Good for a phase you trust.
- **Plan first, code second.** For any non-trivial phase, ask for a plan and approve it before code.

## When to let it run, and when not to

> **This table is generated from [roadmap.md](roadmap.md), phase by phase.** If the two ever
> disagree, the roadmap wins and this table is the bug — it was wrong for four sessions, naming
> phases that do not exist (there is no "phase 3 offline sync"; sync is **1c**, and payroll is
> **Phase 3**, not "5–6"). This is the document that gates unattended runs, so a phase number in it
> is load-bearing rather than descriptive.

| Phase | Unattended? | Why |
|---|---|---|
| **0** scaffold | ✅ high | No product decisions. Let it run. |
| **1** auth, sync, onboarding | ⚠️ medium | 1a–1c are mechanical — and note that **offline sync is 1c**, not a later phase. **Sit with 1d**: enterprise adaptation is the product, and it is a judgement call rather than a spec. |
| **2** livestock & crops | ✅ per checklist item, with two exceptions | CRUD + tests; the gate catches regressions. **Low for 2c** (the crush UX is judgement). **Medium for 2d, 2g** — read [legal-compliance.md §4.3](../00-business/legal-compliance.md) first; withdrawal periods and PHI are legal rules, not technical ones. |
| **3 labour & wages 🇿🇦** | ❌ **LOW — stay at the keyboard, review every diff** | **This is the payroll phase.** An autonomous run here produces confident, wrong, legally-consequential code. A bug underpays a real worker for a year, and the BCEA does not accept "the tests were green". **Never let 3d–3e (the payroll engine and the blocking logic) run unattended.** Run `compliance-checker` on every slice and read its output yourself. Take 3a as a session of its own. |
| **4** finance & compliance 🇿🇦 | ⚠️ mixed | **High** for 4a–4b and 4h. **Medium** for 4c–4g: the *content* is legal, the *engine* is code. |
| **5** hardening & pilot | ❌ low | Mostly judgement. Pilot farms discover things no test does. |
| **6** integrations | ✅ high | Well-specified, externally bounded, low product judgement. |
| **7** intelligence | ⚠️ medium | |

## Sub-agents

- `reviewer` — end of every phase, against the exit gate.
- `compliance-checker` — any change to payroll/deductions/animal-ID/POPIA/export-audit.
- `sync-auditor` — any change to schema, RLS, or sync rules.

## Guardrails that are always on

- `.claude/settings.json` denies reading `.env*` and `infra/secrets/**`, and denies editing applied
  migrations. `git push`, `gh repo`, and `pnpm db:migrate` are `ask` — Claude pauses for you.
- The verify Stop hook blocks turn-end on a red build. Disable only via `.claude/gate-off` (never commit it).
- Re-verify every regulated number against the Government Gazette before writing payroll. The pack
  gives you the shape of the calculation, not today's rate.
