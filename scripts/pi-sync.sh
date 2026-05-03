#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${PI_SYNC_ENV_FILE:-$ROOT_DIR/.pi-sync.env}"

PI_SYNC_OVERRIDE_VARS=(
  PI_REMOTE_HOST
  PI_SSH_PORT
  PI_SSH_BATCH_MODE
  PI_SSH_KEY
  PI_SSH_OPTS
  PI_REMOTE_STAGE_DIR
  PI_REMOTE_RUNTIME_DIR
  PI_REMOTE_RUNTIME_UI_DIR
  PI_REMOTE_RUNTIME_SERVICE_DIR
  PI_REMOTE_RUNTIME_BIN_DIR
  PI_REMOTE_RUNTIME_OS_DIR
  PI_REMOTE_RUNTIME_ROMS_DIR
  PI_REMOTE_RETROARCH_CORE_DIR
  PI_REMOTE_RETROARCH_SYSTEM_DIR
  PI_REMOTE_USER_HOME
  PI_REMOTE_USER_NAME
  PI_BUILD_UI
  PI_BUILD_INPUT
  PI_BUILD_UINPUT_HELPER
  PI_SYNC_UPDATER
  PI_SYNC_OS
  PI_SYNC_ROMS
  PI_SYNC_ARCADE_SERVICE_ENV
  PI_INSTALL_SYSTEMD_UNITS
  PI_INSTALL_ETC_FILES
  PI_DAEMON_RELOAD
  PI_RESET_FAILED_SERVICES
  PI_RESTART_INPUT
  PI_RESTART_KIOSK
  PI_REMOTE_CLEANUP_STAGE
  PI_INPUT_SERVICE
  PI_KIOSK_SERVICE
  PI_MARK_LOCAL_BUILD
  PI_LOCAL_BUILD_VERSION
  PI_LOCAL_BUILD_DIR
  PI_LOCAL_ARCADE_SERVICE_ENV_FILE
)

for var_name in "${PI_SYNC_OVERRIDE_VARS[@]}"; do
  if [[ "${!var_name+x}" == "x" ]]; then
    printf -v "__PI_SYNC_SAVED_$var_name" '%s' "${!var_name}"
    printf -v "__PI_SYNC_HAS_$var_name" '%s' '1'
  fi
done

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

for var_name in "${PI_SYNC_OVERRIDE_VARS[@]}"; do
  has_name="__PI_SYNC_HAS_$var_name"
  saved_name="__PI_SYNC_SAVED_$var_name"
  if [[ "${!has_name:-}" == "1" ]]; then
    printf -v "$var_name" '%s' "${!saved_name}"
    export "$var_name"
  fi
done

PI_REMOTE_HOST="${PI_REMOTE_HOST:-}"
PI_SSH_PORT="${PI_SSH_PORT:-22}"
PI_SSH_BATCH_MODE="${PI_SSH_BATCH_MODE:-0}"
PI_SSH_KEY="${PI_SSH_KEY:-}"
PI_SSH_OPTS="${PI_SSH_OPTS:-}"

PI_REMOTE_STAGE_DIR="${PI_REMOTE_STAGE_DIR:-/tmp/arcade-deploy}"
PI_REMOTE_RUNTIME_DIR="${PI_REMOTE_RUNTIME_DIR:-/opt/arcade}"
PI_REMOTE_RUNTIME_UI_DIR="${PI_REMOTE_RUNTIME_UI_DIR:-$PI_REMOTE_RUNTIME_DIR/ui}"
PI_REMOTE_RUNTIME_SERVICE_DIR="${PI_REMOTE_RUNTIME_SERVICE_DIR:-$PI_REMOTE_RUNTIME_DIR/service}"
PI_REMOTE_RUNTIME_BIN_DIR="${PI_REMOTE_RUNTIME_BIN_DIR:-$PI_REMOTE_RUNTIME_DIR/bin}"
PI_REMOTE_RUNTIME_OS_DIR="${PI_REMOTE_RUNTIME_OS_DIR:-$PI_REMOTE_RUNTIME_DIR/os}"
PI_REMOTE_RUNTIME_ROMS_DIR="${PI_REMOTE_RUNTIME_ROMS_DIR:-$PI_REMOTE_RUNTIME_DIR/roms}"
PI_REMOTE_USER_HOME="${PI_REMOTE_USER_HOME:-/home/arcade1}"
PI_REMOTE_USER_NAME="${PI_REMOTE_USER_NAME:-arcade1}"
PI_REMOTE_RETROARCH_CORE_DIR="${PI_REMOTE_RETROARCH_CORE_DIR:-}"
PI_REMOTE_RETROARCH_SYSTEM_DIR="${PI_REMOTE_RETROARCH_SYSTEM_DIR:-$PI_REMOTE_USER_HOME/.config/retroarch/system}"

