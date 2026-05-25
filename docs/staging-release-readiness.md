# Staging Release Readiness

This document is the first staging release-readiness note for the
`sandbox-worker-control-plane` branch.

It does not claim that staging is already deployed. It defines the exact
services, environment, smoke checks, rollback steps, and blocking gates that
must be satisfied before the first staging deploy is considered ready.

## Release Target

Phase-one staging should exercise the real product shape with non-production
credentials:

```text
Browser
  -> Railway frontend
  -> Railway control-plane API
  -> sandbox router
  -> AWS EKS Fargate worker Pod
  -> staging LLM gateway
  -> staging ElAgenteHarness
```

The staging environment must prove that product auth, sandbox routing, worker
identity, gateway credential bootstrap, harness credential bootstrap, and usage
import work together without exposing root provider keys or product JWTs inside
the worker.

## Required Services

- Railway frontend service.
- Railway control-plane API service.
- Product Postgres database.
- Sandbox router service.
- AWS EKS cluster with Fargate profile for worker Pods.
- ECR or selected image registry for `Dockerfile.worker` images.
- Staging LLM gateway.
- Staging ElAgenteHarness service.
- Object storage if workspace snapshots or artifacts are enabled.
- Log and metrics sink for control-plane, router, and worker logs.

## Required Control-Plane Environment

- `DATABASE_URL`
- Product auth mode and JWT verifier settings:
  - `REMOTE_CODEX_AUTH_MODE`
  - issuer
  - audience
  - JWKS URL or public key source
- Route-token signing current key and key id.
- Previous route-token signing key only during rotation windows.
- Router public HTTP base URL.
- Router public WebSocket base URL.
- Worker internal token material or secret reference.
- Sandbox manager provider set to the AWS/EKS adapter.
- AWS region, cluster, namespace, service account, Fargate profile, subnet, and
  security group settings.
- Worker image repository and immutable image tag.
- Worker resource profile defaults.
- Capacity preflight:
  - target active sandbox count for the staging run;
  - expected production active sandbox count for the release;
  - profile mix for `small`, `standard`, and `large`;
  - headroom-adjusted Fargate vCPU requirement;
  - private subnet free IP count;
  - AWS Fargate On-Demand vCPU quota in the sandbox region;
  - any required AWS Service Quotas request id and approval status.
- Gateway base URL and gateway admin credential, following
  `docs/llm-gateway-contract.md`.
- Harness base URL and harness admin credential if the harness requires admin
  provisioning.
- Usage import schedule disabled or enabled explicitly for staging.

## Required Worker Environment

These values must be injected by the control plane or sandbox manager and must
not be accepted from the browser:

- `REMOTE_CODEX_SANDBOX_ID`
- `REMOTE_CODEX_USER_ID`
- `REMOTE_CODEX_WORKER_AUTH_TOKEN`
- `REMOTE_CODEX_LLM_GATEWAY_BASE_URL`
- scoped gateway token or configured provider credential file generated from
  that token
- `ELAGENTE_HARNESS_BASE_URL`
- scoped `INACT_X_APP_KEY`
- `WORKSPACE_ROOT=/workspace`
- `HOME=/home/agent`

The worker must not receive raw OpenAI, Anthropic, or other provider root keys.

## Required Smoke Checks

Run these checks before marking any staging checkbox complete:

### AWS Staging Preflight Evidence

Before running the lifecycle smoke, create an AWS staging preflight evidence
file. The template is:

```text
docs/aws-staging-preflight-evidence-template.json
```

Prefer collecting the first draft from the staging operator environment:

```bash
AWS_STAGING_REVIEWED_BY=<operator-email> \
AWS_STAGING_EKS_CLUSTER_NAME=<cluster> \
AWS_STAGING_FARGATE_PROFILE_NAME=<profile> \
AWS_STAGING_CONFIG_REVIEWED=true \
AWS_STAGING_CREDENTIAL_REVIEW_PASSED=true \
pnpm exec tsx scripts/collect-aws-staging-preflight-evidence.ts > ./aws-staging-preflight.json
```

