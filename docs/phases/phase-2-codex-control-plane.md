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

### 3.8 Slash 命令兼容范围

当前决定是：**不追求完整兼容 Codex CLI 的全部 slash 命令**，只兼容在本项目网页端明显有价值、且与远程 Codex 控制面直接相关的少数命令。

#### 3.8.0 实施 Checklist

执行约束：

- 本节 checklist 不是参考清单，而是实施约束。
- **每完成一个 checkpoint，必须立即在文档里打钩，不允许等到整批做完再统一补。**
- 如果某个 checkpoint 需要调整范围，必须先更新本文档，再继续实现。

第一批：slash 工具箱、`/fast`、`/compact`

- [x] A1. 在 prompt 输入框上方功能栏加入统一 slash 工具箱入口按钮。
- [x] A2. 工具箱浮层能在桌面和移动端正常打开、关闭、点击外部收起。
- [x] A3. 第一批工具箱中仅展示 `/fast` 与 `/compact` 两项，不提前暴露未实现项。
- [x] A4. `/fast` 在工具箱中表现为 toggle 项，并能明确显示当前 on/off 状态。
- [x] A5. `/fast` 状态以 Codex 主机 `~/.codex/config.toml` 中的 `service_tier` 为准，并能跨刷新读取。
- [x] A6. `/fast` 切换后，前端状态、Codex 主机配置、重新加载后的状态保持一致。
- [x] A7. `/fast` 切换后，时间线上出现小型系统卡片 `Fast mode on/off`。
- [x] A8. fast mode 与模型 / reasoning 选择的语义明确分离，不再错误地互相挟持。
- [x] A9. `/compact` 在工具箱中表现为一次性动作按钮，而不是 toggle。
- [x] A10. `/compact` 点击后走独立 API 动作，不伪装成普通用户消息发送。
- [x] A11. `/compact` 成功触发后，时间线继续复用现有 context compaction 卡片，不引入第二套视觉。
- [x] A12. `/compact` 在执行中具备忙碌态，避免重复点击。
- [x] A13. 为第一批 slash 功能补齐前端交互测试。
- [x] A14. 为第一批 slash 功能补齐 API / service 测试。
- [x] A15. 跑完本批相关测试后再打钩本批最终完成项。

后续批次

- [ ] B1. `/fork` 二级选择流程与 thread 分叉数据模型设计落地。
- [x] B2. `/skills` 悬浮列表只读展示落地。
- [x] B3. `/mcp` 悬浮列表只读展示落地。
- [ ] B4. `/review` 的网页端高频入口形态定稿并实现。
- [ ] B5. `/init` 是否进入网页端范围，需要单独评审后再决定。
- [ ] B6. `/plugins` 插件目录 / 管理面板方案定稿并实现。

第二批：`/skills`、`/mcp`

- [x] C1. slash 工具箱根列表新增 `/skills` 与 `/mcp` 两个入口。
- [x] C2. `/skills` 点击后打开只读二级悬浮面板，而不是发送普通消息。
- [x] C3. `/mcp` 点击后打开只读二级悬浮面板，而不是发送普通消息。
- [x] C4. `/skills` 面板展示技能名称、描述、scope 与实际调用名（如 `$imagegen`），不再伪造 on/off。
- [x] C5. `/mcp` 面板展示 MCP server 名称、认证状态与工具概览。
- [x] C6. `/skills` 数据直接对接 Codex App Server `skills/list`，不手搓本地目录扫描。
- [x] C7. `/mcp` 数据直接对接 Codex App Server `mcpServerStatus/list`，不额外发明配置来源。
- [x] C8. 两个面板都不向时间线插入卡片或消息气泡。
- [x] C9. 为第二批 slash 功能补齐前端交互测试。
- [x] C10. 为第二批 slash 功能补齐 API / service 测试。
- [x] C11. 跑完本批相关测试后再打钩本批最终完成项。
- [x] C12. `/skills` 面板去掉伪开关语义，改为目录 / 状态视图。
- [x] C13. `/mcp` 面板补齐第一阶段管理方案：列表、添加 HTTP MCP、原始 TOML 编辑。

当前计划兼容的命令范围如下：

- `/compact`
  - 用于主动触发线程压缩，降低上下文长度，避免长对话继续膨胀。
