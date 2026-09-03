# Supervisor Web UI 审计与优化清单

日期：2026-09-03
分支：`rust/acp-rewrite`
范围：`apps/supervisor-web` 中由 Supervisor 自己维护的产品界面，包括 Relay Home、Portal、Devices、Account、Admin、Guide、Workspaces、New Workspace、New Thread、Import Session、应用导航和设置。
排除：`@remote-codex/thread-ui` 提供的线程列表、线程详情、timeline、composer、shell 等内部实现；本轮不修改 `remote-codex-thread-ui` 源码。

## 目标定义

这里的“高端优雅”不是增加阴影、渐变或装饰，而是让界面像成熟的开发者工具：安静、稳定、紧凑、状态明确，频繁操作无需猜测。结构主要通过字号、字重、间距、对齐和分隔线表达；卡片只用于真正独立、可重复的对象，禁止卡片嵌套。

物理场景：开发者在夜间用手机或副屏检查自己机器上的长时任务，光线偏暗，注意力有限，需要迅速识别当前设备、工作区、运行状态和下一步操作。暗色主题应是低眩光的暖中性色；亮色主题应适合白天移动使用。琥珀仅用于主操作、当前选择和需要注意的状态。

## 方法与证据

- [x] 确认 Rust 重构 worktree 和分支，工作目录为 `.worktrees/rust-rewrite`。
- [x] 使用隔离端口启动本地 Supervisor、Vite、真实 Relay 和 relay-supervisor。
- [x] 使用 Playwright 浏览器接口走查桌面和 `390 x 844` 手机视口。
- [x] 使用独立数据库、测试用户、在线设备、长名称工作区和真实空态进行验证。
- [x] 检查页面 DOM、触控尺寸、横向溢出、嵌套描边和关键操作路径。
- [x] 对照 Linear、GitHub Primer、Apple HIG、WAI-ARIA 和 WCAG 2.2。

### 实测基线

| 页面 | 实测问题 |
| --- | --- |
| Workspaces，390px | 17 个可交互目标中 14 个小于 44px；存在 12 个“可点击行内嵌按钮”；删除、置顶、重命名热区分别只有 28px、28px、16px。 |
| Relay Devices，390px | 当前 7 个操作目标全部小于 44px；23 个描边容器中 16 个处于另一描边容器内。 |
| Relay Home，390px | 22 个描边容器中 16 个嵌套；页面首屏由营销式卡片和重复 CTA 主导。 |
| Relay Guide，390px | 文档宽度达到 524px，产生整页横向滚动；21 个描边容器中 14 个嵌套。 |
| Account modal，390px | 弹层内继续嵌套 Profile、Password 卡片，并出现页面与弹层双重滚动。 |
| New Thread，390px | Backend 同时使用 select 和四张可选卡片表达同一选择；表单卡片内再次嵌套卡片。 |
| Import Session，390px | 原生 select 一次承载大量历史 session，无搜索；长说明挤占首屏，缺少明确返回路径。 |
| Relay Admin | Rust relay 尚未暴露前端请求的 `/relay/admin*` 等接口；页面把原始 `not found` 当成主界面错误，且不会进入登录态。 |

## 参考准则

