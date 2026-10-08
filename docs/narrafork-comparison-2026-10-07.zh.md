# remoteCodex 与 NarraFork 代码对比及功能建议

对比日期：2026-10-07。本文回答三个问题：共同功能谁做得更好、我们有哪些它尚无对应实现的功能、它有哪些值得我们补充的功能。

## 1. 对比范围与主要判断

| 项目 | 固定版本 | 实际检查范围 |
| --- | --- | --- |
| remoteCodex | 0.12.68；94edcfadc8a6dda5ebc23271ee582709d32af171 | Rust runtime/supervisor/relay/CLI、Web 接入、协议、相关架构与运维文档 |
| remoteCodex 共享 UI | 8e4c384d81012c229d1a780ea175fa2dbaa5c82b | packages/thread-ui/src 下的工作区、Monaco、文件标签、保存流程 |
| NarraFork | 0.8.3；4e04d2f2e490bd57a5d8d712b709a574b905848a | AgentLoop、Provider、数据库与消息引用、上下文、Git、编辑器、任务、权限、插件、远程 executor、更新、VS Code 扩展 |

NarraFork 已浅克隆到 .temp/research/NarraFork；该目录受现有 .temp/ 忽略规则覆盖。分析以固定提交的实现为准，未把 README 中列出的每个名称自动当作完整功能，也未把旧 TypeScript 代码自动视为当前 Rust 运行时能力。

这是静态代码审查，没有部署 NarraFork、运行其 Agent、执行第三方工具或做性能对照。因此“更好”主要指功能完整性、边界设计和适用场景；不据此断言谁更快、更省 token、更少故障或更能承受大规模用户。“未见对应实现”也限定于上述版本的生产代码，不排除原生 harness 或外部集成已经具备某项能力。

**核心判断：我们更像“原生 coding agent 的分布式控制与协作平台”，它更像“自己掌握 Agent 执行和上下文的浏览器开发工作台”。** 我们的优势集中在原生 harness、设备自治、协作投递语义、加密 relay 与设备运维；它的优势集中在上下文可编辑性、会话与 Git 的组合工作流、多人工作台和服务端扩展生态。

值得学的是它把开发过程中的对象关联起来的方式：会话关联文件版本、分支、评审、知识条目、任务执行记录。照搬其 AgentLoop 会改变我们当前 ACP 架构，不应把这种架构改造误当作增加几个 UI 按钮。

## 2. 底层架构为何会产生这些差异

| 维度 | remoteCodex | NarraFork | 对产品的影响 |
| --- | --- | --- | --- |
| Agent 执行 | 设备 Supervisor 经 ACP/薄适配器管理原生 harness | 服务端 AgentLoop 直接调用 Provider API、组织历史并执行工具 | 我们保留原生生态；它可以统一改写模型输入和工具策略 |
| 模型与工具语义 | 由 harness 主导，控制面协商能力 | Provider 格式适配与内建工具由项目掌握 | 我们的能力因 harness 而异；它跨模型的 UI 和历史语义更统一 |
| 数据位置 | 各设备保存执行与会话数据，relay 转发连接与密文 | 中央服务保存会话、引用、知识与项目数据；远端设备主要执行工具 | 我们更适合设备自治；它更容易做全局搜索和统一团队视图 |
| 远程设备 | 远端设备运行独立 Supervisor 和原生 agent | Go executor 提供文件、命令、Git、PTY 等执行 RPC | 我们偏“让另一台设备上的 agent 做事”；它偏“当前 agent 在另一台机器执行工具” |
| 工作区 | 共享 React UI，聊天加文件/编辑器分栏 | Dockview 多面板，叠加项目、章节、会话与 Git 工作流 | 它更接近浏览器 IDE；我们更偏远程会话操作台 |
| 技术栈 | Rust 控制面，React/TypeScript UI，原生运行时与 npm 启动分发 | TypeScript/Bun/Hono、React/Mantine、Drizzle；独立 Go executor | 语言本身不能作为性能或可靠性胜负依据 |

我们实际通过 catalog 接入 Codex、Claude、Grok、Cursor、Gemini、Copilot、OpenCode、DeepSeek 等不同命令路径，能力经过协商和覆盖；不是每个 harness 都支持同样的 fork、steer、compact 或配置管理。[命令目录][R-harness]、[能力协商][R-cap]、[适配覆盖][R-adapter]。

NarraFork 的 ProviderAdapter 则统一构造工具和请求，AgentLoop 自己掌握执行循环。特别要注意，它名为 Codex Provider 的代码主要包装 OpenAI Provider、账号认证及请求传输，并不等于运行 Codex ACP/原生 CLI。因此“它也支持 Codex”与“我们接入原生 Codex harness”不能当作完全相同的能力。[执行循环][N-loop]、[Provider 接口][N-provider]、[Codex Provider][N-codex]。

两条路线各有代价：我们需要处理各原生 harness 的能力差异；它需要持续维护模型协议、工具循环、压缩和权限实现。若某功能涉及“最终送给模型的上下文”，它通常具有更直接的实现条件。

## 3. 共同能力：谁做得更完整

