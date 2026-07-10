# RoleAgent Tavern V0.17 Implementation Plan

> 计划范围：SillyTavern Extension Compatibility Bridge，固定为 L1 + L2。
> 基线：`dev` @ `5559e80`，调研提交 `e0cd639`。
> 本文仅描述后续实现，不在本阶段修改业务代码、SillyTavern 源码或 JS-Slash-Runner 源码。

## 1. MVP 范围

### 1.1 目标

V0.17 在 V0.16 的 Extension Manager、feature toggles、受控 assets API 和 iframe runtime 之上增加一条独立的 SillyTavern compatibility runtime。目标不是复制完整 SillyTavern，而是在不污染 React 主页面的前提下，让外部插件有机会在隔离 iframe 中显示设置 UI，并持久化该插件自己的 JSON 设置。

兼容等级定义如下：

| 等级 | V0.17 含义 | 成功标准 |
| --- | --- | --- |
| L0 | install / display-only | 能安装、识别 manifest、显示 JS/CSS 条目，但不执行第三方脚本 |
| L1 | isolated settings UI | 在 `sandbox="allow-scripts"` 的 compatibility iframe 中加载 bridge shell、插件 CSS/JS，并提供设置页挂载点 |
| L2 | extension settings persistence | 在 L1 基础上提供隔离的 `extension_settings` 与 `saveSettingsDebounced`，设置保存后刷新仍存在 |

RoleAgent 原生扩展继续显示为 `RoleAgent Native`，不强行映射为 L0/L1/L2。L0/L1/L2 是 external/SillyTavern 插件的“当前获准能力上限”，不是完整兼容保证。

### 1.2 MVP 必须交付

- compatibility iframe + fake SillyTavern environment shell；
- fake `extension_settings`；
- `saveSettingsDebounced` shim；
- `GET /api/extensions/:id/settings`；
- `PATCH /api/extensions/:id/settings`；
- `ExtensionRuntimePanel` 支持 RoleAgent native 与 SillyTavern compatibility 两种可运行模式；
- external display-only 继续保留且不回归；
- JS-Slash-Runner / 酒馆助手设置页 smoke test，目标是尽力挂载设置 UI，而不是宣称完整可用；
- Extension Manager 显示 L0/L1/L2、实验性风险、已开放能力与明确缺失能力；
- 文档、手工测试记录和回滚说明。

### 1.3 明确不做

- 不在 React 主页面注入或执行第三方 JS/CSS；
- iframe 不使用 `allow-same-origin`；
- 不实现完整 `SillyTavern.getContext()`；
- 不提供 `getRequestHeaders`、CSRF token、API key 或 authenticated request proxy；
- 不实现可工作的 `eventSource` / `event_types` 事件系统；
- 不注册或执行 slash command；
- 不开放 chat、character、worldbook、persona 的全量读写；
- 不开放 prompt / generation hooks；
- 不给插件任意数据库、文件系统或网络访问；
- 不修改 SillyTavern 和 JS-Slash-Runner 源码。

### 1.4 完成判定

V0.17 完成必须同时满足：

1. V0.16 RoleAgent native runtime 与 external display-only 行为不回归；
2. eligible external 插件只能在隔离 iframe 内执行；
3. L2 设置只能写入当前 InstalledExtension 的专用 JSON 字段；
4. 修改一个无副作用的兼容设置后，关闭/刷新/重新打开仍能读回；
5. 酒馆助手至少得到可复现的 smoke 结果；若无法完整挂载，必须明确记录卡点并保持 L0/L1/L2 基础设施可独立验收。

## 2. 数据结构方案

### 2.1 方案比较

| 方案 | 优点 | 问题 | 结论 |
| --- | --- | --- | --- |
| 复用 `InstalledExtension.featureSettingsJson` | 无 migration；字段已存在 | feature toggle 与插件任意设置混在一起；大小、校验、生命周期不同；容易被 PATCH 整体覆盖 | 不采用 |
| 新增 `InstalledExtension.compatSettingsJson` | 与 feature toggle 隔离；每个安装扩展天然独立；GET/PATCH 与删除级联简单；改动最小 | 单行 JSON 不适合历史版本、跨用户配置或细粒度查询 | V0.17 推荐 |
| 新增独立 `ExtensionSettings` 表 | 可支持 revision、profile、审计和分片 | V0.17 只有单用户、单扩展 blob；增加关系、迁移和并发复杂度 | 延后到需要多 profile/历史时 |

