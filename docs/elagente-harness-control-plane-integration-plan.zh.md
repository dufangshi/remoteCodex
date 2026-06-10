# ElAgenteHarness Control Plane Integration Plan

本文档梳理当前 `sandbox-worker-control-plane` 分支里 ElAgenteHarness 接入相关代码的真实状态，并给出后续最优雅的接入方案。

目标不是再造一套单独的 chemistry 入口，而是把 Harness 纳入现有 Remote Codex control-plane / sandbox / worker / provider-runtime 的同一条生命周期：

1. control plane 管理产品用户、sandbox、credential metadata、审计和 quota。
2. sandbox 启动时只注入 scoped runtime credential。
3. worker 内部用标准 env 和受控 tool surface 调 Harness。
4. 前端只展示状态、workflow、artifact 和 usage，不接触 raw key。

## Desired Outcome

最终完成后，每个 sandbox worker 在启动时应内置知道：

- `ELAGENTE_HARNESS_BASE_URL`
- `INACT_X_APP_KEY`
- `REMOTE_CODEX_CHEMISTRY_TOOLS_ENABLED=true`

worker 里的 Codex / Claude Code / OpenCode 不应该拿到 Harness admin key，也不应该需要用户手动粘贴 key。agent 使用 chemistry 能力时，应通过受控的 Harness client/tool/MCP wrapper 访问：

- `GET /`
- `GET /members/.me`
- `GET /estructural/.help`
- `GET /quntur/.help`
- `GET /farmaco/.help`
- approved tool/workflow invocation endpoints

所有 Harness 请求都应带：

```http
X-Api-Key: $INACT_X_APP_KEY
```

`INACT_X_APP_KEY` 不应进入前端响应、日志、thread message、prompt、artifact metadata 或 Git。

## Current State

### Latest Verification Snapshot

Last verified in this worktree on 2026-06-03:

- `/home/u/dev/ElAgente/harness/ElAgenteHarness`: Harness main commit `bd0c1e16cc995881e551459cdac633b1e2b78adc` (`Wire Remote Codex Harness admin contract`) was created and pushed to `EvoEvolver/ElAgenteHarness` `origin/main` at 2026-06-03T07:59:44Z. This commit updates the Dockerfile `INACT_COMMIT` pin to `d2f3cbe1eff7879751b77278f23f24f22f2014c5`, updates the `src/inact` submodule pointer, and adds Harness admin contract tests. The Harness production service later began exposing the planned admin routes: public unauthenticated probes against `https://elagenteharness-production.up.railway.app/admin/members/ensure`, `/admin/members/reconcile`, `/admin/members/<externalKeyId>/rekey`, `/admin/members/<externalKeyId>/revoke`, and `/admin/usage/export?limit=1` now return `401 X-Admin-Key required` instead of `404 Not Found`. `GET /health` returns `ok`. Authenticated JSON smoke remains pending because local `railway status` reports an expired OAuth token and no linked project, and local `.env` does not contain `ADMIN_KEY`.
- `/home/u/dev/ElAgente/harness/ElAgenteHarness`: `uv run pytest tests/test_server.py -q` passed: 21 tests. This proves the local Harness server now exposes the planned `/admin/members/ensure`, `/admin/members/reconcile`, `/admin/members/<externalKeyId>/rekey`, `/admin/members/<externalKeyId>/revoke`, and `/admin/usage/export` routes on the mounted `/admin` prefix, with idempotent external-id ensure and Remote Codex-shaped usage export at local test scope.
- `/home/u/dev/ElAgente/harness/ElAgenteHarness`: `uv run pytest tests/test_server.py tests/test_compute_job_storage.py -q` passed: 36 tests after the Harness main commit.
- `/home/u/dev/ElAgente/harness/ElAgenteHarness`: `uv run pytest src/inact/tests/test_workspace_admin.py -q` passed: 3 tests after the Harness main commit.
- `/home/u/dev/ElAgente/harness/ElAgenteHarness`: `git diff --check -- Dockerfile tests/test_server.py src/inact` passed before commit.
- `pnpm --filter @remote-codex/control-plane-api test -- src/adapters.test.ts` passed: 99 tests across the control-plane test dependency graph. This proves `HttpHarnessAdmin` now prefers the planned Harness rotate/revoke/reconcile endpoints, preserves legacy 404 fallback, parses `externalKeyId` correctly when Harness also returns `externalUserId`, and keeps the Harness usage export/import adapter behavior stable under tests.
- `pnpm --filter @remote-codex/control-plane-api test -- src/adapters.test.ts src/config.test.ts` passed: 103 tests across the control-plane test dependency graph. This proves `ELAGENTE_HARNESS_LEGACY_ADMIN_FALLBACK=false` is parsed into config and passed to `HttpHarnessAdmin`, while the default remains compatibility mode. It also proves strict mode does not call legacy `/admin/create`, `/admin/<id>/rekey`, `/admin/<id>/delete`, or metadata-only reconcile when the planned Harness JSON routes return 404.
- `pnpm --filter @remote-codex/control-plane-api typecheck` passed.
- `pnpm --filter @remote-codex/control-plane-api test -- src/app.test.ts` passed: 99 tests.
- `pnpm --filter @remote-codex/control-plane-api typecheck` passed.
- `pnpm --filter @remote-codex/supervisor-api test -- src/app.test.ts` passed: 167 tests.
- `pnpm --filter @remote-codex/supervisor-api typecheck` passed.
- `pnpm --filter @remote-codex/supervisor-web test -- src/pages/ControlPlanePage.test.tsx` passed: 264 tests.
- `pnpm --filter @remote-codex/supervisor-web typecheck` passed.
- `pnpm --filter @remote-codex/db typecheck` passed.
- `pnpm --filter @remote-codex/plugin-runtime test` passed: 6 tests. This proves generic `elagente.harness.run` artifact fences declared by the Harness plugin can be extracted into thread timeline artifact items, and that MCP Harness invoke formatting emits a non-secret generic Harness run artifact fence.
- `pnpm --filter @remote-codex/plugin-runtime typecheck` passed.
- `pnpm --filter @remote-codex/plugin-elagente-harness typecheck` passed.
- `node --check bin/remote-codex-plugin-mcp.mjs` passed.
- `pnpm exec tsc --noEmit --allowJs false scripts/harness-admin-contract-smoke.ts` passed.
- `ELAGENTE_HARNESS_ADMIN_KEY=not-real-admin-key pnpm smoke:harness-admin-contract` returned structured redacted JSON with unauthenticated route-protection checks passing and authenticated ensure failing at `401 X-Admin-Key required`, without printing any key material. This proves the smoke script is runnable and redacts output; it does not replace the real-key authenticated smoke.
- `pnpm exec tsc --noEmit --allowJs false scripts/staging-phase-one-smoke.ts` passed after adding `STAGING_HARNESS_SMOKE=1` checks for worker Harness status, root discovery, module discovery, invoke usage, MCP `source: worker-api` evidence, and live thread artifact UI evidence. These are optional for local partial smoke but required for a complete release evidence bundle.
- `pnpm exec tsc --noEmit --allowJs false scripts/provider-gateway-smoke.ts scripts/staging-phase-one-smoke.ts scripts/harness-admin-contract-smoke.ts` passed.
- `pnpm test:phase-zero-six-evidence` passed: 65 tests. This verifies placeholder smoke env values are ignored without falling back to local provider config; `STAGING_HARNESS_SMOKE=1` records Harness worker status, root discovery, module discovery, invoke, usage-summary, MCP worker-api, and thread artifact UI evidence through the staging smoke script; `verify-harness-integration-evidence.ts` fails when worker runtime, secret safety, usage attribution, MCP worker-api, or live artifact UI evidence is incomplete; the Harness K8s Secret smoke records RBAC/key-presence evidence without printing Secret data values; `verify-harness-evidence-review.ts` requires live smoke paths plus explicit secret-safety signoff and all required Harness gates; `verify-harness-evidence-env.ts` reports only missing env names and can write a placeholder-only operator env template; `collect-harness-integration-evidence.ts` can collect a complete Harness evidence bundle when all required live env is present while safely reporting missing env names when it is not; and the collector can write a placeholder Harness env template without leaking current secret env values.
- `pnpm exec tsc --noEmit --allowJs false scripts/verify-harness-evidence-env.ts scripts/collect-harness-integration-evidence.ts scripts/verify-harness-evidence-review.ts scripts/harness-k8s-secret-smoke.ts scripts/verify-harness-integration-evidence.ts scripts/staging-phase-one-smoke.ts scripts/provider-gateway-smoke.ts scripts/harness-admin-contract-smoke.ts` passed.
- `pnpm --filter @remote-codex/plugin-runtime test` passed: 6 tests.
- `pnpm --filter @remote-codex/supervisor-api test -- src/app.test.ts` passed: 167 tests.
- `pnpm --filter @remote-codex/control-plane-api test -- src/app.test.ts` passed: 99 tests.
- `git diff --check` passed.
- AppShell nav/settings context was collapsed to a single source of truth: `apps/supervisor-web/src/components/AppShellNavContext.tsx` now re-exports `@remote-codex/thread-ui`, and `apps/supervisor-web/src/app.tsx` now mounts one `AppShellNavContext.Provider` instead of local/shared nested providers. `rg -n "LocalAppShellNavContext|SharedAppShellNavContext|AppShellNavContext = createContext|createContext<AppShellNavContextValue" apps/supervisor-web/src packages/thread-ui/src -S` now only reports `packages/thread-ui/src/app-shell/AppShellNavContext.tsx`.
- Frontend/thread-ui Harness secret scan `rg -n "INACT_X_APP_KEY|ELAGENTE_HARNESS_ADMIN_KEY|keyCiphertext|apiKey" apps/supervisor-web packages/thread-ui -S` returned no matches.
- `pnpm --filter @remote-codex/supervisor-web typecheck` passed after the single-context cleanup.
- `pnpm --filter @remote-codex/supervisor-web test -- src/pages/ControlPlaneSessionPage.test.tsx src/components/AppShellNavigation.test.tsx` passed through the supervisor-web dependency graph: 17 files, 263 tests.
- `ControlPlanePage` Harness overview was verified as an operator/status surface rather than a chemistry executor: the frontend code search shows only status/module tools/runs/usage fetch paths and no browser-side Harness invoke executor, and `pnpm --filter @remote-codex/supervisor-web test -- src/pages/ControlPlanePage.test.tsx` passed through the supervisor-web dependency graph with 17 files / 264 tests. The added stopped-sandbox test proves the UI does not request `/api/sandbox/harness/*`, does not show Harness base URL/tool/run data, does not show invoke/execute controls, and does not render `INACT_X_APP_KEY` before the sandbox is running.
- Harness usage/quota/audit local coverage was re-audited: `apps/supervisor-api/src/worker-control-plane-sync.test.ts` proves worker-local Harness usage sync sends user/sandbox/workspace/session/thread/turn metadata; `apps/control-plane-api/src/app.test.ts` proves internal `/api/internal/harness/usage-events` ownership validation, control-plane Harness invoke usage summary/events, duplicate `provider + externalEventId` idempotency, quota preflight, audit logging, and mocked Harness export/import; `apps/control-plane-api/src/quota.test.ts` covers Harness compute/spend quota reasons. These tests prove local/integration behavior, not the required live staging MCP invoke or production Harness export/import smoke.
- Claude/OpenCode provider config secret posture was re-audited at worker startup test scope: `apps/supervisor-api/src/app.test.ts` reads Codex, Claude, and OpenCode config files and asserts provider configs do not contain `INACT_X_APP_KEY`, provider root keys, `sk-`, or real provider root key material. Claude/OpenCode equivalent MCP tool config and real Harness invocation remain unproven.
- Worker Harness API local route coverage was re-audited: `apps/supervisor-api/src/app.test.ts` covers `/api/worker/metadata`, `/api/harness/status`, `/api/harness/me`, `/api/harness/modules/farmaco/help`, `/tools`, `/runs`, `/runs/:runId`, `/artifacts`, `/download.zip`, and `/tools/:tool/invoke`; it verifies protected Harness calls use the injected `X-Api-Key`, normalized run/artifact shapes are returned, worker-local invoke records usage metadata, and Harness error responses redact the raw key. This does not replace the required real deployed worker smoke through router/control-plane.
- Harness repository lower-level coverage was added: `pnpm --filter @remote-codex/control-plane-api test -- src/repository.test.ts` passed and directly covers Harness user upsert idempotency, sandbox key create/rotate/revoke, usage event duplicate `provider + externalEventId` idempotency, summary/list behavior, and non-secret audit metadata.
- Worker-local Harness usage attribution fallback was added and verified: `apps/supervisor-api/src/routes/system.ts` now enriches Harness invoke usage context from the local worker DB only when exactly one thread is `running`, filling missing `workspaceId`, `threadId`, and `turnId` from the running thread and latest turn metadata without inferring `sessionId`. Usage metadata now includes non-secret `attributionSource` values: `request-context`, `worker-inferred`, or `worker-runtime`. `pnpm --filter @remote-codex/supervisor-api test -- src/app.test.ts` passed with 9 files / 169 tests, including coverage that a single running thread is attributed, multiple running threads are not guessed, and attribution source metadata is recorded.
- Harness root discovery is now covered by the same worker/MCP boundary as other Harness calls: `WorkerHarnessClient.home()` calls Harness `GET /` with the worker-held app key, `GET /api/harness/home` exposes it through the worker API, MCP registers `harness_home` which prefers worker-local `/api/harness/home` before direct Harness dev fallback, and staging Harness smoke records `harness_worker_home` so the combined verifier requires deployed worker root discovery evidence. `pnpm --filter @remote-codex/supervisor-api test -- src/app.test.ts`, `pnpm --filter @remote-codex/supervisor-api typecheck`, `node --check bin/remote-codex-plugin-mcp.mjs`, and `pnpm --filter @remote-codex/plugin-elagente-harness typecheck` passed after this change.
- `pnpm --filter @remote-codex/supervisor-api typecheck` passed after the worker-local Harness attribution fallback.
- `pnpm --filter @remote-codex/supervisor-api typecheck` passed after the boundary rescan.
- `pnpm --filter @remote-codex/control-plane-api typecheck` passed after the boundary rescan.
- `pnpm verify:harness-evidence-env` was run in the current local shell. It exited non-zero as expected because live admin/staging/K8s env is missing. The generated report listed only missing env names and `secretSafety.valuesPrinted=false`; it did not print secret values. The missing required env names are: `ELAGENTE_HARNESS_ADMIN_BASE_URL`, `ELAGENTE_HARNESS_ADMIN_KEY`, `STAGING_CONTROL_PLANE_BASE_URL`, `STAGING_PRODUCT_JWT`, `STAGING_HARNESS_SMOKE`, `STAGING_HARNESS_MODULE`, `STAGING_HARNESS_INVOKE_TOOL`, `STAGING_HARNESS_INVOKE_INPUT_JSON`, `STAGING_HARNESS_MCP_SMOKE_COMMAND`, `STAGING_HARNESS_THREAD_ARTIFACT_UI_SMOKE_COMMAND`, `HARNESS_K8S_NAMESPACE`, `ELAGENTE_HARNESS_APP_KEY_SECRET_NAME`, and `HARNESS_K8S_SECRET_KEY`.
- `pnpm verify:harness-evidence-env -- --write-env-template ./.temp/harness-evidence/harness-readiness.env.sh` was run in the current local shell. It exited non-zero as expected because live env values are missing, and wrote a placeholder-only operator env template covering all required admin, staging, MCP/UI proof, and K8s inputs.
- `pnpm collect:harness-integration-evidence -- --output-dir ./.temp/harness-evidence/latest-local-missing-env` was run in the current local shell. It exited non-zero as expected because the required admin, staging, Harness invoke, MCP worker-api, thread artifact UI, and K8s Secret env values are missing. The generated summary reported only env names, output paths, and `secretSafety.valuesPrinted=false`; it did not print env values.
- `pnpm collect:harness-integration-evidence -- --output-dir ./.temp/harness-evidence/latest-local-template --write-env-template ./.temp/harness-evidence/harness.env.sh` was run in the current local shell. It exited non-zero as expected because live env values are missing, and wrote a placeholder env template containing env names and placeholders only.
- Public unauthenticated probes against `https://elagenteharness-production.up.railway.app` were rechecked on 2026-06-03: `GET /health` returned `200` with body `ok`, `POST /admin/members/ensure` returned `401 ERROR 401: X-Admin-Key required`, and `GET /admin/usage/export?limit=1` returned `401 ERROR 401: X-Admin-Key required`. This still proves route existence and protection, not authenticated contract shape.

