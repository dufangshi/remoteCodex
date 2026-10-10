# 中英界面定向验证记录

日期：2026-10-08。对应 `docs/i18n.md` 的实现与覆盖清单。所有依赖安装、构建和
测试都在 `nf-i18n` worktree 内执行；未 push、部署、发版或修改正式 Supervisor。
共享 UI 共有 2,231 个配对翻译 key。

## 构建与类型

以下命令均退出 0；共享 UI 构建完成后重新安装主 worktree 的 file 依赖。

```sh
corepack pnpm --dir pockymoe-thread-ui --filter @pockymoe/thread-ui build
corepack pnpm install --offline --frozen-lockfile
corepack pnpm --dir pockymoe-thread-ui --filter @pockymoe/thread-ui typecheck
corepack pnpm --filter @pockymoe/supervisor-web typecheck
```

两个仓库的 `git diff --check` 通过。未改 Rust crates，未运行 Rust workspace
测试、根 pnpm build、兼容矩阵或完整浏览器套件。

## 单元/组件回归

以下命令均通过。测试组有重叠，不能把各组数量直接相加为唯一测试总数。

| 工作目录 | 命令（pnpm 使用 corepack） | 结果 |
| --- | --- | --- |
| 共享 UI | `pnpm --filter @pockymoe/thread-ui test src/i18n/i18n.test.tsx src/components/GroupedThreadTabs.test.tsx src/components/composer/composerPresentation.test.ts src/components/graph-workspace/explorer/WorkspaceExplorerTree.test.tsx` | 4 文件，20 测试通过（当时 locale 8 测试） |
| 共享 UI | `pnpm --filter @pockymoe/thread-ui test src/i18n/i18n.test.tsx src/components/GroupedThreadTabs.test.tsx src/components/composer/ComposerHooksPanel.test.tsx` | 3 文件，16 测试通过 |
| 共享 UI | `pnpm --filter @pockymoe/thread-ui test src/i18n/i18n.test.tsx src/components/GroupedThreadTabs.test.tsx src/components/graph-workspace/GraphDrawioPreview.test.tsx` | 3 文件，15 测试通过（locale 已增至 9 测试） |
| 主仓库 | `pnpm --filter @pockymoe/supervisor-web test src/components/ConversationSearch.test.tsx src/components/RuntimeManagement.test.tsx src/components/ThreadPublicLinks.test.tsx src/components/UpstreamManagement.test.tsx src/components/DeviceEncryptionStatus.test.tsx` | 5 文件，19 测试通过 |
| 主仓库 | `pnpm --filter @pockymoe/supervisor-web test src/lib/transcriptExport.test.tsx` | 1 文件，2 测试通过 |
| 共享 UI | `pnpm --filter @pockymoe/thread-ui test src/i18n/i18n.test.tsx src/components/composer/composerUtils.test.ts src/components/graph-chat/GraphChatMessageFrame.test.tsx` | 实际匹配 2 文件，40 测试通过；MessageFrame 测试文件不存在，未作为已验证文件统计 |
| 共享 UI | `pnpm --filter @pockymoe/thread-ui test src/components/graph-chat/GraphChatCompactMessageItem.test.tsx` | 1 文件，5 测试通过；覆盖实际使用 MessageFrame 的组件 |
| 主仓库 | `pnpm --filter @pockymoe/supervisor-web test src/lib/notificationWorker.test.ts src/components/ConversationSearch.test.tsx` | 2 文件，4 测试通过 |

Locale 的 9 个测试覆盖 aliases/unsupported fallback、浏览器检测/保存优先级、
资源 key 和插值占位符一致、英语资源回退、插值不递归、复数、日期/数字、实时切换、
存储失败/cross-tab 同步，以及 `[PHOTO ...]` / `[FILE ...]` 原生提示词标记不变。
部分既有 Hook/GraphChat 测试打印 React `act` 警告，但没有测试失败。

## 浏览器

最终运行命令：

