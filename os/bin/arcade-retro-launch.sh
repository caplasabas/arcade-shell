#!/usr/bin/env bash
set -euo pipefail

DISPLAY_VALUE="${ARCADE_RETRO_DISPLAY:-:1}"
VT_VALUE="${ARCADE_RETRO_VT:-vt1}"
SWITCH_TO_VT="${ARCADE_RETRO_SWITCH_TO_VT:-}"
SWITCH_DELAY_MS="${ARCADE_RETRO_SWITCH_DELAY_MS:-1200}"
SWITCH_SETTLE_MS="${ARCADE_RETRO_SWITCH_SETTLE_MS:-250}"
POST_SWITCH_READY_RETRIES="${ARCADE_RETRO_POST_SWITCH_READY_RETRIES:-15}"
POST_SWITCH_STABILIZE_MS="${ARCADE_RETRO_POST_SWITCH_STABILIZE_MS:-900}"
SESSION_READY_FILE="${ARCADE_RETRO_READY_FILE:-/tmp/arcade-retro-session.ready}"
SESSION_READY_TIMEOUT_MS="${ARCADE_RETRO_READY_TIMEOUT_MS:-7000}"
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
PREWARM_FIRST_LAUNCH_STABILIZE_MS="${ARCADE_RETRO_PREWARM_FIRST_LAUNCH_STABILIZE_MS:-2200}"
PREWARM_CLIENT_ENABLE="${ARCADE_RETRO_PREWARM_CLIENT_ENABLE:-1}"
PREWARM_CLIENT_DURATION_MS="${ARCADE_RETRO_PREWARM_CLIENT_DURATION_MS:-2500}"
PREWARM_CLIENT_CLEAR_SETTLE_MS="${ARCADE_RETRO_PREWARM_CLIENT_CLEAR_SETTLE_MS:-600}"
PREWARM_CLIENT_LOG="${ARCADE_RETRO_PREWARM_CLIENT_LOG:-/tmp/arcade-retro-prewarm-client.log}"
PREWARM_CLIENT_APPEND_CONFIG="${ARCADE_RETRO_PREWARM_CLIENT_APPEND_CONFIG:-/tmp/arcade-retro-prewarm-client.cfg}"
RETROARCH_BIN="${ARCADE_RETRO_BIN:-/usr/bin/retroarch}"
RETROARCH_CONFIG_PATH="${ARCADE_RETRO_CONFIG_PATH:-/opt/arcade/os/retroarch.cfg}"
RETROARCH_APPEND_CONFIG="${ARCADE_RETRO_APPEND_CONFIG:-/opt/arcade/os/retroarch-single-x.cfg}"
RETRO_RUN_USER="${ARCADE_RETRO_RUN_USER:-arcade1}"
RETRO_RUN_HOME="${ARCADE_RETRO_RUN_HOME:-/home/${RETRO_RUN_USER}}"
RETRO_XDG_RUNTIME_DIR="${ARCADE_RETRO_XDG_RUNTIME_DIR:-/run/user/1000}"
RETRO_DBUS_ADDRESS="${ARCADE_RETRO_DBUS_ADDRESS:-unix:path=${RETRO_XDG_RUNTIME_DIR}/bus}"
RETRO_PULSE_SERVER="${ARCADE_RETRO_PULSE_SERVER:-unix:${RETRO_XDG_RUNTIME_DIR}/pulse/native}"

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
prewarm_first_launch_stabilize_seconds="$(ms_to_seconds "$PREWARM_FIRST_LAUNCH_STABILIZE_MS")"
prewarm_client_duration_seconds="$(ms_to_seconds "$PREWARM_CLIENT_DURATION_MS")"
prewarm_client_clear_settle_seconds="$(ms_to_seconds "$PREWARM_CLIENT_CLEAR_SETTLE_MS")"

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
    env DISPLAY="$DISPLAY_VALUE" XAUTHORITY="" xsetroot -solid black >/dev/null 2>&1 || true
    sleep "$prewarm_first_launch_stabilize_seconds"
    log "first-launch prewarmed X refresh complete"
    return 0
  fi

  log "first-launch prewarmed X refresh did not become ready in time"
  return 1
}

run_as_arcade_user() {
  sudo -u "$RETRO_RUN_USER" env \
    DISPLAY="$DISPLAY_VALUE" \
    XAUTHORITY="" \
    HOME="$RETRO_RUN_HOME" \
    USER="$RETRO_RUN_USER" \
    LOGNAME="$RETRO_RUN_USER" \
    XDG_RUNTIME_DIR="$RETRO_XDG_RUNTIME_DIR" \
    DBUS_SESSION_BUS_ADDRESS="$RETRO_DBUS_ADDRESS" \
    PULSE_SERVER="$RETRO_PULSE_SERVER" \
    "$@"
}

