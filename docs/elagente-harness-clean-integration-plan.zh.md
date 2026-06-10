# ElAgenteHarness Clean Integration Plan

本文档是 2026-06-03 对当前 `sandbox-worker-control-plane` 分支、`@remote-codex/thread-ui`、Remote Codex control-plane/worker/plugin 代码、以及本地 `/home/u/dev/ElAgente/harness/ElAgenteHarness` 相关源码重新通读后的接入计划。

它的用途是把“怎么接入最优雅”说清楚：哪些部分已经实现，现有设计是否合理，哪些边界必须保持，后续应该按什么顺序推进。

相关历史文档：

- [ElAgenteHarness Control Plane Integration Decision](./elagente-harness-control-plane-integration-decision.zh.md)
- [ElAgenteHarness Goal Checklist](./elagente-harness-goal-checklist.zh.md)
- [ElAgenteHarness Evidence Runbook](./elagente-harness-evidence-runbook.zh.md)
- [ElAgenteHarness Control Plane Integration Plan](./elagente-harness-control-plane-integration-plan.zh.md)

## 结论

最优雅的接入方式不是前端直连 Harness，也不是把 Harness key 注入 prompt、plugin settings 或 route token，而是把 ElAgenteHarness 作为 sandbox worker 的受控内置能力。

推荐生产链路：

```text
browser
  -> Remote Codex frontend
  -> control-plane API
  -> sandbox router / worker internal API
  -> worker-local Harness API / managed MCP tools
  -> ElAgenteHarness
```

agent 使用工具时：

```text
Codex runtime
  -> remote_codex_plugins MCP
  -> http://127.0.0.1:$PORT/api/harness/*
  -> WorkerHarnessClient
  -> ElAgenteHarness with X-Api-Key
```

control-plane overview 查看状态时：

```text
browser
  -> /api/sandbox/harness/*
  -> control-plane API
  -> sandbox router / worker internal API
  -> worker /api/harness/*
  -> WorkerHarnessClient
  -> ElAgenteHarness with X-Api-Key
```

当前分支已经基本朝这个方向实现。下一步不应该大改 UI 或复制 main branch thread UI，而应该：

- 保持 `@remote-codex/thread-ui` 作为唯一 thread UI/package 边界。
- 让 Harness plugin/MCP 继续走 worker-local API。
- 配置真实部署环境并补齐 live evidence。
- 后续 main UI 更新时只升级 `@remote-codex/thread-ui` 包，不在当前分支维护 thread UI fork。

## 本次代码通读后的总判断

本次重新通读了 Remote Codex 当前分支的 control-plane API、sandbox adapter、worker API、plugin/MCP、thread UI adapter、frontend control-plane 页面、DB schema/migration、验证脚本，以及本地 `/home/u/dev/ElAgente/harness/ElAgenteHarness` 的 server/admin/runtime route 代码。结论如下：

| 区域 | 当前状态 | 设计判断 | 后续动作 |
| --- | --- | --- | --- |
| Harness admin contract | Harness 本地代码已有 `/admin/members/ensure`、`/admin/members/reconcile`、`/admin/members/<externalKeyId>/rekey`、`/admin/members/<externalKeyId>/revoke`、`/admin/usage/export`，Remote Codex `HttpHarnessAdmin` 已优先调用 planned JSON routes。 | 合理。control-plane 负责 admin provisioning，worker/browser 不接触 admin key。 | 用真实 `ADMIN_KEY` 跑 production authenticated smoke；staging/prod 设置 `ELAGENTE_HARNESS_LEGACY_ADMIN_FALLBACK=false`。 |
| Runtime key ownership | control-plane 为 sandbox ensure/rotate Harness app key，并写入 K8s Secret `data[<sandboxId>]`。 | 合理。key 应是 sandbox-scoped；workspace/session/thread 只做 usage attribution。 | 补 live K8s Secret/RBAC smoke，证明 Secret value 不打印。 |
| Worker runtime | worker startup 在 chemistry enabled 时要求 `ELAGENTE_HARNESS_BASE_URL` 和 `INACT_X_APP_KEY`，`WorkerHarnessClient` 是唯一 runtime `X-Api-Key` 注入点。 | 合理。缺 key fail closed，且 redaction 边界清楚。 | 用真实 running sandbox 验证 `/api/harness/home/status/me/help/tools`。 |
| Agent tool path | built-in `remote-codex.elagente-harness` plugin + `remote_codex_plugins` MCP 已提供 Harness tools，worker runtime 下优先走 worker-local API。 | 合理。MCP 是 agent 使用 chemistry 能力的自然入口。 | live Codex thread smoke 必须证明 `harness_status.source === "worker-api"`。 |
| Frontend overview | `ControlPlanePage` 只展示 sandbox/Harness readiness、tools/runs metadata、usage summary/events；没有 browser-side invoke executor。 | 合理。overview 是 operator surface，不应变成前端任意 Harness executor。 | 保持只读/状态型；真实 invocation 走 thread MCP。 |
| Thread chat UI | `ControlPlaneSessionPage` 使用 `@remote-codex/thread-ui` 的 `ThreadDetailSurface`，本地只做 route token、session lookup、worker thread adapter。 | 方向正确。当前分支不应复制 main branch thread UI internals。 | 后续 UI 能力缺口在 main `@remote-codex/thread-ui` 增加 public API，再升级当前分支依赖。 |
| Plugin/settings UI | `AppShellNavContext` 已 re-export `@remote-codex/thread-ui` context，`PluginProvider` 已由 thread-ui 提供。 | 合理。settings/nav/plugin manager 应只有一套 context。 | 不在 control-plane 页面再实现插件管理；缺能力时改 package。 |
| Usage/audit | 已有 worker immediate event 和 Harness admin export/import 两条路径，DB 有 `control_harness_usage_events`。 | 合理。实时 UI 和账单补偿审计可以并存，靠 `provider + externalEventId` 幂等。 | live low-cost invoke 后证明 usage count 增加、workspace/session attribution 正确。 |
| Artifact projection | MCP 可输出 `chemistry.molecule3d`、`elagente.harness.run`、`elagente.harness.artifact` fenced artifact。 | 合理。phase one 用 fallback card + XYZ renderer，避免提前定制过重 UI。 | live thread UI smoke 证明 artifact card 出现；需要更好 renderer 时在 thread-ui/plugin frontend module 加。 |
| `@remote-codex/thread-ui` 依赖 | 当前是 `workspace:*` package import 边界，不是外部版本化依赖。 | 边界已清晰，但还没达到“main 更新后只改版本号”的最优状态。 | 推荐 main 发布私有 registry package 或 git tag/tarball；当前分支从 workspace dependency 迁移到版本化依赖。 |

