# 休眠设备在线状态与 Codex 导入线程同步调查

调查基线：主仓库 `d9881086`（runtime 0.12.26），独立 UI 仓库
`dufangshi/remote-codex-thread-ui-rust` 的 `68493a1c8b2ed27c2572c9309c3dfe06bc284f9d`。
真实调用使用 Linux Codex CLI 0.153.4、现有 codex-acp 和 `gpt-5.6-luna`。

## 已确认的在线状态问题

`crates/relay/src/lib.rs` 的 `handle_supervisor` 原来只在 WebSocket 关闭、读写报错或队列关闭时移除设备。收到 `relay.heartbeat` 只更新显示时间，没有接收超时。设备休眠或网络中断后，TCP 可以保持半开，relay 的设备映射仍存在，portal 就一直返回 `connected: true`。

0.12.26 新增的是 **supervisor 端** 90 秒接收超时。Mac 休眠时这个进程也暂停，不能代替仍运行于服务器上的 relay 做离线检测。只更新设备 supervisor 无法补齐 relay 的缺口。

浏览器的 `keyFor` 向设备请求加密公钥；休眠设备导致的 503/504 原来统一转成 “Unable to establish an encrypted device connection.”。该提示不能证明加密算法、证书或 supervisor 版本有问题。

历史追踪：Rust relay 的这一处理器来自 2026-09-01 的 `098fd431`。旧 Node relay 的 `relay.heartbeat` 路径也只更新 `lastHeartbeatAt`；本次证据不足以把用户首次观察到的问题归因到某一个改版。

本次修改：

- relay 在 90 秒没有收到设备帧后清理连接。计时使用单调时钟，向设备写数据不续期；正常应用心跳及 ping/pong 保持连接。
- `lastHeartbeatAt` 使用 relay 收到心跳的时间，避免设备时钟偏差。
- HTTP 待响应请求绑定具体 `connection_id`。连接失效时返回 503，并移除该连接的浏览器会话；旧连接清理不能取消新连接的请求。
- 浏览器区分设备离线、无响应、权限不足、繁忙和临时服务错误，保留加密身份核验及禁止降级的逻辑。
- 设备列表可见时，对 relay 仍持有连接的每个设备每 3 秒调用受权限保护的 `/presence`，由 relay 经该设备的真实隧道请求 `/healthz`，等待上限 5 秒。自有设备与共享设备/线程去重探测，共享访问按 thread/workspace scope 校验；响应只公开 `connected`。
- 卡片在线状态取决于成功探测的 5 秒有效期，每 250ms 检查过期。有效期从探测发起时计算，延迟回复不能额外续期；正常浏览器调度下，设备停止回复后约 5 秒内变灰。portal 的旧 `connected: true` 不能续期。暂时变灰的设备仍继续探测，回复后原地恢复；后台页停止探测，返回时重新验证。
- 探测不会关闭设备隧道、唤醒托管 VM、计为用户活动或中断模型任务。relay 的 90 秒回收作为后台兜底，与页面的 5 秒在线有效期分开。
- supervisor 将隧道 ping 间隔改为 3 秒、无入站帧期限及连接尝试上限改为 5 秒；已建立连接失效后立即重连，失败尝试按 1/2/3 秒退避。heartbeat 同时检查墙钟间隔，避免 macOS 单调时钟不计休眠时间而继续信任旧 TCP。唤醒后第一个 heartbeat 最迟约 3 秒发生；网络恢复后的重试受正在进行的 5 秒尝试和至多 3 秒退避约束，不依赖重新输入启动命令。

## 独立的加密会话恢复缺陷

设备清醒时也可能遇到密钥缓存失效：supervisor 重启或临时密钥过期后，浏览器仍持有旧接收公钥。`forward_local` 在解密和执行业务之前返回 `409 transport_reconnect_required`。原 `exchange` 仅对 GET 清缓存重试，而实时连接先调用 **POST `/transport/session`**，所以第一次会话创建失败并显示加密连接错误。

本次允许该特定 POST 在明确的旧密钥拒绝后换钥重试一次，保留请求体、请求取消和 socket 派生密钥；不自动重发普通业务 POST，也不绕过固定身份核验或允许明文降级。公钥请求另加 10 秒超时，失败缓存和旧 legacy 定时器只清理自己的缓存任务。

