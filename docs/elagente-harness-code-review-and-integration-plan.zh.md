# ElAgenteHarness 接入代码通读评审和最优集成计划

本文档基于当前 `sandbox-worker-control-plane` 分支代码、`@remote-codex/thread-ui` 包边界、以及本地 Harness 源码 `/home/u/dev/ElAgente/harness/ElAgenteHarness` 的通读结果，梳理 ElAgenteHarness 应如何优雅接入 Remote Codex control plane。

核心目标：

- sandbox 创建时由 control-plane 自动准备 Harness scoped key。
- worker 内部持有 `INACT_X_APP_KEY`，agent 通过受控工具使用 Harness。
- browser、route token、thread prompt、plugin settings、日志都不接触 raw key。
- UI 只负责状态、发现、用量、artifact 展示，不实现另一套 Harness secret 或 admin console。

## 总体结论

当前分支的方向基本正确：Harness 已经被放在 sandbox worker 的受控运行时能力里，而不是被暴露成前端可直连的服务。

推荐保持这条链路：

```text
browser
  -> supervisor-web control-plane pages
  -> control-plane API
  -> sandbox router / worker route token
  -> supervisor-api worker Harness API 或 managed MCP
  -> ElAgenteHarness
```

不推荐的链路：

```text
browser -> ElAgenteHarness
prompt/system message -> INACT_X_APP_KEY
plugin settings -> Harness key
route token payload -> Harness key
```

原因很直接：`INACT_X_APP_KEY` 是 sandbox-scoped secret。只要浏览器或 prompt 能看到它，就会破坏后续 billing、quota、revoke 和审计边界。

## 当前已经实现的能力

### 1. Control-plane 配置和生命周期

已实现文件：

- [apps/control-plane-api/src/config.ts](/home/u/dev/remoteCodex/apps/control-plane-api/src/config.ts)
- [apps/control-plane-api/src/adapters.ts](/home/u/dev/remoteCodex/apps/control-plane-api/src/adapters.ts)
- [apps/control-plane-api/src/app.ts](/home/u/dev/remoteCodex/apps/control-plane-api/src/app.ts)
- [apps/control-plane-api/src/repository.ts](/home/u/dev/remoteCodex/apps/control-plane-api/src/repository.ts)

已支持环境变量：

- `ELAGENTE_HARNESS_BASE_URL`
- `ELAGENTE_HARNESS_PROVIDER`
- `ELAGENTE_HARNESS_APP_KEY_SECRET_NAME`
- `ELAGENTE_HARNESS_ADMIN_BASE_URL`
- `ELAGENTE_HARNESS_ADMIN_KEY`
- `REMOTE_CODEX_CHEMISTRY_TOOLS_ENABLED`

代码现状：

- `REMOTE_CODEX_CHEMISTRY_TOOLS_ENABLED=true` 时会要求 `ELAGENTE_HARNESS_BASE_URL` 存在。
- control-plane 有 `HarnessAdmin`、`HttpHarnessAdmin`、`NoopHarnessAdmin`。
- sandbox bootstrap/start/restart/admin restart 前会走 `ensureHarness(...)`。
- `ensureHarness(...)` 会尝试确保 Harness user/key，然后把 raw API key 写入 sandbox Secret writer。
- `harnessStartInput(...)` 只把 Harness base URL、secret name 和 enable flag 传给 sandbox manager，不传 raw key。

设计判断：

- 这个边界合理，应保留。
- admin key 只属于 control-plane API，不应进入 worker。
- Harness base URL 可以进入 worker，因为它不是 secret。
- chemistry enabled 但 admin/secret writer 不完整时应 fail closed，当前方向正确。

当前不足：

- `ensureHarness(...)` 如果发现 DB 里已有 active key 且 secret binding 看起来一致，会直接返回；它没有验证 Kubernetes Secret 是否仍然存在。因此生产上可能出现 DB 认为可用、worker 实际缺 `INACT_X_APP_KEY` 的情况。
- fallback 到 Harness 当前 `/admin/create` 是短期兼容，不是理想长期 contract。

### 2. DB schema 和 secret binding

已实现文件：

