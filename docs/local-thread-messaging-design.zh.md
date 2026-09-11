# 通用线程交互 CLI：设计讨论稿

状态：第二版，待评审，尚未实现。本文中的新增命令与返回结构是设计提案。

工作目录：`/Users/mac/dev/remoteCodex-thread-messaging`  
分支：`feat/local-thread-messaging`  
代码起点：`0b1d60f8`

## 1. 核心接口

remoteCodex 向本机 Agent 和用户提供一组通用能力：

1. 创建线程，并选择 workspace、provider、agent、模型和推理等级。
2. 向任意已有且有权访问的线程发送文字消息。
3. 查询线程列表、运行状态和过去的聊天历史，按需展开细节。

线程之间平等，任何线程都可以调用这些能力。一次运行中可以给同一线程发送多条消息，也可以联系多个线程；发送后可以继续工作，不要求等待回复。接收方可主动反向发送消息，协议不强制一问一答、固定父子关系或任务步骤。

发布跟踪、代码评审、资料查询、请另一个 Agent 解答问题、长期复用某个专业线程，都是这组接口的使用方式。何时创建、复用、读取、回信由 skill 指导 Agent 决策，不进入基础接口的业务状态机。

## 2. 数据直接复用现有 remoteCodex

本功能不新增数据库表，不建立独立的 Message、Task、合作关系或消息日志存储。继续使用现有线程、turn、history item、pending steer 和运行时状态。

| 能力 | 现有来源 |
| --- | --- |
| 创建、列出和识别线程 | workspace 与 threads；使用网页 URL 最后一段的 thread ID |
| 向线程发消息 | 现有 prompt 提交和 pending steer 机制 |
| 查询运行状态 | thread 状态、active turn、pending requests / steers |
| 最近 N 轮历史 | thread_turns 的 ordinal、limit、beforeTurnId 分页 |
| 输入和 Agent 文字 | thread_history_items 中的 userMessage、agentMessage |
| 工具、输出、扩展字段和附件 | 已保存的 history item JSON 与现有附件存储 |

CLI 调用 Supervisor API，由 runtime 查询已有数据；CLI 不直写 SQLite，也不各自维护一份 transcript。HTTP 可增加读取视图和必要的参数，但数据来源、线程执行和权限处理与网页相同。

原先提到的“记住使用过哪个线程”，先通过交互内容中的线程 ID、已有线程列表和 skill 的上下文记录实现。若需要可查询的少量关系 metadata，可利用已有 KV 或可扩展字段；它是便利信息，不是发送消息和读取历史的前置条件，也不承诺未记录的旧关系能被完整重建。

## 3. CLI 表面

建议沿用现有 `remote-codex` 二进制，提供以下独立命令。所有输出为有界的结构化 JSON，字段采用 camelCase；示例参数为提案。

```sh
# 发现已有线程，列表只返回简要信息。
remote-codex thread list --workspace WORKSPACE_ID
remote-codex thread show THREAD_ID

# 查询运行状态，不附带聊天历史。
remote-codex thread status THREAD_ID

# 发现目标 provider 可选的 agent、模型和推理等级。
remote-codex thread backends
remote-codex thread models --provider acp --agent grok

# 创建线程；创建与发送是可独立使用的操作。
remote-codex thread create \
  --workspace WORKSPACE_ID --title helper \
  --provider acp --agent grok \
  --model MODEL_ID --reasoning-effort low

# 发送消息；不等待模型回复。
remote-codex thread send THREAD_ID --text "请帮我查一下这个问题。"
remote-codex thread send THREAD_ID --text-file question.txt
remote-codex thread send THREAD_ID --text-file -

# 默认查看最近 3 个 turn 的用户输入和全部 Agent 文字回复。
remote-codex transcript THREAD_ID
remote-codex transcript THREAD_ID --limit 5

# 往前翻阅，返回较早的历史页。
remote-codex transcript THREAD_ID --before-turn TURN_ID --limit 3

# 对某一轮感兴趣时，展开条目；再读取具体内容。
remote-codex transcript THREAD_ID --turn TURN_ID
remote-codex transcript THREAD_ID --turn TURN_ID --item ITEM_ID
remote-codex transcript THREAD_ID --turn TURN_ID --item ITEM_ID --raw
```

`create` 可以提供可选的初始文字参数，作为“创建后发送”的便利组合，不赋予它特殊任务语义。返回 thread ID 后，后续操作与任何已有线程完全相同。创建成功但初始发送失败时，应返回已创建的 ID，方便继续使用。

