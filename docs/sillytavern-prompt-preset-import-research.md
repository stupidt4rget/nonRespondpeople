# SillyTavern Prompt Preset Import Research

> 调研日期：2026-07-06
> SillyTavern 源码（只读）：`E:\Sillytavern Originalcode\SillyTavern-release`
> RoleAgent Tavern 基准：`PromptSettings` + 服务端 `promptBuilder`（V0.10 已落地）
> 用途：为 V0.11b「对话补全预设导入」提供 clean-room 产品/数据/接口设计依据。
> **本文档不包含 SillyTavern 源码、函数实现或大段原文。**

---

## 1. Scope and clean-room constraints

### 1.1 调研范围

- SillyTavern 中与「预设 / prompt 组装 / 导入导出」相关的行为与数据格式。
- 与 RoleAgent Tavern 当前 `PromptSettings`、`promptBuilder` 的映射关系与差距。
- V0.11b 最小可行实现建议（功能边界、模型、API、UI、校验、测试）。

### 1.2 不在本次范围

- 不实现任何功能代码。
- 不复制 SillyTavern 的 UI 结构、类层次、默认 prompt 文案、identifier 命名表。
- 不研究 Kobold/NovelAI 专用采样预设、Text Completion 本地后端拼接链路的全量细节。
- 不把 ST 的「master formatting bundle」原样作为 RoleAgent 第一版格式。

### 1.3 Clean-room 边界（必须遵守）

| 可以借鉴 | 不可复制 |
|---|---|
| 预设分类型管理的**产品思路**（不同用途分开存） | 具体目录名、apiId 枚举、DOM 选择器约定 |
| JSON 单文件导入导出、文件名推导名称 | `prompts[]` / `prompt_order[]` 完整 schema 与 identifier 集合 |
| 导入后保存并切换、可重命名/删除/恢复默认 | 默认 preset 中的 main/nsfw/jailbreak 原文 |
| 旧字段迁移到结构化 prompt 列表的**思路** | 迁移函数、事件名、具体 legacy 键名处理逻辑 |
| 敏感字段剥离、用户确认后再应用 | ST 的 secrets 文件布局与 CSRF 流程 |
| 按角色绑定预设名称（自动匹配） | `character_id` 100000/100001 等内部约定 |

RoleAgent Tavern 的默认 preset 必须保持**中性、安全**：仅描述角色扮演边界与连续性，不得内置成人内容、jailbreak、绕过安全策略、忽略规则等指令。

---

## 2. Relevant SillyTavern source areas inspected

以下区域用于理解行为，**未写入实现**：

| 区域 | 路径（相对 ST 仓库根） | 关注点 |
|---|---|---|
| 预设 HTTP API | `src/endpoints/presets.js` | 按 apiId 分目录保存/删除/恢复默认 |
| 设置加载 | `src/endpoints/settings.js` | 启动时批量读取各预设目录 JSON |
| 预设管理 UI | `public/scripts/preset-manager.js` | 导入/导出/重命名/删除/恢复、master import |
| Chat Completion 预设体 | `default/content/presets/openai/*.json` | `prompts` + `prompt_order` + 采样/模型字段 |
| Prompt 条目管理 | `public/scripts/PromptManager.js` | prompt 列表、顺序、启用、注入深度、迁移 |
| Chat Completion 组装 | `public/scripts/openai.js` | `preparePromptsForChatCompletion`、`populateChatCompletion` |
| 独立 System Prompt | `public/scripts/sysprompt.js`、`default/content/presets/sysprompt/*.json` | name/content/post_history |
| Instruct 模板 | `public/scripts/instruct-mode.js`、`default/content/presets/instruct/*.json` | 文本补全分隔符与序列 |
| Context 模板 | `public/scripts/power-user.js`、`default/content/presets/context/*.json` | story_string 模板 |
| Reasoning 模板 | `public/scripts/reasoning.js`、`default/content/presets/reasoning/*.json` | 思考块前后缀 |
| TextGen 采样预设 | `default/content/presets/textgen/*.json` | 仅采样参数 |
| 用户目录与迁移 | `src/users.js` | 每用户独立预设目录；instruct→sysprompt 历史迁移 |
| 默认内容清单 | `default/content/index.json` | 出厂预设类型与文件列表 |

