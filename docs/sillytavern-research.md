# SillyTavern 架构与功能调研报告

> 调研日期：2026-07-06
> SillyTavern 源码：`E:\Sillytavern Originalcode\SillyTavern-release`（只读调研）
> RoleAgent Tavern 基准：dev HEAD `746ed9f`（merge: add prompt engine v0.10）
> 用途：RoleAgent Tavern 后续开发参考。本报告只描述架构与行为，不包含 SillyTavern 源码，功能实现须 clean-room 编写（见第 6 节许可说明）。

---

## 1. SillyTavern 总体架构图（文字版）

```
┌────────────────────────── 浏览器（前端，无框架，jQuery + ES Module）──────────────────────────┐
│  public/index.html（唯一页面，~8000 行 DOM）                                                  │
│    └─ public/script.js（1.2 万行总协调器：全局状态 chat/characters/main_api、事件总线、       │
│        Generate() 主流程、角色/聊天 CRUD、saveChat）                                          │
│        ├─ openai.js          Chat Completion：PromptManager 集成、ChatCompletion 预算、25+ 源 │
│        ├─ textgen-settings.js / kai-settings.js / nai-settings.js   Text Completion 各后端    │
│        ├─ PromptManager.js   prompt 条目/顺序/token 预览 UI                                   │
│        ├─ world-info.js      WI 编辑器 + checkWorldInfo 激活扫描                              │
│        ├─ group-chats.js     群聊轮替生成                                                     │
│        ├─ personas.js / power-user.js / preset-manager.js / tokenizers.js / tags.js ...       │
│        ├─ extensions.js      内置/第三方扩展加载（manifest.json）                             │
│        └─ slash-commands/    STscript 解析执行引擎                                            │
│  通信：fetch + JSON + CSRF token；流式 = fetch ReadableStream 解析 SSE（无 WebSocket）        │
└──────────────────────────────────────┬───────────────────────────────────────────────────────┘
                                       │ REST /api/*
┌──────────────────────────── Node/Express 后端（server.js → src/server-main.js）──────────────┐
│  src/endpoints/  按资源分文件：characters / chats / worldinfo / settings / presets / secrets  │
│                  / groups / avatars / backgrounds / images / extensions / vectors / ...       │
│  src/endpoints/backends/  chat-completions.js、text-completions.js、kobold.js —— 纯转发代理： │
│                  request body 由前端构造，后端做鉴权、格式转换、SSE 透传                      │
│  src/users.js    多用户（cookie-session）+ 每用户独立数据目录                                 │
│  src/plugin-loader.js  服务端插件（/api/plugins/<id>，默认关闭）                              │
└──────────────────────────────────────┬───────────────────────────────────────────────────────┘
                                       │ 文件系统（无数据库）
┌──────────────────────────── data/<user>/ 纯文件存储 ─────────────────────────────────────────┐
│  settings.json、secrets.json                                                                  │
│  characters/*.png（角色卡内嵌 tEXt chara/ccv3）   chats/<角色>/*.jsonl（首行 metadata）       │
│  worlds/*.json   groups/*.json + group chats/*.jsonl   OpenAI Settings/ 等预设目录            │
│  extensions/（第三方 git clone）   vectors/   backups/                                        │
└───────────────────────────────────────────────────────────────────────────────────────────────┘
```

对 RoleAgent 最有参考价值的三条架构结论：

1. **Prompt 组装完全在前端**，后端只是哑代理。RoleAgent 在服务端做 promptBuilder 是更干净的架构，不必效仿 ST。
2. **一切皆文件、无数据库**，多用户靠目录隔离。RoleAgent 的 Prisma + SQLite 在查询、搜索、事务上是代际优势。
3. **一条 `Generate(type)` 主链路复用所有生成场景**（normal / regenerate / continue / impersonate / swipe / quiet），差异只在入口预处理和保存策略。这是 RoleAgent 设计 chat service 时最值得吸收的模式。

### 1.1 前后端通信

