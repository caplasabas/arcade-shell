#!/usr/bin/env bash
set -e

CORE_NAME="$1"
ROM_PATH="$2"

CORE_PATH="/usr/lib/aarch64-linux-gnu/libretro/${CORE_NAME}_libretro.so"

# Switch to tty2 (game screen)
chvt 2
#sleep 1

retroarch \
  -L "$CORE_PATH" \
  "$ROM_PATH" \
  --fullscreen

# After exit, return to chromium VT (tty3)
#sleep 1
chvt 3