- [packages/db/src/schema.ts](/home/u/dev/remoteCodex/packages/db/src/schema.ts)
- [packages/db/migrations/0025_control_harness_credentials.sql](/home/u/dev/remoteCodex/packages/db/migrations/0025_control_harness_credentials.sql)
- [packages/db/migrations/0026_control_harness_usage_events.sql](/home/u/dev/remoteCodex/packages/db/migrations/0026_control_harness_usage_events.sql)

已新增表：

- `control_harness_users`
- `control_harness_keys`
- `control_harness_usage_events`

设计判断：

- `control_harness_keys.secret_name + secret_key` 记录 K8s Secret binding 是必要的。
- DB 保存 external id、状态、rotation/revocation 时间、secret binding 是合理的。
- DB 不应保存 raw key。`key_ciphertext` 可以保留为未来 KMS/envelope encryption 扩展位。

当前不足：

- `control_harness_usage_events` 已有 schema，但 agent 通过 MCP 直接调用 Harness 时未必会进入 control-plane usage 记录。
- `control_harness_usage_events` 目前可记录 invoke result 的归一化片段，但还没有完整 Harness usage export/import。

### 3. Sandbox env 注入

已实现文件：

- [apps/control-plane-api/src/adapters.ts](/home/u/dev/remoteCodex/apps/control-plane-api/src/adapters.ts)

已实现行为：

- AWS worker pod env 注入 `ELAGENTE_HARNESS_BASE_URL`。
- AWS worker pod env 注入 `REMOTE_CODEX_CHEMISTRY_TOOLS_ENABLED`。
- AWS worker pod secret env 注入 `INACT_X_APP_KEY`，来源为：

```text
secret name = ELAGENTE_HARNESS_APP_KEY_SECRET_NAME
secret key  = sandbox.id
```

设计判断：

- 这是当前最干净的 secret 边界。
- 每个 sandbox 一把 Harness key，blast radius 清晰。
- key rotate/revoke 可以按 sandbox 做。

当前不足：

- Secret writer 目前只有 write/upsert，没有 read/exists 验证。
- 如果 Secret 丢失，当前实现不一定自动恢复。

### 4. Worker Harness API

已实现文件：

- [apps/supervisor-api/src/worker-harness-client.ts](/home/u/dev/remoteCodex/apps/supervisor-api/src/worker-harness-client.ts)
- [apps/supervisor-api/src/routes/system.ts](/home/u/dev/remoteCodex/apps/supervisor-api/src/routes/system.ts)

已实现 worker API：

- `GET /api/harness/status`
- `GET /api/harness/me`
- `GET /api/harness/modules/:module/help`
- `GET /api/harness/modules/:module/tools`
- `GET /api/harness/modules/:module/runs`
- `GET /api/harness/modules/:module/runs/:runId`
- `GET /api/harness/modules/:module/runs/:runId/artifacts`
- `GET /api/harness/modules/:module/runs/:runId/download.zip`
- `POST /api/harness/modules/:module/tools/:tool/invoke`

设计判断：

- worker 是唯一应持有 `INACT_X_APP_KEY` 的运行时调用者，这个设计正确。
- module allowlist `estructural | quntur | farmaco` 合理。
- worker error redaction 必须保留。

当前不足：

- `WorkerHarnessClient` 和 `bin/remote-codex-plugin-mcp.mjs` 里重复实现了 Harness fetch、module allowlist、redaction。
- invoke result 仍偏 Harness 原始 payload。后续应归一化为 Remote Codex 的 run/artifact/timeline event。

### 5. Control-plane Harness proxy 和 usage

已实现文件：

- [apps/control-plane-api/src/app.ts](/home/u/dev/remoteCodex/apps/control-plane-api/src/app.ts)
- [apps/control-plane-api/src/repository.ts](/home/u/dev/remoteCodex/apps/control-plane-api/src/repository.ts)

已实现 user-facing API：

- `GET /api/sandbox/harness/status`
- `GET /api/sandbox/harness/modules/:module/help`
- `GET /api/sandbox/harness/modules/:module/tools`
- `GET /api/sandbox/harness/modules/:module/runs`
- `GET /api/sandbox/harness/modules/:module/runs/:runId`
- `GET /api/sandbox/harness/modules/:module/runs/:runId/artifacts`
- `GET /api/sandbox/harness/modules/:module/runs/:runId/download.zip`
- `POST /api/sandbox/harness/modules/:module/tools/:tool/invoke`
- `GET /api/usage/harness/summary`
- `GET /api/usage/harness/events`

