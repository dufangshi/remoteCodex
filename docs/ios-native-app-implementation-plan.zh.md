# iOS Native App Implementation Plan

本文档定义一个与现有 Android app 功能等同的原生 iOS app 实施计划。目标是在 `apps/ios` 下新增 Swift/SwiftUI 客户端，复用 supervisor/relay 现有 HTTP、WebSocket、文件、导出和线程事件协议，不引入跨平台 UI 或 WebView 主壳。

## 目标与边界

- 使用 Swift 和 SwiftUI 构建原生 iOS app。
- 功能目标与当前 `apps/android` 活跃范围等同，包含连接、Relay 设备管理、工作区、线程、实时事件、富消息、附件、导出、插件/Hook/MCP 信息、文件浏览和设置。
- 继续排除 Android 文档中已暂停的 shell/terminal parity，除非后续产品策略显式重新启用。
- 以现有 supervisor API 为协议源，Android Kotlin 客户端和 Web UI 作为功能与呈现参考。
- 优先实现可测试协议层和状态投影，再逐屏铺开 SwiftUI。
- 不修改 `packages/thread-ui/src`；本计划不触发 `@remote-codex/thread-ui` rebuild 要求。

## 主要参考

- Android 架构与功能范围：[android-client-architecture.md](android-client-architecture.md)
- Android 连接/恢复契约：[android-connection-flow.md](android-connection-flow.md)
- 连接与认证模式：[auth-and-connectivity-modes.md](auth-and-connectivity-modes.md)
- Android API 客户端：`apps/android/app/src/main/java/com/remotecodex/android/api/SupervisorApiClient.kt`
- Android WebSocket 客户端：`apps/android/app/src/main/java/com/remotecodex/android/api/SupervisorEventSocketClient.kt`
- Android 事件投影：`apps/android/app/src/main/java/com/remotecodex/android/thread/ThreadEventReducer.kt`
- Android 乐观投影：`apps/android/app/src/main/java/com/remotecodex/android/thread/ThreadOptimisticProjection.kt`
- Android 主界面与线程界面：`SupervisorHomeScreen.kt`、`SupervisorConnectionSetupScreen.kt`、`ThreadDetailScreen.kt`

## 建议工程结构

```text
apps/ios
  RemoteCodex.xcodeproj
  RemoteCodex
    App
      RemoteCodexApp.swift
      AppRoute.swift
      AppEnvironment.swift
    Core
      API
      Auth
      Connectivity
      Models
      Persistence
      ThreadProjection
      Utilities
    Features
      Connection
      Home
      Workspace
      ThreadDetail
      Settings
      RichContent
      Export
    Design
      GraphColors.swift
      GraphControls.swift
      RemoteCodexTheme.swift
    Resources
      Assets.xcassets
  RemoteCodexTests
  RemoteCodexUITests
```

首版保持单 iOS app target，使用目录和 Swift module 边界控制复杂度。等协议层稳定后，再考虑抽出 Swift Package targets，例如 `RemoteCodexCore`、`RemoteCodexThreadProjection`、`RemoteCodexDesign`。

## 平台与技术选择

- 最低版本：iOS 17。这样可以使用现代 SwiftUI navigation、observation、file importer/exporter、async/await 和 URLSession WebSocket。若后续必须兼容更老设备，再降到 iOS 16 并补齐兼容代码。
- UI：SwiftUI 原生实现。
- 网络：`URLSession` + async/await；WebSocket 使用 `URLSessionWebSocketTask`。
- JSON：`Codable` 为主，对动态 JSON、tool block、history detail 使用 `JSONValue` 枚举保留未知字段。
- 本地持久化：非敏感设置用 `UserDefaults`；token 使用 Keychain。
- 文件导入导出：`fileImporter`、`UIDocumentPickerViewController` bridge、`ShareLink`/`UIActivityViewController`。
- 图片解码：`Image`/`UIImage`，线程图片通过 authenticated API fetch 后本地解码。
- 富文本：首版用 SwiftUI `Text`/自研轻量 block renderer；不把 Web markdown renderer 嵌入 WebView。
- 分子/图/插件 renderer：与 Android 等同先提供 native fallback 和元数据视图，不实现完整 3D/Web plugin renderer。

## 功能等同范围

### 连接与恢复

- 支持 Intranet/local、Server、Relay 三种模式。
- Local/Intranet：保存 base URL，检查 `/api/auth/session` 与 `/healthz`，按需处理 authRequired。
- Server：登录 `/api/auth/login`，Bearer token 保护 REST 与 `/ws?token=...`。
- Relay：登录/注册 `/relay/auth/login`、`/relay/auth/register`，读取 `/relay/portal`，创建设备 `/relay/devices`，撤销设备 `DELETE /relay/devices/:deviceId`，连接 `/relay/devices/:deviceId/api/...` 和 `/relay/devices/:deviceId/ws?relaySession=...`。
- Relay account token 和 selected device id 必须分开存储；撤销当前设备只清 device id，不清 account token。
- 按 connection key 记录 last route：Home、WorkspaceDetail、ThreadDetail。
- app 重启后恢复上次连接和上次 route；失败时显示重试与连接设置，不自动擦除状态。

### Home 与设置

