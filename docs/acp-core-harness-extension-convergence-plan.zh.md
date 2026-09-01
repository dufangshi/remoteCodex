# ACP Core 与 Harness 扩展收敛计划

- 状态：Complete
- 最后审阅：2026-08-31
- 适用范围：Remote Codex agent runtime、Supervisor conversation persistence、Web/iOS/Android thread surface

## 目标

将 Remote Codex 的多 harness 接入收敛为以下长期结构：

1. ACP 承担各 harness 语义真正一致的 session、prompt、事件、权限、配置和 usage 能力。
2. 每个 harness 通过小型、版本化 adapter 补充 native 独有能力，不在 Supervisor 中复制整套 runtime。
3. Supervisor 继续拥有独立于 provider 的本地 conversation journal；无论事件来自标准 ACP 还是 harness extension，都写入同一套规范化历史。
4. Codex 原生 `app-server` runtime 在 ACP 路径达到明确 parity gate 前保留为行为基准和回滚路径。
5. 只有真实 harness E2E、Supervisor/ACP 重启恢复 E2E 和用户可见 Web E2E 全部通过，才允许宣布本计划完成。

本计划不是“把所有 provider 特性塞进 ACP 核心”。通用层只接纳语义稳定、可跨 harness 复用的能力；其余能力保留为显式、可协商的 extension。

## 当前进度

- 当前 Phase：Phase 7 与完成后源码复核均已完成。
- 下一项：后续版本按 capability 变化维护 contract snapshot；native Codex 保留为明确 fallback，尚未退役。
- 已完成实现项：Phase 0-7 全部保留范围；ACP core、versioned extension、durable journal、Codex parity、adopt/import、多 harness contract、Web/mobile/relay 与 native fallback。
- 已关闭 Phase gate：Phase 0、Phase 1、Phase 2、Phase 3、Phase 4、Phase 5、Phase 6、Phase 7。
- 已记录真实 E2E：Codex ACP restart/context/image/approval/steering/compact/goal/fast/import；Claude ACP restart/context/fork；Web desktop/mobile；Android local/server/relay；iOS prompt/relaunch；native Codex restart/context fallback。
- 实际集成状态：完整实现、证据与 lint 收口已通过 merge commit 集成到 `main`。

交付 checklist：

- [x] 逐项读取实际代码、diff、测试和本机 E2E 产物，不依赖旧对话记录判断完成度。
- [x] 修复复核发现的 capability 隔离、扩展失败关闭和临时 session 残留问题。
- [x] 重新运行受影响的 unit、integration、build、真实 provider 和浏览器 E2E。
- [x] 将当前 worktree 变更提交到 `codex/acp-harness-adapter-plan`。
- [x] 审阅后合并到 `main`。

Goal 模式每次推进后必须更新本节。只允许在对应 checklist 和证据同时更新后改变 Phase 状态。

## 非目标

- 本计划不立即删除原生 Codex runtime。
- 本计划不要求所有 harness 支持 Codex 独有能力。
- 本计划不把完整 transcript 上传到 Relay 或新的中央数据库。
- 本计划不把原始 ACP NDJSON 默认写入持久化存储。
- 本计划不通过 provider 名称硬编码 capability 来模拟 parity。
- 本计划不在同一 thread 上并行运行 ACP owner 和 native owner。
- 本计划不顺带完成 Treer 合并；它只建立未来可迁移的 provider/conversation 边界。

## Goal 模式执行契约

本文件应作为 Goal 模式的单一执行清单。启动 Goal 时使用以下目标：

> 在不降低原生 Codex 已有能力、不引入第二个 session/process 所有者的前提下，实现 ACP core、版本化 harness extension、Supervisor-owned conversation journal 和 Codex-over-ACP parity；完成所有 checklist，并以真实 Codex ACP 重启恢复及 Web E2E 证据关闭计划。

执行规则：

- 每次只推进一个 Phase；开始前读取本文件和当前代码，不依赖旧对话记忆。
- 同一时间最多一个 checklist 项处于实际实施中。
- 代码、测试、文档和 E2E 证据必须在同一功能项中闭环。
- 单元测试、mock runtime、fixture 和类型检查不能单独关闭真实 E2E gate。
- 只有命令实际成功执行、结果被检查并记录到“E2E 证据”章节后，才可将对应 checkbox 改为 `[x]`。
- 旧日期、旧分支或另一台机器留下的证据不能自动关闭当前实现的 gate。
- 遇到 provider 版本不支持时，应记录探测结果和 blocker；不得通过硬编码 `capabilities=true` 绕过。
- 不得输出、提交或记录 Codex auth、API key、Relay token、cookie 或完整敏感 prompt。
- 修改 `packages/thread-ui/src` 后，必须在拥有该 package 的 thread-ui workspace 中先执行 `pnpm --filter @remote-codex/thread-ui build`，再验证 Supervisor Web。
- 未完成真实 E2E 时，Goal 状态必须保持 active 或明确 blocked，不得标记 complete。

## 当前事实基线

### Conversation persistence

Remote Codex 已经为所有 provider 使用同一套本地 SQLite 投影：

- `threads` 保存本地 thread 与 provider session 的绑定。
- `thread_turn_metadata` 保存 display prompt、model、reasoning、usage 和时间信息。
- `thread_history_items` 保存规范化的 user、agent、reasoning、tool、command、file、plan 等 item。
- `ThreadHistoryPersistenceCoordinator` 将 runtime 事件 upsert 到 SQLite。
- `ThreadDetailAssembler` 将 provider transcript、Supervisor 持久化 item 和 live state 合并为客户端 DTO。

ACP runtime 自身的 `sessions` 和 active mapper 是进程内状态。ACP runtime 重启后，旧 UI transcript 主要由 Supervisor SQLite 恢复；provider 的 `session/load` 或 `session/resume` 负责恢复模型上下文。

### Phase 0 时的 Codex ACP 能力差距

Phase 0 的通用 ACP wrapper 已支持基础 prompt、interrupt、plan、permission、model/config option、usage、FS 和 terminal callback，但没有完整消费 Codex ACP 已声明的 extension。当时的差距包括：

