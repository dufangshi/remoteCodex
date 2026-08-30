# Android / iOS 对齐 `main` 差异审计与回测门禁

> - 状态：功能实现、Android AOSP 与 iOS Simulator 全量回测已完成；等待 clean parity gate 最终确认
> - 审计日期：2026-08-29
> - 主仓库基线：`remoteCodex` `origin/main` @ `2c760e4e`，版本 `0.11.50`
> - 共享 UI 固定输入：`remote-codex-thread-ui` @ `f9e957fbd08fb7f8284e6c1d4ab068541610d426`
> - 工作分支：`codex/mobile-app-parity`
> - Worktree：`/Users/mac/dev/remoteCodex-mobile-parity`

## 1. 结论摘要

当前问题分为三类，不能只通过重新打包解决：

1. **发布版本落后**：GitHub Release 中最后一组移动端资产仍位于 `v0.11.31`。Android APK 与 iOS IPA 的最后更新时间均为 2026-07-12，而主仓库已到 `v0.11.50`。发布资产没有记录源码 commit、共享 thread-ui commit、构建类型或校验报告，无法证明其准确源码来源。
2. **当前源码仍有功能差异**：最新 Web 已支持 ACP agent catalog、按 agent/workspace 获取模型、agent adapter 安装、agent 标签、sandbox、Terminal plugin 和完整 provider 配置；Android/iOS 仍缺少其中多条主路径。
3. **构建与发布不可复现**：两端通过未固定 commit 的 sibling `remote-codex-thread-ui` `file:` 依赖打包；移动端构建不会先重建 thread-ui；iOS 的 `project.yml` 与已提交 `.xcodeproj` 在版本号和 bundle id 上互相冲突；发布脚本可回退上传 debug APK，且不会先执行测试。

初始审计将真机 IPA 也纳入发布门禁。用户在实施阶段明确本 Goal 以 Android AOSP 与 iOS Simulator 为交付环境，因此最终对齐定义调整为：**源码能力对齐 + 两端真实模拟器全功能 E2E 通过 + 从干净 checkout 生成 signed Android APK 与 iOS Release Simulator app 并回装 + 版本/产物来源可追溯**。签名 IPA 仍由独立 publication gate 严格管理。

## 2. 审计边界和判定规则

本次以当前 `main` 的 supervisor Web 和外部 `@remote-codex/thread-ui` 为产品能力基准，比较以下三层：

- 原生壳：连接、设备、认证、Home、Workspace、路由恢复、文件/分享桥接。
- WebView adapter：REST/WebSocket、线程状态投影、composer、workspace、plugin、shell、原生桥。
- 构建发布：版本号、依赖来源、测试门禁、APK/IPA 产物和 GitHub Release。

优先级定义：

- `P0`：阻止声称“与 main 全功能对齐”，或可能生成错误/不可追溯发布包。
- `P1`：主要功能或可靠性差异，必须在完整回测前关闭。
- `P2`：质量、可维护性或次要兼容性问题，不应遗留到最终发布。
- `Verify`：静态检查未发现明确缺失，但必须在真实模拟器中证明。

平台可以采用不同原生交互，但不得降低后端能力、权限、错误恢复或数据完整性。除确属平台不适用的系统行为外，本 Goal 不沿用旧文档中的 deferred scope。

## 3. 版本与发布差异

