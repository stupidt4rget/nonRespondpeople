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

## 2026-07-06 - SillyTavern architecture research doc
- Added docs/sillytavern-research.md: read-only research of the SillyTavern codebase (architecture, module inventory, feature matrix vs RoleAgent dev HEAD 746ed9f, gap analysis, roadmap proposal, license notes).
- Research method: behavior/spec observation only; no SillyTavern code copied (AGPL-3.0 clean-room constraint documented in section 6 of the report).
- Roadmap outcome adopted for next phase (V0.10.1 quality fixes): SSE streaming + abort, message edit/delete, regenerate, prompt debug API + panel, LLM settings persistence, squash consecutive system messages. Items registered in docs/todo.md.
- Decision recorded: continue in-house development (RoleAgent Tavern); SillyTavern fork / repackaging route evaluated and rejected (AGPL lock-in, no iOS path, upstream merge burden, UI rewrite equals rewriting most of ST).
- Doc-only change: no code, no schema, no deps.
- Prisma: added WorldBook, CharacterWorldBook, Conversation, and ChatMessage models. Migration `20260705093000_add_worldbooks_chat_persistence` creates tables, indexes, cascade cleanup for character-bound conversation/message/binding data, and a ChatMessage role check limited to user/assistant.
- Shared: added worldbook, conversation, chat message, character export, and worldbook binding DTO/request/response types. ChatResponse still keeps `reply` while adding saved message/conversation metadata.
- Server: added `routes/worldbooks.ts` for list/import/export/delete worldbooks and character-worldbook bindings; added `routes/conversations.ts` for default per-character conversation loading and active worldbook multi-select updates.
- Server chat: POST /api/chat now reads saved conversation history, injects all currently enabled worldbooks into the system prompt with length limits, calls the configured LLM, and only then saves user + assistant messages. Failed LLM calls do not save partial chat rows.
- Character import/export: import now supports character_book from request or rawCardJson fallback and binds generated worldbooks to the imported character. Export returns JSON role card fields plus character_book when available; PNG re-encoding was intentionally deferred.
- Web: main UI text is localized to Chinese. ChatPanel loads persisted conversation messages on character switch, updates from saved server messages after send, and keeps the composer fixed at the bottom.
- Web: added WorldBookPanel for worldbook JSON import/export/delete and per-conversation enabled worldbook multi-select. Character detail includes JSON export.
- Verified: Prisma migrate dev applied `add_worldbooks_chat_persistence`; Prisma Client generated; shared/server/web typecheck passed; server build passed; web Vite build passed. No new dependencies; no package/config changes; no Git commit.

## 2026-07-09 - V0.12 prompt transparency, timing, API key persistence, variants
- Prisma: added `LlmSettings`, `AssistantMessageVariant`, generation `visibleThinkingEnabled`, and ChatMessage metadata columns for raw/thinking content, timing JSON, prompt debug JSON, and selected variant id. Migration `20260709120000_add_visible_thinking_prompt_debug_variants`.
- Settings: LLM settings now persist in SQLite. GET /api/settings/llm never returns the real key, only `hasApiKey`; PUT/POST preserve an existing key when `apiKey` is omitted or blank; only `clearApiKey: true` clears it. Database settings take priority when a saved key exists, env settings remain fallback.
- Generation controls: added `visibleThinkingEnabled`, default true. PromptBuilder injects a visible-thinking request using `<thinking>...</thinking>` wording and does not call it real CoT.
- PromptBuilder: prompt assembly debug now includes character/preset sections, conservative worldbook keyword matches, recent history, visible-thinking status, generation settings summary, final messages, estimated chars/tokens, and truncation notes.
- Chat/regenerate: stream and non-stream paths now record startedAt, firstTokenAt, completedAt, firstTokenMs, outputMs, totalMs, and stopped. Assistant replies are saved with variants; regenerate preserves previous replies and selects the new variant without duplicating old variants into model context.
- Web: ChatPanel renders `<thinking>`/`<think>` blocks in a collapsible thinking area, shows timing metadata, provides assistant variant previous/next controls, and adds a read-only Prompt Preview panel. LLM settings form keeps the API key field blank with saved/not-set placeholders and adds explicit clear-key action.
- Tooling: local pnpm v11 required a one-time `pnpm approve-builds --all` during verification for locked Prisma/esbuild/electron build scripts; no dependency versions were changed.
- Verified: `pnpm typecheck`, `pnpm build`, and `pnpm build:desktop` passed after regenerating Prisma Client. Security scans passed: provider key-prefix scan no output; `LLM_API_KEY` only in README/settings/devlog; `Authorization`/`Bearer` only in chat request headers and docs.

## 2026-07-10 - V0.14 character worldbook entry management
- Reused the existing `CharacterWorldBook` relation and V0.13 `entriesJson` normalization/serialization path; no schema change and no migration were needed.
- Added `POST /api/characters/:id/worldbook` to create and bind a character-owned worldbook. Existing conversations for that character receive the new default worldbook id so prompt generation can use it immediately.
- Added strict API input validation for managed entry fields (booleans, strings, string arrays, trigger/insertion enums, and finite numbers). Existing normalization continues to clamp order/depth/probability, including probability to 0-100.
- Added a collapsible Character WorldBook editor in CharacterDetail. It shows book/entry enabled counts and supports entry enable/disable, expand/edit, add, duplicate, delete, and persisted save for title, comment, content, keywords, trigger strategy, insertion position, order, depth, and probability.
- PromptBuilder was left structurally unchanged because it already receives active character-bound worldbooks through the conversation path and applies V0.13 constant/keyword/selective trigger logic while skipping disabled entries.
- Browser QA verified the collapsible section, existing-worldbook summary, entry rows, and expanded entry field set without mutating user data. A pre-existing Prompt Preview duplicate-key warning remains outside this change.
- Verified: `git diff --check`, `pnpm typecheck`, `pnpm build`, and `pnpm build:desktop` passed. On this Windows sandbox, the two build commands required an unrestricted retry to recreate gitignored server `dist` files.