The collector uses `aws sts get-caller-identity`,
`aws eks describe-cluster`, `aws eks describe-fargate-profile`, and
`kubectl auth can-i` when those CLIs are available. It also accepts the same
deployment env names used by the control plane, including
`SANDBOX_EKS_CLUSTER_NAME`, `SANDBOX_K8S_NAMESPACE`,
`SANDBOX_K8S_SERVICE_ACCOUNT`, `SANDBOX_WORKER_IMAGE_REPOSITORY`,
`SANDBOX_WORKER_IMAGE_TAG`, `SANDBOX_SUBNET_IDS`, and
`SANDBOX_SECURITY_GROUP_IDS`.

Review and edit the generated JSON to remove placeholders and add any values
that are not discoverable from the CLIs, such as log group names. Then run:

```bash
pnpm verify:aws-staging-preflight-evidence -- ./aws-staging-preflight.json
```

This verifier covers S3.04 and S3.05 only. It is read-only and reports whether
the AWS config review and Kubernetes credential review are complete enough to
check those boxes. It deliberately requires separate review evidence because
the runtime smoke cannot prove account naming, VPC selection, log groups, or
least-privilege RBAC by itself.

Before collecting the full Phase 0 through Phase 6 bundle, operators can run a
non-secret environment readiness check:

```bash
pnpm verify:phase-zero-six-env-ready
```

To generate a private shell template for the missing staging inputs, use:

```bash
pnpm verify:phase-zero-six-env-ready -- \
  --write-env-template ./.temp/phase-zero-six-evidence/phase-zero-six.env.sh
```

The generated template contains only placeholder values and non-secret
examples. Fill it in inside the operator shell, keep it out of Git, and then
run:

```bash
source ./.temp/phase-zero-six-evidence/phase-zero-six.env.sh
pnpm verify:phase-zero-six-env-ready
```

For AWS-only S3.04/S3.05 preflight work, generate a smaller template:

```bash
pnpm verify:phase-zero-six-env-ready -- \
  --skip-staging-smoke \
  --write-env-template ./.temp/phase-zero-six-evidence/aws-preflight.env.sh
```

This command reports readiness by evidence group:

- AWS preflight env for S3.04 and S3.05.
- Runtime smoke env for S3.06 through S3.08 and R5.10/R5.12.
- Direct-worker-denial env for R5.11, either direct worker URL denial or
  private-network router-only proof.
- Codex, Claude Code, and OpenCode provider smoke commands for G6.11 through
  G6.13.

The readiness report prints only environment variable names. It does not print
JWTs, API keys, provider command JSON values, gateway tokens, or harness keys.
It is an operator convenience check only; it does not prove AWS access, staging
lifecycle, router behavior, or provider runtime success, and it must not be
used to check any checklist box by itself.

The JSON includes `missingEnvExportTemplate` and
`missingRecommendedEnvExportTemplate` arrays. These contain shell `export`
lines with placeholders or non-secret examples only, grouped by evidence area.
Operators can copy those lines into a private staging shell, replace
placeholders with real values, or use `--write-env-template` to write the same
placeholder exports to a private shell file. Do not commit a filled env file or
paste real JWTs, gateway tokens, provider command env JSON, or AWS credentials
into release docs.

### Phase-One Runtime Smoke

The scripted entry point for the phase-one Remote Codex staging path is:

```bash
STAGING_CONTROL_PLANE_BASE_URL=https://<control-plane-staging> \
STAGING_PRODUCT_JWT=<jwt-for-test-user> \
STAGING_ADMIN_JWT=<jwt-for-admin-user> \
STAGING_DIRECT_WORKER_BASE_URL=https://<worker-endpoint-if-public> \
STAGING_IDEMPOTENT_LIFECYCLE_SMOKE=1 \
STAGING_STOP_SANDBOX_AFTER_SMOKE=1 \
pnpm smoke:staging-phase-one
```

