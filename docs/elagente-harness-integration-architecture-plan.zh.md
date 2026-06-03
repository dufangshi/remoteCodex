# ElAgenteHarness 接入架构和推进计划

本文档用于回答当前分支应该如何最优雅地接入 ElAgenteHarness。它基于当前 `sandbox-worker-control-plane` 分支代码、`@remote-codex/thread-ui` 抽包状态，以及本地 `/home/u/dev/ElAgente/harness/ElAgenteHarness` 的 Harness 源码。

已有实施记录和更细的阶段验收项见 [elagente-harness-control-plane-integration-plan.zh.md](/home/u/dev/remoteCodex/docs/elagente-harness-control-plane-integration-plan.zh.md)。本文档聚焦架构边界、现状判断、风险和下一步 checklist。

## 结论

最优雅的接入方式是把 ElAgenteHarness 当作 sandbox worker 的受控能力，而不是当作前端可以直接调用的第三方服务。

推荐边界：

```text
browser
  -> Remote Codex frontend
  -> control-plane API
  -> sandbox router 或 internal worker endpoint
  -> worker Harness API / managed MCP tool
  -> ElAgenteHarness with sandbox-scoped X-Api-Key
```

不要把 `INACT_X_APP_KEY` 暴露给：

- browser
- route token payload
- thread prompt
- plugin settings UI
- worker logs
- MCP config file

可以暴露给用户的只有非敏感状态：

- Harness base URL
- Harness 是否 enabled
- sandbox key 是否 present
- chemistry tools 是否 enabled
- module/tool 名称和 help 文本
- run/job/artifact 的非敏感 metadata

## 当前已实现的部分

### Control-plane 配置

已实现：

- `ELAGENTE_HARNESS_BASE_URL`
- `ELAGENTE_HARNESS_PROVIDER`
- `ELAGENTE_HARNESS_APP_KEY_SECRET_NAME`
- `ELAGENTE_HARNESS_ADMIN_BASE_URL`
- `ELAGENTE_HARNESS_ADMIN_KEY`
- `REMOTE_CODEX_CHEMISTRY_TOOLS_ENABLED`

合理性判断：

- 这些变量应只配置在 control-plane API 部署环境里。
- `ELAGENTE_HARNESS_ADMIN_KEY` 不应进入 worker。
- `ELAGENTE_HARNESS_BASE_URL` 可以进入 worker，因为它不是 secret。
- `REMOTE_CODEX_CHEMISTRY_TOOLS_ENABLED=true` 时要求 Harness base URL 是合理的，避免启动一个声称有 chemistry tools 但没有 Harness 地址的 worker。

还需要补强：

- staging 环境需要显式记录这些变量的最终值来源。
- `ELAGENTE_HARNESS_ADMIN_BASE_URL` 目前默认等于 base URL，长期可保留，但 docs 里应把 admin URL 和 user URL 分开描述。

### Control-plane Harness admin client

已实现：

- `HarnessAdmin`
- `HttpHarnessAdmin`
- `NoopHarnessAdmin`
- `ensureSandboxKey`
- `rotateSandboxKey`
- `revokeSandboxKey`
- `reconcileSandboxKey`

当前兼容策略：

- 优先尝试 `POST /admin/members/ensure`。
- 如果 Harness 端返回 404，降级到当前 Inact admin 的 `POST /admin/create`。

合理性判断：

- 这是可接受的短期兼容层。
- 但长期不够干净，因为 `/admin/create` 不是 idempotent ensure，DB 丢失或 secret 丢失时容易创建重复 member。
- 当前 `reconcileSandboxKey` 如果已有 `externalKeyId`，只能返回 metadata，不能重新拿到 raw API key。因此如果 K8s Secret 丢失，单靠 reconcile 不一定能恢复运行时 secret。

最优雅的长期方向：

- Harness 端补一个稳定 admin contract。
- control-plane 只使用稳定 contract，不再 scrape 或解析传统 TOML/text admin output。
- key 只在 create/rotate/ensure 返回一次，control-plane 立刻写入 K8s Secret。
- 如需恢复丢失 secret，要么 Harness ensure 能返回 active key，要么 control-plane 触发 rotate 后写入新 key。