- ACP session import 被显式禁用。
- `session/load` 历史回放没有进入专用 hydration mapper。
- streaming agent message 的 partial delta 在 item 封闭前主要存在于内存。
- Codex ACP 已声明 steering，但 Remote Codex ACP runtime 没有 `sendInput`。
- Codex ACP 已声明 goal extension，但 Remote Codex ACP runtime 将 goals 标记为 false。
- Codex ACP 已声明 image prompt capability，但 Remote Codex ACP runtime 只发送 text block。
- compact、fork、hard rollback、MCP management、skills、hooks、host config 和 fast mode 尚未通过 ACP 路径暴露。

Phase 4 已关闭 steering、compact、goal 与 fast mode 差距。`codex-acp 1.6.2` 没有暴露 fork、rollback、MCP 管理、skills、hooks、hook trust 或 host config 管理 wire surface，这些能力经产品决策继续保留在 native Codex；详见 `docs/acp-codex-parity-2026-08-31.json`。执行时仍必须重新记录本机 `codex --version`、`codex-acp --version` 和 ACP initialize response；本节不是永久版本承诺。

## 架构决策

### 1. 单一 session 与 process 所有者

一个 Remote Codex thread 在任何时刻只能由一个 runtime connection 拥有。

禁止以下实现：

- 同时启动 `codex-acp` 和第二个原生 `codex app-server` 操作同一个 thread。
- ACP 负责 prompt、原生 side channel 负责 compact/fork，但两者没有共享 generation、ordering 和 cancellation。
- 根据 UI 动作临时切换 provider transport，导致 provider session ID 漂移。

优先实现顺序：

1. 在同一 ACP connection 上调用标准 method。
2. 在同一 ACP connection 上调用已协商的版本化 extension method。
3. 只有 harness 无法在同一进程暴露 extension 时，才允许 adapter 内部代理 native RPC；该 adapter 仍必须是唯一 owner，并统一发出事件。

### 2. ACP Core 的晋升标准

一项能力只有满足以下条件才进入通用 ACP core：

- 至少两个 harness 具有相同的用户语义，而不是只有相似命令名。
- 请求、响应、错误、取消和重试语义可以形成稳定 contract。
- 能力可以通过 initialize/capability negotiation 探测。
- 缺少能力时存在明确 unsupported 行为，不需要猜测 provider 类型。
- 事件可以映射到统一 conversation journal，并具有稳定去重键。

仅一个 harness 使用、语义明显不同或仍不稳定的能力保留为 extension。

### 3. Harness adapter 的职责边界

每个 harness adapter 只负责：

- base CLI、ACP server 和 adapter 的探测及安装元数据。
- 认证环境、provider home 和启动参数。
- native session ID 与 Remote Codex scoped session ID 的绑定。
- extension capability 的版本声明和 method 映射。
- native 特有 request/event 到统一类型的转换。
- extension 错误归一化和可恢复性声明。

Harness adapter 不负责：

- SQLite schema 或 repository。
- Thread UI、Relay、workspace 权限或移动端路由。
- 通用 history merge、turn ordering 或 idempotency。
- 创建第二套 provider session 生命周期。

### 4. Capability 以运行时协商为准

最终 capability 必须由以下信息组合，而不是 provider 名称硬编码：

```text
effective capabilities
  = stable ACP capabilities
  + negotiated extension capabilities
  + local adapter availability
  - explicitly unsupported or failed probes
```

UI、API 路由和 toolbox 只消费 effective capability。不得因为 `agentId === "codex"` 就假定 fork、goal 或 fast mode 一定可用。

### 5. 标准能力与扩展能力分类

| 能力 | 目标归属 | 备注 |
| --- | --- | --- |
| session new/list/load/resume/close/delete | ACP core | 逐项协商；不能用一个总开关代替 |
| prompt/cancel | ACP core | 基础 turn 生命周期 |
| text/image/audio/resource prompt | ACP core | 按 prompt capabilities 发送真实 content block |
| assistant/reasoning/tool/file/command/plan/compaction event | ACP core mapping | 是否可主动触发 compact 是另一项能力 |
| permission request | ACP core | 保留 option kind 和 persist scope |
| model/reasoning/session mode/config option | ACP core | 以 config option 为主，legacy method 为 adapter fallback |
| usage/context window/provider cost | ACP core | 保留 provider-reported 与本地估算的来源差异 |
| import/adopt existing session | Supervisor core | 依赖 list/load 和可靠 hydration，不应永久 Codex-only |
| steer running turn | extension，候选 core | 需区分 live steer 与 queued continuation |
| request compact | extension，候选 core | 不与 compaction notification 混为一谈 |
| fork current session | ACP core（unstable negotiated） | Claude/OpenCode 已共享 `session/fork`；必须按 capability 探测 |
| rollback/rewind | harness extension | 必须定义上下文和文件语义 |
| goal lifecycle | harness extension | 当前 Codex extension |
| fast/performance mode | harness extension | 与 service tier、模型和计费相关 |
| MCP status/management | harness extension | session MCP input 不等于 host management |
| skills/hooks/config files | harness extension | 明显属于 harness 管理面 |
| subscription usage window | harness extension | ChatGPT、Claude 和 API key 语义不同 |

## Conversation Journal 与历史恢复契约

### 目标模型

标准 ACP 事件和 extension 事件都必须先转成统一 envelope，再写现有 Supervisor persistence：

```text
provider
provider_session_id
provider_turn_id
provider_item_id
local_thread_id
display_turn_id
event_kind
sequence_or_revision
normalized_payload
provider_timestamp
received_timestamp
source_mode: hydrate | live
idempotency_key
```

实施前应评估现有 `thread_turn_metadata` 与 `thread_history_items` 是否可表达上述字段。只有确有查询或去重需求时才增加列或新表；不得无理由建立第二份 transcript 数据库。

### Hydrate 模式

用于 Supervisor 启动恢复和 adopt/import：

- 在发起 `session/load` 前注册 hydration mapper。
- 接受 provider 回放的完整历史，但不广播成新的 live notification。
- 使用稳定 session/turn/item ID 或确定性派生 ID。
- 对已存在 SQLite item 做幂等 upsert。
- 恢复完成后校验 turn 数、顺序、状态和最后 assistant 文本。
- hydrate 结束点必须明确，不能与后续 live event 交错造成重复。
- provider 只返回部分历史时，保留 Supervisor 已有 item，并标记 coverage，不得静默删除。

### Live 模式

用于新 turn：

- user prompt 在 provider dispatch 前或同一事务边界内持久化。
- streaming assistant partial 应周期性 checkpoint，不能只等 turn complete。
- item update 按 stable item ID upsert。
- turn complete 后写最终状态、usage 和 ordering hint。
- Supervisor 崩溃后重新 hydrate，不得重复显示已 checkpoint 的 partial/final item。
- pending permission、question 和 plan decision 的耐久性必须单独定义；不能把内存 Map 当成持久 contract。