| ID | 项目 | `main` / 目标状态 | Android 当前状态 | iOS 当前状态 | 优先级 | 完成标准 |
| --- | --- | --- | --- | --- | --- | --- |
| R1 | GitHub 移动端发布资产 | 当前版本应生成同版本 APK/IPA | 最新公开 APK 仍挂在 `v0.11.31` | 最新公开 IPA 仍挂在 `v0.11.31` | P0 | 新版本两份资产来自同一已验证 commit，Release 记录 commit、thread-ui commit、checksum 和回测报告 |
| R2 | App 展示版本 | 与根包 `0.11.50` 同步 | `build.gradle.kts` 从根包生成 `versionName=0.11.50`、`versionCode=1150`，源码已同步但未发布 | `.xcodeproj` 仍为 `0.11.31 (1131)` | P0 | 两端安装后系统读取到的版本与根包/tag 一致，build number 单调递增 |
| R3 | iOS 工程版本源 | 单一、可生成、不可漂移 | 不适用 | `project.yml` 为 `0.1.0 (1)`，`.xcodeproj` 为 `0.11.31 (1131)` | P0 | 选定唯一 source of truth；重新生成工程不会回退版本 |
| R4 | iOS bundle id | 工程生成前后保持安装身份一致 | 不适用 | `project.yml` 为 `com.remotecodex.ios`，`.xcodeproj` 实际为 `com.fonsh.remotecodex.ios` | P0 | 确认正式 bundle id，生成工程前后完全一致，并验证升级安装不丢数据 |
| R5 | 发布脚本门禁 | 只允许已测试的 release 产物 | `publish-mobile-release-assets.mjs` 在 release APK 不存在时会回退 debug APK | 脚本只查找现有 IPA，不验证版本、签名、commit 或测试 | P0 | 禁止 debug fallback；发布前校验签名、版本、commit、checksum 和完整回测结果 |
| R6 | 自动化发布 | main/tag 有可重复的移动端构建门禁 | 现有 GitHub workflows 没有 Android release build/E2E gate | 现有 workflows 没有 iOS archive/E2E gate | P1 | 至少提供一个可重复的本机 release gate；CI 能力允许时接入 workflow |

补充证据：`v0.11.31..main` 的移动端目录共有 26 个文件变化，约 2,001 行新增、182 行删除。公开资产在 tag 发布后三天被覆盖过，因此不能仅凭 tag 推断 APK/IPA 的实际源码 commit；这本身就是 R5 的 provenance 缺陷。

## 4. 功能差异表

