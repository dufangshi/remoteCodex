# Relay Device Share Implementation Plan

> Status: planning document only. This branch starts from `main` at the point where relay thread sharing already exists.

## Goal

把 relay share 从“只能分享一个指定 thread”扩展为可分享一整台 relay device。

目标场景：

- 用户 A 在 relay 账号下添加了一台办公室服务器 device。
- A 可以把这台 device 分享给同事 B、C。
- B、C 登录自己的 relay 账号后，可以在 Relay Portal 里看到这台 shared device。
- 根据 A 授予的权限，B、C 可以查看 workspaces、threads、running 状态，进入 thread，继续对话，或读写 workspace 文件。
- A 可以在 Shared by me 中管理、修改、撤销这些授权。

## Current State

当前实现是 thread-centric share：

- `CreateRelaySessionShareInput.threadId` 是必填字段。
- `RelaySessionShareDto` 表示一个 shared thread，而不是通用授权。
- `relay_shares.thread_id` 是 `TEXT NOT NULL`。
- `RelayStore.effectiveAccess(...)` 先按 device owner 判断，否则只按 exact `threadId` 或 exact `workspaceId` 查找 share。
- `/relay/devices/:deviceId/api/threads` 对 shared user 特殊处理为只返回已分享的 thread 列表。
- `/relay/devices/:deviceId/ws` 当前通过 `threadId` 做 shared access 判断。
- Runtime metadata allowlist 只为已有 shared thread 用户开放必要 toolbox metadata。

这些限制说明：device share 不应通过伪造 `threadId="*"` 实现，而应成为新的 first-class grant scope。

## Product Semantics

### Share scopes

1. `thread`
   - 现有语义。
   - 只分享一个 thread。
   - 可选附带该 thread 所属 workspace 的 `none/read/write` 权限。

2. `workspace`
   - 后续可选增强。
   - 分享某个 workspace 里的 threads 和 workspace 文件权限。
   - 可以作为 device share 的 allowlist 基础。

3. `device`
   - 本计划重点。
   - 分享整台 relay device。
   - 对方可进入这台 device，并看到其 workspaces、threads、running 状态。

### Permission presets

UI 提供角色预设，但后端保存细粒度字段。

1. Viewer
   - `threadAccess = read`
   - `workspaceAccess = none` 或 `read`
   - 允许查看 device、workspace/thread 列表、thread transcript。
   - 不允许发 prompt、interrupt、goal mutation、file mutation。

2. Collaborator
   - `threadAccess = control`
   - `workspaceAccess = read`
   - 允许发 prompt、continue/resume、interrupt、goal/slash toolbox、创建 thread。
   - 允许读 workspace 文件，不允许写。

3. Operator
   - `threadAccess = control`
   - `workspaceAccess = write`
   - Collaborator + workspace 文件写权限。

4. Device admin
   - 暂不实现。
   - `copy setup token`、delete device、runtime restart/build/install、host config、relay admin 仍然 owner-only。

### Workspace scope

V1 建议支持：

- `workspaceScope = all`

V1.1 再支持：

- `workspaceScope = selected`
- `workspaceIds = string[]`

原因：如果 V1 同时做 selected workspace，要在 thread-only API 路径上反查 thread 属于哪个 workspace，容易扩大第一阶段复杂度。

## Backend Design

### Phase 1: Shared types and store model

- [x] 在 `packages/shared/src/index.ts` 增加通用 grant DTO。
- [x] 保留现有 `RelaySessionShareDto` 兼容旧 UI/API。
- [x] 新增 `RelayAccessGrantDto`：

```ts
export type RelayShareScopeDto = 'thread' | 'workspace' | 'device';
export type RelayThreadAccessDto = 'read' | 'control';
export type RelayWorkspaceAccessDto = 'none' | 'read' | 'write';
export type RelayWorkspaceScopeDto = 'all' | 'selected';

export interface RelayAccessGrantDto {
  id: string;
  ownerUserId: string;
  ownerUsername: string;
  targetUserId: string;
  targetUsername: string;
  deviceId: string;
  deviceName: string;
  scope: RelayShareScopeDto;
  threadId: string | null;
  threadTitle: string | null;
  workspaceId: string | null;
  workspaceLabel: string | null;
  workspaceScope: RelayWorkspaceScopeDto;
  workspaceIds: string[];
  label: string | null;
  threadAccess: RelayThreadAccessDto;
  workspaceAccess: RelayWorkspaceAccessDto;
  canCreateThreads: boolean;
  createdAt: string;
  revokedAt: string | null;
  expiresAt: string | null;
  lastAccessedAt: string | null;
  lastAccessedByUsername: string | null;
  accessEvents: RelayAccessGrantEventDto[];
}
```

- [ ] 新增 create/update input：

