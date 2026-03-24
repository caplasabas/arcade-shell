#!/usr/bin/env bash
set -euo pipefail

DISPLAY_VALUE="${ARCADE_RETRO_DISPLAY:-:1}"
VT_VALUE="${ARCADE_RETRO_VT:-vt1}"
SWITCH_TO_VT="${ARCADE_RETRO_SWITCH_TO_VT:-}"
SWITCH_DELAY_MS="${ARCADE_RETRO_SWITCH_DELAY_MS:-1200}"
SWITCH_SETTLE_MS="${ARCADE_RETRO_SWITCH_SETTLE_MS:-250}"
XORG_BIN="${ARCADE_RETRO_XORG_BIN:-/usr/lib/xorg/Xorg}"
SESSION_SCRIPT="${ARCADE_RETRO_SESSION_SCRIPT:-/opt/arcade/os/bin/arcade-retro-session.sh}"
XORG_LOG="${ARCADE_RETRO_XORG_LOG:-/tmp/arcade-game-xorg.log}"
SESSION_LOG="${ARCADE_RETRO_SESSION_LOG:-/tmp/arcade-game-session.log}"
PREWARMED_X="${ARCADE_RETRO_PREWARMED_X:-0}"

xorg_pid=""
session_pid=""

cleanup() {
  if [[ -n "$session_pid" ]]; then
    kill "$session_pid" >/dev/null 2>&1 || true
    wait "$session_pid" 2>/dev/null || true
  fi
  if [[ -n "$xorg_pid" ]]; then
    kill "$xorg_pid" >/dev/null 2>&1 || true
    wait "$xorg_pid" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

if [[ "$PREWARMED_X" != "1" && ! -x "$XORG_BIN" ]]; then
  echo "[arcade-retro-launch] missing Xorg binary: $XORG_BIN" >&2
  exit 1
fi

if [[ ! -x "$SESSION_SCRIPT" ]]; then
  echo "[arcade-retro-launch] missing session script: $SESSION_SCRIPT" >&2
  exit 1
fi

if [[ "$PREWARMED_X" != "1" ]]; then
  "$XORG_BIN" "$DISPLAY_VALUE" "$VT_VALUE" -nocursor -nolisten tcp -ac >"$XORG_LOG" 2>&1 &
  xorg_pid="$!"
fi

for _ in $(seq 1 50); do
  if DISPLAY="$DISPLAY_VALUE" xset q >/dev/null 2>&1; then
    break
  fi
  sleep 0.1
done

if ! DISPLAY="$DISPLAY_VALUE" xset q >/dev/null 2>&1; then
  echo "[arcade-retro-launch] Xorg did not become ready on $DISPLAY_VALUE" >&2
  exit 1
fi

switch_delay_seconds="$(python3 - "$SWITCH_DELAY_MS" <<'PY'
import sys
value = 1200
try:
    value = max(0, int(float(sys.argv[1])))
except Exception:
    value = 1200
print(f"{value / 1000:.3f}")
PY
)"

switch_settle_seconds="$(python3 - "$SWITCH_SETTLE_MS" <<'PY'
import sys
value = 250
try:
    value = max(0, int(float(sys.argv[1])))
except Exception:
    value = 250
print(f"{value / 1000:.3f}")
PY
)"

if [[ -n "$SWITCH_TO_VT" ]]; then
  sleep "$switch_delay_seconds"
  chvt "$SWITCH_TO_VT" >/dev/null 2>&1 || true
  sleep "$switch_settle_seconds"
fi

DISPLAY="$DISPLAY_VALUE" XAUTHORITY="" "$SESSION_SCRIPT" >"$SESSION_LOG" 2>&1 &
session_pid="$!"

wait "$session_pid"
exit $?