- 显示 supervisor session、健康状态、workspace/thread 数量和最近项目。
- Workspaces/Threads 两个 destination。
- Workspace 创建、打开、收藏、重命名、删除、刷新。
- Thread 列表搜索、状态筛选、排序、分组：running、attention、failed、recent、completed。
- 新建 thread：`POST /api/threads/start`，支持 workspace、title、provider、model、reasoning effort、approval mode。
- 导入 thread：`POST /api/threads/import`。
- 设置面板支持 System/Light/Dark 主题，runtime config、workspace settings、agent runtime list、plugin list/import/toggle。
- workspace settings 保存：`PATCH /api/config/workspace-settings`。

### Workspace detail

- Workspace 状态、路径、收藏/打开、新建 thread。
- 加载 workspace thread 子集。
- 文件树：`GET /api/workspaces/:id/files/tree`。
- 文件 preview：`GET /api/workspaces/:id/files/preview?path=...&offset=...&limit=...`。
- raw/copy/open/download/upload/save：
  - `GET /api/workspaces/:id/files/raw`
  - `GET /api/workspaces/:id/files/download`
  - `POST /api/workspaces/:id/files/upload`
  - `PUT /api/workspaces/:id/files`
- 与 Android 一样，复杂 workspace mutation、garbage 清理和完整 artifact/event/live roots 可作为后续 deferred scope，除非 goal 明确要求。

### Thread detail

- 初始 bundle 等同 Android：thread detail limit 30、workspace tree、首个文件 preview、export turns、fork turns、skills、MCP servers、hooks、model options。
- Timeline 显示 turns、user message、assistant message、tool call/result、history items、pending requests、answered notes、activity notes、live plan、token usage、context usage。
- WebSocket 连接并处理 thread event：
  - `thread.updated`
  - `thread.goal.updated`
  - `thread.goal.cleared`
  - `thread.turn.started`
  - `thread.turn.completed`
  - `thread.turn.failed`
  - `thread.turn.token.updated`
  - `thread.item.started`
  - `thread.item.completed`
  - `thread.request.created`
  - `thread.request.resolved`
  - `thread.output.delta`
  - `thread.context.updated`
  - `thread.plan.updated`
- 支持 event id/cursor/sequence 保存、replayed event 去重、output delta 去重、sequence-aware item ordering。
- 未知或复杂事件 fallback 到 aggregate detail refresh。
- 支持加载更早历史：`GET /api/threads/:id?limit=10&beforeTurnId=...`，合并 older turns 且不覆盖 live state。
- 保持 timeline tail-follow 行为：靠近底部时自动跟随，不在底部时保持位置并提供 Jump to latest。

### Composer 与线程动作

- Prompt 输入、清洗、粘贴控制字符规范化、空提交保护。
- 文件/图片附件 picker，multipart 提交 `/api/threads/:id/prompt`。
- 乐观 prompt turn：发送中、已接受、失败、后续 server turn/user message 到达后清理。
- Stop/interrupt：`POST /api/threads/:id/interrupt`。
- Resume unloaded thread：`POST /api/threads/:id/resume`。
- 设置更新：`PATCH /api/threads/:id/settings`，包括 model、reasoning effort、fast mode、collaboration/plan mode、sandbox mode。
- Goal 更新：`PATCH /api/threads/:id/goal`。
- Compact：`POST /api/threads/:id/compact`。
- Fork latest/selected turn：`GET /fork-turns` + `POST /fork`。
- Rename/delete：`PATCH /api/threads/:id`、`DELETE /api/threads/:id`。
- Pending request response：`POST /api/threads/:id/requests/:requestId/respond`，支持 approval、requestUserInput、planDecision，提交中禁用重复操作，失败后恢复。
- Hook trust/untrust：`POST /hooks/trust`、`POST /hooks/untrust`。

### 富内容与辅助面板

- Markdown/GFM 安全集合：段落、标题、列表、任务列表、blockquote、hr、table、inline code、fenced code、link、image placeholder。
- Math：实现 Android 等同的离线结构化渲染，覆盖 inline/display、sup/sub、frac、sqrt、常见符号。首版不要求完整 TeX 引擎。
- Tool block：识别 `tool-call`、`tool-result`、merged tool block，JSON pretty formatting，参数/结果 copy。
- Code block：轻量语法样式，先不追求 Shiki parity。
- Thread image asset：只允许安全 thread-relative path，经 `/api/threads/:id/assets/image` 拉取，远程/data/file/traversal path fallback 为 placeholder。
- History detail：`/items/:itemId/detail`，按 contentType/sourcePath/assetPath 渲染 JSON、Markdown、image、plain。
- Workspace panel tabs：Workspace、Tool Usage、Guide、Graph、Extensions。
- Molecule/artifact fallback：解析 XYZ/extxyz/CIF/PDB 元数据和首帧简图；完整 3D viewer 进入 deferred scope。

### 导出与分享

- Export turns：`GET /api/threads/:id/export-turns`。
- Transcript export：`GET /api/threads/:id/exports/pdf`，支持 PDF/HTML、latest/custom、turnIds、profile、includeTokenAndPrice、includeCommandOutput、includeAbsolutePaths。
- iOS 本地文件保存与系统分享分开处理，重复导出 guard，失败状态不丢弃已保存文件。
- 文件名规范化：按格式补 `.pdf`/`.html`，清理路径分隔符、非法字符、空名、过长名。

