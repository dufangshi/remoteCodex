# 本机线程协作 CLI：设计讨论稿

状态：待用户评审，尚未实现。本文中的命令、API、字段和默认值均为提案。

工作目录：`/Users/mac/dev/remoteCodex-thread-messaging`  
分支：`feat/local-thread-messaging`  
起点：`0b1d60f8`  
本阶段只整理设计；用户评审后再开始实现和容器测试。

## 1. 要解决的问题

主线程完成代码修改后，可以把 NPM 发布、GitHub Actions 跟踪等长时间工作交给另一个线程，指定适合的模型和推理等级，然后结束当前轮。远端工作完成后，由 remoteCodex 把一条简短通知作为 prompt 交给发起线程，发起线程再按需读取结果。

线程是平等的：A 可以给 B 发任务，B 也可以给 A 发任务。这里的“主线程 / 子线程”描述一次委派关系，不是线程的永久身份。

用户已经明确的要求：

- CLI 可以创建线程、选择模型和推理等级、分配任务、读取 transcript、在线程之间发消息。
- 默认 transcript 包含 prompt、所有 Agent 对外文字回复（包括中间进度说明）及时间戳；工具与其他详细记录逐级展开。
- 创建并分配任务时可以选择是否在完成后通知发起者。
- 保存过去合作过的线程，方便显式复用。
- 使用 remoteCodex 网页 URL 最后一段的线程 ID，不要求用户知道 harness session ID。
- 通信属于 remoteCodex，支持 Codex 与 ACP Grok 等不同 provider 相互调用。
- 第一版主要服务本机，可以在独立容器中验证。

## 2. 建议先对齐的三个粒度

### 2.1 线程是长期会话，消息是一次交付

建议第一版只引入持久化的“线程消息”和“合作关系”。一条任务消息触发目标线程的一次 prompt 执行，并关联实际的 turn ID。暂不另建具有多步骤编排能力的独立 Task 系统。

这样可以复用一个发布线程处理多次发布，每次都有独立 message ID、执行状态和通知对象。创建线程与发送任务在概念上分开，CLI 提供一条命令完成两步的便捷入口。

**待确认 A：** 第一版是否接受“一条任务消息对应一轮执行”？如果需要 Agent 多轮自主执行、跨人工问答后才宣告任务结束，就需要独立的 Task 生命周期，不能把 turn 结束当作任务结束。

### 2.2 发送意味着自动唤起，忙碌时默认排队

建议 `message send` 的默认语义：持久化接受消息后立即返回；目标空闲时自动启动一轮，目标运行中则 FIFO 排队，在当前轮结束后启动。

发起线程不需要保持工具调用或轮询进程运行。消息排队顺序以数据库序号为准，不能只依赖可能相同的时间戳。一个线程同一时刻最多运行一轮，网页 prompt 和 CLI 消息共用串行调度约束。

**待确认 B：** 第一版是否只保证排队交付？运行中实时插话可以以后增加 `--delivery steer`，并由 capability 明确支持情况。不能在不支持的 provider 上偷偷把实时插话变成中断重启。

### 2.3 完成通知是一条新的消息

建议通知订阅挂在任务消息上，而不是在线程上设置永久回调。任务执行进入终态时，runtime 产生一条 `completion` 消息交给原发起者；它同样遵守忙碌排队、空闲唤起规则。

建议区分 `completed`、`failed`、`interrupted`，只描述本轮执行结果。`completed` 不等于“CI 成功”或“发布成功”，业务结果由 Agent 的文字回复说明。等待权限或人工输入不属于完成。

通知默认不再请求完成通知，避免两个线程仅因系统回执无限互相唤起。Agent 主动反向委派仍然允许。

## 3. CLI 草案

所有命令输出结构化 JSON，字段采用 camelCase。大段输入支持 `--body-file`，`-` 表示 stdin。以下占位符由实际 ID 和当前 provider 的模型目录替换。