PI_BUILD_UI="${PI_BUILD_UI:-1}"
PI_BUILD_INPUT="${PI_BUILD_INPUT:-1}"
PI_BUILD_UINPUT_HELPER="${PI_BUILD_UINPUT_HELPER:-1}"
PI_SYNC_UPDATER="${PI_SYNC_UPDATER:-1}"
PI_SYNC_OS="${PI_SYNC_OS:-1}"
PI_SYNC_ROMS="${PI_SYNC_ROMS:-0}"
PI_SYNC_ARCADE_SERVICE_ENV="${PI_SYNC_ARCADE_SERVICE_ENV:-1}"
PI_INSTALL_SYSTEMD_UNITS="${PI_INSTALL_SYSTEMD_UNITS:-1}"
PI_INSTALL_ETC_FILES="${PI_INSTALL_ETC_FILES:-1}"
PI_DAEMON_RELOAD="${PI_DAEMON_RELOAD:-1}"
PI_RESET_FAILED_SERVICES="${PI_RESET_FAILED_SERVICES:-1}"
PI_RESTART_INPUT="${PI_RESTART_INPUT:-1}"
PI_RESTART_KIOSK="${PI_RESTART_KIOSK:-1}"
PI_REMOTE_CLEANUP_STAGE="${PI_REMOTE_CLEANUP_STAGE:-1}"
PI_INPUT_SERVICE="${PI_INPUT_SERVICE:-arcade-input.service}"
PI_KIOSK_SERVICE="${PI_KIOSK_SERVICE:-arcade-ui.service}"
PI_MARK_LOCAL_BUILD="${PI_MARK_LOCAL_BUILD:-1}"
PI_LOCAL_BUILD_VERSION="${PI_LOCAL_BUILD_VERSION:-$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || node -p "require('$ROOT_DIR/package.json').version")}"

LOCAL_BUILD_DIR="${PI_LOCAL_BUILD_DIR:-$ROOT_DIR/.pi-sync-build}"
LOCAL_UI_DIST_DIR="$ROOT_DIR/apps/ui/dist"
LOCAL_SERVICE_DIR="$ROOT_DIR/apps/service"
LOCAL_INPUT_BUNDLE_SOURCE="$LOCAL_SERVICE_DIR/dist/input.bundle.cjs"
LOCAL_INPUT_BUNDLE="$LOCAL_BUILD_DIR/input.bundle.cjs"
LOCAL_UINPUT_HELPER_SOURCE="$ROOT_DIR/apps/service/uinput-helper.c"
LOCAL_UINPUT_HELPER_STAGE_SOURCE="$LOCAL_BUILD_DIR/uinput-helper.c"
LOCAL_RETRO_OVERLAY_SOURCE="$ROOT_DIR/apps/service/arcade-retro-overlay.c"
LOCAL_RETRO_OVERLAY_STAGE_SOURCE="$LOCAL_BUILD_DIR/arcade-retro-overlay.c"
LOCAL_UPDATER_SOURCE="$ROOT_DIR/scripts/arcade-shell-updater.mjs"
LOCAL_OS_DIR="$ROOT_DIR/os"
LOCAL_ROMS_DIR="$ROOT_DIR/roms"
LOCAL_RETROARCH_CORES_DIR="$LOCAL_ROMS_DIR/cores"
LOCAL_RETROARCH_NEOGEO_ZIP="$LOCAL_ROMS_DIR/neogeo/neogeo.zip"
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

