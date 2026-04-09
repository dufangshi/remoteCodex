# Phase 5：交互补全与通知体系

## 1. 阶段目标

补齐 agent 交互闭环，使系统不仅能运行 thread 和 shell，还能正确处理 plan mode 问题、展示待处理状态、提供网页内通知，并为未来 guarded 模式审批保留清晰扩展点。

## 2. 前置条件

- Phase 4 已通过。
- thread、turn、shell、管理策略已经稳定。
- 已确认第一版通知范围以网页内通知为主。

## 3. 本阶段需要开发什么

### 3.1 plan mode 问题处理

需要接入并实现对 `tool/requestUserInput` 一类事件的处理链路：

- 识别待回答问题
- 在 UI 中高亮展示
- 支持用户提交回答
- 回答后回写到指定 thread / turn
- 回答完成后清除 pending 状态

至少需要覆盖：

- 1 到 3 个短问题
- 单次回答提交
- 超时或失效问题的提示

### 3.2 全局待处理提示

即使用户当前停留在 shell 首页，也必须知道有待处理事项：

- 顶部状态条
- badge 计数
- 可点击跳转到 agent pane
- 区分 question 与 approval 两类待处理任务

### 3.3 网页内通知中心

需要建立统一通知中心，覆盖至少以下事件：

- turn completed
- turn failed
- user input required
- approval required
- shell exited
- shell error
- cleanup completed

通知能力至少包括：

- 未读标记
- 已读/全部已读
- 时间排序
- 点击跳转目标 thread 或管理页

### 3.4 guarded 模式审批预留

虽然第一版默认 `yolo`，但本阶段必须把 guarded 模式的事件和 UI 占位补好：

- `item/fileChange/requestApproval`
- `item/commandExecution/requestApproval`

本阶段最低要求不是做完整审批流，而是做到：

- 事件能被识别
- UI 能展示待审批项
- 数据模型与前端状态结构可扩展

### 3.5 Agent Pane 完整化

需要把 Phase 2 的基础 agent pane 补到可用版本：

- 最近 turn 流完整展示
- pending question 展示与回答
- pending approval 占位展示
- prompt 输入与发送
- interrupt current turn
- thread 状态栏

### 3.6 事件一致性与去重

本阶段必须处理通知和待处理状态常见问题：

- 前端刷新后重复通知
- 同一事件多端订阅导致重复渲染
- 已失效 pending 状态未清理
- 已回答问题仍残留 badge

## 4. 本阶段交付物

- plan mode 问题处理链路
- 顶部全局状态提醒
- 网页内通知中心
- guarded 模式审批事件预留
- 完整版 agent pane
- 通知与 pending 状态去重机制

## 5. 验收标准

满足以下条件才可视为 Phase 5 完成：

1. 当 Codex 发起 plan mode 提问时，用户即使停留在 shell 视图也能收到明显提醒。
2. 用户可以在网页中提交问题答案，并让 thread 正常继续。
3. turn 完成、失败、shell 异常、cleanup 结果等关键事件都会进入通知中心。
4. 刷新页面或重新连接后，不会出现明显重复通知或错误的 pending badge。
5. 系统已经为 guarded 模式审批事件保留可接入的模型与 UI 入口。

## 6. 如何验收

建议按以下顺序验收：

1. plan mode 验收
   - 构造一个会触发 `requestUserInput` 的真实或模拟场景。
   - 在 shell 首页停留，确认顶部出现明显提醒。
   - 跳转到 agent pane 并提交回答。
   - 确认 thread 继续运行。
2. 通知中心验收
   - 分别制造 turn completed、turn failed、shell exited、cleanup completed 事件。
   - 确认通知出现、排序正确、点击可跳转。
3. 去重验收
   - 反复刷新页面或断线重连。
   - 确认 badge 计数和通知条目无明显重复。
4. guarded 预留验收
   - 模拟 approval 事件。
   - 确认 UI 可展示待审批项占位，而不是丢事件。
5. 多端表现验收
   - 在桌面端与手机端分别测试 question 提醒和通知中心。

## 7. 如何检查

开发完成后，必须至少执行并记录以下检查：

- 运行 `pnpm lint`
- 运行 `pnpm typecheck`
- 运行 `pnpm test`
- 运行 `pnpm build`
- 执行一次 plan mode 问题展示与提交测试
- 执行一次 turn completed / failed 通知测试
- 执行一次 shell exited 通知测试
- 执行一次 cleanup completed 通知测试
- 执行一次页面刷新后的 pending 状态去重测试
- 执行一次 approval 事件占位渲染测试

## 8. Checklist

以下项目必须全部打钩，Phase 5 才算通过：

- [ ] 已接入 `tool/requestUserInput` 或等效事件，并能识别待回答问题。
- [ ] 已实现 pending question 的展示、回答提交和提交后状态清理。
- [ ] 已实现全局顶部状态提示，即使用户停留在 shell 视图也能看到待处理事项。
- [ ] 已实现 question 与 approval 两类待处理事项的区分展示。
- [ ] 已实现网页内通知中心，并支持未读、已读、排序和跳转。
- [ ] 已覆盖 turn completed、turn failed、user input required、approval required、shell exited、shell error、cleanup completed 等关键通知。
- [ ] 已完善 agent pane，使其支持最近 turn 流、prompt 输入、interrupt、pending question 和 approval 占位。
- [ ] 已为 guarded 模式审批事件保留数据模型与 UI 扩展点。
- [ ] 已处理页面刷新、断线重连、多次订阅导致的重复通知与重复 badge 问题。
- [ ] 已处理已失效 pending 状态的清理，避免 UI 残留脏数据。
- [ ] 已验证手机端和桌面端都能完成 question 提醒与回答流程。
- [ ] 已验证关键通知都能生成、展示并跳转。
- [ ] 已验证 `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build` 全部通过。
