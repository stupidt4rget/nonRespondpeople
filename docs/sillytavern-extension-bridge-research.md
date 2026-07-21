# SillyTavern Extension Compatibility Bridge Research

> **调研阶段**：V0.17 只读调研（2026-07-10）
> **基线**：`dev` @ `5559e80`（merge: add extension runtime and feature toggles v0.16）
> **调研分支**：`feature/st-extension-bridge-v0.17`
> **源码路径**：
> - RoleAgent Tavern：`E:\RoleAgent Tavern`
> - SillyTavern：`E:\Sillytavern Originalcode\SillyTavern-release`
> - JS-Slash-Runner（酒馆助手）：`E:\Sillytavern Originalcode\JS-Slash-Runner-main`

本文档区分两类内容：

- **【源码确认】**：已在上述仓库中直接阅读或 `rg` 追踪到的机制。
- **【设计建议】**：基于现状提出的 V0.17 架构与 MVP 范围，尚未实现。

---

## 1. 背景与目标

### 1.1 V0.15 / V0.16 已具备的能力

【源码确认】RoleAgent Tavern 在 V0.15 实现了 Extension Manager（安装、列表、启用/停用、删除），在 V0.16 叠加了 Extension Runtime 与 feature toggles。详见 `docs/devlog.md` 中 2026-07-10 条目。

核心能力摘要：

| 能力 | 关键文件 |
| --- | --- |
| ZIP / 公开 HTTPS Git 安装 | `apps/server/src/services/extensionManager.ts` |
| manifest 规范化与 external 识别 | `normalizeExtensionManifest()` → `compatibility: 'roleagent' \| 'external'` |
| 功能项与 iframe runtime | `resolveManifestFeatures()`, `getInstalledExtensionRuntime()` |
| 受控 assets / runtime API | `apps/server/src/routes/extensions.ts` |
| 前端管理 UI + iframe 宿主 | `apps/web/src/components/ExtensionManagerPanel.tsx`, `ExtensionRuntimePanel.tsx` |
| 共享 DTO | `packages/shared/src/index.ts` |
| DB 模型 | `apps/server/prisma/schema.prisma` → `InstalledExtension` |

### 1.2 V0.17 为什么要做 Compatibility Bridge

【设计建议】V0.16 已能**识别** SillyTavern 风格 manifest（`js`/`css`/`loading_order`），并将 external 脚本标为 **display-only**，**不在主页面执行**。社区大量插件（如酒馆助手 JS-Slash-Runner）假设完整 SillyTavern Extension API 与主页面 DOM 挂载点存在。

V0.17 目标不是一次性复制 SillyTavern Extension API，而是设计**安全、分级、可逐步落地**的兼容桥，使热门插件能在受控环境中逐步获得所需能力，同时避免污染 React 主应用与泄露敏感数据。

---

## 2. 当前 RoleAgent Tavern 扩展系统现状

### 2.1 已实现能力

【源码确认】

#### 安装 / 删除 / 启用 / 停用

- `installExtensionFromZip()` / `installExtensionFromGit()` → `installValidatedExtension()`（`extensionManager.ts`）
- `updateExtensionEnabled()` → `PATCH /api/extensions/:id`
- `deleteInstalledExtension()` → `DELETE /api/extensions/:id`
- 新安装扩展默认 `enabled: false`（`installValidatedExtension` 中 `enabled: false`）

#### manifest 识别

- `readAndValidateManifest()` 读取 `manifest.json`（≤64 KB）
- `type === 'roleagent-extension'` → `compatibility: 'roleagent'`；否则 `external`
- 支持 `entry` / `js` / `css` / `features[]` / `loading_order` 路径校验（不执行，仅验证相对路径安全）
- external 且无 RoleAgent `features` 时，`synthesizeExternalDisplayFeatures()` 将 `js`/`css` 合成为 display-only 功能项（`external-script`, `external-style`）

#### feature toggles

- `InstalledExtension.featureSettingsJson` 存储 `{ features: { [featureId]: { enabled: boolean } } }`
- `PATCH /api/extensions/:id/features/:featureId` → `updateExtensionFeatureEnabled()`
- `buildExtensionFeatureDtos()` 计算 `runnable`, `runtimeUrl`, `compatibilityNote`

#### API 端点

| 方法 | 路径 | 实现 |
| --- | --- | --- |
| GET | `/api/extensions` | `listInstalledExtensions()` |
| PATCH | `/api/extensions/:id` | `updateExtensionEnabled()` |
| PATCH | `/api/extensions/:id/features/:featureId` | `updateExtensionFeatureEnabled()` |
| GET | `/api/extensions/:id/assets/*` | `resolveExtensionAssetPath()` + `readExtensionAssetFile()` |
| GET | `/api/extensions/:id/runtime/:featureId` | `getInstalledExtensionRuntime()` + `injectHtmlBaseHref()` |
| POST | `/api/extensions/install-zip` | multipart ZIP |
| POST | `/api/extensions/install-git` | 公开 HTTPS Git |
| DELETE | `/api/extensions/:id` | 删除 DB 记录 + 文件目录 |

