# ElAgenteHarness Control Plane Integration Decision

本文档基于 2026-06-03 对当前 `sandbox-worker-control-plane` 分支、`@remote-codex/thread-ui`、Remote Codex control-plane/worker/plugin 代码，以及本地 `/home/u/dev/ElAgente/harness/ElAgenteHarness` 源码的通读。它是后续 goal 模式推进 ElAgenteHarness 接入的主计划。

相关历史和证据文档：

- [ElAgenteHarness Control Plane Integration Plan](./elagente-harness-control-plane-integration-plan.zh.md)
- [ElAgenteHarness Optimal Integration Plan](./elagente-harness-optimal-integration-plan.zh.md)
- [ElAgenteHarness Goal Checklist](./elagente-harness-goal-checklist.zh.md)
- [ElAgenteHarness Evidence Runbook](./elagente-harness-evidence-runbook.zh.md)

## 一句话结论

最优雅、边界最清晰的接入方式是把 ElAgenteHarness 作为 sandbox worker 的内置受控能力，而不是作为前端直连服务、prompt secret 注入方案、workspace/session 级 secret，或当前分支私有 UI fork。

推荐链路：

```text
browser
  -> Remote Codex frontend
  -> control-plane API
  -> sandbox router / worker internal API
  -> worker-local Harness API / managed MCP tools
  -> ElAgenteHarness
```

agent 实际使用工具时的生产路径：

```text
Codex runtime
  -> remote_codex_plugins MCP
  -> worker-local http://127.0.0.1:$PORT/api/harness/*
  -> WorkerHarnessClient
  -> ElAgenteHarness with X-Api-Key
```

control-plane overview 查看状态时的路径：

```text
browser
  -> /api/sandbox/harness/*
  -> control-plane API
  -> sandbox router / worker internal API
  -> worker /api/harness/*
  -> WorkerHarnessClient
  -> ElAgenteHarness with X-Api-Key
```

## Secret Boundary

`INACT_X_APP_KEY` 只能存在于：

- Kubernetes Secret
- sandbox worker env
- worker 内部 Harness HTTP client 调用栈

`INACT_X_APP_KEY` 不能存在于：

- browser/frontend bundle
- route token payload
- plugin settings
- system prompt/model hint
- thread message
- artifact metadata
- MCP config file
- control-plane public API response
- worker/control-plane logs

可以暴露给前端和用户的只有非敏感状态：

- Harness base URL
- Harness 是否 enabled
- chemistry tools 是否 enabled
- sandbox runtime key 是否 present
- module/tool 名称和 help 文本
- run/job/artifact 的非敏感 metadata
- usage summary/events 中的非敏感字段

## 已通读的关键代码

Remote Codex 当前分支：

- [apps/control-plane-api/src/config.ts](/home/u/dev/remoteCodex/apps/control-plane-api/src/config.ts)
- [apps/control-plane-api/src/adapters.ts](/home/u/dev/remoteCodex/apps/control-plane-api/src/adapters.ts)
- [apps/control-plane-api/src/app.ts](/home/u/dev/remoteCodex/apps/control-plane-api/src/app.ts)
- [apps/control-plane-api/src/repository.ts](/home/u/dev/remoteCodex/apps/control-plane-api/src/repository.ts)
- [apps/control-plane-api/src/quota.ts](/home/u/dev/remoteCodex/apps/control-plane-api/src/quota.ts)
- [apps/supervisor-api/src/worker-harness-client.ts](/home/u/dev/remoteCodex/apps/supervisor-api/src/worker-harness-client.ts)
- [apps/supervisor-api/src/routes/system.ts](/home/u/dev/remoteCodex/apps/supervisor-api/src/routes/system.ts)
- [apps/supervisor-api/src/worker-control-plane-sync.ts](/home/u/dev/remoteCodex/apps/supervisor-api/src/worker-control-plane-sync.ts)
- [apps/supervisor-api/src/plugins/builtin-plugins.ts](/home/u/dev/remoteCodex/apps/supervisor-api/src/plugins/builtin-plugins.ts)
- [apps/supervisor-api/src/plugins/plugin-service.ts](/home/u/dev/remoteCodex/apps/supervisor-api/src/plugins/plugin-service.ts)
- [bin/remote-codex-plugin-mcp.mjs](/home/u/dev/remoteCodex/bin/remote-codex-plugin-mcp.mjs)
- [packages/plugin-elagente-harness/src/manifest.ts](/home/u/dev/remoteCodex/packages/plugin-elagente-harness/src/manifest.ts)
- [packages/thread-ui/src/ThreadDetailSurface.tsx](/home/u/dev/remoteCodex/packages/thread-ui/src/ThreadDetailSurface.tsx)
- [packages/thread-ui/src/plugins/PluginProvider.tsx](/home/u/dev/remoteCodex/packages/thread-ui/src/plugins/PluginProvider.tsx)
- [apps/supervisor-web/src/pages/ControlPlanePage.tsx](/home/u/dev/remoteCodex/apps/supervisor-web/src/pages/ControlPlanePage.tsx)
- [apps/supervisor-web/src/pages/ControlPlaneSessionPage.tsx](/home/u/dev/remoteCodex/apps/supervisor-web/src/pages/ControlPlaneSessionPage.tsx)
- [apps/supervisor-web/src/components/AppShellNavContext.tsx](/home/u/dev/remoteCodex/apps/supervisor-web/src/components/AppShellNavContext.tsx)