- [Linear design refresh](https://linear.app/now/behind-the-latest-design-refresh)：导航应退后，工作内容应突出；结构应被感知，而不是被边框反复强调。
- [Primer layout](https://primer.style/product/getting-started/foundations/layout/) 与 [navigation](https://primer.style/product/ui-patterns/navigation/)：使用可预测页面结构；窄屏应真正转换为单栏任务流。
- [Primer buttons](https://primer.style/product/components/button/)：一个视图只有一个主要操作，同级操作使用一致的层级。
- [Primer forms](https://primer.style/product/ui-patterns/forms/) 与 [saving](https://primer.style/product/ui-patterns/saving/)：永久标签、简单纵向布局、明确保存模型、错误靠近字段。
- [Primer empty states](https://primer.style/product/ui-patterns/empty-states/) 与 [loading](https://primer.style/product/ui-patterns/loading/)：区分首次为空、筛选为空和失败；使用尺寸稳定的局部 skeleton。
- [Primer delete pattern](https://primer.style/product/scenario-patterns/delete/) 与 [confirmation dialog](https://primer.style/product/components/confirmation-dialog/guidelines/)：区分 Remove 和 Delete；不可逆操作说明对象、影响及恢复性。
- [Apple buttons](https://developer.apple.com/design/human-interface-guidelines/buttons) 与 [layout](https://developer.apple.com/design/human-interface-guidelines/layout)：主要触控目标至少 44 x 44，并让操作靠近其影响的内容。
- [WCAG 2.2 target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)、[reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html)、[focus not obscured](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html) 和 [status messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html)：24px 是 AA 底线，本产品移动端以 44px 为目标；320px 不应整页横向滚动；焦点不能被 sticky/fixed UI 遮挡；异步结果应可被辅助技术感知。
- [WAI-ARIA modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)：弹层需要可访问标题、`aria-modal`、焦点约束、Escape 关闭和焦点归还。

## 已定位问题

以下勾选表示问题已经修复，并通过静态检查、浏览器实测或自动回归验证。

### P0：操作正确性与可达性

- [x] Workspaces 行使用 `role="link"`，内部再嵌套四个 button，键盘和屏幕阅读器语义冲突。
- [x] 本地 Workspaces 页没有可见的主导航或 Settings 入口；只有进入线程相关页面后才能访问设置。
- [x] Relay Devices 删除设备使用 `window.confirm`，与产品对话框不一致，也无法表达加载和服务端错误。
- [x] Add Device、Share Device、权限编辑弹层没有完整 dialog 语义、焦点约束、Escape 关闭和焦点归还。
- [x] Account settings 同时以独立路由和用户菜单内的大弹层存在，产生重复信息架构和移动端双重滚动。
- [x] “Verify email” 只改变本地文案，没有调用后端，是误导性的假操作。
- [x] Account 初次加载失败会被误报为“需要登录”，真实网络错误不可见且没有 Retry；当前密码还错误使用 `autocomplete="new-password"`。
- [x] Relay 注册无条件把 Registration password 设为必填，即使服务器未要求邀请码。
- [x] Relay 登录后总是进入 Devices，未保存原始深链，直接访问共享 workspace/thread 时会丢失上下文。
- [x] Relay Home 把 session 请求失败伪装为 Signed out，服务不可用与未登录无法区分。
- [x] 已在线但缺少 `connectedAt` 的设备显示 “Online since never”。
- [x] Relay Admin 在当前 Rust backend 返回 404 时直接显示原始 “not found”，没有说明能力缺失或恢复路径。
- [x] New Workspace 空输入时主按钮仍可用，提交后才出现通用错误，且焦点不会回到字段。
- [x] Import Session 缺少返回/取消路径，大量候选 session 没有搜索或筛选。
- [x] Import 获取 backend 失败时会伪造“可用 Codex”选项，未就绪 backend 也可以提交。

### P1：结构与视觉层级

- [x] Relay Home 使用“主卡片 + 内部状态 pill + 三个 fact 卡 + 右侧卡片 + 三个 feature 卡”的营销式构图，不像操作台。
- [x] Relay Guide 的 mode 卡、flow 外卡、step 内卡、code 卡层层嵌套，手机上形成长而重的边框隧道。
- [x] Devices 把四个共享类别永久展开为四张面板，即使全部为空，导致主要设备任务只占页面一小部分。
- [x] Device 自身又被面板和卡片双重包裹，四个同权操作拥挤，删除始终暴露在高频操作旁。
- [x] Device setup 的 Clipboard API 不存在或写入失败时仍可能显示 Copied；通用代码块复制没有可感知的成功/失败反馈。
- [x] Devices 每 3 秒全量拉取 portal，不检查页面可见性、没有退避，首次成功后的失败被完全吞掉。
- [x] 共享记录的 access history 使用绝对定位浮层，却没有 disclosure 的 `aria-expanded`、Escape、外点关闭和焦点处理。
- [x] Workspaces 每条记录都是浮卡，右侧 Supervisor 又是一张孤立卡；长页面留下大量无意义空白。
- [x] 工作区路径用 9px 可点击文字和弹窗查看，既难读也不符合“次要信息仍可操作”的预期。
- [x] New Thread 用 select 与 backend 卡片重复表达选择，运行时安装操作和创建线程主任务混在一起。
- [x] New Thread 默认选择内部值 `yolo`，没有把权限风险解释为用户可理解的“完整访问”；无效 workspace 参数会静默切到第一项。
- [x] Settings、Account、Admin 多处以 panel 内再嵌 panel 的方式分组，视觉边界远多于信息边界。
- [x] 页头结构不一致：有的使用 sticky bar，有的只是标题，有的缺少品牌/返回/账户/当前设备上下文。
- [x] 按钮命名不一致，例如 Create、Add、Save、Register 与对象名有时缺失；部分主按钮重复出现。

### P2：细节、响应式与反馈

- [x] 大量元数据使用过宽的 uppercase letter spacing，降低扫描速度并产生“模板化后台”观感。
- [x] 颜色几乎全部落在冷 slate 一条色轴，主操作主要依赖近白填充，品牌和语义层级不清。
- [x] 输入、按钮、菜单、dialog 的 focus-visible 实现不一致。
- [x] 多个页面用纯文本 “Loading...” 替代最终布局，加载完成时发生明显结构跳动。
- [x] 空态被包成虚线卡片再放进面板，说明重复且没有按任务优先级收敛。
- [x] Relay Guide 的 command code block 造成手机横向溢出。
- [x] `bg-black/*`、过大的圆角、全局 pill 和不一致阴影破坏主题一致性。
- [x] 部分菜单只处理鼠标外点，不完整处理键盘 roving focus、Escape 和触发器焦点恢复。
- [x] 缺少统一的 `prefers-reduced-motion` 降级。
- [x] 通过 320px 严格窄视口、768px 等效放大布局、亮色主题和键盘遍历建立成体系验收。

## 实施 Checklist

### A. 共享基础

- [x] 建立统一的产品页 shell、页头、section header、按钮、icon button、输入和状态样式。
- [x] 使用 OKLCH 重整深浅主题：暖中性色为主，琥珀仅用于主操作/选择/注意；保留清晰语义色。
- [x] 统一 `:focus-visible`、disabled、loading、error、hover、active 状态。
- [x] 移动端主要操作热区达到 44px；桌面紧凑控件至少满足 WCAG 24px 与间距要求。
- [x] 添加统一 skeleton、空态、notice 和 section divider 模式。
- [x] 添加 reduced-motion 规则，避免动画布局属性。
- [x] 为 Supervisor 自维护页面提供本地可控的确认 dialog，不依赖线程 UI 的视觉实现。

### B. Workspaces 与创建流程

- [x] 重写 workspace 行为真实 Link + 同级操作，不再嵌套交互元素。
- [x] 将多张 workspace 卡收敛为一张列表面和 row divider。
- [x] 把重命名、删除等低频操作放入行尾菜单，删除保持二次确认和失败上下文。
- [x] 放大置顶、菜单、路径等触控热区；长路径可截断、复制或查看完整值。
- [x] 把 Supervisor 元数据收敛为安静的状态条/可折叠详情，不再与列表抢占一列。
- [x] 给 Workspaces 增加一致导航、设置入口和 Relay 设备返回路径。
- [x] New Workspace 改为明确的 New folder / Existing path / Git repository 模式。
- [x] New Workspace 加 Cancel/Back、禁用空提交、字段级错误和聚焦错误字段。

### C. Relay 用户界面

- [x] Relay Home 从营销卡片阵列改为直接进入工作的控制台首页。
- [x] Relay Guide 改为连续文档结构和编号步骤，移除嵌套卡片并修复 code overflow。
- [x] Portal 使用清晰的登录/注册分段控制，补品牌和返回路径，修正邀请码可选逻辑。
- [x] Devices 采用单一资源列表；设备状态、名称、最后活动和主操作按固定列对齐。
- [x] Add Device 使用页内渐进表单，不再先弹 modal。
- [x] Device 低频操作进入 overflow menu，危险项与普通项分组。
- [x] 共享内容使用 tabs/segmented navigation，仅展示当前类别；空态不同时铺满四张卡。
- [x] 替换 `window.confirm`，完善分享/权限弹层语义和键盘行为。
- [x] Account 只保留可链接的独立页面，移除菜单内重复的大弹层。
- [x] 删除假的 Verify email；将 Profile 与 Password 改为连续设置 sections。

### D. Admin、New Thread、Import、Settings

- [x] Admin 能力缺失时显示明确的兼容性状态、当前可用操作和恢复建议，不显示裸 404。
- [x] Admin summary 改为紧凑统计条，tabs 可键盘操作并同步 URL。
- [x] Admin 表格在窄屏改为可读的行详情，不依赖整页横向滚动。
- [x] New Thread 删除 backend select 与卡片的重复表达，将安装/更新移到次级管理入口。
- [x] Approval mode 使用用户可理解的标签与风险说明，不直接把内部值当主要文案。
- [x] Import Session 缩短首屏说明，增加返回路径、候选搜索、候选数和无结果反馈。
- [x] App Settings 拆成连续 sections，减少 panel/card 嵌套，统一保存反馈和移动端高度。

### E. 验收

- [x] `pnpm --filter @remote-codex/supervisor-web typecheck` 通过。
- [x] `pnpm --filter @remote-codex/supervisor-web test` 通过。
- [x] `pnpm --filter @remote-codex/supervisor-web build` 通过。
- [x] 定向 Playwright e2e 覆盖 workspace 创建、workspace 行操作、Relay Devices、New Thread 和 Import。
- [x] 逐页检查 `320 / 375 / 390 / 768 / 1440px`，无非必要整页横向滚动或遮挡。
- [x] 深色与亮色主题逐页截图检查。
- [x] 键盘检查页头、列表行、菜单、tabs、表单、dialog；焦点可见且顺序合理。
- [x] 再次统计移动端触控目标、嵌套交互和嵌套描边，关键页面达到目标。
- [x] 更新本清单，所有已实现项勾选；未完成项必须写明阻塞原因，不以“后续优化”代替。

### F. 部署

- [x] 仅提交本轮 Supervisor Web UI、审计文档、回归测试和 Rust relay 部署边界，不混入并行的 Rust/ACP 改动。
- [x] 推送 `rust/acp-rewrite` 并从该 ref 手动触发分支隔离的 `Relay Deploy`；`main` 的 Node image/deploy jobs 在该 ref 上必须为 skipped。
- [x] 等待 GitHub Actions 的 Linux/amd64 Rust build、带主机指纹的 artifact upload、独立 systemd 替换与公网隔离验证成功。
- [x] 检查 `https://remote.lnz-study.com` 在线页面、资源版本和关键响应式界面，并确认 `https://remote-codex.lnz-study.com` 的 Node 资源未变化。

## 最终验证记录

- `pnpm --filter @remote-codex/supervisor-web typecheck`：通过。
- `pnpm --filter @remote-codex/supervisor-web test`：通过；当前没有 Vitest 单测，实际行为由 Playwright 回归覆盖。
- `pnpm --filter @remote-codex/supervisor-web build`：通过；仅保留既有 worker URL、3Dmol eval 和 chunk size 警告。
- 新增 product/relay Playwright：26 项通过，2 项按项目设计跳过；其中包含 host 与 relay 两组 `320 / 375 / 390 / 768 / 1440px` 宽度矩阵。
- 既有 `phase2`：5 项通过，1 项在 desktop 项目按设计跳过。
- 390px 实测：Workspaces 和 Relay Devices 的 `scrollWidth` 等于 viewport，嵌套交互为 0，可见操作小于 44px 的数量为 0；Relay Guide 同样无横向溢出。
- 主题对比度计算：亮色正文 15.64:1、亮色 muted 5.40:1、亮色主按钮 6.77:1；暗色正文 16.39:1、暗色 muted 5.81:1、暗色主按钮 9.07:1。
- `@remote-codex/thread-ui` 源码与包文件无 diff；通用交互 CSS 已限定在 Supervisor 自维护 surface，未覆盖 thread-ui 控件。
- 当前 Rust relay 尚未实现 Admin 数据接口；前端已提供明确兼容性状态、Retry 和 Relay Home 恢复路径，不再显示裸 404。
- 仓库的 `lint` 脚本仍缺 ESLint 依赖与配置，这是既有工具链缺口，不属于本轮 UI 运行时阻塞。
- UI 主提交为 `5756c5f6`；Rust relay 可重复部署与回滚保护提交最终落在 `d8a546e5`。`Relay Deploy` run `33806743748` 全部通过，其中 Node image/deploy jobs 均为 skipped。
- `remote.lnz-study.com` 只替换远端 `remote-codex-rust-relay.service`，监听 `127.0.0.1:18791`，继续使用独立数据目录 `/var/lib/remote-codex-rust-relay`；部署前后均有 1 个 Rust supervisor 在线。
- 上线后 Rust 站点资源为 `/assets/index-BTIEUUoA.js`，主题色为 `#171713`；Node 站点仍为 `/assets/index-C8LwKBtI.js` 和 `#101722`，健康检查正常，证明未被 Rust artifact 覆盖。
- 线上登录态 Playwright 复核 Relay Home、Devices、Workspaces、New Workspace、New Thread、Import、Account、Admin、Guide；全部 `390px` 页面 `scrollWidth` 等于 `innerWidth`，Devices/Workspaces 嵌套交互为 0、可见目标小于 44px 的数量为 0；亮色 Settings 实测 `theme-color` 为 `#f3f6f7`。

### 截图索引

- [Workspaces desktop, light](ui-audit-screenshots/workspaces-desktop-light.png)
- [Workspaces mobile, light](ui-audit-screenshots/workspaces-mobile-light.png)
- [Relay Devices desktop, dark](ui-audit-screenshots/relay-devices-desktop-dark.png)
- [Relay Devices mobile, dark](ui-audit-screenshots/relay-devices-mobile-dark.png)
- [Relay Guide mobile, dark](ui-audit-screenshots/relay-guide-mobile-dark.png)
- [Settings mobile, light](ui-audit-screenshots/settings-mobile-light.png)

## 验收标准

1. Workspaces、Devices 和 Relay Guide 在 320px 宽度无整页横向滚动。
2. Workspaces 不再存在 `role="link" button` 或 `a button`。
3. Workspaces 与 Devices 的主要手机操作热区达到 44px。
4. Workspaces、Devices、Relay Home 和 Relay Guide 不再出现卡片嵌套；允许表格、dialog、code block 和真实交互组的单层边界。
5. 每页只有一个明确主操作，危险操作不与主操作同权展示。
6. 失败、加载、空态和成功反馈都在受影响区域内，并提供下一步或恢复路径。
7. 不修改 `remote-codex-thread-ui` 源码；Supervisor 自维护页面的构建与定向回归全部通过。
