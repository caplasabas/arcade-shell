# Service Migration Order

This refactor is intentionally `review-first` and `connect-later`.

Rules:
- Do not switch the live runtime to `src/` all at once.
- Review each module against `input.js` before connecting it.
- Connect one slice at a time on the dev test cabinet.
- Publish only after the same repo state passes on the cabinet.
- Use the scaffold service on a separate port for smoke tests before any cutover.
- Keep `src/input.ts` as the loose-typed TS monolith while slices are being extracted.

## Recommended Order

1. `src/types.ts`
   - Shared contracts only.
   - No runtime behavior.

2. `src/config.ts`
   - Environment parsing and defaults.
   - Safe because it is pure input/output.

3. `src/games/`
   - Static metadata only.
   - Verify catalog parity with existing constants.

4. `src/state/`
   - Local stores only.
   - No backend or process side effects.

5. `src/ui/`
   - Derived overlay/view state only.
   - Safe if it stays read-only.

6. `src/session/`
   - Move session transitions and timers after state/types are stable.

7. `src/device/`
   - Move device identity and backend boundary after session logic is typed.
   - Keep backend auth changes separate from pure refactors.

8. `src/hardware/`
   - Move GPIO and hopper/coin controllers as hardware adapters first.
   - Keep them callback-driven and free of backend writes.

9. `src/runtime/`
   - Move process launch and OS integration after the contracts above are stable.

10. `src/api/`
   - Connect last because it ties all services together.

## Connect Checklist

For each module:

1. Compare the extracted code to `input.js`.
2. Confirm input/output contracts match the current runtime behavior.
3. Connect only one call site or one route group.
4. Sync to the dev cabinet manually.
5. Validate the exact behavior on-device.
6. Keep the old path intact until the new path is proven.
7. Remove dead code only after the replacement is stable.

## Cutover Guidance

- First cut over pure modules.
- Then cut over one local route cluster at a time.
- Cut over backend authority only after local behavior is stable.
- Do not mix auth redesign and module extraction in the same risky step.

## Smoke Test Mode

Run the extracted scaffold as a separate service:

```bash
ARCADE_SERVICE_PORT=3171 npm run --workspace apps/service build:scaffold
ARCADE_SERVICE_PORT=3171 npm run --workspace apps/service start:scaffold
```

Single-file bundle option:

```bash
ARCADE_SERVICE_PORT=3171 npm run --workspace apps/service bundle
ARCADE_SERVICE_PORT=3171 npm run --workspace apps/service start:bundle
```

Use it only to validate low-risk slices like:
- `GET /health`
- `GET /device-id`
- `GET /runtime/auth-context`
- `GET /device-state`
- `GET /cabinet-games`
- `GET /network-info`
- `GET /games`

Do not treat scaffold responses as replacements for:
- RetroArch launch/exit
- hopper/withdraw execution
- GPIO/input device handling
- arcade-time/session accounting
- Wi-Fi connect/delete flows
