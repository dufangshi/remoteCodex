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
Before changing any staging checkbox, run the evidence verifier against that
stored JSON:

```bash
pnpm verify:staging-phase-one-evidence -- ./staging-phase-one-smoke.json
```

To audit all remaining Phase 0 through Phase 6 boxes in one read-only report,
combine the AWS preflight evidence and the phase-one staging smoke:

```bash
pnpm verify:phase-zero-six-evidence -- \
  --aws-preflight ./aws-staging-preflight.json \
  --staging-smoke ./staging-phase-one-smoke.json
```

After the aggregate report shows one or more remaining Phase 0 through Phase 6
items under `readyToCheck`, the same tool can update those proven checklist
items in one guarded step:

```bash
pnpm verify:phase-zero-six-evidence -- \
  --aws-preflight ./aws-staging-preflight.json \
  --staging-smoke ./staging-phase-one-smoke.json \
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
pnpm collect:phase-zero-six-evidence -- --output-dir ./artifacts/phase-zero-six-evidence/<run-id>
```

The bundle runner writes:

- `aws-staging-preflight.json`
- `aws-staging-preflight-verification.json`
- `staging-phase-one-smoke.json`
- `staging-phase-one-verification.json`
- `phase-zero-six-verification.json`
- `summary.json`

After reviewing the JSON files for accidental secret exposure and confirming
the aggregate verifier lists the expected items under `readyToCheck`, rerun
with the guarded checklist update:

```bash
pnpm collect:phase-zero-six-evidence -- \
  --output-dir ./artifacts/phase-zero-six-evidence/<run-id>-apply \
  --apply-ready
```

For AWS-only preflight work, such as checking only S3.04/S3.05 before the
runtime smoke is available, pass `--skip-staging-smoke`.

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
  available and direct worker access returns `401` or `403`.
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
