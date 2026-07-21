# RoleAgent Tavern V0.18 — SillyTavern UI Extension compatibility runtime research

**Status:** research complete for local-source review; architecture not approved; no V0.18 runtime implementation started.
**Research date:** 2026-07-19 (Asia/Shanghai).
**Compatibility evidence baseline:** RoleAgent `498e24f`, local SillyTavern `1.18.0`, local JS-Slash-Runner / 酒馆助手 `4.8.18`.

## 1. Executive summary

The expression “full SillyTavern extension compatibility” is not a single API shim. In the inspected SillyTavern client, a UI Extension is an ES module inserted into the **main page**, shares that page's DOM and global libraries, imports internal modules by URL, reads and mutates live chat/character/persona/worldbook/preset state, registers events and slash commands, and can call authenticated same-origin APIs. That is high-privilege browser code, not a Server Plugin and not an isolated widget.

RoleAgent V0.17 already has three deliberately different behaviors:

- **RoleAgent Native**: declared RoleAgent HTML features in a controlled iframe.
- **L0 Display-only**: external manifest JS/CSS is described but not executed.
- **L2 Experimental sandbox**: an external module and stylesheet run in an opaque-origin `sandbox="allow-scripts"` iframe. Only `extension_settings`, `saveSettingsDebounced`, two mount nodes, settings persistence, bounded logs, and a session-scoped `postMessage` handshake are supplied.

Those boundaries are real security controls. Removing `allow-same-origin`, `connect-src 'none'`, message validation, path confinement, or settings limits would not “complete” L2; it would silently convert a sandbox into trusted code execution while retaining misleading labels. V0.18 therefore needs a separately named, explicitly enabled **Trusted / L3** compatibility mode, while preserving L0, L2, and Native unchanged.

JS-Slash-Runner 4.8.18 is a demanding baseline. Its final bundle retains 24 static imports of SillyTavern modules (151 imported names), six distinct dynamically imported SillyTavern modules, direct main-page DOM access, host globals, 28 event types, slash-command construction/execution, chat/character/persona/worldbook/preset CRUD, prompt injection, custom raw generation, generation abort, same-origin `srcdoc` iframe script execution, optional WebSocket access, and remote CDN resources. It cannot run meaningfully in V0.17 L2.

The evidence supports a **direction**, not a final architecture decision:

1. Freeze a versioned compatibility contract and fixtures before broadening execution.
2. Keep L2 as the safe settings-only path.
3. Prototype Trusted/L3 as a distinct execution path, comparing main-window execution against a dedicated compatibility renderer. A same-origin iframe alone does not recreate SillyTavern's main-page DOM and does not provide robust per-plugin network isolation.
4. Use JS-Slash-Runner-specific module rewriting/adapter work only as a measured compatibility fixture, not as the definition of the general API.
5. Claim only the API subset proven by source inventory and smoke tests. The candidate acceptance wording is: **“V0.18 targets the local SillyTavern 1.18.0 source snapshot and JS-Slash-Runner 4.8.18, implementing the UI Extension API subset verified by source inventory and executable smoke tests.”**

No browser or Electron smoke was run in this research task; all runtime behavior below is either source-confirmed or explicitly marked for runtime verification.

## 2. Scope and non-goals

### 2.1 Terms

| Term | Meaning in this document |
| --- | --- |
| SillyTavern UI Extension | Browser-side manifest, ES module, CSS/i18n, DOM integration and client APIs loaded by `public/scripts/extensions.js`. |
| SillyTavern Server Plugin | Server-side/plugin process capabilities. **Out of V0.18 scope.** |
| RoleAgent Native Extension | RoleAgent manifest/features and controlled iframe runtime. It is not an ST compatibility claim. |
| V0.17 L0 | External manifest display only; no external script execution. |
| V0.17 L2 | Experimental opaque-origin iframe; script plus settings-only compatibility shell. |
| V0.18 Trusted / L3 candidate | Explicitly opted-in, high-privilege UI Extension compatibility runtime; architecture still under review. |

### 2.2 In scope

- SillyTavern UI Extension manifest/loading semantics.
- Browser ESM resolution, host DOM/globals, settings, events, slash/STscript, prompt/generation, UI lifecycle and diagnostics.
- JS-Slash-Runner 4.8.18 as the primary complex fixture.
- Electron and Web implications of browser-side compatibility.

### 2.3 Non-goals

- Server Plugin compatibility.
- Arbitrary Node.js module execution, filesystem access, shell/process access, or Electron `nodeIntegration`.
- Exposing LLM/API secrets to extension code.
- Claiming all ST extensions work.
- Choosing the final architecture or producing the implementation plan.
- Modifying either reference source tree or running data-writing tests.

## 3. Research baselines

| Repository / snapshot | Absolute path | Git branch | `rev-parse HEAD` | `describe --tags --always` | `status --short` | Version metadata |
| --- | --- | --- | --- | --- | --- | --- |
| RoleAgent Tavern | `E:\RoleAgent Tavern` | `feature/full-st-extension-runtime-v0.18` | `498e24fb551425f6e997dc3128260476370b3ad0` | `498e24f` | clean | root `package.json`: `roleagent-tavern` `0.0.0`, `pnpm@9.15.0` |
| SillyTavern | `E:\Sillytavern Originalcode\SillyTavern-release` | not available: directory has no `.git` | not available | not available | not a Git repository | `package.json`: `sillytavern` `1.18.0`, license field `AGPL-3.0` |
| JS-Slash-Runner | `E:\Sillytavern Originalcode\JS-Slash-Runner-main` | not available: directory has no `.git` | not available | not available | not a Git repository | `package.json`: `JS-Slash-Runner` `4.8.18`; manifest `4.8.18`, minimum client `1.12.13` |

The RoleAgent branch HEAD, local `dev`, and their merge-base all equal `498e24fb551425f6e997dc3128260476370b3ad0`. The research branch therefore starts exactly at the requested `dev` baseline. The two extracted reference directories must not be assigned guessed commits or branches.

The task text used 4.8.19 only as example wording. The local evidence is 4.8.18, so 4.8.18 is the actual compatibility fixture.

## 4. RoleAgent V0.17 baseline

### 4.1 Stored model and DTO contract

`InstalledExtension` stores manifest identity, default-disabled state, feature flags, an isolated compatibility settings document, and an installation path. `compatSettingsJson` defaults to `{}` and is separate from `featureSettingsJson` (`apps/server/prisma/schema.prisma:L198-L216`). Shared types expose compatibility levels only through `native | L0 | L1 | L2`, `compatRuntimeUrl`, capability/warning lists, feature runtime URLs, and JSON settings DTOs (`packages/shared/src/index.ts:L13-L43`, `packages/shared/src/index.ts:L73-L110`). There is no V0.18 L3 type yet.

### 4.2 Extension Manager and assets

- ZIP and public HTTPS Git installs are accepted by the server; a validated install is created with `enabled: false` (`apps/server/src/services/extensionManager.ts`, `installValidatedExtension`, around L1470-L1512).
- External JS/CSS entries become display-only feature rows; `displayOnly` makes them non-runnable (`extensionManager.ts:L539-L552`, `L730-L833`).
- A compatibility URL exists only when an enabled external manifest has a safe `.js` path (`extensionManager.ts:L560-L568`).
- The DTO labels Native, L2 and L0 separately. L2 itself enumerates missing event bus, slash, chat/character/worldbook/persona and prompt/generation APIs (`extensionManager.ts:L579-L642`).
- Assets are extension-local, reject traversal/schemes/symlinks/unsupported extensions, enforce a 25 MiB limit, and use explicit MIME types (`apps/server/src/services/extensionAssets.ts:L4-L20`, `L44-L167`, `L170-L201`).
- The assets route returns `Access-Control-Allow-Origin: null` only for an opaque sandbox module request with `Origin: null` (`apps/server/src/routes/extensions.ts:L234-L255`).
- Both native runtime and compatibility runtime use a restrictive CSP. The generic runtime denies all connections (`extensionAssets.ts:L22-L29`); compat additionally denies frames, workers, forms, objects and media, with nonce/self scripts only and `connect-src 'none'` (`extensionCompatRuntime.ts:L89-L105`).

### 4.3 Native, L0 and L2 behavior