This proves the current in-branch Harness lifecycle, worker Harness routes, Control Plane Harness panel, MCP registration syntax, worker-local MCP root discovery/status/help/tools/invoke usage sync, worker-local single-running-thread attribution fallback, Harness usage export/import client plumbing, Harness quota preflight, and Harness usage summary/event plumbing are test-stable at unit/integration-test scope. It also proves the control-plane can detect an existing Harness Secret binding through the secret writer and rotate/rewrite the sandbox Harness key when the Secret is missing, and that the MCP script syntax supports Harness molecule artifact normalization into the existing XYZ viewer artifact type. Worker Harness run/artifact APIs now preserve raw Harness `payload`/`text` while adding normalized `runs`, `run`, and `artifacts` shapes for downstream UI/timeline use. The Harness plugin now declares generic `elagente.harness.run` and `elagente.harness.artifact` artifact types, and MCP invoke results can emit non-secret generic Harness run/artifact fenced blocks for thread timeline fallback rendering. The Harness main repository now has the planned admin/usage JSON contract committed and pushed, and Remote Codex now prefers that planned contract while retaining legacy 404 fallback. The K8s Secret smoke and combined verifier now exist and are locally tested with fake evidence paths. This does not prove authenticated Railway production admin smoke, real cluster Secret RBAC, real Codex MCP smoke, or full end-to-end artifact/timeline rendering in a live thread.

### Implemented In This Branch

#### Control-plane config and lifecycle

[apps/control-plane-api/src/config.ts](/home/u/dev/remoteCodex/apps/control-plane-api/src/config.ts) 已支持 worker runtime config 和 admin provisioning config：

- `ELAGENTE_HARNESS_BASE_URL`
- `ELAGENTE_HARNESS_APP_KEY_SECRET_NAME`
- `REMOTE_CODEX_CHEMISTRY_TOOLS_ENABLED`
- `ELAGENTE_HARNESS_PROVIDER`
- `ELAGENTE_HARNESS_ADMIN_BASE_URL`
- `ELAGENTE_HARNESS_ADMIN_KEY`
- `ELAGENTE_HARNESS_LEGACY_ADMIN_FALLBACK`