### Control-plane DB

已实现：

- `control_harness_users`
- `control_harness_keys`
- repository 方法：
  - `upsertHarnessUser`
  - `upsertHarnessKey`
  - `updateHarnessKeyRotation`
  - `revokeHarnessKey`
  - `getHarnessKeyForSandbox`
  - `getHarnessUserForUser`

合理性判断：

- 用 Remote Codex user 和 sandbox 绑定 Harness identity/key 是正确的。
- 当前 DB 只记录 key metadata 和可选 ciphertext，不应存 raw key。
- `secret_name` 和 `secret_key` 记录 K8s Secret 绑定是必要的。

还需要补强：

- 明确 key_ciphertext 策略：要么接入 KMS/envelope encryption 后存加密 key，要么保持 null 并依赖 K8s Secret。
- 如果保持 null，sandbox start 前必须能确认 Secret 可用，或者能强制 rotate 生成新 key。

### Sandbox secret 注入

已实现：

- `SandboxSecretWriter`
- AWS/Kubectl `upsertSecretKey`
- sandbox start input 支持：
  - `harness.baseUrl`
  - `harness.appKeySecretName`
  - `harness.chemistryToolsEnabled`
- AWS worker pod env 支持：
  - `ELAGENTE_HARNESS_BASE_URL`
  - `REMOTE_CODEX_CHEMISTRY_TOOLS_ENABLED`
  - secret env `INACT_X_APP_KEY`

合理性判断：

- 这是正确层级。worker 需要 app key，browser 和 route token 不需要。
- K8s Secret 以 `secretName + sandboxId` 作为 key 的设计可以支持多 sandbox。

还需要补强：

- `ensureHarness` 目前看到 active DB key 且 secret binding 匹配时会直接返回，不一定重新写 Secret。对生产更稳的方案是：
  - 如果 secret writer 支持 read/exists，start 前验证 key 存在。
  - 如果无法验证且 DB 没有可解密 key，start 前 rotate 并写入新 key。
  - 如果 chemistry enabled 且写 Secret 失败，必须 fail closed。

### Worker Harness client 和 worker API

已实现：

- `WorkerHarnessClient`
- worker metadata 暴露非敏感 Harness 状态。
- worker routes：
  - `GET /api/harness/status`
  - `GET /api/harness/me`
  - `GET /api/harness/modules/:module/help`
  - `GET /api/harness/modules/:module/tools`
  - `GET /api/harness/modules/:module/runs`
  - `GET /api/harness/modules/:module/runs/:runId`
  - `GET /api/harness/modules/:module/runs/:runId/artifacts`
  - `GET /api/harness/modules/:module/runs/:runId/download.zip`
  - `POST /api/harness/modules/:module/tools/:tool/invoke`

合理性判断：

- worker 作为 Harness user API 的唯一运行时调用者是正确的。
- `X-Api-Key` 只在 worker 内部添加是正确的。
- error redaction 是必要的，当前已有覆盖。

还需要补强：

- 当前工具调用结果仍是 Harness 原始 payload/text。后续应规范化为 Remote Codex 可理解的 event/run/artifact shape。
- 对 POST invoke 的 usage/audit metadata 还需要覆盖 MCP 直接调用路径，并补齐 Remote Codex user、sandbox、workspace、session、thread、turn。

### Managed MCP 和 plugin 系统

已实现：

- built-in plugin `remote-codex.elagente-harness`
- managed MCP server `remote_codex_plugins`
- MCP tools：
  - `harness_status`
  - `harness_help`
  - `harness_list_tools`
  - `harness_invoke_tool`
- `REMOTE_CODEX_ENABLED_PLUGIN_IDS` 用于 gate enabled plugins。
- `modelHints` 告诉模型有 Harness tools，且不要询问或打印 `INACT_X_APP_KEY`。

合理性判断：

- 这是正确入口。agent 应通过工具用 Harness，而不是让用户把 key 粘进 prompt。
- 当前 MCP CLI 直接读 worker env 调 Harness，可接受，因为 MCP 运行在 worker 内。

