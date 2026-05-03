#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${PI_SYNC_ENV_FILE:-$ROOT_DIR/.pi-sync.env}"

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

PI_REMOTE_HOST="${PI_REMOTE_HOST:-}"
PI_REMOTE_RUNTIME_DIR="${PI_REMOTE_RUNTIME_DIR:-/opt/arcade}"
PI_SSH_PORT="${PI_SSH_PORT:-22}"
PI_SSH_BATCH_MODE="${PI_SSH_BATCH_MODE:-0}"
PI_SSH_KEY="${PI_SSH_KEY:-}"
PI_SSH_OPTS="${PI_SSH_OPTS:-}"
PI_PULL_ENV="${PI_PULL_ENV:-0}"

if [[ -z "$PI_REMOTE_HOST" ]]; then
  echo "[pi-pull] Missing PI_REMOTE_HOST. Set it in .pi-sync.env (for example: arcade1@10.0.254.12)."
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
)

if [[ "${1:-}" == "--dry-run" ]]; then
  RSYNC_ARGS+=(-n -v)
  shift
fi

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/arcade-pi-pull.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

mkdir -p "$TMP_DIR/os/systemd" "$TMP_DIR/os/boot" "$TMP_DIR/scripts"

echo "[pi-pull] Pulling runtime truth from $PI_REMOTE_HOST"

rsync "${RSYNC_ARGS[@]}" -e "${ssh_cmd[*]}" \
  "$PI_REMOTE_HOST:/home/arcade1/.xinitrc" \
  "$TMP_DIR/os/.xinitrc"

rsync "${RSYNC_ARGS[@]}" -e "${ssh_cmd[*]}" \
  "$PI_REMOTE_HOST:/boot/firmware/config.txt" \
  "$TMP_DIR/os/boot/config.txt"

rsync "${RSYNC_ARGS[@]}" -e "${ssh_cmd[*]}" \
  "$PI_REMOTE_HOST:/boot/firmware/cmdline.txt" \
  "$TMP_DIR/os/boot/cmdline.txt"

rsync "${RSYNC_ARGS[@]}" -e "${ssh_cmd[*]}" \
  "$PI_REMOTE_HOST:$PI_REMOTE_RUNTIME_DIR/os/boot/boot.png" \
  "$TMP_DIR/os/boot/boot.png"

rsync "${RSYNC_ARGS[@]}" -e "${ssh_cmd[*]}" \
  "$PI_REMOTE_HOST:$PI_REMOTE_RUNTIME_DIR/os/retroarch.cfg" \
  "$TMP_DIR/os/retroarch.cfg"

rsync "${RSYNC_ARGS[@]}" -e "${ssh_cmd[*]}" \
  "$PI_REMOTE_HOST:$PI_REMOTE_RUNTIME_DIR/os/retroarch-single-x.cfg" \
  "$TMP_DIR/os/retroarch-single-x.cfg"

rsync "${RSYNC_ARGS[@]}" -e "${ssh_cmd[*]}" \
  "$PI_REMOTE_HOST:/etc/systemd/system/arcade-input.service" \
  "$TMP_DIR/os/systemd/arcade-input.service"

rsync "${RSYNC_ARGS[@]}" -e "${ssh_cmd[*]}" \
  "$PI_REMOTE_HOST:/etc/systemd/system/arcade-ui.service" \
  "$TMP_DIR/os/systemd/arcade-ui.service"

rsync "${RSYNC_ARGS[@]}" -e "${ssh_cmd[*]}" \
  "$PI_REMOTE_HOST:/etc/systemd/system/arcade-shell-updater.service" \
  "$TMP_DIR/os/systemd/arcade-shell-updater.service"

rsync "${RSYNC_ARGS[@]}" -e "${ssh_cmd[*]}" \
  "$PI_REMOTE_HOST:/etc/systemd/system/arcade-splash.service" \
  "$TMP_DIR/os/systemd/arcade-splash.service"

rsync "${RSYNC_ARGS[@]}" -e "${ssh_cmd[*]}" \
  "$PI_REMOTE_HOST:/etc/systemd/system/arcade-watchdog.service" \
  "$TMP_DIR/os/systemd/arcade-watchdog.service"

rsync "${RSYNC_ARGS[@]}" -e "${ssh_cmd[*]}" \
  "$PI_REMOTE_HOST:/usr/local/bin/arcade-shell-updater.mjs" \
  "$TMP_DIR/scripts/arcade-shell-updater.mjs"

if [[ "$PI_PULL_ENV" == "1" ]]; then
  rsync "${RSYNC_ARGS[@]}" -e "${ssh_cmd[*]}" \
    "$PI_REMOTE_HOST:$PI_REMOTE_RUNTIME_DIR/os/.env.arcade-service" \
    "$ROOT_DIR/.env.arcade-service"
fi

install -m 0755 "$TMP_DIR/os/.xinitrc" "$ROOT_DIR/os/.xinitrc"
install -m 0644 "$TMP_DIR/os/boot/config.txt" "$ROOT_DIR/os/boot/config.txt"
install -m 0644 "$TMP_DIR/os/boot/cmdline.txt" "$ROOT_DIR/os/boot/cmdline.txt"
install -m 0644 "$TMP_DIR/os/boot/boot.png" "$ROOT_DIR/os/boot/boot.png"
install -m 0644 "$TMP_DIR/os/retroarch.cfg" "$ROOT_DIR/os/retroarch.cfg"
install -m 0644 "$TMP_DIR/os/retroarch-single-x.cfg" "$ROOT_DIR/os/retroarch-single-x.cfg"
rsync -a --delete "$TMP_DIR/os/systemd/" "$ROOT_DIR/os/systemd/"
install -m 0755 "$TMP_DIR/scripts/arcade-shell-updater.mjs" \
  "$ROOT_DIR/scripts/arcade-shell-updater.mjs"

echo "[pi-pull] Updated repo files from live Pi:"
echo "[pi-pull]   os/.xinitrc"
echo "[pi-pull]   os/boot/config.txt"
echo "[pi-pull]   os/boot/cmdline.txt"
echo "[pi-pull]   os/boot/boot.png"
echo "[pi-pull]   os/retroarch.cfg"
echo "[pi-pull]   os/retroarch-single-x.cfg"
echo "[pi-pull]   os/systemd/*.service"
echo "[pi-pull]   scripts/arcade-shell-updater.mjs"
if [[ "$PI_PULL_ENV" == "1" ]]; then
  echo "[pi-pull]   .env.arcade-service"
fi
