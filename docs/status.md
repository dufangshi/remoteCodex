# Remote Codex Branch Status

This file is the current-state handoff for the
`sandbox-worker-control-plane` branch. Update it before larger phase handoffs or
when the next implementation focus changes materially.

## 2026-05-27 Railway/EKS Deployment Handoff

This branch has been deployed to Railway project `TaskMarket`, environment
`production`, with AWS/EKS sandbox runtime in account `918876873590`,
region `ca-central-1`.

### Current Git State

- Branch: `sandbox-worker-control-plane`.
- Latest pushed commit: `cebf2f7 Allow frontend CORS for control plane`.
- Recent deployment commits:
  - `cebf2f7 Allow frontend CORS for control plane`.
  - `e88ad3e Deploy Railway supervisor frontend`.
  - `80631bd Deploy Railway control plane to EKS workers`.

### Active CORS Fix Pending Deploy

The browser frontend currently needs the `cebf2f7` control-plane CORS fix to be
deployed. Before this deploy, clicking `Login / register` in the Railway
frontend fails in the browser with:

```text
Access to fetch at
https://remote-codex-control-plane-production.up.railway.app/api/me/bootstrap
from origin
https://remote-codex-frontend-production.up.railway.app
has been blocked by CORS policy:
No 'Access-Control-Allow-Origin' header is present
```

`cebf2f7` fixes this in:

- `apps/control-plane-api/src/app.ts`
- `apps/control-plane-api/src/config.ts`
- `apps/control-plane-api/src/app.test.ts`

The control plane now handles OPTIONS preflight requests and allowlists browser
origins. The production frontend is allowed by default:

```text
https://remote-codex-frontend-production.up.railway.app
```

Additional browser origins can be appended with:

```text
CONTROL_PLANE_CORS_ALLOWED_ORIGINS=<comma-separated origins>
```

The expected CORS response includes:

```text
Access-Control-Allow-Origin: <allowed origin>
Access-Control-Allow-Methods: GET,POST,PATCH,DELETE,OPTIONS
Access-Control-Allow-Headers: authorization,content-type,x-remote-codex-service-token
Access-Control-Max-Age: 600
Vary: Origin
```

Local verification for the CORS fix passed:

```bash
pnpm --filter @remote-codex/control-plane-api typecheck
pnpm --filter @remote-codex/control-plane-api test
git diff --check
```

The control-plane test suite passed with 65 tests.

### Immediate Next Step

Railway CLI auth expired while trying to deploy the CORS fix. Re-authenticate:

```bash
railway login --browserless
```

Open:

```text
https://railway.com/activate
```

Enter the new code printed by the CLI, then deploy the current branch to the
control-plane service:

```bash
railway up \
  --service remote-codex-control-plane \
  --environment production \
  --message allow-frontend-cors-cebf2f7 \
  --detach
```

Wait for success:

```bash
railway service status \
  --service remote-codex-control-plane \
  --environment production \
  --json
```

Then verify preflight:

```bash
curl -i -X OPTIONS \
  https://remote-codex-control-plane-production.up.railway.app/api/me/bootstrap \
  -H 'Origin: https://remote-codex-frontend-production.up.railway.app' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: authorization,content-type'
```

Expected result:

```text
HTTP/2 204
access-control-allow-origin: https://remote-codex-frontend-production.up.railway.app
access-control-allow-methods: GET,POST,PATCH,DELETE,OPTIONS
access-control-allow-headers: authorization,content-type,x-remote-codex-service-token
```

After this deploy, refresh:

```text
https://remote-codex-frontend-production.up.railway.app/control-plane/login
```

and click `Login / register` again.

### Railway Services

Project/environment:

```text
Project: TaskMarket
Environment: production
```

Frontend:

```text
Service: remote-codex-frontend
URL: https://remote-codex-frontend-production.up.railway.app
Latest verified deployment before CORS fix: f84dea39-5c6f-4423-b61d-2c49af20d7b6
Status before CORS fix: SUCCESS
/healthz: ok
```

