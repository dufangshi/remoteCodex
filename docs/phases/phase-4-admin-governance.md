# Phase 4：管理界面与资源治理

## 1. 阶段目标

建立 thread / shell / workspace 的统一管理界面与治理策略，避免长期运行后资源失控，并让用户可以明确查看、终止、清理和保留关键会话。

## 2. 前置条件

- Phase 3 已通过。
- thread 与 shell 生命周期已稳定。
- 已确认资源限制基线：
  - 总 thread 数 `< 20`
  - 每个 workspace thread 数 `< 5`

## 3. 本阶段需要开发什么

### 3.1 管理后台数据聚合

需要实现一组管理视图聚合接口，至少能展示：

- workspace 总数
- thread 总数
- 活跃 thread 数
- shell 总数
- 活跃 shell 数
- stale shell 数
- pinned thread 数
- 最近失败事件

### 3.2 资源限制策略

需要实现可配置的 policy 模型，至少包括：

- 总 thread 数上限
- 每个 workspace 的 thread 上限
- shell 保留天数
- transcript 保留天数
- pinned thread 是否参与自动清理

策略必须支持：

- 默认值
- 管理页修改
- 持久化
- 生效前校验

### 3.3 管理页面能力

管理页至少需要支持以下动作：

- 查看全部 workspace
- 查看 workspace 下的 thread 与 shell
- 手动 terminate thread
- 手动 terminate shell
- 删除历史 thread / transcript
- pin / unpin thread
- 批量清理 stale shell
- 查看清理结果

### 3.4 自动清理作业

需要实现后台清理任务，至少处理：

- 长期未活动 shell
- 长期未活动 transcript
- 已失效但数据库仍保留的 shell 映射

必须具备：

- dry-run 模式
- 实际执行模式
- 执行日志
- 清理结果通知

### 3.5 风险控制

所有 destructive 操作都需要最少限度防误触：

- 明确二次确认
- 展示影响对象
- 区分 interrupt、terminate、delete 三类操作

### 3.6 治理可观测性

需要让用户能看见治理动作是否真实生效：

- policy 当前值
- 最近一次 cleanup 时间
- cleanup 扫描数量
- cleanup 删除数量
- cleanup 失败数量

## 4. 本阶段交付物

- 管理页与资源统计接口
- policy 持久化模型与配置 UI
- 手动治理动作接口
- 自动 cleanup 作业
- 清理日志与结果展示

## 5. 验收标准

满足以下条件才可视为 Phase 4 完成：

1. 用户可以在管理页查看全部 workspace / thread / shell 的当前状态。
2. 系统会在超过配额时拒绝新建 thread，并给出明确原因。
3. 用户可以手动 terminate 指定 thread 或 shell，且状态同步正确。
4. 自动清理策略可在 dry-run 与真实执行模式下工作，并有可见结果。
5. pinned thread 不会被默认自动清理。
6. 删除、终止、清理等高风险动作都有明确确认与结果反馈。

## 6. 如何验收

建议按以下顺序验收：

1. 统计面板验收
   - 创建多个 workspace、thread、shell。
   - 检查管理页统计数字是否准确。
2. 配额策略验收
   - 将上限设置为较小值。
   - 人为创建接近阈值的 thread。
   - 验证超限时被拒绝，并有明确提示。
3. 手动治理验收
   - 对某个 thread 执行 terminate。
   - 对某个 shell 执行 terminate。
   - 删除一个历史 thread 或 transcript。
4. 自动清理验收
   - 构造 stale shell / transcript 数据。
   - 先执行 dry-run。
   - 再执行真实 cleanup。
   - 验证 pinned thread 不受影响。
5. 风险控制验收
   - 检查 destructive 操作前的确认步骤。
   - 检查操作后是否有日志与通知。

## 7. 如何检查

开发完成后，必须至少执行并记录以下检查：

- 运行 `pnpm lint`
- 运行 `pnpm typecheck`
- 运行 `pnpm test`
- 运行 `pnpm build`
- 执行一次资源上限拦截测试
- 执行一次 terminate thread 测试
- 执行一次 terminate shell 测试
- 执行一次 cleanup dry-run 测试
- 执行一次 cleanup 实际执行测试
- 检查 pinned thread 未被自动删除
- 检查 policy 修改后重启服务仍然生效

## 8. Checklist

以下项目必须全部打钩，Phase 4 才算通过：

- [ ] 已实现管理页统计接口，并能展示 workspace、thread、shell 的核心数量与状态。
- [ ] 已实现 policy 数据模型，支持默认值、修改、持久化和加载。
- [ ] 已实现总 thread 上限与每 workspace thread 上限的拦截逻辑。
- [ ] 已实现 shell 保留天数、transcript 保留天数等清理策略配置。
- [ ] 已实现管理页的手动 terminate thread 能力。
- [ ] 已实现管理页的手动 terminate shell 能力。
- [ ] 已实现历史 thread / transcript 删除能力，并附带风险提示。
- [ ] 已实现 pin / unpin thread，并确保 pinned thread 默认不参与自动清理。
- [ ] 已实现 cleanup 作业的 dry-run 模式。
- [ ] 已实现 cleanup 作业的真实执行模式。
- [ ] 已实现 cleanup 结果日志、统计与通知展示。
- [ ] 已在高风险操作前提供明确确认与影响说明。
- [ ] 已验证策略修改后在服务重启后仍然保持一致。
- [ ] 已验证超限时新建 thread 会被拒绝且错误提示明确。
- [ ] 已验证 `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build` 全部通过。
