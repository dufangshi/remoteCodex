# Relay Session Sharing And Thread Actions Panel Plan

本文档细化 relay 模式下的 session 共享机制，以及把 PDF/HTML 导出和 Share 合并到同一个 thread actions 面板里的实现方案。

## 背景

当前 relay 已经有 session share 的雏形：

- `packages/shared/src/index.ts` 已有 `RelaySessionShareDto`、`RelayPortalSummaryDto.sharedWithMe`、`sharedByMe`。
- `apps/relay-server/src/relay-store.ts` 已有 `createShare`、`revokeShare`、`canAccessDevice`。
- `apps/relay-server/src/app.ts` 已经能按 `deviceId + threadId` 给 shared user 转发部分 HTTP/WebSocket 请求。
- `apps/supervisor-web/src/pages/RelayPortalPage.tsx` 已有旧版 invite/shared 列表入口。
- `apps/supervisor-web/src/pages/RelayDevicesPage.tsx` 已经加载 `sharedWithMe/sharedByMe`，但主要 UI 仍围绕 owned devices。

当前问题是：

- shared session 没有明确权限模型，read-only 和 collaborator 没有严格区分。
- thread 详情页没有自然的分享入口。
- 桌面网页有 Export PDF/HTML，但移动端 thread UI 很难找到入口。
- `ExportTranscriptDialog` 属于 `../remote-codex-thread-ui/packages/thread-ui/src/components/ExportTranscriptDialog.tsx`，supervisor-web 只是 re-export，因此面板体验应主要在 `@remote-codex/thread-ui` 中实现。

## 目标

- 在 thread 详情页提供一个统一的 actions 面板，包含 `PDF`、`HTML`、`Share` 三个模式。
- 移动端、桌面端、iOS WebView、Android WebView 都能从同一入口打开该面板。
- 分享支持只读共享和完整协作共享。
- workspace 权限独立配置为不可见、只读、可读写。
- relay device 页面显示 `Shared with me`，朋友能从那里打开别人共享给他的 session。
- 后端强制权限，不依赖前端隐藏按钮。

## 非目标

- 不把账号密码或 owner session cookie 直接交给朋友。
- 不做多人光标、presence、评论等协同编辑功能。
- 不开放 owner-only 管理能力给 collaborator，例如删除 device、revoke share、删除整个 thread。
- 不把 workspace 全局暴露给 shared user；权限必须绑定到具体 share。

## UI 入口

### Thread Detail

在 thread 详情页 topbar 增加一个统一 `Actions` 入口。视觉上仍可使用当前圆形 icon button，但行为变为打开统一面板。

桌面端：

- 当前右侧的单独 export button 变成 actions button。
- 打开面板后左侧是 mode rail：`PDF`、`HTML`、`Share`。
- 默认选中 `PDF`。

移动端：

- actions button 放在 thread topbar 左侧或靠左的主工具区，避免被右侧 workspace toggle、connection status 挤掉。
- 如果顶部空间不足，优先顺序为：back/nav、actions、workspace toggle、connection status。
- 面板使用 bottom sheet 或 full-screen modal，不使用桌面宽卡片硬塞。

建议命名：

- Button aria/title: `Thread actions`
- Panel title: `Thread actions`
- Tabs: `PDF`、`HTML`、`Share`

### Export 面板改造

现有文案：

```text
Exports the latest 10 turns in chronological order.
```

应移除，替换成更省纵向空间的 turn selector。

建议结构：

```text
Thread actions

[PDF] [HTML] [Share]

Turns
[Latest 10 v]

[x] Token and price
[Review copy v]

Export PDF
```

`Turns` 控件：

- 默认 `Latest 10`
- 可选：
  - `Latest 3`
  - `Latest 10`
  - `Latest 20`
  - `All loaded`
  - `Custom`
- 选 `Custom` 时才展示 turn checkbox list。
- footer 显示 `7 turns selected`，而不是一整块说明卡。

这样比现在两组 segmented controls 加说明框更适合手机。

### Share 面板

选中 `Share` 后显示：

```text
Share

Relay identifier
[ username or email ]

Thread access
( ) View only
( ) Collaborator

Workspace
( ) No access
( ) Read files
( ) Read and edit files

Label
[ optional label ]

[Share session]
```

下方显示 active shares：

```text
Shared by me
alice    View only / Workspace read    Revoke
bob      Collaborator / Workspace write Revoke
```