RoleAgent Tavern 已读对照：

- `apps/server/src/services/promptBuilder.ts` — 固定顺序的多段 system 消息组装
- `apps/server/prisma/schema.prisma` — `PromptSettings` 单例行
- `apps/server/src/routes/settings.ts` — `GET/PUT/POST reset` prompt 设置
- `apps/web/src/components/PromptSettings.tsx` — 全局表单编辑
- `packages/shared/src/index.ts` — `PromptSettingsDto`

---

## 3. Preset concepts in SillyTavern

SillyTavern **明确区分**多种预设，由统一的 Preset Manager 按 `apiId` 路由，但语义与存储相互独立。

### 3.1 预设类型总览

| 类型 | apiId / 归类 | 解决什么问题 | 是否「对话补全预设」 |
|---|---|---|---|
| **OpenAI / Chat Completion preset** | `openai` | Chat API 消息组装：`prompts` 列表、`prompt_order`、模型名、温度、max_tokens、各类场景 prompt 字符串 | **是（核心）** |
| **Prompt Manager** | 内嵌于 OpenAI preset | 可编辑的 prompt 条目集合（含 marker 占位符）及每角色启用/排序 | **是（核心子系统）** |
| **System Prompt (sysprompt)** | `sysprompt` | 独立系统提示词模板；可选 `post_history`；与 `use_sysprompt` 开关联动 | **部分相关**（单段 system 文本） |
| **Instruct template** | `instruct` | Text Completion：user/assistant/system 序列、stop、wrap、names_behavior | **否**（本地文本格式） |
| **Context template** | `context` | Text Completion：story_string（类模板语法）把角色/WI/场景拼成一段上下文 | **否** |
| **Reasoning template** | `reasoning` | 模型「思考」块的前缀/后缀/分隔符及 UI 解析行为 | **否**（V0.11b 不做） |
| **TextGen / Kobold / Novel preset** | `textgenerationwebui` 等 | 采样参数（temp、top_p、rep_pen…） | **否**（采样层，非 prompt 语义） |
| **Master formatting bundle** | `af_master_import` | 一次导入 instruct + context + sysprompt + textgen + reasoning 等 | **否**（第一版不兼容） |

### 3.2 各类型与用户操作（UI 行为摘要）

- **切换**：各面板有下拉框；切换触发 `change`，加载该预设到内存并 `saveSettings`（全局 settings.json 记录当前选中名）。
- **保存 / 另存为**：「Update」覆盖当前项；「Save as」弹窗输入名称；hint 提示可用角色名绑定预设。
- **导入**：隐藏 file input → 解析 JSON → `savePreset(name, data)` → 写入用户目录 → 加入下拉并选中 → toast 成功。
- **导出**：`getPresetSettings(当前名)` → `JSON.stringify` → 下载 `{name}.json`。
- **删除**：确认后删服务器文件并从下拉移除；若删的是当前项则切到下一项。
- **恢复默认**：对出厂预设可调 `/api/presets/restore` 取默认 JSON，删用户副本后重新保存。
- **重命名**：save 新名 + delete 旧名 + 迁移 extensions 字段（OpenAI preset 有额外刷新逻辑）。
- **Master import/export**：Advanced Formatting 区；自动检测单文件类型或弹出多 section 勾选；导出文件名形如 `ST-formatting-YYYY-MM-DD.json`。

### 3.3 与「对话补全预设」的对应关系

对 RoleAgent Tavern（走 Chat Completions API、服务端 `promptBuilder`）而言：

- **应纳入 V0.11b 研究范围**：从 ST 导入时最多提取「主角色扮演指令」类文本（ST 中对应 OpenAI preset 的 `main` 条目，或 sysprompt 的 `content`）。
- **不应混入第一版**：instruct、context、reasoning、textgen 采样、完整 `prompts`/`prompt_order`、模型/代理/密钥字段、per-character prompt order、in-chat 深度注入、扩展 prompt 槽位。

---

## 4. Import/export formats and fields

### 4.1 文件形态

