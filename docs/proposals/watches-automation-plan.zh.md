# Watches 与统一自动化研究方案

研究日期：2026-10-08。研究线程：58e727fc-30b6-4473-b6ef-1e72cbab8520（nf-watches-plan）；父线程：a233a03f-bcd6-4e8e-9b77-2e5d5e30134e。

仅研究，未修改产品代码、未启动定时任务、未安装/升级 harness、未运行测试、未提交、未部署。原始研究报告目录为 `.temp/research/narrafork-implementation/revision/`；父线程复核后归档此副本到预览分支。

## 1. 结论与证据口径

当前 UI 的 watches 是 **Claude 原生调度任务的历史投影**，并不是 Remote Codex 已有的通用持久化 scheduler。创建证据来自成功的 `CronCreate` 工具历史；取消证据来自成功的 `CronDelete`；空列表对账只识别特定 `CronList` 文本。原生 timer 完成回复通过 Claude 本地 JSONL transcript 的显式 `turnOrigin: scheduled` 标记回填。创建识别与执行历史恢复是两条不同链路，不能把扫描 transcript 说成创建任务，也不能把 UI active 说成实时 CronList 确认。

建议建立一个小型 Supervisor-owned `trigger → condition → action` 注册表和执行账本，复用现有 thread admission、持久化 continuation、inbox、completion notification、task dependency 和 peer outbox。不要再造另一套线程、消息、依赖任务或 shell 授权系统。Native Claude watches 继续作为外部来源投影；Supervisor automation 才承诺跨 Supervisor 重启恢复、明确 missed-run 策略与执行历史。

三项最小能力可以分两步落地：第一步支持每小时 prompt 唤醒自己，以及指定 turn/task 完成后的被动提醒；第二步以**显式受控 command wrapper**实现“某条命令执行结束后跑已授权脚本”。所有 ACP 工具的通用后置 hooks、自由交互 PTY 的命令边界识别、原生 timer 实时管理放到后续。事件默认提醒始终进 passive inbox；报告不会自动唤醒接收者。

以下标记区分证据：

- **[仓库事实]**：canonical 源码直接可证，行号以 commit `bfe6d36435eea7e8812d3d3f7640156287f2cf53` 为准。
- **[本机安装事实]**：本设备安装包的源码/类型定义，可证当前包内容，不等于用户那次 timer 的运行证据，也不代表所有设备。
- **[官方文档]**：2026-10-08 读取 primary 官方页面；不自动外推到旧版本 SDK/ACP。
- **[推断]**：由边界推出的风险/行为，未做运行实验。
- **[建议]**：尚不存在的设计、命令、schema、API。
- **[未知]**：没有成功工具 receipt、具体 session 或实验，不能宣称已验证。

组合预览 `/home/ubuntu/dev/remoteCodex.worktrees/nf-combined-preview` 的 HEAD 为 `88128d2edd8ac91cb839075c875513c7e0210ae4`。已只读核对：`crates/runtime/src/service/watches.rs` 与 canonical 完全相同；相对 canonical 的 crates 改动集中于 file documents、HTTP/relay 路由、service/lib/DB 接入，未新增 scheduler/automation 实现。报告引用 canonical 行号，实施时必须重新定位预览中 service/http/db 的移动行号。当前树没有 `crates/controlplane/`；Rust 控制面是 `crates/runtime` 的 `Supervisor` 与 `crates/supervisor` HTTP 层，不能设计成不存在的 crate。

## 2. 现有链路逐项核实

| 关键现状 | 证据（canonical 路径:起始行） | 含义与限制 |
| --- | --- | --- |
| [仓库事实] watches API 只有 GET | `crates/supervisor/src/http.rs:220`, `:1503` | `/api/threads/{id}/watches` 调 `state.thread_watches`；没有在该路由创建/停用/取消 scheduler 的入口。 |
| [仓库事实] 只支持 Claude / ACP claude | `crates/runtime/src/service/watches.rs:327` | 其他 provider 返回空 watches；不能把当前 UI 当成 Codex/Grok 自动化支持。 |
| [仓库事实] 创建数据来自工具历史 | `crates/runtime/src/service/watches.rs:349` | 查询 `thread_history_items.item_json` 的 text 精确等于 CronCreate/CronDelete/CronList；JOIN `kv turn-process:{turnId}`。没有扫描 scheduled_tasks.json 创建 watch。 |
| [仓库事实] Input/Result 是格式化 detailText | `crates/runtime/src/service/watches.rs:64`; `crates/runtime/src/acp/mapper.rs:589` | detailText 中的 Input JSON 加 Result/Output 文本；不是 Cron tool API RPC。映射器从 ACP rawInput/rawOutput/content 生成。 |
| [仓库事实] 只接受成功工具 | `crates/runtime/src/service/watches.rs:78`, `:120` | 先检查工具 header Status，再回退 item.status，避免 enclosing interrupted turn 覆盖成功工具。普通 assistant 说“设好了”不够。 |
| [仓库事实] 创建成功采用文本解析 | `crates/runtime/src/service/watches.rs:173` | 必须有 cron、prompt，结果包含 scheduled，能解析 `job …` ID。recurring 读输入，否则看结果；expiresAt 从 `expires after N days` 加创建时间。不是完整 cron engine。 |
| [仓库事实] CronDelete/CronList 对账很窄 | `crates/runtime/src/service/watches.rs:129`, `:148` | 只识别精确 `No scheduled jobs.`；删除接受几种精确成功句子。非空 CronList 不做逐 job 对账，外部取消/漏记录可能仍 active。 |
| [仓库事实] active 是同进程实例推导 | `crates/runtime/src/service/watches.rs:201`; `crates/runtime/src/acp/runtime.rs:2584`; `crates/runtime/src/service.rs:407` | expiry、currentStarted、durable 输入、turn-process instance 决定 expired/sessionEnded/active/unconfirmed；active 不是直接读取原生 scheduler 的存在状态。 |
| [仓库事实] 历史恢复只读且只收 scheduled | `crates/runtime/src/service/claude_history.rs:1`, `:42` | sessionId 必须吻合；排除 isSidechain；要求 user turnOrigin=scheduled、UUID、timestamp 不早于 thread.createdAt。不是按文本“定时”猜测。 |
| [仓库事实] 恢复扫描实际路径 | `crates/runtime/src/service/claude_history.rs:221` | 在配置的 claude_home/projects 下最多深度 2 找 `{session}.jsonl`，路径/长度/mtime 缓存；这是**恢复已执行 transcript**的文件扫描，不能误写成 timer 注册扫描。 |
| [仓库事实] 只导入完成回复 | `crates/runtime/src/service/claude_history.rs:120`, `:184` | 必须有非空 assistant text + end_turn/stop_sequence/max_tokens；live 中已有 user turn 就跳过，提交前重查 session/admission。仅 thinking、工具输出、失败/中途崩溃可能不形成完成 scheduled turn。 |
| [仓库事实] 恢复去重且通知页面 | `crates/runtime/src/service/claude_history.rs:271`, `:305`; `crates/runtime/src/service/reliability.rs:145` | `${threadId}:scheduled:${nativeUuid}` INSERT OR IGNORE，按原生时间插入 ordinal；thread.updated reason=scheduled_history_recovered；2 秒 observer 检查**已被历史读取注册**的 session，单 session 至少 5 秒节流。不是无条件全设备扫全部 sessions。 |
| [仓库事实] 执行归属仅精确 prompt + lifetime | `crates/runtime/src/service/watches.rs:227` | scheduled turn displayPrompt 精确匹配创建 prompt，限定 start/end；多个候选计 ambiguous，不计总成本；没有原生 jobId→runId 因果关系。数字是已记录/可归属运行，不是完整 scheduler audit。 |
| [仓库事实] UI 是只读轮询 | `apps/supervisor-web/src/components/ThreadWatchesControl.tsx:179`, `:223`, `:258` | Claude 页面 visible 时每 30 秒 GET；显示当前/历史、cron/prompt/创建/过期/触发/费用；无 create/pause/cancel/真实 nextRunAt，无 watches 就隐藏。API 错误静默忽略，旧 snapshot 可能留存。 |
| [仓库事实] Rust hooks 管理仍是占位 | `crates/supervisor/src/http.rs:233`, `:1651`; `crates/protocol/src/lib.rs:584` | GET 返回空 hooks/path/warnings/errors；默认 management.hooks/hookTrust false。relay ACL 中出现 hooks 路由不等于 runtime 已实现 hooks。 |
| [仓库事实] ACP Claude 有特殊 bookends | `crates/runtime/src/acp/adapter.rs:188`; `crates/runtime/src/acp/runtime.rs:2624`; `crates/runtime/src/acp/claude_lifecycle.rs:40` | 接收 session/update 和 _claude/sdkMessage，只额外请求 command_lifecycle/result/system；native 原生运行不等于每次都有 Remote Codex owned turn。不能仅 idle frame 判完成。 |

