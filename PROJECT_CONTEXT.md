# PROJECT_CONTEXT.md

## Purpose
- Capture the active ChatGPT/Codex instructions and repository signal so future sessions can drop this file in and behave consistently.

## System directives (from the current session)
- `ChatGPT` is running under the Codex persona (GPT-5) with sandboxed shell access. Always prefer direct tooling when possible, obey the strict citation rules when referencing web results, and escalate only when absolutely necessary.
- Use `rg` for searching text, prefer `rg --files` for listing (since it is fast).
- Avoid destructive git operations, do not revert user changes, and default to ASCII text unless non-ASCII is already required.

## Developer instructions (current project-specific mandates)
- The user, developer, and AGENT instructions stress being a pragmatic engineer: focus on actionable code changes, report precisely, and keep explanations short.
- Provide user updates via the `commentary` channel every ~30s during longer operations, describing current phase and next steps; before reading files, send a pre-read update, and before edits, describe what you plan to change.
- Use `apply_patch` for manual edits, avoid inline shell multi-commands, and track progress with short, factual updates. Never run git interactive commands; keep git usage non-destructive.
- Final responses should prefer short paragraphs, minimal listing, no nested bullets, and include verification of any skipped tests or blockers.

## AGENTS/skills context
- Known skill files (per AGENTS instructions) live under `/Users/cplasabas/Library/Caches/JetBrains/WebStorm2025.3/aia/codex/skills/.system/` and include `skill-creator`, `skill-installer`, `slides`, and `spreadsheets`. The active instruction is to trigger these skills only when explicitly referenced or when a task clearly matches their description. For a context-write request like this, no extra skill invocation was required.

## Repository snapshot (March 15, 2026, Asia/Manila timezone)
- Root workspace: `apps/` and `packages/` workspaces managed via the root `package.json`. The primary scripts are `lint`, `format`, `ui`, `build`, `engine:simulate`, `build:engine`, `build:web`, `package:game`, `deploy:local`, `package:encrypted`, and `publish:supabase`.
- `apps/ultra-ace-web/` is a React + Vite TypeScript app (React 19.2, Vite 7.2). Key dependencies include `@supabase/supabase-js`, `@ultra-ace/engine` (workspace link), `react`, `react-dom`, and `uuid`. Building relies on `tsc -b` followed by `vite build`.
- `packages/engine/` houses the engine module (`@ultra-ace/engine`), built with TypeScript via `tsc -p tsconfig.build.json`. The runtime exposes `dist/index.js` and dist types, and has a simulation script (`node dist/simulate.js`).
- `apps/dashboard` exists but was not inspected; presume it follows the same monorepo structure.

## Active developer workflow notes
- The repo is private, and local commands run inside `/Users/cplasabas/Desktop/Projects/Personal/ultra-ace`, where `node_modules/`, `apps/`, `packages/`, and `scripts/` contain the working tree.
- Use `npm run ui` for running the web app in dev mode and `npm run build` for full compilation (engine + web). Packaging is handled by the shell scripts under `scripts/` (`package.sh`, `package-encrypted.sh`, `deploy-local.sh`, `publish-supabase.mjs`).
- Testing/data details are not specified; default manual validation through `npm run build` is presumed adequate.

## Communication reminders
- All instructions about pacing, escalation, and testing in the developer brief still apply: keep user updates concise, explain automation decisions, never omit mention of unrun tests, and return the finished context file as the primary deliverable.
