# Remote Codex Side Execution Checklist

This is the detailed execution checklist for the Remote Codex side of the
Agente sandbox-worker product.

Use this document as the working board for implementation. Check one box only
after the implementation and verification for that item exist in this
repository, or after the named staging smoke has actually run.

## Scope

Remote Codex owns:

- Railway frontend product surface.
- Railway control-plane API.
- Product auth integration, user records, projects, workspaces, sessions,
  sandbox registry, usage, quota, and audit records.
- Sandbox lifecycle orchestration for phase one.
- Sandbox router and route-token proxying when the router stays in this repo.
- Worker-mode supervisor API that runs inside each sandbox.
- Worker image bootstrap for Codex, Claude Code, OpenCode, MCP,
  ElAgenteHarness, and LLM gateway credentials.
- Remote Codex side integration contracts for the LLM gateway,
  ElAgenteHarness, object storage, AWS sandbox runtime, and compute job pools.

Remote Codex does not own:

- Real model provider root-key storage when the gateway owns those keys.
- LLM gateway routing internals.
- ElAgenteHarness workflow execution internals.
- Modal, AWS Batch, Slurm, ORCA, or other chemistry compute worker internals.
- Arbitrary command execution outside sandbox workers.

## Completion Rules

- Do not check a task because it is planned or documented.
- Check a task only after code, tests, smoke checks, deployment wiring, or a
  deliberately scoped documentation deliverable has landed.
- If a task depends on an external service, the Remote Codex task is complete
  only when the contract, client, fixture, mock, or deployment wiring exists in
  this repository.
- Keep staging and production tasks unchecked until the actual environment has
  been exercised.
- Add a short evidence note when checking a group of tasks:

```text
Evidence:
- Files: <main files>
- Verification: <commands or smoke checks>
- Residual risk: <what remains unchecked>
```

## Reference Verification Commands

Use focused commands for the area changed. Run broader checks before a handoff.

```bash
pnpm --filter @remote-codex/control-plane-api typecheck
pnpm --filter @remote-codex/control-plane-api test
pnpm --filter @remote-codex/sandbox-router typecheck
pnpm --filter @remote-codex/sandbox-router test
pnpm --filter @remote-codex/supervisor-api typecheck
pnpm --filter @remote-codex/supervisor-api test
pnpm --filter @remote-codex/supervisor-web typecheck
pnpm --filter @remote-codex/supervisor-web test
pnpm --filter @remote-codex/config typecheck
pnpm --filter @remote-codex/db typecheck
docker build -f Dockerfile.worker -t remote-codex-worker:verify .
```

## Target Product Shape

```text
Browser
  -> Railway Frontend
  -> Railway Control Plane API
     - auth
     - users/projects/workspaces/sessions
     - billing/quota/usage
     - sandbox registry
     - route-token issuance
     - gateway and harness credential mapping

Browser
  -> Sandbox Router
     - validates short-lived route token
     - resolves sandbox endpoint
     - injects worker token and signed identity envelope
     - proxies HTTP, SSE, and WebSocket

Control Plane API
  -> AWS Sandbox Manager
     - wraps Kubernetes/EKS operations
     - creates/deletes worker Pods
     - injects env and secrets
     - manages worker endpoint registration
     - snapshots workspaces when persistence is enabled

AWS EKS Fargate
  -> one active sandbox = one Pod = one container
     - remote-codex supervisor-api in worker mode
     - Codex / Claude Code / OpenCode
     - /workspace
     - approved MCP/tool configs
     - ElAgenteHarness client config

Worker
  -> LLM Gateway
     - gateway-scoped token only
     - no real provider root keys in sandbox

Worker
  -> ElAgenteHarness
     - INACT_X_APP_KEY
     - workflow catalog/task/job/artifact APIs
```

## Phase 0: Documentation And Release Baseline

Goal: keep the branch understandable and releaseable as product shape changes.

### Tasks

- [x] Add first staging release-readiness notes.
  - Acceptance: create a staging readiness document that names the exact
    services, env vars, smoke checks, rollback steps, and blocked gates for the
    first staging deploy.
  - Verification: docs link back to this checklist and to `docs/status.md`.

- [x] Add a release checklist that blocks production when required smoke checks
  are unchecked.
  - Acceptance: release checklist includes auth, sandbox lifecycle, router,
    gateway, harness, worker image, usage import, and rollback gates.
  - Verification: checklist is linked from `docs/README.md`.

- [x] Update `docs/status.md` after each major implementation slice.
  - Acceptance: status names completed work, current focus, and remaining
    risks.
  - Verification: status file commit accompanies larger phase handoffs.

### Evidence

- Files: `docs/staging-release-readiness.md`, `docs/release-gates.md`,
  `docs/status.md`, `docs/README.md`
- Verification: `git diff --check`
- Residual risk: staging has not been deployed or smoked; staging and
  production gates remain unchecked until real environment verification exists.

## Phase 1: Product Auth, Users, And Admin Boundary

Goal: product identity stays in the control plane and never becomes a worker
credential.

### Backend Tasks

- [ ] Add production auth-provider integration smoke.
  - Acceptance: the selected auth provider can issue a token accepted by the
    control plane in staging-like config.
  - Verification: integration smoke or documented staging smoke covers success,
    expired token, wrong issuer, and wrong audience.

- [x] Enforce disabled-user behavior for route-token issuance.
  - Acceptance: disabled users receive a stable `403` response and no route
    token.
  - Verification: control-plane tests cover active and disabled users.

- [x] Enforce disabled-user behavior for sandbox start/restart.
  - Acceptance: disabled users cannot start or restart a sandbox; already
    running sandboxes are handled according to documented policy.
  - Verification: lifecycle API tests cover disabled-account denial.

- [x] Enforce disabled-user behavior for usage import and billing visibility.
  - Acceptance: usage import never reactivates disabled users and billing
    visibility follows the documented account policy.
  - Verification: usage import tests cover disabled-user records.

- [x] Add user data export API or explicitly document deferral.
  - Acceptance: either an API returns exportable user/project/session/usage
    data, or `docs/status.md` documents why this is deferred.
  - Verification: API tests pass, or deferral is linked from release notes.

- [x] Add user deletion/anonymization API or explicitly document deferral.
  - Acceptance: either an API anonymizes/deletes product user data according to
    policy, or deferral is explicit before launch.
  - Verification: API tests pass, or deferral is linked from release notes.

### Frontend Tasks

- [x] Add dedicated login route or provider redirect entry.
  - Acceptance: unauthenticated users have a clear entry point into the selected
    auth provider.
  - Verification: frontend test covers rendering and redirect/action behavior.

- [x] Add authenticated app-shell guard.
  - Acceptance: protected product routes cannot render product data before auth
    resolves.
  - Verification: frontend tests cover unauthenticated and authenticated
    routing.

- [x] Add auth loading state.
  - Acceptance: the app shows a non-destructive loading state while the product
    auth session is being resolved.
  - Verification: frontend test covers pending auth.

- [x] Add expired-session state.
  - Acceptance: expired auth redirects or prompts re-login without losing local
    route state unexpectedly.
  - Verification: frontend test covers expired session behavior.

- [x] Add disabled-account state.
  - Acceptance: disabled users see a clear account state and cannot open
    sandbox sessions.
  - Verification: frontend test covers disabled response handling.

