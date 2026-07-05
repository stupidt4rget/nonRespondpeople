# Devlog

## 2026-07-04
- Initialized pnpm workspace monorepo skeleton.
- Added apps/web (Vite + React + TypeScript), apps/server (Fastify + TypeScript), packages/shared (shared types, buildable).
- Wired workspace dependencies: both apps depend on @roleagent/shared via workspace:*.
- packages/shared builds to dist; exports point to dist/index.js + dist/index.d.ts.
- Root scripts (dev/build/typecheck) build shared first, then run apps.
- Added .env.example (no API keys), tsconfig.base.json, .gitignore supplements.
- No business logic implemented; Prisma + SQLite deferred to a later phase.

## 2026-07-04 - README docs
- Supplemented README.md: project intro, tech stack, directory structure, prerequisites, install/dev/typecheck/build, health endpoint, Git branch rules, security notes.
- Env var copy steps given for both PowerShell and bash.
- No code/package.json/AGENTS.md changes; no deps; no Git commit.

## 2026-07-04 - AGENTS.md update
- Updated AGENTS.md to match current state: pnpm workspace skeleton ready, dev/typecheck/build scripts work, three-package structure, shared must build first.
- Kept rules: small steps, no secrets, no unrelated changes, no deps without approval, feature branch + PR, confirm branch before work, run typecheck/build after changes.
- No code/package.json changes; no deps; no Git commit.

## 2026-07-04 - frontend health status
- apps/web/src/App.tsx: on mount fetch('/api/health'), show project name, connection state (checking/connected/error), backend name, error.
- Reused shared HealthResponse type; no packages/shared change.
- Relies on Vite proxy (/api -> :3000); no backend/package.json change; no deps.
- Verified: pnpm typecheck and pnpm build both pass.

## 2026-07-04 - Prisma + SQLite base setup
- Installed prisma (devDep, ^6) and @prisma/client (dep, ^6) in apps/server; no other deps.
- Chose Prisma 6 over 7: Prisma 7 removes datasource.url from schema and needs driver adapters (extra deps for SQLite), conflicting with constraints (only prisma + @prisma/client, schema uses env("DATABASE_URL")). Prisma 6 keeps classic url = env("DATABASE_URL") + prisma-client-js generator.
- Added apps/server/prisma/schema.prisma: generator client + datasource db (sqlite, env("DATABASE_URL")), no business model.
- Added apps/server/src/db/prisma.ts: PrismaClient singleton; runtime DATABASE_URL falls back to file:./dev.db via datasources.db.url, so pnpm dev works without .env.
- Modified apps/server/src/index.ts: added GET /api/db-health running prisma.$queryRaw`SELECT 1`, returns DbHealthResponse; on failure logs and returns {status:'error',database:'sqlite'}. Kept /api/health.
- Modified packages/shared/src/index.ts: added DbHealthResponse type only.
- Modified apps/server/package.json: added "db:generate": "prisma generate"; no postinstall.
- Modified .env.example: enabled DATABASE_URL="file:./dev.db".
- Install note: Prisma 6 pulls effect@3.21.0 via @prisma/config; @prisma/engines postinstall is slow; used pnpm install --ignore-scripts then prisma generate.
- Fresh clone: pnpm install (can add --ignore-scripts), then db:generate, then typecheck/build.
- Verified: pnpm typecheck pass; pnpm build pass; pnpm dev -> GET /api/health and /api/db-health both 200. dev.db at apps/server/prisma/dev.db (gitignored).

