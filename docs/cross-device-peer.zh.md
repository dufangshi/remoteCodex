# 跨 device 线程通信与文件传输（同一 owner）

状态：实施中。分支 `feat/cross-device-peer`。本文是各实现分支共同遵守的接口契约；签名以已提交的骨架代码为准（`crates/supervisor/src/peer_*.rs`、`auth.rs` 的 `PeerCaller`、`crates/runtime/src/interaction/peer.rs`）。改契约先改本文。

## 1. 范围

- 只在**同一 relay 用户名下**的 device 之间（`relay_devices.owner_user_id` 相同）。不含分享设备、hosted 成员访问、Web UI。
- 消息：设备目录；对远端 thread 的 info / workspaces / list / status / show / transcript / send（inbox、direct、queue、steer）/ backends / models / create；跨 device 的 `--notify-on-complete`（结果落到发起方本机 inbox）；目标离线时 inbox/queue 消息进**发送端** outbox，稍后重投。
- 文件：随消息推送附件（分片上传到目标 thread 的 incoming 目录）；只读拉取远端 workspace 文件（`fs ls` / `fs get`）。
- 传输：除密钥握手外全部端到端 HPKE 加密，relay 只见路由元数据。放开隧道 WebSocket 的 16 MiB 帧上限。
- 不做：远端 wait / wake / tree / task / close / delete / inbox 操作；relay 存储任何消息或文件；分享设备权限映射。

## 2. 总体流程

```text
A 上的 agent ── remote-codex CLI ── loopback /api/cli (A supervisor)
   A supervisor ── peer_send::intercept ── peer_link::request（HPKE 加密）
      ── A 的隧道帧 peer.request ──▶ relay（核对同一 owner、路径前缀、密文）
      ── B 的隧道帧 relay.request + relay 写入的 peer 身份 ──▶ B supervisor
         tunnel 解密 → dispatch_raw 注入 PeerCaller → /api/peer/... handler
      ◀── relay.response ── relay ── peer.response ◀── A（解密）
```

## 3. 身份与开关

- **relay device ID**：relay 在 `relay.connected` 中发送 `deviceId` 和（新增）`deviceName`。supervisor 记录在 `peer_link`，`relay_identity()` 返回。本地 `hosts.id` 保持不变；`/api/cli` 的 `info` 增加 `relayDeviceId`、`deviceName`。
- **PeerCaller**（`crates/supervisor/src/auth.rs`）：`{device_id, device_name, user_id}`，只能由隧道根据 relay 写入的 `peer` 对象构造，作为请求 extension，与 `TrustedRelayForward` 同时存在。
- **开关**：每台 device 独立，默认关闭。`Supervisor::peer_access_enabled()` / `set_peer_access(bool)`（已实现，KV `peer:settings`）。发出和接收都要求本机开启。Web/本机 owner 通过 `GET|PATCH /api/config/peer-access`（`{"enabled":bool}`）设置；CLI `remote-codex device access on|off` 只接受本机 machine credential（`CliCaller(None)`），thread 凭据只能查看。远端 device 无法修改开关（PeerCaller 只能访问 `/api/peer/*`）。
- **身份钉扎**：A 首次与 B 握手时 TOFU 钉住 B 的 identity key（runtime KV `peer:pin:{relayDeviceId}` = `{"identityKey","fingerprint","pinnedAt"}`），之后变化即 `PeerError::IdentityChanged`。`remote-codex device trust DEVICE --reset`（machine credential）清除。

## 4. 隧道帧（relay ↔ supervisor）

device → relay：

```json
{"type":"peer.request","requestId":"<A 生成的 uuid>","targetDeviceId":"<relay device id>",
 "payload":{"method":"POST","path":"/api/peer/cli","headers":{...},"body":"<base64>","bodyEncoding":"base64"}}
{"type":"peer.directory","requestId":"<uuid>"}
```

relay → 发起方：

