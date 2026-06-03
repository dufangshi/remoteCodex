# ElAgenteHarness Goal Checklist

本文档用于 goal 模式逐项推进 ElAgenteHarness 接入闭环。架构判断见 [ElAgenteHarness Optimal Integration Plan](./elagente-harness-optimal-integration-plan.zh.md)，历史实现记录见 [ElAgenteHarness Control Plane Integration Plan](./elagente-harness-control-plane-integration-plan.zh.md)。

核心原则：

- `INACT_X_APP_KEY` 只在 Kubernetes Secret、worker env、worker Harness client 调用栈中存在。
- browser、route token、plugin settings、prompt、thread message、artifact metadata、frontend bundle 都不能包含 raw key。
- 生产 provider tool path 必须走 worker-local `/api/harness/*`，不能依赖 direct Harness fallback。
- 当前分支只消费 `@remote-codex/thread-ui`；缺 UI slot/renderer 时改 main package 后升级。

## 0. 当前代码边界复核

- [x] `ControlPlaneSessionPage` 仍通过 `@remote-codex/thread-ui` 的 `ThreadDetailSurface` 渲染聊天界面。
- [x] 当前分支没有复制 main branch thread timeline/composer/settings/plugin manager 源码；control-plane session page 只接 adapter/route token/session lookup。
- [x] app shell nav/settings context 只有 `@remote-codex/thread-ui` 一处创建；`apps/supervisor-web/src/components/AppShellNavContext.tsx` 只 re-export package context。
- [x] `remote-codex.elagente-harness` plugin manifest 不包含 key、token、admin credential 字段。
- [x] `bin/remote-codex-plugin-mcp.mjs` 在 worker runtime 下优先且必须调用 worker-local `/api/harness/*`。
- [x] `apps/supervisor-api/src/worker-harness-client.ts` 仍是 `X-Api-Key` 注入和 redaction 的唯一 runtime Harness client。
- [x] `apps/control-plane-api/src/app.ts` 的 public API response 不返回 Harness raw key 或 key ciphertext。

验证命令：

```bash
rg -n "INACT_X_APP_KEY|ELAGENTE_HARNESS_ADMIN_KEY|keyCiphertext|apiKey" apps/supervisor-web packages/thread-ui
node --check bin/remote-codex-plugin-mcp.mjs
pnpm --filter @remote-codex/supervisor-api typecheck
pnpm --filter @remote-codex/control-plane-api typecheck
```

完成标准：

- 只允许出现非敏感说明文案、type/interface 名称或 redaction 逻辑。
- frontend/thread-ui 不出现会把 raw key 展示给用户的代码路径。

2026-06-03 本地验证：

- `rg -n "LocalAppShellNavContext|SharedAppShellNavContext|AppShellNavContext = createContext|createContext<AppShellNavContextValue" apps/supervisor-web/src packages/thread-ui/src -S` only reports `packages/thread-ui/src/app-shell/AppShellNavContext.tsx`.
- `rg -n "INACT_X_APP_KEY|ELAGENTE_HARNESS_ADMIN_KEY|keyCiphertext|apiKey" apps/supervisor-web packages/thread-ui -S` returned no matches.
- `node --check bin/remote-codex-plugin-mcp.mjs` passed.
- `pnpm --filter @remote-codex/supervisor-web typecheck` passed.
- `pnpm --filter @remote-codex/supervisor-web test -- src/pages/ControlPlaneSessionPage.test.tsx src/components/AppShellNavigation.test.tsx` passed through the supervisor-web dependency graph: 17 files, 263 tests.
- `pnpm --filter @remote-codex/supervisor-api typecheck` passed.
- `pnpm --filter @remote-codex/control-plane-api typecheck` passed.

## 1. Harness 生产 admin contract authenticated smoke

前置条件：

- 拿到真实 Harness `ADMIN_KEY`。
- 使用 `https://elagenteharness-production.up.railway.app`。
- smoke 脚本不得打印 `apiKey` 原文，只打印 `apiKeyPresent: true` / `keyChanged: true` 这类布尔证据。

推荐命令：

