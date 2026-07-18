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

| Phase | Unattended? | Why |
|---|---|---|
| 0 scaffold, 1 shell/auth | ✅ mostly | Mechanical, well-specified, strong gate |
| 2 livestock, 4 crops, 5 finance | ✅ per checklist item | CRUD + tests; the gate catches regressions |
| **3 offline sync** | ❌ **stay at the keyboard** | Conflict resolution and three-layer tenancy are the hardest, highest-risk code. Review every diff. |
| **payroll / compliance** (in 5–6) | ❌ **review every change** | A bug underpays a real worker for a year. Run `compliance-checker` and read its output yourself. |
| 6 compliance packs, 7 polish | ⚠️ mixed | Report generation unattended; legal rules reviewed. |

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