Control plane:

```text
Service: remote-codex-control-plane
URL: https://remote-codex-control-plane-production.up.railway.app
Latest verified deployment before CORS fix: 32b13417-4bc4-4dd8-acb7-cdb5163ce750
Status before CORS fix: SUCCESS
/healthz: {"ok":true,"service":"control-plane-api"}
```

The control-plane deployment above does not include `cebf2f7`; redeploy is
required before browser login works from the frontend origin.

### AWS/EKS Runtime

AWS account/region:

```text
Account: 918876873590
Region: ca-central-1
```

EKS:

```text
Cluster: inact-harness-agents
Namespace: remote-codex-staging
Fargate profile: remote-codex-staging-workers
```

Router:

```text
URL: http://k8s-remoteco-remoteco-7dd92e25ca-b41c163a458fb214.elb.ca-central-1.amazonaws.com
/healthz: {"ok":true,"role":"sandbox-router"}
```

Observed EKS Auto Mode nodes:

```text
i-0112b1453eb49e03f
Type: c6g.large
Name tag: null
Node pool: system
Private IP: 10.0.131.110
Running: kube-system metrics-server pods

i-002ad155c9d04d932
Type: c6a.large
Name tag: null
Node pool: general-purpose
Private IP: 10.0.144.184
Running: remote-codex-sandbox-router
```

Do not manually terminate those EC2 instances. They are EKS Auto Mode managed
capacity. The Remote Codex worker Pods are temporary and run through the
`remote-codex-staging-workers` Fargate profile, not as persistent EC2 nodes.

### Last Full Runtime Smoke

The final API-level smoke before the CORS browser issue passed:

```text
ok: true
generatedAt: 2026-05-27T06:07:45.651Z
```

Passed steps:

```text
bootstrap_user_and_sandbox
start_sandbox
sandbox_health
sandbox_ready
create_project_workspace_session
issue_route_token
router_health
browser_to_router_to_worker
direct_worker_private_denial
stop_sandbox
```

Cleanup check returned:

```text
No resources found in remote-codex-staging namespace.
```

The smoke command shape was:

```bash
STAGING_CONTROL_PLANE_BASE_URL=https://remote-codex-control-plane-production.up.railway.app \
STAGING_PRODUCT_JWT=dev:smoke-user-3 \
STAGING_IDEMPOTENT_LIFECYCLE_SMOKE=0 \
STAGING_STOP_SANDBOX_AFTER_SMOKE=1 \
STAGING_SANDBOX_READY_TIMEOUT_MS=900000 \
STAGING_SANDBOX_READY_POLL_MS=10000 \
STAGING_SANDBOX_STOP_TIMEOUT_MS=900000 \
STAGING_DIRECT_WORKER_PRIVATE_REVIEWED_BY=yinalwyn123@gmail.com \
STAGING_DIRECT_WORKER_NETWORK_MODE=private \
STAGING_DIRECT_WORKER_INGRESS_POLICY=router-only \
STAGING_DIRECT_WORKER_PRIVATE_PROOF='worker Service is ClusterIP in remote-codex-staging and only router LoadBalancer is public' \
pnpm smoke:staging-phase-one
```

### Product Limitations

This is an internal/dev-mode deployment, not the final user-facing product.

- Control-plane auth is still dev bearer auth:

  ```text
  CONTROL_PLANE_AUTH_MODE=dev
  Authorization: Bearer dev:<subject>
  ```

- Real TaskMarket auth is not wired yet.
- Real LLM/provider execution is not wired yet. Workers are allowed to start
  without a gateway by setting:

  ```text
  REMOTE_CODEX_ENABLED_AGENT_PROVIDERS=""
  ```

- The current deployment proves frontend/control-plane/router/worker lifecycle,
  route-token issuance, router-to-worker access, direct-worker denial, and
  cleanup. It does not yet provide a complete end-user coding-agent workflow.

### Sensitive Local Files

Do not print or commit these files:

```text
.temp/railway-control-plane.env
.temp/remote-codex-control-plane-staging-access-key.json
.temp/aws-terraform.env
infra/terraform/staging/terraform.tfvars
infra/terraform/staging/terraform.tfstate
```

They are ignored by Git.

## Current Scope

Remote Codex is being shaped into the Agente product control plane plus sandbox
worker runtime:

- Railway-facing product frontend and control-plane API.
- Product users, projects, workspaces, sessions, sandbox registry, usage, quota,
  and audit records.
- Per-user sandbox lifecycle orchestration.
- Worker-mode supervisor API inside each sandbox.
- Worker bootstrap for Codex, Claude Code, OpenCode, MCP, the LLM gateway, and
  ElAgenteHarness.

Remote Codex integrates with, but does not own, the internals of the LLM
gateway, ElAgenteHarness, or chemistry compute workers.

## Current Mode Definitions

- Local development: dev bearer auth, local control-plane API, local database,
  local worker-process sandbox adapter, and mocked or manually configured
  gateway/harness dependencies.
- Staging: production-style JWT auth, real deployed control plane, real sandbox
  runtime, staging gateway credentials, staging harness credentials, and staging
  AWS/database/object-storage resources.
- Production: production auth, production database and object storage,
  least-privilege AWS permissions, secure secrets, route-token key rotation,
  credential rotation, usage import, quota enforcement, and operational alerts.

## Implemented Baseline

- Architecture docs and task checklists exist under `docs/`.
- Staging release-readiness notes and production release gates exist under
  `docs/`.
- Control-plane auth supports local dev bearer auth and production-style JWT
  verification with issuer, audience, expiry, not-before, issued-at, and clock
  skew checks.
- Control-plane schema and APIs cover users, projects, workspaces, sessions,
  sandboxes, route tokens, and admin user/sandbox operations.
- Project, workspace, and session list APIs support bounded `limit`/`offset`
  pagination with response metadata plus search/status filters.
- Worker-mode session checkpoint sync can call the control plane through the
  internal service-token endpoint with bounded retry/backoff.
- Control-plane session checkpoint sync rejects wrong-user and wrong-sandbox
  updates and audits sync failures.
- Inactive account behavior is implemented for route-token issuance, sandbox
  start/restart, and usage import.
- User data export and deletion/anonymization APIs are explicitly deferred in
  `docs/user-data-policy.md`; account suspension is the implemented phase-one
  control.
- Project, workspace, session, and sandbox ownership tests exist.
- Worker mode validates required sandbox identity and internal worker token
  settings.
- Local worker checkpoint smoke verifies that the worker sync client reaches the
  control-plane internal checkpoint endpoint and updates durable session
  `workerSessionId`, `status`, and `lastActivityAt`.
- Phase-one staging smoke runner exists as `pnpm smoke:staging-phase-one`; it
  can produce JSON evidence for lifecycle, route-token, router, direct-worker,
  idempotent lifecycle, admin runtime detail, and optional provider gateway
  staging checks once real staging URLs and tokens are available. If the smoke
  aborts mid-run, it now prints a JSON stderr report with partial steps so
  failed staging runs remain diagnosable.
- Staging smoke evidence verifier exists as
  `pnpm verify:staging-phase-one-evidence -- <smoke-json>`; it audits the
  remaining Phase 3, Phase 5, and Phase 6 staging checkboxes without mutating
  the checklist.
- Phase 0-6 aggregate evidence verifier exists as `pnpm phase-zero-six:audit`
  for the current checklist state, or as
  `pnpm verify:phase-zero-six-evidence -- --aws-preflight <evidence-json> --staging-smoke <smoke-json>`
  when reviewing collected AWS and staging smoke artifacts;
  it reads the active checklist and combines AWS preflight plus staging smoke
  verifier output into one read-only report of boxes that are ready to check
  and boxes still missing evidence. Its explicit `--apply-ready` mode updates
  only ready checkboxes and refuses to edit when no boxes are ready or any
  checked box is contradicted.
