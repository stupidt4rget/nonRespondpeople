# Devlog

## 2026-07-04
- Initialized pnpm workspace monorepo skeleton.
- Added apps/web (Vite + React + TypeScript), apps/server (Fastify + TypeScript), packages/shared (shared types, buildable).
- Wired workspace dependencies: both apps depend on @roleagent/shared via workspace:*.
- packages/shared builds to dist; exports point to dist/index.js + dist/index.d.ts.
- Root scripts (dev/build/typecheck) build shared first, then run apps.
- Added .env.example (no API keys), tsconfig.base.json, .gitignore supplements.
- No business logic implemented; Prisma + SQLite deferred to a later phase.

## 2026-07-04 · 文档补充
- 补充 README.md：项目介绍、技术栈、目录结构、开发前准备、安装/启动/类型检查/构建、健康检查接口、Git 分支规则、安全提醒。
- 环境变量复制步骤同时给出 Windows PowerShell 与 bash 两种命令。
- 未改动代码、package.json、AGENTS.md；未安装依赖；未提交 Git。

## 2026-07-04 · AGENTS.md 更新
- 更新 AGENTS.md 以符合现状：pnpm workspace 骨架已就绪、dev/typecheck/build 脚本可用、三包结构、shared 须先构建的依赖顺序说明。
- 保留规则：小步开发、不提交密钥、不修改无关文件、不安装依赖除非批准、feature branch + PR、开发前确认当前分支、修改后运行 pnpm typecheck/build。
- 未改动代码、package.json；未安装依赖；未提交 Git。

## 2026-07-04 · 前端健康状态显示
- apps/web/src/App.tsx：挂载时 fetch('/api/health')，显示项目名、连接状态(checking/connected/error)、后端 name、错误信息。
- 复用 shared 现有 HealthResponse 类型，未改动 packages/shared。
- 依赖 Vite proxy (/api → :3000)；未改后端、package.json；未装依赖。
- 验证项：pnpm typecheck、pnpm build；实际执行后均通过，已通过 pnpm typecheck 与 pnpm build。

## 2026-07-04 · Prisma + SQLite 基础接入
- 在 apps/server 安装 `prisma`（devDependency，^6）与 `@prisma/client`（dependency，^6），未安装其它依赖。
- 版本选择说明：Prisma 7 已移除 schema 中的 `datasource.url`，运行时需通过 driver adapter 连库（SQLite 需 `@prisma/adapter-better-sqlite3` 等额外依赖），与「仅 prisma + @prisma/client」「schema 用 env("DATABASE_URL")」两项约束冲突，故降级采用 Prisma 6（仍支持经典 `url = env("DATABASE_URL")` + `prisma-client-js` 生成器 + `import { PrismaClient } from '@prisma/client'`）。
- 新增 `apps/server/prisma/schema.prisma`：`generator client { provider = "prisma-client-js" }` + `datasource db { provider = "sqlite"; url = env("DATABASE_URL") }`，未添加任何业务 model。
- 新增 `apps/server/src/db/prisma.ts`：导出 `PrismaClient` 单例；运行时 `process.env.DATABASE_URL ?? 'file:./dev.db'`，经 `datasources.db.url` 注入 PrismaClient，使 `pnpm dev` 在无 `.env` 时也能开箱跑通 `/api/db-health`。
- 修改 `apps/server/src/index.ts`：新增 `GET /api/db-health`，执行 `prisma.$queryRaw\`SELECT 1\`` 做连通性检查，返回 `DbHealthResponse`；失败时记日志并返回 `{ status: 'error', database: 'sqlite' }`。保留原 `/api/health`。
- 修改 `packages/shared/src/index.ts`：仅新增 `DbHealthResponse { status: 'ok'|'error'; database: string }` 类型，未动现有导出。
- 修改 `apps/server/package.json`：新增 `"db:generate": "prisma generate"` 脚本；不加 postinstall。
- 修改 `.env.example`：启用 `DATABASE_URL="file:./dev.db"`，注明运行时默认回退、可复制为 `.env` 覆盖；不创建真实 `.env`。
- 安装工作流注意：Prisma 6 经 `@prisma/config` 引入传递依赖 `effect@3.21.0`，首装下载较慢且 `@prisma/engines` postinstall 下载引擎较慢，曾触发超时；最终用 `pnpm install --ignore-scripts` 完成 linking，再 `prisma generate` 按需下载 query engine（`query_engine-windows.dll.node` + `query_engine_bg.wasm`）。
- fresh clone 注意（已记入 todo）：先 `pnpm install`（可加 `--ignore-scripts` 避开慢 postinstall），再 `$env:DATABASE_URL="file:./dev.db"; pnpm --filter @roleagent/server db:generate` 生成客户端，之后方可 typecheck/build。
- `prisma generate` 验证：因 schema 用 `env("DATABASE_URL")`，generate 时用 PowerShell 临时环境变量注入，不落盘 `.env`。
- 验证结果：`pnpm typecheck` 通过；`pnpm build` 通过；`pnpm dev` 后 `GET /api/health` → `{"status":"ok","name":"RoleAgent Tavern"}`、`GET /api/db-health` → `{"status":"ok","database":"sqlite"}`，均 200。运行时 `file:./dev.db` 相对 schema 目录解析，db 落点 `apps/server/prisma/dev.db`（`*.db` 已 gitignore）。
- 未改动：apps/web、AGENTS.md、根 package.json、tsconfig.base.json、pnpm-workspace.yaml；未实现业务 model；未提交 Git。