| Mode | Execution | Available surface | Explicitly absent / boundary |
| --- | --- | --- | --- |
| Native | Enabled RoleAgent HTML feature, controlled iframe | HTML entry, assets, feature toggles | Not an ST global/API compatibility environment. |
| L0 | None | Manifest/display metadata | No external JS, CSS injection into app, settings or host access. |
| L2 | External JS module + CSS in `sandbox="allow-scripts"` iframe | `#extensions_settings`, `#extensions_settings2`, `window.extension_settings`, `window.saveSettingsDebounced`, `SillyTavern.getContext().extensionSettings/saveSettingsDebounced` | Opaque origin, no parent DOM, same-origin storage, network, event bus, slash, chat data, host request headers, prompt/generation hooks. |

The compatibility shell validates manifest JS/CSS entries before resolving them (`extensionCompatRuntime.ts:L29-L77`, `L549-L579`). Its fake context contains exactly two members and is frozen (`L326-L397`). Assets load only after a validated init (`L428-L476`). Unsupported APIs remain absent instead of being silently stubbed (`L428-L439`).

### 4.4 `postMessage`, session and settings flow

Protocol version 1 uses these messages:

| Direction | Type | Purpose |
| --- | --- | --- |
| iframe → host | `roleagent:compat:shell-ready` | Announces shell before session binding. |
| host → iframe | `roleagent:compat:init` | Supplies extension ID, random session ID and validated settings. |
| iframe → host | `roleagent:compat:runtime-ready` | Announces loaded L1/L2 assets. |
| iframe → host | `roleagent:compat:status` / `log` | Bounded diagnostics. |
| iframe → host | `roleagent:compat:save-settings` | Sends one validated settings snapshot with request ID. |
| host → iframe | `roleagent:compat:save-result` | Completes the correlated save. |
| host → iframe | `roleagent:compat:shutdown` | Stops saves and marks the session closed. |

The host creates a 16+ character session identifier after GET settings, validates `event.source`, exact fields, serialized size, protocol and session before acting, and rate-limits displayed logs (`apps/web/src/components/ExtensionRuntimePanel.tsx:L312-L559`). The iframe enforces exact init identity and request correlation (`extensionCompatRuntime.ts:L442-L533`). `'*'` is used as target origin because the iframe has an opaque origin, but sender-window identity plus session/protocol/shape validation is required.

`saveSettingsDebounced` waits 500 ms, validates depth/node/string/key/total-size limits, serializes one in-flight request, queues the newest snapshot, and then asks the host to PATCH (`extensionCompatRuntime.ts:L140-L158`, `L320-L370`, `L479-L508`). The server GET reads `compatSettingsJson`; PATCH requires an enabled external compatibility candidate and persists normalized JSON (`extensionManager.ts:L2123-L2152`; routes in `apps/server/src/routes/extensions.ts:L211-L232`, `L326-L343`).

### 4.5 Enable, disable, close and delete

- Enable/disable is a DB boolean update. Disabled extensions lose asset/runtime access and the UI closes an active runtime (`extensionManager.ts:L2073-L2079`, `L2154-L2164`; `ExtensionManagerPanel.tsx:L76-L91`, `L142-L167`). Settings are retained.
- Panel close/unmount sends shutdown, nulls session state and navigates the iframe to `about:blank` (`ExtensionRuntimePanel.tsx:L561-L586`).
- Delete first closes the panel in the UI, then server-side moves the validated install directory into controlled temporary trash, deletes the DB row, and restores the directory if DB deletion fails (`ExtensionManagerPanel.tsx:L220-L238`; `extensionManager.ts:L2198-L2237`).
- The manager visibly lists allowed/unavailable capabilities and warnings rather than presenting L2 as full compatibility (`ExtensionManagerPanel.tsx:L393-L485`).

### 4.6 What V0.17 does and does not provide

**Implemented:** safe install identity, default-off activation, manifest/feature DTOs, controlled assets, MIME and opaque-origin module CORS, CSP, Native/L0/L2 separation, settings GET/PATCH, bounded JSON, session handshake, status/log transport, disable gating and recoverable delete.

**Missing for ST compatibility:** ST module URL resolution, main-page DOM/global libraries, full `getContext`, event bus, slash/STscript registry, chat/character/persona/worldbook/preset projections, authenticated request broker, popup/templates/i18n/macros beyond plugin-bundled code, prompt/generation integration, stream/abort integration, permission model, and generalized plugin cleanup.

L2 cannot be “unlimited” without changing its threat model. Adding `allow-same-origin` would restore same-origin storage and potentially parent access when combined with appropriate origin; relaxing CSP would restore arbitrary fetch/frames/workers; broad `getContext` objects would expose mutable app state. Those are Trusted/L3 decisions and must not regress L2, L0 or Native.

## 5. SillyTavern UI Extension execution model

### 5.1 Discovery, manifest and URL rules

The server `/api/extensions/discover` combines built-ins with user/global third-party directories. User and global folders are exposed as `third-party/<folder>`, with user copies taking precedence (`src/endpoints/extensions.js:L476-L514`). Installation derives a sanitized folder from an HTTP/HTTPS Git URL, clones it, reads `manifest.json`, requires a JSON object, and returns selected metadata (`src/endpoints/extensions.js:L84-L151`). This is server support for installing UI assets, not the separate Server Plugin model.

The client fetches every manifest from `/scripts/extensions/${name}/manifest.json` (`public/scripts/extensions.js:L533-L562`). Third-party asset URLs therefore follow `/scripts/extensions/third-party/<folder>/<manifest path>`.

### 5.2 Activation sequence

1. `initExtensions()` installs extension-manager UI handlers before settings load (`public/script.js:L740-L750`; `public/scripts/extensions.js:L2293-L2315`).
2. `getSettings()` loads the app settings, then `loadExtensionSettings()` copies `settings.extension_settings` into the live object (`public/script.js:L7852-L7882`, `L7962-L7976`; `extensions.js:L1783-L1808`).
3. The client emits `EXTENSIONS_FIRST_LOAD`, discovers folders, fetches manifests and sorts them by numeric `loading_order`, then display name (`extensions.js:L48-L50`, `L568-L580`, `L1793-L1804`).
4. Activation checks `minimum_client_version`, Extras `requires`, extension `dependencies`, and `disabledExtensions`. `optional` is informative in manager UI, not an activation blocker (`extensions.js:L586-L661`, around `L972-L981`).
5. Locale data loads first; JS and CSS load concurrently afterward (`extensions.js:L628-L643`). JS is always an async ES module inserted into `document.body`; CSS is a stylesheet inserted into `document.head` (`extensions.js:L775-L840`). i18n chooses the current locale file from `manifest.i18n` and merges fetched JSON (`extensions.js:L843-L873`).
6. The optional `activate` hook is dynamically imported from the same entry module and called after assets load (`extensions.js:L383-L465`, `L631-L638`).

The extension therefore executes in the SillyTavern main-page browsing context. It can use the same `document`, DOM mount points, globals and origin as core code. `public/index.html:L8186-L8204` loads classic global libraries such as jQuery and toastr before `script.js`; `#extensions_settings` and `#extensions_settings2` are main-page containers.

### 5.3 Settings and context

`extension_settings` is one mutable global object exported by `extensions.js` (`public/scripts/extensions.js:L141-L219`). `saveSettingsDebounced` is a relaxed debounce around `saveSettings` (`public/script.js:L464-L470`). `saveSettings` POSTs the full app payload, including `extension_settings`, to `/api/settings/save` with host request headers and emits `SETTINGS_UPDATED` (`public/script.js:L7992-L8055`). Chat metadata, character `data.extensions`, and preset `extensions` are separate persistence scopes and not aliases of global extension settings.

`SillyTavern.getContext()` is sourced from `public/scripts/st-context.js:getContext` and currently returns all members listed in Appendix A. It is a live façade over imported core variables and functions, not an RPC-safe DTO (`public/scripts/st-context.js:L114-L306`).

### 5.4 Events, slash and generation

`event_types` defines 105 keys in the local snapshot, covering application readiness, messages, chat, generation, character, worldbook, presets, Persona, stream tokens and more (`public/scripts/events.js:L3-L111`). `eventSource` auto-replays `APP_INITIALIZED` and `APP_READY` to late listeners: the emitter records the last args after emission and invokes a newly added listener immediately (`public/scripts/events.js:L113`; `public/lib/eventemitter.js:L29-L59`, `L130-L157`). The app emits those two events after initialization and before/after hiding the loader (`public/script.js:L783-L788`).

Slash commands are registered through `SlashCommandParser.addCommandObject()` (legacy `registerSlashCommand` is a bound compatibility API) and executed through `executeSlashCommandsWithOptions` (`public/scripts/slash-commands.js:L103-L110`, `L6961-L7058`; parser class under `public/scripts/slash-commands/SlashCommandParser.js`).