ElAgenteHarness 本地源码：

- [/home/u/dev/ElAgente/harness/ElAgenteHarness/src/elagente_harness/server.py](/home/u/dev/ElAgente/harness/ElAgenteHarness/src/elagente_harness/server.py)
- [/home/u/dev/ElAgente/harness/ElAgenteHarness/src/inact/inact/apps/workspace/register.py](/home/u/dev/ElAgente/harness/ElAgenteHarness/src/inact/inact/apps/workspace/register.py)
- [/home/u/dev/ElAgente/harness/ElAgenteHarness/src/elagente_harness/compute_job/compute_job.py](/home/u/dev/ElAgente/harness/ElAgenteHarness/src/elagente_harness/compute_job/compute_job.py)
- [/home/u/dev/ElAgente/harness/ElAgenteHarness/tests/test_server.py](/home/u/dev/ElAgente/harness/ElAgenteHarness/tests/test_server.py)
- [/home/u/dev/ElAgente/harness/ElAgenteHarness/tests/test_compute_job_storage.py](/home/u/dev/ElAgente/harness/ElAgenteHarness/tests/test_compute_job_storage.py)

## 当前已实现

### Control-plane 配置

`apps/control-plane-api/src/config.ts` 已支持：

- `ELAGENTE_HARNESS_BASE_URL`
- `ELAGENTE_HARNESS_PROVIDER`
- `ELAGENTE_HARNESS_APP_KEY_SECRET_NAME`
- `ELAGENTE_HARNESS_ADMIN_BASE_URL`
- `ELAGENTE_HARNESS_ADMIN_KEY`
- `ELAGENTE_HARNESS_LEGACY_ADMIN_FALLBACK`
- `REMOTE_CODEX_CHEMISTRY_TOOLS_ENABLED`

设计判断：

- 这些变量放在 control-plane API 部署环境中是正确的。
- `ELAGENTE_HARNESS_ADMIN_KEY` 只用于 provisioning，不进入 worker/frontend。
- `ELAGENTE_HARNESS_BASE_URL` 可以进入 worker，因为它不是 secret。
- `REMOTE_CODEX_CHEMISTRY_TOOLS_ENABLED=true` 时要求 `ELAGENTE_HARNESS_BASE_URL` 存在是正确的 fail-fast。
- `ELAGENTE_HARNESS_LEGACY_ADMIN_FALLBACK` 默认 `true` 适合迁移期；staging/prod 应设置为 `false`，让 planned JSON admin contract 不可用时直接失败。

### Harness admin contract

Remote Codex `HttpHarnessAdmin` 当前优先调用 planned Harness admin routes：

- `POST /admin/members/ensure`
- `POST /admin/members/reconcile`
- `POST /admin/members/<externalKeyId>/rekey`
- `POST /admin/members/<externalKeyId>/revoke`
- `GET /admin/usage/export`

如果 planned route 返回 404 且 legacy fallback 未禁用，才会 fallback 到旧接口：

- `POST /admin/create`
- `POST /admin/<id>/rekey`
- `POST /admin/<id>/delete`
- metadata-only reconcile

Harness 本地源码和测试已具备 planned contract：

- `/admin/members/ensure` 对同一 `externalId` 幂等。
- `externalKeyId` 使用 `remote-codex:sandbox:<sandboxId>`。
- `externalUserId` 使用 `remote-codex:user:<userId>`。
- `rekey/revoke/reconcile` 支持 Remote Codex stable external id。
- `/admin/usage/export` 输出 Remote Codex 可导入的 usage event shape。

