#!/bin/bash

xsetroot -solid black

# disable screen blanking
xset s off
xset -dpms
xset s noblank

unclutter &

# launch chromium
chromium-browser \
	--kiosk \
	http://localhost:5174 \
	--window-position=0,0 \
	--window-size=1440,900 \
	--start-fullscreen \
	--no-first-run \
	--disable-infobars \
	--disable-session-crashed-bubble \
	--disable-restore-session-state \
	--disable-features=PaintHolding
