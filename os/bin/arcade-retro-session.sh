#!/usr/bin/env bash
set -euo pipefail

DISPLAY_VALUE="${DISPLAY:-:1}"
OVERLAY_ENABLE="${ARCADE_RETRO_OVERLAY_ENABLE:-1}"
OVERLAY_DELAY_MS="${ARCADE_RETRO_OVERLAY_DELAY_MS:-700}"
OVERLAY_HEIGHT="${ARCADE_RETRO_OVERLAY_HEIGHT:-40}"
OVERLAY_POLL_MS="${ARCADE_RETRO_OVERLAY_POLL_MS:-250}"
OVERLAY_BIN="${ARCADE_RETRO_OVERLAY_BIN:-/opt/arcade/bin/arcade-retro-overlay}"
OVERLAY_HOST="${ARCADE_RETRO_OVERLAY_HOST:-127.0.0.1}"
OVERLAY_PORT="${ARCADE_RETRO_OVERLAY_PORT:-5174}"
OVERLAY_PATH="${ARCADE_RETRO_OVERLAY_PATH:-/arcade-life/overlay-state}"
RETROARCH_BIN="${ARCADE_RETRO_BIN:-retroarch}"
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
RETROARCH_CLIENT_LOG="${ARCADE_RETRO_CLIENT_LOG:-/tmp/arcade-retroarch-client.log}"
SESSION_LOG_TARGET="${ARCADE_RETRO_SESSION_TRACE_LOG:-/tmp/arcade-retro-session-trace.log}"

log() {
  printf '[arcade-retro-session] %s\n' "$*" | tee -a "$SESSION_LOG_TARGET" >&2
}

if [[ -z "$RETROARCH_CORE_PATH" || -z "$RETROARCH_ROM_PATH" ]]; then
  log "missing ARCADE_RETRO_CORE_PATH or ARCADE_RETRO_ROM_PATH"
  exit 1
fi

export DISPLAY="$DISPLAY_VALUE"
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

xsetroot -solid black
xset s off
xset -dpms
xset s noblank

unclutter_pid=""
overlay_pid=""
retroarch_pid=""

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

write_runtime_input_config() {
  local p1_event p2_event p1_index p2_index

  p1_event="$(get_event_index_by_name 'Arcade Virtual P1' || true)"
  p2_event="$(get_event_index_by_name 'Arcade Virtual P2' || true)"

  if [[ -z "$p1_event" || -z "$p2_event" ]]; then
    log "runtime input config skipped: virtual event nodes not found"
    rm -f "$RETROARCH_RUNTIME_INPUT_CONFIG"
    return
  fi

  if (( p1_event < p2_event )); then
    p1_index=0
    p2_index=1
  else
    p1_index=1
    p2_index=0
  fi

  cat >"$RETROARCH_RUNTIME_INPUT_CONFIG" <<EOF
input_player1_joypad_index = "$p1_index"
input_player1_reserved_device = "0000:0000 Arcade Virtual P1"
input_player2_joypad_index = "$p2_index"
input_player2_reserved_device = "0000:0000 Arcade Virtual P2"
EOF

  log "runtime input config: P1 event=$p1_event index=$p1_index, P2 event=$p2_event index=$p2_index"
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

launch_overlay_after_delay() {
  local delay_seconds
  delay_seconds="$(get_overlay_delay_seconds)"

  sleep "$delay_seconds"

  while [[ -n "$retroarch_pid" ]] && kill -0 "$retroarch_pid" >/dev/null 2>&1; do
    launch_overlay
    return
  done
}

retroarch_args=(--fullscreen --verbose)
if [[ -n "$RETROARCH_CONFIG_PATH" ]]; then
  retroarch_args+=(--config "$RETROARCH_CONFIG_PATH")
fi
if [[ -n "$RETROARCH_APPEND_CONFIG" && -f "$RETROARCH_APPEND_CONFIG" ]]; then
  retroarch_args+=(--appendconfig "$RETROARCH_APPEND_CONFIG")
  log "using appendconfig=$RETROARCH_APPEND_CONFIG"
fi
write_runtime_input_config
if [[ -f "$RETROARCH_RUNTIME_INPUT_CONFIG" ]]; then
  retroarch_args+=(--appendconfig "$RETROARCH_RUNTIME_INPUT_CONFIG")
  log "using runtime appendconfig=$RETROARCH_RUNTIME_INPUT_CONFIG"
fi
retroarch_args+=(--log-file "$RETROARCH_CLIENT_LOG")
retroarch_args+=(-L "$RETROARCH_CORE_PATH" "$RETROARCH_ROM_PATH")
log "launching retroarch as $RETRO_RUN_USER"

run_as_arcade_user "$RETROARCH_BIN" "${retroarch_args[@]}" &
retroarch_pid="$!"
log "retroarch pid=$retroarch_pid"

if [[ "$OVERLAY_ENABLE" != "0" ]]; then
  launch_overlay_after_delay &
fi

wait "$retroarch_pid"
retroarch_status=$?
log "retroarch exited status=$retroarch_status"
exit $retroarch_status