尚未完成的不是代码 shape，而是真实 production authenticated smoke：当前只有生产未认证探测证明 routes 存在并受 `X-Admin-Key` 保护，还没有真实 `ADMIN_KEY` 下的 JSON 合同证据。

### Sandbox lifecycle

`apps/control-plane-api/src/app.ts` 已在 bootstrap/start/restart/admin restart 路径中接入 `ensureHarness(...)`：

```text
sandbox start/restart/bootstrap
  -> ensure Harness user
  -> ensure or rotate sandbox-scoped Harness key
  -> write Kubernetes Secret data[<sandboxId>]
  -> persist non-secret key metadata
  -> start worker with secretKeyRef env
```

当前逻辑：

- chemistry tools disabled 时不 provision Harness。
- chemistry tools enabled 时缺 `ELAGENTE_HARNESS_BASE_URL`、admin base URL 或 admin key 会 fail closed。
- 如果 DB 中已有 active key 且 Secret binding 匹配，会调用 Secret writer 检查 `data[<sandboxId>]` 是否仍存在。
- Secret 存在时复用 existing metadata。
- Secret 明确缺失时 rotate Harness key，并重新写入 Kubernetes Secret。
- provisioning 或 Secret 写入失败时返回 `harness_unavailable`，不会启动一个缺 key 的 worker。

设计判断：

- credential ownership 应该是 sandbox-scoped，而不是 workspace/session/thread-scoped。
- workspace/session/thread 只做 usage attribution。
- sandbox start/restart 是最自然的 Secret reconcile/rotate 时机。
- 如果 chemistry tools enabled 但 Harness admin/Secret provisioning 失败，fail closed 是正确行为。

### Credential DB

`packages/db/src/schema.ts` 和 migrations 已新增：

- `control_harness_users`
- `control_harness_keys`
- `control_harness_usage_events`

当前 DB 保存：

- Remote Codex user/sandbox 到 Harness external user/key id 的映射
- key status
- Secret binding: `secret_name`, `secret_key`
- rotation/revocation timestamps
- nullable `key_ciphertext`
- usage events

设计判断：

- phase one 里 raw key 的 runtime source of truth 是 K8s Secret。
- DB 不应保存 raw key。
- 如果未来要求 control-plane 从 DB 恢复 raw key，必须先引入 KMS/envelope encryption，不能把 raw key 明文写 DB。

### Kubernetes Secret injection

`apps/control-plane-api/src/adapters.ts` 已支持 worker env 注入：

```text
ELAGENTE_HARNESS_BASE_URL=<configured base url>
REMOTE_CODEX_CHEMISTRY_TOOLS_ENABLED=true|false
INACT_X_APP_KEY=<from Kubernetes Secret data[<sandboxId>]>
```

K8s binding：

```text
secret name = ELAGENTE_HARNESS_APP_KEY_SECRET_NAME
secret key  = sandbox.id
value       = Harness api_key
```

设计判断：

- 这个形态和 sandbox-scoped credential 匹配。
- 一个 fixed Secret 中按 sandbox id 分 key，便于 rotate/revoke 单个 sandbox。
- worker pod 只通过 `secretKeyRef` 读自己的 key。
- control-plane public API 只返回 `keyPresent` / secret binding metadata，不返回 value。

### Worker startup validation

worker runtime config 已解析：

- `ELAGENTE_HARNESS_BASE_URL`
- `INACT_X_APP_KEY`
- `REMOTE_CODEX_CHEMISTRY_TOOLS_ENABLED`

worker 启动校验已实现：

- chemistry enabled 时要求 Harness base URL。
- chemistry enabled 时要求 `INACT_X_APP_KEY`。
- worker metadata 只暴露 `keyPresent`，不暴露 key。
- startup/API/log redaction 覆盖 `INACT_X_APP_KEY`。

设计判断：

- 这是正确的 fail-closed 行为。
- 缺 key 的 worker 不应假装 chemistry capability 可用。

### Worker Harness API

`apps/supervisor-api/src/worker-harness-client.ts` 和 `apps/supervisor-api/src/routes/system.ts` 已实现 worker-local API：

- `GET /api/harness/status`
- `GET /api/harness/me`
- `GET /api/harness/home`
- `GET /api/harness/modules/:module/help`
- `GET /api/harness/modules/:module/tools`
- `GET /api/harness/modules/:module/runs`
- `GET /api/harness/modules/:module/runs/:runId`
- `GET /api/harness/modules/:module/runs/:runId/artifacts`
- `GET /api/harness/modules/:module/runs/:runId/download.zip`
- `POST /api/harness/modules/:module/tools/:tool/invoke`