## 协议层实施任务

- [x] I1. 新建 `apps/ios` Xcode 工程，加入 SwiftUI app target、unit test target、UI test target、README。
- [x] I2. 定义 `SupervisorConnectionMode`、`SupervisorConnectionConfig`、URL normalize、REST path、WebSocket URL 生成；移植 Android `SupervisorConnectionTest` 覆盖。
- [x] I3. 实现 Keychain token store 和 UserDefaults app settings：theme、mode、base URL、auth token reference、relay device id、last route。
- [x] I4. 实现 `SupervisorAPIClient` 基础 transport：JSON request、array request、download request、multipart upload、统一错误解析。
- [x] I5. 建立 Codable DTO：auth/session/health、workspace、thread summary/detail、runtime config、agent runtimes、plugins、relay portal/devices。
- [x] I6. 覆盖所有 Android active REST method 的 Swift client 方法，并用 mocked transport 写路径、method、body、headers 测试。
- [x] I7. 实现 Relay path adapter，保证 direct 与 relay-forwarded API 使用同一业务 client。
- [x] I8. 实现 `SupervisorEventSocketClient`：连接、鉴权 query/header、thread event parse、socket state、关闭策略。
- [x] I9. 实现动态 JSON 保留模型 `JSONValue`，确保未知 event payload、tool result、history detail 不丢字段。

验收：

- `xcodebuild test -scheme RemoteCodex -destination 'platform=iOS Simulator,name=iPhone 15'` 通过协议层测试。
- REST/WebSocket URL 与 Android 对等测试样例一致。

## 状态投影实施任务

- [x] P1. 定义 Swift `ThreadProjectionState`、`ThreadEventReduceResult`。
- [x] P2. 移植 `reduceThreadEvent`，覆盖 metadata、goal、turn lifecycle、token usage、context usage、request lifecycle。
- [x] P3. 实现 `thread.output.delta` append、delta key 去重、缺失 turn fallback refresh、materialized item replacement。
- [x] P4. 实现 event stable key、seen key bounded cache、last cursor 保存。
- [x] P5. 实现 turn item upsert、sequence-aware ordering、protected streaming item id。
- [x] P6. 实现 answered request provisional note 与 server durable note reconciliation。
- [x] P7. 实现 optimistic prompt projection、accepted/started/failed 转换、server detail 到达后的清理规则。
- [x] P8. 实现 older history merge，不覆盖当前 live state、保留 detail cache。

验收：

- Swift 单测覆盖 Android `ThreadEventReducerTest` 和 `ThreadOptimisticProjectionTest` 的核心场景。
- 重放同一 event 不产生重复消息、重复 output delta 或重复 answered note。

## Presentation 与富内容任务

- [x] R1. 定义 `ThreadDetailViewModel` 输入模型，与 API DTO 分离。
- [x] R2. 移植 `ThreadDetailMapper`：detail + tree + preview + export/fork/skills/MCP/hooks/modelOptions -> thread view state。
- [x] R3. 移植 status、token、history kind、tool status、plan step labels。
- [x] R4. 实现 Markdown heuristic 和 rich block parser。
- [x] R5. 实现 plain URL、image source 安全校验、user attachment token parser。
- [x] R6. 实现 Math presentation。
- [x] R7. 实现 tool block parser 和 JSON formatter。
- [x] R8. 实现 molecule data normalization 与首帧 2D fallback model。
- [x] R9. 实现 history detail presentation：plain、JSON、Markdown、image reference、file metadata。

验收：

- 单测覆盖 Android `RichMessageBlocksTest`、`GraphChatToolBlocksTest`、`GraphChatPlainTextTest`、`MathPresentationTest`、`MarkdownImageSourcesTest`、`UserMessageSegmentsTest`、`GraphMoleculeViewerDataTest` 的 iOS 等价场景。

## SwiftUI 界面任务

- [x] U1. 建立 design tokens：light/dark graph colors、status colors、spacing、button/badge/dialog/input primitives。
- [x] U2. App route shell：Connection、Home、WorkspaceDetail、ThreadDetail、Settings overlay，支持 iPhone safe area 和 iPad split-friendly 布局。
- [x] U3. Connection flow：ModeSelect、ServerAuth、RelayAuth、RelayDevices、ConnectionSettings，按 Android connection contract 恢复状态。
- [x] U4. Relay device UI：设备列表、在线状态、refresh polling、create device、one-time token command、copy、revoke confirm、connect/offline save warning。
- [x] U5. Home workspaces：列表、创建、打开、收藏、重命名、删除、错误/忙碌状态。
- [x] U6. Home threads：搜索、筛选、排序、分组、新建/导入、打开。
- [x] U7. Settings panel：主题、runtime/workspace settings、agent runtimes、plugins import/toggle。
- [x] U8. Workspace detail：workspace 信息、scoped threads、file tree、preview、copy/open/download/upload/save。
- [x] U9. Thread top bar 与 rooms panel：back/home、settings、workspace switch、rename/export/delete/fork/new chat actions。
- [x] U10. Thread timeline：turn frame、message frame、tool accordion、reasoning accordion、history rows、pending request card、answered/activity notes、load earlier。
- [x] U11. Composer：text input、attachment chips、slash/action menu、model/effort/fast/plan controls、goal editor、context meter、jump to latest、send/stop。
- [x] U12. Workspace panel tabs：Workspace、Tool Usage、Guide、Graph、Extensions。
- [x] U13. Long detail dialogs：history details、command output/file read/file change/image/artifact inspection。
- [x] U14. Export dialog：latest/custom、PDF/HTML、turn selection、token/price option、save/share state。

