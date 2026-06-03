# ElAgenteHarness 最优接入计划

本文档基于 2026-06-03 对当前 `sandbox-worker-control-plane` 分支、`@remote-codex/thread-ui`、以及本地 `/home/u/dev/ElAgente/harness/ElAgenteHarness` 的源码通读。目标是把 ElAgenteHarness 作为 sandbox worker 的受控计算化学能力接入 Remote Codex，而不是新增一套前端直连服务、prompt key 注入方案，或当前分支私有 thread UI fork。

更细的历史实施记录见：

- [ElAgenteHarness Control Plane Integration Plan](./elagente-harness-control-plane-integration-plan.zh.md)
- [ElAgenteHarness Integration Architecture Plan](./elagente-harness-integration-architecture-plan.zh.md)

## 一句话结论

最优雅的边界是：

```text
browser
  -> Remote Codex frontend
  -> control-plane API
  -> sandbox router / worker internal API
  -> worker-local Harness client / managed MCP tools
  -> ElAgenteHarness
```

## 本轮复核结论

本轮在 2026-06-03 重新通读了当前分支的 control-plane、worker、MCP、plugin、thread UI 接入点，以及本地 Harness 仓库 `/home/u/dev/ElAgente/harness/ElAgenteHarness` 的 admin/user/tool routes。结论是：当前分支的总体设计方向已经正确，下一步不应该改成前端直连 Harness，也不应该把 `INACT_X_APP_KEY` 注入 prompt 或 plugin settings。最佳方案是继续把 Harness 作为 sandbox worker 的受控能力，由 control-plane 负责 key provisioning、Secret 写入、quota/audit/usage，由 worker 暴露受控 local API，再由 managed MCP tools 给 Codex 等 agent 使用。

当前已经实现到代码层面的部分：

- control-plane 能解析 Harness admin/runtime 配置，并在 chemistry tools enabled 时 fail fast。
- sandbox start/restart/bootstrap 前会执行 Harness user/key ensure 或 rotate，并把 raw app key 写入 K8s Secret。
- worker pod env 只通过 Secret 注入 `INACT_X_APP_KEY`，普通 env 只注入 non-secret Harness base URL 和 chemistry enabled flag。
- worker 启动时会校验 chemistry enabled 场景下必须存在 `ELAGENTE_HARNESS_BASE_URL` 和 `INACT_X_APP_KEY`。
- worker-local `/api/harness/*` 已封装 health、me、help、tools、runs、artifacts、download、invoke。
- managed MCP `remote_codex_plugins` 已提供 `harness_status`、`harness_help`、`harness_list_tools`、`harness_invoke_tool`。
- MCP 生产优先路径已经是 worker-local API；direct Harness fallback 只应作为非 worker 本地调试兼容。
- `remote-codex.elagente-harness` built-in plugin 已声明 model hint、MCP server、generic Harness artifact types。
- `ControlPlaneSessionPage` 已使用 `@remote-codex/thread-ui` 的 `ThreadDetailSurface`，没有重新实现聊天 UI。
- Control Plane overview 的 Harness 区块是 read-only operator/status surface，代码里没有前端 arbitrary invoke executor。
- Harness 本体已在本地和生产未认证探测层面看到 planned admin routes 存在，生产 authenticated JSON smoke 仍待跑。

当前还不能算闭环的部分：

- 没有真实 Harness `ADMIN_KEY` 的 authenticated production admin smoke。
- Remote Codex staging/prod 的 Harness env、K8s Secret/RBAC、worker Secret injection 还没有 live evidence。
- 真实 Codex thread 的 `harness_status` 尚未证明返回 `source: worker-api`。
- 低成本 `harness_invoke_tool` 尚未在真实 deployed worker 中证明能返回结果并写入 usage/audit。
- thread UI 尚未用 live Harness run/artifact 证明 molecule/generic artifact card 实际渲染。
- Harness admin legacy 404 fallback 仍在 `HttpHarnessAdmin` 中保留，代码兼容合理；当前代码已支持用 `ELAGENTE_HARNESS_LEGACY_ADMIN_FALLBACK=false` 显式禁用，生产仍需配置并用 authenticated smoke 验证。

因此最优推进方式不是大改 UI，也不是重写 Harness client，而是按下面的 live-gated checklist 推进：先验证 Harness admin contract，再配置 Remote Codex 部署环境，再跑 worker-local MCP 和 artifact/usage smoke，最后收敛掉 legacy fallback 和补足 provider parity。

`INACT_X_APP_KEY` 只应存在于：

- Kubernetes Secret
- sandbox worker env
- worker 内部 Harness HTTP client 调用栈

不应存在于：

- browser
- route token payload
- plugin settings
- thread prompt
- thread message
- artifact metadata
- frontend bundle
- control-plane public API response
- worker logs

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
- [bin/remote-codex-plugin-mcp.mjs](/home/u/dev/remoteCodex/bin/remote-codex-plugin-mcp.mjs)
- [packages/plugin-elagente-harness/src/manifest.ts](/home/u/dev/remoteCodex/packages/plugin-elagente-harness/src/manifest.ts)
- [packages/thread-ui/src/ThreadDetailSurface.tsx](/home/u/dev/remoteCodex/packages/thread-ui/src/ThreadDetailSurface.tsx)
- [packages/thread-ui/src/plugins/PluginProvider.tsx](/home/u/dev/remoteCodex/packages/thread-ui/src/plugins/PluginProvider.tsx)
- [apps/supervisor-web/src/pages/ControlPlanePage.tsx](/home/u/dev/remoteCodex/apps/supervisor-web/src/pages/ControlPlanePage.tsx)
- [apps/supervisor-web/src/pages/ControlPlaneSessionPage.tsx](/home/u/dev/remoteCodex/apps/supervisor-web/src/pages/ControlPlaneSessionPage.tsx)