restart_needed_message() {
  echo "[pi-sync] Note: installed systemd units must point to runtime paths under $PI_REMOTE_RUNTIME_DIR."
  echo "[pi-sync] Example targets:"
  echo "[pi-sync]   UI assets:    $PI_REMOTE_RUNTIME_UI_DIR/dist"
  echo "[pi-sync]   Input bundle: $PI_REMOTE_RUNTIME_SERVICE_DIR/input.bundle.cjs"
  echo "[pi-sync]   Input helper: $PI_REMOTE_RUNTIME_BIN_DIR/uinput-helper"
  echo "[pi-sync]   Service env:  $PI_REMOTE_RUNTIME_OS_DIR/.env.arcade-service"
  echo "[pi-sync]   ROMs:         $PI_REMOTE_RUNTIME_ROMS_DIR"
  echo "[pi-sync]   RA cores:     ${PI_REMOTE_RETROARCH_CORE_DIR:-auto-detect}"
  echo "[pi-sync]   RA system:    $PI_REMOTE_RETROARCH_SYSTEM_DIR"
}

mkdir -p "$LOCAL_BUILD_DIR"
rm -f "$LOCAL_INPUT_BUNDLE" "$LOCAL_UINPUT_HELPER_STAGE_SOURCE"
rm -f "$LOCAL_RETRO_OVERLAY_STAGE_SOURCE"
mkdir -p "$LOCAL_BUILD_DIR/ui-dist"
rm -rf "$LOCAL_BUILD_DIR/ui-dist"

if [[ "$PI_BUILD_UI" == "1" ]]; then
  echo "[pi-sync] Building Vite UI locally"
  npm --prefix "$ROOT_DIR/apps/ui" run build
  rsync -a --delete "$LOCAL_UI_DIST_DIR/" "$LOCAL_BUILD_DIR/ui-dist/"
fi

if [[ "$PI_BUILD_INPUT" == "1" ]]; then
  echo "[pi-sync] Building bundled input service locally"
  npm --prefix "$LOCAL_SERVICE_DIR" run bundle
  if [[ ! -f "$LOCAL_INPUT_BUNDLE_SOURCE" ]]; then
    echo "[pi-sync] Missing bundled input service: $LOCAL_INPUT_BUNDLE_SOURCE"
    exit 1
  fi
  cp "$LOCAL_INPUT_BUNDLE_SOURCE" "$LOCAL_INPUT_BUNDLE"
fi

if [[ "$PI_BUILD_UINPUT_HELPER" == "1" ]]; then
  echo "[pi-sync] Staging uinput-helper source for remote build"
  if [[ ! -f "$LOCAL_UINPUT_HELPER_SOURCE" ]]; then
    echo "[pi-sync] Missing helper source: $LOCAL_UINPUT_HELPER_SOURCE"
    exit 1
  fi

  cp "$LOCAL_UINPUT_HELPER_SOURCE" "$LOCAL_UINPUT_HELPER_STAGE_SOURCE"

  if [[ ! -f "$LOCAL_RETRO_OVERLAY_SOURCE" ]]; then
    echo "[pi-sync] Missing native overlay source: $LOCAL_RETRO_OVERLAY_SOURCE"
    exit 1
  fi

  cp "$LOCAL_RETRO_OVERLAY_SOURCE" "$LOCAL_RETRO_OVERLAY_STAGE_SOURCE"
fi

echo "[pi-sync] Preparing remote staging directory"
"${ssh_cmd[@]}" "$PI_REMOTE_HOST" "mkdir -p '$PI_REMOTE_STAGE_DIR/ui-dist' '$PI_REMOTE_STAGE_DIR/service' '$PI_REMOTE_STAGE_DIR/bin' '$PI_REMOTE_STAGE_DIR/scripts' '$PI_REMOTE_STAGE_DIR/os' '$PI_REMOTE_STAGE_DIR/roms' '$PI_REMOTE_STAGE_DIR/retroarch/cores' '$PI_REMOTE_STAGE_DIR/retroarch/system'"

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
    "$PI_REMOTE_HOST:$PI_REMOTE_STAGE_DIR/service/input.bundle.cjs"
fi

if [[ "$PI_BUILD_UINPUT_HELPER" == "1" ]]; then
  echo "[pi-sync] Uploading uinput-helper source for remote build"
  rsync "${RSYNC_ARGS[@]}" -e "${ssh_cmd[*]}" \
    "$LOCAL_UINPUT_HELPER_STAGE_SOURCE" \
    "$PI_REMOTE_HOST:$PI_REMOTE_STAGE_DIR/bin/uinput-helper.c"

  echo "[pi-sync] Uploading native overlay source for remote build"
  rsync "${RSYNC_ARGS[@]}" -e "${ssh_cmd[*]}" \
    "$LOCAL_RETRO_OVERLAY_STAGE_SOURCE" \
    "$PI_REMOTE_HOST:$PI_REMOTE_STAGE_DIR/bin/arcade-retro-overlay.c"
