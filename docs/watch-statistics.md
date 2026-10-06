# Watch 摘要与累计计费

Watches 对话框默认显示每个 watch 的周期、状态、创建时间、已记录触发次数和累计费用。提示词、原始 cron、ID、过期时间通过 Show details 展开；已取消、过期、完成或结束会话的 watch 收入默认折叠的 Past watches。

费用和聊天 turn 共用 `TokenUsageCost`：桌面悬浮、手机点击显示输入、缓存读取、缓存写入、输出和推理 token。每次调用的模型与计费规则可能不同，因此后端逐项累加关联 turn 已计算的费用，不对合并后的 token 重新定价。统计读取全部持久化 turn 元数据，不受当前聊天分页限制，不加载大段工具详情。

`GET /api/threads/:id/watches` 在现有字段外增加：

- `triggerCount`：可唯一关联的已记录定时 turn 数；缺少创建时间时为 null。
- `ambiguousTriggerCount`：同时匹配多个 watch 的定时 turn 数；这些 turn 不计入任一 watch 的次数或金额。
- `usageTriggerCount` / `pricedTriggerCount`：已提供 token / 费用的关联 turn 数，便于说明统计覆盖范围。
- `tokenUsage`：关联 turn 的 token breakdown 之和。
- `priceEstimate`：USD 分项与总金额之和。

仅关联 `${threadId}:scheduled:${nativeUuid}` 标识的 turn，排除手动提交的同文本消息。Claude 原生定时记录不携带 watch ID，因此按精确提示词和创建、取消、过期时间匹配；同提示词的生命周期重叠时报告歧义，不猜测归属。单次 watch 只匹配首个触发。后台历史恢复当前只导入已有最终结果的定时 turn，因此正在执行、尚未记录的触发不会提前加入总计。

计费缺失时显示 Cost unavailable；部分 turn 缺少计费时说明 X/Y 覆盖范围。明确没有已记录触发的 watch 显示 0 次、$0。旧版 Supervisor 不返回新字段时，Web 仍提供折叠详情和创建时间，但次数、费用显示 Unavailable，避免把未知误显示成零。

刷新每 30 秒一次，并在打开列表和浏览器返回前台时刷新；聊天 token 更新不再反复重建定时器或发起额外查询。对话框使用共享 Dialog 的焦点管理和滚动锁定。

验证：7 项 Watch Rust 回归覆盖生命周期、歧义、缺失数据、单次触发、分页外的计费；5 项原生定时历史恢复回归；共享 turn 计费组件回归；移动 Chromium 专项覆盖详情折叠、累计费用、token 提示层、焦点恢复、长内容不产生横向溢出和旧版接口兼容。