Prompt/generation surfaces include:

- `setExtensionPrompt` and `extension_prompts` (`public/script.js:setExtensionPrompt`, around L8866; context L151-L153).
- manifest `generate_interceptor`: core calls a named `globalThis` function in loading order and provides an abort callback (`public/scripts/extensions.js:L2008-L2039`; invoked at `public/script.js:L4504-L4513`).
- `Generate`, `generateQuietPrompt`, `generateRaw`, `generateRawData`, and `stopGeneration` (`public/script.js:L3025`, `L3941`, `L4063`, `L4231`, `L5548`).
- generation and stream events including start/stop/end, prompt-ready, after-data and stream-token (`public/scripts/events.js:L22-L25`, `L56-L65`, `L72-L75`).
- `getRequestHeaders`, which is host-authenticated request context and must not be exposed as raw credentials (`public/script.js:getRequestHeaders`, around L645).

No `prompt_interceptor` symbol or “prompt interceptor” implementation was found by case-insensitive search of the inspected `public/script.js` and `public/scripts` tree. The source-confirmed mechanisms are `setExtensionPrompt`, prompt-ready/generate events, and manifest `generate_interceptor`. V0.18 must not invent a distinct core API under the missing name; any requirement called “prompt interceptor” needs a fixture/API definition during Phase 0.

### 5.5 Lifecycle and cleanup reality

Manifest hooks may name exported functions for `install`, `update`, `delete`, `clean`, `enable`, `disable`, and `activate`; each is dynamically imported and bounded by a five-second wait (`extensions.js:L383-L465`). Enable/disable updates `disabledExtensions`, saves settings and normally reloads the page (`L468-L500`). Delete optionally calls `clean`, calls `delete`, removes files through the server, saves settings, then reloads (`L1397-L1455`, `L1556-L1588`).

There is no core registry that automatically owns and removes every listener, DOM node, interval or hook created by arbitrary extension code. Page reload is the general cleanup boundary; hook quality is extension-dependent. A RoleAgent Trusted runtime that promises hot disable must add ownership tracking or explicitly require reload.

## 6. SillyTavern source entry map

| Capability | SillyTavern file | Export / function / object | Extension usage | RoleAgent V0.17 |
| --- | --- | --- | --- | --- |
| Folder discovery | `src/endpoints/extensions.js:L476-L514` | GET `/discover` | obtain built-in/local/global names | partial install manager, different layout |
| Manifest fetch | `public/scripts/extensions.js:L533-L562` | `getManifests` | `/scripts/extensions/<name>/manifest.json` | partial validation, different schema |
| Order/gates | `extensions.js:L568-L665` | `activateExtensions` | `loading_order`, version, requires, dependencies, disabled | missing ST semantics |
| JS | `extensions.js:L813-L840` | `addExtensionScript` | async `type=module` in body | L2 module only, isolated |
| CSS | `extensions.js:L781-L805` | `addExtensionStyle` | stylesheet in main head | L2 iframe only |
| i18n | `extensions.js:L848-L873` | `addExtensionLocale` | manifest locale JSON | missing |
| Main DOM | `public/index.html` | whole document, `#extensions_settings*` | direct jQuery/DOM | L2 has local mount nodes only |
| Global settings | `extensions.js:L141-L219` | `extension_settings` | mutable namespaces | partial per-extension JSON |
| Save settings | `public/script.js:L469`, `L7992-L8055` | `saveSettingsDebounced`, `saveSettings` | full settings payload | partial compat PATCH |
| Context | `public/scripts/st-context.js:L114-L306` | `getContext` | live core façade | stub: 2 members |
| Events | `events.js:L3-L113` | `event_types`, `eventSource` | on/once/emit/remove/makeFirst/makeLast | missing |
| Ready replay | `lib/eventemitter.js:L43-L58`, `L130-L157` | auto-fire events | late APP listeners still run | missing |
| Slash/STscript | `slash-commands.js`, parser classes | parser/command/execution APIs | register and execute | missing |
| Templates | `extensions.js:L116-L138`, `templates.js` | `renderExtensionTemplate*` | fetch/localize extension HTML | missing |
| Popup | `popup.js:L9-L25`, `L148+`, `L909+` | `Popup`, `callGenericPopup` | modal UI | missing |
| i18n helpers | `i18n.js:L15-L101`, `L246+` | `t`, `translate`, locale APIs | strings/UI | missing |
| Macros | `macros.js`, `macros/macro-system.js` | parser/registry | register/evaluate | missing |
| Chat/messages | `st-context.js:L117-L155` | `chat`, CRUD/render/save | live arrays/functions | missing |
| Character fields | `extensions.js:L2055+`, context L206-L207 | `writeExtensionField*` | `data.extensions` writes | native backend exists; no bridge |
| Persona | `st-context.js:L226-L235` and persona helpers | power-user/persona APIs | live state and uploads | missing |
| Worldbook | `st-context.js:L276-L282`, `world-info.js` | load/save/list/prompt | CRUD and prompt | missing |
| Presets | `st-context.js:L226-L228`, `L286` | settings/manager | live preset mutation | missing |
| Prompt injection | `script.js:setExtensionPrompt` | extension prompt store | add/remove injections | missing |
| Generation interceptor | `extensions.js:L2008-L2039` | `runGenerationInterceptors` | global named callback | missing |
| Quiet/raw generation | `script.js:L3025`, `L3941`, `L4063` | generation functions | direct calls | missing |
| Stream/abort | `events.js`, `script.js:L5548+` | token events/stop | observe/cancel | missing |
| Request headers | `script.js:getRequestHeaders` | authenticated headers | internal API fetch | intentionally not exposed in L2 |
| Hooks | `extensions.js:L383-L465` | manifest hook imports | lifecycle callbacks | missing |
| Disable/delete | `extensions.js:L468-L500`, `L1556-L1588` | hook + settings + reload | page-reload cleanup | different controlled close/delete |

## 7. JS-Slash-Runner dependency inventory

### 7.1 Package and build

- Manifest: JS `dist/index.js`, CSS `dist/index.css`, `loading_order: 100`, empty `requires`/`optional`, i18n `en`, minimum client `1.12.13`, version `4.8.18`.
- Build: Vite 8, Vue plugin, auto-imports for Vue/Pinia/VueUse/ST `t`, component auto-import, ES output, `esnext`, source map, no module preservation (`vite.config.ts`).
- Output sizes: `dist/index.js` 1,121,321 bytes; CSS 89,176; source map 4,413,518; external `lib/jsoneditor.js` 1,218,766.
- The resolver rewrites `@sillytavern/...` to a calculated relative URL and marks it external. `ST_IMPORT_DEPTH` can override the path depth. `vanilla-jsoneditor` is also rewritten to `../lib/jsoneditor.js` and external.
- `vite-plugin-external` maps six package imports to host globals: `jquery → $`, `hljs → hljs`, `lodash → _`, `showdown → showdown`, `toastr → toastr`, `@popperjs/core → Popper` (`vite.config.ts:L8-L17`, resolver and plugin sections).

### 7.2 Host-provided versus bundled

| Object/library | Result from config + final bundle | Implication |
| --- | --- | --- |
| jQuery / `$` | **Host-provided** external; render iframe additionally loads CDN jQuery, script iframe maps parent jQuery | Required for entry initialization and extensive DOM code. |
| toastr | **Host-provided** external | Used widely for errors/status. |
| lodash / `_` | **Host-provided** external | Source imports `lodash`; external plugin rewrites it. |
| hljs | **Host-provided** external/global | Directly patches `hljs.highlightElement`. |
| showdown | **Host-provided** external/global | Propagated into child iframes. |
| Popper | **Host-provided** external/global | Declared and externalized. |
| YAML | **Bundled** | Imported from `yaml`, not externalized, then assigned to `globalThis.YAML`. |
| Vue | **Bundled** | Large Vue runtime is present in `dist`; extra remote Vue script is only for devtools/global compatibility. |
| Pinia | **Bundled** | Auto-imported and present in bundle; not externalized. |
| axios | **Not used by inspected source/bundle entry** | Package dependency alone is not evidence of a host requirement. |
| socket.io-client | **Bundled** | Imported by developer listener; opens WebSocket only when listener setting is enabled. |

### 7.3 Internal module imports

Automated inspection of the final bundle found **25 static import declarations**: **24 SillyTavern module URLs** plus `../lib/jsoneditor.js`, importing **151 names** in total. The ST module list is:

`script.js`; `scripts/utils.js`; `i18n.js`; `world-info.js`; `extensions/regex/engine.js`; `preset-manager.js`; `extensions.js`; `openai.js`; `macros.js`; `RossAscends-mods.js`; `power-user.js`; `user.js`; `authors-note.js`; `PromptManager.js`; `sse-stream.js`; `personas.js`; `slash-commands.js`; `SlashCommand.js`; `SlashCommandArgument.js`; `SlashCommandCommonEnumsProvider.js`; `SlashCommandEnumValue.js`; `SlashCommandParser.js`; `popup.js`; `tokenizers.js`.

The bundle also contains **8 dynamic import expressions**, resolving to six distinct ST modules: `script.js`, `scripts/group-chats.js`, `scripts/macros/engine/MacroRegistry.js`, `scripts/openai.js`, `scripts/power-user.js`, and `scripts/templates.js`. Source locations include `createGenerationParametersCompat.ts:L39-L76` and `panel/developer/Reference.vue:L137,L175`.

This proves that package dependencies alone are insufficient: the final artifact intentionally expects the host's internal file layout and named exports.

### 7.4 Network, storage and globals

Automated source inspection found 29 `fetch`/socket construction tokens across 16 files (25 direct `fetch(` occurrences plus Socket.IO setup). Internal endpoints include settings/version, character create/edit/import, chat import/history, extension install/update/delete/version, avatars, and chat-completion status/generate. External fetches include update metadata/types, user-supplied media/script URLs, optimize documents and remote scripts. Developer listener defaults to `http://localhost:6621` and forces WebSocket transport (`src/panel/developer/listener.ts:L9-L64`).

There are 66 URL-like source matches (87 in the final bundle, which also includes bundled-library documentation/schema strings). Runtime-relevant groups include GitLab update APIs, `testingcf.jsdelivr.net` CDN scripts/styles, the project/documentation sites, example media URLs, and localhost listener. Exact URL strings are summarized in Appendix C; permission design must operate on resolved request destinations, not a hard-coded list.

Source does not spell `localStorage` directly, but VueUse `useLocalStorage` is used for `TH-Panel:active_tab` and dialog position/size keys (`src/panel/composable/use_validated_tab.ts:L6-L10`; `panel/component/Dialog.vue:L369-L403`). The bundle contains storage code because VueUse is bundled. No source use of sessionStorage, IndexedDB or cookies was found.

Plugin-created globals include `globalThis.TavernHelper`, `globalThis.YAML`, `globalThis.z`; child iframe setup reads/sets `$`, `jQuery`, `_`, `SillyTavern`, `Mvu`, `__TH_IFRAME_ID`, and copies `EjsTemplate`, `showdown`, `toastr` and helper bindings from the parent (`src/function/index.ts:L210-L479`; `src/third_party_object.ts`; `src/iframe/predefine.js`).

## 8. JS-Slash-Runner UI and feature map

The entry waits for jQuery ready, initializes macros/swipe/helper globals/slash commands, mounts Vue into a newly created `#tavern_helper` under `#extensions_settings`, and unmounts Vue on `pagehide` (`src/index.ts:L1-L50`).

| Tab | Entry | Principal dependencies | Initialization condition / behavior |
| --- | --- | --- | --- |
| Render | `src/panel/Render.vue` | message iframe runtime, chat DOM, hljs, macro processing, message/stream events | Enabled by global `render.enabled`; creates same-origin `srcdoc`/blob iframes for qualifying code blocks; streaming optional. |
| Script | `src/panel/Script.vue` | global/preset/character settings stores, script iframe store, eventSource, parent DOM button destination | Global scripts plus current preset/character scripts; enabled scopes determine hidden script iframes. Executes stored content as `<script type="module">`. |
| Toolbox | `src/panel/Toolbox.vue` | audio, prompt viewer, variable manager, logs, dialogs/local storage | Tools mount on demand; prompt viewer checks API/connectivity and listens to generation events. |
| Optimize | `src/panel/Optimize.vue` | power-user/worldbook/preset/chat DOM/event hooks, remote help Markdown | Individual global settings enable behavioral patches; defaults are mostly enabled. |
| Developer | `src/panel/Developer.vue` | listener, macro-like tools, type/reference UI | listener opens Socket.IO only when `listener.enabled`; reference view dynamically imports ST templates/macro registry. |

### 8.1 Data and API surface actually used

- **DOM:** automated extraction found 100 selector calls / 61 unique selector strings. These target ST chat messages, character editor, worldbook editor, prompt context inputs, Quick Reply, send form and extension mount points (Appendix C).
- **Context:** direct `getContext()` reads `extensionPrompts`; iframe predefinition spreads the entire `SillyTavern.getContext()` into child globals, so compatibility cannot safely replace it with only that one member.
- **Events:** 92 `eventSource` method calls, with `on`, `once`, `emit`, `makeFirst`, `makeLast`, and `removeListener`; 28 distinct `event_types` names (Appendix C).
- **Slash:** `SlashCommandParser.addCommandObject`, `SlashCommand.fromProps`, registry inspection, and `executeSlashCommandsWithOptions`; audio and event commands are registered in `src/slash_command`.
- **Settings:** global namespace `tavern_helper` (legacy `TavernHelper`); chat metadata namespace `tavern_helper`; character `data.extensions.tavern_helper`; preset `extensions.tavern_helper`. It also uses core `extension_settings.note`, `regex`, `variables`, dynamic extension IDs, `quickReplyV2.isCombined`, and legacy character keys.
- **Chat/message/character/persona/worldbook/preset:** full helper methods exist for reads and mutations; implementations directly import live core arrays/settings and call internal endpoints. See `src/function/index.ts:L267-L469` for the exported TavernHelper surface.
- **Prompt/generation:** uses `extension_prompts`/`setExtensionPrompt`, emits/observes prompt-ready and generation events, implements its own normal/raw generation assembly, calls chat-completion endpoints, streams via ST helpers, and owns per-generation AbortControllers (`src/function/inject.ts`; `src/function/generate/*`). Its manifest does **not** declare ST `generate_interceptor`; generation coupling is through imports/events/helper APIs.
- **Iframes/scripts:** script content is interpolated into a same-origin `srcdoc` document as a module; no `sandbox` attribute is present. Child code receives parent jQuery and a broad merged global surface (`src/panel/script/iframe.ts:L5-L22`; `src/panel/script/Iframe.vue`; `src/iframe/predefine.js`). Rendered message HTML can also contain scripts and remote libraries.
- **Cleanup:** Vue unmounts on `pagehide`; event wrappers expose removal and several components remove listeners/observers on unmount; generation controllers abort; iframe cleanup protector tracks parent globals/DOM and removes them on pagehide. Coverage is not universal: cleanup protector is optional/default false, and its source notes that top interception may fail (`src/iframe/cleanup_protector.js`; `src/type/settings.ts:L57-L69`). Runtime verification is required.

## 9. Compatibility gap matrix

Status vocabulary is restricted to `implemented`, `partial`, `stub`, `missing`, `intentionally unsupported`, and `unknown / needs runtime verification`.

