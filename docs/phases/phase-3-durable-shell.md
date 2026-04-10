# Phase 3：独立 Shell、会话导入与 Durable Terminal

## 1. 阶段目标

把 supervisor 从“只能管理自己创建的 thread”推进到“能够统一管理本机已有 agent 工作状态”：

- 为 thread 提供独立、持久、可重连的 shell
- 但 shell 改为用户显式创建，不再在创建 thread 时自动生成
- 支持通过本机已有的 Codex `session id` 导入历史 session
- 导入时自动发现对应 workspace 目录，并复用或创建 workspace
- 确保手机断线、切后台、切网络后，shell 与 thread 不会丢失
- 确保导入的历史 session 在 supervisor 中可见、可恢复、可继续

## 2. 前置条件

- Phase 2 已通过。
- 目标环境已安装 `tmux`。
- supervisor 与被导入的 Codex session 运行在同一台主机上。
- supervisor 可读取本机 Codex 状态目录，例如 `~/.codex`。
- 已确认一条 thread 最多绑定一条 durable shell，但 thread 可以没有 shell。

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

- 在用户显式点击 `Create Shell` 时创建 shell
- 记录 shell 与 thread、workspace 的映射
- 跟踪 shell 状态与最近活动时间
- 在 shell 退出时更新数据库状态
- 拒绝对同一 thread 重复创建多个 durable shell

本阶段不再采用“创建 thread 时自动创建 shell”的规则。

### 3.3 PTY / WebSocket Bridge

需要把 shell 输出桥接到 Web UI：

- shell 输出流转发
- 前端输入转发
- attach / detach 生命周期处理
- 心跳与断线检测

必须做到：

- viewer 断开不会销毁 shell
- viewer 重连后能继续看到已有 shell
- shell 未创建、已退出、未找到三种情况可以明确区分

### 3.4 Shell UI

需要实现 shell 作为主工作区能力的一部分，至少包括：

- 全屏 shell 视图
- 当前 thread 信息栏
- attach 状态显示
- 网络断线重连提示
- shell 未创建、未就绪、已退出、未找到提示
- `Create Shell` / `Connect Shell` / `Reconnect Shell` 入口

### 3.5 本机已有 Codex Session 导入

本阶段需要新增“导入本机已有 Codex session”的能力，至少包括：

- 用户输入 `session id`
- supervisor 在本机 Codex 状态中查找该 session
- 优先从本机状态数据库读取 `cwd`、标题、session 元信息
- 必要时 fallback 到本地 session transcript，例如 `rollout-*.jsonl`
- 从 session 元信息中恢复对应 workspace 路径
- 检查该 session 是否已被 supervisor 导入过，避免重复导入

导入能力的边界必须明确：

- 只保证导入当前这台主机上、当前本机 Codex 状态仍保留的 session
- 不承诺仅凭 `session id` 恢复另一台机器上的 session

### 3.6 Workspace 自动匹配与默认命名

当通过已有 Codex session 导入时，必须实现：

- 用恢复出的绝对路径匹配现有 workspace
- 如果该路径已存在于 supervisor，直接复用对应 workspace
- 如果该路径尚不存在，则创建新的 workspace

当需要新建 workspace 时：

- 默认名称使用路径最后一级目录名
- 例如 `/Users/fonsh/Desktop/UoftCourse/writer` 默认命名为 `writer`
- 用户后续仍可修改该名称

这个“默认使用路径最后一级目录名”的规则，也需要同步应用到正常的 workspace 创建流程，以保持产品行为一致。

### 3.7 导入后的 Thread 行为规则

导入本机已有 Codex session 后，需要实现并固定以下规则：

- 导入时先创建一个 imported thread，并落库保存其 `codex_session_id`
- 导入完成后，历史消息可以立即查看
- 但继续发送新的 prompt 前，用户必须手动点击 `Resume / Connect`
- 导入本身不应隐式触发一次自动 resume
- 如果对应 workspace 路径不存在，应当明确提示路径缺失状态
- 同一个 `codex_session_id` 不应被重复导入成多个 thread

