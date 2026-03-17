#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${PI_SYNC_ENV_FILE:-$ROOT_DIR/.pi-sync.env}"

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

PI_REMOTE_HOST="${PI_REMOTE_HOST:-}"
PI_REMOTE_DIR="${PI_REMOTE_DIR:-/home/arcade1/arcade}"
PI_SSH_PORT="${PI_SSH_PORT:-22}"
PI_SSH_BATCH_MODE="${PI_SSH_BATCH_MODE:-0}"
PI_SSH_KEY="${PI_SSH_KEY:-}"
PI_SSH_OPTS="${PI_SSH_OPTS:-}"

if [[ -z "$PI_REMOTE_HOST" ]]; then
  echo "[pi-pull] Missing PI_REMOTE_HOST. Set it in .pi-sync.env (e.g. arcade1@192.168.1.50)."
  exit 1
fi

if ! command -v rsync >/dev/null 2>&1; then
  echo "[pi-pull] rsync is required but not installed."
  exit 1
fi

ssh_cmd=(ssh -p "$PI_SSH_PORT" -o ConnectTimeout=4)

if [[ "$PI_SSH_BATCH_MODE" == "1" ]]; then
  ssh_cmd+=(-o BatchMode=yes)
fi

if [[ -n "$PI_SSH_KEY" ]]; then
  ssh_cmd+=(-i "$PI_SSH_KEY")
fi

if [[ -n "$PI_SSH_OPTS" ]]; then
  # shellcheck disable=SC2206
  extra_opts=($PI_SSH_OPTS)
  ssh_cmd+=("${extra_opts[@]}")
fi

RSYNC_ARGS=(
  -az
  --human-readable
  --exclude '.git/'
  --exclude '.idea/'
  --exclude 'node_modules/'
  --exclude 'apps/ui/node_modules/'
  --exclude 'apps/service/node_modules/'
  --exclude '.DS_Store'
)

if [[ "${1:-}" == "--dry-run" ]]; then
  RSYNC_ARGS+=(-n -v)
  shift
fi

echo "[pi-pull] Syncing $PI_REMOTE_HOST:$PI_REMOTE_DIR -> $ROOT_DIR"
rsync "${RSYNC_ARGS[@]}" -e "${ssh_cmd[*]}" "$PI_REMOTE_HOST:$PI_REMOTE_DIR/" "$ROOT_DIR/" "$@"
echo "[pi-pull] Complete"
