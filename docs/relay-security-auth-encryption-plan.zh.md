# Relay 安全、低打扰二步验证与密文转发实施计划

状态：实现及本地验收完成；分支提交与四平台构建核验中。起点：main `5dd2acc5`，共享 UI main `d3bcbfd`。分支：`security/relay-auth-encryption`（两个仓库）。

## 本次边界

先修已确认的权限、内容隔离、会话和 OAuth 漏洞，再提供 Google Authenticator 兼容的 TOTP、恢复码、Passkey 和可信浏览器，最后实现 browser ↔ supervisor 密文数据通道。暂不改变设备所有者的能力，不引入工作区白名单、OS 沙箱或逐命令本地审批。

密文通道保护中继中的私有请求／响应／事件内容；账号、设备 ID、授权所需的资源范围、大小／时序仍可见。公开分享快照由用户主动发布，为公开明文。网页仍由 relay 提供时，不能承诺抵御恶意替换前端、首次公钥替换或已获设备控制权限的 relay；本次不把传输加密宣称为设备权限隔离。

## 产品约定

- 账户 Security 页面：Authenticator app、Passkeys、Recovery codes、Trusted browsers、Active sessions。
- TOTP 使用标准 otpauth QR＋手工密钥，验证第一枚有效验证码后才启用；恢复码只展示一次，可复制／下载；重生成作废旧码。
- 密码登录的新浏览器先验证密码，再展示一个验证码页面，可选 Passkey 或恢复码，不重复填写密码。
- 默认记住通过二步验证的浏览器 30 天。有效的随机 HttpOnly 可信浏览器凭据＋一致的浏览器环境可免重复 OTP；不以 IP 或可伪造的指纹单独判断可信。正常切换 Wi-Fi／移动网络不触发反复验证。
- 新浏览器、凭据丢失／过期、恢复码登录、改密／重置 MFA／撤销信任触发重新验证。安全设置变更要求近期强验证（10 分钟），不把普通登录或 OAuth 身份返回自动当作二步验证。
- Passkey 使用标准 WebAuthn、user verification 和服务器端单次 challenge，可作为 MFA 的替代方式；至少保留一种可用恢复途径。
- 安全切换对旧会话执行明确迁移或一次重新登录，不静默保留不可撤销旧令牌。不因常规刷新、切页、每条 prompt 弹验证。

## 阶段与验收

### S1 已确认漏洞与基础防护

- [x] Supervisor 内部转发改为不可由 HTTP 请求伪造的进程内授权。
- [x] 附件归属与真实图片校验，阻断 thread 图片接口读取非附件文件；保留既有合法历史图片。
- [x] 隔离原始 HTML／SVG，防止主站同源脚本；保留下载与正常文件预览。
- [x] WS 按消息类型、thread／shell 归属逐次授权；陌生 Origin 拒绝；撤销／禁用／到期断开。
- [x] 服务端可撤销会话、安全 Cookie／CSRF、移除 Web 长期 localStorage bearer，兼容明确的原生认证。
- [x] 设备 token 哈希存储、一次显示与轮换、隧道 Authorization；独立持久随机 session secret。
- [x] OAuth browser-bound 单次 state＋PKCE；限流、有限队列／并发和必要审计。
- [x] 隔离回归确认所有审查复现被阻断且正常访问通过。

### S2 TOTP、恢复码与可信浏览器

- [x] 持久化迁移、加密保存 TOTP、单次挑战、尝试限制、防重放。
- [x] enrollment／verify／disable／recovery regenerate，强验证保护变更。
- [x] trusted browser 30 天、环境绑定、主动撤销；session 列表及撤销。
- [x] 统一账户 Security UI，QR、复制、恢复码下载、登录挑战与异常恢复。
- [x] 验证新环境必需 OTP、可信环境免 OTP、改密／撤销后失效、旧码重放被拒绝。

### S3 Passkey

- [x] 成熟服务端 WebAuthn 库，固定 RP ID／origin，挑战只存在服务端并绑定账户／会话。
- [x] 注册、命名、删除、认证，支持不同设备和备份凭据，防止删除最后恢复途径。
- [x] 浏览器原生凭据 API，取消可无损回退验证码；虚拟 authenticator 端到端测试。