- [ ] Add admin user management UI.
  - Acceptance: admins can view users, update status, and update quota profile.
  - Verification: frontend tests cover list, status update, quota update, and
    non-admin denial UI.

### Boundary Tasks

- [ ] Add staging proof that worker requests never receive product JWTs.
  - Acceptance: staging worker logs or a diagnostic endpoint prove browser
    `Authorization` tokens are stripped before worker traffic.
  - Verification: staging smoke captures sanitized worker request headers.

### Evidence

- Files: `apps/control-plane-api/src/app.ts`,
  `apps/control-plane-api/src/app.test.ts`,
  `apps/supervisor-web/src/app.tsx`,
  `apps/supervisor-web/src/app.test.tsx`,
  `apps/supervisor-web/src/pages/ControlPlaneLoginPage.tsx`,
  `apps/supervisor-web/src/pages/ControlPlanePage.tsx`,
  `apps/supervisor-web/src/pages/ControlPlanePage.test.tsx`,
  `packages/shared/src/index.ts`, `docs/user-data-policy.md`,
  `docs/status.md`
- Verification: `pnpm --filter @remote-codex/control-plane-api typecheck`;
  `pnpm --filter @remote-codex/control-plane-api test`;
  `pnpm --filter @remote-codex/supervisor-web typecheck`;
  `pnpm --filter @remote-codex/supervisor-web test`;
  `pnpm --filter @remote-codex/shared typecheck`; `git diff --check`
- Residual risk: production auth-provider integration smoke, admin user
  management UI, and staging worker JWT proof remain unchecked. User data
  export and deletion/anonymization APIs are explicitly deferred and are not
  implemented.

## Phase 2: Projects, Workspaces, Sessions, And Worker Session Contract

Goal: the control plane owns durable product metadata while the worker owns live
sandbox-local execution state.

### Product Metadata Tasks

- [x] Add pagination for project lists.
  - Acceptance: project list endpoint accepts bounded pagination parameters and
    returns stable pagination metadata.
  - Verification: API tests cover default limit, custom limit, and ownership.

- [x] Add pagination for workspace lists.
  - Acceptance: workspace list endpoint paginates within a project context.
  - Verification: API tests cover pagination and cross-user denial.

- [x] Add pagination for session lists.
  - Acceptance: session list endpoint paginates within a workspace context.
  - Verification: API tests cover pagination and archived-session handling.

- [x] Add search/filter support for product lists.
  - Acceptance: product list APIs support the filters needed by the frontend
    without leaking cross-user data.
  - Verification: API tests cover search, status filters, and ownership.

### Session Sync Tasks

- [x] Add worker-to-control-plane heartbeat/checkpoint call.
  - Acceptance: worker mode can send checkpoint metadata for a live session to
    the control plane.
  - Verification: supervisor-api or integration test proves a checkpoint call
    reaches the expected control-plane endpoint.

- [x] Reject checkpoint sync for the wrong user.
  - Acceptance: a worker/user mismatch is rejected and audited.
  - Verification: control-plane tests cover wrong-user denial.

- [x] Reject checkpoint sync for the wrong sandbox.
  - Acceptance: a sandbox mismatch is rejected and audited.
  - Verification: control-plane tests cover wrong-sandbox denial.

- [x] Add retry/backoff policy for checkpoint submission.
  - Acceptance: transient control-plane failures retry with bounded backoff and
    do not block the worker indefinitely.
  - Verification: worker tests cover retry, stop condition, and log redaction.

- [x] Add audit events for session sync failures.
  - Acceptance: sync denials and repeated sync failures create audit records
    without sensitive payloads.
  - Verification: control-plane tests assert audit events.

- [x] Add session close/finalize sync behavior.
  - Acceptance: closing a worker session updates the durable control-plane
    session state.
  - Verification: integration or unit tests cover finalize success and retry.

### Frontend Tasks

- [x] Add project detail UI.
  - Acceptance: project detail shows project metadata, workspaces, and primary
    actions without needing direct worker access.
  - Verification: frontend tests cover loading, empty, populated, and error
    states.

- [x] Add loading states for every product metadata list.
  - Acceptance: project, workspace, and session lists have explicit pending
    states.
  - Verification: frontend tests cover each pending state.

- [ ] Add open-session flow that obtains a route token and connects through the
  router.
  - Acceptance: clicking a session opens the worker through the router using an
    in-memory route token.
  - Verification: frontend test or local e2e smoke covers open-session flow.

### Evidence

- Files: `apps/control-plane-api/src/app.ts`,
  `apps/control-plane-api/src/repository.ts`,
  `apps/control-plane-api/src/app.test.ts`,
  `apps/supervisor-api/src/worker-control-plane-sync.ts`,
  `apps/supervisor-api/src/worker-control-plane-sync.test.ts`,
  `apps/supervisor-api/src/routes/system.ts`, `packages/config/src/index.ts`
- Verification: `pnpm --filter @remote-codex/control-plane-api typecheck`;
  `pnpm --filter @remote-codex/control-plane-api test`;
  `pnpm --filter @remote-codex/supervisor-api typecheck`;
  `pnpm --filter @remote-codex/supervisor-api test`;
  `pnpm --filter @remote-codex/config typecheck`;
  `pnpm --filter @remote-codex/config test`
- Residual risk: the open-session router/worker connection task remains
  unchecked; no staging worker-to-control-plane smoke has run.

## Phase 3: Sandbox Lifecycle And AWS Runtime

Goal: the control plane can start, stop, observe, and recover one sandbox per
user on EKS Fargate.

### AWS Runtime Tasks

- [x] Define namespace and label strategy for hundreds of users.
  - Acceptance: docs and adapter config define namespace, labels, owner ids,
    environment names, and cleanup selectors.
  - Verification: AWS adapter tests assert required labels on created Pods.

- [x] Define Pod TTL and cleanup behavior.
  - Acceptance: stale Pods and orphaned registry records have a documented and
    implemented cleanup path.
  - Verification: reaper tests cover orphaned Pod, stale starting state, and
    stale stopping state.

- [x] Define scaling and capacity request process.
  - Acceptance: docs state expected active sandbox counts, resource profiles,
    Fargate profile/subnet constraints, and AWS quota request process.
  - Verification: staging readiness notes include capacity preflight.

- [x] Add sandbox idle-timeout policy.
  - Acceptance: idle criteria, warning behavior, snapshot behavior, and stop
    behavior are explicit.
  - Verification: lifecycle tests cover idle timeout decisions.

- [x] Add sandbox reaper job.
  - Acceptance: an internal reaper job endpoint repairs stale sandbox states and
    cleans orphaned runtime resources; deployment can schedule it every 1-5
    minutes.
  - Verification: job tests cover stale states and idempotency.

- [x] Add admin sandbox detail API.
  - Acceptance: admins can inspect one sandbox registry entry, runtime status,
    endpoint status, and recent lifecycle errors.
  - Verification: API tests cover admin success and non-admin denial.

- [x] Add admin sandbox detail UI.
  - Acceptance: admins can inspect sandbox status, owner, image, resource
    profile, endpoint, and last failure.
  - Verification: frontend tests cover admin and non-admin behavior.

### Staging Tasks

- [ ] Add staging start-one-sandbox smoke test.
  - Acceptance: control plane creates and starts one real EKS Fargate worker
    Pod from the configured image.
  - Verification: staging smoke records Pod name, sandbox id, and `/readyz`
    result.