当前约束：

- module allowlist: `estructural`, `quntur`, `farmaco`
- tool name 必须是 URL-safe slug
- run id 必须是安全 id
- invoke body 必须是 JSON object
- `X-Api-Key` 只由 worker client 添加
- errors 会 redact `INACT_X_APP_KEY`
- worker metadata 只暴露 `keyPresent`，不暴露 key

设计判断：

- 这是正确的安全边界。
- 所有 provider 和 UI 都应该通过这层访问 Harness。
- browser 不应该直接拿 `X-Api-Key` 调 Harness。

### Managed MCP/plugin

`packages/plugin-elagente-harness` 已作为 builtin plugin 注册，`bin/remote-codex-plugin-mcp.mjs` 已提供：

- `harness_status`
- `harness_home`
- `harness_help`
- `harness_list_tools`
- `harness_invoke_tool`

当前 MCP production path：

- worker runtime 或显式 `REMOTE_CODEX_WORKER_API_BASE_URL` 时，优先调用 worker-local `/api/harness/*`。
- worker API 不可用时不会在 worker runtime 下静默 fallback 到 direct Harness。
- direct Harness fallback 只适合 local dev/outside-worker，并且可以通过 `REMOTE_CODEX_ALLOW_DIRECT_HARNESS_FALLBACK=true` 显式允许。

当前 plugin 管理：

- builtin/imported plugin registry
- enable/disable
- uninstall imported plugin
- `REMOTE_CODEX_ENABLED_PLUGIN_IDS` gate
- `modelHints`
- managed Codex MCP config block

设计判断：

- MCP/plugin 是 agent 使用 Harness 的正确入口。
- `modelHints` 可以告诉模型工具用法，但不能放 credential。
- MCP config 不应写 `INACT_X_APP_KEY`。
- 生产验收必须看到 `harness_status` 返回 `source: worker-api`。

当前限制：

- Codex MCP config 是静态文件，不能天然注入每个 turn 的动态 `workspaceId/sessionId/threadId/turnId`。
- MCP 代码已支持从 env 读取可选非敏感 attribution，并写进 `_remoteCodexContext`；但真实 per-turn attribution 仍需要 staging proof 或后续更强的 runtime context 注入方案。

### Usage / quota / audit

当前已有两条 usage path：

```text
worker-local invoke
  -> optional quota preflight
  -> Harness call
  -> record control_harness_usage_events
```

```text
Harness /admin/usage/export
  -> control-plane import job/admin route
  -> idempotent control_harness_usage_events
```

设计判断：

- immediate worker event 适合实时 UI。
- Harness export/import 适合最终账单和补偿审计。
- 两者必须用 `provider + externalEventId` 幂等。
- 真实账单闭环不能只依赖 worker best-effort event，仍需要 Harness export/import smoke。

当前限制：

- worker-local invoke 能记录 user/sandbox，并在 `_remoteCodexContext` 存在时记录 workspace/session/thread/turn。
- 如果 MCP 静态环境没有动态 context，session attribution 可能缺失。
- worker-local invoke 现在会在本地 DB 恰好一个 thread running 时保守补 `workspaceId`、`threadId`、`turnId`，并且不会在多 running thread 场景猜测。
- 不应为了补 attribution 把 key 或敏感 context 放进 prompt。

### Artifact projection

当前 MCP 已能把 Harness 结果映射为：

- `chemistry.molecule3d`
- `elagente.harness.run`
- `elagente.harness.artifact`

`packages/plugin-runtime` 已支持 `remote-codex-artifact` fenced block extraction，`@remote-codex/thread-ui` 已能通过 plugin/timeline 体系渲染 artifact fallback。

设计判断：

- molecule 继续复用 XYZ viewer，这是正确复用。
- generic Harness run/job/artifact 第一阶段可以用 thread-ui fallback artifact card。
- 等真实 Harness output shape 稳定后，再决定是否在 main `@remote-codex/thread-ui` 或 Harness plugin frontend module 中加入 custom renderer。

### Frontend / thread UI boundary

`ControlPlaneSessionPage` 已使用 `@remote-codex/thread-ui`：

- `ThreadDetailSurface`
- app shell menu/settings
- plugin provider context
- timeline/composer/shell surface

`apps/supervisor-web/src/components/AppShellNavContext.tsx` 只 re-export package context，避免 app/package 两套 settings nav context。

设计判断：

