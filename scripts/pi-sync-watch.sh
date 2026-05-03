#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SYNC_SCRIPT="$ROOT_DIR/scripts/pi-sync.sh"

if [[ ! -x "$SYNC_SCRIPT" ]]; then
  echo "[pi-watch] $SYNC_SCRIPT is not executable. Run: chmod +x scripts/pi-sync.sh scripts/pi-sync-watch.sh"
  exit 1
fi

DEBOUNCE_SECONDS="${PI_SYNC_DEBOUNCE_SECONDS:-1.2}"
EXCLUDES_REGEX='(^|/)(\.git|\.idea|node_modules|dist)(/|$)|\.DS_Store$'

echo "[pi-watch] Watching $ROOT_DIR"
echo "[pi-watch] Debounce: ${DEBOUNCE_SECONDS}s"

if command -v fswatch >/dev/null 2>&1; then
  echo "[pi-watch] Using fswatch"

  fswatch \
    -o \
    --latency "$DEBOUNCE_SECONDS" \
    --exclude '.*\/\.git\/.*' \
    --exclude '.*\/\.idea\/.*' \
    --exclude '.*\/node_modules\/.*' \
    --exclude '.*\/dist\/.*' \
    "$ROOT_DIR" | while read -r _; do
    echo "[pi-watch] Change detected, syncing..."
    if ! "$SYNC_SCRIPT"; then
      echo "[pi-watch] Sync failed (will keep watching)"
    fi
  done
else
  echo "[pi-watch] fswatch not found, using polling fallback (2s interval)"

  snapshot_file="$(mktemp)"
  trap 'rm -f "$snapshot_file"' EXIT

  make_snapshot() {
    if [[ "$(uname -s)" == "Darwin" ]]; then
      find "$ROOT_DIR" -type f \
        ! -path "$ROOT_DIR/.git/*" \
        ! -path "$ROOT_DIR/.idea/*" \
        ! -path "$ROOT_DIR/node_modules/*" \
        ! -path "$ROOT_DIR/apps/ui/node_modules/*" \
        ! -path "$ROOT_DIR/apps/service/node_modules/*" \
        ! -path "$ROOT_DIR/apps/ui/dist/*" \
        ! -name ".DS_Store" \
        -print0 | xargs -0 stat -f "%m %N" 2>/dev/null | shasum
    else
      find "$ROOT_DIR" -type f \
        ! -path "$ROOT_DIR/.git/*" \
        ! -path "$ROOT_DIR/.idea/*" \
        ! -path "$ROOT_DIR/node_modules/*" \
        ! -path "$ROOT_DIR/apps/ui/node_modules/*" \
        ! -path "$ROOT_DIR/apps/service/node_modules/*" \
        ! -path "$ROOT_DIR/apps/ui/dist/*" \
        ! -name ".DS_Store" \
        -print0 | xargs -0 stat -c "%Y %n" 2>/dev/null | shasum
    fi
  }

  make_snapshot >"$snapshot_file"

  while true; do
    sleep 2
    next="$(make_snapshot)"
    prev="$(cat "$snapshot_file")"
    if [[ "$next" != "$prev" ]]; then
      echo "$next" >"$snapshot_file"
      echo "[pi-watch] Change detected, syncing..."
      "$SYNC_SCRIPT" || echo "[pi-watch] Sync failed (will keep watching)"
    fi
  done
fi