| 项目 | SillyTavern 行为 |
|---|---|
| 扩展名 | 几乎一律 **`.json`**；textgen 导入时文件名可带 `.settings` 后缀（导入时剥掉） |
| 编码 | UTF-8 文本 |
| 结构 | **JSON 对象**；无 YAML / 纯文本 preset 格式 |
| 版本字段 | **无统一 `version`/`schema` 字段**；靠字段探测与迁移逻辑兼容旧版 |
| 名称 | 对象内 `name`（string）；缺失则用文件名（去扩展名） |

### 4.2 OpenAI / Chat Completion preset（最复杂）

单文件包含两类数据：**LLM 调用参数** + **Prompt Manager 配置**。

**A. 采样与模型（与 prompt 组装弱相关）**

| 字段示例 | 类型 | 必需性 | 说明 |
|---|---|---|---|
| `temperature`, `top_p`, `frequency_penalty`, `presence_penalty`, `top_k` | number | 可选 | 采样 |
| `openai_max_context`, `openai_max_tokens` | number | 可选 | 上下文/输出上限 |
| `openai_model`, `claude_model`, `custom_model`, `custom_url` | string | 可选 | 模型与端点 |
| `reverse_proxy`, `proxy_password` | string | 可选 | **敏感/不应导入** |
| `chat_completion_source` | string | 可选 | 供应商标识 |
| `stream_openai`, `squash_system_messages`, `use_sysprompt` | boolean | 可选 | 行为开关 |

**B. 场景用 prompt 字符串（非 Prompt Manager 条目）**

| 字段 | 类型 | 说明 |
|---|---|---|
| `impersonation_prompt`, `new_chat_prompt`, `continue_nudge_prompt`, `group_nudge_prompt` | string | 特殊生成类型的短 prompt |
| `scenario_format`, `personality_format`, `wi_format` | string | 包装宏 |

**C. Prompt Manager：`prompts` 数组**

每个元素为 object，常见字段：

| 字段 | 类型 | 必需性 | 说明 |
|---|---|---|---|
| `identifier` | string | marker/系统条目必需 | 稳定键，如 main、jailbreak、chatHistory |
| `name` | string | 可选 | 显示名 |
| `role` | string | 可选 | `system` / `user` / `assistant`（无 developer） |
| `content` | string | 非 marker 时常见 | 支持 `{{char}}`、`{{user}}` 等宏 |
| `system_prompt` | boolean | 可选 | 是否属系统 prompt 组 |
| `marker` | boolean | 可选 | true 表示占位符，组装时替换为角色/WI/历史等 |
| `injection_position` | number | 可选 | 0=相对顺序内；1=绝对（插入聊天深度） |
| `injection_depth`, `injection_order` | number | 可选 | 深度注入位置与排序 |
| `injection_trigger` | string[] | 可选 | 按生成类型触发 |
| `forbid_overrides` | boolean | 可选 | 禁止角色卡覆盖 |
| `extension` | boolean | 可选 | 来自扩展 |

已知 marker identifier（占位，无 content）：`worldInfoBefore`、`worldInfoAfter`、`charDescription`、`charPersonality`、`scenario`、`personaDescription`、`dialogueExamples`、`chatHistory`。

已知非 marker 常见 identifier：`main`、`nsfw`、`jailbreak`、`enhanceDefinitions`。

**D. Prompt Manager：`prompt_order` 数组**

按「虚拟角色 id」分组的排序表：

| 字段 | 类型 | 说明 |
|---|---|---|
| `character_id` | number | 全局单聊/群聊等不同默认顺序（如 100000 vs 100001） |
| `order` | array | `{ identifier: string, enabled: boolean }[]` |

顺序决定相对 prompt 的拼接先后；`enabled: false` 的条目跳过（`main` 通常仍保留）。

### 4.3 System Prompt preset（sysprompt）

| 字段 | 类型 | 必需 | 说明 |
|---|---|---|---|
| `name` | string | 是 | 预设名 |
| `content` | string | 是 | 主 system 文本 |
| `post_history` | string | 否 | 历史后附加 system 文本（类似 ST 的 PHI 概念） |

导入校验：`name` + `content` 同时存在即识别为 sysprompt。

### 4.4 Instruct template