#### sandbox iframe

- `ExtensionRuntimePanel.tsx`：`sandbox="allow-scripts"`（**无** `allow-same-origin`）
- `src` 来自 `feature.runtimeUrl`（仅 `runnable === true` 且 entry 为 `.html`/`.htm`）
- 服务端 CSP（`extensionAssets.ts` → `RUNTIME_CSP`）：
  - `default-src 'none'`
  - `script-src 'self' 'unsafe-inline' blob:`
  - `connect-src 'none'`

#### postMessage allowlist

- 仅接受来自当前 iframe `contentWindow` 的消息
- `event.data` 须为 plain object，JSON 序列化长度 ≤ 4096
- 支持类型：
  - `roleagent:extension-ready`
  - `roleagent:show-toast`（`message` ≤ 200，`level`: `info`|`success`|`error`）

#### assets 安全策略

- 路径遍历拒绝、符号链接拒绝、扩展名白名单（`.html`, `.js`, `.css`, 图片等）
- 单文件 ≤ 25 MB，解压总量 ≤ 100 MB
- `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`

#### external / SillyTavern 风格 manifest（display-only）

- `EXTERNAL_SCRIPT_NOTE` / `EXTERNAL_STYLE_NOTE`：仅展示，不执行
- `computeFeatureRunnable()` 对 `displayOnly` 返回 `false`
- external `js` 路径**不会**被注入主页面

### 2.2 当前不能做什么

【源码确认】

| 缺失能力 | 依据 |
| --- | --- |
| 不执行 external JS/CSS | `displayOnly: true`；`getInstalledExtensionRuntime()` 对 non-HTML entry 返回 403 |
| 不注入主页面 | 无 `<script>` 注入逻辑；V0.16 devlog 明确说明 |
| 不支持 SillyTavern Extension API | 无 `SillyTavern`, `getContext`, `eventSource` 等 shim |
| 不支持 `extension_settings` | DB 仅有 `featureSettingsJson`（功能开关），无 per-extension 设置 blob |
| 不支持 ST event bus | 无 `eventSource` / `event_types` |
| 不支持 slash command | 无 `SlashCommandParser` 注册桥 |
| 不支持 prompt/generation hooks | 无 `Generate` 拦截或 `GENERATION_*` 事件 |

---

## 3. SillyTavern 第三方插件运行机制

### 3.1 目录结构

【源码确认】

| 类型 | 路径 | 来源 |
| --- | --- | --- |
| 内置扩展 | `public/scripts/extensions/{name}/` | `src/endpoints/extensions.js` → `PUBLIC_DIRECTORIES.extensions` |
| 用户第三方 | `{user}/extensions/{folder}/` → 前端名 `third-party/{folder}` | `users.js` 路由 `/scripts/extensions/third-party/*` |
| 全局第三方 | `public/scripts/extensions/third-party/{folder}/` | `src/constants.js` → `globalExtensions` |

发现逻辑：`GET /api/extensions/discover`（`src/endpoints/extensions.js`）合并 built-in、local、global 扩展列表。

### 3.2 manifest 结构

【源码确认】典型字段（以 JS-Slash-Runner `manifest.json` 为例）：

```json
{
  "display_name": "酒馆助手",
  "loading_order": 100,
  "requires": [],
  "optional": [],
  "js": "dist/index.js",
  "css": "dist/index.css",
  "author": "...",
  "version": "4.8.18",
  "auto_update": true,
  "minimum_client_version": "1.12.13",
  "i18n": { "en": "i18n/en.json" }
}
```

可选 `hooks` 对象（`extensions.js` → `hasExtensionHook` / `callExtensionHook`）：`install`, `update`, `delete`, `clean`, `enable`, `disable`, `activate` — 值为扩展 JS 模块**导出的函数名**。

【待进一步确认】社区文档中常见的 `settings.html` **不是** SillyTavern 核心 `extensions.js` 的通用加载机制；源码中仅见个别内置扩展自行 fetch（如 `quick-reply` 的 `settings.html`）。多数第三方扩展（含酒馆助手）在 `script.js` 内用 jQuery/Vue **自行生成**设置 UI。

### 3.3 script.js / style.css 加载流程

【源码确认】`activateExtensions()`（`public/scripts/extensions.js`）：

1. 按 `loading_order` 排序 manifest
2. 检查 `requires`（Extras API 模块）、`dependencies`（其他扩展）、`minimum_client_version`、`disabledExtensions`
3. 依次：`addExtensionLocale()` → `addExtensionScript()` + `addExtensionStyle()`
4. 成功后 `activeExtensions.add(name)` → `callExtensionHook(name, 'activate')`

**JS 加载**（`addExtensionScript`）：

- URL：`/scripts/extensions/${name}/${manifest.js}`
- `type="module"`, `async`, `document.body.appendChild(script)`
- 同一扩展只加载一次（按 `script[id]` 去重）

**CSS 加载**（`addExtensionStyle`）：