ElAgenteHarness 本地源码：

- [/home/u/dev/ElAgente/harness/ElAgenteHarness/src/elagente_harness/server.py](/home/u/dev/ElAgente/harness/ElAgenteHarness/src/elagente_harness/server.py)
- [/home/u/dev/ElAgente/harness/ElAgenteHarness/src/inact/inact/apps/workspace/register.py](/home/u/dev/ElAgente/harness/ElAgenteHarness/src/inact/inact/apps/workspace/register.py)
- [/home/u/dev/ElAgente/harness/ElAgenteHarness/src/elagente_harness/compute_job/compute_job.py](/home/u/dev/ElAgente/harness/ElAgenteHarness/src/elagente_harness/compute_job/compute_job.py)
- [/home/u/dev/ElAgente/harness/ElAgenteHarness/tests/test_server.py](/home/u/dev/ElAgente/harness/ElAgenteHarness/tests/test_server.py)
- [/home/u/dev/ElAgente/harness/ElAgenteHarness/tests/test_compute_job_storage.py](/home/u/dev/ElAgente/harness/ElAgenteHarness/tests/test_compute_job_storage.py)

## 当前真实状态

### Remote Codex 侧已实现

Control-plane 配置已经支持：

- `ELAGENTE_HARNESS_BASE_URL`
- `ELAGENTE_HARNESS_PROVIDER`
- `ELAGENTE_HARNESS_APP_KEY_SECRET_NAME`
- `ELAGENTE_HARNESS_ADMIN_BASE_URL`
- `ELAGENTE_HARNESS_ADMIN_KEY`
- `REMOTE_CODEX_CHEMISTRY_TOOLS_ENABLED`

仍建议新增或确认的生产配置：

- `ELAGENTE_HARNESS_LEGACY_ADMIN_FALLBACK=false`

这个变量已经在代码里实现。它的意义是让生产环境在 Harness planned JSON admin contract 不可用时直接失败，而不是继续 fallback 到旧 `/admin/create`、`/admin/<id>/rekey`、`/admin/<id>/delete` 兼容路径。短期保留 fallback 对本地和迁移阶段有价值；长期生产应显式使用 planned routes，避免 idempotency、external id、Secret 恢复语义被旧接口稀释。

设计判断：

- 这些变量放在 control-plane API 部署环境中是正确的。
- `ELAGENTE_HARNESS_ADMIN_KEY` 只用于 control-plane provisioning，不应进入 worker。
- `ELAGENTE_HARNESS_BASE_URL` 可以进入 worker，因为它不是 secret。
- `REMOTE_CODEX_CHEMISTRY_TOOLS_ENABLED=true` 时要求 `ELAGENTE_HARNESS_BASE_URL` 存在是正确的 fail-fast。

Sandbox lifecycle 已实现：

```text
sandbox start/restart/bootstrap
  -> ensure Harness user
  -> ensure or rotate sandbox-scoped Harness key
  -> write K8s Secret key data[<sandboxId>]
  -> persist non-secret key metadata
  -> start worker with env from Secret
```

DB 已实现：

- `control_harness_users`
- `control_harness_keys`
- `control_harness_usage_events`

当前 DB 只保存 external ids、status、Secret binding、rotation/revocation timestamps、usage events 和 nullable `key_ciphertext`。phase-one 里 raw key 的 runtime source of truth 是 K8s Secret；如果未来需要 DB 侧恢复 raw key，必须先接 KMS/envelope encryption。

Worker env 注入已实现：

```text
ELAGENTE_HARNESS_BASE_URL=<configured base url>
REMOTE_CODEX_CHEMISTRY_TOOLS_ENABLED=true|false
INACT_X_APP_KEY=<from Kubernetes Secret data[<sandboxId>]>
```

Worker startup validation 已实现：

- chemistry enabled 时要求 `ELAGENTE_HARNESS_BASE_URL` 和 `INACT_X_APP_KEY`。
- worker metadata 只暴露 `enabled`、`baseUrl`、`keyPresent`、`chemistryToolsEnabled`、`modules`、`health`，不暴露 key。
- error/log redaction 覆盖 `INACT_X_APP_KEY`、`ELAGENTE_HARNESS_ADMIN_KEY`、`keyCiphertext` 等敏感字段。

Worker Harness API 已实现：

- `GET /api/harness/status`
- `GET /api/harness/me`
- `GET /api/harness/modules/:module/help`
- `GET /api/harness/modules/:module/tools`
- `GET /api/harness/modules/:module/runs`
- `GET /api/harness/modules/:module/runs/:runId`
- `GET /api/harness/modules/:module/runs/:runId/artifacts`
- `GET /api/harness/modules/:module/runs/:runId/download.zip`
- `POST /api/harness/modules/:module/tools/:tool/invoke`

约束已经合理：

- module allowlist: `estructural`, `quntur`, `farmaco`
- tool name URL-safe
- run id URL-safe
- invoke body 必须是 JSON object
- `X-Api-Key` 只由 worker client 添加
- worker-side errors 会 redact app key

Managed MCP/plugin 已实现：

- built-in plugin `remote-codex.elagente-harness`
- managed MCP server `remote_codex_plugins`
- MCP tools:
  - `harness_status`
  - `harness_help`
  - `harness_list_tools`
  - `harness_invoke_tool`
- `REMOTE_CODEX_ENABLED_PLUGIN_IDS` gating
- plugin `modelHints`

设计判断：