所以当前架构不需要推倒重做。真正缺的是生产配置、真实 sandbox/worker/MCP/UI smoke、以及 `@remote-codex/thread-ui` 的版本化依赖收敛。

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

可以暴露给前端的只有非敏感信息：

- Harness base URL
- Harness enabled/configured 状态
- chemistry tools enabled 状态
- worker runtime `keyPresent`
- module/tool/help/run/artifact metadata
- usage summary/events 中的非敏感字段

## 本次通读的关键代码

Remote Codex 当前分支：

- [apps/control-plane-api/src/config.ts](/home/u/dev/remoteCodex/apps/control-plane-api/src/config.ts)
- [apps/control-plane-api/src/adapters.ts](/home/u/dev/remoteCodex/apps/control-plane-api/src/adapters.ts)
- [apps/control-plane-api/src/app.ts](/home/u/dev/remoteCodex/apps/control-plane-api/src/app.ts)
- [apps/control-plane-api/src/repository.ts](/home/u/dev/remoteCodex/apps/control-plane-api/src/repository.ts)
- [packages/db/src/schema.ts](/home/u/dev/remoteCodex/packages/db/src/schema.ts)
- [apps/supervisor-api/src/worker-harness-client.ts](/home/u/dev/remoteCodex/apps/supervisor-api/src/worker-harness-client.ts)
- [apps/supervisor-api/src/routes/system.ts](/home/u/dev/remoteCodex/apps/supervisor-api/src/routes/system.ts)
- [apps/supervisor-api/src/worker-environment.ts](/home/u/dev/remoteCodex/apps/supervisor-api/src/worker-environment.ts)
- [apps/supervisor-api/src/plugins/builtin-plugins.ts](/home/u/dev/remoteCodex/apps/supervisor-api/src/plugins/builtin-plugins.ts)
- [apps/supervisor-api/src/plugins/plugin-service.ts](/home/u/dev/remoteCodex/apps/supervisor-api/src/plugins/plugin-service.ts)
- [bin/remote-codex-plugin-mcp.mjs](/home/u/dev/remoteCodex/bin/remote-codex-plugin-mcp.mjs)
- [packages/plugin-elagente-harness/src/manifest.ts](/home/u/dev/remoteCodex/packages/plugin-elagente-harness/src/manifest.ts)
- [packages/thread-ui/src/index.ts](/home/u/dev/remoteCodex/packages/thread-ui/src/index.ts)
- [packages/thread-ui/src/plugins/PluginProvider.tsx](/home/u/dev/remoteCodex/packages/thread-ui/src/plugins/PluginProvider.tsx)
- [packages/thread-ui/src/app-shell/AppShellNavContext.tsx](/home/u/dev/remoteCodex/packages/thread-ui/src/app-shell/AppShellNavContext.tsx)
- [apps/supervisor-web/src/app.tsx](/home/u/dev/remoteCodex/apps/supervisor-web/src/app.tsx)
- [apps/supervisor-web/src/components/AppShellNavContext.tsx](/home/u/dev/remoteCodex/apps/supervisor-web/src/components/AppShellNavContext.tsx)
- [apps/supervisor-web/src/pages/ControlPlanePage.tsx](/home/u/dev/remoteCodex/apps/supervisor-web/src/pages/ControlPlanePage.tsx)
- [apps/supervisor-web/src/pages/ControlPlaneSessionPage.tsx](/home/u/dev/remoteCodex/apps/supervisor-web/src/pages/ControlPlaneSessionPage.tsx)

ElAgenteHarness 本地源码此前已复核：

- [/home/u/dev/ElAgente/harness/ElAgenteHarness/src/elagente_harness/server.py](/home/u/dev/ElAgente/harness/ElAgenteHarness/src/elagente_harness/server.py)
- [/home/u/dev/ElAgente/harness/ElAgenteHarness/src/inact/inact/apps/workspace/register.py](/home/u/dev/ElAgente/harness/ElAgenteHarness/src/inact/inact/apps/workspace/register.py)
- [/home/u/dev/ElAgente/harness/ElAgenteHarness/src/elagente_harness/compute_job/compute_job.py](/home/u/dev/ElAgente/harness/ElAgenteHarness/src/elagente_harness/compute_job/compute_job.py)
- [/home/u/dev/ElAgente/harness/ElAgenteHarness/tests/test_server.py](/home/u/dev/ElAgente/harness/ElAgenteHarness/tests/test_server.py)
- [/home/u/dev/ElAgente/harness/ElAgenteHarness/tests/test_compute_job_storage.py](/home/u/dev/ElAgente/harness/ElAgenteHarness/tests/test_compute_job_storage.py)

