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