If worker services are intentionally private and have no public worker endpoint,
replace `STAGING_DIRECT_WORKER_BASE_URL` with private ingress proof:

```bash
STAGING_DIRECT_WORKER_PRIVATE_REVIEWED_BY=<operator-email> \
STAGING_DIRECT_WORKER_NETWORK_MODE=private \
STAGING_DIRECT_WORKER_INGRESS_POLICY=router-only \
STAGING_DIRECT_WORKER_PRIVATE_PROOF="<non-secret cluster/service/ingress evidence>"
```

This emits `direct_worker_private_denial` instead of
`direct_worker_denial`. The verifier accepts it for R5.11 only when the proof
states that the worker network mode is private, ingress policy is router-only,
and an operator identity reviewed the evidence. Do not put kubeconfig contents,
AWS credentials, JWTs, or service tokens in the proof string.

Optional provider runtime commands can be attached when the worker/gateway path
is ready:

```bash
STAGING_CODEX_GATEWAY_SMOKE_COMMAND="<command run by the operator>" \
STAGING_CLAUDE_GATEWAY_SMOKE_COMMAND="<command run by the operator>" \
STAGING_OPENCODE_GATEWAY_SMOKE_COMMAND="<command run by the operator>"
```

For commands with nested quoting or provider-specific environment, prefer the
JSON forms:

```bash
STAGING_CODEX_GATEWAY_SMOKE_COMMAND_JSON='["pnpm","exec","tsx","scripts/provider-gateway-smoke.ts","codex"]' \
STAGING_CODEX_GATEWAY_SMOKE_COMMAND_ENV_JSON='{"PROVIDER_GATEWAY_SMOKE_COMMAND_JSON":"[\"codex\",\"exec\",\"--\",\"echo\",\"gateway smoke\"]","PROVIDER_GATEWAY_SMOKE_USAGE_RECORDED":"1"}'
```

The staging runner records only the env var names and override keys, not the
JSON env values.

The recommended command target is the provider gateway helper inside the
worker. Run it directly in the worker shell, or wrap it with `kubectl exec` if
the operator launches it from outside the Pod:

```bash
PROVIDER_GATEWAY_SMOKE_COMMAND_JSON='["codex","exec","--","echo","gateway smoke"]' \
PROVIDER_GATEWAY_SMOKE_USAGE_RECORDED=1 \
pnpm exec tsx scripts/provider-gateway-smoke.ts codex
```

For the phase-one staging runner, point each optional command at the helper:

```bash
STAGING_CODEX_GATEWAY_SMOKE_COMMAND_JSON='["pnpm","exec","tsx","scripts/provider-gateway-smoke.ts","codex"]' \
STAGING_CLAUDE_GATEWAY_SMOKE_COMMAND_JSON='["pnpm","exec","tsx","scripts/provider-gateway-smoke.ts","claude"]' \
STAGING_OPENCODE_GATEWAY_SMOKE_COMMAND_JSON='["pnpm","exec","tsx","scripts/provider-gateway-smoke.ts","opencode"]'
```

`PROVIDER_GATEWAY_SMOKE_COMMAND_JSON` must be a JSON string array containing
the real provider CLI command to run inside the worker. The helper verifies the
provider command result, gateway usage evidence, generated provider config, and
absence of raw root-key env/config names before printing the JSON consumed by
the staging verifier.

Useful timing overrides for slower EKS/Fargate starts:

```bash
STAGING_SANDBOX_READY_TIMEOUT_MS=900000 \
STAGING_SANDBOX_READY_POLL_MS=15000 \
STAGING_SANDBOX_STOP_TIMEOUT_MS=900000 \
STAGING_SANDBOX_STOP_POLL_MS=15000 \
STAGING_PROVIDER_SMOKE_TIMEOUT_MS=180000
```