- [ ] Add staging stop-one-sandbox smoke test.
  - Acceptance: control plane stops the same worker and registry state becomes
    stopped.
  - Verification: staging smoke records Pod deletion/termination and final
    control-plane status.

- [ ] Add staging idempotent lifecycle smoke.
  - Acceptance: repeated start, stop, and restart calls do not corrupt sandbox
    registry state.
  - Verification: staging smoke records repeated operations and final state.

### Evidence

- Files:
- Verification:
- Residual risk:

## Phase 4: Worker Image, Runtime, And Startup Guardrails

Goal: the sandbox worker starts from a reproducible image and fails closed when
identity, filesystem, provider, MCP, gateway, or harness settings are unsafe.

### Image Tasks

- [ ] Build the worker image locally from a clean checkout.
  - Acceptance: `Dockerfile.worker` builds without depending on local dirty
    files.
  - Verification: `docker build -f Dockerfile.worker -t remote-codex-worker:verify .`

- [ ] Run the worker container locally and verify `/readyz`.
  - Acceptance: the built image starts in worker mode with minimal required
    env and returns healthy readiness.
  - Verification: local container smoke captures `/readyz`.

- [ ] Add CI worker image build.
  - Acceptance: CI builds the worker image on PR or branch push.
  - Verification: CI config exists and build job passes.

- [ ] Add CI worker `/readyz` smoke.
  - Acceptance: CI starts the image and verifies readiness.
  - Verification: CI smoke logs show `/readyz` success.

### Startup Guardrail Tasks

- [x] Validate MCP config path and permissions.
  - Acceptance: worker startup rejects missing, world-writable, or outside-home
    MCP config paths when MCP is enabled.
  - Verification: supervisor-api tests cover valid and invalid config paths.

- [x] Redact harness key from startup logs.
  - Acceptance: `INACT_X_APP_KEY` and equivalent harness secrets never appear in
    startup logs.
  - Verification: tests assert redacted startup output.

- [x] Redact gateway token from startup logs.
  - Acceptance: gateway tokens never appear in startup logs.
  - Verification: tests assert redacted startup output.

### Worker Authorization Tasks

- [ ] Add artifact read/write scope checks.
  - Acceptance: artifact download, upload, metadata, and delete routes require
    the appropriate identity-envelope scopes.
  - Verification: worker tests cover missing, wrong, and valid scopes.

- [ ] Add local worker container auth denial smoke.
  - Acceptance: non-health routes reject requests without an internal token.
  - Verification: local smoke captures `401` or `403`.

- [ ] Add local worker container auth success smoke.
  - Acceptance: non-health routes accept the internal worker token and valid
    identity envelope where required.
  - Verification: local smoke captures successful response.

### Evidence

- Files:
- Verification:
- Residual risk:

## Phase 5: Sandbox Router And Route Tokens

Goal: browsers reach workers only through short-lived route tokens and
router-injected internal worker identity.

### Route Token Tasks

- [x] Add revocation strategy if required before launch.
  - Acceptance: route-token revocation is either implemented or explicitly
    deferred with a short TTL risk note.
  - Verification: revocation tests pass, or release notes document deferral.

- [x] Include project/workspace/session scopes when opening a session.
  - Acceptance: route tokens can be scoped to the selected project, workspace,
    and session.
  - Verification: control-plane and router tests cover session-scoped tokens.

- [x] Add tests proving route tokens are not persisted in local storage.
  - Acceptance: frontend stores route tokens only in memory.
  - Verification: frontend tests assert no local/session storage writes.

### Router Tasks

- [ ] Add staging direct-worker-denial proof.
  - Acceptance: direct requests to a worker public endpoint fail without the
    router-injected worker token.
  - Verification: staging smoke records direct denial and router success.

- [ ] Add staging browser-to-router-to-worker smoke.
  - Acceptance: a real browser session reaches a real worker through the router
    using a control-plane-issued route token.
  - Verification: staging smoke captures route-token issue, router connection,
    and worker response.

### Frontend Tasks

- [ ] Reconnect WebSocket after token refresh.
  - Acceptance: long-running sessions refresh route tokens and reconnect
    without requiring full app reload.
  - Verification: frontend or e2e test simulates expiring token and reconnect.

- [ ] Show sandbox offline state from router failures.
  - Acceptance: router `sandbox_offline` or upstream errors produce a clear UI
    state.
  - Verification: frontend tests cover offline and reconnect states.

### Evidence

- Files: `packages/shared/src/tokens.ts`,
  `apps/control-plane-api/src/app.ts`,
  `apps/control-plane-api/src/app.test.ts`,
  `apps/sandbox-router/src/worker-identity.ts`,
  `apps/sandbox-router/src/app.test.ts`,
  `apps/supervisor-web/src/pages/ControlPlanePage.tsx`,
  `apps/supervisor-web/src/pages/ControlPlanePage.test.tsx`
- Verification:
  `pnpm --filter @remote-codex/control-plane-api typecheck`,
  `pnpm --filter @remote-codex/control-plane-api test`,
  `pnpm --filter @remote-codex/sandbox-router typecheck`,
  `pnpm --filter @remote-codex/sandbox-router test`,
  `pnpm --filter @remote-codex/supervisor-web typecheck`,
  `pnpm --filter @remote-codex/supervisor-web test`
- Residual risk: staging direct-worker-denial and browser-to-router-to-worker
  smoke checks are still unchecked until a staging environment is exercised.

## Phase 6: LLM Gateway Integration

Goal: Codex, Claude Code, and OpenCode use gateway tokens inside the sandbox;
real provider root keys stay outside the sandbox.

### Gateway Contract Tasks

- [x] Choose phase-one gateway implementation: sub2api or lightweight custom
  gateway.
  - Acceptance: docs name the chosen gateway, deployment location, ownership,
    and fallback plan.
  - Verification: architecture decision is linked from `docs/README.md`.

- [x] Document gateway deployment shape.
  - Acceptance: docs cover service placement, network path, storage, secrets,
    admin access, backup, and upgrade path.
  - Verification: deployment docs include required env vars and smoke checks.

- [x] Document gateway admin credential requirements.
  - Acceptance: docs list admin token storage, rotation, and least-privilege
    requirements.
  - Verification: docs are referenced from staging readiness notes.

- [x] Document gateway admin API endpoints used by Remote Codex.
  - Acceptance: docs describe user create, key create, revoke, rotate,
    reconcile, and usage export endpoints.
  - Verification: gateway client tests align with documented endpoint shapes.

- [x] Document required gateway usage-export API shape.
  - Acceptance: docs define event id, external key id, model, token fields,
    cost, currency, timestamp, and pagination/watermark behavior.
  - Verification: usage importer tests use the documented fixture shape.

- [x] Add gateway unavailable/degraded behavior.
  - Acceptance: control plane and frontend have stable degraded states when the
    gateway admin API or model proxy is unavailable.
  - Verification: API and frontend tests cover gateway unavailable responses.

Evidence:

- Files: `docs/llm-gateway-contract.md`, `docs/README.md`,
  `docs/staging-release-readiness.md`, `docs/release-gates.md`,
  `apps/control-plane-api/src/adapters.ts`,
  `apps/control-plane-api/src/adapters.test.ts`,
  `apps/control-plane-api/src/app.ts`,
  `apps/control-plane-api/src/app.test.ts`
