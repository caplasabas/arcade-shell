#!/bin/bash
set -e

echo "[BOOT] Arcade system starting..."

BASE_DIR="$HOME/arcade"
SERVICE_DIR="$BASE_DIR/service"
UI_DIR="$BASE_DIR/menu-ui"

# Kill stale processes
pkill -f node || true
pkill -f Chromium || true
pkill -f retroarch || true

sleep 1

echo "[BOOT] Starting backend service"
cd "$SERVICE_DIR"
npm run start &

sleep 1

echo "[BOOT] Starting main menu (Vite)"
cd "$UI_DIR"
npm run dev &

echo "[BOOT] Waiting for UI to be ready..."
until curl -sf http://localhost:5173 >/dev/null; do
  sleep 0.5
done

echo "[BOOT] UI ready, launching kiosk"
"$BASE_DIR/scripts/ultraace.sh" &

wait
