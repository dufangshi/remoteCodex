# Claude/OpenCode Backend Parity Plan

目标：让 `claude` 和 `opencode` 在 Web、iOS、Android 的 local/server/relay 三种连接形态下，具备和 Codex 尽量一致的可发现、可安装、可选择模型、可真实运行、可测试的体验。

非当前优先级：MCP 配置渲染、provider host config 归档。

## 边界说明

- `claude` 是代码层 provider id，展示名是 `Claude Code`。
- `opencode` 是代码层 provider id，展示名是 `OpenCode`。
- Local/server 模式：安装、更新、状态检测发生在当前连接的 supervisor API 所在机器。
- Relay 模式：relay server 只负责账号、设备、隧道和转发。Claude/OpenCode 不需要安装在 relay server 上，除非 relay server 同时也是某个 supervisor 设备。真正需要安装的是被连接的 relay device 上运行的 supervisor API。

## Phase 0: Runtime Inventory And Baseline

目标：确认当前 `codex`、`claude`、`opencode` 的后端状态、模型列表、安装命令、更新命令和测试入口。

Checklist:

- [x] 记录 `/api/agent-runtimes` 返回的三个 backend 状态字段：`enabled`、`installation.installed`、`installation.installedVersion`、`installation.lastError`。
- [x] 记录 `/api/agent-runtimes/claude/models` 返回 `sonnet`、`sonnet[1m]`、`opus`、`haiku`。
- [x] 记录 `/api/agent-runtimes/opencode/models` 的返回和 provider/model id 格式。
- [x] 确认 Claude 本机依赖：`claude --version`、`@anthropic-ai/claude-agent-sdk` import、`ClaudeRuntimeAdapter.start()`。
- [x] 确认 OpenCode 本机依赖：`opencode --version`、`@opencode-ai/sdk/v2` import、`OpenCodeRuntimeAdapter.start()`。
- [x] 明确当前 installer 命令：
  - Claude: `npm install -g @anthropic-ai/claude-code @anthropic-ai/claude-agent-sdk`
  - OpenCode: `npm install -g opencode-ai @opencode-ai/sdk`
- [x] 评估 installer 是否应优先写入 workspace 依赖，而不是只依赖 global npm 可见性。

E2E gate:

- [x] 本机 supervisor API 启动后，Web、iOS、Android 均能看到同一组 backend 状态。
- [ ] 未安装 runtime 时，状态显示为不可用，且不会误允许创建 thread。

## Phase 1: Unified Backend Picker And Install/Update UI

目标：所有端在创建 thread 选择 backend 时，都能看到可用和不可用 backend；不可用项置灰，但提供安装按钮；已安装项提供更新按钮。

Checklist:

- [x] Web `New Thread` 的 Backend 区域改成列表或增强 select：显示 `Codex`、`Claude Code`、`OpenCode`。
- [x] 不可用 backend 置灰，显示 `lastError` 或简短原因。
- [x] 不可用 backend 右侧显示下载按钮，调用 `POST /api/agent-runtimes/:provider/install`，body 为 `{ "action": "install" }`。
- [x] 已安装 backend 右侧显示更新按钮，调用同一路由，body 为 `{ "action": "update" }`。
- [x] 安装/更新进行中显示 busy 状态，禁用重复点击。
- [x] 安装/更新成功后自动刷新 `/api/agent-runtimes` 和当前 provider 的 `/models`。
- [x] iOS 创建 thread 界面实现同等 backend 列表、灰态、下载/更新按钮、错误展示。
- [x] Android 创建 thread 界面实现同等 backend 列表、灰态、下载/更新按钮、错误展示。
- [x] Relay 模式下按钮文案明确为“安装到当前设备”或等价表达，避免误解为安装到 relay server。
- [x] Server 模式需要保留登录鉴权；安装/更新失败时展示 supervisor API 返回的 details。

E2E gate:

- [ ] 在本机临时禁用或移除某个 runtime 后，Web/iOS/Android 都显示灰态和安装按钮。
- [ ] 点击安装后能恢复为可选 backend。
- [ ] 点击更新后状态保持可用，失败时不破坏已有可用 runtime。
- [x] Relay 连接到某个 device 后，安装/更新请求命中该 device 背后的 supervisor，而不是 relay server 本身。

## Phase 2: Model Selection Parity

目标：Claude/OpenCode 的模型选择列表在 Web、iOS、Android 中都以列表形式正常展示，不能退回自由文本输入。

Checklist:

- [x] Backend 切换到 Claude 时，模型列表来自 `/api/agent-runtimes/claude/models`。
- [x] Claude 至少展示 `sonnet`、`sonnet[1m]`、`opus`、`haiku`，并标出默认模型。
- [x] 本轮真实测试默认使用 `haiku`，降低成本和延迟。
- [x] Backend 切换到 OpenCode 时，模型列表来自 `/api/agent-runtimes/opencode/models`。
- [x] OpenCode 模型显示 provider/model/variant，避免用户看不懂 `anthropic/sonnet-4.5@default` 这类 id。
- [x] 不支持 reasoning effort 的模型隐藏或禁用 reasoning selector。
- [x] 不支持 fast/performance mode 的 backend 不展示或禁用 fast mode。
- [x] iOS、Android、Web 三端的默认模型选择逻辑一致：优先选 `isDefault`，否则选第一项。

