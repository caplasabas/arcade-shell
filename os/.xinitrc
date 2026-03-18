#!/bin/bash
set -e

xsetroot -solid black
xset s off
xset -dpms
xset s noblank

command -v unclutter >/dev/null 2>&1 && unclutter &

UI_URL="http://127.0.0.1:${ARCADE_UI_PORT:-5174}"

wait_for_ui() {
  local i
  for i in $(seq 1 20); do
    if command -v curl >/dev/null 2>&1; then
      if curl -fsS "$UI_URL" >/dev/null 2>&1; then
        return 0
      fi
    elif command -v wget >/dev/null 2>&1; then
      if wget -q -O /dev/null "$UI_URL"; then
        return 0
      fi
    elif command -v nc >/dev/null 2>&1; then
      if nc -z 127.0.0.1 "${ARCADE_UI_PORT:-5174}" >/dev/null 2>&1; then
        return 0
      fi
    fi
    sleep 1
  done

  echo "[xinitrc] UI server did not become ready at $UI_URL" >&2
  return 1
}

wait_for_ui

exec /usr/lib/chromium/chromium \
  --kiosk \
  "$UI_URL" \
  --window-position=0,0 \
  --window-size=1440,900 \
  --start-fullscreen \
  --no-first-run \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-restore-session-state \
  --disable-features=PaintHolding \
  --autoplay-policy=no-user-gesture-required
