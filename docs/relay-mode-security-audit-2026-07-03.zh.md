# Relay 模式公网多租户安全审查报告

审查日期：2026-07-03 PDT  
审查对象：`/Users/mac/dev/remoteCodex` 当前工作区，重点为 `apps/relay-server`、relay 模式下的 `apps/supervisor-api` 转发通道、relay Web UI/移动端使用路径、部署配置与依赖锁文件。  
结论级别：**当前实现不建议直接作为公网多账号生产 relay 暴露**。它已经有账号、设备、share、路径白名单和 SQLite 参数绑定等安全雏形，但在公网多租户、真实开发机作为后端执行面的场景下，仍存在数个高风险问题，需要在上线前完成加固。

## 1. 执行摘要

relay 模式的风险不是普通 Web 后台风险，而是“公网入口可以间接访问真实开发设备”。一旦 relay 授权或转发边界出错，攻击者可能获得：

- 其他用户 relay 账号会话。
- 其他用户私有 supervisor 的 API 访问权。
- 真实工作区文件读取、下载、覆盖、删除能力。
- 已运行线程的 prompt/control 权限。
- terminal/shell 交互面，进而接近远程命令执行。
- 多租户 relay 数据库中的设备 token、用户邮箱、share 关系。

当前代码里做得比较好的部分：

- relay 用户会话、设备、share 已经有独立数据模型。
- SQLite 查询大多使用参数绑定，未发现明显拼接式 SQL 注入。
- shared session 的 REST 转发有路径白名单，默认不允许任意 `/api/*`。
- shared session 有 `threadAccess` 和 `workspaceAccess` 区分。
- workspace 文件路径解析在 supervisor 侧使用 realpath/root 校验，能挡住常见 `../` 和 symlink 逃逸。
- Docker 运行阶段使用非 root 用户。

但上线前必须处理的高风险点：

1. relay 会把浏览器请求头里的 `Cookie` 等敏感 header 转发给私有 supervisor，导致设备 owner 或被攻陷的 supervisor 能窃取访问者的 relay session。
2. supervisor 在 relay 模式下只凭内部 `x-remote-codex-relay-forwarded: 1` 注入请求绕过本机 auth，relay server 成为唯一授权边界；任何 relay allowlist 漏洞都会直接落到真实开发机。
3. shared WebSocket 控制消息缺少细粒度 server-side allowlist，`control` share 可以把任意 `SupervisorSocketClientEnvelope` 发入 supervisor plugin host。
4. workspace read/write share 的实际权限很大：可以读取 raw 文件、下载目录 zip，write 还能上传、移动、删除文件；这对真实开发目录里的 `.env`、SSH/Git 凭据、源码和构建产物非常敏感。
5. 默认注册开启，且无 rate limit、账号锁定、邮箱验证、MFA、CSRF token 或 bot 防护。
6. device token 明文保存在 SQLite，数据库或备份泄漏会直接变成私有 supervisor 接管。
7. session token 可放在 URL query 中，容易进入日志、浏览器历史、Referer、截图和移动端调试日志。
8. `pnpm audit --prod` 当前报告 1 个 high、2 个 moderate、1 个 low 依赖漏洞。

## 2. 架构和信任边界

### 2.1 主要组件

- 公网 relay server：`apps/relay-server/src/app.ts`
  - 提供 `/relay/auth/*`、`/relay/portal`、`/relay/devices`、`/relay/shares`、`/relay/admin`。
  - 通过 `/supervisor/tunnel` 接受私有 supervisor 发起的 WebSocket。
  - 通过 `/relay/devices/:deviceId/api/*` 和 `/relay/api/*` 转发 HTTP 请求。
  - 通过 `/relay/devices/:deviceId/ws` 和 `/relay/ws` 转发实时事件/控制消息。

- relay 数据库：`apps/relay-server/src/relay-store.ts`
  - SQLite：`relay-store.sqlite`。
  - 表：`relay_users`、`relay_devices`、`relay_shares`、`relay_settings`。

- 私有 supervisor：`apps/supervisor-api/src/app.ts`
  - relay 模式下本机 supervisor 主动连接公网 relay。
  - relay 转发过来的 HTTP 请求通过 Fastify `inject()` 在本机执行。
  - 带 `x-remote-codex-relay-forwarded: 1` 的注入请求会绕过 supervisor admin auth。

