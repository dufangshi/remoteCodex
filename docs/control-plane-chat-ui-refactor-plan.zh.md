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

Tasks：

- [ ] 列出 `ControlPlanePage` 当前首屏所有 visible field。
  - Done when：文档或测试 fixture 中记录字段清单，包括 raw id、timestamp、router、worker、actions。
  - Verify with：
    ```bash
    rg -n 'Workspace Flow|Admin User|LLM Usage|router|worker|sandbox|created|updated|session' apps/supervisor-web/src/pages/ControlPlanePage.tsx
    ```

- [ ] 列出 `ControlPlaneSessionPage` 当前 chat surface 的 sidebar、settings、timeline、composer、meta slots。
  - Done when：确认哪些来自 `@remote-codex/thread-ui`，哪些是 control-plane adapter 自己塞入。
  - Verify with：
    ```bash
    rg -n 'ThreadDetailSurface|metaContent|settingsContent|surfaceActions|timelineProps|composerProps' apps/supervisor-web/src/pages/ControlPlaneSessionPage.tsx
    ```

- [ ] 截取当前 desktop 和 mobile control-plane 页面截图。
  - Done when：`output/playwright/` 或临时 evidence 中有截图路径。
  - Verify with：Playwright 打开 `https://remote-codex-frontend-production.up.railway.app/control-plane` 或本地 dev URL。

- [ ] 确认现有测试覆盖范围。
  - Done when：知道哪些测试会因为布局/label 改动需要更新。
  - Verify with：
    ```bash
    pnpm --filter @remote-codex/supervisor-web test -- ControlPlanePage ControlPlaneSessionPage
    ```

Evidence：

```text
Files:
- <audit notes or changed docs>

Verification:
- <commands>
- <screenshots>

Residual risk:
- <unknowns>
```

## Phase 1：统一产品语言与展示策略

Goal：先定义用户可见 noun、status、action 和 metadata 层级，再改 UI。

Tasks：

- [ ] 定义 control plane 顶层 noun。
  - Recommended nouns：Workspace、Project、Session、Sandbox、Thread、Artifact、Inspector。
  - Done when：页面 copy 不再混用 worker thread、remote session、control session 表达同一对象。
  - Verify with：
    ```bash
    rg -n 'control session|worker thread|remote session|thread|session' apps/supervisor-web/src/pages/ControlPlane*.tsx
    ```

- [ ] 定义 session card/table 默认字段。
  - Default fields：title、status、provider/model、workspace、last activity、primary action。
  - Hidden fields：full id、worker id、router URL、raw created/updated。
  - Done when：字段映射落入 helper 或 presenter，UI 不在 JSX 里散落判断。
  - Verify with：新增或更新 presenter/unit test。

- [ ] 定义 status badge 文案和颜色语义。
  - Done when：running、idle、failed、interrupted、not loaded、sandbox starting、sandbox stopped 有一致 badge。
  - Verify with：`ControlPlanePage.test.tsx` 或 presenter test 覆盖。

- [ ] 定义 relative time 与 exact time 策略。
  - Done when：首屏显示 relative time，exact timestamp 只在 inspector。
  - Verify with：测试断言主列表不出现 ISO timestamp。

## Phase 2：Control Plane App Shell 重构

Goal：把 control plane 从“所有 card 平铺”改成 restrained dashboard shell。

Target layout：

```text
Top bar: workspace selector / search / sandbox health / user menu
Sidebar: navigation and selected hierarchy
Main: summaries and sessions
Inspector: collapsible details
```

Tasks：

- [ ] 引入 control-plane-local shell components。
  - Suggested files：
    - `apps/supervisor-web/src/pages/control-plane/ControlPlaneShell.tsx`
    - `apps/supervisor-web/src/pages/control-plane/ControlPlaneTopBar.tsx`
    - `apps/supervisor-web/src/pages/control-plane/ControlPlaneSidebar.tsx`
    - `apps/supervisor-web/src/pages/control-plane/ControlPlaneInspector.tsx`
  - Done when：`ControlPlanePage.tsx` 不再承担全部布局 JSX。
  - Verify with：typecheck 和 ControlPlanePage tests。

- [ ] 把顶部大段 marketing/product copy 收紧成窄 top bar。
  - Remove from first viewport：`Product account and sandbox registry` 这类长描述。
  - Keep：current workspace、sandbox status、search、user avatar。
  - Done when：首屏不再出现大段解释性文案。
  - Verify with：测试或 Playwright snapshot。

- [ ] 左侧 account 逻辑改为用户头像菜单。
  - Done when：显示圆形 avatar，默认使用用户名首字母或 fallback icon。
  - Menu content：email、display name、plan、usage link、logout。
  - Verify with：ControlPlanePage test 覆盖打开 user menu 和 logout。

- [ ] 移除或下沉 `Admin User` 区块。
  - Recommended：普通用户不显示；admin 能力进 user menu 或 settings。
  - Done when：默认 control plane 首屏没有 Admin User panel。
  - Verify with：测试断言非 admin 看不到 `Admin User`。