## 已实现

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

- 这些变量放在 control-plane API 环境中是正确的。
- `ELAGENTE_HARNESS_ADMIN_KEY` 只用于 control-plane provisioning，不进入 worker/frontend。
- `ELAGENTE_HARNESS_BASE_URL` 可以进入 worker，因为它不是 secret。
- `REMOTE_CODEX_CHEMISTRY_TOOLS_ENABLED=true` 时要求 `ELAGENTE_HARNESS_BASE_URL` 存在是合理的 fail-fast。
- staging/prod 应设置 `ELAGENTE_HARNESS_LEGACY_ADMIN_FALLBACK=false`，让 planned admin contract 不可用时直接失败。

### Harness admin provisioning

`apps/control-plane-api/src/app.ts` 已在 bootstrap/start/restart/admin restart 路径中接入 `ensureHarness(...)`：

```text
sandbox start/restart/bootstrap
  -> ensure Harness user
  -> ensure or rotate sandbox-scoped Harness key
  -> write Kubernetes Secret data[<sandboxId>]
  -> persist non-secret key metadata
  -> start worker with secretKeyRef env
```

当前行为：

- chemistry disabled 时不 provision Harness。
- chemistry enabled 时缺 Harness base URL、admin base URL 或 admin key 会 fail closed。
- DB 中已有 active key 且 Secret binding 匹配时，会检查 Secret `data[<sandboxId>]` 是否仍存在。
- Secret 存在时复用现有 metadata。
- Secret 缺失时 rotate Harness key 并重新写入 Secret。
- provisioning 或 Secret write 失败时返回 `harness_unavailable`，不会启动缺 key 的 worker。

设计判断：

- Harness key 应该是 sandbox-scoped，而不是 workspace/session/thread-scoped。
- workspace/session/thread 只用于 usage attribution。
- sandbox start/restart 是最自然的 Secret reconcile/rotate 时机。

### Credential DB

`packages/db/src/schema.ts` 和 migrations 已新增：

- `control_harness_users`
- `control_harness_keys`
- `control_harness_usage_events`

DB 保存的是 external ids、status、Secret binding、rotation/revocation timestamps、usage events、nullable encrypted key metadata。phase one 中 raw key 的 runtime source of truth 是 Kubernetes Secret，不是 DB。

设计判断：

- 不应把 raw Harness app key 明文写 DB。
- 如果未来要求 DB 侧恢复 raw key，必须先接 KMS/envelope encryption。

### Kubernetes Secret injection

`apps/control-plane-api/src/adapters.ts` 已让 sandbox start input 支持：

```ts
harness?: {
  baseUrl: string;
  appKeySecretName?: string | null;
  chemistryToolsEnabled?: boolean;
}
```

AWS/EKS worker env 注入形态：

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
- fixed Secret + sandbox id key 便于单 sandbox rotate/revoke。
- worker pod 只通过 `secretKeyRef` 读自己的 runtime key。
- public API 只暴露 `keyPresent` / Secret binding metadata，不暴露 value。

### Worker startup validation

`apps/supervisor-api/src/worker-environment.ts` 已实现：

- provider runtimes 启用时要求 LLM gateway base URL/token。
- chemistry tools enabled 时要求 `ELAGENTE_HARNESS_BASE_URL` 和 `INACT_X_APP_KEY`。
- Harness base URL 必须是合法 URL。
- startup metadata 只显示 `harnessConfigured` / `chemistryToolsEnabled`，不显示 key。

`packages/config/src/index.ts` 已解析：

- `ELAGENTE_HARNESS_BASE_URL`
- `INACT_X_APP_KEY`
- `REMOTE_CODEX_CHEMISTRY_TOOLS_ENABLED`

并暴露：

- `harnessBaseUrl`
- `harnessEnabled`
- `chemistryToolsEnabled`

设计判断：

- 缺 key 的 worker 不应假装 chemistry capability 可用。
- worker metadata 里 `keyPresent` 是可接受的非敏感状态。

### Worker Harness API

`apps/supervisor-api/src/worker-harness-client.ts` 和 `apps/supervisor-api/src/routes/system.ts` 已实现：

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
- tool name URL-safe
- run id URL-safe
- invoke body 必须是 JSON object
- `X-Api-Key` 只由 `WorkerHarnessClient` 添加
- worker-side Harness error 会 redact `INACT_X_APP_KEY`
- worker metadata 只暴露 `keyPresent`

设计判断：

- 这是正确的 runtime boundary。
- 所有 provider 和 UI 都应通过这层访问 Harness。
- browser 不应该直接拿 `X-Api-Key` 调 Harness。

### Managed MCP/plugin

`packages/plugin-elagente-harness` 已作为 built-in plugin 注册。

`bin/remote-codex-plugin-mcp.mjs` 已提供：

- `harness_status`
- `harness_home`
- `harness_help`
- `harness_list_tools`
- `harness_invoke_tool`

生产路径：

- worker runtime 或显式 `REMOTE_CODEX_WORKER_API_BASE_URL` 时，优先调用 worker-local `/api/harness/*`。
- worker API 不可用时不会在 worker runtime 下静默 fallback 到 direct Harness。
- direct Harness fallback 只适合 local dev/outside-worker，并且要显式允许。

plugin 管理：