- relay Web UI：`apps/supervisor-web`
  - relay server 可直接服务构建后的前端，并注入 `{ mode: 'relay', relayApiBase: '/relay' }`。

### 2.2 关键安全边界

公网用户浏览器或移动端不应该直接信任私有 supervisor。安全链条应该是：

1. relay edge 认证用户。
2. relay 根据 user/device/share 计算权限。
3. relay 严格限制请求路径、方法、body、header、WebSocket message 类型。
4. 私有 supervisor 对 relay-forwarded 请求再次执行必要的资源级校验，或者至少接收 relay 传入的不可伪造授权上下文。
5. response header/body 经过 relay 过滤后再返回给公网用户。

当前实现中，第 1、2、3 步有基础，但第 3 步仍不完整，第 4 步基本缺失，第 5 步存在敏感 header 转发问题。

## 3. 风险分级

- P0 / Critical：可导致跨账号接管、真实开发机命令执行、任意敏感文件泄漏，或上线后极难补救。
- P1 / High：需要账号或 share 前置条件，但可导致越权读写、会话泄漏、持久化 token 泄漏、强 DoS。
- P2 / Medium：配置陷阱、弱防护、信息泄漏、依赖漏洞、审计缺口。
- P3 / Low：安全卫生、文档不一致、误导性配置、未来维护风险。

## 4. 详细发现

### F-01 P0：relay 转发浏览器 `Cookie` 等敏感 header 给私有 supervisor

证据：

- `forwardRelayHttp()` 使用 `relayRequestHeaders(input.request.headers)` 把公网请求头放入 `relay.request.payload.headers`。
- `relayRequestHeaders()` 只剔除 `authorization`、`content-length`、`transfer-encoding`，没有剔除 `cookie`、`origin`、`referer`、`x-forwarded-*`、`host`、`connection`、`upgrade` 等。
- relay 用户 session cookie 名为 `remote_codex_relay_session`，认证读取路径包括 cookie、query 和 bearer。

攻击路径：

1. Alice 把某个 thread share 给 Bob。
2. Bob 在浏览器中访问 Alice 的设备路由：`/relay/devices/:deviceId/api/...`。
3. Bob 的浏览器自动带上 `remote_codex_relay_session=...`。
4. relay 认证 Bob 后，把原始 `Cookie` header 转发给 Alice 的私有 supervisor。
5. Alice 的 supervisor 是 Alice 控制的本地进程，或者 Alice 的机器已被恶意代码控制。它可以在日志、插件、中间件或调试输出中读取 Bob 的 relay session。
6. 拿到 Bob 的 relay session 后，可冒充 Bob 访问 Bob 自己的设备和 shares。

影响：

- 跨账号 session 泄漏。
- share 的 receiver 反而把自己的 relay 凭据暴露给 device owner。
- 这在多租户平台里属于严重信任边界破坏。

修复建议：

- relay 转发到 supervisor 前必须构造一份最小 header allowlist。
- 默认只允许 `content-type`、`accept`、必要的 `if-none-match`/`range` 等无敏感 header。
- 明确剔除：`cookie`、`authorization`、`proxy-authorization`、`set-cookie`、`host`、`origin`、`referer`、`forwarded`、`x-forwarded-*`、`connection`、`upgrade`、`keep-alive`、`te`、`trailer`、`transfer-encoding`。
- 不要把 relay session query 参数转发进 supervisor URL。relay 应先消费认证参数，再从 target path 中移除 `token`/`relaySession`。
- 给测试补充：shared user 请求带 cookie 时，supervisor 收到的 `relay.request.payload.headers` 不含 cookie。

### F-02 P0：supervisor relay auth 绕过完全依赖 relay server 正确授权

证据：

- `apps/supervisor-api/src/app.ts` 中，relay 模式下只要请求 header `x-remote-codex-relay-forwarded` 为 `1`，supervisor onRequest auth 直接 `return`。
- `createRelayRequestHandler()` 对 relay tunnel 过来的请求使用 Fastify `inject()`，并主动设置该 header。

这不是单独漏洞，因为外网不能直接调用 `inject()`；但它使 relay server 成为唯一权限判定点。一旦 relay 的路径 allowlist、share 解析、device 选择、WebSocket message 过滤出错，私有 supervisor 不再有第二道用户级鉴权。

影响：