| 共同能力 | 我们当前实现 | NarraFork 当前实现 | 判断 |
| --- | --- | --- | --- |
| 多模型/多 agent | 多种原生 harness；每种保留自己的模型、命令、认证与工具行为 | 多 Provider 进入同一 AgentLoop，使用统一历史和工具抽象 | 原生兼容与生态保真：我们更强；跨 Provider 一致性：它更强 |
| 会话恢复/导入 | 可枚举、导入本机 Codex/Grok/Claude 等已有原生历史，接回相应运行路径 | 以自己数据库中的 narrator 历史为中心 | 已有 CLI 用户迁移：我们更强 |
| 会话分叉 | 能力允许时创建真实原生会话分叉；历史时点支持依 harness 而异 | full/compressed/fresh 继承模式，消息引用共享及懒回填 | 原生会话连续性：我们更合适；统一继承与存储设计：它更完整 |
| 压缩 | 调用 harness 的 compact；是否可用由协商/适配决定 | 整体/分段压缩，可看、编辑、撤销摘要 | 它明显更完整，但我们不能只改本地显示就声称改了原生上下文 |
| 上下文观察 | 消息、事件、用量等；缺少统一的最终请求组成视图 | 按 system、summary、工具定义、工具调用/结果、附件等分类展示 | 它更强；分类占比仍含估算，不是每项精确 token 计数 |
| 文件浏览与编辑 | 已有 Monaco、文件标签、预览与聊天/文件分栏 | Monaco、预览、版本与冲突处理 | 两边都有编辑器；它的并发保存保护更好 |
| Git/worktree | agent/worktree 隔离基础与原生 Git 工具可用 | 分叉、变更、提交、暂存、stash、合并、评审、历史快照关联 | 它在端到端产品流程上更完整 |
| 多会话布局 | 会话导航、收藏/最近访问、活跃聊天与文件分栏 | Dockview 多会话、多面板及布局持久化 | 它更灵活 |
| 多 agent 协作 | 本地线程层级、角色、依赖任务板、wait/wake、被动 inbox、显式 steer | Agent/Send/Await、持久 mailbox、采纳回执、用户接管子代理 | 深层原生 agent 协作与投递控制：我们更强；人工介入体验：它有值得学的设计 |
| 跨设备 | 独立 agent 会话创建/通信、转录与文件交换 | 同一会话切换默认设备，或按工具调用选设备 | 分布式自主 agent：我们更强；单会话跨机器工具操作：它更直接 |
| 连接加密 | 浏览器/设备及设备/设备的 HPKE、身份签名/固定、重放保护；relay 转密文 | VNet 层也有 HKDF/AES-GCM 加密；中央服务持有 Agent 上下文 | 对 relay 隐藏聊天正文：我们架构更有优势；不能说它没有加密 |
| 长任务恢复 | 输入先持久化、幂等、未知状态保护、更新中断标记与选择性恢复 | 持久运行记录、工具恢复、更新恢复、子代理恢复入口 | 两边都有实质实现；未实测前不判总体可靠性胜负 |
| 定时任务 | Claude 原生会话定时能力与已完成结果回填，缺少独立持久调度域 | cron、时区、执行记录、重启重建、重叠控制 | 它更完整 |
| Skills/MCP | 能用原生 harness 生态与公开能力；配置管理依 harness | 自己统一内建工具、技能、MCP 和 routines | 我们原生生态更强；它统一管理更强 |
| 分享与权限 | relay 的设备/工作区/线程访问控制及读/控制范围 | 用户/团队/项目权限，知识 ACL，外部应用授权资源范围 | 都有；它在团队知识与外部应用授权上更细 |
| 插件 | 当前 Rust Supervisor 生产路径主要是内建 terminal；导入插件接口明确不支持 | 插件包、独立进程 RPC、能力代理、可选 Podman、iframe 面板 | 它明显更完整 |
| 搜索 | 当前线程内 user/assistant 摘录搜索 | 会话/章节/知识等多实体 FTS 与权限过滤 | 它明显更完整 |
| 远程运行环境 | 可选 hosted Incus 设备、CPU/RAM/disk 配额、生命周期与设备指标 | 远端 executor，加上章节级 rootless Podman/Compose 环境 | 我们偏设备运维；它偏项目开发环境；容器不是我方独有 |
| 更新分发 | 原生运行时/npm、设备管理 Check/Update、独立 Windows Manager | 预编译可执行文件、executor 分发、校验、增量更新与回退 | 两边都有实质实现；我们的优势偏设备运维，它偏服务端单包升级 |

主要证据：我方的[原生历史][R-local]、[fork/compact][R-fork]、[协作投递][R-interaction]、[任务板][R-task]、[跨设备边界][R-peer]；对方的[消息引用 schema][N-schema]、[分叉逻辑][N-fork]、[上下文路由][N-compact]、[布局实现][N-dock]、[持久投递][N-delivery]。后文展开容易混淆的部分。

### 3.1 分叉：它的“共享引用”与我们的“原生会话”各有价值

NarraFork 将消息正文与会话中的消息引用分开保存。full 分叉可以插入引用而不复制全部正文；压缩前的较早历史还能按需回填。共享的摘要被编辑前，会先做 copy-on-write，避免污染兄弟分支。[schema][N-schema]、[fork][N-fork]、[摘要编辑][N-message-edit]。

我们创建 fork 时既要处理原生 session fork，也会将 turn/history 写入新线程 journal。原生分叉有利于保留 harness 自己的上下文与语义；但本地展示历史没有同等引用共享设计。[fork 实现][R-fork]。

可借鉴“不可变事件正文 + 分支引用”，改善我们大量分叉时的 journal 存储和检索。它不会自动降低原生 harness 的存储或模型计费，收益需要基准验证；更不能用数据库引用替代真正的原生会话分叉。

### 3.2 编辑器：我们已经有，缺的是冲突保护

共享 UI 中存在真正的 Monaco 编辑器、预览/固定标签和保存路径，不能把“补一个编辑器”列为新功能。[Monaco][U-editor]、[工作区布局][U-layout]。

具体差距是保存协议：我们的写入路径主要接收 path/content，校验文件范围后直接写盘。NarraFork 保存时比较 baseHash 与磁盘 currentHash，冲突时返回当前版本供用户处理。[我方文件写入][R-file]、[UI 保存][U-save]、[对方冲突检查][N-editor]。

典型场景：用户打开文件后，agent 修改了同一文件；用户随后保存旧缓冲区。目前我们缺少同等的协议级版本前提保护。补充 expectedHash、冲突结果和 diff UI，比重做编辑器更有价值。