- built-in/imported plugin registry
- enable/disable
- imported plugin uninstall
- `REMOTE_CODEX_ENABLED_PLUGIN_IDS` gate
- `modelHints`
- managed Codex MCP config block

设计判断：

- MCP/plugin 是 agent 使用 Harness 的正确入口。
- `modelHints` 可以告诉模型工具用法，但不能包含 credential。
- MCP config 不应写 `INACT_X_APP_KEY`。
- production smoke 必须证明 `harness_status` 返回 `source: worker-api`。

当前限制：

- managed MCP config 目前主要覆盖 Codex config。
- Claude/OpenCode 等价 MCP/tool config 尚未证明。
- MCP 静态 config 不能天然注入每个 turn 的动态 `workspaceId/sessionId/threadId/turnId`。

### Usage / quota / audit

当前有两条 usage path：

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

worker-local invoke 已支持：

- `_remoteCodexContext` 中的 `workspaceId/sessionId/threadId/turnId`
- `recordUsage=false`
- estimated compute/cost quota preflight
- `attributionSource`
- 单个 running thread 场景下保守补 `workspaceId/threadId/turnId`

设计判断：

- immediate worker event 适合实时 UI。
- Harness export/import 适合最终账单和补偿审计。
- 两者必须用 `provider + externalEventId` 幂等。
- 不应为了补 attribution 把 key 或敏感 context 放进 prompt。

当前限制：

- 如果 MCP runtime 没有动态 context，session attribution 可能缺失。
- 真实 per-turn attribution 仍需要 staging proof 或后续更强的 runtime context 注入方案。
- 不能在多 running thread 场景猜测 attribution。

### Artifact projection

MCP 已能把 Harness 结果映射为：

- `chemistry.molecule3d`
- `elagente.harness.run`
- `elagente.harness.artifact`

`packages/plugin-runtime` 已支持 `remote-codex-artifact` fenced block extraction。

`@remote-codex/thread-ui` 已通过 plugin/timeline 体系支持 artifact fallback 和 XYZ renderer。

设计判断：

- molecule 继续复用 XYZ viewer。
- generic Harness run/job/artifact 第一阶段可以用 fallback artifact card。
- 等真实 Harness output shape 稳定后，再在 main `@remote-codex/thread-ui` 或 plugin frontend module 中加 custom renderer。
- 当前分支不应复制 renderer 源码。

### Frontend / thread UI boundary

`ControlPlaneSessionPage` 已使用 `@remote-codex/thread-ui`：

- `ThreadDetailSurface`
- `AppShellMenuButton`
- `AppShellNavigationMenu`
- `ThreadTimeline` props/types
- `ThreadComposer` props/types
- plugin/app shell context

`apps/supervisor-web/src/components/AppShellNavContext.tsx` 只 re-export `@remote-codex/thread-ui` context，避免 app/package 两套 settings/nav context。

`apps/supervisor-web/src/app.tsx` 使用 `PluginProvider` 包住路由。control-plane route 当前用默认 built-in plugin context，本地 supervisor route 则接 supervisor plugin API adapter。

设计判断：

- 当前方向正确：control-plane session page 只做 adapter，不 fork thread UI。
- control-plane session page 必须保留 session lookup、route token、resume/reconnect、worker thread adapter、metadata 映射这类胶水逻辑。
- 插件设置应走 `@remote-codex/thread-ui` 的 shared navigation/settings，不应在 control-plane 页面再做一套 plugin manager。
- `Prompt sent. Waiting for worker updates...` 这类临时文案不应作为正式 chat UX 出现；当前代码搜索显示它只作为“不应出现”的测试断言保留。

当前依赖形态：

- `apps/supervisor-web/package.json` 依赖 `@remote-codex/thread-ui: workspace:*`。
- `packages/thread-ui/package.json` 还是 `private: true` 的 workspace package。

这说明当前已经是 package import 边界，但还不是外部 registry/git tag 版本依赖。后续 main UI 更新后，当前分支仍需要把 main 的 `packages/thread-ui` 同步/升级进来，或把 `@remote-codex/thread-ui` 发布成可版本化依赖后只改版本号。

### Control-plane overview

`ControlPlanePage` 当前是 operator/status surface：

- sandbox lifecycle
- Harness readiness
- base URL/key present/chemistry enabled
- module selector
- tools list
- recent runs
- usage summary/events

代码搜索显示前端只调用：

- `/api/sandbox/harness/status`
- `/api/sandbox/harness/modules/:module/tools`
- `/api/sandbox/harness/modules/:module/runs`
- `/api/usage/harness/summary`
- `/api/usage/harness/events`

没有 browser-side Harness invoke executor。

设计判断：

- overview 可以展示 Harness 状态和工具发现。
- overview 不应变成 arbitrary Harness tool executor。
- 真正的 chemistry invocation 应发生在 thread agent MCP tools 中，或未来单独做受控 job submission UI。

## 现有设计是否合理

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

## 已实现能力与未完成证据

下面这张表用于 goal 模式推进时判断“代码已有”还是“闭环已证实”。只有 live evidence gate 全部通过，才算 ElAgenteHarness 接入完成。