- URL：`/scripts/extensions/${name}/${manifest.css}`
- `document.head.appendChild(link)`

### 3.4 运行上下文

【源码确认】

- 插件 JS 以 **ES module** 运行在**主页面** `window` / `document` 上下文，与 SillyTavern 核心脚本**共享**全局作用域
- 可直接访问：`jQuery`/`$`、`SillyTavern`、`extension_settings`、`chat`、`characters` 等
- `globalThis.SillyTavern` 在 `public/script.js` 定义为 `{ libs, getContext }`
- `getContext()` 实现在 `public/scripts/st-context.js`，聚合大量核心 API

### 3.5 jQuery 与 DOM 挂载

【源码确认】

- 主页面 `index.html` 提供 `#extensions_settings` 与 `#extensions_settings2`（扩展设置面板容器）
- 酒馆助手入口（`JS-Slash-Runner-main/src/index.ts`）：

```typescript
const $app = $('<div id="tavern_helper">').appendTo('#extensions_settings');
app.mount($app[0]);
```

- 扩展菜单：`#extensionsMenu` / `#extensionsMenuButton`（`addExtensionsButtonAndMenu()`）

### 3.6 设置持久化

【源码确认】

- 全局对象 `extension_settings`（`public/scripts/extensions.js` 导出）为内存中的大对象，含 `regex`, `variables`, `note`, `tts` 等子树
- 插件通过 `extension_settings[extensionId] = ...` 或 `_.set(extension_settings, key, value)` 读写
- `saveSettingsDebounced()`（`public/script.js`）→ debounced `saveSettings()` → `POST /api/settings/save`，payload 含 `extension_settings` 字段
- 启动时 `loadExtensionSettings()` → `Object.assign(extension_settings, settings.extension_settings)`

### 3.7 事件系统

【源码确认】`public/scripts/events.js`：

- `event_types`：含 `APP_READY`, `CHAT_CHANGED`, `GENERATION_STARTED`, `GENERATION_ENDED`, `SETTINGS_UPDATED`, `EXTENSIONS_FIRST_LOAD` 等 60+ 事件名
- `eventSource`：`EventEmitter` 实例（`public/lib/eventemitter.js`）
- API：`on`, `once`, `removeListener`, `emit`

### 3.8 Slash Command

【源码确认】

- `registerSlashCommand`（`public/scripts/slash-commands.js`）为 `SlashCommandParser.addCommand` 的别名（已标记 deprecated）
- 推荐：`SlashCommandParser.addCommandObject(SlashCommand.fromProps({...}))`
- `getContext()` 暴露 `SlashCommandParser`, `SlashCommand`, `executeSlashCommandsWithOptions` 等

### 3.9 getContext 暴露的能力（摘要）

【源码确认】`public/scripts/st-context.js` → `getContext()` 返回对象包含（非完整列表）：

| 类别 | 字段示例 |
| --- | --- |
| 聊天 | `chat`, `chatMetadata`, `addOneMessage`, `deleteMessage`, `saveChat`, `getCurrentChatId` |
| 角色 | `characters`, `characterId`, `getOneCharacter`, `selectCharacterById` |
| 生成 | `generate`（即 `Generate`）, `stopGeneration`, `sendGenerationRequest`, `sendStreamingRequest` |
| 世界书 | `loadWorldInfo`, `saveWorldInfo`, `getWorldInfoNames`, `convertCharacterBook` |
| 设置 | `extensionSettings`（即 `extension_settings`）, `saveSettingsDebounced`, `powerUserSettings` |
| 事件 | `eventSource`, `eventTypes` / `event_types` |
| 网络 | `getRequestHeaders` |
| Slash | `SlashCommandParser`, `registerSlashCommand`, `executeSlashCommandsWithOptions` |
| Prompt | `extensionPrompts`, `setExtensionPrompt` |
| 变量 | `variables.local.*`, `variables.global.*` |

---

## 4. JS-Slash-Runner / 酒馆助手样本分析

### 4.1 入口与 manifest

【源码确认】

| 项 | 值 |
| --- | --- |
| manifest | `JS-Slash-Runner-main/manifest.json` |
| JS 入口 | `dist/index.js`（ES module） |
| CSS | `dist/index.css` |
| 前端入口 | `src/index.ts` → 构建为 `dist/index.js` |
| 挂载时机 | `$(() => { ... })` — jQuery DOM ready |
| 挂载点 | `#extensions_settings` |
| UI 框架 | Vue 3 + Pinia + vue-final-modal |

### 4.2 五个页签

【源码确认】`src/Panel.vue` → `tabs` 常量：

| key | 名称 | 组件 |
| --- | --- | --- |
| `render` | 渲染 | `Render.vue` |
| `script` | 脚本 | `Script.vue` |
| `toolbox` | 工具 | `Toolbox.vue` |
| `optimize` | 优化 | `Optimize.vue` |
| `developer` | 开发 | `Developer.vue` |

页签 DOM 由 Vue 模板生成（非静态 `settings.html`）。活动页签持久化：`useValidatedTab('TH-Panel:active_tab', 'render', ...)`。

