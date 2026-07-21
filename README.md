# RoleAgent Tavern 使用说明

## 环境要求

- Node.js（当前开发环境使用 v24）
- pnpm 9.15.0（项目已在 `package.json` 中固定版本）
- Windows PowerShell，或支持环境变量的 Bash 终端

## Web 版启动

首次下载项目后，需要安装依赖、生成 Prisma Client，并应用数据库迁移。

### Windows PowerShell

```powershell
pnpm install
$env:DATABASE_URL="file:./dev.db"
pnpm --filter @roleagent/server db:generate
pnpm --filter @roleagent/server exec prisma migrate deploy
pnpm dev
```

### macOS / Linux / Git Bash

```bash
pnpm install
export DATABASE_URL="file:./dev.db"
pnpm --filter @roleagent/server db:generate
pnpm --filter @roleagent/server exec prisma migrate deploy
pnpm dev
```

启动成功后访问：

- Web 页面：<http://localhost:5173>
- 后端 API：<http://localhost:3000>
- 健康检查：<http://localhost:3000/api/health>

以后再次启动通常只需：

```bash
pnpm dev
```

## 配置模型

进入 Web 页面后，在左侧打开“模型设置”，填写：

1. OpenAI Chat Completions 兼容 API 的 Base URL。
2. API Key。
3. 模型名称。
4. 点击“保存设置”。

服务端会在 Base URL 后请求 `/chat/completions`。保存后，设置查询接口不会把 API Key 原文返回前端。

也可以在启动服务前设置环境变量：

### Windows PowerShell

```powershell
$env:LLM_API_BASE_URL="https://provider.example/v1"
$env:LLM_API_KEY="your-api-key"
$env:LLM_MODEL="your-model-name"
pnpm dev
```

### macOS / Linux / Git Bash

```bash
export LLM_API_BASE_URL="https://provider.example/v1"
export LLM_API_KEY="your-api-key"
export LLM_MODEL="your-model-name"
pnpm dev
```

如果数据库中已保存有效的模型密钥，则数据库配置优先；否则使用环境变量。

## 基本使用流程

1. 在左侧“创建角色”中填写名称和简介，或在“导入角色”中选择 JSON / PNG 角色卡。
2. 从角色列表选择一个角色。
3. 按需设置用户 Persona、世界书、Prompt Preset 和生成参数。
4. 在聊天输入框中发送消息。
5. 生成过程中可以停止输出；已生成的消息可以编辑、删除或重新生成。

角色卡中包含世界书时，导入后会自动创建并绑定对应世界书。角色详情页可以编辑角色资料并导出 JSON 角色卡。

## 扩展程序使用

1. 打开左侧“扩展程序”。
2. 上传 ZIP 扩展包，或填写公开 HTTPS Git 仓库地址。
3. 安装完成后手动启用扩展。
4. 展开扩展卡片，按需启用功能项并打开运行界面。

扩展默认处于停用状态。第三方脚本只会在受控 iframe 中运行，但启用前仍应确认扩展来源可信。部分 SillyTavern 扩展只能安装或显示设置界面，不能完整运行。

## 桌面版

启动 Electron 开发环境：

```bash
pnpm dev:desktop
```

构建桌面端：

```bash
pnpm build:desktop
```

生成 Windows x64 portable 程序：

```bash
pnpm package:desktop
```

打包结果位于 `apps/desktop/release/`。桌面版使用 Electron 用户数据目录中的独立 SQLite 数据库，并会在启动时自动应用数据库迁移。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `pnpm dev` | 启动 Web 与 Server 开发环境 |
| `pnpm typecheck` | 检查 shared、web、server 的 TypeScript 类型 |
| `pnpm build` | 构建 shared、web、server |
| `pnpm dev:desktop` | 启动桌面开发环境 |
| `pnpm build:desktop` | 构建桌面端依赖与代码 |
| `pnpm package:desktop` | 打包 Windows x64 portable 程序 |

根命令会先构建 `packages/shared`。如果单独运行某个 workspace 包，请先确保 `packages/shared/dist/` 已生成。

## 本地数据

- Web 开发数据库：`apps/server/prisma/dev.db`
- Web 扩展数据：`apps/server/data/`
- 桌面版数据库与扩展：Electron 用户数据目录下的 `data/`
- 构建产物：各包的 `dist/`、`apps/desktop/release/`

这些内容都是本地数据或生成文件，不应提交到 GitHub。不要提交 `.env`、API Key、SQLite 数据库、聊天记录或其他私密数据。

## 常见问题

### 找不到 Prisma Client

重新设置 `DATABASE_URL` 并生成客户端：

```powershell
$env:DATABASE_URL="file:./dev.db"
pnpm --filter @roleagent/server db:generate
```

### 数据库表不存在

应用已经提交的迁移：

```powershell
$env:DATABASE_URL="file:./dev.db"
pnpm --filter @roleagent/server exec prisma migrate deploy
```

### 修改 shared 后类型没有更新

使用根目录的 `pnpm dev`、`pnpm typecheck` 或 `pnpm build`，这些命令会先重新构建 shared。

### 无法调用模型

检查 Base URL、API Key 和模型名称是否填写完整，并确认服务商支持 OpenAI Chat Completions 兼容的 `/chat/completions` 接口。

### 端口被占用

默认端口为 Web `5173`、Server `3000`。关闭占用端口的程序后重新运行 `pnpm dev`，或按项目配置修改端口。