| ID | 能力 | Web / shared UI 当前能力 | Android 当前状态 | iOS 当前状态 | 优先级 | 完成标准 |
| --- | --- | --- | --- | --- | --- | --- |
| F1 | ACP 新建线程 | 列出 `/agents`，展示 availability/transport，支持安装 adapter，按 `agentId + cwd` 加载 models，并提交 `agentId` | WebView 与原生 Workspace picker 都只有 backend + model；没有 agent catalog、adapter 安装或 `agentId` | 同 Android；Swift DTO 也没有 `agentId` | P0 | 两端可从 Home、Workspace、线程内 New Chat 创建 ACP thread，并验证 agent/model/effort/approval 写入 API |
| F2 | ACP 已有线程设置 | 按 thread `agentId` 和 workspace path 获取模型，composer 显示固定 agent label | 仍调用通用 `listModels(provider)`，不显示 agent label | 同 Android | P0 | 打开 ACP thread 后显示正确 agent；模型列表来自该 agent/workspace；更新设置后重载一致 |
| F3 | Agent runtime 可用性 | 以 `sessions.resume && turns.start`、status 和 ACP availability 判定可用 | 原生 `canStartSession` 只检查 `enabled`，`SupervisorModelOption` 缺 ACP metadata，install API 不支持 `modelId` | 同 Android | P0 | 不可用 backend/agent 不得创建线程；错误原因和安装/恢复动作与 Web 等价 |
| F4 | Sandbox mode | Web composer 显示并更新 `read-only` / `workspace-write` / `danger-full-access` | 明确传 `sandboxMode: null` 并隐藏控件 | 同 Android | P0 | 两端可读写并持久化 sandbox；发送 prompt、恢复 session 和重载后保持一致 |
| F5 | Terminal plugin / shell | Web 注册 terminal builtin，提供 shell adapter、xterm、创建/切换/输入/resize/终止；relay 已转发 attached shell events | WebView `shell: null`、`shellAvailable: false`；旧 Compose shell 仅 debug fallback | WebView `shell: null`、`shellAvailable: false`；无生产 shell host | P0 | Local/Server/Relay 均可在真实线程中打开 terminal、执行命令、收流式输出、切换/终止并在重连后恢复 |
| F6 | Built-in plugin renderers | Web 向 `PluginProvider` 注入 builtin plugins 并连接 server plugin state | 直接使用空 `PluginProvider`；声明了 terminal/xyz 依赖但未注册 | 同 Android | P0 | 两端加载 server plugin 状态；XYZ/artifact renderer 与 terminal panel 可见且 enable/disable 生效 |
| F7 | Provider 配置和恢复 | Web 支持 host config 读取/保存、config archive 创建/重命名/应用、runtime restart/install/update | 原生只覆盖 backend 列表和 install/update；WebView settings 为空 | 同 Android | P1 | 移动端提供等价、安全的配置与恢复路径，或将 canonical 设置面完整嵌入 shared UI；全模式验证权限和失败恢复 |
| F8 | Workspace 文件深链 | 点击文件/行号后在 workspace explorer 定位并预览 | `openWorkspaceFile` 只跳到 native Workspace，丢弃 path/line | 同 Android；仅 UI-test bootstrap 有 focus request | P1 | timeline/file-change/链接点击后打开准确文件和行；返回 thread 后状态不丢失 |
| F9 | Workspace surface flags | supervisor Web 显式只启用 workspace tab，其他 tab 关闭 | 未传 flags，继承 shared UI 默认的全部 tabs | 同 Android | P1 | 明确一套 canonical feature flags，并让 Web/Android/iOS 一致；当前默认按 supervisor Web 配置对齐 |
| F10 | Runtime status 投影 | Web 传入真实 provider runtime status/capabilities/schema | 未向 `ThreadDetailSurface` 传 status | 非 fixture 也传入 `mockStatus` | P1 | 两端只显示真实 runtime status；断开、安装中、失败、版本变化可实时/刷新后正确显示 |
| F11 | Provider config-backed MCP 编辑 | Web composer 通过 provider config read/write 保存 MCP 配置 | 有 toolbox/schema，但未传 config read/write callbacks | 同 Android | P1 | MCP 变更可保存、重载、失败恢复，并覆盖 relay 权限限制 |
| F12 | 最新 thread-ui 视觉/文件能力 | 8 月新增 markdown viewer、workspace explorer 和可缩放图片预览 | 当前 bundle 能编译，但无真实设备手势/下载/桥接验证 | 同 Android | Verify | 在两台模拟器验证 markdown、图片缩放、raw/open/download、旋转/前后台恢复 |
| F13 | 8 月线程同步修复 | queued prompt、goal lifecycle、Claude/ACP item ordering 与 resolved model label 已进入主线/shared UI | 源码包含 8 月 2 日前的 adapter 修复，公开包无法证明包含；8 月后能力未做移动端 E2E | 同 Android | Verify | 对 Codex/Claude/OpenCode/ACP 分别验证流式输出、排队/取消/steer、goal、compaction、模型标签和重载 |
| F14 | Shared-device scope 与撤销确认 | 最新 Web 按整台设备/指定 workspace/指定 thread 显示真实 scope，撤销前明确对象、范围和立即失效后果 | DTO 已有 `workspaceScope/workspaceIds`，但 row 标题和撤销 dialog 未完整解释实际范围 | 同 Android | P1 | 两端对 incoming/outgoing grant 显示与 Web 一致的 scope；撤销确认包含用户、设备、workspace/thread 范围，并验证撤销立即生效 |

## 5. 构建与依赖差异

| ID | 风险 | 当前证据 | 优先级 | 目标 |
| --- | --- | --- | --- | --- |
| B1 | thread-ui 依赖未固定 | 三个前端 package 都以 sibling `file:` 路径引用 `/Users/mac/dev/remote-codex-thread-ui`，root lockfile 不记录其 git commit | P0 | 构建显式记录/校验 thread-ui commit；推荐为本 Goal 创建配套 clean worktree/branch 或引入可固定 revision 的依赖方式 |
| B2 | 移动端构建消费 stale `dist` | Android/iOS 只构建各自 Vite wrapper；输入是外部 thread-ui `dist`，不会自动重建 thread-ui source | P0 | 任一 thread-ui source 变化后，先执行 `pnpm --filter @remote-codex/thread-ui build`，再构建两端 bundle 和原生 app |
| B3 | 文档边界冲突 | `AGENTS.md` 描述本仓库 `packages/thread-ui`，但该目录已移除；`docs/thread-ui-extraction-checklist.md` 指向外部 sibling repo | P1 | 更新单一、准确的构建说明，所有本机/CI/release 命令一致 |
| B4 | 共享 package 前置构建隐含 | clean worktree 直接 typecheck 两个 mobile Web 包会因 `@remote-codex/shared/dist` 不存在而失败；先 build shared 后通过 | P1 | 聚合命令显式构建依赖，clean checkout 一条命令可完成全部校验 |
| B5 | iOS Xcode 27 并发告警 | generic simulator build 成功，但 `ThreadDetailWebViewScreen.swift` 有多条 Sendable/MainActor 告警 | P2 | 消除告警，避免后续 Swift/Xcode 将其升级为错误 |
| B6 | 前端 bundle 体积 | Android/iOS minified JS 均约 4.6 MB，Vite 发出大 chunk 警告 | P2 | 不以盲目拆包为目标；先测 WebView 冷启动/内存，若超门槛再做可验证优化 |

