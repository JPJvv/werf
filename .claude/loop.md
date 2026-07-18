# /loop — the default working prompt

Work the current phase from `docs/04-delivery/phase-checklists.md`, one checklist item at a time.

For each item:
1. State which checklist item and which FR/story ID you are doing.
2. Make the smallest change that satisfies it, following `.claude/rules/*`.
3. Write or update the test that proves the behaviour (not the implementation).
4. Run `pnpm verify`. Do not move on until it exits 0.
5. Commit with a Conventional message referencing the FR/story ID.

At the end of the phase, invoke the `reviewer` agent against the phase exit gate. If the phase touched
payroll/compliance, also invoke `compliance-checker`; if it touched schema/sync, also `sync-auditor`.
Stop and ask me before: opening a PR, running a destructive migration, or anything the settings mark `ask`.
