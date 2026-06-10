# ElAgenteHarness Evidence Runbook

本文档用于收集 `docs/elagente-harness-control-plane-integration-plan.zh.md` 里剩余 live gates 的真实证据。它不要求、也不应该记录任何 secret 原文。

配套模板：

- [ElAgenteHarness Evidence Template](./elagente-harness-evidence-template.json)

## 目标

最终必须拿到三份真实 smoke JSON：

- Harness production admin contract smoke
- Remote Codex staging phase-one Harness smoke
- K8s Secret/RBAC smoke

然后用 combined verifier 证明：

- `harness-admin-contract`
- `harness-worker-runtime`
- `harness-usage-attribution`
- `harness-mcp-worker-api`
- `harness-thread-artifact-ui`

## 快速采集

先检查 live env readiness：

```bash
pnpm verify:harness-evidence-env
```

如果需要生成 private operator env 模板：

```bash
pnpm verify:harness-evidence-env -- \
  --write-env-template ./.temp/harness-evidence/harness.env.sh
```

如果所有 live env 已经在当前 operator shell 中配置好，可以用 collector 一次性运行 admin smoke、staging smoke、K8s smoke、combined verifier 和 evidence review verifier：

```bash
pnpm collect:harness-integration-evidence -- \
  --output-dir ./.temp/harness-evidence/latest
```

collector 会生成：

```text
./.temp/harness-evidence/latest/
  harness-admin-smoke.json
  staging-phase-one-smoke.json
  harness-k8s-secret-smoke.json
  harness-integration-verification.json
  evidence-review.json
  harness-evidence-review-verification.json
  summary.json
```

如果缺少必要 env，collector 会输出缺失 env 名称和下一步命令，但不会打印 env value。

然后在私有 shell 中填好占位符并执行：

```bash
source ./.temp/harness-evidence/harness.env.sh
pnpm verify:harness-evidence-env
pnpm collect:harness-integration-evidence -- \
  --output-dir ./.temp/harness-evidence/latest
```

不要提交替换占位符后的 env 文件。

## Secret Safety

不要把以下内容写进模板、docs、thread message、artifact metadata、日志截图或 PR 描述：

- `ELAGENTE_HARNESS_ADMIN_KEY`
- `INACT_X_APP_KEY`
- `X-Api-Key` value
- `STAGING_PRODUCT_JWT`
- route token
- sub2api key
-任何 `sk-...` 形式的真实 key

允许记录：

- `apiKeyPresent: true`
- `keyChanged: true`
- `keyPresent: true`
- Secret `namespace`
- Secret `name`
- Secret `key`，也就是 sandbox id
- smoke JSON path
- verifier gate 是否通过

## 1. Harness Admin Contract Smoke

前置条件：

- 真实 Harness `ADMIN_KEY`
- 生产 Harness base URL

命令：

```bash
ELAGENTE_HARNESS_ADMIN_BASE_URL=https://elagenteharness-production.up.railway.app \
ELAGENTE_HARNESS_ADMIN_KEY=<actual Harness ADMIN_KEY> \
pnpm smoke:harness-admin-contract \
  > ./.temp/harness-evidence/harness-admin-smoke.json
```

完成标准：

- `ok` 为 true。
- `unauthenticated POST /admin/members/ensure` 为 true。
- `unauthenticated GET /admin/usage/export?limit=1` 为 true。
- `authenticated ensure creates or returns member` 为 true。
- `authenticated ensure is idempotent` 为 true。
- `authenticated reconcile returns existing external key` 为 true。
- `authenticated rekey returns a new key` 为 true。
- `authenticated usage export returns Remote Codex shape` 为 true。
- `authenticated revoke marks key revoked` 为 true。
- 输出不包含 `apiKey` 原文，只包含 `apiKeyPresent`、`keyChanged` 等布尔证据。

## 2. Remote Codex Staging Harness Smoke

前置条件：

- Remote Codex control-plane API 已配置：
  - `ELAGENTE_HARNESS_BASE_URL`
  - `ELAGENTE_HARNESS_ADMIN_BASE_URL`
  - `ELAGENTE_HARNESS_ADMIN_KEY`
  - `ELAGENTE_HARNESS_APP_KEY_SECRET_NAME`
  - `ELAGENTE_HARNESS_PROVIDER=elagente-harness`
  - `REMOTE_CODEX_CHEMISTRY_TOOLS_ENABLED=true`
- 有 staging product JWT。
- 有一个可以启动/重启 sandbox 的测试用户。

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
pnpm smoke:staging-phase-one \
  > ./.temp/harness-evidence/staging-phase-one-smoke.json