还需要补强：

- `WorkerHarnessClient` 和 `bin/remote-codex-plugin-mcp.mjs` 里有重复 Harness fetch/redaction 逻辑。长期应抽到一个小的 shared client，例如 `packages/harness-client`，由 worker route 和 MCP CLI 共用。
- 对 expensive tool 的调用需要 quota/audit hook。MCP 直接打 Harness 时不经过 worker route，后续如果要统一审计，应让 MCP tool 调 worker-local Harness API 或 shared client 发出 usage event。

### `@remote-codex/thread-ui` 边界

已实现：

- `@remote-codex/thread-ui` 已是 workspace package。
- `ThreadDetailSurface` 通过 adapter props 接收数据加载、prompt、history detail、asset URL、shell 等能力。
- `AppShellNavigationMenu`、settings、plugin provider、timeline/plugin renderers 已在 package 内。
- control-plane session page 已经用 `ThreadDetailSurface`，而不是重新实现完整 chat UI。

合理性判断：

- 当前方向正确。control-plane session page 只应该做 adapter 和 control-plane session metadata，不应该 fork thread UI。
- 插件设置应走 `@remote-codex/thread-ui` 的 shared navigation/settings，不应在 control-plane 页面再做一套插件管理 UI。

还需要补强：

- 保持 `apps/supervisor-web` 对 thread UI 的依赖为包级 import。
- 避免在 control-plane session page 里复制 timeline/composer/settings 内部逻辑。
- 如果 thread UI 缺某个 slot 或 setting，优先在 `/home/u/dev/remoteCodex-main` 的 `packages/thread-ui` 加 adapter/slot，然后当前分支升级 package，而不是在当前分支 patch 一份 UI。

### Frontend control-plane overview

已实现：

- project/workspace/session 的逐级选择和创建逻辑已经比最早版本清晰。
- session chat route 已经使用 thread UI。
- `apps/supervisor-web/src/lib/api.ts` 已有 Harness status/help/tools/runs typed functions。
- Control Plane overview 已有 compact Harness panel，能显示 readiness、base URL、key present、chemistry enabled、module selector、tools list、recent runs 和 unavailable/degraded state。

未完成：

- Harness task/job/run 尚未归一化成 Remote Codex timeline/artifact records。
- artifact previews 仍停留在 read-only metadata/download links，未和 thread artifact system 完全闭环。
- staging smoke 未验证真实 Harness 部署下的 UI 和 agent tool 调用。

合理性判断：

- overview 页面可以展示 Harness 状态和工具发现。
- overview 页面不应直接 invoke compute tool。真实调用应发生在 thread agent tool 中，或者未来做一个受控 job submission UI。

## Harness 端现状判断

本地 Harness 源码显示：

- `/health` public。
- `/members` 使用 per-user `X-Api-Key`。
- `/admin` 使用 `X-Admin-Key`。
- `estructural`、`quntur`、`farmaco` 都有：
  - `/.help`
  - `/tools`
  - `/tools/:tool`
  - `/runs`
  - `/runs/:runId`
  - `/runs/:runId/artifacts`
  - `/runs/:runId/download.zip`
- compute job 侧有：
  - `/compute/jobs`
  - `/compute/artifacts`
  - usage 表 `compute_job_usage`
  - member billing events `agent_billing_events`

问题：

- `/admin/create` 会返回 raw `api_key`，但不是稳定 ensure。
- `/admin/list` 会列出 raw keys，不适合作为常规 sync 机制。
- 当前没有明确的 Remote Codex external id 字段 contract。
- usage export 还不是 Remote Codex 能直接导入的 normalized schema。

建议 Harness 端新增 contract：

```text
POST /admin/members/ensure
GET  /admin/members/by-external-id/:externalId
POST /admin/members/:memberId/keys/ensure
POST /admin/keys/:externalKeyId/rotate
POST /admin/keys/:externalKeyId/revoke
GET  /admin/usage/export?cursor=...
```

建议 response shape：

