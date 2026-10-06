# 账号级消息快捷键

设置 → Preferences → Message shortcuts 提供两种模式；新账号默认沿用 Ctrl+Enter 发送。

| 模式 | 发送／运行中排队 | 换行 | 直接 steer |
| --- | --- | --- | --- |
| Ctrl+Enter to send（默认） | Ctrl+Enter | Enter（Shift+Enter 也可） | Ctrl+Shift+Enter |
| Enter to send | Enter | Shift+Enter | Ctrl+Enter |

macOS 上 Command 可代替 Ctrl。中文等输入法组合期间 Enter 不触发发送；持续按住快捷键不重复提交。Shell 保留原有按键行为。

此设置通过 `/relay/account/preferences` 的 GET/PATCH 存在 Relay 的 `relay_account_preferences` 中，以当前登录用户为唯一键。同账号的设备和浏览器共用，其他账号独立。页面打开、重新获得焦点或从后台返回时读取账号配置；保存失败会提示错误并保留上一次成功保存的模式。独立本地 Supervisor 页没有 Relay 账号时使用默认模式。

运行中的直接 steer 先按现有可靠流程保存消息，再根据该次提交的 `clientRequestId` 自动 steer 对应队列项。不会选择队列里其他消息；原 turn 已结束时保留正常投递。steer 失败或结果未确认时显示原因、保留已保存消息并清空草稿，避免重复提交。后端不支持 steer 时保留草稿并提示正常发送；空闲时 steer 快捷键等同发送新 turn。附件经过原有上传、持久化路径。

运行中 turn 顶部的 tok/s 使用整个 turn 的累计平均生成速度，底部继续显示最近一次已确认响应的速度。旧数据分别回退到累计平均和最近一分钟速度。两者都沿用实际输出 token 的统计，包括推理和工具参数；排除工具执行及用户等待，不用文本长度估算。没有已确认 token 用量时显示 `—`。

验证包含账号鉴权／跨会话同步／数据库重开、快捷键映射、状态刷新竞态、steer 投递确认，以及一条隔离 Relay、两台 fake Supervisor、两个浏览器的桌面 Chromium 链路。共享 UI 另验证同一运行 turn 顶部平均与底部近期速度独立显示。

结果：Rust 账号接口回归 1 项、Web 回归 8 项、共享 UI 回归 40 项、桌面 Chromium 专项 1 项通过；Rust 格式／编译、两份 UI 的类型检查、共享包和 Web 构建通过。生产账号偏好未修改，运行中的设备 Supervisor 不需要为这两项 Web 功能升级。

Watch 次数和费用统计另见 [Watch 摘要](watch-statistics.md)，该项需要设备 Supervisor 升级到 0.12.62。
