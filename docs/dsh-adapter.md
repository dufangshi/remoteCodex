# DSH（DeepSeek Harness）接入：bridge 架构、差异与路线图

分支 `feat/dsh-bridge`，共享 UI 分支 `feat/dsh-bridge-ui`。实测基线为 npm `@deepseek-ai/dsh@0.2.0-rc.2`（latest），源码对照 `dsh-v0.1.5-rc.1` 与 `0.2.1-alpha.1`。

## 结论

DSH 本身是 Cordis 全插件平台，但它**刻意把 ACP 定为“仅自动化”协议**（[设计记录](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/.agents/notes/implemented/simplification/2026-07-23-acp-automation-only-protocol.md)）：只有 model/reasoning 两个 config option、按步提交的整段消息、`kind:"other"` 的通用工具卡。没有流式输出、modes、commands、plan，也没有问答、插件管理或 fork/load。只靠 ACP 永远拿不到 DSH 的主要能力，不能指望上游在 ACP 里补。

可行方案是把“DSH 插件”做成 **adapter 级扩展**，分三层：

1. DSH 侧 `deepseek-bridge.mjs`：用 DSH 官方 `--patch` 插入 ACP 所在的同一进程。
2. Rust `acp/deepseek.rs`：负责 bridge 通道和语义映射。
3. supervisor-web 的 `DshHarnessPanel`：在 `/harness` 和 设置 → 会话 中显示。

bridge 是 DSH 的又一个 carrier：它通过 `ctx.typertGateway.invoke()` 调用 DSH 自己 Web 客户端使用的 `@Remote` 方法（`commands`、`goals`、`permissionPresets`、`pluginManager`、`llm`），并订阅 DSH 自己的 session projection。它不改 DSH 内核，也不另开 Web 服务。

现有的插件清单系统（`@remote-codex/plugin-runtime`）在 Rust 重写后只剩“设备级开关终端按钮”的作用：没有面板、设置或工具箱挂点，导入返回 501。所以本次没有复用它，而是沿用已有的 `harness` 工具箱入口和 `negotiated.harness` 元数据。以后若要恢复真正的插件系统，这套“adapter 元数据 + 类型化动作 + 面板组件”可以原样迁移成一个面板贡献点。

## DSH 与 Codex / Claude Code 的差异

| 维度 | Codex（ACP + app-server bridge） | Claude Code（ACP adapter） | DSH（`dsh --profile acp`） | 接入要点 |
|---|---|---|---|---|
| 内核 | 固定 Rust 内核 | 固定内核 + SDK | 一切皆 Cordis 插件；profile = bundle 叠加 + 用户 patch | 工具、persona、插件都可能随配置变化，能力必须运行时探测 |
| 协议面 | 完整交互：modes、commands、fork、goal | 交互式：modes、commands、ExitPlanMode | 仅自动化：只有 `set_config_option`（model/reasoning） | 交互能力只能走 bridge 调 DSH 自己的 API |
| 流式 | token 级 chunk | token 级 chunk | 每步提交后一次性整段发送 | bridge 转发 `agent/assistant-stream`，再与提交块对账 |
| 权限 | ACP mode / app-server policy | ACP mode | 进程启动时读 `DSH_PERMISSION_MODE`；会话级 `/permission` | 启动 env + 运行时命令，再读 projection 确认 |
| 计划模式 | mode | mode + ExitPlanMode | `/plan` 命令；`exit_plan_mode` 走 user-questions 审阅 | bridge 下发 `/plan`，并充当问题应答方 |
| 自治工作 | goal 由 Codex 驱动 | 后台任务 | `create_goal` 或 `/goal` 后在 ACP prompt **结束后**继续自动跑轮次 | 回合持续到 DSH 空闲；Stop 时同时暂停 goal |
| 会话 | load/fork（经 bridge） | load | 只有 list/resume/close；无 load/fork/回放；所有 profile 共享 `$DSH_HOME/sessions` | 历史由 Remote Codex 自己保存 |
| 设置存储 | `CODEX_HOME` config | `CLAUDE_CONFIG_DIR` | volatile 字段整行写进 profile 的 `cordis.patch.yml`；acp 禁用 HMR，需重启；凭据在 `.credentials.yaml`（监听热更新） | 带 revision 写，标注“重连生效”，写前备份 |
| 模型 | 固定目录 | 固定目录 | 运行时 provider 注册（DeepSeek、pi-ai 的 40+ provider、自定义网关） | 可选项以 ACP 的 config options 为准；推理档位按模型逐个解析 |
| 工具展示 | 命令、diff、终端输出 | 富卡片 | 只有 `kind:"other"`、`title` = 工具名、`rawInput`、结果文本 | 尚未做：可由 bridge 转发工具的 presentation |
| 进程 | 每线程一个 | 每线程一个 | 每线程一个，空闲约 170 MB RSS | 进程级 env（权限）正好需要每线程独立进程 |
| 稳定性 | 稳定协议 | 稳定协议 | 公开 API 处于 pre-stable 阶段，0.1.5 → 0.2 已改模型目录和设置存储 | bridge 按服务逐项探测并带协议版本；任一功能缺失只降级该功能 |
| 隐私 | — | — | `session-log-deepseek.enabled` 默认把会话日志随请求上传；OTEL 默认 `FEEDBACK_ONLY` | 面板展示并可修改该开关 |

