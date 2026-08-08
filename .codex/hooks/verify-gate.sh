#!/usr/bin/env bash
# Stop hook: block a turn from ending until `pnpm verify` passes.
# Escape hatch: create .claude/gate-off (git-ignored) to disable temporarily.
set -uo pipefail
cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || echo .)}"

if [ -f .claude/gate-off ]; then
  echo '{"decision":"approve","reason":"gate-off present — verify skipped"}'
  exit 0
fi

# No package.json yet (pre-scaffold): let the turn end so the scaffold can be built.
if [ ! -f package.json ]; then
  echo '{"decision":"approve","reason":"no package.json yet — scaffold phase"}'
  exit 0
fi

# Fingerprint the exact working-tree state: HEAD, every tracked modification, and
# the contents of every untracked file. If it is byte-identical to a state that
# ALREADY passed, the answer cannot have changed — skip the run rather than spend
# another ~81s median (p90 155s, worst 218s) re-proving it. Turns that only asked
# a question or edited a doc were paying full price for a known result.
#
# Only PASSES are ever cached. A failure re-runs, so the gate can never be
# skipped into a green state it did not earn.
CACHE=".claude/.verify-passed"
fingerprint() {
  {
    git rev-parse HEAD 2>/dev/null
    git diff HEAD 2>/dev/null
    git ls-files --others --exclude-standard -z 2>/dev/null | xargs -0 -r sha1sum 2>/dev/null
  } | sha1sum | cut -d' ' -f1
}
FP="$(fingerprint)"

if [ -n "$FP" ] && [ -f "$CACHE" ] && [ "$(cat "$CACHE" 2>/dev/null)" = "$FP" ]; then
  echo '{"decision":"approve","reason":"working tree unchanged since the last passing pnpm verify — gate skipped"}'
  exit 0
fi

if pnpm verify >/tmp/werf-verify.log 2>&1; then
  [ -n "$FP" ] && printf '%s' "$FP" >"$CACHE" 2>/dev/null
  echo '{"decision":"approve","reason":"pnpm verify passed"}'
  exit 0
else
  rm -f "$CACHE" 2>/dev/null
  tail -c 4000 /tmp/werf-verify.log 1>&2
  echo '{"decision":"block","reason":"pnpm verify failed — fix lint/typecheck/test/build before ending the turn. See stderr."}'
  exit 0
fi
