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

- [ ] 记录 `/api/agent-runtimes` 返回的三个 backend 状态字段：`enabled`、`installation.installed`、`installation.installedVersion`、`installation.lastError`。
- [ ] 记录 `/api/agent-runtimes/claude/models` 在未启动 turn 和已启动 turn 时的返回差异。
- [ ] 记录 `/api/agent-runtimes/opencode/models` 的返回和 provider/model id 格式。
- [ ] 确认 Claude 本机依赖：`claude --version`、`@anthropic-ai/claude-agent-sdk` import、`ClaudeRuntimeAdapter.start()`。
- [ ] 确认 OpenCode 本机依赖：`opencode --version`、`@opencode-ai/sdk/v2` import、`OpenCodeRuntimeAdapter.start()`。
- [ ] 明确当前 installer 命令：
  - Claude: `npm install -g @anthropic-ai/claude-code @anthropic-ai/claude-agent-sdk`
  - OpenCode: `npm install -g opencode-ai @opencode-ai/sdk`
- [ ] 评估 installer 是否应优先写入 workspace 依赖，而不是只依赖 global npm 可见性。

E2E gate:

- [ ] 本机 supervisor API 启动后，Web、iOS、Android 均能看到同一组 backend 状态。
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
- [ ] Relay 连接到某个 device 后，安装/更新请求命中该 device 背后的 supervisor，而不是 relay server 本身。

## Phase 2: Model Selection Parity

目标：Claude/OpenCode 的模型选择列表在 Web、iOS、Android 中都以列表形式正常展示，不能退回自由文本输入。

Checklist:

- [x] Backend 切换到 Claude 时，模型列表来自 `/api/agent-runtimes/claude/models`。
- [ ] Claude 至少展示 `sonnet`、`sonnet[1m]`、`opus`、`haiku`，并标出默认模型。
- [ ] 本轮真实测试默认使用 `haiku`，降低成本和延迟。
- [x] Backend 切换到 OpenCode 时，模型列表来自 `/api/agent-runtimes/opencode/models`。
- [ ] OpenCode 模型显示 provider/model/variant，避免用户看不懂 `anthropic/sonnet-4.5@default` 这类 id。
- [ ] 不支持 reasoning effort 的模型隐藏或禁用 reasoning selector。
- [ ] 不支持 fast/performance mode 的 backend 不展示或禁用 fast mode。
- [x] iOS、Android、Web 三端的默认模型选择逻辑一致：优先选 `isDefault`，否则选第一项。

E2E gate:

- [ ] Web 创建 Claude thread 时能选择 `haiku` 并成功提交。
- [ ] iOS 创建 Claude thread 时能选择 `haiku` 并成功提交。
- [ ] Android 创建 Claude thread 时能选择 `haiku` 并成功提交。
- [ ] OpenCode 模型列表在三端均非空且可选择。

## Phase 3: Real Claude/OpenCode Runtime Smoke

目标：不只跑 fake runtime 或 mock test，而是确认真实 Claude/OpenCode 后端可以完成 thread 生命周期。

Checklist:

- [ ] 准备独立测试数据库和 workspace，避免污染正式数据。
- [ ] 启动 supervisor API，启用 `REMOTE_CODEX_ENABLED_AGENT_PROVIDERS=codex,claude,opencode`。
- [ ] Claude 使用 `haiku` 创建 thread。
- [ ] Claude 发送短 prompt，确认收到真实 assistant 回复。
- [ ] Claude 发送文件读写类 prompt，确认默认 full-access 路径可真实读写 workspace。
- [ ] Claude 发送 plan mode prompt，确认 plan 状态和视觉状态正确。
- [ ] Claude 中断长任务，确认 turn 状态变为 interrupted。
- [ ] OpenCode 创建 thread 并发送短 prompt，确认真实 assistant 回复。
- [ ] OpenCode 文件读写和中断路径通过。
- [ ] 所有真实 smoke 的 transcript 可重新打开并恢复。

E2E gate:

- [ ] Web 真实 Claude smoke 通过。
- [ ] iOS 真实 Claude smoke 通过。
- [ ] Android 真实 Claude smoke 通过。
- [ ] Web 真实 OpenCode smoke 通过。
- [ ] iOS 真实 OpenCode smoke 通过。
- [ ] Android 真实 OpenCode smoke 通过。

## Phase 4: Running-Turn Steer Support

目标：Claude/OpenCode 都要支持运行中追加输入或提供等价体验；不能因为 `turns.steer=false` 让用户在运行中完全无法补充信息。

Checklist:

- [ ] 调研 Claude Agent SDK 是否支持向运行中 query/session 注入 input、request answer、或 continuation。
- [ ] 如果 Claude SDK 支持 live input，实现 `sendInput` 并将 capabilities `turns.steer` 改为 true。
- [ ] 如果 Claude SDK 不支持 live input，实现明确的 fallback：排队 continuation，在当前 turn 完成后自动开启隐藏 continuation turn，并保持 UI 看起来属于同一个可见 turn。
- [ ] 调研 OpenCode SDK 是否支持 running-turn input。
- [ ] 对 OpenCode 实现 live steer 或同样的 queued continuation fallback。
- [ ] UI 中运行中发送 prompt 时，不再直接报 “This backend does not support sending input while a turn is running.”。
- [ ] Pending queued steer 在 thread detail、WebView、native shell 中可见且可取消。
- [ ] 中断后 pending steer 必须清空或标记取消，避免自动执行过期指令。

E2E gate:

- [ ] Claude 长任务运行中，从 Web 输入追加信息，最终 transcript 包含并遵循追加信息。
- [ ] Claude 长任务运行中，从 iOS 输入追加信息，最终 transcript 包含并遵循追加信息。
- [ ] Claude 长任务运行中，从 Android 输入追加信息，最终 transcript 包含并遵循追加信息。
- [ ] OpenCode 同样三端通过。

## Phase 5: Claude Slash Command Parity

目标：支持 Claude Code 原生 slash command 体验，包含用户提到的 `/btw`。实施时需要用当前 Claude CLI/SDK 实际确认命令语义。

Checklist:

- [ ] 列出当前 Claude Code CLI/SDK 支持的 slash commands，并记录哪些可通过普通 prompt 透传，哪些需要 runtime API 特殊处理。
- [ ] 在 Web/iOS/Android composer 中，输入 `/` 时展示 backend-aware slash command 菜单。
- [ ] Claude backend 下包含 Claude Code 支持的命令，包括 `/btw`、`/mcp` 以及当前 CLI 实际支持的其它命令。
- [ ] OpenCode backend 下展示 OpenCode 自己支持的 slash commands，例如 `/compact`、`/fork`、`/mcp`。
- [ ] 不同 backend 的 slash command 菜单不可混用。
- [ ] slash command 执行结果进入 timeline 或 settings panel，而不是静默失败。
- [ ] 如果某条 slash command 只能在 Claude TTY 里使用，文档和 UI 要明确显示“不支持当前远程运行模式”。

E2E gate:

- [ ] Claude `/btw` 在 Web/iOS/Android 的行为一致。
- [ ] Claude `/mcp` 在三端能打开或显示合理结果。
- [ ] OpenCode `/compact` 或 `/mcp` 在三端行为一致。

## Current Local Baseline

- [x] 本机 `claude` CLI 存在，已验证版本为 `2.1.197 (Claude Code)`。
- [x] 已将 `@anthropic-ai/claude-agent-sdk` 加入 `@remote-codex/claude` workspace 依赖。
- [x] 已验证 `@anthropic-ai/claude-agent-sdk` 可以被 Node import。
- [x] 已验证 `ClaudeRuntimeAdapter.start()` 可进入 `ready`。
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
- [x] 已尝试真实 Claude `haiku` prompt smoke，链路到达 Claude Code，但当前本机 Claude 未登录。
- [ ] 登录 Claude Code 后重跑真实 `haiku` prompt smoke。当前错误：`Not logged in · Please run /login`。
- [ ] 尚未完成 Web/iOS/Android 三端真实 Claude 创建 thread E2E。
- [ ] 尚未完成 Web/iOS/Android 三端真实 OpenCode 创建 thread E2E。