2026-10-08 专项审查补充：NarraFork 当前 FileTreePanel 只对 local 设备设置目录根，editor-documents 路由也明确拒绝远端编辑传输。因此上述优势主要指其本地文档生命周期和冲突处理，不能扩大为“远程文件浏览/编辑全面领先”；我方已有经 relay 操作设备文件的完整链路。[对方文件树入口][N-file-tree]、[远端编辑限制][N-editor-remote]。详细改进设计见[文件浏览与编辑方案](proposals/narrafork-file-browser-editor-plan.zh.md)。

### 3.3 终端：它让人与 agent 使用同一个 PTY

NarraFork 除普通 Bash 工具外，还提供 Terminal 工具，在限定 workspace/narrator 范围内创建、读取、写入和等待同一 PTY；增量输出有 cursor。用户与 agent 能观察同一个 shell 状态。[Terminal 工具][N-terminal]。

我们有 Web 人工 PTY，也有 ACP 命令终端，但两者是不同实现：ACP 终端创建命令子进程，并不自动等于用户当前打开的交互 shell。[人工 ShellHub][R-terminal]、[ACP 终端][R-acp-terminal]。

可借鉴的是显式、可授权的终端共享接口，而不是把所有 harness 命令默认送进用户 shell。原生工具能否接入仍取决于 ACP/MCP 能力。

另一个相关差别是跨设备操作。它的 SwitchDevice 改变同一会话的默认执行目标，也允许 Read/Write/Edit/Glob/Grep/Bash 单次选择设备；模型上下文仍由中央服务掌握。我们的主要流程是委派给另一台设备上的独立 agent，再交换结果和文件。前者适合“同一件事在多台机器上操作”，后者适合“让多台机器上的自主 agent 分工”。这是两种能力，不能只按设备数量比较。[SwitchDevice][N-switch]。

### 3.4 可靠性：双方都有设计，值得学的是恢复的可见性

我们的可靠性逻辑会先记录完整输入、维护幂等信息，对不确定的执行状态采取保护；更新标记在取消前持久化，恢复时限定为此次更新打断的 turn，用户停止优先。[输入可靠性][R-reliability]、[更新恢复][R-update]。

NarraFork 同样不会盲目重放结果未知的副作用工具；它还有针对未完成子代理的恢复卡片，区分前台等待续跑与较早的后台任务。[工具恢复][N-recovery]、[子代理恢复][N-subrecover]。

我们最值得学的是把“这次更新中断了什么、哪些已恢复、哪些结果未知、用户下一步能做什么”展示清楚。不能仅因为它有更多恢复代码或我们用了 Rust，就判定总体可靠性更高。

## 4. 我们更强，以及它没有同等对应实现的能力

以下是“当前未见同等实现”，不是声称对方完全没有这个大类功能。

### 4.1 原生 harness 的远程控制与已有历史承接

我们直接围绕原生 harness 建控制层，能承接本机已经存在的原生会话，并通过适配器保留其命令、模型和能力边界。NarraFork 主要承接自己数据库中的统一会话，没有看到与我方相同的多原生 CLI 会话导入/恢复控制面。

适合我们的人群是：已经在终端使用 Codex、Claude 等，希望远程继续，并保留工具行为与原生生态，而非迁移到另一个 AgentLoop。[目录][R-harness]、[历史导入][R-local]。

### 4.2 独立 agent 之间明确的消息投递与执行边界

我们的 inbox 只提供被动输入；queue 表示排到完整当前轮结束后执行；steer/direct 用于及时修正，并要求具体中断原因。回执区分请求的投递方式和实际采用方式，接收不等于执行完成；还有 ack、wait/wake 和依赖任务板。

本地 agent 树当前限制深度 3、每根 20 个打开的 agent 线程，并支持角色、工作目录/worktree 等元数据。NarraFork 也有可靠 mailbox 和采纳回执，但其子代理策略明确限制子代理再次 spawn/await agent 等能力，当前产品路线不是同等深度的异构原生线程协作。[投递实现][R-interaction]、[线程管理][R-agents]、[任务板][R-task]、[对方策略][N-policy]。

边界必须说清：我方跨设备 API 目前是创建、发信、转录、文件等子集，并非本地任务树、wait/wake、任务板、关闭等所有能力都已跨设备对等实现；当前 peer 访问也限定同一 owner 的设备，并须显式启用，不能等同于任意跨团队协作。[跨设备范围][R-peer]。

### 4.3 relay 不必读取聊天内容的连接架构

我方安全传输有设备身份签名/固定、HPKE、有效期及重放保护；设备之间也走加密 peer 通道。对于不完全信任的 relay，仍可把它限定为路由节点。[安全传输][R-secure]、[peer][R-peer]。

NarraFork VNet 有加密，不能称为明文网络系统；但它的中央 AgentLoop 本身负责模型请求和上下文，因此中央服务需要读取相应内容。[VNet 加密][N-vnet]。

我方优势也有边界：relay 仍处理路由与部分账户元数据；端口预览是独立 HTTP 数据路径，不能把“聊天密文转发”扩张成“全部功能对 relay 完全不可见”。[预览边界][R-preview]。

### 4.4 持久设备的运维视角

我们能管理运行原生 harness 的完整 Supervisor 设备，收集 CPU/RAM 等指标；可选 hosted provider 接入 Incus，设置 CPU、内存、磁盘配额并管理生命周期。Windows Device Manager 是独立发布的稳定 bootstrap，runtime 更新由管理 Check/Update 承接。[设备指标][R-metrics]、[hosted provider][R-hosted]、[发布与更新][R-release]。

NarraFork 的 Go executor 更轻，另有章节级 Podman 环境。两者都涉及容器与远程运行，但未见它提供同等“托管原生 Supervisor 设备 + 设备状态/配额 + 独立 Manager 升级”的完整链路。[executor][N-executor]、[章节容器][N-container]。

