#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${PI_SYNC_ENV_FILE:-$ROOT_DIR/.pi-sync.env}"

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

PI_REMOTE_HOST="${PI_REMOTE_HOST:-}"
PI_SSH_PORT="${PI_SSH_PORT:-22}"
PI_SSH_BATCH_MODE="${PI_SSH_BATCH_MODE:-0}"
PI_SSH_KEY="${PI_SSH_KEY:-}"
PI_SSH_OPTS="${PI_SSH_OPTS:-}"

PI_REMOTE_STAGE_DIR="${PI_REMOTE_STAGE_DIR:-/home/arcade1/arcade-deploy}"
PI_REMOTE_RUNTIME_DIR="${PI_REMOTE_RUNTIME_DIR:-/opt/arcade}"
PI_REMOTE_RUNTIME_UI_DIR="${PI_REMOTE_RUNTIME_UI_DIR:-$PI_REMOTE_RUNTIME_DIR/ui}"
PI_REMOTE_RUNTIME_SERVICE_DIR="${PI_REMOTE_RUNTIME_SERVICE_DIR:-$PI_REMOTE_RUNTIME_DIR/service}"
PI_REMOTE_RUNTIME_BIN_DIR="${PI_REMOTE_RUNTIME_BIN_DIR:-$PI_REMOTE_RUNTIME_DIR/bin}"
PI_REMOTE_RUNTIME_OS_DIR="${PI_REMOTE_RUNTIME_OS_DIR:-$PI_REMOTE_RUNTIME_DIR/os}"
PI_REMOTE_RUNTIME_ROMS_DIR="${PI_REMOTE_RUNTIME_ROMS_DIR:-$PI_REMOTE_RUNTIME_DIR/roms}"

PI_BUILD_UI="${PI_BUILD_UI:-1}"
PI_BUILD_INPUT="${PI_BUILD_INPUT:-1}"
PI_BUILD_UINPUT_HELPER="${PI_BUILD_UINPUT_HELPER:-1}"
PI_SYNC_OS="${PI_SYNC_OS:-1}"
PI_SYNC_ROMS="${PI_SYNC_ROMS:-1}"
PI_SYNC_ARCADE_SERVICE_ENV="${PI_SYNC_ARCADE_SERVICE_ENV:-1}"
PI_INSTALL_SYSTEMD_UNITS="${PI_INSTALL_SYSTEMD_UNITS:-1}"
PI_INSTALL_ETC_FILES="${PI_INSTALL_ETC_FILES:-1}"
PI_DAEMON_RELOAD="${PI_DAEMON_RELOAD:-1}"
PI_RESTART_INPUT="${PI_RESTART_INPUT:-1}"
PI_RESTART_KIOSK="${PI_RESTART_KIOSK:-1}"
PI_INPUT_SERVICE="${PI_INPUT_SERVICE:-arcade-input.service}"
PI_KIOSK_SERVICE="${PI_KIOSK_SERVICE:-arcade-ui.service}"

LOCAL_BUILD_DIR="${PI_LOCAL_BUILD_DIR:-$ROOT_DIR/.pi-sync-build}"
LOCAL_UI_DIST_DIR="$ROOT_DIR/apps/ui/dist"
LOCAL_INPUT_ENTRY="$ROOT_DIR/apps/service/input.js"
LOCAL_INPUT_BUNDLE="$LOCAL_BUILD_DIR/input.bundle.js"
LOCAL_UINPUT_HELPER_SOURCE="$ROOT_DIR/apps/service/uinput-helper.c"
LOCAL_UINPUT_HELPER_STAGE_SOURCE="$LOCAL_BUILD_DIR/uinput-helper.c"
LOCAL_OS_DIR="$ROOT_DIR/os"
LOCAL_ROMS_DIR="$ROOT_DIR/roms"
LOCAL_ARCADE_SERVICE_ENV_FILE="${PI_LOCAL_ARCADE_SERVICE_ENV_FILE:-$ROOT_DIR/.env.arcade-service}"