```json
{
  "externalUserId": "remote-codex:user:<userId>",
  "externalKeyId": "remote-codex:sandbox:<sandboxId>",
  "apiKey": "only-returned-on-create-or-rotate",
  "status": "active",
  "metadata": {
    "remoteCodexUserId": "...",
    "remoteCodexSandboxId": "..."
  }
}
```

## 最优接入方案

### 1. 身份和 key 生命周期

目标：

```text
Remote Codex user
  -> Remote Codex sandbox
  -> Harness member/key
  -> K8s Secret
  -> worker env INACT_X_APP_KEY
```

规则：

- 每个 sandbox 使用独立 Harness key。
- key rotate/revoke/reconcile 由 control-plane admin API 负责。
- worker 不创建 key。
- browser 不创建 key。
- agent 不知道 key。

推荐实现：

1. `ensureHarness(user, sandbox)` 在 bootstrap/start/restart 前运行。
2. 如果 chemistry disabled，跳过。
3. 如果 chemistry enabled 但 admin/base URL/Secret writer 不完整，fail closed。
4. 确保 Harness member/key。
5. 将 raw key 写入 K8s Secret。
6. DB 只保存 external key id、secret binding、status、rotated/revoked 时间。
7. sandbox start input 只携带 base URL 和 secret binding。

### 2. Runtime 调用路径

目标：

```text
agent
  -> managed MCP tool
  -> worker Harness client
  -> Harness module/tool API
```

推荐实现：

- MCP tools 保持简洁：
  - readiness: `harness_status`
  - discovery: `harness_help`, `harness_list_tools`
  - invocation: `harness_invoke_tool`
- tool invocation 返回结构化结果时，优先产生 Remote Codex artifact/event。
- 如果 Harness 返回 XYZ/CIF/PDB，agent 可以继续使用 `remote_codex_render_molecule` 生成 thread artifact。
- 后续将 Harness client 抽包，减少 worker route 和 MCP CLI 的重复代码。

### 3. Product UI 展示路径

目标：

```text
Control Plane overview
  -> control-plane API
  -> worker Harness read-only API
  -> status/modules/runs/artifacts metadata
```

UI 只展示：

- Harness readiness
- modules
- tools list
- recent runs
- artifact links/previews
- degraded/error state

UI 不做：

- raw API key 展示
- admin key 管理
- arbitrary tool invoke
- prompt 注入编辑器

### 4. Thread UI 模块化路径

目标：

```text
apps/supervisor-web
  imports @remote-codex/thread-ui
  provides control-plane adapter
  does not fork thread internals
```

规则：

- `ControlPlaneSessionPage` 只负责：
  - session lookup
  - route token creation
  - worker thread adapter
  - settingsContent/metaContent
  - workspace/session navigation metadata
- chat surface、composer、timeline、settings、plugin renderer 全部来自 `@remote-codex/thread-ui`。
- 如果需要 hamburger/settings/plugin slot，改 `packages/thread-ui` 主线包，再升级当前分支。

### 5. 系统提示词和工具说明

系统提示词可以补充非敏感使用说明，但不能成为主要集成机制。

推荐：

- plugin `modelHints` 说明 Harness tools 可用。
- 提醒模型先 `harness_status`，再 `harness_help` 或 `harness_list_tools`。
- 可以说明 Inact workspace 的非敏感使用方法。
- 不写入任何 key、token、admin URL。

不推荐：

- 在 session prompt 拼接 `INACT_X_APP_KEY`。
- 让用户手动复制 Harness key。
- 让 browser 生成或保存 key。

## Checklist

### Phase A: 收口当前分支已有实现

- [ ] 跑完 control-plane API Harness tests。
- [ ] 跑完 supervisor-api worker Harness tests。
- [ ] 跑完 plugin MCP node syntax check。
- [ ] 跑完 supervisor-web control-plane session tests。
- [ ] 确认 `git diff --check` 无 whitespace 问题。
- [ ] 确认 frontend bundle 中没有 `INACT_X_APP_KEY`、`ELAGENTE_HARNESS_ADMIN_KEY`、raw Harness key。

### Phase B: 补 control-plane Harness read-only API

