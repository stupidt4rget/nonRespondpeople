# V0.17 SillyTavern Extension Compatibility Bridge - Smoke Results

> **日期**: 2026-07-11
> **分支**: `feature/st-extension-bridge-v0.17`
> **基线**: `dev` @ `5559e80` (V0.16 merge)

---

## 1. 测试环境

| 项 | 值 |
| --- | --- |
| OS | Windows |
| Branch | `feature/st-extension-bridge-v0.17` |
| Dev server | `pnpm dev` (apps/web :5173, apps/server :3000) |
| Fixture ZIP | `E:\RoleAgent Tavern Smoke Fixtures\compat-l2-fixture.zip` |
| Database | SQLite (`dev.db`), `prisma db push` confirmed "already in sync" |
| Node | pnpm workspace monorepo |
| HEAD at smoke time | `8fa59fcc` |

Fixture 为仓库外独立创建的最小 L2 compat extension，仅使用 `window.extension_settings`、`window.saveSettingsDebounced`、`window.SillyTavern.getContext()` 和 `#extensions_settings` 挂载点。不含 jQuery、import、fetch、parent 访问或 storage 访问。

---

## 2. 已完成 Commits

| Commit | 描述 |
| --- | --- |
| `916f5a3` | feat: add extension compatibility settings API v0.17 |
| `2d5e2dc` | feat: add extension compatibility runtime shell v0.17 |
| `e331d0d` | feat: add extension compatibility runtime host v0.17 |
| `fe8663c` | feat: show extension compatibility levels v0.17 |
| `8fa59fcc` | fix: serve extension js assets with module-safe mime v0.17 |

---

## 3. 内部 Fixture Smoke 结果

### 3.1 安装与启用

| 步骤 | HTTP | 结果 |
| --- | --- | --- |
| POST `/api/extensions/install-zip` (multipart, compat-l2-fixture.zip) | 201 | 安装成功，返回 `InstalledExtensionDto` |
| PATCH `/api/extensions/compat-l2-fixture` (`enabled: true`) | 200 | 扩展已启用 |

### 3.2 Compatibility Runtime 加载

| 步骤 | HTTP | 结果 |
| --- | --- | --- |
| GET `/api/extensions/compat-l2-fixture/settings` | 200 | 返回默认 `{}` settings |
| GET `/api/extensions/compat-l2-fixture/compat-runtime` | 200 | 返回 bridge shell HTML |
| GET `/api/extensions/compat-l2-fixture/assets/style.css` | 200 | CSS 加载成功 |
| GET `/api/extensions/compat-l2-fixture/assets/index.js` | 200 | JS module 加载成功 |

### 3.3 UI 与能力验证

- iframe 内 fixture UI 正确渲染（标题、3 个能力检查 badge、输入框、Save 按钮、状态文本）
- `window.SillyTavern.getContext()` -> available
- `window.extension_settings` -> available
- `window.saveSettingsDebounced` -> available

### 3.4 设置持久化

| 步骤 | HTTP | 结果 |
| --- | --- | --- |
| 在输入框输入文本，点击 Save | PATCH `/api/extensions/compat-l2-fixture/settings` | 200 |
| 关闭 panel 后重新打开 | GET `/api/extensions/compat-l2-fixture/settings` | 200，值正确读回 |
| 刷新页面后重新打开 | GET settings + compat-runtime + assets | 200，log-confirmed server reload path; UI readback observed manually |

### 3.5 结论

L1/L2 bridge 基础设施通过内部 fixture 验收：隔离 shell、设置读写、saveSettingsDebounced debounce、postMessage 握手与安全边界均按设计工作。

---

## 4. CORS / MIME 修复记录

### 4.1 问题现象

Fixture 首次 smoke 时，compat runtime panel 显示：

```
Declared extension module failed to load.
```

后端日志确认 `GET assets/index.js` 和 `GET assets/style.css` 均返回 200，说明文件可读取，但 module script 未执行。

### 4.2 根因

compat iframe 使用 `sandbox="allow-scripts"`（无 `allow-same-origin`），浏览器赋予 iframe **opaque origin**。`<script type="module">` 按 HTML 规范始终以 CORS mode 发起请求（与 `crossorigin` 属性无关）。浏览器发送 `Origin: null`，后端返回 200 但缺少 `Access-Control-Allow-Origin` 头，浏览器拦截响应，`<script>` 触发 `error` 事件。

CSS 不受影响是因为 `<link rel="stylesheet">` 默认使用 `no-cors` 模式，不需要 CORS 头。

MIME 类型本身正确（`text/javascript; charset=utf-8`），不是本次故障的原因。

### 4.3 修复

**Commit `8fa59fcc`** 修改了 3 个文件：

| 文件 | 变更 |
| --- | --- |
| `apps/server/src/routes/extensions.ts` | asset 路由：`Origin: null` 时返回 `Access-Control-Allow-Origin: null` + `Vary: Origin` |
| `apps/server/src/services/extensionAssets.ts` | `.mjs` 加入 `ALLOWED_ASSET_EXTENSIONS`；`getExtensionAssetContentType` 对 `.mjs` 返回 `text/javascript; charset=utf-8` |
| `apps/server/src/services/extensionCompatRuntime.ts` | `readManifestAssetEntry` 的 `js` 字段接受 `.js` 或 `.mjs` |