### S4 密文传输与兼容

- [x] 定义有版本的数据协议，成熟算法／库，设备持久私钥、客户端公钥固定、会话密钥协商、防篡改／重放。
- [x] 私有 HTTP 数据、附件、WebSocket agent／terminal 事件双向加密；授权路由元数据与密文绑定。
- [x] 复用连接／会话密钥，流式分片、有界队列；不为每条 token／按键做非对称运算。
- [x] 新旧版本协商明确展示连接安全状态，不静默将已要求密文的连接降级为明文。
- [x] 分享快照在客户端投影后显式发布；导出、本地模式与非加密旧设备兼容策略记录。
- [x] Rust／Web 互操作、篡改／重放／重连、二进制及性能测试；记录同样负载的明文／密文耗时与字节开销。

### S5 集成与交付

- [x] 修改 crates 后 cargo test --workspace；相关 Vitest、Web 类型检查与构建。
- [x] 按 focused-e2e 技能只跑安全／登录／分享／加密相关 spec 和明确 browser project；桌面与移动覆盖有不同交互的流程。
- [x] 更新 docs 的完成状态、实际协议／迁移、运维恢复和验证结果；提交实际受影响仓库的相关变更；共享 UI 仓库本次无差异。
- [ ] 分支推送，保持 main 未合并；部署前固定 runtime／UI SHA，按 release-runtime 完整四平台发布策略处理。用户本次要求新分支推进，不自动把未验收分支替换 main。

## 验证原则

使用隔离 relay＋supervisor、假 harness、合成文件及浏览器虚拟认证器；不读取真实秘密、不攻击公网、不改变正在执行任务的 supervisor。安全结论区分已验证、协议约束和仍存在的信任边界。性能不以跳过鉴权／加密或无界缓冲换取。

## 资料