模型与推理等级来自目标 provider 的实际能力。明确指定而不支持的值需要明确报错；未指定时遵循现有创建线程的默认配置。发送消息本身不改变接收线程的模型设置。

线程 ID 始终是 remoteCodex ID，不要求调用者处理 provider session ID。可兼容完整网页 URL 输入，但应确认其中的 device ID 指向当前设备，不根据 URL 隐式跨机器调用。

## 4. 发送和状态语义

`thread send` 是现有 prompt 提交的 CLI 入口，内容可以是问题、补充信息、指令、进度汇报、结果或普通交流。发送端不受“每轮只发一条”限制，也没有“收到回复才能再发”的协议锁。

目标空闲时启动处理；目标运行中沿用现有 pending steer / continuation 行为。这里区分两件事：接收方如何串行执行是 runtime 的现有调度职责，发送方何时再次联系它由 Agent 自行决定。未来若暴露实时 steer，也复用已协商的 provider capability。

发送命令在后端接受后返回简短回执，不等到目标输出最终答案，不隐式订阅或打印 transcript。回执应准确区分已接受、已排队和提交失败；能取得的 turn ID、pending steer ID 或 clientRequestId 使用现有标识，不引入新 message ID 体系。回执不代表接收方已经读到或完成处理。

实现时检查当前 HTTP 后台启动 prompt 的早返回、并发提交和 clientRequestId 行为，避免把“后台函数已 spawn”误报为“已经可靠提交”。需要的修正落在现有提交路径和存储中，不据此扩展出独立消息系统。

`thread status` 返回 thread ID、provider / agent、状态、active turn ID、更新时间、最近错误，以及是否等待权限 / 人工输入、排队数量等轻量信息。状态从现有记录和 runtime 取得，不根据最后一条回复猜测；默认不返回 pending prompt 全文、历史或费用日志。`idle` 只表示当前未运行，不能推断某个业务目标已经成功。

## 5. Transcript：默认最近几轮，逐级发现

### 默认层：对话文字

`remote-codex transcript THREAD_ID` 建议返回最近 **3 个 turn**，页内按时间先后排列。通过 `--limit N` 控制轮数，通过 `--before-turn` 向前翻页；第一轮的初始 prompt 在其所在历史页完整可读，不在每个请求里重复附带。

每轮包含 turn ID、状态、开始 / 结束时间，以及该轮所有用户输入和 Agent 对外文字回复。保留中间进度说明，不只保留最后答案。每条文字带 item ID、种类和已存时间戳，默认不包含工具结果、命令输出、diff 或其他 verbose 结构。

这是一层确定性查询 / 过滤，不调用模型总结。复用已有 `load_turn_conversation`：它已按 `userMessage` / `agentMessage` 查询同一份后端历史。当前网页 summary 在此后还有一个“只保留最后一条 Agent 回复”的折叠步骤；CLI 默认文字层保留查询得到的全部对话文字，不经过该步骤。

返回已读取的轮数、是否还有更早历史、下一页入口，以及每轮展开入口和隐藏条目数。调用者不需要猜测额外命令或自行拼装内部路径。

### Turn 层：单轮条目

`--turn TURN_ID` 返回该轮所有已存条目的目录：ID、种类、时间、状态和有限长度的预览。Agent 能看到这轮做了什么，并选择感兴趣的条目。

一轮可能含有很多工具调用，因此条目目录也需要分页；不能仅因指定了 turn 就一次性展开所有工具输出。

### Item 层：具体内容

`--turn TURN_ID --item ITEM_ID` 返回单条详细内容。`--raw` 读取同一条记录的完整已存 JSON，包括扩展字段。附件沿用现有引用与读取接口；只暴露 remoteCodex 实际保存过的记录，不声称存在从未存储的完整协议日志。

### 每一层都有体积边界

最近 3 轮也可能非常大，所以轮数限制之外还要限制返回体大小。大段文字、长工具输出、raw 字段均支持明确标识截断和续读入口；通过续读能读全，不能悄悄丢掉中间 Agent 回复。无需维护新数据库快照表，可依据已有 turn / item 标识和内容偏移分页。

运行中的记录标记为未完成；读取结果说明观察时间，读取增长中的 item 可重新请求该条，避免把实时内容当作不可变快照。历史缺失时间戳时返回空值，或明确标出 turn 时间回退值。

默认命令不提供隐式全量 dump，也不因为一次小查询顺带读取其他轮、附件和 provider 本地日志。

## 6. Skill 如何使用这些原语

后续写一个线程交互 skill，说明接口和典型决策，而不替接口增加隐藏业务限制：