### 2.1 创建究竟属于谁

[仓库事实] 可证明的路径如下：

```text
Claude 模型请求 CronCreate
    → Claude harness 的内置调度工具运行并返回成功文本
    → ACP session/update 工具输入、输出
    → TurnMapper 形成 toolCall + detailText
    → EventBus persister 保存 thread_history_items
    → GET watches 重放成功工具记录并生成 snapshot
```

证据：`crates/runtime/src/acp/mapper.rs:146`（tool_call/tool_call_update 合并），`:434`（kind 映射），`:603`（rawInput/detail）；`crates/runtime/src/acp/runtime.rs:3298`（item 事件）；`crates/runtime/src/service.rs:433`（upsert 历史）；`crates/runtime/src/service/watches.rs:349`（查询）。所以 **CronCreate 是创建工具；ACP tool event 是观测传输；DB history 是展示持久化**。没有源码证据显示 Remote Codex 自己注册该 cron、通过 tools/event 创建它，或把 transcript 字句变成调度任务。

[本机安装事实] catalog 使用 `claude-agent-acp`，依赖安装默认 `@latest`，不是仓库固定版本（`crates/runtime/src/acp/catalog.rs:63`, `crates/runtime/src/acp/dependencies.rs:19`, `:44`）。当前本机：

- ACP adapter 0.86.0：`/home/ubuntu/.local/share/remote-codex/adapters/lib/node_modules/@agentclientprotocol/claude-agent-acp/package.json:6`。
- adapter 自带 Agent SDK 0.3.287：该目录 `node_modules/@anthropic-ai/claude-agent-sdk/package.json:3`。
- 独立 Claude CLI 2.1.289：`/home/ubuntu/.local/share/remote-codex/harnesses/lib/node_modules/@anthropic-ai/claude-code/package.json:3`。不能因 CLI 已升级就假设 adapter 自带 SDK 同步升级。

[本机安装事实] SDK `sdk-tools.d.ts:2880` 定义 CronCreateInput：cron/prompt/recurring/durable；`:2894` 的类型注释描述 durable 指向 `.claude/scheduled_tasks.json`；`:4137` 定义 CronCreateOutput `{id,humanSchedule,recurring,durable?}`，CronListOutput 是 jobs 数组；`:2905` 还存在 ScheduleWakeupInput。**类型注释不是已运行 persistence 实验，不能把 durable 文件行为宣称在用户 session 已验证。** 当前 watches 不识别 ScheduleWakeup，也没有结构化 Cron 输出 parser；若实际收到纯 JSON 结果，现有英文文本 parser 可能漏项（推断，未采集该 session 实际 receipt）。

[本机安装事实] adapter `dist/acp-agent.js:7031` 默认使用 claude_code 工具 preset，只因 elicitation 缺失禁 AskUserQuestion，未在这段专门禁 Cron；`:7115` 读取 user/project/local settings；`:7161` 附加 SDK PostToolUse 等内部 callbacks；`:365` 注明 hooks/canUseTool callbacks 不能直接跨 JSON-RPC。这些是 **harness 内部 hook**，不是当前 Rust `/hooks` API 的实现，也不能据此假定 Rust 能收到所有 PostToolUse 字段。

### 2.2 官方行为、现有投影与未知必须分开