- 当前方向正确：control-plane session page 只做 adapter，不 fork thread UI。
- 插件设置应走 `@remote-codex/thread-ui` 的 shared navigation/settings，不应在 control-plane 页面再做一套插件管理 UI。
- `Prompt sent. Waiting for worker updates...` 这类临时文案不应作为正式 chat UX 出现；当前源码中它只应作为“不应出现”的测试断言保留。

当前限制：

- `@remote-codex/thread-ui` 当前是 monorepo workspace package 依赖：`@remote-codex/thread-ui: workspace:*`。
- 这已经是包级 import 边界，但还不是外部 registry/git tag 版本依赖。
- 后续 main 更新 UI 后，当前分支理想上只升级 package 版本；如果仍在同一 monorepo workspace 中，则需要把 main 的 `packages/thread-ui` 更新合入当前分支或改成发布包/git tag 依赖。

### Control-plane overview

Control Plane overview 目前是 operator/status surface：

- sandbox lifecycle
- Harness readiness
- base URL/key present/chemistry enabled
- module selector
- tools list
- recent runs
- usage summary/events

设计判断：

- overview 页面可以展示 Harness 状态和工具发现。
- overview 页面不应变成 arbitrary Harness tool executor。
- 真正调用计算化学工具应发生在 thread agent 的 MCP tools 中，或未来另做受控 job submission UI。

## 当前设计是否合理

整体设计合理，不建议推倒重做。

合理部分：

- sandbox-scoped Harness key。
- control-plane 持有 admin credential，worker 只持有 runtime app key。
- K8s Secret 注入 `INACT_X_APP_KEY`。
- worker-local `/api/harness/*` 作为唯一 runtime Harness client。
- agent 通过 managed MCP tools 使用 Harness。
- frontend 只看 status/usage/artifact，不碰 raw key。
- thread UI 通过 `@remote-codex/thread-ui` 复用 main UI。
- plugin 管理复用 main/settings 体系。
- usage 同时支持 worker immediate event 和 Harness export/import 补偿。

需要收敛的部分：

- 真实 production/staging evidence 还没闭环。
- K8s Secret/RBAC 还需要 live smoke。
- live Codex MCP 还需要证明 `source: worker-api`。
- live thread UI 还需要证明 Harness artifact card 能显示。
- dynamic workspace/session/thread/turn attribution 需要真实 MCP/thread smoke 或后续 runtime context 注入。
- `@remote-codex/thread-ui` 需要从 workspace package 进一步走向可版本化依赖，才能最大化降低 main UI 更新后的当前分支改动量。

## 最优接入方式

### 1. 保持 Secret 只在 worker runtime

不要把 Harness key 放入：

- OAuth/session token
- route token
- frontend state
- plugin settings
- MCP config env
- prompt/model hint
- artifact payload

`INACT_X_APP_KEY` 的唯一来源是：

```text
control-plane admin ensure/rekey
  -> Kubernetes Secret data[<sandboxId>]
  -> worker env secretKeyRef
  -> WorkerHarnessClient
```

### 2. 把 Harness 视为 sandbox capability

关系应是：

```text
user
  -> sandbox
     -> Harness key
     -> workspace(s)
        -> session(s)
           -> thread(s)
```

workspace/session/thread 是 attribution，不决定 key ownership。

创建 session 前要求 sandbox running 是合理的，因为：

- session resume 需要 worker thread。
- Harness key 注入发生在 worker 启动。
- worker 不 running 时没有 `/api/harness/*` runtime surface。

### 3. 用统一 plugin 管理

Harness plugin 应通过：

- builtin plugin manifest
- `PluginService`
- `PluginProvider`
- `AppShellNavigation` / Settings
- managed MCP config sync

进入系统。

不应该做：

- control-plane 独立 Harness plugin settings 页面
- browser 输入 Harness key 的表单
- per-session Harness key 配置
- prompt-level Harness enable switch

### 4. MCP production path 必须走 worker API

生产环境验收必须看到：

```json
{
  "source": "worker-api"
}
```

direct Harness fallback 只保留给 local dev/outside-worker。worker runtime 下如果 worker API 不可用，应失败并暴露 redacted error，不能静默 fallback。

### 5. Artifact 先 generic，后 custom renderer

第一阶段：

- molecule: `chemistry.molecule3d`
- Harness run: `elagente.harness.run`
- Harness file/artifact: `elagente.harness.artifact`
- 使用 thread-ui fallback artifact card

第二阶段：

- 等真实 Harness output shape 稳定后，在 main `@remote-codex/thread-ui` 或 Harness plugin frontend module 中加入 custom renderer。
- 当前分支只升级 package，不复制 renderer 源码。

