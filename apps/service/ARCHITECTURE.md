# Service Refactor Scaffold

This directory introduces a non-breaking TypeScript scaffold for `apps/service`.

Current rule:
- `input.js` remains the live runtime entrypoint.
- `src/` is the migration target.
- `src/input.ts` is the loose-typed TypeScript clone of the live monolith.

Intended responsibilities:
- `src/config.ts`: runtime config loading
- `src/types.ts`: shared service contracts
- `src/games/`: static catalog and game metadata
- `src/state/`: local process state stores
- `src/session/`: session lifecycle logic
- `src/ui/`: UI-facing derived state
- `src/device/`: device identity and backend authority
- `src/hardware/`: GPIO, hopper, coin acceptor, and input-device integrations
- `src/runtime/`: process launchers and OS/runtime integration
- `src/api/`: localhost HTTP and WebSocket surfaces

Migration order:
1. Move pure helpers and state stores.
2. Move local HTTP handlers.
3. Move backend/Supabase client logic.
4. Move hardware/runtime integrations.
5. Cut over `input.js` behavior incrementally into `src/input.ts`.
6. Only then replace the TS monolith with thinner composition roots.

Notes:
- This scaffold intentionally keeps some endpoints as placeholders.
- Auth and Supabase authority are meant to move into the service layer later.
- Use `MIGRATION_ORDER.md` as the sequence of review and cutover.
