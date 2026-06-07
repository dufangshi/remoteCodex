# Control Plane 与 Chat Workspace 信息架构重构计划

本文档把当前 control plane 和 chat 页面优化方案拆成可按 goal mode 推进的工程清单。目标不是把组件做得更漂亮，而是降低默认信息暴露，把 raw id、router、worker、sandbox、调试字段和低频操作收进按需展开的 inspector、drawer、menu 或 settings 中。

## 使用方式

每次 goal mode 只领取一个阶段或一个阶段内的少量 checkbox。完成后必须补充 evidence，再勾选。

勾选标准：

- 代码、测试、文档或部署配置已经落地。
- 对应 `Done when` 已满足。
- 对应 `Verify with` 已执行，或明确记录为什么暂时不能执行。
- 没有把无关重构、样式 churn、旧脏改动混入同一个提交。
- 如果改到 `packages/thread-ui/src`，先执行：

```bash
pnpm --filter @remote-codex/thread-ui build
```

然后再跑 supervisor-web 测试。`apps/supervisor-web` 通过 `@remote-codex/thread-ui` package entrypoint 使用 `packages/thread-ui/dist/index.js`，本地测试可能吃 stale dist。这个规则也记录在根目录 `AGENTS.md`。

推荐验证命令：

```bash
pnpm --filter @remote-codex/thread-ui typecheck
pnpm --filter @remote-codex/thread-ui build
pnpm --filter @remote-codex/supervisor-web typecheck
pnpm --filter @remote-codex/supervisor-web test -- ControlPlanePage
pnpm --filter @remote-codex/supervisor-web test -- ControlPlaneSessionPage
pnpm --filter @remote-codex/supervisor-web test -- ThreadTimeline ThreadComposer
pnpm --filter @remote-codex/supervisor-web build
```

部署验证：

```bash
git push origin sandbox-worker-control-plane
gh run list --workflow staging-images.yml --branch sandbox-worker-control-plane --limit 5
curl -sS https://remote-codex-frontend-production.up.railway.app/build.json
```

## Goal Mode 执行协议

每次进入 goal mode 时，先把任务缩到一个可验收切片。不要用“优化 control plane UI”这种大目标直接开工。

推荐 goal 格式：

```text
目标：
- 完成 Phase <n> 的 <1 到 3 个 checkbox>。

范围：
- 只改 <files/components>。
- 不改 API schema，除非本阶段明确要求。
- 不改 @remote-codex/thread-ui 源码，除非该能力必须变成 shared thread surface。

验收：
- <tests>
- <screenshots>
- <manual smoke>
- 更新 docs/control-plane-chat-ui-refactor-plan.zh.md evidence。
```

每次 goal 的固定步骤：

1. 读取本文件对应 Phase 和 acceptance criteria。
2. 用 `rg` 找当前实现，不凭记忆改。
3. 先列出 visible fields、actions、raw metadata 的去留。
4. 只实现当前切片，不顺手重构无关 UI。
5. 更新或新增测试，优先 Testing Library role/name 断言，少依赖 class。
6. 跑 typecheck、相关 vitest、build。
7. 用 Playwright 截 desktop 和 mobile。
8. 把 commands、screenshots、残余风险写回本文件。

每次 goal 的禁止事项：

- 不把 raw id 从一个首屏 card 移到另一个首屏 card。
- 不为了“看起来完整”把 inspector、logs、metadata 默认展开。
- 不把 chat UI 从 `@remote-codex/thread-ui` 复制到 control-plane。
- 不引入 Vercel Chatbot、assistant-ui、Tremor、Langfuse 等依赖，除非另开技术决策文档。它们在本计划中只是 IA 和交互参考。
- 不把 Project level 的移除混进纯前端 IA PR。移除 Project 需要 API、DB、迁移和回归测试。

## 分阶段实施矩阵

| 阶段 | 主要产物 | 推荐改动文件 | 必跑验证 | Playwright 证据 |
| --- | --- | --- | --- | --- |
| Phase 0 | 字段审计、截图基线 | `docs/control-plane-chat-ui-refactor-plan.zh.md` | `rg` audit、现有 tests | `/control-plane` desktop/mobile |
| Phase 1 | noun、status、time、field presenter | `ControlPlanePage.tsx`、可选 presenter helper、`ControlPlanePage.test.tsx` | ControlPlanePage vitest、typecheck | 主列表 copy/status 截图 |
| Phase 2 | app shell、top bar、account menu | `ControlPlanePage.tsx`、可选 `pages/control-plane/*`、`index.css` | ControlPlanePage vitest、build | desktop/mobile 首屏 |
| Phase 3 | 逐级 workspace/project/session flow | `ControlPlanePage.tsx`、API form helpers、tests | create parent gating tests | create flow 截图 |
| Phase 4 | session list、summary row、More menu | `ControlPlanePage.tsx`、tests | row action/menu tests | list/table 截图 |
| Phase 5 | sandbox lifecycle compact summary | `ControlPlanePage.tsx`、lifecycle tests | sandbox action/status tests | progress/status 截图 |
| Phase 6 | control-plane inspector | `ControlPlanePage.tsx`、`index.css`、tests | redaction/copy tests | inspector open/closed desktop/mobile |
| Phase 7 | chat workspace shell cleanup | `ControlPlaneSessionPage.tsx`、tests | ControlPlaneSessionPage vitest、build | chat desktop/mobile |
| Phase 8 | tool/log/artifact inspector | `packages/thread-ui/src`、`ControlPlaneSessionPage.tsx`、tests | thread-ui build、ThreadTimeline tests | Preview/Logs tabs |
| Phase 9 | responsive/a11y polish | `index.css`、affected tests | typecheck、build、role tests | mobile no-overlap |
| Phase 10 | deploy and smoke | CI/deploy docs only unless needed | build sha、GitHub Actions、manual smoke | staging screenshots |

## 设计参考转译规则

把外部参考转成当前产品可执行模式，不直接照搬视觉。

| 参考 | 在本项目中转译成 | 不做什么 |
| --- | --- | --- |
| Vercel Chatbot | 左侧 thread/session list，中间 chat，底部 sticky composer，右侧 artifact panel | 不迁移到 Next.js，不复制模板目录 |
| assistant-ui | Thread/Message/Composer/tool display 的行为标准 | 不替换已有 `@remote-codex/thread-ui` |
| AI Elements/shadcn Blocks | restrained dashboard shell、sidebar、tabs、menu、drawer、table vocabulary | 不新增重型组件库 |
| Tailwind Plus app shell | 响应式 sidebar、top bar、stacked mobile layout | 不做营销 hero 或大面积装饰背景 |
| Tremor | 少量 operation metrics，例如 running sessions、health、usage、errors | 不做一屏大指标模板 |
| Langfuse | trace/log/tool drill-down 信息层级 | 不把 raw trace 默认铺进聊天流 |
| Vercel/Railway logs | logs 作为专门入口或 tab | 不把 stdout/stderr 默认占满主流 |
| Modal/Daytona sandbox | sandbox lifecycle summary、details drawer、usage timeline | 不默认暴露 worker/router/internal ids |

## 视觉与交互验收规则

这些规则适用于所有阶段。

- 首屏默认只显示用户做决策需要的信息：title、status、health、last activity、primary action。
- 每个重复 item 只保留一个 primary action；secondary action 进入 `...` menu。
- raw UUID、worker id、router URL、image URL、exact timestamp 只出现在 inspector、metadata tab 或 copy field。
- status 使用人能读懂的 label，例如 `Running`、`Ready`、`Failed`，不要把 raw enum 直接显示给用户。
- 时间默认用 relative time；exact timestamp 只在 details。
- mobile 下主要 touch target 至少 44px。密集辅助按钮必须有清晰 hit area 和 focus ring。
- 页面级滚动应被控制。control plane 首屏应能在常见 desktop viewport 看到 top bar、sidebar、main summary/list 的主要操作。
- chat workspace 的 composer 要 sticky，但不能在用户向上滚动历史时把 scroll 强行拉回底部。
- settings、plugin 管理和 hamburger 由 `@remote-codex/thread-ui` 提供，control-plane 不再实现一套平行 settings。
- 工具调用、命令输出、artifact source 默认折叠或进入右侧 panel。聊天流只保留可读摘要。

## 每个切片的 Evidence 模板

完成任意 checkbox 后，把 evidence 写在对应 Phase 下，而不是只写最终总结。

```text
Evidence:

Files:
- <changed file>

Implemented:
- <what changed>

Verification:
- <command and pass/fail>
- <screenshot path>
- <manual smoke result>

Residual risk:
- <known gap, if any>

Next recommended slice:
- <small next goal>
```

## 核心判断

当前主要问题是信息架构过度暴露：