- Verification:
  `pnpm --filter @remote-codex/control-plane-api typecheck`,
  `pnpm --filter @remote-codex/control-plane-api test`
- Residual risk: scheduled gateway usage pulling and staging provider-runtime
  smoke checks remain unchecked.

### Control Plane Tasks

- [x] Add gateway provider config table or config source.
  - Acceptance: gateway provider config is not hard-coded when multiple
    environments or gateways are expected.
  - Verification: config tests cover missing and valid gateway provider config.

- [x] Store encrypted gateway token only if raw recovery is required.
  - Acceptance: docs and schema clarify whether raw gateway tokens are stored,
    encrypted, or write-only after provisioning.
  - Verification: tests prove raw tokens are redacted from API responses and
    logs; migration exists if schema changes.

- [x] Add usage import adapter for the chosen gateway.
  - Acceptance: control plane can fetch gateway usage from the chosen gateway
    admin API and normalize it into the usage event schema.
  - Verification: gateway client tests and control-plane tests cover import,
    identity mapping, dedupe, and gateway-export response parsing.

- [x] Add scheduled usage import job.
  - Acceptance: import runs on a schedule with a stored watermark and bounded
    batch size.
  - Verification: job tests cover initial import, incremental import, retry,
    and idempotency.

- [x] Add usage import logs and metrics.
  - Acceptance: import records source count, imported count, duplicate count,
    failure count, and last successful watermark without secrets.
  - Verification: tests or smoke logs prove structured records are emitted.

### Worker Provider Tasks

- [ ] Add staging smoke where Codex reaches the gateway.
  - Acceptance: Codex inside a real worker makes a model request through the
    gateway using only the scoped gateway token.
  - Verification: staging smoke records worker request success and confirms no
    provider root key exists in worker env/config.

- [ ] Add staging smoke where Claude Code reaches the gateway.
  - Acceptance: Claude Code inside a real worker makes a model request through
    the gateway using only the scoped gateway token.
  - Verification: staging smoke records worker request success and confirms no
    provider root key exists in worker env/config.

- [ ] Add staging smoke where OpenCode reaches the gateway.
  - Acceptance: OpenCode inside a real worker makes a model request through the
    gateway using only the scoped gateway token.
  - Verification: staging smoke records worker request success and confirms no
    provider root key exists in worker env/config.

### Frontend Tasks

- [x] Add LLM usage summary UI.
  - Acceptance: users can see total LLM spend/tokens for the current billing
    period.
  - Verification: frontend tests cover loading, populated, empty, and error
    states.

- [x] Add LLM usage detail UI.
  - Acceptance: users can inspect usage events by time, model, and provider.
  - Verification: frontend tests cover event list and pagination/filtering if
    available.

- [x] Add gateway unavailable UI.
  - Acceptance: gateway provisioning or usage import failures show a clear
    product state.
  - Verification: frontend tests cover gateway degraded responses.

- [x] Add quota exceeded UI for LLM usage.
  - Acceptance: users see a clear blocked state when LLM quota is exceeded.
  - Verification: frontend tests cover quota exceeded response shape.

### Evidence

- Files: `apps/supervisor-web/src/pages/ControlPlanePage.tsx`,
  `apps/supervisor-web/src/pages/ControlPlanePage.test.tsx`,
  `packages/shared/src/index.ts`
- Verification: `pnpm --filter @remote-codex/supervisor-web typecheck`;
  `pnpm --filter @remote-codex/supervisor-web test`;
  `pnpm --filter @remote-codex/shared typecheck`
- Residual risk: staging provider-runtime gateway smokes remain unchecked.

## Phase 7: ElAgenteHarness Integration

Goal: sandbox agents can call computational chemistry workflows through
ElAgenteHarness using scoped `INACT_X_APP_KEY` credentials.

### Credential Provisioning Tasks

- [ ] Add harness admin credential config if required.
  - Acceptance: control plane can authenticate to harness admin APIs without
    exposing admin credentials to workers.
  - Verification: config tests cover missing and valid harness admin config.

- [ ] Add harness credential table.
  - Acceptance: Remote Codex can map harness credentials to product users and
    sandboxes.
  - Verification: migration and repository tests pass.

- [ ] Decide whether Remote Codex stores only key hashes or encrypted raw keys.
  - Acceptance: docs and schema state whether raw key recovery is possible.
  - Verification: tests prove raw keys are redacted from logs and API responses.

- [ ] Generate `INACT_X_APP_KEY` during user or sandbox provisioning.
  - Acceptance: new users or sandboxes receive a scoped harness key before the
    worker starts.
  - Verification: provisioning tests cover generated key injection.

- [ ] Bind harness key to user id.
  - Acceptance: harness key records cannot be used across users.
  - Verification: ownership tests cover cross-user denial.

- [ ] Bind harness key to sandbox id.
  - Acceptance: harness keys are scoped to the phase-one sandbox when required.
  - Verification: credential tests cover sandbox mismatch.

- [ ] Bind harness key to scopes.
  - Acceptance: key scopes match allowed workflow/task/job actions.
  - Verification: tests cover allowed and denied scope sets.

- [ ] Bind harness key to quota profile.
  - Acceptance: harness calls can be tied to product quota limits.
  - Verification: quota tests cover harness key provisioning.

- [ ] Add harness key rotation endpoint.
  - Acceptance: admins or automated lifecycle can rotate a user's harness key
    and update future sandbox env injection.
  - Verification: API tests cover rotate, audit, and old key state.

- [ ] Add harness key revocation endpoint.
  - Acceptance: admins can revoke harness access for a user or sandbox.
  - Verification: API tests cover revoke and non-admin denial.

- [ ] Add harness credential ownership tests.
  - Acceptance: users cannot view, rotate, or revoke other users' harness
    credentials.
  - Verification: control-plane tests pass.

### Worker Bootstrap And Tool Surface Tasks

- [ ] Redact harness key from logs.
  - Acceptance: `INACT_X_APP_KEY` never appears in worker/control-plane/router
    logs.
  - Verification: redaction tests cover harness key patterns.

- [ ] Redact harness key from API responses.
  - Acceptance: APIs return only safe harness credential metadata.
  - Verification: API tests assert raw key absence.

- [ ] Add staging smoke where worker calls harness with injected key.
  - Acceptance: real worker calls staging harness and receives authenticated
    response.
  - Verification: staging smoke records worker id, harness task/catalog call,
    and no raw key exposure.

- [ ] Decide whether the first tool surface is MCP, shell wrappers, provider
  config, or a combination.
  - Acceptance: architecture decision explains first implementation and why.
  - Verification: decision doc is linked from this checklist.

- [ ] Render ElAgenteHarness MCP config if MCP is used.
  - Acceptance: worker renders an approved MCP server entry pointing to harness
    with scoped env.
  - Verification: config rendering tests pass.

- [ ] Render ElAgenteHarness shell/tool wrappers if wrappers are used.
  - Acceptance: wrappers call harness with scoped env and no host-local paths.
  - Verification: wrapper tests or worker tests pass.

- [ ] Integrate harness tools into Codex config.
  - Acceptance: Codex can discover the approved harness tool surface.
  - Verification: provider bootstrap tests cover Codex harness config.

- [ ] Integrate harness tools into Claude Code config.
  - Acceptance: Claude Code can discover the approved harness tool surface.
  - Verification: provider bootstrap tests cover Claude harness config.