```json
{"type":"peer.response","requestId":"<A 的 id>","payload":{"statusCode":200,"headers":{...},"body":"...","bodyEncoding":"base64"}}
{"type":"peer.directory.result","requestId":"<A 的 id>",
 "devices":[{"deviceId":"...","name":"...","online":true,"self":false}]}
```

relay → 目标（沿用 `relay.request`，多一个只由 relay 写入的 `peer`）：

```json
{"type":"relay.request","requestId":"<relay 新 uuid>","deviceId":"<B>","payload":{...},
 "peer":{"deviceId":"<A>","deviceName":"<A 的名字>","userId":"<owner>"}}
```

目标回复仍是 `relay.response`，relay 按自己的 requestId 映射回 A 的 `peer.response`。relay 自己产生的错误也用 `peer.response`，`statusCode` 为 4xx/5xx，`headers` 不含 `x-rcd-encrypted`，`body` 为 JSON 字符串 `{"code","message"}`：

| 情况 | statusCode | code |
| --- | --- | --- |
| 目标不存在或不属于同一 owner | 404 | `device_not_found` |
| 目标离线 | 503 | `device_offline` |
| 目标 30 s 内无响应 | 504 | `timeout` |
| 路径/方法/明文规则不满足 | 403 | `peer_forbidden` |
| 请求体超过上限 | 413 | `payload_too_large` |
| 发起方并发超过 32 | 429 | `busy` |

## 5. Relay 规则

1. 发起方 device = 该隧道 socket 已认证的 device；绝不取自帧内容。目标必须存在、`owner_user_id` 相同、owner 用户 enabled，且目标 ≠ 发起方。
2. `payload.path`（去掉 query）必须以 `/api/peer/` 开头；method ∈ GET/POST/PUT。
3. 除 `GET .../transport/key` 握手外必须带 `x-rcd-key`（即密文）；否则 403。
4. 只转发这些 header：`content-type`、`accept`、`x-rcd-key`、`x-rcd-request`、`x-rcd-enc`、`x-rcd-sealed`。丢弃 `x-rcd-resource`、`x-rcd-hosted-workspaces` 等策略头。`peer` 对象只由 relay 构造；浏览器路径永远不带 `peer`。
5. `payload.body` 字符串 ≤ 8 MiB；每个发起方同时在途 ≤ 32；沿用全局 pending 上限。
6. 目录：同 owner 的全部 device（含自己 `self:true`），`online` 取当前隧道连接。
7. `/supervisor/tunnel` 升级时把 WebSocket message/frame 上限提到 128 MiB。

## 6. Supervisor 入站规则（目标 B）

- `relay.request` 带 `peer` 时，`forward_local` / `dispatch_*` 在 `TrustedRelayForward` 之外注入 `PeerCaller`。
- `require_auth`：带 `PeerCaller` 的请求只能访问 `/api/peer/` 前缀；`/api/peer/` 前缀的请求必须带 `PeerCaller`（否则 403，包括 owner 浏览器）。`/api/cli` 规则不变。
- 带 `PeerCaller` 的请求，除 `.../transport/key` 和 `.../transport/stream/...` 外必须是密文，否则 400。
- 加密下载流对 `/api/peer/...` 路径的作用域是 `/api/peer`，续读路径为 `/api/peer/transport/stream/{id}?chunk=N`，从而仍满足 relay 的前缀规则。
- 隧道客户端连接时同样把 message/frame 上限提到 128 MiB（`connect_async_with_config`）。

## 7. 加密客户端（A）

与 `secure_transport.rs` 服务端逐字节兼容：