验收：

- 每个主要 screen 有 SwiftUI preview 或 fixture state。
- iPhone portrait、iPhone landscape、iPad regular width 不出现文本重叠或主操作不可达。
- VoiceOver label 覆盖 icon-only controls、pending request choices、destructive actions。

## 端到端集成任务

- [x] E2E1. Local mode smoke：连接 `http://10.0.2.2` 等价的 iOS simulator host 地址应使用 `http://127.0.0.1:8787` 或 Mac host reachable URL，加载 workspace/thread。
- [x] E2E2. Server mode smoke：登录、Bearer REST、WebSocket token query、重启恢复。
- [x] E2E3. Relay mode smoke：登录/注册、设备创建、连接在线设备、relay REST 和 relay WebSocket。
- [x] E2E4. Thread streaming smoke：发送 prompt，看到 optimistic user message、running assistant placeholder、output delta、completed materialized item。
- [x] E2E5. Pending request smoke：approval、question、plan decision 三类控件提交与失败恢复。
- [x] E2E6. Workspace files smoke：tree、preview、load more、copy raw、download、upload。
- [x] E2E7. Export smoke：PDF/HTML custom turns，保存和分享。
- [x] E2E8. Relaunch restoration：按 connection key 恢复上次 Home/Workspace/Thread。

验收：

- 提供本地运行说明和至少一组可重复的 simulator manual smoke checklist。
- 若引入 XCUITest 自动化，先覆盖 connection local、home snapshot、thread detail load 三条最小路径。

## 分阶段推进顺序

### Phase 0：工程与协议骨架

完成 `I1-I5`，建立 app target、settings/keychain、URL/REST 基础、核心 DTO。此阶段 UI 只需要能启动并显示 connection placeholder。

完成标准：

- Xcode 工程可打开、可 build、unit tests 可运行。
- URL/path/auth/session/health/workspace/thread summary DTO 测试通过。

状态：已完成。`apps/ios` 现在包含 XcodeGen 管理的 `RemoteCodex.xcodeproj`、SwiftUI app target、unit/UI test targets、连接配置、Keychain/UserDefaults settings、基础 API transport、JSONValue、首批 supervisor/relay DTO 和 Phase 0 测试。验证命令：

```bash
cd apps/ios
swiftformat RemoteCodex RemoteCodexTests RemoteCodexUITests --config .swiftformat
swiftlint lint --config .swiftlint.yml RemoteCodex RemoteCodexTests RemoteCodexUITests
xcodebuild test \
  -project RemoteCodex.xcodeproj \
  -scheme RemoteCodex \
  -destination 'platform=iOS Simulator,id=B9E0BB3C-4FB0-4C86-A0E1-E578E1AFCBC9' \
  | xcbeautify
```

当前证据：SwiftLint 0 violations；`xcodebuild test` 通过 13 个 unit tests 和 1 个 UI launch test。

### Phase 1：连接与 Home

完成 `I6-I7` 中 home/settings 相关方法，完成 `U1-U7` 的可用首版。

完成标准：

- Local/Server/Relay 连接流可用。
- Home 能加载 workspace/thread snapshot。
- Workspace CRUD、Thread search/filter/group、新建 thread 可用。
- 主题和基本设置持久化。

状态：已完成初版。已新增真实 `ConnectionScreen` 和 `HomeScreen`，覆盖 Local/Server/Relay 登录入口、Relay 设备列表轮询刷新、创建、撤销、连接、离线保存警告、Home snapshot、workspace create/open/favorite/rename/delete、thread search/filter/sort/group、新建 thread、主题持久化、runtime/workspace settings 保存、agent runtime、plugin import/toggle 初版。已扩展 API client 覆盖 Phase 1 的 relay auth、relay portal/device、workspace CRUD/favorite/open、thread start/import、runtime config、workspace settings、agent runtimes、plugins endpoints，并用 mocked transport 和 ViewModel tests 验证关键 path/body/header 与状态行为。

当前证据：

```bash
cd apps/ios
swiftformat RemoteCodex RemoteCodexTests RemoteCodexUITests --config .swiftformat
swiftlint lint --config .swiftlint.yml RemoteCodex RemoteCodexTests RemoteCodexUITests
xcodebuild test \
  -project RemoteCodex.xcodeproj \
  -scheme RemoteCodex \
  -destination 'platform=iOS Simulator,id=B9E0BB3C-4FB0-4C86-A0E1-E578E1AFCBC9' \
  | xcbeautify
```

当前结果：SwiftLint 0 violations；`xcodebuild test` 通过 19 个 unit tests 和 1 个 UI launch/connection test。

`I6` 已在 Phase 2/3 后续工作中关闭：Swift client 覆盖 home/settings、workspace files、thread detail、prompt/upload、history detail、thread image asset、export、fork、skills、MCP、hooks、pending request、relay portal/device 和 connection check；shell REST 仍按本文 deferred scope 排除。