| 字段 | 类型 | 必需 | 说明 |
|---|---|---|---|
| `name` | string | 是 | |
| `input_sequence`, `output_sequence` | string | 是（用于类型检测） | user/assistant 包裹序列 |
| `system_sequence`, `stop_sequence`, `*_suffix` | string | 否 | |
| `wrap`, `macro`, `names_behavior` | boolean/string | 否 | |
| `system_prompt` | string | 否（已废弃） | 旧版内嵌；导入时会提示迁移到 sysprompt |

### 4.5 Context template

| 字段 | 类型 | 必需 | 说明 |
|---|---|---|---|
| `name` | string | 是 | |
| `story_string` | string | 是 | 类 Handlebars 的条件块模板 |
| `example_separator`, `chat_start` | string | 否 | |
| `story_string_position`, `story_string_depth`, `story_string_role` | number | 否 | 插入位置 |

### 4.6 Reasoning template

| 字段 | 类型 | 必需 | 说明 |
|---|---|---|---|
| `name`, `prefix`, `suffix`, `separator` | string | 是 | 思考块格式 |

### 4.7 TextGen 采样 preset

| 字段 | 类型 | 必需 | 说明 |
|---|---|---|---|
| `temp`, `top_k`, `top_p`, `rep_pen` | number | 是（用于类型检测） | 无 prompt 文本 |

### 4.8 Master bundle 格式

顶层 object，键为 section 名：

| 键 | 含义 |
|---|---|
| `instruct` | Instruct template object |
| `context` | Context template object |
| `sysprompt` | System prompt object |
| `preset` | TextGen 采样 object |
| `reasoning` | Reasoning object |
| `srw` | Start Reply With：`{ value: string, show: boolean }` |

导入时对各 section 做 `isValid` 探测，弹出勾选框让用户选择要应用的 section。

### 4.9 旧格式兼容（ST 侧）

- OpenAI preset：曾用扁平字段 `main_prompt`、`nsfw_prompt`、`jailbreak_prompt`；加载时迁移进 `prompts[]` 对应 identifier 后删除旧键。
- Instruct：`separator_sequence` → `output_suffix`；`names`/`names_force_groups` → `names_behavior`。
- Instruct 内嵌 `system_prompt` → 迁移到独立 sysprompt 文件（用户确认）。
- 用户目录级：批量把 instruct 目录中含 `system_prompt` 的旧文件迁到 sysprompt 目录。

**RoleAgent 第一版不需要实现上述迁移**；仅需识别常见现代 JSON 形状并在无法识别时明确报错。

---

## 5. Prompt assembly behavior

### 5.1 总体数据流（Chat Completion 路径）

```
角色卡 + WI 扫描 + 历史 + 用户输入
        ↓
preparePromptsForChatCompletion（填充 marker 条目的 content）
        ↓
PromptCollection（合并 preset 中 prompts + prompt_order 启用状态）
        ↓
populateChatCompletion（按顺序插入 MessageCollection，预留 token）
        ↓
populationInjectionPrompts（绝对深度注入）
        ↓
ChatCompletion 预算裁剪 → 发往 API
```

RoleAgent Tavern 当前在**服务端**用固定管线完成类似语义，但**没有**可配置的 prompt 列表与 per-character order。

### 5.2 Prompt 列表与顺序

- **`prompts`**：定义「有哪些槽位」及静态文本。
- **`prompt_order`**：定义「哪些启用、相对顺序」；可按虚拟 `character_id` 区分单聊/群聊默认顺序。
- **Marker**：不直接输出 content，组装阶段注入 WI、描述、人格、场景、persona、示例对话、聊天历史。
- **非 marker**：直接作为一条 message（经宏替换）。

### 5.3 Role 表示

- 使用 OpenAI 风格字符串：`system`、`user`、`assistant`。
- `bias` 等特殊条目可为 `assistant`。
- ST 未使用 `developer` role。

### 5.4 影响顺序与是否启用的字段