### 4.3 设置读写与保存

【源码确认】以全局设置为例（`src/store/settings/global.ts`）：

1. 从 `extension_settings.tavern_helper`（`setting_field = 'tavern_helper'`）读取
2. Zod schema 校验（`GlobalSettings` in `src/type/settings.ts`）
3. Pinia `watch(settings, ...)` 深度监听 → `_.set(extension_settings, setting_field, ...)` → `saveSettingsDebounced()`
4. 应用就绪：`APP_READY_EVENTS` = `[event_types.APP_READY, 'chatLoaded', event_types.SETTINGS_UPDATED]`（`src/util/tavern.ts`）

另有 `useChatSettingsStore`, `useCharacterSettingsStore`, `usePresetSettingsStore`（`src/store/settings/`），分别绑定 chat/character/preset 级数据。

### 4.4 使用的 SillyTavern API（主要）

【源码确认】

| API | 用途示例 |
| --- | --- |
| `SillyTavern.getContext()` | iframe 内通过 `predefine.js` 代理父窗口 |
| `extension_settings` | 全局/聊天/角色/预设设置持久化 |
| `saveSettingsDebounced` | 设置变更落盘 |
| `eventSource` / `event_types` | 消息渲染、生成结束、设置更新等 |
| `getRequestHeaders` | `import_raw.ts`, `compatibility.ts` 中 authenticated fetch |
| `chat`, `characters`, `chat_metadata` | 消息/角色/变量操作 |
| `Generate` / `generate` | `src/function/generate/` |
| `extension_prompts`, `setExtensionPrompt` | `src/function/inject.ts` prompt 注入 |
| `SlashCommandParser.addCommandObject` | `/event-emit`, `/audio*` 等（多数标记 deprecated） |
| `world_names`, worldbook API | `src/function/worldbook.ts` |
| jQuery `$` | DOM 挂载、事件、部分 UI 交互 |

额外：**TavernHelper** 全局对象（`initTavernHelperObject()`）— 酒馆助手自有 API 层，封装 character/chat/generate/worldbook/variables 等，供用户脚本与 iframe 使用。

### 4.5 注册的 Slash Command

【源码确认】`src/slash_command/index.ts` → `initSlashEventEmit()`, `initSlashAudio()`：

- `/event-emit`（`event.ts`）
- `/audioenable`, `/audioplaypause`, `/audiomode`, `/audioimport`, `/audioselect`（`audio.ts`，均标记 `@deprecated`）

### 4.6 监听的事件（部分）

【源码确认】

| 模块 | 事件 |
| --- | --- |
| `panel/optimize/better_message_to_load` | `USER_MESSAGE_RENDERED`, `CHARACTER_MESSAGE_RENDERED`, `MESSAGE_DELETED`, `SETTINGS_UPDATED` |
| `function/inject.ts` | `GENERATION_ENDED`, `GENERATION_STOPPED`（通过 `iframe_events` / `tavern_events`） |
| `swipe.ts` | `MESSAGE_SWIPE_DELETED` |
| `store/settings/global.ts` | `APP_READY`, `chatLoaded`, `SETTINGS_UPDATED` |

### 4.7 依赖 jQuery / 主页面 DOM

【源码确认】

- **强依赖 jQuery**：入口 `$()`, `appendTo('#extensions_settings')`, 多处 `$(document).on(...)`
- **强依赖 `#extensions_settings`**：无主页面该节点则 UI 无法挂载
- **强依赖主页面 window**：`TavernHelper`, `SillyTavern`, `extension_settings` 均在主页面初始化

### 4.8 对 RoleAgent Tavern 兼容难度

【设计建议】**高**。酒馆助手不是“纯 settings.html 插件”，而是：

1. 主页面 ES module + Vue 应用
2. 大量 ST 核心 API 与可变全局状态
3. 自有 iframe 脚本运行时（`src/iframe/predefine.js` 从 `window.parent` 桥接 API）
4. 生成/世界书/角色写操作

V0.17 **无法**通过“仅加载 `dist/index.js` 到主页面”安全兼容；需要 compatibility iframe + 分层 shim，且首期只能覆盖**设置 UI 展示 + extension_settings 读写**子集。

### 4.9 依赖表

