# Arcade Watchdog

Tracks the input service, Chromium kiosk, RetroArch emulator, network, and disk health so the cabinet can recover from crashes or freezes.

## Deployment
1. Copy `scripts/arcade-watchdog.sh` to `/usr/local/bin/arcade-watchdog.sh` and `chmod +x` it.
2. Place `default/arcade-watchdog.env.example` at `/etc/default/arcade-watchdog.env` and edit values to match your installation paths and device names.
3. Copy `os/systemd/arcade-watchdog.service` to `/etc/systemd/system/arcade-watchdog.service`.
4. Reload and enable the service: `systemctl daemon-reload && systemctl enable --now arcade-watchdog`.
5. Monitor `/var/log/arcade-watchdog/*.log` and `journalctl -fu arcade-watchdog` for behavior.

## Responsibilities
- **Input service**: checks `arcade-input.service` plus an HTTP health probe (default `http://127.0.0.1:5174/device-id`) and restarts the service when it stops responding.
- **Chromium**: relaunches if the `chromium` pattern disappears, logging the restart and piping output to a dedicated logfile.
- **RetroArch**: restarts when the process exits or its CPU usage stays below `RETROARCH_STUCK_CPU_THRESHOLD` for `RETROARCH_STUCK_CYCLES` loops.
- **Network**: pings `NETWORK_CHECK_HOST` (default `1.1.1.1`). After `NETWORK_FAILURE_RESTART_THRESHOLD` misses it runs `RESTART_NETWORK_COMMAND`, and if failures reach `NETWORK_FAILURE_REBOOT_THRESHOLD`, the watchdog triggers `systemctl reboot` (or `REBOOT_COMMAND` if set).
- **Disk health**: monitors disk usage on `DISK_PATH` and optionally runs `smartctl -H` against `SMART_DEVICE` whenever enough time has passed.

## Systemd integration
- The unit runs as `root` with `Type=notify`, `WatchdogSec=60`, and `OnFailure=reboot.target`, so `systemd` reboots the Pi if the watchdog freezes.
- The script sends `systemd-notify --ready` once it starts and keeps the watchdog alive at the end of each loop.

## Tuning tips
- Adjust `CHECK_INTERVAL` or the CPU thresholds when the system is slow.
- Update `CHROMIUM_CMD`/`RETROARCH_CMD` to the same commands the cabinet already uses so restarts keep the environment consistent.
- Point `SMART_DEVICE` to `/dev/mmcblk0` or your main SSD/hard drive if SMART is available.
