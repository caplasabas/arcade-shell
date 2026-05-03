#!/usr/bin/env bash
set -euo pipefail

DISPLAY_VALUE="${DISPLAY:-:1}"
OVERLAY_ENABLE="${ARCADE_RETRO_OVERLAY_ENABLE:-1}"
OVERLAY_DELAY_MS="${ARCADE_RETRO_OVERLAY_DELAY_MS:-1700}"
OVERLAY_HEIGHT="${ARCADE_RETRO_OVERLAY_HEIGHT:-40}"
OVERLAY_POLL_MS="${ARCADE_RETRO_OVERLAY_POLL_MS:-250}"
OVERLAY_BIN="${ARCADE_RETRO_OVERLAY_BIN:-/opt/arcade/bin/arcade-retro-overlay}"
OVERLAY_HOST="${ARCADE_RETRO_OVERLAY_HOST:-127.0.0.1}"
OVERLAY_PORT="${ARCADE_RETRO_OVERLAY_PORT:-5174}"
OVERLAY_PATH="${ARCADE_RETRO_OVERLAY_PATH:-/arcade-life/overlay-state}"
OVERLAY_READY_RETRIES="${ARCADE_RETRO_OVERLAY_READY_RETRIES:-40}"
OVERLAY_READY_POLL_MS="${ARCADE_RETRO_OVERLAY_READY_POLL_MS:-250}"
OVERLAY_STABLE_MS="${ARCADE_RETRO_OVERLAY_STABLE_MS:-1200}"
CLIENT_READY_MARKER="${ARCADE_RETRO_CLIENT_READY_MARKER:-[INFO] [Environ]: SET_GEOMETRY.}"
CLIENT_READY_TIMEOUT_MS="${ARCADE_RETRO_CLIENT_READY_TIMEOUT_MS:-10000}"
CLIENT_READY_POLL_MS="${ARCADE_RETRO_CLIENT_READY_POLL_MS:-100}"
CLIENT_READY_SETTLE_MS="${ARCADE_RETRO_CLIENT_READY_SETTLE_MS:-1900}"
RETROARCH_BIN="${ARCADE_RETRO_BIN:-/usr/bin/retroarch}"
RETRO_RUN_USER="${ARCADE_RETRO_RUN_USER:-arcade1}"
RETRO_RUN_HOME="${ARCADE_RETRO_RUN_HOME:-/home/${RETRO_RUN_USER}}"
RETRO_XDG_RUNTIME_DIR="${ARCADE_RETRO_XDG_RUNTIME_DIR:-/run/user/1000}"
RETRO_DBUS_ADDRESS="${ARCADE_RETRO_DBUS_ADDRESS:-unix:path=${RETRO_XDG_RUNTIME_DIR}/bus}"
RETRO_PULSE_SERVER="${ARCADE_RETRO_PULSE_SERVER:-unix:${RETRO_XDG_RUNTIME_DIR}/pulse/native}"
RETROARCH_CORE_PATH="${ARCADE_RETRO_CORE_PATH:-}"
RETROARCH_ROM_PATH="${ARCADE_RETRO_ROM_PATH:-}"
RETROARCH_CONFIG_PATH="${ARCADE_RETRO_CONFIG_PATH:-}"
RETROARCH_APPEND_CONFIG="${ARCADE_RETRO_APPEND_CONFIG:-/opt/arcade/os/retroarch-single-x.cfg}"
RETROARCH_RUNTIME_INPUT_CONFIG="${ARCADE_RETRO_RUNTIME_INPUT_CONFIG:-/tmp/arcade-retro-input-runtime.cfg}"
RETROARCH_MERGED_APPEND_CONFIG="${ARCADE_RETRO_MERGED_APPEND_CONFIG:-/tmp/arcade-retro-appendconfig.cfg}"
RETROARCH_CLIENT_LOG="${ARCADE_RETRO_CLIENT_LOG:-/tmp/arcade-retroarch-client.log}"
SESSION_LOG_TARGET="${ARCADE_RETRO_SESSION_TRACE_LOG:-/tmp/arcade-retro-session-trace.log}"
SESSION_READY_FILE="${ARCADE_RETRO_READY_FILE:-/tmp/arcade-retro-session.ready}"
VIRTUAL_EVENT_RETRIES="${ARCADE_RETRO_VIRTUAL_EVENT_RETRIES:-25}"
VIRTUAL_EVENT_POLL_MS="${ARCADE_RETRO_VIRTUAL_EVENT_POLL_MS:-100}"
RUNTIME_INPUT_CONFIG_ENABLE="${ARCADE_RETRO_RUNTIME_INPUT_CONFIG_ENABLE:-0}"