- 握手：`GET /api/peer/transport/key?challenge=<随机 [A-Za-z0-9-]{≤128}>`（明文 peer 请求）。校验 identity key 对 `rcd-key-v1\n{challenge}\n{keyId}\n{expiresAt}\n{serverTime}\n{publicKey}` 的 P-256 签名、challenge 一致、`expiresAt` 未过期；TOFU 钉扎（§3）。按 `serverTime` 计算时钟偏移，请求 ID 时间戳使用对端时钟（服务端只接受 ±120 s）。描述符缓存到 `expiresAt` 前 5 分钟；收到 409 `transport_reconnect_required` 时刷新并重试一次。
- 请求：`x-rcd-request = "{uuid}.{ms}"`，AAD `rcd-http-v1\n{keyId}\n{requestId}\n{method}\n{path}\n`（resource 为空串），明文 `pack({"query":"?...","headers":{"content-type":...}}, body)`，密文放 body（base64），header 带 `x-rcd-key`、`x-rcd-request`、`x-rcd-enc`。
- 响应：`x-rcd-encrypted: 1` 时用 exporter `remote-codex/http-response/v1` 派生的 AES-256-GCM（零 nonce，AAD `{请求 AAD}\nresponse`）解密并 unpack，得到 `{headers,status,streamNext}` + body；有 `streamNext` 时继续加密 GET 拼接（总量 ≤ 64 MiB）。
- relay 产生的明文错误按 §4 表映射：503→`Offline`，504→`Timeout`，其余→`Remote`；隧道未连接→`RelayUnavailable`。

## 8. `peer_link` API（骨架已提交）

`relay_identity`、`directory`、`request`、`request_json`、`reset_pin`、`PeerError`（`retryable()` 仅对 `RelayUnavailable`/`Offline`/`Timeout` 为真）。链路状态按 `state.config.database_url` 区分（与 `secure_transport::transport` 相同），以便同一进程内的多个 supervisor 互不干扰。隧道断开时让所有在途请求失败为 `RelayUnavailable`。

## 9. 目标端 `/api/peer/cli`

请求体与本地 `/api/cli` 相同（`{"operation", ...}`）。先检查 `PeerCaller` 存在、本机开关已开（否则 403 `peer_access_disabled`），再按白名单处理：

| operation | 行为 |
| --- | --- |
| `info` | `{deviceId(hosts.id), relayDeviceId, deviceName, peerAccess:true}` |
| `workspaces` | `[{id,name,absPath}]` |
| `list` / `status` / `show` / `transcript` / `backends` | 去掉 `fromThreadId` 后调用 `interaction::run` |
| `models` | 同上；可带 `workspaceId` 选择 cwd |
| `create` | 去掉 `fromThreadId`、`parentThreadId`、`name`（远端不建 lineage）；必须带 `workspaceId`；`approvalMode` 不继承；支持 `role`、`worktree`。可选 KV `peer:origin:{threadId}` 记录来源 `{deviceId, deviceName, threadId}` |
| `send` | 见 §10 |
| 其他 | 403 `peer_operation_forbidden` |

## 10. 远程发件人与完成通知（runtime）

- 远程发件人 `{deviceId, deviceName, threadId?}` 只来自 `PeerCaller` + 请求体的 `fromThreadId`，不能经本地 `/api/cli` JSON 设置。
- `send` 不在本机校验远程 `fromThreadId`。inbox 记录新增 `fromDeviceId`、`fromDeviceName`、`replyTo`（`"{deviceId}/{threadId}"`）。direct/queue/steer 的 prompt 头为 `[remoteCodex {kind} from {deviceId}/{threadId} (device "{deviceName}") | {subject}]`，其余（`In reply to`、正文）与本地一致。
- 去重键命名空间：`cli:request:{id}:peer:{deviceId}:{threadId}:{key}`。
- `notifyOnComplete`：订阅值增加 `deviceId`、`deviceName`。`finish_notification` 遇到远程订阅时不写本机 inbox，而是写一条 outbox 记录（§12），内容与本地完成通知相同（kind `result`），`fromThreadId` 为完成的本机 thread。

## 11. 本地 `/api/cli` 扩展与 CLI（A）

`peer_send::intercept` 处理：