| 机制 | 影响 |
|---|---|
| `prompt_order[].order` 数组顺序 | 相对 prompt 的主顺序 |
| `prompt_order[].enabled` | 跳过该 identifier（main 例外逻辑需注意） |
| `populateChatCompletion` 内硬编码批次 | 部分块（如 worldInfoBefore → main → …）有固定先后 |
| `injection_position === ABSOLUTE` | 脱离相对顺序，按 depth/order 插入历史 |
| `pin_examples` | 示例对话与历史的先后 |
| `authorsNote` / 扩展 `position` | 相对 main 的前/后插入 |
| `worldInfoBefore` / `worldInfoAfter` marker | WI 在 main 前或后的语义位置 |

### 5.5 Token 预算与世界书

- Chat Completion 使用 token 计数器类做 dry-run 与裁剪；历史常从新到旧填充。
- WI 分 before/after 两路注入，由 marker 位置决定；与 RoleAgent 当前「激活条目合并为一条 system」不同。
- `openai_max_context` / `openai_max_tokens` 在 preset 层配置，与 prompt 条目协同。

### 5.6 对 RoleAgent `promptBuilder` 的启发

当前 `promptBuilder` 固定顺序（摘要）：

1. `roleplayPreset`（全局 base instruction）
2. user persona
3. character `systemPrompt`（支持 `{{original}}` 引用 base）
4. description → personality → scenario
5. worldbook block（关键词激活 + 字符预算）
6. examples → history → authorsNote → postHistory → role boundary reminder → user message

**可借鉴但不急于 V0.11b 实现的想法：**

- 将「主指令」与「历史后指令」拆成可导入的两段（映射 ST `main` 与 `jailbreak`/sysprompt `post_history` 的**概念**，不复制 identifier）。
- 未来支持「启用/禁用」各 character 区块，而非硬编码全插入。
- 深度注入与 marker 化 WI/历史是 V0.12+ 能力；V0.11b 仅导入文本到现有槽位。

---

## 6. UI behavior

### 6.1 单预设导入流程

1. 用户点击 Import → 选择本地 JSON 文件。
2. 前端 `JSON.parse`（失败则浏览器/reader 抛错，无结构化校验）。
3. 从 `data.name` 或文件名得到预设名。
4. 调用 `savePreset`：POST `/api/presets/save`，写入用户目录。
5. 下拉框新增或更新项并 **立即选中**（相当于立即应用）。
6. Toast 提示成功。

**无独立预览步骤**；导入即持久化并切换。

### 6.2 Master import

- 自动类型检测 → 单类型直接保存；多 section 弹窗勾选。
- 无效文件：`No valid sections` / `Invalid data` toast。

### 6.3 其他 UI 能力

| 能力 | 支持情况 |
|---|---|
| 重命名 | 是 |
| 删除 | 是（需确认） |
| 复制预设 | 通过 Save as 间接实现 |
| 恢复默认 | 是（仅出厂预设） |
| 导出 | 是（当前选中项） |
| 按角色名自动选预设 | 是（聊天切换时模糊匹配预设名） |
| Prompt Manager 可视化编辑 | 是（OpenAI 路径；含 token 预览、inspect） |

### 6.4 错误反馈

- JSON 解析失败：一般无友好捕获（master import 有 invalid object 检查）。
- 保存失败：toast + 控制台；提示检查服务器连接。
- 类型探测失败：master import 报错；单预设导入**不**做 schema 校验，错误字段可能静默进入存储。

### 6.5 RoleAgent V0.11b 最小 UI 建议

1. 在现有 **Prompt Settings** 区域增加：**Import preset**、**Export preset**、可选 **Preset 下拉**（若做命名库）。
2. 导入后展示 **只读摘要**（识别类型、将写入的字段、截断预览前 200 字）→ 用户确认 → 应用。
3. 提供 **Revert to app default**（已有 reset API，可复用）。
4. 不做 Prompt Manager 全功能编辑器；继续用 textarea 编辑 `roleplayPreset`。
5. 明确提示：**仅导入角色扮演指令文本，不包含模型密钥与采样参数**。

---

## 7. Storage behavior

### 7.1 SillyTavern