### 6. Control-plane overview 是 operator surface

保留：

- sandbox readiness
- Harness enabled/keyPresent/health
- modules/tools/runs metadata
- usage summary/events

避免：

- arbitrary Harness tool executor
- key/admin key editor
- prompt injection editor
- 第二套 plugin manager
- chemistry IDE 化

## 分阶段计划

### Phase A: 代码边界复核

目标：确认当前分支只消费 `@remote-codex/thread-ui`，并且 Harness key 没有进入前端/prompt/settings。

任务：

- [x] 检查 `ControlPlaneSessionPage` 使用 `ThreadDetailSurface`。
- [x] 检查 app shell/settings context 已由 `@remote-codex/thread-ui` 统一。
- [x] 检查 `remote-codex.elagente-harness` manifest 不含 key/admin credential 字段。
- [x] 检查 `bin/remote-codex-plugin-mcp.mjs` worker runtime 下优先走 worker API。
- [x] 检查 frontend/thread-ui 不出现 raw `INACT_X_APP_KEY` 泄漏路径。
- [ ] 把 `@remote-codex/thread-ui` 从 workspace-local 依赖推进为可版本化依赖，或明确当前分支以后如何升级 main 的 package。

验证命令：

```bash
rg -n "INACT_X_APP_KEY|ELAGENTE_HARNESS_ADMIN_KEY|keyCiphertext|apiKey" apps/supervisor-web packages/thread-ui
rg -n "LocalAppShellNavContext|SharedAppShellNavContext|AppShellNavContext = createContext|createContext<AppShellNavContextValue" apps/supervisor-web/src packages/thread-ui/src -S
node --check bin/remote-codex-plugin-mcp.mjs
pnpm --filter @remote-codex/supervisor-web typecheck
pnpm --filter @remote-codex/supervisor-api typecheck
pnpm --filter @remote-codex/control-plane-api typecheck
```

### Phase B: Harness production admin contract smoke

目标：证明线上 Harness planned admin routes 不只是存在且受保护，还能用真实 `ADMIN_KEY` 返回 Remote Codex 需要的 JSON shape。

命令：

```bash
ELAGENTE_HARNESS_ADMIN_BASE_URL=https://elagenteharness-production.up.railway.app \
ELAGENTE_HARNESS_ADMIN_KEY=<actual Harness ADMIN_KEY> \
pnpm smoke:harness-admin-contract
```

完成标准：

- [ ] unauthenticated `/admin/members/ensure` 返回 `401 X-Admin-Key required`。
- [ ] authenticated ensure 返回 `externalUserId`、`externalKeyId`、`apiKey` present。
- [ ] same external id ensure idempotent。
- [ ] reconcile 返回 matching key。
- [ ] rekey 返回 new key，smoke 不打印原文。
- [ ] usage export 返回 `{ events, nextCursor }` shape。
- [ ] revoke 返回 revoked。

### Phase C: Remote Codex 部署环境

目标：control-plane 能生成 scoped Harness key，并把它写入 worker 可用的 K8s Secret。

control-plane API env：

```text
ELAGENTE_HARNESS_BASE_URL=https://elagenteharness-production.up.railway.app
ELAGENTE_HARNESS_ADMIN_BASE_URL=https://elagenteharness-production.up.railway.app
ELAGENTE_HARNESS_ADMIN_KEY=<actual Harness ADMIN_KEY>
ELAGENTE_HARNESS_APP_KEY_SECRET_NAME=<k8s secret name>
ELAGENTE_HARNESS_PROVIDER=elagente-harness
ELAGENTE_HARNESS_LEGACY_ADMIN_FALLBACK=false
REMOTE_CODEX_CHEMISTRY_TOOLS_ENABLED=true
```

K8s smoke：

```bash
HARNESS_K8S_NAMESPACE=<namespace> \
ELAGENTE_HARNESS_APP_KEY_SECRET_NAME=<secret name> \
HARNESS_K8S_SECRET_KEY=<sandbox id> \
pnpm smoke:harness-k8s-secret
```

完成标准：

- [ ] control-plane identity 可以 `get secrets`。
- [ ] control-plane identity 可以 `patch secrets`。
- [ ] configured Secret 存在 `data[<sandboxId>]`。
- [ ] smoke 输出只包含 metadata/key presence，不打印 Secret data value。
- [ ] worker metadata 显示 `keyPresent: true`。

### Phase D: Staging worker/MCP/thread smoke