- [x] 保留 `GET /api/sandbox/harness/status`。
- [x] 增加 `GET /api/sandbox/harness/modules/:module/help`。
- [x] 保留或完善 `GET /api/sandbox/harness/modules/:module/tools`。
- [x] 增加 `GET /api/sandbox/harness/modules/:module/runs`。
- [x] 增加 `GET /api/sandbox/harness/modules/:module/runs/:runId`。
- [x] 增加 `GET /api/sandbox/harness/modules/:module/runs/:runId/artifacts`。
- [x] 增加 download proxy，并确认不泄漏 key。
- [ ] 所有 read-only proxy 只在 sandbox running 时可用。

### Phase C: 补 control-plane overview Harness UI

- [x] 在 `apps/supervisor-web/src/lib/api.ts` 增加 typed functions。
- [x] 在 `ControlPlanePage` 增加 Harness panel。
- [x] sandbox 不 running 时展示 disabled/degraded state。
- [x] running 时展示 readiness、base URL、key present、modules。
- [x] module selector 展示 tools list。
- [x] recent runs 有基础展示。
- [x] UI 不显示 raw key。
- [ ] artifacts 有稳定 contract 后再展示 preview。
- [ ] 加测试覆盖 not running、ready、unavailable、no secret leak。

### Phase D: 补 worker 和 MCP 的审计边界

- [ ] 将 Harness 调用路径集中到一个 shared client 或 worker-local API。
- [ ] invoke 时记录 user/sandbox/workspace/session/thread/turn metadata。
- [ ] MCP errors 继续 redaction。
- [ ] plugin disabled 时 MCP 不注册 Harness tools。
- [ ] settings 里能看到 Harness plugin，但不能看到 key。

### Phase E: 补 Harness admin contract

- [ ] Harness 端实现 idempotent `POST /admin/members/ensure`。
- [ ] Harness 端支持 external user id 和 external key id。
- [ ] Harness 端支持 key ensure/rotate/revoke/reconcile。
- [ ] Harness 端 admin response 不通过 list raw keys 做同步。
- [ ] Remote Codex `HttpHarnessAdmin` 删除 text/TOML fallback 或把 fallback 限定为 dev only。

### Phase F: 补 Secret 恢复策略

- [ ] 定义 K8s Secret source of truth。
- [ ] 如果 Secret writer 支持 read/exists，start 前验证 `secretName/sandboxId`。
- [ ] 如果 Secret 丢失且 DB 没有可解密 key，rotate 后写入新 key。
- [ ] chemistry enabled 且 Secret 写入失败时 sandbox start fail closed。
- [ ] admin reconcile 能恢复 secret binding。

### Phase G: 补 run/artifact/usage 规范化

- [ ] 定义 Remote Codex Harness run schema。
- [ ] 将 Harness module runs 转成 Remote Codex timeline 或 side panel records。
- [ ] 将 artifact links 转成 Remote Codex artifact refs。
- [ ] 支持 molecule artifacts 时复用 XYZ/CIF/PDB renderer。
- [ ] 定义 Harness usage import event：
  - source
  - provider
  - module
  - tool
  - run id
  - job id
  - cost or compute units
  - user/sandbox/workspace/session/thread/turn
  - occurredAt
- [ ] usage import idempotent。
- [ ] quota 能阻止 expensive Harness jobs。

### Phase H: staging smoke

- [ ] Railway control-plane 配置真实 Harness admin env。
- [ ] sandbox cluster 有 Harness key Secret 写权限。
- [ ] 新用户注册后 bootstrap 不泄漏 Harness key。
- [ ] start sandbox 后 worker metadata 显示 Harness enabled/keyPresent。
- [ ] control-plane overview Harness status 正常。
- [ ] Codex thread 能调用 `harness_status`。
- [ ] Codex thread 能调用一个轻量 `harness_help` 或 `harness_list_tools`。
- [ ] 调用一个安全低成本 module tool 并收到结果。
- [ ] 若返回 XYZ/CIF/PDB，能在 thread UI 生成或展示 molecule artifact。
- [ ] secret scan 覆盖 frontend bundle、API responses、logs、thread messages。

## 当前分支下一步建议