- Phase 0-6 staging evidence bundle runner exists as `pnpm phase-zero-six:collect`
  for the standard `.temp/phase-zero-six-evidence/latest` path, with
  `pnpm collect:phase-zero-six-evidence -- --output-dir <dir>` still available
  for custom artifact directories;
  it checks non-secret env readiness, collects AWS preflight evidence, runs the
  phase-one staging smoke, runs all evidence verifiers, scans generated JSON
  artifacts for obvious secret-like leakage, and writes a summary JSON for the
  staging release record. When env readiness fails, it now still writes a
  placeholder-only `phase-zero-six.env.sh` or `aws-preflight.env.sh` into the
  output directory so operators can fill missing staging inputs without
  scraping JSON, scans those early-stop artifacts before returning, and puts
  readiness groups plus next-step commands directly in `summary.json`. Its
  bundle-level `--apply-ready` path now runs
  read-only Phase 0-6 verification first, scans generated artifacts second, and
  only then runs a separate checklist apply command; if the artifact scan
  fails, no checklist file is edited. When apply runs, it performs a post-apply
  scan over the generated apply artifacts and records the result in
  `summary.postApplyScanPassed`. After writing final `summary.json` and
  `operator-report.txt`, it also performs a final artifact scan and records
  `summary.finalArtifactScanPassed`. The bundle also supports
  `--from-output-dir <dir>` to reuse already reviewed evidence artifacts for
  verification/apply without rerunning live AWS, Kubernetes, control-plane,
  router, or provider smoke commands; reuse mode scans both the input evidence
  directory and the newly generated verifier/apply output directory before
  applying checklist changes. Bundle `summary.ok` reports collection
  and apply-flow success, while `summary.phaseZeroSixComplete` separately
  reports whether all Phase 0-6 boxes are complete, so AWS-only partial
  evidence can succeed without claiming full release readiness. Summary result
  entries expose both bundle-level `ok` and command-level `rawOk` so operators
  can distinguish successful partial collection from complete checklist
  readiness, and `summary.checklistReadiness` exposes ready-to-check,
  still-missing, and contradicted checklist items without opening the raw
  verifier JSON. Its `--skip-staging-smoke` mode limits env readiness to AWS
  preflight inputs. It stops after env readiness failure by default; `--force`
  is available only for diagnostic collection. The recommended `.temp` output
  path is ignored by Git.
- Phase 0-6 staging env readiness verifier exists as
  `pnpm verify:phase-zero-six-env-ready`; it reports only environment variable
  names by evidence group and helps operators see which AWS, runtime, router,
  and provider smoke inputs are still missing before running the live bundle.
  It also emits placeholder-only shell export templates for missing required
  and recommended env. Operators can now pass `--write-env-template <path>` to
  write those placeholder exports to a private shell file under `.temp` before
  filling real staging values. It now also reports `itemReadiness` by checklist
  item plus `nextCommands`, so staging operators can see the exact S3/R5/G6
  boxes blocked by each missing evidence group. The bundle summary preserves
  these fields under `summary.envReadiness` on early env failure, and the
  bundle writes a non-authoritative `operator-report.txt` plus
  `release-review.json` for quick staging handoff and release review. It now
  also reports host-tool readiness for the live evidence collector, including
  `aws` and `kubectl` for the AWS preflight group. It is not
  checklist-completion evidence by itself.
- Phase 0-6 operator convenience scripts now wrap the evidence flow:
  `pnpm phase-zero-six:env`, `pnpm phase-zero-six:template`,
  `pnpm phase-zero-six:collect`, `pnpm phase-zero-six:collect:aws`, and
  `pnpm phase-zero-six:audit`, with guarded apply commands
  `pnpm phase-zero-six:apply` and `pnpm phase-zero-six:apply:aws`. These scripts
  do not relax evidence rules; they standardize the commands operators use to
  collect and apply the real AWS/staging/provider evidence required by the
  remaining unchecked S3/R5/G6 boxes.