## 2026-07-05 - Character model + minimal API
- Added Character model to apps/server/prisma/schema.prisma: id (cuid), name, description?, createdAt (default now), updatedAt (@updatedAt). No avatar/tags/prompt/worldbook.
- Migration 20260705061441_add_character_model/migration.sql: CREATE TABLE "Character". Command: prisma migrate dev --name add_character_model, then db:generate.
- packages/shared/src/index.ts: added CharacterDto, CreateCharacterRequest, CharactersResponse. Kept existing exports.
- Added apps/server/src/routes/characters.ts: Fastify plugin characterRoutes(app).
  - toCharacterDto mapper: Prisma returns Date, DTO uses string; import type { Character } from '@prisma/client'; .toISOString() conversion.
  - GET /api/characters: findMany orderBy createdAt desc, returns { characters: map(toCharacterDto) }.
  - POST /api/characters: validate name non-empty string, else 400; description non-string -> null; create then 201 with toCharacterDto. No zod.
- Modified apps/server/src/index.ts: import characterRoutes; await app.register(characterRoutes) before listen. Kept /api/health, /api/db-health.
- Verified: pnpm typecheck pass; pnpm build pass; pnpm dev -> endpoints tested, POST empty name -> 400.

## 2026-07-05 - Character web minimal page
- Added apps/web/src/api.ts: fetchCharacters() and createCharacter(body), reusing @roleagent/shared types (import type).
  - createCharacter error parsing: default message HTTP {status}; try parse JSON {error?}, if string use it; catch ignores parse failure. No any, uses unknown + typeof.
- Modified apps/web/src/App.tsx: kept health useEffect; added second useEffect for fetchCharacters with cancelled guard; create form (name required, description optional); handleCreate validates name.trim(), calls createCharacter, prepends result, clears form.
- List: loading/empty/error states; shows name / description ?? 'no description' / createdAt (raw ISO string).
- import { useEffect, useState, type FormEvent } from 'react'.
- Verified: pnpm typecheck pass; pnpm build pass (32 modules); pnpm dev via Vite proxy 5173 -> page HTML 200, endpoints work, POST empty name -> 400.

## 2026-07-05 - V0.1 run and validation docs
- Updated `README.md` to reflect V0.1 status (previous description was outdated, still saying "skeleton stage, roles not implemented"):
  - Top intro changed to: V0.1 stage, Prisma + SQLite wired up, Character model + minimal backend API + minimal frontend page implemented; chat/worldbook/model config are later phases.
  - Added "Current Features (V0.1)" section: health, Character list, Character create form, Prisma + SQLite.
  - Tech stack added "Database: Prisma 6 + SQLite".
  - Directory structure updated with `apps/server/prisma/` (schema.prisma, migrations/) and `apps/web/src/api.ts`.
  - Added "Fresh Clone Setup (Windows PowerShell)" section with command sequence: `pnpm install` -> `db:generate` -> `prisma migrate dev` -> `pnpm dev`, explaining that `db:generate` produces the Prisma Client, `migrate dev` applies `add_character_model` to create tables, both need `DATABASE_URL` (injected via PowerShell temp env var, no `.env` written). Added one-line bash equivalent note.
  - Prerequisites added `DATABASE_URL` fallback note: runtime works without `.env`, but generate/migrate need it injected.
  - "Health check endpoint" expanded to "API Endpoints" table: 4 endpoints (health / db-health / characters GET / characters POST) + examples.
  - Added "Notes" section: do not commit dev.db/.env/dist, dev.db location `apps/server/prisma/dev.db`, branch note (`main` is not latest, `dev` is current dev branch, features on `feature/*` merged into `dev`).
- Updated `docs/todo.md`: checked off `Prisma: document pnpm install + db:generate fresh-clone step in README / CI.` Other routing/app shell/API client todos remain unchecked.
- Untouched: apps/, packages/, package.json, pnpm-lock.yaml, AGENTS.md, tsconfig.base.json, pnpm-workspace.yaml; no new files; no deps installed; no commands run; no Git commit. Doc-only changes, no typecheck/build needed.
- Encoding fix: rewrote README.md and this devlog entry in ASCII English to avoid mojibake under GBK viewers. Replaced non-ASCII punctuation in docs/todo.md with plain ASCII characters.