其中 `REMOTE_CODEX_CHEMISTRY_TOOLS_ENABLED=true` 时会要求 `ELAGENTE_HARNESS_BASE_URL` 存在。这是合理的 fail-fast。`ELAGENTE_HARNESS_LEGACY_ADMIN_FALLBACK` 默认 `true`，用于迁移期兼容旧 Harness admin text/TOML routes；staging/prod 可设置为 `false`，让 planned JSON route 404 直接作为 provider failure，而不是继续调用旧 `/admin/create`、`/admin/<id>/rekey`、`/admin/<id>/delete` 或 metadata-only reconcile。

control plane 现在已经有 `HarnessAdmin` / `HttpHarnessAdmin` / `NoopHarnessAdmin`，并在 sandbox bootstrap/start/restart/admin restart 前执行 `ensureHarness(...)`：

```text
ensure Harness user -> ensure/rotate sandbox key -> write K8s Secret -> store metadata -> start worker
```

短期兼容 Harness 当前 admin API：

- 优先调用计划中的 `POST /admin/members/ensure`。
- 如果返回 404 且 `ELAGENTE_HARNESS_LEGACY_ADMIN_FALLBACK` 未禁用，则 fallback 到当前已有的 `POST /admin/create`。
- rotate/revoke/reconcile 优先调用计划中的 `/admin/members/*` JSON endpoints。
- 如果计划 endpoint 返回 404 且 legacy fallback 未禁用，rotate/revoke 仍 fallback 到当前 `/admin/<id>/rekey` 和 `/admin/<id>/delete`；reconcile 在有既有 external key id 时 fallback 为 metadata-only reconcile。

#### Sandbox start input and env injection

[apps/control-plane-api/src/adapters.ts](/home/u/dev/remoteCodex/apps/control-plane-api/src/adapters.ts) 的 `SandboxStartInput` 已有：

```ts
harness?: {
  baseUrl: string;
  appKeySecretName?: string | null;
  chemistryToolsEnabled?: boolean;
}
```

这和 LLM gateway 的 `gateway` input 同级，位置合理。

`AwsEksFargateSandboxManager.prepareSandboxEnvironment()` 已经会注入：

```text
ELAGENTE_HARNESS_BASE_URL=<configured base url>
REMOTE_CODEX_CHEMISTRY_TOOLS_ENABLED=true|false
```

并在有 `appKeySecretName` 时挂载：

```ts
INACT_X_APP_KEY: {
  secretName: input.harness.appKeySecretName,
  key: input.sandboxId,
}
```

也就是说现有设计已经假设：Kubernetes Secret 里同一个 secret name 下，每个 sandbox id 是一个 key，value 是该 sandbox 的 Harness `X-Api-Key`。

这个设计整体合理，因为：

- worker 不需要知道 admin credential。
- key 通过 Kubernetes Secret 注入，不走前端。
- 每个 sandbox 可独立 rotate/revoke。
- 与 gateway token secret injection 的形态一致。

`LocalWorkerProcessSandboxManager.prepareSandboxEnvironment()` 已经支持从 local `workerEnv.INACT_X_APP_KEY` 注入，适合本地 smoke。

#### Harness credential DB model

[packages/db/src/schema.ts](/home/u/dev/remoteCodex/packages/db/src/schema.ts) 和 migration `0025_control_harness_credentials.sql` 已新增：

- `control_harness_users`
- `control_harness_keys`

[apps/control-plane-api/src/repository.ts](/home/u/dev/remoteCodex/apps/control-plane-api/src/repository.ts) 已支持：

- `upsertHarnessUser`
- `upsertHarnessKey`
- `updateHarnessKeyRotation`
- `revokeHarnessKey`
- `getHarnessKeyForSandbox`
- `getHarnessUserForUser`

这些表只保存 non-secret external ids、status、rotation/revocation timestamps、Secret binding metadata，以及 nullable encrypted key metadata。public API 会 redact `apiKey` / `keyCiphertext`。

#### Kubernetes Secret writer

[apps/control-plane-api/src/adapters.ts](/home/u/dev/remoteCodex/apps/control-plane-api/src/adapters.ts) 已新增 `SandboxSecretWriter`，并让 AWS Kubernetes client 支持 `upsertSecretKey` 和 `hasSecretKey`。

当前写入形态：

```text
secret name = ELAGENTE_HARNESS_APP_KEY_SECRET_NAME
secret key  = sandbox.id
value       = Harness api_key
```

如果 chemistry enabled 且 admin provisioning/Secret write 失败，sandbox start/restart 会 fail closed 为 `harness_unavailable`，不会启动一个缺 key 的 worker。

当前还支持 Secret 存在性检查：

- `SandboxSecretWriter.hasSecretValue(...)`
- `AwsSandboxSecretWriter.hasSecretValue(...)`
- `KubectlAwsSandboxKubernetesClient.hasSecretKey(...)`

如果 DB 中已有 active Harness key 且 Secret binding 匹配，control-plane 会先检查 `secretName/sandboxId` 是否存在。存在时跳过 rotate；缺失时 rotate Harness key 并重新写入 Secret，然后再启动 worker。

#### Worker startup validation

[apps/supervisor-api/src/worker-environment.ts](/home/u/dev/remoteCodex/apps/supervisor-api/src/worker-environment.ts) 已经实现：

- provider runtimes 启用时要求 LLM gateway base URL/token。
- chemistry tools 启用时要求 `ELAGENTE_HARNESS_BASE_URL` 和 `INACT_X_APP_KEY`。
- Harness base URL 必须是合法 URL。
- worker startup metadata 只显示 `harnessConfigured` / `chemistryToolsEnabled`，不显示 key。

这是合理的 fail-closed 行为。

#### Runtime config

[packages/config/src/index.ts](/home/u/dev/remoteCodex/packages/config/src/index.ts) 已经解析：

- `ELAGENTE_HARNESS_BASE_URL`
- `INACT_X_APP_KEY`
- `REMOTE_CODEX_CHEMISTRY_TOOLS_ENABLED`

并暴露：

```ts
harnessBaseUrl
harnessEnabled
chemistryToolsEnabled
```

#### Log/API redaction

[apps/supervisor-api/src/app.ts](/home/u/dev/remoteCodex/apps/supervisor-api/src/app.ts) 已经 redacts：

- `INACT_X_APP_KEY`
- gateway token 等其它 secret

[apps/control-plane-api/src/app.ts](/home/u/dev/remoteCodex/apps/control-plane-api/src/app.ts) 已经 redacts：

- `ELAGENTE_HARNESS_ADMIN_KEY`
- `harnessAdminKey`
- `harnessKey.keyCiphertext`
- `*.harnessKey.keyCiphertext`
- `body.harnessKey.keyCiphertext`
- `payload.harnessKey.keyCiphertext`

#### Worker Harness API

[apps/supervisor-api/src/worker-harness-client.ts](/home/u/dev/remoteCodex/apps/supervisor-api/src/worker-harness-client.ts) 已新增 worker-side Harness client。它读取 worker env snapshot，不依赖 frontend 或 control plane route token，支持：

- `configured()`
- `health()`
- `me()`
- `help(module)`
- `listTools(module)`
- `invoke(module, tool, input)`

[apps/supervisor-api/src/routes/system.ts](/home/u/dev/remoteCodex/apps/supervisor-api/src/routes/system.ts) 已新增 worker API：

- `GET /api/harness/status`
- `GET /api/harness/me`
- `GET /api/harness/home`
- `GET /api/harness/modules/:module/help`
- `GET /api/harness/modules/:module/tools`
- `POST /api/harness/modules/:module/tools/:tool/invoke`

约束：

- module allowlist: `estructural`, `quntur`, `farmaco`
- tool name 必须是 URL-safe slug
- invoke body 必须是 JSON object
- 所有 protected Harness calls 都由 worker 加 `X-Api-Key`
- error text 会 redact `INACT_X_APP_KEY`

`/api/worker/metadata` 现在暴露 `keyPresent: boolean` 和 `chemistryToolsEnabled: boolean`，仍不显示 key。

#### Provider-visible MCP surface

新增 built-in plugin package：

- [packages/plugin-elagente-harness](/home/u/dev/remoteCodex/packages/plugin-elagente-harness)

并复用现有 managed MCP server：

- [bin/remote-codex-plugin-mcp.mjs](/home/u/dev/remoteCodex/bin/remote-codex-plugin-mcp.mjs)

Codex 可通过 `remote_codex_plugins` MCP server 发现：

- `harness_status`
- `harness_help`
- `harness_list_tools`
- `harness_invoke_tool`

MCP config 只写入非敏感 `REMOTE_CODEX_ENABLED_PLUGIN_IDS`，不会写入 `INACT_X_APP_KEY`。多个 plugins 共用同一个 MCP server 时会 dedupe，只生成一段 `[mcp_servers.remote_codex_plugins]`。

MCP tool runtime 现在优先调用 worker-local API：

```text
remote_codex_plugins MCP -> http://127.0.0.1:$PORT/api/harness/*
```