推荐在 `InstalledExtension` 增加：

```prisma
compatSettingsJson String @default("{}")
```

使用新的 migration，例如 `20260710xxxxxx_add_extension_compat_settings_v017`。现有记录默认 `{}`，卸载扩展时随 `InstalledExtension` 记录一起删除；禁用扩展不清空设置。

### 2.2 存储形态

数据库字段只存 JSON object，不存 envelope：

```json
{
  "tavern_helper": {
    "active_tab": "render"
  }
}
```

API envelope 中再携带 extension id 和更新时间，避免把服务器元数据暴露成 `extension_settings` 的可写键：

```ts
type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
type ExtensionSettings = { [key: string]: JsonValue };

interface ExtensionSettingsResponse {
  extensionId: string;
  settings: ExtensionSettings;
  updatedAt: string;
}

interface UpdateExtensionSettingsRequest {
  settings: ExtensionSettings;
}
```

V0.17 的 PATCH 是“替换当前扩展的完整 settings document”，不是 JSON Merge Patch。这样与 SillyTavern 的 `saveSettingsDebounced()` 保存内存快照一致，也避免部分补丁产生数组合并歧义。

### 2.3 隔离原则

- 每个 `InstalledExtension` 只有自己的 `compatSettingsJson`；插件 A 永远不能提交插件 B 的 id 或设置；
- iframe 中可见的 `extension_settings` 是该行 JSON 的克隆，不是 RoleAgent 用户设置、数据库快照或其他插件设置；
- `featureSettingsJson` 继续只保存 `{ features: { [featureId]: { enabled } } }`；
- JSON 解析失败视为服务器数据异常，记录日志并返回 500，不静默覆盖成 `{}`；
- V0.17 不做 revision history；同一扩展只允许一个活动 compatibility panel，降低 last-write-wins 冲突。

## 3. 后端 API 设计

### 3.1 GET `/api/extensions/:id/settings`

用途：由 React host 在打开 compatibility runtime 前读取设置。iframe 不直接 fetch 该 API。

成功响应：

```json
{
  "extensionId": "tavern-helper",
  "settings": {
    "tavern_helper": {}
  },
  "updatedAt": "2026-07-10T12:00:00.000Z"
}
```

规则：

- id 必须对应已安装扩展；
- GET 可读取已禁用扩展的现有设置，便于管理和诊断，但前端不得为禁用扩展打开 runtime；
- 仅返回该扩展的 `compatSettingsJson`；
- 响应使用 `Cache-Control: no-store`。

### 3.2 PATCH `/api/extensions/:id/settings`

请求：

```json
{
  "settings": {
    "tavern_helper": {
      "active_tab": "script"
    }
  }
}
```

成功返回更新后的 `ExtensionSettingsResponse`。规则：

- body 必须是 plain object，且唯一顶层字段为 `settings`；
- `settings` 必须是 JSON object，不接受数组、字符串或 null 作为顶层值；
- extension 必须存在、已启用，并且是允许 compatibility runtime 的 external extension；
- 以 UTF-8 重新序列化后的 `settings` 最大 256 KiB；route body limit 建议 300 KiB；
- 最大嵌套深度 32、总节点数 10,000、单字符串最大 64 KiB、单 key 最大 256 个 Unicode code point；
- number 必须有限，拒绝 `NaN` / `Infinity`；
- 递归拒绝 `__proto__`、`prototype`、`constructor` 键，避免 prototype pollution；
- 保存前对 DTO 做深拷贝/规范化，不保存 class instance 或非 JSON 值；
- 更新后依赖 Prisma `updatedAt` 返回新的时间戳。

### 3.3 HTTP 状态与错误

沿用现有 `{ "error": "..." }` 响应形态，不在 V0.17 扩大整个 API 的错误协议。

| HTTP | 条件 |
| --- | --- |
| 400 | body 不是 object、字段不合法、settings 不是 object、深度/节点/key/value 校验失败 |
| 403 | PATCH 时扩展已禁用；runtime 请求未获准 |
| 404 | extension id 不存在 |
| 409 | 扩展不是 compatibility runtime 候选，或活动状态与请求冲突 |
| 413 | 请求体或序列化后的 settings 超过大小限制 |
| 500 | 数据库中的 JSON 已损坏或发生未预期错误；日志不得打印完整 settings |