## 2026-07-05 · Character 模型 + 最小 API
- 在 `apps/server/prisma/schema.prisma` 新增首个业务 model `Character`：`id String @id @default(cuid())`、`name String`、`description String?`、`createdAt DateTime @default(now())`、`updatedAt DateTime @updatedAt`。未加 avatar/tags/prompt/worldbook 等字段。
- 新增 migration `20260705061441_add_character_model/migration.sql`：`CREATE TABLE "Character"`（id TEXT PK、name TEXT NOT NULL、description TEXT、createdAt DATETIME DEFAULT CURRENT_TIMESTAMP、updatedAt DATETIME NOT NULL）。执行命令：`$env:DATABASE_URL="file:./dev.db"; pnpm --filter @roleagent/server exec prisma migrate dev --name add_character_model`，再 `db:generate` 刷新 `@prisma/client`。
- `packages/shared/src/index.ts` 新增 3 个类型：`CharacterDto`（id/name/description:string|null/createdAt:string/updatedAt:string，时间用 ISO 字符串以匹配 JSON 序列化后客户端实际收到的形状）、`CreateCharacterRequest`（name 必填、description 可选）、`CharactersResponse`（`{ characters: CharacterDto[] }`）。保留原有 `appName`/`HealthResponse`/`DbHealthResponse` 不动。
- 新增 `apps/server/src/routes/characters.ts`：导出 Fastify 插件 `characterRoutes(app)`。
  - 关键点：Prisma 查询返回的 `createdAt`/`updatedAt` 是 `Date`，不能直接当作 `CharacterDto`（DTO 里是 string）。新增显式 mapper `toCharacterDto(character: Character)`，用 `import type { Character } from '@prisma/client'`（type-only import），将 `Date` 经 `.toISOString()` 转成 ISO 字符串。
  - `GET /api/characters`：`prisma.character.findMany({ orderBy: { createdAt: 'desc' } })`，返回 `{ characters: characters.map(toCharacterDto) }`。
  - `POST /api/characters`：取 `req.body`（防御 null/undefined），手写校验 `typeof name === 'string' && name.trim() !== ''`，否则 `reply.code(400).send({ error: 'name is required and must be a non-empty string' })`；`description` 非字符串时存 null；`prisma.character.create` 后 `reply.code(201).send(toCharacterDto(created))`。未引入 zod。