- [ ] Integrate harness tools into OpenCode config.
  - Acceptance: OpenCode can discover the approved harness tool surface.
  - Verification: provider bootstrap tests cover OpenCode harness config.

- [ ] Add tests for harness tool config rendering.
  - Acceptance: rendering tests prove paths, env, and secrets are safe.
  - Verification: harness tool config tests pass.

### Product API And UI Tasks

- [ ] Add workflow catalog endpoint or proxy integration.
  - Acceptance: frontend can list available harness workflows through the
    control plane or approved API path.
  - Verification: API tests cover success, unavailable harness, and auth.

- [ ] Add task list endpoint or proxy integration.
  - Acceptance: users can list their harness tasks.
  - Verification: API tests cover ownership and pagination if applicable.

- [ ] Add task detail endpoint or proxy integration.
  - Acceptance: users can inspect task status, inputs, outputs, and linked
    artifacts.
  - Verification: API tests cover ownership and missing task states.

- [ ] Add artifact metadata endpoint or proxy integration.
  - Acceptance: users can inspect harness artifact metadata without exposing
    storage credentials.
  - Verification: API tests cover signed URL or metadata behavior.

- [ ] Add workflow catalog UI.
  - Acceptance: users can browse available computational chemistry workflows.
  - Verification: frontend tests cover loading, empty, populated, and error
    states.

- [ ] Add task status UI.
  - Acceptance: users can track running, failed, and completed harness tasks.
  - Verification: frontend tests cover task states.

- [ ] Add job status UI.
  - Acceptance: users can see external compute job progress when harness
    exposes it.
  - Verification: frontend tests cover job pending/running/complete/fail.

- [ ] Add chemistry artifact display hooks.
  - Acceptance: UI can link to or preview supported chemistry artifacts.
  - Verification: frontend tests cover known artifact metadata types.

- [ ] Add missing-harness-key error state.
  - Acceptance: missing credential state is actionable and does not expose raw
    secrets.
  - Verification: frontend tests cover missing key response.

- [ ] Add harness-unavailable error state.
  - Acceptance: harness downtime shows a clear degraded product state.
  - Verification: frontend tests cover unavailable response.

### Usage Tasks

- [ ] Define normalized harness usage event schema.
  - Acceptance: schema covers workflow id, task id, job id, units, estimated
    cost, actual cost, currency, user id, sandbox id, and timestamps.
  - Verification: schema tests cover valid and invalid events.

- [ ] Add harness webhook receiver or polling importer.
  - Acceptance: Remote Codex can ingest harness usage idempotently.
  - Verification: importer tests cover dedupe, retry, and malformed payloads.

- [ ] Map harness usage to user id.
  - Acceptance: imported harness usage always resolves to a product user.
  - Verification: tests cover known and unknown user mappings.

- [ ] Map harness usage to sandbox id.
  - Acceptance: usage resolves to sandbox when available.
  - Verification: tests cover sandbox mapping and missing sandbox behavior.

- [ ] Map harness usage to project/workspace/session when available.
  - Acceptance: usage links to product context when harness payload includes
    enough metadata.
  - Verification: tests cover linked and unlinked usage.

- [ ] Store workflow id, job id, usage units, estimated cost, and actual cost.
  - Acceptance: usage ledger stores enough detail for billing and user-facing
    summaries.
  - Verification: repository and API tests cover stored fields.

- [ ] Add harness usage to billing summary.
  - Acceptance: user usage summary includes harness usage totals.
  - Verification: summary endpoint tests cover combined LLM and harness usage.

### Evidence

- Files:
- Verification:
- Residual risk:

## Phase 8: MCP And Tool Policy

Goal: MCP and tool execution stay inside the sandbox, are auditable, and do not
mount host-local resources.

### Policy Tasks

- [ ] Define approved MCP server registry.
  - Acceptance: registry names allowed servers, commands, args, env, cwd,
    scopes, and owner.
  - Verification: config tests validate registry shape.

- [ ] Define stdio MCP launch policy.
  - Acceptance: stdio MCP servers run only inside the sandbox with bounded env
    and cwd under `/workspace`.
  - Verification: policy tests cover allowed and denied launch configs.

- [ ] Define remote MCP allowlist policy.
  - Acceptance: remote MCP endpoints are allowlisted by origin and scope.
  - Verification: policy tests cover allowed and denied origins.

- [ ] Define env-var allowlist for MCP stdio servers.
  - Acceptance: MCP receives only explicit env vars, not full worker env.
  - Verification: rendering tests prove secret env vars are excluded.

- [ ] Define cwd policy requiring stdio MCP servers to run under `/workspace`.
  - Acceptance: relative and absolute cwd values cannot escape `/workspace`.
  - Verification: path validation tests cover traversal and symlinks if
    applicable.

- [ ] Block host-local filesystem MCP servers by default.
  - Acceptance: filesystem MCP servers cannot mount host paths outside
    `/workspace`.
  - Verification: policy tests cover denied host-local paths.

- [ ] Block host-local Docker MCP servers by default.
  - Acceptance: MCP cannot access Docker socket or host container runtime.
  - Verification: policy tests cover denied Docker socket env/mounts.

- [ ] Block host-local database MCP servers by default.
  - Acceptance: database MCP servers require explicit registry approval and
    scoped credentials.
  - Verification: policy tests cover denied default DB configs.

- [ ] Add ElAgenteHarness tools to the approved MCP/tool registry.
  - Acceptance: harness tools are registered with scoped env and allowed
    commands.
  - Verification: registry tests cover harness entries.

### Config Rendering Tasks

- [ ] Render Codex MCP config under the sandbox provider home.
  - Acceptance: Codex MCP config is written under `/home/agent` and references
    only approved servers.
  - Verification: provider bootstrap tests pass.

- [ ] Render Claude Code MCP config under the sandbox provider home.
  - Acceptance: Claude Code MCP config is written under `/home/agent` and
    references only approved servers.
  - Verification: provider bootstrap tests pass.

- [ ] Render OpenCode MCP config under the sandbox provider home.
  - Acceptance: OpenCode MCP config is written under `/home/agent` and
    references only approved servers.
  - Verification: provider bootstrap tests pass.

- [ ] Validate rendered config path and permissions at worker startup.
  - Acceptance: worker rejects missing, unsafe, or externally writable MCP
    config.
  - Verification: startup tests cover path and permissions.

- [ ] Add tests proving stdio MCP cwd is inside `/workspace`.
  - Acceptance: tests cover absolute path, relative path, traversal, and valid
    project directory.
  - Verification: MCP policy tests pass.

- [ ] Add tests proving MCP env is allowlisted.
  - Acceptance: tokens and unrelated worker secrets are excluded.
  - Verification: config rendering tests assert env keys.

### Audit And UI Tasks

- [ ] Add MCP startup audit events.
  - Acceptance: worker/control plane records which approved MCP servers started.
  - Verification: tests assert audit payloads without secrets.

- [ ] Add MCP tool-call audit events.
  - Acceptance: tool calls produce auditable metadata without sensitive payloads.
  - Verification: tests cover success and failure audit events.

- [ ] Add MCP failure timeline items where useful.
  - Acceptance: user-visible timeline shows actionable MCP startup/call
    failures.
  - Verification: frontend or worker tests cover failure item shape.