### 4.4 修复后状态

- `.js` / `.mjs` Content-Type: `text/javascript; charset=utf-8`
- `.css` Content-Type: `text/css; charset=utf-8`
- iframe sandbox 仍为 `allow-scripts`，未加 `allow-same-origin`
- CSP `script-src 'self' 'nonce-...'` 未放宽到远程域名
- `Access-Control-Allow-Origin: null` 仅允许 opaque origin（sandbox iframe）
- `nosniff` / `no-store` / path traversal / symlink / size 白名单不变

---

## 5. JS-Slash-Runner 当前结果

### 5.1 总体状态

**本版本不追求跑通 JS-Slash-Runner（酒馆助手）五个 tab。** 当前保持 degraded / display-only 状态。V0.17 不通过补 L3-L5 来追求表面跑通。

### 5.2 阻断原因（按严重程度）

| # | 阻断点 | 严重程度 | 说明 |
| --- | --- | --- | --- |
| 1 | `dist/index.js` 顶部 25 个 static ESM imports 指向 SillyTavern 模块 | FATAL | 浏览器无法完成 module link，模块根本不执行 |
| 2 | 缺少 jQuery (`$`) | FATAL | 入口使用 `$(() => { ... })` jQuery DOM ready，无 `$` 则入口不执行 |
| 3 | 存在远程 CDN 脚本注入（jsdelivr.net） | FATAL | CSP `connect-src 'none'` / `script-src 'self'` 阻断远程加载 |
| 4 | `fetch('/version')` 等 API 调用 | FATAL | CSP `connect-src 'none'` 阻断 |
| 5 | `eventSource` / `event_types` 缺失 | DEGRADED | 设置 store 依赖 `APP_READY` 事件初始化 |
| 6 | `SlashCommandParser` 缺失 | DEGRADED | 部分功能注册 slash command |
| 7 | chat / worldbook / prompt / generation API 缺失 | DEGRADED | 五个 tab 中的 chat/character/worldbook/generation 功能不可用 |

### 5.3 不实施的范围

V0.17 明确不实现以下能力来追求 JS-Slash-Runner 跑通：

- 不自托管 jQuery（需单独批准的新依赖）
- 不加入 import map / module shim（L3+ 范围）
- 不实现 `eventSource` / `event_types` 事件系统
- 不实现 `SlashCommandParser` / slash command
- 不开放 chat / character / worldbook / persona 全量读写
- 不开放 prompt / generation hooks
- 不提供 `getRequestHeaders` / auth proxy

### 5.4 后续路径

如需在后续版本尝试 JS-Slash-Runner smoke，建议路径：

1. 先用内部 fixture 验收 L1/L2 bridge（已完成）
2. 自托管经批准的固定版本 jQuery + 许可证
3. 实现受限 import map / module-link shim 映射到 RoleAgent compat shim modules
4. 尝试加载 JS-Slash-Runner，记录 degraded 项
5. 不为五个 tab 的表面成功开放 L3-L5 能力

---

## 6. 安全边界

V0.17 SillyTavern Extension Compatibility Bridge 的安全边界如下：

### 6.1 执行隔离

- 第三方 JS/CSS **永远不注入** React 主 document
- iframe 固定 `sandbox="allow-scripts"`，**无 `allow-same-origin`**
- compatibility shell 与 native runtime 使用不同入口和协议
- 关闭/禁用/删除扩展时立即 blank iframe 并废弃 session id
- 一个 panel 同时只运行一个 external extension

### 6.2 不开放的能力

- 不主页面注入第三方 JS
- no `allow-same-origin`
- no `getRequestHeaders` / auth proxy
- no event bus (`eventSource` / `event_types`)
- no slash command (`SlashCommandParser`)
- no chat / character / worldbook / persona full access
- no prompt / generation hooks
- no arbitrary filesystem / database / API key access

### 6.3 开放的能力（L2）

- `window.extension_settings`（隔离的 per-extension JSON 对象）
- `window.saveSettingsDebounced`（500ms debounce，通过 postMessage 发送给 host）
- `window.SillyTavern.getContext()` 返回 `{ extensionSettings, saveSettingsDebounced }`
- `#extensions_settings` 挂载点
- 受控的 CSS / JS module 加载

### 6.4 设置存储

- settings 只写入当前 `InstalledExtension.compatSettingsJson` 字段
- 最大 256 KiB，深度 32，节点 10,000，单字符串 64 KiB，单 key 256 code points
- 递归拒绝 `__proto__` / `prototype` / `constructor` 键
- iframe 和服务器两端都校验，以服务器为准
- 禁用扩展不清空设置，删除扩展时级联清除

### 6.5 CSP

compat runtime shell CSP：

```
default-src 'none';
base-uri 'none';
object-src 'none';
form-action 'none';
frame-ancestors 'self';
frame-src 'none';
child-src 'none';
worker-src 'none';
script-src 'self' 'nonce-...';
style-src 'self';
img-src 'self' data: blob:;
font-src 'self' data:;
media-src 'none';
connect-src 'none';
```

未放宽到远程域名。

---

## 7. 最终验证命令

```powershell
git diff --check
pnpm typecheck
pnpm build
pnpm build:desktop
```

以上命令在 Commit 6（本文档）提交前执行，结果记录于 devlog。
