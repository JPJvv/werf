#!/usr/bin/env bash
#
# Warn (never block) when an edited source file reintroduces one of the two defect
# classes this repo keeps relapsing into. Set 2026-07-30 by JP (STATUS §2.1c).
#
#   1. navigator.onLine in a write path — "offline is the default state, not the
#      error state" (.claude/rules/frontend.md). Allowed only in the sync-status
#      hook and in explicitly display-only reads.
#   2. toISOString().slice(0,10) — wrong for ~2 hours a day in South Africa. Use
#      the farm's zone via farmLocalDay / farmToday. Found in production twice, in
#      test assertions once, and in an e2e fixture once.
#
# Test files and fixtures legitimately carry these shapes, so they are skipped.
# ALWAYS exits 0: this warns, it never blocks a save.

set -uo pipefail

# The harness sets CLAUDE_FILE_PATH for Edit|Write hooks (same as the sibling
# prettier/eslint hook). Fall back to parsing the PostToolUse JSON on stdin.
input="$(cat 2>/dev/null || true)"
file="${CLAUDE_FILE_PATH:-}"
if [ -z "$file" ]; then
  file="$(printf '%s' "$input" | sed -n 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
fi

[ -z "$file" ] && exit 0
[ -f "$file" ] || exit 0

case "$file" in
  *.test.ts | *.test.tsx | *.spec.ts | *.spec.tsx) exit 0 ;;
esac

warn=""

online="$(grep -nE 'navigator\.onLine' "$file" 2>/dev/null | grep -vE 'useSyncStatus|// *display' || true)"
if [ -n "$online" ]; then
  warn="${warn}  navigator.onLine in a write path — offline is the default state, not the error state (.claude/rules/frontend.md):
$(printf '%s' "$online" | sed 's/^/    /')
"
fi

slice="$(grep -nE 'toISOString\(\)\.slice\(0, *10\)' "$file" 2>/dev/null || true)"
if [ -n "$slice" ]; then
  warn="${warn}  toISOString().slice(0,10) — wrong ~2h/day in SA; use farmLocalDay / farmToday:
$(printf '%s' "$slice" | sed 's/^/    /')
"
fi

if [ -n "$warn" ]; then
  printf '⚠ defect-class check on %s\n%s' "$file" "$warn"
fi

exit 0