## 修复前实测到的问题

以下均在隔离 `DSH_HOME` 中用真实 DSH 0.2.0-rc.2 复现：

1. **只读线程能写工作区。** Remote Codex 的 sandbox/approval 设置从未传给 DSH，DSH 默认 workspace-write。选 Full access 也只能在 bwrap 拒绝后靠自动批准提权。
2. **模型列表不一致。** 0.2.x 的 acp 默认模型 `deepseek-v4-flash` 已不在 DeepSeek 目录中。旧的发现插件只列出目录内模型，线程当前模型不在下拉框里。
3. **没有流式输出。** 长推理期间界面一直不动，直到该步提交才一次性出现。
4. **goal 自治轮次在回合外运行。** 模型调用 `create_goal` 后，ACP prompt 先返回 `end_turn`，DSH 随后在后台继续跑：12 秒内跑到 15/256 轮。Remote Codex 看不到这些输出，也没有 Stop 可以按，只能看着 token 被消耗。
5. **`exit_plan_mode` 必然失败。** 没有问题应答方，结果是 `NO_PROVIDER`；同时 plan 模式本身也无法进入。`/compact`、`/goal` 被当作普通文本发给模型。
6. **插件清单混入 `include:` 组行**，且对任何操作都只读。
7. 仍未处理，见路线图：
   - ACP 的图片能力由 acp 行默认模型决定；默认模型不在目录中，图片输入被关闭。
   - ACP 的 list/resume 能看到 DSH Web 建的 preset 会话，恢复时会丢掉 preset。
   - 工具卡缺少 diff 和位置信息。

## bridge 架构

**启动顺序。** Rust 先在 `127.0.0.1:0` 监听并生成一次性 token，然后启动 `dsh --profile acp --patch <bridge>`，并按线程权限设置 `DSH_PERMISSION_MODE`。bridge 在 `appReady` 之后反向连接，发送 `hello` 快照（协议版本、DSH 版本、profile、各模型推理档位、权限预设、插件/bundle/provider 清单、功能开关）。Rust 收到 hello 之后才发 ACP `initialize`/`session/new`。原因是 ACP 会先于其他插件就绪，过早初始化会拿到不完整的 provider 目录。

**通道协议**（JSON lines，单行上限 2 MB）：

- Rust 调用：`snapshot`、`session`（projection、命令、运行状态）、`invoke`（白名单 Remote）、`command`（只允许 `/plan` `/permission` `/goal` `/compact`）、`settings`、`updateSetting`。
- DSH 事件：
  - `stream`：attempt 的 start、text/reasoning delta、end，delta 按 40 ms 合并；
  - `status`：idle/running；
  - `projection`：plan/goal/todos/permissions 的 client view，与 DSH Web 同源；
  - `question` / `question-cancelled`。
- Rust 用 `answer` 回复问题。

**语义映射：**

- **模型：** ACP config options 是可选项的真相源。bridge 只补充每个模型自己的推理档位和 provider 名称。切换模型后列表重新计算。
- **权限：** 产品的 sandbox 映射为 `read-only` / `workspace-write` / `danger-full-access`。每次应用前读 `permissions` projection，不一致才执行 `/permission`，执行后再读回校验。必须读回，是因为用户的 `permission.defaultPreset` 会覆盖启动 env。
  - profile 没有 permission 插件时，只有启动 env 与要求一致才放行，否则拒绝（fail closed），不会用更宽的沙箱运行。
  - DSH 对未注册的命令返回空结果，一律按错误处理。