| 依赖项 | JS-Slash-Runner 用途 | SillyTavern 来源 | RoleAgent Tavern 当前是否有 | 兼容建议 | 风险 |
| --- | --- | --- | --- | --- | --- |
| `#extensions_settings` DOM | Vue 应用挂载 | `index.html` | 无等价挂载点 | 在 compat iframe 或 Extension Manager 内提供容器；或专用 host div | 中：布局/样式差异 |
| jQuery `$` | 入口、事件、部分 UI | 主页面全局 | 未作为扩展 API 暴露 | compat 环境注入 jQuery；或 adapter 改写入口（非 MVP） | 低（仅 UI 层） |
| `extension_settings` | 全局/聊天/角色设置 | `extensions.js` | 无 | L2：per-extension JSON blob + 内存 proxy | 中：需迁移/隔离键空间 |
| `saveSettingsDebounced` | 设置落盘 | `script.js` | 无 | L2：debounce → `PATCH` 扩展设置 API | 低 |
| `SillyTavern.getContext` | 全功能 API 入口 | `script.js` + `st-context.js` | 无 | L4+：分阶段白名单 shim | 高 |
| `eventSource` / `event_types` | 消息/生成/设置事件 | `events.js` | 无 | L3：宿主转发选定事件 | 中 |
| `getRequestHeaders` | CSRF 认证请求 | `script.js` | 无（有自有 API） | **不暴露**；提供受限代理 API | 高 |
| `chat` / `characters` | 消息与角色读写 | `script.js` | 有后端，无前端全局 | L4：只读 DTO 经 postMessage | 高 |
| `Generate` / `generate` | 触发 LLM 生成 | `script.js` | 有 `/api/chat` | L5：显式授权 + 审计 | 极高 |
| `setExtensionPrompt` | Prompt 注入 | `script.js` | 有 prompt 管线 | L5 | 极高 |
| `SlashCommandParser` | 注册斜杠命令 | `slash-commands/` | 无 | L3：注册到宿主 registry | 中 |
| `TavernHelper` | 助手自有 API | `function/index.ts` | 无 | 需随 getContext shim 逐步实现 | 高 |
| iframe parent 桥接 | 用户脚本 API | `iframe/predefine.js` | 无 compat parent | compat iframe 作 parent 提供 `_bind` API | 高 |
| `world_names` / worldbook API | 世界书 CRUD | `world-info.js` | 有后端 | L4 只读 / L5 写入 | 高 |
| Vue 3 runtime | UI 渲染 | CDN / 打包进 dist | 未注入 | compat iframe 加载 Vue 或打包进 bridge shell | 中 |

---

## 5. SillyTavern API 依赖盘点

### 5.1 全局对象

| API | ST 行为 | RAT V0.16 |
| --- | --- | --- |
| `SillyTavern` | `globalThis.SillyTavern = { libs, getContext }`（`script.js`） | 无 |
| `SillyTavern.getContext` | 返回 API 聚合对象（`st-context.js`） | 无 |
| `window` / `document` | 扩展与核心共享 | iframe 隔离；主页面 React |
| `jQuery` / `$` | 全局，扩展广泛使用 | 主页面未保证 |

### 5.2 设置持久化

| API | ST 行为 | RAT V0.16 |
| --- | --- | --- |
| `extension_settings` | 可变全局对象，随用户设置 JSON 持久化 | 无；仅有 `featureSettingsJson`（布尔开关） |
| `saveSettingsDebounced` | debounce → `POST /api/settings/save` | 无 |

### 5.3 网络请求

| API | ST 行为 | RAT V0.16 |
| --- | --- | --- |
| `getRequestHeaders` | `{ 'Content-Type', 'X-CSRF-Token': token }` | 无；扩展 CSP `connect-src 'none'` |
| fetch 习惯 | 扩展直接 `fetch('/api/...', { headers: getRequestHeaders() })` | 扩展无法出站（CSP） |

### 5.4 事件系统

| API | ST 行为 | RAT V0.16 |
| --- | --- | --- |
| `eventSource` | `EventEmitter` 单例 | 无 |
| `event_types` | 字符串常量表 | 无 |

### 5.5 Slash Command

| API | ST 行为 | RAT V0.16 |
| --- | --- | --- |
| `registerSlashCommand` | → `SlashCommandParser.addCommand` | 无 |
| `SlashCommand` / `SlashCommandParser` | 声明式命令注册与执行 | 无 |

### 5.6 聊天上下文

| API | ST 行为 | RAT V0.16 |
| --- | --- | --- |
| `chat` | 当前会话消息数组（内存） | 后端 `Conversation`/`ChatMessage`；前端无全局 `chat` |
| `Generate` | 触发完整生成管线 | `/api/chat` 存在；未暴露给扩展 |
| regenerate / continue | 经 `getContext` 多种封装 | 未暴露 |

### 5.7 角色 / Persona / WorldBook

| API | ST 行为 | RAT V0.16 |
| --- | --- | --- |
| `characters` | 内存角色列表 | `/api/characters` |
| `world_names` / `loadWorldInfo` | 世界书内存+文件 | `/api/worldbooks` |
| persona | `power_user` / chat metadata | `/api/user-personas` |

### 5.8 Prompt / Generation Hooks

| API | ST 行为 | RAT V0.16 |
| --- | --- | --- |
| `GENERATE_BEFORE_COMBINE_PROMPTS` 等 | `eventSource` 发射 | 无 |
| `setExtensionPrompt` | 注入 extension prompt 槽 | `promptBuilder` 内部；未挂钩扩展 |
| `runGenerationInterceptors` | `extensions.js` 导出（生成拦截器） | 无 |

---

## 6. 兼容层分级设计

### L0 — install / display