| 能力 | 代码/本地测试状态 | live evidence 状态 | 判定 |
| --- | --- | --- | --- |
| Harness admin planned JSON routes | Harness 本地代码和测试已覆盖；Remote Codex `HttpHarnessAdmin` 已兼容 planned routes 和 legacy fallback。 | 只证明了 production unauth routes 返回 401；缺真实 `ADMIN_KEY` authenticated smoke。 | 未闭环。 |
| `ELAGENTE_HARNESS_LEGACY_ADMIN_FALLBACK=false` | config/test 已支持。 | 需要部署环境真实设置并验证。 | 未闭环。 |
| sandbox-scoped key provisioning | control-plane `ensureHarness`、DB metadata、Secret writer 已实现并有本地测试。 | 需要真实 K8s Secret/RBAC smoke。 | 未闭环。 |
| worker env secret injection | EKS adapter/local worker adapter 已实现；worker startup validation 已测试。 | 需要真实 worker metadata 证明 `keyPresent: true`。 | 未闭环。 |
| worker `/api/harness/*` | 本地 supervisor-api tests 覆盖 status/me/home/help/tools/runs/artifacts/download/invoke 和 redaction。 | 需要通过真实 router/control-plane 访问 deployed worker。 | 未闭环。 |
| managed MCP tools | `remote_codex_plugins` 已注册 Harness tools；node syntax check 和 plugin-runtime tests 通过。 | 需要真实 Codex thread 证明 `source: worker-api`。 | 未闭环。 |
| usage/quota/audit | DB/repository/app/quota/worker-sync local tests 已覆盖。 | 需要真实 low-cost invoke 后 usage event count 增加且 attribution 正确。 | 未闭环。 |
| artifact extraction | molecule/generic Harness artifact fenced block extraction 已有本地测试。 | 需要真实 thread UI 看到 Harness artifact card。 | 未闭环。 |
| frontend secret posture | frontend/thread-ui scan 未发现 raw key path；control-plane overview 无 browser-side invoke executor。 | 需要部署后 secret scan/log review。 | 未闭环。 |
| `@remote-codex/thread-ui` boundary | control-plane session page 已只 import package public exports。 | 仍是 workspace link，不是版本化依赖。 | 部分完成。 |

当前可以认为“代码方向和本地测试已经足够支持进入 staging smoke”，但不能认为“全链路已经完成”。

## 非目标

不要做这些接入方式：

- frontend direct Harness with `INACT_X_APP_KEY`
- prompt/system prompt 注入 raw key
- route token 携带 Harness key
- plugin settings 里配置 Harness key
- workspace/session/thread 级 Harness key
- control-plane overview 变成 arbitrary tool executor
- 当前分支复制 main thread timeline/composer/settings/plugin manager 源码
- worker runtime 下 MCP 失败后静默 fallback 到 direct Harness

## 接入方案取舍

### 采用的方案

采用 `control-plane provisioning + sandbox-scoped Secret + worker-local Harness API + managed MCP tools + thread-ui artifact rendering`。

具体边界：

```text
control-plane API
  owns Harness admin credential
  ensures user/key
  writes Kubernetes Secret data[<sandboxId>]
  records non-secret key metadata and usage events

sandbox worker
  receives INACT_X_APP_KEY through env secretKeyRef
  exposes /api/harness/* as local runtime API
  invokes Harness with X-Api-Key internally
  records usage through internal control-plane sync

agent runtime
  uses managed MCP tools
  receives tool descriptions/model hints, not secrets
  emits non-secret artifacts

browser/thread UI
  renders status, usage, timeline, artifact cards
  never sees raw Harness key
```

采用理由：

- 和现有 sandbox lifecycle 一致：key 在 sandbox start/restart 时 reconcile。
- 和现有 LLM gateway secret injection 形态一致：credential 从 K8s Secret 进 worker env。
- 和现有 plugin/MCP 体系一致：agent 通过 tools 获得能力，UI 通过 artifact/timeline 展示结果。
- 审计链路完整：control-plane 仍然拥有 user/sandbox/workspace/session/thread attribution。
- 安全边界清楚：raw key 不进入 browser、prompt、route token、settings、artifact 或日志。

### 明确不采用的方案

| 方案 | 不采用原因 |
| --- | --- |
| 前端直连 Harness 并带 `INACT_X_APP_KEY` | raw key 会进入 browser，可被用户、扩展、日志、network tooling 看到，不符合 secret boundary。 |
| 前端直连 Harness 但不带 key | Harness runtime routes 需要 `X-Api-Key`，否则无法做 per-sandbox auth/billing；如果改成 public CORS，会破坏访问控制。 |
| 把 key 注入 system prompt/model hint | prompt/thread 可能被展示、导出、总结、转发，也会让模型有机会打印 secret。 |
| route token 携带 Harness key | route token 是 browser 可见 credential，scope 是路由访问，不应升级为第三方服务 API key。 |
| plugin settings 里保存 Harness key | plugin settings 是用户/前端可管理配置，不适合存 raw runtime credential。 |
| workspace/session/thread scoped Harness key | 会造成大量 key lifecycle、rotation、revocation 和 billing 复杂度；真实资源是 sandbox worker。 |
| control-plane overview 做任意 tool executor | 会绕过 agent/tool 工作流，也容易把 UI 做成第二套 chemistry IDE；phase one 只保留状态和发现。 |
| 当前分支 fork main thread UI 源码 | 后续 main UI 更新会持续产生代码差异；应通过 `@remote-codex/thread-ui` public API 消费。 |
| worker runtime MCP fallback 到 direct Harness | 会绕过 worker API 的 quota、usage attribution、redaction 和 source proof；production 必须失败而不是静默绕行。 |

### 可接受的例外

- local dev/outside-worker 场景可以允许 direct Harness fallback，用于独立调试 MCP 脚本。
- control-plane API 可以通过 sandbox router proxy 读取 worker `/api/harness/*`，但这只是 browser 到 worker 的受控转发，不是 control-plane 持 runtime key 代调 Harness。
- Harness base URL、module/tool/run metadata、`keyPresent` 这类非敏感状态可以展示给前端。