### Provider context 与 UI transcript 分离

- Provider session 负责模型上下文能否继续。
- Supervisor journal 负责客户端 transcript 是否稳定可读。
- Provider 无法 resume 时，历史仍应只读可见，并明确显示 disconnected/unavailable。
- Supervisor journal 不应默认保存原始 ACP NDJSON 或敏感 native payload；只有经过审计的诊断模式可以短期采样。

## Codex 原生与 Codex ACP Parity 目标

| 功能 | 原生 Codex 基线 | ACP 当前状态 | 目标实现层 | 关闭 gate |
| --- | --- | --- | --- | --- |
| 新建、prompt、interrupt | 支持 | 支持 | ACP core | 真实 ACP API + Web E2E |
| 历史持久化 | provider transcript + Supervisor projection | Supervisor projection，load replay 未 hydrate | Journal core | 重启后无丢失、无重复 |
| list/load/resume | 支持 | Codex ACP 已声明 | ACP core | 杀死 ACP/Supervisor 后继续上下文 |
| 导入本地 thread | 支持 | Remote Codex 禁用 | Supervisor adopt + hydrate | 导入已有 Codex thread E2E |
| 图片附件 | `localImage` | ACP 只发送 text | ACP prompt capability | 真图片理解 E2E |
| running-turn steer | 支持 | 已通过 legacy extension 接入 | steer extension | 长 turn 中追加输入 E2E |
| compact | 支持 | 已通过同一 ACP session 的 control prompt 接入 | compact extension | 触发后继续 prompt |
| fork | 支持 | 无可协商 wire surface | native fallback | 新协议出现前不在 ACP UI 暴露 |
| hard rollback | 支持 | 无可协商 wire/file contract | native fallback | 新协议出现前不在 ACP UI 暴露 |
| goal | 支持 | 已接入 set/pause/resume/clear | goal extension | lifecycle E2E |
| guarded approval | 多种 Codex request | ACP permission 基础支持 | ACP core + Codex request extension | 真实 command/file approval E2E |
| structured questions/MCP elicitation | 支持 | 未完整接入 | Codex request extension | Web 回答后 turn 继续 |
| model/reasoning | 原生 model/list | ACP config options | ACP core | 切换后真实 turn 使用目标配置 |
| MCP status | 支持 | ACP 仅声明 session MCP transport，无管理 API | native fallback | ACP UI 不暴露管理入口 |
| skills/hooks/config archive | 支持 | 无可协商 wire surface | native fallback | ACP UI 不暴露管理入口 |
| fast mode | 支持 | 已通过 config option 接入 | ACP config + adapter | 配置确认且后续 usage 可观察 |
| token/context usage | 支持 | 支持基础 usage | ACP core | reload 后数值不倒退/重复 |

Parity 不要求 wire payload 完全一致，但要求用户可见结果、错误恢复、持久化和权限语义达到同等质量。若某项明确决定不支持，必须形成产品决策并从“退役原生 Codex”的完成条件中移除；不得静默降低能力。

## 分阶段 Checklist

### Phase 0：基线、契约与测试夹具

目标：冻结当前行为和可重复测试输入，避免用实现过程中的印象判断 parity。

- [x] 记录 native Codex 与 Codex ACP effective capability JSON。
- [x] 记录 `codex --version`、`codex-acp --version`、ACP protocol version 和 initialize response。
- [x] 建立 native-vs-ACP capability snapshot 测试，差异必须显式批准。
- [x] 建立可脚本启动的 fake ACP server，覆盖 list/load/replay/live/permission/config/usage。
- [x] 建立包含多个 turn、reasoning、tool、failed tool、plan、usage 的 Supervisor SQLite fixture。
- [x] 为现有 ACP history ownership 和 missing-turn merge 补足回归测试。
- [x] 定义 extension namespace、版本、错误 envelope 和 idempotency 字段。
- [x] 将本计划列入相关文档索引或开发入口。

Phase gate：

- [x] `@remote-codex/acp` unit tests 通过。
- [x] Supervisor history/detail focused tests 通过。
- [x] capability snapshot 在 Codex ACP 不可用时返回 unsupported，而不是伪造支持。

### Phase 1：Hydration 与 Durable Conversation Journal

目标：ACP process 或 Supervisor 重启后，历史不丢失、不重复，provider 上下文可继续。

- [x] 增加明确的 `hydrate` 与 `live` mapping mode。
- [x] 在 `session/load` 前安装 hydration mapper，消费 replayed turns。
- [x] 定义稳定 turn/item ID 及 deterministic fallback。
- [x] 对 hydration replay 实现幂等 upsert 和 coverage 检查。
- [x] 为 assistant streaming partial 增加有界频率 checkpoint。
- [x] 明确 pending permission/question 在重启时的恢复或终止语义。
- [x] 保留 Supervisor-only history fallback，不要求 provider replay 才能读旧消息。
- [x] 处理 hydrate/live 交界处的重复 notification。
- [x] 确认删除 local thread 时 journal 清理仍完整，且不会误删 provider session。

Phase gate：

- [x] fake ACP：Supervisor 在 assistant streaming 中崩溃并重启，partial/final item 无重复且不回退。
- [x] fake ACP：重复执行同一 hydration 两次，SQLite 行数和最终 DTO 不变。
- [x] fake ACP：provider resume 失败时，旧 transcript 仍可只读加载。
- [x] 真实 Codex ACP：Supervisor 与 ACP process 重启后，旧 transcript 完整并可继续上下文。

### Phase 2：ACP Core 共同能力补齐

目标：最大化真正通用的 ACP 能力，不引入 harness-specific 分支。

- [x] 按 initialize response 动态声明 list/load/resume/close/delete。
- [x] 支持 text、image、audio、resource/resource_link prompt block，并按 capability 拒绝不支持类型。
- [x] 完整映射 plan、compaction、usage、title 和 config update。
- [x] 保留 permission option kind、persist scope 和 cancelled 语义。
- [x] 统一 model/reasoning/mode/config option 更新和错误回滚。
- [x] 明确 client FS/terminal 的 workspace boundary 和审计要求。
- [x] 不再把 ACP catalog 的静态能力当成所有 child agent 的真实能力。
- [x] UI 在能力缺失时隐藏或禁用对应操作，并显示可恢复原因。