## 6. 已确认可用的审计基线

本阶段没有启动模拟器 E2E，也没有修改 app 源码。已完成以下只读/构建基线：

| 检查 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 通过 |
| `pnpm --filter @remote-codex/shared build` | 通过 |
| Android thread-web typecheck/test/build | 通过，2 files / 12 tests |
| iOS WebThread typecheck/test/build | 通过，5 files / 45 tests |
| Android `./gradlew testDebugUnitTest` | 通过，native compile + 341 tests，0 skipped / 0 failures / 0 errors |
| iOS generic Simulator build | 通过，使用 Xcode-beta 27.0；有 B5 告警 |
| 当前 AOSP AVD | `cardverify_aosp35_root`，Android 35 default/AOSP image，arm64，Play Store disabled |
| 当前 iOS runtime | iOS 26.5 与 27.0 均已安装；已有 iPhone 17 Pro simulators |

## 7. Goal 实施顺序

### Phase 0：冻结可复现基线

- 保持主仓库 worktree 在 `codex/mobile-app-parity`。
- 不触碰现有 dirty `/Users/mac/dev/remote-codex-thread-ui` checkout；需要修改 shared UI 时，从其 `main` 另建 clean worktree/branch，并在本仓库记录 commit。
- 修正 B1-B4，提供 clean checkout 的一键 build/test 命令。
- 固定正式 iOS bundle id、版本来源和 build number 策略。

### Phase 1：关闭版本和发布 P0

- 统一 Android/iOS/root 版本。
- 让 release 脚本只接受明确的 release APK/IPA。
- 在上传前读取二进制内版本、bundle/application id、签名和 checksum。
- 产物元数据包含主仓库 commit、thread-ui commit、构建时间和回测报告。

### Phase 2：关闭 ACP 和 composer P0

- 在 shared mobile create flow 提取共同逻辑，避免 Android/iOS 再次分叉。
- 两端 native DTO/client 与 WebView client 接入 `agentId`、agent catalog、agent-scoped models、adapter install 和 availability。
- 接入 agent label、sandbox 和真实 runtime status。
- 为 Home、Workspace、线程内 New Chat 三个入口补单元/集成测试。

### Phase 3：关闭 terminal/plugin/settings/workspace 差异

- 为移动 WebView 注册与 Web 相同的 builtin plugins 和 server adapter。
- 接入 REST + WebSocket shell adapter，覆盖 Local/Server/Relay。
- 补 provider config/archive/restart、MCP 保存和权限门禁。
- 保留 workspace file path/line deep link，并统一 workspace feature flags。

### Phase 4：自动化回归扩充

- 所有新能力先有 contract/unit/component tests，再进入模拟器 E2E。
- Android 把 local/server/relay skill 流程固化为可重复脚本；iOS 把环境变量 gate 的必测用例变成 full gate 中不可 skip 的套件。
- ACP、sandbox、terminal、plugin、发布元数据都必须新增正向和失败恢复测试。

### Phase 5：双模拟器完整回测与循环修复

- 启动指定 Android AOSP emulator 和 iOS Simulator。
- 依次执行第 8、9 节矩阵；每个失败都回到实现阶段修复，再从受影响层向上重跑。
- 不允许以“已知问题”“偶现”“环境原因”直接放行；必须修复或证明为可重复、平台外部且不影响产品的阻塞，并得到明确产品决策。