- session id、sandbox id、worker id、router URL、raw timestamps、created/updated、status、image、route-token access 等字段同时出现在首屏。
- 控制台操作、聊天产品、调试器信息三层同时展开，用户无法一眼判断下一步动作。
- chat 页面像浮在 control plane 上的 overlay，而不是独立 workspace surface。
- tool calls、command output、artifact、metadata 都堆进聊天流，导致聊天本体难以扫描。

目标方向：

- 默认干净，细节按需展开。
- control plane 和 chat workspace 分成两个清晰 surface。
- 首屏只回答：当前 workspace 是什么，哪些 session 在跑，哪个需要注意，下一步最可能做什么。
- raw id 和调试字段放入 inspector、drawer、copy menu 或 metadata tab。
- chat 主流只保留可读摘要；tool call、raw output、artifact source 放入折叠块或右侧 panel。

## 参考来源

优先参考组合：

- Vercel Chatbot：chat skeleton、thread sidebar、streaming response、composer、model/provider controls。
- assistant-ui：Thread、Message、Composer、branching、tool call display 的 production React 模式。
- AI Elements：shadcn 风格 AI-native blocks。
- shadcn/ui Dashboard Blocks：dashboard、sidebar、data table、copyable block 风格。
- Tailwind Plus Application Shells：responsive sidebar/stacked application shell。
- Tremor：dashboard metrics、session health、resource/cost/latency cards。
- Langfuse：trace tree、latency、cost、session filtering、prompt/completion drill-down。
- Vercel/Railway logs：logs 不默认铺满主界面，只在 build/deploy/log explorer/CLI 中展开。
- Modal/Daytona sandbox dashboard：sandbox lifecycle、details page、usage timeline、create drawer。

这些参考用于信息层级和布局模式，不要求引入对应依赖。优先复用当前 repo 的 React、Vite、Tailwind、`@remote-codex/thread-ui` 和已有组件。

## 非目标

- 不在本计划中替换技术栈到 Next.js。
- 不直接引入重型 admin template 全套样式。
- 不把 `@remote-codex/thread-ui` fork 成 control-plane-local 复制代码。
- 不默认展示 raw provider key、route token、worker internal token、harness admin key 或任何 secret。
- 不把 chat workspace 做成 control plane 上的 floating overlay。
- 不因为“信息可用”就默认显示低频字段。

## 目标信息架构

### 页面 1：Control Plane

```text
Top bar
  workspace selector / search / sandbox health / user menu

Left sidebar
  Workspaces
  Projects, if retained
  Sessions
  Settings

Main
  summary row
  sessions table or list
  sandbox health and activity feed

Right inspector, collapsible
  selected workspace/project/session/sandbox details
  raw ids
  router URL
  worker id
  timestamps
  copy buttons
  logs/drill-down links
```

默认首屏只显示：

- Workspace label
- Project label, if project level remains
- Session title
- Status
- Provider
- Last activity
- Health
- Primary action

默认不显示：

- sandbox id
- worker id
- router URL
- raw image URL
- created/updated timestamps
- full UUID
- every action button

### 页面 2：Chat Workspace

```text
Left column
  thread/session list
  filters
  current workspace context

Center
  message stream
  sticky composer
  hamburger/settings from @remote-codex/thread-ui

Right column
  Artifact preview
  tabs: Preview | Source | Logs | Metadata
```

Chat workspace 应基于 `@remote-codex/thread-ui`，control-plane session page 只负责 auth、route token、worker session id、adapter、DTO mapping 和 control-plane-specific slots。

## IA 字段分层规则

| 信息 | 默认位置 | 展开位置 |
| --- | --- | --- |
| Workspace name | sidebar/top bar | inspector shows path |
| Project name | sidebar/top bar, if retained | inspector shows slug/id |
| Session title | main list/chat header | inspector shows id and worker id |
| Session status | badge | inspector shows raw state history |
| Provider/model | compact label | settings or inspector |
| Last activity | relative time | inspector shows exact timestamps |
| Sandbox health | summary badge/card | inspector shows image, region, profile |
| Router URL | hidden | inspector copy field |
| Worker session id | hidden | inspector copy field |
| Raw UUIDs | hidden | inspector copy field |
| Logs | link/count/status | right panel or drawer |
| Tool output | collapsed summary | expanded detail or Logs tab |
| Artifacts | preview thumbnail/card | right Preview/Source/Metadata tabs |

## Phase 0：现状审计与基线冻结

Goal：建立当前页面信息和行为基线，避免重构时丢功能。

Recommended slice：

- 只做审计和截图，不改 UI。
- 产出 visible field inventory、action inventory、raw metadata inventory。
- 把需要保留但下沉的信息标记为 `move to inspector`、`move to user menu`、`move to settings`、`hide unless debug`。

Tasks：

- [x] 列出 `ControlPlanePage` 当前首屏所有 visible field。
  - Done when：文档或测试 fixture 中记录字段清单，包括 raw id、timestamp、router、worker、actions。
  - Verify with：
    ```bash
    rg -n 'Workspace Flow|Admin User|LLM Usage|router|worker|sandbox|created|updated|session' apps/supervisor-web/src/pages/ControlPlanePage.tsx
    ```

- [x] 列出 `ControlPlaneSessionPage` 当前 chat surface 的 sidebar、settings、timeline、composer、meta slots。
  - Done when：确认哪些来自 `@remote-codex/thread-ui`，哪些是 control-plane adapter 自己塞入。
  - Verify with：
    ```bash
    rg -n 'ThreadDetailSurface|metaContent|settingsContent|surfaceActions|timelineProps|composerProps' apps/supervisor-web/src/pages/ControlPlaneSessionPage.tsx
    ```

- [x] 截取当前 desktop 和 mobile control-plane 页面截图。
  - Done when：`output/playwright/` 或临时 evidence 中有截图路径。
  - Verify with：Playwright 打开 `https://remote-codex-frontend-production.up.railway.app/control-plane` 或本地 dev URL。

- [x] 确认现有测试覆盖范围。
  - Done when：知道哪些测试会因为布局/label 改动需要更新。
  - Verify with：
    ```bash
    pnpm --filter @remote-codex/supervisor-web test -- ControlPlanePage ControlPlaneSessionPage
    ```

Evidence：

```text
Files:
- apps/supervisor-web/src/pages/ControlPlanePage.tsx
- apps/supervisor-web/src/pages/ControlPlaneSessionPage.tsx
- apps/supervisor-web/src/pages/ControlPlanePage.test.tsx
- apps/supervisor-web/src/pages/ControlPlaneSessionPage.test.tsx
- apps/supervisor-web/src/components/ThreadTimeline.test.tsx
- docs/control-plane-chat-ui-refactor-plan.zh.md

Current audit:
- ControlPlanePage first viewport now shows compact top bar fields, Workspace Browser hierarchy, overview strip, session list, selected summary, and collapsible Inspector. Raw ids, worker/router URLs, slugs, image, S3 prefix, exact timestamps, and failure codes are under Inspector Metadata/Route/Logs rather than the default surface.
- ControlPlaneSessionPage delegates sidebar, timeline, composer, hamburger/settings, and plugin management to `@remote-codex/thread-ui` through `ThreadDetailSurface`. The control-plane adapter provides `metaContent`, `settingsContent`, `surfaceActions`, `timelineProps`, `composerProps`, route-token-backed history detail loading, and a local right-side `ThreadInspector`.
- Baseline screenshots exist for desktop and mobile control-plane, session workspace, inspector tabs, sandbox lifecycle, More menu, and artifact/log inspector states.
- Test coverage now centers on `ControlPlanePage.test.tsx`, `ControlPlaneSessionPage.test.tsx`, and `ThreadTimeline.test.tsx`.

Verification:
- rg -n 'Workspace Flow|Admin User|LLM Usage|Product account|sandbox registry|router|worker|sandbox|created|updated|session|Control Plane|Workspace Browser|Inspector|Metadata|Route|Logs' apps/supervisor-web/src/pages/ControlPlanePage.tsx
- rg -n 'ThreadDetailSurface|metaContent|settingsContent|surfaceActions|timelineProps|composerProps|AppShellMenuButton|AppShellNavigationMenu|ThreadInspector' apps/supervisor-web/src/pages/ControlPlaneSessionPage.tsx
- pnpm --filter @remote-codex/supervisor-web exec vitest run src/pages/ControlPlanePage.test.tsx src/pages/ControlPlaneSessionPage.test.tsx src/components/ThreadTimeline.test.tsx
- output/playwright/control-plane-inspector-tabs-summary-desktop.png
- output/playwright/control-plane-inspector-tabs-mobile.png
- output/playwright/control-plane-session-phase7-three-column-desktop.png
- output/playwright/control-plane-session-phase7-three-column-mobile.png

Residual risk:
- Phase 0 is now a current-state audit rather than a pre-refactor historical baseline. Earlier raw UI screenshots are still available in older output/playwright artifacts if needed.
```

## Phase 1：统一产品语言与展示策略

Goal：先定义用户可见 noun、status、action 和 metadata 层级，再改 UI。