移动端可把 active shares 折叠到 `Shared by me` disclosure，避免首屏过高。

## `@remote-codex/thread-ui` 改动面

`ExportTranscriptDialog` 应升级为更通用组件，例如：

```text
ThreadActionsDialog
```

保留 backward-compatible export 名称一段时间也可以：

```ts
export { ThreadActionsDialog };
export { ThreadActionsDialog as ExportTranscriptDialog };
```

建议新增 props：

```ts
type ThreadActionMode = 'pdf' | 'html' | 'share';

interface ThreadActionsDialogProps {
  open: boolean;
  busy?: boolean;
  shareAvailable?: boolean;
  initialMode?: ThreadActionMode;
  turnsState: ExportTurnsState;
  shareState?: ShareState;
  onCancel: () => void;
  onLoadTurns: () => void | Promise<void>;
  onExport: (input: ExportThreadPdfInput) => void | Promise<void>;
  onCreateShare?: (input: CreateRelayShareInput) => void | Promise<void>;
  onRevokeShare?: (shareId: string) => void | Promise<void>;
}
```

还需要让 `ThreadDetailSurface` 或 `ThreadWorkspaceLayout` 支持移动端 actions：

- 现状：supervisor-web 的 export button 通过 `topbarActions`/floating panel 注入，移动端不稳定可见。
- 目标：thread-ui surface 接收 `threadActionsButton` 或 `onOpenThreadActions`，并在 desktop/mobile topbar 都渲染。
- supervisor-web 只负责传 handler，不自己决定移动端布局。

建议 API：

```ts
interface ThreadDetailSurfaceProps {
  topbarActions?: ReactNode;
  mobileTopbarActions?: ReactNode;
}
```

或更收敛：

```ts
interface ThreadDetailSurfaceProps {
  threadActionsButton?: ReactNode;
}
```

我倾向第二种，因为 actions button 是产品级固定入口，不需要让宿主传一排不受控按钮。

## supervisor-web 改动面

`apps/supervisor-web/src/pages/ThreadDetailPage.tsx`：

- 把当前 `exportTranscriptButton` 改成 `threadActionsButton`。
- 使用 `ThreadActionsDialog` 替代 `ExportTranscriptDialog`。
- relay 模式下传入 share handlers 和当前 share 状态。
- 根据 effective access 禁用 composer/workspace write controls。

`apps/supervisor-web/src/pages/useThreadAuxiliaryActions.ts`：

- 保留 export state 和 `handleExportTranscript`。
- 增加 share state：
  - `shareDialogState`
  - `loadRelaySharesForThread`
  - `handleCreateRelayShare`
  - `handleRevokeRelayShare`
- share 创建成功后刷新 portal/share summary。

`apps/supervisor-web/src/lib/api.ts`：

- 扩展 `createRelayShare` input。
- 增加 `fetchRelayAccess(deviceId, threadId)` 或在 thread detail response 外挂 effective relay access。

`apps/supervisor-web/src/pages/RelayDevicesPage.tsx`：

- 增加 `Shared with me` section。
- 每张 shared card 显示：
  - label 或 thread id
  - owner username
  - device name
  - thread access chip
  - workspace access chip
  - connected/offline status
  - `Open`
- 点击 `Open`：
  - `setSelectedRelayDeviceId(share.deviceId)`
  - `setSelectedRelayThreadId(share.threadId)`
  - navigate `/devices/:deviceId/threads/:threadId`

旧 `RelayPortalPage` 中的 invite/shared 功能可以降级为 account/management 页面，避免和 device 页面重复。

## shared DTO 和 DB

新增类型：

```ts
export type RelayThreadAccessDto = 'read' | 'control';
export type RelayWorkspaceAccessDto = 'none' | 'read' | 'write';

export interface CreateRelaySessionShareInput {
  targetIdentifier: string;
  deviceId: string;
  threadId: string;
  workspaceId?: string | null;
  label?: string | null;
  threadAccess: RelayThreadAccessDto;
  workspaceAccess: RelayWorkspaceAccessDto;
  expiresAt?: string | null;
}
```

扩展 `RelaySessionShareDto`：

```ts
threadAccess: RelayThreadAccessDto;
workspaceAccess: RelayWorkspaceAccessDto;
workspaceId: string | null;
expiresAt: string | null;
```

SQLite migration：

