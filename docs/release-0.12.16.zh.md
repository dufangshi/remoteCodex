# 0.12.16 发布记录

范围：合并 `security/relay-auth-encryption` 与远端 main `eeca4572`。包含 relay 安全修复、Authenticator/Passkey/恢复码/可信浏览器管理、密文转发，以及 main 的 Codex effort 恢复、skill 命令过滤和可操作的 fork 错误提示。

共享 UI 固定提交：`4523453e69482d603fdf9dceabfd43407bfc240c`。Windows Device Manager 不变。

发布前检查：

- Rust 1.89：215 项 workspace 测试通过；CLI 构建通过。
- Web 类型检查、构建、22 项相关 Vitest 通过。
- 桌面／移动 Chromium：MFA 管理、加密、slash/fork、composer 共 14 条相关用例通过。
- 管理操作实际验证：验证器启用／关闭，Passkey 添加／重命名／删除，恢复码下载／重生成，可信浏览器 UI 撤销；管理员账户的独立 Security 页面通过。已检查移动端完整管理页面截图。
- relay-deploy 增加切换服务前的 session secret 长度／HTTPS origin 预检，以及停止写入后的一致性 SQLite 和 secret/config root-only 备份。actionlint 通过。

发布使用 `npm-release.yml channel=latest` 和公网 `relay-deploy.yml`，均固定上述 UI SHA。实际结果在完成后补记。[迁移与恢复](./relay-security-operations.zh.md)仍适用。

上线连通性核验补充：旧 supervisor 使用 URL 设备 token 握手，新 Origin 中间件曾提前拒绝该原生连接。已仅为 `/supervisor/tunnel` 保留无 Origin 的原生入口，后续设备 token 哈希鉴权仍必需；浏览器 Origin／跨站检查不放宽。新增旧握手成功、无效 token 401、恶意 Origin 403 回归通过，完整 Rust 测试重新通过。首次 npm run 在发布前取消，最终版本从兼容修复后的提交重建，不覆盖已发布资产。