设计判断：

- read-only proxy 用于 Control Plane overview 是合理的。
- invoke proxy 可以用于受控 UI 或未来 job submission，但不应该成为 agent 的主要路径。
- usage event 用 `provider + externalEventId` 去重方向正确。

当前不足：

- 当前 usage 只覆盖 control-plane invoke proxy。Codex MCP 直接调用 Harness 时不会天然进入这个 usage table。
- 没有 quota preflight，因此 expensive Harness jobs 还不能在提交前被 control-plane 阻断。
- `POST /api/sandbox/harness/.../invoke` 返回 Harness 原始 payload；需要确认 Harness 永不返回 raw key。更稳的做法是成功 payload 也走 key-pattern redaction 或 allowlisted metadata extraction。

### 6. Managed plugin / MCP

已实现文件：

- [packages/plugin-elagente-harness](/home/u/dev/remoteCodex/packages/plugin-elagente-harness)
- [apps/supervisor-api/src/plugins/builtin-plugins.ts](/home/u/dev/remoteCodex/apps/supervisor-api/src/plugins/builtin-plugins.ts)
- [apps/supervisor-api/src/plugins/plugin-service.ts](/home/u/dev/remoteCodex/apps/supervisor-api/src/plugins/plugin-service.ts)
- [bin/remote-codex-plugin-mcp.mjs](/home/u/dev/remoteCodex/bin/remote-codex-plugin-mcp.mjs)

已实现 MCP tools：

- `harness_status`
- `harness_help`
- `harness_list_tools`
- `harness_invoke_tool`

设计判断：

- MCP/plugin 是 agent 使用 Harness 的正确入口。
- `REMOTE_CODEX_ENABLED_PLUGIN_IDS` gate 合理。
- MCP config 不包含 `INACT_X_APP_KEY`，由 worker process env 提供，这是正确的。
- model hint 只描述工具用法，不包含 key，这是正确的。

当前不足：

- MCP 直接打 Harness，绕过 worker route 和 control-plane usage 记录。
- 如果未来要统一审计和 quota，MCP invoke 应改为调用 worker-local API，或复用一个会发 usage event 的 shared client。

### 7. Frontend

已实现文件：

- [apps/supervisor-web/src/lib/api.ts](/home/u/dev/remoteCodex/apps/supervisor-web/src/lib/api.ts)
- [apps/supervisor-web/src/pages/ControlPlanePage.tsx](/home/u/dev/remoteCodex/apps/supervisor-web/src/pages/ControlPlanePage.tsx)
- [apps/supervisor-web/src/pages/ControlPlaneSessionPage.tsx](/home/u/dev/remoteCodex/apps/supervisor-web/src/pages/ControlPlaneSessionPage.tsx)

已实现：

- Control Plane overview 有 Harness panel。
- account popover 里有 LLM usage 和 Harness usage。
- session chat 使用 `@remote-codex/thread-ui` 的 `ThreadDetailSurface`。
- 之前的 `Prompt sent. Waiting for worker updates...` 字样已经不再作为发送成功 message 插入。

设计判断：

- overview 的 Harness panel 应保持 operator/readiness 角色，不要变成完整 chemistry workbench。
- 真正执行 chemistry 任务应发生在 thread agent 的 tools 里。
- session chat 继续只做 adapter，聊天 UI、settings、plugin rendering 继续从 `@remote-codex/thread-ui` 来。

当前不足：

- `@remote-codex/thread-ui` 当前是 workspace package 依赖：`@remote-codex/thread-ui: workspace:*`。这已经是包级边界，但不是外部 registry/git 版本依赖。
- 因此“main 更新 UI 后当前分支零代码同步”的理想状态还没完全达到。后续需要把 thread-ui 发布成可版本化依赖，或使用 git/tag 依赖。

## Harness 端现状

通读路径：

- `/home/u/dev/ElAgente/harness/ElAgenteHarness/src/elagente_harness/server.py`
- `/home/u/dev/ElAgente/harness/ElAgenteHarness/src/inact/inact/apps/workspace/register.py`
- `/home/u/dev/ElAgente/harness/ElAgenteHarness/docs/apps/compute_job.md`
- `/home/u/dev/ElAgente/harness/ElAgenteHarness/docs/modules/job-submission.md`