```sql
ALTER TABLE relay_shares ADD COLUMN thread_access TEXT NOT NULL DEFAULT 'control';
ALTER TABLE relay_shares ADD COLUMN workspace_access TEXT NOT NULL DEFAULT 'none';
ALTER TABLE relay_shares ADD COLUMN workspace_id TEXT;
ALTER TABLE relay_shares ADD COLUMN expires_at TEXT;
```

兼容策略：

- 旧 share 默认 `thread_access='control'`，维持现有行为。
- 旧 share 默认 `workspace_access='none'`，避免突然暴露 workspace。

## relay-server 权限矩阵

后端必须提供一个 `effectiveAccess(userId, deviceId, threadId?)`，不要继续只返回 boolean。

```ts
type EffectiveRelayAccess =
  | { kind: 'owner'; threadAccess: 'control'; workspaceAccess: 'write' }
  | { kind: 'shared'; shareId: string; threadAccess: RelayThreadAccessDto; workspaceAccess: RelayWorkspaceAccessDto; workspaceId: string | null };
```

### Thread API

Read-only 允许：

- `GET /api/threads/:threadId`
- `GET /api/threads/:threadId/items/:itemId/detail`
- `GET /api/threads/:threadId/export-turns`
- `GET /api/threads/:threadId/exports/pdf`
- `GET /api/threads/:threadId/assets/image`
- `GET /api/threads/:threadId/goal`
- `GET /api/threads/:threadId/skills`
- `GET /api/threads/:threadId/mcp-servers`
- `GET /api/threads/:threadId/hooks`

Collaborator 额外允许：

- `POST /api/threads/:threadId/prompt`
- `POST /api/threads/:threadId/interrupt`
- `POST /api/threads/:threadId/resume`
- `POST /api/threads/:threadId/requests/:requestId/respond`
- `PATCH /api/threads/:threadId/goal`

Owner-only：

- `DELETE /api/threads/:threadId`
- `PATCH /api/threads/:threadId`
- `PATCH /api/threads/:threadId/settings`
- fork/import/compact 是否开放以后再定，第一版建议 owner-only。

### Workspace API

`workspaceAccess='none'`：

- 所有 `/api/workspaces/:workspaceId/...` 禁止。
- 前端不显示 workspace pane 或显示 locked state。

`workspaceAccess='read'` 允许：

- `GET /api/workspaces/:workspaceId`
- `GET /api/workspaces/:workspaceId/files/tree`
- `GET /api/workspaces/:workspaceId/files/preview`
- `GET /api/workspaces/:workspaceId/files/raw`
- `GET /api/workspaces/:workspaceId/files/download`
- `GET /api/workspaces/:workspaceId/artifacts`
- `GET /api/workspaces/:workspaceId/artifacts/:artifactId`
- `GET /api/workspaces/:workspaceId/artifacts/:artifactId/download`

`workspaceAccess='write'` 额外允许：

- `PUT /api/workspaces/:workspaceId/files`
- `POST /api/workspaces/:workspaceId/files/upload`
- `PATCH /api/workspaces/:workspaceId/files/move`
- `DELETE /api/workspaces/:workspaceId/files`

Owner-only：

- create/delete workspace
- update workspace path/label
- favorite
- open workspace
- create/delete artifacts if artifact creation can run commands or read broad paths

### WebSocket

当前 WebSocket 已经按 `threadId` 过滤 server-to-client events。需要补 client-to-server 权限：

- Read-only share：
  - 允许接收 `thread.*` events。
  - 不允许发送任何 client message 给 supervisor。
- Collaborator：
  - 允许发送正常 thread control messages。
- Revoke/expire 后：
  - 新连接拒绝。
  - 已连接 socket 最好主动 close；第一版可以在下一次 message/heartbeat 时 close，但 revoke 后 HTTP 必须立即 403。

## 移动端和 WebView 注意事项

- iOS/Android WebView 不应该重新设计一套 export/share UI，面板主体应来自 `@remote-codex/thread-ui`。
- `apps/supervisor-web` 只覆盖桌面网页和手机浏览器；Android APK 的 thread 详情页使用 `apps/android/thread-web/src/AndroidThreadDetailPage.tsx` 独立 bundle，必须单独接入 `ThreadActionsDialog` 和 relay share API。
- Android relay URL 拼接要区分控制面和设备转发面：
  - `/api/...` 在 relay 模式下走 `/relay/devices/:deviceId/api/...`
  - `/relay/portal`、`/relay/access`、`/relay/shares` 保持原始控制面路径，不能被 device route 包住。
