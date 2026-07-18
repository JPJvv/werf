<!-- Write this for a stranger reading it in six months. -->

## What changed

<!-- One paragraph. What does this PR do and why. -->

## Phase / requirements

- Phase:
- FR / story IDs:

## Exit-gate criteria met

- [ ] `pnpm verify` exits 0 (lint + typecheck + test + build)
- [ ] Phase checklist items for this PR are ticked (link the checklist section)
- [ ] New behaviour has tests asserting behaviour, not implementation
- [ ] No secrets, no real farm/worker data, no real SA ID numbers (seed IDs invalid on purpose)

## Domain review (tick if the PR touches these)

- [ ] Payroll/compliance: `compliance-checker` run, no hardcoded regulated numbers, lookups by `occurred_at`
- [ ] Schema/sync: `sync-auditor` run, RLS + sync rules + API guards agree, offline path exercised

## Notes for the reviewer

<!-- Anything non-obvious, trade-offs made, follow-ups deferred. -->
