#!/bin/bash

xsetroot -solid black
xset s off
xset -dpms
xset s noblank

command -v unclutter >/dev/null 2>&1 && unclutter &

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
  --ozone-platform=x11