Phase gate：

- [x] fake ACP capability negotiation matrix E2E 通过。
- [x] 真实 Codex ACP 图片附件 E2E 通过。
- [x] 真实 Codex ACP guarded permission E2E 通过。
- [x] Web reload 后 model/reasoning/context usage 保持正确。

### Phase 3：版本化 Harness Extension 框架

目标：允许 harness 补充 native 能力，同时保持 adapter 小且可测试。

- [x] 定义 extension descriptor：ID、version、methods、events、stability。
- [x] 定义 extension method timeout、cancel、retry 和 idempotency contract。
- [x] 由 runtime registry 合成 effective capabilities。
- [x] 同一 extension 不允许同时注册两个 owner。
- [x] extension event 进入与 ACP core 相同的 journal/event projector。
- [x] adapter 缺失、版本过旧或 probe 失败时安全降级。
- [x] 增加 adapter contract test kit，供 Codex/Claude/OpenCode/其他 ACP harness 复用。
- [x] 文档化“两个 harness 语义一致后才晋升 core”的审阅流程。

Phase gate：

- [x] fake adapter extension method 和 event E2E 通过。
- [x] extension 版本不兼容时 UI 不暴露错误能力。
- [x] extension timeout/cancel 不会启动第二次 provider 操作。

### Phase 4：Codex Extension Adapter Parity

目标：在单一 Codex ACP session owner 下补齐原生 Codex 的关键能力。

- [x] 消费 Codex ACP steering capability，并实现 `sendInput`。
- [x] 实现 request compact extension。
- [x] 确认当前协议无 fork wire surface，形成保留 native 的明确决定且 ACP capability 保持 false。
- [x] 确认当前协议无 rollback/file rewind contract，形成保留 native 的明确决定且 ACP capability 保持 false。
- [x] 消费 goal extension，复用现有 `ThreadGoalCoordinator`。
- [x] 区分 session MCP transport 与 host MCP 管理，后者明确保留 native。
- [x] 对 skills、hooks、hook trust 和 host config 形成明确保留 native 的决定。
- [x] 接入 fast/performance mode，验证 config acknowledgement 和后续 usage；ACP 未暴露的 billing tier 元数据列为已批准限制。
- [x] ACP permission mapping 通过真实 approval；structured question 与 MCP elicitation 在无协商 contract 时明确保留 native。
- [x] 确认 adapter 只使用同一 ACP connection，不启动第二个 app-server owner。

Phase gate：

- [x] 真实 Codex ACP running-turn steer E2E 通过。
- [x] 真实 Codex ACP compact 后继续 prompt E2E 通过。
- [x] fork 探测为 unsupported，ACP capability/UI 保持 false，native fallback 决策已记录。
- [x] rollback 探测为 unsupported，ACP capability/UI 保持 false，native fallback 决策已记录。
- [x] 真实 Codex ACP goal set/pause/resume/clear lifecycle E2E 通过。
- [x] fast config/usage 通过真实 E2E；MCP/skills/hooks 等不保留于 ACP 的项目已记录 native fallback。
- [x] `docs/acp-codex-parity-2026-08-31.json` 无未批准 regression。

### Phase 5：通用 Session Adopt/Import

目标：将“导入本地 thread”从 Codex-only API 提升为基于能力的 Supervisor 功能。

- [x] 定义 adopt eligibility：list + load + cwd + stable session ID + usable history。
- [x] 列出尚未被 Supervisor 管理的 ACP sessions，并按具体 child agent 探测，避免启动全部 harness。
- [x] hydration 导入完整 turns，并记录 provider session binding 与 `agentId`。
- [x] 重复 import 返回已有 local thread，不创建副本。
- [x] candidate 明确标记 history unknown；空历史可导入，load/history unavailable 返回可恢复错误。
- [x] workspace 不存在时沿用可信绝对路径创建/确认流程。
- [x] 保留 native Codex import 作为 migration fallback，直到 ACP 受控切换完成。

Phase gate：

- [x] 在 Supervisor 外通过真实 Codex ACP 创建 thread，Remote Codex 通过 ACP candidate/import API 导入成功。
- [x] 导入后的旧 transcript、cwd、title 和最后回复正确。
- [x] 显式 Resume/Connect 后新 prompt 继续原上下文。
- [x] Supervisor 重启后 imported thread 不重复、不丢失，assistant marker 各恰好一条。

### Phase 6：其他 Harness Adapter 收敛

目标：验证架构不是只为 Codex 定制。

- [x] Claude：列出 core、标准 fork、共享 steering/goal 与必须保留的 SDK management。
- [x] OpenCode：列出 core 与标准 fork；compact 在没有协商 request contract 时保留 native。
- [x] Grok/Cursor：验证 native ACP 无 Remote Codex extension 时只暴露协商到的基础能力。
- [x] Gemini/Copilot/DeepSeek：按本机实际安装状态记录 capability，不伪造 parity。
- [x] 将两个 harness 共同声明的 `session/fork`、steering 与 goal mapping 收敛到共享实现；native mapping 在受控切换前不提前删除。
- [x] 保留无法安全迁移的 native adapter，并在 capability 报告记录退出条件。
- [x] 真实 Claude Agent ACP 运行 shared contract E2E。

Phase gate：

- [x] 真实 Claude Agent ACP 的 create/prompt/restart/transcript/fork E2E 通过。
- [x] 不支持 extension 的 harness 不显示 Codex-only compact/management UI。
- [x] `assertAcpHarnessContract` 同时被真实 Codex 与 Claude verifier 复用。

### Phase 7：客户端 Parity 与受控切换

目标：ACP 路径成为可选默认值，但原生 Codex 仍可快速回滚。

- [x] Web create-thread 和 detail surface 使用 per-agent effective capability。
- [x] iOS/Android WebThread 使用相同 DTO 和 capability，不维护独立特性表。
- [x] Local/server/relay 三种连接模式均能操作 Codex ACP thread。
- [x] native/ACP backend 可按 thread 显式选择，已有 thread 不原地切换 owner。
- [x] ACP status 记录 session start、resume 和 capability probe 失败计数，不记录消息正文。
- [x] README 保留并验证回滚到原生 Codex runtime 的操作说明。
- [x] 更新 README、backend parity 文档和移动端 E2E 入口。

Phase gate：