### Phase 6：最终产物回装和发布验收

- 从 clean worktree 构建最终 APK/IPA，不复用开发期旧产物。
- 在两个已清数据的模拟器中安装最终产物，重跑关键全链路和升级/重载场景。
- 所有门禁为绿后才可上传 Release，并在上传后下载公开资产再做版本/checksum 一致性校验。

## 8. 指定模拟器与服务矩阵

### 8.1 设备

| 平台 | 必测设备 | 系统 | 启动要求 |
| --- | --- | --- | --- |
| Android | AVD `cardverify_aosp35_root` | Android 35 AOSP default image, arm64 | 必须真实启动；通过 `adb devices -l` 记录 emulator id；安装本 Goal 生成的 APK |
| iOS | iPhone 17 Pro `B9E0BB3C-4FB0-4C86-A0E1-E578E1AFCBC9` | iOS 26.5 | 必须真实 boot；使用 `DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer` |
| iOS 兼容 smoke | iPhone 17 Pro `053902BA-2D76-4C4C-B540-FA34020EBF07` | iOS 27.0 | 最终至少 build/install/launch + thread smoke，关闭 Xcode 27 回归风险 |

当前全局 `xcode-select` 指向 Command Line Tools，不能依赖全局切换；所有命令必须显式传 `DEVELOPER_DIR`。

### 8.2 连接模式

| 模式 | Android emulator URL | iOS Simulator URL | 必须验证 |
| --- | --- | --- | --- |
| Local/Intranet | `http://10.0.2.2:8787` | `http://127.0.0.1:8787` | 无认证健康检查、workspace/thread 全链路、WebSocket streaming、前后台恢复 |
| Server | `http://10.0.2.2:8787` | `http://127.0.0.1:8787` | 未认证 401、登录/token、REST + `/ws?token=...`、token 失效和重新登录 |
| Relay | `http://10.0.2.2:8788` | `http://127.0.0.1:8788` | relay login、device 注册/选择、supervisorConnected、forwarded REST/WebSocket、shared permissions |

每个平台的三种模式都必须通过，不能用一个平台的结果替代另一个平台，也不能只通过 API 辅助提交来代替 UI 主路径。API 辅助仅可用于构造 fixture，并必须明确记录。

## 9. 全功能回测矩阵

| 领域 | 必测场景 | UI 证据 | API/日志断言 |
| --- | --- | --- | --- |
| 安装/升级 | clean install、从 `v0.11.31` 升级、版本展示、数据保留 | 系统 app 信息、首屏、已保存设备 | application/bundle id、version/build、无迁移错误 |
| 连接与设备 | Local/Server/Relay 添加、重命名、删除、切换、logout、重连 | 三模式 header 与 Connected 状态 | health/session/401/token/relay portal 正确 |
| Relay 管理与共享 | 注册账号、创建设备、选择在线设备、整台设备/指定 workspace/指定 thread scope、owner/collaborator/view-only、撤销 | device/share UI、scope 文案、撤销确认与权限禁用态 | grant/share/access DTO、立即失效行为与审计事件一致 |
| Workspace | list/create/open/favorite/rename/delete、tree、preview、edit、upload/download | 文件内容、按钮状态、错误恢复 | 路径、内容、size、权限和刷新一致 |
| 文件深链/富媒体 | timeline 文件链接、行号、markdown、图片缩放、raw/open/download | 打开准确文件/行，图片手势截图 | URL 编码、content type、无 WebView 错误 |
| 新建线程 | Home/Workspace/线程内 New Chat；Codex/Claude/OpenCode/ACP | provider/agent/model/effort/approval 可选 | thread DTO 的 provider/agentId/model/effort/approval 正确 |
| Runtime 管理 | unavailable、install/update、ACP adapter、restart、失败恢复 | busy/error/retry 状态 | status、version、capabilities、无错误残留 |
| Composer 设置 | model、effort、fast、plan/default、sandbox、attachments | 控件和发送后的持久状态 | PATCH/prompt payload 与重载 DTO 一致 |
| Streaming | partial output、tool/history、token/context、completion | 运行中增量和最终文本 | event 顺序、cursor、complete/idle、`lastError=null` |
| Active turn | queue prompt、cancel queued、steer/follow-up、interrupt | queued/steer/card 状态变化 | 同一 active turn/后续 turn 语义正确，无重复 item |
| Goal/plan/request | goal 创建/更新/完成、plan、approval/question/planDecision | timeline note、状态、失败恢复 | goal lifecycle 隔离；request resolve 只发生一次 |
| 历史与生命周期 | load earlier、background/foreground、force stop/relaunch、连接切换 | transcript 不丢失、不重复、route 恢复 | 分页边界、refresh/reconnect、cursor 无回退 |
| Thread 管理 | rename、fork latest/turn、compact、export PDF/HTML、delete | dialog、下载/share、返回路由 | 新 thread/source turn、导出内容、删除结果正确 |
| Plugin/Terminal | XYZ/artifact renderer、enable/disable、terminal 创建/输入/resize/切换/终止 | renderer 和真实终端输出 | plugin state、shell events、relay forwarding 正确 |
| 错误恢复 | 断网、服务重启、401、relay backend offline、workspace missing、写入失败 | 明确错误、retry、恢复后状态 | 无 silent failure、无 stale token、无重复副作用 |