```bash
ELAGENTE_HARNESS_ADMIN_BASE_URL=https://elagenteharness-production.up.railway.app \
ELAGENTE_HARNESS_ADMIN_KEY=<actual Harness ADMIN_KEY> \
pnpm smoke:harness-admin-contract
```

要验证的生产接口：

- [ ] `GET /health` 返回 `ok`。
- [ ] `POST /admin/members/ensure` 第一次返回 `created: true`、`externalKeyId`、`externalUserId`、`apiKey` present。
- [ ] 同一 payload 第二次 ensure 返回 `created: false` 且 `externalKeyId` 不变。
- [ ] `POST /admin/members/reconcile` 返回 matching `externalKeyId`。
- [ ] `POST /admin/members/<externalKeyId>/rekey` 返回新 key，且不打印原文。
- [ ] `POST /admin/members/<externalKeyId>/revoke` 返回 `status: revoked`。
- [ ] `GET /admin/usage/export?limit=10` 返回 `{ events, nextCursor }` JSON。

完成标准：

- 生产 contract shape 与 Remote Codex `HttpHarnessAdmin` 期望一致。
- 未认证请求仍返回 `401 X-Admin-Key required`。
- smoke 输出和日志不包含 `apiKey` 原文。

## 2. Remote Codex 部署环境配置

Control-plane API 必需 env：

```text
ELAGENTE_HARNESS_BASE_URL=https://elagenteharness-production.up.railway.app
ELAGENTE_HARNESS_ADMIN_BASE_URL=https://elagenteharness-production.up.railway.app
ELAGENTE_HARNESS_ADMIN_KEY=<actual Harness ADMIN_KEY>
ELAGENTE_HARNESS_APP_KEY_SECRET_NAME=<k8s secret name>
ELAGENTE_HARNESS_PROVIDER=elagente-harness
ELAGENTE_HARNESS_LEGACY_ADMIN_FALLBACK=false
REMOTE_CODEX_CHEMISTRY_TOOLS_ENABLED=true
```

Kubernetes/RBAC：

- [ ] control-plane identity 可以 create/update configured Secret。
- [ ] control-plane identity 可以 read/check `data[<sandboxId>]`，或明确采用 start/restart rotate+rewrite 策略。
- [ ] worker pod spec 使用 `secretKeyRef` 注入 `INACT_X_APP_KEY`。
- [ ] Secret name 固定为 `ELAGENTE_HARNESS_APP_KEY_SECRET_NAME`。
- [ ] Secret key 固定为 sandbox id。

完成标准：

- start/restart sandbox 前能 ensure Harness key。
- `control_harness_keys.secret_name` 和 `secret_key` 与 Secret binding 一致。
- worker metadata 只显示 `keyPresent: true`，不显示 key。

K8s Secret/RBAC smoke：

```bash
HARNESS_K8S_NAMESPACE=<namespace> \
ELAGENTE_HARNESS_APP_KEY_SECRET_NAME=<secret name> \
HARNESS_K8S_SECRET_KEY=<sandbox id> \
pnpm smoke:harness-k8s-secret
```

完成标准：

- [ ] `harness_k8s_secret_rbac_get` 为 true。
- [ ] `harness_k8s_secret_rbac_patch` 为 true。
- [ ] `harness_k8s_secret_key_present` 为 true。
- [ ] smoke 输出只包含 Secret metadata 和 key presence，不包含 Secret data value。

## 3. Sandbox worker smoke

使用真实 running sandbox 验证：

完整证据命令：

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

局部调试可以少填低成本 invoke、MCP 或 UI artifact 命令，但完整
release evidence 不可以。collector 会把上述 Harness staging 变量都视为
required env。

- [x] `/api/worker/metadata` 显示 Harness enabled、chemistry enabled、key present at local worker-route test scope。
- [x] worker `/api/harness/status` 返回 ready/configured 状态 at local worker-route test scope。
- [x] worker `/api/harness/me` 能访问 Harness `/members/.me` at local worker-route test scope。
- [x] worker `/api/harness/modules/farmaco/help` 或 `tools` 可用 at local worker-route test scope。
- [x] worker error response 中不包含 `INACT_X_APP_KEY` at local worker-route test scope。
- [ ] Real deployed worker metadata shows Harness enabled、chemistry enabled、key present.
- [ ] Real deployed worker `/api/harness/status` returns ready/configured state.
- [ ] Real deployed worker `/api/harness/me` reaches Harness `/members/.me`.
- [ ] Real deployed worker `/api/harness/modules/farmaco/help` or `tools` is available.
- [ ] Real deployed worker error responses do not contain `INACT_X_APP_KEY`.