The script prints JSON evidence with step names and ids. Store the output with
the staging release record before checking the corresponding staging boxes.
If the smoke aborts before the final report, it prints a JSON error object to
stderr with the partial `steps` collected before the failure. Store that stderr
JSON with the failed staging run; it is not checklist-completion evidence, but
it usually shows exactly which lifecycle, router, or provider step failed.
Before changing any staging checkbox, run the evidence verifier against that
stored JSON:

```bash
pnpm verify:staging-phase-one-evidence -- ./staging-phase-one-smoke.json
```

To audit all remaining Phase 0 through Phase 6 boxes in one read-only report,
combine the AWS preflight evidence and the phase-one staging smoke:

```bash
pnpm verify:phase-zero-six-evidence -- \
  --aws-preflight ./.temp/phase-zero-six-evidence/<run-id>/aws-staging-preflight.json \
  --staging-smoke ./.temp/phase-zero-six-evidence/<run-id>/staging-phase-one-smoke.json
```

After the aggregate report shows one or more remaining Phase 0 through Phase 6
items under `readyToCheck`, the same tool can update those proven checklist
items in one guarded step:

```bash
pnpm verify:phase-zero-six-evidence -- \
  --aws-preflight ./.temp/phase-zero-six-evidence/<run-id>/aws-staging-preflight.json \
  --staging-smoke ./.temp/phase-zero-six-evidence/<run-id>/staging-phase-one-smoke.json \
  --apply-ready
```

`--apply-ready` refuses to edit the checklist if no Phase 0 through Phase 6
boxes are ready or if existing checked evidence is contradicted. It can safely
apply a partial staging result, such as S3.04/S3.05 from AWS preflight first
and S3.06-S3.08/R5.10-R5.12/G6.11-G6.13 later as runtime smoke evidence
arrives.

The verifier is read-only by default. It reports which remaining staging
checkboxes have enough evidence to check and which proof fields are missing.
Only the explicit `--apply-ready` mode updates checklist files, and only after
the boxes it changes are backed by evidence.

### One-Command Evidence Bundle

When the staging operator environment has AWS, Kubernetes, product JWT, admin
JWT, router, direct-worker, and provider smoke env configured, use the bundle
runner to collect and verify the Phase 0 through Phase 6 evidence in one
directory:

```bash
pnpm collect:phase-zero-six-evidence -- --output-dir ./.temp/phase-zero-six-evidence/<run-id>
```

The bundle runner checks `env-readiness.json` first. If required environment
inputs are missing, it stops before running AWS, Kubernetes, control-plane, or
provider smoke commands. This avoids accidental partial live runs with the
wrong staging inputs.

For diagnostic collection only, operators can override that guard:

```bash
pnpm collect:phase-zero-six-evidence -- \
  --output-dir ./.temp/phase-zero-six-evidence/<run-id>-diagnostic \
  --force
```

Do not use `--force` output to check boxes unless the normal evidence verifiers
also report those boxes under `readyToCheck`.

The bundle runner writes:

- `env-readiness.json`
- `aws-staging-preflight.json`
- `aws-staging-preflight-verification.json`
- `staging-phase-one-smoke.json`
- `staging-phase-one-verification.json`
- `phase-zero-six-verification.json`
- `phase-zero-six-apply.json` when `--apply-ready` is requested and allowed
- `artifact-secret-scan.json`
- `summary.json`

The bundle runner also scans generated JSON artifacts for obvious secret-like
values and sensitive fields before marking the bundle successful. This is a
guardrail, not a replacement for operator review.
Provider command `stdout`, `stderr`, and command errors are redacted before
they are written to evidence JSON, and then scanned again by the artifact
secret scanner. The provider gateway helper preserves redacted stdout and
stderr even when the provider command exits non-zero, so operators can debug a
failed Codex, Claude Code, or OpenCode smoke without storing raw secrets in the
evidence bundle.
If a provider command exits non-zero, the staging smoke still emits a JSON
report with that provider step marked `ok: false`; the verifier then leaves the
corresponding G6 box unchecked with a concrete failure record.