| 维度 | 行为 |
|---|---|
| 介质 | **文件系统**，每用户独立目录 |
| 路径 | `data/<user>/` 下分目录：`OpenAI Settings/`、`instruct/`、`context/`、`sysprompt/`、`reasoning/`、`TextGen Settings/` 等 |
| 文件名 | `{sanitizedName}.json` |
| 当前选中项 | 存在全局 `settings.json`（内存态 `oai_settings` / `power_user.*`） |
| 范围 | **按用户全局**；非按单角色/单会话文件存储 preset 本体 |
| per-character 差异 | `prompt_order` 按 `character_id` 存在 **OpenAI preset JSON 内**，非独立文件 |
| 出厂默认 | `default/content/presets/` 种子内容；restore API 可读回 |

### 7.2 对 RoleAgent Tavern（Prisma + SQLite）的建议

**现状**：`PromptSettings` 单例（`id = 'default'`），字段为 `roleplayPreset`、预算整数等。

**V0.11b 推荐：先扩展 `PromptSettings`，不新增表。**

理由：

- 第一版只做「导入一段主指令 + 可选 post-history/authorsNote 映射」，与现有字段高度重合。
- 单用户/单实例产品阶段，命名预设库、多用户隔离尚未成为刚需。
- 减少 migration 与 API 面。

**何时新增 `PromptPreset` 表（V0.12+）**：

- 需要多个命名预设并存、切换、导出库。
- 需要 per-character 选中不同 preset。
- 需要保存完整「区块启用表」而非单一大文本。

建议未来表形状（仅供参考，非本版实现）：

- `PromptPreset(id, name, roleplayPreset, authorsNote, postHistoryInstructions, source, importedAt, isBuiltin)`
- `PromptSettings.activePresetId` 外键可选。

---

## 8. Security and safety considerations

### 8.1 导入内容风险

| 风险 | 说明 |
|---|---|
| **API 密钥与代理** | OpenAI preset 含 `reverse_proxy`、`proxy_password`、`custom_url`、`custom_include_headers` 等 |
| **模型/端点配置** | 可能把用户导向恶意代理 |
| **Jailbreak / NSFW 指令** | `jailbreak`、`nsfw` 条目及 sysprompt 中「uncensored」类文案 |
| **忽略规则 / 绕过安全** | 「ignore previous instructions」类 post_history |
| **HTML/脚本** | 文本进 prompt 而非 DOM，但导出文件若被其他系统当 HTML 处理仍有风险 |
| **超大 payload** | 整 preset 可达数万字符；需大小上限 |
| **PII** | 用户自定义 preset 可能含私人信息 |

### 8.2 剥离与默认策略（RoleAgent 应采用）

1. **字段白名单**：V0.11b 只接受映射到 `roleplayPreset` / `authorsNote` / `userPersona` 的文本；拒绝或丢弃其余键。
2. **密钥扫描**：若 JSON 字符串值匹配 `sk-`、`Bearer `、`Authorization`、`api_key`、`apiKey` 等模式 → 拒绝导入并提示。
3. **敏感键黑名单**：`reverse_proxy`、`proxy_password`、`custom_include_headers`、`custom_url`（若含密钥）等一律丢弃且不计入成功。
4. **jailbreak 内容**：即使 ST 文件含 `jailbreak` 或 `post_history`，**默认不导入**；可在高级选项显式勾选「导入历史后指令」（仍经内容审核提示）。
5. **内置默认**：使用 RoleAgent 已有中性 `DEFAULT_ROLEPLAY_PRESET`；不得从 ST 复制默认 JSON。
6. **日志**：导入记录来源文件名与识别类型，不记录完整正文到服务器日志。

### 8.3 可借鉴 vs 不可复制（安全）

| 可借鉴 | 不可复制 |
|---|---|
| 导入前类型探测与用户确认 | ST 默认启用 nsfw/jailbreak 条目 |
| 剥离连接/密钥字段的原则 | ST 的 secrets.json 双写机制 |
| 中性 main prompt 的产品定位 | ST sysprompt「Roleplay - Simple」等原文 |
| 显式「恢复应用默认」 | 无校验的单文件导入直接落盘 |

---

## 9. Recommended V0.11b scope for RoleAgent Tavern

### 9.1 功能边界（做）