## 10. 完成门禁

只有同时满足以下条件，Goal 才能标记 complete：

- 差异表中的 `P0/P1/P2` 全部关闭；`Verify` 全部有双模拟器证据。
- shared、Android Web、iOS Web、Android native、iOS native 的 build/typecheck/unit/component tests 全绿。
- Android AOSP 与 iOS Simulator 的 Local/Server/Relay 六组 E2E 全绿，required tests 为 **0 skip**。
- Codex、Claude、OpenCode、ACP 至少各完成一条真实线程闭环；不可用 runtime 的失败路径也通过。
- 最终 release APK/IPA 从 clean worktree 生成并回装；二进制内版本、id、commit metadata 和 checksum 一致。
- 无未解释 app crash、uncaught JS error、Swift fatal、Android exception、API `lastError` 或 relay disconnect。
- 每次修复后重跑受影响单测、对应模式 E2E，最后再完整重跑六组矩阵；不得只重跑最初失败的单点后结束。
- 最终报告列出设备/OS、app 版本、主仓库 commit、thread-ui commit、服务模式、workspace、thread id、model/effort/agent、sentinel、截图/日志路径和所有命令结果。

## 11. 审计阶段的历史约束

- 不修改 `apps/android`、`apps/ios`、supervisor 或外部 thread-ui 源码。
- 不启动 Android/iOS 模拟器执行产品 E2E。
- 不生成或上传新的 APK/IPA，不修改任何 GitHub Release。
- 不触碰当前已有 dirty worktree 中的用户改动。

下一步由当前 Goal 按第 7 节开始实施；在第 10 节全部满足前不得宣称完成对齐。

## 12. 2026-08-30 实施与验收进度

### 12.1 当前结论

移动端源码差异已关闭，Claude 登录恢复后真实 provider 双端闭环也已通过。用户明确本 Goal 的 iOS 交付目标是 Simulator build/install/E2E；该路径不需要 Apple Developer 登录或 provisioning profile。真机/App Store IPA 仍由严格的 publication gate 管理，但不再阻塞 Simulator parity 的完成判定。

已关闭：

- Android/iOS 版本、build number、bundle/application id 与根版本统一为 `0.11.50 (1150)`。
- thread-ui revision、构建输入、release asset 名称、checksum 与回测 evidence contract 已固定；禁止 debug APK fallback。
- ACP agent catalog、adapter install、agent-scoped models、agent label、sandbox capability、真实 runtime status 已接入两端原生和 WebView。
- Terminal builtin、server plugin adapter、Local/Server/selected-device Relay shell WebSocket、xterm 和 plugin enable/disable 已接入。
- skills、MCP、hooks、provider config read/write、config archives、runtime install/update/restart/build-restart 已接入移动端设置面。
- workspace file deep link、canonical workspace flags、iOS 原生文件 tree/preview/edit/upload/download 与 shared-device scope/grouping 已对齐。
- iOS Xcode 27 actor/sendability 告警已处理；Android/iOS 当前生产 Web bundle 均可构建。