### 3.4 服务层和路由落点

- shared：新增 settings DTO、`ExtensionCompatibilityLevel = 'L0' | 'L1' | 'L2'`；
- `extensionManager.ts`：新增严格 parse/validate、`getExtensionSettings()`、`updateExtensionSettings()`，复用现有 `ExtensionManagerError`；
- `extensions.ts`：新增 GET/PATCH，继续通过 `sendExtensionError()` 统一输出；
- Prisma：新增字段和 migration；
- API 不接受 `extensionId` 出现在 body 中，目标 id 只能来自 path。

## 4. 前端 Runtime 设计

### 4.1 三种运行形态

| 形态 | 判定 | UI 行为 |
| --- | --- | --- |
| RoleAgent native runtime | `compatibility === 'roleagent'` 且现有 feature 可运行 | 保持 V0.16 的 `feature.runtimeUrl`、ready/toast 协议和 Run 按钮 |
| external display-only | external 且只有 L0，或兼容 runtime 被关闭/失败回退 | 不执行 JS；显示 manifest 条目、L0 徽章和风险/限制说明 |
| SillyTavern compatibility runtime | external、扩展已启用、manifest 有安全本地 JS entry，且最大能力为 L1/L2 | host 先 GET settings，再打开 compatibility iframe 并握手 |

前端活动状态从 `{ extensionId, featureId }` 扩展为显式 discriminated union：

```ts
type ActiveExtensionRuntime =
  | { mode: 'native'; extensionId: string; featureId: string }
  | { mode: 'sillytavern-compat'; extensionId: string };
```

不要把 external script feature 改成普通 V0.16 runnable feature；compatibility runtime 是独立入口，避免 display-only 保护被意外绕过。

### 4.2 iframe src 与 sandbox

推荐新增独立路由：

```text
GET /api/extensions/:id/compat-runtime
```

它返回服务器生成的 bridge shell HTML，不直接返回插件 JS。这样不会与现有 `/runtime/:featureId` 的动态参数冲突，也能在加载插件前建立安全环境。

iframe 固定使用：

```tsx
<iframe
  sandbox="allow-scripts"
  referrerPolicy="no-referrer"
  src={compatRuntimeUrl}
/>
```

不得增加 `allow-same-origin`、`allow-forms`、`allow-popups`、`allow-downloads` 或 `allow-top-navigation`。

### 4.3 postMessage 协议

由于 sandbox iframe 是 opaque origin，host 发送消息需要 `targetOrigin: '*'`。安全边界依靠 `event.source === iframe.contentWindow`、随机 session id、protocol version、消息类型白名单和严格 DTO 校验，而不是信任 `event.origin`。

host → iframe：

| type | 字段 | 用途 |
| --- | --- | --- |
| `roleagent:compat:init` | `protocolVersion`, `sessionId`, `extensionId`, `settings` | 初始化安全上下文；只能处理一次 |
| `roleagent:compat:save-result` | `sessionId`, `requestId`, `ok`, 可选 `error`, `updatedAt` | 返回 PATCH 结果 |
| `roleagent:compat:shutdown` | `sessionId` | 关闭时停止 debounce/timer，并拒绝后续保存 |

iframe → host：

| type | 字段 | 用途 |
| --- | --- | --- |
| `roleagent:compat:shell-ready` | `protocolVersion`, `sessionId` | shell 已安装消息监听器 |
| `roleagent:compat:runtime-ready` | `sessionId`, `level` | 插件入口已加载；不表示所有功能可用 |
| `roleagent:compat:save-settings` | `sessionId`, `requestId`, `settings` | host 校验后调用 PATCH |
| `roleagent:compat:status` | `sessionId`, `status`, 可选短消息 | 上报 degraded/error，不传堆栈和敏感对象 |
| `roleagent:compat:log` | `sessionId`, `level`, `message` | 限长、限速的 console/error 转发 |

协议约束：

