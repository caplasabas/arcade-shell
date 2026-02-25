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
- Optionally runs remote UI build (`PI_BUILD_UI=1`)
- Restarts services via `systemctl` (no reboot)
