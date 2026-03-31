#!/usr/bin/env bash
set -euo pipefail

SCRIPT_NAME=$(basename "$0")
LOG_DIR=${LOG_DIR:-/var/log/arcade-watchdog}
LOG_FILE=${LOG_FILE:-$LOG_DIR/watchdog.log}
CHECK_INTERVAL=${CHECK_INTERVAL:-10}
STARTUP_GRACE_SEC=${STARTUP_GRACE_SEC:-30}

CHROMIUM_CMD=${CHROMIUM_CMD:-}
CHROMIUM_PATTERN=${CHROMIUM_PATTERN:-}
CHROMIUM_LOG=${CHROMIUM_LOG:-$LOG_DIR/chromium.log}

RETROARCH_CMD=${RETROARCH_CMD:-}
RETROARCH_PATTERN=${RETROARCH_PATTERN:-}
RETROARCH_LOG=${RETROARCH_LOG:-$LOG_DIR/retroarch.log}
RETROARCH_STUCK_CPU_THRESHOLD=${RETROARCH_STUCK_CPU_THRESHOLD:-0.5}
RETROARCH_STUCK_CYCLES=${RETROARCH_STUCK_CYCLES:-6}

INPUT_SERVICE_NAME=${INPUT_SERVICE_NAME:-arcade-input.service}
INPUT_HEALTH_URL=${INPUT_HEALTH_URL:-http://127.0.0.1:5174/device-id}
INPUT_HEALTH_TIMEOUT=${INPUT_HEALTH_TIMEOUT:-3}
INPUT_FAILURE_RESTART_THRESHOLD=${INPUT_FAILURE_RESTART_THRESHOLD:-2}
INPUT_LINK_STATUS_URL=${INPUT_LINK_STATUS_URL:-http://127.0.0.1:5174/input-link-status}
INPUT_LINK_FAILURE_RESTART_THRESHOLD=${INPUT_LINK_FAILURE_RESTART_THRESHOLD:-3}

UI_SERVICE_NAME=${UI_SERVICE_NAME:-arcade-ui.service}
UI_HEALTH_URL=${UI_HEALTH_URL:-http://127.0.0.1:5174/}
UI_HEALTH_TIMEOUT=${UI_HEALTH_TIMEOUT:-4}
UI_FAILURE_RESTART_THRESHOLD=${UI_FAILURE_RESTART_THRESHOLD:-2}

NETWORK_CHECK_HOST=${NETWORK_CHECK_HOST:-1.1.1.1}
NETWORK_CHECK_TIMEOUT=${NETWORK_CHECK_TIMEOUT:-5}
NETWORK_FAILURE_RESTART_THRESHOLD=${NETWORK_FAILURE_RESTART_THRESHOLD:-3}
NETWORK_FAILURE_REBOOT_THRESHOLD=${NETWORK_FAILURE_REBOOT_THRESHOLD:-12}
RESTART_NETWORK_COMMAND=${RESTART_NETWORK_COMMAND:-}

DISK_PATH=${DISK_PATH:-/}
DISK_USAGE_THRESHOLD=${DISK_USAGE_THRESHOLD:-90}
DISK_FAILURES_BEFORE_WARNING=${DISK_FAILURES_BEFORE_WARNING:-3}
SMART_DEVICE=${SMART_DEVICE:-}
SMART_CHECK_INTERVAL=${SMART_CHECK_INTERVAL:-3600}

REBOOT_COMMAND=${REBOOT_COMMAND:-}

mkdir -p "$LOG_DIR"

trap 'log CRITICAL "triggered exit ($?)"' EXIT

retroarch_stuck_counter=0
input_failures=0
input_link_failures=0
ui_failures=0
network_failures=0
disk_failure_count=0
smart_failure_count=0
last_smart_check=0
reboot_triggered=0
started_at=$SECONDS

log() {
  local level=$1
  shift
  printf '%s [%s] [%s] %s\n' "$(date +'%Y-%m-%dT%H:%M:%S%z')" "$SCRIPT_NAME" "$level" "$*" | tee -a "$LOG_FILE"
}

supports_keep_alive=0
if command -v systemd-notify >/dev/null 2>&1; then
  set +e
  systemd-notify --keep-alive >/dev/null 2>&1 && supports_keep_alive=1
  set -e
fi

notify_systemd_ready() {
  if command -v systemd-notify >/dev/null 2>&1; then
    systemd-notify --ready >/dev/null 2>&1 || true
  fi
}

notify_systemd_watchdog() {
  if ! command -v systemd-notify >/dev/null 2>&1; then
    return
  fi

  if ((supports_keep_alive)); then
    systemd-notify --keep-alive >/dev/null 2>&1 || true
  else
    WATCHDOG=1 systemd-notify >/dev/null 2>&1 || true
  fi
}

process_pid() {
  local pattern=$1
  pgrep -f "$pattern" 2>/dev/null | head -n1 || true
}

start_background() {
  local name=$1
  local cmd=$2
  local logfile=$3
  mkdir -p "$(dirname "$logfile")"
  log INFO "$name" "launching: $cmd"
  setsid bash -lc "$cmd" >>"$logfile" 2>&1 &
}

start_retroarch() {
  start_background "retroarch" "$RETROARCH_CMD" "$RETROARCH_LOG"
}

restart_managed_service() {
  local service_name=$1
  if [[ -z "$service_name" ]]; then
    return
  fi

  if ! command -v systemctl >/dev/null 2>&1; then
    log WARN "Service" "systemctl unavailable; cannot restart $service_name"
    return
  fi

  log WARN "Service" "restarting $service_name"
  systemctl restart "$service_name" >/dev/null 2>&1 || true
}

monitor_input_service() {
  if ((SECONDS - started_at < STARTUP_GRACE_SEC)); then
    return
  fi
  local service_name=$INPUT_SERVICE_NAME
  local health_url=$INPUT_HEALTH_URL
  local timeout_seconds=$INPUT_HEALTH_TIMEOUT

  if [[ -n "$service_name" ]] && command -v systemctl >/dev/null 2>&1; then
    if ! systemctl is-active --quiet "$service_name"; then
      log WARN "Input" "$service_name inactive, restarting"
      restart_managed_service "$service_name"
      input_failures=0
      return
    fi
  fi

  if [[ -z "$health_url" ]]; then
    input_failures=0
    return
  fi

  if curl -fsS --max-time "$timeout_seconds" "$health_url" >/dev/null 2>&1; then
    if ((input_failures > 0)); then
      log INFO "Input" "health probe restored"
    fi
    input_failures=0
    return
  fi

  ((input_failures++))
  log WARN "Input" "health probe failed ($input_failures/$INPUT_FAILURE_RESTART_THRESHOLD): $health_url"

  if ((input_failures >= INPUT_FAILURE_RESTART_THRESHOLD)); then
    restart_managed_service "$service_name"
    input_failures=0
  fi
}

monitor_input_links() {
  if ((SECONDS - started_at < STARTUP_GRACE_SEC)); then
    return
  fi
  local status_url=$INPUT_LINK_STATUS_URL
  if [[ -z "$status_url" ]]; then
    input_link_failures=0
    return
  fi

  local payload
  payload=$(curl -fsS --max-time "$INPUT_HEALTH_TIMEOUT" "$status_url" 2>/dev/null || true)
  if [[ -z "$payload" ]]; then
    ((input_link_failures++))
    log WARN "InputLinks" "status probe failed ($input_link_failures/$INPUT_LINK_FAILURE_RESTART_THRESHOLD)"
  elif grep -q '"healthy":[[:space:]]*true' <<<"$payload"; then
    if ((input_link_failures > 0)); then
      log INFO "InputLinks" "all links restored"
    fi
    input_link_failures=0
    return
  else
    ((input_link_failures++))
    log WARN "InputLinks" "encoder link missing ($input_link_failures/$INPUT_LINK_FAILURE_RESTART_THRESHOLD)"
  fi

  if ((input_link_failures >= INPUT_LINK_FAILURE_RESTART_THRESHOLD)); then
    restart_managed_service "$INPUT_SERVICE_NAME"
    restart_managed_service "$UI_SERVICE_NAME"
    input_link_failures=0
  fi
}

monitor_ui_service() {
  if ((SECONDS - started_at < STARTUP_GRACE_SEC)); then
    return
  fi
  local service_name=$UI_SERVICE_NAME
  if [[ -n "$service_name" ]] && command -v systemctl >/dev/null 2>&1; then
    if ! systemctl is-active --quiet "$service_name"; then
      ((ui_failures++))
      log WARN "UI" "$service_name inactive ($ui_failures/$UI_FAILURE_RESTART_THRESHOLD)"
    else
      if [[ -n "$UI_HEALTH_URL" ]] && ! curl -fsS --max-time "$UI_HEALTH_TIMEOUT" "$UI_HEALTH_URL" >/dev/null 2>&1; then
        ((ui_failures++))
        log WARN "UI" "health probe failed ($ui_failures/$UI_FAILURE_RESTART_THRESHOLD): $UI_HEALTH_URL"
      else
        if ((ui_failures > 0)); then
          log INFO "UI" "health restored"
        fi
        ui_failures=0
        return
      fi
    fi
  fi

  if ((ui_failures >= UI_FAILURE_RESTART_THRESHOLD)); then
    restart_managed_service "$service_name"
    ui_failures=0
  fi
}

monitor_chromium() {
  if [[ -z "$CHROMIUM_PATTERN" || -z "$CHROMIUM_CMD" ]]; then
    return
  fi
  local pid
  pid=$(process_pid "$CHROMIUM_PATTERN")
  if [[ -z "$pid" ]]; then
    log WARN "Chromium" "not running, restarting"
    start_background "chromium" "$CHROMIUM_CMD" "$CHROMIUM_LOG"
  fi
}

monitor_retroarch() {
  if [[ -z "$RETROARCH_PATTERN" || -z "$RETROARCH_CMD" ]]; then
    return
  fi
  local pid cpu
  pid=$(process_pid "$RETROARCH_PATTERN")

  if [[ -z "$pid" ]]; then
    log WARN "RetroArch" "process missing, starting"
    start_retroarch
    retroarch_stuck_counter=0
    return
  fi

  cpu=$(ps -p "$pid" -o %cpu= 2>/dev/null | tr -d '[:space:]' || true)
  cpu=${cpu:-0}

  if awk "BEGIN {exit !($cpu < $RETROARCH_STUCK_CPU_THRESHOLD)}"; then
    ((retroarch_stuck_counter++))
  else
    retroarch_stuck_counter=0
  fi

  if ((retroarch_stuck_counter >= RETROARCH_STUCK_CYCLES)); then
    log WARN "RetroArch" "low CPU ($cpu%%) for $retroarch_stuck_counter samples, restarting"
    kill "$pid" >/dev/null 2>&1 || true
    start_retroarch
    retroarch_stuck_counter=0
  fi
}

restart_network() {
  log INFO "Network" "attempting recovery"
  if [[ -n "$RESTART_NETWORK_COMMAND" ]]; then
    bash -cl "$RESTART_NETWORK_COMMAND"
    return
  fi

  if command -v nmcli >/dev/null 2>&1; then
    nmcli networking off >/dev/null 2>&1
    sleep 2
    nmcli networking on >/dev/null 2>&1
    return
  fi

  if command -v systemctl >/dev/null 2>&1; then
    systemctl restart NetworkManager.service >/dev/null 2>&1 || systemctl restart networking.service >/dev/null 2>&1 || true
    return
  fi

  log WARN "Network" "no helper command found to restart network"
}

trigger_reboot() {
  local reason=$1
  if ((reboot_triggered)); then
    return
  fi
  reboot_triggered=1
  log CRITICAL "System" "reboot triggered (reason: $reason)"
  if [[ -n "$REBOOT_COMMAND" ]]; then
    bash -cl "$REBOOT_COMMAND"
    return
  fi
  if command -v systemctl >/dev/null 2>&1; then
    systemctl reboot
  else
    /sbin/reboot || /usr/sbin/reboot || true
  fi
}

check_network() {
  if timeout "$NETWORK_CHECK_TIMEOUT" ping -c1 "$NETWORK_CHECK_HOST" >/dev/null 2>&1; then
    if ((network_failures > 0)); then
      log INFO "Network" "connectivity restored"
    fi
    network_failures=0
    return
  fi

  ((network_failures++))
  log WARN "Network" "connectivity check failed ($network_failures/$NETWORK_FAILURE_REBOOT_THRESHOLD)"

  if ((network_failures == NETWORK_FAILURE_RESTART_THRESHOLD)); then
    restart_network
  fi

  if ((network_failures >= NETWORK_FAILURE_REBOOT_THRESHOLD)); then
    trigger_reboot "network unreachable"
  fi
}

smartctl_available() {
  command -v smartctl >/dev/null 2>&1
}

run_smart_check() {
  local output
  log INFO "Disk" "running SMART health scan for $SMART_DEVICE"
  if ! output=$(smartctl -H "$SMART_DEVICE" 2>&1); then
    log WARN "Disk" "smartctl failed: $(head -n1 <<<\"$output\")"
    ((smart_failure_count++))
    return
  fi

  if grep -qi "PASSED" <<<"$output"; then
    log INFO "Disk" "SMART passed"
    smart_failure_count=0
  else
    log WARN "Disk" "SMART reported issues: $(head -n1 <<<\"$output\")"
    ((smart_failure_count++))
  fi
}

check_disk() {
  local usage
  usage=$(df --output=pcent "$DISK_PATH" 2>/dev/null | tail -n1 | tr -dc '0-9')

  if [[ -n "$usage" && "$usage" -ge "$DISK_USAGE_THRESHOLD" ]]; then
    ((disk_failure_count++))
    if ((disk_failure_count % DISK_FAILURES_BEFORE_WARNING == 1)); then
      log WARN "Disk" "usage $usage% exceeds $DISK_USAGE_THRESHOLD%"
    fi
  else
    disk_failure_count=0
  fi

  if [[ -n "$SMART_DEVICE" ]] && smartctl_available && ((last_smart_check == 0 || SECONDS - last_smart_check >= SMART_CHECK_INTERVAL)); then
    last_smart_check=$SECONDS
    run_smart_check
  fi
}

main_loop() {
  notify_systemd_ready
  while true; do
    monitor_input_service
    monitor_input_links
    monitor_ui_service
    monitor_chromium
    monitor_retroarch
    check_network
    check_disk
    notify_systemd_watchdog
    sleep "$CHECK_INTERVAL"
  done
}

main_loop
