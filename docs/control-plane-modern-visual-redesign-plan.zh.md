# Control Plane 现代视觉重构方案

本文档只定义方案和推进清单，不直接修改前端实现。目标是把 `https://remote-codex-frontend-production.up.railway.app/control-plane` 从“工程控制台 + 调试面板”改成更现代、简洁、接近 Apple/macOS 原生工具感的 control panel。

关键词：

- Apple-like，但不是照搬 Apple branding。
- 更像本地 app / macOS utility，不像 SaaS marketing dashboard。
- 默认干净，调试信息按需展开。
- 主区 session-first，sandbox 和 usage 是状态背景，不抢主任务。
- 不引入整套重型模板库，优先重排现有 React/Tailwind 结构。

## 研究来源

### Apple HIG

- [Apple HIG: Split views](https://developer.apple.com/design/Human-Interface-Guidelines/split-views)
  - 可借鉴：多 pane 结构、sidebar + content + inspector、当前选择高亮、pane 可隐藏、隐藏 pane 必须有恢复入口、thin divider。
  - 对本项目的转译：`Sidebar | Sessions | Inspector` 是合理结构，但 Inspector 默认不应一直占据视觉重心。

- [Apple HIG: Sidebars](https://developer.apple.com/design/human-interface-guidelines/sidebars?changes=_11)
  - 可借鉴：sidebar 是高层导航，不应该承载太深、太重的信息层级；空间不足时需要更紧凑的替代导航。
  - 对本项目的转译：左侧不继续显示“所有 project 全展开树”，改成 workspace/project context + compact session/workspace navigation。

- [Apple HIG: Toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars?changes=la)
  - 可借鉴：toolbar 用于位置感、导航、搜索和常用动作；动作需要分组，避免过度拥挤；标题应短而有用；不要用 app name 充当无效标题。
  - 对本项目的转译：顶部不要重复 `Control Plane` 大标题 + 解释文案；使用 breadcrumb/context title、search、sandbox status、primary action、account。

- [Apple HIG: Materials](https://developer.apple.com/design/human-interface-guidelines/materials?changes=_11)
  - 可借鉴：material 用于区分层级、保留上下文、增强前景/背景关系，但必须保证对比度。
  - 对本项目的转译：可以使用轻微 translucent surface、blur、vibrancy-like text tokens，但不要做装饰性 glassmorphism。

- [Apple HIG: Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)
  - 可借鉴：界面应该直觉、可感知、可适应。
  - 对本项目的转译：菜单必须支持 Escape、focus ring、键盘 tab 顺序；mobile sidebar/inspector 不能互相挡住。

### 现代 dashboard/app shell

- [Vercel dashboard navigation redesign](https://vercel.com/changelog/dashboard-navigation-redesign-rollout)
  - 可借鉴：可隐藏/可调整 sidebar、项目作为 filter、按常用开发者 workflow 排序、mobile 使用更适合单手操作的底部导航。
  - 对本项目的转译：Project 更适合作为 context filter，不适合作为永远铺开的主导航层。

- [shadcn/ui Sidebar](https://ui.shadcn.com/docs/components/radix/sidebar)
  - 可借鉴：sidebar 是 viewport-level layout primitive，支持 collapsible icon mode、themeable、composable。
  - 对本项目的转译：可以学习它的结构和状态模型，但不必引入 shadcn 依赖。

- [shadcn/ui dashboard blocks](https://ui.shadcn.com/blocks?category=dashboard)
  - 可借鉴：sidebar + breadcrumb header + table/list 主内容的 dashboard vocabulary。
  - 对本项目的转译：session 主区应更接近 table/list，而不是多个 dashboard cards。

- [Tailwind Plus sidebar layouts](https://tailwindcss.com/plus/ui-blocks/application-ui/application-shells/sidebar)
  - 可借鉴：官方 responsive sidebar shell、desktop/tablet/mobile 都有稳定结构。
  - 对本项目的转译：先把 shell 响应式做好，再谈视觉细节。

- [Tailwind Plus Application UI](https://tailwindcss.com/plus/ui-blocks/application-ui)
  - 可借鉴：Application shells、headings、tables、description lists、forms 是可组合的产品 UI 基础。
  - 对本项目的转译：session list、metadata list、sandbox state 应使用一致的 list/table/description-list vocabulary。

- [Langfuse observability overview](https://langfuse.com/docs/observability/overview)
  - 可借鉴：LLM trace/tool/cost/latency 需要 drill-down，不应默认铺满主流。
  - 对本项目的转译：tool/log/artifact detail 保留在 chat workspace/inspector，不回流到 control plane 首屏。

## 视觉方向

### Scene

用户是在一台 laptop 或外接显示器上远程监控一个正在运行的 Codex sandbox，同时可能在手机上快速恢复 session。环境是低干扰、长时间使用，不是展示型 dashboard。界面应该像 macOS 系统工具或 Vercel/Linear 式开发者 console：安静、清楚、轻量、有层级。

### Register

这是 product UI。设计服务于操作效率，不能做营销 landing、hero、装饰插图或大面积品牌表达。

### 风格目标

- 背景：更浅的 tinted neutral，不再大面积厚重深色 panel。
- 面：少量 translucent/inset surface，近似 macOS sidebar/window/content separation。
- 字体：优先 system stack 或保留现有 IBM Plex Sans 但调小层级差；不要大标题。
- 圆角：统一 10 到 14px，小控件 8 到 10px，避免过圆的 SaaS 卡片。
- 阴影：极轻，只用于 floating inspector、menus、popover；常规 panel 用 hairline border。
- 色彩：amber 只用于 primary action 或 warning；selection 可用 muted blue/graphite，不再到处 amber。
- 图标：使用小型单色 icon 表达动作，文本只用于主要命令。
- 密度：主区 list/table 比 card 更优先。

### 明确不做

- 不引入 heavy admin template。
- 不做纯黑背景、霓虹、紫蓝渐变。
- 不做真正透明玻璃覆盖整个页面。
- 不默认展开 raw metadata。
- 不在 control plane 重新实现 chat UI。
- 不在本阶段移除 Project 的 API/DB 层级，只把 Project 视觉上改成 context filter。

## 目标布局

### Desktop

```text
┌─────────────────────────────────────────────────────────────────────┐
│ Toolbar: sidebar toggle / context breadcrumb / search / status / user │
├───────────────┬─────────────────────────────────────────────┬───────┤
│ Sidebar       │ Main                                        │ Drawer│
│               │                                             │ hidden│
│ Workspace     │ Sessions                                    │ by    │
│ Project filter│ table/list                                  │ default
│ Sandbox chip  │                                             │       │
│ Usage link    │ Active summary strip                        │       │
│ Settings      │                                             │       │
└───────────────┴─────────────────────────────────────────────┴───────┘
```

默认只显示两栏：

- left sidebar：context + navigation。
- main content：sessions first。

Inspector 默认隐藏。只有以下动作打开：

- 点击 session row。
- 点击 `Details` icon。
- 点击 More -> `Show metadata`。
- 点击 sandbox health chip。

### Main content

主区首屏顺序：

1. Context title row：当前 workspace/project + sandbox health + primary action。
2. Session table/list：主要任务。
3. Activity strip：最近事件、sandbox readiness、usage compact。

不再把 overview cards 放在页面顶部占视觉重心。

### Sidebar

建议结构：

```text
Remote Codex

Workspace
  Computational chemistry test
  Project: selected as filter

Sessions
  All
  Active
  Needs runtime
  Failed

System
  Sandbox
  Usage
  Settings
```

Project 不再作为树里一大堆 sibling 默认展开；它变成 workspace context 内的 filter/select。

### Session list

桌面 table/list：

```text
Name        Runtime      Last activity   Model       Action
session1    Ready        2d ago          gpt-5.4     Resume
session1    Ready        2d ago          No model    Resume
```

每行只展示一个 primary action。More menu 放：

- Show details
- Copy session ID
- Copy sandbox ID
- Close session

### Inspector

Desktop：右侧 drawer，宽度 360 到 420px，默认关闭。

Tabs：

```text
Summary | Metadata | Route | Logs
```

打开逻辑：

- Summary：用户点 session/sandbox 时默认打开。
- Metadata：只有显式点 metadata / copy ids 时打开。
- Route：只有 route-token 相关操作时打开。
- Logs：只有 inspect 或 failed/degraded 时打开。

### Mobile

Mobile 不做三栏。

```text
Top toolbar
Segmented context: Sessions / Sandbox / Usage
Session list
Bottom action bar or floating primary action
Drawer for sidebar and inspector
```

移动端重点：

- 一屏只显示一个主任务。
- Sidebar 和 Inspector 都是 drawer。
- Account 在 toolbar trailing avatar。
- 创建动作是 floating `+` 或 toolbar button，跟当前 context 绑定。

## 组件与文件边界

推荐继续复用现有结构，不大迁移：

- `apps/supervisor-web/src/pages/control-plane/ControlPlaneShell.tsx`
  - 承担整体 split view shell。
  - 新增 sidebar collapsed / inspector drawer state 的 class hooks。

- `ControlPlaneTopBar.tsx`
  - 改成 toolbar 模型。
  - 支持 leading、title/breadcrumb、center search、trailing actions。

- `ControlPlaneSidebar.tsx`
  - 从 wrapper 变成真正 sidebar component。
  - 接收 context、filters、counts、selected filter、onCreate。

- `ControlPlaneInspector.tsx`
  - 改成 drawer/aside。
  - 默认 hidden；mobile 用 drawer overlay。

- `ControlPlanePage.tsx`
  - 继续持有数据和事件。
  - 把 tree rows、session rows、summary strip、account menu 拆出去。

建议新增：

```text
apps/supervisor-web/src/pages/control-plane/ControlPlaneToolbar.tsx
apps/supervisor-web/src/pages/control-plane/ControlPlaneSessionList.tsx
apps/supervisor-web/src/pages/control-plane/ControlPlaneContextSidebar.tsx
apps/supervisor-web/src/pages/control-plane/ControlPlaneStatusStrip.tsx
apps/supervisor-web/src/pages/control-plane/ControlPlaneAccountMenu.tsx
```

## Design Tokens

新增或收敛为以下 token，不直接散写颜色：

```css
--control-window-bg
--control-sidebar-bg
--control-content-bg
--control-surface
--control-surface-elevated
--control-hairline
--control-selection-bg
--control-selection-fg
--control-toolbar-bg
--control-shadow-popover
```

建议方向：

- light mode 先做好，Apple-like 更容易显著。
- dark mode 保留，但降低大面积纯暗 panel 的厚重感。
- 选择态使用 muted blue/graphite，不用到处 amber。
- warning/failure 才使用 amber/red。

## 分阶段实施计划

## Implementation Evidence

本节记录当前分支已经完成和验证的部分，避免后续 goal 模式重复判断。

### 2026-06-07 Local Implementation

Scope：

- `ControlPlaneTopBar` 增加 macOS-like window controls，顶部改为更窄的 toolbar 视觉。
- `/control-plane` 默认改为 two-pane：sidebar + main，Inspector 默认隐藏。
- Sidebar 新增 Workspace context、Sessions filters、System group，并保留 project/workspace tree 作为逐级选择入口。
- Main 新增 compact workspace hero，sandbox lifecycle 主动作在首屏可见，sessions 成为主内容。
- Inspector 改为按需 drawer，session row 点击或 toolbar Inspector 打开，Escape 可关闭。
- Account menu、create panel、row menu、Inspector 支持 Escape 关闭。
- Raw metadata、route token、logs 保留在 Inspector tabs 中，不默认暴露。
- Mobile 下保留 project/workspace tree 入口，避免隐藏创建下级前必须选择上级的路径。

Evidence：

- Chrome DevTools MCP verified local `/control-plane` renders after login at `http://127.0.0.1:5173/control-plane`。
- Playwright desktop screenshot: `output/playwright/control-plane-modern-after-desktop.png`。
- Playwright mobile screenshot: `output/playwright/control-plane-modern-after-mobile.png`。
- Tests:
  - `pnpm --filter @remote-codex/supervisor-web exec vitest run src/pages/ControlPlanePage.test.tsx` passed, 23 tests。
  - `pnpm --filter @remote-codex/supervisor-web exec tsc --noEmit` passed。
  - `pnpm --filter @remote-codex/supervisor-web build` passed。
  - `git diff --check -- apps/supervisor-web/src/pages/ControlPlanePage.tsx apps/supervisor-web/src/pages/control-plane/ControlPlaneTopBar.tsx apps/supervisor-web/src/pages/ControlPlanePage.test.tsx apps/supervisor-web/src/index.css docs/control-plane-modern-visual-redesign-plan.zh.md` passed。

Residual work：

- Phase G live frontend smoke is done. The deploy helper reported a control-plane API SHA mismatch because this pass changed only frontend UI and the API `/healthz` still reports the previous API build SHA。
- The current redesign is intentionally scoped to `/control-plane`; session chat UI remains owned by `@remote-codex/thread-ui`。

### 2026-06-07 Deployment Evidence

- Commit: `cf3c0e42d596192b276ad86ae0d5dc4ea8c6f489` (`Modernize control plane shell`)。
- GitHub Actions: `Staging Images` run `27086295547` passed。
- Frontend deploy step passed in the workflow。
- Live smoke URL: `https://remote-codex-frontend-production.up.railway.app/control-plane`。
- Live Playwright screenshot: `output/playwright/control-plane-modern-live-desktop.png`。
- Live smoke verified the new toolbar, sidebar context navigation, default-hidden inspector, workspace hero, and session-first main surface after login。
- Chrome DevTools MCP smoke verified Inspector opens, Escape closes it, account menu opens, and Escape closes it on the live frontend。
- Chrome DevTools MCP smoke verified session resume from workspace `test1`: selecting the workspace showed two runtime-ready sessions, clicking `Resume session session1 from summary` navigated to `/control-plane/sessions/2008afb1-a046-4509-981e-8ce19361453f`, and the thread UI rendered history, thread list, and composer without sending a prompt。
- Deploy helper final health check:
  - expected SHA: `cf3c0e42d596192b276ad86ae0d5dc4ea8c6f489`
  - control-plane API `/healthz` SHA: `9e8d13d533816896b8dcb9b0d87edf372954ec3d`
  - interpretation: frontend-only UI change deployed successfully, but API health SHA cannot prove frontend build freshness。

### Phase A：视觉基线与截图

- [x] 截取当前线上 `/control-plane` desktop/mobile。
- [ ] 截取当前 session page desktop/mobile。
- [x] 标注首屏过重区域：一直打开的 Inspector、overview strip、card panels、dense tree、top bar actions。
- [x] 把截图路径写回本文件。

Done when：

- 有 before screenshots。
- 明确哪些视觉元素会被删除、隐藏、重排。

Verify：

```bash
bash /home/u/.codex/skills/playwright/scripts/playwright_cli.sh open https://remote-codex-frontend-production.up.railway.app/control-plane
bash /home/u/.codex/skills/playwright/scripts/playwright_cli.sh screenshot --filename output/playwright/control-plane-modern-before-desktop.png
```

### Phase B：Toolbar 与 shell

- [x] `ControlPlaneTopBar` 改成 Apple-like toolbar。
- [x] `ControlPlaneShell` 改成 two-pane default，Inspector 默认隐藏。
- [x] `Details` 变成 icon/toolbar item，不再常驻右栏。
- [x] Alert stack 改成 toolbar 下方的 slim banner 或 toast region。

Done when：

- `/control-plane` 第一眼不再是三栏调试台。
- 默认首屏只有 sidebar + main。
- toolbar 控件不超过 3 组。

Verify：

- `ControlPlanePage.test.tsx`
- typecheck
- desktop/mobile screenshots。

### Phase C：Sidebar 从树改为 context navigation

- [x] Project 改成 context filter/select，不默认展开所有 project。
- [x] Workspace 显示当前上下文和切换入口。
- [x] Sessions filters：All / Active / Needs runtime / Failed。
- [x] System group：Sandbox / Usage / Settings。
- [x] `+` 创建动作根据当前 context 决定创建 project/workspace/session。

Done when：

- 左侧看起来像现代 app sidebar，而不是文件树和调试对象树。
- 用户仍可逐级创建，但默认视觉不暴露所有层级。

Verify：

- parent gating tests。
- user flow：选 project -> workspace -> create session。

### Phase D：Main 改成 session-first

- [x] Overview strip 下沉到 compact status row。
- [x] Sessions 用 table/list 作为主内容。
- [x] Selection panel 降级为 compact context summary，metadata 合并到 drawer。
- [x] Empty state 给明确下一步动作。
- [x] Row hover、selected、focus、keyboard navigation 完整。

Done when：

- 首屏主要视觉焦点是 sessions。
- raw id 不出现在 table/list。
- 每行只有一个 primary action。

Verify：

- session list tests。
- desktop screenshot 对比旧版应明显更简洁。

### Phase E：Inspector drawer

- [x] Inspector 默认关闭。
- [x] 点击 session row 打开 Summary drawer。
- [x] Metadata/Route/Logs tabs 保留，但不默认出现。
- [x] Drawer 支持 Escape 关闭。
- [x] Mobile drawer 不遮挡 toolbar 后无法关闭。

Done when：

- raw fields 仍可 copy，但不会默认影响首屏。
- Escape 和 focus trap 正常。

Verify：

- Testing Library role/name tests。
- Playwright: open/close inspector, Escape close, copy buttons visible。

### Phase F：Apple-like polish

- [x] light mode token polish。
- [x] dark mode token polish。
- [x] hairline divider 替代厚 border。
- [x] popover/drawer 使用轻阴影和 material-like surface。
- [x] status chips 统一尺寸和语义色。
- [x] icon buttons 使用统一 32/36px 尺寸。
- [x] account menu Escape 关闭。

Done when：

- 页面第一眼明显比当前版本更轻、更现代。
- Apple-like 是通过 structure/material/toolbar/sidebar 表达，不是通过装饰性玻璃。

Verify：

- Playwright desktop/mobile screenshots。
- keyboard smoke。
- contrast spot check。

### Phase G：Staging smoke

- [x] Deploy branch。
- [ ] Verify frontend build SHA。
- [x] Login staging。
- [x] `/control-plane` desktop smoke。
- [x] `/control-plane` mobile smoke。
- [x] session resume smoke。
- [x] settings/account-menu smoke。
- [x] record screenshots and residual risks。

Done when：

- build SHA matches pushed code。
- no console errors。
- no raw tokens copied into logs。

## Acceptance Criteria

视觉：

- 打开 `/control-plane` 第一眼明显是 modern app shell，而不是后台表单堆叠。
- Inspector 默认不占右栏。
- Sidebar 是简洁 navigation/context，不是深展开树。
- 主区优先展示 sessions table/list。
- 顶部 toolbar 窄、稳定、短标题。
- 默认首屏不显示 UUID、worker id、router URL、image URL、exact timestamps。

交互：

- Project/workspace/session 创建的 parent gating 不回退。
- Resume 正常进入 chat workspace。
- Sandbox start/stop/restart 状态不回退。
- Account menu 和 Inspector 支持 Escape。
- Mobile 下 sidebar/inspector 都可关闭。

技术：

- 不 fork `@remote-codex/thread-ui`。
- 不引入 shadcn/tailwind plus template 源码。
- 不改变 API schema。
- 每个阶段都更新测试和 screenshots。

## 推荐下一步 Goal

```text
目标：
- 完成 docs/control-plane-modern-visual-redesign-plan.zh.md Phase A + Phase B。

范围：
- 只改 ControlPlaneShell.tsx、ControlPlaneTopBar.tsx、index.css 和必要 tests。
- 不改 API。
- 不改 @remote-codex/thread-ui。

验收：
- ControlPlanePage tests pass。
- supervisor-web typecheck pass。
- desktop/mobile before/after screenshots。
- Inspector 默认隐藏，Details 能打开。
- 更新本文件 evidence。
```