- 原生 runtime 现有 4096 字节消息上限不变；compat settings 消息单独允许到 300 KiB；
- host 每次打开生成 128-bit 随机 session id，关闭后立即失效；
- 同一 iframe 同时最多一个 settings PATCH；新的 debounce 快照可覆盖排队中尚未发送的旧快照；
- log/status 单条最多 2 KiB，每 10 秒最多 20 条，超过后丢弃并显示一次限流提示；
- host 与 iframe 都拒绝未知 type、多余字段、错误 protocolVersion、错误 sessionId 和不可序列化数据。

### 4.4 状态展示

Runtime panel 显示：`loading-settings`、`starting-shell`、`loading-plugin`、`ready`、`saving`、`saved`、`degraded`、`error`。关闭时先发 shutdown，再将 iframe `src` 设为 `about:blank`。错误文案要区分“桥接环境失败”“插件入口加载失败”“未开放能力被调用”“设置保存失败”。

## 5. Fake SillyTavern Environment 设计

### 5.1 shell 加载顺序

1. 输出最小 HTML、`#extensions_settings`、`#extensions_settings2` 和状态区域；
2. 安装 message/error/console bridge；
3. 等待并验证一次 `roleagent:compat:init`；
4. 原地填充稳定引用的 `extension_settings` object；
5. 安装 `saveSettingsDebounced`、`SillyTavern.getContext()` 和 `roleagent` bridge；
6. 若已批准并自托管 jQuery，则先加载 jQuery；
7. 加载 manifest CSS；
8. 通过受控 module loader 加载 manifest JS；
9. 成功后发送 runtime-ready；任何阶段失败都发送 degraded/error，但不放宽 sandbox/CSP。

插件 module 必须在 init 完成后才加载，避免 store 在 settings 到达前把默认值覆盖回数据库。

### 5.2 `extension_settings`

- 使用无 prototype 的 plain object 作为根对象，并保持引用稳定；
- init 时递归拷贝服务器已验证的 JSON；
- 暴露 `window.extension_settings` 和 context 中的 `extensionSettings`，两者引用同一对象；
- 保存时 `structuredClone` 后 postMessage，不把 Proxy、DOM、函数或循环引用发给 host；
- V0.17 保存整个对象，但服务器仍只落到当前 InstalledExtension 的行；
- 不自动注入 chat、character、preset 或全局 RoleAgent 设置。

### 5.3 `saveSettingsDebounced`

- 建议 500 ms trailing debounce；
- 连续修改只提交最后一个完整快照；
- 保存中再次变化时保留一个最新待发送快照；
- PATCH 失败不丢弃内存值，panel 显示“未保存”，允许下一次修改或手动重试；
- shutdown 时取消未开始的 timer，不在 iframe 关闭后继续写入；
- 函数不接受 URL、headers 或任意 fetch 参数。

### 5.4 `window.SillyTavern` 与最小 `getContext`

```ts
window.SillyTavern = Object.freeze({
  getContext: () => Object.freeze({
    extensionSettings: window.extension_settings,
    saveSettingsDebounced: window.saveSettingsDebounced,
  }),
});
```

这是能力引用容器，不是 SillyTavern 上下文快照。不得加入 API key、chat、characters、worldbooks、persona、generation、prompt hooks、request headers、event bus 或 slash registry。未知字段保持 `undefined`；对于 module-link 必须存在但未获准的函数，使用带明确错误码的 deny stub，而不是伪造成功结果。

### 5.5 jQuery / `$`

酒馆助手入口使用 `$(() => ...)`、`$('<div>')` 和 `.appendTo('#extensions_settings')`，因此实际 smoke 需要 jQuery。

方案约束：

- 禁止 CDN；`connect-src 'none'` 保持不变；
- 不临时从 SillyTavern 安装目录读取运行时资源；产物必须随 RoleAgent 构建稳定提供；
- 推荐使用经明确批准、固定版本、保留许可证的自托管 jQuery 资产；这一步属于新增第三方依赖/资产，实施前必须单独获得批准；
- 未获批准时 shell 不伪装完整 jQuery，酒馆助手 smoke 标记为 degraded，通用 L1/L2 bridge 仍可用内部 fixture 验收。

### 5.6 静态 ESM imports 与受限 module-link shim

当前酒馆助手 `dist/index.js` 在模块首行静态导入 `script.js`、`scripts/extensions.js`、world-info、slash command、openai 等大量 SillyTavern 模块。只设置 `window.SillyTavern` 无法让浏览器完成 ESM link。