## 2026-07-10 - V0.15 extension manager + ZIP bomb hardening
- Added `InstalledExtension` Prisma model and migration `20260710110000_add_extensions_v015` for extension metadata (id, displayName, version, sourceType, enabled, installedPath, manifestJson).
- Server: new `extensionManager` service and `/api/extensions` routes for list, ZIP install, public HTTPS Git install, enable/disable toggle, and delete. ZIP path uses a custom `zipArchive` extractor; Git path uses shallow clone + `ls-tree`/`cat-file` materialization without `npm install` or manifest entry execution.
- Web: new `ExtensionManagerPanel` workspace view with ZIP upload, Git URL install, installed list, enable toggle, and delete. Shared DTOs and API client helpers added in `@roleagent/shared` and `apps/web/src/api.ts`.
- Security (ZIP bomb patch): `zipArchive.ts` now enforces limits on **actual decompressed output bytes** during Deflate inflation and stored entries, not only ZIP header `uncompressedSize`. Limits: 20 MB archive upload, 100 MB total unpacked, 25 MB per file, 2000 files. Exceeding limits throws frontend-visible errors, aborts extraction, and removes the partial temp directory before any DB write or final install path copy. Zip-slip, manifest validation, and Git manifest/path checks are unchanged.
- Cleaned local V0.15 test artifacts under `data/v015-fixtures/`, `data/v015-manual/`, and `data/v015-no-git/` only; preserved `apps/server/prisma/dev.db` and other real user data.

## 2026-07-10 - V0.15 manifest compatibility (RoleAgent + external/SillyTavern)
- Added `normalizeExtensionManifest()` in `extensionManager.ts` so Git/ZIP installs can register extensions without a strict `manifest.id` or `type === "roleagent-extension"`.
- ID derivation order: `id` → `packageName` → `name` → `display_name` / `displayName` → Git repo slug → package directory name; candidates are lowercased, sanitized to `[a-z0-9_-]`, and validated. Missing version defaults to `0.0.0` for management-only registration.
- Compatibility: `type === "roleagent-extension"` → `roleagent`; otherwise `external`. Original `type` and `compatibility` are stored in `manifestJson`; list DTO exposes `compatibility` for UI badges. V0.15 still does not execute `entry` / `js` / `css` / `loading_order` paths—only validates they are safe relative paths.
- User-facing errors updated for missing manifest, invalid JSON, underivable id, and duplicate install (409). No schema migration.

## 2026-07-10 - V0.16 Extension Runtime & Feature Toggles
- Built on V0.15 Extension Manager: extensions now expose per-feature items with individual enablement and a controlled iframe runtime path.
- Manifest: added optional `features[]` (`id`, `name`, `description`, `category`, `entry`, `runtime`, `enabledByDefault`). When `features` is missing but a safe iframe `entry` exists, a `main` feature is synthesized automatically.
- Persistence: `InstalledExtension.featureSettingsJson` stores per-feature `{ enabled }` toggles. Migration `20260710140000_add_extension_feature_settings_v016` adds the column with default `{}`.
- API: `GET /api/extensions` now returns `features` with `enabled`, `runnable`, `runtimeUrl`, and `compatibilityNote`. Added `PATCH /api/extensions/:id/features/:featureId` for per-feature enable/disable without changing extension-level `enabled`.
- Runtime delivery: added controlled `GET /api/extensions/:id/assets/*` for extension sub-resources and `GET /api/extensions/:id/runtime/:featureId` for iframe HTML entry. Runtime supports `runtime === "iframe"` only; HTML responses inject a safe `<base href>` so relative assets resolve under `/api/extensions/:id/assets/`.
- Security: assets/runtime reject path traversal, remote schemes, symlinks, and disallowed extensions; enforce file size limits, `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`, and a restrictive CSP. Extension overall `enabled === false` blocks runtime; feature `enabled === false` blocks runtime entry.
- Web: `ExtensionManagerPanel` supports expandable extension cards, feature lists grouped by category (`render` / `script` / `tool` / `optimization` / `development` / `other`), per-feature toggles, run button, and `ExtensionRuntimePanel` iframe host. Iframe uses `sandbox="allow-scripts"` only (no `allow-same-origin`); `src` comes from `feature.runtimeUrl`.
- postMessage bridge (minimal whitelist): accepts only messages from the active iframe; `event.data` must be a plain object with JSON length ≤ 4096. Supported types: `roleagent:extension-ready` (marks runtime ready, no data echoed back) and `roleagent:show-toast` (`message` string ≤ 200, optional `info`/`success`/`error` level, rendered as plain text). No chat/character/worldbook/API-key data is sent to extensions.
- External / SillyTavern manifests remain partially compatible only: when no RoleAgent `features` and no safe iframe entry exist, `js`/`css` paths are surfaced as display-only candidates (`runnable=false`, compatibility notes, toggles persist but nothing executes). External JS/CSS is not injected into the main page and SillyTavern Extension API is not implemented. Planned follow-up: V0.17 SillyTavern Extension Compatibility Bridge.
- Verified on branch `feature/extension-runtime-v0.16`: `git diff --check`, `pnpm typecheck`, and `pnpm build` passed.
- Still before merge to `dev`: browser manual test with a RoleAgent runtime ZIP, external display-only regression (e.g. JS-Slash-Runner), `pnpm build:desktop`, and post-merge smoke test on `dev`.