E2E gate:

- [x] Web 创建 Claude thread 时能选择 `haiku` 并成功提交。
- [x] iOS 创建 Claude thread 时能选择 `haiku` 并成功提交。
- [x] Android 创建 Claude thread 时能选择 `haiku` 并成功提交。
- [x] OpenCode 模型列表在三端均非空且可选择。

## Phase 3: Real Claude/OpenCode Runtime Smoke

目标：不只跑 fake runtime 或 mock test，而是确认真实 Claude/OpenCode 后端可以完成 thread 生命周期。

Checklist:

- [x] 准备独立测试数据库和 workspace，避免污染正式数据。
- [x] 启动 supervisor API，启用 `REMOTE_CODEX_ENABLED_AGENT_PROVIDERS=codex,claude,opencode`。
- [x] Claude 使用 `haiku` 创建 thread。
- [x] Claude 发送短 prompt，确认收到真实 assistant 回复。
- [x] Claude 发送文件读写类 prompt，确认默认运行权限可真实读写 workspace。
- [x] Claude 发送 plan mode prompt，确认 plan 状态和视觉状态正确。
- [x] Claude 中断长任务，确认 turn 状态变为 interrupted。
- [x] OpenCode 创建 thread 并发送短 prompt，确认真实 assistant 回复。
- [x] OpenCode 文件读写和中断路径通过。
- [x] 所有真实 smoke 的 transcript 可通过 API 重新读取并恢复。

E2E gate:

- [x] Web/API 真实 Claude smoke 通过。
- [x] iOS 真实 Claude prompt smoke 通过。
- [x] Android 真实 Claude prompt smoke 通过。
- [x] Web/API 真实 OpenCode smoke 通过。
- [x] iOS 真实 OpenCode prompt smoke 通过。
- [x] Android 真实 OpenCode prompt smoke 通过。

## Phase 4: Running-Turn Steer Support

目标：Claude/OpenCode 都要支持运行中追加输入或提供等价体验；不能因为 `turns.steer=false` 让用户在运行中完全无法补充信息。

Checklist:

- [x] 调研 Claude Agent SDK 是否支持向运行中 query/session 注入 input、request answer、或 continuation。
- [ ] 如果 Claude SDK 支持 live input，实现 `sendInput` 并将 capabilities `turns.steer` 改为 true。
- [x] 如果 Claude SDK 不支持 live input，实现明确的 fallback：排队 continuation，在当前 turn 完成后自动开启隐藏 continuation turn，并保持 UI 看起来属于同一个可见 turn。
- [x] 调研 OpenCode SDK 是否支持 running-turn input。
- [x] 对 OpenCode 实现 live steer 或同样的 queued continuation fallback。
- [x] UI 中运行中发送 prompt 时，不再直接报 “This backend does not support sending input while a turn is running.”。
- [x] Pending queued steer 在 thread detail、WebView、native shell 中可见且可取消。
- [x] 中断后 pending steer 必须清空或标记取消，避免自动执行过期指令。

E2E gate:

- [x] Claude 长任务运行中，从 Web 输入追加信息，最终 transcript 包含并遵循追加信息。
- [x] Claude 长任务运行中，从 iOS 输入追加信息，最终结果包含并遵循追加信息。
- [x] Claude 长任务运行中，从 Android 输入追加信息，最终结果包含并遵循追加信息。
- [x] OpenCode 长任务运行中，从 Web 输入追加信息，最终 transcript 包含并遵循追加信息。
- [x] OpenCode 长任务运行中，从 iOS 输入追加信息，最终结果包含并遵循追加信息。
- [x] OpenCode 长任务运行中，从 Android 输入追加信息，最终结果包含并遵循追加信息。

Implementation notes 2026-07-03:

- 当前后端根因已定位：`ThreadService.sendPrompt` 在 `record.providerTurnId && record.status === "running"` 且 `resolvePromptTurnConfig().supportsRunningTurnInput === false` 时直接返回 409：`This backend does not support sending input while a turn is running.`。
- `supportsRunningTurnInput` 当前只在 runtime 同时暴露 `sendInput` 且 capabilities `turns.steer=true` 时成立；Codex 满足，Claude/OpenCode 当前都不满足。
- 现有架构已有 `thread_pending_steers`、`pendingSteers` DTO、Web/iOS/Android shared thread-ui 展示 pending steer 的基础能力；这些目前主要服务 Codex live steer。
- 对 Claude/OpenCode 的最小可靠方案应在后端实现 queued continuation fallback：运行中 prompt 先写入 pending steer；当前 turn 完成后，由 turn completion path 启动 hidden continuation turn，并使用原 turn 作为 `displayTurnId`，让 UI 看起来仍属于同一个可见 turn。
- 关键切入点：`ThreadRuntimeEventProjector` 的 `turn.completed` 分支目前会 `clearPendingSteersForTurn`；queued fallback 需要在清理前读取 pending steer，完成后按顺序启动 continuation，interrupt path 则继续清空 pending steer，避免过期指令自动执行。
- 不建议只把 409 改成成功并保留 pending steer：这样 pending steer 会在 turn 完成 reconcile 时消失，但不会被 Claude/OpenCode 执行。