按风险和收益排序：

1. 先完成 Phase A：确认当前已有大块实现能稳定测试通过。
2. 补 Phase B/C 的测试和 sandbox running guard。
3. 把 MCP Harness 调用收口到 worker-local API 或 shared client，避免 usage/audit 分叉。
4. 做 staging smoke：重点验证真实 `INACT_X_APP_KEY` 只存在于 K8s Secret 和 worker env。
5. 再推动 Harness 端 Phase E contract，移除当前 fallback 依赖。
6. 最后做 quota、artifact/timeline 正规化和完整 Harness usage export。

## 关键设计取舍

### 为什么前端不直连 Harness

前端直连 Harness 需要 browser 持有 `X-Api-Key`，这会破坏 sandbox-scoped secret 边界。即使用短期 token，也会引入新的 CORS、token mint、scope、revocation、audit surface。当前需求下没有必要。

正确做法是 browser 调 Remote Codex API，Remote Codex 通过 worker 调 Harness。

### 为什么不用 prompt 注入传 key

prompt 是可见、可记录、可被模型输出的上下文。把 key 放进 prompt 会泄漏。prompt 只能描述工具使用方法，不能承载凭证。

### 为什么 project/workspace/session 不应影响 Harness identity

Harness key 应绑定 sandbox，而不是 workspace 或 session。原因：

- worker env 是 sandbox 级别。
- 一个 sandbox 内可能有多个 workspace/session。
- 绑定 workspace/session 会导致 worker env 无法清晰切换 key。

workspace/session metadata 应用于 audit/usage attribution，而不是 key ownership。

### 为什么 MCP tool 是 agent 的主要入口

agent 工作在 thread 里，最自然的能力入口是 tool。MCP 能被 plugin settings gate，能配合 `@remote-codex/thread-ui` 展示 plugin 状态，也能通过 model hints 说明使用方法。

Control-plane overview 是 operator surface，不应变成 chemistry workflow editor。

## 文件级落点

Remote Codex 当前分支：

- `apps/control-plane-api/src/config.ts`
- `apps/control-plane-api/src/adapters.ts`
- `apps/control-plane-api/src/app.ts`
- `apps/control-plane-api/src/repository.ts`
- `apps/control-plane-api/src/*.test.ts`
- `packages/db/src/schema.ts`
- `packages/db/migrations/0025_control_harness_credentials.sql`
- `apps/supervisor-api/src/worker-harness-client.ts`
- `apps/supervisor-api/src/routes/system.ts`
- `apps/supervisor-api/src/plugins/*`
- `packages/plugin-elagente-harness/*`
- `bin/remote-codex-plugin-mcp.mjs`
- `apps/supervisor-web/src/lib/api.ts`
- `apps/supervisor-web/src/pages/ControlPlanePage.tsx`
- `apps/supervisor-web/src/pages/ControlPlaneSessionPage.tsx`
- `packages/thread-ui/*`

Harness 端建议改动：

- `/home/u/dev/ElAgente/harness/ElAgenteHarness/src/inact/inact/apps/workspace/register.py`
- `/home/u/dev/ElAgente/harness/ElAgenteHarness/src/elagente_harness/server.py`
- `/home/u/dev/ElAgente/harness/ElAgenteHarness/src/elagente_harness/core/run_store.py`
- `/home/u/dev/ElAgente/harness/ElAgenteHarness/src/elagente_harness/compute_job/compute_job.py`

## Open Questions

1. Harness 是否愿意让 `ensure` 在 active key 存在时返回 raw key？如果不愿意，Remote Codex 必须通过 rotate 恢复丢失 Secret。
2. Harness usage export 应以 member billing events 为主，还是 compute job usage 为主？建议两者统一成一份 export。
3. Remote Codex 是否需要在 control-plane overview 展示 run/artifact，还是只在 thread timeline 展示？建议先 overview 只做 read-only status，artifact 主要进 thread timeline。
4. 未来如果一个 sandbox 运行多个 agent provider，是否所有 provider 共用同一 Harness key？当前建议共用 sandbox key，并用 metadata 做 provider attribution。