Harness 已有能力：

- `/health` 和 `/healthz`。
- `/members` user registry。
- `/members/.me`。
- `/members/.billing`。
- `/admin/create`。
- `/admin/list`。
- `/admin/<id>/rekey`。
- `/admin/<id>/delete`。
- `/admin/<id>/update`。
- `/estructural/.help`、`/quntur/.help`、`/farmaco/.help`。
- 各 module `/tools`、`/tools/:tool`。
- 各 module `/runs`、`/runs/:runId`、`/runs/:runId/artifacts`、`/runs/:runId/download.zip`。
- compute job usage 和 `agent_billing_events`。

Harness 当前缺口：

- 没有 idempotent `POST /admin/members/ensure`。
- 没有 external user id / external key id contract。
- `/admin/list` 会返回 raw `api_key`，不适合作为 Remote Codex 常规 reconcile/export 机制。
- 没有 Remote Codex 可直接导入的 normalized usage export。
- 当前 admin response 是 text/TOML-like，Remote Codex 只能兼容解析，不够稳。

## 最优接入方式

### 身份模型

推荐 phase 1 继续使用 sandbox-scoped Harness key：

```text
Remote Codex user
  -> Remote Codex sandbox
  -> Harness member/key
  -> K8s Secret
  -> worker env INACT_X_APP_KEY
```

不要把 key 绑定到 project/workspace/session。

原因：

- worker env 是 sandbox 级别。
- 一个 sandbox 内可以有多个 workspace/session。
- workspace/session 应用于 usage attribution，不应用于 secret ownership。

### Runtime 调用模型

推荐目标：

```text
Codex / agent
  -> managed MCP tool
  -> worker-local Harness API 或 shared Harness client
  -> ElAgenteHarness
```

短期可以保留 MCP 直接调用 Harness，但长期更优雅的方式是让 MCP 调 worker-local API：

```text
harness_invoke_tool
  -> http://127.0.0.1:<worker-port>/api/harness/modules/:module/tools/:tool/invoke
  -> WorkerHarnessClient
  -> Harness
  -> worker emits normalized usage/event
```

这样可以统一：

- redaction
- allowlist
- usage attribution
- future quota hook
- result normalization

### Product UI 模型

Control Plane overview 应展示：

- sandbox readiness
- Harness enabled/keyPresent/health
- module list
- tools discovery
- recent runs
- account usage summary

Control Plane overview 不应展示：

- raw Harness key
- admin key
- arbitrary secret editing
- full chemistry workflow builder

Thread UI 应展示：

- agent 调用工具后的 response。
- molecule/file/artifact renderer。
- plugin settings。
- run/artifact timeline event。

### Thread UI 依赖模型

当前状态：

- `apps/supervisor-web` 已 import `@remote-codex/thread-ui`。
- `ControlPlaneSessionPage` 已使用 `ThreadDetailSurface`。
- `@remote-codex/thread-ui` 仍是 workspace local package。

最优状态：

- 当前分支只依赖 `@remote-codex/thread-ui` 的 public API。
- 不在当前分支 patch package internals。
- 如果需要 settings/plugin/navigation slot，在 main 分支的 `packages/thread-ui` 增 public API。
- main 发布新 package version 后，当前分支只升级版本。

## 推荐实施顺序

### Phase 1: 收口当前实现并修测试

目标：确认当前大块代码不是“看起来有”，而是稳定可验证。

Checklist：

- [ ] `pnpm --filter @remote-codex/control-plane-api test -- src/app.test.ts`
- [ ] `pnpm --filter @remote-codex/control-plane-api typecheck`
- [ ] `pnpm --filter @remote-codex/supervisor-api test -- src/app.test.ts`
- [ ] `pnpm --filter @remote-codex/supervisor-api typecheck`
- [ ] `pnpm --filter @remote-codex/supervisor-web test -- src/pages/ControlPlanePage.test.tsx`
- [ ] `pnpm --filter @remote-codex/supervisor-web test -- src/pages/ControlPlaneSessionPage.test.tsx`
- [ ] `pnpm --filter @remote-codex/supervisor-web typecheck`
- [ ] `pnpm --filter @remote-codex/db typecheck`
- [ ] `node --check bin/remote-codex-plugin-mcp.mjs`
- [ ] `git diff --check`