### 4.5 浏览器/系统推送通道

我们 relay 中已有 Web Push/VAPID，以及 APNs 接入。NarraFork 在检查范围内主要是站内通知、钉钉/飞书等出站通知和 IM 网关，未找到对应的 Web Push/APNs 实现。它的 IM 渠道更广；我们的系统推送方向有现成基础。[Web Push][R-push]、[APNs][R-apns]、[对方网关][N-gateway]。

## 5. 它更强，以及我们当前缺少的产品能力

### 5.1 可操作的上下文管理

这是它最有辨识度的优势之一：压缩不只是一个命令，用户能查看、编辑和撤销摘要，选择某段历史压缩，并查看上下文组成。服务端还处理运行中改写的互斥、取消和超时，避免只在 UI 层删消息。[上下文路由][N-compact]、[组成类型][N-compose]、[组成 UI][N-compose-ui]。

这些能力有利于修正“摘要忘记关键要求”的长任务。我们现在主要调用 harness compact，未见同等统一的摘要编辑/撤销接口。先补观察能力更现实；只有 harness 明确支持时，才能承诺真正改变下一次模型输入。

另外，它的分类占比包含按字符等方式估算，并结合最终请求的统计口径展示，不能据此宣称工具定义、附件等每一类都有精确 tokenizer 计量。

### 5.2 会话、文件历史、Git 分叉与评审的闭环

它的 chapter fork 不仅复制聊天：能结合 Git 分支/worktree、工作区或提交边界，选择 full/compressed/fresh 上下文继承。合并路径支持 merge/squash/cherry-pick，并将评审与具体 commit 关联；源提交改变需要重新评审。[分叉][N-chapter-fork]、[合并/评审][N-merge]。

还有暂存/撤销暂存、commit、stash、AI commit message 和文件变更反转/三方冲突处理。[Git 路由][N-git]、[变更反转][N-reverse]。

我们已有 worktree 和原生 Git 操作能力，缺少的是将其组织成用户可见的完整流程。适合借鉴“任务 → 隔离工作区 → diff → 验证记录 → 评审 → 合并”，而非只是再包一层 git 命令。

回滚也有实际限制：文件反转不代表 shell 命令产生的数据库、网络或其他外部副作用都能撤销，不应将其描述为整个世界的时间旅行。

### 5.3 多会话工作台与布局一致性

Dockview 支持多个会话/编辑器面板、不同排列方式；服务端将面板成员关系与布局分离，布局保存带 revision 条件，避免不同浏览器互相覆盖布局。[Dockview][N-dock]、[面板服务][N-panel]。

我们有现成的聊天/文件分栏，但缺少任意多会话并排工作台。值得先加“双会话对照”和固定编辑器，再决定是否需要完整 Dockview。

### 5.4 独立、持久的定时任务

它持久保存 cron、时区、提示词、模型、权限与工作区策略，以及执行记录；调度器重启时重建下一次触发，运行时避免同任务重叠。[任务服务][N-schedule]、[调度器][N-schedule-tick]。

它明确不补跑重启期间错过的所有任务；不能宣传为绝不漏跑。我们的 Claude 定时结果回填也不等于 Supervisor 独立持久调度。对“每日巡检、定期审查依赖、定时报表”而言，它的产品形态更实用。[我方当前边界][R-schedule]。

### 5.5 项目知识库与有权限的知识注入

它有知识条目、版本/分支、草稿、提交审查、集合权限及标签级别限制；知识注入能引用特定修订，并基于关键词匹配提供相关内容。[知识库范围][N-knowledge]、[ACL][N-knowledge-acl]、[注入][N-knowledge-inject]。

我方 AGENTS.md、skills、普通文件和 harness 记忆能承担部分知识用途，但没有同等的团队知识管理产品。可以先从“项目文档索引 + 可引用版本 + 来源链接”开始，经文件/MCP 提供给原生 harness，不必立即建一个中央向量平台。

它当前也不是所有知识库设想都已落地：文档标出的内联链接与条件块尚未实现；关键词/FTS 不应被描述为已验证的向量语义检索。

### 5.6 跨会话、跨知识的全文检索

它有 SQLite FTS5 trigram，覆盖章节、消息、知识等，搜索服务要求权限主体；也存在 PostgreSQL 对应实现。我们的搜索目前按线程查用户/助手消息并生成摘录，核心是文字匹配，没有同等全局 FTS。[对方索引][N-fts]、[权限搜索][N-search]、[我方搜索][R-search]。

最值得借鉴的是搜索范围、权限与跳转锚点，数据库选择本身不是答案。我们应由各设备做本地索引，再让客户端汇总获授权结果，以保留 relay 无需读取聊天的架构。

### 5.7 可安装插件，而非只有插件接口名称

它有独立进程 JSON-RPC、启动/崩溃控制、能力代理；可选 Podman runner 使用只读根文件系统、网络与资源限制等；前端面板用隔离 iframe/MessageChannel。[插件运行时][N-plugins]、[Podman runner][N-sandbox]、[插件面板][N-plugin-ui]。

我们源码中仍存在 TypeScript 插件框架，但当前 Rust Supervisor 的导入插件路由明确返回 unsupported。不能把遗留注册器算成已上线的可安装插件生态。[Rust 实际路由][R-plugins]。

值得学它的“插件声明能力 → 宿主授权 → 隔离执行 → 受控 UI 通信”；完整插件宿主维护成本高，优先级应低于编辑冲突、搜索和 Git 流程。

### 5.8 面向第三方应用的 OAuth API

它不只是使用 GitHub 登录：有 OAuth 授权服务器式的外部 API，按 scopes 与资源 grant 限制第三方应用，并将外部 token 与浏览器登录 session 分开。[External API][N-oauth]、[grant 校验][N-oauth-acl]。

