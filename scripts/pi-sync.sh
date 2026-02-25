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

PI_BUILD_UI="${PI_BUILD_UI:-1}"
PI_RESTART_INPUT="${PI_RESTART_INPUT:-1}"
PI_RESTART_KIOSK="${PI_RESTART_KIOSK:-1}"
PI_INPUT_SERVICE="${PI_INPUT_SERVICE:-arcade-input.service}"
PI_KIOSK_SERVICE="${PI_KIOSK_SERVICE:-arcade-ui.service}"
PI_DAEMON_RELOAD="${PI_DAEMON_RELOAD:-1}"

if [[ -z "$PI_REMOTE_HOST" ]]; then
  echo "[pi-sync] Missing PI_REMOTE_HOST. Set it in .pi-sync.env (e.g. arcade1@192.168.1.50)."
  exit 1
fi

if ! command -v rsync >/dev/null 2>&1; then
  echo "[pi-sync] rsync is required but not installed."
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
  --delete
  --human-readable
  --exclude '.git/'
  --exclude '.idea/'
  --exclude 'node_modules/'
  --exclude 'apps/ui/node_modules/'
  --exclude 'apps/service/node_modules/'
  --exclude '.DS_Store'
)

echo "[pi-sync] Syncing $ROOT_DIR -> $PI_REMOTE_HOST:$PI_REMOTE_DIR"
rsync "${RSYNC_ARGS[@]}" -e "${ssh_cmd[*]}" "$ROOT_DIR/" "$PI_REMOTE_HOST:$PI_REMOTE_DIR/"

remote_script=$(cat <<EOF
set -euo pipefail
cd "$PI_REMOTE_DIR"

restart_service() {
  local svc="\$1"
  if command -v sudo >/dev/null 2>&1; then
    sudo -n systemctl restart "\$svc" 2>/dev/null || systemctl restart "\$svc"
  else
    systemctl restart "\$svc"
  fi
}

if [[ "$PI_DAEMON_RELOAD" == "1" ]]; then
  echo "[pi-sync:remote] daemon-reload"
  if command -v sudo >/dev/null 2>&1; then
    sudo -n systemctl daemon-reload 2>/dev/null || systemctl daemon-reload
  else
    systemctl daemon-reload
  fi
fi

if [[ "$PI_BUILD_UI" == "1" ]]; then
  echo "[pi-sync:remote] Building UI"
  npm --prefix apps/ui run build
fi

if [[ "$PI_RESTART_INPUT" == "1" ]]; then
  echo "[pi-sync:remote] Restarting $PI_INPUT_SERVICE"
  restart_service "$PI_INPUT_SERVICE"
fi

if [[ "$PI_RESTART_KIOSK" == "1" ]]; then
  echo "[pi-sync:remote] Restarting $PI_KIOSK_SERVICE"
  restart_service "$PI_KIOSK_SERVICE"
fi

echo "[pi-sync:remote] Done"
EOF
)

echo "[pi-sync] Running remote build/restart steps"
"${ssh_cmd[@]}" "$PI_REMOTE_HOST" "$remote_script"
echo "[pi-sync] Complete"