- 先看线程列表、简要状态，发现已有合适线程时复用；需要不同上下文、workspace 或模型时创建。
- 发消息时说明上下文、目的，以及需要回复时回复到哪个 remoteCodex thread ID。
- 只需要知道是否运行就查 status；想了解交流内容先查最近几轮；遇到具体疑点再展开 turn / item。
- 可以连续补充消息，可以同时联系多个线程，可以主动回信；不要求发送后等待。
- 把值得复用的 thread ID 留在当前对话或已有可扩展 metadata 中，避免每次都从头创建。
- 发布跟踪等长耗时场景只是示例：另一线程完成工作后，可直接调用同一 `send` 给发起者汇报。

需要让受管理的 Agent 能发现当前 remoteCodex thread ID、workspace、本机 Supervisor 连接方式和 CLI 帮助。采用统一 runtime 上下文传递，覆盖创建与恢复；不依赖某个 provider 的专用工具。

最初提出的“由 remoteCodex 自动在完成时通知”仍保留为待讨论的可选便利能力。它与 Agent 主动 `send` 回报不同：skill 能指导主动回信，但不能单靠说明文字保证进程失败时也通知。基础协议先独立成立；若保留自动通知，围绕现有执行事件与 KV 等机制单独约定触发条件，不把一般消息绑定成必须结束的 Task，也不新增表。本稿尚未确定该可选能力的具体实现与交付保证。

## 7. 参考 Treer 与后端归属

参考 `~/dev/treer/crates/treer-cli/src/main.rs` 中独立的 list / show / prompt / transcript 操作，以及 transcript 的 overview → turn → item 展开选择器和 JSON 输出。发送、读取与可选等待分别可用，不要求所有交互走 dispatch 工作流。

采用 remoteCodex 自己的默认值：最近 3 轮、保留中间对外文字、使用已有 beforeTurnId 分页；不照搬 Treer 从第 0 页开始或 overview 仅展示最终输出的细节。

```text
Codex / ACP Grok / 其他受管理的 Agent / 本机用户
  → remote-codex CLI
  → Supervisor API
  → 现有线程 service、历史查询与存储
  → AgentRuntime / ACP 薄适配
```

| 入口 | 复用方向 |
| --- | --- |
| thread list / show | 现有 `/api/threads` 与线程元信息查询；列表限制数量和字段 |
| thread create | 现有 `/api/threads/start` |
| thread send | 现有 `/api/threads/{id}/prompt` |
| thread status | 现有轻量状态 / delivery 数据；只选择必要字段 |
| transcript | 现有 turn 分页与 conversation 查询；增加有界的 conversation 视图或薄读取端点 |
| turn / item / raw | 现有详情读取，补分页、完整字段和 thread + turn + item 归属校验 |

CLI 属于 `crates/cli`；必要 DTO 属于 `crates/protocol`；HTTP 适配属于 `crates/supervisor`；查询与提交修正属于 `crates/runtime`。Codex 与 ACP Grok 双向使用相同接口，provider 差异只留在已有 ACP 适配层。

本机连接复用 Supervisor 的授权边界，明确提供可供本机 CLI 使用的连接与凭据发现方式；不让线程 ID 充当认证凭据，不要求 Agent 调用公共 Relay。连接细节下一阶段结合启动方式确定，不扩展本轮协议范围。

## 8. 下一阶段验收

方案评审后再开始实现，重点验证通用能力：

1. 创建线程并按目标 provider 能力选择模型 / 推理等级。
2. A 连续给 B 发多条消息、同时给 C 发消息，B 能主动给 A 发消息；发送均不等待模型最终回复。
3. 查询状态不加载大段历史；运行中、空闲、错误、等待输入和排队情况准确。
4. 默认读最近 3 轮，包含所有用户输入与 Agent 中间 / 最终文字；可以向前翻阅直到初始 prompt。
5. turn / item / raw 逐级展开能访问已存详细记录，长内容、运行中内容和分页不会静默遗漏。
6. Codex → ACP Grok、ACP Grok → Codex 共用接口；fixture 验证与真实 provider 验证分别记录。
7. 不新增数据库表，不重复存聊天历史，不要求运行某个专用 app-server。
8. skill 能仅靠这组原语指导发现、复用、创建、交流和按需读历史。

修改 `crates/` 后执行 `cargo test --workspace`。隔离调用测试可在 Docker 中运行；涉及重启 / 恢复时按项目要求使用 Treer Apple container 测试机。若改 Web，再按 focused-e2e skill 选定 spec 和 browser project。

本阶段只更新设计文档，不实施代码、创建新 skill、发布版本或修改活跃 Supervisor。