- `devices` → 目录（标注 `self`）；`peerAccess`（带 `enabled` 即设置，需 machine credential）；`peerTrust`（`{deviceId, reset:true}`，需 machine credential）；`outbox`（列出待投递记录）。
- 带 `deviceId` 的操作：先按 relay device ID 或名字（不区分大小写、唯一匹配）解析；等于本机（relay id、hosts.id 或本机名）时去掉 `deviceId` 交给本地处理。远端：白名单 §9 的操作经 `request_json(…, "/api/peer/cli", …)` 转发；`send`/`create` 把调用方 thread（thread 凭据或 `--from`）填为 `fromThreadId`。其他操作报错 `not available across devices`。
- `send` 带 `attachments`（本机路径数组，≤ 20 个）：先 `peer_files::stage` 到 `{数据目录}/peer-outbox/{outboxId}/`，再 `peer_files::upload` 到目标 thread，最后发送消息。正文末尾附上目标端路径清单，请求体带结构化 `attachments`。
- `fsList` / `fsGet`（`deviceId`、`workspaceId`、`path`、`out?`）→ `peer_files::fs_list` / `fs_get`；目标是本机时报错（直接用文件系统）。
- 本地 `info` 增加 `relayDeviceId`、`deviceName`。

CLI：

```sh
remote-codex device list
remote-codex device access [on|off]
remote-codex device trust DEVICE --reset
remote-codex device workspaces DEVICE
remote-codex thread list|backends|models --device DEVICE ...
remote-codex thread create --device DEVICE --workspace WS ...
remote-codex thread status|show DEVICE/THREAD
remote-codex transcript DEVICE/THREAD ...
remote-codex thread send DEVICE/THREAD [--attach PATH ...] ...
remote-codex fs ls DEVICE --workspace WS [PATH]
remote-codex fs get DEVICE --workspace WS PATH [--out LOCAL]
remote-codex outbox
```

目标解析：`DEVICE/THREAD`（THREAD 为 UUID，DEVICE 为名字或 relay id）；完整网页 URL 用 `info.relayDeviceId`（兼容 `hosts.id`）判断本机/远端，修复现有 URL 误判；名字、`self`、`parent`、`root` 只在本机解析。

## 12. Outbox

KV `peer:outbox:{id}`：

```json
{"id":"...","targetDeviceId":"...",
 "request":{"operation":"send","threadId":"...","text":"...","delivery":"inbox|queue","kind":"...","subject":"...","inReplyTo":null,"fromThreadId":"...","notifyOnComplete":false,"clientRequestId":"outbox-{id}"},
 "attachments":["/abs/staged/file", "..."],
 "createdAt":"...","attempts":0,"nextAttemptAt":"...","lastError":null,"expiresAt":"createdAt+7d"}
```

- 只有 inbox/queue 的 `send` 且错误 `retryable()` 时进入 outbox，回执为 `{"delivery":"outboxed","outboxId",...}`；direct、steer、create 和其他错误直接失败。
- 投递：每 5 s 扫描到期记录；先上传附件再发送；重试间隔 5 s、15 s、60 s、5 min，之后每 15 min。成功后删除记录及暂存目录。
- 过期或遇到不可重试错误时删除，并在本机发件 thread（若存在）的 inbox 里放一条 kind `status` 的失败说明。
- runtime（§10 完成通知）只写记录，投递由 supervisor 的 worker 负责。

## 13. 文件（`/api/peer/files/*`，目标 B）

都要求 `PeerCaller` 和开关已开。