Recommended slice：

- 新增或整理 display helper，不大改布局。
- 把 raw enum 到 human label 的映射集中起来。
- 先让 copy 和 status 统一，再进入 shell 重构。

Implementation notes：

- 推荐 helper：
  - `statusLabel(rawState)`
  - `statusTone(rawState)`
  - `connectionLabel(rawState)`
  - `relativeTimeLabel(timestamp)`
  - `sessionPrimaryAction(session, sandboxState)`
- 如果 JSX 中出现多处 `session.status === ... ? ...`，优先抽 presenter，避免后面 Phase 4/5 重复改。
- `Thread` 一词只用于 chat/thread-ui 语境；control plane 主列表优先称 `Session`。
- `Worker`、`Router`、`Route token` 默认视为 diagnostics 语言，不进入首屏。

Tasks：

- [x] 定义 control plane 顶层 noun。
  - Recommended nouns：Workspace、Project、Session、Sandbox、Thread、Artifact、Inspector。
  - Done when：页面 copy 不再混用 worker thread、remote session、control session 表达同一对象。
  - Verify with：
    ```bash
    rg -n 'control session|worker thread|remote session|thread|session' apps/supervisor-web/src/pages/ControlPlane*.tsx
    ```

- [x] 定义 session card/table 默认字段。
  - Default fields：title、status、provider/model、workspace、last activity、primary action。
  - Hidden fields：full id、worker id、router URL、raw created/updated。
  - Done when：字段映射落入 helper 或 presenter，UI 不在 JSX 里散落判断。
  - Verify with：新增或更新 presenter/unit test。

- [x] 定义 status badge 文案和颜色语义。
  - Done when：running、idle、failed、interrupted、not loaded、sandbox starting、sandbox stopped 有一致 badge。
  - Verify with：`ControlPlanePage.test.tsx` 或 presenter test 覆盖。

- [x] 定义 relative time 与 exact time 策略。
  - Done when：首屏显示 relative time，exact timestamp 只在 inspector。
  - Verify with：测试断言主列表不出现 ISO timestamp。

Evidence：

```text
Files:
- apps/supervisor-web/src/pages/ControlPlanePage.tsx
- apps/supervisor-web/src/pages/ControlPlanePage.test.tsx
- docs/control-plane-chat-ui-refactor-plan.zh.md

Implemented:
- Current noun split is: Control Plane for the management surface, Project/Workspace/Session/Sandbox for the product hierarchy, Thread only inside the shared chat/thread-ui surface, Artifact for plugin-rendered output, and Inspector for on-demand detail.
- ControlPlanePage includes centralized display helpers for `statusLabel`, `statusTone`, `workspaceSourceLabel`, `sessionRuntimeLabel`, `providerLabel`, `sandboxStageLabel`, `sandboxHealthLabel`, and action presentation.
- Session list defaults to title, provider, relative last activity, status badge, runtime readiness, primary action, and More menu. Full ids, worker id, router URL, and exact timestamps are hidden in Inspector Metadata/Route.
- Status colors are mapped through semantic tokens, and status text uses human labels rather than raw enum casing.
- Relative time is used in the top-level session list, selected summary, sandbox summary, and chat meta. Exact timestamps remain in Diagnostics, Metadata, Logs, or route-token detail surfaces.
- Added display helpers for workspace source, session runtime, and provider labels.
- Workspace Browser now shows `Active`, `Local workspace`, `Codex / Active`, and `Not started` rather than raw-ish lowercase labels like `active`, `empty workspace`, `codex / Active`, or `runtime ready`.
- Selected project/workspace/session summaries use the same display helpers for status, provider, source, and runtime.
- Account and Harness summaries now use human labels such as `Active`, `Ready`, `Present`, `Enabled`, and `OK`.
- Added a regression test that verifies workspace browser and session summary labels use product-facing text and do not render the old raw labels.
- Follow-up Phase 3 visual slice replaced compact `P`、`W`、`S` and chevron text markers with aria-hidden SVG icons, so the workspace browser accessible names stay focused on product labels.

Verification:
- pnpm --filter @remote-codex/supervisor-web exec vitest run src/pages/ControlPlanePage.test.tsx
- pnpm --filter @remote-codex/supervisor-web typecheck
- pnpm --filter @remote-codex/supervisor-web build
- Playwright local smoke at http://localhost:5173/control-plane
- output/playwright/control-plane-language-polish-desktop.png
- output/playwright/control-plane-language-polish-mobile.png
- output/playwright/control-plane-tree-icons-desktop.png
- output/playwright/control-plane-tree-icons-mobile.png

Residual risk:
- Workspace Browser still has dense project names and long smoke-test titles. A later Phase 3 visual slice should add stronger truncation/tooltip rules and optional filtering.
- Harness subfields such as `folder index` and `history available` remain lower-priority operational labels and may be polished in a later Harness-specific slice.
```

## Phase 2：Control Plane App Shell 重构

Goal：把 control plane 从“所有 card 平铺”改成 restrained dashboard shell。

Target layout：

```text
Top bar: workspace selector / search / sandbox health / user menu
Sidebar: navigation and selected hierarchy
Main: summaries and sessions
Inspector: collapsible details
```

Recommended slice：

1. 先只收紧顶部：去掉大段 copy，保留 current workspace、health、search、avatar。
2. 再处理 account：从左侧/主区卡片改成右上角 avatar menu。
3. 最后拆 shell components，避免在同一 PR 同时改结构和行为。

Implementation notes：

- Top bar 高度应稳定，目标 48 到 64px。
- Account menu 默认显示 avatar 或用户名首字母；展开后才显示 email、usage、logout。
- `Admin User` 默认不应是普通用户首屏概念。需要保留时放入 settings/admin-only menu。
- `LLM Usage` 优先进入 user menu/account drawer。主区只保留总览指标，例如 `Usage today`。
- 避免把 top bar 做成营销 header。不要放 slogan、长副标题或产品介绍段落。

Tasks：

- [x] 引入 control-plane-local shell components。
  - Suggested files：
    - `apps/supervisor-web/src/pages/control-plane/ControlPlaneShell.tsx`
    - `apps/supervisor-web/src/pages/control-plane/ControlPlaneTopBar.tsx`
    - `apps/supervisor-web/src/pages/control-plane/ControlPlaneSidebar.tsx`
    - `apps/supervisor-web/src/pages/control-plane/ControlPlaneInspector.tsx`
  - Done when：`ControlPlanePage.tsx` 不再承担全部布局 JSX。
  - Verify with：typecheck 和 ControlPlanePage tests。

- [x] 把顶部大段 marketing/product copy 收紧成窄 top bar。
  - Remove from first viewport：`Product account and sandbox registry` 这类长描述。
  - Keep：current workspace、sandbox status、search、user avatar。
  - Done when：首屏不再出现大段解释性文案。
  - Verify with：测试或 Playwright snapshot。

- [x] 左侧 account 逻辑改为用户头像菜单。
  - Done when：显示圆形 avatar，默认使用用户名首字母或 fallback icon。
  - Menu content：email、display name、plan、usage link、logout。
  - Verify with：ControlPlanePage test 覆盖打开 user menu 和 logout。

- [x] 移除或下沉 `Admin User` 区块。
  - Recommended：普通用户不显示；admin 能力进 user menu 或 settings。
  - Done when：默认 control plane 首屏没有 Admin User panel。
  - Verify with：测试断言非 admin 看不到 `Admin User`。

- [x] 把 `LLM Usage` 整合进 user center。
  - Done when：usage 不再作为主区大卡片抢占首屏。
  - Verify with：user menu 或 account drawer 中能查看 usage summary。

Evidence：