- 让 agent 通过 MCP tool 使用 Harness 是正确入口。
- `modelHints` 可以注入工具使用说明，但不能注入 credential。
- MCP config 不应写 `INACT_X_APP_KEY`。
- 生产路径应优先并成功使用 worker-local API：`remote_codex_plugins MCP -> http://127.0.0.1:$PORT/api/harness/*`。
- 当前 direct Harness fallback 已收紧为 dev/outside-worker 兼容。worker runtime 或显式 worker API base URL 场景下，worker API 不可用不会静默 fallback 到直连 Harness；非 worker 本地调试如需允许该 fallback，必须显式设置 `REMOTE_CODEX_ALLOW_DIRECT_HARNESS_FALLBACK=true`。

Control-plane overview 已实现：

- account Harness usage summary/events
- Harness readiness panel
- key present 非敏感状态
- chemistry enabled 状态
- module selector
- tools list
- recent runs
- unavailable/degraded state

设计判断：

- overview 是 operator/status surface，不应成为 arbitrary chemistry tool executor。
- 真正的 chemistry invocation 应发生在 thread agent MCP tool 中，或未来另做受控 job submission UI。

`@remote-codex/thread-ui` 边界已实现：

- `ControlPlaneSessionPage` 使用 `ThreadDetailSurface`。
- timeline/composer/settings/plugin provider/app shell navigation 来自 `@remote-codex/thread-ui`。
- `ControlPlaneSessionPage` 只做 control-plane session lookup、route token、worker thread adapter、session metadata。

设计判断：

- 当前方向正确。
- 后续如果 settings、hamburger、plugin slot、timeline renderer 缺能力，应在 main branch 的 `packages/thread-ui` 补 adapter/slot，再由当前分支升级包。
- 当前分支不应复制 main branch thread UI 源码，也不应维护本地 thread UI fork。

### Harness 侧已实现但仍缺 authenticated production smoke

本地 `/home/u/dev/ElAgente/harness/ElAgenteHarness/src/inact` submodule 已经实现 planned admin contract：

- `agents.external_id TEXT NOT NULL DEFAULT ''`
- partial unique index: `external_id != ''` 时唯一
- `AgentRegistry.ensure_by_external_id(...)`
- `AgentRegistry.get_by_external_id(...)`
- `AgentRegistry.regenerate_key_external(...)`
- `AgentRegistry.force_delete_external(...)`
- `AgentRegistry.export_usage_events(...)`

本地 Harness admin routes 已实现：

- `POST /admin/members/ensure`
- `POST /admin/members/reconcile`
- `POST /admin/members/<externalKeyId>/rekey`
- `POST /admin/members/<externalKeyId>/revoke`
- `GET /admin/usage/export`

旧 routes 仍保留：

- `POST /admin/create`
- `GET /admin/list`
- `POST /admin/<id>/rekey`
- `POST /admin/<id>/delete`
- `POST /admin/<id>/update`

本地测试已经证明：

- `/admin/members/ensure` 对同一 `externalId` 是幂等的。
- `rekey/revoke/reconcile` 支持 Remote Codex stable external id。
- `/admin/usage/export` 能把 `compute_job_usage` / `agent_billing_events` 映射为 Remote Codex 可导入的 usage shape。

当前已完成：

- `src/inact` 已提交并推送到 `remote-codex-admin-contract`，commit 为 `d2f3cbe1eff7879751b77278f23f24f22f2014c5`。
- Harness 主仓库 `main` 已提交并推送 commit `bd0c1e16cc995881e551459cdac633b1e2b78adc`。
- Harness Dockerfile `INACT_COMMIT` 已 pin 到包含 planned admin routes 的 inact commit。
- 生产服务 `https://elagenteharness-production.up.railway.app` 的公开未认证探测已经从 `404` 变为 `401 X-Admin-Key required`，说明 routes 已经部署且受 admin key 保护。

仍未完成：

- 没有真实 `ADMIN_KEY`，所以还没有跑过 authenticated production JSON contract smoke。
- 本地 `railway status` 仍显示 OAuth refresh/link 不可用，不能直接通过本机 Railway CLI 验证或改生产环境。
- Harness 主仓库仍有无关 dirty 文件，不应混入 Remote Codex 接入提交：
  - `docs/modules/estructural/tool-runtime-checklist.md`
  - `docs/plans/quntur-tool-ports.active.md`
  - `submodules/`

## 最优架构

### 身份和 credential ownership

phase one 使用 sandbox-scoped Harness key：

```text
Remote Codex user
  -> Remote Codex sandbox
  -> Harness member/key
  -> K8s Secret key: <sandboxId>
  -> worker env INACT_X_APP_KEY
```

推荐 external ids：

```text
externalUserId = remote-codex:user:<userId>
externalKeyId  = remote-codex:sandbox:<sandboxId>
name           = remote-codex-sandbox-<shortSandboxId>
kind           = agent
```

为什么不把 key 绑定到 workspace/session：

- worker env 是 sandbox 级别。
- 一个 sandbox 内可以有多个 workspace/session/thread。
- workspace/session 用于 attribution，不用于 credential ownership。
- 如果 key 随 session 切换，worker env 会变得不可预测。
- sandbox restart 是自然的 key reconcile/rotate 时机。

### Production 调用路径

Agent tool path：

```text
Codex provider runtime
  -> remote_codex_plugins MCP
  -> http://127.0.0.1:$WORKER_PORT/api/harness/*
  -> WorkerHarnessClient
  -> ElAgenteHarness with X-Api-Key
```

Control-plane overview path：