### 3.8 与 Thread 的联动规则

需要实现并固定以下规则：

- 创建 thread 时不自动创建 shell
- shell 仅在用户显式操作时创建
- 恢复历史 thread 时不强制自动 attach shell
- thread 完成后 shell 默认保留
- viewer 切后台只做 detach，不终止 shell
- imported thread 在用户手动 `Resume / Connect` 前，应保持为“可查看历史、不可继续执行”的状态

### 3.9 断线恢复与 supervisor 重启恢复

需要实现两类恢复：

1. 浏览器断线恢复
   - 前端重连后自动重新 attach 已连接的 shell
   - shell 输出继续流动
   - imported thread 的已导入历史仍可见
2. supervisor 重启恢复
   - 从数据库恢复 shell 记录
   - 重新扫描现存 `tmux` session
   - 修正数据库与实际 `tmux` 状态差异
   - 保留 imported thread 与 `codex_session_id` 的绑定关系

### 3.10 只读 tree 与 shell / imported thread 联动

在本阶段需要把 shell、workspace tree、thread 切换放在同一主工作区中，至少实现：

- tree 选择文件或目录时在 shell UI 中体现当前位置
- 可在同一 workspace 下切换不同 thread
- 可区分 thread 是否已有 shell、是否为 imported thread
- 保持 tree 仍为只读，不引入文件编辑器

## 4. 本阶段交付物

- 可复用的 `tmux` 封装模块
- `ShellSession` 服务与持久化模型
- shell WebSocket bridge
- shell 主视图 UI
- 本机已有 Codex session 导入能力
- session id 到 workspace 路径的恢复逻辑
- workspace 自动匹配与默认命名规则实现
- imported thread 与 shell 的绑定规则实现
- 断线恢复与 supervisor 重启恢复能力

## 5. 验收标准

满足以下条件才可视为 Phase 3 完成：

1. 创建新 thread 时不会自动生成 shell。
2. 用户可以显式为某条 thread 创建、连接、重连其 durable shell。
3. 手机浏览器断网、刷新、切后台后重新进入，原 shell 仍存在并可继续使用。
4. shell 中运行的长任务在 viewer 断开期间不会被终止。
5. supervisor 重启后，未失效的 `tmux` session 能够重新被发现并重新关联。
6. 用户输入本机已有 Codex `session id` 后，supervisor 能恢复出对应 `cwd`。
7. 若该 `cwd` 对应 workspace 已存在，则能够在其下创建 imported thread；若不存在，则能够先创建 workspace 再导入 thread。
8. 新建 workspace 时，如用户未手动填写名称，默认采用路径最后一级目录名。
9. imported thread 导入后可查看历史，但在手动点击 `Resume / Connect` 前不会自动继续执行。
10. 用户可以明确区分 viewer 已断开、shell 已退出、shell 未找到、workspace 路径缺失这几种状态。

## 6. 如何验收

建议按以下顺序验收：

1. shell 显式创建验收
   - 新建 thread。
   - 检查不会自动生成 `tmux` session。
   - 手动点击 `Create Shell`。
   - 检查是否创建 `tmux` session 与数据库 shell 记录。
2. shell 输入输出验收
   - 在网页 shell 中执行简单命令。
   - 验证回显正常、输出连续、无明显卡顿。
3. 本机已有 session 导入验收
   - 准备一个本机已存在的 Codex `session id`。
   - 输入 `session id` 进行导入。
   - 检查是否正确恢复 `cwd` 并显示历史。
4. workspace 匹配与默认命名验收
   - 分别测试：
     - 目标路径已存在对应 workspace
     - 目标路径不存在对应 workspace
   - 检查新建 workspace 时默认名称是否为路径最后一级目录名。
5. imported thread 手动恢复验收
   - 导入后确认历史可见。
   - 确认在点击 `Resume / Connect` 前不会自动续跑。
   - 手动点击后，验证可以继续发送 prompt。