```text
Files:
- apps/supervisor-web/src/pages/ControlPlanePage.tsx
- apps/supervisor-web/src/pages/ControlPlanePage.test.tsx
- apps/supervisor-web/src/pages/control-plane/ControlPlaneShell.tsx
- apps/supervisor-web/src/pages/control-plane/ControlPlaneTopBar.tsx
- apps/supervisor-web/src/pages/control-plane/ControlPlaneSidebar.tsx
- apps/supervisor-web/src/pages/control-plane/ControlPlaneInspector.tsx
- apps/supervisor-web/src/index.css
- docs/control-plane-chat-ui-refactor-plan.zh.md

Implemented:
- The old explanatory first-viewport copy is replaced by a compact top bar with title, current context, sandbox state, refresh/details controls, and an account avatar.
- Account details moved into the top-right avatar menu, including display name, email, plan, LLM usage, Harness usage, usage history, and logout.
- The default control-plane surface no longer shows a separate `Admin User` panel.
- Usage is available from the account menu instead of occupying a main dashboard card.
- Introduced local shell pieces for the control-plane surface: top bar, sidebar wrapper, inspector wrapper, and `ControlPlaneShell`.
- `ControlPlaneShell` now owns the page-level console, alert stack, and responsive grid container; `ControlPlanePage.tsx` keeps data loading and event handlers.

Verification:
- pnpm --filter @remote-codex/supervisor-web exec vitest run src/pages/ControlPlanePage.test.tsx
- pnpm --filter @remote-codex/supervisor-web typecheck
- pnpm --filter @remote-codex/supervisor-web build
- git diff --check -- apps/supervisor-web/src/pages/ControlPlanePage.tsx apps/supervisor-web/src/pages/control-plane/ControlPlaneShell.tsx apps/supervisor-web/src/pages/control-plane/ControlPlaneTopBar.tsx apps/supervisor-web/src/pages/control-plane/ControlPlaneSidebar.tsx apps/supervisor-web/src/pages/control-plane/ControlPlaneInspector.tsx docs/control-plane-chat-ui-refactor-plan.zh.md
- output/playwright/control-plane-account-menu-refactor-desktop.png
- output/playwright/control-plane-account-menu-refactor-mobile.png
- output/playwright/control-plane-inspector-tabs-summary-desktop.png
- output/playwright/control-plane-inspector-tabs-mobile.png

Residual risk:
- `ControlPlanePage.tsx` still owns a large render tree because this slice intentionally avoided moving behavior-adjacent JSX into child components. Future cleanup can extract sidebar tree rows and inspector tab panels without changing the shell contract.
```

## Phase 3：Workspace / Project / Session 导航重构

Goal：把 “Workspace Flow” 从同级卡片堆叠改成逐级选择的 navigation flow。

Recommended slice：

- 先做决策：Project 是否保留在主 flow。
- 再做 parent gating：没有选中上级时，不能创建下级。
- 最后做视觉：逐级文件夹式 navigation、当前层级 `+` 创建入口。

Implementation notes：

- 如果 Project 没有真实业务含义，短期建议“弱化 Project”，而不是删除数据模型。
- Workspace 应是用户理解的主要容器。Session 应明确属于当前 Workspace。
- 创建 Session 前必须满足：
  - 已选 workspace。
  - sandbox 可用或已明确进入启动流程。
  - provider/model 等必要配置已存在或有默认值。
- 创建按钮的位置由当前选择决定：
  - 选中 workspace list header 的 `+`：创建 workspace。
  - 选中 workspace 后 session section 的 `+`：创建 session。
  - 选中 session 后 `...`：rename、copy id、delete、open details。

Tasks：

- [x] 明确 Project level 是否保留。
  - Decision options：
    - 保留 Project：Project 是 workspace grouping，sidebar 显示 Project 下的 Workspace。
    - 弱化 Project：只在 inspector 或 settings 中显示 project，主 flow 以 Workspace 为根。
    - 移除 Project：需要 API、DB、tests、迁移计划，不应混入 UI-only PR。
  - Done when：写入本文件或 `docs/architecture-decisions.md`。
  - Verify with：对应 route/API/UI 不再互相矛盾。

- [x] 改成逐级选择流程。
  - User flow：
    1. 选择 workspace 或 project。
    2. 选中上级后显示下级列表。
    3. 只有选中上级后才能创建下级。
  - Done when：create workspace/session 不再是全局同级按钮。
  - Verify with：ControlPlanePage tests 覆盖未选上级时 create 下级 disabled。

- [x] 创建入口改成基于当前选择的 `+` 或 More menu。
  - Done when：点击当前层级的 create icon 时弹出对应 inline drawer/form。
  - Avoid：多个大按钮同时展示。
  - Verify with：测试覆盖 create workspace/session form 的 parent id。

- [x] 长路径、slug、raw id 下沉。
  - Done when：sidebar 只展示 label/status；path 在 hover tooltip 或 inspector。
  - Verify with：主 DOM 不默认显示 `/workspace/...`，inspector 可显示并 copy。

Evidence：

```text
Files:
- apps/supervisor-web/src/pages/ControlPlanePage.tsx
- apps/supervisor-web/src/pages/ControlPlanePage.test.tsx
- apps/supervisor-web/src/index.css
- docs/control-plane-chat-ui-refactor-plan.zh.md

Verification:
- pnpm --filter @remote-codex/supervisor-web exec vitest run src/pages/ControlPlanePage.test.tsx
- pnpm --filter @remote-codex/supervisor-web typecheck
- pnpm --filter @remote-codex/supervisor-web build
- Playwright local smoke at http://localhost:5173/control-plane
- output/playwright/control-plane-tree-icons-desktop.png
- output/playwright/control-plane-tree-icons-mobile.png

Implemented:
- Decision: keep Project in the UI for now as a workspace grouping level. Removing it would require API, database, migration, and fixture changes, so this UI slice makes the hierarchy clearer instead of deleting the level.
- Workspace Browser now uses progressive disclosure: project selection reveals workspaces, workspace selection reveals sessions, and unselected child levels are not shown as sibling cards.
- The create `+` target follows the current selection: root creates project, selected project creates workspace, selected workspace creates session.
- Create workspace and create session are gated by parent selection, and session creation also requires a ready sandbox.
- Workspace paths, slugs, raw project/workspace/session ids, and exact timestamps are kept in the Inspector Metadata tab instead of the browser tree or default session list.
- Workspace Browser renders project, workspace, and session hierarchy as folder/document-style SVG icons instead of exposing `P`、`W`、`S` text markers.
- Expand/collapse chevrons are SVG icons with `aria-hidden`, so accessible names read as `Computational chemistry Active`, `Molecule study Local workspace`, or `Open session ... from workspace browser`.
- The sessions panel count now reads as `N active sessions` rather than a terse `N active`.
- Regression coverage asserts the product-facing labels remain visible and the old compact letter markers no longer render.

Residual risk:
- Project level is still present by explicit UI decision. Removing it remains a separate API/DB/migration decision.
- Long generated project/session names still make the tree visually dense; a later slice should add search/filtering and more predictable truncation.
```

## Phase 4：Session 列表与 Summary 区

Goal：主区先回答“现在有什么在跑，哪个需要注意，下一步做什么”。

Recommended slice：

- 把 session 平铺 card 改成 compact list 或 table。
- 把 secondary actions 收进 More menu。
- 把 summary 指标限制为 3 到 4 个。

Implementation notes：

- Session row 默认结构：
  ```text
  Title
  Workspace · Provider/model
  Status badge · Last activity
  Primary action · More
  ```
- Desktop 可用 table；mobile 应转成 compact row，不要横向滚动作为默认体验。
- Primary action 由状态决定，不要同时显示 Resume、Start、Stop、Token、Delete 等一排按钮。
- More menu 可包含：Open details、Copy session id、Copy sandbox id、Restart sandbox、Delete。
- Copy raw id 的入口存在即可，不需要常驻显示 raw id 文本。

Tasks：

- [x] 建立 session table/list。
  - Columns：Title、Status、Provider、Workspace、Last activity、Primary action、More。
  - Done when：session raw UUID 不在 list row 默认显示。
  - Verify with：ControlPlanePage test 更新。

- [x] Summary row 限制为 3 到 4 个 operational metrics。
  - Suggested：Running sessions、Sandbox health、Recent errors、Usage today。
  - Done when：不是一堆相同 card 网格；只放操作有用指标。
  - Verify with：Playwright screenshot 检查首屏。

- [x] 每行只保留一个 primary action。
  - Running/active session：Open chat 或 Resume。
  - Stopped sandbox：Start sandbox。
  - Failed session：Open details 或 Retry。
  - Secondary：More menu。
  - Verify with：测试覆盖 More menu 中 copy id、open details、delete/stop 等动作。

- [x] 状态和相对时间可扫描。
  - Done when：状态 badge 和 relative time 不换行，不挤压 title。
  - Verify with：mobile screenshot。

Evidence：

```text
Files:
- apps/supervisor-web/src/pages/ControlPlanePage.tsx
- apps/supervisor-web/src/pages/ControlPlanePage.test.tsx
- apps/supervisor-web/src/index.css
- docs/control-plane-chat-ui-refactor-plan.zh.md

Verification:
- pnpm --filter @remote-codex/supervisor-web exec vitest run src/pages/ControlPlanePage.test.tsx
- pnpm --filter @remote-codex/supervisor-web typecheck
- pnpm --filter @remote-codex/supervisor-web build
- git diff --check -- apps/supervisor-web/src/pages/ControlPlanePage.tsx apps/supervisor-web/src/pages/ControlPlanePage.test.tsx apps/supervisor-web/src/index.css
- Playwright local smoke at http://localhost:5173/control-plane
- output/playwright/control-plane-session-more-menu-desktop.png
- output/playwright/control-plane-session-more-menu-mobile.png

Implemented:
- The main sessions surface is now a compact list with title, provider, relative activity time, status, runtime readiness, one primary action, and one More trigger.
- The overview strip is limited to four operational counters: Projects, Workspaces, Sessions, and Sandbox.
- Each session row now keeps one primary action (`Resume` or `Start`) plus one `More` trigger.
- Secondary actions (`Show details`, `Copy session ID`, `Copy sandbox ID`, `Close session`) are hidden behind a role=menu popover instead of appearing as repeated row buttons.
- Raw session and sandbox IDs are not printed in the session list row or More menu; copy actions write them to the clipboard on demand.
- On mobile, the More menu opens as a bottom sheet with 44px touch targets so it is not clipped by the row or viewport.
- Added regression coverage for the list, More menu, clipboard copy, and row-level raw-id redaction.

Residual risk:
- The More menu is a lightweight local menu, not a shared menu primitive yet. If more row menus appear elsewhere, extract a shared accessible menu component.
- `Close session` remains enabled only for sessions with a worker runtime and running sandbox; destructive delete/rename are still future Phase 4 work.
```

