# Devlog

## 2026-07-04
- Initialized pnpm workspace monorepo skeleton.
- Added apps/web (Vite + React + TypeScript), apps/server (Fastify + TypeScript), packages/shared (shared types, buildable).
- Wired workspace dependencies: both apps depend on @roleagent/shared via workspace:*.
- packages/shared builds to dist; exports point to dist/index.js + dist/index.d.ts.
- Root scripts (dev/build/typecheck) build shared first, then run apps.
- Added .env.example (no API keys), tsconfig.base.json, .gitignore supplements.
- No business logic implemented; Prisma + SQLite deferred to a later phase.