In `summary.json`, `ok: true` means the bundle collection, artifact scan, and
requested checklist apply flow completed successfully. It does not necessarily
mean every Phase 0 through Phase 6 checklist item is complete. Use
`phaseZeroSixComplete: true` for that stronger claim. Partial evidence runs,
such as AWS-only S3.04/S3.05 preflight with `--skip-staging-smoke`, can produce
`ok: true` and `phaseZeroSixComplete: false`.

Each `summary.results[]` entry includes both `ok` and `rawOk`. `ok` is the
bundle-level interpretation for that command. `rawOk` is the command's own
checklist-completion result. For partial evidence, `verify_phase_zero_six_*`
commands can have `ok: true` and `rawOk: false`, meaning the command ran and
applied the ready boxes successfully, while the full Phase 0 through Phase 6
checklist still has missing staging evidence.

Checklist apply inside the bundle is intentionally ordered after read-only
verification and artifact scanning. Even when `--apply-ready` is present, the
bundle first writes `phase-zero-six-verification.json`, then scans the artifact
directory with `verify-phase-zero-six-artifacts-safe`, and only then runs a
second `verify-phase-zero-six-evidence --apply-ready` command. If the artifact
scan fails, `summary.json` records `applySkippedReason` and no checklist file is
edited.

After reviewing the JSON files for accidental secret exposure and confirming
the aggregate verifier lists the expected items under `readyToCheck`, rerun the
bundle with the guarded checklist update:

```bash
pnpm collect:phase-zero-six-evidence -- \
  --output-dir ./.temp/phase-zero-six-evidence/<run-id>-apply \
  --apply-ready
```

For AWS-only preflight work, such as checking only S3.04/S3.05 before the
runtime smoke is available, pass `--skip-staging-smoke`. In that mode the
bundle also passes `--skip-staging-smoke` to the env readiness verifier, so only
AWS preflight env is required before collection starts.

The recommended `.temp/phase-zero-six-evidence/` output location and legacy
`artifacts/phase-zero-six-evidence/` location are ignored by Git. If an
operator intentionally stores evidence elsewhere, run
`pnpm verify:phase-zero-six-artifacts-safe -- --dir <artifact-dir>` and confirm
the path is excluded from commits before saving raw staging JSON.

The important step-to-checkbox mapping is:

- `start_sandbox`, `sandbox_ready`, and `admin_sandbox_runtime_detail` prove
  real worker Pod creation, runtime identity, image, namespace, Pod name,
  worker service name, and readiness for S3.06.
- `stop_sandbox` proves user stop convergence for S3.07 when stop is accepted
  and subsequent health polling reaches `finalHealthState: "stopped"` with
  `stopConverged: true`.
- `idempotent_lifecycle` proves repeated start/restart calls keep one sandbox
  id for S3.08.
- `router_health` proves the deployed staging router health endpoint is
  reachable and reports `role: "sandbox-router"` for R5.10.
- `browser_to_router_to_worker` proves R5.12 when worker metadata reports
  `requestDiagnostics.authorizationHeaderPresent: false` and
  `requestDiagnostics.workerTokenHeaderPresent: true`, proving browser
  `Authorization` was stripped and router worker-token injection happened.
- `direct_worker_denial` proves R5.11 when `STAGING_DIRECT_WORKER_BASE_URL` is
  available and direct worker access returns `401` or `403`. The response body
  may be JSON, plain text, HTML, or empty; the smoke records only status and
  accepted statuses for this proof.
- `direct_worker_private_denial` proves R5.11 when workers are intentionally
  private: it must record `networkMode: "private"`,
  `ingressPolicy: "router-only"`, `reviewedBy`, and a non-secret proof string.
  This is the expected proof path when EKS/Fargate workers have no public
  endpoint and are reachable only through sandbox-router.