- `POST /uploads` `{threadId, name, size, sha256, uploadId?}` → `{uploadId, received, chunkSize: 4194304}`。`name` 取 basename，不得为空或含分隔符，长度 ≤ 255；`size` ≤ 1 GiB；`sha256` 为 64 位十六进制。带已有 `uploadId` 时返回当前 `received`，用于续传。暂存于 `{数据目录}/peer-uploads/{uploadId}.part|.json`；超过 24 h 未提交的清理。
- `PUT /uploads/{id}?offset=N`（原始字节，≤ chunkSize）：`offset == received` 才追加，否则 409 并返回当前 `received`。
- `POST /uploads/{id}/commit`：校验大小与 sha256 后移动到 `{thread 的 cwd}/.temp/threads/{threadId}/incoming/{uploadId}/{name}`（cwd：有 worktree 用 worktree，否则 workspace 根目录）。返回 `{name, size, sha256, path, relativePath}`。
- `POST /list` `{workspaceId, path}` → `{entries:[{name,path,kind,size?,modifiedAt?}]}`。`POST /stat` → `{kind,size,sha256,modifiedAt}`（v1 只支持普通文件）。`GET /read?workspaceId=&path=&offset=&length=`：返回原始字节，单次 ≤ 1 MiB，带 `content-range`。路径都用 `files::assert_within` 限定在 workspace 内。
- 调用方函数（骨架已提交）：`stage`（复制文件，目录打 zip）、`upload`（按 `chunkSize` 分片上传，支持续传）、`fs_list`、`fs_get`（默认保存到 `{调用方 thread cwd}/.temp/threads/{caller}/downloads/{deviceName}/{name}`，无调用方时保存到 workspace 根目录下的 `.temp/downloads/...`；校验 sha256）。

## 14. 安全清单

- relay：同 owner、前缀、密文、header 白名单、不信任设备提供的 `peer`、体积与并发上限。
- supervisor：`PeerCaller` 只来自 relay 帧；`PeerCaller` ⇔ `/api/peer/*`；两端开关；操作白名单；路径限定 workspace；上传只落在 thread incoming 目录；大小与哈希校验；远程发件人由服务端填写；prompt 头标明远程来源。
- 钉扎 TOFU；身份变化即失败，只有 machine credential 能重置。

## 15. 测试与验收

- 各分支：`cargo fmt --all`，相关 crate 的 `cargo check --all-targets`，以及本分支新增/受影响测试（`cargo test -p <crate> <name>`）。不跑 `cargo test --workspace`。
- relay：鉴权（同 owner 通过；他人设备 404；离线 503；超时 504）、前缀与明文规则、header 过滤、响应路由回发起方、目录。
- 传输：Rust client ↔ `secure_transport` 服务端往返；签名错误；钉扎变化；streamNext 续读；时钟偏移；隧道 pending 关联与断线失败。
- 目标端：`router().oneshot()` 注入 `TrustedRelayForward` + `PeerCaller` 测白名单、开关、远程发件人、去重、完成通知写 outbox；无 `PeerCaller` 访问 `/api/peer/*` 被拒；带 `PeerCaller` 访问其他路由被拒。
- 文件：分片、续传、偏移冲突、哈希不符、名字清洗、路径越界、incoming 落点。
- 集成（合并后）：`scripts/peer-e2e-live.mjs` 用真实二进制在临时目录跑 relay + 两台 fake-runtime supervisor，覆盖目录、开关、远端 list/status/send/transcript/create、完成通知回到 A 的 inbox、B 离线时进 outbox 并在恢复后送达、附件（含 > 16 MiB）、`fs get`，以及一个经 relay 的 20 MiB 浏览器式上传不再断隧道。

## 16. 分工与文件归属

| 分支 | 负责 | 主要文件 |
| --- | --- | --- |
| relay | §4 relay 侧、§5 | `crates/relay/src/peer.rs`（新）、`lib.rs` 少量接入 |
| transport | §4 supervisor 侧、§6、§7、§8 | `tunnel.rs`、`auth.rs`、`peer_link.rs`、`secure_transport/{client,streams}.rs`、`Cargo.toml` |
| peer-api | §9、§10 | `peer_api.rs`、`crates/runtime/src/interaction/{mod,inbox,peer}.rs` |
| peer-send | §11、§12、CLI 与文档 | `peer_send.rs`、`interaction.rs`（仅 `info` 与转发入口）、`crates/cli/src/*`、`skills/thread-interaction/SKILL.md`、`docs/thread-interaction.md` |
| peer-files | §13 | `peer_files.rs` |

不要修改其他分支负责的文件；确实需要时在交付说明里写明。`crates/supervisor/src/lib.rs` 里 peer 模块的 `#[allow(dead_code)]` 由各自负责的分支在实现完成后移除。