[官方文档，摘要] [Claude scheduled tasks](https://code.claude.com/docs/en/scheduled-tasks) 描述 CronCreate/List/Delete、本地时区、忙时低优先级等待、漏周期合并、不精确 jitter、重复任务七天期限。当前页面说明部分 CronCreate 任务可在 resume/continue 恢复，动态 loop 与过期/错过时间的一次任务有例外；特定配置还描述项目 scheduled_tasks.json。执行仍需存活 session；恢复不等于设备离线时照常运行。这里只概括官方页面，未实测本机 SDK 的具体分支。

[仓库事实] `skills/thread-interaction/SKILL.md:394` 仍说 native timers 不跨 harness/Supervisor restart；UI `apps/supervisor-web/src/components/ThreadWatchesControl.tsx:260` 也使用 session timer stop 文案。这与上述当前官方恢复语义有版本差异。**实施不能沿用“所有 Cron 一律内存、不恢复”的绝对说法，也不能把新版官方恢复能力当成本仓已经适配。** 不在本研究里修改 skill/UI。

[推断] 现有 `sessionEnded` 可能误判已由新版 Claude 恢复的非 durable 任务；durable 输入只能让某些分支保持 unconfirmed，并非实时证实仍 scheduled。native lastTriggeredAt 是已完成且归属成功的记录，真实任务下一次执行因 jitter/忙态不能从 cron 精确推出。此外归属窗口使用 at < expiry（`crates/runtime/src/service/watches.rs:245`），原生在到期边缘最后一次执行有可能被投影排除；这是静态边界推断，未做过期实验。

[未知/需专项验证] 用户具体那次 CronCreate 成功 receipt、native job ID、工具/SDK/adapter 版本、durable 参数、实际 persistence；是否可用 CronList 得到真实 snapshot；重启/恢复时是否仍跑；任务取消是否经本仓被记录；scheduled turn 是否有 jobId；idle autonomous permission 能否在 UI 关联。研究没有新增工具调用验证，也未打开私人 session/DB 抽样，避免把类型或测试 fixture 说成用户实况。

权限边界已能静态确定：`crates/runtime/src/acp/runtime.rs:2677` 只有 live.active 才关联 thread/turn/bus；`:2788` guarded request DTO 也只在 active 存在时发 UI，`:2816` 300 秒无响应取消。[推断] native 自己从 idle 发起的 scheduled 权限请求可能没有 owned turn，因而 UI 无法展示该请求；有请求会取消，不代表能无人值守执行，也不能描述成总会自动批准。autoApprove 只来自现有 yolo/danger-full-access（`crates/runtime/src/acp/modes.rs:25`）。

[官方文档，摘要] [Claude hooks](https://code.claude.com/docs/en/hooks#posttooluse) 区分工具成功/失败与外部文件变化；[权限说明](https://code.claude.com/docs/en/hooks#security-considerations) 明确 command hooks 用 OS 用户权限，SDK workspace trust 也不能替代用户批准。故不要为统一 automation 静默写 `.claude/settings.json` 并借 native hooks 绕开 guarded。

## 3. 已有等待、通知、任务依赖如何复用

| 能力 | 现状/源码 | 可复用部分，不能假定的部分 |
| --- | --- | --- |
| `thread wait NAME...` | `crates/runtime/src/interaction/agents.rs:369`, `:460`; CLI `threads.rs:493`; HTTP `crates/supervisor/src/interaction.rs:143` | 返回 queued/running/blocked/lastTurn/closingMessage；等待当前 thread 状态，不是指定 immutable turn 的 permanent subscription。blocked 包括审批、未答 question；recovering 可被判 settled，不能当业务成功。 |
| `thread wait NAME... --wake` | `crates/runtime/src/interaction/agents.rs:621`, `:659` | caller 显式登记、仅自己的 descendants、KV durable、全部 settled 或一个 blocked 后事务 enqueue 一次并删注册。复用 receiver-owned wake 意图与 continuation；不把它扩成任意 inbox 自动唤醒。观察的是 member 当前状态，不是永久监听每一轮。 |
| `inbox wait --kind result --kind question` | `crates/runtime/src/interaction/inbox.rs:167`; `crates/runtime/src/interaction/agents.rs:264` | 订阅 bus 并重查持久化 KV，lagged 后重读、每秒保底检查；支持 kind/from/new，旧未 ack 邮件立即命中。它阻塞当前调用，不启动 idle thread。 |
| `--notify-on-complete` | `crates/runtime/src/interaction/mod.rs:173`, `:420`, `:590`; `crates/runtime/src/service.rs:2530` | 从 pending send 映射到执行 turn；terminal 时事务保存 passive result，恢复 worker 补发。只能用于有执行的 send，不是已有任意 turn 的通用注册 API；subscribe 与是否叫醒完全分开。 |
| task 依赖/claim | `crates/runtime/src/db.rs:118`; `crates/runtime/src/interaction/tasks.rs:260`, `:348`, `:390` | agent_tasks/agent_task_deps、原子 claim、task claim --wait；task done 通知 creator result，成功完成后依赖就绪通知 owner task，但仍 passive。复用 board 的身份/完成语义，不能把 task 完成与 thread turn 完成混为一个事件。 |
| message 路由/dedup | `crates/protocol/src/interaction.rs:6`; `crates/runtime/src/interaction/mod.rs:299`, `:331`, `:350` | inbox 默认；queue 只承载真 task；direct 按 idle/running 事务解析；steer 绑定 activeTurn，要求 concrete reason、能力支持。clientRequestId+fingerprint 重试保持原 route、冲突拒绝。 |
| queue executor | `crates/runtime/src/interaction/mod.rs:475`, `:547`; `crates/runtime/src/service/reliability.rs:133` | 持久化 thread_pending_steers continuation，在整个 turn 结束后 admission 执行；非另一 agent scheduler。queued 只表示接收，后续执行可能受 recovering/权限/后端错误阻塞。 |
| peer outbox | `crates/supervisor/src/peer_send.rs:253`, `:309`, `:417`, `:521`; `crates/runtime/src/interaction/peer.rs:50` | inbox/queue 远端可重试，durable outbox + requestId + 指纹，七天期限、退避与失败被动通知。不是精确定时/脚本 exactly-once 服务；direct/steer 不自动 outbox。 |
| runtime event bus | `crates/runtime/src/actor.rs:29`, `:58`; `crates/runtime/src/service.rs:383` | 内存 broadcast(2048)，先 persister 再广播；不是 durable event journal。completion/task 状态事务可以成为统一事件落点；不能只挂 websocket subscriber 保证不漏。 |
| relay 通知 | `crates/runtime/src/relay_notifications.rs:7`, `:27` | 仅 completed/failed，KV 通知过期一天。可保持移动/Web通知渠道；不拿它做长期 automation trigger 日志。 |

现有 wake 的一个边界也应在后续实现核查：`crates/runtime/src/interaction/agents.rs:674` 遇到读取 member 失败会跳过，`:679` 对实际读到 states 做 all；全部缺失时空集合 all 可为 true（源码推出的风险）。新订阅必须把 source deleted/missing 作为明确终态/失效，不复刻“漏读当已完成”。

## 4. 统一语义与忙态投递

[建议] automation 表示一个已授权意图，不是定时器每次重新让模型猜授权。SourceKind 明确 `nativeClaude`、`supervisor`、`receiverWait`；只让 supervisor 行承担可靠执行承诺。ReceiverWait 显示现有 `--wake`，但兼容老 KV，不强制马上迁移。nativeClaude 记录只能 read-only 展示，创建原生任务仍交由 harness，直到有可确认的 capability 才加管理按钮。

Trigger 有三类：time（at/interval/以后 cron）、event（固定 turn/task/受控 command/以后 tool）、receiverWait（现有 descendant wait）。Condition 是严格类型化纯谓词：statusIn/exitCodeEquals/toolNameEquals/commandId/workspaceId/afterSequence；MVP 不支持 JavaScript、任意 shell 或 LLM condition。“若 CI 完成”若要执行命令检查，本身是显式 action/受控 poll，不能藏在 condition 中免授权。

Action 先有 `notifyInbox` 和 `prompt`；第二阶段加 `runScript`。目标线程与事件来源分开。结果/通知是 passive 消息，注册 wake 是接收者另外明确的执行意图。

| 到达的内容/当前状态 | 合法默认行为 | 禁止隐式行为 |
| --- | --- | --- |
| 用户授权“每小时检查……”形成定时 task；thread idle | 从统一 outbox 接入现有 queue admission | 不伪造 peer direct urgency，不重写普通消息默认值。 |
| 同一定时 task；thread running/有 pending approval | 等整个 turn；默认只保留一个待执行 occurrence，合并后续 ticks | 不在下一 tool 返回时执行，不 steer 打断当前工作，不自动批准审批。 |
| 某 turn/task 完成的结果/提醒 | `notifyInbox` kind=result/status；忙闲均不叫醒 | 不把报告 relabel 为 task 后 queue，不让普通 inbox 默认启动 turn。 |
| receiver 明确登记“该结果来了后继续处理” | 先保存原 result，再创建有授权注册 ID 的内部 wake continuation；running 时仍 queue | 不给 result 改 kind，不能自动将 sender 的 notifyOnComplete 升级为 wake。 |
| 新消息纠正/停止当前工作 | 用户/peer 显式 steer/direct，task/question + interruptReason，检查完整 receipt | automation 的忙态策略不得替此变成 queue；direct=queued 说明接收时 idle，并非打断成功。 |
| recovering、deleted、closed、权限撤回 | 标 waitingRecovery/targetUnavailable/disabled，需要明确恢复；不重开 closed | 不把状态不明当 idle、不创建替代线程、不改 guarded→yolo。 |

MVP prompt action 永远 `delivery: queue`，因为它是已授权的独立周期任务，可以等待完整 turn。MVP event 默认 notifyInbox，唤醒只限已有 descendant `wait --wake`；任意 turn/task 的 completion wake 作为后续显式 receiver subscription，并保留 result 原信封。在 UI “提醒我”与“收到后让此线程继续工作”是两个不同选择，默认前者。

自动化记录 origin 放在 queue payload/turn metadata，建议新增 `automationRunId/automationId/triggerEventId/originKind`，不新增与现有 MESSAGE_KINDS 冲突的 message kind。内部 wake 文本解释“这是你登记的 continuation”，不是假装用户发了新的普通任务。非 self target 的自动 prompt 必须有接收者或用户明确授权，managed agent 无权任意使兄弟线程定时自启动。

[推断/风险] 原生 Claude timers 会自行运行，而本仓 `live.active` 的入场锁只覆盖 Remote Codex 发起的 turn（`crates/runtime/src/acp/runtime.rs:1714`）。“DB thread idle”不等于 native scheduler 也 idle。Supervisor prompt 与 native autonomous 输出共用 session 可能遇到 attribution/忙态 race。MVP 不宣称安全合并两种执行所有权：同一 Claude session 默认不同时开启 native timer 与 Supervisor prompt automation；发现 active/unconfirmed native watch 需在 UI 选择保留 native 或先由 harness 确认取消，再启用 Supervisor 计划。既有 native watches 不自动导入复制执行。未来需权威 busy/origin/jobId 适配，不能只靠旧投影状态。

## 5. Tool/terminal/command hook 的真实边界

| 观测面 | 已有代码证据 | 能确证什么 | 不能确证什么 |
| --- | --- | --- | --- |
| ACP tool_call / update | `crates/runtime/src/acp/mapper.rs:146`, `:415`, `:454`, `:466`; `crates/runtime/src/service.rs:433` | 某 toolCallId 的传输状态、可能的原始 command 参数和输出；工具成功/失败 | 不是所有 Bash 都调用 Supervisor terminal/create；title 文本不等于 argv；tool succeeded 不必等于 shell exit 0；工具内部子命令边界未知。 |
| ACP Client AgentTerminals | `crates/runtime/src/acp/runtime.rs:2880`; `crates/runtime/src/acp/terminal.rs:28`, `:68`, `:100` | 本 client 真正 spawn 的 executable/args/cwd，以及 child.wait exitCode/signal | 当前只有内存 terminal registry/channel，无 durable command journal；不能监控其孙进程或所有 harness 内置 Bash；terminal release 可 kill，须区分 cancelled。 |
| Web PTY shell | `crates/supervisor/src/shells.rs:72`, `:109`, `:148` | shell 启动、输入字节、输出字节、shell process 状态 | 输入文本可能是编辑/转义/多行/管道；输出“success”不是命令完成。没有每条命令 commandId+exitCode；不能用 output regex 宣称检测任意命令执行。 |
| Native Claude SDK hooks | 本机 `dist/acp-agent.js:7161`; 官方 hooks 链接见上 | harness 可以在其工具成功后运行 native callback/command | Rust hooks endpoint 空，不代表已转发；OS 用户权限 native command hook 不受 ACP guarded approval 充分约束。 |
| transcript 回填 scheduled tools | `crates/runtime/src/service/claude_history.rs:103`, `:120` | 已完成 scheduled turn 中记录的工具历史 | 属于 replay，不能默认重新执行后置脚本，否则每次恢复会重复外部副作用；未完成记录仍看不到。 |

[建议] 第一版“检测 xx 命令后跑脚本”只承诺 **通过 `remote-codex command run` 显式登记的受控命令**。给该执行分配 commandId，存 resolved executable/argv/cwd 与真实 exit；command.completed 条件匹配该 ID/固定参数，脚本执行一次。不要新增盲扫 transcript/PTY 文本的 scheduler。随后将 ACP Client terminal spawn/wait 接入相同 command registry，再加具名工具完成 adapter；其余来源 coverage 明确标部分覆盖。

Tool hook 用结构化 event，不反向解析 mapper 的 detailText。保留 `toolName/toolCallId/nativeSessionId/rawInput/redactedOutput/status/exitCode?` 的最小摘要；Secret 脱敏，argv/output 均不放通知全量。没有可靠 exitCode 就不能接受 `exitCodeEquals:0` condition，只允许 `toolStatus: completed` 并用文字说明。

[官方文档] [ACP terminals](https://agentclientprotocol.com/protocol/v1/terminals) 提供 terminal/output 的 exitStatus、wait_for_exit 与 kill/release；这是 Client terminal 生命周期，不是统一 hook 事件或全系统 shell 审计标准。

## 6. 可靠性、授权与防循环

### 6.1 时间与运行策略

[建议] MVP 的“每小时”采用 UTC anchor interval 3600 秒，而不是 local cron。每次 due = anchor + n×interval，上一轮结束时间不改变 anchor；可读标签“每 1 小时”。一次 at 接受带 offset RFC3339。后续 local cron 另存 IANA timezone（如 America/Toronto），不能只存当前 UTC-04:00 offset；夏令时不影响 interval，影响 wall-clock cron。后续 cron 明确 DST policy：不存在当地时刻 skip，重复当地时刻默认只执行一次（occurrenceKey 用 local date-time + policy；若用户选两次则包括 offset）。API preview 返回至少未来五次 UTC+当地时间，规则与 nextRunAt 共用引擎。

MVP missedRunPolicy 为 `coalesceLatest`：Supervisor/device 离线或忙超过多个周期，恢复最多生成一次最近 overdue occurrence，记录 missedCount，不补齐几十个 prompt。配置 maxLatenessSeconds（建议 24h），超期 skip 并列历史；支持 `skip`，以后才 `catchUpLimited(maxRuns)`。暂停/取消时不补跑；resume 默认 next future，显式“补最近一次”才执行。界面显示 nextScheduledAt 与 queuedAt/实际 startedAt，不把 scheduled time 当执行 SLA。

overlapPolicy 默认为 `coalesce`：同 automation 已 queued/running/waitingApproval 时保留一个 pending，后续触发合并且审计计数；终态之后再释放。跟踪 run→pendingSteerId→turnId 才知道整个任务终止，不能 receipt=queued 就释放 overlap。所有用户输入保持原队列顺序；automation 待执行可选择在 pending 中低优先级，但不得绕过现有 admission/用户 corrections。

### 6.2 事务、outbox、lease、去重

[建议] 单 Supervisor DB 当前有 OS 所有权锁（`crates/runtime/src/db.rs:216`）和 WAL（`:235`），仍需 crash recovery：

1. 事件状态更新与 durable automation event 写入同事务；time due 检测事务写 occurrence/run 并推进 nextScheduledAt。
2. 唯一键 `(automationId, definitionRevision, occurrenceKey)`；固定 turn event key `turn:{turnId}:{terminalStatus}`；task key `task:{rootId}:{number}:{transitionRevision}`；command key `command:{commandId}:terminal`。native replay 记录 observedAt 与 occurredAt，默认 `replayPolicy: ignoreHistorical`，不把历史回填当新执行触发。
3. run 与 action intent 同事务保存，worker 领取时用 leaseOwner/leaseUntil/fencingToken 条件 CAS。异步工作不能持 SQLite mutex；worker renew lease，旧 fencingToken 的结果不覆盖新持有者。
4. prompt/inbox 使用现有 acceptance/dedup 路由；建议把 `thread_send` transaction 内 acceptance 抽出共用函数，使 run 更新与 enqueue/store 在同事务内完成。不要在 db.with 里面再调用会 lock db 的异步 thread_send。若短期用分离 action outbox，requestId 固定 `automation-{runId}`，payload/fingerprint 预存且每次重试完全相同，接受成功后补记 mapping；过长 ID 用固定哈希。
5. 远端发送再交给已有 peer outbox，引用既有 outboxId。MVP只本设备；后续才远端，不在 relay 再建 scheduler。网络 ACK 只确认接受，turn 完成回执才能记 execution terminal。
6. script 外部副作用无法由 SQLite 保证 exactly once。spawn 前持久化 starting 并绑定 runId；restart 时身份不足/未确认完成标 `executionUncertain`，默认不重跑、不仅因 lease 过期就重复 spawn。可选 idempotent script 接收 stable idempotency key，自行去重后才自动 retry。

event bus 只用来加速 UI/worker 唤醒，durable event 表和 checkpoint 才是事实来源；lagged/offline 重查 DB。已存在完成通知的恢复逻辑（`crates/runtime/src/interaction/mod.rs:528`）继续运行。原生 transcript import 是直接 SQL 而非所有 item events（`claude_history.rs:271`），未来统一 turn terminal event 应在该事务里写，但标 historical recovery，默认不触发业务脚本。

暂停/取消需原子阻止新 occurrence 与尚未 dispatch 的 action；已经入现有 pending queue 的 automation 要按 pendingSteerId 调取消路径并同步 run 状态（现有 `crates/runtime/src/service.rs:2636`）。取消不是“正在运行的 turn 已停”；停运行中的 automation turn 必须显式 interrupt 且只针对该 run 映射的 turn，不杀当前用户工作。用户 Stop 默认 suspend 此 thread 的 prompt automation，避免 scheduler 在下一分钟反复叫醒，resume 需用户操作。这个行为为新增设计，不是现有 interrupt 的全局语义。

### 6.3 授权不会扩大

[建议] 自动化创建、prompt 执行、script 运行授权分开记录，但不让用户在每次 tick 重复批准已给出的精确长期意图。managed agent 可以按本次用户授权提案/创建 self prompt；不能用 fromThreadId 自报自己是用户。auth 层已有 authenticated CliCaller（`crates/supervisor/src/auth.rs:102`），但普通 CLI attribution 并不是完整安全边界（`crates/supervisor/src/interaction.rs:57`）；新增 script grant 必须绑定真实 authenticated caller，user token/machine credential 或 UI 明确授权。

prompt 每次执行重新读取 thread policy；guarded 仍 guarded，审批待用户处理。创建任何 automation 不修改 approvalMode/sandboxMode/model。权限更严格、用户撤回、workspace 不存在、thread recovering/closed/deleted 时 defer/disable。agent 即便编辑 workspace 文件、修改 automation JSON 或指定 shell argv 也不能绕过用户 grant。

runScript MVP 只允许 workspace 内已授权固定 scriptPath/executable/argv/cwd，不允许动态字符串拼 shell；规范化 realpath，检查 symlink 逃逸，绑定内容 SHA256 与 scope。编辑脚本导致 hash 不同标 needsAuthorization，不能沿用旧 grant 执行新代码。不能自动载入整个仓库 hooks 或给 shell blanket allow；创建请求默认 needsAuthorization，明确用户指令已经给出精确 grant 时可一次登记。授权实施不可单靠 native Claude hook trust。

script runner 为受控进程，复用 child_process 平台处理，但不能直接把当前 AgentTerminals.create 当安全 sandbox（该函数直接 spawn，`crates/runtime/src/acp/runtime.rs:2880` 也未见独立 terminal shell approval 检查）。显式 timeoutSeconds（建议默认 60、上限 300）、stdout/stderr 截断/磁盘上限、退出码、取消信号、工作区、环境 allowlist、并发上限；不传 REMOTE_CODEX_TOKEN 或 machine credential。环境只暴露 runId/automationId/event JSON stdin；不提供任意 target prompt/自授权凭证。需要 OS 约束时明确支持能力，未支持的平台禁用 script，不以 guarded 名义假装已沙箱。

### 6.4 防止递归与成本失控

每个产生事件携带 automationOrigin + causationId + ancestry。默认忽略 automation 自己产生的 tool/command/turn 事件；父子 causation 链检测重复 automationId；链长最多 3、每线程每小时 maxRuns/提示次数/重试预算、设备脚本并发上限；超限 disabledWithReason。不要根据结果里写“再叫醒我”创建任务，必须明确 scheduling API 成功 receipt。定时任务运行中新增永久自动化需原用户意图或再次授权，不能从普通 inbox/status 自动衍生 scheduler。耗费/LLM token 可展示但无 usage 就保持 unknown，不能填零宣称无成本。

## 7. API、CLI 与 JSON 草案（全部尚未实现）

### 7.1 复用命令已经可用

```bash
remote-codex thread wait child-a child-b --wake
remote-codex inbox wait --kind result --kind question
remote-codex thread send child-a --delivery queue --kind task --subject '执行检查' \
  --text-file check.txt --notify-on-complete --request-id check-r1
remote-codex task add '待构建结束后检查报告' --after 1 --assign reviewer
remote-codex task claim --wait
```

这些是当前命令，完成通知 passive，wake 必须由 receiver 登记。上述示例仅文档，不在本研究执行。

### 7.2 新增统一 automation CLI

```bash
# 下一小时起每小时独立检查；用户授权时可 enable，agent 提案显示有效状态
remote-codex automation create --name hourly-self --thread self \
  --every 1h --action prompt --text-file hourly-prompt.txt \
  --busy-policy coalesce --missed-run-policy coalesceLatest --request-id hourly-r1

# 精确选定 turn，事件提醒被动进入当前 thread（不重新发一个 task）
remote-codex automation create --name build-finished --on-turn TURN_UUID \
  --source-thread BUILD_THREAD_UUID --status completed --action notifyInbox \
  --thread self --once --subject '构建轮次已完成' --request-id build-reminder-r1

remote-codex automation create --name task-finished --on-task 4 --root ROOT_UUID \
  --status completed --action notifyInbox --thread self --once --request-id task-reminder-r1

# 第二阶段：用户先在 UI/可信 CLI 授权固定脚本，agent不能自发 grant
remote-codex automation create --file command-hook.json --request-id command-hook-r1
remote-codex automation authorize AUTO_UUID --script-sha256 SHA256
# hook 可按 invocation 的 commandId 绑定，或预先按 explicit commandKey 绑定
remote-codex command run --thread self --command-key focused-build --cwd . -- cargo check -p remote-codex-runtime

remote-codex automation list --thread self
remote-codex automation show AUTO_UUID
remote-codex automation preview --file proposal.json
remote-codex automation pause AUTO_UUID
remote-codex automation resume AUTO_UUID
remote-codex automation cancel AUTO_UUID
remote-codex automation runs AUTO_UUID --limit 20
remote-codex automation retry RUN_UUID --request-id retry-r1
```

`authorize` 是可信身份校验后的操作，不是通过 --from 欺骗身份。MVP可以只提供 UI grant，CLI authorize 延后。retry 仅 transport 或可证明未执行的 action；executionUncertain/有副作用脚本不得自动重试。`--once` 针对 immutable source，只生成一 occurrence。禁止默认挂“任意某线程下一次完成”，避免 source 无意改变。

### 7.3 最小定义与执行记录

所有公开 JSON 字段保持 camelCase，放 `crates/protocol` + `@remote-codex/shared` 类型，不再像 native Watch 一样仅组件内私有接口。

```json
{
  "schemaVersion": 1,
  "name": "hourly-self",
  "sourceKind": "supervisor",
  "ownerThreadId": "58e727fc-30b6-4473-b6ef-1e72cbab8520",
  "workspaceId": "5bffcb4d-0b86-4186-883b-ef2617aa671f",
  "trigger": {"kind": "interval", "everySeconds": 3600, "anchorAt": "2026-10-08T18:00:00Z"},
  "condition": {"all": [{"kind": "targetAvailable"}]},
  "action": {"kind": "prompt", "threadId": "58e727fc-30b6-4473-b6ef-1e72cbab8520", "text": "检查已授权项目的运行状况", "delivery": "queue"},
  "policies": {"missedRun": "coalesceLatest", "maxLatenessSeconds": 86400, "overlap": "coalesce", "maxPendingRuns": 1, "replay": "ignoreHistorical"},
  "enabled": true
}
```

Response 加 `automationId/definitionRevision/createdAt/updatedAt/effectiveState/nextScheduledAt/lastRunId/authorization`；server 计算来源、授权与 nextScheduledAt，不信任客户端自报 authorized。

```json
{
  "schemaVersion": 1,
  "name": "turn-done",
  "trigger": {"kind": "turnEnded", "sourceThreadId": "SOURCE_THREAD_UUID", "turnId": "TURN_UUID", "once": true},
  "condition": {"all": [{"kind": "statusIn", "values": ["completed"]}]},
  "action": {"kind": "notifyInbox", "threadId": "RECEIVER_THREAD_UUID", "messageKind": "result", "subject": "构建完成", "includeClosingMessage": true},
  "policies": {"replay": "ignoreHistorical"},
  "enabled": true
}
```

Task trigger 用 `{kind: taskEnded,rootThreadId,taskNumber,once:true}`。Command hook 定义：

```json
{
  "schemaVersion": 1,
  "name": "after-focused-build",
  "workspaceId": "WORKSPACE_UUID",
  "trigger": {"kind": "commandEnded", "sourceThreadId": "THREAD_UUID", "commandKey": "focused-build", "observability": "supervisorCommand"},
  "condition": {"all": [{"kind": "exitCodeEquals", "value": 0}]},
  "action": {"kind": "runScript", "scriptPath": "scripts/report-build.sh", "args": [], "cwd": ".", "timeoutSeconds": 60, "requiredScriptSha256": "SHA256", "authorizationGrantId": null},
  "policies": {"overlap": "skip", "replay": "ignoreHistorical", "retry": "manual"},
  "enabled": true
}
```

`commandKey` 是预登记受控命令类别，不是 shell 输出 regex；每次实际执行有独立 commandId，只有该 wrapper 的真实事件可触发，未知来源拒绝。未授权 response effectiveState=needsAuthorization。

```json
{
  "runId": "RUN_UUID",
  "automationId": "AUTO_UUID",
  "definitionRevision": 1,
  "occurrenceKey": "interval:2026-10-08T18:00:00Z",
  "triggerEventId": null,
  "scheduledAt": "2026-10-08T18:00:00Z",
  "observedAt": "2026-10-08T18:03:00Z",
  "state": "queued",
  "missedCount": 0,
  "deliveryReceipt": {"requestedDelivery": "queue", "delivery": "queued", "messageId": "PENDING_UUID"},
  "pendingSteerId": "PENDING_UUID",
  "turnId": null,
  "startedAt": null,
  "completedAt": null,
  "attemptCount": 1,
  "error": null
}
```

state 区分 due/conditionSkipped/waitingAuthorization/waitingRecovery/dispatching/queued/running/waitingApproval/completed/failed/cancelled/skipped/executionUncertain。queued 不显示为已执行成功。UI retry 带明确 error.code、是否安全可重试与 nextAttemptAt。

### 7.4 HTTP 与 schema

新 REST 只在设备控制面执行，Web 经 relay 代理：

- `GET/POST /api/threads/{id}/automations`；GET 兼容统一只读列表 `{automations, nativeWatches, receiverWaits}`，POST sourceKind 仅 supervisor。
- `POST /api/threads/{id}/automations/preview`；`GET/PATCH /api/threads/{id}/automations/{automationId}`（If-Match/revision，防并发覆盖）。
- `POST .../{automationId}/pause|resume|cancel`；`GET .../{automationId}/runs?before=...&limit=...`；`POST .../{automationId}/runs/{runId}/retry`。
- script grant `POST .../{automationId}/authorize` 仅可信用户；managed agent 不能授权；跨 device admin grant 以后单独设计。
- 原 `/watches` GET 保持 native 兼容；不把 POST 写进同一只读投影接口。relay `crates/relay/src/route_acl.rs:136` 的白名单要加 read/control 区别，页面 relay 部署才会生效。
- CLI 当前统一 `/api/cli`（`crates/cli/src/threads.rs:396`），添加 automationCreate/List/Show/Preview/Pause/Resume/Cancel/Runs 等 operation，调用同一 runtime service。不要 CLI 与 REST 各写 scheduler。

建议 SQLite 增量迁移（物理 DB 列可沿既有 snake_case，公开 DTO camelCase）：

```text
automations:
 id PK, workspace_id, owner_thread_id, name, source_kind,
 definition_revision, definition_json, enabled, effective_state,
 next_scheduled_at, last_occurrence_key, authorization_grant_id,
 created_by_identity, created_at, updated_at
 INDEX(enabled, next_scheduled_at), INDEX(owner_thread_id)

automation_events:
 sequence INTEGER PK AUTOINCREMENT, event_key UNIQUE, event_kind,
 thread_id, turn_id?, root_thread_id?, task_number?, command_id?,
 occurred_at, observed_at, origin_kind, causation_json, payload_json

automation_runs:
 id PK, automation_id FK, definition_revision, occurrence_key,
 trigger_event_id?, definition_snapshot_json, state, scheduled_at,
 observed_at, missed_count, queued_at?, started_at?, completed_at?,
 pending_steer_id?, turn_id?, command_id?, receipt_json?, error_json?,
 lease_owner?, lease_until?, fencing_token, attempt_count
 UNIQUE(automation_id, definition_revision, occurrence_key)

automation_action_outbox:
 run_id PK FK, immutable_request_json, client_request_id UNIQUE,
 next_attempt_at, attempt_count, accepted_at?, delivery_receipt_json?

automation_grants:
 id PK, automation_id, authorized_by_identity, scope_json,
 script_sha256?, granted_at, revoked_at?

command_executions (阶段 2):
 id PK, command_key?, thread_id, turn_id?, workspace_id, automation_run_id?,
 executable, argv_json, cwd, source_kind, state, started_at, completed_at?,
 exit_code?, signal?, error_json?, output_artifact_path?
```

现有 thread_turns/thread_pending_steers 是执行事实来源，automation_runs 仅索引关联与历史，不另造 thread 状态机。MVP turn/task source 可先直接在原事务创建匹配 run/outbox，无需为每条 streaming token 写 event；phase 2 的工具统一事件才逐步扩展 journal。Event cursor 和 retention 必须保证未处理订阅不会先被清理；历史默认保留 30 天，可配置，定义与最后终态长保留。删除 thread 时先 disable target/source automation 并保存 targetUnavailable 原因，不能留下 FK 断开的活 scheduler。

## 8. UI 行为与部署归属

[建议] 在当前 Clock watches 入口扩展“自动化”面板，并加永远可见的“创建自动化”入口，非 Claude 也可使用 Supervisor automation。表格/卡片展示名称、来源、自然语言 trigger、condition、action、启用状态、nextScheduledAt、上次实际执行与错误；nativeClaude 卡片标“Claude 原生 / 状态来自工具历史 / 非实时确认”，Supervisor 卡片标“设备管理 / 跨重启恢复 / 设备离线时不运行”。不要把 native active 与 Supervisor enabled 合并计数。

创建向导：选择时间/轮次完成/task 完成/受控命令完成；时间输入“每小时”或一次具体时间；event 用线程 selector 与 immutable turn/task ID；展示“当 X 成功完成 → 在当前线程 inbox 提醒”。选择 prompt 时明确“线程忙时等待整个轮次结束，并合并错过周期”。脚本页显示工作区、脚本、固定 argv、timeout、hash 与授权范围，无“授权全部 shell”按钮。

可读 condition 从 typed DTO 自动生成，不用模型总结猜语义；高级 JSON 与预览使用同一 validator。next time 同时展示选定时区与本机时间；pending/忙等待/needsAuthorization/离线分别显示原因。native 精确 nextRunAt 未知时显示“未知（按原生 scheduler）”，可单列 cron 的理论时刻但不可冒充实际承诺。

启停取消：pause 禁未来触发，resume 预览下一次，cancel 收敛未投递 occurrence；停当前运行另一个明确操作。Native 不提供假 pause/cancel；以后 capability 能确证时才允许转给原生工具并等待成功 receipt。原生转 Supervisor 为显式导入向导：取消原生成功后才启新计划，失败保持草案，防双跑。

执行历史每行有 run 状态、scheduled/queued/started/completed、合并次数、条件 skip、exit/error、重试次数、触发来源、费用 coverage、thread/turn 链接。点 prompt run 到现有线程 turn，点 command run 到受控输出 artifact，不把机密 argv/env 贴在通知里。错误允许 safe retry，否则显示“执行结果不明，需要核查”，不把它美化为普通失败后自动重跑。

Web/shared 类型落 `apps/supervisor-web` / `@remote-codex/shared`，公共 `remote.lnz-study.com` 由 Rust relay 服务；真正实施 Web 改动后需按用户已有流程发布 shared UI SHA 并 dispatch relay-deploy。研究不部署，不因 runtime automation 触碰 Windows Device Manager 独立版本。

## 9. 分期、实现落点与具体验收

### Phase 0：校准 native 事实，保持只读

短期独立改动：nativeDTO 添加 sourceKind/statusEvidence/statusCheckedAt/coverage，UI 不承诺未知 nextRunAt；支持正式采样的结构化 Cron 输出、ScheduleWakeup 来源（未采样先不猜 parser）；校正 restart/resume 文案。真实版本矩阵至少分独立 CLI 与 ACP bundled SDK。验证前提是用户授权专项 runtime 实验，用 disposable session 实测成功 create/list/delete、resume、过期/忙合并与 guarded permission；这些实验本研究未执行。

验收：普通 assistant 说“定时已设”不产生 watch；失败 create/cancel 不算成功；成功工具处于 interrupted parent turn 仍正确；非空 list 不误宣称全对账；未确认持久性不显示“可靠跨重启”。在原生没有 jobId 因果链时保留 ambiguous，不按 cron 时刻猜成本归属。

### Phase 1：最小 Supervisor automation（时间 + 完成提醒）

落点：新增 `runtime/src/service/automation.rs` 与 DB migration/protocol DTO；`crates/runtime/src/service.rs:2530` 的 terminal transaction 与 `crates/runtime/src/interaction/tasks.rs:390` 的 task transition 注册事件；复用 queue/inbox acceptance，不新建 coordinator split；CLI `threads.rs` 与 supervisor REST；共享 UI 类型与面板。time worker 在 Supervisor 的现有生命周期里启动，一个 worker 与 DB 租约即可，不起另一守护进程。只本设备 interval/at；target self prompt、turn/task notifyInbox；receiver-owned descendant wake 保持既有命令实现。

验收用 targeted crate/test-name + formatting/compile，UI用 focused-e2e 选相关 spec 与明确 browser；不默认 workspace/full browser/platform matrix。以下是将来必须通过的场景，**不是本次已跑测试**：

1. fake clock 每小时 prompt 只入一个 pending，running 2.5 小时后完整 turn 结束才执行合并一次，不在工具 batch 后提前跑。
2. 关闭 Supervisor 跨 3 个 tick，重启恢复 coalesceLatest 一次、nextScheduledAt 正确推进；skip 不执行；超 maxLateness 留历史。
3. turn completed/failed/interrupted 按 condition 精确匹配；监听已完成 turn 注册在同事务选择 immediate once 或 conflict，不发生“注册与完成竞态”漏提醒；默认注册返回 sourceAlreadyEnded，UI让用户显式选择立即通知。
4. task failed 不使原 task dependencies 误变 ready；task 提醒与 turn 提醒不混淆；creator 自己完成 task 的现有自通知抑制行为保持。
5. 完成提醒给 idle/running receiver 都只新增 result/status inbox，不增加 pending turn；只有本人已登记 wait --wake 才一次 continuation。
6. 重放事件、lost ACK 重试、接收前后 crash，UNIQUE occurrence/requestId 保证不重复 inbox/prompt acceptance；requestId payload 改动明确 conflict。
7. guarded prompt 运行遇审批保持 waitingApproval，无自动授权；recovering/closed/deleted 不执行或自重开。
8. pause/cancel 清理自己的尚未执行队列，保留用户 pending 消息；用户 steer/stop 仍走原语义，停止后 automation 不偷偷唤醒。
9. native 与 Supervisor 同 session 冲突不自动双跑；列表区分来源、native 未确认状态、真实执行记录与 queued acceptance。

### Phase 2：满足受控 command → script 最小能力

新增命令执行账本与 wrapper，用真实 spawn/wait 形成 commandEnded；增加 runScript grant/timeout/idempotency/loop guard；脚本结果保持被动报告。先可靠支持受控执行，不宣称任意 shell 命令侦测。API/CLI共享同一 runtime service；script runner 对权限校验后才复用进程工具。

验收：指定 commandKey 的一次真实 exit 0 只触发一次脚本；同样文本出现在 PTY/assistant 或非受控命令不触发；exit 非 0、signal/timeout 与 unknown exit 区分；wrapper 完成事务 crash 重启不会漏/重复 occurrence；spawn 后 crash 标 uncertain 不自动重跑；grant 撤销、脚本 hash 改动、cwd symlink 逃逸/跨 workspace 立即拒绝；agent 无法用 --from 授权或改成 yolo；脚本不能用 env 偷获 machine token；超时杀自己的进程树并留审计；本 automation 的命令完成不递归触发自己。

Phase 1 + Phase 2 是三个用户场景的最小完整交付。若时间只够 Phase 1，必须明确“命令→脚本尚未实现”，不能宣称统一 hooks 已满足。

### Phase 3：通用 hooks 与精细 scheduling

ACP owned terminal/create/exit 接 command registry；tool event 增原始结构化 observability，按 capabilities 才开放 matching；支持 local cron/IANA DST、受限 catch-up、跨 device routing。PTY 每条命令完成需要显式 shell integration/command wrapper 协议（commandId、开始/结束、exit status），没有它继续标 unsupported，输出 regex 只能作低可信提醒条件，不得直接运行脚本。native watch 的实时 list/cancel/status/origin-jobId 作为薄 Claude adapter 扩展，不将 native scheduler 引入 Rust 或重复执行。任意 turn/task receiver wake 的显式授权 subscription 可此阶段加，普通报告 inbox 默认完全不变。

## 10. 需要决策的点

推荐默认值可直接作为实施选项，不需本研究向用户请求执行权限：

1. **归属**：接受 Supervisor automation 提供可靠性、native watches 仅投影；不自动导入 native 执行。推荐接受。
2. **时间/漏跑**：MVP interval/at + coalesceLatest/maxLateness24h + overlap coalesce；local cron/DST后续。推荐接受。
3. **完成消息**：默认 passive inbox；任意 completion wake 后续显式 receiver 注册，现有 descendant --wake 继续复用。推荐接受。
4. **脚本范围**：Phase 2受控 command wrapper + 用户精确 hash grant；通用 Bash/PTY hook 后续。推荐接受，避免把“监测所有命令”当已可实现事实。
5. **native 与 Supervisor 共 session**：MVP拒绝自动双调度，显式确认取消/迁移；未来权威 busy adapter 再开放。推荐接受。
6. **产品控制**：用户 Stop 是否暂停 prompt automation、resume 是否只从未来时间开始；推荐是，且 UI显示暂停原因。

最需补充的实际证据不是再扫更多文件，而是用户那次成功 scheduling receipt/jobId 与对应版本。当前结论足以设计统一机制，但不足以保证其具体 native timer 的 persistence/restart/permission 行为。

## 11. 父线程复核与建议

已复核 watches 的工具历史查询、原生 scheduled JSONL 回填、receiver-owned wake、
任务完成通知以及 hooks HTTP 占位源码；再次核对当前 Claude 官方 scheduling 文档。
创建、执行与展示是不同链路；具体用户原生任务的重启恢复行为仍需实际 receipt 证据。

统一自动化建议先做时间 prompt 与 turn/task 事件。现有 descendant `thread wait --wake`
已能覆盖多 Agent 子线程结束后继续工作的主要场景。对任意精确 turn/task 的
“完成后让此线程继续工作”，应提供接收方显式登记的 continuation；若首期暂不支持，
UI 必须明确只有 inbox 提醒，不能把它展示成唤醒功能。脚本 hooks 后续先接可靠的
受控命令完成事件，再按 capability 扩到 ACP 工具与 terminal，不能承诺检测所有 PTY
命令。此报告中的 automation/command CLI、API、表和面板仍是设计，尚未实现。

本轮 UI 分屏修正已实现，但不会因此实施、启用或部署此自动化方案。