- [ ] 把 `LLM Usage` 整合进 user center。
  - Done when：usage 不再作为主区大卡片抢占首屏。
  - Verify with：user menu 或 account drawer 中能查看 usage summary。

## Phase 3：Workspace / Project / Session 导航重构

Goal：把 “Workspace Flow” 从同级卡片堆叠改成逐级选择的 navigation flow。

Tasks：

- [ ] 明确 Project level 是否保留。
  - Decision options：
    - 保留 Project：Project 是 workspace grouping，sidebar 显示 Project 下的 Workspace。
    - 弱化 Project：只在 inspector 或 settings 中显示 project，主 flow 以 Workspace 为根。
    - 移除 Project：需要 API、DB、tests、迁移计划，不应混入 UI-only PR。
  - Done when：写入本文件或 `docs/architecture-decisions.md`。
  - Verify with：对应 route/API/UI 不再互相矛盾。

- [ ] 改成逐级选择流程。
  - User flow：
    1. 选择 workspace 或 project。
    2. 选中上级后显示下级列表。
    3. 只有选中上级后才能创建下级。
  - Done when：create workspace/session 不再是全局同级按钮。
  - Verify with：ControlPlanePage tests 覆盖未选上级时 create 下级 disabled。

- [ ] 创建入口改成基于当前选择的 `+` 或 More menu。
  - Done when：点击当前层级的 create icon 时弹出对应 inline drawer/form。
  - Avoid：多个大按钮同时展示。
  - Verify with：测试覆盖 create workspace/session form 的 parent id。

- [ ] 长路径、slug、raw id 下沉。
  - Done when：sidebar 只展示 label/status；path 在 hover tooltip 或 inspector。
  - Verify with：主 DOM 不默认显示 `/workspace/...`，inspector 可显示并 copy。

## Phase 4：Session 列表与 Summary 区

Goal：主区先回答“现在有什么在跑，哪个需要注意，下一步做什么”。

Tasks：

- [ ] 建立 session table/list。
  - Columns：Title、Status、Provider、Workspace、Last activity、Primary action、More。
  - Done when：session raw UUID 不在 list row 默认显示。
  - Verify with：ControlPlanePage test 更新。

- [ ] Summary row 限制为 3 到 4 个 operational metrics。
  - Suggested：Running sessions、Sandbox health、Recent errors、Usage today。
  - Done when：不是一堆相同 card 网格；只放操作有用指标。
  - Verify with：Playwright screenshot 检查首屏。

- [ ] 每行只保留一个 primary action。
  - Running/active session：Open chat 或 Resume。
  - Stopped sandbox：Start sandbox。
  - Failed session：Open details 或 Retry。
  - Secondary：More menu。
  - Verify with：测试覆盖 More menu 中 copy id、open details、delete/stop 等动作。

- [ ] 状态和相对时间可扫描。
  - Done when：状态 badge 和 relative time 不换行，不挤压 title。
  - Verify with：mobile screenshot。

## Phase 5：Sandbox 生命周期与 Details 下沉

Goal：sandbox 默认作为 health summary，而不是 raw infrastructure card。

Tasks：

- [ ] Sandbox summary 改成 compact health block。
  - Default：
    ```text
    Sandbox
    Running · Standard
    Healthy · updated 2m ago
    ```
  - Hidden：sandbox id、worker service name、router URL、image、createdAt。
  - Verify with：主页面不显示 router URL。

- [ ] Start/Stop/Restart 状态机收敛。
  - Done when：starting/stopping/restarting/running/stopped/failed 对应按钮状态明确。
  - Verify with：ControlPlanePage existing lifecycle tests 更新。

- [ ] Sandbox startup progress 改成真实阶段说明。
  - Suggested stages：requested、scheduling、worker ready、router ready、running。
  - Done when：25/50/100 这类数字不再单独出现，必须有阶段文案。
  - Verify with：测试覆盖 progress label。

- [ ] Sandbox details 进入 inspector。
  - Fields：sandbox id、worker id、router URL、image、region、resource profile、created/updated、last seen。
  - Done when：copy buttons 存在，但默认不抢首屏。
  - Verify with：打开 inspector 后可 copy raw id。

## Phase 6：Control Plane Inspector

Goal：用右侧 inspector 承接低频调试信息。

Tasks：

- [ ] 实现 collapsible inspector。
  - Desktop：右侧固定宽度，可折叠。
  - Mobile：drawer。
  - Done when：selected workspace/project/session/sandbox 共用一个 inspector shell。
  - Verify with：desktop/mobile screenshots。

- [ ] Inspector tabs。
  - Suggested tabs：Summary、Metadata、Logs、Route。
  - Done when：raw fields 不再散落在主页面。
  - Verify with：测试或 snapshot。

- [ ] Copy buttons 和 redaction。
  - Done when：raw id/router URL 可 copy，secret/token 永不显示。
  - Verify with：测试断言不渲染 bearer token、route token。

- [ ] Empty state。
  - Done when：未选中对象时 inspector 显示简短 empty state，不占用大量空间。
  - Verify with：Playwright screenshot。

## Phase 7：Chat Workspace 页面重构