浏览器回归使用一个独立客户端缓存旧密钥，重启隔离测试设备后，**第一条请求直接创建会话，没有先发 GET**。真实 Rust relay/supervisor 返回序列确认为 `409 → 200`，新的加密通道及收发密钥均成功建立。这是可复现的独立缺陷，但没有 Mac 现场日志，不能断言它就是用户当时遇到的同一次故障。

## 线程同步实验

测试脚本：`scripts/verify-codex-external-sync.mjs`。测试启动自己的 supervisor、Codex CLI 和 app-server，使用合成标记验证模型上下文，所有进程、数据库、线程和工作目录均在 Docker 中隔离。真实 supervisor 没有被重启、更新或停止。主机认证目录只读挂载，脚本只复用认证与必要模型配置，测试 session/SQLite 全部新建。

完整候选运行的原生 thread ID：`01a08d49-c285-70f3-b67a-c2b3506ad626`。
对应 Remote Codex thread ID：`86005b55-456f-4756-b8c2-0c1f345228f1`。
本机证据：`.local/external-sync-probe/run-9df57adf-4746-44aa-a71b-26f6ea0f8f38/evidence.json`。

### 相同 CODEX_HOME、相同 SQLite

1. CLI 创建会话，记住 `CLI_FIRST_47`。
2. 用独立 app-server 加载该会话，模拟官方 App 持有线程；再调用 Remote Codex 的真实导入 API。导入记录正确，provider session ID 仍是原 UUID，没有调用 fork。
3. 此时 Remote Codex 请求 Resume，Codex 拒绝第二个写入者：`already has an active writer`。基线返回难读的 400 嵌套 JSON-RPC 错误；候选版本已实测返回 `409 harness_session_in_use`，提示关闭另一端后再连接。
4. 关闭该测试 app-server，通过 CLI resume 写入 `CLI_AFTER_IMPORT_82`。再次读取网页使用的 thread detail API，仍只有导入时的记录，新消息缺失。
5. Remote Codex Resume 后发送消息，记住 `WEB_NEW_93`，并询问 CLI 后写入的标记。模型正确回答 `CLI_AFTER_IMPORT_82`，但网页历史仍未补齐那一轮。这证明“网页看不到”与“模型没读到”是两个不同问题。
6. 新启动的原生 app-server 使用只读 `thread/read(includeTurns: true)` 能读到 `WEB_NEW_93`。此时 CLI resume 则退出码 1，报写入者冲突。
7. 停止的只是测试 supervisor 进程组。重新 CLI resume 后，模型能正确列出三个标记，原生历史也包含 CLI 和网页的追加内容。

代码原因：`import_thread` 调用 `persist_imported_turns` 将当前记录写入 Remote Codex 自己的 SQLite；后续 `get_thread_detail_page` 读取这份投影，并没有持续摄取外部 Codex 的新 turn。已有导入的再次 import 也直接返回已有记录。`AcpRuntime::resume_session` 对已经加载的 session 会直接返回，不会重新加载外部修改。

### 不同 CODEX_HOME、不同 SQLite，共享 rollout 文件

两个独立 app-server 共用同一会话文件目录和 thread ID，但各自拥有配置目录、SQLite 和运行状态。这时两个进程都成功 resume。

在 A 端写入 `FIRST_STORE_19` 后，B 端询问该标记回答 `ABSENT`；B 写入 `SECOND_STORE_26` 后，A 也回答 `ABSENT`。两边 `thread/read` 的历史分别缺少另一边的标记。实际写入成功，但两个模型上下文及其历史视图已分离。

这复现了“相同 thread ID，看起来像分叉”的行为。它不是 Remote Codex 显式创建了新 UUID，而是两个独立的 Codex 运行状态没有实时协调。不能用合并 JSONL 文件来保证模型上下文和 SQLite 索引同步。

### 控制实验：仅改变 SQLite

保持 **完全相同的 CODEX_HOME**，第二个进程只通过 `-c sqlite_home=...` 指向另一目录：Codex 0.153.4 仍拒绝 resume，报 `already has an active writer`。

因此，不能把“双写成功并分叉”简单归因于 `sqlite_home` 配置。独立的写入协调环境也是条件。本次没有运行 macOS 官方 App，也没有读取用户 Mac 的实际进程环境，不能断言其具体目录或锁路径。

仓库已有 [2026-09-08 存储事故记录](incident-2026-09-08-codex-storage.md)，记录过 Mac 与 Apple 容器共享 `.codex`，以及跨系统文件锁失效和改用本机 SQLite 的事实。它提供了需要核对的环境线索，但不等于本次 Mac 故障已经现场确认。不要为追求同步重新跨系统共写 SQLite；这会重现已证实的损坏风险。