- Phase 0-6 evidence tooling has CLI-level tests via
  `pnpm test:phase-zero-six-evidence`, covering guarded checklist application
  and obvious artifact secret leakage detection in JSON and shell/env evidence
  artifacts, including bundle-level refusal to apply checklist changes after an
  artifact scan failure.
- Phase 0-6 evidence tooling CI workflow exists at
  `.github/workflows/phase-zero-six-evidence.yml`; it typechecks the evidence
  scripts, runs `pnpm test:phase-zero-six-evidence`, and audits the current
  checklist state on matching branch pushes and pull requests. The path filters
  include the provider gateway smoke, redaction, GitHub Environment, and
  AWS/staging verifier helpers so evidence-helper changes do not bypass CI.
  GitHub Actions run `26411058304` passed on `sandbox-worker-control-plane` at
  commit `4f22d61767ed30aeaf5979e32868bee4546d5b48`.
- Phase 0-6 manual staging evidence workflow exists at
  `.github/workflows/phase-zero-six-staging-evidence.yml`; it runs from
  `workflow_dispatch` against the `staging` GitHub Environment, supports full
  or AWS-only evidence collection, and uploads the generated evidence bundle
  without committing checklist changes. Its `force_diagnostics` mode now keeps
  the collection step non-blocking so diagnostic artifacts are still uploaded
  when env readiness, AWS access, staging smoke, or provider runtime checks fail.
  Operators must review the artifact and run the guarded apply flow before
  checking any remaining S3/R5/G6 boxes.
- The visible `Phase 0-6 Evidence Tooling` workflow also supports manual
  diagnostic collection. GitHub Actions run `26409751861` passed on
  `sandbox-worker-control-plane` at commit
  `4153a7f8b2dd58de18a73983f5086c75dab8e5a2` with `evidence_mode=aws-only`
  and `force_diagnostics=true`; it uploaded artifact
  `phase-zero-six-staging-evidence-26409751861`. The artifact is diagnostic
  only because the `staging` Environment still lacks real Phase 0-6
  vars/secrets, so it must not be used to check S3/R5/G6 boxes.
- GitHub Actions run `26411418044` verified the current visible workflow's
  `evidence_mode=aws-only` plus `force_diagnostics=true` path at commit
  `5ca9686c2ad95c6ce670cec1ba05938b15f28af8`. It completed successfully and
  uploaded artifact `phase-zero-six-staging-evidence-26411418044`. The artifact
  secret scans passed, but `phase-zero-six-verification.json` reported
  `readyToCheck=0` and `stillMissing=11`, so this artifact is diagnostic only
  and must not be used to check S3/R5/G6 boxes.
- GitHub currently exposes only the visible `Phase 0-6 Evidence Tooling`
  workflow for manual dispatch from this branch; the standalone
  `.github/workflows/phase-zero-six-staging-evidence.yml` file remains a
  branch-local staging workflow definition but is not listed by
  `gh workflow list --repo dufangshi/remoteCodex --all` until it is available
  from the default branch. Operators should use the visible workflow commands
  emitted by `pnpm phase-zero-six:github-env:report`, including the
  `force_diagnostics=true` variants when they need artifact upload from a
  partially configured environment.
- GitHub Environment readiness for the manual staging evidence workflow can be
  checked with `pnpm phase-zero-six:github-env` or the human-readable
  `pnpm phase-zero-six:github-env:report`; the checker uses `gh` metadata APIs
  and prints only variable and secret names, never values.
- GitHub Environment configuration for the manual staging evidence workflow now
  has an operator path: `pnpm phase-zero-six:github-env:template` writes a
  private `.temp` template, and `pnpm phase-zero-six:github-env:configure -- \
  --values-file <path> --direct-worker-mode private --dry-run` validates the
  filled names before `gh variable set --env staging` and
  `gh secret set --env staging` are used. The configure tool shares required
  var/secret names with the readiness checker and prints names only, never
  values.
- The GitHub `staging` Environment now exists and allows the
  `sandbox-worker-control-plane` branch. It still has no required Phase 0-6
  evidence variables or secrets configured, so the manual staging evidence
  workflow cannot yet produce checklist-completion evidence.