```sh
# 发现可用 backend / agent / model / reasoning effort。
remote-codex thread backends
remote-codex thread models --provider acp --agent grok

# 找到当前身份、当前 workspace 和过去合作过的线程。
remote-codex thread self
remote-codex thread peers
remote-codex thread list --workspace WORKSPACE_ID
remote-codex thread show THREAD_ID

# 创建并委派。默认使用调用者 workspace，也可以明确指定。
remote-codex thread create \
  --title release-watcher \
  --provider acp --agent grok \
  --model MODEL_ID --reasoning-effort low \
  --body-file release-task.txt \
  --notify-on-complete

# 复用已存在的线程，发起者从本机调用上下文中取得。
remote-codex message send THREAD_ID \
  --body-file next-release-task.txt \
  --notify-on-complete

# 对方也能反向调用，接口相同。
remote-codex message send ORIGINAL_SENDER_THREAD_ID \
  --body "请检查这次发布的版本号是否正确。"

# 读取交付和执行状态，不隐式拉取完整历史。
remote-codex message show MESSAGE_ID
remote-codex message list --thread THREAD_ID

# 分级发现记录。
remote-codex thread transcript THREAD_ID
remote-codex thread transcript THREAD_ID --message MESSAGE_ID
remote-codex thread transcript THREAD_ID --cursor CURSOR
remote-codex thread transcript THREAD_ID --view turn --turn TURN_ID
remote-codex thread transcript THREAD_ID --view item --turn TURN_ID --item ITEM_ID
remote-codex thread transcript THREAD_ID --view raw --turn TURN_ID --item ITEM_ID
```

建议 `--notify-on-complete` 是每次任务的显式选项，默认关闭。`create` 未带任务时只创建线程，不能订阅一个尚不存在的任务的完成通知。

`create` 不自动复制发起线程的 transcript；任务上下文由发起者写入 prompt，需要时再通过 CLI 下钻读取。创建结果只返回线程、消息和状态等小型回执。创建成功而初始任务提交失败时，必须返回已创建的 thread ID 和明确错误，便于恢复，不能让重试静默创建重复线程。

建议 ID 参数也接受完整线程 URL，但要校验 URL 中的 device ID 是当前 Supervisor 的设备。UUID 是同一设备内的寻址方式；不通过 URL 自动触发跨设备路由。

模型和推理等级以目标 harness 的能力目录为准。明确指定而不支持的值应报可操作的错误，不能静默换成另一模型或另一等级；没有可选推理等级的 provider 可以省略该参数。

## 4. Transcript 的逐级发现

这里的“概览”是确定性过滤，不能额外调用模型生成摘要。过滤只控制显示层，不删除存储内容。

| 层级 | 内容 | 返回的下钻入口 |
| --- | --- | --- |
| `overview`（默认） | 该页各轮的输入 prompt 和所有对外 `agentMessage`；包含进度说明与最终回复；逐条时间戳 | turn ID、隐藏条目数、下一页 cursor |
| `turn` | 指定轮的全部条目目录：种类、ID、时间戳、状态、短预览 | item ID 与该条完整内容入口 |
| `item` | 单条完整的规范化内容，例如命令、输出、工具调用结果、diff；大内容仍分段 | 内容续读 cursor、raw 入口、附件引用 |
| `raw` | 单条记录在 remoteCodex 中实际保存的完整 JSON，包括扩展字段 | 大字段续读入口和已保存附件引用 |

第一轮能读到最初始 prompt；后续轮也保留各自输入，包括其他线程发送的消息和系统完成通知，避免复用线程后丢失语境。可以按 message ID 直接定位本次任务，避免从整个线程历史寻找。

建议默认从第一轮开始，一页一轮；所有层级都有响应体大小上限。如果一轮中 Agent 文字很多，也应提供续读 cursor，不能为了限长只留下最终回复。具体字节上限在实现前定一个统一常量。

默认层不包含工具输出、diff、原始协议事件或 harness 提供的 reasoning 类条目。只展示 provider 已暴露且 remoteCodex 已持久化的内容，不承诺获取模型内部未提供的推理或从未保存的 stdio 日志。

必须保持每条中间文字回复的原始边界、先后顺序和可用时间戳。历史记录缺少时间戳时，返回空值或明确注明来自 turn 的回退时间，不编造精确发送时间。运行中的输出必须标注未完成；cursor 应绑定稳定快照或记录修订信息，不能把正在增长的文本当成不可变记录而漏读尾部。