- [ ] Add UI for MCP status and failures.
  - Acceptance: users can see enabled tools and current failure state.
  - Verification: frontend tests cover enabled, disabled, and failed states.

### Evidence

- Files:
- Verification:
- Residual risk:

## Phase 9: Workspace Persistence, Diffs, And Artifacts

Goal: workspaces survive sandbox restarts and users can review files/artifacts
created by agents and chemistry jobs.

### Persistence Tasks

- [ ] Choose phase-one persistence backend: EFS, S3 snapshots, or temporary MVP
  workspace.
  - Acceptance: architecture decision states the chosen backend and tradeoffs.
  - Verification: decision doc is linked from this checklist.

- [ ] Document EFS tradeoffs.
  - Acceptance: docs cover cost, latency, POSIX behavior, Fargate support, and
    multi-AZ concerns.
  - Verification: docs are linked from persistence decision.

- [ ] Document S3 snapshot tradeoffs.
  - Acceptance: docs cover save/restore semantics, consistency, performance,
    retention, and file metadata limits.
  - Verification: docs are linked from persistence decision.

- [ ] Document temporary workspace limitations if chosen for MVP.
  - Acceptance: docs state data loss risks and user-facing limitations.
  - Verification: release checklist includes explicit acknowledgement.

- [ ] Define maximum workspace size.
  - Acceptance: size limit is enforced or at least measured before snapshot.
  - Verification: tests cover limit behavior or measurement output.

- [ ] Define maximum artifact size.
  - Acceptance: artifact upload/view endpoints enforce documented limits.
  - Verification: tests cover too-large artifacts.

- [ ] Add snapshot metadata table.
  - Acceptance: DB stores snapshot id, user id, sandbox id, workspace id, object
    path, size, status, and timestamps.
  - Verification: migration and repository tests pass.

- [ ] Restore snapshot before worker readiness.
  - Acceptance: worker is not marked ready for a workspace until restore
    completes or explicitly fails according to policy.
  - Verification: lifecycle tests cover restore success and failure.

- [ ] Save snapshot before sandbox stop.
  - Acceptance: controlled stop saves workspace state when persistence is
    enabled.
  - Verification: lifecycle tests cover snapshot before stop.

- [ ] Add manual snapshot endpoint.
  - Acceptance: user or admin can trigger a snapshot according to ownership and
    quota policy.
  - Verification: API tests cover success, ownership, and quota.

- [ ] Add snapshot status endpoint.
  - Acceptance: frontend can poll snapshot status.
  - Verification: API tests cover pending, complete, failed.

- [ ] Add snapshot failure handling.
  - Acceptance: failures update status, show user/admin state, and do not lose
    registry consistency.
  - Verification: tests cover failure transitions.

- [ ] Add snapshot retry policy.
  - Acceptance: retry count and backoff are bounded.
  - Verification: job tests cover retry and terminal failure.

- [ ] Add snapshot retention policy.
  - Acceptance: retention by age/count is documented and enforced or queued.
  - Verification: retention job tests pass.

### Diff Tasks

- [ ] Initialize baseline in `/workspace`.
  - Acceptance: workspace has a known baseline for diffing after project setup
    or restore.
  - Verification: worker tests cover baseline creation.

- [ ] Preserve git metadata when source is a git repository.
  - Acceptance: git workspaces keep commit history and remotes unless policy
    says otherwise.
  - Verification: worker tests cover git workspace restore/diff.

- [ ] Create synthetic baseline commit when source is not a git repository.
  - Acceptance: non-git workspaces still support changed-file and diff views.
  - Verification: worker tests cover synthetic baseline.

- [ ] Add worker changed-files endpoint.
  - Acceptance: worker returns changed path, status, size, and binary flag.
  - Verification: API tests cover text, binary, delete, rename where supported.

- [ ] Add worker text-diff endpoint.
  - Acceptance: worker returns bounded textual diffs.
  - Verification: tests cover normal diff and size limits.

- [ ] Add worker binary-diff metadata endpoint.
  - Acceptance: binary changes return metadata, not raw binary diff.
  - Verification: tests cover binary files.

- [ ] Add patch size limit.
  - Acceptance: large patches are rejected or truncated according to policy.
  - Verification: tests cover limit.

- [ ] Add file size limit.
  - Acceptance: diff/read endpoints enforce maximum file size.
  - Verification: tests cover too-large file.

- [ ] Add symlink policy.
  - Acceptance: symlinks cannot escape `/workspace`.
  - Verification: tests cover symlink traversal.

- [ ] Add executable-bit policy.
  - Acceptance: executable changes are shown and controlled according to
    security policy.
  - Verification: tests cover executable-bit changes.

- [ ] Add delete policy.
  - Acceptance: deletes are represented in diffs and require user-visible
    review where applicable.
  - Verification: tests cover deletion.

- [ ] Add generated credential exclusion policy.
  - Acceptance: generated gateway/harness/provider credential files are
    excluded from user diff export.
  - Verification: tests prove credential paths are omitted/redacted.

- [ ] Add diff review UI.
  - Acceptance: users can inspect changed files and textual diffs.
  - Verification: frontend tests cover changed-file list and diff viewer.

- [ ] Add apply accepted changes path.
  - Acceptance: accepted changes can be exported, committed, or applied to the
    target project according to product policy.
  - Verification: API/frontend tests cover accepted and rejected changes.

### Artifact Tasks

- [ ] Define artifact ownership model.
  - Acceptance: docs define owner, sandbox, workspace/session linkage, and
    access control.
  - Verification: docs linked from artifact implementation.

- [ ] Define object storage path format.
  - Acceptance: object keys include environment, user/sandbox/workspace
    partitioning, artifact id, and no raw user-supplied unsafe path.
  - Verification: tests cover object key generation.

- [ ] Add artifact upload from worker or harness.
  - Acceptance: worker or harness can register/upload artifacts without
    exposing storage credentials to the browser.
  - Verification: API tests cover upload/register flow.

- [ ] Add artifact download/view URL endpoint.
  - Acceptance: users receive short-lived URLs or proxied artifact responses for
    owned artifacts only.
  - Verification: API tests cover ownership and expiry.

- [ ] Add artifact retention policy.
  - Acceptance: retention by age, size, and account status is documented.
  - Verification: retention tests pass if enforcement is implemented.

- [ ] Add chemistry artifact type mapping.
  - Acceptance: known chemistry artifacts have metadata types for UI rendering.
  - Verification: tests cover known artifact type mapping.

### Evidence

- Files:
- Verification:
- Residual risk:

## Phase 10: Billing, Quotas, And Usage Ledger

Goal: Remote Codex normalizes paid-resource usage from gateway, harness,
compute, storage, and sandbox runtime into one billing surface.

### Ledger Tasks

- [ ] Finalize usage ledger schema across all sources.
  - Acceptance: schema supports LLM, harness, compute, storage, and sandbox
    runtime without one-off tables per source.
  - Verification: migration and repository tests pass.

- [ ] Add usage source enum for `llm`.
  - Acceptance: LLM events use a stable source value.
  - Verification: usage tests cover LLM source.

- [ ] Add usage source enum for `harness`.
  - Acceptance: harness workflow/task usage can be stored.
  - Verification: usage tests cover harness source.

- [ ] Add usage source enum for `compute`.
  - Acceptance: external compute jobs can be billed.
  - Verification: usage tests cover compute source.