- `/skills`
  - 用于查看和管理当前可用 skills，便于在网页端理解和启用 Codex 能力增强。
- `/mcp`
  - 用于查看和管理 MCP 服务及其可用状态，满足远程环境排障与能力确认需求。
- `/plugins`
  - 用于浏览、安装、启用和禁用插件，并查看插件打包的 skills、apps 与 MCP 能力。
- `/fast`
  - 用于切换 Codex 的 `service_tier` 到更偏速度优先的 `fast` 服务层级。
- `/init`
  - 用于生成或初始化 `AGENTS.md` / 项目说明类引导文件，适合新 workspace 的起步操作。
- `/fork`
  - 用于从当前 thread 分叉一个新 thread，保留上下文但让后续探索与主线隔离。
- `/review`
  - 用于对当前改动发起代码审查，这是网页端非常有价值的高频能力。

本项目对 slash 的网页端交互约定如下：

- 不把 slash 主要实现为“用户输入 `/xxx` 文本然后发出去”。
- 在 prompt 输入框上方的细功能栏中新增一个 slash 工具箱按钮，图标使用简洁的斜杠风格。
- 点击该按钮后弹出一个浮层列表，展示当前支持的 slash 功能。
- 真正适合做“模式切换”的 slash，在列表中表现为可点亮的切换项。
- 真正适合做“一次性动作”的 slash，在列表中表现为执行按钮。
- 真正适合做“管理面板入口”的 slash，在列表中表现为打开二级浮层或面板。
- 仍允许后续补做输入 `/xxx` 的文本快捷入口，但那应视为工具箱的别名，而不是唯一入口。

当前这一批 slash 的细化方案如下。

#### 3.8.1 `/fast`

定位：

- `/fast` 是 Codex 服务层级偏好切换，而不是普通消息。
- 它应当作为 slash 工具箱里的一个 toggle 项存在。

交互要求：

- 当当前 Codex 主机配置处于 fast mode 时，该按钮为点亮态；否则为熄灭态。
- 点击后立即切换 Codex `service_tier` 的 fast / flex 状态。
- 切换完成后，在时间线上插入一个非常小的系统卡片，例如 `Fast mode on` 或 `Fast mode off`。
- 该卡片只承担状态告知职责，不需要占据大气泡样式。

状态与持久化要求：

- fast mode 必须以 `~/.codex/config.toml` 中的 `service_tier` 为唯一真实来源，而不是仅存在于当前页面内存里的前端状态。
- 刷新页面、恢复 thread、跨端打开同一 thread 时，都应能读到一致的 fast mode 状态。
- fast mode 不能强制切换模型，也不能锁死模型 / reasoning 选择；它只表达服务层级偏好。

#### 3.8.2 `/compact`

定位：

- `/compact` 是一次性动作，不是模式开关。
- 它应当作为 slash 工具箱中的一个执行按钮。

交互要求：

- 用户点击 `/compact` 后直接触发上下文压缩。
- 时间线卡片不新增专门样式，直接复用现有自动 compact 时已经存在的上下文压缩卡片。
- 如果 compact 正在执行，工具箱里该项应当给出短暂的忙碌态，避免重复点击。

实现要求：

- 主动触发的 compact 与自动触发的 compact 应复用同一套后端动作与时间线映射，避免前端出现两套长得很像但语义分裂的卡片。

#### 3.8.3 `/fork`

定位：

- `/fork` 是 thread 分叉能力，不是普通消息，也不是简单 toggle。
- 它是当前这批 slash 里交互最复杂的一个。

主流程：

- 在 slash 工具箱中点击 `/fork` 后，打开二级界面。
- 二级界面先提供两个入口：
  - `Fork from latest`
  - `Fork from selected turn`
- 如果用户选择 `Fork from selected turn`，则继续弹出一个可滚动列表。
- 列表仅展示简洁条目，例如 `Turn 12`、`Turn 13`，不强制展示 turn 细节。
- 用户需要的上下文细节由主时间线自行承载，fork 选择器只负责精确选 turn。

fork 后的结果要求：

- fork 成功后自动创建新 thread，并跳转到新 thread。
- 原 thread 时间线上插入一个系统卡片，文案类似 `Thread forked`。
- 该卡片内需要提供跳转到新 thread 的按钮。
- 新 thread 时间线上新增一个来源卡片，文案类似 `Forked from thread Y at turn N`。