现有 Web 折叠只保留最后一条 Agent 回复，不能直接作为本接口的 overview。第一版增加独立读取投影，不要求同步修改前端呈现。

## 5. 完成通知与恢复

建议通知文本保持短小，示例：

```text
线程 release-watcher（THREAD_ID）已结束消息 MESSAGE_ID 对应的执行。
执行状态：completed；结束时间：2026-09-11T16:20:00Z。
请运行 remote-codex thread transcript THREAD_ID --message MESSAGE_ID 查看结果。
```

通知必须携带发起消息、发送线程、接收线程、实际 turn ID 和终态，不自动塞入整段日志。若 Agent 回复“需要人工批准”，回执不能宣称发布成功。

建议持久化的最低要求：

- 接受回执必须发生在 SQLite 提交之后，进程内 `spawn` 不等于消息已可靠接受。
- 发送重试支持调用者提供幂等键；同一身份、同一键、同一请求返回同一结果，参数不一致则报冲突。
- 消息与执行 turn 的绑定必须原子建立，避免竞争产生两次执行。
- 执行终态与待发完成通知应在同一事务中记录，通过唯一约束去重；通知入队后才能标为已交付。
- Supervisor 启动时恢复尚未开始的消息和待发通知。已经开始但因崩溃中断的任务要暴露中断状态，不能盲目重跑可能有发布副作用的 prompt；既有更新恢复流程另外协调。
- 目标线程删除、模型启动失败、权限请求等待等情况都可查询，不能静默丢弃。删除后的消息保留稳定引用，列表标明对端不可用。

这里保证的是可靠入队、关联和通知去重，不承诺任意外部发布操作的 exactly-once。

## 6. 合作关系与调用身份

`thread peers` 建议返回过去合作过的线程 ID、标题、workspace、provider、agent、模型、当前状态、最近联系时间、收发数量以及最近 message ID。两边都能发现对方，不设置父线程所有权。

第一版由 Agent 读取 peers 后决定是否复用。不要仅凭标题相同自动复用，因为旧线程可能有不同 workspace、权限和上下文。线程的模型配置按现有设置管理，发新任务不偷偷覆盖目标线程的设置。

建议通过统一 runtime 为受管理的 harness 注入本机 CLI 上下文：Supervisor 本机地址、remoteCodex thread ID，以及受本机接口验证的调用凭据。具体机制在实现时检查 ACP 启动 / 恢复路径；环境变量作用于独占会话进程，若进程复用则必须改为会话级传递，不能把一个全局 thread ID 发给多个会话。

进程启动前需要分配 remoteCodex thread ID；现有代码在 harness session 创建后才生成 ID，这一点需要调整。恢复已有会话也必须重新绑定身份。权限不能仅由用户可修改的 `--from` 或 thread ID 环境变量证明。

本机 CLI 不应要求 Agent 掌握公共 Relay 管理员密码。建议使用仅本机可访问的专用入口和调用凭据，拒绝公共 Relay 转发访问这个入口；沿用已有项目授权边界，不把任意局域网连接当作可信本机调用。具体采用 loopback HTTP 还是 Unix socket / Windows 对应 IPC，留给下一轮设计收敛。

**待确认 C：** 建议第一版允许同一个 Supervisor 下跨 workspace 的显式线程通信；默认创建和发现限制在当前 workspace。线程平等表示双向调用能力相同，不表示绕过设备或 workspace 的既有权限。

## 7. 实现归属与现有代码差距

```text
任何受管理的 Agent / 本机用户
  -> remote-codex CLI
  -> 本机 Supervisor API
  -> runtime 消息存储与线程调度
  -> AgentRuntime
  -> ACP / 各 harness 的薄适配
```

| 所属 | 计划职责 |
| --- | --- |
| `crates/protocol` | 消息、合作关系、分级 transcript 的 camelCase DTO |
| `crates/runtime` | SQLite migration、可靠入队、turn 绑定、终态通知、恢复、查询投影 |
| `crates/supervisor` | 统一 API、本机身份验证、请求校验 |
| `crates/cli` | 命令解析、输入文件、当前身份发现、JSON 回执和下钻导航 |
| `crates/runtime/src/acp/` | 必要的环境 / 会话上下文传递和 capability 差异，保持薄适配 |

