# arcade-shell

Monorepo containing:

- apps/ui (Vite frontend)
- apps/service (Node hardware service)
- roms (RetroArch ROMS folder)
- scripts (deployment scripts/pi os (debian) scripts)

## Pi quick sync workflow

1. Copy `.pi-sync.env.example` to `.pi-sync.env` and set:
   - `PI_REMOTE_HOST` (example: `arcade1@192.168.1.50`)
   - service names (`PI_INPUT_SERVICE`, `PI_KIOSK_SERVICE`)
2. One-shot deploy:
   - `npm run pi:sync`
3. Watch mode (auto-sync on save):
   - `npm run pi:watch`

Behavior:
- Rsyncs project to `PI_REMOTE_DIR` (default `/home/arcade1/arcade`)
- Optionally installs RetroArch config from `os/retroarch.cfg` to active runtime `RETROARCH_CONFIG_PATH` (`PI_SYNC_RETROARCH_CONFIG=1`)
- Optionally runs remote UI build (`PI_BUILD_UI=1`)
- Restarts services via `systemctl` (no reboot)

## RetroArch OSD Fix Note (important)

If `arcade-input.service` logs show `[RETROARCH OSD]` but no text is visible in-game, ensure this key is set:

- `notification_show_when_menu_is_alive = "false"` in `os/retroarch.cfg`

Working baseline used during recovery:

- `RETROARCH_OSD_COMMAND=AUTO` (`.env.arcade-service`)
- `menu_enable_widgets = "true"`
- `video_crop_overscan = "false"`
- `input_overlay_enable = "false"` (unless intentionally testing controller overlays)

After changing config, restart:

- `sudo systemctl restart arcade-input.service arcade-ui.service`