```sh
PATH="$PWD/.temp/bin:$PATH" \
E2E_API_PORT=18182 E2E_WEB_PORT=15182 \
E2E_DATABASE_URL="$PWD/.temp/i18n/e2e.sqlite" \
E2E_WORKSPACE_ROOT="$PWD/.temp/i18n/workspaces" \
corepack pnpm exec playwright test e2e/i18n.spec.ts --project=desktop-chromium
```

**2 测试通过，8.1 秒。**

- 桌面：English → 简体中文 → English；宿主设置和共享工作台同步；输入草稿、用户
  标题、文件名保持原文；打开延迟加载的文件浏览器/Monaco，编辑并保存原文文件；
  两个方向刷新均保留语言选择。
- 窄屏 390×844：`zh-SG` 浏览器初始化简体中文；通过移动导航打开设置并切换英语；
  刷新持久生效；不支持的已保存 `fr-FR` 明确回退英语。

测试 Supervisor 用隔离数据库和工作区，配置清空正式 POCKYMOE relay 参数。
fake ACP 使用 `ios-e2e-stream`；Rust 可执行文件来自固定主线已有构建的本地副本，
没有重新编译无改动的 crates 或连接真实模型凭据。

首次定向运行发现 lazy import 工厂中的非法 hook，并修复了两处；随后根据实际
可访问名称修正文件编辑器测试定位，并使用文件树原有键盘交互打开文件。最终两个
测试一起通过，未加长超时或开启 retry。Vite 的页面刷新 websocket ECONNRESET
和环境 FORCE_COLOR 警告不影响结果。

真实 Relay/OAuth/托管 VM/passkey 服务及第三方 Monaco/Draw.io 内部菜单没有进行
本轮浏览器端到端验证，范围和仍保留原文的界面见 `docs/i18n.md`。

## Task #7：语言缓存定向补充修复

父线程交付审查发现两处导入时翻译和两处 memo 文案缓存。修复将 MCP 成功提示、
Shell 超时提示的翻译移到新操作发生时，并让 linked-files、Working/Confirming/
Worked duration 的 memo 按 locale 重算。小范围同类审查补齐顶栏用量、图节点/
工具标签、实时 Hook 摘要和共享访问徽标的语言依赖；不重建文件 adapter/model 或
输入草稿。新增三个 Worked duration 配对 key，中英资源共 2,234 keys。

没有改 `useI18n().t` 身份：它仍是稳定的、每次调用读取当前语言的全局函数；现有
使用没有 `[t]` memo 依赖。架构文档明确缓存显示标签用 `[locale, ...inputs]`。
模块级变量初始化、translate/Intl/helper 的 memo、memo 组件语言订阅进行了有界
源码检查；纯数据模型/过滤 memo、运行时错误和事件回调不机械添加 locale 依赖。

共享 UI 执行：

```sh
corepack pnpm --dir pockymoe-thread-ui --filter @pockymoe/thread-ui test \
  src/components/composer/useComposerMcpConfig.test.tsx \
  src/components/shell/shellEvents.test.ts \
  src/components/ThreadTimeline.test.tsx \
  src/components/graph-workspace/GraphWorkspaceExplorer.test.tsx \
  src/i18n/i18n.test.tsx
```

首轮 4 文件 51 测试通过，Shell 回归中一句中文标点期望写错导致 1 测试失败；
修正期望后仅重跑该相关文件：

```sh
corepack pnpm --dir pockymoe-thread-ui --filter @pockymoe/thread-ui test src/components/shell/shellEvents.test.ts
```

26 测试通过。最终五个相关文件合计 77 测试全部通过（四文件保留首轮通过结果）。
新增回归证明模块已经导入后，en→zh 的新 MCP raw/HTTP 保存和 terminal attach
超时使用新语言，之前创建的通知/错误保持原文；inProgress/recovering/completed
的 React.memo 时间线在 props 不变时刷新标签；linked-files 更新且不重请求文件树。

共享 UI typecheck、最后一次 shared build、更新主仓库 file dependency 后的主 Web
类型检查及两个仓库 `git diff --check` 通过。本轮不重复浏览器回归；父线程负责组合
search/i18n 浏览器链路。既有 MCP harness 测试仍有 React act 警告，测试未失败。