已解除的阻塞：

| 门禁 | 最终证据 | 状态 |
| --- | --- | --- |
| 真实 Claude 双端闭环 | iOS real-provider suite 10/10；Android `ClaudeComposerE2ETest` 在 AOSP 从真实 WebView composer 提交并收到 `ANDROID_CLAUDE_FINAL_OK` | Closed |
| iOS Release Simulator | `Release-iphonesimulator/RemoteCodex.app` 为 `0.11.50 (1150)`，已 clean install/cold launch 于 iOS 26.5 | Closed |
| Android release signer | 新长期 key 位于 `~/.remote-codex/signing/android-release.jks`，密码在 macOS Keychain，certificate SHA-256 已 pin | Closed |
| 历史 APK 签名迁移 | 新 key 无法覆盖不同历史 signer 的公开 `v0.11.31`，但 clean install 与后续同-key upgrade 可用 | 已记录的一次性迁移限制，不是本 Goal 的功能差异 |

### 12.2 差异关闭状态

| 范围 | 状态 | 说明 |
| --- | --- | --- |
| `R2-R5` | Closed | 版本/id/source-of-truth/release validation 已实现并测试 |
| `R1` | Simulator Closed / Publication Optional | signed Android APK 与 iOS Release Simulator app 已生成回装；真机 IPA/公开 upload 是独立发布步骤 |
| `R6` | Closed | `pnpm verify:mobile:release-gate` 从 JUnit/xcresult 和二进制直接生成 evidence；publish 会强制重新收集，不能接受手写 passed JSON |
| `F1-F12`, `F14` | Closed | 两端源码、contract/component/native tests 与指定模拟器 E2E 均有证据 |
| `F13` | Closed | Codex、Claude、OpenCode、ACP 真实闭环与 fake-runtime lifecycle 均通过 |
| `B1-B5` | Closed | 固定 revision、一键前置构建、工程元数据和 Xcode 27 告警已关闭 |
| `B6` | Verified | minified bundle 约 5.6 MB，仍有 chunk warning；两台 iOS runtime 与 AOSP WebView load/E2E 均在门槛内，无启动失败或内存崩溃 |

### 12.3 最终通过的回测证据

| 层级 / 设备 | 结果 | skip |
| --- | --- | --- |
| Android thread-web | 4 files / 16 tests passed；typecheck + production build passed | 0 |
| iOS WebThread | 6 files / 48 tests passed；typecheck + production build passed | 0 |
| Android native unit | 342 passed | 0 |
| Android AOSP 35 required connected gate | 15 passed；Local + Server + Relay，含真实 Claude、Relay streaming/WebSocket 和 provider settings | 0 |
| iOS 26.5 native unit | 72 passed | 0 |
| iOS 26.5 fixture gate | 13 passed | 0 |
| iOS 26.5 Local required A/B | 19 + 10 passed | 0 |
| iOS 26.5 Server | 3 passed | 0 |
| iOS 26.5 Relay | 5 passed | 0 |
| iOS 27.0 compatibility smoke | build/install/launch/shared thread UI test passed | 0 |
| 真实 provider | iOS Codex/Claude/OpenCode/ACP 10/10；Android Claude composer 通过 | 0 |

指定设备：

- Android：`cardverify_aosp35_root` / `emulator-5554` / Android 15 AOSP arm64。
- iOS 主门禁：iPhone 17 Pro `B9E0BB3C-4FB0-4C86-A0E1-E578E1AFCBC9` / iOS 26.5。
- iOS 兼容：iPhone 17 Pro `053902BA-2D76-4C4C-B540-FA34020EBF07` / iOS 27.0。

持久化 evidence 位于：