- OWASP Authentication / Session Management / WebSocket Security Cheat Sheets。
- WebAuthn server：https://docs.rs/webauthn-rs/latest/webauthn_rs/
- TOTP：https://docs.rs/totp-rs/latest/totp_rs/
- [RFC 9180 HPKE](https://www.rfc-editor.org/rfc/rfc9180)、[hpke Rust](https://docs.rs/hpke/latest/hpke/) 和 [hpke-js](https://github.com/dajiaji/hpke-js)；使用成熟算法与实现。

## 实施记录

- 初始化：同步检查 main，建立两个工作分支；将用户范围、低打扰登录和验收项写入本计划。

- S1 首轮：进程内转发替代可伪造 Header；限制图片到实际 thread 附件目录并校验 raster signature；HTML/SVG sandbox CSP 经两段转发完整保留。服务端会话撤销、改密/禁用触发器、Secure Cookie、Origin/CSRF、OAuth 单次浏览器绑定和 PKCE 已实现。Browser bearer 退出 localStorage，用户/admin 使用独立 Cookie。
- S1 验证：全工作区 cargo test 通过；新增真实 relay＋fake supervisor 的 Chromium E2E 通过（19.6 秒，含合法图片正例、越权 shell/跨站 WS/原始 HTML/改密及 logout 旧会话拒绝）。设备 token 轮换 UI、最终有界传输与审计仍在补齐。
- S2/S3 首轮：TOTP encrypted-at-rest、一次性恢复码、30 天可信浏览器、10 分钟近期验证、会话/浏览器撤销和 WebAuthn 服务端挑战均已接入，使用 totp-rs 5.7.2 / webauthn-rs 0.5.5。序列化 WebAuthn state 只存服务器数据库，绝不放入客户端 Cookie。
- S2/S3 验证：28 项 relay Rust 测试通过；真实浏览器验证扫码设置、恢复码下载、虚拟 Passkey 注册与登录、新浏览器 OTP、可信浏览器免 OTP、刷新挑战恢复通过（12.4 秒）。继续补取消/撤销、移动布局及完整集成。

## S4 协议落地约定

采用 RFC 9180 HPKE（DHKEM P-256 / HKDF-SHA256 / AES-256-GCM），Rust `hpke` 与浏览器 `@hpke/core`（WebCrypto）互操作。设备持久 P-256 身份签名密钥仅保存于设备；短期 HPKE 公钥由该身份签名并附期限。浏览器固定身份公钥，拒绝已固定身份变化／已支持加密设备的静默降级；短期解密密钥轮换后丢弃，避免持久身份私钥单独解开历史数据。

HTTP 使用独立 HPKE 上下文和 exporter 派生的响应密钥，绑定版本、请求 ID、method/path 等路由元数据。独立上下文允许并发响应乱序，不共用有序 nonce。WebSocket 建立一次通道后使用 exporter 派生的双向 AES-GCM 密钥及独立递增序号，逐帧防重放，按键和流式消息不重复 DH。

Service Worker 覆盖图片、原始文件、下载等浏览器直接请求；普通 fetch 与 WebSocket 也通过同一协议实现。Relay 只保留鉴权所需的路由／资源 ID，私有正文和二进制内容保持密文。Hosted 隔离的响应过滤前移到加密前，保留已有授权边界；公开链接改由浏览器主动发布投影后的快照。

首版性能验证比较相同大小内容的明文／密文请求及连续终端帧，记录首次密钥获取、后续请求耗时和字节开销；只在握手、逐请求 HPKE 与批量 AES 代价可接受时交付。


## 最终实施与验收记录（2026-09-06）

- S1–S3 完成：设备 token 一次显示／轮换、独立持久 secret、OAuth 单次 state＋PKCE、有限队列／并发／限流、安全审计补齐。账户和管理员均可配置 TOTP、恢复码及 Passkey；撤销信任同时撤销关联会话；恢复码不产生隐式信任。
- S4 完成：身份签名增加浏览器随机挑战；HTTP query 一并加密；1 MiB 有权限范围的拉取分片支持大文件；Hosted 过滤前移；共享 shell 校验只传递最小 ID 集合。新增设备状态／指纹 UI 和只读 `relay-fingerprint` CLI。异常重启后刷新临时密钥可恢复，身份改变必须显式核验。
- Rust 固定发布工具链：`cargo +1.89.0 test --workspace --locked`，211 项通过；debug／release CLI 构建通过。
- Web：类型检查与生产构建通过，相关 Vitest 22 项通过。桌面／移动 MFA 页面截图已检查，无布局溢出。
- 聚焦 E2E：真实隔离 relay＋fake supervisor；desktop-chromium 安全边界、MFA、公开分享通过；优化构建的加密／分片／图片／terminal／公开快照／重启／身份改变用例在 desktop-chromium、mobile-chromium 和 iPhone WebKit 均通过。MFA 桌面与移动 Chrome 包括虚拟 Passkey、取消后重试、刷新挑战、OTP 重放、恢复码单次使用、可信浏览器撤销和管理员设置。
- 依赖：生产 npm audit 0 已知漏洞；cargo-audit 0 已知漏洞／0 warning（更新 yanked 的未激活锁文件依赖 chacha20 至 0.10.2）。这不是“未来无漏洞”或独立密码学审计的承诺。
- 优化构建本机基准：1 MiB 相同文件，交替运行并预热后各 6 次，桌面 Chromium 中位数明文 3.9 ms、密文 13.1 ms（增加 9.2 ms）。3 MiB＋17 字节下载验证全部字节一致；WS 验证 terminal 明文未出现在 relay 帧中。不能将本机延迟外推为公网吞吐保证。
- 实现、迁移、备份、恢复、旧版本兼容及尚存的 relay 信任边界见 [运维说明](./relay-security-operations.zh.md)。隔离测试／性能／审计原始结果位于本地忽略目录 `.local/security-audit/`，不提交真实凭据或用户数据。
- 共享 UI 固定 SHA：`d3bcbfd1b8f984922aba637fbbee8878ba11d604`，无本次代码变化。root runtime/npm 版本保持 0.12.14，尚未发新版，不覆盖已发布资产。

- 四平台 dry-run 首轮发现 Windows Git Bash 的 Perl 缺少 OpenSSL 构建模块；已指定 runner 预装的原生 Strawberry Perl，并在编译前验证 IPC::Cmd。此修复只影响 runtime 构建，不变更 Device Manager。
