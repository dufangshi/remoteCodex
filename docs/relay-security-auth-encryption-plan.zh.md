# Relay 安全、低打扰二步验证与密文转发实施计划

状态：实施中。起点：main `5dd2acc5`，共享 UI main `d3bcbfd`。分支：`security/relay-auth-encryption`（两个仓库）。

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

- [ ] Supervisor 内部转发改为不可由 HTTP 请求伪造的进程内授权。
- [ ] 附件归属与真实图片校验，阻断 thread 图片接口读取非附件文件；保留既有合法历史图片。
- [ ] 隔离原始 HTML／SVG，防止主站同源脚本；保留下载与正常文件预览。
- [ ] WS 按消息类型、thread／shell 归属逐次授权；陌生 Origin 拒绝；撤销／禁用／到期断开。
- [ ] 服务端可撤销会话、安全 Cookie／CSRF、移除 Web 长期 localStorage bearer，兼容明确的原生认证。
- [ ] 设备 token 哈希存储、一次显示与轮换、隧道 Authorization；独立持久随机 session secret。
- [ ] OAuth browser-bound 单次 state＋PKCE；限流、有限队列／并发和必要审计。
- [ ] 隔离回归确认所有审查复现被阻断且正常访问通过。

### S2 TOTP、恢复码与可信浏览器

- [ ] 持久化迁移、加密保存 TOTP、单次挑战、尝试限制、防重放。
- [ ] enrollment／verify／disable／recovery regenerate，强验证保护变更。
- [ ] trusted browser 30 天、环境绑定、主动撤销；session 列表及撤销。
- [ ] 统一账户 Security UI，QR、复制、恢复码下载、登录挑战与异常恢复。
- [ ] 验证新环境必需 OTP、可信环境免 OTP、改密／撤销后失效、旧码重放被拒绝。

### S3 Passkey

- [ ] 成熟服务端 WebAuthn 库，固定 RP ID／origin，挑战只存在服务端并绑定账户／会话。
- [ ] 注册、命名、删除、认证，支持不同设备和备份凭据，防止删除最后恢复途径。
- [ ] 浏览器原生凭据 API，取消可无损回退验证码；虚拟 authenticator 端到端测试。

### S4 密文传输与兼容

- [ ] 定义有版本的数据协议，成熟算法／库，设备持久私钥、客户端公钥固定、会话密钥协商、防篡改／重放。
- [ ] 私有 HTTP 数据、附件、WebSocket agent／terminal 事件双向加密；授权路由元数据与密文绑定。
- [ ] 复用连接／会话密钥，流式分片、有界队列；不为每条 token／按键做非对称运算。
- [ ] 新旧版本协商明确展示连接安全状态，不静默将已要求密文的连接降级为明文。
- [ ] 分享快照在客户端投影后显式发布；导出、本地模式与非加密旧设备兼容策略记录。
- [ ] Rust／Web 互操作、篡改／重放／重连、二进制及性能测试；记录同样负载的明文／密文耗时与字节开销。

### S5 集成与交付

- [ ] 修改 crates 后 cargo test --workspace；相关 Vitest、Web 类型检查与构建。
- [ ] 按 focused-e2e 技能只跑安全／登录／分享／加密相关 spec 和明确 browser project；桌面与移动覆盖有不同交互的流程。
- [ ] 更新 docs 的完成状态、实际协议／迁移、运维恢复和验证结果；每阶段提交两个仓库的相关变更。
- [ ] 分支推送，保持 main 未合并；部署前固定 runtime／UI SHA，按 release-runtime 完整四平台发布策略处理。用户本次要求新分支推进，不自动把未验收分支替换 main。

## 验证原则

使用隔离 relay＋supervisor、假 harness、合成文件及浏览器虚拟认证器；不读取真实秘密、不攻击公网、不改变正在执行任务的 supervisor。安全结论区分已验证、协议约束和仍存在的信任边界。性能不以跳过鉴权／加密或无界缓冲换取。

## 资料

- OWASP Authentication / Session Management / WebSocket Security Cheat Sheets。
- WebAuthn server：https://docs.rs/webauthn-rs/latest/webauthn_rs/
- TOTP：https://docs.rs/totp-rs/latest/totp_rs/
- 具体加密协议选型与测试向量在 S4 开始前写入本文件，不自创密码学算法。

## 实施记录

- 初始化：同步检查 main，建立两个工作分支；将用户范围、低打扰登录和验收项写入本计划。