- 修改 `apps/server/src/index.ts`：新增 `import { characterRoutes } from './routes/characters.js'`；在 `start()` 内 `await app.register(characterRoutes)` 后再 `app.listen`。原有 `/api/health`、`/api/db-health` 不动。
- 验证：`pnpm typecheck` 通过；`pnpm build` 通过（server tsc + web vite build 均 Done）。
- `pnpm dev` 后实测：`GET /api/health` → `{"status":"ok","name":"RoleAgent Tavern"}`；`GET /api/db-health` → `{"status":"ok","database":"sqlite"}`；`GET /api/characters` 空列表 → `{"characters":[]}`；`POST /api/characters`（`{"name":"Aria","description":"Test role"}`）→ 201，返回 `{id,name,description,createdAt:"2026-07-05T06:16:33.007Z",updatedAt:"..."}`（ISO 字符串，mapper 生效）；再次 GET 列表含该条；`POST` 传 `{"name":"   "}` → 400 `{"error":"name is required and must be a non-empty string"}`。
- 未改动：apps/web、AGENTS.md、根 package.json、tsconfig.base.json、pnpm-workspace.yaml、pnpm-lock.yaml；未安装新依赖；未创建真实 .env；未提交 Git；未实现聊天/世界书/模型调用/鉴权。`dev.db` 落点 `apps/server/prisma/dev.db`（`*.db` 已 gitignore）。

## 2026-07-05 · Character Web 最小页面
- 新增 `apps/web/src/api.ts`：封装两个 fetch 调用，复用 `@roleagent/shared` 的 `CharacterDto` / `CharactersResponse` / `CreateCharacterRequest`（全部 `import type`）。
  - `fetchCharacters()`：`GET /api/characters`，`res.ok` 否则抛 `HTTP {status}`，返回 `data.characters`。
  - `createCharacter(body)`：`POST /api/characters`，`Content-Type: application/json`。失败时错误解析容错——先设默认 message `HTTP {status}`，`try` 里 `await res.json() as { error?: unknown }`，若 `err.error` 是 string 则覆盖 message；`catch` 忽略解析失败（响应体非 JSON 时回退到 HTTP 状态码）；最后统一 `throw new Error(message)`。不引入 `any`，用 `unknown` + `typeof` 收窄。
- 修改 `apps/web/src/App.tsx`：保留原有 health 检测 `useEffect` 与显示（`state`/`backendName`/`error` 完全不动）。
  - 新增第二个 `useEffect` 挂载时调 `fetchCharacters()`，带 `cancelled` 防泄漏，`loading`/`listError`/`characters` 三个 state。
  - 新增创建表单：`name`（text input，必填）、`description`（textarea，可选）、提交按钮。`handleCreate` 用 `FormEvent` 阻止默认提交，`name.trim()` 为空时前端阻止并显示「name 不能为空」；调 `createCharacter({ name: name.trim(), description: description.trim() || undefined })`，成功后 `setCharacters((prev) => [created, ...prev])`（prepend，匹配后端 createdAt desc 顺序）、清空表单；失败显示错误信息。
  - 列表区：loading 显示「加载中…」、空数组显示「暂无角色」、有数据用 `<ul>` 渲染 `name` / `description ?? '无描述'` / `createdAt`（原始 ISO 字符串直接显示，不做格式化）。
  - 类型 import：`import { useEffect, useState, type FormEvent } from 'react'`（inline type import，匹配 `jsx: react-jsx` 下不默认导入 React 的配置）。
- 验证：`pnpm typecheck` 通过；`pnpm build` 通过（web 32 modules transformed，含新增 api.ts）。
- `pnpm dev` 后通过 Vite proxy（5173）实测：页面 HTML 200 且含 `<div id="root">`；`GET /api/health` → `{"status":"ok",...}`（health 显示 connected）；`GET /api/characters` 返回已有角色；`POST /api/characters`（Luna）→ 201 创建成功；再次 GET 列表含新角色且位于顶部；`POST` 空 name → 400。
- 未改动：apps/server、apps/server/prisma、packages/shared、AGENTS.md、根 package.json、tsconfig.base.json、pnpm-workspace.yaml、pnpm-lock.yaml；未安装新依赖；未提交 Git；未做路由/编辑器/聊天/世界书/模型配置。

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
- Encoding fix: rewrote README.md entirely in ASCII English and this devlog entry in English to avoid mojibake (the previous Chinese text plus the middle-dot "·" and em-dash "—" caused "鈥?" garbling under GBK viewers). Replaced the non-ASCII em dash in todo.md with a plain ASCII "-".