| 维度 | 内容 |
| --- | --- |
| **目标** | 识别 ST 插件；展示 manifest、js/css 候选项；**不执行**插件 |
| **后端** | 已有；可增强 manifest 解析（`loading_order`, `requires`, `minimum_client_version`）仅展示 |
| **前端** | 已有 `compatibilityNote`；可增加「兼容等级：L0」徽章 |
| **安全风险** | 极低 |
| **测试** | 安装 JS-Slash-Runner ZIP；列表显示 external + js/css 项 |
| **V0.17 MVP** | **是**（已 largely 完成） |

### L1 — settings UI

| 维度 | 内容 |
| --- | --- |
| **目标** | 在隔离环境展示插件设置 UI（`settings.html` 或插件 JS 生成的 DOM） |
| **后端** | `GET .../runtime/compat` 返回 bridge shell HTML；加载插件 CSS/JS |
| **前端** | Compatibility iframe host；注入最小 `SillyTavern` stub + `#extensions_settings` |
| **安全风险** | 中：插件 JS 在 iframe 内执行，但仍隔离于主页面 |
| **测试** | 酒馆助手设置面板是否渲染（不要求全功能） |
| **V0.17 MVP** | **是**（核心目标） |

### L2 — extension_settings persistence

| 维度 | 内容 |
| --- | --- |
| **目标** | 内存 `extension_settings` proxy + `saveSettingsDebounced` shim + 持久化 |
| **后端** | 新增 `extensionSettingsJson` 或复用字段；`GET/PATCH /api/extensions/:id/settings` |
| **前端** | iframe 内 `extension_settings[pluginId]` 与宿主同步 |
| **安全风险** | 中：仅存储插件声明命名空间内的 JSON |
| **测试** | 修改助手设置 → 刷新 → 值保留 |
| **V0.17 MVP** | **是** |

### L3 — event bus / slash command

| 维度 | 内容 |
| --- | --- |
| **目标** | fake `eventSource`；slash 注册转发到宿主 |
| **后端** | 可选：slash 执行日志 |
| **前端** | 宿主 `eventBus` 向 compat iframe postMessage；slash registry |
| **安全风险** | 中高：事件可触发插件逻辑链 |
| **测试** | 注册 `/event-emit`；宿主收到自定义事件 |
| **V0.17 MVP** | **否**（设计预留） |

### L4 — chat / character / worldbook read

| 维度 | 内容 |
| --- | --- |
| **目标** | 只读 `getContext` 子集 |
| **后端** | 白名单 DTO API |
| **前端** | `getContext()` 返回 proxy，经 postMessage 向宿主取数 |
| **安全风险** | 高：隐私数据 |
| **测试** | 只读获取当前角色名；拒绝未授权字段 |
| **V0.17 MVP** | **否** |

### L5 — prompt / generation hooks

| 维度 | 内容 |
| --- | --- |
| **目标** | `Generate`、prompt 注入、生成前后 hook |
| **后端** | hook 注册表；审计日志；每插件授权 |
| **前端** | 与聊天管线集成 |
| **安全风险** | 极高：影响 LLM 行为与费用 |
| **测试** | 授权插件 before-generate hook |
| **V0.17 MVP** | **否** |

---

## 7. 四种兼容方案比较

| 方案 | 兼容性 | 安全性 | 实现复杂度 | 对 React 主页面风险 | 对第三方插件改造需求 | 是否推荐 |
| --- | --- | --- | --- | --- | --- | --- |
| **A. 主页面直接注入 external JS** | 最高 | 最低 | 低 | **极高** | 无 | **否** |
| **B. sandbox iframe + postMessage bridge** | 低–中 | 高 | 中 | 低 | 高（多数 ST 插件不可直接运行） | 作为组件 |
| **C. compatibility iframe + fake ST environment** | 中–高 | 中–高 | 高 | 低 | 低–中（热门插件可渐进适配） | **是** |
| **D. 热门插件 adapter** | 中（单插件高） | 高 | 中（每插件） | 低 | 高（需维护 adapter） | 作补充 |

### 7.1 为什么「主页面直接注入 external JS」风险较高

【设计建议】结合 ST 现状与 RAT 技术栈：

| 风险 | 说明 |
| --- | --- |
| 污染 `window` | ST 扩展直接修改 `extension_settings`、`chat` 等全局变量（`extensions.js` 设计） |
| 污染 `document` | `document.body.appendChild(script)` 同级；插件可任意注册 DOM 监听 |
| 污染 React DOM | 无隔离；与 React 虚拟 DOM 冲突，导致重复挂载/事件泄漏 |
| 样式冲突 | `addExtensionStyle` 向 `document.head` 注入全局 CSS |
| 读取敏感数据 | `getContext()` 含完整 `chat`、`characters`、`power_user` |
| 任意网络请求 | `getRequestHeaders()` + `fetch` 可调任意 ST API |
| 难以撤销 | 扩展停用后全局副作用可能残留（事件监听、定时器） |
| 难以审计 | 无边界；插件可动态 `eval` |
| 插件互相影响 | 共享命名空间；后加载扩展可覆盖先加载扩展 |

