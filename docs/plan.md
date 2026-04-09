# Tailscale + Codex 远程开发系统通用方案设计

> 细化后的分阶段开发文档已拆分到 `docs/phases/` 目录：
>
> - `docs/phases/README.md`
> - `docs/phases/phase-1-foundation.md`
> - `docs/phases/phase-2-codex-control-plane.md`
> - `docs/phases/phase-3-durable-shell.md`
> - `docs/phases/phase-4-admin-governance.md`
> - `docs/phases/phase-5-interaction-notifications.md`

## 文档定位

这是一份**与现有业务项目解耦**的通用系统设计文档，目标是设计一个可以通过手机网页远程操作电脑上 `Codex` 的开发系统。

设计目标不是“做一个普通 Web Terminal”，而是：

1. 远程继续和管理本机已有的 `Codex` 会话。
2. 保证手机断线、切网、切后台时，会话和 shell 不丢。
3. 同时保留一个独立的远程 shell，用于手动测试、检查和接管。
4. 默认运行在 `Tailscale` 私网中，不暴露公网入口。

当前范围按你的决定收敛为：

- 单人自用
- 前端先做网页，后续可迁移 React Native
- 只考虑 `macOS` 和 `WSL Ubuntu`
- `Codex` 优先，暂不做 `Claude Code`
- 默认 `YOLO`，但架构必须兼容后续审批和 plan mode 交互

---

## 一、核心结论

## 1. 主控制面应选择什么

结论：

- **Codex App Server** 应作为主控制面
- **Codex CLI** 作为本机 fallback / 人工接管入口
- **Codex SDK** 不作为 MVP 主入口，但后续可用于自动化任务
- **OpenAI Agents SDK** 不适合作为“远程控制本机 Codex 会话”的主层

原因来自 OpenAI 官方文档：