- [ ] Add usage source enum for `storage`.
  - Acceptance: object storage/snapshot usage can be billed.
  - Verification: usage tests cover storage source.

- [ ] Add usage source enum for `sandbox_runtime`.
  - Acceptance: active sandbox runtime can be billed or quota-limited.
  - Verification: usage tests cover runtime source.

- [ ] Add dedupe key for imported usage events.
  - Acceptance: gateway/harness/compute imports are idempotent.
  - Verification: importer tests cover duplicate events.

- [ ] Store user id on usage events.
  - Acceptance: every billable event resolves to a user or lands in a dead
    letter/unresolved queue.
  - Verification: repository tests cover user mapping.

- [ ] Store sandbox id on usage events.
  - Acceptance: sandbox context is stored when available.
  - Verification: repository tests cover sandbox mapping.

- [ ] Store project id when available.
  - Acceptance: usage can be filtered by project when event metadata includes
    enough context.
  - Verification: tests cover project-linked usage.

- [ ] Store workspace id when available.
  - Acceptance: usage can be filtered by workspace when event metadata includes
    enough context.
  - Verification: tests cover workspace-linked usage.

- [ ] Store session id when available.
  - Acceptance: usage can be filtered by session when event metadata includes
    enough context.
  - Verification: tests cover session-linked usage.

- [ ] Store usage units.
  - Acceptance: each source has normalized units and raw metadata.
  - Verification: tests cover unit conversion.

- [ ] Store cost amount.
  - Acceptance: cost can be displayed and billed with decimal-safe handling.
  - Verification: tests cover cost precision.

- [ ] Store currency.
  - Acceptance: events include currency or a configured default.
  - Verification: tests cover currency.

- [ ] Store metadata JSON.
  - Acceptance: source-specific raw metadata is available for reconciliation
    without storing secrets.
  - Verification: tests cover metadata redaction.

### Quota Tasks

- [ ] Add quota profile schema.
  - Acceptance: quota profiles are durable and versionable.
  - Verification: migration and repository tests pass.

- [ ] Add user quota assignment.
  - Acceptance: users can be assigned quota profiles by admin or default signup
    policy.
  - Verification: user tests cover default and admin update.

- [ ] Add compute spend quota.
  - Acceptance: compute job creation can be blocked or warned based on quota.
  - Verification: quota tests cover compute source.

- [ ] Add storage quota.
  - Acceptance: snapshots/artifacts respect storage quota.
  - Verification: quota tests cover storage source.

- [ ] Add sandbox runtime quota.
  - Acceptance: sandbox runtime duration can be limited.
  - Verification: quota tests cover runtime source.

- [ ] Add quota preflight before harness job creation when visible to Remote
  Codex.
  - Acceptance: Remote Codex blocks or warns before expensive harness/compute
    jobs when it is in the request path.
  - Verification: API tests cover quota exceeded for harness job creation.

### Frontend And Admin Tasks

- [ ] Add usage dashboard.
  - Acceptance: users can see total usage by source and billing period.
  - Verification: frontend tests cover summary states.

- [ ] Add LLM usage breakdown.
  - Acceptance: users can inspect model/token/cost breakdown.
  - Verification: frontend tests cover LLM breakdown.

- [ ] Add workflow usage breakdown.
  - Acceptance: users can inspect workflow/task usage.
  - Verification: frontend tests cover workflow usage.

- [ ] Add compute usage breakdown.
  - Acceptance: users can inspect external compute job usage and costs.
  - Verification: frontend tests cover compute usage.

- [ ] Add quota remaining display.
  - Acceptance: users can see remaining quota for relevant sources.
  - Verification: frontend tests cover quota display.

- [ ] Add quota exceeded banner.
  - Acceptance: quota denial responses show clear user-facing state.
  - Verification: frontend tests cover quota exceeded errors.

- [ ] Add admin usage reconciliation page or export endpoint.
  - Acceptance: admins can reconcile gateway/harness usage with product ledger.
  - Verification: API/frontend tests cover admin-only access.

### Evidence

- Files:
- Verification:
- Residual risk:

## Phase 11: Deployment, Operations, And CI

Goal: the product can be deployed, observed, scaled, and recovered without
manual guesswork.

### Railway Tasks

- [ ] Add Railway service definition for frontend.
  - Acceptance: frontend deploy config is versioned.
  - Verification: Railway deployment or config validation succeeds.

- [ ] Add Railway service definition for control-plane API.
  - Acceptance: control-plane deploy config is versioned.
  - Verification: Railway deployment or config validation succeeds.

- [ ] Add Railway Postgres configuration.
  - Acceptance: DB connection and migration behavior are documented.
  - Verification: staging deploy runs migrations successfully.

- [ ] Add required frontend env documentation.
  - Acceptance: docs list every required frontend env var and safe example.
  - Verification: docs linked from deployment checklist.

- [ ] Add required control-plane env documentation.
  - Acceptance: docs list auth, DB, router, AWS, gateway, harness, and secrets
    env vars.
  - Verification: config tests or docs cover missing env behavior.

- [ ] Add migration command for deploy.
  - Acceptance: deployment process runs forward-only migrations explicitly.
  - Verification: staging deploy logs show migration command.

- [ ] Add frontend health check.
  - Acceptance: deployment platform can verify frontend health.
  - Verification: health check smoke succeeds.

- [ ] Add control-plane health check.
  - Acceptance: deployment platform can verify API health and dependency state.
  - Verification: health check smoke succeeds.

### AWS Tasks

- [ ] Add AWS account and environment naming convention.
  - Acceptance: docs define dev/staging/prod account or namespace strategy.
  - Verification: docs linked from staging readiness notes.

- [ ] Add ECR repository for worker image.
  - Acceptance: worker image has a registry and immutable tag policy.
  - Verification: image push smoke succeeds or IaC plan includes ECR.

- [ ] Add sandbox router deployment plan.
  - Acceptance: docs state whether router runs on Railway, AWS, or both, and
    how it reaches workers.
  - Verification: staging smoke uses the documented router path.

- [ ] Add sandbox worker runtime plan.
  - Acceptance: docs cover EKS cluster, Fargate profile, namespace, service
    discovery, and worker Pod networking.
  - Verification: staging sandbox smoke uses documented runtime.

- [ ] Add VPC networking plan.
  - Acceptance: docs cover subnets, security groups, ingress/egress, NAT, and
    private/public endpoint decisions.
  - Verification: staging readiness notes include network checks.

- [ ] Add egress policy.
  - Acceptance: worker egress to gateway, harness, package registries if
    allowed, and object storage is explicit.
  - Verification: staging smoke validates required egress.

- [ ] Add secrets injection plan.
  - Acceptance: docs cover Secrets Manager/Kubernetes Secret use and which
    secrets enter worker env.
  - Verification: AWS adapter tests assert secret refs or injected env shape.

- [ ] Add logs and metrics plan.
  - Acceptance: docs cover CloudWatch or chosen log sink and metrics routing.
  - Verification: staging smoke confirms logs are visible.

- [ ] Add S3 workspace snapshot plan if snapshots are chosen.
  - Acceptance: docs cover bucket naming, object keys, encryption, retention,
    and access policy.
  - Verification: snapshot smoke uses documented bucket/path.

### Secrets Tasks