- 从 **单个 JSON 文件** 导入「角色扮演主指令」到 `PromptSettings.roleplayPreset`。
- 可选：若识别为 ST sysprompt，同时映射 `post_history` → 暂存到 `authorsNote` 或预留字段（见下文字段映射）。
- 导出当前 `roleplayPreset`（及可选 `authorsNote`）为 **RoleAgent 自有格式** JSON。
- 导入/导出前后可 **预览 + 确认**；失败返回结构化错误。
- 保留现有 **Reset to default**。
- 服务端校验与敏感内容扫描。

### 9.2 功能边界（不做）

- 完整 ST OpenAI preset / `prompts` + `prompt_order` 兼容。
- Instruct / Context / Reasoning / TextGen 采样 / Master bundle。
- Prompt Manager UI、marker、深度注入、per-character order。
- 模型名、温度、max_tokens 从 preset 导入（留给 LLM settings）。
- 导入后按角色名自动绑定。
- 多预设命名库（可推迟到 V0.12）。

---

## 10. Proposed RoleAgent Tavern data model

### 10.1 V0.11b（推荐：扩展 PromptSettings）

在 `PromptSettings` 增加可选列：

| 列 | 类型 | 说明 |
|---|---|---|
| `presetDisplayName` | String? | 最近一次导入或用户命名的预设标签（仅展示） |
| `presetSource` | String? | 如 `builtin` / `imported-st-sysprompt` / `imported-st-main` / `imported-rat` |
| `presetImportedAt` | DateTime? | 导入时间 |

`roleplayPreset`、`authorsNote` 继续承载正文；不新增子表。

### 10.2 共享 DTO 扩展（`packages/shared`）

```typescript
// 概念形状，非实现代码
PromptSettingsDto {
  // 现有字段 ...
  presetDisplayName?: string | null;
  presetSource?: string | null;
  presetImportedAt?: string | null; // ISO
}

PromptPresetImportResult {
  recognizedAs: 'st-sysprompt' | 'st-openai-main' | 'rat-preset' | 'plain-text';
  appliedFields: ('roleplayPreset' | 'authorsNote')[];
  warnings: string[];
  rejectedKeys: string[];
}
```

---

