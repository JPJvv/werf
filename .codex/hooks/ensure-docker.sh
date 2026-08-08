#!/usr/bin/env bash
# SessionStart hook: make sure a container runtime is up before anyone runs the gate.
#
# WHY THIS EXISTS. `pnpm verify` is the definition of done, and 272 of its 806 tests are the
# testcontainers integration tier. With no Docker daemon they do not skip — they FAIL, thirteen
# files at once, with "Could not find a working container runtime strategy", and the gate exits 1.
# A session that opens without Docker therefore sees a red gate that has nothing to do with its own
# work, and the honest local figure is 534/806 rather than the 806 the docs claim. See STATUS.md
# §4 A10. This hook removes that failure mode instead of documenting it a third time.
#
# It NEVER blocks: it always exits 0. The worst case is a warning saying the integration tier
# cannot run, which is strictly better than thirteen confusing failures later.
set -uo pipefail

READY_TIMEOUT_SECONDS=60

emit() {
  # $1 = systemMessage (shown to the user), $2 = additionalContext (given to Claude)
  python3 -c '
import json, sys
print(json.dumps({
    "systemMessage": sys.argv[1],
    "suppressOutput": True,
    "hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": sys.argv[2]},
}))' "$1" "$2" 2>/dev/null || printf '{"systemMessage":%s}\n' "\"$1\""
}

docker_ready() { docker info >/dev/null 2>&1; }

# Already up — the overwhelmingly common case. Say nothing, cost nothing.
if docker_ready; then
  exit 0
fi

# Not up. Find the launcher for this platform.
launched=""
case "$(uname -s)" in
  MINGW* | MSYS* | CYGWIN*)
    for exe in \
      "/c/Program Files/Docker/Docker/Docker Desktop.exe" \
      "$LOCALAPPDATA/Docker/Docker Desktop.exe"; do
      if [ -f "$exe" ]; then
        "$exe" >/dev/null 2>&1 &
        launched="Docker Desktop"
        break
      fi
    done
    ;;
  Darwin)
    if [ -d "/Applications/Docker.app" ]; then
      open -a Docker >/dev/null 2>&1 && launched="Docker Desktop"
    fi
    ;;
  Linux)
    # Rootless/systemd installs vary too much to guess at; only try the user unit.
    systemctl --user start docker-desktop >/dev/null 2>&1 && launched="docker-desktop"
    ;;
esac

if [ -z "$launched" ]; then
  emit "⚠️ Docker is not running and no launcher was found — the integration tier (272 of 806 tests) will FAIL, not skip. Start Docker, then re-run pnpm verify." \
    "Docker is NOT running on this machine and could not be started automatically. pnpm verify will exit 1 on 13 testcontainers files with 'Could not find a working container runtime strategy'. That is an environment condition, NOT a code defect (STATUS.md §4 A10) — do not chase it as one. Unit tests still run: 534 of 806."
  exit 0
fi

# Poll rather than sleeping a fixed block: a warm daemon is ready in a second or two.
waited=0
while [ "$waited" -lt "$READY_TIMEOUT_SECONDS" ]; do
  if docker_ready; then
    emit "🐳 $launched was not running — started it, ready after ${waited}s. The integration tier can run." \
      "Docker was down at session start and this hook started it. It is ready now, so pnpm verify can run all 806 tests."
    exit 0
  fi
  sleep 3
  waited=$((waited + 3))
done

emit "⚠️ Started $launched but it was not ready within ${READY_TIMEOUT_SECONDS}s — give it a moment before running pnpm verify." \
  "Docker was started but did not become ready within ${READY_TIMEOUT_SECONDS}s. It is probably still coming up. If pnpm verify fails on 'Could not find a working container runtime strategy', wait and re-run rather than treating it as a code defect (STATUS.md §4 A10)."
exit 0
