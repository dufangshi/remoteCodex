# Phase 3：独立 Shell 与 Durable Terminal

## 1. 阶段目标

为每个 Codex thread 建立独立、持久、可重连的 shell 会话，确保手机断线、切后台、切网络后，shell 与 thread 不会丢失，并支持手动接管与长期任务运行。

## 2. 前置条件

- Phase 2 已通过。
- 目标环境已安装 `tmux`。
- 已确认“一条 thread 对应一条 shell session”的约束。

## 3. 本阶段需要开发什么

### 3.1 tmux Manager

需要实现对 `tmux` 的封装层，至少包括：

- 创建 session
- 查询 session
- attach / detach
- 发送输入
- 捕获输出
- 终止 session
- 检查 session 存活状态

session 命名规则必须稳定，可从 thread ID 推导。

### 3.2 Shell Session 服务

需要建立 `ShellSession` 服务层，负责：

- 在 thread 创建时自动创建 shell
- 记录 shell 与 thread、workspace 的映射
- 跟踪 shell 状态与最近活动时间
- 在 shell 退出时更新数据库状态

### 3.3 PTY / WebSocket Bridge

需要把 shell 输出桥接到 Web UI：

- shell 输出流转发
- 前端输入转发
- attach / detach 生命周期处理
- 心跳与断线检测

必须做到：

- viewer 断开不会销毁 shell
- viewer 重连后能继续看到已有 shell

### 3.4 Shell UI

需要实现 shell 作为首页主视图的最小版本：

- 全屏 shell 视图
- 当前 thread 信息栏
- attach 状态显示
- 网络断线重连提示
- shell 未就绪或已退出提示

### 3.5 与 Thread 的联动规则

需要实现并固定以下规则：

- 创建 thread 时自动创建 shell
- 恢复历史 thread 时不强制自动 attach shell
- thread 完成后 shell 默认保留
- viewer 切后台只做 detach，不终止 shell

### 3.6 断线恢复与 supervisor 重启恢复

需要实现两类恢复：

1. 浏览器断线恢复
   - 前端重连后自动重新 attach
   - shell 输出继续流动
2. supervisor 重启恢复
   - 从数据库恢复 shell 记录
   - 重新扫描现存 tmux session
   - 修正数据库与实际 tmux 状态差异

### 3.7 只读 tree 与 shell 联动

在本阶段需要把 shell 和 workspace tree 放在同一主工作区中，至少实现：

- tree 选择文件或目录时在 shell UI 中体现当前位置
- 可在同一 workspace 下切换不同 thread 的 shell
- 保持 tree 仍为只读，不引入文件编辑器

## 4. 本阶段交付物

- 可复用的 `tmux` 封装模块
- `ShellSession` 服务与持久化模型
- shell WebSocket bridge
- shell 首页 UI
- 断线恢复与 supervisor 重启恢复能力
- thread 与 shell 的绑定规则实现

## 5. 验收标准

满足以下条件才可视为 Phase 3 完成：

1. 每次创建新 thread 时都会自动生成一个独立 shell。
2. 手机浏览器断网、刷新、切后台后重新进入，原 shell 仍存在并可继续使用。
3. shell 中运行的长任务在 viewer 断开期间不会被终止。
4. supervisor 重启后，未失效的 tmux session 能够重新被发现并重新关联。
5. 用户可以明确区分 shell 已断连、shell 已退出、viewer 已断开这三种状态。

## 6. 如何验收

建议按以下顺序验收：

1. 创建联动验收
   - 新建 thread。
   - 检查是否自动创建 tmux session 与数据库 shell 记录。
2. shell 输入输出验收
   - 在网页 shell 中执行简单命令。
   - 验证回显正常、输出连续、无明显卡顿。
3. 弱网与断线验收
   - 手动断开浏览器连接。
   - 重新打开页面并确认 shell 状态仍然存在。
   - 在 shell 中预先运行一个长任务，确认断线期间任务未中断。
4. supervisor 重启验收
   - 保持 tmux session 运行。
   - 重启 supervisor。
   - 检查 shell 记录是否被正确恢复与重新 attach。
5. 状态识别验收
   - 分别模拟 viewer 断开、shell 退出、tmux 不存在三种情况。
   - 检查 UI 提示是否准确。

## 7. 如何检查

开发完成后，必须至少执行并记录以下检查：

- 运行 `pnpm lint`
- 运行 `pnpm typecheck`
- 运行 `pnpm test`
- 运行 `pnpm build`
- 执行一次 thread 自动创建 shell 的集成测试
- 执行一次 shell attach / detach 测试
- 执行一次浏览器断线重连测试
- 执行一次长任务不中断测试
- 执行一次 supervisor 重启后 shell 恢复测试
- 核对数据库 shell 状态、tmux 实际状态与 UI 状态三者一致

## 8. Checklist

以下项目必须全部打钩，Phase 3 才算通过：

- [ ] 已实现 `tmux` 的创建、查询、输入、输出、终止、状态检查封装。
- [ ] 已建立稳定的 `tmux session name` 命名规则，可从 thread 唯一推导。
- [ ] 已实现 `ShellSession` 服务，并持久化 thread、workspace、tmux session 的映射。
- [ ] 已实现 thread 创建时自动创建 shell 的流程。
- [ ] 已实现 shell 输出到 WebSocket、前端输入到 shell 的双向桥接。
- [ ] 已实现 viewer detach 不影响 shell 存活的生命周期规则。
- [ ] 已实现浏览器断线重连后的自动恢复或显式恢复能力。
- [ ] 已实现 supervisor 重启后扫描并恢复既有 tmux session 的能力。
- [ ] 已明确区分并展示 viewer 断连、shell 退出、shell 未找到三类状态。
- [ ] 已在 UI 中提供稳定可用的 shell 主视图。
- [ ] 已保留只读 tree，并与 shell 所属 workspace 正确联动。
- [ ] 已验证长任务在 viewer 断线期间不会被终止。
- [ ] 已验证历史 thread 可重新接入其对应 shell。
- [ ] 已验证 `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build` 全部通过。
