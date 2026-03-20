#!/bin/bash

set -euo pipefail

export HOME="${HOME:-/home/arcade1}"
export USER="${USER:-arcade1}"
export LOGNAME="${LOGNAME:-$USER}"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/1000}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=${XDG_RUNTIME_DIR}/bus}"
export PULSE_SERVER="${PULSE_SERVER:-unix:${XDG_RUNTIME_DIR}/pulse/native}"

xsetroot -solid black
xset s off
xset -dpms
xset s noblank

command -v unclutter >/dev/null 2>&1 && unclutter &

KIOSK_PROFILE_DIR="/tmp/arcade-ui-chromium-profile"
rm -rf "$KIOSK_PROFILE_DIR"
install -d -m 0700 "$KIOSK_PROFILE_DIR"

exec /usr/lib/chromium/chromium \
  --kiosk \
  http://localhost:5174 \
  --window-position=0,0 \
  --window-size=1440,900 \
  --start-fullscreen \
  --no-first-run \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-restore-session-state \
  --disable-features=PaintHolding \
  --disable-gpu \
  --disable-gpu-rasterization \
  --disable-gpu-compositing \
  --ozone-platform=x11 \
  --default-background-color=000000 \
  --user-data-dir="$KIOSK_PROFILE_DIR"