log() {
  printf '[arcade-retro-session] %s\n' "$*" | tee -a "$SESSION_LOG_TARGET" >&2
}

if [[ -z "$RETROARCH_CORE_PATH" || -z "$RETROARCH_ROM_PATH" ]]; then
  log "missing ARCADE_RETRO_CORE_PATH or ARCADE_RETRO_ROM_PATH"
  exit 1
fi

export DISPLAY="$DISPLAY_VALUE"
rm -f "$SESSION_READY_FILE"
log "starting display=$DISPLAY_VALUE core=$RETROARCH_CORE_PATH rom=$RETROARCH_ROM_PATH"

wait_for_x_server() {
  local attempt
  for attempt in $(seq 1 50); do
    if xset q >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.1
  done

  echo "[arcade-retro-session] X server did not become ready on $DISPLAY_VALUE" >&2
  return 1
}

wait_for_x_server
log "X server ready"

xsetroot -solid black >/dev/null 2>&1 || true
xset s off >/dev/null 2>&1 || true
xset -dpms >/dev/null 2>&1 || true
xset s noblank >/dev/null 2>&1 || true

unclutter_pid=""
overlay_pid=""
retroarch_pid=""
session_ready_written="0"

cleanup() {
  if [[ -n "$overlay_pid" ]]; then
    kill "$overlay_pid" >/dev/null 2>&1 || true
    wait "$overlay_pid" 2>/dev/null || true
  fi

  if [[ -n "$unclutter_pid" ]]; then
    kill "$unclutter_pid" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

if command -v unclutter >/dev/null 2>&1; then
  unclutter >/dev/null 2>&1 &
  unclutter_pid="$!"
  log "unclutter pid=$unclutter_pid"
fi

run_as_arcade_user() {
  sudo -u "$RETRO_RUN_USER" env \
    DISPLAY="$DISPLAY_VALUE" \
    XAUTHORITY="${XAUTHORITY:-}" \
    HOME="$RETRO_RUN_HOME" \
    USER="$RETRO_RUN_USER" \
    LOGNAME="$RETRO_RUN_USER" \
    XDG_RUNTIME_DIR="$RETRO_XDG_RUNTIME_DIR" \
    DBUS_SESSION_BUS_ADDRESS="$RETRO_DBUS_ADDRESS" \
    PULSE_SERVER="$RETRO_PULSE_SERVER" \
    "$@"
}

mark_session_ready() {
  if [[ "$session_ready_written" == "1" ]]; then
    return
  fi
  : >"$SESSION_READY_FILE"
  session_ready_written="1"
  log "session ready file written $SESSION_READY_FILE"
}

read -r screen_width screen_height <<EOF
$(python3 - <<'PY'
import os
import re
import subprocess

fallback = ("1440", "900")
try:
    output = subprocess.check_output(["xrandr", "--current"], env=os.environ, text=True)
except Exception:
    print(*fallback)
    raise SystemExit(0)

match = re.search(r"current\s+(\d+)\s+x\s+(\d+)", output)
if match:
    print(match.group(1), match.group(2))
else:
    print(*fallback)
PY
)
EOF

if [[ -z "${screen_width:-}" || -z "${screen_height:-}" ]]; then
  screen_width="1440"
  screen_height="900"
fi

overlay_top=$((screen_height - OVERLAY_HEIGHT))
overlay_margin=$((OVERLAY_HEIGHT * 3 / 2))
overlay_top=$((overlay_top - overlay_margin))
if (( overlay_top < 0 )); then
  overlay_top=0
fi

launch_overlay() {
  if [[ "$OVERLAY_ENABLE" == "0" ]]; then
    return
  fi

  if [[ ! -x "$OVERLAY_BIN" ]]; then
    echo "[arcade-retro-session] overlay skipped, native overlay missing: $OVERLAY_BIN" >&2
    return
  fi

  if [[ -n "$overlay_pid" ]] && kill -0 "$overlay_pid" >/dev/null 2>&1; then
    log "overlay already running"
    return
  fi

  log "launching native overlay bin=$OVERLAY_BIN"

  run_as_arcade_user nice -n 10 "$OVERLAY_BIN" \
    --x 0 \
    --y "$overlay_top" \
    --width "$screen_width" \
    --height "$OVERLAY_HEIGHT" \
    --poll-ms "$OVERLAY_POLL_MS" \
    --host "$OVERLAY_HOST" \
    --port "$OVERLAY_PORT" \
    --path "$OVERLAY_PATH" \
    >/tmp/arcade-retro-overlay.log 2>&1 &

  overlay_pid="$!"
  log "overlay pid=$overlay_pid"
}

stop_overlay() {
  if [[ -z "$overlay_pid" ]]; then
    log "overlay stop requested"
    return
  fi

  if kill -0 "$overlay_pid" >/dev/null 2>&1; then
    kill "$overlay_pid" >/dev/null 2>&1 || true
    wait "$overlay_pid" 2>/dev/null || true
  fi

  log "overlay stopped"
  overlay_pid=""
}

get_event_index_by_name() {
  local target_name="$1"
  local name_file

  for name_file in /sys/class/input/event*/device/name; do
    [[ -f "$name_file" ]] || continue
    if [[ "$(cat "$name_file" 2>/dev/null)" == "$target_name" ]]; then
      basename "$(dirname "$(dirname "$name_file")")" | sed 's/^event//'
      return 0
    fi
  done

  return 1
}

get_virtual_event_poll_seconds() {
  python3 - "$VIRTUAL_EVENT_POLL_MS" <<'PY'
import sys
value = 100
try:
    value = max(25, int(float(sys.argv[1])))
except Exception:
    value = 100
print(f"{value / 1000:.3f}")
PY
}

wait_for_event_index_by_name() {
  local target_name="$1"
  local retries="$2"
  local poll_seconds
  local attempt
  local event_index=""

  poll_seconds="$(get_virtual_event_poll_seconds)"

  for attempt in $(seq 1 "$retries"); do
    event_index="$(get_event_index_by_name "$target_name" || true)"
    if [[ -n "$event_index" ]]; then
      printf '%s\n' "$event_index"
      return 0
    fi
    sleep "$poll_seconds"
  done

  return 1
}

write_runtime_input_config() {
  if [[ "$RUNTIME_INPUT_CONFIG_ENABLE" != "1" ]]; then
    log "runtime input config disabled"
    rm -f "$RETROARCH_RUNTIME_INPUT_CONFIG"
    return
  fi

  local p1_event p2_event

  p1_event="$(wait_for_event_index_by_name 'Arcade Virtual P1' "$VIRTUAL_EVENT_RETRIES" || true)"
  p2_event="$(wait_for_event_index_by_name 'Arcade Virtual P2' "$VIRTUAL_EVENT_RETRIES" || true)"

  if [[ -z "$p1_event" || -z "$p2_event" ]]; then
    log "runtime input config skipped: virtual event nodes not found after retries=${VIRTUAL_EVENT_RETRIES}"
    rm -f "$RETROARCH_RUNTIME_INPUT_CONFIG"
    return
  fi

  cat >"$RETROARCH_RUNTIME_INPUT_CONFIG" <<EOF
input_player1_joypad_index = "0"
input_player2_joypad_index = "1"
EOF

  log "runtime input config: P1 event=$p1_event reserved=Arcade Virtual P1, P2 event=$p2_event reserved=Arcade Virtual P2"
}

write_merged_append_config() {
  : >"$RETROARCH_MERGED_APPEND_CONFIG"

  if [[ -n "$RETROARCH_APPEND_CONFIG" && -f "$RETROARCH_APPEND_CONFIG" ]]; then
    cat "$RETROARCH_APPEND_CONFIG" >>"$RETROARCH_MERGED_APPEND_CONFIG"
    printf '\n' >>"$RETROARCH_MERGED_APPEND_CONFIG"
    log "including appendconfig=$RETROARCH_APPEND_CONFIG"
  fi

  if [[ -f "$RETROARCH_RUNTIME_INPUT_CONFIG" ]]; then
    cat "$RETROARCH_RUNTIME_INPUT_CONFIG" >>"$RETROARCH_MERGED_APPEND_CONFIG"
    printf '\n' >>"$RETROARCH_MERGED_APPEND_CONFIG"
    log "including runtime input config=$RETROARCH_RUNTIME_INPUT_CONFIG"
  fi

  if [[ ! -s "$RETROARCH_MERGED_APPEND_CONFIG" ]]; then
    rm -f "$RETROARCH_MERGED_APPEND_CONFIG"
    return 1
  fi

  return 0
}

get_overlay_delay_seconds() {
  python3 - "$OVERLAY_DELAY_MS" <<'PY'
import sys
value = 1200
try:
    value = max(0, int(float(sys.argv[1])))
except Exception:
    value = 1200
print(f"{value / 1000:.3f}")
PY
}

get_overlay_ready_poll_seconds() {
  python3 - "$OVERLAY_READY_POLL_MS" <<'PY'
import sys
value = 250
try:
    value = max(50, int(float(sys.argv[1])))
except Exception:
    value = 250
print(f"{value / 1000:.3f}")
PY
}

get_client_ready_poll_seconds() {
  python3 - "$CLIENT_READY_POLL_MS" <<'PY'
import sys
value = 100
try:
    value = max(25, int(float(sys.argv[1])))
except Exception:
    value = 100
print(f"{value / 1000:.3f}")
PY
}

get_client_ready_settle_seconds() {
  python3 - "$CLIENT_READY_SETTLE_MS" <<'PY'
import sys
value = 900
try:
    value = max(0, int(float(sys.argv[1])))
except Exception:
    value = 900
print(f"{value / 1000:.3f}")
PY
}

get_overlay_stable_seconds() {
  python3 - "$OVERLAY_STABLE_MS" <<'PY'
import sys
value = 1200
try:
    value = max(0, int(float(sys.argv[1])))
except Exception:
    value = 1200
print(f"{value / 1000:.3f}")
PY
}

wait_for_client_ready() {
  local attempts
  attempts="$(python3 - "$CLIENT_READY_TIMEOUT_MS" "$CLIENT_READY_POLL_MS" <<'PY'
import sys
timeout_ms = 10000
poll_ms = 100
try:
    timeout_ms = max(0, int(float(sys.argv[1])))
except Exception:
    pass
try:
    poll_ms = max(25, int(float(sys.argv[2])))
except Exception:
    pass
print(max(1, timeout_ms // poll_ms))
PY
)"
  local poll_seconds
  local attempt
  poll_seconds="$(get_client_ready_poll_seconds)"

  for attempt in $(seq 1 "$attempts"); do
    if [[ -f "$RETROARCH_CLIENT_LOG" ]] && grep -Fq "$CLIENT_READY_MARKER" "$RETROARCH_CLIENT_LOG"; then
      log "client ready marker observed: $CLIENT_READY_MARKER"
      return 0
    fi

    if [[ -n "$retroarch_pid" ]] && ! kill -0 "$retroarch_pid" >/dev/null 2>&1; then
      log "client ready wait aborted: RetroArch exited before marker"
      return 1
    fi

    sleep "$poll_seconds"
  done

  log "client ready marker not observed within ${CLIENT_READY_TIMEOUT_MS}ms; continuing"
  return 0
}

wait_for_overlay_stable() {
  local stable_seconds
  stable_seconds="$(get_overlay_stable_seconds)"

  if [[ -z "$overlay_pid" ]]; then
    log "overlay stability check skipped: overlay pid missing"
    return 1
  fi

  sleep "$stable_seconds"
  if kill -0 "$overlay_pid" >/dev/null 2>&1; then
    log "overlay stable for ${OVERLAY_STABLE_MS}ms pid=$overlay_pid"
    return 0
  fi

  log "overlay exited before stable window elapsed"
  return 1
}

wait_for_overlay_state() {
  if ! command -v curl >/dev/null 2>&1; then
    log "overlay readiness skipped: curl missing"
    return 0
  fi

  local overlay_url="http://${OVERLAY_HOST}:${OVERLAY_PORT}${OVERLAY_PATH}"
  local poll_seconds
  local attempt
  poll_seconds="$(get_overlay_ready_poll_seconds)"

  for attempt in $(seq 1 "$OVERLAY_READY_RETRIES"); do
    if curl -fsS --max-time 1 "$overlay_url" >/dev/null 2>&1; then
      log "overlay endpoint ready attempt=$attempt url=$overlay_url"
      return 0
    fi

    if [[ -n "$retroarch_pid" ]] && ! kill -0 "$retroarch_pid" >/dev/null 2>&1; then
      log "overlay readiness aborted: RetroArch exited before endpoint became ready"
      return 1
    fi

    sleep "$poll_seconds"
  done

  log "overlay endpoint did not become ready in time; launching overlay anyway"
  return 0
}

launch_overlay_after_delay() {
  local delay_seconds
  local settle_seconds
  delay_seconds="$(get_overlay_delay_seconds)"
  settle_seconds="$(get_client_ready_settle_seconds)"

  sleep "$delay_seconds"

  while [[ -n "$retroarch_pid" ]] && kill -0 "$retroarch_pid" >/dev/null 2>&1; do
    wait_for_client_ready || return 0
    wait_for_overlay_state || return 0
    launch_overlay
    wait_for_overlay_stable || return 0
    sleep "$settle_seconds"
    mark_session_ready
    return
  done
}

retroarch_args=(--fullscreen --verbose)
if [[ -n "$RETROARCH_CONFIG_PATH" ]]; then
  retroarch_args+=(--config "$RETROARCH_CONFIG_PATH")
fi
write_runtime_input_config
if write_merged_append_config; then
  retroarch_args+=(--appendconfig "$RETROARCH_MERGED_APPEND_CONFIG")
  log "using merged appendconfig=$RETROARCH_MERGED_APPEND_CONFIG"
fi
retroarch_args+=(--log-file "$RETROARCH_CLIENT_LOG")
retroarch_args+=(-L "$RETROARCH_CORE_PATH" "$RETROARCH_ROM_PATH")
log "launching retroarch as $RETRO_RUN_USER"

rm -f "$RETROARCH_CLIENT_LOG" /tmp/arcade-retro-overlay.log

run_as_arcade_user "$RETROARCH_BIN" "${retroarch_args[@]}" &
retroarch_pid="$!"
log "retroarch pid=$retroarch_pid"

if [[ "$OVERLAY_ENABLE" != "0" ]]; then
  launch_overlay_after_delay &
else
  wait_for_client_ready || true
  mark_session_ready
fi

wait "$retroarch_pid"
retroarch_status=$?
log "retroarch exited status=$retroarch_status"
exit $retroarch_status