- relay 任意一处授权 bug 都会变成真实开发机 API 越权。
- 新增 supervisor API 时，如果 relay allowlist 没有被同时审查，可能意外暴露高危能力。

修复建议：

- relay 转发时附带不可伪造的授权上下文，例如：
  - `relayUserId`
  - `deviceId`
  - `accessKind`
  - `threadId`
  - `workspaceId`
  - `threadAccess`
  - `workspaceAccess`
- supervisor 对敏感路由再次校验该上下文，特别是 thread/workspace/shell/plugin 路由。
- 不要只靠 `x-remote-codex-relay-forwarded: 1` 作为语义授权；这个 header 应仅表示 transport 来源。
- 建立“新增 API 默认不允许 relay shared 访问”的测试门禁。

### F-03 P0：shared WebSocket control 面没有细粒度消息 allowlist

证据：

- `connectRelayWebsocket()` 对 shared read-only 会关闭；但只要 `threadAccess === 'control'`，就把客户端发来的 JSON 原样包装成 `relay.client.message` 转给 supervisor。
- `createRelaySocketBridge()` 把该消息交给 `createSupervisorSocketSession().handleMessage()`。
- `createSupervisorSocketSession()` 会调用 `backendPluginHost.handleSocketMessage()`。
- terminal backend 支持 `shell.attach`、`shell.detach`、`shell.input`、`shell.resize`、`shell.clear`。

当前下行过滤 `shouldForwardSocketEvent()` 只看 top-level `threadId`。Shell envelope 的 `threadId` 在 `payload.threadId` 中，`shell.output` 甚至没有 threadId。因此 shared client 可能收不到 shell output，但上行控制消息仍会进入 supervisor 插件处理。

影响：

- shared `control` 用户不应自动拥有 terminal/plugin 控制面。
- 即使现在 shell 输出被过滤，这仍可能造成 shell attach 状态变化、viewer 冲突、资源消耗、插件副作用。
- 未来新增 WebSocket plugin message 时默认会被 shared control 放行，形成高风险扩展点。

修复建议：

- relay 端对 shared WebSocket 上行消息做 explicit allowlist。
- 初期建议 shared 用户只允许 `supervisor.ping`；需要 thread prompt/control 时走已审计 REST 路由。
- 如果必须支持 shell：
  - share 中单独增加 `shellAccess: none/read/write`。
  - relay 根据 `shellId -> threadId/workspaceId` 做 server-side 校验，而不是让客户端自报。
  - supervisor 插件处理时也校验 relay 授权上下文。
- 下行事件过滤要理解 `ShellEventEnvelope.payload.threadId`，并避免把无 threadId 的 `shell.output` 发给不具备 shell 权限的 shared client。

### F-04 P0：workspace share 可读取或下载真实工作区中的任意文件和目录

证据：

- relay allowlist 对 shared workspace read 放行：
  - `/api/workspaces/:id/files/tree`
  - `/api/workspaces/:id/files/preview`
  - `/api/workspaces/:id/files/raw`
  - `/api/workspaces/:id/files/download`
  - artifacts 读取和下载。
- supervisor 的 raw/download 会基于 workspace root 读取文件，download 对目录会创建 zip。

这不是路径逃逸漏洞；路径限制本身看起来较稳。但权限语义非常大：workspace read 等同于该 workspace 内所有文件和目录可读。

攻击路径：

1. Owner 分享一个 thread，并勾选 workspace read。
2. Receiver 可读取该 workspace 下 `.env`、`.npmrc`、私钥、配置文件、源码、测试数据、artifact。
3. 若 workspace 是真实开发目录，往往包含云 token、API key、Git 凭据、数据库 dump。

影响：

- 大规模敏感信息泄漏。
- 一次误分享可能泄露整个项目目录，而不只是 thread transcript。

修复建议：

- UI 文案必须把 workspace read 解释为“可读取整个 workspace 文件树”，不能只写“查看相关文件”。
- 默认为 `workspaceAccess: none`，并且创建 share 时强制二次确认。
- 引入文件范围策略：
  - 只允许 thread artifact 或显式选择的文件。
  - 默认排除 `.env*`、`.ssh/`、`.git/`、`.npmrc`、`.pypirc`、`id_rsa*`、`*.pem`、`*.key`、数据库 dump 等。
  - 目录 zip 下载默认禁止或需要 owner 单独开启。
- 对 `files/raw` 和 `files/download` 增加审计日志。