## 同步能力的边界与后续实现方向

当前“导入”是历史快照和后续接管入口，不是官方 App 的实时镜像。一个进程读到了另一端写入的磁盘历史，也不代表已经加载的模型上下文会自动更新。

短期若共用同一台机器的有效存储，应先释放原端的会话，再由另一端 resume；仅停下生成不一定释放写入者。网页当前仍存在历史快照不刷新的缺陷，切换后不能把可见记录当作完整的原生历史。

完整支持需要两个独立工作：

1. 外部历史摄取与对账：以原生 turn/item ID 幂等更新 Remote Codex 投影，处理分页、去重、运行中 turn、删除/回滚、来源和更新时间，并通知前端。只刷新页面不能完成这些工作。
2. 单一会话所有者：网页与 CLI/App 连接同一个持有会话的 Codex app-server，或提供明确的释放/接管流程。官方文档提供 CLI `codex --remote` 接入 app-server 的方式，但不能据此推断 macOS 官方 App 可以接入任意第三方 app-server；其兼容性需要单独验证。

本次修复在线状态和误导性错误，并提供可重复的同步调查证据；**没有实现外部历史自动同步或官方 App 双端协作**。

官方接口语义参考：[OpenAI Docs: Codex App Server](https://learn.chatgpt.com/docs/app-server)。`thread/read` 不 resume、不订阅事件；`thread/resume` 加载会话。本文关于写入者限制及上下文分离的结论来自上述真实实验，不把它们写成官方跨版本承诺。

## 复现与检查

先 `cargo build -p remote-codex`。容器需提供 Node、现有 `codex`/`codex-acp`、CA 证书，以及以下挂载：

- `/repo`：仓库只读挂载，包含刚构建的 `target/debug/remote-codex` 和脚本。
- `/source-codex`：主机 `.codex` 只读挂载。
- `/probe`：仅用于测试的新目录，可写。

在容器内执行 `node /repo/scripts/verify-codex-external-sync.mjs`。这会产生实际 Luna token 消耗；输出每一步的布尔观察、测试标记和错误分类。脚本不修改真实认证文件，也不扫描真实会话。结果留在 `/probe/run-<uuid>/`，完整 native read 结果仅含合成会话。使用与宿主相同 UID/GID 运行容器可保持证据文件可读。

检查结果：

- `cargo test --workspace`：248 项通过，包含正常心跳、无入站帧超时、未来时间戳、持续出站流量、等待请求清理、替换连接隔离、共享探测授权、自动重连及写入者冲突错误分类。`cargo fmt --all --check` 与 Clippy 通过（Clippy 存在既有警告）。为满足 CI，同时格式化了基线中未格式化的 Rust 片段，未修改其行为。
- Windows CI 首轮在三个既有 ACP 中断测试中报 `base_missing`：测试 helper 未对 Python 绝对路径加引号，通用命令解析器吞掉 Windows 反斜杠。改为统一 `shell_words::join` 编码测试参数，保留原测试断言及产品逻辑。
- thread UI 包已在正确仓库构建；supervisor-web 类型检查与生产构建通过。
- Chromium 四项相关用例通过：离线/重连错误分类、真实加密 HTTP/附件/终端及旧密钥 POST 恢复、共享卡片断连恢复、portal 保持在线但探测沉默时卡片按时变灰及原地恢复。Vitest 覆盖 5 秒有效期、多个设备相互独立、旧 portal 不能续期、后台停止探测及丢弃过期回复。
- `scripts/verify-relay-recovery.mjs` 在无外网、无认证挂载的 Docker 中运行。SIGSTOP 9 秒模拟进程暂停，探测 5 秒内返回不可达；SIGCONT 后约 113ms 建立新隧道，PID 不变，正在运行的 fake turn 保持运行并最终完成。另在 TCP 不关闭的情况下双向丢弃数据，网络恢复后约 2104ms 自动连回，PID 仍不变。该测试证明 Linux 下的时序及运行时隔离；macOS 真机合盖仍需现场验证。

在线状态探测和加密恢复需要部署 relay/Web；新的快速隧道重连及写入者冲突提示需要后续 runtime 版本更新到设备。合入 main 本身不会替换本机正在运行的 supervisor，也不等于已发布新的 npm runtime。单独重启设备不部署公网 Web。