- [x] Web desktop 与 mobile viewport 真实 Codex ACP E2E 通过。
- [x] iOS 27 simulator 真实 Codex ACP create/prompt/terminate-relaunch smoke 通过。
- [x] Android `Pixel_10_Pro` emulator 真实 Codex ACP create/prompt/reload smoke 通过。
- [x] Android server auth 与 relay-forwarded Codex ACP REST/WebSocket/WebView smoke 通过。
- [x] 同时启用 native/ACP 时，native Codex thread 在 Supervisor 重启后可读取、Resume 并继续上下文。

## 强制 E2E 设计

### 测试隔离

- 使用独立临时 `DATABASE_URL` 和 workspace root。
- 使用唯一测试 thread title、prompt marker 和文件 marker。
- 允许读取现有 Codex 登录态，但不得复制、打印或打包 auth 文件。
- 测试结束清理临时 workspace、Supervisor DB 和测试产物；不得删除 provider 的非测试 session。
- E2E 必须显式 opt in，例如 `REMOTE_CODEX_REAL_ACP_E2E=1`，普通单元测试不得意外调用真实模型。

### 必须新增或固化的入口

建议形成以下稳定入口；实际文件名可调整，但能力不可缺失：

```text
scripts/verify-acp-codex-restart.mts
e2e/acp-codex-parity.spec.ts
e2e/acp-codex-import.spec.ts
```

推荐命令形态：

```bash
REMOTE_CODEX_REAL_ACP_E2E=1 \
REMOTE_CODEX_ENABLED_AGENT_PROVIDERS=codex,acp \
pnpm exec tsx scripts/verify-acp-codex-restart.mts

REMOTE_CODEX_REAL_ACP_E2E=1 \
pnpm exec playwright test e2e/acp-codex-parity.spec.ts \
  --project=desktop-chromium
```

### 最终必须覆盖的真实场景

- [x] 创建 Codex ACP thread，发送真实 prompt，收到唯一 marker。
- [x] 执行真实受控文件写入，Web approval 后确认 workspace 文件内容。
- [x] fake ACP 在 streaming 中崩溃 Supervisor 后 checkpoint 无重复；真实 Codex ACP process/Supervisor restart 后状态与上下文可恢复。
- [x] 完整重启后发送依赖前文的 follow-up，证明 provider context 恢复。
- [x] 导入一个 Supervisor 之外创建的 Codex ACP thread，并继续上下文。
- [x] 从 Web UI 完成 steer、compact、goal、approval 和图片附件等所有 ACP 保留能力；fork 为明确 unsupported/native fallback。
- [x] 浏览器 reload/分页展开后 turn、item、usage 与 goal/pending 状态正确。
- [x] unsupported extension 不显示可点击的假入口。
- [x] 原生 Codex 与 Codex ACP 均运行真实 restart/context verifier，并生成 parity report。

## 验证命令分层

### Focused checks

```bash
pnpm --filter @remote-codex/acp typecheck
pnpm --filter @remote-codex/acp test
pnpm --filter @remote-codex/supervisor-api typecheck
pnpm --filter @remote-codex/supervisor-api exec vitest run \
  src/thread-detail-assembler.test.ts \
  src/thread-history-items.test.ts
```

### Integration checks

```bash
pnpm --filter @remote-codex/supervisor-api test
pnpm --filter @remote-codex/supervisor-web typecheck
pnpm --filter @remote-codex/supervisor-web test
pnpm build
```

### Real E2E checks

真实 E2E 命令必须由实施阶段新增并保持可重复。最终至少运行：

```bash
REMOTE_CODEX_REAL_ACP_E2E=1 \
pnpm exec tsx scripts/verify-acp-codex-restart.mts

REMOTE_CODEX_REAL_ACP_E2E=1 \
pnpm exec playwright test e2e/acp-codex-parity.spec.ts \
  --project=desktop-chromium
```

如果变更影响 `@remote-codex/thread-ui`：

```bash
(
  cd ../remote-codex-thread-ui
  pnpm --filter @remote-codex/thread-ui build
  pnpm --filter @remote-codex/thread-ui test
)
pnpm --filter @remote-codex/supervisor-web test
pnpm --filter @remote-codex/supervisor-web build
```

如果变更影响移动端 contract、WebThread 或用户可见 capability：

```bash
pnpm verify:mobile:parity-gate
```

并运行相关 iOS simulator 与 Android emulator 真实 Codex ACP smoke。只有构建 APK/IPA 不能替代该 smoke。

## E2E 证据模板

每次关闭 Phase gate 时追加一段，不覆盖旧记录：

```text
日期：
Commit：
平台：
codex --version：
codex-acp --version：
ACP protocol / extension versions：
命令：
场景：
结果：
本地 evidence 路径：
已脱敏检查：是/否
已清理临时资源：是/否
```

禁止记录 auth token、完整环境变量、cookie、用户真实 workspace 内容或 provider 私密响应。

### Phase 0 基线证据

日期：2026-08-31<br>
Commit 基线：`ea4764b3c08343f9720b773830dc45b9b9b980fd`<br>
平台：macOS arm64<br>
`codex --version`：`codex-cli 0.150.1`<br>
`codex-acp --version`：`@agentclientprotocol/codex-acp 1.6.2`<br>
ACP protocol：`1`<br>
能力快照：`docs/acp-capability-baseline-2026-08-31.json`<br>
命令与结果：

- `REMOTE_CODEX_ACP_COMMAND=codex-acp pnpm exec tsx scripts/inspect-acp-capabilities.mts`：成功，确认 list/load/resume/close/delete、image、MCP、steering 和 goal 协商结果。
- `pnpm --filter @remote-codex/acp typecheck`：成功。
- `pnpm --filter @remote-codex/acp test`：8 files、23 tests 通过。
- `pnpm --filter @remote-codex/supervisor-api typecheck`：成功。
- `pnpm --filter @remote-codex/supervisor-api exec vitest run src/thread-detail-assembler.test.ts src/thread-history-items.test.ts src/thread-history-persistence-coordinator.test.ts`：3 files、26 tests 通过。
- `pnpm --filter @remote-codex/db typecheck`：成功。

检查：capability snapshot 不含 credentials、session ID 或 message content；测试临时 SQLite 和 fake ACP state 已由测试 teardown 清理。本证据只关闭 Phase 0，不替代后续真实 Codex ACP restart/Web E2E。

### Phase 1 Hydration 与重启证据