- Codex App Server 的定位是给 rich client 用，适合“认证、会话历史、审批、流式 agent 事件”。  
  来源：[Codex App Server](https://developers.openai.com/codex/app-server)

- Codex App Server 使用双向 `JSON-RPC 2.0`，支持 `stdio` 和实验性的 `websocket` 传输。  
  来源：[Codex App Server](https://developers.openai.com/codex/app-server)

- Codex App Server 支持：
  - `thread/start`
  - `thread/resume`
  - `thread/list`
  - `thread/read`
  - `turn/start`
  - `turn/steer`
  - `turn/interrupt`  
  来源：[Codex App Server](https://developers.openai.com/codex/app-server)

- Codex SDK 的定位是“Programmatically control local Codex agents”，更适合 CI/CD、内部工具和应用内集成。  
  来源：[Codex SDK](https://developers.openai.com/codex/sdk)

- OpenAI Agents SDK 的定位是：当**你的服务端自己拥有 orchestration、tool execution、approvals、state** 时使用。  
  来源：[Agents SDK](https://developers.openai.com/api/docs/guides/agents)

因此，对本项目最合理的职责划分是：

- `Codex App Server`：面向远程 UI 的会话协议
- `Codex CLI`：本机维护和 fallback
- `Codex SDK`：将来做自动化 / 后台作业时再引入

## 2. shell 应该怎么做

结论：

- 每个 `Codex thread` 绑定一个**独立 shell**
- shell 不依赖 App Server 的瞬时命令执行能力来长期存活
- shell 通过 `tmux + PTY` 独立持久存在
- viewer 断开只 detach，不销毁 shell

这比把 shell 完全塞进 App Server 的命令执行能力里更稳，更符合“弱网络下会话不丢”的目标。

## 3. 网络应该怎么做

结论：

- 全系统通过 `Tailscale` 私网访问
- 不直接把 `codex app-server` 暴露给手机
- 手机只连接你自己的 `supervisor`
- `supervisor` 本地通过 `stdio` 驱动 `codex app-server`

这样做的好处：

1. 外部入口只有一个，边界清晰。
2. App Server 可以视为本地进程依赖，而不是外部协议依赖。
3. 以后接入 shell、文件树、通知、管理界面时，不会把协议拆碎。

---

## 二、产品目标与非目标

## 目标

1. 从手机网页安全访问一台主机上的开发环境。
2. 列出、启动、恢复、终止 `Codex` 线程。
3. 为每个 `Codex` 线程提供一个独立 shell。
4. 提供只读文件树。
5. 提供网页内通知。
6. 支持 `plan mode` 提问和后续审批流。
7. 提供管理界面，防止 session / shell 过多导致资源失控。

## 非目标

1. 第一版不做多人协作。
2. 第一版不做 `Claude Code`。
3. 第一版不做复杂文件编辑器。
4. 第一版不做公网暴露。
5. 第一版不做跨多主机编排。

---

## 三、部署拓扑

## 1. 单机拓扑

```text
Phone Browser
   |
   | HTTPS / WebSocket over Tailscale
   v
Supervisor (Node/TypeScript)
   |-- Web UI
   |-- API + WS Gateway
   |-- SQLite
   |-- Workspace Manager
   |-- Thread Registry
   |-- Shell Manager
   |-- Notification Manager
   |
   | stdio JSON-RPC
   v
codex app-server
   |
   v
Codex local runtime

Supervisor
   |
   | local PTY/tmux control
   v
Per-thread tmux shell sessions
```

## 2. 主机环境策略

### macOS

建议：

- `supervisor` 直接跑在 `macOS`
- 不要为了“统一类 Linux 环境”而再包一层虚拟化

原因：

1. 你的目标是控制**本机**的 Codex、shell 和文件系统。
2. 如果再包一层 Linux，路径、shell、文件树、Codex 进程归属都会复杂化。
3. `macOS` 本身是 POSIX 系统，对 `tmux`、PTY、Node 都足够友好。

### WSL Ubuntu

建议：

- 每个 `WSL Ubuntu` 实例里独立运行一个 `supervisor`

这样最符合你的要求：

- WSL 内的 `Codex`、shell、文件树都由 WSL 内部直接管理
- 不需要跨 Windows / WSL 再做一层代理

---

## 四、为何选 TypeScript / Node

当前建议最终选型：

- `supervisor = TypeScript + Node.js`

原因：

1. Codex SDK 官方当前明确提供的是 TypeScript 包 `@openai/codex-sdk`。  
   来源：[Codex SDK](https://developers.openai.com/codex/sdk)

2. Codex App Server 的 `stdio JSON-RPC` 在 Node 中非常容易接。

3. 你需要一体化：
   - web server
   - websocket
   - sqlite
   - 事件流
   - 前后端类型复用

4. 这是单人自用的 MVP，首要目标是稳定可用与迭代速度，而不是极限性能。

### 为什么不是 Go / Rust

不是不能做，而是现在不值得优先：

- Go / Rust 的收益主要在于更强的系统级控制和更高的长期稳定性
- 但你现在更重要的是：
  - 快速接入 App Server
  - 快速完成 durable session
  - 快速做网页控制台

因此第一版用 TypeScript 更务实。

---

## 五、Codex、CLI、SDK、Agents SDK 的职责划分

## 1. Codex App Server

角色：

- 主会话协议层
- 提供 thread 生命周期和 turn 生命周期
- 提供流式事件
- 提供 plan mode 和审批交互能力

你要依赖的关键能力：

- `thread/start`
- `thread/resume`
- `thread/list`
- `thread/read`
- `thread/loaded/list`
- `turn/start`
- `turn/interrupt`
- `tool/requestUserInput`
- `item/fileChange/requestApproval`
- `item/commandExecution/requestApproval`

其中对你很关键的是：

- `tool/requestUserInput`  
  App Server 支持向用户发起 1 到 3 个短问题。  
  来源：[Codex App Server](https://developers.openai.com/codex/app-server)

- `item/fileChange/requestApproval`  
  后续非 YOLO 模式下，文件变更审批可以走这一套。  
  来源：[Codex App Server](https://developers.openai.com/codex/app-server)

## 2. Codex CLI

角色：

- 本机 fallback
- 人工调试入口
- 紧急接管入口

你仍然应该保留：

- `codex resume <thread-id>`
- `codex app-server`

因为 CLI 在本机维护和应急接管时很有价值。

## 3. Codex SDK

角色：

- 非 UI 的程序化自动化层
- 未来做后台工作流、批量任务时使用

不建议 MVP 直接基于 SDK 来做整个远程系统，因为你当前需要的是 rich client 会话体验，而不是“在服务端发一段 prompt 然后拿最终结果”。

## 4. OpenAI Agents SDK

角色：

- 自己构建 agent orchestration 服务时使用

不适合当前项目作为主方案，因为你现在不是要自己重做一个通用 agent runtime，而是要远程控制本机已有的 `Codex`。

---

## 六、系统总架构

建议模块拆分如下：

```text
supervisor/
  app/
    web-server
    api-router
    websocket-gateway
  codex/
    app-server-process
    jsonrpc-client
    thread-service
    turn-service
    approval-service
  shell/
    tmux-manager
    pty-bridge
    shell-session-service
  workspace/
    workspace-service
    tree-service
    git-status-service
  notifications/
    notification-service
  store/
    sqlite
    migrations
  policy/
    quotas
    cleanup
  ui/
    frontend bundle
```

---

## 七、核心对象模型

## 1. Host

当前只有一台主机，但对象模型仍保留 `host`，方便以后扩展。

字段建议：

- `id`
- `hostname`
- `platform` (`macos` / `wsl-ubuntu`)
- `tailscale_name`
- `created_at`
- `last_seen_at`

## 2. Workspace

`workspace` 是一切 thread 和 shell 的归属根。

字段建议：

- `id`
- `host_id`
- `label`
- `abs_path`
- `is_favorite`
- `created_at`
- `last_opened_at`

规则：

1. 创建 thread 时必须先选 workspace。
2. workspace 手动添加。
3. 选择器支持：
   - 从 `~/` 开始浏览
   - 手动输入路径
   - 收藏常用 workspace

## 3. CodexThread

对应一个 App Server thread。

字段建议：

- `id`
- `workspace_id`
- `codex_thread_id`
- `title`
- `model`
- `approval_mode` (`yolo` / `guarded`)
- `status` (`active` / `idle` / `finished` / `error` / `archived`)
- `created_at`
- `updated_at`
- `last_turn_started_at`
- `last_turn_completed_at`
- `last_viewed_at`
- `is_pinned`

## 4. ShellSession

每个 thread 绑定一个独立 shell。

字段建议：

- `id`
- `workspace_id`
- `thread_id`
- `tmux_session_name`
- `cwd`
- `status` (`running` / `stopped` / `finished`)
- `created_at`
- `updated_at`
- `last_activity_at`

约束：

- 一条 `CodexThread` 对应一条 `ShellSession`
- shell 在 thread 创建时自动创建
- shell 独立存活，不因为 viewer 断开而结束

## 5. ViewerSession

浏览器连接对象。

字段建议：

- `id`
- `thread_id`
- `shell_id`
- `connected_at`
- `last_heartbeat_at`
- `active_tab`

注意：

- `ViewerSession` 断开不影响 `CodexThread` 和 `ShellSession`

## 6. Notification

字段建议：

- `id`
- `thread_id`
- `kind`
- `severity`
- `title`
- `body`
- `is_read`
- `created_at`

---

## 八、线程与 shell 生命周期

## 1. 创建新 thread

流程建议：

1. 用户打开 workspace 选择器
2. 选择已有 workspace，或从 `~/` 浏览后添加新 workspace
3. 选择启动参数：
   - model
   - YOLO / guarded
4. supervisor 调 `thread/start`
5. supervisor 同时创建一个独立 shell：
   - 启动 `tmux`
   - cwd = workspace 根目录
6. 在 SQLite 写入：
   - workspace
   - thread
   - shell session
7. UI 默认进入该 thread 对应的 shell 主页

## 2. 恢复历史 thread

流程建议：

1. 管理页列出历史 thread
2. 用户点击恢复
3. 先只做 `thread/read` 和元数据展示，不强制立即 attach shell
4. 如果用户要继续 agent：
   - 执行 `thread/resume`
5. 如果用户要接 shell：
   - attach 对应 shell

这个设计满足你的要求：

- 支持“恢复历史 thread 但不立即进入 shell”

## 3. 断线与切后台

原则：

- viewer 断线只影响 viewer
- 不影响：
  - Codex thread
  - shell session
  - tmux session

恢复策略：

1. 网页重连后重新订阅 thread 事件
2. shell 重新 attach 到既有 `tmux` session
3. 如果 thread 当前没有 active turn，只显示 idle 状态

## 4. supervisor 重启

策略：

1. 启动后读取 SQLite registry
2. 恢复：
   - workspace
   - thread 元数据
   - shell 与 tmux 的映射
3. 不强制把所有 Codex thread 全部立即 resume 进内存
4. 只在需要时对指定 thread 执行 `thread/resume`

这样更节省内存，也更利于管理。

## 5. thread 完成后的 shell 保留策略

按你的要求，thread 完成后 shell 默认保留。

推荐清理策略：

- 最近活动时间驱动
- 配合最大数量上限

例如：

- 7 天未活动的 finished shell 可清理
- 超过总壳数阈值时，优先清理最久未活动且未 pinned 的 shell

---

## 九、资源治理与管理界面

你明确提到需要“管理主机上服务端所有正在运行的 session，例如删除、启动或结束，防止内存爆炸”。

因此管理界面必须是 MVP。

## 1. 限额

按你确认的策略：

- 总 thread 数 `< 20`
- 每个 workspace thread 数 `< 5`

建议额外加上：

- 最大活跃 shell 数
- 最大历史 transcript 存储大小

## 2. 管理页能力

管理页至少需要：

- 查看所有 workspace
- 查看每个 workspace 下的 thread 数
- 查看每个 thread 当前状态
- 查看每个 shell 当前状态
- 手动结束 thread
- 手动结束 shell
- 手动删除历史 thread / transcript
- 批量清理 finished / stale shell
- pin / unpin thread

## 3. 全局清理策略

按你的要求保留全局策略开关。

推荐默认策略：

- 7 天未活动 shell 自动清理
- 30 天未活动 transcript 自动归档或删除
- pinned thread 不自动清理

---

## 十、shell 设计

## 1. 为什么必须使用 tmux

因为你的最重要需求是：

- 手机网络不稳定
- 会话不能丢

`tmux` 的价值非常直接：

1. shell 可脱离 viewer 独立存在
2. attach / detach 天然成立
3. supervisor 重启后也有机会重新接回
4. 对手工测试、长任务、日志查看都很稳

## 2. shell 创建策略

按你的决定：

- 创建 thread 时自动创建 shell

shell 启动参数建议：

- cwd = workspace 根目录
- 默认 shell = `zsh` 或系统默认登录 shell
- tmux session name 包含 thread id

## 3. shell 视图策略

默认首页就是 shell 视图。

布局按你的偏好建议为：

- 主体全屏 shell
- 上下分屏时：
  - 上半部分：tree
  - 下半部分：shell
- 右上角切换：
  - thread list
  - agent pane
  - management
  - notifications

## 4. 紧急停止策略

按你的要求：

- 首页只放一个“停止当前 Codex turn”
- shell 进程停止放在统一管理页

这是合理的，因为：

- 首页是高频操作面
- shell kill 属于更重的维护操作

---

## 十一、Agent Pane 设计

虽然首页默认是 shell，但 `agent pane` 不能弱化，因为：

- plan mode 会提问
- 非 YOLO 模式将来会审批
- 你需要看 agent reasoning/output 的流

因此 `agent pane` 必须支持：

1. 显示当前 thread 状态
2. 显示最近 turn 输出
3. 发送 prompt
4. 停止当前 turn
5. 显示 pending 问题
6. 显示 pending approval

## 1. plan mode 交互必须被全局提示

这是个关键设计点。

即使用户当前停留在 shell 视图，系统也必须：

- 在全局顶部状态条显示有 pending question
- 用 badge 或 modal 强提醒
- 允许点击后直接跳到 agent pane 回答

否则会经常错过 `tool/requestUserInput`。

## 2. 非 YOLO 模式的后续兼容

虽然你当前默认 YOLO，但系统必须预留：

- command approval
- file change approval

因为 App Server 已有对应事件模型。  
来源：[Codex App Server](https://developers.openai.com/codex/app-server)

---

## 十二、文件树设计

## 1. 第一版目标

按你的要求：

- 只读文件树
- 默认不打开文件内容
- 后续可逐步支持 `txt` / `md` 这类简单文件预览

## 2. tree 选择器与浏览器

需要两个 tree 形态：

### A. workspace 选择 tree

用于新增 workspace：

- 从 `~/` 开始浏览
- 支持 `cd`
- 支持 `ls`
- 支持手输绝对路径
- 支持收藏

### B. 当前 workspace tree

用于主界面：

- 只读展示
- 默认隐藏 dotfiles
- 手动展开显示隐藏文件
- 只显示 git 状态：
  - `modified`
  - `untracked`

---

## 十三、通知设计

第一版按你的要求，只做网页内通知。

通知事件建议包括：

- thread turn 完成
- thread turn 失败
- thread 等待 plan mode 输入
- thread 等待审批
- shell 退出
- shell 异常
- 清理策略执行结果

前端表现建议：

- 顶部状态条
- 右上角通知中心
- 未读 badge

---

## 十四、API 与事件面设计

## 1. 建议 API

### Workspace

- `GET /api/workspaces`
- `POST /api/workspaces`
- `GET /api/workspaces/tree?path=...`

### Thread

- `GET /api/threads`
- `POST /api/threads/start`
- `POST /api/threads/:id/resume`
- `POST /api/threads/:id/prompt`
- `POST /api/threads/:id/interrupt`
- `POST /api/threads/:id/terminate`
- `POST /api/threads/:id/pin`

### Shell

- `GET /api/shells`
- `POST /api/shells/:id/attach`
- `POST /api/shells/:id/terminate`

### Files

- `GET /api/workspaces/:id/tree`
- `GET /api/workspaces/:id/git-status`

### Management

- `GET /api/admin/stats`
- `POST /api/admin/cleanup`
- `GET /api/admin/policies`
- `PUT /api/admin/policies`

## 2. WebSocket 事件流

建议一个统一 WS：

- `/ws`

事件类型建议：

- `thread.updated`
- `thread.turn.started`
- `thread.turn.completed`
- `thread.turn.failed`
- `thread.user_input.required`
- `thread.approval.required`
- `thread.output.delta`
- `shell.output`
- `shell.exited`
- `notification.created`
- `policy.cleanup.completed`

---

## 十五、安全模型

## 1. Tailscale 角色

你已经定为“只做私网接入”，这正是最稳妥的起点。

建议：

- 手机和主机都加入同一个 tailnet
- supervisor 只监听 Tailscale IP 或仅在本机 + 反代到 Tailscale

## 2. 应用内鉴权

即使在 Tailscale 内，也建议保留应用层鉴权：

- 本地账号密码
- 或单用户 token
- 或简化版 session cookie

因为将来做 app 形态时会更自然。

## 3. 权限模式

当前默认：

- `YOLO`

但对象模型必须保留：

- `approval_mode`

以支持将来 thread 级别切换为 guarded。

## 4. 紧急停止

首页只提供：

- `interrupt current turn`

管理页提供：

- terminate shell
- terminate thread

---

## 十六、MVP 建议范围

## 必做

1. Tailscale 私网接入
2. 内置 web server
3. SQLite registry
4. workspace 管理
5. Codex thread 启动 / 恢复 / interrupt
6. 每 thread 自动创建独立 shell
7. shell attach/detach
8. 只读 tree
9. plan mode 问题展示与应答
10. 基础网页通知
11. 管理界面
12. 清理策略

## 可以延后

1. 文件内容预览
2. 非 YOLO 审批 UI 的精细打磨
3. React Native 封装
4. Claude adapter
5. 多主机支持
6. 外部通知渠道

---

## 十七、实施顺序

## Phase 1：基础 supervisor

- TypeScript monorepo
- 内置 web server
- SQLite
- workspace registry
- tree 浏览器

## Phase 2：Codex 主控制面

- `codex app-server` 本地 stdio 驱动
- thread/list/start/resume/read
- turn/start/interrupt
- agent 输出事件流

## Phase 3：独立 shell

- tmux manager
- 每 thread 自动创建 shell
- PTY attach/detach
- shell websocket bridge

## Phase 4：管理界面与治理

- 资源上限
- 清理策略
- pinned thread
- 手动 terminate

## Phase 5：交互与通知

- plan mode 问题处理
- pending badge
- 网页内通知
- 非 YOLO 审批预留

---

## 十八、最终推荐方案

一句话总结：

> 做一个运行在主机本地的 TypeScript `supervisor`，通过 `stdio` 驱动 `codex app-server`，再用 `tmux` 为每个 Codex thread 提供独立、可持续的 shell，并通过 `Tailscale` 将这一切安全地暴露给手机网页。

更具体地说：

1. `Codex App Server` 负责 agent 会话与 turn。
2. `tmux shell` 负责手工测试、接管和长期终端存活。
3. `SQLite` 负责 registry 和治理。
4. `Tailscale` 负责私网接入。
5. `supervisor` 作为唯一外部入口，统一 UI、API、WS、管理和通知。

这套设计满足你最重要的要求：

- 可恢复已有 `Codex` 会话
- 手机断线不会丢会话
- 每个 thread 一个独立 shell
- 可管理所有运行中的 session，防止资源爆炸
- 当前默认 YOLO，后续仍兼容审批与 plan mode

---

## 参考资料

- OpenAI Codex App Server
  - https://developers.openai.com/codex/app-server
- OpenAI Codex SDK
  - https://developers.openai.com/codex/sdk
- OpenAI Agents SDK
  - https://developers.openai.com/api/docs/guides/agents
- Tailscale 文档入口
  - https://tailscale.com/docs

## 关键引用摘录说明

以下判断直接基于官方文档：

- App Server 适合 rich client，提供认证、会话历史、审批和流式 agent 事件。
- App Server 使用 JSON-RPC 2.0，支持 `stdio` 和实验性 `websocket`。
- App Server 支持 thread/turn 生命周期及 user input / approval 交互。
- Codex SDK 的定位是程序化控制本地 Codex agent。
- Agents SDK 适合你自己拥有 orchestration、tool execution、state 和 approvals 的应用。

这也是本设计最终选择：

- **App Server 作为主控制面**
- **tmux shell 作为 durable terminal**
- **supervisor 作为统一入口**

的根本依据。