V0.17 允许实现一个仅用于“模块链接成功”的受限 shim 层：

- shell import map 只映射已审计的 SillyTavern module specifier 到 RoleAgent 自己的 compat shim modules；
- shim 只导出插件在模块链接阶段要求的静态名称；
- `extension_settings` 和 `saveSettingsDebounced` 指向真实 L2 shim；
- jQuery 由独立自托管脚本提供；
- 其他导出使用 inert value 或 deny function，并在调用时报告 `unsupported-capability`；
- 不把 inert placeholder 描述成 eventSource/event_types、slash、chat 或 generation 的实现，也不向 host 转发这些行为；
- 映射清单必须固定在代码中，不能由 manifest 自由指定 host module URL。

若为了让酒馆助手初始化而必须实现 L3-L5 语义，应停止扩展 shim，并把结果记录为 smoke limitation，而不是扩大 V0.17 范围。

### 5.7 `roleagent` bridge 与错误转发

iframe 只获得冻结的窄接口：protocol version、extension id、status/log 上报和 settings save。不得提供通用 `request()` 或任意 API path。

shell 捕获 `error`、`unhandledrejection` 和加载失败，转为限长纯文本；不转发 settings、对象 dump、完整 URL query、cookie 或 stack。host 只将文本渲染到 React 文本节点，不使用 `innerHTML`。

## 6. JS-Slash-Runner Smoke 方案

### 6.1 加载事实

- manifest JS：`dist/index.js`，ES module；
- manifest CSS：`dist/index.css`；
- 入口等待 jQuery DOM ready；
- 入口创建 `<div id="tavern_helper">` 并 append 到 `#extensions_settings`；
- Vue 3 + Pinia 应用随后挂载到该 div；
- 设置源为 `extension_settings.tavern_helper`，watch 后调用 `saveSettingsDebounced()`；
- 不是通过通用 `settings.html` 加载。

### 6.2 五个 tab 的预期

| tab | L1/L2 smoke 目标 | 明确缺失 |
| --- | --- | --- |
| 渲染 `render` | tab 和纯设置控件尽力渲染；无副作用开关可保存 | 消息 DOM、chat、渲染事件、stream 事件不工作 |
| 脚本 `script` | tab/列表外壳尽力渲染；纯全局设置可保存 | 脚本执行、按钮事件、slash、preset/chat 绑定不工作 |
| 工具 `toolbox` | tab 外壳和静态说明尽力渲染 | prompt viewer、变量、worldbook、character/chat 操作不工作 |
| 优化 `optimize` | 纯设置开关尽力渲染并持久化 | 依赖主页面 DOM、eventSource、preset/worldbook 的优化不生效 |
| 开发 `developer` | 静态文档/设置 UI 尽力渲染 | 代码执行、下载、host API、generation 调试不开放 |

“五个 tab 可见”不等于“五个 tab 功能可用”。UI 必须在 panel 顶部持续显示 L2 experimental 和缺失能力列表。

### 6.3 Smoke 步骤

1. 使用未修改的 JS-Slash-Runner ZIP 安装；
2. 确认 L0 时只显示 external JS/CSS，不执行；
3. 启用扩展并点击“实验性兼容模式”；
4. 检查 shell、jQuery、自托管 CSS、import map、module-link shim 的加载顺序；
5. 检查 `#tavern_helper` 和五个 tab；
6. 切换 tab，记录首个 unsupported capability 和是否可继续使用 UI；
7. 修改一个不依赖 chat/generation 的全局设置；
8. 等待 saved，关闭并重新打开，再执行浏览器刷新，确认值仍存在；
9. 点击一个超出范围的功能，确认 graceful degrade，不产生 authenticated request、不污染主页面；
10. 保存 console、network、status 截图/记录到 V0.17 smoke 文档。

### 6.4 Graceful degrade

- module link 失败：panel 显示具体缺失 module/export，终止插件入口，不改 CSP；
- jQuery 缺失：在加载插件前报 `jquery-unavailable`，不注入不完整 `$`；
- unsupported capability 被调用：deny stub 报告能力名，阻止行为；能继续渲染的部分保持可见；
- 插件抛错：停止重复日志，保留关闭按钮和风险说明；
- settings 保存失败：保留内存值并标记未保存，不把失败值写到其他配置；
- 酒馆助手不能完整挂载：保持 generic L1/L2 bridge，用最小内部 fixture 验收设置持久化；酒馆助手卡片回退 L0/display-only，并记录限制，不实现 L3-L5 补洞。