### F-05 P0：workspace write share 可改写真实工作区文件

证据：

- relay allowlist 对 shared workspace write 放行：
  - `PUT /api/workspaces/:id/files`
  - `POST /api/workspaces/:id/files/upload`
  - `PATCH /api/workspaces/:id/files/move`
  - `DELETE /api/workspaces/:id/files`
- supervisor 侧对应实现会写入、上传、移动、删除文件。

影响：

- 供应链风险：攻击者可修改源码、脚本、配置、测试、构建文件。
- 持久化风险：写入 hook、shell profile、package script、CI 配置后，owner 后续执行命令可能触发恶意代码。
- 数据破坏风险：删除或移动真实项目文件。

修复建议：

- 默认禁止 shared workspace write。
- 如果产品需要多人协作编辑，建议改为 PR/patch 模型，而不是直接写真实目录。
- write share 应限制到临时 branch、临时 copy、sandbox workspace 或 allowlisted 子目录。
- 删除操作需要 owner 侧确认或回收站机制。
- 所有 write 操作记录 actor、path、hash before/after。

### F-06 P1：默认开放注册，不适合公网多租户安全默认值

证据：

- `loadRelayServerConfig()` 中 `REMOTE_CODEX_RELAY_REGISTRATION_ENABLED` 未配置时默认为 `true`。
- README 的 Docker 示例也设置 `REMOTE_CODEX_RELAY_REGISTRATION_ENABLED=true`。
- 注册只需要 email、username、password；registration password 是可选项。

影响：

- 公网 relay 会被任意人注册。
- 账号枚举、垃圾账号、数据库膨胀、设备名/share 名滥用。
- 攻击者可利用 relay 作为长期探测面，观察健康状态、注册行为、前端漏洞。

修复建议：

- 公网生产默认改为 `false`。
- 若支持开放注册，必须配套：
  - email verification。
  - invitation code 或 organization allowlist。
  - CAPTCHA/Turnstile。
  - per-IP/per-account rate limit。
  - abuse detection 和 admin 审计。

### F-07 P1：登录、注册、密码更新、设备/share 创建无 rate limit

证据：

- relay server 未注册 rate limit 插件。
- 登录失败返回统一 401 是好的，但没有节流或锁定。
- 注册、share、device 创建均无全局/账号/IP 配额。

影响：

- 密码爆破。
- 邮箱/用户名枚举。
- 低成本 DoS：大量注册、创建设备、创建 share。
- SQLite 写放大。

修复建议：

- 接入 IP + account 维度 rate limit。
- 登录失败指数退避。
- 注册和设备创建配额。
- admin 后台显示异常登录、注册、设备创建。

### F-08 P1：device token 明文持久化

证据：

- `createDevice()` 生成 `rcd_...` token 后同时保存 `token` 和 `tokenHash`。
- SQLite migration 中 `relay_devices.token` 仍存在。
- `publicDevice()` 返回 `token`，portal summary 中也会带出 device token。

影响：

- 数据库、备份、调试 dump、admin 误导出泄漏后，攻击者可直接冒充私有 supervisor 连接 relay。
- token 无过期、无自动轮换、无 last used 追踪。

修复建议：

- 只保存 `tokenHash` 和 `tokenPreview`。
- token 只在创建时显示一次。
- 增加 rotate/revoke token 操作。
- 记录 `lastUsedAt`、`lastSeenIpHash`、`lastUserAgent` 或 tunnel metadata。
- 数据库备份加密。

### F-09 P1：session token 可通过 query 参数传递，泄漏面过大

证据：

- `readRelaySessionToken()` 接受 `relaySession`、`token` query。
- WebSocket URL 和 image asset URL 中使用 query token。
- iOS/WebThread 测试也构建了含 `relaySession` 的图片 URL。

影响：

- token 进入浏览器历史、代理日志、CDN/反代 access log、移动端日志、截图、Referer。
- 长期 14 天 session 一旦泄漏，影响窗口较长。

修复建议：

- 普通 HTTP 禁止 query session，只允许 HttpOnly cookie 或 Authorization header。
- WebSocket 使用短期一次性 WS ticket：
  - 浏览器先用 cookie 调 `/relay/ws-ticket`。
  - ticket 30-60 秒有效、单次使用、绑定 user/device/thread/access。
  - WS URL 只放 ticket，不放长期 session。