【源码确认】SillyTavern **故意**采用主页面共享模型以最大化扩展能力；RoleAgent Tavern 使用 React + 自有 API，**不应**复制该模型。

---

## 8. 推荐架构

【设计建议】采用：**方案 C — compatibility iframe + fake SillyTavern environment + postMessage bridge**，并吸收方案 B 的 sandbox 与消息白名单。

```
┌─────────────────────────────────────────────────────────┐
│  RoleAgent Tavern (React 主页面)                          │
│  ExtensionManagerPanel / CompatHost                       │
│    │ postMessage (typed, allowlist)                       │
│    ▼                                                      │
│  ┌───────────────────────────────────────────────────┐  │
│  │ compatibility iframe (sandbox=allow-scripts)         │  │
│  │  • bridge shell HTML (服务端注入)                     │  │
│  │  • fake SillyTavern.getContext()                     │  │
│  │  • fake extension_settings + saveSettingsDebounced   │  │
│  │  • #extensions_settings (供插件挂载)                  │  │
│  │  • 加载插件 manifest.js / css (同源 assets URL)     │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
         ▲ PATCH/GET settings
         ▼
  apps/server  extensionSettingsJson (per InstalledExtension)
```

### 8.1 关键设计点

| 主题 | 设计 |
| --- | --- |
| **fake SillyTavern API** | iframe 内 `globalThis.SillyTavern = { getContext: () => shim }`；shim 仅实现 L1–L2 所需字段，其余 `undefined` 或 no-op |
| **插件 JS 运行位置** | iframe 内 `<script type="module" src="/api/extensions/:id/assets/{manifest.js}">` |
| **sandbox** | 延续 `allow-scripts` only；**不使用** `allow-same-origin` |
| **无 same-origin 的影响** | iframe 与父页面不同源；必须通过 `postMessage` 通信；插件无法直接读父页面 DOM（符合安全目标） |
| **assets 加载** | 沿用现有 `/api/extensions/:id/assets/*`；compat shell 设置 `<base href>` |
| **settings 持久化** | `PATCH /api/extensions/:id/settings` → `extensionSettingsJson` 中 `pluginNamespace` 键 |
| **extension_settings 桥接** | iframe 内 `extension_settings = new Proxy({})`；读写映射到命名空间 |
| **saveSettingsDebounced** | debounce → postMessage → 宿主 PATCH settings |
| **eventSource** | L3+：`emit`/`on` 由宿主代理；V0.17 可返回 stub（`on` 注册但不触发） |
| **slash command** | L3+：iframe 注册 → postMessage → 宿主 `SlashCommandRegistry` |
| **getContext 白名单** | L4+：仅返回 `{ extensionSettings, saveSettingsDebounced, eventSource(stub) }`；**不返回** API key、完整 DB |
| **隐私** | 不注入 `getRequestHeaders`；不暴露 `process.env`；chat/character 需显式权限位 |

---

## 9. V0.17 MVP 建议

【设计建议】**尽可能小**，不追求完整 ST 兼容。

### 9.1 范围

| 包含 | 不包含 |
| --- | --- |
| compatibility iframe + bridge shell | 主页面注入 `dist/index.js` |
| fake `extension_settings` + `saveSettingsDebounced` | 完整 `getContext` |
| per-extension settings API + DB 字段 | `getRequestHeaders` / 任意 authenticated proxy |
| 酒馆助手**设置页基本显示**（L1，尽力而为） | slash command 执行 |
| 兼容等级 UI（L0–L2） | event bus 转发 |
| | prompt / generation hooks |
| | chat/character/worldbook 读写 |

### 9.2 推荐实现顺序

1. **数据结构**：`InstalledExtension.extensionSettingsJson`（或扩展 `featureSettingsJson` 结构文档化）；migration
2. **后端 API**：`GET/PATCH /api/extensions/:id/settings`；`GET /api/extensions/:id/compat`（bridge shell）
3. **前端 runtime**：`ExtensionCompatPanel`；postMessage 协议扩展（settings-save, settings-load）
4. **fake ST environment**：bridge shell 内联 shim 脚本（`SillyTavern`, `extension_settings`, `#extensions_settings`, jQuery 可选）
5. **JS-Slash-Runner smoke**：安装官方 manifest；在 compat iframe 加载；验证设置页签是否部分渲染
6. **测试计划**：单元（settings CRUD）；手动（安装助手 ZIP → 打开 compat → 改设置 → 刷新）
7. **文档**：`docs/devlog.md` 追加 V0.17 条目；更新 AGENTS.md 扩展章节（若需要）

### 9.3 对酒馆助手的现实预期

【设计建议】首期**不保证**酒馆助手全功能可用。助手依赖大量 L3–L5 API（`TavernHelper.generate`, 消息渲染监听等）。MVP 成功标准建议定为：

- compat iframe 内 Vue 应用能挂载；
- 全局设置 store 能读写并持久化；
- 不崩溃、不污染主页面；
- 明确标注「兼容等级 L2；渲染/脚本/生成功能不可用」。

