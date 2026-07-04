# AGENTS.md

Guidance for OpenCode sessions working in this repo.

## Status
pnpm workspace monorepo, skeleton stage. `pnpm dev` / `pnpm typecheck` / `pnpm build` are wired up and working.
Not yet present: Prisma + SQLite, ESLint/Prettier, test runner, and any business features (roles, chat, worldbook, model config).
pnpm is pinned to `pnpm@9.15.0` via the `packageManager` field.

## Stack
- pnpm workspace (pnpm@9.15.0) + TypeScript
- apps/web: React + Vite
- apps/server: Fastify (exposes GET /api/health)
- packages/shared: buildable shared types/utilities; exports point to dist/
- Gitignored: build outputs (dist/, build/), local data (data/, *.db, *.sqlite), secrets (.env, .env.local)

## Layout
- apps/web — Vite + React + TS frontend
- apps/server — Fastify + TS backend
- packages/shared — shared package; apps depend on its built dist
- docs/devlog.md — development journal (append notes here)
- docs/todo.md — task backlog
- README.md — project overview
- tsconfig.base.json — shared strictness flags; per-package tsconfig extends it

## Commands (verified in package.json)
- `pnpm install` — install dependencies
- `pnpm dev` — build shared, then run web (:5173) + server (:3000) in parallel
- `pnpm typecheck` — build shared, then `tsc --noEmit` across all packages
- `pnpm build` — build shared, then build apps (web: vite build, server: tsc)
- Do not invent scripts that are not present in package.json.

## Build-order gotcha
`packages/shared` must be built before apps can typecheck/build/run, because apps import its `dist/`.
Root scripts handle this via `pnpm --filter @roleagent/shared build && ...`. When running a single package
directly (e.g. `pnpm --filter @roleagent/server dev`), build shared first if its `dist/` is missing (fresh clone).
`dist/` is gitignored, so a clean checkout has no shared build output.

## Workflow
- Confirm the current branch before starting work; do not commit directly to main.
- Work on feature branches; merge via PR.
- Prefer small, reviewable changes (small steps).
- After changes, run `pnpm typecheck` and `pnpm build` to verify.
- Lint/test steps will be added when ESLint and a test runner land.

## Agent Rules
- Do not modify unrelated files.
- Do not install new dependencies without approval.
- Do not commit .env, API keys, local databases, or generated build outputs.
- Do not invent scripts that are not present in package.json.
- Prefer small, reviewable changes.
