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
> disagree, the roadmap wins and this table is the bug. This is the document that gates unattended
> runs, so a phase number in it is load-bearing rather than descriptive.

| Phase | Unattended? | Why |
|---|---|---|
| **0** scaffold | ✅ high | No product decisions. Let it run. |
| **1** shell, auth & 2FA | ⚠️ medium | Authentication ceremonies and offline session recovery need close review even when their mechanics are well tested. |
| **2** livestock | ✅ per checklist item, with two exceptions | **Low for 2c** (the crush UX is judgement). **Medium for 2d and 2f** — read [legal-compliance.md §4.3](../00-business/legal-compliance.md) first; withdrawal, animal-ID and stock-theft rules are regulated. |
| **3** offline sync | ⚠️ per slice | Tenancy and conflict rules are data-integrity boundaries. Keep schema/RLS/sync-rule changes small and owner-trigger `sync-auditor` when the branch is being cleared. |
| **4** crops & fields | ⚠️ mixed | CRUD is routine; chemical registration, PHI and re-entry logic require close review and effective-dated reference data. |
| **5** people, work & pay 🇿🇦 | ❌ **low — review regulated diffs** | Build simple farmer forms and PDF/DOCX/XLSX outputs; compliance warns and never blocks. Run each 5d payroll rule as a small reviewed slice. The owner triggers `compliance-checker`; external legal review gates deployment. |
| **6** finance & compliance 🇿🇦 | ⚠️ mixed | The mechanics are testable, but evidence-pack contents, POPIA access and statutory exports need human review. |
| **7** hardening & pilot | ❌ low | Mostly judgement. Pilot farms and external security testing discover things the automated gate cannot. |

## Sub-agents

- `reviewer` — owner-triggered at a phase gate.
- `compliance-checker` — owner-triggered for payroll/deductions/animal-ID/POPIA/export-audit.
- `sync-auditor` — owner-triggered for schema, RLS, sync rules, or write paths.

These agents are never started silently. See `AGENTS.md` for the current review policy.

## Guardrails that are always on

- `.claude/settings.json` denies reading `.env*` and `infra/secrets/**`, and denies editing applied
  migrations. `git push`, `gh repo`, and `pnpm db:migrate` are `ask` — Claude pauses for you.
- The verify Stop hook blocks turn-end on a red build. Disable only via `.claude/gate-off` (never commit it).
- Re-verify every regulated number against the Government Gazette before writing payroll. The pack
  gives you the shape of the calculation, not today's rate.