验收标准：

- 所有上述命令通过。
- 测试覆盖 no key leak。
- 文档中的“已实现/未实现”与代码一致。

### Phase 2: 去除重复 Harness client 逻辑

目标：不要在 worker route 和 MCP CLI 里各写一套 Harness fetch/redaction。

推荐做法：

1. 新增 `packages/harness-client` 或 `packages/shared-harness-client`。
2. 抽出：
   - module allowlist
   - tool/run id validation
   - `X-Api-Key` header injection
   - text/json/binary response parsing
   - error redaction
3. `WorkerHarnessClient` 使用该 package。
4. `remote-codex-plugin-mcp.mjs` 使用该 package，或者直接调用 worker-local API。

更推荐的最终做法：

- MCP CLI 调 worker-local API。
- worker route 继续使用 shared client。

原因：

- MCP 调 worker-local API 后，usage/audit/quota 可以集中在 worker/control-plane adapter。
- MCP 不需要知道 Harness base URL 的 request details，只需要知道 worker 本地 API 可用。

验收标准：

- `harness_status/help/list_tools/invoke_tool` 行为不变。
- 禁用 plugin 后 MCP 不注册 Harness tools。
- MCP config 不出现 `INACT_X_APP_KEY`。
- 错误里不出现 key。

### Phase 3: usage/audit 归一化

目标：agent 通过 MCP 发起的 Harness 调用也能进入用量和审计。

推荐路径：

1. worker `/api/harness/.../invoke` 在返回时生成 normalized event candidate：
   - provider
   - module
   - tool
   - run id
   - job id
   - external event id
   - compute units
   - cost USD
   - status
   - occurredAt
2. worker 把 event 通过现有 control-plane sync 通道上报，或在 control-plane proxy invoke 时记录。
3. 如果 MCP 走 worker-local API，就能复用同一条记录逻辑。
4. `control_harness_usage_events` 保持 idempotent。

短期可接受：

- control-plane proxy invoke 记录 usage。
- MCP invoke 暂时不完整记录，但文档和 staging smoke 必须明确这一限制。

长期验收标准：

- Codex thread 调 `harness_invoke_tool` 后，account menu 中 Harness usage 增加。
- 重试同一 external event 不重复计费。
- usage event 能关联 user/sandbox/workspace/session/thread/turn。

### Phase 4: Secret 恢复策略

目标：DB 和 K8s Secret 状态不一致时自动恢复，不启动缺 key worker。

推荐做法：

1. 扩展 `SandboxSecretWriter`：

```ts
interface SandboxSecretWriter {
  putSecretValue(...): Promise<void>;
  hasSecretValue?(input: { secretName: string; key: string }): Promise<boolean>;
  deleteSecretValue?(...): Promise<void>;
}
```

2. `ensureHarness(...)` 逻辑调整：

```text
if chemistry disabled:
  no-op
if active DB key and secret exists:
  return existing
if active DB key and secret missing and encrypted key recoverable:
  rewrite secret
if active DB key and secret missing and raw key unrecoverable:
  rotate Harness key, write secret, update DB
if no DB key:
  ensure/create Harness key, write secret, insert DB
```

验收标准：

- Secret 缺失时 start/restart 不会启动 broken worker。
- Secret writer 失败时 chemistry enabled start fail closed。
- logs/API 不出现 raw key。

### Phase 5: Harness 端 admin contract 标准化

目标：Remote Codex 不再依赖 `/admin/create` text fallback 和 `/admin/list` raw key。

建议 Harness 新增：

```http
POST /admin/members/ensure
GET  /admin/members/by-external-id/:externalId
POST /admin/members/:externalUserId/keys/ensure
POST /admin/keys/:externalKeyId/rotate
POST /admin/keys/:externalKeyId/revoke
GET  /admin/usage/export?cursor=...
```

建议 response：

```json
{
  "externalUserId": "remote-codex:user:<userId>",
  "externalKeyId": "remote-codex:sandbox:<sandboxId>",
  "apiKey": "only-returned-on-create-or-rotate",
  "status": "active",
  "created": true,
  "metadata": {
    "remoteCodexUserId": "<userId>",
    "remoteCodexSandboxId": "<sandboxId>"
  }
}
```

