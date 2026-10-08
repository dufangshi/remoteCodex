# Watch 摘要与累计计费

统一 Automation 对话框中的原生 watch 卡片默认显示每个 watch 的周期、状态、创建时间、已记录触发次数和累计费用。提示词、原始 cron、ID、过期时间通过 Show details 展开；已取消、过期、完成或结束会话的 watch 收入默认折叠的历史/非活跃列表。

费用和聊天 turn 共用 `TokenUsageCost`：桌面悬浮、手机点击显示输入、缓存读取、缓存写入、输出和推理 token。每次调用的模型与计费规则可能不同，因此后端逐项累加关联 turn 已计算的费用，不对合并后的 token 重新定价。统计读取全部持久化 turn 元数据，不受当前聊天分页限制，不加载大段工具详情。

`GET /api/threads/:id/watches` 在现有字段外增加：

- `triggerCount`：可唯一关联的已记录定时 turn 数；缺少创建时间时为 null。
- `ambiguousTriggerCount`：同时匹配多个 watch 的定时 turn 数；这些 turn 不计入任一 watch 的次数或金额。
- `usageTriggerCount` / `pricedTriggerCount`：已提供 token / 费用的关联 turn 数，便于说明统计覆盖范围。
- `tokenUsage`：关联 turn 的 token breakdown 之和。
- `priceEstimate`：USD 分项与总金额之和。

仅关联 `${threadId}:scheduled:${nativeUuid}` 标识的 turn，排除手动提交的同文本消息。Claude 原生定时记录不携带 watch ID，因此按精确提示词和创建、取消、过期时间匹配；同提示词的生命周期重叠时报告歧义，不猜测归属。单次 watch 只匹配首个触发。后台历史恢复当前只导入已有最终结果的定时 turn，因此正在执行、尚未记录的触发不会提前加入总计。

计费缺失时显示 Cost unavailable；部分 turn 缺少计费时说明 X/Y 覆盖范围。明确没有已记录触发的 watch 显示 0 次、$0。旧版 Supervisor 不返回新字段时，Web 仍提供折叠详情和创建时间，但次数、费用显示 Unavailable，避免把未知误显示成零。

对话框打开时每 3 秒一次，并在打开列表和浏览器返回前台时刷新；聊天 token 更新不再反复重建定时器或发起额外查询。对话框使用共享 Dialog 的焦点管理和滚动锁定。

验证：9 项 Watch Rust 回归覆盖生命周期、歧义、缺失数据、单次触发、分页外的计费；5 项原生定时历史恢复回归；共享 turn 计费组件回归；移动 Chromium 专项覆盖详情折叠、累计费用、token 提示层、焦点恢复、长内容不产生横向溢出和旧版接口兼容。

## 统一只读 Automation 面板

线程工具栏只有一个 Automation（自动化）按钮。原生 Claude watches 与设备自动化共用对话框，展示当前规则及默认折叠的历史/非活跃规则。Web 不提供创建、预览、编辑、暂停、恢复、取消操作；智能体 CLI/API 的完整管理能力继续保留。定义、执行历史和受控脚本输出仅供查看。对话框打开时每 3 秒刷新，并在返回前台时刷新；请求串行化，切换线程时丢弃旧响应。

`GET /api/threads/:id/automations` 的每个 DTO 及单条 show/create/control 响应增加可选 `statistics`；旧设备没有此字段时显示未知。统计直接读取**全部**持久化 ledger 和 turn 元数据，独立于 `/runs` 最近 100 条记录的显示上限：

- `triggerCount` = 所有执行记录的 `1 + missedCount` 之和，包含合并、条件不满足、循环保护和过期跳过的触发。它是已观察触发次数，不是动作数或模型调用数；从未被调度器观察的事件不凭空补计。
- `runCount` 是 ledger 行数。`executedActionCount` 是有开始时间的动作记录数（收件箱成功投递也算一次）；`runningActionCount` 是运行中的动作记录数。
- `promptTurnCount` 是 prompt 动作快照中绑定的去重 turnId 数。只关联目标线程的这些回合，排除同线程其他手动回合；多个记录绑定同一个回合只计费一次，多个规则绑定同一回合则记为歧义并排除计费。
- `usageTurnCount` / `pricedTurnCount` 分别是有有效 token / USD 估价的关联回合数。`ambiguousTurnCount` / `missingTurnCount` 显示歧义或已缺失的回合；`unattributedRunCount` 表示已启动或结果不确定却没有 turnId 的 prompt 记录。待执行队列不提前算作模型用量。
- `tokenUsage` 是关联回合的完整 token breakdown 之和；`priceEstimate` 是各回合按其模型、价格档位、缓存和时间规则得到的 USD 分项之和，不对 token 总和重新定价。包含已经持久化的运行中消耗，未上报/未持久化的数据仍未知。计价沿用 timeline/native watch 的设备价格目录，金额是估算而非账单。

Inbox 和 script 动作本身没有模型 token 费用，显示已知 0；脚本自行调用模型的费用不被此 ledger 测量，并明确说明。无已启动模型回合的规则可显示 0；已关联但没有 token/价格的回合显示未知；部分覆盖显示已知小计及覆盖数。合并触发次数不乘入 token 或金额。

顶部累计触发次数为设备已观察触发次数加原生 watch 唯一匹配的已记录定时回合数；两者口径在面板中解释。原生时间/归属缺失的次数保留未知标记，歧义触发不猜测分配。token/USD 合计为所有卡片的已知归属小计，持续标注其可能不完整；任一接口失败时显示失败与未知覆盖。原生 watch 的提示词/生命周期匹配和状态恢复沿用现有后端，运行中但尚未导入的原生回合仍不提前纳入。

专项验证覆盖：超过 100 次历史执行、合并与重复绑定、运行中消耗、混合价格模型、未知模型、缺失/歧义关联、普通回合隔离、无模型动作；React 回归覆盖单一面板、禁止写入操作、累计值独立于历史分页、双语说明、旧设备未知统计及线程切换竞态。浏览器旧创建表单用例改为 API 准备 fixture、只读面板验证及原生 watch 共用面板回归。
