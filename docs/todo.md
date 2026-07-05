# Todo

## Next
- [ ] Add ESLint + Prettier at root (lint -> typecheck -> test flow).
- [ ] Add shared watch mode so apps pick up shared source changes in dev.
- [x] Set up Prisma + SQLite - basic plumbing (schema with sqlite datasource + `env("DATABASE_URL")`, PrismaClient singleton with runtime fallback, `/api/db-health`, `DATABASE_URL` in `.env.example`, `db:generate` script).
- [x] Prisma: add first business models + `prisma migrate dev` migration workflow. (Character model + GET/POST /api/characters, 2026-07-05)
- [ ] Prisma: production DATABASE_URL configuration (env loading / secrets) before deploy.
- [x] Prisma: document `pnpm install` + `db:generate` fresh-clone step in README / CI. (2026-07-05)
- [ ] Server: config + additional endpoints beyond /api/health.
- [ ] Web: app shell, routing, API client.
- [x] Web: minimal Character list and create form. (2026-07-05)
- [x] Character management V0.2: detail, update, delete APIs and web UI. (2026-07-05)
- [x] Minimal chat V0.3: POST /api/chat mock + ChatPanel UI. (2026-07-05)
- [x] API chat + character card import V0.4: real LLM call, JSON/PNG import, card fields. (2026-07-05)
- [ ] Business features (later phases): roles, chat, worldbook, model config.
- [ ] CI workflow + pre-commit hooks.
- [ ] Test runner + fixtures.