Implementation notes 2026-07-03 update:

- 已实现通用 non-steer backend queued continuation fallback：当 runtime 没有 `sendInput` 或 `turns.steer=true` 时，`sendPrompt` 不再返回 409，而是写入 `thread_pending_steers`。
- `ThreadRuntimeEventProjector` 在 completed turn 上按 provider 能力决定是否保留 pending steers；Claude/OpenCode 这类 non-steer runtime 会保留队列并触发 drain，Codex live steer 仍沿用完成后清理逻辑。
- drain 逻辑会逐条消费 pending steer，启动 hidden continuation turn，并用原可见 turn 作为 `displayTurnId`；queued prompt 会作为本地 user message 投影回原 turn，最终 transcript 能看到用户追加输入。
- interrupt path 会同时清理 runtime turn id 和 display turn id 上的 pending steers，避免中断后继续自动执行旧输入。
- 已覆盖 supervisor-api fake Claude runtime：running 时第二条 prompt 返回 200、pending steer 可见、当前 turn 完成后自动启动 hidden continuation、最终同一可见 turn 包含两条 user message。
- 已修复 OpenCode 特有状态漂移：OpenCode 开始运行后可能出现 `providerTurnId` 非空但 thread `status=idle`，且历史 transcript turn id 会从 live UUID 变成 `opencode-turn-msg...`。queued fallback 现在只对 non-steer backend 放宽 active-turn 判定，并在 active turn 的远端历史 id 暂不匹配时保留 pending steer。
- 已完成真实 API queued continuation smoke：Claude haiku 和 OpenCode 均能在运行中接收第二条 prompt，detail 中出现 pending steer，当前 turn 完成后自动 hidden continuation，最终 transcript 命中 start/append marker。
- 已补齐 pending queued steer cancel：新增 supervisor API `DELETE /api/threads/:id/pending-steers/:pendingSteerId`，Web/iOS/Android WebThread client 均接入，shared thread-ui 对真实 pending steer 显示 `Cancel`，取消后不会触发 hidden continuation。
- 同步修复 pending request option/submit 按钮的 accessible name，避免内部 control id 覆盖用户可见文案；`ThreadTimeline.test.tsx` 已覆盖 101 个 timeline 用例。
- 已完成真实 Web 和 iOS WebView UI 长任务运行中追加输入 E2E；测试使用 queued continuation 写文件作为可重复验证结果，避免依赖真实模型逐字输出 marker。

Implementation notes 2026-07-03 Web UI update:

- 新增 Playwright real-backend gate `e2e/phase4-running-turn-queued-continuation.spec.ts`，默认通过 `REMOTE_CODEX_REAL_BACKEND_E2E=1` 显式开启，避免普通 E2E 依赖本机 Claude/OpenCode 登录态。
- Web E2E 流程：API 创建 workspace/thread，Web composer 发送短阻塞命令 prompt，等待 `activeTurnId` 出现后再次从 Web composer 发送追加 prompt；测试断言 UI 出现 queued prompt 和 `Cancel`，并等待 continuation 在 workspace 中写入指定文件，reload 后 UI 仍能看到该文件。
- 注意：真实 Claude/OpenCode 运行期间可能出现 `activeTurnId` 已存在但 `thread.status=idle` 的短暂状态漂移，因此 Web E2E 等待 active turn id，而不是只等 `status=running`。

Implementation notes 2026-07-03 iOS UI update:

- 新增 iOS real-backend UI tests：`testLiveLocalThreadWebViewQueuesRealClaudeHaikuContinuation` 和 `testLiveLocalThreadWebViewQueuesRealOpenCodeContinuation`。
- iOS E2E 流程：API 创建 workspace/thread，iOS WebView composer 发送短阻塞命令 prompt，等待 `activeTurnId` 出现后再次从 WebView composer 发送追加 prompt；测试等待 continuation 在 workspace 中写入指定文件，并确认 WebView 没有 `thread-webview-error`。
- OpenCode 的真实响应不应依赖逐字 marker 输出；测试改用 `sleep; echo` 触发首轮短阻塞，再用文件写入验证 queued continuation 已真实执行。

Implementation notes 2026-07-03 Android UI update:

- 新增 Android real-backend gate `e2e/android-phase4-running-turn-queued-continuation.mjs`，通过 ADB 启动真实 Android app WebView fixture，再用 WebView DevTools/CDP 操作 app 内 `remote-codex-thread-ui` composer。
- Android E2E 流程：API 创建 workspace/thread，AOSP app WebView composer 发送短阻塞命令 prompt，等待 `activeTurnId` 出现后再次从同一个 WebView composer 发送追加 prompt；测试等待 continuation 在 workspace 中写入指定文件。
- `pendingSteerObserved` 在 Android 脚本中作为诊断项输出：OpenCode/Claude 成功路径可以观察到 pending，但真实后端窗口较短时不应只依赖 pending 可见性；最终文件写入是 queued continuation 被执行的稳定证据。