目标：真实部署证明 worker API、Codex MCP、usage 和 UI artifact 都闭环。

基础 smoke：

```bash
STAGING_HARNESS_SMOKE=1 \
STAGING_CONTROL_PLANE_BASE_URL=<control-plane base url> \
STAGING_PRODUCT_JWT=<product jwt> \
pnpm smoke:staging-phase-one
```

低成本 invoke：

```bash
STAGING_HARNESS_SMOKE=1 \
STAGING_HARNESS_MODULE=farmaco \
STAGING_HARNESS_INVOKE_TOOL=<low-cost tool> \
STAGING_HARNESS_INVOKE_INPUT_JSON='<json object>' \
STAGING_CONTROL_PLANE_BASE_URL=<control-plane base url> \
STAGING_PRODUCT_JWT=<product jwt> \
pnpm smoke:staging-phase-one
```

MCP 证据要求：

- `STAGING_HARNESS_MCP_SMOKE_COMMAND` 输出顶层 JSON。
- 顶层必须包含 `"source": "worker-api"`。

Thread UI artifact 证据要求：

- `STAGING_HARNESS_THREAD_ARTIFACT_UI_SMOKE_COMMAND` 输出 JSON。
- `artifactTypes` 至少包含一个：
  - `elagente.harness.run`
  - `elagente.harness.artifact`
  - `chemistry.molecule3d`

完成标准：

- [ ] sandbox running。
- [ ] browser -> router -> worker metadata 可达。
- [ ] worker `/api/harness/status` ready。
- [ ] worker `/api/harness/modules/:module/help|tools` 可达。
- [ ] Codex MCP `harness_status` 返回 `source: worker-api`。
- [ ] 低成本 `harness_invoke_tool` 成功。
- [ ] control-plane usage summary/events 增加。
- [ ] thread timeline 显示 Harness artifact card 或 molecule renderer。
- [ ] API/thread/log scan 不包含 `INACT_X_APP_KEY`。

### Phase E: 总体验收 verifier

当 admin smoke、staging smoke、K8s smoke 都有 JSON evidence 后运行：

```bash
pnpm verify:harness-integration-evidence \
  --admin-smoke <harness-admin-smoke.json> \
  --staging-smoke <staging-phase-one-smoke.json> \
  --k8s-secret-smoke <harness-k8s-secret-smoke.json>
```

完成标准：

- [ ] `harness-admin-contract` true。
- [ ] `harness-worker-runtime` true。
- [ ] `harness-usage-attribution` true。
- [ ] `harness-mcp-worker-api` true。
- [ ] `harness-thread-artifact-ui` true。

### Phase F: Attribution hardening

目标：让 Harness usage 更稳定地归属到 user/sandbox/workspace/session/thread/turn。

当前状态：

- user/sandbox 来自 worker runtime identity，已稳定。
- workspace/session/thread/turn 优先依赖 `_remoteCodexContext`。
- worker-side inference 已实现一个保守 fallback：仅当本地 DB 中恰好一个 thread running 时补 workspace/thread/turn，不推断 sessionId。
- worker-local Harness usage metadata 已记录非敏感 `attributionSource`：`request-context`、`worker-inferred` 或 `worker-runtime`。
- MCP 静态 config 无法天然知道当前 turn。

推荐推进顺序：

- [ ] staging smoke 先证明当前 `_remoteCodexContext` 能否在真实 Codex MCP invoke 中带上 workspace/session/thread/turn。
- [x] 如果不能，优先在 worker-local route 内做保守 inference：仅当本地 DB 中恰好一个 thread running 时补 thread/workspace/turn。
- [x] 不要 infer sessionId，除非 worker DB 或 control-plane checkpoint 明确提供 session mapping。
- [x] 在 control-plane usage event metadata 中标记 attribution source，目前 worker-local invoke 会记录 `request-context`、`worker-inferred` 或 `worker-runtime`。
- [x] 对多 running thread 场景不做猜测，宁可只记录 user/sandbox。

完成标准：

- [ ] usage events 至少稳定记录 user/sandbox/module/tool/run/job。
- [x] 单 running thread 场景记录 workspace/thread/turn。
- [x] 多 running thread 场景不误归属。
- [x] sessionId 只有在真实 session mapping 存在时才记录。
- [x] usage metadata 标记 attribution source。
- [ ] 真实 staging MCP invoke 证明 user/sandbox/workspace/session/thread/turn attribution 符合预期。

### Phase G: Provider parity

目标：Claude/OpenCode 等 provider 共享同一套 Harness capability。