- iOS WebView 由 `apps/ios/RemoteCodex/Features/ThreadDetail/ThreadDetailWebViewScreen.swift` 加载 bundled web dist，并通过 `shareDownloadedFile` bridge 调起系统分享；第一版应重点确认 actions button 在 WebView 内可见。
- Android WebView 已有 `shareDownloadedFile` native bridge，PDF/HTML export 应继续走 native download/share；Share tab 不依赖本地文件系统能力，可以在移动端完整支持。
- 共享权限在移动端也必须执行：
  - read-only share 禁用 composer 和控制类操作。
  - workspace `none` 不暴露 workspace adapter。
  - workspace `read` 允许 tree/preview/raw/download，禁止 upload/move/delete。
  - workspace `write` 才开放写入。

## 验收测试

### Unit/API

- owner 可以创建 read-only share。
- owner 可以创建 collaborator share。
- target identifier 支持 username/email。
- read-only share:
  - `GET /api/threads/:id` 200
  - `POST /api/threads/:id/prompt` 403
  - WebSocket 能收到 thread update
  - WebSocket client message 被拒绝
- collaborator:
  - `POST /api/threads/:id/prompt` 200
  - `DELETE /api/threads/:id` 403
- workspace none/read/write 分别按矩阵放行/拒绝。
- revoke 后 HTTP 立即 403。

### supervisor-web

- desktop thread detail 打开 actions panel，能切换 `PDF`、`HTML`、`Share`。
- mobile viewport 能看到 actions button。
- mobile actions panel 不溢出，footer button 可见。
- `Exports the latest 10 turns in chronological order.` 不再出现。
- `Latest 3/10/20/All loaded/Custom` selector 工作。
- `Share` 表单能创建 share 并显示在 `Shared by me`。
- RelayDevicesPage 显示 `Shared with me` 并能打开 shared thread。

### thread-ui

- `ThreadActionsDialog` snapshot/interaction tests 覆盖：
  - PDF mode
  - HTML mode
  - Share mode
  - custom turns
  - mobile narrow viewport layout
- `ThreadDetailSurface` 在 mobile topbar 渲染 actions button。

## 分阶段落地

### Phase 1: UI shell and mobile export fix

- 在 `@remote-codex/thread-ui` 中把 `ExportTranscriptDialog` 升级为 actions dialog。
- PDF/HTML 先可用，Share tab 可以先显示 disabled placeholder。
- 移动端 topbar 补 actions button。
- supervisor-web 适配新 props。

验收：

- 桌面 PDF/HTML 仍可导出。
- 手机 viewport 能打开同一个面板。
- 旧说明文案被 turn selector 替代。

### Phase 2: Relay share permission model

- 扩 DTO、DB migration、relay-store。
- 实现 `effectiveAccess`。
- 改 HTTP permission matrix。
- 改 WebSocket client-to-server gate。

验收：

- API tests 覆盖 read-only/collaborator/workspace 权限。

### Phase 3: Share tab and RelayDevices shared list

- Share tab 接真实 API。
- Thread detail 显示 active shares 和 revoke。
- RelayDevicesPage 增加 `Shared with me`。

验收：

- A 账号创建 share，B 账号登录后无需刷新 owner session 即可看到入口。
- B 打开 shared session 后能接收 owner 后续对话更新。

### Phase 4: Effective access UI enforcement

- read-only 禁用 composer 和 request response controls。
- workspace none/read/write 控制 explorer/editor/upload/delete。
- 顶部显示 shared banner/chips。

验收：

- 前端不会展示明显不可用的操作。
- 后端仍为最终权限边界。

### Phase 5: Mobile WebView parity

- iOS/Android WebView 确认 actions button 可见。
- PDF/HTML download fallback 或 native bridge 行为明确。
- Share tab 在移动端可用。

验收：

- iOS/Android/desktop 三端都能打开 actions panel。
- 至少 Share 和 HTML export 在三端完成真实 smoke。

## 实现顺序建议

先修移动端 export 入口和面板结构，再做权限后端。原因是：

- 当前 export 面板已经属于 `thread-ui`，移动端入口问题可以独立解决。
- Share tab 可以先以 placeholder 进入统一面板，避免之后再改一次用户入口。
- 后端权限矩阵风险更高，应在 UI 壳稳定后单独实现和测试。