```ts
export interface CreateRelayAccessGrantInput {
  targetIdentifier: string;
  deviceId: string;
  scope: RelayShareScopeDto;
  threadId?: string | null;
  workspaceId?: string | null;
  workspaceScope?: RelayWorkspaceScopeDto;
  workspaceIds?: string[];
  label?: string | null;
  threadAccess: RelayThreadAccessDto;
  workspaceAccess: RelayWorkspaceAccessDto;
  canCreateThreads?: boolean;
  expiresAt?: string | null;
}
```

- [ ] 扩展 `RelayEffectiveAccessDto`：

```ts
export interface RelayEffectiveAccessDto {
  kind: 'owner' | 'shared';
  grantId: string | null;
  shareId: string | null; // deprecated compatibility
  scope: 'owner' | RelayShareScopeDto;
  threadAccess: RelayThreadAccessDto;
  workspaceAccess: RelayWorkspaceAccessDto;
  workspaceId: string | null;
  workspaceScope: RelayWorkspaceScopeDto | null;
  canCreateThreads: boolean;
}
```

验收：

- [x] TypeScript shared package builds.
- [x] Existing thread share type consumers still compile.

### Phase 2: Database migration

Preferred path: introduce new table instead of overloading `relay_shares`.

- [x] Add `relay_access_grants`.
- [ ] Add `relay_access_grant_workspace_ids` if selected workspaces are supported in this phase.
- [x] Add `relay_access_grant_events`.
- [x] Keep `relay_shares` readable for existing deployments.
- [ ] Option A: migrate existing `relay_shares` rows into `relay_access_grants(scope='thread')`.
- [x] Option B: keep compatibility read path that maps old shares into grant objects.

Current V1 implementation note:

- `relay_access_grants.workspace_ids` is stored as a JSON text column for scaffolding.
- A normalized `relay_access_grant_workspace_ids` table is still deferred until selected-workspace enforcement is implemented.

Recommended V1 migration:

```sql
CREATE TABLE IF NOT EXISTS relay_access_grants (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES relay_users(id) ON DELETE CASCADE,
  owner_username TEXT,
  target_user_id TEXT NOT NULL REFERENCES relay_users(id) ON DELETE CASCADE,
  target_username TEXT,
  device_id TEXT NOT NULL REFERENCES relay_devices(id) ON DELETE CASCADE,
  device_name TEXT,
  scope TEXT NOT NULL CHECK (scope IN ('thread', 'workspace', 'device')),
  thread_id TEXT,
  thread_title TEXT,
  workspace_id TEXT,
  workspace_label TEXT,
  workspace_scope TEXT NOT NULL DEFAULT 'all',
  label TEXT,
  thread_access TEXT NOT NULL DEFAULT 'control',
  workspace_access TEXT NOT NULL DEFAULT 'none',
  can_create_threads INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  expires_at TEXT
);
```

Unique active grant policy:

- [ ] One active grant per `(owner_user_id, target_user_id, device_id, scope, thread_id, workspace_id)`.
- [ ] For device scope, `thread_id` and `workspace_id` are null.
- [ ] Creating the same active grant updates permissions instead of duplicating rows.

验收：

- [x] Fresh DB starts.
- [ ] Existing DB with `relay_shares` starts.
- [x] Existing thread shares still appear in portal.
- [x] Revoked/expired grants are not effective.

### Phase 3: Access resolver

Replace the current `EffectiveRelayAccess` shape with grant-aware access.

Resolution order:

1. Device owner.
2. Exact active `thread` grant.
3. Exact active `workspace` grant.
4. Active `device` grant.

Rules:

- [x] Owner keeps full access.
- [x] Thread grant keeps current behavior.
- [ ] Workspace grant allows threads/files under that workspace only. This can be deferred.
- [x] Device grant allows full device navigation with bounded operations.
- [ ] If multiple active grants match, use highest capability:
  - `control > read`
  - `write > read > none`
  - `canCreateThreads = true` if any matching grant allows it.

Implementation targets:

- [x] `apps/relay-server/src/relay-store.ts`
  - `createGrant`
  - `updateGrant`
  - `revokeGrant`
  - `effectiveAccess`
  - `portalSummary`
  - `recordGrantAccess`

验收:

- [ ] Unit tests for owner, thread grant, device grant, expired, revoked, and self-share rejection.
- [x] Existing thread-share tests still pass.

## Relay Forwarding Design

### Phase 4: Device grant HTTP forwarding

Change `forwardRelayHttp(...)` to distinguish:

- no access
- thread grant
- workspace grant
- device grant

Allowed for device grant:

- [x] `GET /api/threads`
- [ ] `GET /api/threads/:threadId`
- [ ] `GET /api/threads/:threadId/items/:itemId/detail`
- [ ] transcript export and image asset paths
- [x] `GET /api/workspaces`
- [ ] `GET /api/workspaces/:workspaceId`
- [ ] workspace file read paths when `workspaceAccess !== none`
- [ ] workspace file write paths when `workspaceAccess === write`
- [x] runtime metadata reads needed for toolbox:
  - `GET /api/agent-runtimes`
  - `GET /api/plugins`
  - `GET /api/agent-runtimes/:provider/status`
  - `GET /api/agent-runtimes/:provider/models`
- [x] `POST /api/threads/start` when `canCreateThreads === true`
- [x] thread control paths when `threadAccess === control`:
  - prompt
  - resume
  - interrupt
  - compact
  - goal set/patch/delete
  - hooks trust/untrust/respond

Still forbidden for shared users:

- [x] device token/setup token reads
- [x] delete device
- [ ] relay admin APIs
- [x] runtime restart/build/install
- [ ] provider host config mutation
- [ ] workspace create/import/delete unless explicitly added later

Special list behavior:

- Existing thread grant:
  - `GET /api/threads` returns only shared threads.
- Device grant:
  - `GET /api/threads` forwards full list.
- Future workspace grant:
  - `GET /api/threads` filters by allowed workspace IDs.

验收：

- [x] Shared thread recipient still sees only shared threads.
- [x] Shared device recipient sees all device threads.
- [x] Forbidden admin/runtime mutation paths return 403.

### Phase 5: WebSocket access

Update WebSocket behavior:

- [ ] `/relay/devices/:deviceId/ws?threadId=...` permits device grant.
- [ ] `/relay/devices/:deviceId/ws` permits device grant without thread filter.
- [ ] Read-only device viewers receive events but cannot send control messages.
- [ ] Collaborator/operator can send allowed client messages.
- [ ] If a specific `threadId` is present, keep filtering events to that thread.
- [ ] If no `threadId`, device grant can receive device-wide thread status updates.

Open question:

- Current socket message path only checks `threadAccess !== control` before forwarding client messages. For device share, we may need to inspect message payload shape to avoid forwarding broad control messages. If payloads are only thread-scoped, current check may be enough for V1.

验收：

- [ ] A and B can view the same shared thread and both receive streaming updates.
- [ ] B can see sidebar room status change when another user starts a thread on the shared device.
- [ ] Viewer socket cannot control supervisor.

## API Design

### Phase 6: Relay API endpoints

Add general grant endpoints while keeping `/relay/shares` compatible.

New endpoints:

- [x] `POST /relay/grants`
- [x] `PATCH /relay/grants/:grantId`
- [x] `DELETE /relay/grants/:grantId`

Compatibility:

- [ ] Existing `POST /relay/shares` maps to `POST /relay/grants` with `scope='thread'`.
- [ ] Existing `PATCH /relay/shares/:shareId` and `DELETE /relay/shares/:shareId` keep working.

Portal DTO:

```ts
export interface RelayPortalSummaryDto {
  user: RelayUserDto;
  devices: RelayDeviceDto[];
  sharedDevicesWithMe: RelayAccessGrantDto[];
  sharedThreadsWithMe: RelayAccessGrantDto[];
  sharedByMe: RelayAccessGrantDto[];
}
```

Migration compatibility:

- [ ] Existing `sharedWithMe` and `sharedByMe` can remain for one release.
- [x] New UI should consume the new grouped fields.
- [ ] Mobile clients should tolerate missing grouped fields during rollout.

验收：

- [ ] API tests cover create/update/revoke device grant.
- [ ] API tests cover compatibility thread share endpoint.
- [ ] API tests cover portal summary grouping.

## Web UI Design

### Phase 7: Relay Portal UI

Relay Portal should show:

- My devices
- Shared devices
- Shared with me, thread grants
- Shared by me

Device card actions:

- Owner device:
  - Open
  - Copy setup
  - Share device
  - Delete
- Shared device:
  - Open
  - Permission chips
  - Owner label
  - Last access / expires label if available

Share device dialog fields:

- Target account identifier
- Role preset:
  - Viewer
  - Collaborator
  - Operator
- Workspace file access:
  - None
  - Read
  - Write
- Thread control:
  - View only
  - Can prompt and control
- Can create new threads
- Expiration
- Optional label

Shared by me management:

- [x] Shared by me supports device/thread/workspace grant rows with scope labels.
- [x] Device grants show device name instead of thread title.
- [x] Thread grants preserve current thread/workspace title display.
- [x] Manage button can edit access fields.
- [ ] Manage button can edit expiration.
- [x] Revoke button revokes grant.
- [x] Access popover shows latest events.

验收:

- [x] Owner can create a device share from portal.
- [x] Target sees shared device in portal without owning it.
- [x] Target opens shared device and lands on `/devices/:deviceId/workspaces`.
- [x] Existing shared thread Open still lands on `/devices/:deviceId/threads/:threadId`.