### Phase 2：Workspace detail

完成 workspace file API、`U8`。

完成标准：

- 能从 Home 进入 workspace detail。
- 能浏览文件树、加载 preview、load more、copy/open/download/upload/save。
- 能从 workspace detail 新建 thread 并进入 thread detail。

状态：已完成。已新增 `WorkspaceDetailScreen` 和 `WorkspaceDetailViewModel`，接入 Home -> Workspace 路由，覆盖 workspace 状态、scoped threads、文件树、文件 preview、load more、保存当前文件、favorite/open、workspace 内 new thread、raw copy、raw open、download/share 和系统文件 picker upload 主路径。API client 已新增 workspace tree、file preview、raw file、write file、download file、upload file 方法，并修正 query value 的 `/` 编码以匹配 Android 路径语义。UI test 通过 `--ui-test-workspace-fixture` 启动参数使用 fixture transport，从 Home 进入 Workspace detail 并验证文件操作控件可达。

当前证据：

```bash
cd apps/ios
swiftformat RemoteCodex RemoteCodexTests RemoteCodexUITests --config .swiftformat
swiftlint lint --config .swiftlint.yml RemoteCodex RemoteCodexTests RemoteCodexUITests
xcodebuild test \
  -project RemoteCodex.xcodeproj \
  -scheme RemoteCodex \
  -destination 'platform=iOS Simulator,id=B9E0BB3C-4FB0-4C86-A0E1-E578E1AFCBC9' \
  | xcbeautify
```

当前结果：SwiftLint 0 violations；`xcodebuild test` 通过 22 个 unit tests 和 2 个 UI tests。

### Phase 3：Thread detail 基础闭环

完成 thread detail bundle、presentation mapper 基础、`U9-U11` 的 message/timeline/composer 主路径。

完成标准：

- 能打开真实 thread detail。
- 能发送 prompt、interrupt、rename/delete、settings update、goal update、compact。
- Timeline 基础 turn/message/tool/history/pending request 可读。

状态：已完成。已新增 `SupervisorAPIClient+Threads.swift`，覆盖 thread detail、prompt、附件 prompt multipart、resume、rename/delete、settings、interrupt、compact、goal fetch/update/clear、fork/export turns、fork、transcript export download、skills、MCP servers、hooks trust/untrust、pending request response 的 REST 方法，并新增 mocked transport 测试验证 path、method、query、multipart body 和 JSON body。已新增 `ThreadDetailScreen` 和 `ThreadDetailViewModel`，从 Home/Workspace 路由进入真实 Thread detail，显示 thread 状态、workspace/model/goal、初始 bundle 的 workspace tree/首个 preview/export turns/fork turns/skills/MCP/hooks/model options、timeline item、composer、附件 chips、pending request card、rename、model settings、goal update/clear、resume、interrupt、compact、delete、fork latest/selected turn、PDF/HTML transcript export/save/share 主路径。当前 Thread detail UI 已补充 rooms section、Home/Latest/Actions 顶栏入口、turn disclosure frame、tool disclosure、reasoning accordion、history action rows、history copy action、answered request/activity timeline notes、live plan card、turn token/context usage row、context meter、Fast/Plan toggles、composer action menu 和 Stop/Send controls；pending request card 已支持 approval、requestUserInput、planDecision，包含单选、多选、Other custom answer、无 options free-form 输入、plan decision 单点即提交和失败后恢复；顶栏 New Chat 已接入真实 `/api/threads/start`，沿用当前 thread 的 workspace、provider、model 和 reasoning effort，成功后打开新 thread；workspace switch 已接入 `/api/workspaces` 列表、当前 workspace 标记和 Thread detail -> Workspace detail 路由；composer slash toolbox 已提供 `/fast`、`/compact`、`/goal`、`/fork`、`/mcp`、`/hooks`、`/export` root actions，并支持输入 `/` 后过滤命令；export dialog 已支持 latest/custom、PDF/HTML、turn selection、select all/clear、空 custom guard、token/price、command output、absolute paths、失败状态不丢弃上一份已保存文件；UI test 通过 fixture transport 打开 thread detail，并滚动验证 composer、live plan、token usage、context usage 和 history/tool 操作行可达。

当前证据：

```bash
cd apps/ios
swiftformat RemoteCodex RemoteCodexTests RemoteCodexUITests --config .swiftformat
swiftlint lint --config .swiftlint.yml RemoteCodex RemoteCodexTests RemoteCodexUITests
xcodebuild test \
  -project RemoteCodex.xcodeproj \
  -scheme RemoteCodex \
  -destination 'platform=iOS Simulator,id=B9E0BB3C-4FB0-4C86-A0E1-E578E1AFCBC9' \
  | xcbeautify
```

当前结果：SwiftFormat clean；SwiftLint 0 violations；`xcodebuild test -only-testing:RemoteCodexTests` 通过 79 个 unit tests；`xcodebuild test -only-testing:RemoteCodexUITests` 默认通过 6 个 UI tests，其中 live local/server/relay smoke 在未提供 base URL 时按预期 skip。`SupervisorThreadAPIClientTests` 覆盖 `/assets/image` 的 relay-forwarded path、query、filename 和 `image/png` download。`SupervisorAPIClientTests` 覆盖 relay portal 真实 `connected` 字段到 iOS `online` 状态的兼容解码。iOS 新建 thread 的 `approvalMode` 已按 Android/API contract 使用 `yolo`。