fi

if [[ "$PI_SYNC_UPDATER" == "1" ]]; then
  if [[ ! -f "$LOCAL_UPDATER_SOURCE" ]]; then
    echo "[pi-sync] Missing updater script: $LOCAL_UPDATER_SOURCE"
    exit 1
  fi

  echo "[pi-sync] Uploading updater script"
  rsync "${RSYNC_ARGS[@]}" -e "${ssh_cmd[*]}" \
    "$LOCAL_UPDATER_SOURCE" \
    "$PI_REMOTE_HOST:$PI_REMOTE_STAGE_DIR/scripts/arcade-shell-updater.mjs"
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

if [[ -d "$LOCAL_RETROARCH_CORES_DIR" ]]; then
  echo "[pi-sync] Uploading RetroArch core payload"
  rsync "${RSYNC_ARGS[@]}" -e "${ssh_cmd[*]}" \
    "$LOCAL_RETROARCH_CORES_DIR/" \
    "$PI_REMOTE_HOST:$PI_REMOTE_STAGE_DIR/retroarch/cores/"
fi

if [[ -f "$LOCAL_RETROARCH_NEOGEO_ZIP" ]]; then
  echo "[pi-sync] Uploading RetroArch neogeo system payload"
  rsync "${RSYNC_ARGS[@]}" -e "${ssh_cmd[*]}" \
    "$LOCAL_RETROARCH_NEOGEO_ZIP" \
    "$PI_REMOTE_HOST:$PI_REMOTE_STAGE_DIR/retroarch/system/neogeo.zip"
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
PI_REMOTE_USER_HOME="$PI_REMOTE_USER_HOME"
PI_REMOTE_USER_NAME="$PI_REMOTE_USER_NAME"
PI_REMOTE_RETROARCH_CORE_DIR="$PI_REMOTE_RETROARCH_CORE_DIR"
PI_REMOTE_RETROARCH_SYSTEM_DIR="$PI_REMOTE_RETROARCH_SYSTEM_DIR"
PI_BUILD_UI="$PI_BUILD_UI"
PI_BUILD_INPUT="$PI_BUILD_INPUT"
PI_BUILD_UINPUT_HELPER="$PI_BUILD_UINPUT_HELPER"
PI_SYNC_UPDATER="$PI_SYNC_UPDATER"
PI_SYNC_OS="$PI_SYNC_OS"
PI_SYNC_ROMS="$PI_SYNC_ROMS"
PI_SYNC_ARCADE_SERVICE_ENV="$PI_SYNC_ARCADE_SERVICE_ENV"
PI_INSTALL_SYSTEMD_UNITS="$PI_INSTALL_SYSTEMD_UNITS"
PI_INSTALL_ETC_FILES="$PI_INSTALL_ETC_FILES"
PI_DAEMON_RELOAD="$PI_DAEMON_RELOAD"
PI_RESET_FAILED_SERVICES="$PI_RESET_FAILED_SERVICES"
PI_RESTART_INPUT="$PI_RESTART_INPUT"
PI_RESTART_KIOSK="$PI_RESTART_KIOSK"
PI_REMOTE_CLEANUP_STAGE="$PI_REMOTE_CLEANUP_STAGE"
PI_INPUT_SERVICE="$PI_INPUT_SERVICE"
PI_KIOSK_SERVICE="$PI_KIOSK_SERVICE"
PI_MARK_LOCAL_BUILD="$PI_MARK_LOCAL_BUILD"
PI_LOCAL_BUILD_VERSION="$PI_LOCAL_BUILD_VERSION"

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

resolve_retroarch_core_dir() {
  if [[ -n "\$PI_REMOTE_RETROARCH_CORE_DIR" ]]; then
    printf '%s\n' "\$PI_REMOTE_RETROARCH_CORE_DIR"
    return 0
  fi

  local candidates=(
    /usr/lib/aarch64-linux-gnu/libretro
    /usr/lib/arm-linux-gnueabihf/libretro
    /usr/lib/libretro
  )
  local candidate

  for candidate in "\${candidates[@]}"; do
    if [[ -d "\$candidate" ]]; then
      printf '%s\n' "\$candidate"
      return 0
    fi
  done

  printf '%s\n' "\${candidates[0]}"
}