如果 worker 设置了 `REMOTE_CODEX_WORKER_AUTH_TOKEN`，MCP 本地调用会带 `x-remote-codex-worker-token`。Direct Harness fallback 已收紧为 development escape hatch：没有 worker API base URL 的外部本地运行仍可直连 Harness；一旦检测到 `REMOTE_CODEX_RUNTIME_ROLE=worker`、`REMOTE_CODEX_SANDBOX_ID` 或显式 `REMOTE_CODEX_WORKER_API_BASE_URL`，worker API 不可用会返回 MCP error，不会静默绕过到直连 Harness。非 worker 本地调试如果确实需要在显式 worker API base URL 失败后继续直连，必须设置 `REMOTE_CODEX_ALLOW_DIRECT_HARNESS_FALLBACK=true`。这个设计让生产期 module allowlist、tool name 校验、key 注入、错误 redaction、usage/quota/audit 都集中在 [apps/supervisor-api/src/worker-harness-client.ts](/home/u/dev/remoteCodex/apps/supervisor-api/src/worker-harness-client.ts) 和 [apps/supervisor-api/src/routes/system.ts](/home/u/dev/remoteCodex/apps/supervisor-api/src/routes/system.ts)。

### Still Not Implemented

#### Frontend Harness workflow/task/artifact state

Control Plane UI 目前已经有 Harness readiness/tools/runs 概览 panel。Worker API 现在已经在 raw Harness `payload`/`text` 旁边附加 normalized run/artifact shape，后续还需要把这些 normalized records 接入稳定的 Harness workflow/task/job timeline surface，并且应继续通过 Remote Codex API 展示，而不是前端直接访问 Harness admin 或 user key。

当前 worker 已能 invoke JSON tool，也能读取 runs/artifacts/download；Codex MCP invoke 对包含 `xyz`/`extxyz`/`pdb`/`cif` 分子结构的 Harness 结果会生成现有 `chemistry.molecule3d` artifact fence，从而复用 main/thread-ui 的 XYZ viewer。更通用的 run id、artifact links、compute job status 已经在 worker API 中初步正规化到 `normalized.runs`、`normalized.run`、`normalized.artifacts`。Harness plugin 也已经声明 `elagente.harness.run` / `elagente.harness.artifact`，MCP invoke 可以把 run/job/status/artifact metadata 投射为 `remote-codex-artifact` fenced block，让 thread timeline 至少使用现有 artifact fallback card 展示。真实 Harness response shape 和 live staging thread 渲染仍需验证。

#### Harness usage import

当前 gateway usage import 已比较完整。Harness 侧已经新增 `control_harness_usage_events`、用户 summary/events API，以及 control-plane Harness invoke proxy 的 normalized usage event 记录。

仍未完成的是：

- Harness 端真实生产接口提供稳定 usage export/webhook，并通过 staging smoke。
- 真实 Codex MCP staging thread 调用 Harness 后的 usage/audit smoke。
- quota preflight 已可在有估算 compute/cost 的 expensive Harness jobs 提交前阻断，仍需 staging 验证。
- thread/turn 级别 attribution 已作为 worker sync metadata 支持；worker-local route 还能在本地 DB 恰好一个 thread running 时保守补 workspace/thread/turn，不会在多 running thread 场景猜测。真实 provider thread smoke 仍需证明 staging MCP 调用能带上或推断正确 attribution。

#### Full staging smoke

真实 staging smoke 的输入已经简化为三层，不再需要 operator 手工准备一长串 `STAGING_*` 环境变量。

基础 worker Harness smoke：

- `ELAGENTE_HARNESS_ADMIN_KEY` 仍必须由私密 operator shell 提供，不能写入仓库、前端或 evidence JSON。
- `ELAGENTE_HARNESS_ADMIN_BASE_URL` 默认 `https://elagenteharness-production.up.railway.app`。
- `STAGING_CONTROL_PLANE_BASE_URL` 默认 `https://remote-codex-control-plane-production.up.railway.app`，不是 `https://debug.lnz-study.com`。
- `STAGING_PRODUCT_JWT` 不再需要手填；`scripts/staging-phase-one-smoke.ts` 会调用 `POST /api/auth/password/login`，默认使用 `dev@example.com` / dev password 换取 session token。需要覆盖时可设置 `STAGING_LOGIN_EMAIL` / `STAGING_LOGIN_PASSWORD` 或直接设置 `STAGING_PRODUCT_JWT`。
- `STAGING_HARNESS_SMOKE` 在 collector 中默认 `1`，`STAGING_HARNESS_MODULE` 默认 `farmaco`。

低成本 invoke release evidence：

- 只有在要证明真实 Harness invoke、usage attribution、quota/audit 闭环时才需要 `STAGING_HARNESS_INVOKE_TOOL` 和 `STAGING_HARNESS_INVOKE_INPUT_JSON`。
- 这两个值应选择 Harness 端明确安全、低成本、可重复的工具和输入；如果只是验证 worker 能看到 Harness status/home/tools，不应要求它们。

Codex agent/plugin/UI release evidence：

- `STAGING_HARNESS_MCP_SMOKE_COMMAND` 和 `STAGING_HARNESS_THREAD_ARTIFACT_UI_SMOKE_COMMAND` 不是 worker 访问 Harness API 的前置条件。
- 它们只用于证明 Codex 通过 managed plugin/MCP 的 `harness_*` tool path 调到 worker-local API，并证明 thread UI 能渲染 Harness artifact。
- 如果当前目标只是“sandbox 里的 agent 能通过 prompt 访问 Harness endpoint/API”，可以先用 prompt 驱动 agent 调 worker Harness tool/API，不需要先配置这些命令。

K8s Secret release evidence：

- `HARNESS_K8S_NAMESPACE` 默认 `remote-codex-staging`。
- `ELAGENTE_HARNESS_APP_KEY_SECRET_NAME` 默认 `remote-codex-harness-app-keys`。
- `HARNESS_K8S_SECRET_KEY` 通常是 staging smoke 输出里的 sandbox id；它用来证明 `data[<sandboxId>]` 存在，而不是读取或打印 secret value。
- K8s Secret proof 的意义是验证 per-sandbox scoped app key 真的被 control-plane 写入集群并注入 worker。部署配置可以保存 admin key、base URL、secret name，但不应保存一个全局 `INACT_X_APP_KEY` 给所有 sandbox 共用；否则会失去每个 sandbox 独立 revoke/rotate/audit 的能力。

完成 staging 后要验证 control-plane provisioning、Secret injection、worker metadata、worker Harness API、必要时的 Codex MCP 工具调用、artifact UI，以及 secret scan。

## Harness-Side Contract Observations

本地 `/home/u/dev/ElAgente/harness/ElAgenteHarness` 和线上 `https://elagenteharness-production.up.railway.app/` 当前形态：

- `/health` 返回 `ok`。
- 根页面列出 `/members/.help`、`/estructural/.help`、`/quntur/.help`、`/farmaco/.help` 等入口。
- 普通调用使用 `X-Api-Key`。
- `ELAGENTE_HARNESS_TOKEN` / `X-ElAgente-Harness-Token` 是可选 app-wide gate，不适合作为每个 sandbox 的身份。
- admin 操作存在 `X-Admin-Key` 保护的 `/admin/*` 路由：
  - `POST /admin/create`
  - `POST /admin/<id>/rekey`
  - `POST /admin/<id>/delete`
  - `POST /admin/<id>/update`
  - `GET /admin/list`

本地 Harness worktree 已新增并测试计划中的 JSON contract：

- `POST /admin/members/ensure`
- `POST /admin/members/reconcile`
- `POST /admin/members/<externalKeyId>/rekey`
- `POST /admin/members/<externalKeyId>/revoke`
- `GET /admin/usage/export`

这些 routes 已在本地 `tests/test_server.py` 中覆盖。生产部署 `https://elagenteharness-production.up.railway.app/` 仍需要发布和 staging smoke 后才能视为完成。

短期可以用这些 admin 路由实现 provisioning，但它们不是最优雅的长期 contract，因为缺少 idempotent ensure/reconcile：

- `POST /admin/create` 每次都会新建 member。
- 没有按 `externalId = remote-codex user/sandbox id` ensure 的语义。
- `admin/list` 会返回所有 `api_key`，不适合作为高频 reconcile API。

因此长期仍建议让 Harness 增加类似 gateway 的 admin contract。Remote Codex 当前代码已经有 `/admin/members/ensure` 优先路径，Harness 端补齐后可以自然切过去。

## Design Assessment

### Existing Design Is Correct And Should Stay

现有 Remote Codex 代码已经把 Harness 放在正确层级：

- control-plane config 决定 Harness 是否启用。
- sandbox start input 携带 Harness metadata。
- AWS pod env/secretEnv 注入 worker。
- worker 启动时 fail closed。
- runtime config 只暴露 non-secret metadata。
- worker API/MCP tool surface 由 worker 持有 secret，provider/frontend 不直接持有。

这些都应该保留。

### Main Remaining Gap Is Productization, Not Credential Lifecycle

现在不需要重写 env 注入方式，也不需要把 key 放进 prompt。credential lifecycle 的 phase-one implementation 已经存在。剩余主要是：

1. 真实 staging smoke 和部署环境配置。
2. Harness 端 idempotent ensure/reconcile/usage export contract 在生产部署中可用。
3. 把 Harness workflow/task/artifact 状态正规化到 Remote Codex UI。
4. usage/quota/audit attribution。
5. Claude/OpenCode 的 provider-visible tool surface 是否需要独立配置。

### Do Not Put Harness Key In Frontend Or Session Prompt

不建议把 key 放到：

