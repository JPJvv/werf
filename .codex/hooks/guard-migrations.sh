#!/usr/bin/env bash
# PreToolUse hook: block edits to migrations that are already applied/committed.
# New migration files are allowed; changing an existing one is not.
set -uo pipefail
cd "$(git rev-parse --show-toplevel 2>/dev/null || echo .)"

# Claude Code passes the tool input as JSON on stdin; extract the target path.
input="$(cat)"
path="$(printf '%s' "$input" | grep -oE '"file_path"[[:space:]]*:[[:space:]]*"[^"]+"' | head -1 | sed -E 's/.*"file_path"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')"

case "$path" in
  *migrations/*.sql)
    # Allow if the file is new (untracked and not yet committed).
    if git ls-files --error-unmatch "$path" >/dev/null 2>&1; then
      echo '{"decision":"block","reason":"This migration is already tracked. Applied migrations are immutable — create a NEW migration instead of editing this one."}'
      exit 0
    fi
    ;;
esac
echo '{"decision":"approve"}'
exit 0