```text
browser
  -> Remote Codex /api/sandbox/harness/*
  -> sandbox router
  -> worker /api/harness/*
  -> WorkerHarnessClient
  -> ElAgenteHarness with X-Api-Key
```

不推荐路径：

```text
browser -> ElAgenteHarness directly with X-Api-Key
prompt  -> contains INACT_X_APP_KEY
plugin settings -> contains INACT_X_APP_KEY
MCP config -> contains INACT_X_APP_KEY
route token -> contains INACT_X_APP_KEY
```

### Usage/quota/audit

Immediate worker usage path：

```text
worker-local Harness invoke
  -> optional quota preflight when estimated cost/compute is provided
  -> Harness call
  -> worker sync posts normalized usage event to control-plane
  -> control_harness_usage_events
  -> account usage summary/events
```

External Harness usage import path：

```text
Harness /admin/usage/export
  -> control-plane scheduled/admin import
  -> idempotent control_harness_usage_events
```

两条路径可以并存，但必须使用 `provider + externalEventId` 幂等。worker immediate event 更适合实时 UI；Harness export 更适合作为最终账单/审计补偿。

### System prompt / model hint 注入

可以做：

- 通过 plugin `modelHints` 告诉 agent 可用工具名和推荐调用顺序。
- 说明 `harness_status`、`harness_help`、`harness_list_tools`、`harness_invoke_tool` 的用途。
- 说明不要询问、打印或尝试读取 `INACT_X_APP_KEY`。
- 说明 ElAgenteHarness/Inact workspace 的工作方式、artifact/runs 的读取方式。

不可以做：

- 把 `INACT_X_APP_KEY` 写入 prompt。
- 把 Harness admin key 写入 prompt。
- 把用户或 sandbox scoped secret 写入 MCP config。
- 让 prompt 注入成为安全边界。安全边界必须是 worker env、tool allowlist、route auth、redaction 和 quota。

## 接入边界判断表

| 部分 | 当前实现 | 是否合理 | 后续最优改法 |
| --- | --- | --- | --- |
| Harness credential ownership | sandbox-scoped key，Secret key 为 sandbox id | 合理 | 保持 sandbox-scoped。workspace/session/thread 只做 attribution，不做 key ownership。 |
| Harness admin credential | control-plane env `ELAGENTE_HARNESS_ADMIN_KEY` | 合理 | 只用于 ensure/rekey/revoke/usage export；继续 redaction，不进入 worker/frontend。 |
| Runtime user credential | `INACT_X_APP_KEY` 由 K8s Secret 注入 worker env | 合理 | 真实 staging 验证 Secret read/write/RBAC；缺 Secret 时 rotate+rewrite。 |
| Browser/frontend | 只通过 Remote Codex control-plane API 和 sandbox proxy 看状态 | 合理 | 继续禁止 browser 直连 Harness with key；overview 保持 operator surface。 |
| Worker Harness API | `/api/harness/*` 封装 Harness calls | 合理 | 继续集中 allowlist、redaction、usage/quota；补真实 staging smoke。 |
| MCP tool surface | `remote_codex_plugins` 提供 `harness_*` tools，优先 worker-local API | 合理 | smoke 必须证明 `source: worker-api`；direct fallback 保持 dev-only。 |
| Plugin manifest | `remote-codex.elagente-harness` 注册 MCP server 和 model hint | 基本合理 | 不在 settings 存 key；如果要 generic artifact timeline，需要在 manifest 声明 artifact type。 |
| Molecule rendering | Harness molecule output 生成 `chemistry.molecule3d` artifact fence，复用 XYZ viewer | 合理 | 保持复用 `remote-codex.xyz-viewer`，不要新增分子 renderer fork。 |
| Generic run/artifact timeline | worker API 已有 normalized records；plugin 已声明 `elagente.harness.run` / `elagente.harness.artifact`；MCP invoke 可输出 generic artifact fence | 基本合理 | 先用 thread-ui fallback 展示 run/job/status/download metadata；live staging thread 通过后再决定是否加 custom renderer。 |
| `@remote-codex/thread-ui` | Control-plane session page 使用 `ThreadDetailSurface` | 合理 | 当前分支只 import package；缺 slot/renderer 时改 main package 后升级，不复制源码。 |
| Usage/quota | immediate worker usage + admin usage export/import 均已实现测试路径 | 合理 | 真实 tool smoke 后确认 user/sandbox/workspace/session/thread/turn attribution。 |
| Claude/OpenCode | 尚未做等价 provider tool wiring | 可后置 | 仍走同一 worker-local API/MCP，不给 provider 单独发 Harness key。 |

### Generic artifact 的推荐设计

当前 molecule artifact 已经可通过 `chemistry.molecule3d` 进入现有 XYZ viewer。通用 Harness run/job/artifact 不应塞进 molecule renderer，也不应改当前分支 thread timeline 源码。

已实现的最小设计：

```json
{
  "type": "remote-codex.artifact",
  "artifactType": "elagente.harness.run",
  "title": "farmaco submit_docking_job run run-123",
  "summaryText": "status: running, artifacts: 2",
  "payload": {
    "module": "farmaco",
    "tool": "submit_docking_job",
    "runId": "run-123",
    "jobId": "42",
    "status": "running",
    "artifactRefs": [
      {
        "title": "farmaco_artifacts.zip",
        "path": "farmaco_artifacts.zip",
        "downloadUrl": "/api/sandbox/harness/modules/farmaco/runs/run-123/download.zip"
      }
    ]
  }
}
```

实施原则：