## 7. 安全设计

### 7.1 执行隔离

- 第三方 JS/CSS 永远不注入 React 主 document；
- iframe 固定 `sandbox="allow-scripts"`，无 `allow-same-origin`；
- compatibility shell 与 native runtime 使用不同入口和协议；
- 关闭/禁用/删除扩展时立即 blank iframe 并废弃 session id；
- 一个 panel 同时只运行一个 external extension，避免插件间共享全局状态。

### 7.2 CSP 与 assets

- 延续 assets 路径遍历、绝对路径、scheme、symlink、文件类型和 25 MB 单文件限制；
- plugin entry 必须是 manifest 中声明且通过安全相对路径校验的本地 `.js`；CSS 同理；
- shell CSP 至少保持 `default-src 'none'`、`connect-src 'none'`，并补充 `object-src 'none'`、`form-action 'none'`；
- script/style/img/font 只允许现有受控 self/data/blob 子集；不为了单个插件开放远程域名；
- import map 只能指向 RoleAgent 固定 shim URL，不接受 manifest 提供的 host module mapping；
- 继续返回 `X-Content-Type-Options: nosniff` 和 `Cache-Control: no-store`。

### 7.3 postMessage

- host 校验 source、session、version、type、字段集合、大小、深度和速率；
- iframe 只接收 `event.source === parent` 且 session 正确的消息；
- 不接受插件指定 API URL、method、headers 或 extension id；
- settings save 由 host 构造固定 PATCH URL；
- 所有 UI 输出均为纯文本；
- 关闭后丢弃迟到的 save/log/status。

### 7.4 settings 与权限提示

- 256 KiB、深度、节点数、key/value 限制在 iframe 和服务器两端都检查，以服务器为准；
- 日志只记录 extension id、状态、字节数和错误类别，不记录完整 settings；
- 卡片明确显示已开放：`isolated script`、`extension settings read/write`；
- 明确显示未开放：network/auth、events、slash、chat/character/worldbook/persona、prompt/generation；
- L2 徽章必须配“实验性、非完整 SillyTavern 兼容”文案；
- 用户必须先启用扩展并主动点击兼容模式，不能安装后自动运行。

## 8. 实施步骤

仓库当前无 ESLint/Prettier 和测试 runner，因此每个 commit 使用已存在的 typecheck/build 脚本，并补充定向 API/手工验证。不得 invent `pnpm test`。

### Commit 1：shared DTO + server settings API

预计文件：

- `packages/shared/src/index.ts`
- `apps/server/prisma/schema.prisma`
- `apps/server/prisma/migrations/20260710xxxxxx_add_extension_compat_settings_v017/migration.sql`
- `apps/server/src/services/extensionManager.ts`
- `apps/server/src/routes/extensions.ts`

内容：新增 settings DTO、compat level 类型、`compatSettingsJson`、GET/PATCH、递归 JSON 校验和错误处理。先不执行插件。

测试命令：

```powershell
git diff --check
pnpm typecheck
pnpm build
```

人工验证：空设置 GET；合法 PATCH 后 GET；未知 id 404；disabled PATCH 403；非法顶层/危险 key 400；超 256 KiB 413；确认 `featureSettingsJson` 未变化。

### Commit 2：compat runtime HTML / fake ST environment shell

预计文件：

- `apps/server/src/services/extensionCompatRuntime.ts`（新增）
- `apps/server/src/services/extensionAssets.ts`
- `apps/server/src/services/extensionManager.ts`
- `apps/server/src/routes/extensions.ts`
- `packages/shared/src/index.ts`（如 runtime DTO 在 Commit 1 未完全定义）

内容：新增 `/compat-runtime`、shell HTML、manifest entry/CSS 校验、CSP、L2 globals、deny bridge 和固定 protocol。不得加载 remote asset。

测试命令：

```powershell
git diff --check
pnpm typecheck
pnpm build
```

人工验证：disabled/non-external/unsafe path 被拒绝；响应 CSP 正确；shell 中存在挂载点；sandbox 下无法读 parent DOM；内部最小 fixture 能触发 init/ready/save。