Phase 3 已关闭。真实 Local/Server/Relay streaming smoke 仍归 Phase 4/6 验收。

### Phase 4：实时投影与历史分页

完成 `I8-I9`、`P1-P8`。

完成标准：

- WebSocket streaming、本地 reducer、乐观 prompt、load earlier、request reconciliation 通过单测和 smoke。
- Reconnect/foreground resume fallback refresh 行为明确。

状态：进行中。已新增 `SupervisorEventSocketClient`，使用 `URLSessionWebSocketTask` 连接 `SupervisorConnectionConfig.webSocketURL()`，保留 Bearer header，解析 `thread.*` event envelope，维护 connecting/open/closed/failed socket state，并在 Thread detail 进入时启动事件流、离开时关闭。已新增可注入的 `SupervisorThreadEventStreaming` 工厂，Thread detail 支持异常断开后的退避重连、重连 open 后 fallback refresh、后台挂起时主动关闭且不误重连、前台恢复时刷新并重新打开事件流；本地投影保留 `lastEventCursor` 供去重和后续服务端 cursor resume 扩展。已新增 `ThreadProjectionState` 和 `reduceThreadEvent`，覆盖 `thread.updated`、goal update/clear、turn started/completed/failed/token、item started/completed、request created/resolved、output delta、context updated、plan updated，以及未知事件 fallback refresh。Reducer 支持 stable event key、bounded seen event cache、last cursor、output delta sequence 去重、sequence-aware item ordering、streaming item protected text、live plan 本地投影、provisional answered request note 与 server durable note reconciliation。已新增 optimistic prompt projection，覆盖 sending/accepted/started/failed、agent placeholder、server user message 到达后的清理规则，并接入 Thread detail send prompt。已新增 older history prepend merge 和 Thread detail `Load Earlier` 操作，加载 `beforeTurnId` 时保留当前 live state。

当前证据：

```bash
cd apps/ios
swiftformat RemoteCodex RemoteCodexTests RemoteCodexUITests --config .swiftformat
swiftlint lint --config .swiftlint.yml RemoteCodex RemoteCodexTests RemoteCodexUITests
xcodebuild test \
  -project RemoteCodex.xcodeproj \
  -scheme RemoteCodex \
  -destination 'platform=iOS Simulator,id=B9E0BB3C-4FB0-4C86-A0E1-E578E1AFCBC9' \
  -only-testing:RemoteCodexTests \
  -parallel-testing-enabled NO \
  | xcbeautify
xcodebuild test \
  -project RemoteCodex.xcodeproj \
  -scheme RemoteCodex \
  -destination 'platform=iOS Simulator,id=B9E0BB3C-4FB0-4C86-A0E1-E578E1AFCBC9' \
  -only-testing:RemoteCodexUITests \
  -parallel-testing-enabled NO \
  | xcbeautify
```

当前结果：SwiftLint 0 violations；`RemoteCodexTests` 通过 79 个 unit tests；`RemoteCodexUITests` 在 deterministic local supervisor 上通过 8 个 UI tests，其中 live server/relay smoke 在未提供 base URL 时按预期 skip。已新增可选 live local XCUITest `testLiveLocalConnectionLoadsHomeWorkspaceAndThread`，在本机临时 supervisor local mode 上通过 Home -> Workspace -> Thread 加载 smoke；已新增可选 live local workspace files XCUITest `testLiveLocalWorkspaceFilesRoundTripTreePreviewDownloadUpload`，在本机临时 supervisor local mode 上通过真实 workspace tree、preview、load more、raw copy、download 和 upload REST，并在 iOS Workspace detail UI 中验证文件树、load more、copy raw 和 download 控件链路；已新增可选 live local streaming XCUITest `testLiveLocalStreamingPromptRendersDeltaAndCompletion`，在 `REMOTE_CODEX_E2E_FAKE_RUNTIME=1` 的 deterministic supervisor 上通过真实 `/api/threads/:id/prompt`、iOS Thread detail WebSocket `thread.output.delta` 渲染、completion 后 detail refresh 和最终 transcript 渲染。已新增可选 live local pending request round-trip `testLiveLocalPendingRequestsSubmitApprovalQuestionAndPlanDecision`，通过 deterministic fake runtime 触发 approval-style request、question request、plan decision，验证 invalid response 不会清 pending request、有效 response 清空 pending request 并 materialize completion；已新增 fixture UI smoke `testPendingRequestFixtureSubmitsApprovalQuestionAndPlanDecisionControls`，覆盖 approval、question、plan decision 三类原生控件点击提交。已新增 fixture export smoke `testThreadExportFixtureExportsPDFAndHTMLCustomTurns`，覆盖 PDF/HTML custom turns 导出、本地保存后的 share 入口。已新增 live local relaunch smoke `testLiveLocalRelaunchRestoresHomeWorkspaceAndThreadByConnectionKey`，覆盖同一 local connection key 下 Home、Workspace、Thread 三类 last route 的重启恢复。已新增可选 live server XCUITest `testLiveServerConnectionAuthenticatesLoadsAndRestoresThread`，在本机临时 supervisor server mode 上通过无 cookie 401、真实 `/api/auth/login`、Bearer `/api/auth/session`、创建 workspace/thread、iOS UI 打开 Home/Workspace/Thread、Thread detail 启动 `/ws?token=...` 和 app 重启后恢复 Thread detail；已新增可选 live relay XCUITest `testLiveRelayConnectionLoadsForwardedRestAndWebSocket`，在本机临时 relay-server + relay-supervisor 上通过 relay 注册/设备创建后的 online portal、relay-forwarded workspace/thread REST、iOS UI 打开 Home/Workspace/Thread。Relay WebSocket open 用 Node 内置 WebSocket 对 `/relay/devices/:deviceId/ws?relaySession=...` 直接验证通过。