if [[ -z "$PI_REMOTE_HOST" ]]; then
  echo "[pi-sync] Missing PI_REMOTE_HOST. Set it in .pi-sync.env (for example: arcade1@10.0.254.12)."
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

find_esbuild() {
  local candidates=(
    "$ROOT_DIR/node_modules/.bin/esbuild"
    "$ROOT_DIR/apps/service/node_modules/.bin/esbuild"
  )
  local candidate

  for candidate in "${candidates[@]}"; do
    if [[ -x "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  if command -v esbuild >/dev/null 2>&1; then
    command -v esbuild
    return 0
  fi

  return 1
}

restart_needed_message() {
  echo "[pi-sync] Note: installed systemd units must point to runtime paths under $PI_REMOTE_RUNTIME_DIR."
  echo "[pi-sync] Example targets:"
  echo "[pi-sync]   UI assets:    $PI_REMOTE_RUNTIME_UI_DIR/dist"
  echo "[pi-sync]   Input bundle: $PI_REMOTE_RUNTIME_SERVICE_DIR/input.bundle.js"
  echo "[pi-sync]   Input helper: $PI_REMOTE_RUNTIME_BIN_DIR/uinput-helper"
  echo "[pi-sync]   Service env:  $PI_REMOTE_RUNTIME_OS_DIR/.env.arcade-service"
  echo "[pi-sync]   ROMs:         $PI_REMOTE_RUNTIME_ROMS_DIR"
}

mkdir -p "$LOCAL_BUILD_DIR"
rm -f "$LOCAL_INPUT_BUNDLE" "$LOCAL_UINPUT_HELPER_STAGE_SOURCE"
mkdir -p "$LOCAL_BUILD_DIR/ui-dist"
rm -rf "$LOCAL_BUILD_DIR/ui-dist"

if [[ "$PI_BUILD_UI" == "1" ]]; then
  echo "[pi-sync] Building Vite UI locally"
  npm --prefix "$ROOT_DIR/apps/ui" run build
  rsync -a --delete "$LOCAL_UI_DIST_DIR/" "$LOCAL_BUILD_DIR/ui-dist/"
fi

if [[ "$PI_BUILD_INPUT" == "1" ]]; then
  echo "[pi-sync] Bundling input service locally"
  if [[ ! -f "$LOCAL_INPUT_ENTRY" ]]; then
    echo "[pi-sync] Missing input entry: $LOCAL_INPUT_ENTRY"
    exit 1
  fi

  ESBUILD_BIN="$(find_esbuild || true)"
  if [[ -z "$ESBUILD_BIN" ]]; then
    echo "[pi-sync] esbuild not found. Install it locally before running this script."
    exit 1
  fi

  "$ESBUILD_BIN" \
    "$LOCAL_INPUT_ENTRY" \
    --bundle \
    --platform=node \
    --target=node20 \
    --format=cjs \
    --minify \
    --outfile="$LOCAL_INPUT_BUNDLE"
fi

if [[ "$PI_BUILD_UINPUT_HELPER" == "1" ]]; then
  echo "[pi-sync] Staging uinput-helper source for remote build"
  if [[ ! -f "$LOCAL_UINPUT_HELPER_SOURCE" ]]; then
    echo "[pi-sync] Missing helper source: $LOCAL_UINPUT_HELPER_SOURCE"
    exit 1
  fi

  cp "$LOCAL_UINPUT_HELPER_SOURCE" "$LOCAL_UINPUT_HELPER_STAGE_SOURCE"
fi

echo "[pi-sync] Preparing remote staging directory"
"${ssh_cmd[@]}" "$PI_REMOTE_HOST" "mkdir -p '$PI_REMOTE_STAGE_DIR/ui-dist' '$PI_REMOTE_STAGE_DIR/service' '$PI_REMOTE_STAGE_DIR/bin' '$PI_REMOTE_STAGE_DIR/os' '$PI_REMOTE_STAGE_DIR/roms'"

RSYNC_ARGS=(
  -az
  --delete
  --human-readable
)

if [[ "$PI_BUILD_UI" == "1" ]]; then
  echo "[pi-sync] Uploading built UI dist"
  rsync "${RSYNC_ARGS[@]}" -e "${ssh_cmd[*]}" \
    "$LOCAL_BUILD_DIR/ui-dist/" \
    "$PI_REMOTE_HOST:$PI_REMOTE_STAGE_DIR/ui-dist/"
fi

if [[ "$PI_BUILD_INPUT" == "1" ]]; then
  echo "[pi-sync] Uploading bundled input service"
  rsync "${RSYNC_ARGS[@]}" -e "${ssh_cmd[*]}" \
    "$LOCAL_INPUT_BUNDLE" \
    "$PI_REMOTE_HOST:$PI_REMOTE_STAGE_DIR/service/input.bundle.js"
fi

if [[ "$PI_BUILD_UINPUT_HELPER" == "1" ]]; then
  echo "[pi-sync] Uploading uinput-helper source for remote build"
  rsync "${RSYNC_ARGS[@]}" -e "${ssh_cmd[*]}" \
    "$LOCAL_UINPUT_HELPER_STAGE_SOURCE" \
    "$PI_REMOTE_HOST:$PI_REMOTE_STAGE_DIR/bin/uinput-helper.c"
fi

if [[ "$PI_SYNC_OS" == "1" ]]; then
  if [[ ! -d "$LOCAL_OS_DIR" ]]; then
    echo "[pi-sync] Missing os directory: $LOCAL_OS_DIR"
    exit 1
  fi

  echo "[pi-sync] Uploading os payload"
  rsync "${RSYNC_ARGS[@]}" -e "${ssh_cmd[*]}" \
    "$LOCAL_OS_DIR/" \
    "$PI_REMOTE_HOST:$PI_REMOTE_STAGE_DIR/os/"
fi

if [[ "$PI_SYNC_ARCADE_SERVICE_ENV" == "1" ]]; then
  if [[ ! -f "$LOCAL_ARCADE_SERVICE_ENV_FILE" ]]; then
    echo "[pi-sync] Missing arcade service env file: $LOCAL_ARCADE_SERVICE_ENV_FILE"
    exit 1
  fi

  echo "[pi-sync] Uploading arcade service env"
  rsync "${RSYNC_ARGS[@]}" -e "${ssh_cmd[*]}" \
    "$LOCAL_ARCADE_SERVICE_ENV_FILE" \
    "$PI_REMOTE_HOST:$PI_REMOTE_STAGE_DIR/os/.env.arcade-service"
fi

if [[ "$PI_SYNC_ROMS" == "1" ]]; then
  if [[ ! -d "$LOCAL_ROMS_DIR" ]]; then
    echo "[pi-sync] Missing roms directory: $LOCAL_ROMS_DIR"
    exit 1
  fi

  echo "[pi-sync] Uploading roms payload"
  rsync "${RSYNC_ARGS[@]}" -e "${ssh_cmd[*]}" \
    "$LOCAL_ROMS_DIR/" \
    "$PI_REMOTE_HOST:$PI_REMOTE_STAGE_DIR/roms/"
fi

read -r -d '' remote_script <<EOF || true
set -euo pipefail

PI_REMOTE_STAGE_DIR="$PI_REMOTE_STAGE_DIR"
PI_REMOTE_RUNTIME_DIR="$PI_REMOTE_RUNTIME_DIR"
PI_REMOTE_RUNTIME_UI_DIR="$PI_REMOTE_RUNTIME_UI_DIR"
PI_REMOTE_RUNTIME_SERVICE_DIR="$PI_REMOTE_RUNTIME_SERVICE_DIR"
PI_REMOTE_RUNTIME_BIN_DIR="$PI_REMOTE_RUNTIME_BIN_DIR"
PI_REMOTE_RUNTIME_OS_DIR="$PI_REMOTE_RUNTIME_OS_DIR"
PI_REMOTE_RUNTIME_ROMS_DIR="$PI_REMOTE_RUNTIME_ROMS_DIR"
PI_BUILD_UI="$PI_BUILD_UI"
PI_BUILD_INPUT="$PI_BUILD_INPUT"
PI_BUILD_UINPUT_HELPER="$PI_BUILD_UINPUT_HELPER"
PI_SYNC_OS="$PI_SYNC_OS"
PI_SYNC_ROMS="$PI_SYNC_ROMS"
PI_SYNC_ARCADE_SERVICE_ENV="$PI_SYNC_ARCADE_SERVICE_ENV"
PI_INSTALL_SYSTEMD_UNITS="$PI_INSTALL_SYSTEMD_UNITS"
PI_INSTALL_ETC_FILES="$PI_INSTALL_ETC_FILES"
PI_DAEMON_RELOAD="$PI_DAEMON_RELOAD"
PI_RESTART_INPUT="$PI_RESTART_INPUT"
PI_RESTART_KIOSK="$PI_RESTART_KIOSK"
PI_INPUT_SERVICE="$PI_INPUT_SERVICE"
PI_KIOSK_SERVICE="$PI_KIOSK_SERVICE"

sudo_cmd() {
  if command -v sudo >/dev/null 2>&1; then
    sudo -n "\$@" 2>/dev/null || sudo "\$@"
  else
    "\$@"
  fi
}

find_remote_c_compiler() {
  local candidates=(cc gcc clang)
  local candidate

  for candidate in "\${candidates[@]}"; do
    if command -v "\$candidate" >/dev/null 2>&1; then
      printf '%s\n' "\$candidate"
      return 0
    fi
  done

  return 1
}

restart_service() {
  local svc="\$1"
  sudo_cmd systemctl restart "\$svc"
}

if [[ "\$PI_BUILD_UI" == "1" ]]; then
  echo "[pi-sync:remote] Installing built UI -> \$PI_REMOTE_RUNTIME_UI_DIR/dist"
  sudo_cmd mkdir -p "\$PI_REMOTE_RUNTIME_UI_DIR/dist"
  sudo_cmd rsync -a --delete "\$PI_REMOTE_STAGE_DIR/ui-dist/" "\$PI_REMOTE_RUNTIME_UI_DIR/dist/"
fi

if [[ "\$PI_BUILD_INPUT" == "1" ]]; then
  echo "[pi-sync:remote] Installing input bundle -> \$PI_REMOTE_RUNTIME_SERVICE_DIR/input.bundle.js"
  sudo_cmd mkdir -p "\$PI_REMOTE_RUNTIME_SERVICE_DIR"
  sudo_cmd install -D -m 0755 "\$PI_REMOTE_STAGE_DIR/service/input.bundle.js" "\$PI_REMOTE_RUNTIME_SERVICE_DIR/input.bundle.js"
fi

if [[ "\$PI_BUILD_UINPUT_HELPER" == "1" ]]; then
  echo "[pi-sync:remote] Building and installing uinput-helper -> \$PI_REMOTE_RUNTIME_BIN_DIR/uinput-helper"
  compiler="\$(find_remote_c_compiler || true)"
  if [[ -z "\$compiler" ]]; then
    echo "[pi-sync:remote] No remote C compiler found (need cc, gcc, or clang)"
    exit 1
  fi

  sudo_cmd mkdir -p "\$PI_REMOTE_RUNTIME_BIN_DIR"
  build_tmp="\$PI_REMOTE_STAGE_DIR/bin/uinput-helper"
  "\$compiler" \
    -O2 \
    -s \
    -Wall \
    -Wextra \
    -o "\$build_tmp" \
    "\$PI_REMOTE_STAGE_DIR/bin/uinput-helper.c"
  sudo_cmd install -D -m 0755 "\$build_tmp" "\$PI_REMOTE_RUNTIME_BIN_DIR/uinput-helper"
fi

if [[ "\$PI_SYNC_OS" == "1" ]]; then
  echo "[pi-sync:remote] Installing os payload -> \$PI_REMOTE_RUNTIME_OS_DIR"
  sudo_cmd mkdir -p "\$PI_REMOTE_RUNTIME_OS_DIR"
  sudo_cmd rsync -a --delete "\$PI_REMOTE_STAGE_DIR/os/" "\$PI_REMOTE_RUNTIME_OS_DIR/"
fi

if [[ "\$PI_SYNC_ARCADE_SERVICE_ENV" == "1" && -f "\$PI_REMOTE_STAGE_DIR/os/.env.arcade-service" ]]; then
  echo "[pi-sync:remote] Installing arcade service env -> \$PI_REMOTE_RUNTIME_OS_DIR/.env.arcade-service"
  sudo_cmd mkdir -p "\$PI_REMOTE_RUNTIME_OS_DIR"
  sudo_cmd install -D -m 0600 "\$PI_REMOTE_STAGE_DIR/os/.env.arcade-service" "\$PI_REMOTE_RUNTIME_OS_DIR/.env.arcade-service"
fi

if [[ "\$PI_SYNC_ROMS" == "1" ]]; then
  echo "[pi-sync:remote] Installing roms payload -> \$PI_REMOTE_RUNTIME_ROMS_DIR"
  sudo_cmd mkdir -p "\$PI_REMOTE_RUNTIME_ROMS_DIR"
  sudo_cmd rsync -a --delete "\$PI_REMOTE_STAGE_DIR/roms/" "\$PI_REMOTE_RUNTIME_ROMS_DIR/"
fi

if [[ "\$PI_INSTALL_ETC_FILES" == "1" && -d "\$PI_REMOTE_RUNTIME_OS_DIR/etc" ]]; then
  echo "[pi-sync:remote] Installing /etc payload"
  while IFS= read -r -d '' etc_file; do
    rel_path="\${etc_file#\$PI_REMOTE_RUNTIME_OS_DIR/etc/}"
    sudo_cmd install -D -m 0644 "\$etc_file" "/etc/\$rel_path"
  done < <(find "\$PI_REMOTE_RUNTIME_OS_DIR/etc" -type f -print0)
fi

if [[ "\$PI_INSTALL_SYSTEMD_UNITS" == "1" && -d "\$PI_REMOTE_RUNTIME_OS_DIR/systemd" ]]; then
  echo "[pi-sync:remote] Installing systemd units"
  shopt -s nullglob
  unit_files=(
    "\$PI_REMOTE_RUNTIME_OS_DIR/systemd"/*.service
    "\$PI_REMOTE_RUNTIME_OS_DIR/systemd"/*.socket
    "\$PI_REMOTE_RUNTIME_OS_DIR/systemd"/*.timer
    "\$PI_REMOTE_RUNTIME_OS_DIR/systemd"/*.path
  )
  shopt -u nullglob

  for unit_file in "\${unit_files[@]}"; do
    sudo_cmd install -D -m 0644 "\$unit_file" "/etc/systemd/system/\$(basename "\$unit_file")"
  done
fi

if [[ "\$PI_DAEMON_RELOAD" == "1" ]]; then
  echo "[pi-sync:remote] daemon-reload"
  sudo_cmd systemctl daemon-reload
fi

if [[ "\$PI_RESTART_INPUT" == "1" ]]; then
  echo "[pi-sync:remote] Restarting \$PI_INPUT_SERVICE"
  restart_service "\$PI_INPUT_SERVICE"
fi

if [[ "\$PI_RESTART_KIOSK" == "1" ]]; then
  echo "[pi-sync:remote] Restarting \$PI_KIOSK_SERVICE"
  restart_service "\$PI_KIOSK_SERVICE"
fi

echo "[pi-sync:remote] Done"
EOF

echo "[pi-sync] Running remote install/restart steps"
"${ssh_cmd[@]}" "$PI_REMOTE_HOST" "$remote_script"
restart_needed_message
echo "[pi-sync] Complete"
