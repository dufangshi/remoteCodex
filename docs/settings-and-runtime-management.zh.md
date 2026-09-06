# 设置、身份验证与运行时管理（0.12.17）

## 用户体验

- 账号页以钥匙图标打开改密窗口。已开启任一种二步验证的账号，每次改密都需要新的认证证明；近期登录、可信浏览器和旧的验证状态不能跳过这一步。
- 手机顶栏为头像和操作按钮保留宽度，长标题自行截断。Session 信息在手机视口内换行；设置窗口只有一个纵向滚动容器。移除侧栏重复的工作区头像、名称和内部 ID。
- 模型价格右上角使用加号，新增和编辑均在浮层完成。嵌套浮层复用线程 UI 的 Dialog，实现焦点约束和 Escape 关闭。
- Composer 菜单增加轻微透明背景与模糊；模型菜单底部同时展示上下文已用、上限、剩余量和百分比（数据缺失时沿用明确的不可用状态）。更早消息入口改为轻量上箭头，保留每次 3 turn 的加载逻辑，并遵循 reduced-motion 偏好。

## Supervisor 更新

设置显示运行中的版本，另行区分磁盘安装版本与 npm latest。仅来源明确的全局 npm launcher 提供更新；源码检出及其他安装方式保留原因说明。

1. 后端持有维护锁，阻止新 turn 与并发 harness 维护；运行中的 turn 不会被这个操作终止。
2. 获取 npm latest 并固定目标版本。把更新器复制到数据库旁的私有 updates 目录，交由操作系统启动：macOS launchd、Linux systemd 用户服务、Windows WMI 独立进程。
3. 先备份旧 launcher 包，使用原安装 prefix 安装目标版本。通过 launcher 的 native-path 下载并校验平台二进制，然后验证其版本。至此旧服务仍在运行。
4. 重新确认旧 PID 和活动 turn 数，只停止该 PID。通过正常 launcher start 入口启动，保留配置、工作目录和本地监听地址/端口。
5. 验证新进程的 healthz 版本/PID；relay 模式同时检查新的连接日志。失败时恢复旧包和原二进制。旧进程拒绝退出时不强杀，也不创建重复服务。
6. 状态持久化，浏览器断连后继续轮询。调度超时或后台 worker 意外退出会释放维护锁并报告失败，便于查看日志后重试。

更新脚本和携带环境的 plan 文件权限为 0600，目录为 0700；正常完成或处理失败后删除 plan。更新器日志不记录环境变量或登录凭据。

首次需要通过现有安装方式升级到包含本管理 API 和 launcher 的版本。旧 Supervisor 不会因为公网 Web 更新而自动被替换。此次验证不更新或重启当前真实 Supervisor。

## Harness 维护

列表分别展示 base harness 与 ACP adapter 的版本、选中路径、真实路径和安装来源。其他 ACP agents 可以展开。Restart 只关闭本 Supervisor 持有的对应 harness 进程及其子进程，清除能力缓存；下一轮用原 session ID 恢复并重新读取配置。其他 harness 不受影响；对应 harness 忙碌时返回冲突。

更新按选中可执行文件定位：

| 来源 | 更新目标 |
| --- | --- |
| npm | 白名单包名、实际全局 prefix；Windows shim 解析到其引用的包，显式 `--prefix`，不更新另一份 PATH 安装 |
| Homebrew | 从 Cellar/Caskroom 识别所属 brew 前缀与 formula/cask，仅升级该项 |
| Claude 原生安装 | 确认标准 versions 路径后调用该入口的 update |
| 桌面 App 内置、手动安装或来源不明 | 展示版本/路径及说明，不猜测包管理器 |

管理请求仅允许设备所有者通过 relay 访问，已有 thread/workspace 分享权限不授予安装或重启权限。更新命令使用参数数组执行，不拼接到 shell。

安装方式参考：[Homebrew 命令文档](https://docs.brew.sh/Manpage)、[Codex cask](https://formulae.brew.sh/cask/codex)、[Claude Code 安装与更新说明](https://support.claude.com/en/articles/14554922-claude-code-user-faq)。Linux 独立更新要求可用的 systemd 用户会话；不满足时明确失败。Windows 和 Linux 独立调度路径需对应平台的运行环境，macOS 已用临时任务验证发起进程死亡后仍继续执行。

## 验证范围

- Rust 工作区 220 项通过：一次性且绑定会话的改密证明；分享权限隔离；npm/Homebrew/shim 来源匹配；ACP 重启后读取新配置并恢复原 session。
- launcher/发布脚本与更新器 15 项通过：下载失败保留旧服务、启动失败回滚、新 turn 阻止更新、拒绝退出不创建重复服务、遗留任务释放锁，以及 launchd worker 脱离发起进程存活。
- 共享 UI 相关组件测试 19 项通过。
- Playwright 专项：手机和桌面的 Session 浮层、上下文菜单、设置滚动、嵌套价格编辑、harness 操作、头像边界；隔离 relay 的 authenticator/passkey 登录及改密二步验证链路。
- 更新逻辑用临时文件和模拟进程检查，未在当前生产 Supervisor 上执行破坏连接的升级测试。

共享 UI 固定提交：`780ad4a2861c29fb76b9df8a70d200967cb9c185`。CSS 也内嵌在共享包 JS 中，因此本次一并重建并核对浏览器计算样式；不能只更新外部 CSS。

本地最终检查：Rust 220 项、launcher/发布脚本 15 项、相关共享 UI 组件 19 项，以及 3 条专项浏览器链路通过（设置分别覆盖手机/桌面，完整 MFA 链路覆盖手机）。浏览器测试使用 `E2E_API_PORT=18787 E2E_WEB_PORT=15173`，避开本机 Docker 占用的默认端口。TypeScript 检查、共享 UI 构建通过。测试不会替换本机实际 Supervisor。

## 发布结果（2026-09-06）

- 本地检查与源码收敛于 15:46:22（America/Toronto）完成，runtime 固定提交 `174a2c6339bf24f72475ee69b4bb5ef94de83d99`；共享 UI 为上述 `780ad4a`。
- [runtime/npm 发布](https://github.com/dufangshi/remoteCodex/actions/runs/34055961187)成功，总耗时 5m06s。Web 40s、测试 1m；Linux x64 2m08s、Linux arm64 2m10s、macOS arm64 2m29s、Windows x64 3m53s 并行执行；包组装 16s、GitHub 资产发布 11s、npm 发布 31s。
- [公网 relay 部署](https://github.com/dufangshi/remoteCodex/actions/runs/34055962516)成功，总耗时 2m43s。native 2m04s 与 Web 40s 并行，部署 31s。`remote.lnz-study.com` 已返回新资源，确认管理 API 入口、改密验证、上下文详情、菜单半透明和头像/卡片 CSS 已包含在公网产物中。
- [main 平台兼容性检查](https://github.com/dufangshi/remoteCodex/actions/runs/34055939668)成功。
- 15:54 最终核验：npm `latest=0.12.17`；实际下载 launcher tarball，SHA-512 与 npm integrity 一致，含独立更新器和 Web；四平台 native manifest 的 SHA-256 与 GitHub 发布资产一致。[版本页](https://github.com/dufangshi/remoteCodex/releases/tag/v0.12.17)指向固定 runtime 提交。
- 公网 healthz 为 ok，已有 5 台 Supervisor 连接；匿名安全设置请求返回 401。当前真实设备 Supervisor 未升级、未重启。Windows Device Manager 版本未变。