### Phase 8: Thread share panel

Thread UI share panel remains thread-specific.

- [ ] Rename copy to "Share this thread" where needed.
- [ ] Add small link/button "Share whole device" only if user is device owner.
- [ ] Thread share creation still sends `scope='thread'`.

验收:

- [ ] Current thread sharing UX is not regressed.
- [ ] Device sharing is discoverable but not mixed into thread-only defaults.

## Mobile Design

### Phase 9: Android and iOS parity

Android and iOS should mirror web semantics:

- [ ] Relay Portal includes Shared devices.
- [ ] Device cards show owner and permission chips.
- [ ] Shared device opens the normal workspace list.
- [ ] Thread creation is available only when allowed.
- [ ] Workspace file actions are hidden or disabled according to `workspaceAccess`.
- [ ] Thread composer is read-only for Viewer.
- [ ] Share management appears under Shared by me.

Mobile navigation:

- [ ] Shared device should use the same selected relay device storage model as owned devices.
- [ ] Back navigation should return to Relay Portal rather than dropping to unrelated local connection state.

验收:

- [ ] Android relay smoke with owner and target accounts.
- [ ] iOS relay smoke with owner and target accounts.
- [ ] No mobile-only route assumes all devices are owned.

## Security and Audit

### Phase 10: Boundary hardening

Required tests:

- [ ] Shared device Viewer cannot prompt.
- [ ] Shared device Collaborator cannot write files.
- [ ] Shared device Operator can write files.
- [ ] Shared device user cannot:
  - delete device
  - copy device setup token
  - restart runtime
  - install/update runtime
  - access relay admin
  - mutate registration settings
- [ ] Revoke cuts access for HTTP requests immediately.
- [ ] Revoke closes or invalidates WebSocket on next permission check.
- [ ] Expired grant is denied.

Audit event plan:

- [ ] Record grant access on meaningful actions, not every 3-second poll.
- [ ] Suggested event kinds:
  - `open_device`
  - `open_thread`
  - `create_thread`
  - `send_prompt`
  - `read_workspace_file`
  - `write_workspace_file`
- [ ] Shared by me should show:
  - last accessed by whom
  - last accessed at
  - expandable recent event list

## E2E Plan

### Phase 11: Local relay two-account E2E

Setup:

- Owner account A.
- Target account B.
- One relay device connected to local supervisor.
- At least two workspaces and two threads.

Scenarios:

- [ ] A creates Viewer device grant to B.
- [ ] B sees shared device.
- [ ] B sees workspaces and threads.
- [ ] B can open transcript.
- [ ] B cannot prompt.
- [ ] A upgrades B to Collaborator.
- [ ] B can create a new thread if `canCreateThreads=true`.
- [ ] B can send prompt and receives stream.
- [ ] A simultaneously sees stream updates.
- [ ] B cannot write file with workspace read.
- [ ] A upgrades B to Operator.
- [ ] B can upload/edit a file.
- [ ] B cannot restart runtime.
- [ ] A revokes grant.
- [ ] B loses access.

Success marker:

```text
RELAY_DEVICE_SHARE_E2E_OK
```

## Suggested Commit Plan

1. `docs: plan relay device sharing`
2. `shared: add relay grant DTOs`
3. `relay-server: add access grant storage`
4. `relay-server: resolve device grants`
5. `relay-server: allow device-grant forwarding`
6. `supervisor-web: add shared device portal UI`
7. `supervisor-web: add device share management`
8. `android: support shared relay devices`
9. `ios: support shared relay devices`
10. `test: add relay device share e2e`

## Open Questions

- [ ] V1 是否允许 device share 创建/import workspace？
  - 推荐：不允许。只允许访问已有 workspace。
- [ ] V1 是否支持 selected workspaces？
  - 推荐：先不做。先实现 all-device share，后续再加 allowlist。
- [ ] Shared user 是否能 rename/delete threads？
  - 推荐：Collaborator 可 rename 自己创建的 thread；delete 暂时 owner-only 或 Operator-only，需另行确认。
- [ ] Shared device 是否在 portal 里显示 workspace/thread counts？
  - 推荐：在线时显示，离线时显示上次缓存，失败不阻塞入口。
- [ ] Revoke 后是否主动关闭 WebSocket？
  - 推荐：V1 至少下一次请求和下一次 socket reconnect 失效；V1.1 做主动断开。

## Definition of Done

- [ ] Thread share existing behavior unchanged.
- [ ] Device share works for web.
- [ ] Android and iOS can open shared devices.
- [ ] Permission matrix has tests.
- [ ] Relay admin/runtime/device-token boundaries remain closed.
- [ ] Local two-account E2E passes.
- [ ] Docs updated with user-facing behavior.