- `/Users/mac/dev/remoteCodex-mobile-parity/.local/mobile-parity/evidence/android-connected-final.xml`
- `/Users/mac/dev/remoteCodex-mobile-parity/.local/mobile-parity/evidence/RemoteCodexUnitFinal.xcresult`
- `/Users/mac/dev/remoteCodex-mobile-parity/.local/mobile-parity/evidence/RemoteCodexFixtureFinal.xcresult`
- `/Users/mac/dev/remoteCodex-mobile-parity/.local/mobile-parity/evidence/RemoteCodexLocalFinalA.xcresult`
- `/Users/mac/dev/remoteCodex-mobile-parity/.local/mobile-parity/evidence/RemoteCodexLocalFinalB.xcresult`
- `/Users/mac/dev/remoteCodex-mobile-parity/.local/mobile-parity/evidence/RemoteCodexServerFinal.xcresult`
- `/Users/mac/dev/remoteCodex-mobile-parity/.local/mobile-parity/evidence/RemoteCodexRelayFinal.xcresult`
- `/Users/mac/dev/remoteCodex-mobile-parity/.local/mobile-parity/evidence/RemoteCodexIOS27Smoke.xcresult`
- `/Users/mac/dev/remoteCodex-mobile-parity/.local/mobile-parity/evidence/RemoteCodexRealProvidersFinal.xcresult`

### 12.4 当前 Android release 产物

- 路径：`/Users/mac/dev/remoteCodex-mobile-parity/apps/android/app/build/outputs/apk/release/app-release.apk`
- application id：`com.remotecodex.android`
- version：`0.11.50 (1150)`
- 大小：约 22 MB
- SHA-256：`24f36705342cbdb53539c9519d73b74a2c3a1bcfafdd838d69b5dd2f0b39f409`
- signer SHA-256：`c21b025135abf8ce1f6db6ecb85a0d0708a0d0504306ec42cb0d4fb9d8b51ac5`
- 签名：长期 PKCS12 keystore，权限 `0600`，随机密码保存在 macOS Keychain；APK Signature Scheme v2 验证通过，已在指定 AOSP 模拟器 clean install/cold launch。

后续 Android release 必须继续使用同一 keystore，否则系统不会允许覆盖安装。

### 12.5 当前 iOS Release Simulator 产物

- 路径：`/Users/mac/dev/remoteCodex-mobile-parity/.local/ios-release-derived/Build/Products/Release-iphonesimulator/RemoteCodex.app`
- bundle id：`com.fonsh.remotecodex.ios`
- version：`0.11.50 (1150)`
- 大小：约 20 MB
- 验证：已在 iPhone 17 Pro / iOS 26.5 clean install、cold launch；Connection 首屏截图无空白、重叠或异常。

Simulator `.app` 不需要 Apple Developer 登录。只有真机/App Store IPA 才需要 Apple team/profile。

### 12.6 自动门禁

Simulator parity 最终门禁：

```bash
pnpm verify:mobile:parity-gate
```

它验证所有 JUnit/xcresult、真实 provider、signed Android APK 和 iOS Release Simulator `.app`，并写入 `.local/mobile-parity/verification.json`。

正式发布前必须运行：

```bash
pnpm verify:mobile:release-gate
```

该命令会直接解析 Android JUnit XML、八组 iOS `.xcresult`、release APK 和 IPA，并校验：

- 每组最小测试数、`failures=0`、`errors=0`、`skipped=0`。
- Android Local/Server/Relay 必须存在对应的 required E2E class。
- iOS Local A/B、Server、Relay、iOS 27 和真实 provider final suite 必须全部通过。
- APK application id/version/build/signature 和官方 certificate SHA-256。
- IPA bundle id/version/build、codesign 和 Apple team `33LNVR7DGT`。
- 当前 tracked worktree 必须 clean；APK/IPA checksum 和 evidence commit 必须一致。

publication gate 额外要求签名 IPA 和 Apple team `33LNVR7DGT`，只有所有检查通过时才写入 `.local/mobile-release/verification.json`。`release:mobile` 会在上传前再次运行该严格收集器。

### 12.7 可选的公开发布续跑

需要真机/App Store IPA 或 GitHub Release 时再执行：

1. 在 Xcode 登录 team `33LNVR7DGT` 并安装 `com.fonsh.remotecodex.ios` profile。
2. archive/export IPA 后运行 `pnpm verify:mobile:release-gate`。
3. publication evidence 全绿后才允许 `release:mobile`，上传后重新下载校验。