数据模型要求：

- 新 thread 必须继承 fork 点之前的历史 turns，而不是仅复制一段摘要文字。
- 需要优先核对 Codex App Server 上游是否已经提供 fork 后 thread 的来源信息和被继承 turn 关系。
- 如果上游直接提供 fork 元数据，则本项目应尽量直接持久化和展示该元数据。
- 如果上游不提供完整 fork 元数据，则需要在 supervisor 侧自行记录：
  - source thread id
  - source turn number
  - fork 创建时间
  - fork 后新 thread id

#### 3.8.4 `/skills`

定位：

- `/skills` 是查看与理解当前 skills 状态的管理入口，不应作为普通消息发进模型上下文。
- 当前已核对到的 OpenAI 官方公开材料不足以支持“网页端直接开关单个 skill”的设计。
- 因此网页端不应把 `/skills` 设计成 toggle 控制台，而应设计成能力目录 / 发现面板。

交互要求：

- 在 slash 工具箱中点击 `/skills` 后，打开一个悬浮列表。
- 列表中展示当前有哪些 skills，以及各自状态。
- 行为尽量贴近 Codex App 的 skills 查看体验。
- 时间线上不留记录，因为它本质上是控制面板操作，不是会话内容的一部分。

本阶段范围：

- 第一阶段先做查看与展示。
- 展示内容优先包括：
  - skill 名称
  - 描述
  - scope（`system` / `user` / `repo` / `admin`）
  - 实际调用名（如 `$imagegen`）
- 不展示伪造的 on/off 开关。
- 如果后端返回 `enabled` 字段，也不把它渲染成用户可切换开关；只有在 OpenAI 官方明确提供稳定的 skill enable / disable 能力后，再补切换交互。
- 安装、刷新、更多详情等能力后续再补。
- 需要明确区分：
  - `/skills` 只展示当前本机已经被 Codex 发现到的 skills。
  - curated / experimental skills 不会因为打开 `/skills` 自动出现。
  - 需要安装新 skill 时，应通过 `skill-installer` skill 调用其 helper scripts，把 skill 下载到 `$CODEX_HOME/skills/<skill-name>`，然后重启 Codex 让其重新发现。

#### 3.8.5 `/mcp`

定位：

- `/mcp` 与 `/skills` 类似，属于能力面板入口，而不是普通消息。
- 但 `/mcp` 最终应承载真实管理能力，而不只是只读查看。

交互要求：

- 在 slash 工具箱中点击 `/mcp` 后，打开一个悬浮列表。
- 列表中展示当前可用的 MCP 服务及其状态。
- 时间线上不留记录。

本阶段范围：

- 官方对齐结论：
  - Codex CLI / IDE extension 共用 `~/.codex/config.toml`
  - MCP server 配置落在 `[mcp_servers.<name>]`
  - 添加 HTTP MCP server 可优先复用官方 CLI：`codex mcp add <name> --url <url>`
- 因此网页端 MCP 管理必须以 `~/.codex/config.toml` 为真实来源，而不是另起一套 supervisor 私有配置。
- 第一阶段建议实现：
  - 当前 MCP server 列表
  - `Add MCP` 二级入口
  - 添加 HTTP / Streamable HTTP MCP server
  - 原始 TOML block 编辑入口
- 列表项优先展示：
  - server 名称
  - 连接方式摘要（`url` 或 `command`）
  - auth 状态
  - tool 数量
  - 最近错误或不可用原因
- 添加成功后需要明确提示配置已写入 `~/.codex/config.toml`，并在必要时提示用户重启 Codex service 以确保生效。
- 复杂 stdio MCP 第一阶段不急于堆大量 GUI 表单，更稳妥的方式是提供对应 TOML block 的原始编辑入口。
- stdio MCP 的 GUI 只负责帮助用户编辑单个 `[mcp_servers.<name>]` block，不负责改写整份配置文件的其它段落。
- `remove`、tool-level approval overrides、`test` / health check 后续再补。

#### 3.8.6 `/plugins`

定位：