- REST：`fetch` + JSON 为主，请求头带 `X-CSRF-Token`（`GET /csrf-token` 获取，`csrf-sync` 实现）。
- 流式：**没有 WebSocket**。前端 `fetch` POST 后读 `response.body`（ReadableStream），经 `public/scripts/sse-stream.js` 解析 SSE；后端把上游 SSE 直接 pipe 给响应。可选 SmoothEventSourceStream 做逐字平滑输出。
- 会话：cookie-session；多用户开关 `enableUserAccounts`（config.yaml），账号元数据存 `data/_storage/`（node-persist）。

### 1.2 数据存储

| 数据 | 格式与位置 |
|---|---|
| 全局设置 | `data/<user>/settings.json` |
| API 密钥 | `data/<user>/secrets.json`（不回传前端） |
| 角色卡 | `characters/*.png`，元数据 base64 存 PNG tEXt chunk（`chara` = V2，`ccv3` = V3，读取时 ccv3 优先） |
| 聊天 | `chats/<角色名>/<聊天名>.jsonl`，**首行是 metadata header**，其后每行一条消息 |
| 群聊 | `groups/*.json`（定义）+ `group chats/*.jsonl` |
| World Info | `worlds/<name>.json`，`entries` 是 uid → entry 字典 |
| 预设 | `OpenAI Settings/`、`TextGen Settings/`、`instruct/`、`context/` 等目录下的 JSON |
| 向量 | `vectors/`（Vectra 本地索引） |

---

## 2. 模块清单

### 2.1 前端（public/）

| 模块 | 文件 | 职责 |
|---|---|---|
| 总入口 | `public/script.js` | 全局状态、Generate() 主流程、事件总线 eventSource、聊天渲染与保存 |
| Chat Completion | `scripts/openai.js` | prepareOpenAIMessages、ChatCompletion token 预算类、25+ API 源、流式解析 |
| Text Completion | `scripts/textgen-settings.js`、`kai-settings.js`、`nai-settings.js`、`instruct-mode.js`、`sysprompt.js` | 15+ 本地后端、story string、instruct 模板拼纯文本 |
| Prompt 管理 | `scripts/PromptManager.js` | prompt 条目/顺序编辑、marker、token 预览、inspect |
| World Info | `scripts/world-info.js` | 编辑器 + checkWorldInfo 激活扫描（递归、预算、timed effects） |
| 角色数据 | `scripts/char-data.js`、`tags.js`、`filters.js` | 卡字段 typedef、标签、列表过滤 |
| 群聊 | `scripts/group-chats.js` | 4 种发言策略、talkativeness、auto mode |
| 会话 | `scripts/bookmarks.js`、`chat-backups.js`、`chats.js` | checkpoint/branch、备份浏览、文件附件（Data Bank） |
| 用户身份 | `scripts/personas.js` | 多 persona、描述注入位置（IN_PROMPT/AN/AT_DEPTH） |
| 预设 | `scripts/preset-manager.js` | 8 类 preset（kobold/novel/openai/textgen/context/instruct/sysprompt/reasoning） |
| 流式 | `scripts/sse-stream.js` | fetch 流 → SSE 解析、SmoothEventSourceStream 平滑输出 |
| 扩展 | `scripts/extensions.js` + `extensions/`（14 个内置） | manifest.json 发现加载、setExtensionPrompt 注入 |
| 脚本语言 | `scripts/slash-commands/`（27 文件）、`variables.js` | STscript：命令注册、变量、闭包 `{: :}`、/if /while |
| 宏 | `scripts/macros.js` + `macros/` | {{char}}/{{user}}/{{persona}} 等 50+ 宏替换 |
| 其他 | `power-user.js`、`tokenizers.js`、`i18n.js`、`backgrounds.js`、`secrets.js`、`authors-note.js`、`itemized-prompts.js` | 高级设置 / token 计数 / 国际化 / 背景 / 密钥 / 作者注 / prompt 调试 |