- **plan：** `collaborationMode=plan` ↔ `/plan` / `/plan off`，pending 状态按“下一回合翻转”计算。审阅通过后，DSH 先退出 plan；运行时发出 `thread.collaboration.updated`，线程随之改回 default，避免下一回合又进入 plan。
- **问题：** DSH 的 user-questions 与产品现有的 native requestUserInput 结构一致。plan 审阅的正文放进问题文本。用户关闭问题时以错误回复 DSH；没有 active turn 时拒绝回答（fail closed）。
- **流式：** delta 先写入临时段落。提交块内容一致时不再发送；不一致时整段替换；失败的 attempt 标记为 failed，重试写入新段落。工具调用开始前清空待对账状态，保证不会重复。
- **回合：** 回合以 DSH 空闲为结束，而不是以 ACP prompt 返回为结束。
  - bridge 上报的忙碌状态覆盖根会话及其后台子代理：根空闲、子代理仍在跑时也算忙。
  - goal 激活期间的空闲判定窗口为 3 秒。
  - broadcast 丢事件时重新读取状态；bridge 断开视为空闲。
  - interrupt 先 `session/cancel`；有激活 goal 时再尽力执行 `/goal pause`。DSH 可能已自行暂停，那时失败也不影响停止结果。
  - 模式命令在全局会话锁之外执行，超时 20 秒。
- **goal / compact：** 产品的 goal 流程把 `/goal …` 作为一个回合执行；`set_goal` 映射为 edit/pause/clear；compact 走 `/compact`，不再发 prompt。

**面板动作：** `POST /api/threads/{id}/harness` 只接受类型化动作：`refresh`、`settings`、`updateSetting`（必须带 revision）、`setPluginEnabled`、`setBundleEnabled`、`stop`、`restart`，不存在原样转发任意 RPC 的入口。relay ACL 默认拒绝共享用户访问该路径（有回归测试）。

`restart` 在线程空闲时关闭该线程的 DSH 进程；下一次请求按已保存的 profile 恢复会话。旧的 `/disconnect` 接口不会重启进程。

**安全约束：**

- 只做白名单式导出：不导出插件 config、环境变量或凭据。
- 设置只接受 JSON 标量，拒绝 `!!` 开头的 YAML tag 和 `__jsExpr` 对象，因为它们会在 DSH 内执行代码。
- 应用级 bundle（base、acp-app、web-app、headless、sdk-app、sdk-minimal）锁定，防止 profile 无法启动。
- 每次写入前把 `cordis.patch.yml` 和 `package.json` 备份到 `profiles/<profile>/.remote-codex/backups/`，保留最近 10 份。

**面板：** `HarnessSettingsFields` 检测到 `harness.kind === "dsh"` 时渲染 `DshHarnessPanel`，包含：

- 会话状态：权限预设、plan、goal 轮次、todos；回合外自治运行时显示 Stop。
- 配置文件设置：精选的 volatile 字段，带 revision 并发保护。
- 插件与 bundle 开关：乐观更新，失败回滚。保存后显示“重连后生效”，并提供“重连以生效”（`restart` 后 `refresh`）。只有新进程确实反映出来的更改才会被清除。
- 设置字段带类型；被拒绝的写入保留错误提示，并恢复为存储值。
- 模型提供方列表。

## 能力覆盖

| DSH 能力 | 状态 | 方式 |
|---|---|---|
| 模型/推理档位（含自定义 provider） | ✓ | ACP + bridge 补充 |
| sandbox/审批预设 | ✓ | env + `/permission` + projection |
| plan 模式与审阅 | ✓ | `/plan` + user-questions 应答方 |
| goal（显示、创建、暂停、清除、回合内自治） | ✓ | goal projection + `/goal` |
| compact | ✓ | `/compact` |
| 流式文本/推理 | ✓ | assistant-stream |
| todos → 产品 plan 面板 | ✓ | todos projection |
| 插件启停、功能 bundle 启停 | ✓（重连生效） | pluginManager |
| profile 精选设置 | ✓（本线程立即生效，其他线程重连后） | settings.mutate |
| provider 列表 | 只读 | llm |
| 运行模式（preset：standard/ptc/minimal/cordis） | 实验验证可行，未产品化 | 见下节 |
| 凭据、provider 配置 | 未做 | 计划只写入、不读取 |
| 插件安装/卸载 | 未做 | pnpm 长任务 |
| 工具富展示（diff、位置） | 未做 | bridge 转发 presentation |
| MCP 透传、子代理/后台任务面板 | 未做 | 目前 `mcpServers: []` |
| load/fork/回放 | DSH ACP 不支持 | — |

## 运行模式（preset）实验

在 acp 进程里叠加三项：web-app 的 24 条“工具移到 preset 平面”禁用行（0.2.0-rc.2 版本）、`agent-preset-registry`、`subagent-model-selection-settings` 宿主行，以及已安装的 `dsh-web-app/presets/*.patch.yml`。然后在 `agent/created`（串行，会话发布前执行）里，对新会话调用 `agentPresets.select(agent, id)`，对已恢复的会话按 `agentPreset` projection 调用 `recompose`。实测：