- 在 `packages/plugin-elagente-harness` manifest 中声明 `elagente.harness.run` 和可选 `elagente.harness.artifact`。
- MCP invoke 对含 run/job/status/artifact metadata 的结果输出 `remote-codex-artifact` fenced block。
- 如果暂时没有 custom renderer，`@remote-codex/thread-ui` 已有 artifact fallback，可以显示 title、summary 和 expandable JSON。
- 如果要更好 UI，应在 main branch `packages/thread-ui` 或该 plugin 的 frontend module 中增加 renderer，然后当前分支升级 `@remote-codex/thread-ui`。
- MCP 输出只写 non-secret normalized metadata 和 control-plane/worker download route，不写 `INACT_X_APP_KEY`。
- 真实 Harness response shape 稳定前，优先保守展示 run id/status/download link，不做复杂 workflow UI。

## 分阶段执行计划

### Phase 0: 保持当前边界干净

目标：确认当前分支没有重新 fork thread UI，也没有把 key 暴露到 browser/prompt/settings。

任务：

- [ ] 保持 `ControlPlaneSessionPage` 只使用 `@remote-codex/thread-ui` 的 `ThreadDetailSurface`。
- [ ] 保持 plugin 管理来自 `@remote-codex/thread-ui` shared settings。
- [ ] 保持 `remote-codex.elagente-harness` 只注册 model hints 和 managed MCP server，不在 manifest/settings 中存 key。
- [ ] 保持 worker-local Harness API 为 MCP 生产优先路径。
- [ ] 保持 browser 只打 Remote Codex API，不直连 Harness。
- [ ] 删除或降级任何把 Harness key 暴露给前端、prompt、settings 的尝试。

验收：

- [ ] `rg -n "INACT_X_APP_KEY|ELAGENTE_HARNESS_ADMIN_KEY|harness-api-key" apps/supervisor-web packages/thread-ui` 无真实 secret 暴露。
- [ ] `ControlPlaneSessionPage` 没有复制 thread timeline/composer/plugin renderer 源码。
- [ ] plugin settings 能显示 Harness plugin，但不显示 key。

### Phase 1: 验证 Harness admin contract

目标：确认生产 Harness 的 planned routes 不只是存在且受保护，还能在真实 admin key 下返回 Remote Codex 需要的 JSON shape。

已完成：

- [x] 只把相关 Harness contract 改动提交到 Harness 主仓库。
- [x] Harness 主仓库 commit `bd0c1e16cc995881e551459cdac633b1e2b78adc` 已推送到 `origin/main`。
- [x] Dockerfile `INACT_COMMIT` 指向包含 planned admin routes 的 inact commit `d2f3cbe1eff7879751b77278f23f24f22f2014c5`。
- [x] 生产服务公开探测显示 planned routes 已部署并受 `X-Admin-Key` 保护。

Harness contract 验收：

- [x] `GET https://elagenteharness-production.up.railway.app/health` 返回 ok。
- [~] `POST /admin/members/ensure` 在生产可用。未认证请求返回 `401 X-Admin-Key required`； authenticated JSON smoke 待跑。
- [ ] 同一 `externalId` 连续 ensure 两次返回同一 `externalKeyId`。
- [ ] `POST /admin/members/:externalKeyId/rekey` 返回新 `apiKey`。
- [ ] `POST /admin/members/:externalKeyId/revoke` 返回 revoked。
- [~] `GET /admin/usage/export?limit=10` 生产 route 存在且受保护； authenticated response shape 待验证。

本地测试建议：

- [x] `/home/u/dev/ElAgente/harness/ElAgenteHarness`: `uv run pytest tests/test_server.py tests/test_compute_job_storage.py -q`
- [x] `/home/u/dev/ElAgente/harness/ElAgenteHarness`: `uv run pytest src/inact/tests/test_workspace_admin.py -q`
- [x] `/home/u/dev/ElAgente/harness/ElAgenteHarness`: `git diff --check -- Dockerfile tests/test_server.py src/inact`

### Phase 2: 配置 Remote Codex 部署环境

目标：control-plane 能在 sandbox start/restart 前生成 scoped Harness key，并写入 K8s Secret。

Remote Codex control-plane API env：

```text
ELAGENTE_HARNESS_BASE_URL=https://elagenteharness-production.up.railway.app
ELAGENTE_HARNESS_ADMIN_BASE_URL=https://elagenteharness-production.up.railway.app
ELAGENTE_HARNESS_ADMIN_KEY=<actual Harness ADMIN_KEY>
ELAGENTE_HARNESS_APP_KEY_SECRET_NAME=<k8s secret name>
ELAGENTE_HARNESS_PROVIDER=elagente-harness
REMOTE_CODEX_CHEMISTRY_TOOLS_ENABLED=true
```

Kubernetes/RBAC 要求：

- [ ] control-plane runtime identity 可以 create/update configured Secret。
- [ ] control-plane runtime identity 可以检查 `data[<sandboxId>]` 是否存在，或文档明确无 read 权限时 start/restart 必须 rotate+rewrite。
- [ ] worker pod env 使用 `secretKeyRef` 注入 `INACT_X_APP_KEY`。
- [ ] Secret name 固定，Secret key 使用 sandbox id。

验收：

- [ ] control-plane start sandbox 时 DB 生成 active `control_harness_keys`。
- [ ] `secret_name = ELAGENTE_HARNESS_APP_KEY_SECRET_NAME`。
- [ ] `secret_key = <sandboxId>`。
- [ ] worker env 中有 `INACT_X_APP_KEY`。
- [ ] worker metadata 只显示 `keyPresent: true`，不显示 key。

### Phase 3: Staging smoke 闭环

目标：真实部署证明全链路可用。

Smoke checklist：