6. 弱网与断线验收
   - 手动断开浏览器连接。
   - 重新打开页面并确认 shell 状态仍然存在。
   - 在 shell 中预先运行一个长任务，确认断线期间任务未中断。
7. supervisor 重启验收
   - 保持 `tmux` session 运行。
   - 重启 supervisor。
   - 检查 shell 记录是否被正确恢复与重新 attach。
   - 检查 imported thread 与其 `codex_session_id` 绑定是否仍然存在。
8. 状态识别验收
   - 分别模拟 viewer 断开、shell 退出、`tmux` 不存在、workspace 路径缺失四种情况。
   - 检查 UI 提示是否准确。

## 7. 如何检查

开发完成后，必须至少执行并记录以下检查：

- 运行 `pnpm lint`
- 运行 `pnpm typecheck`
- 运行 `pnpm test`
- 运行 `pnpm build`
- 执行一次 thread 手动创建 shell 的集成测试
- 执行一次 shell attach / detach 测试
- 执行一次浏览器断线重连测试
- 执行一次长任务不中断测试
- 执行一次 supervisor 重启后 shell 恢复测试
- 执行一次通过 `session id` 导入本机已有 Codex session 的测试
- 执行一次“已存在 workspace”导入测试
- 执行一次“未存在 workspace，自动用路径最后一级命名创建 workspace”测试
- 执行一次 imported thread 必须手动 `Resume / Connect` 后才能继续的测试
- 执行一次重复导入同一 `codex_session_id` 的防重测试
- 核对数据库 shell 状态、`tmux` 实际状态、workspace 状态与 UI 状态四者一致

## 8. Checklist

以下项目必须全部打钩，Phase 3 才算通过：

- [ ] 已实现 `tmux` 的创建、查询、输入、输出、终止、状态检查封装。
- [ ] 已建立稳定的 `tmux session name` 命名规则，可从 thread 唯一推导。
- [ ] 已实现 `ShellSession` 服务，并持久化 thread、workspace、`tmux session` 的映射。
- [ ] 已将 shell 创建规则改为“用户显式创建”，而不是创建 thread 时自动创建。
- [ ] 已实现 shell 输出到 WebSocket、前端输入到 shell 的双向桥接。
- [ ] 已实现 viewer detach 不影响 shell 存活的生命周期规则。
- [ ] 已实现浏览器断线重连后的自动恢复或显式恢复能力。
- [ ] 已实现 supervisor 重启后扫描并恢复既有 `tmux session` 的能力。
- [x] 已实现通过本机 Codex `session id` 恢复 `cwd` 与 session 元信息的能力。
- [x] 已实现 imported thread 的持久化模型，并保存 `codex_session_id` 绑定关系。
- [x] 已实现 supervisor 对现有 workspace 的路径匹配逻辑。
- [x] 已实现当 workspace 不存在时，按路径最后一级目录名默认创建 workspace 的逻辑。
- [x] 已将“路径最后一级目录名作为默认 workspace 名称”的规则同步到正常 workspace 创建流程。
- [x] 已实现 imported thread 导入后仅查看历史、不自动 resume 的规则。
- [x] 已实现继续发送新 prompt 前必须手动 `Resume / Connect` 的规则。
- [x] 已实现对重复导入同一 `codex_session_id` 的防重处理。
- [ ] 已明确区分并展示 viewer 断连、shell 退出、shell 未找到、workspace 路径缺失等状态。
- [ ] 已在 UI 中提供稳定可用的 shell 主视图。
- [ ] 已保留只读 tree，并与 shell 所属 workspace、imported thread 所属 workspace 正确联动。
- [ ] 已验证长任务在 viewer 断线期间不会被终止。
- [ ] 已验证历史 thread 可重新接入其对应 shell。
- [ ] 已验证本机已有 Codex session 可被正确导入并继续。
- [ ] 已验证 `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build` 全部通过。