## 2026-07-05 - Character management V0.2
- Added 3 backend routes in apps/server/src/routes/characters.ts: GET /api/characters/:id (404 if not found), PATCH /api/characters/:id (update name/description; 400 on empty name / no fields / bad types; 404 if not found), DELETE /api/characters/:id (returns {ok:true,id}; 404 if not found). Kept existing GET list and POST.
- Body validation: added isPlainObject guard (rejects null/array/non-object) for both POST and PATCH before destructuring fields. No zod, no any; uses type narrowing on each field. PATCH description semantics: undefined = leave unchanged, null = clear, string = set.
- 404 handling: findUnique before update/delete; null result returns 404 {error} so Prisma NotFound exceptions never reach the client. PATCH validates body (400) before checking existence (404).
- packages/shared/src/index.ts: added UpdateCharacterRequest {name?; description?: string | null} and DeleteCharacterResponse {ok: true; id: string}. GET /:id and PATCH responses reuse CharacterDto directly.
- apps/web/src/api.ts: extracted throwApiError(res) helper (default HTTP {status}; try parse JSON {error?}; catch falls back to HTTP status). Refactored existing fetchCharacters/createCharacter to use it. Added fetchCharacter(id), updateCharacter(id, body), deleteCharacter(id).
- New apps/web/src/components/CharacterDetail.tsx: shows id/name/description/createdAt/updatedAt; edit form (name required, description optional); Save calls PATCH; Delete calls DELETE with window.confirm. Internal state resets via key={character.id} from parent.
- apps/web/src/App.tsx: added selectedId state; list items are clickable buttons (selected one bold); renders CharacterDetail when selected, else a placeholder. onUpdated replaces the list item; onDeleted removes it and clears selection. Converted all user-visible UI text from Chinese to English (Loading..., No characters yet, no description, name must not be empty, etc.).
- No schema change, no migration, no new deps.
- Verified: pnpm typecheck pass; pnpm build pass (33 modules). pnpm dev API tests: GET /:id 200/404, PATCH name/description/null 200, PATCH empty name/no fields/nonexistent 400/400/404, DELETE 200/404, POST non-object body 400. All passed.
- Untouched: apps/server/prisma, apps/server/src/index.ts, package.json, pnpm-lock.yaml, AGENTS.md, tsconfig.base.json, pnpm-workspace.yaml; no Git commit.

## 2026-07-05 - Minimal chat V0.3
- New apps/server/src/routes/chat.ts: POST /api/chat. Validates body is object, characterId + message non-empty strings, looks up character (404 if not found), returns ChatResponse { reply: "Mock reply from {name}: I received your message." }. No real LLM. Reuses prisma singleton; isPlainObject guard duplicated locally (same pattern as characters.ts).
- Modified apps/server/src/index.ts: import + register chatRoutes alongside characterRoutes.
- packages/shared/src/index.ts: added ChatRequest { characterId; message } and ChatResponse { reply }.
- apps/web/src/api.ts: added sendChat(body) using existing throwApiError helper.
- New apps/web/src/components/ChatPanel.tsx: local ChatMessage type (role/content/createdAt); messages state (not persisted); input + Send button; on send appends user msg, calls sendChat, appends assistant reply; empty input blocked; error display. key reset via parent.
- apps/web/src/App.tsx: when a character is selected, renders ChatPanel below CharacterDetail (with key=`chat-{id}` to reset on switch). No layout refactor.
- No schema change, no migration, no new deps, no real LLM.
- Verified: pnpm typecheck pass; pnpm build pass (34 modules). pnpm dev API tests: POST /chat valid 200 with mock reply; empty message 400; nonexistent characterId 404; non-object body 400; missing characterId 400.
- Untouched: apps/server/prisma, package.json, pnpm-lock.yaml, AGENTS.md, tsconfig.base.json, pnpm-workspace.yaml; no Git commit.