### Commit 3：frontend runtime panel compatibility mode

预计文件：

- `apps/web/src/api.ts`
- `apps/web/src/components/ExtensionManagerPanel.tsx`
- `apps/web/src/components/ExtensionRuntimePanel.tsx`
- `apps/web/src/App.css`

内容：active runtime discriminated union、settings GET/PATCH host、session handshake、compat message allowlist、状态/保存/关闭 UI；保留 native 协议原路径。

测试命令：

```powershell
git diff --check
pnpm typecheck
pnpm build
```

人工验证：native Run 行为不变；L0 无运行按钮；compat 启动/保存/关闭；伪造 window message、错误 session、超大 message 均被忽略。

### Commit 4：Extension Manager compatibility badges / risk copy

预计文件：

- `packages/shared/src/index.ts`
- `apps/server/src/services/extensionManager.ts`
- `apps/web/src/components/ExtensionManagerPanel.tsx`
- `apps/web/src/components/ExtensionFeatureList.tsx`（仅在功能项提示需要时）
- `apps/web/src/App.css`

内容：计算/展示 Native、L0、L1、L2，显示最大获准能力、实验性风险、缺失能力和 L0 fallback；不把 level 当成完整兼容承诺。

测试命令：

```powershell
git diff --check
pnpm typecheck
pnpm build
```

人工验证：RoleAgent/native、普通 external、ST-style external 三类卡片文案和按钮正确；禁用扩展不能启动 compat。

### Commit 5：JS-Slash-Runner smoke adjustments（如需要）

预计文件：

- `apps/server/src/services/extensionCompatRuntime.ts`
- `apps/server/src/services/extensionCompatModules.ts`（需要静态 ESM link shim 时新增）
- `apps/server/src/routes/extensions.ts`
- `apps/web/src/components/ExtensionRuntimePanel.tsx`（仅补充可诊断状态）
- 经批准的自托管 jQuery 文件与许可证（条件项；未批准则不加入）

内容：仅补足 L1/L2 加载所需的固定 import map、静态导出 deny/inert shim、jQuery 前置检查和诊断。不修改 JS-Slash-Runner，不实现 L3-L5。

测试命令：

```powershell
git diff --check
pnpm typecheck
pnpm build
pnpm build:desktop
```

人工验证：按 §6 完成五 tab smoke、一次无副作用设置保存与刷新；记录所有 degraded 项；Network 中无 remote/authenticated request。

### Commit 6：docs/devlog update

预计文件：

- `docs/devlog.md`
- `docs/sillytavern-extension-bridge-v017-smoke.md`（新增，记录环境、版本、五 tab 结果和限制）
- `README.md`（仅在已有 Extension Manager 使用说明需要同步时）

内容：记录真实实现、测试结果、未实现能力、安全边界和回滚方法，不把部分渲染写成完整兼容。

测试命令：

```powershell
git diff --check
pnpm typecheck
pnpm build
pnpm build:desktop
```

人工验证：文档中的 endpoint、字段、level、命令与代码一致；截图/日志不含设置内容、路径隐私或凭证。

## 9. 测试计划

### 9.1 自动/构建检查

最终分支必须执行：

```powershell
git diff --check
pnpm typecheck
pnpm build
pnpm build:desktop
```

当前没有 test runner；V0.17 不以此为理由发明 `pnpm test`。若实现期间仓库正式加入测试脚本，再把 settings validator、route 和 message validator 纳入自动测试。

### 9.2 API 矩阵

- GET `{}` 默认值与正确 `updatedAt`；
- PATCH 后 GET 完整相等；
- object/array/string/null 顶层边界；
- 深度 32/33、节点 10,000/10,001、256 KiB 边界；
- `__proto__` / `prototype` / `constructor` 任意层级拒绝；
- 404、403、409、413、损坏存储 500；
- 保存 compat settings 不改变 feature toggles；
- disable/re-enable 保留设置；delete 后 settings endpoint 404。

### 9.3 Extension Manager 手测

- 安装并查看 RoleAgent native、普通 external、ST-style external；
- Native/ L0/L1/L2 badge 与风险文案正确；
- disabled extension 不能进入 compatibility mode；
- 开启/关闭 panel 不残留 iframe、listener、timer；
- compatibility error 不影响 Extension Manager 继续操作其他扩展。

### 9.4 回归手测