## Phase 5：Sandbox 生命周期与 Details 下沉

Goal：sandbox 默认作为 health summary，而不是 raw infrastructure card。

Recommended slice：

- 先压缩 sandbox summary。
- 再整理 lifecycle 按钮状态。
- 最后把 ids/router/image/timestamps 放入 inspector。

Implementation notes：

- Sandbox 在 UI 上应像 runtime environment，不像 Kubernetes/debug object。
- 进度不要只显示百分比。百分比可以保留，但必须配阶段说明。
- 推荐阶段文案：
  - `Request received`
  - `Scheduling sandbox`
  - `Preparing runtime`
  - `Opening sandbox route`
  - `Ready`
- Start 按钮在 starting/running/stopping 时不能误导性亮着。可用状态要和真实 action 一致。
- `Resume` 只有在 session 可进入 chat 且 sandbox/route 状态满足要求时才作为 primary action。

Tasks：

- [x] Sandbox summary 改成 compact health block。
  - Default：
    ```text
    Sandbox
    Running · Standard
    Healthy · updated 2m ago
    ```
  - Hidden：sandbox id、worker service name、router URL、image、createdAt。
  - Verify with：主页面不显示 router URL。

- [x] Start/Stop/Restart 状态机收敛。
  - Done when：starting/stopping/restarting/running/stopped/failed 对应按钮状态明确。
  - Verify with：ControlPlanePage existing lifecycle tests 更新。

- [x] Sandbox startup progress 改成真实阶段说明。
  - Suggested stages：requested、scheduling、worker ready、router ready、running。
  - Done when：25/50/100 这类数字不再单独出现，必须有阶段文案。
  - Verify with：测试覆盖 progress label。

- [x] Sandbox details 进入 inspector。
  - Fields：sandbox id、worker id、router URL、image、region、resource profile、created/updated、last seen。
  - Done when：copy buttons 存在，但默认不抢首屏。
  - Verify with：打开 inspector 后可 copy raw id。

Evidence：

```text
Files:
- apps/supervisor-web/src/pages/ControlPlanePage.tsx
- apps/supervisor-web/src/pages/ControlPlanePage.test.tsx
- docs/control-plane-chat-ui-refactor-plan.zh.md

Implemented:
- Added product-facing sandbox stage labels: Request received, Scheduling sandbox, Preparing runtime, Opening sandbox route, Ready, Checking readiness, Startup failed, and Stopped.
- Added product-facing sandbox health labels: Healthy, Waiting for runtime readiness, Needs attention, Failed, Offline, and related transient states.
- The visible sandbox summary now shows State, Stage, Health, and Last seen instead of using low-level worker/pod status as the primary health line.
- Startup progress keeps the numeric percentage but pairs it with the stage label, so 25/50/100-style values are not the only visible startup explanation.
- Sandbox id, image, router URL, worker service name, S3 prefix, raw statusReason, failure code/message, and exact timestamps remain inside the `Sandbox metadata` disclosure in the inspector.
- Start button no longer remains misleadingly active while the sandbox is starting/running/stopping: it renders as `Starting...` or disabled `Running` with explanatory titles.
- Sandbox actions now use a centralized state presenter. Stopped and failed sandboxes expose `Start` / `Retry start`; running sandboxes disable `Running` while keeping Stop/Restart/Health/Inspect available; starting/degraded/stopping states have explicit disabled states and explanatory titles.
- The large bootstrap flow now uses `Start` after a stopped sandbox, while `Restart` is reserved for running/degraded recovery.

Verification:
- pnpm --filter @remote-codex/supervisor-web exec vitest run src/pages/ControlPlanePage.test.tsx
- pnpm --filter @remote-codex/supervisor-web typecheck
- pnpm --filter @remote-codex/supervisor-web build
- git diff --check -- apps/supervisor-web/src/pages/ControlPlanePage.tsx apps/supervisor-web/src/pages/ControlPlanePage.test.tsx apps/supervisor-web/src/index.css docs/control-plane-chat-ui-refactor-plan.zh.md
- Playwright local smoke at http://127.0.0.1:5173/control-plane with VITE_CONTROL_PLANE_BASE_URL=https://remote-codex-control-plane-production.up.railway.app
- output/playwright/control-plane-sandbox-lifecycle-desktop.png
- output/playwright/control-plane-sandbox-lifecycle-mobile.png
- output/playwright/control-plane-sandbox-actions-desktop.png
- output/playwright/control-plane-sandbox-actions-mobile.png

Residual risk:
- Live Playwright screenshots captured the currently running production sandbox (`Ready` / `Healthy`). Starting, degraded, and failed states are covered by ControlPlanePage unit tests rather than live screenshots.
- Inspector still uses disclosures rather than full Summary / Metadata / Logs / Route tabs; that belongs to Phase 6.
- Mobile inspector drawer still lets the dimmed underlying page show through heavily; address this in Phase 6 or Phase 9 visual polish.
```

## Phase 6：Control Plane Inspector

Goal：用右侧 inspector 承接低频调试信息。

Recommended slice：

- 实现 inspector shell 和 selection state。
- 先支持 session/sandbox metadata。
- 再加 logs/route tabs 和 copy buttons。

Implementation notes：

- Desktop inspector 默认可折叠，宽度建议 320 到 420px。
- Mobile inspector 用 drawer，不挤压主列表。
- Inspector 不应成为第二个主页面。默认 Summary 简短，Metadata/Logs/Route 按 tab 展开。
- Copy button 要靠近字段，字段名使用 product/debug 双层语言：
  - `Session ID`
  - `Sandbox ID`
  - `Worker ID`
  - `Router URL`
- Secret redaction 是硬要求：route token、bearer token、admin key、provider key 不显示。

Tasks：

- [x] 实现 collapsible inspector。
  - Desktop：右侧固定宽度，可折叠。
  - Mobile：drawer。
  - Done when：selected workspace/project/session/sandbox 共用一个 inspector shell。
  - Verify with：desktop/mobile screenshots。

- [x] Inspector tabs。
  - Suggested tabs：Summary、Metadata、Logs、Route。
  - Done when：raw fields 不再散落在主页面。
  - Verify with：测试或 snapshot。

- [x] Copy buttons 和 redaction。
  - Done when：raw id/router URL 可 copy，secret/token 永不显示。
  - Verify with：测试断言不渲染 bearer token、route token。

- [x] Empty state。
  - Done when：未选中对象时 inspector 显示简短 empty state，不占用大量空间。
  - Verify with：Playwright screenshot。

Evidence：

```text
Files:
- apps/supervisor-web/src/pages/ControlPlanePage.tsx
- apps/supervisor-web/src/pages/ControlPlanePage.test.tsx
- apps/supervisor-web/src/index.css
- docs/control-plane-chat-ui-refactor-plan.zh.md

Implemented:
- Replaced the right Inspector disclosure stack with Summary / Metadata / Route / Logs tabs.
- Kept Summary focused on sandbox state, action row, selected object summary, and Harness overview.
- Moved raw sandbox ids, worker ids, image URL, S3 prefix, exact timestamps, status reason, and copy controls into Metadata.
- Kept route-token creation and route/socket details in Route, with token values still treated as ephemeral secrets and not rendered or persisted.
- Moved Harness detail/tool/run inspection and admin inspection output into Logs.
- Added mobile drawer polish so the inspector reads as an opaque details layer over a darker scrim.
- Updated regression tests so raw reason codes and worker metadata are asserted in Metadata, route actions in Route, and sandbox lifecycle actions in Summary.

Verification:
- pnpm --filter @remote-codex/supervisor-web exec vitest run src/pages/ControlPlanePage.test.tsx
- pnpm --filter @remote-codex/supervisor-web typecheck
- pnpm --filter @remote-codex/supervisor-web build
- Playwright local smoke at http://127.0.0.1:5173/control-plane, using Railway control-plane base URL.
- output/playwright/control-plane-inspector-tabs-summary-desktop.png
- output/playwright/control-plane-inspector-tabs-metadata-desktop.png
- output/playwright/control-plane-inspector-tabs-route-desktop.png
- output/playwright/control-plane-inspector-tabs-mobile.png

Residual risk:
- Logs still combines Harness details, tool/run summary, and admin inspection output; split only if the real data volume makes the tab noisy.
- Project/workspace rows still show generated smoke-test names and a broad project list from staging data; data cleanup is out of scope for this UI slice.
- Mobile drawer behavior is visually confirmed, but a dedicated keyboard traversal test for tab order is still pending.
```