## 2026-07-05 - API chat + character card import V0.4
- Prisma: added 6 optional fields to Character model (persona, scenario, firstMessage, messageExample, systemPrompt, rawCardJson). Migration `20260705091654_add_character_card_fields`.
- shared: CharacterDto extended with 6 new fields (all string|null). CreateCharacterRequest/UpdateCharacterRequest extended. ChatRequest added optional history (ChatHistoryMessage[]). New types: ChatHistoryMessage, ImportCharacterCardRequest, ImportCharacterCardResponse (= CharacterDto).
- server/routes/characters.ts: toCharacterDto includes new fields. POST and PATCH accept new fields. New POST /api/characters/import (placed before /:id) creates Character from imported card data including rawCardJson. strOrNull helper for create; OPTIONAL_CARD_FIELDS loop for PATCH validation.
- server/routes/chat.ts: replaced mock with real OpenAI-compatible call. Reads LLM_API_BASE_URL/LLM_API_KEY/LLM_MODEL from env; 500 if any missing (key not leaked). Builds system message from character persona/description/scenario/systemPrompt. Includes history from request (validated). Calls {baseUrl}/chat/completions with Bearer auth, stream:false. Parses choices[0].message.content with unknown narrowing. Network error -> 502, non-2xx -> 502. Trailing slash on baseUrl stripped.
- web/api.ts: sendChat accepts ChatRequest (with history). New importCharacterCard function.
- web/components/ChatPanel.tsx: initializes messages with character.firstMessage as first assistant message if present. Sends history (all prior messages) with each chat request.
- web/components/CharacterImport.tsx (new): file input accepting .json and .png. JSON: parse text. PNG: manual chunk parsing with DataView/Uint8Array/TextDecoder, finds tEXt chunk keyword "chara", atob base64 decode, JSON.parse. mapCardToImport supports v1 (flat) and v2 (data nested), snake_case and camelCase field names. No new deps. Calls importCharacterCard, onImported callback.
- web/App.tsx: added CharacterImport section + handleImported (prepend to list + select new character).
- README: added LLM Configuration section + import/chat endpoints in API table.
- Verified: pnpm typecheck pass; pnpm build pass (35 modules). API tests: POST /import 201 with new fields; GET /:id returns new fields; PATCH persona 200; POST /chat no config 500; POST /chat nonexistent 404.
- Untouched: apps/server/src/index.ts, apps/server/src/db/prisma.ts, package.json, pnpm-lock.yaml, AGENTS.md, tsconfig.base.json, pnpm-workspace.yaml; no Git commit.

## 2026-07-05 - Worldbook + chat persistence + CN UI V0.8
- Prisma: added WorldBook, CharacterWorldBook, Conversation, and ChatMessage models. Migration `20260705093000_add_worldbooks_chat_persistence` creates tables, indexes, cascade cleanup for character-bound conversation/message/binding data, and a ChatMessage role check limited to user/assistant.
- Shared: added worldbook, conversation, chat message, character export, and worldbook binding DTO/request/response types. ChatResponse still keeps `reply` while adding saved message/conversation metadata.
- Server: added `routes/worldbooks.ts` for list/import/export/delete worldbooks and character-worldbook bindings; added `routes/conversations.ts` for default per-character conversation loading and active worldbook multi-select updates.
- Server chat: POST /api/chat now reads saved conversation history, injects all currently enabled worldbooks into the system prompt with length limits, calls the configured LLM, and only then saves user + assistant messages. Failed LLM calls do not save partial chat rows.
- Character import/export: import now supports character_book from request or rawCardJson fallback and binds generated worldbooks to the imported character. Export returns JSON role card fields plus character_book when available; PNG re-encoding was intentionally deferred.
- Web: main UI text is localized to Chinese. ChatPanel loads persisted conversation messages on character switch, updates from saved server messages after send, and keeps the composer fixed at the bottom.
- Web: added WorldBookPanel for worldbook JSON import/export/delete and per-conversation enabled worldbook multi-select. Character detail includes JSON export.
- Verified: Prisma migrate dev applied `add_worldbooks_chat_persistence`; Prisma Client generated; shared/server/web typecheck passed; server build passed; web Vite build passed. No new dependencies; no package/config changes; no Git commit.