- asset/image 用 cookie 鉴权；移动端如不能用 cookie，使用短期 signed URL。

### F-10 P1：session cookie 缺少 `Secure`，且无显式 CSRF 防护

证据：

- `attachRelayCookie()` 设置 `HttpOnly; SameSite=Lax; Path=/; Max-Age=...`，没有 `Secure`。
- auth、account、admin、device、share 都使用 cookie session。

影响：

- 若公网部署误用 HTTP，session 可被明文传输。
- SameSite=Lax 能挡住很多跨站请求，但不是完整 CSRF 策略，尤其要考虑 WebSocket handshake、老浏览器、反代配置和未来 content-type 变化。

修复建议：

- 生产环境强制 HTTPS，cookie 加 `Secure`。
- 增加 `REMOTE_CODEX_RELAY_COOKIE_SECURE`，生产默认 true。
- state-changing 请求要求 CSRF token 或 double-submit token。
- WebSocket 校验 `Origin`。

### F-11 P1：response header 过滤不足，私有 supervisor 可向公网 relay 域写 cookie

证据：

- `canForwardResponseHeader()` 只过滤 `content-length` 和 `transfer-encoding`。
- `Set-Cookie`、`Location`、`Refresh`、`Content-Security-Policy`、`Access-Control-*` 等都可能被转发。

影响：

- 私有 supervisor 或被攻陷的本地服务可通过 relay response 对公网用户浏览器设置 cookie。
- 如果能设置 `remote_codex_relay_session`，可能造成 session fixation/logout、覆盖用户会话或其他 cookie 污染。

修复建议：

- response header 使用 allowlist。
- 默认允许：`content-type`、`cache-control`、`content-disposition`、必要下载 header。
- 明确剔除 `set-cookie`、`access-control-*`、`content-security-policy`、`location` 或对 redirect 单独处理。

### F-12 P1：无全局连接数、pending request、WebSocket message 大小和速率限制

证据：

- `state.supervisors`、`clientSockets`、`RelayRequestBroker.pendingRequests` 均为内存 Map。
- request timeout 为 30 秒，但没有 per-user/per-device/pending 上限。
- WebSocket message parse 后直接处理，没有大小/频率上限。

影响：

- 攻击者用合法账号即可制造大量 pending relay requests。
- 慢 supervisor 或不响应 supervisor 会让 relay 保持大量 pending Promise 和 timeout。
- 大 WebSocket 消息可造成内存压力。

修复建议：

- per-user、per-device、per-IP 并发上限。
- 每个 supervisor 最大 clientSockets。
- 每个 user/device 最大 pending relay requests。
- WebSocket max payload 和 message rate limit。
- request body size limit 按 endpoint 细分。

### F-13 P1：shared access 的 device 自动选择路径易造成误路由

证据：

- `/relay/api/*` 和 `/relay/ws` 会使用 `firstAccessibleConnectedDevice()` 选择第一个 accessible connected device。
- 对 owner 来说，如果拥有多台设备，未显式指定 device 时可能访问第一台 connected 设备。

影响：

- 用户以为操作的是 A 设备，实际落到 B 设备。
- 对多设备 owner，误操作可能触发错误工作区/线程。

修复建议：

- 公网多设备场景禁用兼容路径 `/relay/api/*` 和 `/relay/ws`，或只保留本地开发模式。
- UI 和移动端必须始终使用 `/relay/devices/:deviceId/...`。

### F-14 P2：`REMOTE_CODEX_RELAY_CLIENT_TOKEN` 配置存在但当前未生效

证据：

- config 解析 `REMOTE_CODEX_RELAY_CLIENT_TOKEN`。
- 代码搜索未发现 relay server 使用 `config.clientToken`。
- 现有测试名为“requires client auth for relayed HTTP requests when configured”，但断言结果仍是“Relay login is required”，并没有验证 client token。

影响：

- 运维可能以为设置了额外 client token 就增加了公网保护，实际没有。
- 安全文档和实际行为不一致。

修复建议：

- 如果不需要该配置，删除并清理文档/CLI help。
- 如果需要，明确语义：它是全局 edge API token，还是 legacy client token；并加测试。

### F-15 P2：legacy supervisor token 仍可连接 `legacy-default`

证据：

- `/supervisor/tunnel` 支持 `REMOTE_CODEX_RELAY_SUPERVISOR_TOKEN`，匹配时 deviceId 为 `legacy-default`。
- 文档也提到 legacy bootstrap token path。