## 最优接入方式

### 1. 保持 Secret 只在 worker runtime

`INACT_X_APP_KEY` 的唯一来源：

```text
control-plane admin ensure/rekey
  -> Kubernetes Secret data[<sandboxId>]
  -> worker env secretKeyRef
  -> WorkerHarnessClient
```

需要继续通过 secret scan 和 smoke 证明：

- frontend/thread-ui 没有 raw key。
- public API 没有 raw key。
- MCP result 没有 raw key。
- logs 没有 raw key。

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

workspace/session/thread 只做 attribution，不决定 key ownership。

创建/resume session 前要求 sandbox running 是合理的，因为：

- session resume 需要 worker thread。
- Harness key 注入发生在 worker 启动。
- worker 不 running 时没有 `/api/harness/*` runtime surface。

### 3. 用统一 plugin 管理

Harness plugin 应通过：

- built-in plugin manifest
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

生产验收必须看到：

```json
{
  "source": "worker-api"
}
```

direct Harness fallback 只保留给 local dev/outside-worker。worker runtime 下如果 worker API 不可用，应失败并暴露 redacted error。

### 5. Artifact 先 generic，后 custom renderer

Phase one：

- molecule: `chemistry.molecule3d`
- Harness run: `elagente.harness.run`
- Harness file/artifact: `elagente.harness.artifact`
- 使用 thread-ui fallback artifact card

Phase two：

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

### 7. 让 `@remote-codex/thread-ui` 真正可升级

当前 `workspace:*` 已经让代码边界清晰，但 main 更新后当前分支仍然要同步 package 源码。为了达到“后续 main 更新 UI 当前分支不需要代码层面更新”的目标，推荐后续在 main 完成以下任一方案。

首选方案：发布/版本化 package。

- `@remote-codex/thread-ui` 取消 `private: true` 或发布到私有 registry。
- 当前分支依赖具体 semver，例如 `^0.2.0`。
- main 更新 thread UI 后发布新版本。
- 当前分支只更新 package version 和 lockfile。

备选方案：git tag/package tarball。

- main branch 打 tag 或构建 package artifact。
- 当前分支依赖 git tag 或 tarball URL。
- 更新时只切 tag/version。

保守方案：继续 workspace package。

- 当前分支每次从 main 合并 `packages/thread-ui` 变更。
- 仍然要求 supervisor-web 不直接改 thread UI internals。
- 成本比版本化依赖高，但比源码复制清楚。

## 分阶段计划

### Phase A: 本地代码边界锁定

目标：证明当前分支保持 clean boundary。

任务：

- [x] `ControlPlaneSessionPage` 使用 `@remote-codex/thread-ui` 的 `ThreadDetailSurface`。
- [x] `AppShellNavContext` 由 `@remote-codex/thread-ui` 单一来源提供。
- [x] `remote-codex.elagente-harness` manifest 不含 key/admin credential。
- [x] `remote_codex_plugins` 在 worker runtime 下优先走 worker-local API。
- [x] frontend/thread-ui 无 raw `INACT_X_APP_KEY` 泄漏路径。
- [x] `Prompt sent. Waiting for worker updates...` 不作为正式 UI message 出现。
- [ ] 决定 `@remote-codex/thread-ui` 的版本化路径：private registry、git tag/tarball，或继续 workspace merge。

验证命令：

```bash
rg -n "INACT_X_APP_KEY|ELAGENTE_HARNESS_ADMIN_KEY|keyCiphertext|apiKey" apps/supervisor-web packages/thread-ui
rg -n "LocalAppShellNavContext|SharedAppShellNavContext|AppShellNavContext = createContext|createContext<AppShellNavContextValue" apps/supervisor-web/src packages/thread-ui/src -S
rg -n "Prompt sent|Waiting for worker updates" apps/supervisor-web/src packages/thread-ui/src -S
node --check bin/remote-codex-plugin-mcp.mjs
pnpm --filter @remote-codex/supervisor-web typecheck
pnpm --filter @remote-codex/supervisor-api typecheck
pnpm --filter @remote-codex/control-plane-api typecheck
```

### Phase B: Harness production admin contract smoke

目标：证明线上 Harness planned admin routes 能用真实 `ADMIN_KEY` 返回 Remote Codex 需要的 JSON shape。

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

### Phase C: Remote Codex deployment env

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

### Phase D: Deployed worker smoke

目标：真实 running sandbox worker 能用注入的 `INACT_X_APP_KEY` 调 Harness。

命令：

```bash
STAGING_HARNESS_SMOKE=1 \
STAGING_HARNESS_MODULE=farmaco \
STAGING_HARNESS_INVOKE_TOOL=<low-cost tool> \
STAGING_HARNESS_INVOKE_INPUT_JSON='<json object>' \
STAGING_HARNESS_MCP_SMOKE_COMMAND='<command that prints {"source":"worker-api"}>' \
STAGING_HARNESS_THREAD_ARTIFACT_UI_SMOKE_COMMAND='<command that prints {"artifactTypes":["elagente.harness.run"]}>' \
STAGING_CONTROL_PLANE_BASE_URL=<control-plane base url> \
STAGING_PRODUCT_JWT=<product jwt> \
pnpm smoke:staging-phase-one
```

只设置 `STAGING_HARNESS_SMOKE=1` 可以验证 worker status/home/discovery 这类局部路径，
但完整 release evidence 必须同时提供低成本 invoke、MCP worker-api proof 和 thread
artifact UI proof 命令。

需要证明：