- 官方对齐命令是 `/plugins`，不是 `/plugin`。
- `/plugins` 属于插件目录 / 管理面板入口，不应作为普通消息发进模型上下文。
- 它的职责是浏览、发现、安装、启用、禁用与查看详情，而不是直接“运行某个插件动作”。
- 真正使用插件时，仍以自然语言任务描述或 prompt 中 `@plugin-or-skill` 的显式调用为主。

交互要求：

- 在 slash 工具箱中点击 `/plugins` 后，打开一个二级悬浮面板。
- 面板整体交互风格与当前已落地的 `/skills`、`/mcp` 面板保持一致。
- 时间线上不留记录，因为它属于控制面操作，不属于会话内容。
- 面板分为两个主区域：
  - `Installed`
  - `Discover`
- `Installed` 区域展示当前已安装的 plugins，并允许 enable / disable。
- `Discover` 区域展示当前可发现的 plugins，并支持关键词搜索。
- 点击任一 plugin 后打开 details 视图，展示该 plugin 的详细信息与可执行管理动作。

本阶段范围：

- 第一阶段先做插件目录与基础管理，不做 plugin authoring UI。
- `Installed` 列表项优先展示：
  - display name
  - plugin id
  - version
  - source / marketplace 来源
  - enabled / disabled 状态
- `Installed` 列表项允许直接执行：
  - `Enable`
  - `Disable`
- `Discover` 列表优先支持：
  - 关键词搜索
  - 按来源区分 discoverable plugins
  - 从列表进入 details
- details 视图优先展示：
  - display name
  - plugin id
  - 描述
  - version
  - marketplace / source
  - bundled skills
  - bundled MCP servers
  - bundled apps
  - install / uninstall / enable / disable 入口
- 如果插件需要认证，应在 details 中展示 auth policy 或需要认证的提示。

状态与持久化要求：

- 插件启用 / 禁用状态以 `~/.codex/config.toml` 为真实来源。
- 官方对齐方式为在 `[plugins.\"<plugin-id>\"]` 下写入 `enabled = true/false`。
- 插件 discover / install 来源需要兼容：
  - 官方 curated marketplace
  - repo marketplace：`$REPO_ROOT/.agents/plugins/marketplace.json`
  - personal marketplace：`~/.agents/plugins/marketplace.json`
- 本项目不应发明一套独立于 Codex 的 plugin 状态存储。
- 页面刷新、线程切换、跨端进入同一 workspace 时，插件状态读取结果必须一致。

实现策略要求：

- 如果 Codex App Server 已暴露插件列表 / 详情 / 安装能力，优先直接复用上游能力。
- 如果上游尚未暴露完整插件管理接口，则 supervisor 侧可以在第一阶段补一层面向 plugin marketplace 与 config 的控制面封装。
- 搜索行为优先在当前已获取的 discoverable plugin 列表上执行前端过滤；只有在上游明确支持远端搜索时，再切换为服务端搜索。
- enable / disable 完成后，UI 应立即更新，并在失败时复用现有顶部错误提示。
- 安装成功后，UI 应明确提示用户通常需要在新 thread 中开始使用该 plugin。

当前明确不做的范围：

- `/plugins` 第一阶段不承担发布插件能力。
- 不在网页端第一阶段提供完整 `.codex-plugin/plugin.json` 图形化编辑器。
- 不在第一阶段提供 marketplace 发布、审核或上传能力。
- plugin authoring 流程后续如有需要，应单独作为“插件开发工具”能力评审。

#### 3.8.7 `/init`

定位：

- `/init` 当前暂不进入网页端优先实现范围。

当前决策：

- 暂不在 slash 工具箱中提供 `/init`。
- 如果用户确实需要初始化 `AGENTS.md` 或类似引导文件，现阶段直接通过普通对话要求模型执行即可。
- 后续只有在确认它能显著提升新 workspace 启动体验时，再考虑做成显式 slash 流程。

当前明确**不以完整兼容为目标**的命令：

- 其它大部分 CLI slash 命令
- 纯 TUI / 本地终端体验导向的命令
- 仅在桌面 CLI 中有明显价值、但在手机网页端收益很低的命令

这里记录的是**当前产品范围决策**，不是对实现顺序的承诺。后续应优先实现：

1. slash 工具箱基础 UI
2. `/compact`
3. `/fast`
4. `/fork`
5. `/skills`
6. `/mcp`
7. `/plugins`
8. `/review`

`/init` 当前不排期。

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
