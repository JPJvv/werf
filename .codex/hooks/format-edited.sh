#!/usr/bin/env bash
#
# PostToolUse hook: format the ONE file that was just edited.
#
# Replaces an inline hook that used "$CLAUDE_FILE_PATH". That variable is never
# set — Claude Code passes tool input as JSON on stdin (which is why the sibling
# guard-migrations.sh parses stdin). The consequences, measured over 1,884 runs:
#
#   * `prettier --write ""` fell back to the whole repo — ~300 files, ~4.7s per
#     edit, and unrelated files landing formatted in the diff.
#   * `eslint --fix ""` errored out every time, so autofix never once ran.
#
# eslint is deliberately NOT run here: `pnpm verify` (Stop hook + CI) already
# runs `eslint .` over everything, and a per-file run costs ~2.1s to duplicate
# a check that is about to happen anyway. Formatting is the part that has to be
# immediate, because it is what the next diff shows.
#
# ALWAYS exits 0: this tidies, it never blocks a save.

set -uo pipefail
cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || echo .)}" || exit 0

input="$(cat 2>/dev/null || true)"
file="$(printf '%s' "$input" | sed -n 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"

[ -z "$file" ] && exit 0
[ -f "$file" ] || exit 0

# Only what prettier actually handles. An unmatched extension must exit rather
# than reach prettier with no usable target — that is the bug this file fixes.
case "$file" in
  *.ts | *.tsx | *.js | *.jsx | *.mjs | *.cjs | *.json | *.css | *.md | *.yml | *.yaml | *.html) ;;
  *) exit 0 ;;
esac

# node_modules/.bin directly, not `pnpm exec`: same binary, ~0.6s instead of ~1.3s.
bin="node_modules/.bin/prettier"
[ -x "$bin" ] || bin="$(command -v prettier 2>/dev/null || true)"
[ -n "$bin" ] || exit 0

"$bin" --write "$file" >/dev/null 2>&1

exit 0
