# Todo

## Next
- [ ] Add ESLint + Prettier at root (lint -> typecheck -> test flow).
- [ ] Add shared watch mode so apps pick up shared source changes in dev.
- [x] Set up Prisma + SQLite — basic plumbing (schema with sqlite datasource + `env("DATABASE_URL")`, PrismaClient singleton with runtime fallback, `/api/db-health`, `DATABASE_URL` in `.env.example`, `db:generate` script).
- [ ] Prisma: add first business models + `prisma migrate dev` migration workflow.
- [ ] Prisma: production DATABASE_URL configuration (env loading / secrets) before deploy.
- [ ] Prisma: document `pnpm install` + `db:generate` fresh-clone step in README / CI.
- [ ] Server: config + additional endpoints beyond /api/health.
- [ ] Web: app shell, routing, API client.
- [ ] Business features (later phases): roles, chat, worldbook, model config.
- [ ] CI workflow + pre-commit hooks.
- [ ] Test runner + fixtures.