完成标准：

- worker runtime 没有因缺 `ELAGENTE_HARNESS_BASE_URL` 或 `INACT_X_APP_KEY` 启动失败。
- Harness key 只通过 worker client 使用。

2026-06-03 本地验证：

- `apps/supervisor-api/src/app.test.ts` includes `proxies worker Harness discovery calls with the injected app key`, covering `/api/worker/metadata`, `/api/harness/status`, `/api/harness/me`, `/api/harness/modules/farmaco/help`, `/tools`, `/runs`, `/runs/:runId`, `/artifacts`, `/download.zip`, and `/tools/:tool/invoke`.
- The same test verifies protected Harness calls carry the injected `X-Api-Key`, response JSON does not contain the raw key, normalized run/artifact shapes are returned, and worker-local invoke records usage metadata.
- `apps/supervisor-api/src/app.test.ts` includes `redacts the Harness key from worker Harness errors`, proving error text replaces the raw key with `[redacted]`.
- These local tests do not replace the required real deployed worker smoke through router/control-plane.

## 4. Codex MCP smoke

在真实 control-plane session 的 Codex thread 中验证：

`scripts/staging-phase-one-smoke.ts` 支持用 `STAGING_HARNESS_MCP_SMOKE_COMMAND`
提供 MCP worker-api live proof。该命令对完整 release evidence 是必需项，
应输出 JSON，且顶层 `source` 必须是 `worker-api`，否则
`harness_mcp_worker_api_smoke` step 会失败。

Live thread UI artifact proof 可通过 `STAGING_HARNESS_THREAD_ARTIFACT_UI_SMOKE_COMMAND` 提供。该命令应输出 JSON，且包含 `artifactTypes` 数组，例如：

```json
{
  "artifactTypes": ["elagente.harness.run"]
}
```

- [ ] Settings/plugin manager 中 `remote-codex.elagente-harness` enabled。
- [ ] Codex 能发现 `harness_status`、`harness_help`、`harness_list_tools`、`harness_invoke_tool`。
- [ ] 调用 `harness_status` 返回 `source: worker-api`。
- [ ] 调用 `harness_help` 或 `harness_list_tools` 成功。
- [ ] 调用一个低成本 `harness_invoke_tool` 成功。
- [ ] `harness_invoke_tool` 的 MCP result 不包含 `INACT_X_APP_KEY`。

失败判定：

- `harness_status` 返回 `source: direct-harness`，production smoke 不通过。
- worker API 不可用时 MCP 静默 fallback 到 direct Harness，production smoke 不通过。

完成标准：

- Codex tool path 为 `MCP -> worker-local API -> WorkerHarnessClient -> Harness`。
- tool invocation 后 control-plane usage/audit 能看到对应事件。

## 5. Usage、quota、audit smoke

Repository local coverage:

- [x] Harness user upsert is idempotent at lower-level repository test scope.
- [x] Harness key create/rotate/revoke lifecycle is covered at lower-level repository test scope.
- [x] Harness usage event duplicate `provider + externalEventId` idempotency is covered at lower-level repository test scope.
- [x] Harness repository audit metadata contains Secret binding metadata but not raw key material.

2026-06-03 本地验证：

- `pnpm --filter @remote-codex/control-plane-api test -- src/repository.test.ts` passed.
- `apps/control-plane-api/src/repository.test.ts` directly covers Harness user/key lifecycle, usage summary/list behavior, duplicate event idempotency, and non-secret audit metadata.

