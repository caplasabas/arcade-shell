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

## Recommended deployment workflow

Use two separate routes on purpose:

1. Test first on the dedicated test cabinet via SSH
2. Publish globally only after that exact repo state is validated

Recommended sequence:

1. Make changes in this repo
2. Push the repo state to the test cabinet with `npm run pi:sync`
3. Validate behavior on the current test cabinet host
4. If the test passes, publish from the same repo state with `npm run publish:arcade-shell`

Practical guidance:
- Prefer `npm run pi:sync` or `npm run pi:watch` over manual SSH edits so the tested cabinet state matches the working tree
- Direct SSH edits on the test cabinet are acceptable for fast debugging, but they should be copied back into the repo before publishing
- Keep the active test cabinet host in `.pi-sync.env`; do not hardcode a permanent IP in workflow docs
- `npm run publish:arcade-shell` packages, encrypts, and uploads the release metadata consumed by the cabinet updater flow
- Do not publish changes that were only tested as ad hoc edits on the cabinet and not reproduced locally

Short version:
- test locally on the current test cabinet
- publish only what passed there