Phase 4 的 Local prompt streaming smoke 已关闭。当前 live streaming smoke 为 deterministic local runtime，通过 REST 触发 prompt 以保证后端完成时序稳定；composer 的 optimistic prompt/running placeholder 路径由 `ThreadOptimisticProjectionTests` 和 Thread detail send prompt 集成覆盖，后续若需要可再增加纯 UI keyboard composer 发送 smoke。Server/Relay 的 output delta streaming 仍可作为扩展 smoke，不阻塞本阶段关闭。

### Phase 5：富内容与辅助能力

完成 `R1-R9`、`U12-U14`。

完成标准：

- Markdown/math/tool JSON/code/image/detail/molecule fallback 与 Android active parity 对齐。
- Export、fork、skills/MCP/hooks、workspace panel tabs 可用。

状态：完成。已新增 `ThreadDetailPresentation.swift`，定义 `ThreadDetailPresentation`、turn/message/history row state、goal state、workspace context、export/fork turns、skills/MCP/hooks extension summary、model option state，以及 status/token/history/tool/plan step label helpers，并让 `ThreadDetailViewModel`/Thread detail screen 的 summary、timeline、context、extensions、export/fork 展示初步消费 presentation state 而非直接渲染 DTO。已新增 `ThreadTimelinePresentationRows.swift` 承载 timeline presentation rows，`PendingThreadRequestRow.swift` 承载 pending request rows，`ThreadDetailDialogs.swift` 承载 history detail sheet 和 export dialog。Workspace panel 已提供 Workspace/Tool Usage/Guide/Graph/Extensions tabs；history detail sheet 已接入 `/api/threads/:id/items/:itemId/detail` 并使用 fallback detail；export dialog 已支持 latest/custom、PDF/HTML、turn selection、token/price、command output、absolute paths 和保存后分享。已新增 `ThreadPresentation.swift`，覆盖 Markdown heuristic、rich block parser、plain URL/Markdown link/inline style/image segment parser、Markdown image source 安全校验、user `[PHOTO]`/`[FILE]` token parser、附件展示状态、Math presentation、history detail content type inference 和 preview builder。已新增 `GraphChatToolPresentation.swift`，覆盖 `tool-call`/`tool-result` fence 预处理、`tool-merged` preview、tool status/tone/default expanded state、flat JSON/colon/value entries、entry display state、tool parameter object formatter 和 JSON pretty printer。已新增 `GraphMoleculePresentation.swift`，覆盖 XYZ/extxyz/CIF/PDB format normalization、XYZ trajectory 拆帧、molecule 结构识别、XYZ 原子解析、首帧 2D fallback schematic model 和 source preview。Thread timeline 已接入基础 rich rendering：assistant 文本按 paragraph/heading/list/quote/rule/math/html/table/code 展示，user 文本识别附件 token 并保留 inline link/style 解析，tool code block 通过 disclosure 展示工具名、状态、call id、参数和文本结果，history row 展示 Android 对等 action label、copy action 和 detail sheet 入口，molecule code block 展示 frame/atom/source 状态与 2D schematic。新增 `ThreadDetailPresentationTests`、`ThreadPresentationTests`、`GraphChatToolPresentationTests` 与 `GraphMoleculePresentationTests`，覆盖 Android `ThreadDetailMapper`/status labels、`RichMessageBlocksTest`、`GraphChatToolBlocksTest`、`GraphChatPlainTextTest`、`MathPresentationTest`、`MarkdownImageSourcesTest`、`UserMessageSegmentsTest`、`HistoryDetailPresentationTest`、`GraphMoleculeViewerDataTest` 的核心等价场景。

当前证据：

```bash
cd apps/ios
xcodegen generate
swiftformat RemoteCodex RemoteCodexTests RemoteCodexUITests --config .swiftformat
swiftlint lint --config .swiftlint.yml RemoteCodex RemoteCodexTests RemoteCodexUITests
xcodebuild test \
  -project RemoteCodex.xcodeproj \
  -scheme RemoteCodex \
  -destination 'platform=iOS Simulator,id=B9E0BB3C-4FB0-4C86-A0E1-E578E1AFCBC9' \
  -only-testing:RemoteCodexTests \
  -parallel-testing-enabled NO \
  | xcbeautify
xcodebuild test \
  -project RemoteCodex.xcodeproj \
  -scheme RemoteCodex \
  -destination 'platform=iOS Simulator,id=B9E0BB3C-4FB0-4C86-A0E1-E578E1AFCBC9' \
  -only-testing:RemoteCodexUITests \
  -parallel-testing-enabled NO \
  | xcbeautify
```