| Capability | 酒馆助手 actually uses | SillyTavern behavior | RoleAgent V0.17 status | V0.18 adaptation | Risk | Priority |
| --- | ---: | --- | --- | --- | --- | --- |
| ESM import resolution | yes | browser-relative internal modules | missing | versioned resolver/import rewriting | high/upstream drift | P0 |
| Import map/module rewrite | yes | physical `/scripts` layout | missing | resolve 24 static + 6 dynamic fixture modules | high | P0 |
| CSS | yes | main document head | partial | scoped Trusted CSS or compatibility document | high/cascade | P0 |
| i18n | yes | manifest locale + `t` | missing | locale loader and API | medium | P1 |
| extension settings | yes | global live object/full save | partial | scope-aware store, events, migrations | medium | P0 |
| chat metadata | yes | mutable live object/save debounce | missing | revisioned bridge/adapter | high/data races | P0 |
| DOM | extensive | unrestricted main page | intentionally unsupported in L2 | explicit Trusted DOM contract or renderer DOM | critical | P0 |
| jQuery | yes | main global | missing | pinned host global matching ST behavior | medium | P0 |
| toastr | yes | main global | missing | UI notification adapter | low | P1 |
| eventSource | yes | async emitter + replay | missing | compatible emitter and lifecycle ownership | high | P0 |
| event_types | 28 names | 105-key object | missing | implemented verified subset; unknown keys error | high | P0 |
| slash commands | yes | parser registry/classes | missing | registry/parser compatibility subset | high | P1 |
| STscript | yes via execute API | core parser/executor/abort | missing | command execution façade | critical | P1 |
| macros | yes | legacy + new registry | missing | fixture-required subset | high | P1 |
| popup | yes | core Popup/callGenericPopup | missing | RoleAgent modal adapter | medium | P1 |
| templates | yes/dynamic | localized template fetch/render | missing | extension path loader/render API | medium | P1 |
| message CRUD | yes | live chat + DOM + save/events | missing | validated CRUD and event parity | critical/data | P0 |
| chat switching | yes | live IDs/reload/events | missing | context switch lifecycle | critical | P0 |
| character | yes | live cards + internal APIs | missing | DTO/edit/extension fields/events | critical | P0 |
| Persona | yes | power-user state + avatar APIs | missing | Persona CRUD/context adapter | high | P1 |
| worldbook | yes | live settings/editor/API | missing | CRUD/settings/prompt subset | critical | P1 |
| prompt injection | yes | live prompt store | missing | typed injection registry | critical | P1 |
| generation interceptor | indirect hooks/events; no manifest field | named global manifest hook | missing | decide supported contract; do not silently stub | critical | P2 |
| quiet generation | helper exposes generation | core quiet function | missing | controlled generation service | critical/cost | P1 |
| raw generation | yes | core/raw internal assembly | missing | versioned generation request contract | critical | P1 |
| stream events | yes | token and lifecycle events | missing | stream subscription with backpressure | high | P1 |
| generation abort | yes | AbortController + stop event | missing | per-extension request ownership/cancel | high | P1 |
| request headers | yes | authenticated same-origin headers | intentionally unsupported in L2 | broker requests; never return secrets | critical/security | P0 |
| network access | CDN/update/WebSocket/media | same-origin + browser network | intentionally unsupported in L2 | declared destinations, prompt/grant, Electron session policy | critical | P0 |
| iframe runner | central feature | plugin-created same-origin frames | partial (isolated runtime only) | Trusted nested iframe policy + ownership | critical | P0 |
| plugin unload | pagehide + partial cleanup | hooks + reload | partial for L2 panel | ownership registry or required reload | critical | P0 |
| error isolation | some event catches | module errors can affect page | partial L2 isolation | boundaries/diagnostics/fail closed | critical | P0 |
| permission disclosure | no formal manifest capabilities | trusted by installation | missing | inferred + declared capability review | critical | P0 |
| desktop build | unknown | browser app; Electron specifics vary | unknown / needs runtime verification | packaged assets/session/CSP smoke | high | P0 |

## 10. Architecture candidates

| Candidate | Compatibility / DOM / ESM | Isolation and failure | Unload and platform | Maintenance / license | Assessment |
| --- | --- | --- | --- | --- | --- |
| A. Enhance V0.17 sandbox iframe | Low–medium; no main DOM; imports need bridge | Strongest current isolation | Good teardown; Web/Electron similar | High shim cost, low code-copy risk | Preserve for L2, not full fixture target. |
| B. Same-origin iframe + bridge | Medium; parent DOM possible, ST globals/modules still synthetic | Same-origin greatly weakens isolation; direct fetch/parent access can bypass bridge | iframe teardown helps, leaked parent effects remain | High compatibility drift | Useful prototype, not equivalent to safe sandbox. |
| C. Main-window Trusted execution | Highest natural DOM/import compatibility | Weak isolation; extension error/global mutation can affect app | Hot unload difficult; Web works, Electron needs hardened webPreferences | Continuous upstream mapping; no required ST code copy if adapter-only | Strong compatibility candidate only with explicit trust and reload/diagnostics. |
| D. Dedicated compatibility page/renderer | Medium–high if it reproduces required ST page/context | Better process/session isolation; cross-renderer bridges | Electron strongest; Web multi-origin/worker constraints | Very high implementation cost | Best security direction for high privilege; DOM fidelity uncertain. |
| E. JS-Slash-Runner-specific adapter | High for one pinned fixture | Can constrain exposed surface | Must track one extension release | High fixture maintenance, low generality | Valuable proving adapter, not general architecture. |
| F. Reuse/embed ST frontend code | Potentially high | Inherits ST coupling and failure modes | Heavy package/build integration | Highest drift; SillyTavern local license is AGPL-3.0 and JS runner has an AFPL text, requiring legal review before copying/distribution | Do not pursue without legal and technical review. |

Criteria conclusions:

- A cannot provide parent/main-page DOM without breaking L2.
- B's same-origin privilege means “bridge-only permissions” are not enforceable against arbitrary code unless the browsing context is additionally isolated.
- C best matches how ST actually loads extensions but conflicts most directly with network/error/unload goals.
- D can enforce network/process boundaries in Electron, but recreating ST DOM/state in a separate renderer may become an ST reimplementation.
- E should be used to validate resolver and API coverage, not to make unsupported general claims.
- F carries both engineering and licensing questions. This document makes no legal conclusion.

**Recommended research tendency:** compare C and D with the same contract fixtures; retain A as L2; use E as a compatibility probe. Do not approve C until the product explicitly accepts its trust semantics, and do not approve D until a thin prototype proves DOM/event/generation latency and packaged-Electron behavior.

## 11. Security and trust model

1. ST UI Extensions are high-privilege browser code.
2. Broad compatibility and a strong sandbox are directly conflicting goals.
3. Trusted/L3 must be explicit, default off, visually distinct, and separately revocable from L2.
4. L2 keeps opaque origin, `allow-scripts` only, `connect-src 'none'`, exact protocol/session checks and bounded settings/logs.
5. Never expose plaintext LLM/API keys. `getRequestHeaders` compatibility must be a brokered operation or scoped opaque request capability.
6. External network is denied by default. Permissions identify schemes/hosts/ports and distinguish media, update, WebSocket and arbitrary fetch.
7. Filesystem, Node.js, Electron preload APIs and Server Plugin APIs are out of scope and denied.
8. Capability review combines manifest declarations with static inference (DOM, network, generation, write access) and displays uncertainty.
9. Disable/delete must remove or invalidate event handlers, DOM, timers, observers, nested frames, slash commands, prompt injects, generation interceptors and in-flight requests. If full tracking is impossible, require a renderer/page reload and say so.
10. A plugin exception must be caught at module load, event, command, hook and render boundaries; diagnostics identify plugin, phase and API without logging secrets or user content by default.
11. Critical missing APIs throw a clear compatibility error. Silent no-op stubs are permitted only for explicitly deprecated, behavior-free APIs such as ST's own legacy `registerHelper` no-op, and must be documented.
12. Electron builds require `contextIsolation: true`, `nodeIntegration: false`, no remote module, a restricted navigation/window-open policy, and a separate network/session review for any compatibility renderer.

## 12. Recommended V0.18 deliverable scope

### Must implement

- Versioned compatibility contract, resolver diagnostics and fixture suite.
- L0/L2/Native regression protection and a separate Trusted/L3 opt-in label/state.
- Static/dynamic ST module rewrite for the pinned fixture subset, with missing-export errors.
- Host globals actually required by the fixture (`$`, `_`, toastr, hljs, showdown, Popper) at pinned compatible versions.
- Settings scopes required by the fixture: global, chat metadata, character extension fields and preset extension fields, with conflict/revision handling.
- Main UI/DOM decision proven by prototype, not assumed; scoped CSS strategy.
- EventSource subset and 28 fixture event names, including APP_READY replay and listener ownership.
- Chat/message/character baseline needed for initialization and basic updates.
- Permission disclosure, default-denied network, error isolation, diagnostics and deterministic disable cleanup/reload.
- Electron packaged-runtime smoke in addition to Web development smoke.

### Should implement

- Slash command classes/registry/execution subset used by audio/event commands.
- popup/templates/i18n/macros subset required by the five tabs.
- Persona/worldbook/preset adapters used by variable manager and helper APIs.
- Prompt injection, quiet/raw generation, stream and abort with explicit user-visible generation authority.
- Nested iframe ownership and optional cleanup protector behavior, verified rather than trusted.

### May defer

- Full parity for all 105 ST event keys or every `getContext` member not exercised by fixtures.
- Extras API `requires` modules beyond manifest gating.
- JS-Slash-Runner developer live listener and remote update/install UI, if permissions are not ready.
- Rare deprecated APIs and tool-calling/scraper/service classes.

### Explicitly unsupported

