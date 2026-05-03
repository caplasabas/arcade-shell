#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="${ROOT_DIR}/logs/card-refresh"
mkdir -p "$LOG_DIR"

HOST="${1:-${CARD_HOST:-arcade1@10.0.254.12}}"
EXPECTED_VERSION="${EXPECTED_VERSION:-}"
WAIT_AFTER_TRIGGER_SEC="${WAIT_AFTER_TRIGGER_SEC:-20}"
REBOOT_AFTER_UPDATE="${REBOOT_AFTER_UPDATE:-1}"
SSH_WAIT_TIMEOUT_SEC="${SSH_WAIT_TIMEOUT_SEC:-180}"
SSH_OPTS=(
  -o StrictHostKeyChecking=accept-new
  -o ConnectTimeout=5
  -o BatchMode=yes
)

STAMP="$(date +%Y%m%d-%H%M%S)"
SAFE_HOST="${HOST//@/_}"
SAFE_HOST="${SAFE_HOST//:/_}"
LOG_FILE="${LOG_DIR}/${STAMP}-${SAFE_HOST}.log"

log() {
  printf '%s %s\n' "[$(date '+%H:%M:%S')]" "$*" | tee -a "$LOG_FILE"
}

run_ssh() {
  ssh "${SSH_OPTS[@]}" "$HOST" "$@" 2>&1 | tee -a "$LOG_FILE"
}

get_remote_state() {
  ssh "${SSH_OPTS[@]}" "$HOST" '
    version="$(cat /opt/arcade/os/.arcade-shell-version 2>/dev/null || echo missing)"
    input_state="$(systemctl is-active arcade-input.service 2>/dev/null || echo unknown)"
    ui_state="$(systemctl is-active arcade-ui.service 2>/dev/null || echo unknown)"
    printf "version=%s\narcade_input=%s\narcade_ui=%s\n" "$version" "$input_state" "$ui_state"
  ' 2>/dev/null
}

wait_for_ssh() {
  local waited=0
  while (( waited < SSH_WAIT_TIMEOUT_SEC )); do
    if ssh "${SSH_OPTS[@]}" "$HOST" 'echo ok' >/dev/null 2>&1; then
      return 0
    fi
    sleep 5
    waited=$((waited + 5))
  done
  return 1
}

summarize_state() {
  local state="$1"
  local version input ui
  version="$(printf '%s\n' "$state" | awk -F= '/^version=/{print $2}')"
  input="$(printf '%s\n' "$state" | awk -F= '/^arcade_input=/{print $2}')"
  ui="$(printf '%s\n' "$state" | awk -F= '/^arcade_ui=/{print $2}')"
  log "version=${version:-unknown} arcade-input=${input:-unknown} arcade-ui=${ui:-unknown}"
}

log "host=$HOST"
log "log_file=$LOG_FILE"

log "checking initial state"
INITIAL_STATE="$(get_remote_state || true)"
if [[ -z "$INITIAL_STATE" ]]; then
  log "failed to read initial state"
  exit 1
fi
summarize_state "$INITIAL_STATE"

log "clearing local-dirty pin if present"
run_ssh "if [ \"\$(cat /opt/arcade/os/.arcade-shell-version 2>/dev/null || true)\" = \"local-dirty\" ]; then sudo rm -f /opt/arcade/os/.arcade-shell-version && echo cleared; else echo not-pinned; fi"

log "triggering updater"
run_ssh "curl -sS -X POST http://localhost:5174/arcade-shell-update/run -H 'Content-Type: application/json' -d '{}'"

log "waiting ${WAIT_AFTER_TRIGGER_SEC}s for updater activity"
sleep "$WAIT_AFTER_TRIGGER_SEC"

MID_STATE="$(get_remote_state || true)"
if [[ -n "$MID_STATE" ]]; then
  log "state after updater trigger"
  summarize_state "$MID_STATE"
fi

if [[ "$REBOOT_AFTER_UPDATE" == "1" ]]; then
  log "rebooting cabinet for first-update runtime handoff"
  ssh "${SSH_OPTS[@]}" "$HOST" 'sudo reboot' >/dev/null 2>&1 || true

  log "waiting for cabinet to come back"
  if ! wait_for_ssh; then
    log "cabinet did not come back within ${SSH_WAIT_TIMEOUT_SEC}s"
    exit 1
  fi
fi

log "collecting final verification"
FINAL_STATE="$(get_remote_state || true)"
if [[ -z "$FINAL_STATE" ]]; then
  log "failed to read final state"
  exit 1
fi
summarize_state "$FINAL_STATE"

FINAL_VERSION="$(printf '%s\n' "$FINAL_STATE" | awk -F= '/^version=/{print $2}')"
FINAL_INPUT="$(printf '%s\n' "$FINAL_STATE" | awk -F= '/^arcade_input=/{print $2}')"
FINAL_UI="$(printf '%s\n' "$FINAL_STATE" | awk -F= '/^arcade_ui=/{print $2}')"

if [[ -n "$EXPECTED_VERSION" ]]; then
  if [[ "$FINAL_VERSION" == "$EXPECTED_VERSION" ]]; then
    log "expected version matched: $EXPECTED_VERSION"
  else
    log "expected version mismatch: got=$FINAL_VERSION expected=$EXPECTED_VERSION"
    exit 1
  fi
fi

if [[ "$FINAL_INPUT" != "active" || "$FINAL_UI" != "active" ]]; then
  log "service verification failed"
  exit 1
fi

log "done"
log "next: quick physical test on cabinet, then power off and swap the next card"