验收标准：

- Remote Codex `HttpHarnessAdmin` 不需要解析 TOML-like admin output。
- `ensure` idempotent。
- `rotate` 返回新 raw key。
- `revoke` 不返回 raw key。
- usage export 不返回 raw keys。

### Phase 6: run/artifact 进入 thread timeline

目标：Harness 结果不是只停留在 JSON 文本，而是能进入 Remote Codex thread UI。

推荐做法：

1. 定义 Remote Codex Harness artifact DTO：
   - module
   - runId
   - jobId
   - artifact type
   - filename
   - content type
   - download route
   - preview metadata
2. worker 读取 Harness `/runs/:runId/artifacts` 后归一化。
3. 对 molecule 文件：
   - XYZ
   - extxyz
   - CIF
   - PDB
   复用 `remote_codex_render_molecule` 或 thread-ui artifact renderer。
4. thread timeline 展示：
   - task submitted
   - run pending/running/done/error
   - artifacts ready

验收标准：

- Codex 发起 Harness 任务后，用户能在 thread UI 里看到 run 状态和 artifact。
- molecule artifact 使用 `@remote-codex/thread-ui` 的 plugin renderer 展示。
- control-plane overview 仍只做概览，不复制 thread artifact UI。

### Phase 7: Staging smoke

目标：真实部署闭环。

环境变量：

- `ELAGENTE_HARNESS_BASE_URL`
- `ELAGENTE_HARNESS_ADMIN_BASE_URL`
- `ELAGENTE_HARNESS_ADMIN_KEY`
- `ELAGENTE_HARNESS_APP_KEY_SECRET_NAME`
- `REMOTE_CODEX_CHEMISTRY_TOOLS_ENABLED=true`

Smoke 步骤：

- [ ] 新用户注册/登录。
- [ ] bootstrap 不泄漏 Harness key。
- [ ] start sandbox。
- [ ] worker metadata 显示 Harness enabled/keyPresent。
- [ ] Control Plane overview Harness panel 可刷新。
- [ ] Codex thread settings 中 Harness plugin enabled。
- [ ] Codex 调 `harness_status`。
- [ ] Codex 调 `harness_help` 或 `harness_list_tools`。
- [ ] Codex 调一个低成本安全 tool。
- [ ] thread 收到回复。
- [ ] 若结果包含 molecule 数据，artifact renderer 正常展示。
- [ ] account menu usage 增加。
- [ ] frontend bundle/API response/thread message/logs 均不含 `INACT_X_APP_KEY` 或 raw key。

## 当前设计是否合理

合理的部分：

- control-plane 管理 admin credential 和 sandbox lifecycle。
- K8s Secret 注入 worker。
- worker API/MCP 持有 user key。
- frontend 不直连 Harness。
- plugin system 管理 agent-visible tools。
- `@remote-codex/thread-ui` 负责 chat/settings/plugin rendering。

需要改进的部分：

- MCP 和 worker route 的 Harness client 逻辑重复。
- MCP invoke usage/audit 没有完整闭环。
- Secret 恢复策略还不够稳。
- Harness 端 admin API 不够标准。
- run/artifact 还没有进入 thread timeline 的规范化数据模型。
- `@remote-codex/thread-ui` 仍是 workspace package，后续要升级为版本化依赖才能真正降低 main UI 同步成本。

## 最小下一步

如果只做一组最有价值的下一步，建议顺序是：

1. 修完当前测试，确保已有 Harness 接入稳定。
2. 更新旧文档中“未实现”但代码已实现的条目。
3. 把 MCP 的 Harness 调用改为 worker-local API 或抽 shared client。
4. 实现 Secret exists/restore/rotate 策略。
5. 推动 Harness 端 `admin/members/ensure` 和 usage export。
6. 做 staging smoke，并把 smoke evidence 写回 docs。

## 决策记录

- Harness key 绑定 sandbox，不绑定 workspace/session。
- browser 永远不直连 Harness user API。
- prompt/system message 只描述工具，不传 key。
- Control Plane overview 是 operator surface，不是 chemistry workbench。
- agent 的主要入口是 MCP/plugin tool。
- thread UI 只从 `@remote-codex/thread-ui` import，缺能力先改 main package，再升级依赖。