内置扩展（`public/scripts/extensions/`）：attachments（Data Bank）、assets、caption、connection-manager、expressions（表情/立绘/VN）、gallery、memory（自动摘要）、quick-reply、regex、stable-diffusion、token-counter、translate、tts、vectors（RAG）。

### 2.2 后端（src/）

| 模块 | 文件 | 职责 |
|---|---|---|
| 启动 | `server.js` → `src/server-main.js` → `src/server-startup.js` | 中间件链（helmet/CSRF/session）、路由挂载、HTTP(S) 监听 |
| 角色卡 | `src/endpoints/characters.js`、`src/character-card-parser.js`、`src/validator/TavernCardValidator.js` | PNG tEXt 读写、V1→V2 转换（convertToV2/charaFormatData）、导入导出 |
| 聊天 | `src/endpoints/chats.js` | jsonl 读写、7 种格式导入（ST/Ooba/Agnai/CAI/KoboldLite/Risu/Chub）、搜索、节流备份 |
| World Info | `src/endpoints/worldinfo.js` | worlds/*.json CRUD、导入 |
| 设置/预设/密钥 | `settings.js`、`presets.js`、`secrets.js` | settings.json 聚合返回、preset 文件、secrets.json |
| AI 转发 | `backends/chat-completions.js`、`backends/text-completions.js`、`backends/kobold.js` | 按 source/api_type 分发、SSE 透传（forwardFetchResponse）、abort 联动 |
| 内容导入 | `content-manager.js`、`charx.js`、`byaf.js` | chub/janitor/pygmalion/risu/perchance URL 导入、CharX/BYAF 格式 |
| 记忆 | `vectors.js` | Vectra 向量索引 CRUD、18+ embedding 源 |
| 用户 | `users.js`、`users-public/private/admin.js` | 多用户、session、目录隔离、静态资源按用户路由 |
| 工具 | `tokenizers.js`、`translate.js`、`search.js`、`extensions.js`、`plugin-loader.js` | 服务端分词（tiktoken/SentencePiece）、翻译、网络搜索、扩展 git 安装、服务端插件 |

### 2.3 核心机制速查

**Generate 主流程**（`public/script.js`）：事件 GENERATION_STARTED → 斜杠命令拦截 → 群聊分流 → sendMessageAsUser → 角色卡字段 → WI 扫描（getWorldInfoPrompt）→ extension prompts 注入 → 按 main_api 构造 body → 流式/非流式请求 → saveReply → saveChatConditional。type 取值：`normal / regenerate / continue / impersonate / swipe / quiet`，全部走同一函数。

**Prompt 系统**（`openai.js` + `PromptManager.js`）：preset 里存 `prompts[]` + `prompt_order[]`；marker prompt（chatHistory、worldInfoBefore/After、charDescription、charPersonality、scenario、personaDescription、dialogueExamples）在组装期被替换为实际内容；非 marker（main、nsfw、jailbreak、enhanceDefinitions）直接输出；角色卡 system_prompt/PHI 可覆盖（prefer_character_prompt）；深度注入统一走 `setExtensionPrompt(key, value, position, depth, scan, role)`，position ∈ {BEFORE_PROMPT, IN_PROMPT, IN_CHAT, NONE}；token 预算由 `ChatCompletion` 类管理，历史从新到旧填充，超支抛 TokenBudgetExceededError；可选 squash 连续 system 消息。

**World Info 激活**（`world-info.js` checkWorldInfo）：扫描最近 `world_info_depth` 条消息（可含名字前缀）+ scan=true 的 extension prompts；判定顺序 constant/sticky → 主 key（支持 regex）→ secondary key 按 selectiveLogic（AND_ANY/NOT_ALL/NOT_ANY/AND_ALL）→ 概率 roll → 分组竞争；支持递归（激活内容再触发条目）、min activations 加深扫描、token 预算（% 上下文 + cap）、timed effects（sticky/cooldown/delay）；插入位置 position ∈ {before, after, ANTop, ANBottom, atDepth(@D+role), EMTop, EMBottom, outlet}；绑定优先级 chat-bound → persona-bound → character（主 world + charLore 附加）→ global。

**角色卡**：V1 平铺字段 / V2 `spec: chara_card_v2`（data 下 name/description/personality/scenario/first_mes/mes_example/creator_notes/system_prompt/post_history_instructions/alternate_greetings/character_book/tags/creator/character_version/extensions）/ V3 `chara_card_v3`；`data.extensions` 存 talkativeness、fav、world 绑定、depth_prompt、regex_scripts；alternate_greetings 在新聊天时变成首条消息的 swipes；mes_example 按 `<START>` 分块。

**会话**：消息对象 {name, is_user, is_system, mes, swipes[], swipe_id, swipe_info, extra{...}}；swipe 右滑越界触发重新生成；checkpoint/branch 通过复制 jsonl + `chat_metadata.main_chat` 实现；保存 1s debounce + 服务端 10s 节流备份。

---

## 3. 功能矩阵

状态依据 RoleAgent dev HEAD `746ed9f`。优先级：P0 = 下一步就该做，P3 = 远期。

### 3.1 核心聊天链路

| SillyTavern 功能 | 所属模块 | 关键源码文件 | 作用 | RoleAgent 状态 | 优先级 | 建议版本 | 备注 |
|---|---|---|---|---|---|---|---|
| Chat Completion 生成 | 生成链路 | `public/scripts/openai.js` | 构造 messages 请求 LLM | 部分做（单 OpenAI 兼容源，stream:false） | P0 | V0.10.1 | RoleAgent 在服务端构造，架构更优 |
| 流式输出（SSE） | 生成链路 | `sse-stream.js`、`backends/chat-completions.js` | 逐 token 渲染 | 未做 | **P0** | V0.10.1 | 体验差距最大的单项；Fastify 转发 SSE 即可 |
| 停止生成（abort） | 生成链路 | `script.js` stopGeneration | 中断请求 | 未做 | P0 | V0.10.1 | 与流式一起做，AbortController 贯穿 |
| Regenerate | 生成链路 | `script.js` Generate('regenerate') | 删最后 AI 回复重新生成 | 未做 | P0 | V0.10.1 | 复用现有 /api/chat 链路即可 |
| Continue | 生成链路 | Generate('continue') | 续写最后一条回复 | 未做 | P1 | V0.11 | |
| Swipe（多候选回复） | 生成链路 | `script.js` swipe()、`mes.swipes[]` | 同一位置多版本切换 | 未做 | P1 | V0.11 | 需要 ChatMessage 增加 swipes 存储设计 |
| Impersonate（AI 代写用户） | 生成链路 | Generate('impersonate') | 生成用户视角发言 | 未做 | P2 | V0.12 | |
| Quiet generation（后台生成） | 生成链路 | generateQuietPrompt | 供摘要/工具静默调用 | 未做 | P2 | V0.12 | 做 summarize 前的地基 |
| Text Completion / instruct 模板 | 生成链路 | `textgen-settings.js`、`instruct-mode.js` | 本地模型纯文本补全 | 未做 | P3 | Later | 目标用户先覆盖 API 用户 |
| 多 API 源（Claude/Gemini/OpenRouter…） | 生成链路 | `backends/chat-completions.js` | 25+ 提供商 | 部分做（自定义 baseUrl 已可接 OpenAI 兼容网关） | P2 | V0.12 | 先做"多连接配置档"，再谈原生协议 |

### 3.2 Prompt 系统

| SillyTavern 功能 | 所属模块 | 关键源码文件 | 作用 | RoleAgent 状态 | 优先级 | 建议版本 | 备注 |
|---|---|---|---|---|---|---|---|
| 固定顺序 prompt 组装 | Prompt | `openai.js` populateChatCompletion | 角色卡各段+WI+历史 | **已做**（promptBuilder.ts 固定顺序） | — | — | v0.10 已闭环 |
| PromptManager（条目可编辑/排序/开关） | Prompt | `PromptManager.js` | 用户自定义 prompt 顺序 | 未做 | P1 | V0.12 | 建议做简化版：DB 存 prompt 条目+order |
| prompt preset（含采样参数） | Prompt | `presets.js`、OpenAI Settings/ | 温度/max_tokens/prompts 打包切换 | 未做 | P1 | V0.11 | 先做采样参数+max context 可配 |
| main prompt / jailbreak(PHI) 覆盖 | Prompt | `preparePromptsForChatCompletion` | 角色卡 system_prompt/PHI 覆盖全局 | **已做**（含 {{original}}） | — | — | 与 ST 语义一致 |
| in-chat 深度注入（@D + role） | Prompt | `populationInjectionPrompts`、setExtensionPrompt | 按深度插入历史中 | 未做 | P1 | V0.11 | WI position/depth 的前置能力 |
| token 预算（tokenizer 计数） | Prompt | `ChatCompletion` 类、`tokenizers.js` | 按 token 裁剪，历史从新到旧填充 | 部分做（字符数近似，历史裁剪已有） | P1 | V0.11 | 可先用 ~4 chars/token 估算或引 tiktoken |
| 宏替换系统 | Prompt | `macros.js`、substituteParams | {{char}}/{{user}}/{{persona}} 等 50+ | 部分做（7 个宏） | P1 | V0.11 | 补 {{persona}}、{{mesExamples}}；{{original}} 已有 |
| prompt itemization（token 占比调试） | Prompt | `itemized-prompts.js` | 每段 prompt 可视化 | 部分做（debug outline，仅日志） | P1 | V0.10.1 | 把 debug 暴露成 API + 前端面板，成本低收益高 |
| squash 连续 system 消息 | Prompt | ChatCompletion.squashSystemMessages | 合并相邻 system | 未做（当前多条独立 system） | P1 | V0.10.1 | 部分 API 对多 system 不友好 |

### 3.3 角色卡

| SillyTavern 功能 | 所属模块 | 关键源码文件 | 作用 | RoleAgent 状态 | 优先级 | 建议版本 | 备注 |
|---|---|---|---|---|---|---|---|
| JSON / PNG 导入（V1/V2） | 角色卡 | `character-card-parser.js`、`characters.js` | tEXt chara 解析 | **已做**（前端解析 PNG） | — | — | 建议移到服务端并支持 ccv3 优先 |
| V3 卡（ccv3 chunk） | 角色卡 | 同上 | 新版规格 | 未做 | P2 | V0.12 | 读取时 ccv3 优先于 chara |
| alternate_greetings | 角色卡 | script.js getFirstMessage → swipes | 多开场白 | 未做 | P1 | V0.11 | 依赖 swipe 数据结构 |
| creator_notes / tags / creator / version | 角色卡 | char-data.js | 展示性字段 | 未做（rawCardJson 里有但未建模） | P2 | V0.12 | 列表 UI 做标签过滤时一起 |
| character_book 内嵌世界书 | 角色卡 | importEmbeddedWorldInfo | 卡带书 | **已做**（导入自动建 WorldBook 并绑定） | — | — | |
| avatar 头像 | 角色卡 | `avatars.js`、thumbnails | 列表/聊天头像 | 未做 | P1 | V0.11 | PNG 导入时把图存下来即可 |
| PNG 导出（写回 tEXt） | 角色卡 | write() in card-parser | 分享卡片 | 未做（仅 JSON 导出，v0.8 明确 deferred） | P2 | V0.12 | png chunk 编码可手写或用库 |
| URL 导入（chub 等） | 角色卡 | `content-manager.js` | 一键拉卡 | 未做 | P3 | Later | 版权与内容风险，见第 6 节 |
| depth_prompt（extensions 字段） | 角色卡 | charaFormatData | 角色自带深度注入 | 未做 | P2 | V0.12 | 依赖深度注入机制 |

### 3.4 World Info

| SillyTavern 功能 | 所属模块 | 关键源码文件 | 作用 | RoleAgent 状态 | 优先级 | 建议版本 | 备注 |
|---|---|---|---|---|---|---|---|
| keys 触发 + constant | WI | `world-info.js` checkWorldInfo | 关键词激活 | **已做**（子串匹配，扫最近 3 条+当前输入） | — | — | |
| scan depth 可配 | WI | world_info_depth | 扫描窗口 | 部分做（写死 3 条） | P1 | V0.11 | 全局+条目级可配 |
| secondary keys + selectiveLogic | WI | 同上 | AND/NOT 组合条件 | 未做 | P1 | V0.11 | 导入卡常用到 |
| insertion order 排序 | WI | entry.order | 插入排序 | **已做** | — | — | |
| position（before/after/@D/EM）+ role | WI | world_info_position | 注入位置控制 | 未做（全部拼一个 system 块） | P1 | V0.11 | 至少支持 before/after char + @D 深度 |
| token budget（%上下文 + cap） | WI | world_info_budget | 防 WI 挤爆上下文 | 部分做（固定 6000 字符） | P1 | V0.11 | 改为可配比例 |
| probability / useProbability | WI | 同上 | 概率激活 | 未做 | P2 | V0.12 | |
| 递归扫描 | WI | scan_state.RECURSION | 条目激活条目 | 未做 | P2 | V0.12 | 控制好 max steps |
| timed effects（sticky/cooldown/delay） | WI | WorldInfoTimedEffects | 时序控制 | 未做 | P3 | Later | 高级用法，用户少 |
| chat-bound / persona-bound 书 | WI | chat_metadata.world_info | 多级绑定 | 部分做（会话级 active 列表 + 角色默认绑定） | — | — | 语义已近似覆盖 |
| WI 编辑器（条目级 UI） | WI | showWorldEditor | 可视化编辑 | 未做（只有导入/导出/删除） | **P0** | V0.11 | 没有编辑器 WI 基本不可用 |
| Novel/Agnai/Risu lorebook 导入 | WI | convertNovelLorebook 等 | 兼容生态 | 未做 | P3 | Later | |

### 3.5 会话管理

| SillyTavern 功能 | 所属模块 | 关键源码文件 | 作用 | RoleAgent 状态 | 优先级 | 建议版本 | 备注 |
|---|---|---|---|---|---|---|---|
| 消息编辑 / 删除 | 会话 | messageEdit / deleteMessage | 修正对话 | 未做 | **P0** | V0.10.1 | 角色扮演刚需，DB 模式下实现成本低 |
| 每角色多会话 | 会话 | chats/*.jsonl 多文件 | 平行剧情 | 未做（每角色 1 个自动会话，todo 已记录） | P0 | V0.11 | schema 已支持，缺 API+UI |
| 会话重命名/删除 | 会话 | renameChat / delChat | 管理 | 未做 | P1 | V0.11 | 随多会话一起 |
| 聊天搜索 | 会话 | POST /api/chats/search | 按文本找消息 | 未做 | P2 | V0.12 | SQLite LIKE/FTS 反而比 ST 好做 |
| 聊天导入导出（jsonl/txt） | 会话 | chats.js import/export | 迁移备份 | 未做 | P2 | V0.12 | 支持 ST jsonl 导入可吸引迁移用户 |
| 自动保存 + 备份 | 会话 | saveChatDebounced、节流备份 | 防丢失 | **已做**（每次请求落库；SQLite 文件即备份） | — | — | 可加定期 DB 备份 |
| checkpoint / branch | 会话 | `bookmarks.js` | 剧情分叉 | 未做 | P3 | Later | |
| 群聊 | 会话 | `group-chats.js` | 多角色同场 | 未做 | P2 | Later | 大功能，先把单聊打磨完 |
| 用户 Persona | 会话 | `personas.js` | 用户名/人设注入 | 未做（userName 参数存在但无 UI/存储） | P1 | V0.11 | 最小版：全局 persona 名+描述 |

### 3.6 平台能力

| SillyTavern 功能 | 所属模块 | 关键源码文件 | 作用 | RoleAgent 状态 | 优先级 | 建议版本 | 备注 |
|---|---|---|---|---|---|---|---|
| 扩展系统 + setExtensionPrompt | 扩展 | `extensions.js`、script.js | 插件注入 prompt | 未做 | P3 | Later | 先在内核里留好"注入槽"抽象 |
| 事件系统 | 扩展 | `events.js` | 100+ 生命周期事件 | 未做 | P3 | Later | |
| Summarize 长期记忆 | 记忆 | `extensions/memory/` | 自动摘要注入 | 未做 | P2 | V0.12+ | 依赖 quiet generation |
| 向量 RAG（chat/data bank） | 记忆 | `extensions/vectors/`、`src/endpoints/vectors.js` | 相似检索注入 | 未做 | P3 | Later | |
| Author's Note | 记忆 | `authors-note.js` | 会话级浮动指令 | 未做 | P1 | V0.11 | 实现简单（一条深度注入），价值高 |
| Regex scripts | 增强 | `extensions/regex/` | 输入/输出正则改写 | 未做 | P2 | V0.12 | |
| Quick Replies / STscript | 增强 | `quick-reply/`、`slash-commands/` | 宏按钮/脚本语言 | 未做 | P3 | 不建议近期做 | STscript 是巨型子系统 |
| 密钥管理（secrets） | 平台 | `secrets.js` | key 不入前端 | 部分做（内存+env，重启丢失） | P0 | V0.10.1 | 至少持久化到本地文件/DB，不回传前端 |
| Tokenizer 服务 | 平台 | `src/endpoints/tokenizers.js` | 精确计数 | 未做 | P1 | V0.11 | |
| 多用户 | 平台 | `src/users.js` | 账号隔离 | 未做 | P3 | 暂不做 | 桌面单机定位下无需求 |
| i18n | UI | `i18n.js`、locales/ | 18 语言 | 未做（UI 硬编码中文） | P2 | V0.12 | |
| 主题/自定义 CSS | UI | `power-user.js` | 个性化 | 未做 | P3 | Later | |
| 移动端适配 | UI | mobile-styles.css | 手机可用 | 未做 | P2 | V0.12 | |
| VN mode / sprites / expressions | UI | `extensions/expressions/` | 立绘表情差分 | 未做 | P3 | 暂不做 | |
| 背景图 / 图库 / TTS / SD 画图 / 翻译 | 扩展 | 各扩展目录 | 周边体验 | 未做 | P3 | Later / 暂不做 | |

---

## 4. RoleAgent Tavern 差距分析

### 4.1 已经站稳的地基（不需要回头重做）

- 服务端 promptBuilder 的分层（base instruction → system_prompt 覆盖含 `{{original}}` → description/personality/scenario → WI 块 → examples（`<START>` 解析）→ history 裁剪 → 当前输入 → PHI → 边界提醒）与 ST 默认 prompt_order 语义高度对应，且比 ST 的前端拼装干净。
- character_book 自动建书绑定 + 会话级 WI 多选，等价于 ST 的 character-bound + chat-bound 组合。
- SQLite 持久化在会话管理、搜索、事务一致性上先天优于 ST 的 jsonl 文件方案。

### 4.2 三类真实差距

1. **交互链路完整度（最痛）**。ST 的核心竞争力是 `Generate(type)` 一条链路支撑 normal/regenerate/continue/swipe/impersonate + 流式 + abort。RoleAgent 目前只有"发一条、等全文、收一条"，消息不可编辑不可删除、生成不可打断不可重来。这是用户第一分钟就能感受到的差距。
2. **可配置性**。ST 的 prompt preset、采样参数、PromptManager、WI 条目编辑器给了重度用户控制权。RoleAgent 目前温度/max tokens 都不可调，WI 条目不可编辑（只能整本导入导出），prompt 顺序写死。
3. **生态兼容面**。V3 卡、alternate_greetings、secondary keys、position/depth 这些字段在社区卡里出现频率很高，导入后被静默忽略会造成"同一张卡在 ST 里表现好、在 RoleAgent 里表现差"的观感。

### 4.3 不必追的部分

Text Completion/instruct 全家桶、25+ 原生 API 协议、STscript、Extras、多用户、VN 模式——这些是 ST 十年生态的沉淀，不构成核心体验，与 RoleAgent 桌面单机定位也不匹配。

---

## 5. 推荐开发路线

### V0.10.1 — 质量修复（立即，均为小步 PR）

1. SSE 流式输出 + 停止生成（服务端转发 stream:true，前端逐 token 渲染，AbortController 贯穿）。
2. 消息编辑 / 删除 API + UI。
3. Regenerate（删最后 assistant 消息重生成，复用 /api/chat）。
4. Prompt debug 从日志升级为 API + 前端"查看本次 prompt"面板（数据已在 `PromptDebugInfo` 里）。
5. LLM 设置持久化（不再重启丢失；apiKey 永不回传前端）。
6. squash 连续 system 消息开关，提升对严格 API 的兼容性。

### V0.11 — 中等功能闭环（下一轮主版本）

- 每角色多会话（新建/切换/重命名/删除）+ swipe 数据结构 + alternate_greetings。
- WI 条目编辑器（增删改条目、启用开关），同时补 secondary keys/selectiveLogic、可配 scan depth、position（before/after/@D+role）、预算改为可配比例。
- 最小 preset：温度、top_p、max_tokens、max context 可配可存。
- 用户 Persona（名字+描述+注入位置）与 `{{persona}}` 宏；宏系统补齐常用项。
- token 估算预算（字符/4 近似或引 tokenizer）。
- Author's Note（会话级深度注入）。

### V0.12 — 补生态兼容

- V3 卡读取、creator_notes/tags/avatar 建模与列表过滤、PNG 导出。
- WI 概率激活、基础递归。
- regex scripts 最小版。
- ST jsonl 聊天导入、聊天搜索。
- 简化版 PromptManager（条目排序/开关）。

### 暂缓的大型功能

群聊、summarize、向量 RAG、扩展系统（先在内核留"注入槽 + 事件"抽象即可）、i18n、移动端。

### 不建议做

STscript 脚本语言、Extras API 对接、AI Horde、多用户系统、VN mode/sprites、服务端插件——投入产出比低或与桌面单机定位不符。

---

## 6. 风险与许可注意事项

1. **AGPL-3.0 传染性**：SillyTavern 采用 AGPL-3.0。**不能复制其源码**（哪怕片段改写痕迹明显也有风险），否则 RoleAgent Tavern 整体必须以 AGPL 开源。本报告输出的是架构与行为描述，据此做 clean-room 实现（只参考"做什么"，自己决定"怎么写"）是安全的。建议团队约定：任何人不把 ST 代码粘进 RoleAgent 仓库；devlog 里记录功能设计来源为"规格/行为观察"而非代码。
2. **角色卡规格是安全的**：Character Card V2/V3 是社区公开规格（独立于 ST 代码库），实现字段兼容不涉及 ST 版权。PNG tEXt chunk 读写属通用技术。
3. **第三方内容风险**：chub 等站点的卡片存在版权与 NSFW 内容问题，URL 一键导入功能建议远期再评估，并保留内容免责声明。
4. **API key 安全**：ST 用服务端 secrets.json 且默认不回显；RoleAgent 当前内存存储重启即丢，且要确保任何 GET 接口不返回 key 明文（现状已做对，持久化时保持）。
5. **兼容性预期管理**：一旦支持"导入 ST 卡/世界书"，用户会默期望 ST 级别的字段行为（尤其 position/depth/secondary keys）。建议导入时对"已解析但未生效"的字段给出显式提示，避免静默降级。