影响：

- 目前没有 store device/share 绑定，普通用户无法访问它，实际爆炸半径有限。
- 但该路径增加了额外认证面，并容易和现代 device token 模型混淆。

修复建议：

- 公网生产禁用 legacy supervisor token。
- 删除或迁移到普通 device token。
- 若保留，必须有 owner 绑定、审计和显式配置开关。

### F-16 P2：账号系统缺少 MFA、邮箱验证、密码策略和 session 撤销

证据：

- 用户表只保存 email、username、role、enabled、password hash。
- session 是 HMAC token，无 server-side session table。
- 密码最小长度 8，无复杂度/泄漏库检查。

影响：

- 密码泄漏后无额外防线。
- 用户改密码后，旧 session 不会自动撤销。
- 管理员只能 disable 用户，不能查看/撤销具体 session。

修复建议：

- 增加 server-side session table 或 per-user `sessionVersion`。
- 改密码、disable、管理员 revoke 时使旧 session 失效。
- 管理员账号支持 TOTP/WebAuthn。
- 登录通知和异常登录审计。

### F-17 P2：健康检查泄露 connected supervisor 数和时间

证据：

- `/healthz` 公开返回 `supervisorConnected`、`supervisorConnectedAt`、`lastSupervisorHeartbeatAt`、`supervisorCount`。

影响：

- 攻击者可观察 relay 使用活跃度。
- 可作为枚举/攻击时机信号。

修复建议：

- 公开 healthz 只返回 `{status:"ok"}`。
- 详细健康状态放到 admin-auth endpoint。

### F-18 P2：CORS WebView 模式允许 `null` origin，误开到公网风险高

证据：

- `REMOTE_CODEX_ENABLE_WEBVIEW_CORS=true` 后默认允许 `null`、`capacitor://localhost`、`ionic://localhost`、`http://localhost`、`https://localhost`。

影响：

- `null` origin 常见于 sandboxed iframe、file URL、部分 WebView。
- 如果公网 relay 误开 CORS，配合 bearer/query token 或非 HttpOnly token 存储会扩大攻击面。

修复建议：

- 生产默认关闭。
- 若必须开启，明确列出移动 app origin，避免默认 `null`。
- CORS 与 cookie/Authorization 使用策略分离。

### F-19 P2：依赖漏洞需要在公网部署前处理

执行命令：

```bash
pnpm audit --prod
```

结果：

- High：`drizzle-orm <0.45.2`，SQL identifier escaping 注入风险。
- Moderate：`prismjs <1.30.0`，DOM Clobbering。
- Moderate：`dompurify <=3.4.10`，配置污染绕过。
- Low：`dompurify <3.4.9`，Trusted Types policy 污染。

说明：

- relay server 本身不直接依赖 `drizzle-orm`，但 monorepo 的 supervisor/db 包依赖它；私有 supervisor 处理 relay 注入请求，因此仍应升级。
- PrismJS/DOMPurify 属于 relay-served web bundle 风险，公网用户会加载该 UI，必须跟进。

修复建议：

- 升级 `drizzle-orm >=0.45.2`。
- 升级 `prismjs >=1.30.0` 相关传递依赖，必要时覆盖 `pnpm.overrides`。
- 升级 `dompurify >=3.4.11`，必要时覆盖 `pnpm.overrides`。
- 在 CI 加 `pnpm audit --prod` 或更细的 allowlist 审核。

### F-20 P2：文档与实现不一致，可能误导安全运维

证据：

- `docs/auth-and-connectivity-modes.md` 仍写 relay store 默认是 `relay-store.json`，但当前实现已使用 `relay-store.sqlite`，并只做 legacy JSON import。
- 文档说 creating device 返回 one-time token，但当前 `publicDevice()` 和 portal summary 仍返回 `token`。

影响：

- 运维可能备份/保护错文件。
- 用户可能以为 device token 不会再次显示，降低保密意识。

修复建议：

- 更新文档为 SQLite。
- 明确 token 是否一次性显示；建议改成真正一次性。
- 安全说明中加入“workspace read/write 的真实含义”。

### F-21 P2：response body 和 file download 缺少敏感内容防护

证据：

- relay 允许 shared read 读取 thread export、items detail、PDF/html export。
- export options 可包含 command output、absolute paths 等，GET export route 允许 query 控制。