日期：2026-08-31<br>
Commit 基线：`ea4764b3c08343f9720b773830dc45b9b9b980fd` 加当前 worktree 变更<br>
平台：macOS arm64<br>
`codex --version`：`codex-cli 0.150.1`<br>
`codex-acp --version`：`@agentclientprotocol/codex-acp 1.6.2`<br>
ACP protocol：`1`<br>
命令与结果：

- `pnpm --filter @remote-codex/acp typecheck && pnpm --filter @remote-codex/acp test`：9 files、27 tests 通过。
- `pnpm --filter @remote-codex/supervisor-api typecheck`：成功。
- `pnpm --filter @remote-codex/supervisor-api exec vitest run src/thread-detail-assembler.test.ts src/thread-history-items.test.ts src/thread-history-persistence-coordinator.test.ts`：3 files、28 tests 通过。
- `pnpm exec tsx scripts/verify-fake-acp-supervisor-restart.mts`：在 assistant streaming 中 `SIGKILL` Supervisor 后，Supervisor-only fallback 恢复成功；resume/hydrate 后 matching turn 为 1、assistant item 为 1、无重复。
- `REMOTE_CODEX_ACP_COMMAND=codex-acp REMOTE_CODEX_ACP_TIMEOUT_MS=180000 pnpm exec tsx scripts/verify-acp-codex-restart.mts`：真实 Codex ACP seed marker、单 turn hydrate、零 live replay 和 provider context continuation 均成功，测试 provider session 已通过 `session/delete` 清理。

实现检查：hydrate turn/item 会与 Supervisor live checkpoint 做保守语义对齐；ACP v1 缺少权威历史总数时明确返回 `historyCoverage.completeness=unknown`，不伪造 complete。fake/真实 verifier 均删除临时 workspace/state；输出不含 session ID、凭据或消息正文。

### Phase 2 ACP Core 证据

日期：2026-08-31<br>
Commit 基线：`ea4764b3c08343f9720b773830dc45b9b9b980fd` 加当前 worktree 变更<br>
平台：macOS arm64<br>
`codex --version`：`codex-cli 0.150.1`<br>
`codex-acp --version`：`@agentclientprotocol/codex-acp 1.6.2`<br>
命令与结果：

- `pnpm --filter @remote-codex/acp typecheck && pnpm --filter @remote-codex/acp test`：11 files、33 tests 通过；覆盖 full/minimal negotiation、typed image/audio/resource、config rollback、workspace symlink escape 和 terminal boundary。
- `pnpm --filter @remote-codex/supervisor-api typecheck`：成功。
- `pnpm --filter @remote-codex/supervisor-web typecheck`：成功。
- `pnpm --filter @remote-codex/supervisor-web exec vitest run src/pages/ThreadDetailPage.test.tsx src/lib/api.test.ts`：2 files、64 tests 通过。
- `pnpm exec tsx scripts/verify-fake-acp-supervisor-restart.mts`：child negotiated lifecycle 经 Supervisor API 可见，streaming crash/restart 仍无重复。
- `REMOTE_CODEX_ACP_CORE_E2E=1 ... pnpm exec playwright test e2e/acp-core-capability.spec.ts --project=desktop-chromium`：1 test 通过；Web timeline、model=`fixture-fast`、reasoning=`high`、context usage 和 reload 后单 turn 均正确。
- 使用隔离 `CODEX_HOME` 运行 `REMOTE_CODEX_ACP_COMMAND=codex-acp REMOTE_CODEX_ACP_TIMEOUT_MS=180000 pnpm exec tsx scripts/verify-acp-codex-restart.mts`：真实图片识别、1 次 guarded permission、文件写入、重启上下文和两个 session 删除均成功。

实现检查：per-agent capability snapshot 在 unavailable 时返回 `effectiveCapabilities=null`；Web 使用全 false capability 并显示 adapter 修复信息。FS、write 和 terminal cwd 均限制在 session workspace，审计事件只包含 operation/session/path，不包含文件内容。

环境说明：未隔离的真实 verifier 曾在共享 `~/.codex/state_5.sqlite` 复现并发 state 污染，新测试 thread ID 被错误映射到旧 rollout path。最终 gate 改用临时 `CODEX_HOME`，只符号链接 auth/config，未复制或输出凭据。为避免误伤真实 rollout，未自动删除共享 DB 中四条错误测试索引；后续真实 E2E 必须继续使用隔离 home。

### Phase 3 Harness Extension Framework 证据

日期：2026-08-31<br>
Commit 基线：`ea4764b3c08343f9720b773830dc45b9b9b980fd` 加当前 worktree 变更<br>
平台：macOS arm64<br>
命令与结果：

- `pnpm --filter @remote-codex/acp typecheck && pnpm --filter @remote-codex/acp test`：12 files、37 tests 通过。
- `pnpm --filter @remote-codex/supervisor-api typecheck`：成功。
- `pnpm --filter @remote-codex/supervisor-api exec vitest run src/thread-runtime-event-projector.test.ts src/thread-detail-assembler.test.ts src/thread-history-items.test.ts src/thread-history-persistence-coordinator.test.ts`：4 files、29 tests 通过。
- fake ACP stdio extension `fixture.session/v1/compact`：method response 成功，公共 extension event notification 被 runtime 接收并转为 `harness.extension`。
- Registry contract：重复 idempotency key 只执行一次；不同 operation 复用 key 返回 conflict；timeout 触发 cooperative abort 且允许显式 retry；v2 请求不会命中仅注册 v1 的 adapter。
- Supervisor projector：extension event 经标准 `ThreadRuntimeEventProjector` 写入 `thread_history_items`，只保存规范化摘要，不持久化测试中的敏感 payload。

实现检查：negotiated descriptor 不直接开启 UI；只有本地 adapter 注册的 capability patch 能贡献 effective capability。一个 extension version 只有一个 owner，owner 卸载后 capability 自动消失。

### Phase 4 Codex Extension Adapter 证据

日期：2026-08-31<br>
Commit 基线：`ea4764b3c08343f9720b773830dc45b9b9b980fd` 加当前 worktree 变更<br>
平台：macOS arm64<br>
`codex --version`：`codex-cli 0.150.1`<br>
`codex-acp --version`：`@agentclientprotocol/codex-acp 1.6.2`<br>
ACP protocol：`1`<br>
命令与结果：

