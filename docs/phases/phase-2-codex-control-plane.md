# Phase 2：Codex 主控制面接入

## 1. 阶段目标

接入本地 `codex app-server`，建立 supervisor 与 Codex 的稳定控制链路，使系统具备 thread 生命周期管理、turn 启动与中断、事件流转发和基础 agent pane 的能力。

## 2. 前置条件

- Phase 1 已通过。
- 本机已可正常执行 `codex app-server`。
- 已明确第一版默认使用 `approval_mode = yolo`。

## 3. 本阶段需要开发什么

### 3.1 App Server 进程管理

需要实现 supervisor 对 `codex app-server` 的本地托管能力：

- 拉起进程
- 监控退出码
- 异常重启策略
- 启动超时与失败处理
- stdout/stderr 日志采集

必须区分两类失败：

- app-server 自身无法启动
- app-server 已启动但 JSON-RPC 握手失败

### 3.2 JSON-RPC 客户端

需要建立类型化的 JSON-RPC 客户端层，至少覆盖：

- 请求 ID 管理
- 超时控制
- 错误映射
- 事件订阅
- 断线恢复后的重新连接逻辑

### 3.3 Thread 生命周期服务

需要实现以下能力：

- `thread/list`
- `thread/start`
- `thread/read`
- `thread/resume`
- `thread/loaded/list`

本地还需要补齐 supervisor 自己的映射与缓存：

- workspace 与 thread 的关联
- thread 标题与更新时间
- thread 状态同步
- pinned 标记预留字段

### 3.4 Turn 生命周期服务

需要实现：

- 发起 prompt
- 启动 turn
- 中断 turn
- turn 状态落库
- turn 结果与错误事件转发

需要特别处理：

- 用户重复点击发送
- turn 尚未结束时再次发起新 turn
- turn 被中断后的 UI 状态回收

### 3.5 Agent 输出事件流

需要把 App Server 的事件流转为 supervisor 可消费的统一事件模型：

- `thread.updated`
- `thread.turn.started`
- `thread.output.delta`
- `thread.turn.completed`
- `thread.turn.failed`

目标是保证 Web UI 无需直接理解底层 App Server 原始事件结构。

### 3.6 基础 Agent Pane

需要实现一个最小可用的 agent pane：

- thread 列表
- thread 详情
- 历史 turn 基础展示
- prompt 输入框
- 发送按钮
- 停止当前 turn 按钮
- turn 状态显示

### 3.7 状态一致性与恢复

需要设计并实现以下恢复策略：

- supervisor 重启后从数据库恢复 thread 元数据
- 对需要继续操作的 thread 执行惰性 `thread/resume`
- 如果 App Server 临时异常，前端能够看到明确状态而不是静默失联

## 4. 本阶段交付物

- 受 supervisor 控制的 `codex app-server` 进程管理器
- 类型化 JSON-RPC 客户端
- thread / turn 服务
- App Server 事件到前端事件的统一转换层
- 基础 agent pane 页面
- thread 状态持久化与恢复机制

## 5. 验收标准

满足以下条件才可视为 Phase 2 完成：

1. 用户可以在网页中创建一个新的 Codex thread。
2. 用户可以查看已有 thread 列表并恢复指定 thread。
3. 用户可以在网页中向指定 thread 发送 prompt，并实时看到输出增量。
4. 用户可以中断正在执行的 turn，且 UI 状态、数据库状态与实际运行状态一致。
5. supervisor 重启后，历史 thread 元数据仍然可见，且可以继续恢复使用。
6. App Server 启动失败、连接失败、调用失败三类异常都有明确可见反馈。

## 6. 如何验收

建议按以下顺序验收：

1. 进程链路验收
   - 由 supervisor 启动 `codex app-server`。
   - 人为制造错误配置，确认失败信息能被识别与展示。
2. thread 验收
   - 新建 thread。
   - 列出 thread。
   - 关闭前端后重新进入，确认列表仍存在。
   - 恢复一个历史 thread 并继续发送 prompt。
3. turn 验收
   - 发起一个简短 prompt。
   - 确认能看到流式输出。
   - 发起一个较长任务后执行 interrupt。
   - 确认状态从执行中回到可交互状态。
4. 重启恢复验收
   - 在已有 thread 数据情况下重启 supervisor。
   - 检查历史 thread 是否仍可见。
   - 继续恢复并发送新 turn。
5. UI 冒烟验收
   - 在桌面与手机宽度下各进行一次 thread 创建、发送 prompt、停止 turn 流程。

## 7. 如何检查

开发完成后，必须至少执行并记录以下检查：

- 运行 `pnpm lint`
- 运行 `pnpm typecheck`
- 运行 `pnpm test`
- 运行 `pnpm build`
- 执行一次真实 `codex app-server` 集成冒烟测试
- 执行一次 thread 创建与恢复测试
- 执行一次 turn interrupt 测试
- 执行一次 supervisor 重启恢复测试
- 检查数据库中 thread 状态与 UI 显示是否一致

## 8. Checklist

以下项目必须全部打钩，Phase 2 才算通过：

- [ ] 已实现由 supervisor 托管的 `codex app-server` 进程生命周期管理。
- [ ] 已实现 JSON-RPC 客户端的请求、超时、错误映射和事件订阅能力。
- [ ] 已接入 `thread/list`、`thread/start`、`thread/read`、`thread/resume`、`thread/loaded/list`。
- [ ] 已接入 turn 启动与 interrupt 能力，并完成服务层封装。
- [ ] 已建立 supervisor 内部 thread 状态模型，并可持久化到数据库。
- [ ] 已实现 App Server 原始事件到统一前端事件模型的转换层。
- [ ] 已实现基础 agent pane，至少支持 thread 列表、thread 详情、prompt 发送、turn 停止。
- [ ] 已处理 app-server 启动失败、连接失败、调用失败三类异常。
- [ ] 已处理重复发送 prompt、turn 执行中重复触发等状态竞争问题。
- [ ] 已实现 supervisor 重启后的 thread 元数据恢复与惰性 `thread/resume`。
- [ ] 已验证真实 `codex app-server` 场景下可以创建、恢复、读取 thread。
- [ ] 已验证真实场景下 turn 输出可流式展示且 interrupt 生效。
- [ ] 已验证桌面端和手机端的基础 agent 交互流程都可用。
- [ ] 已验证 `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build` 全部通过。