影响：

- Thread transcript 本身可能包含 secrets、命令输出、绝对路径。
- read-only share 不是低敏权限；它可能泄露完整历史上下文。

修复建议：

- share UI 明确 read thread 会暴露 transcript、命令输出、附件和导出。
- 对 shared read 默认禁用 `includeCommandOutput`、`includeAbsolutePaths`，除非 owner 明确允许。
- 导出接口根据 share policy 二次过滤。

### F-22 P3：日志和审计能力不足

证据：

- relay server `Fastify({ logger: false })`。
- 没有用户登录、失败登录、share 创建/撤销、device token 使用、HTTP 转发、workspace 文件读写的结构化审计。

影响：

- 发生越权或泄漏后难以追踪。
- 多租户公网服务难以做风控。

修复建议：

- 打开结构化日志并做 secret redaction。
- 记录 actor、targetUser、deviceId、shareId、threadId、workspaceId、path、method、status、requestId。
- 对敏感文件下载、workspace write、admin 操作做高优先级审计事件。

## 5. 注入类漏洞审查

### 5.1 SQL 注入

当前 relay store 的用户、设备、share 查询基本使用 `better-sqlite3.prepare(...).get/run()` 参数绑定，未看到把用户输入直接拼接到 WHERE 值中的模式。  
注意点：

- `ensureColumn(table, column, definition)` 使用字符串拼接执行 PRAGMA/ALTER，但调用参数是代码常量，不是用户输入。
- legacy JSON import 直接插入历史数据，仍走 SQL 参数绑定。
- `pnpm audit` 报告 monorepo 中 `drizzle-orm` high 漏洞，应升级，尤其 supervisor/db 仍处于 relay 请求执行链路中。

结论：relay store 未发现直接 SQL 注入；依赖层面存在 high 告警。

### 5.2 路径穿越

当前 supervisor workspace 文件读写使用 realpath/root 校验，`packages/workspace` 的 `assertPathWithinRoot()`、`resolveWorkspaceFilePath()` 能处理常见相对路径和 symlink。  
风险不在 path traversal，而在授权语义：share 一旦给了 workspace read/write，就是整个 workspace 内的 broad access。

### 5.3 SSRF / 任意 URL 转发

relay HTTP target path 来自 `/relay/devices/:deviceId/api/*` 去掉前缀后的本地 path，`isAllowedRelayTarget()` 只允许 `/api/*` 和 `/healthz`，没有直接把用户 URL 请求到任意 host。因此未发现传统 SSRF。  
但 response header 转发、cookie/header 转发仍会造成跨信任边界数据泄漏。

### 5.4 XSS / HTML 注入

本次没有逐行审查 thread-ui 的 markdown 渲染实现，但依赖审计显示 `prismjs` 和 `dompurify` 有相关告警。relay web UI 在公网直接服务给多租户用户，且 transcript/markdown/mermaid/代码块均可能包含攻击者可控内容，因此必须修复依赖并补 XSS 回归测试。

### 5.5 命令注入 / RCE

relay server 本身未发现直接 spawn 用户输入。真正的 RCE 面在私有 supervisor：prompt、terminal shell、plugin、hook、workspace 文件写入等都可影响真实开发机。relay 必须把这些当作高危操作，并确保 shared control 不默认拥有 terminal/plugin/hook 能力。

## 6. 建议的上线阻断清单

公网多账号部署前至少完成以下 P0/P1：

1. Header 转发最小化：禁止转发 `cookie`、`set-cookie`、`authorization`、`origin`、`referer`、`host`、hop-by-hop headers、`x-forwarded-*`。
2. Response header allowlist：禁止私有 supervisor 通过 relay 给公网用户设置 cookie。
3. 禁止长期 session 出现在 URL query；WebSocket/asset 改短期 ticket。
4. Cookie 加 `Secure`，生产强制 HTTPS。
5. 注册默认关闭；开放注册必须有邀请/邮箱验证/CAPTCHA/rate limit。
6. 登录、注册、设备、share、HTTP relay、WebSocket 加 rate limit 和配额。
7. device token 改为只存 hash，创建后只显示一次，支持 rotate/revoke。
8. shared WebSocket 上行消息增加 explicit allowlist；默认禁止 shell/plugin 控制。
9. workspace read/write share 改成最小权限，至少 UI 二次确认并默认禁止目录 zip。
10. supervisor 对 relay 授权上下文做二次校验，不只信 `x-remote-codex-relay-forwarded`。
11. 升级 `pnpm audit --prod` 中的 high/moderate 漏洞。
12. 添加安全回归测试和 CI 门禁。

