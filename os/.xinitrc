#!/bin/bash

set -euo pipefail

export HOME="${HOME:-/home/arcade1}"
export USER="${USER:-arcade1}"
export LOGNAME="${LOGNAME:-$USER}"

RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/1000}"
if [[ ! -d "$RUNTIME_DIR" || ! -w "$RUNTIME_DIR" ]]; then
  RUNTIME_DIR="/tmp/arcade-ui-runtime"
fi
install -d -m 0700 "$RUNTIME_DIR"
install -d -m 0700 "$RUNTIME_DIR/dconf"

export XDG_RUNTIME_DIR="$RUNTIME_DIR"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=${XDG_RUNTIME_DIR}/bus}"

if [[ -S "/run/user/1000/pulse/native" ]]; then
  export PULSE_SERVER="unix:/run/user/1000/pulse/native"
else
  unset PULSE_SERVER
fi

xsetroot -solid black
xset s off
xset -dpms
xset s noblank

command -v unclutter >/dev/null 2>&1 && unclutter &

KIOSK_PROFILE_DIR="/tmp/arcade-ui-chromium-profile"
rm -rf "$KIOSK_PROFILE_DIR"
install -d -m 0700 "$KIOSK_PROFILE_DIR"

WINDOW_SIZE="$(xwininfo -root 2>/dev/null | awk '/-geometry/ { split($2, parts, "+"); print parts[1]; exit }')"
if [[ -z "$WINDOW_SIZE" ]]; then
  WINDOW_SIZE="1440x900"
fi

CHROMIUM_CMD=(
  /usr/lib/chromium/chromium
  --kiosk \
  http://localhost:5174 \
  --autoplay-policy=no-user-gesture-required \
  --window-position=0,0 \
  --window-size="${WINDOW_SIZE/x/,}" \
  --start-fullscreen \
  --no-first-run \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-restore-session-state \
  --disable-features=PaintHolding \
  --enable-gpu-rasterization \
  --enable-zero-copy \
  --ignore-gpu-blocklist \
  --ozone-platform=x11 \
  --default-background-color=000000 \
  --user-data-dir="$KIOSK_PROFILE_DIR"
)

if command -v dbus-run-session >/dev/null 2>&1; then
  exec dbus-run-session -- "${CHROMIUM_CMD[@]}"
fi

exec "${CHROMIUM_CMD[@]}"