原则：

- 不给 provider 单独发 Harness key。
- 不把 key 写 provider config。
- 仍走 worker-local API 或同一 managed MCP server。
- usage/audit 仍进 control-plane。

完成标准：

- [ ] Claude/OpenCode 能发现 Harness tools。
- [ ] tool invocation 走 worker API。
- [ ] usage/audit 记录一致。
- [ ] provider logs 不含 key。

### Phase H: Thread UI package versioning

目标：后续 main 分支更新 thread UI 后，当前分支不需要做源码级 UI diff。

当前状态：

- `apps/supervisor-web` 已通过 `@remote-codex/thread-ui` import 使用 thread UI。
- 但依赖是 `workspace:*`，仍需要当前分支拿到 `packages/thread-ui` 的源码更新。

推荐方案：

- [ ] 在 main 分支把 `@remote-codex/thread-ui` 作为可发布 package 固化 exports、types、CSS entry、peer deps。
- [ ] 发布到私有 registry，或使用 git tag/tarball dependency。
- [ ] 当前分支改为依赖明确版本，例如 `@remote-codex/thread-ui@0.x.y`。
- [ ] 当前分支只保留 adapter 层：control-plane session lookup、route token、worker thread adapter、session metadata。
- [ ] 如果需要新 settings/plugin/timeline slot，先在 main `@remote-codex/thread-ui` 加，再升级当前分支依赖版本。

完成标准：

- [ ] 当前分支不再需要修改 `packages/thread-ui/src/*` 来满足 control-plane session UI。
- [ ] `ControlPlaneSessionPage` 只 import package public API。
- [ ] thread UI 更新通过 package version bump 完成。

## 不建议做的方案

### 前端直连 Harness

不建议，因为：

- browser 必须持有 `X-Api-Key`。
- CORS 会被迫为 secret-bearing client 打开。
- usage/quota/audit 很容易绕过 control-plane。
- route token、product auth、Harness auth 会混在一起。

### prompt 注入 raw key

不建议，因为：

- prompt/thread/message 都不是 secret boundary。
- agent 可能复述、总结、保存或上传 key。
- plugin model hint 可以讲用法，但不能讲 credential。

### workspace/session scoped Harness key

不建议，因为：

- worker env 是 sandbox 级别。
- 一个 sandbox 可以有多个 workspace/session。
- key 随 session 改变会让 worker runtime 不稳定。

### 当前分支 fork thread UI

不建议，因为：

- 后续 main 更新会变成源码 diff 合并。
- settings/plugin/timeline/composer 容易分裂。
- 正确方式是把需要的 slot/renderer 放进 `@remote-codex/thread-ui`，当前分支升级 package。

## 剩余风险

1. 没有真实 Harness `ADMIN_KEY` authenticated production smoke。
2. Remote Codex production/staging Harness env 是否已配置仍需 live evidence。
3. K8s Secret/RBAC live smoke 未完成。
4. 真实 sandbox worker 是否拿到 `INACT_X_APP_KEY` 未完成。
5. 真实 Codex MCP 是否返回 `source: worker-api` 未完成。
6. 真实 Harness invoke usage/audit 未完成。
7. Live thread UI artifact rendering 未完成。
8. Dynamic workspace/session/thread/turn attribution 尚未在真实 staging MCP invoke 中证明；本地 worker fallback 已覆盖单 running thread 的 workspace/thread/turn。
9. 如果未来 DB 需要恢复 raw key，必须补 KMS/envelope encryption。

## 本轮复核命令

本轮用于复核设计边界的命令：

```bash
git status --short --branch
rg -n "ELAGENTE|INACT_X_APP_KEY|harness|Harness|remote-codex.elagente|_remoteCodexContext|control_harness|harness_" apps packages bin scripts docs -g '!**/dist/**' -g '!**/node_modules/**'
rg -n "admin|members|usage|X-Admin-Key|x-app-key|INACT|Remote Codex|remote codex|Harness" /home/u/dev/ElAgente/harness/ElAgenteHarness -g '!**/node_modules/**' -g '!**/.git/**'
rg -n "INACT_X_APP_KEY|ELAGENTE_HARNESS_ADMIN_KEY|keyCiphertext|apiKey" apps/supervisor-web packages/thread-ui -S
```

本轮未重新运行完整 test suite。最近已记录通过的验证见 [ElAgenteHarness Control Plane Integration Plan](./elagente-harness-control-plane-integration-plan.zh.md) 的 `Latest Verification Snapshot`。