## Phase 5: Claude Slash Command Parity

目标：支持 Claude Code 原生 slash command 体验。用户提到的 `/btw` 必须以当前 Claude CLI/SDK 的真实能力为准：如果当前 SDK session 不暴露它，UI 需要明确显示不可用，而不是假装可执行。

Checklist:

- [x] 列出当前 Claude Code CLI/SDK 支持的 slash commands，并记录哪些可通过普通 prompt 透传，哪些需要 runtime API 特殊处理。
- [x] 在 Web/iOS/Android composer 中，输入 `/` 时展示 backend-aware slash command 菜单。
- [x] Claude backend 下根据 SDK `system/init.slash_commands` 动态包含当前 session 实际支持的命令；`/mcp` 保留专用 panel。
- [x] OpenCode backend 下展示 OpenCode 自己支持的 slash commands：当前为 `/compact`、`/fork`。
- [x] 不同 backend 的 slash command 菜单不可混用：菜单来自当前 runtime 的 `managementSchema.toolboxItems`。
- [x] slash command 执行结果进入 timeline 或 settings panel，而不是静默失败。
- [x] 如果某条 slash command 只能在 Claude TTY 里使用，文档和 UI 要明确显示“不支持当前远程运行模式”。

E2E gate:

- [x] Claude `/btw` 在 Web/iOS/Android 的行为一致：当前 SDK session 未暴露，因此三端均显示为 disabled/unsupported。
- [x] Web/iOS/Android Claude `/mcp` 能打开或显示合理结果；iOS/Android 真实 gate 已覆盖菜单中 `/mcp` 可见。
- [x] Web/iOS/Android OpenCode `/compact`、`/fork` 可见，且当前 runtime 不支持 MCP status 时不会展示会 409 的 `/mcp` 假入口。

Implementation notes 2026-07-03:

- 本机 `claude --help` 只列出 CLI 参数和子命令，没有列出交互式 slash command 清单；`/btw` 需要继续通过 Claude Code 交互模式或 SDK 能力确认。
- 当前 runtime toolbox 初始暴露情况：Claude 至少暴露 `/mcp`，并会在 session init 后动态补充 SDK `slash_commands`；OpenCode 暴露 `/compact`、`/fork`。当前 `@opencode-ai/sdk` 没有 MCP status/list API，因此 OpenCode 暂不展示 `/mcp`。
- Web/iOS/Android 的 thread composer 均消费 backend `managementSchema.toolboxItems`，因此 backend-aware slash command 菜单可以通过 runtime toolbox schema 统一下发。
- thread composer 实现在外部本地依赖 `/Users/mac/dev/remote-codex-thread-ui/packages/thread-ui`。如果新增“prompt slash item”（例如点击 `/btw` 插入 `/btw ` 到输入框），需要同步更新该包及其 shared toolbox action/schema，再回到本 repo 重建 Web/iOS/Android thread bundle。

Implementation notes 2026-07-03 Phase 5 update:

- 已参考 Claude Agent SDK slash command 文档：SDK 会在 `system/init` message 中返回当前 session 可用的 `slash_commands`；只有不需要交互式终端的 commands 才能通过 SDK dispatch，命令可作为 prompt 发送，例如 `/compact`。
- 本机 Claude Code `2.1.197` 通过 SDK `system/init.slash_commands` 返回了 40+ 条当前 session 可用命令，包括 `/compact`、`/clear`、`/context`、`/usage`、`/goal`、`/review`、`/code-review` 等；后端会直接使用 SDK 返回值动态下发，不在代码里维护静态清单。
- 当前 SDK session 未列出 `/btw`。Claude runtime 现在会把 `/btw` 下发为 disabled `unsupported` toolbox item，描述为当前 Claude Agent SDK session 未暴露，可能需要交互式 Claude TTY 或不同 Claude Code 版本。
- Claude runtime 现在会在 `system/init` 时刷新 `managementSchema.toolboxItems`：发现的 slash commands 使用 `action: "prompt"`，点击后向 composer 插入命令文本；`/mcp` 继续使用专用 `action: "mcp"` panel。
- 已同步外部 thread-ui shared schema 和 composer toolbox：新增 `prompt`、`unsupported` actions；`prompt` 插入命令文本，`unsupported` 显示 `Unavailable` 且禁用。
- 已补齐空 prompt 输入 `/` 打开 backend-aware slash command 菜单；为避免误吞正文中的斜杠，只在 chat prompt 为空且菜单项可用时拦截。
- 已通过 focused tests 覆盖：Claude adapter 会从 SDK init 更新 slash toolbox；Web composer 会把 backend prompt slash command 插入 prompt、禁用 unsupported item，并在空 prompt 输入 `/` 时打开菜单。
- 已补 Web real-backend Phase 5 gate `e2e/phase5-slash-command-parity.spec.ts`：Claude haiku 真实启动后，Web composer 展示 SDK 动态 slash commands、禁用 unsupported `/btw`，`/compact` 会插入 prompt，`/mcp` 可打开 panel；OpenCode Web composer 展示 `/compact`、`/fork`，且不会展示当前 runtime 不支持的 `/mcp`。
- 已补 iOS WebView Phase 5 gate：`testLiveLocalThreadWebViewShowsRealClaudeSlashToolbox` 和 `testLiveLocalThreadWebViewShowsRealOpenCodeSlashToolbox` 会创建真实 backend thread，打开 app 内 WebView，验证 slash toolbox 按钮和空 prompt 输入 `/` 都能打开 backend-aware 菜单；Claude 验证 `/mcp` 可见、`/btw` disabled，OpenCode 验证 `/compact`、`/fork` 可见且不展示 `/mcp`/`/btw`。
- 已补 Android AOSP WebView Phase 5 gate `e2e/android-phase5-slash-command-parity.mjs`：通过 ADB 启动真实 Android app WebView fixture，再用 WebView DevTools/CDP 验证 slash toolbox 按钮和键入 `/` 的行为；Claude/OpenCode 断言与 iOS gate 保持一致。
- 已补 Web focused regression：Claude prompt 型 slash command（例如 `/usage`）从 backend-aware toolbox 进入 composer 后，经 `/api/threads/:id/prompt` 发送，并通过 WebSocket delta/turn completion 落入 timeline；专用命令如 `/mcp` 仍进入 settings/panel，unsupported 命令保持禁用。