- [ ] 新用户注册/登录不泄漏 Harness key。
- [ ] start/restart sandbox 能 ensure Harness key。
- [ ] K8s Secret 存在 `data[<sandboxId>]`。
- [ ] worker metadata 显示 Harness enabled/keyPresent，但不显示 key。
- [ ] control-plane overview Harness status ready。
- [ ] Codex thread 能调用 `harness_status`，并显示 `source: worker-api`。
- [ ] Codex thread 能调用 `harness_help` 或 `harness_list_tools`。
- [ ] Codex thread 能调用一个低成本 Harness tool。
- [ ] tool 调用后 control-plane 有 Harness usage event。
- [ ] `GET /api/usage/harness/summary` 统计发生变化。
- [ ] frontend bundle/API response/thread message/log scan 不包含 `INACT_X_APP_KEY`。

失败判定：

- 如果 `harness_status` 走 `source: direct-harness`，不能算 production smoke 通过。
- 如果 tool 调用成功但 usage/audit 没记录，只能算 Harness 可达，不能算 Remote Codex 闭环。
- 如果任何 frontend/API response 出现 raw key，必须立即回滚或禁用 chemistry tools。

### Phase 4: 收敛 MCP direct fallback

目标：避免 MCP 生产调用绕过 worker usage/quota/audit。

当前状态：

- MCP 已优先调用 worker-local `/api/harness/*`。
- MCP 仍保留 direct Harness fallback，用于没有 worker API base URL 的 dev/outside-worker。
- worker runtime 和显式 worker API base URL 场景不会自动 direct fallback。

推荐改法：

- [x] 增加生产 guard：runtime role 为 worker 或有 sandbox id 时，direct fallback 不会被使用。
- [x] direct fallback 只允许在 local dev/outside-worker；显式 worker API base URL 失败后的 fallback 需要 `REMOTE_CODEX_ALLOW_DIRECT_HARNESS_FALLBACK=true` 且不在 worker runtime。
- [x] worker API 不可用时不会吞掉真实错误导致生产误判。
- [ ] 可选新增 `packages/harness-client`，让 worker route 和 MCP CLI 复用 module/tool validation、redaction、response parsing。

验收：

- [ ] staging Codex thread 调 `harness_status` 时返回 `source: worker-api`。
- [ ] staging Codex thread 调 `harness_invoke_tool` 后 control-plane 有 usage/audit event。
- [ ] MCP error 不包含 `INACT_X_APP_KEY`。
- [ ] production smoke 不依赖 direct Harness fallback。

### Phase 5: Thread timeline/artifact 正规化

目标：Harness 结果在 main thread UI 中自然显示，不新增本地 thread UI fork。

当前已实现：

- molecule-shaped Harness outputs 可转换为 `remote-codex-artifact` fenced block。
- artifact type: `chemistry.molecule3d`
- 现有 XYZ viewer 可以渲染分子结构。
- worker read-only Harness routes 会保留 raw Harness `payload`/`text`，并附加 normalized records：
  - `normalized.runs[]`
  - `normalized.run`
  - `normalized.artifacts[]`

待做：

- [x] 定义并实现 worker API 的 normalized run/artifact shape：
  - module
  - tool
  - runId
  - jobId
  - status
  - title
  - createdAt/updatedAt
  - artifact refs
- [x] worker API 将 runs/artifacts 正规化，同时继续透传 raw Harness payload。
- [x] thread timeline 可以通过 `elagente.harness.run` / `elagente.harness.artifact` artifact fence 和现有 fallback card 显示 run/job 状态。
- [x] molecule 以外的 artifacts 定义 stable artifact refs 和 download URLs 的最小 normalized metadata。
- [ ] 如果 `@remote-codex/thread-ui` 缺 slot，在 main branch 的 `packages/thread-ui` 增加 adapter/renderer extension，再升级当前分支依赖。

验收：

- [ ] Codex 调用 Harness 返回 XYZ/CIF/PDB 时，thread UI 显示 molecule renderer。
- [~] Harness async run 返回 run id 时，thread UI 能通过 fallback artifact card 显示 run 状态或 artifact link；live staging thread 尚未验证。
- [~] run/artifact preview 已可通过 `@remote-codex/thread-ui` fallback artifact path 进入聊天 UI；custom renderer 仍未做也未要求。
- [ ] 当前分支没有复制 main thread timeline renderer。

### Phase 6: Control-plane overview 保持 operator surface

目标：overview 清楚但不膨胀，不变成 chemistry IDE。

保留：

- account usage
- sandbox readiness
- Harness readiness
- module/tools/runs read-only overview
- degraded state

避免：

- arbitrary tool invocation form
- raw key display
- admin key management
- prompt injection editor
- 另一套 plugin manager

待做：

- [ ] overview 的 Harness panel 只依赖 Remote Codex API。
- [ ] sandbox not running 时所有 worker-backed Harness calls disabled。
- [ ] runs/artifacts 只展示 metadata/download，不直接暴露 key。
- [ ] account menu 里汇总 LLM + Harness usage，不在页面上分散重复。

验收：

- [ ] ControlPlanePage tests 覆盖 not running / running / unavailable / no key leak。
- [ ] staging UI refresh 后状态和真实 worker 一致。

### Phase 7: Claude/OpenCode 等 provider 接入

目标：其它 sandbox agent 使用同一套 Harness capability，不引入第二条 secret 路径。

原则：

- 仍使用 worker env 中的 `INACT_X_APP_KEY`。
- 仍优先通过 worker-local Harness API 或同一 managed MCP server。
- 不给 provider runtime 单独发 Harness admin credential。
- provider-specific config 只记录 tool/MCP 描述，不记录 key。

验收：