- AWS staging preflight evidence verifier exists as
  `pnpm verify:aws-staging-preflight-evidence -- <evidence-json>` with template
  `docs/aws-staging-preflight-evidence-template.json`; it audits S3.04 and
  S3.05 evidence before those boxes are checked.
- AWS staging preflight evidence collector exists as
  `scripts/collect-aws-staging-preflight-evidence.ts`; it can gather a first
  evidence draft from `aws` CLI, `kubectl auth can-i`, and deployment env
  values before the verifier is run. Use `pnpm exec tsx ... > file` when
  redirecting clean JSON to a file.
- Provider gateway smoke helper exists as
  `scripts/provider-gateway-smoke.ts`; it wraps a real provider CLI command,
  checks generated provider config, checks raw root-key absence, and emits the
  JSON fields required by the G6.11-G6.13 staging verifier.
- Provider command `stdout`, `stderr`, and command errors are redacted before
  they enter staging evidence JSON; the artifact secret scanner still runs as a
  second guardrail on the generated bundle. Provider gateway smoke now preserves
  redacted stdout/stderr even when the provider command exits non-zero, making
  failed G6.11-G6.13 runtime smokes easier to debug without storing raw secrets.
- Provider command failures are captured as failed staging smoke steps instead
  of aborting the whole JSON report, so G6.11-G6.13 verifier output can show
  exactly which runtime smoke failed.
- The phase-one staging smoke runner supports provider command JSON and
  provider-specific env JSON, so G6.11-G6.13 smokes can pass quoted provider
  commands and usage evidence into the helper without logging raw env values.
- Staging stop evidence now polls sandbox health until `stopped`, and direct
  worker denial accepts `401` or `403`, including non-JSON denial bodies,
  aligning smoke output with the checklist verifier for S3.07 and R5.11.
- R5.11 staging evidence also supports private router-only workers via
  `direct_worker_private_denial`, so deployments that intentionally expose no
  public worker endpoint can still prove direct-worker denial with reviewed
  private ingress evidence.
- Staging router deployment evidence now includes an explicit `router_health`
  step before browser-to-router-to-worker metadata resolution, strengthening
  R5.10 proof.
- Worker metadata now returns non-secret request diagnostics, allowing staging
  `browser_to_router_to_worker` evidence to prove browser `Authorization`
  stripping and router worker-token injection for R5.12.
- Worker mode disables host/provider management APIs that should not be exposed
  in sandbox runtime.
- Route-token signing supports key ids and previous-key verification.
- Route tokens carry validated project, workspace, and session scopes, and the
  sandbox router forwards project scope in the signed worker identity envelope.
- Phase-one route-token revocation strategy is documented as short TTL plus
  signing-key rotation; per-token revocation remains deferred unless launch
  requirements change.
- Local worker-process sandbox adapter exists for development.
- Phase-one AWS runtime decision is EKS Fargate with one Pod per active user
  sandbox.

## In Progress

- Phase 0 documentation and release baseline is complete in
  `docs/remote-codex-side-detailed-checklist.md`; live staging verification has
  not run yet.
- `docs/remote-codex-side-product-task-checklist.zh.md` is the active
  Remote Codex side product task board for one-item-at-a-time implementation.
  Treat it as the daily execution checklist: choose one unchecked item, satisfy
  its `Done when` and `Verify with`, check only that proven item, and commit the
  evidence. `docs/remote-codex-side-detailed-checklist.md` remains the
  authoritative Phase 0-6 evidence checklist because the evidence scripts read
  it directly. Keep `docs/remote-codex-side-work-breakdown.md` aligned for the
  near-term queue, and keep `docs/remote-codex-side-execution-checklist.md`
  synchronized when a completed item changes phase evidence or release risk.
- AWS sandbox adapter implementation exists with local manager and mocked
  EKS/Fargate adapter tests; real staging AWS/EKS lifecycle verification has not
  run yet.