- [x] worker-local Harness invoke 带上 user/sandbox/workspace/session/thread/turn attribution at unit/integration-test scope。
- [x] control-plane internal `/api/internal/harness/usage-events` 记录事件 at unit/integration-test scope。
- [x] `GET /api/usage/harness/summary` 统计变化 at unit/integration-test scope。
- [x] `GET /api/usage/harness/events` 能看到 module/tool/run/job/status at unit/integration-test scope。
- [x] duplicate `provider + externalEventId` 不重复计费 at repository/integration-test scope。
- [x] estimated expensive job 会被 quota preflight 阻断 at control-plane and worker sync test scope。
- [x] `POST /api/admin/usage/harness/import` 能从 Harness `/admin/usage/export` 导入事件 at mocked Harness admin test scope。
- [ ] Real staging MCP `harness_invoke_tool` calls are attributed to user/sandbox/workspace/session/thread/turn.
- [ ] Real Harness-side production usage export/import is staging-tested.

完成标准：

- immediate worker event 和 Harness admin export/import 可并存。
- usage/audit 不依赖 frontend 直连 Harness。

2026-06-03 本地验证：

- `apps/supervisor-api/src/worker-control-plane-sync.test.ts` includes `records worker-local Harness usage events with worker identity`, proving worker sync sends user/sandbox/workspace/session/thread/turn metadata to `/api/internal/harness/usage-events`.
- `apps/control-plane-api/src/app.test.ts` includes `accepts internal worker Harness usage events and validates ownership`, proving the internal endpoint records events and rejects mismatched ownership.
- `apps/control-plane-api/src/app.test.ts` includes `records normalized Harness usage events for control-plane tool invocations`, proving summary/events, duplicate `provider + externalEventId` idempotency, audit logging, and quota preflight behavior for the control-plane proxy path.
- `apps/control-plane-api/src/app.test.ts` includes `imports Harness usage pulled from the configured Harness export adapter`, proving mocked Harness admin export/import.
- `apps/control-plane-api/src/quota.test.ts` covers `harness_compute_quota_exceeded` and `harness_spend_quota_exceeded`.
- `apps/supervisor-api/src/worker-control-plane-sync.test.ts` includes `checks Harness quota with worker identity before invocation`.
- These local tests do not replace the required real staging MCP invoke and production Harness export/import smoke gates.

## 6. Thread timeline / artifact 接入

已实现并需保持：

- [x] molecule-shaped Harness outputs 可生成 `remote-codex-artifact` fenced block。
- [x] molecule artifact type 使用 `chemistry.molecule3d`，复用 XYZ viewer。
- [x] worker run/artifact API 已返回 `normalized.runs`、`normalized.run`、`normalized.artifacts`。

待实现：

- [x] 在 `packages/plugin-elagente-harness` manifest 中声明 generic artifact type，例如 `elagente.harness.run`。
- [x] MCP 或 worker adapter 能把 Harness run/job metadata 输出为 `remote-codex-artifact` fenced block。
- [x] thread timeline 能通过 existing artifact fallback card 显示 Harness run artifact。
- [ ] 如需更好 renderer，在 main branch `@remote-codex/thread-ui` 或 plugin frontend module 中新增 renderer 后升级当前分支。
- [x] artifact payload 只包含 module/tool/run/job/status/download route 等 non-secret metadata。
- [ ] 用真实 staging Harness response 验证 live thread timeline 中 run/artifact card 出现。

完成标准：

- molecule output 显示 XYZ renderer。
- generic run/job 至少显示 title、summary、expandable metadata 或 download link；当前已有测试覆盖 extractor 插入，仍需 live staging UI smoke。
- 当前分支不复制 thread-ui renderer 源码。

## 7. Control-plane overview 收敛

- [x] Harness panel 只显示 readiness、module/tools/runs metadata、usage summary。
- [x] sandbox not running 时禁用 worker-backed Harness calls。
- [x] overview 不提供 arbitrary raw tool executor。
- [x] overview 不显示或编辑 Harness key/admin key。
- [x] account menu 中整合 LLM + Harness usage。

完成标准：

- overview 是 operator/status surface，不是 chemistry IDE。
- 所有数据来自 Remote Codex API，不来自 browser direct Harness call。

2026-06-03 本地验证：