## Current Local Baseline

- [x] 本机 `claude` CLI 存在，已验证版本为 `2.1.197 (Claude Code)`。
- [x] 本机 `opencode` CLI 存在，已验证版本为 `1.17.11`。
- [x] 已将 `@anthropic-ai/claude-agent-sdk` 加入 `@remote-codex/claude` workspace 依赖。
- [x] 已将 `@opencode-ai/sdk` 加入 `@remote-codex/opencode` workspace 依赖。
- [x] 已验证 `@anthropic-ai/claude-agent-sdk` 可以被 Node import。
- [x] 已验证 `@opencode-ai/sdk/v2` 可以被 Node import。
- [x] 已验证 local supervisor `/api/agent-runtimes` 返回 `codex`、`claude`、`opencode` 均 `enabled=true` 且 `installed=true`。
- [x] 已验证 local supervisor `/api/agent-runtimes/claude/models` 返回 `sonnet`、`sonnet[1m]`、`opus`、`haiku`。
- [x] 已验证 local supervisor `/api/agent-runtimes/opencode/models` 返回非空模型列表。
- [x] 已验证 `ClaudeRuntimeAdapter.start()` 可进入 `ready`。
- [x] 已修复 Claude adapter 默认覆盖 `CLAUDE_CONFIG_DIR`/`CLAUDE_HOME` 导致 SDK 路径看不到现有登录态的问题。
- [x] 已修复 supervisor-api 安装检测逻辑，使其能识别 pnpm workspace 下的 provider SDK。
- [x] 已通过临时 local supervisor 验证 `/api/agent-runtimes` 返回 `claude.enabled=true`。
- [x] 已通过临时 local supervisor 验证 `/api/agent-runtimes/claude/models` 返回 `haiku`。
- [x] 已运行 `pnpm --filter @remote-codex/claude test`，24 个测试通过。
- [x] 已运行 `pnpm --filter @remote-codex/supervisor-api test -- app.test.ts --runInBand`，238 个测试通过，1 个 skipped。
- [x] 已运行 `pnpm --filter @remote-codex/supervisor-web typecheck`。
- [x] 已运行 `pnpm --filter @remote-codex/supervisor-web exec vitest run src/pages/ThreadNewPage.test.tsx src/lib/api.test.ts`，15 个测试通过。
- [x] 已运行 iOS `xcodebuild` Debug simulator build。
- [x] 已运行 iOS `SupervisorAPIClientTests` 和 `WorkspaceDetailViewModelTests` targeted test，19 个测试通过。
- [x] 已运行 Android `:app:compileDebugKotlin`。
- [x] 已运行 Android `SupervisorApiClientTest` targeted unit test。
- [x] 已运行 `pnpm --filter @remote-codex/supervisor-api run typecheck`。
- [x] 已运行 `pnpm --filter @remote-codex/supervisor-api test -- app.test.ts`，171 个测试通过。
- [x] 已完成真实 Claude `haiku` prompt smoke，回复命中 `CLAUDE_HAIKU_SMOKE_OK`。
- [x] 已完成真实 OpenCode prompt smoke，回复命中 `OPENCODE_SMOKE_OK`。
- [x] 已完成 Web/iOS/Android 三端真实 Claude 创建 thread E2E。
- [x] 已完成 Web/iOS/Android 三端真实 OpenCode 创建 thread E2E。

## E2E Evidence 2026-07-03

