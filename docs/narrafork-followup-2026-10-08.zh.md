# NarraFork 专项方案与搜索、多语言交付

日期：2026-10-08。通过 pockymoe CLI 创建了五个子线程，均使用
`gpt-6.1-sol`、`high`。文件编辑、人工介入、工作台布局交付详细设计；搜索和
多语言交付实现。父线程完成代码审阅、两个仓库的整合及组合浏览器验证。

参考 NarraFork 固定提交为 `4e04d2f2e490bd57a5d8d712b709a574b905848a`。
总体相似点、差异及功能归属见[原始对比报告](narrafork-comparison-2026-10-07.zh.md)。
以下方案中的现状对照固定在原业务基线，不能把提议接口当作已实现能力。

## 三份详细方案

| 方向 | 最值得借鉴的部分 | 建议先做的改进 |
| --- | --- | --- |
| [文件浏览与编辑](proposals/narrafork-file-browser-editor-plan.zh.md) | 文档会话、版本与保存回执、固定冲突快照、文件树异步请求隔离 | 每文件草稿与 revision；带 expectedHash 的条件保存；保存中继续输入/切文件的正确结算；断线后未知写入结果恢复；有界且严格的文本预览 |
| [人工介入与多 Agent](proposals/narrafork-human-intervention-plan.zh.md) | 显式接管/归还控制权、人工工作时限制自动推进、成果交付闸门 | 持久化 humanHold；区分执行状态、自动驱动和成果发布；接管默认允许当前 turn 收尾；单独提供 Stop/steer；父线程 wait/wake、task done、队列恢复统一遵守 hold |
| [工作台布局与 UI](proposals/narrafork-workbench-layout-ui-plan.zh.md) | 多资源工作台、多会话同时可见、清晰导航上下文与布局恢复 | 明确设备/工作区身份；按来源隔离文件模型/草稿；双会话对照且只有一个明确输入目标；轻量协作进度与成果入口；手机保留一个主视图 |

三份文档均包含源码对照、用户流程、状态与接口草案、分阶段实施/验收及验证建议。
父线程将源码锚点转换为固定版本链接，检查了 93 个代码链接的文件与行号，以及
文档相对链接和 Markdown 代码围栏。它们是后续产品改造方案，本轮没有实现这三项。

对“谁更好”需要保留边界：我们的远程设备控制面、原生 harness 接续、加密传输、
任务依赖/inbox/wait 以及手机继续工作，是现成基础。NarraFork 更值得学习的是
文档生命周期和多资源组织。其当前 FileTreePanel 仅为 local 设置根目录，编辑
文档路由明确拒绝远程 transfer；不能由它的本地编辑体验推导出远程编辑全面领先。
我们也已有 Monaco、虚拟文件树、多格式预览、文件标签与聊天/文件分栏。

暂缓完整 Dockview 和自由浮动 IDE。先解决草稿、安全保存、清晰发送目标与协作
进度。关闭面板仅关闭视图，不停止 Agent；查看结果也不能自动确认 Agent inbox。
人工接管必须持久化，不能照搬仅内存的 hold。

## 已实现：所选设备上的跨会话搜索

- 范围：当前会话、当前工作区、当前设备。新增范围搜索已持久化的线程标题、用户
  与助手消息；结果有片段、线程/工作区来源和原始消息定位，支持分页、键盘操作、
  取消旧请求，跨线程跳转及刷新后恢复定位。
- 存储：设备 SQLite migration 11，一次性回填投影与 FTS5 trigram 索引；流式
  消息、标题编辑、fork、来源变化和删除在写入事务中增量维护。
- 查询：Unicode 大小写处理，中文及一两个字符查询可用；按字面子串匹配，标点、
  `%`、`_`、引号和 FTS 操作符不会改变查询语义。短词只扫描设备侧的会话投影，
  返回片段和页数有界，不把全部历史下载到浏览器。
- 权限：仅单线程分享或工作区文件权限不能枚举其他会话；relay 先鉴权，设备执行
  查询。搜索请求/结果使用现有加密传输，不新建 relay 明文聊天索引。
- 兼容：旧设备的新增端点返回 404 时提供中英提示，保留范围选择，等待用户主动
  切回单会话；网络错误、403 不会误判成不支持，也不会静默扩大查询范围。

当前不聚合账号下多个设备/离线设备，不搜索文件、工具输出、附件或尚未导入的
原生历史。多用户 hosted VM 的全局/工作区搜索暂拒绝，直到有设备强制执行的
租户线程 allowlist；单线程搜索仍可用。首次索引回填耗时与会话文本量相关，分页
基于实时数据，尚无大规模性能实测。详见[搜索说明](global-search.md)。