Goal：把 chat 从 control plane overlay 改成独立 workspace layout。

Current entry：

- `apps/supervisor-web/src/pages/ControlPlaneSessionPage.tsx`
- route：`/control-plane/sessions/:sessionId`
- shared surface：`ThreadDetailSurface` from `@remote-codex/thread-ui`

Tasks：

- [ ] 保持 `@remote-codex/thread-ui` 为唯一 chat surface。
  - Done when：不复制 `ThreadTimeline`、`ThreadComposer`、`ThreadWorkspaceLayout` 代码。
  - Verify with：
    ```bash
    rg -n 'ThreadTimeline|ThreadComposer|ThreadWorkspaceLayout' apps/supervisor-web/src/pages/ControlPlaneSessionPage.tsx
    ```

- [ ] Chat layout 改成三栏 workspace。
  - Left：session/thread list。
  - Center：message stream + sticky composer。
  - Right：artifact/log inspector。
  - Done when：chat 不再视觉上盖在 control plane 上。
  - Verify with：desktop screenshot。

- [ ] 顶部 header 只显示 title、status、provider/model、settings。
  - Hidden：worker id、router URL、full UUID。
  - Verify with：DOM/snapshot 不默认显示 worker id。

- [ ] 保留左上角 hamburger 和 settings。
  - Done when：settings 中能进入 plugin 管理。
  - Verify with：ControlPlaneSessionPage test 覆盖 Settings 打开和 plugins 可见。

- [ ] Session/thread selector 与 control plane selection 对齐。
  - Done when：左栏 session list 使用 product session title/status，而不是 worker raw id。
  - Verify with：测试覆盖 sidebar link `/control-plane/sessions/:sessionId`。

## Phase 8：Tool Call、Logs 与 Artifact 展示策略

Goal：聊天流保持可读，把调试细节放到折叠块和右侧 panel。

Tasks：

- [ ] Tool calls 默认折叠。
  - Summary shows：tool name、status、duration、short result。
  - Details shows：raw input/output。
  - Done when：raw command output 不默认铺满聊天流。
  - Verify with：ThreadTimeline tests。

- [ ] Command output 使用 detail dialog 或 Logs tab。
  - Done when：长 stdout/stderr 不主导 message stream。
  - Verify with：现有 deferred detail tests 仍通过。

- [ ] Artifact panel tabs。
  - Tabs：Preview、Source、Logs、Metadata。
  - Done when：XYZ molecule artifact 可在 Preview 中查看，source 在 Source tab。
  - Verify with：XYZ renderer smoke 或 screenshot。

- [ ] Artifact selection 行为。
  - Done when：点击 timeline artifact 打开右侧 panel，而不是只在消息内展开。
  - Verify with：thread-ui tests 或 integration test。

- [ ] Metadata tab 显示 raw artifact/session data。
  - Done when：metadata 可 copy，但默认不显示在 chat stream。
  - Verify with：snapshot。

## Phase 9：响应式、可访问性与键盘体验

Goal：desktop/tablet/mobile 都保持信息层级清楚。

Tasks：

- [ ] Desktop 三栏布局稳定。
  - Done when：1280px 宽度下 control plane 和 chat workspace 不需要页面级纵向滚动才能看到主要操作。
  - Verify with：Playwright screenshot。

- [ ] Mobile 变成 stacked layout。
  - Control Plane：sidebar/drawer、main list、inspector drawer。
  - Chat：thread drawer、chat center、artifact drawer。
  - Verify with：375px screenshot。

- [ ] Keyboard navigation。
  - Done when：sidebar items、More menu、inspector tabs、composer、settings 可键盘访问。
  - Verify with：Testing Library role queries，manual keyboard smoke。

- [ ] Touch targets。
  - Done when：主要按钮和 menu item 不低于 44px touch target，密集辅助控件有 clear hit area。
  - Verify with：mobile screenshot + DOM class review。

- [ ] No overlap rule。
  - Done when：top bar、sidebar、composer、timeline、inspector 不互相遮挡。
  - Verify with：desktop/mobile screenshots。

## Phase 10：测试、Smoke 与部署闭环

Goal：每个 UI slice 都有自动测试和 staging smoke。

Tasks：

- [ ] 更新 `ControlPlanePage.test.tsx`。
  - Coverage：user menu、hierarchy selection、create parent gating、session list、inspector。

- [ ] 更新 `ControlPlaneSessionPage.test.tsx`。
  - Coverage：thread list、settings/plugins、hidden raw ids、prompt send、interrupt、route token refresh。

- [ ] 更新 `ThreadTimeline.test.tsx`。
  - Coverage：tool collapsed by default、artifact panel events、deferred details。

- [ ] 添加 Playwright smoke checklist。
  - Required views：
    - `/control-plane`
    - `/control-plane/sessions/:sessionId`
    - mobile `/control-plane`
    - mobile chat workspace
  - Evidence：screenshots or trace.

- [ ] 部署并验证 build sha。
  - Done when：
    ```bash
    curl -sS https://remote-codex-frontend-production.up.railway.app/build.json
    ```
    returns pushed SHA.

- [ ] 手工验收清单。
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

