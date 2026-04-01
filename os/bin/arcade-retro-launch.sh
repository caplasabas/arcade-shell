#!/usr/bin/env bash
set -euo pipefail

DISPLAY_VALUE="${ARCADE_RETRO_DISPLAY:-:1}"
VT_VALUE="${ARCADE_RETRO_VT:-vt1}"
SWITCH_TO_VT="${ARCADE_RETRO_SWITCH_TO_VT:-}"
SWITCH_DELAY_MS="${ARCADE_RETRO_SWITCH_DELAY_MS:-1200}"
SWITCH_SETTLE_MS="${ARCADE_RETRO_SWITCH_SETTLE_MS:-250}"
POST_SWITCH_READY_RETRIES="${ARCADE_RETRO_POST_SWITCH_READY_RETRIES:-15}"
POST_SWITCH_STABILIZE_MS="${ARCADE_RETRO_POST_SWITCH_STABILIZE_MS:-900}"
XORG_BIN="${ARCADE_RETRO_XORG_BIN:-/usr/lib/xorg/Xorg}"
SESSION_SCRIPT="${ARCADE_RETRO_SESSION_SCRIPT:-/opt/arcade/os/bin/arcade-retro-session.sh}"
XORG_LOG="${ARCADE_RETRO_XORG_LOG:-/tmp/arcade-game-xorg.log}"
SESSION_LOG="${ARCADE_RETRO_SESSION_LOG:-/tmp/arcade-game-session.log}"
PREWARMED_X="${ARCADE_RETRO_PREWARMED_X:-0}"
PREWARMED_X_SERVICE="${ARCADE_RETRO_XORG_SERVICE:-arcade-retro-x.service}"
XORG_READY_RETRIES="${ARCADE_RETRO_XORG_READY_RETRIES:-50}"
PREWARM_XORG_READY_RETRIES="${ARCADE_RETRO_PREWARM_XORG_READY_RETRIES:-3}"
XORG_READY_POLL_MS="${ARCADE_RETRO_XORG_READY_POLL_MS:-100}"
XSET_TIMEOUT_SEC="${ARCADE_RETRO_XSET_TIMEOUT_SEC:-1}"
PREWARM_RESTART_WAIT_MS="${ARCADE_RETRO_PREWARM_RESTART_WAIT_MS:-1500}"
PREWARM_FIRST_LAUNCH_REFRESH="${ARCADE_RETRO_PREWARM_FIRST_LAUNCH_REFRESH:-1}"
PREWARM_FIRST_LAUNCH_STAMP="${ARCADE_RETRO_PREWARM_FIRST_LAUNCH_STAMP:-/tmp/arcade-retro-prewarm-first-launch.ok}"

xorg_pid=""
session_pid=""

log() {
  printf '[arcade-retro-launch] %s\n' "$*" >&2
}

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

ms_to_seconds() {
  python3 - "$1" <<'PY'
import sys
value = 0
try:
    value = max(0, int(float(sys.argv[1])))
except Exception:
    value = 0
print(f"{value / 1000:.3f}")
PY
}

poll_seconds="$(ms_to_seconds "$XORG_READY_POLL_MS")"
prewarm_restart_wait_seconds="$(ms_to_seconds "$PREWARM_RESTART_WAIT_MS")"

if [[ "$PREWARMED_X" != "1" && ! -x "$XORG_BIN" ]]; then
  log "missing Xorg binary: $XORG_BIN"
  exit 1
fi

if [[ ! -x "$SESSION_SCRIPT" ]]; then
  log "missing session script: $SESSION_SCRIPT"
  exit 1
fi

probe_x_ready() {
  if command -v timeout >/dev/null 2>&1; then
    timeout "${XSET_TIMEOUT_SEC}s" env DISPLAY="$DISPLAY_VALUE" XAUTHORITY="" xset q >/dev/null 2>&1
    return $?
  fi

  env DISPLAY="$DISPLAY_VALUE" XAUTHORITY="" xset q >/dev/null 2>&1
}

wait_for_x_ready() {
  local retries="${1:-$XORG_READY_RETRIES}"
  local attempt

  for attempt in $(seq 1 "$retries"); do
    if probe_x_ready; then
      return 0
    fi
    sleep "$poll_seconds"
  done

  probe_x_ready
}

