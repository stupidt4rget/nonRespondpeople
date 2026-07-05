# RoleAgent Tavern

A tavern-style roleplay agent tool. This repo is currently at stage V0.1: Prisma + SQLite persistence is wired up, the first business model Character is implemented with a minimal backend API, and a minimal web page (character list + create form) is provided for validation. Chat, worldbook, model config, and character card editor are not implemented yet.

## Current Features (V0.1)

- Health status: `GET /api/health`, `GET /api/db-health`
- Prisma 6 + SQLite persistence (local `dev.db` file)
- Character model (id, name, description, createdAt, updatedAt)
- `GET /api/characters` - return character list sorted by createdAt desc
- `POST /api/characters` - create a character
- Minimal web character list (http://localhost:5173)
- Minimal web create form
- Character detail view, edit, and delete (select a character in the list)

## Not Implemented Yet

- Chat
- Worldbook
- Model config
- Character card editor

## Tech Stack

- Package manager: pnpm workspace (pinned to `pnpm@9.15.0`)
- Language: TypeScript
- `apps/web`: React + Vite
- `apps/server`: Fastify
- `packages/shared`: buildable shared types/utilities
- Database: Prisma 6 + SQLite
- Runtime: Node.js (dev environment uses v24)

## Directory Structure

```
RoleAgent Tavern/
|-- apps/
|   |-- web/                # React + Vite frontend
|   |   |-- src/
|   |   |   |-- App.tsx
|   |   |   |-- api.ts      # Character API call wrappers
|   |   |   |-- main.tsx
|   |   |   `-- vite-env.d.ts
|   |   |-- index.html
|   |   |-- vite.config.ts
|   |   `-- tsconfig.json
|   `-- server/             # Fastify backend
|       |-- prisma/
|       |   |-- schema.prisma   # Prisma schema (Character model)
|       |   `-- migrations/     # migration files (committed)
|       |-- src/
|       |   |-- index.ts
|       |   |-- db/prisma.ts
|       |   `-- routes/characters.ts
|       `-- tsconfig.json
|-- packages/
|   `-- shared/             # shared types (builds to dist, used by apps)
|       |-- src/index.ts
|       `-- tsconfig.json
|-- docs/
|   |-- devlog.md           # development log
|   `-- todo.md             # task backlog
|-- .env.example            # env var template (no API keys)
|-- .gitignore
|-- AGENTS.md
|-- package.json            # root workspace scripts
|-- pnpm-workspace.yaml
|-- tsconfig.base.json
`-- README.md
```

> `node_modules/`, each package's `dist/`, `data/`, `*.db` are generated or local data, ignored by `.gitignore`, and not under version control.

## Prerequisites

1. Install Node.js (dev environment uses v24).
2. Enable pnpm. This repo pins `pnpm@9.15.0` via the `packageManager` field in `package.json`; if not installed, run `npm install -g pnpm@9.15.0`.
3. Copy the env var template (modify as needed; never commit `.env`):

   Windows PowerShell:
   ```powershell
   copy .env.example .env
   ```

   Git Bash / macOS / Linux:
   ```bash
   cp .env.example .env
   ```

   > Note: at runtime `DATABASE_URL` falls back to `file:./dev.db`, so `pnpm dev` works without `.env`; but `prisma generate` and `prisma migrate dev` require `DATABASE_URL` to be set (because the schema uses `env("DATABASE_URL")`), see the fresh clone setup below.

## Fresh Clone Setup (Windows PowerShell)

The `packages/shared` build output (`dist/`) and the Prisma Client are not under version control, so a fresh clone must build them first before typecheck/build/run:

```powershell
pnpm install
$env:DATABASE_URL="file:./dev.db"; pnpm --filter @roleagent/server db:generate
$env:DATABASE_URL="file:./dev.db"; pnpm --filter @roleagent/server exec prisma migrate dev
pnpm dev
```

- `db:generate`: generates the Prisma Client; apps depend on its types and runtime.
- `migrate dev`: applies existing migrations (`add_character_model`) and creates tables in `apps/server/prisma/dev.db`.
- Both commands need `DATABASE_URL`; here it is injected via a PowerShell temporary env var, without writing `.env`.

> Bash users: replace `$env:DATABASE_URL="file:./dev.db"; pnpm ...` with `DATABASE_URL="file:./dev.db" pnpm ...`.

## Start Dev Environment

```bash
pnpm dev
```

This first builds `packages/shared`, then starts in parallel:
- Frontend page: http://localhost:5173 (Vite, proxies `/api` to the backend)
- Backend API: http://localhost:3000

Open http://localhost:5173 to see: backend connection status, character list, character create form.

## Type Check

```bash
pnpm typecheck
```

First builds `packages/shared`, then runs `tsc --noEmit` across all packages.

## Build

```bash
pnpm build
```

First builds `packages/shared`, then builds `apps/web` (`vite build`) and `apps/server` (`tsc`); outputs go to each package's `dist/`. The backend can run standalone:

```bash
node apps/server/dist/index.js
```

## API Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Backend liveness check, returns `{status, name}` |
| GET | `/api/db-health` | Database connectivity check, returns `{status, database}` |
| GET | `/api/characters` | Return character list, sorted by `createdAt desc` |
| POST | `/api/characters` | Create a character, body `{name, description?}`, returns 201 with the created item; empty name returns 400 |
| GET | `/api/characters/:id` | Return a single character; 404 if not found |
| PATCH | `/api/characters/:id` | Update a character, body `{name?, description?}` (`description: null` clears it); 400 on empty name / no fields; 404 if not found |
| DELETE | `/api/characters/:id` | Delete a character, returns `{ok, id}`; 404 if not found |

Examples:

```
GET http://localhost:3000/api/health
```

```json
{ "status": "ok", "name": "RoleAgent Tavern" }
```

```
GET http://localhost:3000/api/characters
```

```json
{ "characters": [ { "id": "...", "name": "Aria", "description": "...", "createdAt": "...", "updatedAt": "..." } ] }
```

```
POST http://localhost:3000/api/characters
Content-Type: application/json

{ "name": "Aria", "description": "test" }
```

## Git Branch Rules

- Develop on feature branches, merge via PR.
- Do not commit directly to `main`.
- See `AGENTS.md` for details.

## Notes

- Never commit `.env`, `.env.local`, API keys, or any secrets.
- Never commit local databases (`*.db`, `*.sqlite`), `data/`, or build outputs (`dist/`, `build/`); all are ignored by `.gitignore`. The `dev.db` file lives at `apps/server/prisma/dev.db`.
- Only `.env.example` is committed as a template, with no real secrets.
- Branch note: `main` is not the latest development branch; `dev` is the current development branch. Features are developed on `feature/*` branches and merged into `dev`.