- `minimal`：模型只拿到持久 bash，persona 被完整替换；
- `standard`：额外出现 `ask_user_question`、`present` 等纯 ACP 下没有的工具。

产品化前必须处理的点：

- 叠加层与 DSH 版本强耦合：禁用行镜像 web-app，应在启动前从已安装 bundle 生成，或请上游提供。
- preset 只能在第一轮之前切换（`agent-preset/locked`），UI 应放在新建线程处，首轮后锁定。
- 恢复时必须重新组合 preset，这同时修复“ACP 恢复 Web preset 会话丢 preset”的问题。

最理想的上游改动是让 DSH ACP 用标准 `configOptions`（category `mode`）公布 preset 和权限预设。

## 保证不出错的原则

1. **可选项以协议为准，状态读回确认。** 模型以 ACP options 为准；权限、plan、goal 以 DSH projection 为准，不假设命令已生效。
2. **按功能降级。** bridge 对每个服务做存在性探测；hello 带协议版本；只有 hello 失败才拒绝会话，并给出升级提示。
3. **同一 profile 的多进程语义要讲清楚。** acp 没有 HMR，设置只在执行写入的进程立即生效，其他线程需要重连；revision 是进程内计数，写入一律带 CAS。
4. **不在 ACP 进程里开 HMR**：acp 行一旦重载，会断掉所有会话，并在同一 stdio 上挂第二个读者。应用 bundle 锁定，写前备份。
5. **凭据只写不读；永不导出配置。** pi-ai 的 headers 未标记为 secret，不能出现在任何视图里。
6. **自治工作必须在回合内，或者可见、可停止。**
7. **问答没有 active turn 时 fail closed。**
8. **无密钥回归**：用 scripted provider 驱动真实 DSH 做端到端测试；升级 DSH 时至少覆盖当前 latest 与下一 alpha。

## 路线图

- **P1**
  - 运行模式选择：新建线程选择 preset，叠加层从已安装 bundle 生成。
  - 设备级 DSH 设置页：用一个短生命周期的“管理 bridge 进程”，不依赖某个线程；提供 provider 配置与凭据只写；重连前用 `--dump-config` 预检；恢复备份。
  - 工具富展示，修正图片能力对应的默认模型，MCP 透传，子代理与后台任务面板。
- **P2**
  - 插件安装/卸载：pnpm 长任务，含进度、registry 选择（DSH 内置 npmmirror 回退）、版本兼容检查和重启编排。
  - 向上游争取：ACP 的 mode/permission config options、流式 chunk、`_meta` 中的工具展示。

## 验证

均为隔离 `DSH_HOME`，未连接正式 relay 或 Supervisor：

```sh
cargo test -p remote-codex-runtime --lib                 # 121 通过（含 bridge、映射、流式对账与竞态、权限 fail closed）
cargo test -p remote-codex-relay --lib route_acl          # harness 动作仅限 owner
node --test scripts/dsh-bridge.test.mjs                  # 快照白名单、调用白名单、问答、流式、备份与 bundle 锁
pnpm --filter @remote-codex/supervisor-web exec vitest run src/components/HarnessSettingsDialog.test.tsx
pnpm --filter @remote-codex/supervisor-web typecheck

# 真实 DSH + scripted provider，无需模型密钥（dsh 需在 PATH）
E2E_REAL_DSH=1 E2E_DSH_SCRIPTED=1 E2E_DSH_HOME=/absolute/isolated-dsh-home \
  E2E_API_PORT=18875 E2E_WEB_PORT=15179 E2E_WORKSPACE_ROOT=/absolute/isolated-workspaces \
  pnpm exec playwright test e2e/dsh-bridge.spec.ts --project=desktop-chromium
```

scripted spec 在 desktop 与 mobile Chromium 上覆盖：只读阻止写入、流式与无重复、plan 审阅通过后退出 plan、goal 轮次留在回合内且可停止、面板插件开关（写前备份、重启后新进程确实生效、应用 bundle 被拒绝）。

独立代码审查发现的问题均已修复，并各自有回归测试：
- 重连不重启；
- 失败 attempt 被存成正常完成的消息；
- 缺少 permission 插件时权限 fail open；
- bridge 与 ACP 竞态导致文本重复；
- 后台子代理落在回合外；
- 设置错误被吞掉；
- UTF-8 跨读取被拆坏；
- bridge 关闭后调用仍等到超时。

真实模型的 `e2e/dsh.spec.ts` 需要 DeepSeek 或其他 provider 凭据，本次未运行；mobile 项目与 Windows 也未运行。本分支未改 runtime 版本号；正式部署需要配套的共享 UI 提交与 relay 部署。
