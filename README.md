# RoleAgent Tavern

A tavern-style roleplay agent tool. This repo is currently at stage V0.4: Prisma + SQLite persistence, Character CRUD, character card import (JSON/PNG), and real LLM chat via OpenAI-compatible API are implemented. Worldbook, model config UI, and character card editor are not implemented yet.

## Current Features (V0.4)

- Health status: `GET /api/health`, `GET /api/db-health`
- Prisma 6 + SQLite persistence (local `dev.db` file)
- Character model with card fields (persona, scenario, firstMessage, messageExample, systemPrompt, rawCardJson)
- Character CRUD: list, create, get by id, update, delete
- Character card import (JSON and SillyTavern PNG)
- Real LLM chat via OpenAI-compatible API (server-side config)
- Minimal web UI: character list, create form, detail/edit, chat panel, import

## Not Implemented Yet

- Worldbook
- Model config UI
- Character card editor
- Chat history persistence
- Streaming output

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
|   |   |   |-- api.ts      # API call wrappers
|   |   |   |-- main.tsx
|   |   |   |-- vite-env.d.ts
|   |   |   `-- components/
|   |   |       |-- CharacterDetail.tsx
|   |   |       |-- CharacterImport.tsx
|   |   |       `-- ChatPanel.tsx
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
|       |   `-- routes/
|       |       |-- characters.ts
|       |       `-- chat.ts
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
- `migrate dev`: applies existing migrations and creates tables in `apps/server/prisma/dev.db`.
- Both commands need `DATABASE_URL`; here it is injected via a PowerShell temporary env var, without writing `.env`.

> Bash users: replace `$env:DATABASE_URL="file:./dev.db"; pnpm ...` with `DATABASE_URL="file:./dev.db" pnpm ...`.

## Start Dev Environment

```bash
pnpm dev
```

This first builds `packages/shared`, then starts in parallel:
- Frontend page: http://localhost:5173 (Vite, proxies `/api` to the backend)
- Backend API: http://localhost:3000

Open http://localhost:5173 to see: backend connection status, character list, create form, import, detail/edit, and chat.

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
| POST | `/api/characters` | Create a character, body `{name, description?, persona?, ...}`, returns 201; empty name returns 400 |
| POST | `/api/characters/import` | Import a character card, body `{name, description?, persona?, scenario?, firstMessage?, ...}`, returns 201 |
| GET | `/api/characters/:id` | Return a single character; 404 if not found |
| PATCH | `/api/characters/:id` | Update a character (`null` clears a field); 400 on empty name / no fields; 404 if not found |
| DELETE | `/api/characters/:id` | Delete a character, returns `{ok, id}`; 404 if not found |
| POST | `/api/chat` | Send a chat message, body `{characterId, message, history?}`; returns `{reply}`; 500 if LLM not configured; 404 if character not found |

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

## LLM Configuration

The chat feature calls an OpenAI-compatible API. Configure these server-side environment variables (never commit real keys):

```
LLM_API_BASE_URL=https://ark.cn-beijing.volces.com/api/coding/v3
LLM_API_KEY=your-api-key
LLM_MODEL=GLM5.2
```

- These are read only on the server (`apps/server/src/routes/chat.ts`); they never reach the frontend or database.
- The final request URL is `{LLM_API_BASE_URL}/chat/completions` (trailing slashes on the base URL are stripped automatically).
- If any variable is missing, `POST /api/chat` returns 500 with `"LLM is not configured on the server"`.

Local PowerShell startup (use your own key):

```powershell
$env:DATABASE_URL="file:./dev.db"
$env:LLM_API_BASE_URL="https://ark.cn-beijing.volces.com/api/coding/v3"
$env:LLM_API_KEY="your-api-key"
$env:LLM_MODEL="GLM5.2"
pnpm dev
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