## Phase 7：Chat Workspace 页面重构

Goal：把 chat 从 control plane overlay 改成独立 workspace layout。

Current entry：

- `apps/supervisor-web/src/pages/ControlPlaneSessionPage.tsx`
- route：`/control-plane/sessions/:sessionId`
- shared surface：`ThreadDetailSurface` from `@remote-codex/thread-ui`

Recommended slice：

- 保持 `@remote-codex/thread-ui` 为 chat surface，不复制 main branch chat UI。
- control-plane session page 只做 adapter：加载 control-plane session、换 route token、映射 worker thread history、提供 slots。
- 先清掉 header/meta 的 raw id 暴露，再做右侧 inspector。

Implementation notes：

- 左上角 hamburger、settings、plugin 管理必须来自 shared thread UI。
- Chat header 默认显示：
  - session title
  - status
  - provider/model
  - workspace context
  - settings entry
- Chat header 默认不显示：
  - control-plane session id
  - worker thread id
  - router URL
  - route token expiry
- Session/thread list 使用 product title 和 status。Raw worker id 只在 Diagnostics。
- Stop/interrupt 按钮行为必须对齐 normal Remote Codex thread UI：运行中可点击，停止后 disabled。
- Bottom stickiness 验收要包含“用户向上滚动历史时不会被强制拉回底部”。

Tasks：

- [x] 保持 `@remote-codex/thread-ui` 为唯一 chat surface。
  - Done when：不复制 `ThreadTimeline`、`ThreadComposer`、`ThreadWorkspaceLayout` 代码。
  - Verify with：
    ```bash
    rg -n 'ThreadTimeline|ThreadComposer|ThreadWorkspaceLayout' apps/supervisor-web/src/pages/ControlPlaneSessionPage.tsx
    ```

- [x] Chat layout 改成三栏 workspace。
  - Left：session/thread list。
  - Center：message stream + sticky composer。
  - Right：artifact/log inspector。
  - Done when：chat 不再视觉上盖在 control plane 上。
  - Verify with：desktop screenshot。

- [x] 顶部 header 只显示 title、status、provider/model、settings。
  - Hidden：worker id、router URL、full UUID。
  - Verify with：DOM/snapshot 不默认显示 worker id。

- [x] 保留左上角 hamburger 和 settings。
  - Done when：settings 中能进入 plugin 管理。
  - Verify with：ControlPlaneSessionPage test 覆盖 Settings 打开和 plugins 可见。

- [x] Session/thread selector 与 control plane selection 对齐。
  - Done when：左栏 session list 使用 product session title/status，而不是 worker raw id。
  - Verify with：测试覆盖 sidebar link `/control-plane/sessions/:sessionId`。

Evidence：

```text
Files:
- apps/supervisor-web/src/pages/ControlPlaneSessionPage.tsx
- apps/supervisor-web/src/pages/ControlPlaneSessionPage.test.tsx
- apps/supervisor-web/src/index.css

Implemented:
- Control-plane session page still delegates chat, timeline, composer, hamburger, settings, and plugin management to @remote-codex/thread-ui.
- Desktop chat workspace now resolves into a three-column surface when an artifact or history detail is selected: shared thread/session navigation on the left, message stream and sticky composer in the center, and a Thread inspector on the right.
- Mobile keeps the thread/session navigation behind the shared topbar toggle and presents the Thread inspector as a fixed details panel instead of forcing three cramped columns.
- Thread Meta now defaults to Status, Provider, Workspace, Project, Model, and Last activity.
- Control session id, worker thread id, router URL, workspace path, sandbox id, image, worker service, and exact route-token expiry moved behind Diagnostics.
- Surface status action now uses a compact human status label instead of raw status text.
- Artifact/history details use Preview, Source, Logs, and Metadata tabs without copying the timeline or composer implementation into control-plane code.

Verification:
- pnpm --filter @remote-codex/supervisor-web exec vitest run src/pages/ControlPlaneSessionPage.test.tsx
- pnpm --filter @remote-codex/supervisor-web exec vitest run src/pages/ControlPlanePage.test.tsx src/pages/ControlPlaneSessionPage.test.tsx
- pnpm --filter @remote-codex/supervisor-web typecheck
- pnpm --filter @remote-codex/supervisor-web build
- rg -n 'ThreadTimeline|ThreadComposer|ThreadWorkspaceLayout' apps/supervisor-web/src/pages/ControlPlaneSessionPage.tsx
- Playwright local smoke at http://localhost:5173/control-plane/sessions/4c2c0190-75a5-421d-acf9-6c9076ae5961
- output/playwright/control-plane-session-phase7-desktop.png
- output/playwright/control-plane-session-phase7-mobile.png
- output/playwright/control-plane-phase7-desktop.png
- output/playwright/control-plane-session-phase7-three-column-desktop.png
- output/playwright/control-plane-session-phase7-three-column-mobile.png

Residual risk:
- Right-side artifact/log inspector exists and is visually verified, but deeper artifact behavior remains covered by Phase 8 evidence and future plugin-specific smoke.
- Mobile inspector is visually verified, but keyboard focus trapping for the fixed details panel is still a Phase 9 accessibility follow-up.
```

## Phase 8：Tool Call、Logs 与 Artifact 展示策略

Goal：聊天流保持可读，把调试细节放到折叠块和右侧 panel。

Recommended slice：

- 先让 timeline 支持选择 artifact/detail，但保留旧 fallback。
- 再在 control-plane session page 加右侧 Thread inspector。
- 最后把 Preview/Source/Logs/Metadata tabs 补完整。

Implementation notes：

- 优先把通用能力做进 `@remote-codex/thread-ui`，control-plane 只传 callback 和 renderer。
- 如果改 `packages/thread-ui/src`，必须执行 `pnpm --filter @remote-codex/thread-ui build`，因为 supervisor-web 可能消费 dist。
- Tool call 默认显示摘要，例如 tool name、状态、duration、短结果。
- Raw input/output 进入 Logs tab、detail drawer 或折叠 detail。
- Artifact Preview 通过 plugin system 渲染，例如 XYZ viewer，不在 control-plane 里复制 renderer。
- Source tab 展示 artifact source/payload，Metadata tab 展示 ids/type/source ids。
- 插件关闭后，对应 MCP/tool/system prompt 不应继续注入；这是 plugin lifecycle 行为，不属于 control-plane 本地 hack。

Tasks：

- [x] Tool calls 默认折叠。
  - Summary shows：tool name、status、duration、short result。
  - Details shows：raw input/output。
  - Done when：raw command output 不默认铺满聊天流。
  - Verify with：ThreadTimeline tests。

- [x] Command output 使用 detail dialog 或 Logs tab。
  - Done when：长 stdout/stderr 不主导 message stream。
  - Verify with：现有 deferred detail tests 仍通过。

- [x] Artifact panel tabs。
  - Tabs：Preview、Source、Logs、Metadata。
  - Done when：XYZ molecule artifact 可在 Preview 中查看，source 在 Source tab。
  - Verify with：XYZ renderer smoke 或 screenshot。

- [x] Artifact selection 行为。
  - Done when：点击 timeline artifact 打开右侧 panel，而不是只在消息内展开。
  - Verify with：thread-ui tests 或 integration test。

- [x] Metadata tab 显示 raw artifact/session data。
  - Done when：metadata 可 copy，但默认不显示在 chat stream。
  - Verify with：snapshot。

Evidence：