- Frontend auth shell covers the local login route, authenticated route guard,
  loading state, expired-session state, disabled-account state, and admin user
  management for list/status/quota/non-admin denial. Production-style
  JWT-compatible auth smoke passes for valid, expired, wrong-issuer, and
  wrong-audience tokens. `docs/remote-codex-side-detailed-checklist.md` Phase 1
  is complete locally, including router tests and local route-token smoke
  proving browser `Authorization` is stripped before upstream worker traffic.
  Staging proof remains a release gate.
- Project detail and product metadata loading states are implemented in the
  control-plane panel; opening a session now gets an in-memory route token,
  opens a sandbox-router WebSocket, reconnects after token refresh, and shows
  sandbox-offline UI when the router socket fails.
- `docs/remote-codex-side-detailed-checklist.md` Phase 2 is complete locally:
  worker checkpoint sync updates durable session state, product session close
  calls the worker disconnect API and marks the durable session idle, and
  product session resume calls the worker resume API and marks the durable
  session active. Staging route-token/router/worker proof remains tracked under
  Phase 5 and release gates.
- Browser-to-worker route-token connection flow; route token issuance, refresh,
  browser WebSocket connection, and reconnect are in place, while staging router
  smoke checks remain open.
- `docs/remote-codex-side-detailed-checklist.md` Phase 5 is complete for local
  route-token contract, router proxying, and worker authorization. Staging
  router deployment, direct-worker-denial proof, and browser-to-router-to-worker
  smoke remain unchecked.
- `docs/remote-codex-side-detailed-checklist.md` Phase 3 is complete locally
  through local sandbox manager, local route-token smoke, capacity/image-pull
  failure mapping, runtime lifecycle audit, idle warning and idle stop policy,
  and admin force-stop audit. Real staging AWS/EKS configuration, credentials,
  Pod start/stop, and lifecycle idempotency remain unchecked.
- Worker image runtime pinning, local Docker build, local `/readyz` smoke, local
  worker auth denial/success smoke, and GitHub Actions worker image CI smoke
  are verified. CI run `26396842026` passed on
  `sandbox-worker-control-plane` at commit
  `4530b9148d9ba293d29200420d58c9ae8bba6cdb`.
- `docs/remote-codex-side-detailed-checklist.md` Phase 4 is complete for local
  worker image/runtime guardrails and CI worker image smoke.
- Worker artifact register, metadata/list, download, and delete routes exist
  behind signed identity-envelope `artifact:read` and `artifact:write` scopes.
- `docs/remote-codex-side-detailed-checklist.md` Phase 6 is complete for local
  LLM gateway integration: the gateway contract, admin client,
  provisioning/reconciliation, safe key metadata storage, redaction, degraded
  API/UI states, worker provider config rendering for Codex/Claude
  Code/OpenCode, startup diagnostics, usage import, scheduled import, LLM quota
  preflight, and usage UI are verified by local tests. Staging
  provider-runtime gateway smokes remain open.
- LLM gateway contract is fixed on a sub2api-compatible shape; provisioning,
  provider selection config, worker provider config rendering, manual usage
  import, gateway usage-export adapter, frontend degraded state, LLM usage
  summary, LLM usage detail UI, quota-exceeded UI, scheduled usage-import job,
  and usage import metrics exist.
- Gateway token storage is documented as metadata plus optional encrypted
  ciphertext only; raw provider keys and raw gateway tokens are not returned by
  Remote Codex APIs.
- Gateway admin/provider failures return stable `gateway_unavailable` API
  errors and the control-plane panel shows a dedicated gateway degraded state.
- ElAgenteHarness credential provisioning and worker bootstrap.

## Immediate Next Implementation Queue

1. Run `pnpm phase-zero-six:audit` first and inspect `nextCommands`,
   `blockingGroups`, and item-level `nextEvidenceCommand` fields. Use
   `pnpm phase-zero-six:audit:report` when a human-readable text report is
   easier than raw JSON; report commands are read-only and do not fail merely
   because live evidence is still missing. These fields identify whether the
   next collection step can be AWS-only or must use the full
   staging/runtime/provider bundle.
