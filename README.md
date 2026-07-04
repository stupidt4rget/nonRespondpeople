# RoleAgent Tavern

类酒馆（Tavern-style）的角色扮演 Agent 工具。本仓库当前为 monorepo 骨架，仅含项目结构与基础脚手架，尚未实现角色、聊天、世界书、模型配置等业务功能。

## 技术栈

- 包管理：pnpm workspace（`packageManager` 固定为 `pnpm@9.15.0`）
- 语言：TypeScript
- `apps/web`：React + Vite
- `apps/server`：Fastify
- `packages/shared`：可构建的共享类型/工具包
- 运行时：Node.js（开发环境为 v24）

## 目录结构

```
RoleAgent Tavern/
├── apps/
│   ├── web/                # React + Vite 前端
│   │   ├── src/
│   │   ├── index.html
│   │   ├── vite.config.ts
│   │   └── tsconfig.json
│   └── server/             # Fastify 后端
│       ├── src/index.ts
│       └── tsconfig.json
├── packages/
│   └── shared/             # 共享类型（构建到 dist，被 apps 依赖）
│       ├── src/index.ts
│       └── tsconfig.json
├── docs/
│   ├── devlog.md           # 开发日志
│   └── todo.md             # 任务清单
├── .env.example            # 环境变量模板（无 API Key）
├── .gitignore
├── AGENTS.md
├── package.json            # 根 workspace 脚本
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── README.md
```

> `node_modules/`、各包 `dist/`、`data/`、`*.db` 等为生成物或本地数据，已在 `.gitignore` 中忽略，不在版本控制中。

## 开发前准备

1. 安装 Node.js（开发环境为 v24）。
2. 启用 pnpm。本仓库通过 `package.json` 的 `packageManager` 字段固定 `pnpm@9.15.0`；若未安装，可执行 `npm install -g pnpm@9.15.0`。
3. 复制环境变量模板（按需修改；切勿提交 `.env`）：

   Windows PowerShell:
   ```powershell
   copy .env.example .env
   ```

   Git Bash / macOS / Linux:
   ```bash
   cp .env.example .env
   ```

## 安装依赖

```bash
pnpm install
```

## 启动开发环境

```bash
pnpm dev
```

该命令会先构建 `packages/shared`，再并行启动：
- 前端：http://localhost:5173 （Vite，`/api` 代理到后端）
- 后端：http://localhost:3000

## 类型检查

```bash
pnpm typecheck
```

会先构建 `packages/shared`，再对所有包执行 `tsc --noEmit`。

## 构建

```bash
pnpm build
```

会先构建 `packages/shared`，再构建 `apps/web`（`vite build`）与 `apps/server`（`tsc`），产物分别输出到各自的 `dist/`。后端可独立运行：

```bash
node apps/server/dist/index.js
```

## 健康检查接口

```
GET http://localhost:3000/api/health
```

响应：

```json
{ "status": "ok", "name": "RoleAgent Tavern" }
```

## Git 分支协作规则

- 在功能分支上开发，通过 PR 合并。
- 不直接向 `main` 提交。
- 详见 `AGENTS.md`。

## 安全提醒

- 切勿提交 `.env`、`.env.local`、API Key 或任何密钥。
- 切勿提交本地数据库（`*.db`、`*.sqlite`）、`data/` 及构建产物（`dist/`、`build/`）；以上均已被 `.gitignore` 忽略。
- 仅 `.env.example` 作为模板纳入版本控制，其中不含任何真实密钥。