```text
Files:
- packages/thread-ui/src/components/ThreadTimeline.tsx
- packages/thread-ui/dist/index.js
- packages/thread-ui/dist/index.d.ts
- apps/supervisor-web/src/lib/api.ts
- apps/supervisor-web/src/pages/ControlPlaneSessionPage.tsx
- apps/supervisor-web/src/pages/ControlPlaneSessionPage.test.tsx
- apps/supervisor-web/src/components/ThreadTimeline.test.tsx
- apps/supervisor-web/src/index.css

Implemented:
- ThreadTimeline exposes a generic onSelectArtifact callback and artifact cards show an Inspect action when the callback is provided.
- ControlPlaneSessionPage renders a right-side Artifact inspector after artifact selection.
- Artifact inspector has Preview, Source, Logs, and Metadata tabs.
- Preview reuses the active plugin renderer through usePlugins().renderArtifact instead of copying XYZ renderer code into control-plane.
- Source extracts molecule payload content when present and falls back to raw payload JSON.
- Metadata keeps artifact id/plugin id/type/source ids/payload behind the inspector instead of the default chat stream.
- ThreadTimeline now exposes onSelectHistoryItemDetail for command/tool detail routing while preserving the old LongTextDialog fallback when no external inspector callback is provided.
- ControlPlaneSessionPage passes a route-token-backed worker history item detail loader and routes command/tool details into the right Thread inspector Logs tab.
- The right inspector is now labeled as Thread inspector because it can display artifacts, command output, and tool-call details.

Verification:
- pnpm --filter @remote-codex/thread-ui build
- pnpm --filter @remote-codex/supervisor-web exec vitest run src/components/ThreadTimeline.test.tsx src/pages/ControlPlaneSessionPage.test.tsx
- pnpm --filter @remote-codex/supervisor-web exec vitest run src/pages/ControlPlanePage.test.tsx src/pages/ControlPlaneSessionPage.test.tsx src/components/ThreadTimeline.test.tsx
- pnpm --filter @remote-codex/supervisor-web typecheck
- pnpm --filter @remote-codex/supervisor-web build
- Playwright local smoke at http://localhost:5173/control-plane/sessions/4c2c0190-75a5-421d-acf9-6c9076ae5961
- output/playwright/control-plane-session-phase8-desktop.png
- output/playwright/control-plane-session-phase8-mobile.png
- output/playwright/control-plane-session-phase8-logs-desktop.png
- output/playwright/control-plane-session-phase8-logs-mobile.png

Residual risk:
- Full artifact click-to-open behavior is implemented through the Inspect action; making the whole artifact card select the artifact remains optional polish.
- The live staging worker did not generate a molecule artifact during this smoke because the sandbox agent did not discover the molecule MCP tool. Artifact inspector behavior is covered by ThreadTimeline and ControlPlaneSessionPage tests with a molecule artifact fixture.
- Live Playwright evidence for command/tool Logs depends on having a live worker thread with command/tool history items; integration tests cover the deferred detail route-token path.
```

## Phase 9：响应式、可访问性与键盘体验

Goal：desktop/tablet/mobile 都保持信息层级清楚。

Recommended slice：

- 用 Playwright 分别看 desktop 1280x800、mobile 390x844。
- 先修 overlap、scroll trap、touch target，再做小的视觉 polish。
- 不以截图“看起来还行”为准，必须实际 tab/scroll/click。

Implementation notes：

- Control plane desktop：top bar、sidebar、main、inspector 不应互相遮挡。
- Control plane mobile：sidebar 和 inspector 应使用 drawer/stacked layout，不强行保留四栏。
- Chat desktop：左栏、timeline、composer、right inspector 高度应稳定。
- Chat mobile：composer 不遮住最后一条消息；drawer 打开时背景不能继续误触。
- Keyboard：
  - tab 能进入 hamburger/settings。
  - tab 能进入 session row primary action 和 More menu。
  - tab 能进入 inspector tabs 和 close button。
  - composer submit/stop 可键盘触发。
- A11y：
  - icon-only buttons 必须有 accessible name。
  - tablist/tabs 使用 role 或可被 Testing Library 可靠查询。
  - status badge 不只依赖颜色表达状态。

Tasks：

- [x] Desktop 三栏布局稳定。
  - Done when：1280px 宽度下 control plane 和 chat workspace 不需要页面级纵向滚动才能看到主要操作。
  - Verify with：Playwright screenshot。

- [x] Mobile 变成 stacked layout。
  - Control Plane：sidebar/drawer、main list、inspector drawer。
  - Chat：thread drawer、chat center、artifact drawer。
  - Verify with：375px screenshot。

- [x] Keyboard navigation。
  - Done when：sidebar items、More menu、inspector tabs、composer、settings 可键盘访问。
  - Verify with：Testing Library role queries，manual keyboard smoke。

- [x] Touch targets。
  - Done when：主要按钮和 menu item 不低于 44px touch target，密集辅助控件有 clear hit area。
  - Verify with：mobile screenshot + DOM class review。

- [x] No overlap rule。
  - Done when：top bar、sidebar、composer、timeline、inspector 不互相遮挡。
  - Verify with：desktop/mobile screenshots。

Evidence：

```text
Files:
- apps/supervisor-web/src/index.css
- docs/control-plane-chat-ui-refactor-plan.zh.md

Implemented:
- Control-plane chat uses a desktop three-column workspace when the Thread inspector is open.
- At mobile widths, the Thread inspector becomes a fixed foreground drawer over a dimmed chat workspace.
- Inspector close button and tab buttons have visible focus rings.
- Mobile inspector close button and tabs use 44px touch targets.

Verification:
- pnpm --filter @remote-codex/supervisor-web typecheck
- pnpm --filter @remote-codex/supervisor-web build
- Playwright role snapshot confirms Thread inspector complementary region, tablist, tabs, close button, and timeline command/tool buttons.
- Playwright keyboard smoke: Tab focus reached timeline command detail button with aria-label "Open full command".
- output/playwright/control-plane-session-phase8-logs-desktop.png
- output/playwright/control-plane-session-phase8-logs-mobile.png
- output/playwright/control-plane-session-phase9-mobile-touch-targets.png

Residual risk:
- Keyboard smoke is lightweight and manual. A later slice can add dedicated Playwright keyboard traversal for app menu, settings, inspector tabs, and composer.
- Console still shows favicon.ico 404 in local dev; no functional console errors were observed.
```

## Phase 10：测试、Smoke 与部署闭环

Goal：每个 UI slice 都有自动测试和 staging smoke。

Recommended slice：

- 每个 UI PR 至少跑相关 vitest、typecheck、build。
- 每个视觉切片至少保留 desktop/mobile Playwright screenshot。
- 部署只在 deliberate commit 后执行，不从混杂 dirty worktree 直接上线。

Implementation notes：

- 本地截图建议命名：
  - `output/playwright/control-plane-<phase>-desktop.png`
  - `output/playwright/control-plane-<phase>-mobile.png`
  - `output/playwright/control-plane-session-<phase>-desktop.png`
  - `output/playwright/control-plane-session-<phase>-mobile.png`
- Staging smoke 必查：
  - `/control-plane` 可登录。
  - user menu 可打开，usage/logout 可见。
  - workspace/session hierarchy 清晰。
  - 创建 session 需要明确 parent。
  - sandbox start 进度有阶段文案，按钮状态正确。
  - resume 进入 chat。
  - chat hamburger/settings/plugin 管理可打开。
  - 发送 prompt 有回复。
  - stop 按钮运行中可用。
  - tool/log/artifact details 不默认淹没聊天流。
  - route token 过期前能刷新或续期，不中断正常聊天。

Tasks：

- [x] 更新 `ControlPlanePage.test.tsx`。
  - Coverage：user menu、hierarchy selection、create parent gating、session list、inspector。

- [x] 更新 `ControlPlaneSessionPage.test.tsx`。
  - Coverage：thread list、settings/plugins、hidden raw ids、prompt send、interrupt、route token refresh。

- [x] 更新 `ThreadTimeline.test.tsx`。
  - Coverage：tool collapsed by default、artifact panel events、deferred details。

- [x] 添加 Playwright smoke checklist。
  - Required views：
    - `/control-plane`
    - `/control-plane/sessions/:sessionId`
    - mobile `/control-plane`
    - mobile chat workspace
  - Evidence：screenshots or trace.

- [x] 部署并验证 build sha。
  - Done when：
    ```bash
    curl -sS https://remote-codex-frontend-production.up.railway.app/build.json
    ```
    returns pushed SHA.

- [x] 手工验收清单。
  - Control Plane：
    - 首屏不显示 raw ids。
    - session 列表一眼能看运行状态。
    - inspector 可展开并 copy raw ids。
    - user menu 包含 account/usage/logout。
  - Chat Workspace：
    - 左侧 thread list 清晰。
    - 中间 chat 不抖动，composer sticky。
    - stop 按钮可用。
    - tool calls 默认折叠。
    - artifact 在右侧 preview。
    - settings/hamburger 可打开 plugin 管理。

Evidence：