- Server Plugins, arbitrary Node modules, arbitrary filesystem/process access, Electron renderer Node integration.
- Returning plaintext secrets/request headers.
- Undeclared/default arbitrary external network.
- Compatibility claims beyond pinned snapshots and smoke-tested surfaces.

### Needs runtime verification

- Whether rewritten imports work in Vite dev and packaged Electron URLs.
- Main-window versus renderer CSS/DOM behavior and error containment.
- Full five-tab JS-Slash-Runner initialization, generated iframe execution, stream rendering and cleanup.
- ST version differences after 1.18.0 and JS-Slash-Runner after 4.8.18.
- WebSocket permission enforcement and blob/srcdoc behavior under production CSP.

## 13. Phased implementation implications (not the implementation plan)

| Phase | Prerequisites | Likely areas | Independently acceptable result | Main risk |
| --- | --- | --- | --- | --- |
| 0 Contract/diagnostics/fixtures | research approval | shared DTOs, fixture assets, diagnostic model | exact API/permission/missing-export report; L0/L2 regression fixture | false compatibility claims |
| 1 Modules/globals | Phase 0 contract | resolver/import map/runtime loader | minimal ES extension and fixture imports load | upstream export drift |
| 2 Settings/DOM/templates/UI | architecture prototype choice | web runtime, settings APIs, CSS/UI host | settings fixture persists and UI mounts | main DOM privilege/CSS |
| 3 Events/chat context | stable lifecycle ownership | event adapter, chat APIs | chat switch/message event fixture passes | ordering/races |
| 4 Slash/STscript | event/context contract | parser façade/registry | command registers, executes, unregisters | arbitrary behavior/abort |
| 5 Prompt/generation | explicit authority UX | generation service, hooks/streams | injection/quiet/raw/abort fixture passes | cost, secrets, data integrity |
| 6 Permissioned network | capability UX and platform policy | backend broker/Electron session/CSP | denied request logged; granted destination works | bypass in Trusted main window |
| 7 Cleanup/error/full smoke | all prior phases | ownership registry, boundaries, diagnostics | disable removes effects; throwing plugin isolated; JS runner matrix passes | leaked effects/white screen |

The reviewed implementation plan belongs in `docs/sillytavern-full-extension-runtime-plan-v018.md` only after this research is approved; that file is intentionally not created here.

## 14. Smoke and acceptance matrix

| Fixture | Core checks | Security/cleanup checks | Platforms |
| --- | --- | --- | --- |
| Internal minimal Trusted fixture | manifest/order, ESM rewrite, CSS, diagnostics | default off, permission display, disable removes all effects | Web + packaged Electron |
| Existing V0.17 L2 fixture | settings UI/read/write/reopen | opaque origin, no same-origin/network, session rejection | Web + Electron |
| JS-Slash-Runner 4.8.18 | all five tabs; helper global; imports; initialization; settings; events; slash; chat update; iframe script; prompt/raw/stream/abort; refresh restore | console/backend errors; remote permission prompts/denials; disable cleanup; no app white screen | Web + packaged Electron |
| Settings-only ST extension | global namespace and debounce | size/depth/prototype rejection | Web |
| Event extension | APP_READY replay, message/chat events/order | listener removed on disable | Web |
| Slash extension | register/execute/result/abort | command removed and name collision diagnosed | Web |
| Prompt interceptor/injection extension | injection present at expected position | removal on disable; missing API not stubbed | Web + Electron |
| Deliberately throwing extension | load/event/command errors captured | app remains usable; diagnostic identifies phase | Web + Electron |
| Unauthorized-network extension | fetch/WebSocket/CDN attempt | denied by default and logged without leaking content | Web + Electron |

JS-Slash-Runner acceptance is not “five tabs are visible.” It must include successful initialization, settings round-trip in all used scopes, event listening, slash registration/execution, chat read/update, iframe script execution, prompt/generation behaviors, refresh recovery, disable cleanup, console and backend diagnostics, and packaged Electron execution.

No row is marked passed by this research. These are proposed executable acceptance cases.

## 15. Open questions

1. Can Web Trusted mode enforce per-plugin external network denial if code runs in the main window? If not, is main-window mode restricted to an explicitly broader trust grant?
2. Can a dedicated Electron renderer reproduce enough main-page DOM and internal module behavior without embedding substantial ST code?
3. What is the exact license/distribution position for reusing SillyTavern AGPL-3.0 code or JS-Slash-Runner AFPL-labelled code? Legal review is required before option F or copied adapters.
4. Should disable require full page/renderer reload, or is ownership instrumentation a product requirement?
5. Which 151 imported names must be genuine in V0.18 versus deferred with a hard diagnostic? Fixture traces are needed.
6. Which JS-Slash-Runner remote resources are essential, optional, update-only or user-authored? Runtime network logs under explicit consent are needed.
7. How should concurrent RoleAgent UI edits and plugin mutations of chat/settings be revisioned and reconciled?
8. Which generation operations require a per-call user confirmation, budget disclosure or model permission?
9. Does production Electron CSP allow required blob/srcdoc/module behavior on Windows, macOS and Linux?
10. What upstream snapshot/update policy triggers compatibility re-certification?

## 16. Source references

### RoleAgent

- `apps/server/prisma/schema.prisma:L198-L216`
- `packages/shared/src/index.ts:L13-L43`, `L73-L110`
- `apps/server/src/services/extensionManager.ts:L539-L642`, `L730-L1027`, `L2073-L2237`
- `apps/server/src/services/extensionAssets.ts:L4-L29`, `L44-L227`
- `apps/server/src/services/extensionCompatRuntime.ts:L29-L105`, `L108-L543`, `L549-L590`
- `apps/server/src/routes/extensions.ts:L197-L368`
- `apps/web/src/components/ExtensionRuntimePanel.tsx:L202-L669`
- `apps/web/src/components/ExtensionManagerPanel.tsx:L60-L238`, `L360-L508`
- `apps/web/src/api.ts:L150-L263`

### SillyTavern

- `src/endpoints/extensions.js:L20-L34`, `L84-L151`, `L476-L514`
- `public/scripts/extensions.js:L383-L500`, `L533-L873`, `L1397-L1588`, `L1783-L1808`, `L2008-L2039`, `L2293-L2315`
- `public/scripts/st-context.js:L1-L309`
- `public/scripts/events.js:L1-L113`
- `public/lib/eventemitter.js:L29-L59`, `L109-L157`
- `public/script.js:L464-L470`, `L740-L788`, `L7852-L7976`, `L7992-L8055`
- `public/scripts/slash-commands.js` and `public/scripts/slash-commands/SlashCommandParser.js`
- `public/index.html:L8186-L8204`

### JS-Slash-Runner

- `manifest.json`, `package.json`, `vite.config.ts`
- `src/index.ts`, `src/Panel.vue`, `src/function/index.ts`
- `src/store/settings/{global,chat,character,preset}.ts`, `src/type/settings.ts`
- `src/function/generate/*`, `src/function/inject.ts`, `src/function/event.ts`, `src/function/slash.ts`
- `src/panel/{Render,Script,Toolbox,Optimize,Developer}.vue`
- `src/panel/script/iframe.ts`, `src/panel/render/iframe.ts`, `src/iframe/*`
- `src/panel/developer/listener.ts`, `src/third_party_object.ts`
- `dist/index.js`, `dist/index.css`, `lib/jsoneditor.js`, `i18n/en.json`, `@types/*`

## Appendix A. Full local `SillyTavern.getContext()` member inventory

From `public/scripts/st-context.js:L114-L306`:

`accountStorage`, `chat`, `characters`, `groups`, `name1`, `name2`, `characterId`, `groupId`, `chatId`, `getCurrentChatId`, `getRequestHeaders`, `reloadCurrentChat`, `renameChat`, `saveSettingsDebounced`, `onlineStatus`, `maxContext`, `chatMetadata`, `saveMetadataDebounced`, `streamingProcessor`, `eventSource`, `eventTypes`, `addOneMessage`, `deleteLastMessage`, `deleteMessage`, `generate`, `sendStreamingRequest`, `sendGenerationRequest`, `stopGeneration`, `tokenizers`, `getTextTokens`, `getTokenCount`, `getTokenCountAsync`, `extensionPrompts`, `setExtensionPrompt`, `updateChatMetadata`, `saveChat`, `openCharacterChat`, `openGroupChat`, `saveMetadata`, `sendSystemMessage`, `activateSendButtons`, `deactivateSendButtons`, `saveReply`, `substituteParams`, `substituteParamsExtended`, `SlashCommandParser`, `SlashCommand`, `SlashCommandArgument`, `SlashCommandNamedArgument`, `SlashCommandEnumValue`, `ARGUMENT_TYPE`, `executeSlashCommandsWithOptions`, `registerSlashCommand`, `executeSlashCommands`, `timestampToMoment`, `registerHelper`, `registerMacro`, `unregisterMacro`, `registerFunctionTool`, `unregisterFunctionTool`, `isToolCallingSupported`, `canPerformToolCalls`, `ToolManager`, `registerDebugFunction`, `renderExtensionTemplate`, `renderExtensionTemplateAsync`, `registerDataBankScraper`, `callPopup`, `callGenericPopup`, `showLoader`, `hideLoader`, `mainApi`, `extensionSettings`, `ModuleWorkerWrapper`, `getTokenizerModel`, `generateQuietPrompt`, `generateRaw`, `generateRawData`, `writeExtensionField`, `writeExtensionFieldBulk`, `getThumbnailUrl`, `selectCharacterById`, `messageFormatting`, `shouldSendOnEnter`, `isMobile`, `t`, `translate`, `getCurrentLocale`, `addLocaleData`, `tags`, `tagMap`, `menuType`, `createCharacterData`, `event_types`, `Popup`, `POPUP_TYPE`, `POPUP_RESULT`, `chatCompletionSettings`, `textCompletionSettings`, `powerUserSettings`, `getCharacters`, `getOneCharacter`, `getCharacterCardFields`, `getCharacterSource`, `importFromExternalUrl`, `importTags`, `uuidv4`, `humanizedDateTime`, `updateMessageBlock`, `appendMediaToMessage`, `ensureMessageMediaIsArray`, `getMediaDisplay`, `getMediaIndex`, `scrollChatToBottom`, `scrollOnMediaLoad`, `macros`, `loader`, `swipe`, `variables`, `loadWorldInfo`, `saveWorldInfo`, `reloadWorldInfoEditor`, `updateWorldInfoList`, `convertCharacterBook`, `getWorldInfoPrompt`, `getWorldInfoNames`, `CONNECT_API_MAP`, `getTextGenServer`, `extractMessageFromData`, `getPresetManager`, `getChatCompletionModel`, `printMessages`, `clearChat`, `ChatCompletionService`, `TextCompletionService`, `ConnectionManagerRequestService`, `updateReasoningUI`, `parseReasoningFromString`, `getReasoningTemplateByName`, `unshallowCharacter`, `unshallowGroupMembers`, `getExtensionManifest`, `openThirdPartyExtensionMenu`, `symbols`, `constants`.

Nested `swipe` contains `left`, `right`, `to`, `show`, `hide`, `refresh`, `isAllowed`, `state`. Nested `variables.local` and `.global` each contain `get`, `set`, `del`, `add`, `inc`, `dec`, `has`.

## Appendix B. JS-Slash-Runner final static imports and direct names

The 24 ST imports and names were parsed from `dist/index.js` rather than inferred from `package.json`:

- `scripts/utils.js`: `Stopwatch`, `delay`, `download`, `ensureImageFormatSupported`, `getBase64Async`, `getCharaFilename`, `getImageSizeFromDataURL`, `getSanitizedFilename`, `getStringHash`, `isDataURL`, `showFontAwesomePicker`, `uuidv4`.
- `scripts/i18n.js`: `getCurrentLocale`, `t`.
- `script.js`: `Generate`, `MAX_INJECTION_DEPTH`, `activateSendButtons`, `addOneMessage`, `baseChatReplace`, `characters`, `chat`, `chat_metadata`, `cleanUpMessage`, `clearChat`, `countOccurrences`, `deactivateSendButtons`, `default_avatar`, `default_user_avatar`, `deleteCharacter`, `eventSource`, `event_types`, `extension_prompt_roles`, `extension_prompt_types`, `extension_prompts`, `getBiasStrings`, `getCharacterCardFields`, `getCharacters`, `getCurrentChatId`, `getExtensionPromptByName`, `getExtensionPromptRoleByName`, `getMaxContextSize`, `getOneCharacter`, `getPastCharacterChats`, `getRequestHeaders`, `getThumbnailUrl`, `isOdd`, `is_send_press`, `main_api`, `messageFormatting`, `name1`, `name2`, `online_status`, `printCharacters`, `printMessages`, `reloadCurrentChat`, `reloadMarkdownProcessor`, `saveCharacterDebounced`, `saveChatConditional`, `saveMetadata`, `saveSettings`, `saveSettingsDebounced`, `scrollChatToBottom`, `selectCharacterById`, `setExtensionPrompt`, `setGenerationProgress`, `setUserName`, `showSwipeButtons`, `stopGeneration`, `substituteParams`, `substituteParamsExtended`, `system_avatar`, `system_message_types`, `this_chid`, `unshallowCharacter`, `user_avatar`.
- `scripts/world-info.js`: `DEFAULT_DEPTH`, `DEFAULT_WEIGHT`, `METADATA_KEY`, `convertCharacterBook`, `createNewWorldInfo`, `deleteWorldInfo`, `getWorldInfoPrompt`, `getWorldInfoSettings`, `loadWorldInfo`, `newWorldInfoEntryTemplate`, `parseRegexFromString`, `saveWorldInfo`, `selected_world_info`, `setWorldInfoButtonClass`, `wi_anchor_position`, `world_info`, `world_info_include_names`, `world_info_logic`, `world_info_position`, `world_names`.
- `extensions/regex/engine.js`: `getRegexedString`, `regex_placement`.
- `preset-manager.js`: `getPresetManager`.
- `extensions.js`: `extensionTypes`, `extension_settings`, `getContext`, `saveMetadataDebounced`.
- `openai.js`: `ChatCompletion`, `Message`, `MessageCollection`, `getChatCompletionModel`, `getStreamingReply`, `isImageInliningSupported`, `oai_settings`, `prepareOpenAIMessages`, `promptManager`, `proxies`, `sendOpenAIRequest`, `setOpenAIMessageExamples`, `setOpenAIMessages`, `setupChatCompletionPromptManager`, `tryParseStreamingError`.
- `macros.js`: `MacrosParser`, `getLastMessageId`.
- `RossAscends-mods.js`: `favsToHotswap`, `isMobile`.
- `power-user.js`: `flushEphemeralStoppingStrings`, `persona_description_positions`, `power_user`.
- `user.js`: `isAdmin`.
- `authors-note.js`: `NOTE_MODULE_NAME`, `metadata_keys`, `shouldWIAddPrompt`.
- `PromptManager.js`: `Prompt`, `PromptCollection`.
- `sse-stream.js`: `getEventSourceStream`.
- `personas.js`: `getUserAvatar`, `getUserAvatars`, `setUserAvatar`, `user_avatar`.
- `slash-commands.js`: `executeSlashCommandsWithOptions`.
- `SlashCommand.js`: `SlashCommand`.
- `SlashCommandArgument.js`: `ARGUMENT_TYPE`, `SlashCommandArgument`, `SlashCommandNamedArgument`.
- `SlashCommandCommonEnumsProvider.js`: `commonEnumProviders`, `enumIcons`.
- `SlashCommandEnumValue.js`: `SlashCommandEnumValue`, `enumTypes`.
- `SlashCommandParser.js`: `SlashCommandParser`.
- `popup.js`: `POPUP_TYPE`, `callGenericPopup`.
- `tokenizers.js`: `getTokenCountAsync`.

The 25th static import is `../lib/jsoneditor.js`: `Mode`, `ValidationSeverity`, `createJSONEditor`.

## Appendix C. Machine-assisted JS-Slash-Runner findings

### Events

28 distinct referenced `event_types`: `APP_READY`, `CHARACTER_DELETED`, `CHARACTER_MESSAGE_RENDERED`, `CHARACTER_RENAMED`, `CHATCOMPLETION_MODEL_CHANGED`, `CHAT_CHANGED`, `CHAT_COMPLETION_PROMPT_READY`, `CHAT_COMPLETION_SETTINGS_READY`, `GENERATE_AFTER_DATA`, `GENERATION_AFTER_COMMANDS`, `GENERATION_ENDED`, `GENERATION_STARTED`, `GENERATION_STOPPED`, `MESSAGE_DELETED`, `MESSAGE_EDITED`, `MESSAGE_RECEIVED`, `MESSAGE_SENT`, `MESSAGE_SWIPED`, `MESSAGE_SWIPE_DELETED`, `MESSAGE_UPDATED`, `MORE_MESSAGES_LOADED`, `OAI_PRESET_CHANGED_AFTER`, `OAI_PRESET_EXPORT_READY`, `PRESET_DELETED`, `PRESET_RENAMED_BEFORE`, `SETTINGS_UPDATED`, `STREAM_TOKEN_RECEIVED`, `USER_MESSAGE_RENDERED`.