```

这些 `STAGING_HARNESS_*` 变量对完整 release evidence 都是必需项。只设置
`STAGING_HARNESS_SMOKE=1` 可以做局部调试，但不能让
`pnpm collect:harness-integration-evidence` 的六个 live gate 全部通过。

MCP worker-api evidence：

`STAGING_HARNESS_MCP_SMOKE_COMMAND` 必须输出顶层 JSON，且包含：

```json
{
  "source": "worker-api"
}
```

Live thread artifact evidence：

`STAGING_HARNESS_THREAD_ARTIFACT_UI_SMOKE_COMMAND` 必须输出顶层 JSON，且包含：

```json
{
  "artifactTypes": ["elagente.harness.run"]
}
```

也可以是：

- `elagente.harness.artifact`
- `chemistry.molecule3d`

完成标准：

- `sandbox_ready` 为 true。
- `browser_to_router_to_worker` 为 true。
- `harness_worker_status` 为 true。
- `harness_worker_discovery` 为 true。
- `harness_control_plane_invoke` 为 true。
- `harness_usage_summary_after_invoke` 为 true。
- `harness_mcp_worker_api_smoke` 为 true，且证据显示 `source=worker-api`。
- `harness_thread_artifact_ui_smoke` 为 true。

## 3. K8s Secret/RBAC Smoke

前置条件：

- 本机 `kubectl` 指向 staging cluster/context。
- 当前 kube identity 是 control-plane 真实使用或等价的 least-privilege identity。
- 已有一个通过 Remote Codex provisioning 创建的 sandbox id。

命令：

```bash
HARNESS_K8S_NAMESPACE=<namespace> \
ELAGENTE_HARNESS_APP_KEY_SECRET_NAME=<secret name> \
HARNESS_K8S_SECRET_KEY=<sandbox id> \
pnpm smoke:harness-k8s-secret \
  > ./.temp/harness-evidence/harness-k8s-secret-smoke.json
```

完成标准：

- `harness_k8s_secret_rbac_get` 为 true。
- `harness_k8s_secret_rbac_patch` 为 true。
- `harness_k8s_secret_key_present` 为 true。
- `secretSafety.valuePrinted` 为 false。
- 输出不包含 Secret `data` value。

## 4. Combined Verifier

命令：

```bash
pnpm verify:harness-integration-evidence \
  --admin-smoke ./.temp/harness-evidence/harness-admin-smoke.json \
  --staging-smoke ./.temp/harness-evidence/staging-phase-one-smoke.json \
  --k8s-secret-smoke ./.temp/harness-evidence/harness-k8s-secret-smoke.json \
  > ./.temp/harness-evidence/harness-integration-verification.json
```

完成标准：

- top-level `ok` 为 true。
- `harness-admin-contract` 为 true。
- `harness-worker-runtime` 为 true。
- `harness-secret-safety` 为 true。
- `harness-usage-attribution` 为 true。
- `harness-mcp-worker-api` 为 true。
- `harness-thread-artifact-ui` 为 true。

## 5. Evidence Bundle Review

把 smoke/verifier path 填入 [template](./elagente-harness-evidence-template.json)，但不要填 secret value。

建议 bundle 目录：

```text
./.temp/harness-evidence/
  harness-admin-smoke.json
  staging-phase-one-smoke.json
  harness-k8s-secret-smoke.json
  harness-integration-verification.json
  evidence-review.json
```

`evidence-review.json` 可以从模板复制，填入：

- `generatedAt`
- `reviewedBy`
- `reviewSource`
- smoke 文件路径
- verifier 文件路径
- `secretSafety` 布尔项

填好后运行：

```bash
pnpm verify:harness-evidence-review -- \
  --review ./.temp/harness-evidence/evidence-review.json
```

完成标准：

- top-level `ok` 为 true。
- `review_metadata_present` 为 true。
- `admin_smoke_reviewed` 为 true。
- `staging_smoke_reviewed` 为 true。
- `k8s_secret_smoke_reviewed` 为 true。
- `combined_verifier_reviewed` 为 true。
- `secret_safety_reviewed` 为 true。

## 6. Goal Completion Rule

只有当 combined verifier 返回 `ok: true`，并且 `pnpm verify:harness-evidence-review` 返回 `ok: true` 时，才能认为 `docs/elagente-harness-control-plane-integration-plan.zh.md` 里的 live integration gates 完成。

如果缺少真实 `ADMIN_KEY`、staging JWT、K8s context、sandbox id、或 live thread artifact proof，则目标仍未完成。