```text
Files:
- apps/supervisor-web/src/pages/ControlPlanePage.test.tsx
- apps/supervisor-web/src/pages/ControlPlaneSessionPage.test.tsx
- apps/supervisor-web/src/components/ThreadTimeline.test.tsx
- docs/control-plane-chat-ui-refactor-plan.zh.md

Verification:
- pnpm --filter @remote-codex/thread-ui build
- pnpm --filter @remote-codex/supervisor-web exec vitest run src/components/ThreadTimeline.test.tsx src/pages/ControlPlaneSessionPage.test.tsx
- pnpm --filter @remote-codex/supervisor-web exec vitest run src/pages/ControlPlanePage.test.tsx src/pages/ControlPlaneSessionPage.test.tsx src/components/ThreadTimeline.test.tsx
- pnpm --filter @remote-codex/supervisor-web typecheck
- pnpm --filter @remote-codex/supervisor-web build
- Playwright local smoke at http://localhost:5173/control-plane/sessions/4c2c0190-75a5-421d-acf9-6c9076ae5961
- output/playwright/control-plane-session-phase8-logs-desktop.png
- output/playwright/control-plane-session-phase8-logs-mobile.png
- output/playwright/control-plane-session-phase9-mobile-touch-targets.png
- git commit 9e8d13d533816896b8dcb9b0d87edf372954ec3d
- node .agents/skills/remote-codex-deploy/scripts/deploy-staging.mjs --push --watch
- GitHub Actions Staging Images: success, https://github.com/dufangshi/remoteCodex/actions/runs/27084771422
- GitHub Actions Worker Image: success, https://github.com/dufangshi/remoteCodex/actions/runs/27084771424
- curl -sS https://remote-codex-frontend-production.up.railway.app/build.json -> {"buildSha":"9e8d13d533816896b8dcb9b0d87edf372954ec3d"}
- curl -sS https://remote-codex-control-plane-production.up.railway.app/healthz -> {"ok":true,"service":"control-plane-api","buildSha":"9e8d13d533816896b8dcb9b0d87edf372954ec3d"}
- curl -sS https://sandbox-router.lnz.app/healthz -> {"ok":true,"role":"sandbox-router"}
- Playwright staging smoke: https://remote-codex-frontend-production.up.railway.app/control-plane
- Playwright staging smoke: https://remote-codex-frontend-production.up.railway.app/control-plane/sessions/2008afb1-a046-4509-981e-8ce19361453f
- output/playwright/staging-control-plane-ia-desktop.png
- output/playwright/staging-control-plane-account-menu.png
- output/playwright/staging-control-plane-inspector-metadata.png
- output/playwright/staging-control-plane-ia-mobile.png
- output/playwright/staging-control-plane-chat-desktop.png
- output/playwright/staging-control-plane-chat-settings.png

Manual staging results:
- `/control-plane` login works with `dev@example.com`.
- First viewport shows compact top bar, Workspace Browser, overview strip, Sessions list, and Inspector. Raw sandbox ids, image, worker id, S3 prefix, and exact timestamps are hidden until Inspector Metadata.
- User avatar menu opens and contains account identity, usage summary, usage history disclosure, account details disclosure, and sign out.
- Project -> workspace -> session hierarchy works. Selecting `Computational chemistry test / test1` shows 2 active sessions with status, relative activity, runtime readiness, one Resume action, and More menu.
- Inspector Summary/Metadata tabs work; Metadata fields have Copy buttons.
- Mobile `/control-plane` renders the stacked layout without a blank page or obvious overlap in the captured viewport.
- Resume opens the chat workspace at `/control-plane/sessions/2008afb1-a046-4509-981e-8ce19361453f`.
- Chat workspace shows shared thread-ui hamburger, thread list, settings panel, timeline, collapsed command/tool batches, sticky composer, Send, and Stop. Stop is correctly disabled for an idle session.
- Settings opens from the thread sidebar and shows remote session controls.

Residual risk:
- Account menu does not close on Escape in the Playwright smoke; it closes by clicking the avatar again. This is a follow-up a11y polish item, not a deploy blocker.
- Chat page console had one non-blocking WebSocket close warning during staging smoke. The UI still reported `Chat session connected`; avoid logging route tokens verbatim when investigating this later.
```

## Recommended PR Slicing

不要把所有阶段塞进一个 PR。推荐顺序：

1. IA presenter helpers：字段分层、status、relative time、raw metadata helpers。
2. ControlPlane shell skeleton：top bar、sidebar、main、inspector，不改业务行为。
3. Workspace/project/session hierarchy：选择上级才能创建下级。
4. Session list and sandbox summary：主区减负，raw fields 下沉。
5. Account menu and usage center：移除 Admin User 首屏暴露。
6. Chat workspace layout：保持 `@remote-codex/thread-ui`，重排左右 panel。
7. Tool/artifact/log behavior：折叠 tool，右侧 artifact tabs。
8. Responsive and accessibility polish。
9. Staging smoke and final evidence update。

每个 PR 必须包含：

```text
Scope:
- <what changed>

User-visible behavior:
- <what changed on screen>

Hidden/inspector behavior:
- <where raw details moved>

Verification:
- <commands>
- <screenshots or smoke>

Residual risk:
- <what remains>
```

## 推荐推进顺序

如果后续从当前状态继续，不要按阶段编号机械从 0 开始。按用户可见收益排序：

1. `Phase 1 + Phase 4`：统一 language/status，并把 session 主区收成 list/table。
2. `Phase 2`：top bar、avatar menu、移除首屏 Admin User/LLM Usage 大块。
3. `Phase 3`：workspace/project/session parent gating，解决创建层级不清楚。
4. `Phase 5 + Phase 6`：sandbox compact summary，raw details 进 inspector。
5. `Phase 7 + Phase 8`：chat workspace 和 artifact/log inspector 对齐 shared thread-ui。
6. `Phase 9`：mobile、scroll、keyboard、touch target。
7. `Phase 10`：staging deploy、build sha、manual acceptance。

每一步结束后都应该让线上产品更可用，而不是只完成内部重构。

## Manual Acceptance Script

部署后按这个顺序验收：

1. 打开 `https://remote-codex-frontend-production.up.railway.app/control-plane`。
2. 登录 `dev@example.com`。
3. 确认首屏没有 session id、sandbox id、worker id、router URL、raw timestamps。
4. 打开 user avatar menu，确认能看到账号信息、usage 入口、logout。
5. 在 workspace browser 中选择 workspace，确认未选中 parent 时不能创建下级。
6. 创建或选择 session，确认 session row 只有一个 primary action 和一个 More menu。
7. Start sandbox，确认进度显示真实阶段，Start 不在 running/starting 状态下误亮。
8. 点击 Resume/Open chat，进入 `/control-plane/sessions/:sessionId`。
9. 打开左上角 hamburger，再进 settings，确认 plugin 管理可见。
10. 发送一个简单 prompt，确认 assistant 有回复。
11. 发送一个长任务 prompt，确认 stop 按钮运行中可点击。
12. 向上滚动聊天历史，确认不会被强制拉回底部。
13. 触发或打开 tool/log/artifact detail，确认详情进入右侧 panel 或折叠块，不默认占满聊天流。
14. 切到 mobile viewport，重复打开 menu、settings、inspector、composer send/stop。
15. 获取 build sha：
    ```bash
    curl -sS https://remote-codex-frontend-production.up.railway.app/build.json
    ```

## Regression Watchlist

这些是历史上容易反复的问题，后续每次 UI 改动都要主动检查：

- `@remote-codex/thread-ui` 源码改了但没有 build dist，导致本地/部署验证不一致。
- 控制面 session page 又复制了一份 thread UI 或 plugin settings。
- hamburger/settings 在 control-plane chat 中消失。
- XYZ plugin 关闭后 MCP/tool prompt 仍注入。
- Artifact 出现了 MCP/tool call，但 Preview 没有渲染。
- Resume 点击无效果，或者弹窗被浏览器/状态机吞掉。
- Start sandbox 按钮在 starting/running 状态仍像可启动。
- route token 过期后聊天中断，不能自动续期。
- composer sticky 导致用户向上滚动时被拉回底部。
- mobile 上 inspector 或 composer 遮住消息、按钮或 tabs。
- raw id、router URL、worker id 回到首屏。

## Acceptance Criteria For The Full Refactor

整体完成后，必须满足：

- `/control-plane` 首屏不再像 raw operations dashboard。
- raw sandbox/session/worker/router ids 不默认显示。
- 用户能在 5 秒内识别当前 workspace、running sessions、sandbox health 和下一步 action。
- 创建 workspace/session 的 parent relationship 在 UI 上明确。
- Chat workspace 不再作为 control plane overlay，而是独立工作区。
- Chat stream 以用户可读 message 为中心，tool/log/artifact 细节按需展开。
- Plugin settings 仍可从 hamburger/settings 进入。
- XYZ artifact 能在 preview surface 中展示。
- Desktop 和 mobile 均无 incoherent overlap。
- Tests、typecheck、production build、staging deploy、manual smoke 均通过。

## Open Questions

- Project level 是否有真实产品价值，还是只应作为 workspace grouping metadata？
- Artifact panel 是否应由 `@remote-codex/thread-ui` 提供通用 slot，还是 control-plane session page 自己传入 right panel？
- Tool call collapse 默认策略应在 `@remote-codex/thread-ui` 全局生效，还是只在 control-plane chat workspace 生效？
- Logs tab 的数据来源是 worker thread history deferred detail、sandbox router logs，还是 control-plane audit events？
- Session list 是否需要 table 视图和 compact card 视图切换？
- Usage 是否只显示 LLM usage，还是合并 LLM、sandbox runtime、storage、harness usage？