我们有账号 OAuth 登录、relay 访问控制和设备 CLI/API；未见同等供第三方应用申请授权的版本化 facade。对“外部系统为某项目创建任务、读取指定会话状态”的集成，值得借鉴它的产品边界，而不是直接暴露设备全权凭据。[我方 OAuth][R-oauth]。

### 5.9 IDE 外壳、IM 网关与双语界面

它的 VS Code 扩展复用已有 Web 前端，通过 SecretStorage 保存连接信息，支持 VS Code remote URL 转换；这不是另外重写一份 IDE 内的 Agent。[扩展][N-vscode]。

服务端还有 Telegram、Slack、Discord、飞书、微信等网关代码，以及 webhook，形成 IM 与会话之间的桥梁；同时提供 en/zh-CN 的集中 i18n 体系。[网关][N-gateway]、[i18n][N-i18n]。

我方有 Web/mobile 和推送，不等于已有这些 IM 适配或同等双语体系。若接 IM，应明确每个外部用户与项目权限的映射：它当前网关的某些路径会选管理员身份执行，不能直接照抄成团队权限方案。

### 5.10 人工接管子代理、模型评测

它允许用户临时接管某个子代理，暂停自动结果回收，让当前执行自然结束后由人操作，再交回；适合“子代理走偏，用户想直接纠正”的场景。但当前 takeover 状态主要在内存，重启后不应当作持久协作状态。[接管实现][N-takeover]。

它还有管理员限定的 benchmark suite/run/result/compare 接口及评测执行代码。我们有工程测试，不等于有面向用户的模型/配置对照产品。[评测服务][N-eval]。

两者都是值得了解的补充能力，但对我方而言，先将现有线程、依赖任务和恢复状态可视化，比先建设通用评测平台更有直接收益。

## 6. 特别排除的误判

1. **NarraFork 的新团队任务树尚未全部落地。** Dynamic Spec 文档明确写了持久任务写操作、UI 等仍待实施；只读 Eval/同步底座及资格验证不能算完整生产任务系统。它已有 Agent/Send/Await、Todo 等能力，需要与新方案分开评价。[明确状态][N-team-spec]。
2. **我们已经有 Monaco、文件标签、分栏、PTY、fork、MCP、worktree。** 差距是完整性与组合方式，不能把这些大类列为完全空白。
3. **我们也不是所有 harness 都有统一配置管理。** 例如 Codex 适配覆盖对部分 skills/MCP/hooks/provider 管理能力做了限制；原生可用不代表控制面统一可编辑。[适配覆盖][R-adapter]。
4. **多设备、加密、容器、更新、可靠投递都不是任何一方的绝对独有。** 应比较所在层级、信任边界与产品流程。
5. **它的可逆上下文、Git 回滚、token 统计均有边界。** 不应扩张成任意副作用可逆或精确成本节省。
6. **代码中有 PostgreSQL、插件隔离或评测接口，不等于已验证生产规模或安全成熟度。** 本次没有用测试数量、语言选择、README 宣传替代实际对照验证。

## 7. 建议加入什么：按收益与架构成本排序

这里的 P0/P1/P2 是建议的实施先后，不是已经排期，也不是工期承诺。

| 优先级 | 建议 | 为什么值得做 | 在我们架构中的落点 | 可验收结果 |
| --- | --- | --- | --- | --- |
| P0 | 文件保存版本校验与冲突 diff | 避免用户覆盖 agent 刚写入的内容；现有编辑器可直接受益 | Rust 文件 API 加 expectedHash，协议保持 camelCase；共享 UI 展示冲突 | 文件被外部修改后旧缓冲区保存返回冲突，用户可对照和重新应用 |
| P0 | 项目/设备级搜索与结果跳转 | 长任务和大量线程中找“以前怎么解决” | 每设备 journal 本地 FTS；relay 仅路由；客户端汇总授权结果 | 搜索能按设备/项目/线程过滤，定位原 turn，权限不同结果不同 |
| P0 | 线程树、依赖任务、inbox 和恢复状态面板 | 现有后端能力未充分转成用户可见操作 | 复用现有任务/交互 API，加真实回执与状态视图 | 区分已接收/排队/运行/待验收/结果未知；只恢复确需恢复的任务 |
| P0 | 上下文观察第一版 | 帮助用户判断何时 compact、哪些内容膨胀 | ACP 可见事件/用量 + capability overlay | 显示数据来源、统计时点、未知项与估算；不伪造最终请求细节 |
| P1 | Git 变更与评审闭环 | 将 worktree 和原生工具变成可审查成果 | Supervisor 提供受限 Git 操作；UI 关联 thread/worktree/commit | 看 diff、暂存、提交、按 commit 评审；提交变化后旧批准失效 |
| P1 | Supervisor 持久调度 | 支持浏览器关闭后仍执行日常任务 | 设备侧 schedule/run 表 + 独立触发器，调用原生线程 API | 时区明确；记录计划与执行；无意外重叠；设备离线和错过任务策略可见 |
| P1 | 双会话对照与可恢复布局 | 适合比较不同 agent、审查分支成果 | 共享 UI，布局成员与排列分开；保存带版本 | 两个会话并排，刷新可恢复，多端旧布局不能无声覆盖新布局 |
| P1 | 项目知识引用与中英双语 | 知识复用与日常可用性提升 | 文件/MCP 接入知识引用；共享 UI 集中 i18n | 回复可追溯知识修订；语言切换覆盖主流程；团队权限贯穿检索与注入 |
| P2 | 可编辑/可撤销的真正上下文 | 长任务价值高，但受 harness 约束 | 支持者添加薄 ACP 适配；不支持者提供显式新线程交接 | 编辑确实影响下一次模型输入；不支持时明确隐藏/说明，不假装成功 |
| P2 | journal 的不可变正文与分支引用 | 改善大量 fork 的存储与索引 | Rust journal/schema；处理分支删除、权限与引用回收 | 大量分叉不重复存正文，编辑摘要不污染兄弟分支，有迁移与存储基准 |
| P2 | 隔离插件、第三方 OAuth、IM/VS Code 外壳 | 扩展团队集成与外部入口 | 统一受控 API、最小授权、独立宿主/外壳 | 可撤销授权；token 范围不超项目；扩展失效不拖垮 Supervisor |
| 按需求 | 轻量远端工具 executor / 共享 PTY | 补充弱设备、单会话跨机执行 | 可选工具层/MCP，保留现有自主 Supervisor 路线 | 当前会话显式选执行设备/终端；权限与能力可发现，不改变所有 harness 的默认语义 |