- `rg -n "handleHarness|fetchControlPlaneHarness|/api/sandbox/harness|invoke|execute|run tool" apps/supervisor-web/src/pages/ControlPlanePage.tsx apps/supervisor-web/src/lib/api.ts -S` shows only status/module tools/runs/usage fetch paths, with no browser-side Harness invoke executor.
- `pnpm --filter @remote-codex/supervisor-web test -- src/pages/ControlPlanePage.test.tsx` passed through the supervisor-web dependency graph: 17 files, 264 tests.
- Added `ControlPlanePage > keeps Harness overview read-only and disabled until the sandbox is running`, which proves stopped sandbox UI does not request `/api/sandbox/harness/*`, does not show Harness base URL/tool/run data, does not show invoke/execute controls, and does not render `INACT_X_APP_KEY`.
- `pnpm --filter @remote-codex/supervisor-web typecheck` passed.

## 8. 安全扫描

扫描范围：

- frontend bundle
- control-plane public API response
- worker metadata
- thread messages
- MCP results
- logs

关键检查：

```bash
rg -n "sk-|INACT_X_APP_KEY|ELAGENTE_HARNESS_ADMIN_KEY|X-Api-Key|apiKey" apps/supervisor-web packages/thread-ui dist .local
```

完成标准：

- 只允许安全文案、字段名、redaction 代码、测试假值。
- 不允许出现真实 Harness user key、admin key、sub2api key 或其它 secret。

## 8.5. 总体验收 verifier

如果所有 live env 已在当前 operator shell 中配置好，可以先运行一键采集：

```bash
pnpm collect:harness-integration-evidence -- \
  --output-dir ./.temp/harness-evidence/latest
```

如果 live env 尚未配置，先生成私有 env 模板：

```bash
pnpm verify:harness-evidence-env -- \
  --write-env-template ./.temp/harness-evidence/harness.env.sh
```

填好并 source 后先检查：

```bash
pnpm verify:harness-evidence-env
```

当 admin smoke 和 staging smoke 都已经生成 JSON evidence 后，运行：

```bash
pnpm verify:harness-integration-evidence \
  --admin-smoke <harness-admin-smoke.json> \
  --staging-smoke <staging-phase-one-smoke.json> \
  --k8s-secret-smoke <harness-k8s-secret-smoke.json>
```

填好 non-secret evidence review 后，运行：

```bash
pnpm verify:harness-evidence-review -- \
  --review ./.temp/harness-evidence/evidence-review.json
```

完成标准：

- [ ] `harness-admin-contract` 为 true。
- [ ] `harness-worker-runtime` 为 true。
- [ ] `harness-secret-safety` 为 true，证明 K8s Secret smoke 没有打印 Secret data value，且 combined evidence 没有明显 raw secret pattern。
- [ ] `harness-usage-attribution` 为 true，且证明 invoke event 带 workspace/session attribution、module/tool/status、usage event id、`externalEventId`/`runId`/`jobId` 至少一个 provider event identity、usage summary event count 增加。
- [ ] `harness-mcp-worker-api` 为 true，且 evidence details 显示 `expectedSource=worker-api`、`observedSource=worker-api`、parsed stdout `source=worker-api`。
- [ ] `harness-thread-artifact-ui` 为 true，且 evidence details 包含 expected Harness artifact contract 和至少一个 observed Harness artifact type。
- [ ] `verify:harness-evidence-review` top-level `ok` 为 true。
- [ ] `secret_safety_reviewed` 为 true。

## 9. 可选：Claude/OpenCode provider 接入

- [ ] 确认 Claude/OpenCode 支持同一个 managed MCP server 或等价 tool config。
- [x] provider config 不包含 `INACT_X_APP_KEY` at worker startup config test scope。
- [ ] tool invocation 仍走 worker-local `/api/harness/*`。
- [ ] usage/audit 与 Codex 一样进入 control-plane。

完成标准：

- 多 provider 共用同一 Harness runtime boundary。
- 没有 provider-specific secret fork。

2026-06-03 本地验证：

- `apps/supervisor-api/src/app.test.ts` includes `writes gateway-backed provider config during worker startup`, which reads Codex, Claude, and OpenCode config files and asserts provider config does not contain `INACT_X_APP_KEY`, root provider keys, `sk-`, or real provider root key material.
- Existing managed MCP sync is currently Codex-config focused. Claude/OpenCode equivalent MCP tool config and real provider invocation are still unproven and remain unchecked.