- `pnpm --filter @remote-codex/acp typecheck && pnpm --filter @remote-codex/acp test`：12 files、39 tests 通过。
- `REMOTE_CODEX_ACP_COMMAND=codex-acp REMOTE_CODEX_ACP_TIMEOUT_MS=180000 pnpm exec tsx scripts/verify-acp-codex-restart.mts`：真实 running-turn steering、同 session compact 后继续、goal set/pause/resume/clear、fast config 与后续 usage、图片、guarded permission、重启上下文均通过。
- `docs/acp-codex-parity-2026-08-31.json`：fork、rollback、MCP management、skills、hooks、hook trust、host config 与 billing tier metadata 均有显式 native fallback 或限制说明；`unapprovedRegressions=[]`。

实现检查：steering/goal 使用 initialize `_meta` 中的 method/action 协商；compact 通过同一 ACP session 的隐藏 `/compact` turn 执行；未启动第二个 app-server owner。测试 session、隔离 Codex home 和 workspace 已清理，输出不含 session ID、凭据或消息正文。

### Phase 5 Session Adopt/Import 证据

日期：2026-08-31<br>
Commit 基线：`ea4764b3c08343f9720b773830dc45b9b9b980fd` 加当前 worktree 变更<br>
平台：macOS arm64<br>
命令与结果：

- `pnpm --filter @remote-codex/supervisor-api exec vitest run src/app.test.ts`：156 tests 全部通过。
- `pnpm --filter @remote-codex/supervisor-web exec vitest run src/pages/ThreadImportPage.test.tsx src/lib/api.test.ts`：2 files、18 tests 通过。
- `REMOTE_CODEX_REAL_ACP_E2E=1 REMOTE_CODEX_ACP_COMMAND=codex-acp pnpm exec tsx scripts/verify-acp-codex-import.mts`：Supervisor 外创建真实会话、unmanaged candidate discovery、`agentId`/cwd/history 导入、重复 import 复用、显式连接、上下文续接与 Supervisor 重启全部通过；重启后 seed/continuation assistant marker 各 1 条。

实现检查：Import 页面只启动所选 ACP child；候选列表过滤已管理 session；runtime import 使用 `local_provider_import`，断开时拒绝 prompt。provider replay 包含 developer instructions 时使用有长度下限的 containment 对齐 visible prompt，修复真实重启后的重复 turn。临时 DB、workspace 和隔离 Codex home 已清理。

### Phase 6 多 Harness 收敛证据

日期：2026-08-31<br>
Commit 基线：`ea4764b3c08343f9720b773830dc45b9b9b980fd` 加当前 worktree 变更<br>
平台：macOS arm64<br>
能力报告：`docs/acp-harness-capabilities-2026-08-31.json`<br>
命令与结果：

- 实际版本探测：Claude Code `2.1.251` / Claude Agent ACP `0.70.0`；OpenCode `1.17.11`；Grok `1.0.13`；Cursor Agent `2026.08.11-e8db854`；Gemini/Copilot base missing；DeepSeek Harness `0.1.2-alpha.2` 但 `dsh-acp` missing。
- 分别对 `claude-agent-acp`、`opencode acp`、`grok agent stdio`、`cursor-agent acp` 运行 initialize inspector，均成功记录协议 1 的真实协商能力。
- `pnpm --filter @remote-codex/acp typecheck && pnpm --filter @remote-codex/acp test`：13 files、43 tests 通过；Codex profile 与 portable fork profile 共用 `assertAcpHarnessContract`。
- `REMOTE_CODEX_REAL_ACP_E2E=1 REMOTE_CODEX_ACP_COMMAND=claude-agent-acp ... pnpm exec tsx scripts/verify-acp-non-codex-harness.mts`：真实 create/prompt/process restart/hydrate/context continuation、标准 session fork、fork context continuation 和 session cleanup 全部通过。
- 共享 contract checker 接入后重新运行真实 Codex verifier：restart、steer、compact、goal、fast、image、approval 全部通过。

实现检查：Claude/OpenCode 同时声明的 unstable `session/fork` 晋升 ACP core；Codex/Claude 同 contract steering/goal 复用协商 adapter；Codex `/compact` 未泄漏给其他 harness。Claude fork 的 provider load 返回空 transcript 时，child journal 使用已 hydrate source snapshot，随后用真实 nonce follow-up 独立证明 fork provider context。测试 session 与 workspace 已清理，报告不含凭据、session ID 或消息正文。

### Phase 7 客户端与受控切换证据

日期：2026-08-31<br>
Commit 基线：`ea4764b3c08343f9720b773830dc45b9b9b980fd` 加当前 worktree 变更<br>
平台：macOS arm64；Chrome desktop/Pixel 5 viewport；Android `emulator-5554` / `Pixel_10_Pro`；iOS 27 iPhone 17 Pro simulator<br>
命令与结果：

- `pnpm exec tsx scripts/verify-acp-codex-web-e2e.mts --project=desktop-chromium`：1 passed；真实 fast、图片、running steer、compact 后继续、goal、read-only guarded approval、reload + load-earlier 唯一计数全部通过。
- 同一 wrapper 的 `--project=mobile-chromium`：1 passed；真实 prompt/reload 与 composer viewport boundary 通过。
- Android debug APK：Gradle build/install 成功；`e2e/android-acp-codex-smoke.mjs` 在 local、authenticated server 和 relay 三种模式均通过，`agentId=codex`、`gpt-5.6-sol/xhigh`、status idle、WebView marker/reload 和 Codex-only capability 过滤正确。
- Server auth：匿名 `/api/workspaces` 返回 401，登录 token 可用。Relay：`Dockerfile.relay` image build 成功，`supervisorConnected=true`，forwarded `/api/workspaces` 200，Android Relay WebView prompt/reload 成功。
- iOS `testLiveLocalAcpThreadShowsAgentAndSubmitsPrompt`：Xcode 27，1 test、0 skip、0 failure；真实 Codex ACP prompt 后 terminate/relaunch，同一 marker 恢复。证据：`.local/mobile-parity/evidence/RemoteCodexRealProvidersFinal.xcresult`。
- `pnpm exec tsx scripts/verify-native-codex-fallback.mts`：native 与 ACP 同时 selectable，native thread owner 保持、Supervisor restart、显式 Resume、transcript 与 provider context continuation 全部通过。
- 最终 checks：ACP 13 files / 44 tests；Supervisor 18 files / 225 tests；Web 20 files / 320 tests；Android unit 与 release assemble；iOS unit 72 tests；`pnpm build` 全 workspace 成功。