- [ ] `/api/worker/metadata` 显示 Harness enabled、chemistry enabled、key present。
- [ ] `/api/sandbox/harness/status` 返回 configured/ready 状态。
- [ ] `/api/sandbox/harness/home` 能返回 Harness root discovery。
- [ ] `/api/sandbox/harness/me` 能访问 Harness `/members/.me`。
- [ ] `/api/sandbox/harness/modules/:module/help` 或 `tools` 可用。
- [ ] worker error response 不包含 `INACT_X_APP_KEY`。

### Phase E: Codex MCP smoke

目标：真实 Codex thread 通过 managed MCP 使用 Harness，且 production path 是 worker API。

需要证明：

- [ ] Settings/plugin manager 中 `remote-codex.elagente-harness` enabled。
- [ ] Codex 能发现 `harness_status`、`harness_home`、`harness_help`、`harness_list_tools`、`harness_invoke_tool`。
- [ ] `harness_status` 返回 `source: worker-api`。
- [ ] `harness_home` 通过 worker-local `/api/harness/home` 成功。
- [ ] `harness_help` 或 `harness_list_tools` 成功。
- [ ] 一个低成本 `harness_invoke_tool` 成功。
- [ ] MCP result 不包含 `INACT_X_APP_KEY`。

失败判定：

- `harness_status` 返回 `source: direct-harness`，production smoke 不通过。
- worker API 不可用时 MCP 静默 fallback 到 direct Harness，production smoke 不通过。

### Phase F: Usage / quota / audit live proof

目标：证明真实 Harness tool call 能进入 usage/audit。

需要证明：

- [ ] low-cost `harness_invoke_tool` 后 `GET /api/usage/harness/summary` 变化。
- [ ] `GET /api/usage/harness/events` 能看到 module/tool/run/job/status。
- [ ] event metadata 不含 raw key。
- [ ] expensive estimate 会被 quota preflight 阻断。
- [ ] Harness production `/admin/usage/export` 可被 control-plane import。
- [ ] duplicate `provider + externalEventId` 不重复计费。

### Phase G: Thread UI / artifact live proof

目标：真实 thread timeline 能显示 Harness artifact。

需要证明：

- [ ] molecule-shaped result 显示 `chemistry.molecule3d` / XYZ renderer。
- [ ] generic run/job result 显示 `elagente.harness.run` fallback card。
- [ ] generic artifact/file result 显示 `elagente.harness.artifact` fallback card。
- [ ] artifact payload 只包含 module/tool/run/job/status/download route 等 non-secret metadata。
- [ ] 如果 fallback card 不够用，先在 main `@remote-codex/thread-ui` 或 plugin frontend module 中加 renderer，再升级当前分支依赖。

### Phase H: Provider parity

目标：决定是否让 Claude/OpenCode 等 provider 同样使用 Harness。

当前状态：

- Codex managed MCP config 路径已实现。
- Claude/OpenCode equivalent MCP config 仍未证明。
- worker startup tests 已覆盖 provider config 不包含 `INACT_X_APP_KEY`。

任务：

- [ ] 明确 Claude/OpenCode 的 MCP/tool config 写入方式。
- [ ] 确保它们也调用 worker-local `/api/harness/*`。
- [ ] 确保 provider config/MCP config 不写 raw key。
- [ ] 跑 provider-specific live smoke。

如果暂不支持，产品上应明确标注 Harness tools phase one 只保证 Codex。

### Phase I: 依赖形态收敛

目标：实现“后续 main 更新 UI 当前分支不需要代码层面更新”。

推荐任务：

- [ ] 在 main branch 把 `@remote-codex/thread-ui` 做成可版本化 package。
- [ ] 当前分支从 `workspace:*` 迁移到 semver/git tag/tarball 依赖。
- [ ] supervisor-web 只 import public exports，不 import package internals。
- [ ] 如果需要新 UI slot/renderer/settings 能力，在 main package 增加 public API。
- [ ] 当前分支升级 package 后只改 adapter 数据，不改 thread UI 源码。

推荐落地顺序：

1. 在 main branch 确认 `packages/thread-ui` 的 public exports 覆盖当前分支需要的全部能力：
   - `ThreadDetailSurface`
   - `ThreadComposer` props/types
   - `ThreadTimeline` props/types
   - `PluginProvider`
   - `usePlugins`
   - `AppShellNavContext`
   - `AppShellMenuButton`
   - `AppShellNavigationMenu`
   - `AppShellSettingsDialog`
   - artifact/inline renderer extension points
2. 当前分支禁止 import `packages/thread-ui/src/...` 内部路径，只允许 import `@remote-codex/thread-ui`。
3. 如果 control-plane session 需要新能力，例如 workspace/session selector slot、shell adapter slot、Harness artifact renderer slot、settings plugin management slot，先在 main package 增加 public prop/export。
4. main 发布新 package 版本或 tag。
5. 当前分支只更新 dependency version/lockfile，并补 adapter 层数据映射。

依赖方式建议：

| 方式 | 优点 | 缺点 | 建议 |
| --- | --- | --- | --- |
| private npm registry semver | 最接近标准 package 依赖，后续只升级版本。 | 需要 registry/auth/publish pipeline。 | 首选。 |
| git tag dependency | 不需要 registry，能锁定 main 某个 tag。 | 安装速度和 lockfile 可控性略差；需要 tag 管理。 | 可作为过渡。 |
| tarball artifact URL | 锁定构建产物，避免源码 workspace merge。 | 需要 artifact hosting。 | 可用于 CI/CD 可控场景。 |
| workspace `workspace:*` | 本地开发最简单。 | main 更新仍要同步 package 源码。 | 仅作为短期过渡。 |

