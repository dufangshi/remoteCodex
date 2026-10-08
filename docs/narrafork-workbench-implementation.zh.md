# 工作台布局实现与验收

本轮在 `feature/narrafork-workbench` 与共享 UI 的 `feature/narrafork-workbench-ui`
独立实现。共享 UI 实现提交为 `090fca674a7ab120a4719f7186ca499025d0af0a`；基线分别为 `6c104ceb3cde832f22d2dcb4188ca520a8bcaac5`、
`970408b3772efccdae2b20153dec027aac9c4fef`。交付供用户审图，未合入 main、部署或发布。

## 已实现

- 保留 MatterWorkbench、当前主题和字体。设备、工作区、主会话及唯一发送目标持续可见。
- 统一参考区入口，切换工作区文件、同设备会话对照、协作进度；最多一个参考会话。
  参考没有 composer 或审批输入；“设为主会话”交换主/参考并走既有路由和权限。
- 主会话使用原 controller；参考只挂载 ThreadTimeline 与独立历史 controller。
  共用原来的 Supervisor socket，参考事件触发有界刷新，3 秒轮询补偿丢失事件。
  慢响应按 device/thread generation 隔离，较旧历史可独立加载、详情可按需展开。
- 主/参考有独立滚动容器。隐藏面板保留挂载及阅读位置；交换主会话重建相应时间线，
  目前不承诺交换后精确恢复旧像素锚点。手机一次只显示主或参考，隐藏 composer 不可聚焦；
  Back 从参考返回主会话，关键按钮可见且没有横向溢出。
- 线程草稿与附件保存在宿主内存，按 device/thread 隔离。快速切换时原 composer 的
  最后一次 flush 只写回原线程；旧 generation 不覆盖再次打开后的新草稿。
  刷新或离开该页面会清掉未发送草稿，本轮没有将正文放入布局或云端。
- 托管线程族来自既有受保护列表/family 数据；显示完成、失败、最后活动及结果/对照入口。
  原生子代理使用活跃报告和最近三轮持久化 `agentToolCall` 历史，最多 20 条。
  不从“活跃列表消失”猜测完成。原生结果打开实际工具正文并定位对应轮次。
- 本地参考成员与排列分开存储，schemaVersion=1；key 含 origin/account/device/workspace。
  保存模式、参考 threadId 与 35–65 比例；双栏实际宽度保证各区至少 360px，内容宽度不足
  800px 时改为单视图。坏排列不删除参考成员，坏成员/未来 schema 安全回退。
  localStorage 失败显示仅本次访问保留。关闭参考只是隐藏视图，保留其引用与后台线程。

## 接口与组合边界

共享 UI 新增可选 `MatterWorkbenchOptions.panels: WorkbenchPanelsOptions` 与
`useWorkbenchPresentation` 导出；未提供 panels 的宿主仍走原外壳。新增文案均复用统一
中英 i18n，旧 CSS 中前进/跳到最新/切到 shell 的英文 aria-label 选择器改为 data-action。

文件区保持 `ThreadDetailSurface -> ThreadGraphWorkspacePanel -> workspaceAdapter` 原传递。
首次访问后隐藏不会卸载文件区。本分支没有改 preview、文件 store 或 Monaco；
文件草稿、版本、安全保存、退出保护由 `nf-files-impl` 负责，组合预览需要父线程整合。
两个分支都触及 ThreadDetailPage，合并时保留本分支新增 hooks/panels 与文件分支的 adapter。

没有新增 task/inbox Web 摘要 API：界面明确只展示 thread/activity/native 数据。查看摘要或
结果不 ack inbox、不发消息，不改变 task/native/managed 的事实类型。未实现跨设备同时
对照、云同步、Git 后端、共享 PTY、底部终端停靠或自由 Dockview。

## 定向验证与截图复现

Rust 无改动。浏览器使用本工作树的 `target/debug/remote-codex` 基线可执行副本，版本
`0.12.68`，SHA256 `ac818ba8392445fe3d1f7e3bfcfed3ef6afc0a4f0aaae6ac42cab88fbbaa930d`。
没有重建无改动的 Rust，也没有运行 workspace 全测。

先构建本分支 UI，并刷新主仓库 file 依赖：

```sh
corepack pnpm --dir remote-codex-thread-ui --filter @remote-codex/thread-ui build
corepack pnpm install --offline --frozen-lockfile
corepack pnpm --dir remote-codex-thread-ui --filter @remote-codex/thread-ui typecheck
corepack pnpm --filter @remote-codex/supervisor-web typecheck
corepack pnpm --dir remote-codex-thread-ui --filter @remote-codex/thread-ui exec vitest run src/components/workbench/presentation.test.ts src/i18n/i18n.test.tsx
corepack pnpm --filter @remote-codex/supervisor-web exec vitest run src/pages/useThreadDrafts.test.tsx src/pages/workbenchNativeModel.test.ts
```

浏览器脚本 `scripts/verify-workbench-layout.sh` 只运行新增布局 spec 的两个桌面用例、已有
thread-groups 的一个桌面用例，以及新增布局 spec 中一个手机用例。端口固定为默认
18185/15185，数据在本工作树 `.temp/workbench/`；Playwright webServer 清空继承的
REMOTE_CODEX 连接参数并覆盖高优先级数据库/工作目录环境变量。

```sh
WORKBENCH_SCREENSHOT_DIR=/home/ubuntu/dev/remoteCodex/.temp/research/narrafork-implementation/screenshots/layout \
  ./scripts/verify-workbench-layout.sh
```

Fixture 与截图动作保存在 `e2e/workbench-panels.spec.ts`，用 API 创建真实 fake Supervisor
会话，在隔离数据库填充中文历史和持久化原生工具状态。图像来自实际浏览器页面，
没有静态 HTML/SVG mock 或 AI 效果图；桌面为 1440×1000、手机为 390×844 CSS 像素。
没有可公开复用的固定基线 before 图，本轮只交付实现页截图。

| 图像 | 内容 |
| --- | --- |
| `layout/desktop-compare.png` | 主实现会话与只读评审并排，输入目标与草稿清楚可见 |
| `layout/desktop-collaboration.png` | 两条托管线程与两条持久化原生工具的完成/失败事实及结果入口 |
| `layout/mobile-main.png` | 单一主视图、发送目标、主线程草稿与手机发送按钮 |
| `layout/mobile-reference.png` | 单一参考视图、设为主会话与关闭按钮；没有第二个输入框 |

最终检查通过：共享 UI / Web typecheck、14 个定向单元测试（11 UI + 3 Web）、3 个桌面与 1 个手机浏览器用例。
主仓库安装的 thread-ui dist 与独立 UI 构建结果逐字节一致；两个仓库 diff --check 无误。

确切提交 SHA、最终验证结果和图片路径见该线程 `.temp/result.md`；截图目录另附 caption。