### 7.1 我建议最先做的三个交付包

**第一包：编辑安全与历史可找。** 补文件版本校验、冲突对照、设备/项目搜索。它们直接改善现有用户流程，不要求改变 AgentLoop 或 native session。

**第二包：把协作变成可审查的成果。** 用线程树、任务依赖、被动 inbox、恢复卡片与 Git diff/commit/评审建立清晰的工作台。先利用我们已经更强的协作后端，而非先复制对方所有布局功能。任务板中的完成状态与“代码已通过用户验收”也应明确分开。

**第三包：持久自动化。** 加设备侧定时任务、执行记录与失败处理，覆盖日常巡检/报告等场景。用显式 schedule id + planned run identity 做去重，更新与重启后对账；对未知副作用保留人工检查入口，不承诺外部命令 exactly-once。

上下文观察和双语可随相关 UI 工作加入；真正可逆上下文、完整插件市场和中央知识平台放后面，更符合当前 Rust/ACP 路线。

### 7.2 不建议直接移植的设计

- 不把 NarraFork 的 AgentLoop/Provider 栈搬进 Rust runtime，另造一套默认模型执行循环；原生 ACP 仍是主路径。
- 不为了全局搜索将所有设备历史明文汇集到公共 relay；索引与授权应保留设备边界。
- 不把共享 UI 的布局当成任务成员或调度事实；关闭一个面板不应取消任务或漏掉结果。
- 不把对方尚未落地的新团队任务树当成现成可移植方案；可以借鉴领域设计，不能据此宣称功能差距已经存在。
- 不因 runtime/Web 功能改进顺带升级 Windows Device Manager；两者继续独立发布。

实施上，Rust 能力放在 crates/，命令差异用 crates/runtime/src/acp/ 的薄适配解决，协议字段继续 camelCase。Web/shared UI 的上线要发布共享 UI 提交并由 main 派发 relay-deploy.yml，传完整 thread_ui_sha；只重启设备 Supervisor 不会更新公共 Web。本次仅分析和文档化，未执行发布。

## 8. 代码依据与复核方式

全文链接固定到本次查看的提交，便于之后版本变化时复核。对我方 UI 的判断同时使用了独立共享 UI 仓库；不能只看 apps/supervisor-web 的适配层。

建议复核关键路径：

1. 看双方 Agent 执行入口，确认“原生 harness 控制”与“自有 AgentLoop”差别。
2. 看 NarraFork schema/fork/摘要编辑，确认引用共享与 copy-on-write。
3. 对照双方文件保存，确认版本冲突机制差距。
4. 看双方 mailbox/recovery，确认双方都实现了持久化与未知结果保护。
5. 看 Dynamic Spec 顶部状态，避免把规划功能算作已上线。
6. 看我方 shared UI、Rust 插件路由及搜索实现，避免遗留代码和 README 导致误判。

本次变更仅为这份分析文档，未改动运行时代码，也未运行编译、crate 测试或浏览器套件。克隆目录保留在 Git 忽略区，便于继续阅读。