start_local_xorg() {
  if [[ ! -x "$XORG_BIN" ]]; then
    return 1
  fi

  : >"$XORG_LOG"
  "$XORG_BIN" "$DISPLAY_VALUE" "$VT_VALUE" -nocursor -nolisten tcp -ac >"$XORG_LOG" 2>&1 &
  xorg_pid="$!"
  log "started local Xorg pid=$xorg_pid display=$DISPLAY_VALUE vt=$VT_VALUE"
  return 0
}

recover_unresponsive_prewarmed_x() {
  if [[ "$PREWARMED_X" != "1" ]]; then
    return 1
  fi

  log "prewarmed X on $DISPLAY_VALUE did not respond; attempting service restart"

  if command -v systemctl >/dev/null 2>&1; then
    systemctl restart --no-block "$PREWARMED_X_SERVICE" >/dev/null 2>&1 || true
    sleep "$prewarm_restart_wait_seconds"

    if wait_for_x_ready "$PREWARM_XORG_READY_RETRIES"; then
      log "prewarmed X recovered after restarting $PREWARMED_X_SERVICE"
      return 0
    fi

    log "prewarmed X still unresponsive; stopping $PREWARMED_X_SERVICE and falling back to local Xorg"
    systemctl stop --no-block "$PREWARMED_X_SERVICE" >/dev/null 2>&1 || true
    sleep 0.5
  fi

  PREWARMED_X=0
  start_local_xorg || return 1
  wait_for_x_ready
}

maybe_refresh_first_launch_prewarmed_x() {
  if [[ "$PREWARMED_X" != "1" || "$PREWARM_FIRST_LAUNCH_REFRESH" != "1" ]]; then
    return 0
  fi

  if [[ -f "$PREWARM_FIRST_LAUNCH_STAMP" ]]; then
    return 0
  fi

  if ! command -v systemctl >/dev/null 2>&1; then
    return 0
  fi

  log "first launch after boot: refreshing prewarmed X service"
  systemctl restart --no-block "$PREWARMED_X_SERVICE" >/dev/null 2>&1 || true
  sleep "$prewarm_restart_wait_seconds"

  if wait_for_x_ready "$PREWARM_XORG_READY_RETRIES"; then
    : >"$PREWARM_FIRST_LAUNCH_STAMP"
    log "first-launch prewarmed X refresh complete"
    return 0
  fi

  log "first-launch prewarmed X refresh did not become ready in time"
  return 1
}

if [[ "$PREWARMED_X" != "1" ]]; then
  start_local_xorg
fi

if ! maybe_refresh_first_launch_prewarmed_x; then
  if ! recover_unresponsive_prewarmed_x; then
    log "prewarmed X failed first-launch refresh on $DISPLAY_VALUE"
    exit 1
  fi
fi

initial_ready_retries="$XORG_READY_RETRIES"
if [[ "$PREWARMED_X" == "1" ]]; then
  initial_ready_retries="$PREWARM_XORG_READY_RETRIES"
fi

if ! wait_for_x_ready "$initial_ready_retries"; then
  if ! recover_unresponsive_prewarmed_x; then
    log "Xorg did not become ready on $DISPLAY_VALUE"
    exit 1
  fi
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

post_switch_stabilize_seconds="$(python3 - "$POST_SWITCH_STABILIZE_MS" <<'PY'
import sys
value = 900
try:
    value = max(0, int(float(sys.argv[1])))
except Exception:
    value = 900
print(f"{value / 1000:.3f}")
PY
)"

if [[ -n "$SWITCH_TO_VT" ]]; then
  sleep "$switch_delay_seconds"
  chvt "$SWITCH_TO_VT" >/dev/null 2>&1 || true
  sleep "$switch_settle_seconds"

  if ! wait_for_x_ready "$POST_SWITCH_READY_RETRIES"; then
    if ! recover_unresponsive_prewarmed_x; then
      log "Xorg did not become ready after VT switch to $SWITCH_TO_VT"
      exit 1
    fi
  fi

  sleep "$post_switch_stabilize_seconds"
fi

DISPLAY="$DISPLAY_VALUE" XAUTHORITY="" "$SESSION_SCRIPT" >"$SESSION_LOG" 2>&1 &
session_pid="$!"

wait "$session_pid"
exit $?