restart_service() {
  local svc="\$1"
  sudo_cmd systemctl restart "\$svc"
}

reset_failed_service() {
  local svc="\$1"
  sudo_cmd systemctl reset-failed "\$svc" || true
}

if [[ "\$PI_BUILD_UI" == "1" ]]; then
  echo "[pi-sync:remote] Installing built UI -> \$PI_REMOTE_RUNTIME_UI_DIR/dist"
  sudo_cmd mkdir -p "\$PI_REMOTE_RUNTIME_UI_DIR/dist"
  sudo_cmd rsync -a --delete "\$PI_REMOTE_STAGE_DIR/ui-dist/" "\$PI_REMOTE_RUNTIME_UI_DIR/dist/"
fi

if [[ "\$PI_BUILD_INPUT" == "1" ]]; then
  echo "[pi-sync:remote] Installing input bundle -> \$PI_REMOTE_RUNTIME_SERVICE_DIR/input.bundle.cjs"
  sudo_cmd mkdir -p "\$PI_REMOTE_RUNTIME_SERVICE_DIR"
  sudo_cmd install -D -m 0755 "\$PI_REMOTE_STAGE_DIR/service/input.bundle.cjs" "\$PI_REMOTE_RUNTIME_SERVICE_DIR/input.bundle.cjs"
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

  echo "[pi-sync:remote] Building and installing native overlay -> \$PI_REMOTE_RUNTIME_BIN_DIR/arcade-retro-overlay"
  overlay_tmp="\$PI_REMOTE_STAGE_DIR/bin/arcade-retro-overlay.tmp"
  "\$compiler" \
    -O2 \
    -s \
    -Wall \
    -Wextra \
    -o "\$overlay_tmp" \
    "\$PI_REMOTE_STAGE_DIR/bin/arcade-retro-overlay.c" \
    -lX11 \
    -lXext
  if [[ ! -s "\$overlay_tmp" ]]; then
    echo "[pi-sync:remote] overlay build produced empty output" >&2
    exit 1
  fi
  sudo_cmd install -D -m 0755 "\$overlay_tmp" "\$PI_REMOTE_RUNTIME_BIN_DIR/arcade-retro-overlay"
  rm -f "\$overlay_tmp"
fi

if [[ "\$PI_SYNC_UPDATER" == "1" && -f "\$PI_REMOTE_STAGE_DIR/scripts/arcade-shell-updater.mjs" ]]; then
  echo "[pi-sync:remote] Installing updater script -> /usr/local/bin/arcade-shell-updater.mjs"
  sudo_cmd install -D -m 0755 "\$PI_REMOTE_STAGE_DIR/scripts/arcade-shell-updater.mjs" "/usr/local/bin/arcade-shell-updater.mjs"
fi

if [[ "\$PI_SYNC_OS" == "1" ]]; then
  echo "[pi-sync:remote] Installing os payload -> \$PI_REMOTE_RUNTIME_OS_DIR"
  sudo_cmd mkdir -p "\$PI_REMOTE_RUNTIME_OS_DIR"
  sudo_cmd rsync -a --delete --exclude '.env.arcade-service' "\$PI_REMOTE_STAGE_DIR/os/" "\$PI_REMOTE_RUNTIME_OS_DIR/"
  if [[ -d "\$PI_REMOTE_RUNTIME_OS_DIR/bin" ]]; then
    sudo_cmd find "\$PI_REMOTE_RUNTIME_OS_DIR/bin" -type f -name '*.sh' -exec chmod 0755 {} +
  fi
  for critical_script in arcade-retro-launch.sh arcade-retro-session.sh; do
    if [[ -f "\$PI_REMOTE_STAGE_DIR/os/bin/\$critical_script" ]]; then
      echo "[pi-sync:remote] Installing critical launch script -> \$PI_REMOTE_RUNTIME_OS_DIR/bin/\$critical_script"
      sudo_cmd install -D -m 0755 \
        "\$PI_REMOTE_STAGE_DIR/os/bin/\$critical_script" \
        "\$PI_REMOTE_RUNTIME_OS_DIR/bin/\$critical_script"
    fi
  done
  if [[ -f "\$PI_REMOTE_RUNTIME_OS_DIR/.xinitrc" ]]; then
    echo "[pi-sync:remote] Installing session file -> \$PI_REMOTE_USER_HOME/.xinitrc"
    sudo_cmd install -D -m 0755 "\$PI_REMOTE_RUNTIME_OS_DIR/.xinitrc" "\$PI_REMOTE_USER_HOME/.xinitrc"
    sudo_cmd chown "\$PI_REMOTE_USER_NAME:\$PI_REMOTE_USER_NAME" "\$PI_REMOTE_USER_HOME/.xinitrc"
  fi
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