- [x] Web UI + local supervisor `127.0.0.1:8931` 创建 Claude thread：`1eef488c-d172-48cd-807a-3a8346254bf0`，title `Web Claude Haiku E2E`，provider `claude`，model `haiku`，status `idle`。
- [x] Web UI + local supervisor `127.0.0.1:8931` 创建 OpenCode thread：`5fad450a-88d4-4adc-9b33-451715776721`，title `Web OpenCode E2E`，provider `opencode`，model `opencode/mimo-v2.5-free`，status `idle`。
- [x] Web/API Claude 文件写入 smoke：thread `ad666fd1-276b-402d-a90b-17e7f1d4932c`，命中 `CLAUDE_FILE_WRITE_OK_2`，文件写入 `/tmp/remote-codex-web-e2e/phase3d/claude-file-1783072338238/claude-write-smoke.txt`。
- [x] Web/API OpenCode 文件写入 smoke：thread `0cb02fe3-84da-4f34-b2b9-b5c537cf47e8`，命中 `OPENCODE_FILE_WRITE_OK_2`，文件写入 `/tmp/remote-codex-web-e2e/phase3d/opencode-file-1783072346674/opencode-write-smoke.txt`。
- [x] Web/API Claude plan smoke：thread `bf96bc7e-f0fb-4d56-a3a0-2a70bcf35e3d`，命中 `CLAUDE_PLAN_OK`。
- [x] Web/API OpenCode plan smoke：thread `cea64b30-c65d-48ad-8cf6-93303cb9a34c`，命中 `OPENCODE_PLAN_OK`。
- [x] Web/API Claude interrupt smoke：thread `9d4dbdff-e06e-4cf0-b697-4ca1bd7d7f66`，detail turns 包含 `[Request interrupted by user]`。
- [x] Web/API OpenCode interrupt smoke：thread `228cfa40-2c62-4ac6-97d3-ebda7c7140a4`，interrupt response 返回 `interrupted`；当前 adapter 在 thread detail 中以 `MessageAbortedError: Aborted` 表示中断后的 turn error。
- [x] iOS simulator 创建 Claude thread：`eb8328f1-d799-4771-b846-9abe930dc133`，title `iOS Claude Haiku Picker D96A60FE`，provider `claude`，model `haiku`，status `idle`。
- [x] iOS simulator 创建 OpenCode thread：`fa4f825e-7d97-478d-9d8e-3866a1791fe0`，title `iOS OpenCode Picker 4FB747A9`，provider `opencode`，model `opencode/mimo-v2.5-free`，status `idle`。
- [x] Android AOSP 创建 Claude thread：`27d150ac-c647-444f-9996-e01552ab6f38`，title `AndroidClaudeHaiku034312`，provider `claude`，model `haiku`，status `idle`。
- [x] Android AOSP 创建 OpenCode thread：`ba8de483-7df9-4112-9b57-8c4cc75f01d1`，title `AndroidOpenCode034648`，provider `opencode`，model `opencode/mimo-v2.5-free`，status `idle`。
- [x] iOS targeted UI tests：`testLiveLocalCreatesClaudeHaikuThreadFromWorkspacePicker`、`testLiveLocalCreatesOpenCodeThreadFromWorkspacePicker` 均通过。
- [x] iOS targeted UI test `testLiveLocalThreadWebViewComposerSubmitsRealClaudeHaikuPrompt` 通过：thread `1baab8a1-265b-4f80-9ba5-28b15f4a8a48`，provider `claude`，model `haiku`，status `idle`，transcript 命中 `IOS_CLAUDE_HAIKU_WEBVIEW_PROMPT_OK_4A9DA817`。
- [x] iOS targeted UI test `testLiveLocalThreadWebViewComposerSubmitsRealOpenCodePrompt` 通过：thread `b1422775-c7c3-4140-9ee1-e870178923ba`，provider `opencode`，model `opencode/mimo-v2.5-free`，status `idle`，transcript 命中 `IOS_OPENCODE_WEBVIEW_PROMPT_OK_EDEDA646`。
- [x] Android debug APK 使用 `./gradlew --no-configuration-cache :app:assembleDebug` 构建通过，并安装到 `emulator-5554` 后完成 UI 创建 thread 验证。
- [x] Android AOSP WebView fixture 真实 Claude prompt smoke 通过：thread `e72d1035-7f44-4f90-be28-6772fed85132`，provider `claude`，model `haiku`，status `idle`，transcript/UI 命中 `ANDROID_CLAUDE_HAIKU_WEBVIEW_PROMPT_OK_7C666B23`。
- [x] Android AOSP WebView fixture 真实 OpenCode prompt smoke 通过：thread `0f388776-55da-452b-8d1b-ed0e32a7b600`，provider `opencode`，model `opencode/mimo-v2.5-free`，status `idle`，transcript/UI 命中 `ANDROID_OPENCODE_WEBVIEW_PROMPT_OK_9C6CD0A7`。
- [x] API Phase 4 Claude queued continuation smoke 通过：thread `ba0b7a62-286c-46d1-86b4-92543970d93f`，provider `claude`，model `haiku`，transcript 命中 `PHASE4_CLAUDE_QUEUE_START_944D1CF5` 和 `PHASE4_CLAUDE_QUEUE_APPEND_944D1CF5`。
- [x] API Phase 4 OpenCode queued continuation smoke 通过：thread `a595a387-3c5c-4acb-b466-1f97d39e4942`，provider `opencode`，model `opencode/mimo-v2.5-free`，transcript 命中 `PHASE4_OPENCODE_QUEUE_START_A70D8ECF` 和 `PHASE4_OPENCODE_QUEUE_APPEND_A70D8ECF`。
- [x] Web UI Phase 4 Claude queued continuation smoke 通过：`REMOTE_CODEX_REAL_BACKEND_E2E=1 ... pnpm exec playwright test e2e/phase4-running-turn-queued-continuation.spec.ts --project=desktop-chromium --grep "claude"`，Web composer 追加输入后写入 `.local/phase4-web-e2e/workspaces/phase4-claude-7AE7A54A/phase4-claude-7ae7a54a.txt`，内容命中 `phase4_web_claude_done 7ae7a54a`。
- [x] Web UI Phase 4 OpenCode queued continuation smoke 通过：`REMOTE_CODEX_REAL_BACKEND_E2E=1 ... pnpm exec playwright test e2e/phase4-running-turn-queued-continuation.spec.ts --project=desktop-chromium --grep "opencode"`，Web composer 追加输入后写入 `.local/phase4-web-e2e/workspaces/phase4-opencode-A4603493/phase4-opencode-a4603493.txt`，内容命中 `phase4_web_opencode_done a4603493`。
- [x] iOS WebView Phase 4 Claude queued continuation smoke 通过：`xcodebuild ... -only-testing:RemoteCodexUITests/RemoteCodexUITests/testLiveLocalThreadWebViewQueuesRealClaudeHaikuContinuation test`，thread `f8430788-6bde-42ff-9d14-c9f0c22e2bb5`，provider `claude`，model `haiku`，写入 `.local/ios-e2e-workspaces/EF2E3FBF-B0AA-4FBF-844E-A4ACEB90D0D2/ios-claude-phase4-65b5593a.txt`，内容命中 `ios_claude_phase4_done 65b5593a`。
- [x] iOS WebView Phase 4 OpenCode queued continuation smoke 通过：`xcodebuild ... -only-testing:RemoteCodexUITests/RemoteCodexUITests/testLiveLocalThreadWebViewQueuesRealOpenCodeContinuation test`，thread `55195502-d7ac-4d73-a2a1-2f13d2e7f734`，provider `opencode`，model `opencode/mimo-v2.5-free`，写入 `.local/ios-e2e-workspaces/7B2D3993-C7D3-42B9-B12E-8C9CDDEF8B57/ios-opencode-phase4-cea9b144.txt`，内容命中 `ios_opencode_phase4_done cea9b144`。
- [x] Android AOSP WebView Phase 4 Claude queued continuation smoke 通过：`ANDROID_E2E_API_BASE=http://127.0.0.1:8932 ANDROID_E2E_ANDROID_BASE=http://10.0.2.2:8932 ANDROID_PHASE4_PROVIDER=claude pnpm exec node e2e/android-phase4-running-turn-queued-continuation.mjs`，thread `45cfbda2-ed1c-4d79-80ce-25122da1f4d5`，provider `claude`，model `haiku`，写入 `.local/android-phase4-e2e/workspaces/android-claude-45158a6d/android-claude-phase4-45158a6d.txt`，内容命中 `android_claude_phase4_done 45158a6d`。
- [x] Android AOSP WebView Phase 4 OpenCode queued continuation smoke 通过：`ANDROID_E2E_API_BASE=http://127.0.0.1:8932 ANDROID_E2E_ANDROID_BASE=http://10.0.2.2:8932 ANDROID_PHASE4_PROVIDER=opencode pnpm exec node e2e/android-phase4-running-turn-queued-continuation.mjs`，thread `8e42e0da-9c19-4341-aba2-6f69b658e36b`，provider `opencode`，model `opencode/mimo-v2.5-free`，写入 `.local/android-phase4-e2e/workspaces/android-opencode-802c5f7a/android-opencode-phase4-802c5f7a.txt`，内容命中 `android_opencode_phase4_done 802c5f7a`。
- [x] Web Phase 5 slash command parity smoke 通过：`REMOTE_CODEX_REAL_BACKEND_E2E=1 REMOTE_CODEX_E2E_BASE_URL=http://127.0.0.1:8935 pnpm --filter @remote-codex/supervisor-web exec playwright test ../../e2e/phase5-slash-command-parity.spec.ts --project=chromium`；Claude haiku 展示 SDK 动态 slash commands、禁用 unsupported `/btw`、`/compact` 插入 prompt、`/mcp` 打开 panel；OpenCode 展示 `/compact`、`/fork` 且不展示 `/mcp`/`/btw`。
- [x] iOS WebView Phase 5 slash command parity smoke 通过：`REMOTE_CODEX_IOS_E2E_BASE_URL=http://127.0.0.1:8936 xcodebuild -project apps/ios/RemoteCodex.xcodeproj -scheme RemoteCodex -destination 'platform=iOS Simulator,name=iPhone 17 Pro,OS=27.0' -only-testing:RemoteCodexUITests/RemoteCodexUITests/testLiveLocalThreadWebViewShowsRealClaudeSlashToolbox -only-testing:RemoteCodexUITests/RemoteCodexUITests/testLiveLocalThreadWebViewShowsRealOpenCodeSlashToolbox test`；Claude/OpenCode 两个真实 backend WebView 测试均通过。
- [x] Android AOSP WebView Phase 5 slash command parity smoke 通过：`ANDROID_E2E_API_BASE=http://127.0.0.1:8936 ANDROID_E2E_ANDROID_BASE=http://10.0.2.2:8936 pnpm exec node e2e/android-phase5-slash-command-parity.mjs`；Claude thread `a17a6ac9-12bc-440e-a560-12e577b5cb06`，model `haiku`；OpenCode thread `4591a8d9-18d9-4285-86f2-375cc0039fac`，model `opencode/mimo-v2.5-free`。
- [x] Phase 2 capability controls 覆盖：外部 `@remote-codex/thread-ui` focused tests `composerToolbox.test.ts`、`ComposerSettingsToolbar.test.tsx`、`composerPresentation.test.ts`、`useComposerToolbarProps.test.ts` 通过，确认不支持 reasoning 的模型禁用 effort selector，且不支持 performance mode 时 `/fast` 不进入 slash toolbox。
- [x] Phase 1 install recovery targeted 覆盖：Web `ThreadNewPage.test.tsx` 验证 unavailable Claude 置灰、点击 Install、刷新后自动选择 Claude `haiku` 并创建 thread；iOS `WorkspaceDetailViewModelTests/testInstallingUnavailableProviderSelectsItAndLoadsModels` 验证安装后选择刚安装 provider 并加载模型；Android native dialog 修复为安装成功后切换刚安装 provider，并在 backend 列表刷新时重新评估模型加载。
- [x] Phase 1 relay device install path 覆盖：supervisor-api focused regression `runs backend install commands on the relayed device supervisor` 验证 relay mode 下直连 install 被 auth 拒绝，而 `createRelayRequestHandler` 转发的 `POST /api/agent-runtimes/claude/install` 会在 device supervisor 执行 fake install command 并返回 enabled backend；Android/iOS API client 单测已覆盖 relay device URL 拼接。
- [x] Phase 0 installer 策略评估：Claude/OpenCode SDK 已作为 workspace package dependency 存在，runtime import 先走本地 package resolution、再 fallback 到 npm global；安装状态检测也会识别 workspace `packages/claude/node_modules` 与 `packages/opencode/node_modules`。安装/更新命令仍应保留全局 CLI+SDK 安装，因为 `claude`、`opencode` 可执行文件必须在 supervisor 所在设备的 configured command/PATH 中可见；不建议改成只写 workspace dependency。
- [x] Phase 4 SDK live-input 调研：本地 `@anthropic-ai/claude-agent-sdk` 暴露的是单次 `query()`/`streamInput(prompt)` query flow，当前 adapter 无可复用的 running query input channel；本地 `@opencode-ai/sdk/v2` session surface 使用 `session.prompt(...)`、`abort(...)`、`wait(...)`、`messages(...)`，未暴露向运行中 prompt 注入 input 的方法。因此 Claude/OpenCode 保持 queued continuation fallback，暂不把 `turns.steer` 改为 true。
- [x] Pending queued steer cancel 覆盖：`pnpm --filter @remote-codex/supervisor-api test -- app.test.ts` 通过 172 个测试；新增 fake Claude cancel 用例确认取消后不会启动 hidden continuation。
- [x] Shared thread-ui pending steer cancel 覆盖：`pnpm --filter @remote-codex/supervisor-web exec vitest run src/components/ThreadTimeline.test.tsx` 通过 101 个测试；包含真实 pending steer `Cancel` adapter 调用和 pending request accessible name 回归。
- [x] iOS WebThread API cancel 覆盖：`pnpm --filter @remote-codex/ios-thread-web test -- IOSApiClient.test.ts` 通过 38 个测试。
- [x] 已运行 `pnpm --filter @remote-codex/supervisor-api run typecheck`、`pnpm --filter @remote-codex/supervisor-web run typecheck`、`pnpm --filter @remote-codex/ios-thread-web run typecheck`、`pnpm --filter @remote-codex/android-thread-web run typecheck`。
- [x] 已运行 `pnpm --filter @remote-codex/supervisor-web run build`、`pnpm --filter @remote-codex/ios-thread-web run build`、`pnpm --filter @remote-codex/android-thread-web run build`，确认 shared thread-ui 新 dist 可被三端打包。

## Remaining High-Value Gaps

- [ ] 未安装 runtime 的灰态、安装按钮、安装后恢复，在 Web/iOS/Android 三端各跑一次真实 E2E。
- [x] Relay device 模式下的安装/更新请求路径已单独验证，确认命中 device supervisor 而不是 relay server。
- [x] slash command 执行结果落入 timeline/settings panel 的产品形态已补 Web focused regression：prompt command 经正常 prompt/timeline 路径显示结果，panel command 进入对应 panel，unsupported item 禁用。