[R-harness]: https://github.com/dufangshi/remoteCodex/blob/94edcfadc8a6dda5ebc23271ee582709d32af171/crates/runtime/src/acp/catalog.rs#L24
[R-cap]: https://github.com/dufangshi/remoteCodex/blob/94edcfadc8a6dda5ebc23271ee582709d32af171/crates/runtime/src/acp/capabilities.rs#L76
[R-adapter]: https://github.com/dufangshi/remoteCodex/blob/94edcfadc8a6dda5ebc23271ee582709d32af171/crates/runtime/src/acp/adapter.rs#L160
[R-local]: https://github.com/dufangshi/remoteCodex/blob/94edcfadc8a6dda5ebc23271ee582709d32af171/crates/runtime/src/local_sessions.rs#L40
[R-fork]: https://github.com/dufangshi/remoteCodex/blob/94edcfadc8a6dda5ebc23271ee582709d32af171/crates/runtime/src/service.rs#L2966
[R-interaction]: https://github.com/dufangshi/remoteCodex/blob/94edcfadc8a6dda5ebc23271ee582709d32af171/crates/runtime/src/interaction/mod.rs#L169
[R-agents]: https://github.com/dufangshi/remoteCodex/blob/94edcfadc8a6dda5ebc23271ee582709d32af171/crates/runtime/src/interaction/agents.rs#L1
[R-task]: https://github.com/dufangshi/remoteCodex/blob/94edcfadc8a6dda5ebc23271ee582709d32af171/crates/runtime/src/interaction/tasks.rs#L1
[R-peer]: https://github.com/dufangshi/remoteCodex/blob/94edcfadc8a6dda5ebc23271ee582709d32af171/docs/cross-device-peer.zh.md#L1
[R-secure]: https://github.com/dufangshi/remoteCodex/blob/94edcfadc8a6dda5ebc23271ee582709d32af171/crates/supervisor/src/secure_transport.rs#L1
[R-preview]: https://github.com/dufangshi/remoteCodex/blob/94edcfadc8a6dda5ebc23271ee582709d32af171/crates/relay/src/preview.rs#L1
[R-metrics]: https://github.com/dufangshi/remoteCodex/blob/94edcfadc8a6dda5ebc23271ee582709d32af171/crates/runtime/src/device_metrics.rs#L1
[R-hosted]: https://github.com/dufangshi/remoteCodex/blob/94edcfadc8a6dda5ebc23271ee582709d32af171/crates/relay/src/hosted.rs#L20
[R-release]: https://github.com/dufangshi/remoteCodex/blob/94edcfadc8a6dda5ebc23271ee582709d32af171/docs/npm-native-release.zh.md#L1
[R-push]: https://github.com/dufangshi/remoteCodex/blob/94edcfadc8a6dda5ebc23271ee582709d32af171/crates/relay/src/notifications.rs#L5
[R-file]: https://github.com/dufangshi/remoteCodex/blob/94edcfadc8a6dda5ebc23271ee582709d32af171/crates/runtime/src/files.rs#L312
[R-terminal]: https://github.com/dufangshi/remoteCodex/blob/94edcfadc8a6dda5ebc23271ee582709d32af171/crates/supervisor/src/shells.rs#L1
[R-acp-terminal]: https://github.com/dufangshi/remoteCodex/blob/94edcfadc8a6dda5ebc23271ee582709d32af171/crates/runtime/src/acp/terminal.rs#L1
[R-reliability]: https://github.com/dufangshi/remoteCodex/blob/94edcfadc8a6dda5ebc23271ee582709d32af171/crates/runtime/src/service/reliability.rs#L10
[R-update]: https://github.com/dufangshi/remoteCodex/blob/94edcfadc8a6dda5ebc23271ee582709d32af171/crates/runtime/src/service/update.rs#L8
[R-schedule]: https://github.com/dufangshi/remoteCodex/blob/94edcfadc8a6dda5ebc23271ee582709d32af171/docs/claude-scheduled-history.md#L1
[R-search]: https://github.com/dufangshi/remoteCodex/blob/94edcfadc8a6dda5ebc23271ee582709d32af171/crates/runtime/src/service/search.rs#L10
[R-plugins]: https://github.com/dufangshi/remoteCodex/blob/94edcfadc8a6dda5ebc23271ee582709d32af171/crates/supervisor/src/http.rs#L2179
[R-oauth]: https://github.com/dufangshi/remoteCodex/blob/94edcfadc8a6dda5ebc23271ee582709d32af171/crates/relay/src/oauth.rs#L1
[U-editor]: https://github.com/dufangshi/remote-codex-thread-ui-rust/blob/8e4c384d81012c229d1a780ea175fa2dbaa5c82b/packages/thread-ui/src/components/graph-workspace/GraphWorkspaceMonacoEditor.tsx#L2
[U-layout]: https://github.com/dufangshi/remote-codex-thread-ui-rust/blob/8e4c384d81012c229d1a780ea175fa2dbaa5c82b/packages/thread-ui/src/components/ThreadWorkspaceLayout.tsx#L1306
[U-save]: https://github.com/dufangshi/remote-codex-thread-ui-rust/blob/8e4c384d81012c229d1a780ea175fa2dbaa5c82b/packages/thread-ui/src/components/graph-workspace/explorer/useWorkspaceFilePreview.ts#L149
[N-loop]: https://github.com/NarraFork/NarraFork/blob/4e04d2f2e490bd57a5d8d712b709a574b905848a/server/lib/agent/loop.ts#L2651
[N-provider]: https://github.com/NarraFork/NarraFork/blob/4e04d2f2e490bd57a5d8d712b709a574b905848a/server/lib/agent/provider.ts#L160
[N-codex]: https://github.com/NarraFork/NarraFork/blob/4e04d2f2e490bd57a5d8d712b709a574b905848a/server/lib/agent/codex-provider.ts#L3
[N-schema]: https://github.com/NarraFork/NarraFork/blob/4e04d2f2e490bd57a5d8d712b709a574b905848a/server/db/schema.ts#L1464
[N-fork]: https://github.com/NarraFork/NarraFork/blob/4e04d2f2e490bd57a5d8d712b709a574b905848a/server/services/narrator-service.ts#L2535
[N-message-edit]: https://github.com/NarraFork/NarraFork/blob/4e04d2f2e490bd57a5d8d712b709a574b905848a/server/services/narrator-messages.ts#L4902
[N-compact]: https://github.com/NarraFork/NarraFork/blob/4e04d2f2e490bd57a5d8d712b709a574b905848a/server/routes/narrators.ts#L3724
[N-compose]: https://github.com/NarraFork/NarraFork/blob/4e04d2f2e490bd57a5d8d712b709a574b905848a/shared/context-composition.ts#L1
[N-compose-ui]: https://github.com/NarraFork/NarraFork/blob/4e04d2f2e490bd57a5d8d712b709a574b905848a/frontend/components/narrator/context-management/ContextCompositionMenu.tsx#L44
[N-dock]: https://github.com/NarraFork/NarraFork/blob/4e04d2f2e490bd57a5d8d712b709a574b905848a/frontend/components/narrator/workspace/DockviewWorkspace.tsx#L1
[N-panel]: https://github.com/NarraFork/NarraFork/blob/4e04d2f2e490bd57a5d8d712b709a574b905848a/server/services/workspace-panel-service.ts#L489
[N-delivery]: https://github.com/NarraFork/NarraFork/blob/4e04d2f2e490bd57a5d8d712b709a574b905848a/server/services/agent-message-delivery.ts#L1
[N-policy]: https://github.com/NarraFork/NarraFork/blob/4e04d2f2e490bd57a5d8d712b709a574b905848a/server/services/agent-runtime/policy.ts#L1
[N-vnet]: https://github.com/NarraFork/NarraFork/blob/4e04d2f2e490bd57a5d8d712b709a574b905848a/server/lib/vnet/crypto.ts#L1
[N-executor]: https://github.com/NarraFork/NarraFork/blob/4e04d2f2e490bd57a5d8d712b709a574b905848a/remote-executor/README.md#L1
[N-container]: https://github.com/NarraFork/NarraFork/blob/4e04d2f2e490bd57a5d8d712b709a574b905848a/server/services/container-service.ts#L44
[N-gateway]: https://github.com/NarraFork/NarraFork/blob/4e04d2f2e490bd57a5d8d712b709a574b905848a/server/gateway/gateway.ts#L1
[N-editor]: https://github.com/NarraFork/NarraFork/blob/4e04d2f2e490bd57a5d8d712b709a574b905848a/server/services/editor-document-worker.ts#L246
[N-terminal]: https://github.com/NarraFork/NarraFork/blob/4e04d2f2e490bd57a5d8d712b709a574b905848a/server/lib/agent/tools/terminal.ts#L1
[N-recovery]: https://github.com/NarraFork/NarraFork/blob/4e04d2f2e490bd57a5d8d712b709a574b905848a/server/services/update-recovery-service.ts#L86
[N-subrecover]: https://github.com/NarraFork/NarraFork/blob/4e04d2f2e490bd57a5d8d712b709a574b905848a/server/services/narrator-subagent-recovery.ts#L1
[N-chapter-fork]: https://github.com/NarraFork/NarraFork/blob/4e04d2f2e490bd57a5d8d712b709a574b905848a/server/services/chapter-fork.ts#L200
[N-merge]: https://github.com/NarraFork/NarraFork/blob/4e04d2f2e490bd57a5d8d712b709a574b905848a/server/services/chapter-merge.ts#L49
[N-git]: https://github.com/NarraFork/NarraFork/blob/4e04d2f2e490bd57a5d8d712b709a574b905848a/server/routes/git.ts#L265
[N-reverse]: https://github.com/NarraFork/NarraFork/blob/4e04d2f2e490bd57a5d8d712b709a574b905848a/server/services/file-change-reversal.ts#L1
[N-schedule]: https://github.com/NarraFork/NarraFork/blob/4e04d2f2e490bd57a5d8d712b709a574b905848a/server/services/scheduled-task-service.ts#L45
[N-schedule-tick]: https://github.com/NarraFork/NarraFork/blob/4e04d2f2e490bd57a5d8d712b709a574b905848a/server/services/scheduled-task-scheduler.ts#L1
[N-knowledge]: https://github.com/NarraFork/NarraFork/blob/4e04d2f2e490bd57a5d8d712b709a574b905848a/docs/KNOWLEDGE_BASE.md#L1
[N-knowledge-acl]: https://github.com/NarraFork/NarraFork/blob/4e04d2f2e490bd57a5d8d712b709a574b905848a/server/services/knowledge-acl.ts#L1
[N-knowledge-inject]: https://github.com/NarraFork/NarraFork/blob/4e04d2f2e490bd57a5d8d712b709a574b905848a/server/services/knowledge-injection.ts#L1
[N-fts]: https://github.com/NarraFork/NarraFork/blob/4e04d2f2e490bd57a5d8d712b709a574b905848a/server/db/fts.ts#L167
[N-search]: https://github.com/NarraFork/NarraFork/blob/4e04d2f2e490bd57a5d8d712b709a574b905848a/server/services/search-service.ts#L40
[N-plugins]: https://github.com/NarraFork/NarraFork/blob/4e04d2f2e490bd57a5d8d712b709a574b905848a/server/services/plugin-runtime.ts#L1
[N-sandbox]: https://github.com/NarraFork/NarraFork/blob/4e04d2f2e490bd57a5d8d712b709a574b905848a/server/services/plugin-podman-runner.ts#L58
[N-plugin-ui]: https://github.com/NarraFork/NarraFork/blob/4e04d2f2e490bd57a5d8d712b709a574b905848a/frontend/components/plugins/PluginDockPanel.tsx#L1
[N-oauth]: https://github.com/NarraFork/NarraFork/blob/4e04d2f2e490bd57a5d8d712b709a574b905848a/server/routes/external-v1.ts#L64
[N-oauth-acl]: https://github.com/NarraFork/NarraFork/blob/4e04d2f2e490bd57a5d8d712b709a574b905848a/server/services/oauth-resource-access.ts#L1
[N-vscode]: https://github.com/NarraFork/NarraFork/blob/4e04d2f2e490bd57a5d8d712b709a574b905848a/vscode-extension/src/extension.ts#L1
[N-i18n]: https://github.com/NarraFork/NarraFork/blob/4e04d2f2e490bd57a5d8d712b709a574b905848a/shared/i18n-locales.ts#L1
[N-takeover]: https://github.com/NarraFork/NarraFork/blob/4e04d2f2e490bd57a5d8d712b709a574b905848a/server/services/subagent-takeover.ts#L1
[N-eval]: https://github.com/NarraFork/NarraFork/blob/4e04d2f2e490bd57a5d8d712b709a574b905848a/server/services/benchmark-service.ts#L247
[N-team-spec]: https://github.com/NarraFork/NarraFork/blob/4e04d2f2e490bd57a5d8d712b709a574b905848a/docs/DYNAMIC_SPEC_TEAM_TASKS.md#L1
[N-switch]: https://github.com/NarraFork/NarraFork/blob/4e04d2f2e490bd57a5d8d712b709a574b905848a/server/lib/agent/tools/switch-device.ts#L6
[R-apns]: https://github.com/dufangshi/remoteCodex/blob/94edcfadc8a6dda5ebc23271ee582709d32af171/crates/relay/src/apns.rs#L1
[N-file-tree]: https://github.com/NarraFork/NarraFork/blob/4e04d2f2e490bd57a5d8d712b709a574b905848a/frontend/components/narrator/file-tree/FileTreePanel.tsx#L37
[N-editor-remote]: https://github.com/NarraFork/NarraFork/blob/4e04d2f2e490bd57a5d8d712b709a574b905848a/server/routes/editor-documents.ts#L68
