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
PI_SYNC_RETROARCH_CONFIG="${PI_SYNC_RETROARCH_CONFIG:-1}"
PI_RETROARCH_CONFIG_SOURCE="${PI_RETROARCH_CONFIG_SOURCE:-$PI_REMOTE_DIR/os/retroarch.cfg}"
PI_RETROARCH_CONFIG_PATH="${PI_RETROARCH_CONFIG_PATH:-}"

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
set +e
rsync "${RSYNC_ARGS[@]}" -e "${ssh_cmd[*]}" "$ROOT_DIR/" "$PI_REMOTE_HOST:$PI_REMOTE_DIR/"
rsync_status=$?
set -e

if [[ $rsync_status -ne 0 ]]; then
  if [[ $rsync_status -eq 23 || $rsync_status -eq 24 ]]; then
    echo "[pi-sync] rsync finished with partial transfer (code $rsync_status); continuing with remote build/restart."
    echo "[pi-sync] Check remote file permissions for deleted paths if cleanup is required."
  else
    echo "[pi-sync] rsync failed with code $rsync_status"
    exit $rsync_status
  fi
fi

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

if [[ "$PI_SYNC_RETROARCH_CONFIG" == "1" ]]; then
  retro_cfg_src="$PI_RETROARCH_CONFIG_SOURCE"
  retro_cfg_dst="$PI_RETROARCH_CONFIG_PATH"

  if [[ -z "\$retro_cfg_dst" ]]; then
    retro_cfg_dst="\$(systemctl show "$PI_INPUT_SERVICE" -p Environment --value 2>/dev/null | tr ' ' '\n' | sed -n 's/^RETROARCH_CONFIG_PATH=//p' | tail -n1)"
  fi

  if [[ -z "\$retro_cfg_dst" ]]; then
    retro_cfg_dst="$PI_REMOTE_DIR/os/retroarch.cfg"
  fi

  if [[ ! -f "\$retro_cfg_src" ]]; then
    echo "[pi-sync:remote] RetroArch config source missing: \$retro_cfg_src (skipping)"
  elif [[ "\$retro_cfg_src" == "\$retro_cfg_dst" ]]; then
    echo "[pi-sync:remote] RetroArch config already synced at \$retro_cfg_src"
  else
    echo "[pi-sync:remote] Installing RetroArch config: \$retro_cfg_src -> \$retro_cfg_dst"
    if command -v sudo >/dev/null 2>&1; then
      sudo -n install -D -m 0644 "\$retro_cfg_src" "\$retro_cfg_dst" 2>/dev/null || sudo install -D -m 0644 "\$retro_cfg_src" "\$retro_cfg_dst"
    else
      install -D -m 0644 "\$retro_cfg_src" "\$retro_cfg_dst"
    fi
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
