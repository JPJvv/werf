# Contributing

Even as a solo project, this repo works like a real one — that discipline is
part of the point.

## Workflow

- Branch per sub-phase: `phase-N/short-description`.
- One phase per PR unless the phase checklist says otherwise. Open a PR even when
  you will merge it yourself — it produces a reviewable diff, a CI run, and a record.
- PR description says what changed and which exit-gate criteria now pass. Write it
  for a stranger reading it in six months.

## Commits

- Conventional Commits, referencing the FR or story ID:
  `feat(livestock): add weaning event capture (FR-112)`.
- Author with your GitHub email or the contribution graph stays empty:
  `git config user.email your-github-email@example.com`, then verify with
  `git log --format='%an <%ae>'` after the first session.
- The `Co-Authored-By: Claude` trailer is fine — leave it. It is true and it reads
  as current, not as cheating.

## Definition of done

`pnpm verify` (lint + typecheck + test + build) must exit 0. It is enforced by the
Stop hook in `.claude/`. Do not disable the gate except via `.claude/gate-off`
(git-ignored), and re-arm it immediately.

## Rules the reviewer will hold you to

See `.claude/rules/` (domain, frontend, db) and `docs/`. The load-bearing ones:
never hardcode a regulated number, money is integer cents, every domain table
carries `farm_id`, soft-delete only, offline is the default state.