2. Run `pnpm phase-zero-six:template`, fill
   `.temp/phase-zero-six-evidence/phase-zero-six.env.sh` in a private operator
   shell, then `source` it. Do not commit the filled env file.
3. Run `pnpm phase-zero-six:env`. Use `pnpm phase-zero-six:env:report` when a
   human-readable text report is easier than raw JSON; report commands are
   operator aids and do not fail just because env is incomplete. Use
   `itemReadiness` and `nextCommands` to fill missing AWS, staging runtime,
   direct-worker, and provider smoke inputs.
4. Run `pnpm phase-zero-six:collect` once env readiness is complete. This
   collects AWS preflight, staging lifecycle/router smoke, provider gateway
   smoke, verifier output, artifact scans, `operator-report.txt`,
   `release-review.json`, and `summary.json`.
5. Review `.temp/phase-zero-six-evidence/latest/summary.json`,
   `operator-report.txt`, `release-review.json`, and raw evidence JSON for
   accidental secret exposure and expected live staging targets.
6. Run `pnpm phase-zero-six:audit` again for the current checklist state, and
   inspect `readyToCheck`, `stillMissing`, `blockingGroups`, and `nextCommands`
   before editing boxes.
7. If the bundle reports proven items under `readyToCheck`, run
   `pnpm phase-zero-six:apply`, then review and commit the checklist changes
   with the evidence artifacts referenced in the commit message.
8. For AWS-only S3.04/S3.05 work before runtime smoke exists, use
   `pnpm phase-zero-six:template:aws`, `pnpm phase-zero-six:env:aws`,
   `pnpm phase-zero-six:collect:aws`, and after review
   `pnpm phase-zero-six:apply:aws`.
9. Capture staging AWS/EKS proof for sandbox start, readiness, stop, and
   idempotent lifecycle.
10. Capture staging router proof for direct-worker denial and
   browser-to-router-to-worker traffic.
11. Run staging provider-runtime gateway smokes for Codex, Claude Code, and
   OpenCode, including gateway usage records and worker env/config root-key
   absence. Use `pnpm exec tsx scripts/provider-gateway-smoke.ts <provider>`
   inside the worker to produce the required evidence JSON.

## Verification Commands

Use the focused command for the area changed, then add broader checks before a
handoff.

```bash
pnpm --filter @remote-codex/control-plane-api typecheck
pnpm --filter @remote-codex/control-plane-api test
pnpm --filter @remote-codex/supervisor-web typecheck
pnpm --filter @remote-codex/supervisor-web test
pnpm --filter @remote-codex/supervisor-api typecheck
pnpm --filter @remote-codex/supervisor-api test
pnpm --filter @remote-codex/config typecheck
pnpm --filter @remote-codex/db typecheck
```

## Migration Policy

Control-plane migrations are forward-only in this branch. Do not edit a
published migration after it has been pushed. Add a new numbered migration for
schema fixes, additive fields, indexes, backfills, or compatibility changes.

Rollback is handled operationally by restoring the database from backups or by
applying a new forward migration that reverts the undesired schema/data change.
Every migration that affects product-control-plane tables should preserve
existing user, project, workspace, session, sandbox, usage, and audit records
unless a later checklist item explicitly defines a deletion policy.

Before marking a schema checklist item complete, verify at least:

```bash
pnpm --filter @remote-codex/db typecheck
pnpm --filter @remote-codex/control-plane-api test
```

Worker image verification target:

```bash
docker build -f Dockerfile.worker -t remote-codex-worker:verify .
```

Staging smoke targets:

- User login to authenticated shell.
- Project creation to workspace creation to session creation.
- Control plane starts one sandbox.
- Browser connects through router to worker.
- Worker rejects direct non-health requests without internal token.
- Worker runs Codex, Claude Code, and OpenCode through the LLM gateway.
- Worker calls ElAgenteHarness with the injected `INACT_X_APP_KEY`.
- Usage import shows LLM and harness usage for the correct product user.