## 已实现：统一中英界面

共享 `@pockymoe/thread-ui/i18n` store，宿主和懒加载面板使用同一语言状态。
支持 English/简体中文、浏览器语言识别、英语回退、手动选择、刷新持久化和跨
标签页同步；日期/数字跟随所选语言。整合资源实际包含 **2,260 个中英配对 key**。

主要工作台、聊天、搜索、文件编辑、终端外层、设置、设备、认证与分享流程均已
接入。语言切换不会改写用户/模型内容、文件、命令与协议字段。父线程审查后补齐
导入时固定提示、linked-files/时间线等 memo 标签的语言依赖；新操作使用新语言，
已经发生的通知保持原文。详见[覆盖与限制](i18n.md)及[专项验证记录](i18n-validation.md)。

Monaco/Draw.io 的第三方内部菜单、原生进程输出、原始服务器错误等仍保留原文；
真实 Relay/OAuth/托管 VM/通行密钥全链路没有在本轮浏览器验证中启动。

## 复核与验证

实现线程交付的定向 Rust 检查均通过：

```sh
cargo fmt --all --check
cargo check -p pockymoe-supervisor -p pockymoe-relay -j 2
cargo test -p pockymoe-runtime --test db_migration --test global_search -j 2
cargo test -p pockymoe-supervisor --test http_e2e conversation_search_reads_bounded_messages_without_hydrating_history -j 2
cargo test -p pockymoe-relay route_acl::tests -j 2
```

覆盖迁移/回填 5 测试、索引查询/维护 2 综合测试、HTTP 1 测试、relay ACL 6 测试。
父线程核对整合后的 Cargo/crates 与已测搜索分支没有差异，并在主仓库成功执行
`cargo build -p pockymoe -j 2`，确保浏览器测试消费新 Supervisor。

父线程对最终组合版本执行：

```sh
corepack pnpm --dir pockymoe-thread-ui --filter @pockymoe/thread-ui build
corepack pnpm install --offline --frozen-lockfile
corepack pnpm --dir pockymoe-thread-ui --filter @pockymoe/thread-ui typecheck
corepack pnpm --filter @pockymoe/supervisor-web typecheck
corepack pnpm --dir pockymoe-thread-ui --filter @pockymoe/thread-ui exec vitest run src/i18n/i18n.test.tsx src/components/ConversationSearchControls.test.tsx
corepack pnpm --filter @pockymoe/supervisor-web exec vitest run src/components/ConversationSearch.test.tsx
PATH="$PWD/.temp/bin:$PATH" \
E2E_API_PORT=18183 E2E_WEB_PORT=15183 \
E2E_DATABASE_URL="$PWD/.temp/narrafork-integration/e2e.sqlite" \
E2E_WORKSPACE_ROOT="$PWD/.temp/narrafork-integration/workspaces" \
corepack pnpm exec playwright test e2e/global-search.spec.ts e2e/i18n.spec.ts --project=desktop-chromium
```

结果：构建和双方类型检查通过，组件回归 **11 + 9 测试通过**，组合浏览器
**3 测试通过（9.5 秒）**。核对消费方 `dist/index.js` 与 `dist/i18n.js` 和共享
UI 产物一致。组合浏览器覆盖跨线程搜索/键盘跳转/刷新、中文搜索结果切英文、
文件编辑保存与草稿保留，以及 390×844 窄屏语言入口/初始化/回退。

搜索线程另外已通过 mobile-chromium 搜索用例；多语言缓存修复另有 77 条定向
回归通过。各批有重叠，不把它们相加声称唯一测试总数。测试使用隔离数据库/
工作区并清空继承的 POCKYMOE 连接设置；没有改动正式 Supervisor/数据库，
没有运行 cargo workspace、完整浏览器或兼容矩阵。

## 提交与发布边界

- 主仓库功能整合：`e2ef712e`（中英）、`54b5bc7c`（搜索）、`40107ee0`
  （切语言徽标）、`ad2b5b05`（旧端点提示）；三份方案为 `9f995e38`。
- 共享 UI 最终组合产物：`970408b3772efccdae2b20153dec027aac9c4fef`。
- 公共 Web 按项目要求从 main 调用 `relay-deploy.yml`，固定上述完整 UI SHA。
  只重启设备 Supervisor 不会发布公共 Web。
- 本轮未变更 runtime/npm 版本或 Windows Device Manager。现有设备须运行包含
  新后端的 runtime 才能启用工作区/设备搜索；发布公共 Web 不会自动升级它们。