当前结果：SwiftLint 0 violations；`RemoteCodexTests` 通过 79 个 unit tests；`RemoteCodexUITests` 默认通过 6 个 UI tests，其中 live local/server/relay smoke 在未提供 base URL 时按预期 skip。选定 live local XCUITest 在 `http://127.0.0.1:8797` 临时 supervisor local mode 上通过，覆盖真实 `/healthz`、`/api/workspaces`、`/api/threads/start` 和 iOS UI 中 Home/Workspace/Thread 加载。选定 live server XCUITest 在 `http://127.0.0.1:8798` 临时 supervisor server mode 上通过，覆盖真实登录、Bearer REST、WebSocket token query 和重启恢复。选定 live relay XCUITest 在 `http://127.0.0.1:8799` 临时 relay-server + `8796` relay-supervisor 上通过，覆盖 relay 注册/设备创建后的 online portal、relay-forwarded workspace/thread REST 和 iOS UI 中 Home/Workspace/Thread 加载；Node WebSocket open 验证 `/relay/devices/:deviceId/ws?relaySession=...` 通过。

Phase 5 已关闭。

### Phase 6：打磨、可访问性与验收

完成 E2E smoke、UI polish、错误恢复、accessibility、README。

完成标准：

- Local/Server/Relay 三模式 smoke 均通过。
- 主要 destructive action 有确认和失败恢复。
- iPhone/iPad 基础布局可用。
- 文档列出 build/test/smoke 命令和已知 deferred scope。

状态：完成。Local mode 的真实 REST + UI 加载 smoke 已通过：使用临时 SQLite 数据库和 `REMOTE_CODEX_MODE=local` 启动 supervisor，iOS simulator 连接 `http://127.0.0.1:8797`，XCUITest 创建 workspace/thread 并在 app 内打开 Home、Workspace 和 Thread detail。Workspace files smoke 已通过：XCUITest 创建真实 workspace 文件夹和长文本 fixture，验证 tree、preview offset/load more、raw、download、upload REST，并在 iOS Workspace detail UI 中点击文件树、load more、copy raw 和 download。Local prompt streaming smoke 已通过：使用 deterministic fake runtime 启动 supervisor，XCUITest 打开 Thread detail 后通过真实 prompt REST 触发 turn，验证 iOS WebSocket 渲染 `thread.output.delta`，等待后端 materialized completion 后刷新并验证最终 transcript。Pending request 已关闭：fake runtime 触发 approval-style、question、plan decision 三类 pending request，XCUITest 通过真实 REST 验证提交、失败后 pending 保留、成功后 pending 清空和 completion materialization；fixture UI smoke 覆盖三类原生控件点击提交。Export 已关闭：fixture UI smoke 覆盖 PDF/HTML custom turns 导出、本地保存和 share 入口。Relaunch restoration 已关闭：live local smoke 覆盖同一 connection key 下 Home、Workspace、Thread 三类 last route 的重启恢复。Server mode 的真实认证 smoke 已通过：使用临时 SQLite 数据库和 `REMOTE_CODEX_MODE=server` 启动 supervisor，XCUITest 验证未认证 REST 401、`/api/auth/login`、Bearer `/api/auth/session`、创建 workspace/thread、iOS UI 加载、`/ws?token=...` 和 app 重启恢复 Thread detail。Relay mode 的真实连接 smoke 已通过：临时 relay-server 注册用户并创建设备，临时 relay-supervisor 用 device token 连接 tunnel，XCUITest 验证 portal online、relay-forwarded REST 和 iOS UI 加载，Node WebSocket 验证 relay WebSocket open。

## Deferred Scope

以下内容不阻塞“与 Android 当前活跃范围等同”，除非后续 goal 明确要求：

- Shell/terminal UI 和 shell WebSocket commands。
- Provider config archive apply、runtime install/update/build/restart。
- MCP config 编辑表单、Hook create/update 表单。
- 完整 Shiki 语法高亮。
- 插件自定义 native renderer 或 Web renderer。
- 完整 3D molecule viewer。
- 可交互图编辑器、节点拖拽、pan/zoom。
- Push notification、voice session、后台长连接策略。

## 风险与决策点

- API DTO 仍可能演进；Swift `Codable` 必须保留未知字段或对 optional 宽容解析。
- Relay multipart/binary 转发在服务端文档中仍有能力边界；iOS 文件 upload/download 需要在 relay smoke 中尽早验证。
- SwiftUI 长 timeline 性能需要分批渲染、稳定 id、避免大段 markdown 每帧重算。
- Keychain item 的迁移和登出/切换账号行为必须明确，不能把 relay account 和 relay device 混为一体。
- iOS simulator 访问本机服务与 Android emulator 地址不同，E2E 文档需要单独写清。
- 如果未来要 App Store 分发，需要另行处理 network privacy、ATS、local network permission、exported file locations 和 credential wording。

## 后续 goal 使用建议

后续 goal 模式推进时，每次只选一个小阶段或一个任务组：

- 协议层优先选 `I1-I3`、`I4-I6`、`I8-I9`。
- 状态层优先选 `P1-P3`，再选 `P4-P8`。
- UI 层按 screen 推进，不要同时改 connection、home、thread detail。
- 每个 goal 结束时更新本文档 checkbox，并在最终回答列出 build/test/smoke 证据。