- [ ] Store route-token signing secret securely.
  - Acceptance: secret comes from secure env/secret manager and supports
    rotation.
  - Verification: config tests cover missing secret; staging uses secure secret.

- [ ] Store worker internal token material securely.
  - Acceptance: worker token material is generated/injected securely and never
    exposed to browser.
  - Verification: staging smoke and tests prove browser cannot obtain token.

- [ ] Store gateway admin credentials securely.
  - Acceptance: gateway admin credentials are never stored in frontend env or
    worker env.
  - Verification: config tests and staging env review.

- [ ] Store harness admin credentials securely.
  - Acceptance: harness admin credentials stay in control plane or secret
    manager only.
  - Verification: config tests and staging env review.

- [ ] Store AWS credentials securely.
  - Acceptance: deployment uses IAM role or least-privilege credentials.
  - Verification: staging deploy does not rely on broad static credentials.

- [ ] Define secret rotation procedure.
  - Acceptance: docs explain route-token, worker token, gateway, harness, and
    AWS credential rotation.
  - Verification: staging rotation drill or documented dry run.

- [ ] Define emergency revoke procedure.
  - Acceptance: docs explain how to revoke a compromised worker, gateway key,
    harness key, or route-token signing key.
  - Verification: staging drill or documented operator checklist.

### Observability Tasks

- [ ] Add control-plane structured logs.
  - Acceptance: auth, lifecycle, usage, gateway, and harness events emit
    structured logs without secrets.
  - Verification: tests or smoke logs cover redaction.

- [ ] Add router structured logs.
  - Acceptance: router logs request id, sandbox id, route result, latency, and
    error code without route tokens.
  - Verification: router tests or smoke logs cover redaction.

- [ ] Add worker structured logs.
  - Acceptance: worker logs startup, auth denial, provider bootstrap, MCP, and
    harness state without secrets.
  - Verification: worker tests or smoke logs cover redaction.

- [x] Add usage import logs.
  - Acceptance: import logs counts, watermarks, and failures.
  - Verification: importer tests or smoke logs cover records.

- [ ] Add sandbox lifecycle metrics.
  - Acceptance: metrics track start/stop/restart counts, durations, failures,
    and active sandboxes.
  - Verification: metrics tests or staging dashboard.

- [ ] Add route-token issuance metrics.
  - Acceptance: metrics track issued, denied, expired, and quota-denied tokens.
  - Verification: metrics tests or staging dashboard.

- [ ] Add worker connection metrics.
  - Acceptance: metrics track HTTP/SSE/WebSocket connections and failures.
  - Verification: router metrics tests or staging dashboard.

- [x] Add gateway usage import metrics.
  - Acceptance: metrics track source/imported/duplicate/failed events.
  - Verification: importer tests or staging dashboard.

- [ ] Add harness usage import metrics.
  - Acceptance: metrics track harness import/webhook success and failure.
  - Verification: importer tests or staging dashboard.

- [ ] Add error dashboards.
  - Acceptance: dashboards cover control-plane, router, worker, gateway import,
    harness import, and sandbox lifecycle failures.
  - Verification: staging dashboard links are documented.

### CI Tasks

- [ ] Add CI job for control-plane typecheck.
- [ ] Add CI job for control-plane tests.
- [ ] Add CI job for supervisor-api typecheck.
- [ ] Add CI job for supervisor-api tests.
- [ ] Add CI job for supervisor-web typecheck.
- [ ] Add CI job for supervisor-web tests.
- [ ] Add CI job for config typecheck.
- [ ] Add CI job for config tests.
- [ ] Add CI job for worker Docker build.
- [ ] Add CI smoke test for worker `/readyz`.
- [ ] Add CI smoke test for worker auth denial.
- [ ] Add CI smoke test for worker auth success.
- [ ] Add CI test for route-token verification.
- [ ] Add CI test for gateway config rendering.
- [ ] Add CI test for harness env/config rendering.
- [ ] Add CI e2e smoke test for login to session open.
- [ ] Add CI e2e smoke test for browser to router to worker connection.

For each CI item:

- Acceptance: job is versioned in repository CI config and runs on the intended
  branch/PR triggers.
- Verification: CI run passes and link is recorded in the release notes or PR.

### Evidence

- Files:
- Verification:
- Residual risk:

## Phase-One Definition Of Done

The first usable product phase is complete only when every item below is
checked.

- [ ] A user can register and log in.
- [ ] The user gets exactly one sandbox.
- [ ] The sandbox starts from a pinned worker image.
- [ ] The browser connects to the worker through route-token proxying.
- [ ] The worker can run Codex through the LLM gateway.
- [ ] The worker can run Claude Code through the LLM gateway.
- [ ] The worker can run OpenCode through the LLM gateway.
- [ ] Real provider root keys never enter the sandbox.
- [ ] The worker receives `INACT_X_APP_KEY`.
- [ ] The worker can call ElAgenteHarness with the injected key.
- [ ] The user can see workflow and task status in the frontend.
- [ ] The control plane imports LLM usage.
- [ ] The control plane imports or receives harness and compute usage.
- [ ] The user can see a usage summary.
- [ ] Basic quota enforcement exists.
- [ ] The worker image can be built in CI.
- [ ] Staging can run browser-to-worker-to-gateway-to-harness smoke tests.

### Evidence

- Files:
- Verification:
- Residual risk:

## Recommended Implementation Order

Use this order for small, reviewable increments. Check an item only after the
corresponding implementation and verification land.

- [x] 1. Finish frontend login route, authenticated shell guard, auth loading,
  expired-session, and disabled-account states.
- [ ] 2. Add production auth-provider smoke test.
- [x] 3. Enforce disabled-user behavior across route tokens, sandbox lifecycle,
  and usage import.
- [ ] 4. Add project detail UI, list loading states, and open-session flow.
- [x] 5. Add worker checkpoint caller, wrong-user/wrong-sandbox denial, retry,
  and session finalize behavior.
- [x] 6. Add AWS namespace/label strategy, Pod cleanup policy, idle timeout, and
  sandbox reaper.
- [ ] 7. Build the worker image locally, run `/readyz`, and add worker Docker CI.
- [ ] 8. Add worker MCP config validation and artifact read/write scopes.
- [ ] 9. Add route-token session scopes, WebSocket reconnect after token
  refresh, and direct-worker-denial staging smoke.
- [x] 10. Choose and document the phase-one LLM gateway deployment shape.
- [x] 11. Add gateway usage adapter, scheduled import job, import metrics, and
  frontend LLM usage UI.
- [ ] 12. Add harness credential table, key generation, rotation, revocation,
  and redaction.
- [ ] 13. Decide harness tool surface, then render harness MCP/wrapper/provider
  configs.
- [ ] 14. Add workflow/task/artifact APIs and frontend UI for ElAgenteHarness.
- [ ] 15. Define MCP registry and render Codex, Claude Code, and OpenCode MCP
  configs.
- [ ] 16. Choose workspace persistence backend and implement snapshot
  save/restore.
- [ ] 17. Add diff endpoints, diff review UI, and generated-credential
  exclusion.
- [ ] 18. Add artifact object storage, download/view URLs, and chemistry
  artifact metadata.
- [ ] 19. Finalize unified usage ledger and quota profiles across LLM, harness,
  compute, storage, and sandbox runtime.
- [ ] 20. Add Railway/AWS deployment docs, secure secret handling, structured
  logs, metrics, dashboards, and release gates.