- `codex_gateway_smoke`, `claude_gateway_smoke`, and
  `opencode_gateway_smoke` prove G6.11-G6.13 only when the command output also
  records a successful gateway usage event and confirms no provider root key is
  present in worker env/config.

Provider smoke commands should print a JSON object to stdout so the staging
runner can attach it as `details.parsedStdout`. The verifier expects this
minimal shape:

```json
{
  "ok": true,
  "provider": "codex",
  "gatewayUsageRecorded": true,
  "rootKeysAbsent": true,
  "workerConfigUsesGateway": true,
  "requestId": "optional-gateway-or-provider-request-id"
}
```

Use `"provider": "claude"` for Claude Code and `"provider": "opencode"` for
OpenCode. `gatewayUsageRecorded` must be based on a gateway usage record, not
only on a successful CLI exit. `rootKeysAbsent` must come from checking worker
environment and generated provider config for raw provider root keys.

- Auth smoke:
  - valid staging user token reaches `GET /api/me`;
  - expired token is rejected;
  - wrong issuer is rejected;
  - wrong audience is rejected.
- Product metadata smoke:
  - create project;
  - create workspace inside project;
  - create session inside workspace.
- Sandbox lifecycle smoke:
  - start one sandbox;
  - observe worker Pod status;
  - wait for worker `/readyz`;
  - stop the sandbox;
  - confirm registry and Pod state converge.
- Router smoke:
  - issue route token;
  - connect browser or scripted client through router;
  - verify direct worker non-health request fails without router-injected token;
  - verify browser product JWT is not forwarded to worker.
- Provider gateway smoke:
  - Codex reaches the staging gateway;
  - Claude Code reaches the staging gateway;
  - OpenCode reaches the staging gateway;
  - worker env/config contains only scoped gateway credentials.
- Harness smoke:
  - worker calls staging ElAgenteHarness with injected `INACT_X_APP_KEY`;
  - raw harness key is not returned by any Remote Codex API response.
- Usage smoke:
  - import one gateway usage event;
  - event maps to the correct user and sandbox;
  - duplicate import does not double-count usage.
- Rollback smoke:
  - stop one sandbox;
  - redeploy previous Railway control-plane image or documented rollback target;
  - confirm route-token issuance and sandbox status endpoints still respond.

## Blocking Gates

The first staging deploy is not release-ready while any of these are true:

- Production-style JWT-compatible auth smoke passes locally with
  `pnpm smoke:production-auth`; live vendor/auth-service token issuance remains
  a staging environment check when that service is selected.
- Worker image has not been built from a clean checkout.
- A real EKS Fargate sandbox cannot reach `/readyz`.
- Browser-to-router-to-worker traffic has not been exercised.
- Direct worker access without the router-injected token succeeds.
- Raw provider root keys enter the worker environment or provider config.
- Gateway or harness secrets appear in logs or API responses.
- Usage import cannot map gateway usage to the correct product user.
- There is no rollback path for Railway control-plane/frontend deployments.

## Rollback Steps

For the first staging deploy, rollback is operational rather than automated:

1. Stop active staging sandboxes through the control-plane admin endpoint.
2. Scale down or redeploy the sandbox router to the last known working version.
3. Redeploy the previous Railway frontend and control-plane API builds.
4. Repoint the worker image tag in staging config to the previous immutable
   image tag if worker bootstrap changed.
5. Rotate staging route-token signing material if route-token handling changed
   and compromise is suspected.
6. Revoke or rotate staging gateway and harness user keys if credential
   injection or redaction failed.
7. Restore the staging database from backup only if a forward migration cannot
   be repaired by a new forward migration.

## Checklist Links

- Primary execution board:
  [Remote Codex Side Execution Checklist](./remote-codex-side-execution-checklist.md)
- Delivery board:
  [Remote Codex Side Delivery Checklist](./remote-codex-side-delivery-checklist.md)
- Current branch status:
  [Remote Codex Branch Status](./status.md)
- Production release gates:
  [Release Gates](./release-gates.md)
