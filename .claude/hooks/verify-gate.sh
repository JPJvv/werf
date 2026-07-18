#!/usr/bin/env bash
# Stop hook: block a turn from ending until `pnpm verify` passes.
# Escape hatch: create .claude/gate-off (git-ignored) to disable temporarily.
set -uo pipefail
cd "$(git rev-parse --show-toplevel 2>/dev/null || echo .)"

if [ -f .claude/gate-off ]; then
  echo '{"decision":"approve","reason":"gate-off present — verify skipped"}'
  exit 0
fi

# No package.json yet (pre-scaffold): let the turn end so the scaffold can be built.
if [ ! -f package.json ]; then
  echo '{"decision":"approve","reason":"no package.json yet — scaffold phase"}'
  exit 0
fi

if pnpm verify >/tmp/werf-verify.log 2>&1; then
  echo '{"decision":"approve","reason":"pnpm verify passed"}'
  exit 0
else
  tail -c 4000 /tmp/werf-verify.log 1>&2
  echo '{"decision":"block","reason":"pnpm verify failed — fix lint/typecheck/test/build before ending the turn. See stderr."}'
  exit 0
fi