验收标准：

- `apps/supervisor-web/package.json` 不再依赖 `workspace:*` 时，当前分支才真正达到“后续 main UI 更新只需升级 package”。
- 当前分支没有对 `packages/thread-ui` 的分支专用 patch。
- 所有新增 UI extension 都在 main package public API 中表达。

## Evidence Gate

不能只靠本地测试宣称闭环。最终必须有 live evidence：

- [ ] authenticated Harness production admin smoke passed。
- [ ] Remote Codex deployed env 设置完成，`ELAGENTE_HARNESS_LEGACY_ADMIN_FALLBACK=false`。
- [ ] K8s Secret/RBAC smoke passed。
- [ ] real sandbox worker metadata shows `keyPresent: true`。
- [ ] real worker `/api/harness/home/status/me/help/tools` passed。
- [ ] combined verifier includes `harness-secret-safety` and K8s Secret smoke proves Secret data values were not printed。
- [ ] real Codex MCP `harness_status` returns `source: worker-api`。
- [ ] low-cost `harness_invoke_tool` returns result and records usage。
- [ ] usage evidence proves workspace/session attribution and usage event count increase。
- [ ] live thread UI shows Harness artifact card, and evidence details include at least one Harness artifact type。
- [ ] `pnpm verify:harness-integration-evidence` over real evidence returns `ok: true`。
- [ ] `pnpm verify:harness-evidence-review` over non-secret review returns `ok: true`。
- [ ] secret scans show no key leakage。

推荐采集命令：

```bash
pnpm verify:harness-evidence-env
pnpm verify:harness-evidence-env -- --write-env-template ./.temp/harness-evidence/harness.env.sh
source ./.temp/harness-evidence/harness.env.sh
pnpm collect:harness-integration-evidence -- --output-dir ./.temp/harness-evidence/latest
pnpm verify:harness-integration-evidence -- <real evidence paths>
pnpm verify:harness-evidence-review -- --review ./.temp/harness-evidence/evidence-review.json
```

## 最小闭环路径

为了避免同时推进太多 UI/worker/provider 事项，推荐最小闭环只验证 Codex + farmaco low-cost tool：

1. 用真实 Harness `ADMIN_KEY` 跑 authenticated admin smoke。
2. 给 control-plane API 配置 Harness env，`ELAGENTE_HARNESS_LEGACY_ADMIN_FALLBACK=false`。
3. 创建或重启一个 sandbox，使 control-plane 写入 `ELAGENTE_HARNESS_APP_KEY_SECRET_NAME` 的 `data[<sandboxId>]`。
4. 通过 staging smoke 验证 worker `/api/harness/status`、`/api/harness/home`、`/api/harness/modules/farmaco/tools`。
5. 在 Codex thread 里调用 `harness_status`，确认 `source: worker-api`。
6. 调用一个低成本 farmaco tool，例如能返回小型 molecule/run payload 的工具。
7. 确认 thread timeline 至少出现一个：
   - `chemistry.molecule3d`
   - `elagente.harness.run`
   - `elagente.harness.artifact`
8. 确认 `GET /api/usage/harness/summary` 的 event count 增加。
9. 确认 event 里有 workspace/session attribution。
10. 运行 combined verifier 和 non-secret review verifier。

这条路径通过后，才继续做：

- Claude/OpenCode provider parity。
- 更漂亮的 Harness custom artifact renderer。
- control-plane overview 更丰富的 Harness metadata UI。
- `@remote-codex/thread-ui` private registry/git tag dependency migration。

## 执行注意事项

- 不要为了让 smoke 快速通过而把 `REMOTE_CODEX_ALLOW_DIRECT_HARNESS_FALLBACK=1` 开到 production worker。production worker 必须以 `source: worker-api` 作为证据。
- 不要把 Harness app key 写进 MCP config。MCP config 只写 server command/args 和 enabled plugin ids。
- 不要在 artifact payload 里保存 full request headers、env snapshot、route token 或 raw Harness response 中的 secret-like fields。
- 不要把 control-plane overview 的 Harness module tools list 做成直接执行按钮，除非后续专门设计受控 job submission UI 和权限/审计模型。
- 不要在多 running thread 时猜测 attribution；当前代码只允许 single running thread fallback，这是合理的保守策略。
- 不要把 local test fixture 中的 `harness-key-secret` 当作真实 secret leak 证据；真实 secret scan 要针对 deployment env、logs、frontend bundle、API response 和 thread transcript。
- 不要把 `keyPresent: true` 理解为 key value 可见；它只能作为 runtime readiness 状态。
- 不要在当前分支 patch `@remote-codex/thread-ui` 私有实现来修 UI 缺口；缺口应进入 main package public API。

## 下一步建议

按优先级：

1. 拿到真实 Harness `ADMIN_KEY`，跑 authenticated admin smoke。
2. 配置 Remote Codex control-plane API Harness env，尤其是 `ELAGENTE_HARNESS_LEGACY_ADMIN_FALLBACK=false`。
3. 跑 K8s Secret/RBAC smoke。
4. 启动真实 sandbox，跑 worker `/api/harness/home/status/me/help/tools` smoke。
5. 在真实 Codex thread 中跑 `harness_status`，确认 `source: worker-api`。
6. 跑一个低成本 `harness_invoke_tool`，确认有回复、usage event、artifact card。
7. 决定 `@remote-codex/thread-ui` 版本化路径，减少后续 main UI 更新的集成成本。