API 建议以 `/api/thread-messages` 和 `/api/threads/{id}/transcript` 等资源组织；本机路由注册、认证方式和最终路径待实现前确认。CLI 不直写 SQLite，也不直接调用 Codex app-server 或 Grok 私有接口。

现有源码支持本方案的基础，但还不满足全部语义：

- [service.rs](../crates/runtime/src/service.rs) 已统一创建线程、prompt、pending steers 和执行完成持久化；需要可靠消息与具体 turn 的事务绑定，并处理与网页提交的并发。
- [http.rs](../crates/supervisor/src/http.rs) 当前空闲线程的 prompt 通过后台任务启动；不能把这条路径的早返回直接当作持久化消息回执。
- [history.rs](../crates/runtime/src/history.rs) 当前摘要仅保留输入与最后一条 Agent 回复；新 overview 必须保留所有中间对外回复，运行中也不能意外倾倒全部工具记录。
- [service.rs](../crates/runtime/src/service.rs) 的单条详情接口只挑选部分字段，并且按 thread + item 寻址；新 raw 视图需要保留已存完整 JSON，并以 thread + turn + item 消除歧义。
- [db.rs](../crates/runtime/src/db.rs) 已持久化 turns 和 history items；尚未发现通用、完整的协议事件日志，不能把 EventBus 广播误称为可永久回放日志。
- [auth.rs](../crates/supervisor/src/auth.rs) 区分本地 / server / relay 认证；新增 Agent CLI 凭据必须与现有网页和可信 Relay 转发入口明确区分。

参考 `~/dev/treer/crates/treer-cli/src/main.rs` 的结构化 JSON、文件输入、overview / turn / item / full 逐级读取和相关 ID 思路。本方案只移植适合本机线程协作的部分，不引入 Treer 的分布式控制平面。

## 8. 下一阶段的验收场景

本阶段不执行实现测试。方案确认后，在独立数据目录和容器 Supervisor 中验证：

1. A 创建 B，指定 provider / agent / model / effort，命令在持久化接受后返回，A 不等待 B 执行结束。
2. B 完成后 A 收到一次简短通知并自动运行；A 忙碌时通知排队，关闭通知时不唤起 A。
3. B 反向给 A 发任务；A 通过 peers 复用 B，前后任务的回执互不串线。
4. Codex → ACP Grok、ACP Grok → Codex 都通过同一 API；先用确定性 fixture 覆盖调度，再在凭据可用时验证真实 provider。fixture 通过不等于真实模型验证通过。
5. overview 同时包含初始 prompt、中间说明和最终回复；大量工具输出不进入默认层，但可通过 turn / item / raw 读全。
6. 多轮、超长文字、运行中增长、同名 item、缺失时间戳、分页边界和附件引用均不造成静默遗漏或错误寻址。
7. 并发消息与网页 prompt 不丢失、不重复执行；幂等重试和通知去重成立。
8. 进程在接受消息、开始执行、完成执行和通知交付之间退出时，重启后状态可解释、可恢复，不自动重发有副作用的已开始任务。
9. 无效本机凭据、伪造发起者、错误 device URL 和公共 Relay 转发不能绕过本机入口边界。

修改 `crates/` 后运行 `cargo test --workspace`。如涉及 Web，再按项目 focused-e2e skill 选择明确 spec 和 browser project；本提案本身不需要 Web 改动。重启 / 恢复测试遵循项目要求，在 Treer Apple container 测试机进行，不操作活跃宿主 Supervisor。Docker 可用于其他隔离的调用和并发测试。

## 9. 评审后再冻结的选择

优先确认 A（一轮执行还是显式 Task 完成）和 B（默认排队是否足够）；这两项直接决定数据模型与调度复杂度。

C（同设备跨 workspace）、默认 overview 的起始位置 / 一页一轮、通知开关默认关闭也都是建议值，尚未视作用户已同意。评审期间先调整本文，不据此启动实现、发布或升级本机 Supervisor。