## 11. Proposed API design

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/settings/prompt` | 现有；返回扩展字段 |
| `PUT` | `/api/settings/prompt` | 现有；手动编辑 |
| `POST` | `/api/settings/prompt/reset` | 现有 |
| `POST` | `/api/settings/prompt/import` | **新增**：body `{ json: object }` 或 multipart 文件；返回 `PromptPresetImportResult` + 更新后 settings |
| `GET` | `/api/settings/prompt/export` | **新增**：下载 RoleAgent 格式 JSON |

### 11.1 Import 请求/响应行为

- 请求体大小上限：例如 256 KB。
- 解析失败 → `400 { error: 'invalid_json' }`。
- 无法识别 → `422 { error: 'unrecognized_preset', hints: [...] }`。
- 含敏感模式 → `422 { error: 'sensitive_content', fields: [...] }`。
- 成功 → `200` + 新 settings + `warnings`（如「已忽略 47 个未支持字段」）。

### 11.2 RoleAgent 导出格式（`rat-prompt-preset`）

```json
{
  "format": "roleagent-prompt-preset",
  "formatVersion": 1,
  "name": "My RP Preset",
  "roleplayPreset": "....",
  "authorsNote": null,
  "exportedAt": "2026-07-06T00:00:00.000Z"
}
```

不使用 ST 的裸对象作为 RoleAgent 官方导出格式，避免误当作全量 ST preset 再导回。

---

## 12. Proposed frontend design

在 `PromptSettings.tsx` 增加：

1. **Import** 按钮 → file input `.json` → 调 `POST import` → 展示 modal：识别类型、字段映射、warnings → Confirm。
2. **Export** 按钮 → 下载 `rat-prompt-preset` 文件。
3. 可选显示 `presetDisplayName` / `presetSource` 小字标签。
4. 导入成功后刷新表单；**不**要求重启会话。
5. 错误以 inline alert 展示（比 ST toast 更清晰）。

无需新页面；与 LLM Settings 并列即可。

---

## 13. Validation and test plan

### 13.1 识别与字段映射

| 输入形状 | 识别为 | 映射 |
|---|---|---|
| `{ name, content }` 且含 `content` | `st-sysprompt` | `content` → `roleplayPreset`；`post_history` 非空 → `authorsNote`（需警告：相当于历史后指令） |
| `{ prompts: [...] }` 且存在 `identifier===main` 的 content | `st-openai-main` | 仅 `main.content` → `roleplayPreset`；忽略 `jailbreak`/`nsfw` 除非高级开关 |
| `{ format: 'roleagent-prompt-preset', formatVersion: 1, ... }` | `rat-preset` | 按白名单字段导入 |
| 仅 `{ roleplayPreset: "..." }` | `rat-preset` 简化形 | 直接采用 |
| `{ name, input_sequence, output_sequence }` | instruct | **拒绝**，提示「不支持文本补全模板」 |
| `{ name, story_string }` | context | **拒绝** |
| `{ temp, top_k, top_p, rep_pen }` | textgen | **拒绝** |

### 13.2 校验规则

- `roleplayPreset` 非空，长度 ≤ 32_000 字符。
- `authorsNote` 可选，≤ 8_000。
- 拒绝嵌套深度 > 20 的 JSON。
- 字符串字段 strip `\0`；无 UTF-8 合法性问题。
- 敏感扫描命中 → 整单拒绝或仅丢弃可疑字段（推荐整单拒绝并列出原因）。
- 导入 `jailbreak` / `nsfw` 正文：默认 **跳过** 并写入 `warnings`。

### 13.3 测试步骤（手动）

1. 导出当前设置 → 再导入 → 文本一致。
2. 用 ST sysprompt 样例（仅 name+content）导入 → `roleplayPreset` 更新。
3. 用 ST OpenAI Default 形文件导入 → 仅 main 段落入库；模型字段不出现 in DB。
4. 含 `sk-fake...` 的 JSON → 422。
5. instruct JSON → 422 与明确 hint。
6. 损坏 JSON → 400。
7. Reset → 恢复中性默认。
8. 导入后发起聊天 → `promptBuilder` debug outline 首条 system 为 new preset。
9. `pnpm typecheck` / `pnpm build` 通过。

### 13.4 自动化（可选）

- 服务端 unit test：`importPromptPreset(json)` 识别与映射表。
- 无需 E2E 浏览器测试即可覆盖核心逻辑。

---

## 14. Out-of-scope items

- 完整 ST Prompt Manager 兼容与 `prompt_order` 编辑器
- Instruct / Context / Reasoning / Master bundle / TextGen 采样导入
- per-character / per-conversation preset 绑定
- 从 PNG 角色卡导入 preset
- Tokenizer 级预算（继续用字符预算）
- 多用户预设隔离（随多用户账号一起设计）
- 导入 ST 的 `extensions` 扩展字段
- 自动从互联网拉取社区 preset
- 复制 ST 的 marker 组装算法与 identifier 常量表

---

## 15. Open questions

1. **post_history 映射**：映射到 `authorsNote`（历史前）还是新增 `postHistoryPreset` 字段对齐 `promptBuilder` 的 `postHistoryInstructions` 槽位？当前 builder 读的是 **角色卡** `postHistoryInstructions`，非全局 settings。V0.11b 是否应增加 `PromptSettings.postHistoryPreset`？
2. **ST main 与 RoleAgent base 重复**：导入的 main 常含「写 {{char}} 的下一条回复」；与 RoleAgent 已有 role boundary 是否冗余？是否在导入时自动 prepend 说明或去重启发式？
3. **多预设库**：是否在 V0.11b 用单字段 `presetDisplayName` 过渡，还是一次到位加 `PromptPreset` 表？
4. **高级开关**：是否提供「同时导入历史后指令（jailbreak 槽）」opt-in？默认应否。
5. **宏兼容**：ST 使用 `{{charIfNotGroup}}` 等扩展宏；RoleAgent 仅支持有限宏——导入时是否做宏替换表或警告？
6. **LLM 采样参数**：V0.11 另线任务是否从 ST preset 导入 `temperature` / `max_tokens` 到 LLM settings？与本文档的边界需产品确认。
7. **国际化**：预设名与正文多语言；导入文件名编码问题（Windows 路径）需不需要 NFC 规范化？

---

*文档结束。未修改 RoleAgent Tavern 功能代码；未提交 Git。*