- [ ] Claude Code 能发现 approved Harness tools。
- [ ] OpenCode 能发现 approved Harness tools。
- [ ] 两者 tool invocation 都能进入 control-plane usage/audit。
- [ ] provider logs 不含 `INACT_X_APP_KEY`。

## 最优接入实施清单

这份清单按最小风险顺序排列。每一项都应该有代码证据或 live evidence 后再勾选，不要用“本地单测通过”替代真实部署 smoke。

### 0. 保持边界不变

目标：不扩大 secret 暴露面，不新增本地 thread UI fork。

- [x] `ControlPlaneSessionPage` 通过 `@remote-codex/thread-ui` 的 `ThreadDetailSurface` 接入聊天界面。
- [x] `AppShellNavContext` 使用 `@remote-codex/thread-ui` 的 shared context，避免 settings/menu 状态分裂。
- [x] Harness plugin 不在 settings 中保存 key。
- [x] Control-plane overview 只做 status/discovery/usage，不做 arbitrary Harness tool executor。
- [x] MCP tool model hint 只描述工具，不注入 credential。
- [ ] 用 secret scan 证明 frontend bundle、thread message、API response、logs 均不含 `INACT_X_APP_KEY`。

### 1. 固化 Harness admin contract

目标：control-plane 只依赖 planned JSON admin routes。

- [x] Harness repo 已实现 `/admin/members/ensure`。
- [x] Harness repo 已实现 `/admin/members/reconcile`。
- [x] Harness repo 已实现 `/admin/members/<externalKeyId>/rekey`。
- [x] Harness repo 已实现 `/admin/members/<externalKeyId>/revoke`。
- [x] Harness repo 已实现 `/admin/usage/export`。
- [x] 生产未认证探测证明这些 routes 已部署且受 `X-Admin-Key` 保护。
- [ ] 用真实 `ELAGENTE_HARNESS_ADMIN_KEY` 跑 authenticated `pnpm smoke:harness-admin-contract`。
- [ ] 证明同一 `externalId` ensure 两次返回同一 `externalKeyId`。
- [ ] 证明 rekey 返回新 `apiKey`，revoke 返回 revoked。
- [ ] 证明 usage export 返回 Remote Codex 可导入 shape。
- [x] Remote Codex 新增 `ELAGENTE_HARNESS_LEGACY_ADMIN_FALLBACK=false` 配置。
- [ ] staging/prod 设置该配置后仍能通过 admin smoke。

### 2. 配置 Remote Codex control-plane 部署

目标：sandbox start/restart 前能准备 scoped Harness key 并写入 Secret。

需要配置在 control-plane API runtime 的变量：

```text
ELAGENTE_HARNESS_BASE_URL=https://elagenteharness-production.up.railway.app
ELAGENTE_HARNESS_ADMIN_BASE_URL=https://elagenteharness-production.up.railway.app
ELAGENTE_HARNESS_ADMIN_KEY=<real Harness admin key>
ELAGENTE_HARNESS_APP_KEY_SECRET_NAME=<k8s secret name>
ELAGENTE_HARNESS_PROVIDER=elagente-harness
REMOTE_CODEX_CHEMISTRY_TOOLS_ENABLED=true
```

验收：

- [ ] start/restart sandbox 时 `control_harness_users` 有对应 user row。
- [ ] `control_harness_keys` 有 active sandbox key metadata。
- [ ] `secret_name` 等于配置的 `ELAGENTE_HARNESS_APP_KEY_SECRET_NAME`。
- [ ] `secret_key` 等于 sandbox id。
- [ ] K8s Secret 中 `data[<sandboxId>]` 存在，但证据不打印 Secret value。
- [ ] 如果 Secret 丢失，control-plane 会 rotate Harness key 并重写 Secret，或 fail closed。

### 3. 验证 worker runtime

目标：真实 sandbox worker 能拿到 key，并且只暴露非敏感状态。

验收：

- [ ] worker env 有 `ELAGENTE_HARNESS_BASE_URL`。
- [ ] worker env 有 `REMOTE_CODEX_CHEMISTRY_TOOLS_ENABLED=true`。
- [ ] worker env 有 `INACT_X_APP_KEY`。
- [ ] `/api/worker/metadata` 只显示 `harness.keyPresent: true`，不显示 key value。
- [ ] `/api/harness/status` 返回 enabled、baseUrl、keyPresent、chemistryToolsEnabled、modules、health。
- [ ] `/api/harness/me` 通过 worker 内部 `X-Api-Key` 调用 Harness。
- [ ] `/api/harness/modules/:module/tools` 和 `/runs` 能返回 Harness discovery/run data。
- [ ] Harness error response 会 redact app key。

### 4. 验证 managed MCP 和 Codex thread

目标：Codex 在真实 thread 中通过 MCP 使用 Harness，且不绕过 worker path。

验收：

- [ ] thread settings 中能看到 `remote-codex.elagente-harness` plugin。
- [ ] `harness_status` 返回 `source: worker-api`。
- [ ] `harness_help` 能读取 `farmaco`、`quntur` 或 `estructural` help。
- [ ] `harness_list_tools` 能列出 approved tools。
- [ ] `harness_invoke_tool` 能调用一个低成本工具。
- [ ] invoke body 可以携带 `_remoteCodexContext` 的 workspace/session/thread/turn attribution。
- [ ] invoke 后 control-plane 有 usage event。
- [ ] `GET /api/usage/harness/summary` 统计变化。
- [ ] MCP output、thread message、timeline artifact 都不包含 `INACT_X_APP_KEY`。

### 5. 收敛 artifact UI

目标：Harness 输出自然进入现有 `@remote-codex/thread-ui`，不在当前分支 fork timeline。