if [[ -d "\$PI_REMOTE_STAGE_DIR/retroarch/cores" ]]; then
  retroarch_core_dir="\$(resolve_retroarch_core_dir)"
  echo "[pi-sync:remote] Installing RetroArch cores -> \$retroarch_core_dir"
  sudo_cmd mkdir -p "\$retroarch_core_dir"
  while IFS= read -r -d '' core_file; do
    sudo_cmd install -D -m 0644 "\$core_file" "\$retroarch_core_dir/\$(basename "\$core_file")"
  done < <(find "\$PI_REMOTE_STAGE_DIR/retroarch/cores" -type f -name '*.so' -print0)
fi

if [[ -f "\$PI_REMOTE_STAGE_DIR/retroarch/system/neogeo.zip" ]]; then
  echo "[pi-sync:remote] Installing RetroArch system file -> \$PI_REMOTE_RETROARCH_SYSTEM_DIR/neogeo.zip"
  sudo_cmd install -D -m 0644 \
    "\$PI_REMOTE_STAGE_DIR/retroarch/system/neogeo.zip" \
    "\$PI_REMOTE_RETROARCH_SYSTEM_DIR/neogeo.zip"
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

if [[ "\$PI_MARK_LOCAL_BUILD" == "1" ]]; then
  echo "[pi-sync:remote] Marking runtime as local build -> \$PI_REMOTE_RUNTIME_OS_DIR/.arcade-shell-version"
  sudo_cmd mkdir -p "\$PI_REMOTE_RUNTIME_OS_DIR"
  printf '%s\n' "\$PI_LOCAL_BUILD_VERSION" | sudo_cmd tee "\$PI_REMOTE_RUNTIME_OS_DIR/.arcade-shell-version" >/dev/null
fi

if [[ "\$PI_DAEMON_RELOAD" == "1" ]]; then
  echo "[pi-sync:remote] daemon-reload"
  sudo_cmd systemctl daemon-reload
fi

if [[ "\$PI_RESET_FAILED_SERVICES" == "1" ]]; then
  if [[ "\$PI_RESTART_INPUT" == "1" ]]; then
    echo "[pi-sync:remote] Resetting failed state for \$PI_INPUT_SERVICE"
    reset_failed_service "\$PI_INPUT_SERVICE"
  fi

  if [[ "\$PI_RESTART_KIOSK" == "1" ]]; then
    echo "[pi-sync:remote] Resetting failed state for \$PI_KIOSK_SERVICE"
    reset_failed_service "\$PI_KIOSK_SERVICE"
  fi
fi

if [[ "\$PI_RESTART_INPUT" == "1" ]]; then
  echo "[pi-sync:remote] Restarting \$PI_INPUT_SERVICE"
  restart_service "\$PI_INPUT_SERVICE"
fi

if [[ "\$PI_RESTART_KIOSK" == "1" ]]; then
  echo "[pi-sync:remote] Restarting \$PI_KIOSK_SERVICE"
  restart_service "\$PI_KIOSK_SERVICE"
fi

if [[ "\$PI_REMOTE_CLEANUP_STAGE" == "1" ]]; then
  echo "[pi-sync:remote] Cleaning remote staging directory"
  rm -rf "\$PI_REMOTE_STAGE_DIR"
fi

echo "[pi-sync:remote] Done"
EOF

echo "[pi-sync] Running remote install/restart steps"
"${ssh_cmd[@]}" "$PI_REMOTE_HOST" "$remote_script"
restart_needed_message
echo "[pi-sync] Complete"