实现检查：ACP catalog toolbox 由 effective capability 过滤；Codex 不显示 fork，Claude/OpenCode 的标准 fork 不泄漏 Codex compact。catalog request ID 与 session ID 分别 scope，真实 guarded permission 能投影到 Web。ACP status 只暴露 failure counters。所有临时 auth symlink、Codex home、DB、workspace、relay token 和测试 session 已清理。

`pnpm verify:mobile:parity-gate` 已执行但仍非零：该 release collector 要求至少 15 条历史 Android connected tests、10 条 iOS real-provider tests、完整 fixture/local/server/relay xcresult 集和 signed release artifacts，并要求 tracked worktree clean。本计划新增并实际通过的 targeted Android local/server/relay、iOS Codex ACP、Android/iOS unit 和 unsigned release assemble 证据均已单独记录；未通过的 aggregate collector 未被冒充为成功。

### 完成后源码审计与复验证据

日期：2026-08-31<br>
Commit 基线：`ea4764b3c08343f9720b773830dc45b9b9b980fd` 加 `codex/acp-harness-adapter-plan` 功能分支提交
审计方式：从 worktree、实际 diff、运行时代码和本机测试产物重新核验，不使用旧对话记录作为完成依据。

源码复核发现并修复：

- Legacy goal extension 现在只接受版本 1 且同时声明 `set`/`clear`；未知版本或不完整 action fail closed。
- Extension invocation 对调用前和调用中的 abort 都会及时返回 `extension_cancelled`，不会因 transport 忽略 signal 而悬挂；compact 隐藏 turn 启动失败会清理 listener，避免未处理 rejection。
- ACP catalog 的 capability union 不再泄漏到具体 child：create/resume/prompt/settings/steer/compact/fork/goal、DTO 和 usage pricing 均按 `agentId`/scoped session 取 effective capability；无 fast 能力的 child 不再收到 `performanceMode=standard`。
- 模型 capability probe 只有在协商到 `session/delete` 时才创建临时 session，并始终 delete；仅有 `session/close` 时使用无副作用回退。OpenCode 增加 `opencode models` 回退和逐行 `provider/model` 解析。

本轮重新执行的命令与结果：

- `pnpm --filter @remote-codex/acp test`：13 files、53 tests 通过；ACP typecheck 与 lint 通过。
- `pnpm --filter @remote-codex/supervisor-api test`：19 files、226 tests 通过；`pnpm --filter @remote-codex/supervisor-web test`：20 files、320 tests 通过。
- `pnpm typecheck` 与 `pnpm build`：全 workspace 成功，包含 Supervisor Web、Android WebThread 和 iOS WebThread。
- 真实 Codex restart verifier：hydrate 无 live replay、provider context、image、steer、compact、goal、fast usage、guarded approval/file write 和 session delete 全部通过。
- 真实 Claude shared-contract verifier：restart/hydrate/context、标准 fork、fork context、steering、goal 和 session delete 全部通过。
- 真实 Web wrapper：`desktop-chromium` 与 `mobile-chromium` 各 1 test 通过；desktop 执行完整 capability 流程。
- fake streaming crash、真实 Codex adopt/import、native Codex fallback 三个 verifier 全部通过，且运行结束后未残留测试临时目录。
- 本机移动端产物复核：iOS 27 real-provider xcresult 为 1/1 通过，iOS unit xcresult 为 72/72 通过；Android local/server/relay 三份证据存在。

Lint 收口：根级 `pnpm lint` 已返回 0。除原先记录的 10 个 Supervisor unused-variable error 外，完整 lint 继续执行后又暴露 6 个 Web unused-variable error；均已在不改变行为的前提下清理。当前仍有 28 个既有 React fast-refresh/hook warning，但没有 lint error。

## 完成定义

只有同时满足以下条件，Goal 才能标记 complete：

- [x] Phase 0-7 所有保留范围内 checklist 已关闭。
- [x] ACP core 与 harness extension 边界已进入维护文档和代码 contract。
- [x] Conversation journal 通过 hydrate/live、重启、幂等和 partial checkpoint 验证。
- [x] Codex ACP 所有保留能力达到原生 Codex 的用户可见 parity，批准的 native fallback 除外。
- [x] 真实 Codex ACP restart E2E 成功，且证明确实继续了原 provider context。
- [x] 真实 Web E2E 从 UI 操作关键能力成功。
- [x] 受影响的 iOS/Android/Relay E2E 成功。
- [x] native Codex fallback 与回滚说明已验证。
- [x] 没有同一 session 的双 process owner。
- [x] 没有 capability 硬编码伪造、测试 skip 冒充成功或未记录的已知 regression。
- [x] E2E 证据已按模板记录且完成脱敏与临时资源清理。

以下情况不能算完成：

- 只有 unit/integration test 通过，没有真实 `codex-acp`。
- 只有 API curl smoke，没有浏览器用户流程。
- 只验证新 thread，没有 Supervisor/ACP process 重启。
- 只恢复 UI transcript，没有证明 provider context 可以继续。
- Codex ACP 缺失 native 能力，但 UI 静默隐藏且没有批准的产品决策。
- 依赖手工修改数据库、复用正式 Supervisor DB 或输出真实凭据。

## 风险与回滚

| 风险 | 缓解 |
| --- | --- |
| hydrate replay 与 live event 重复 | 明确 mode、稳定 ID、idempotency key、重复 hydration 测试 |
| extension 版本漂移 | initialize negotiation、版本范围、unsupported 降级 |
| 两个 owner 操作同一 Codex thread | adapter 唯一 owner 约束、process/session generation 检查 |
| Supervisor journal 与 provider history 分叉 | coverage 标记、只增量合并、不静默删除、parity report |
| streaming crash 丢 partial | 有界 checkpoint、重启 E2E |
| ACP 最小公分母拖累产品 | harness extension 保留差异能力，不强迫错误抽象 |
| adapter 再次膨胀成 runtime | contract test kit、职责边界、代码审阅检查 |
| 真实 E2E 不稳定或昂贵 | 唯一 marker、文件 side effect、显式 opt in、保留 trace |

在任何 Phase 出现严重 regression 时：

1. 保持原生 Codex 为默认或恢复为默认。
2. 禁用对应 ACP extension capability，不伪造成功。
3. 保留 Supervisor journal，避免因 runtime 回滚丢失 transcript。
4. 记录失败版本、session generation 和脱敏诊断。
5. 修复并重新运行真实 E2E 后再恢复 rollout。