### DOM selectors

61 extracted unique selector strings (dynamic template selectors excluded): `#add_avatar_button`, `#avatar_load_preview`, `#character_json_data`, `#character_replace_file`, `#character_search_bar`, `#character_world`, `#chat`, `#chat > .mes`, `#chat > .welcomePanel`, `#chat_truncation, #chat_truncation_counter`, `#create_button`, `#curEditTextarea`, `#export_button`, `#extension_floating_prompt`, `#extensions_settings`, `#form_create`, `#oai_max_context_unlocked`, `#oai_max_context_unlocked, #openai_max_context, #openai_max_context_counter`, `#openai_max_context`, `#qr--bar`, `#rm_info_avatar`, `#send_form`, `#show_more_messages`, `#stream_toggle`, `#world_button`, `#world_editor_select`, `#world_info`, `#world_info_budget`, `#world_info_budget_cap`, `#world_info_case_sensitive`, `#world_info_character_strategy`, `#world_info_depth`, `#world_info_include_names`, `#world_info_match_whole_words`, `#world_info_max_recursion_steps`, `#world_info_min_activations`, `#world_info_min_activations_depth_max`, `#world_info_overflow_alert`, `#world_info_recursive`, `#world_info_use_group_scoring`, `.TH-collapse-code-block-button`, `.TH-render > iframe`, `.avatar img`, `.ch_name .name_text`, `.character_world_info_selector`, `.chat_lorebook_button`, `.fa-copy`, `.mesIDDisplay`, `.mes_streaming`, `.mes_text`, `.mes_text, .TH-streaming`, `.open_alternate_greetings`, `.swipes-counter`, `.tokenCounterDisplay`, `[data-i18n=…]`, `[data-type]`, `chat > .mes`, `code[data-highlighted=…]`, `dialog[open]:last-of-type`, `div.TH-render`, `option[value!=…]`.

### Remote destination groups

- GitLab: update/version/changelog/manifest/type downloads for `novi028/JS-Slash-Runner`.
- `testingcf.jsdelivr.net`: jQuery/UI/touch-punch, Font Awesome, Vue/Vue Router globals, helper iframe log script, optimize scripts/readmes and community resources.
- Project/community/docs: GitHub, GitLab, GitHub Pages docs, Discord, Rentry and StageDog docs.
- `localhost:6621`: optional developer listener WebSocket.
- User/content URLs: media, avatar, script info and image fetch paths; exact destination is runtime data-dependent.

### Automated method and limitations

Read-only regex analysis covered 167 TS/Vue/JS/HTML source files plus `dist/index.js`. It counted import declarations/expressions, URL literals, network tokens, event names/methods, globals, settings properties, iframe/message patterns, slash APIs and literal selector calls. Minification, template construction, aliases and bundled library strings mean counts are a lower bound for dynamic behavior and an upper bound for semantically active URL/storage tokens. Therefore the inventories support adapter planning but do not replace runtime tracing.

## Appendix D. Network call sites and URL literal inventory

### Source network call sites

All source `fetch` sites found by automated/`rg` inspection:

- `src/util/compatibility.ts:L13` — `/api/settings/get`.
- `src/util/tavern.ts:L22,L252` — `/version`, `/api/characters/edit`.
- `src/function/character.ts:L197,L257,L315` — character create, input avatar URL, character edit.
- `src/function/extension.ts:L29,L49,L65,L100` — extension version/install/delete/update.
- `src/function/import_raw.ts:L27,L71` — character/chat import.
- `src/function/generate/index.ts:L46` — chat-completion backend status.
- `src/function/generate/responseGenerator.ts:L308,L393` — chat-completion generation.
- `src/function/generate/utils.ts:L29` — input image URL.
- `src/function/lorebook.ts:L68` — character edit for lorebook binding.
- `src/function/persona.ts:L172,L203,L371` — input avatar source, avatar upload/delete.
- `src/function/raw_character.ts:L106` — dynamically selected chat-history endpoint.
- `src/panel/Optimize.vue:L82` — remote optimize documentation URL.
- `src/panel/info/update.ts:L11,L27` — remote changelog/manifest.
- `src/panel/script/Builtin.vue:L227` — script-provided `info_url`.

No source import/use of axios and no direct `new WebSocket` were found. Socket.IO is imported at `src/panel/developer/listener.ts:L2`, constructed at L37 and registers `connect`, `connect_error`, `disconnect`, `iframe_updated`, `script_iframe_updated`, and `message_iframe_updated` at L41-L63. The final bundle contains 26 `fetch(` tokens and one `WebSocket` token; the latter is from bundled Socket.IO transport code.

### Deduplicated source URL literals/templates

The source scanner found 66 URL-like occurrences. The deduplicated literal/template inventory is:

- `http://localhost:6621`.
- `https://github.com/N0VI028/JS-Slash-Runner`.
- `https://gitlab.com/novi028/JS-Slash-Runner`.
- `https://gitlab.com/api/v4/projects/${encodeURIComponent(...)}` plus fixed GitLab API URLs generated for `CHANGELOG.md` and `manifest.json` in the built artifact.
- `https://gitlab.com/novi028/JS-Slash-Runner/-/raw/main/dist/@types.txt?ref_type=heads&inline=false`.
- `https://gitlab.com/novi028/JS-Slash-Runner/-/raw/main/dist/@types.zip?ref_type=heads&inline=false`.
- `https://n0vi028.github.io/JS-Slash-Runner-Doc`.
- `https://n0vi028.github.io/JS-Slash-Runner-Doc/guide/基本用法/如何正确使用酒馆助手.html`.
- `https://github.com/StageDog/tavern_helper_template/blob/main/util/streaming.ts`.
- `https://rentry.org/sillytavern-script-book`.
- `https://stagedog.github.io/青空莉/作品集/`.
- `https://platform.openai.com/docs/guides/vision/calculating-costs` (documentation link, not an LLM request endpoint).
- Discord channel links `https://discord.com/channels/1134557553011998840/1296494001406345318` and `https://discord.com/channels/1291925535324110879/1374297592854216774`.
- `https://testingcf.jsdelivr.net/gh/N0VI028/JS-Slash-Runner/src/iframe/node_modules/log.js`.
- `https://testingcf.jsdelivr.net/gh/N0VI028/JS-Slash-Runner/src/panel/optimize/${name...}`.
- npm CDN resources: `@fortawesome/fontawesome-free/css/all.min.css`, `jquery-ui-touch-punch`, `jquery-ui/dist/jquery-ui.min.js`, `jquery-ui/themes/base/theme.min.css`, `jquery/dist/jquery.min.js`, `vue-router/dist/vue-router.global.prod.min.js`, and `vue/dist/vue.runtime.global.prod.min.js`, all under `https://testingcf.jsdelivr.net/npm/`.
- StageDog resource **dist scripts** under `https://testingcf.jsdelivr.net/gh/StageDog/tavern_resource/dist/酒馆助手/`: `token数过多提醒`, `一键禁用条目递归`, `世界书强制自定义排序`, `世界书繁简互换`, `保存提示词时保存预设`, `切换预设时提醒还没有保存`, `删除角色卡时删除绑定的主要世界书`, `压缩相邻消息`, `取消代码块高亮`, `标签化`, `深度条目排斥器`, `角色卡绑定预设`, `输入助手`, `预设条目更多按钮`, `预设防误触`; each ends in `/index.js`.
- Matching StageDog resource **documentation** under `https://testingcf.jsdelivr.net/gh/StageDog/tavern_resource/src/酒馆助手/<same-name>/README.md` for all fifteen names above.
- Example/user-content literals: `https://example.com/song.mp3`, `song1.mp3`, `song2.mp3`, `sound.mp3`, `sound1.mp3`, `sound2.mp3`, `audio1.mp3`, `audio2.mp3`, and `audio3.mp3` (some occur in comma/newline-separated UI examples).

Bundled-library-only URL strings (JSON Schema, W3C namespaces, Vue/Pinia/Socket.IO documentation and Vue error references) explain why the final bundle's raw URL count is larger; they are not treated as active plugin request destinations without runtime evidence.