完整助手兼容需多版本迭代至 L4/L5。

---

## 10. 安全边界

V0.17 **不能**做：

| 禁止项 | 原因 |
| --- | --- |
| 主页面直接注入第三方 JS | §7.1 |
| 向插件暴露 API key / CSRF token | `getRequestHeaders` 等价能力 |
| 任意文件系统访问 | 仅 assets API 白名单 |
| 任意数据库访问 | 仅扩展 settings JSON |
| 默认开放 chat/worldbook/persona 全量 | 隐私 |
| 默认 prompt/generation hook | 影响 LLM 与费用 |
| 插件任意 authenticated request | 需显式代理与审计 |
| 绕过 iframe sandbox | 安全基线 |
| 对危险 manifest 自动在主页面执行 | `js` 路径仅 compat 入口可控加载 |

---

## 11. 待确认问题

1. **V0.17 是否仅以 JS-Slash-Runner 为首个兼容样本？**
   建议：是，作为唯一 smoke test 插件；同时保留 generic compat shell。

2. **settings UI：解析 `settings.html` 还是插件 JS 自生成？**
   源码显示酒馆助手为后者；建议 compat shell 提供 `#extensions_settings` + 执行 `manifest.js`，不优先实现通用 `settings.html` 解析。

3. **是否需要插件权限声明？**
   建议：V0.17 在 manifest 增加可选 `permissions: []`；未声明则仅 L0–L2。

4. **`extension_settings` 存储位置？**
   建议：新增 `extensionSettingsJson`（与 `featureSettingsJson` 分离）；`featureSettingsJson` 继续只管 feature 布尔开关。

5. **slash command 何时进入 MVP？**
   建议：V0.18+（L3），V0.17 仅接口设计。

6. **是否显示「兼容等级」与「危险能力声明」？**
   建议：是；Extension Manager 卡片展示 `compatLevel: L0–L5` 与已授权能力列表。

7. **compat iframe 是否允许 `allow-same-origin`？**
   建议：否；保持与 V0.16 runtime 一致。

8. **jQuery 是否由 bridge shell 从 CDN 加载？**
   待确认：安全策略可能要求自托管 jQuery 于 assets；需与 CSP 协调。

---

## 12. 结论

**V0.17 应优先实现 L1 + L2（compatibility iframe 内的 settings UI 与 `extension_settings` 持久化），原因为：**

- L0 已基本具备；
- 酒馆助手与多数 ST 插件的**首要交互面**是设置 UI + `extension_settings`，且可在 iframe 内相对隔离地模拟；
- L3–L5 引入事件、数据与生成钩子，安全与产品复杂度陡增，不适合与桥接基础设施同期交付。

**不要建议一次性完整兼容 SillyTavern。** 应采用分级桥接，以 JS-Slash-Runner 为烟雾测试样本，逐版本提升兼容等级。

---

## 附录 A：RoleAgent Tavern 关键文件索引

| 文件 | 职责 |
| --- | --- |
| `apps/server/src/routes/extensions.ts` | HTTP 路由 |
| `apps/server/src/services/extensionManager.ts` | 安装、manifest、feature DTO |
| `apps/server/src/services/extensionAssets.ts` | assets 安全、CSP、base href |
| `apps/server/src/services/zipArchive.ts` | ZIP 解压 |
| `apps/web/src/components/ExtensionManagerPanel.tsx` | 扩展管理 UI |
| `apps/web/src/components/ExtensionRuntimePanel.tsx` | iframe runtime + postMessage |
| `apps/web/src/components/ExtensionFeatureList.tsx` | 功能项列表 |
| `packages/shared/src/index.ts` | DTO |
| `apps/server/prisma/schema.prisma` | `InstalledExtension` |
| `docs/devlog.md` | V0.15/V0.16 变更记录 |

## 附录 B：SillyTavern 关键文件索引

| 文件 | 职责 |
| --- | --- |
| `public/scripts/extensions.js` | 扩展加载、extension_settings、activate |
| `public/scripts/st-context.js` | `getContext()` |
| `public/scripts/events.js` | eventSource / event_types |
| `public/script.js` | SillyTavern 全局、saveSettings、getRequestHeaders |
| `public/scripts/slash-commands.js` | slash 注册 |
| `src/endpoints/extensions.js` | 安装、discover API |
| `public/index.html` | `#extensions_settings` 挂载点 |

## 附录 C：JS-Slash-Runner 关键文件索引

| 文件 | 职责 |
| --- | --- |
| `manifest.json` | ST 扩展清单 |
| `src/index.ts` | 入口、挂载 `#extensions_settings` |
| `src/Panel.vue` | 五页签 UI |
| `src/store/settings/global.ts` | extension_settings 读写 |
| `src/type/settings.ts` | `setting_field = 'tavern_helper'` |
| `src/function/index.ts` | TavernHelper API |
| `src/iframe/predefine.js` | iframe 内 SillyTavern 代理 |
| `src/slash_command/` | 斜杠命令注册 |
