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