- 普通 RoleAgent native runtime：原有 feature toggle、runtime URL、ready、toast、关闭行为不回归；
- external/ST display-only：未主动进入 compat 时仍不执行 JS/CSS；
- assets：路径遍历、远程 scheme、symlink、非白名单扩展名继续拒绝；
- 主页面：第三方 CSS 不影响 React，第三方 JS 不能访问 parent DOM；
- desktop build 启动后 endpoint 与 Web 开发模式一致。

### 9.5 JS-Slash-Runner settings smoke

- 使用未修改的目标版本 ZIP；
- 记录 manifest 版本、jQuery 方案、module shim 清单；
- 检查五 tab 的“可见 / 部分可用 / 阻断”状态；
- 修改一个无 chat/generation 副作用的全局设置；
- 等待 panel 显示 saved；
- 关闭并重新打开确认值存在；
- 完整刷新 RoleAgent 后再次确认；
- 验证 GET 返回同一值，`compatSettingsJson` 有更新而 `featureSettingsJson` 不变；
- 点击缺失能力时只出现 graceful degrade，不出现 host 数据、远程请求或主页面异常。

### 9.6 postMessage 对抗检查

- 非活动 iframe/source、普通 window、旧 session 发来的消息被拒绝；
- 未知 type、多余字段、循环对象、超大 settings、日志洪泛被拒绝/限流；
- 连续快速修改只保存最后快照；
- 保存途中关闭 panel 不接受迟到响应；
- 插件不能让 host 请求自定义 URL、method 或 headers。

## 10. 风险与回滚

### 10.1 主要风险

| 风险 | 控制 |
| --- | --- |
| 插件静态 imports 远超 L1/L2 | 固定 import map + deny/inert link shim；需要 L3-L5 时停止扩展范围 |
| jQuery 缺失或版本不兼容 | 只用经批准的自托管固定版本；否则明确 degraded |
| 插件误把 placeholder 当完整 ST API | UI 持续显示实验性限制；调用时明确 unsupported，不伪造成功 |
| settings 体积/深度滥用 | 256 KiB、深度、节点、key/value、prototype key 限制 |
| postMessage 冒充/重放 | source + session + version + DTO + 关闭失效 |
| 插件 CSS/JS 污染主页面 | sandbox iframe，无 same-origin，无主页面注入 |
| V0.16 native 回归 | compat 独立 URL/active mode/协议；保留 native 分支和回归手测 |

### 10.2 关闭 compatibility runtime

实现时增加单一 server/frontend kill switch（例如服务器配置 `ROLEAGENT_ST_COMPAT_RUNTIME=false`，默认值和发布说明必须明确）。关闭后：

- server `/compat-runtime` 返回 404 或 403；
- DTO 的 `compatRuntimeUrl` 为 null，最大等级回到 L0；
- 前端隐藏“实验性兼容模式”按钮并关闭活动 iframe；
- settings GET 可以保留用于诊断，PATCH 可随 runtime 一起拒绝；
- 不删除 `compatSettingsJson`，避免重新开启后用户设置丢失。

### 10.3 回退到 display-only

单个插件发生错误时，只将该插件标为 L0/degraded，不修改 manifest，不删除安装文件，不清空设置。V0.16 的 external synthesized features、compatibility note 和不可运行保护继续生效。

### 10.4 避免破坏 V0.16

- 不改变 `/api/extensions/:id/runtime/:featureId` 的 RoleAgent native 判定；
- 不把 `displayOnly` external feature 的 `runnable` 改为 true；
- 新增 compat URL 而不是复用 external script 的 runtime URL；
- 新字段均有默认值，migration 不重写现有 feature settings；
- frontend 使用显式 runtime mode，native postMessage 4096 字节规则不变；
- 回滚代码时可以保留新增数据库列，旧代码会忽略该列。

### 10.5 酒馆助手无法完整渲染时

V0.17 仍保留并验收：隔离 shell、L2 settings API、save debounce、postMessage 安全边界、兼容等级 UI 和内部 fixture。酒馆助手结果如实记录为 partial/blocked，默认回退 L0/display-only。不得为了五个 tab 的表面成功开放 authenticated proxy、event bus、slash、chat/worldbook/persona 或 generation hooks；这些能力只能作为后续 L3-L5 独立版本设计。