已实现方向：

- molecule 输出使用 `chemistry.molecule3d`，复用 main 的 XYZ/CIF/PDB renderer。
- generic run 使用 `elagente.harness.run` artifact type。
- generic file 使用 `elagente.harness.artifact` artifact type。
- 当前没有 custom renderer 时使用 thread-ui fallback artifact card。

下一步：

- [ ] 用真实 Harness molecule 输出证明 XYZ viewer 渲染。
- [ ] 用真实 async run 输出证明 generic artifact card 显示 run id、status、artifact link。
- [ ] 如果 fallback card 不够清楚，在 main branch 的 `packages/thread-ui` 或插件 frontend module 增加 renderer extension。
- [ ] 当前分支只升级 `@remote-codex/thread-ui` 包，不复制 renderer 源码。

### 6. Usage、quota、audit 进入可运营状态

目标：Harness 调用能被实时记录，也能由 Harness admin export 补偿导入。

验收：

- [ ] worker-local invoke 会执行 quota preflight。
- [ ] worker-local invoke 成功后写入 `control_harness_usage_events`。
- [ ] `provider + externalEventId` 幂等去重。
- [ ] admin `/usage/export` import 可导入 Harness final usage。
- [ ] usage event metadata 不含 raw key。
- [ ] account menu 中 LLM usage 和 Harness usage 汇总显示。

### 7. Provider parity

目标：Codex、Claude Code、OpenCode 都使用同一条 Harness capability path。

原则：

- 不给 provider-specific config 写 Harness key。
- 不为 Claude/OpenCode 单独引入 Harness credential。
- 仍通过 worker env 和 worker-local MCP/API 使用 Harness。

验收：

- [ ] Claude Code 能发现同一 managed MCP tools。
- [ ] OpenCode 能发现同一 managed MCP tools。
- [ ] 两者调用 Harness 后也能写 usage/audit。
- [ ] provider config files 和 logs 不含 `INACT_X_APP_KEY`。

## 代码改进建议

这些是下一步可以直接分给 coding agent 的工程任务，按优先级排序。

1. 在 staging/prod 设置并验证 `ELAGENTE_HARNESS_LEGACY_ADMIN_FALLBACK=false`。
   - 代码侧配置项已存在。
   - 生产设置后，planned route 404 必须失败。
   - authenticated smoke 必须证明 ensure、rotate、revoke、reconcile 全部走 planned JSON routes。

2. 抽一个小的 shared Harness runtime client。
   - 目标包可命名为 `packages/harness-runtime-client`。
   - worker route 和 MCP script 共用 module allowlist、tool name validation、run id validation、redaction、payload normalization。
   - 这不是当前闭环的前置条件，但能减少 drift。

3. 把 live evidence collector 接到部署流程。
   - 部署后自动或半自动运行 `pnpm collect:harness-integration-evidence`。
   - 证据目录只保存状态、路径、HTTP status、redacted shape，不保存 key。
   - `pnpm verify:harness-integration-evidence` 和 `pnpm verify:harness-evidence-review` 作为上线 gate。

4. 在 main branch 扩展 thread-ui artifact renderer。
   - 只有当 live generic fallback card 不够清楚时再做。
   - renderer 输入必须是 normalized non-secret payload。
   - 当前分支只消费新版本 `@remote-codex/thread-ui`。

5. 明确 local dev 模式。
   - 本地可以允许 direct Harness fallback。
   - worker runtime、staging、production 不允许 fallback 绕过 worker-local API。
   - 文档和 smoke 都必须检查 `source: worker-api`。

## 推荐执行顺序

1. 用 `pnpm smoke:harness-admin-contract` 和真实 `ELAGENTE_HARNESS_ADMIN_KEY` 跑 authenticated Harness production admin contract smoke。
2. 配置 Remote Codex control-plane env 和 K8s Secret/RBAC。
3. 做 staging smoke，优先证明 Secret injection、worker-local MCP、usage/audit。
4. 增加 `ELAGENTE_HARNESS_LEGACY_ADMIN_FALLBACK=false`，让生产只接受 planned Harness admin contract。
5. 做 run/artifact 正规化，全部通过 `@remote-codex/thread-ui` 的 extension/renderer 进入聊天 UI。
6. 最后再考虑 Claude/OpenCode provider 的同能力接入。

## 明确不做

- 不让前端直连 Harness 并持有 `X-Api-Key`。
- 不把 `INACT_X_APP_KEY` 注入 system prompt。
- 不在当前分支复制 main branch 的 thread UI 源码。
- 不新增一套 control-plane plugin manager。
- 不依赖 `/admin/list` 作为长期 reconcile 机制。
- 不让 workspace/session 决定 Harness credential ownership。
- 不把 Harness overview 做成通用任意工具执行器。

## 当前最大风险

1. Harness production 是否已经部署 planned admin/usage contract 尚未验证。
2. Remote Codex staging K8s Secret read/write RBAC 尚未验证。
3. 真实 Codex MCP invocation 尚未证明走 `source: worker-api`。
4. MCP direct fallback 如果误用为生产路径，会绕开部分 usage/quota/audit 设计。
5. run/artifact response shape 未完全稳定，timeline 正规化需要等真实 Harness contract 和真实工具输出。
6. `key_ciphertext` 仍是 nullable phase-one 设计；如果未来要求 DB 恢复 raw key，必须引入 KMS/envelope encryption。

这些风险不改变总体架构。它们只决定下一步应该优先补生产 Harness 部署和 staging smoke，而不是重写 Remote Codex 前端、改变 secret 边界，或 fork `@remote-codex/thread-ui`。