- Control Plane frontend localStorage。
- route token payload。
- thread prompt/system prompt 明文。
- session/workspace/project DB 普通 metadata。

系统提示词可以告诉 agent “Harness tools are available”，但不应成为主要集成方式。正确做法是 worker 内置 tool/client，系统提示只描述非敏感使用方式。

### Prefer Gateway-Like Pattern

LLM gateway 已经形成合理模式：

```text
admin client -> repository metadata -> sandbox start input -> worker env/secret -> provider config -> usage import
```

Harness 应复用这个模式：

```text
harness admin client -> repository metadata -> K8s Secret -> sandbox start input -> worker env -> harness tool surface -> usage import
```

这样未来 billing、quota、audit、admin reconcile 都能复用同一套产品逻辑。

## Recommended Architecture

### 最优雅接入方式

当前分支不需要再引入一套新的 Harness frontend、也不需要把 Harness 做成浏览器直连服务。最优雅的边界应保持为：

```text
Control Plane
  -> provision/reconcile/revoke sandbox-scoped Harness credential
  -> write sandbox key into Kubernetes Secret
  -> start/restart sandbox worker with Harness metadata

Worker
  -> owns ELAGENTE_HARNESS_BASE_URL + INACT_X_APP_KEY
  -> exposes /api/harness/* as the only local Harness facade
  -> enforces module/tool allowlist and redaction

Provider runtime / Codex
  -> discovers managed MCP tools through the existing plugin system
  -> MCP calls worker-local /api/harness/*
  -> never receives admin credential and should not need raw Harness key in config

Frontend
  -> calls Remote Codex control-plane / sandbox proxy APIs
  -> shows status, runs, artifacts, usage, degraded states
  -> never calls Harness with INACT_X_APP_KEY
```

这条链路的优点：

- credential lifecycle 和 sandbox lifecycle 对齐，删除/重启/rotate 都有明确归属。
- worker 是唯一 runtime secret owner，secret 不扩散到 frontend、route token、thread message 或 plugin settings。
- MCP 插件仍然复用 `@remote-codex/thread-ui` 既有 settings/plugin 管理，不需要本分支维护 thread UI fork。
- Harness job/run/artifact 后续可以归一化成 Remote Codex timeline/artifact，而不是新建一套聊天界面。
- usage/quota/audit 可以在 control-plane 和 worker sync 之间补齐，不阻塞 phase-one tool 可用性。

因此后续集成原则是：继续收窄 `bin/remote-codex-plugin-mcp.mjs` 与 Harness raw key 的直接耦合，把真实产品能力放进 worker/control-plane API；不要把 Harness 特性塞进前端 prompt 或 thread UI 源码改动。

### Identity Model

推荐 phase 1 使用 sandbox-scoped Harness key：

```text
Remote Codex user 1 -> sandbox 1 -> Harness member/key 1
Remote Codex user 1 -> sandbox 2 -> Harness member/key 2
```

理由：

- sandbox 是 worker runtime 和 secret injection 的天然边界。
- sandbox delete/revoke 可以直接撤销 key。
- usage 能天然映射到 sandbox。
- 不同 sandbox 的泄漏 blast radius 更小。

长期可以再增加 user-level member，但 worker 使用的 key 仍建议 sandbox-scoped 或至少 sandbox-bound。

### External IDs

建议 Harness member external identity 使用稳定命名：

```text
externalUserId = remote-codex:user:<userId>
externalKeyId  = remote-codex:sandbox:<sandboxId>
name           = remote-codex-sandbox-<shortSandboxId>
kind           = agent
email          = optional user email
description   = Remote Codex sandbox <sandboxId> for user <userId>
```

如果 Harness 近期不能支持 external id 字段，则 Remote Codex DB 需要记录 Harness integer member id，并只在缺失时 create。

### Credential Storage

推荐新增 DB 表，形态参考 gateway：

```text
control_harness_users
  id
  user_id
  provider                 -- e.g. elagente-harness
  external_user_id          -- Harness member id or external id
  created_at

control_harness_keys
  id
  user_id
  sandbox_id
  provider
  external_key_id           -- Harness member id or external key id
  key_ciphertext            -- nullable; only when control plane receives raw key
  secret_name               -- K8s secret name
  secret_key                -- sandbox id
  status                    -- active/revoked
  created_at
  rotated_at
  revoked_at
```

Security note:

- If Harness returns raw `api_key`, control plane must either immediately write it to K8s Secret and avoid DB raw storage, or store encrypted ciphertext only.
- For staging simplicity, DB `key_ciphertext` may be nullable when K8s Secret is source of truth.
- Never return key material from public APIs.

### Kubernetes Secret Strategy

Use existing adapter assumption:

```text
secret name = ELAGENTE_HARNESS_APP_KEY_SECRET_NAME
secret key  = sandbox.id
value       = Harness api_key
```

Before `sandboxManager.startSandbox(...)`:

1. Ensure Harness key exists and is active.
2. Ensure K8s Secret contains `data[<sandboxId>]`.
3. Start worker pod.

If key provisioning or Secret write fails and `REMOTE_CODEX_CHEMISTRY_TOOLS_ENABLED=true`, sandbox start should fail with a clear `harness_unavailable` / `harness_key_unavailable` style error rather than starting a broken worker.

If chemistry tools are disabled, Harness key provisioning should be skipped.

### Worker Tool Surface

Phase 1 should not rely on free-form curl. Implement a small worker-side Harness client/wrapper:

- reads `ELAGENTE_HARNESS_BASE_URL` and `INACT_X_APP_KEY`
- redacts key in logs/errors
- supports discovery:
  - `harness_status`
  - `harness_help(module)`
  - `harness_list_tools(module)`
- supports a small allowlist of invocation endpoints:
  - `estructural`
  - `quntur`
  - `farmaco`

Best first surface:

1. A backend service in `apps/supervisor-api` for worker-only Harness calls.
2. A provider-visible MCP server or managed plugin wrapper that calls that service over worker-local HTTP.
3. Codex integration first, because current plugin/MCP management is strongest for Codex.
4. Claude/OpenCode later, or expose via their supported config once contract is clear.

Do not put `INACT_X_APP_KEY` into MCP config files. The preferred MCP path is:

```text
MCP harness_* tool -> worker-local /api/harness/* -> WorkerHarnessClient -> ElAgenteHarness
```

MCP 不是 Harness status/API 本身的必要前置。基础 runtime proof 可以直接证明 worker-local `/api/harness/*` 通过 `WorkerHarnessClient` 访问 Harness 部署端点，并且 key 只在 worker env 中存在。MCP proof 只在 release 目标宣称“Codex 可通过 managed plugin/tool 调 Harness”时才需要；此时要证明 source 是 `worker-api`，避免 MCP 进程静默走 direct Harness fallback。

Direct Harness calls from the MCP process are acceptable only as a development fallback when the MCP script is run outside a worker. Production agent/tool smoke should prove the worker-local path.

### Frontend Surface

Frontend should call Remote Codex APIs, not Harness directly:

- `GET /api/harness/status`
- `GET /api/harness/modules`
- `GET /api/harness/workflows`
- `GET /api/harness/tasks`
- `GET /api/harness/tasks/:id`
- `GET /api/harness/artifacts/:id`

These APIs should:

- enforce product auth
- map product user/sandbox/workspace/session
- never expose `INACT_X_APP_KEY`
- return degraded states when Harness is unavailable

### Usage And Quota

Harness usage should eventually enter the same usage ledger as gateway usage. Add source/type fields if needed:

```text
source = harness
provider = elagente-harness
model/workflow = farmaco|quntur|estructural:<tool>
costUsd
externalRequestId
occurredAt
userId
sandboxId
workspaceId?
sessionId?
```

Phase 1 can postpone billing, but the Harness key and invocation payload should carry enough metadata for later attribution:

- user id
- sandbox id
- workspace id, when available
- session id, when available

## Implementation Plan

### Phase 0: Keep Existing Env Contract

Status: implemented.

Do not change:

- `ELAGENTE_HARNESS_BASE_URL`
- `INACT_X_APP_KEY`
- `REMOTE_CODEX_CHEMISTRY_TOOLS_ENABLED`
- `SandboxStartInput.harness`
- AWS secretEnv key shape: secret key equals sandbox id

Only add missing lifecycle pieces.

Acceptance:

- Existing adapter and worker environment tests still pass.
- No frontend-exposed key material.

### Phase 1: Harness Admin Contract

Status: partially implemented in Remote Codex, pending Harness-side ideal contract.

Preferred long-term Harness contract:

```http
POST /admin/members/ensure
X-Admin-Key: <admin key>
Content-Type: application/json

{
  "externalId": "remote-codex:sandbox:<sandboxId>",
  "userId": "<remoteCodexUserId>",
  "sandboxId": "<sandboxId>",
  "name": "remote-codex-sandbox-<shortSandboxId>",
  "kind": "agent",
  "email": "<user email>",
  "description": "Remote Codex sandbox <sandboxId>"
}
```

Response:

```json
{
  "externalUserId": "...",
  "externalKeyId": "...",
  "apiKey": "...",
  "created": true
}
```

Also add:

```http
POST /admin/members/<externalKeyId>/rekey
POST /admin/members/<externalKeyId>/revoke
POST /admin/members/reconcile
GET  /admin/usage/export
```

Short-term fallback if Harness is not changed:

- Use `POST /admin/create` once.
- Store returned integer id and api key metadata in Remote Codex DB.
- Use `POST /admin/<id>/rekey` and `/delete` for rotation/revoke.
- Avoid repeated create by checking Remote Codex DB first.

Current branch behavior:

- `HttpHarnessAdmin` first tries `POST /admin/members/ensure`.
- If that endpoint is not present and `ELAGENTE_HARNESS_LEGACY_ADMIN_FALLBACK` is not disabled, it falls back to `POST /admin/create`.
- Existing DB metadata prevents repeated create for already-provisioned active sandbox keys.
- `HttpHarnessAdmin` now first tries planned JSON rotate/revoke/reconcile endpoints.
- If planned rotate/revoke endpoints are not present and legacy fallback is not disabled, it falls back to `/admin/<id>/rekey` and `/admin/<id>/delete`.
- If planned reconcile is not present, DB already has an external key id, and legacy fallback is not disabled, it falls back to metadata-only reconcile.
- `ELAGENTE_HARNESS_LEGACY_ADMIN_FALLBACK=false` disables all of those legacy fallback paths and makes a planned route 404 fail as a provider error.
- Local Harness worktree now implements the planned ensure/reconcile/rekey/revoke/usage export endpoints under tests. Production deployment still needs rollout and smoke.

Acceptance:

- [x] Mocked Harness admin client tests cover ensure/rotate/revoke/reconcile.
- [x] Harness unavailable maps to stable control-plane error.
- [x] Local Harness worktree implements idempotent `POST /admin/members/ensure`.
- [x] Local Harness worktree implements planned reconcile/rekey/revoke aliases.
- [x] Local Harness worktree implements `GET /admin/usage/export` with Remote Codex-shaped events.
- [x] Harness main repo commit `bd0c1e16cc995881e551459cdac633b1e2b78adc` pins the production Dockerfile to the inact commit containing the planned admin/usage contract and was pushed to `origin/main`.
- [x] Remote Codex `HttpHarnessAdmin` prefers planned JSON rotate/revoke/reconcile endpoints and keeps 404 fallback.
- [x] Remote Codex parses `externalKeyId` correctly when Harness responses also include `externalUserId`.
- [x] Remote Codex can disable legacy text/TOML fallback for Harness admin through `ELAGENTE_HARNESS_LEGACY_ADMIN_FALLBACK=false`.
- [~] Harness-side ideal idempotent admin contract routes exist in production. Unauthenticated probes on 2026-06-03 now return `401 X-Admin-Key required` for `/admin/members/ensure`, `/admin/members/reconcile`, `/admin/members/<externalKeyId>/rekey`, `/admin/members/<externalKeyId>/revoke`, and `/admin/usage/export?limit=1`; authenticated JSON contract smoke is still pending.
- [ ] Remote Codex production configuration sets `ELAGENTE_HARNESS_LEGACY_ADMIN_FALLBACK=false`, or production no longer needs text/TOML fallback for Harness admin.

### Phase 2: Control-plane Harness Admin Client

Status: implemented in Remote Codex. The real Harness production endpoint still needs staging verification.

Add config:

```text
ELAGENTE_HARNESS_ADMIN_BASE_URL
ELAGENTE_HARNESS_ADMIN_KEY
ELAGENTE_HARNESS_PROVIDER=elagente-harness
ELAGENTE_HARNESS_LEGACY_ADMIN_FALLBACK=false
```

`ELAGENTE_HARNESS_BASE_URL` remains the worker/user API base URL. In staging they may be the same host.

Add services:

```ts
interface HarnessAdmin {
  ensureUser(...)
  ensureSandboxKey(...)
  rotateSandboxKey(...)
  revokeSandboxKey(...)
  reconcileSandboxKey(...)
  exportUsage(...)
}
```

Mirror `LlmGatewayAdmin` naming and behavior.

Acceptance:

- [x] Control-plane log redaction paths redact admin key and Harness key ciphertext.
- [x] Unit tests verify request URLs, headers, payloads, and error mapping.
- [x] `HarnessAdmin.exportUsage(...)` exists and is wired to the planned stable Harness endpoint path.
- [x] Local Harness worktree exposes the matching stable `GET /admin/usage/export` endpoint under tests.
- [x] Harness main repo with Dockerfile/submodule pin for that endpoint was pushed to `origin/main`.
- [~] Real Harness production deployment exposes the matching stable `GET /admin/usage/export` route and protects it with `X-Admin-Key`; authenticated response-shape smoke is still pending.

### Phase 3: DB Schema And Repository

Status: implemented.

Add migration for:

- `control_harness_users`
- `control_harness_keys`

Add repository methods:

- `upsertHarnessUser`
- `upsertHarnessKey`
- `getHarnessKeyForSandbox`
- `updateHarnessKeyRotation`
- `revokeHarnessKey`

Mirror gateway repository methods where possible.

Acceptance:

- [x] Repository behavior is covered through control-plane app tests.
- [x] Audit logs record non-sensitive external ids only.
- [x] Lower-level Harness repository tests cover user/key lifecycle, usage idempotency, summary/list behavior, and audit metadata.

Future note:

- If a separate active sandbox binding field is added later, revocation should clear that binding. The current schema has no separate active binding field; revocation updates `control_harness_keys.status` and `revoked_at`.

### Phase 4: K8s Secret Writer

Status: implemented for AWS/Kubernetes via `upsertSecretKey`; local worker still uses explicit local `workerEnv.INACT_X_APP_KEY`.

Add a small abstraction rather than burying this in route handlers:

```ts
interface SandboxSecretWriter {
  putSecretValue(input: {
    namespace: string;
    secretName: string;
    key: string;
    value: string;
  }): Promise<void>;
  hasSecretValue?(input: {
    namespace: string;
    secretName: string;
    key: string;
  }): Promise<boolean>;
  deleteSecretValue?(...)
}
```

For AWS/Kubernetes:

- patch existing Secret when present
- create Secret when missing
- check whether a Secret key is present before reusing an active DB key
- avoid logging raw `value`

Alternative: extend `AwsSandboxKubernetesClient` with `upsertSecretKey`.

Recommended flow before worker start/restart:

```text
ensureHarness(app, user, sandbox)
ensureSandboxHarnessSecret(app, sandbox, harnessKey)
sandboxManager.startSandbox(..., harness: harnessStartInput(app))
```

Acceptance:

- [x] Unit tests assert K8s Secret writer receives `secretName`, `key=sandboxId`, not raw key in logs.
- [x] Start fails closed when chemistry enabled and Secret write fails.
- [x] Secret writer can verify whether `secretName/sandboxId` still exists before start.
- [x] Missing Secret can be recovered by forced rotate and rewrite before worker start.
- [ ] Real staging cluster RBAC proves the Secret read path works outside unit tests.

### Phase 5: Provisioning Flow

Status: implemented for bootstrap/start/restart/admin restart/admin harness-key endpoints.

Add `ensureHarness(app, user, sandbox)` analogous to `ensureGateway`.

Call it in:

- `/api/me/bootstrap`
- `/api/sandbox/start`
- `/api/sandbox/restart`
- admin sandbox restart/reconcile endpoints

Do not provision on `/api/auth/register`; a user can register without a sandbox. Provisioning belongs to bootstrap/sandbox lifecycle.

Important behavior:

- If chemistry disabled: no-op.
- If chemistry enabled but admin config missing: startup should fail with config error.
- If existing active key exists and Secret exists: no-op.
- If DB has key but Secret missing: rotate Harness key and rewrite Secret.
- If Harness rejects key: reconcile or surface stable error.

Acceptance:

- [x] Existing bootstrap still works when Harness disabled.
- [x] Tests cover Harness enabled start/restart attaching metadata and writing secret.
- [x] Tests cover Harness provisioning failure.
- [x] Tests cover existing DB key with present K8s Secret skipping rotation.
- [x] Tests cover existing DB key with missing K8s Secret rotating and rewriting the key.
- [ ] Staging smoke proves the same recovery path against real Kubernetes.

### Phase 6: Worker Harness Client

Status: implemented.

Add worker-side Harness client:

```ts
class WorkerHarnessClient {
  status()
  me()
  help(module)
  listTools(module)
  invoke(module, tool, input)
}
```

Rules:

- Uses `config.harnessBaseUrl`.
- Uses the app env snapshot for `INACT_X_APP_KEY`.
- Adds `X-Api-Key`.
- Redacts key from errors.
- Enforces allowlisted modules/endpoints.

Add worker API diagnostics:

- `GET /api/harness/status`
- `GET /api/harness/me`
- `GET /api/harness/modules/:module/help`
- `GET /api/harness/modules/:module/tools`
- `POST /api/harness/modules/:module/tools/:tool/invoke`

Acceptance:

- [x] Worker-to-Harness mocked tests cover auth header and redaction.
- [x] `/api/worker/metadata` continues not to leak keys.
- [x] Worker API includes status, me, root discovery, help, tools, runs, run detail, artifacts, artifact zip download, and invoke routes.

### Phase 7: Provider Tool Surface

Status: implemented for Codex managed MCP config, plugin settings, worker-local Harness API preference, production guard against automatic direct Harness fallback, and optional non-secret attribution context passthrough from MCP to worker-local Harness invoke; still needs staging thread smoke and live usage attribution.

Preferred first implementation:

- Add a managed MCP server or plugin-backed tool surface for Codex.
- The tool process calls supervisor worker APIs over `http://127.0.0.1:$PORT/api/harness/*`.
- Direct Harness calls from the MCP process remain only as local/dev fallback. Worker runtime and explicit worker API base URL paths do not silently fall back to direct Harness when the worker API is unavailable.
- Tool names should be explicit:
  - `harness_status`
  - `harness_home`
  - `harness_help`
  - `harness_list_tools`
  - `harness_invoke_tool`

Then extend to Claude/OpenCode once config support is confirmed.

Prompt/system injection should be secondary:

- mention available Harness modules
- explain that tools should be used
- never include `INACT_X_APP_KEY`

Acceptance:

- [x] Codex managed MCP config includes one deduped `remote_codex_plugins` server.
- [x] MCP tool registration is gated by `REMOTE_CODEX_ENABLED_PLUGIN_IDS`, so disabling the Harness plugin disables Harness tools.
- [x] MCP/tool config does not contain raw key.
- [x] MCP tools prefer worker-local `/api/harness/*` and include `REMOTE_CODEX_WORKER_AUTH_TOKEN` only as worker API auth when configured.
- [x] MCP direct Harness fallback is disabled for worker runtime paths; `REMOTE_CODEX_ALLOW_DIRECT_HARNESS_FALLBACK=true` is only honored outside worker runtime.
- [x] Worker-local Harness invoke reports usage/audit to the control-plane internal Harness usage endpoint when sync is configured.
- [x] MCP `harness_invoke_tool` forwards optional non-secret `REMOTE_CODEX_WORKSPACE_ID`, `REMOTE_CODEX_SESSION_ID`, `REMOTE_CODEX_THREAD_ID`, and `REMOTE_CODEX_TURN_ID` into worker-local `_remoteCodexContext` when those env values are provided.
- [x] MCP `harness_home` exposes Harness `GET /` through worker-local `/api/harness/home`.
- [x] `node --check bin/remote-codex-plugin-mcp.mjs` passes.
- [ ] Real staging Codex thread calls `harness_status`.
- [ ] Real staging Codex thread calls one lightweight `harness_help`/`harness_list_tools`.
- [ ] Real staging Codex `harness_invoke_tool` records usage/audit through worker/control-plane with user/sandbox/workspace/session/thread attribution.

### Phase 8: Frontend And Product UI

Status: partially implemented for read-only Harness discovery/status.

Add Control Plane UI panels after backend is stable:

- Harness configured state.
- Chemistry tools enabled state.
- Workflow/module list.
- Task/job status.
- Artifact links/previews.

Use Remote Codex APIs. Do not call Harness from browser with user key.

Implemented in this branch:

- Worker read-only Harness routes now include:
  - `GET /api/harness/status`
  - `GET /api/harness/me`
  - `GET /api/harness/modules/:module/help`
  - `GET /api/harness/modules/:module/tools`
  - `GET /api/harness/modules/:module/runs`
  - `GET /api/harness/modules/:module/runs/:runId`
  - `GET /api/harness/modules/:module/runs/:runId/artifacts`
  - `GET /api/harness/modules/:module/runs/:runId/download.zip`
- Control-plane user API proxies the read-only Harness status/module/run/artifact routes through the running sandbox worker.
- Worker Harness run/artifact routes preserve raw Harness response data and add normalized records:
  - `GET /api/harness/modules/:module/runs` returns `normalized.runs[]`.
  - `GET /api/harness/modules/:module/runs/:runId` returns `normalized.run`.
  - `GET /api/harness/modules/:module/runs/:runId/artifacts` returns `normalized.artifacts[]`.
  - Normalized run records include module, run id, job id, tool, status, title, timestamps, artifact count, and artifact refs.
  - Normalized artifact records include module, run id, title, path, type/format, MIME type, size, download URL, and preview kind.
- Control-plane overview UI now shows a compact Harness panel:
  - readiness state
  - base URL
  - key-present state without showing the key
  - chemistry enabled state
  - module selector
  - tools list
  - recent runs list
  - degraded/unavailable state
- Codex MCP `harness_invoke_tool` normalizes molecule-shaped Harness outputs into standard `remote-codex-artifact` fenced blocks with artifact type `chemistry.molecule3d`, so existing `@remote-codex/thread-ui` / XYZ viewer rendering can pick them up without a local thread UI fork.

Remaining:

- [x] Project normalized generic Harness run/job/artifact metadata into Remote Codex artifact fenced blocks for existing timeline fallback rendering.
- [ ] Validate generic Harness run/job/artifact timeline rendering in a live staging thread with real Harness responses.
- Add end-to-end staging smoke with a real running sandbox and real Harness deployment.

Acceptance:

- [x] User sees degraded state if Harness unavailable in tested Control Plane UI states.
- [x] User never sees `INACT_X_APP_KEY` in tested UI/API snapshots.
- [x] ControlPlanePage Harness usage summary/event tests pass.
- [x] Worker Harness runs/artifacts routes add normalized run/artifact records while preserving raw Harness payloads in tests.
- [x] Control-plane Harness proxy preserves worker normalized run/artifact records in tests.
- [x] Harness plugin declares generic `elagente.harness.run` / `elagente.harness.artifact` artifact types.
- [x] Codex MCP invoke can emit non-secret generic Harness run/artifact fenced blocks for existing thread timeline fallback rendering.
- [x] Plugin artifact extraction tests cover generic Harness run artifact insertion into thread timeline items.
- [ ] Staging UI smoke proves the same behavior with a real running sandbox and Harness deployment.

### Phase 9: Usage, Quota, Audit

Status: partially implemented.

Add normalized Harness usage events:

- workflow/tool name
- request id
- cost or compute units
- user/sandbox/workspace/session
- occurredAt

Add importer or webhook receiver:

- polling `HarnessAdmin.exportUsage`, or
- internal webhook endpoint from Harness

Implemented in this branch:

- `control_harness_usage_events` schema and migration.
- `recordHarnessUsageEvent(...)` repository method.
- user-facing `GET /api/usage/harness/summary`.
- user-facing `GET /api/usage/harness/events`.
- control-plane Harness invoke proxy records normalized event fields:
  - provider
  - module
  - tool
  - run id
  - job id
  - external event id
  - compute units
  - cost USD
  - status
- duplicate `provider + externalEventId` records are idempotent.
- worker-local Harness invoke route records normalized usage through `WorkerControlPlaneSyncClient` when called by MCP/provider runtimes.
- internal `POST /api/internal/harness/usage-events` validates worker user/sandbox/workspace/session ownership and records thread/turn metadata when provided.
- `HarnessAdmin.exportUsage(...)` imports exported Harness usage into `control_harness_usage_events`.
- admin `POST /api/admin/usage/harness/import` and internal scheduled `POST /api/internal/jobs/harness-usage-import` are wired to the Harness usage importer.
- Harness quota preflight checks estimated compute/cost before control-plane and worker-local Harness invocation when estimates are provided.
- account menu includes Harness usage summary and recent Harness events.

Remaining:

- Real Harness-side production `exportUsage` endpoint still needs staging smoke.
- Quota preflight still needs real staging smoke with production profile limits and provider-supplied estimates.
- Real staging Codex MCP invoke smoke still needs to prove thread/turn attribution from provider runtime context.

Acceptance:

- [x] Duplicate events are idempotent for control-plane Harness invoke proxy.
- [x] Usage summary includes Harness rows.
- [x] User-facing Harness usage event list is tested.
- [x] Worker-local Harness invoke sync records usage through the control-plane internal endpoint in tests.
- [x] Harness-side usage export/import client path is implemented and tested against a mocked Harness admin.
- [x] Quota checks can block estimated expensive Harness jobs before invocation in control-plane and worker-local API tests.
- [x] MCP worker invoke payload construction can include workspace/session/thread/turn attribution fields without including Harness secrets.
- [x] Worker-local Harness invoke can conservatively infer workspace/thread/turn from the single running local thread when `_remoteCodexContext` is missing.
- [x] Worker-local Harness invoke does not infer workspace/thread/turn when multiple local threads are running.
- [x] Worker-local Harness usage metadata marks non-secret attribution source as `request-context`, `worker-inferred`, or `worker-runtime`.
- [ ] Real staging MCP `harness_invoke_tool` calls are attributed to user/sandbox/workspace/session/thread/turn.
- [ ] Real Harness-side production usage export/import is staging-tested.

### Phase 10: Staging Smoke

Status: not completed.

Staging smoke should verify:

1. Control plane can ensure Harness key.
2. K8s Secret contains sandbox key, and the control-plane Secret existence check can read it.
3. Worker starts with chemistry enabled.
4. Worker `/api/worker/metadata` shows Harness enabled and no key.
5. Worker `/api/harness/me` can call Harness `/members/.me`.
6. Worker `/api/harness/home` can call Harness `GET /` root discovery.
7. Codex can call `harness_status`.
8. One lightweight module help/list-tools call succeeds.
9. Secret scan finds no `INACT_X_APP_KEY` in frontend, logs, API responses, thread messages.

Use the staging phase-one smoke with Harness checks enabled:

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

For local partial smoke, it is acceptable to omit the low-cost invoke, MCP, or
thread artifact command. For complete release evidence and
`pnpm collect:harness-integration-evidence`, all Harness staging variables above
are required.

Verify the live K8s Secret/RBAC evidence separately. This smoke prints only Secret metadata and key presence; it does not print Secret data values:

```bash
HARNESS_K8S_NAMESPACE=<namespace> \
ELAGENTE_HARNESS_APP_KEY_SECRET_NAME=<secret name> \
HARNESS_K8S_SECRET_KEY=<sandbox id> \
pnpm smoke:harness-k8s-secret
```

The K8s Secret smoke must prove:

- `harness_k8s_secret_rbac_get`
- `harness_k8s_secret_rbac_patch`
- `harness_k8s_secret_key_present`

Low-cost Harness invoke evidence is required for the complete collector bundle.
The selected tool should be cheap, deterministic enough for smoke, and should
return at least one provider event identity such as `externalEventId`, `runId`,
or `jobId`.

MCP worker-api evidence is collected with `STAGING_HARNESS_MCP_SMOKE_COMMAND`.
The command must emit JSON with top-level `source: "worker-api"` so the
`harness_mcp_worker_api_smoke` step proves the production MCP path did not fall
back to direct Harness. This command is required for the complete collector
bundle; omitting it is only acceptable for local partial smoke.

Live thread UI artifact evidence is collected with
`STAGING_HARNESS_THREAD_ARTIFACT_UI_SMOKE_COMMAND`. The command is required for
the complete collector bundle and must emit JSON with `artifactTypes`
containing at least one of:

- `elagente.harness.run`
- `elagente.harness.artifact`
- `chemistry.molecule3d`

After admin, staging, and K8s Secret smoke artifacts are available, verify the combined Harness acceptance gates with:

```bash
pnpm verify:harness-integration-evidence \
  --admin-smoke <harness-admin-smoke.json> \
  --staging-smoke <staging-phase-one-smoke.json> \
  --k8s-secret-smoke <harness-k8s-secret-smoke.json>
```

The combined verifier requires all of these gates:

- `harness-admin-contract`, including route protection, ensure/idempotent/reconcile/rekey/revoke details, usage export shape, and redacted key fields
- `harness-worker-runtime`, including K8s Secret RBAC/key presence, staging sandbox/router readiness, `harness_worker_status` details proving `enabled=true`, `keyPresent=true`, `chemistryToolsEnabled=true`, a non-empty Harness base URL, and `farmaco` in `modules`, plus non-empty `harness_worker_home` and module discovery responses
- `harness-secret-safety`, including K8s Secret smoke `secretSafety.valuePrinted=false` and a combined admin/staging/k8s evidence scan with no obvious raw bearer/JWT/provider key/AWS/GitHub token or `INACT_X_APP_KEY=<value>` patterns
- `harness-usage-attribution`, including workspace/session attribution, module/tool/status, a usage event id, at least one provider event identity (`externalEventId`, `runId`, or `jobId`), and increased usage event count
- `harness-mcp-worker-api`, with evidence details showing `expectedSource=worker-api`, `observedSource=worker-api`, and parsed command stdout `source=worker-api`
- `harness-thread-artifact-ui`, with evidence details showing the expected Harness artifact contract and at least one observed Harness artifact type

For the exact evidence collection sequence and a non-secret evidence review template, use:

- [ElAgenteHarness Evidence Runbook](./elagente-harness-evidence-runbook.zh.md)
- [ElAgenteHarness Evidence Template](./elagente-harness-evidence-template.json)

After filling the evidence review template, run:

```bash
pnpm verify:harness-evidence-review -- \
  --review ./.temp/harness-evidence/evidence-review.json
```

If all required live env is available in the operator shell, the whole evidence bundle can also be collected with:

```bash
pnpm collect:harness-integration-evidence -- \
  --output-dir ./.temp/harness-evidence/latest
```

To generate a private operator env template for those live values:

```bash
pnpm verify:harness-evidence-env -- \
  --write-env-template ./.temp/harness-evidence/harness.env.sh
```

After filling and sourcing the template, verify env readiness before collecting:

```bash
pnpm verify:harness-evidence-env
```

Before Remote Codex staging smoke, run the Harness production admin contract smoke with the real Harness admin key:

```bash
ELAGENTE_HARNESS_ADMIN_BASE_URL=https://elagenteharness-production.up.railway.app \
ELAGENTE_HARNESS_ADMIN_KEY=<actual Harness ADMIN_KEY> \
pnpm smoke:harness-admin-contract
```

The script verifies route protection, idempotent ensure, reconcile, rekey, revoke, and usage export response shape. It redacts `apiKey` values and reports only booleans such as `apiKeyPresent` and `keyChanged`.

The combined verifier now treats the admin smoke as valid only when the evidence includes these non-secret details:

- unauthenticated `/admin/members/ensure` and `/admin/usage/export?limit=1` steps are `ok`.
- ensure details include `apiKeyPresent: true`, a non-empty `externalKeyId`, and redacted body key fields.
- idempotent ensure details include `created: false`, `apiKeyPresent: true`, a non-empty `externalKeyId`, and redacted body key fields.
- reconcile details include a non-empty `externalKeyId` and redacted key fields.
- rekey details include `apiKeyPresent: true`, `keyChanged: true`, a non-empty `externalKeyId`, and redacted body key fields.
- usage export details include numeric `eventCount` and `nextCursorPresent: true`.
- revoke details include `status: "revoked"`.

If any admin smoke body contains a non-redacted `apiKey`, `api_key`, `key`, `token`, or `secret` field, `harness-admin-contract` fails even if all step names are marked `ok`.

Current completion audit:

- [x] Harness admin routes exist and are protected at production route-existence level: unauthenticated probes return `401`, not `404`.
- [ ] Authenticated Harness production admin smoke with a real `ADMIN_KEY` has not been run in this workspace.
- [ ] Remote Codex staging/prod Harness env has not been proven live.
- [ ] Real K8s Secret/RBAC smoke has not been run against the deployment namespace.
- [ ] Real worker metadata has not proven `keyPresent: true` for a deployed sandbox.
- [ ] Real Codex MCP smoke has not proven `source: worker-api`.
- [ ] Real low-cost `harness_invoke_tool` has not proven usage/audit attribution.
- [ ] Live thread UI has not proven Harness artifact rendering.
- [ ] `pnpm verify:harness-integration-evidence` has not been run with real admin/staging/k8s evidence returning `ok: true`.

## Proposed File-Level Work

### Remote Codex

Touched in this branch:

- `apps/control-plane-api/src/config.ts`
- `apps/control-plane-api/src/adapters.ts`
- `apps/control-plane-api/src/app.ts`
- `apps/control-plane-api/src/repository.ts`
- `apps/control-plane-api/src/*.test.ts`
- `packages/db/src/schema.ts`
- `packages/db/migrations/0025_control_harness_credentials.sql`
- `apps/supervisor-api/src/worker-environment.ts`
- `apps/supervisor-api/src/routes/system.ts`
- `apps/supervisor-api/src/worker-harness-client.ts`
- `apps/supervisor-api/src/plugins/*`
- `packages/plugin-elagente-harness/*`
- `bin/remote-codex-plugin-mcp.mjs`
- `packages/config/src/index.ts`

### ElAgenteHarness

Status:

- The planned Harness admin/member/usage contract is implemented locally in `src/inact`.
- The Harness main repo has been pushed to `origin/main` at commit `bd0c1e16cc995881e551459cdac633b1e2b78adc`.
- The production Railway service has been proven to expose the new planned endpoints at route-existence level: unauthenticated public probes now return `401 X-Admin-Key required` instead of `404 Not Found`. Authenticated response-shape smoke is still pending because the real `ADMIN_KEY` is not available in this workspace.

Implemented local improvements:

- Add idempotent admin ensure/reconcile endpoint.
- Add stable external id fields or metadata.
- Add usage export endpoint if not already present. Remote Codex already has `HarnessAdmin.exportUsage(...)` client/import plumbing for the planned endpoint.
- Avoid admin list being the only way to recover key metadata.

## Open Decisions

1. Harness should still expose idempotent `ensure`/`reconcile`; Remote Codex currently has fallback create + DB dedupe.
2. Current phase-one posture is K8s Secret as runtime source of truth; DB key ciphertext remains nullable and redacted.
3. Phase-one tool surface is both worker API and Codex managed MCP plugin.
4. Approved phase-one modules are `estructural`, `quntur`, and `farmaco`.
5. Harness usage pricing/quota remains open until Harness exposes stable usage events or Remote Codex records per-invoke usage.

## Recommended Next Step

Implement in this order:

1. Run authenticated production Harness admin smoke using the real Railway `ADMIN_KEY`. Local `.env` does not contain this key, so only unauthenticated route-existence probes have been completed.
2. Smoke these production Harness contract calls:
   - `POST /admin/members/ensure`
   - `POST /admin/members/reconcile`
   - `POST /admin/members/<externalKeyId>/rekey`
   - `POST /admin/members/<externalKeyId>/revoke`
   - `GET /admin/usage/export`
3. Configure Remote Codex production/staging Harness env and K8s Secret/RBAC.
4. Run staging smoke for provisioning, Secret injection, worker `/api/harness/*`, and Codex MCP `harness_status`.
5. Run one low-cost real Codex `harness_invoke_tool` and verify usage/audit attribution.
6. Add normalized Harness task/job/run/artifact timeline records once real Harness response shapes are stable.
7. Extend provider-visible tool config to Claude/OpenCode if their runtime config supports the same clean secret boundary.

This order keeps the boundary clean: first credential lifecycle, then worker access, then provider UX, then product UI/billing.