## 7. 建议测试用例

### 7.1 Header/cookie 泄漏回归

- shared user 请求 `/relay/devices/:deviceId/api/threads/:id`，带 `Cookie: remote_codex_relay_session=...`。
- supervisor socket 收到的 `relay.request.payload.headers` 不得含 `cookie`。
- target path 不得含 `relaySession` 或 `token` query。

### 7.2 Response header 污染回归

- fake supervisor 返回：
  - `Set-Cookie: remote_codex_relay_session=attacker`
  - `Location: https://evil.example`
  - `Access-Control-Allow-Origin: *`
- relay response 不应转发这些 header，除非某个 header 明确在 allowlist 中且有测试说明。

### 7.3 Shared REST allowlist 回归

- shared read 不允许 POST/PATCH/DELETE thread。
- shared control 只允许 prompt/resume/interrupt/respond/goal PATCH。
- shared workspace read 不允许 upload/move/delete。
- shared workspace write 不允许 workspace rename/favorite/open/artifact create/delete。
- 新增 supervisor API 时，必须显式测试 shared 默认 403。

### 7.4 Shared WebSocket 回归

- shared read 发送任何非 ping message：连接关闭或返回拒绝。
- shared control 发送 `shell.attach`：默认拒绝。
- shared control 发送未知 plugin message：默认拒绝。
- 如果未来允许 shell，必须验证 shellId 属于 shared thread，且输出只发给授权用户。

### 7.5 Token 生命周期回归

- device token 创建后 portal summary 不返回完整 token。
- rotate 后旧 token 无法连接 `/supervisor/tunnel`。
- revoke/delete device 后当前 tunnel 和 client sockets 断开。
- 用户改密码或 disable 后旧 session 失效。

### 7.6 DoS/配额回归

- 单用户 pending relay request 超限返回 429/503。
- 单 device clientSockets 超限拒绝。
- WebSocket 大消息被关闭。
- 登录失败超过阈值触发退避。

## 8. 建议实现顺序

第一批，阻断高危泄漏：

1. 修 `relayRequestHeaders()` 和 response header 过滤。
2. 移除 HTTP query session；WebSocket 引入短期 ticket。
3. Cookie 加 `Secure` 和 Origin/CSRF 防护。
4. 增加回归测试。

第二批，收紧授权：

1. shared WebSocket message allowlist。
2. relay 授权上下文传到 supervisor。
3. supervisor 对 thread/workspace/shell/plugin 路由二次校验。
4. workspace share 最小权限化。

第三批，运营安全：

1. rate limit、配额、审计日志。
2. token hash-only、rotate、session revoke。
3. 注册策略、MFA、邮箱验证。
4. 依赖升级和 CI audit。

## 9. 审计范围限制

本报告基于当前本地代码静态审查、已有测试阅读、`pnpm audit --prod` 结果和部分配置/文档核对。未完成以下事项：

- 未对公网实际部署环境、反向代理、TLS、Cloudflare/WAF、日志系统做现场验证。
- 未运行动态渗透测试或 fuzz。
- 未完整审查 `@remote-codex/thread-ui` 源码和所有 markdown/mermaid/XSS sink。
- 未审查 iOS/Android 原生安全存储细节。
- 未审查全部 agent runtime/provider/plugin 供应链执行面。

因此，本报告应作为上线前安全整改清单，而不是最终安全证明。

## 10. 总体结论

relay 模式的产品方向是可行的：私有 supervisor 主动出站连接公网 relay，比直接暴露开发机端口更合理。当前实现也已经有明确的 user/device/share 模型和 shared REST allowlist。

但以“一个公网 relay 支持多个账号、多个人注册、后端连接真实开发设备”的标准看，现在的风险还偏高。最危险的不是传统 SQL 注入，而是多租户信任边界：header/cookie 被转发到他人设备、shared control 进入 WebSocket plugin host、workspace share 过宽、token 生命周期不足、默认开放注册和无速率限制。

建议把本报告中的 P0/P1 项作为公网部署阻断项；完成后再做一次专门的动态测试和代码复审。