maybe_warm_first_launch_client() {
  if [[ "$PREWARMED_X" != "1" || "$PREWARM_CLIENT_ENABLE" != "1" ]]; then
    return 0
  fi

  if [[ -f "$PREWARM_FIRST_LAUNCH_STAMP" ]]; then
    return 0
  fi

  if [[ ! -x "$RETROARCH_BIN" || ! -f "$RETROARCH_CONFIG_PATH" ]]; then
    : >"$PREWARM_FIRST_LAUNCH_STAMP"
    return 0
  fi

  : >"$PREWARM_CLIENT_APPEND_CONFIG"
  if [[ -f "$RETROARCH_APPEND_CONFIG" ]]; then
    cat "$RETROARCH_APPEND_CONFIG" >>"$PREWARM_CLIENT_APPEND_CONFIG"
    printf '\n' >>"$PREWARM_CLIENT_APPEND_CONFIG"
  fi
  cat >>"$PREWARM_CLIENT_APPEND_CONFIG" <<'EOF'
audio_enable = "false"
video_font_enable = "false"
menu_show_start_screen = "false"
EOF

  log "first launch after boot: warming RetroArch client on $DISPLAY_VALUE"
  : >"$PREWARM_CLIENT_LOG"
  local warmup_status=0
  if command -v timeout >/dev/null 2>&1; then
    timeout --signal=INT --kill-after=1s "${prewarm_client_duration_seconds}s" \
      bash -lc '
        exec sudo -u "$1" env \
          DISPLAY="$2" \
          XAUTHORITY="" \
          HOME="$3" \
          USER="$1" \
          LOGNAME="$1" \
          XDG_RUNTIME_DIR="$4" \
          DBUS_SESSION_BUS_ADDRESS="$5" \
          PULSE_SERVER="$6" \
          "$7" --menu --fullscreen --config "$8" --appendconfig "$9" --log-file "${10}"
      ' _ \
      "$RETRO_RUN_USER" \
      "$DISPLAY_VALUE" \
      "$RETRO_RUN_HOME" \
      "$RETRO_XDG_RUNTIME_DIR" \
      "$RETRO_DBUS_ADDRESS" \
      "$RETRO_PULSE_SERVER" \
      "$RETROARCH_BIN" \
      "$RETROARCH_CONFIG_PATH" \
      "$PREWARM_CLIENT_APPEND_CONFIG" \
      "$PREWARM_CLIENT_LOG" \
      >/dev/null 2>&1 || warmup_status=$?
  else
    run_as_arcade_user "$RETROARCH_BIN" \
      --menu \
      --fullscreen \
      --config "$RETROARCH_CONFIG_PATH" \
      --appendconfig "$PREWARM_CLIENT_APPEND_CONFIG" \
      --log-file "$PREWARM_CLIENT_LOG" \
      >/dev/null 2>&1 &
    local warmup_pid="$!"

    sleep "$prewarm_client_duration_seconds"
    kill -INT "$warmup_pid" >/dev/null 2>&1 || true
    sleep 0.5
    kill -TERM "$warmup_pid" >/dev/null 2>&1 || true
    sleep 0.5
    kill -KILL "$warmup_pid" >/dev/null 2>&1 || true
    wait "$warmup_pid" 2>/dev/null || warmup_status=$?
  fi

  pkill -f "retroarch --menu --fullscreen --config $RETROARCH_CONFIG_PATH --appendconfig $PREWARM_CLIENT_APPEND_CONFIG" >/dev/null 2>&1 || true

  env DISPLAY="$DISPLAY_VALUE" XAUTHORITY="" xsetroot -solid black >/dev/null 2>&1 || true
  sleep "$prewarm_client_clear_settle_seconds"

  : >"$PREWARM_FIRST_LAUNCH_STAMP"
  log "first-launch RetroArch warmup complete status=$warmup_status"
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

maybe_warm_first_launch_client

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
session_ready_timeout_seconds="$(ms_to_seconds "$SESSION_READY_TIMEOUT_MS")"

rm -f "$SESSION_READY_FILE"
DISPLAY="$DISPLAY_VALUE" XAUTHORITY="" ARCADE_RETRO_READY_FILE="$SESSION_READY_FILE" "$SESSION_SCRIPT" >"$SESSION_LOG" 2>&1 &
session_pid="$!"

if [[ -n "$SWITCH_TO_VT" ]]; then
  if command -v timeout >/dev/null 2>&1; then
    timeout "${session_ready_timeout_seconds}s" sh -c '
      while [ ! -f "$1" ]; do
        sleep 0.1
      done
    ' _ "$SESSION_READY_FILE" >/dev/null 2>&1 || log "session ready wait timed out after ${SESSION_READY_TIMEOUT_MS}ms"
  else
    local_wait_started=0
    while [[ ! -f "$SESSION_READY_FILE" && $local_wait_started -lt 70 ]]; do
      sleep 0.1
      local_wait_started=$((local_wait_started + 1))
    done
  fi

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

wait "$session_pid"
exit $?
