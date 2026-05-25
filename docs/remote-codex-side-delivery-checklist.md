# Remote Codex Side Delivery Checklist

This document is the execution checklist for the work that must be implemented
inside this repository for the Agente sandbox-worker product direction.

It is written as a practical delivery board. Each checkbox should be updated
only after the corresponding code, tests, smoke checks, or deployment checks
exist on this branch.

## Scope

Remote Codex owns these product surfaces:

- Railway-hosted frontend and product UI.
- Railway-hosted control-plane API.
- Product users, projects, workspaces, sessions, sandboxes, quotas, usage, and
  audit records.
- One-user-to-one-sandbox lifecycle orchestration for phase one.
- Sandbox router and short-lived route-token proxying.
- Worker-mode supervisor API that runs inside each sandbox.
- Worker image bootstrap for Codex, Claude Code, OpenCode, MCP, LLM gateway
  credentials, and ElAgenteHarness credentials.
- Integration contracts with the LLM gateway, ElAgenteHarness, object storage,
  AWS sandbox runtime, and compute job pools.

Remote Codex does not own these systems internally:

- Real model provider root-key storage when the LLM gateway owns those keys.
- LLM gateway routing internals.
- ElAgenteHarness workflow execution internals.
- Modal, AWS Batch, Slurm, ORCA, or other chemistry compute worker internals.
- Arbitrary execution outside the sandbox worker runtime.

## Target Architecture

```text
Browser
  -> Railway Frontend
  -> Railway Control Plane API
     - auth
     - users/projects/workspaces/sessions
     - quotas/billing/usage
     - sandbox registry
     - route-token issuance
     - gateway and harness credential mapping

Browser
  -> Sandbox Router
     - validates route token
     - resolves sandbox endpoint
     - injects worker token and signed identity envelope
     - proxies HTTP/SSE/WebSocket

Control Plane API
  -> AWS Sandbox Manager
     - creates/stops EKS Fargate Pods
     - injects env and secrets
     - tracks status/endpoint/health
     - snapshots workspace when enabled

AWS EKS Fargate
  -> one active sandbox = one Pod = one container
     - remote-codex supervisor-api in worker mode
     - Codex / Claude Code / OpenCode
     - /workspace
     - provider homes under /home/agent
     - approved MCP/tool configs
     - ElAgenteHarness client config

Worker
  -> LLM Gateway
     - gateway token only
     - no real provider root keys in sandbox

Worker
  -> ElAgenteHarness
     - INACT_X_APP_KEY
     - workflow catalog/task/job/artifact APIs

ElAgenteHarness
  -> Compute Job Pool
     - Modal/AWS Batch/HPC workers
```

## Checklist Rules

- `[ ]` means not implemented or not verified.
- `[x]` means implemented and verified in this repository.
- Do not check an item just because it is documented.
- Each checked item must have one of these proof paths:
  - unit test,
  - typecheck,
  - migration check,
  - local smoke test,
  - staging smoke test,
  - CI job,
  - deployment verification.
- If a task depends on an external service, check the Remote Codex item only
  when the integration contract, API client, mock, fixture, or deployment wiring
  exists here.
- Keep staging and production checkboxes unchecked until the actual environment
  has been exercised.
- When a task is checked, update the nearest verification note with the exact
  command or smoke path.

## Phase 0: Repository And Architecture Baseline

Goal: make the branch safe to build on and easy for a new contributor to
understand.

### Tasks

- [x] Create and push `sandbox-worker-control-plane`.
- [x] Remove obsolete docs that describe the old product shape.
- [x] Add a docs index.
- [x] Document the overall Agente product architecture.
- [x] Document the control-plane to sandbox-worker architecture.
- [x] Document product auth and worker identity boundaries.
- [x] Document the session-to-worker contract.
- [x] Document architecture decisions for AWS runtime, sandbox shape, gateway
  handling, and local development.
- [x] Document local control-plane, router, and worker smoke flow.
- [x] Add implementation checklists.
- [x] Add first staging release-readiness notes.

### Verification

- [x] `docs/README.md` points to the active architecture docs.
- [x] `docs/status.md` describes implemented work and open risks.
- [x] Local smoke documentation exists.
- [x] Staging release notes link back to this checklist.

## Phase 1: Product Auth, Users, And Admin Boundary

Goal: product identity belongs to the control plane and never becomes a worker
credential.

### Control Plane API

- [x] Define the auth verifier interface.
- [x] Support `dev:<subject>` bearer auth for local development.
- [x] Support production-style JWT verification.
- [x] Validate JWT issuer.
- [x] Validate JWT audience.
- [x] Validate JWT time claims with clock-skew tolerance.
- [x] Standardize `401 unauthorized` responses.
- [x] Standardize `403 forbidden` responses.
- [x] Bootstrap product users idempotently from authenticated identity.
- [x] Store user status.
- [x] Store display name.
- [x] Store billing customer id.
- [x] Store quota profile.
- [x] Add `GET /api/me`.
- [x] Add `PATCH /api/me`.
- [x] Add admin user list API.
- [x] Add admin user status update API.
- [x] Add admin quota-profile update API.
- [x] Add audit events for admin user updates.
- [ ] Add integration smoke test for the selected production auth provider.
- [x] Define and implement disabled-user behavior for route-token issuance.
- [x] Define and implement disabled-user behavior for sandbox start/restart.
- [x] Define and implement disabled-user behavior for usage import.
- [x] Add user data export API or explicitly document deferral.
- [x] Add user deletion/anonymization API or explicitly document deferral.

### Frontend

- [ ] Add dedicated login route or provider redirect entry.
- [x] Add signup/registration entry.
- [x] Add logout action.
- [ ] Add authenticated app-shell guard.
- [ ] Add auth loading state.
- [ ] Add expired-session state.
- [ ] Add disabled-account state.
- [x] Add account/profile page.
- [ ] Add admin user management UI.

### Worker Boundary

- [x] Strip product JWTs before router-to-worker traffic.
- [x] Strip browser-supplied internal worker headers.
- [x] Strip browser-supplied identity envelope headers.
- [ ] Add staging smoke proof that worker requests never receive product JWTs.

### Verification

- [x] Control-plane auth tests pass.
- [x] Control-plane typecheck passes.
- [x] Supervisor-web typecheck passes.
- [x] Router or worker tests prove product JWT headers do not reach workers.
- [ ] Frontend auth tests cover login, logout, loading, expired session, and
  disabled account.
- [ ] Local or staging e2e smoke covers login into the authenticated app shell.

## Phase 2: Projects, Workspaces, Sessions, And Worker Contract

Goal: the control plane owns durable product metadata while the worker owns live
execution state inside the sandbox.

### Data Model

- [x] Add durable project records.
- [x] Add durable workspace records.
- [x] Add durable session records.
- [x] Link workspaces to projects.
- [x] Link sessions to workspaces.
- [x] Track worker session id separately from control-plane session id.
- [x] Enforce one-user-to-one-sandbox for phase one.
- [x] Define project archive/delete semantics.
- [x] Define workspace archive/delete semantics.
- [x] Define session archive/delete semantics.
- [x] Document forward-only migration policy.
- [x] Add pagination for project lists.
- [x] Add pagination for workspace lists.
- [x] Add pagination for session lists.
- [x] Add search/filter support for product lists.

### Control Plane API

- [x] Add project CRUD APIs.
- [x] Add workspace create/update APIs.
- [x] Add session create/update APIs.
- [x] Enforce ownership checks on project APIs.
- [x] Enforce ownership checks on workspace APIs.
- [x] Enforce ownership checks on session APIs.
- [x] Add cross-user denial tests.
- [x] Define control-plane session to worker session mapping.
- [x] Define required worker metadata fields.
- [x] Add safe worker metadata endpoint fields.
- [x] Add explicit session checkpoint endpoint.
- [x] Add worker-to-control-plane heartbeat/checkpoint call.
- [x] Reject checkpoint sync for the wrong user.
- [x] Reject checkpoint sync for the wrong sandbox.
- [x] Add retry/backoff policy for checkpoint submission.
- [x] Add audit events for session sync failures.
- [x] Add session close/finalize sync behavior.

### Frontend

- [x] Add project list UI.
- [x] Add project creation UI.
- [ ] Add project detail UI.
- [x] Add workspace list UI inside project context.
- [x] Add workspace creation UI.
- [x] Add session list UI inside workspace context.
- [x] Add session creation UI.
- [x] Add empty states for project/workspace/session lists.
- [x] Add create/update error states.
- [ ] Add loading states for every list.
- [ ] Add open-session flow that obtains a route token and connects through the
  router.

### Verification

- [x] Control-plane CRUD and ownership tests pass.
- [x] Frontend project/workspace/session navigation tests pass.
- [x] Worker metadata tests cover safe metadata shape.
- [x] Session sync tests cover wrong-user and wrong-sandbox denial.
- [ ] Local smoke proves a worker checkpoint reaches the control plane.
- [ ] E2E smoke creates project, workspace, session, and opens the session.

## Phase 3: Sandbox Lifecycle And AWS Runtime

Goal: the control plane can start, stop, observe, and recover one sandbox per
user.

### Sandbox Manager

- [x] Define `SandboxManager`.
- [x] Add `createSandbox`.
- [x] Add `startSandbox`.
- [x] Add `stopSandbox`.
- [x] Add `restartSandbox`.
- [x] Add `deleteSandbox`.
- [x] Add status polling.
- [x] Add endpoint discovery.
- [x] Add environment preparation.
- [x] Add structured errors for quota, capacity, config, and provider failures.
- [x] Implement local no-op adapter for tests.
- [x] Implement local worker-process adapter for development.
- [x] Add sandbox idle-timeout policy.
- [x] Add sandbox reaper job.
- [x] Add admin sandbox detail API.
- [x] Add admin sandbox detail UI.

### AWS EKS Fargate Adapter

- [x] Choose EKS Fargate for phase-one sandbox workers.
- [x] Document ECS Fargate fallback.
- [x] Define worker image repository and immutable tag format.
- [x] Define CPU, memory, and ephemeral storage profiles.
- [x] Define VPC, subnet, security group, and egress requirements.
- [x] Implement AWS adapter configuration loading.
- [x] Implement Pod creation.
- [x] Implement Pod stop.
- [x] Implement Pod status polling.
- [x] Implement worker endpoint discovery.
- [x] Implement worker environment injection.
- [x] Implement worker secret injection.
- [x] Handle AWS capacity errors.
- [x] Handle image pull errors.
- [x] Handle worker readiness timeout.
- [x] Define namespace and label strategy for hundreds of users.
- [x] Define Pod TTL/cleanup behavior.
- [x] Define scaling and capacity request process.
- [ ] Add staging start-one-sandbox smoke test.
- [ ] Add staging stop-one-sandbox smoke test.

### Frontend

- [x] Add sandbox status indicator.
- [x] Add start/stop/restart actions.
- [x] Add degraded/offline UI.
- [x] Add startup progress UI.
- [x] Add failure reason UI.
- [x] Add admin sandbox detail API.
- [x] Add admin sandbox detail UI.

### Verification

- [x] Unit tests cover lifecycle transitions.
- [x] AWS adapter tests pass with mocked AWS clients.
- [x] Local worker-process adapter can start a worker.
- [x] Local route-token smoke test reaches a worker process.
- [ ] Staging can create, start, observe, and stop one EKS Fargate sandbox.

## Phase 4: Worker Image, Runtime, And Startup Guardrails

Goal: the sandbox worker starts from a reproducible image and fails closed when
required identity, filesystem, gateway, or harness settings are unsafe.

### Worker Image

- [x] Keep `Dockerfile.worker` as the canonical image.
- [x] Pin Node base image version.
- [x] Pin `@openai/codex`.
- [x] Pin `@anthropic-ai/claude-code`.
- [x] Pin `@anthropic-ai/claude-agent-sdk`.
- [x] Pin `opencode-ai`.
- [x] Pin `@opencode-ai/sdk`.
- [x] Add image labels for git SHA and image version.
- [x] Run the image as non-root `agent`.
- [x] Use `/workspace` as workspace root.
- [x] Put provider homes under `/home/agent`.
- [x] Listen on `0.0.0.0`.
- [x] Add build-time provider runtime manifest.
- [x] Add safe worker runtime metadata endpoint.
- [ ] Build the worker image locally from a clean checkout.
- [ ] Run the worker container locally and verify `/readyz`.
- [ ] Add CI worker image build.
- [ ] Add CI worker `/readyz` smoke.

### Worker Startup Validation

- [x] Validate worker-mode required environment.
- [x] Validate `REMOTE_CODEX_SANDBOX_ID`.
- [x] Validate `REMOTE_CODEX_USER_ID`.
- [x] Validate `REMOTE_CODEX_WORKER_AUTH_TOKEN`.
- [x] Validate `WORKSPACE_ROOT=/workspace` in production worker mode.
- [x] Validate `HOME=/home/agent` in production worker mode.
- [x] Fail fast on missing provider home directories.
- [x] Fail fast on unwritable workspace.
- [x] Add startup metadata logs without secrets.
- [x] Validate gateway env when provider runtimes are enabled.
- [x] Validate ElAgenteHarness env when chemistry tools are enabled.
- [x] Validate MCP config path and permissions.
- [x] Redact harness key from startup logs.
- [x] Redact gateway token from startup logs.

### Worker API Authorization

- [x] Keep `/healthz` public.
- [x] Keep `/readyz` public.
- [x] Require worker token for non-health APIs in worker mode.
- [x] Accept `Authorization: Bearer <token>`.
- [x] Accept `X-Remote-Codex-Worker-Token`.
- [x] Disable provider host config read in worker mode.
- [x] Disable provider host config write in worker mode.
- [x] Disable build restart in worker mode.
- [x] Disable runtime install/update in worker mode.
- [x] Verify signed identity envelope signature.
- [x] Verify identity envelope expiry.
- [x] Verify identity envelope sandbox id.
- [x] Verify identity envelope scopes.
- [x] Add `shell:write` checks.
- [x] Add `file:write` checks.
- [x] Add `provider:turn:create` checks.
- [x] Add `provider:turn:interrupt` checks.
- [ ] Add artifact read/write scope checks.

### Verification

- [x] Supervisor API typecheck passes.
- [x] Config typecheck passes.
- [x] Worker auth and scope tests pass.
- [ ] `docker build -f Dockerfile.worker -t remote-codex-worker:verify .`
- [ ] Local worker container smoke verifies `/readyz`.
- [ ] Local worker container smoke verifies non-health auth denial/success.

## Phase 5: Sandbox Router And Route Tokens

Goal: browsers reach workers only through short-lived route tokens and the
router-injected internal worker token.

### Route Token Contract

- [x] Define route token payload schema.
- [x] Include user id.
- [x] Include sandbox id.
- [x] Include scopes.
- [x] Include expiry.
- [x] Include nonce/token id.
- [x] Sign route tokens with a control-plane secret.
- [x] Add route-token key id.
- [x] Add route-token signing key rotation strategy.
- [x] Add expiry/tamper/wrong-sandbox tests.
- [ ] Add revocation strategy if required before launch.
- [ ] Include project/workspace/session scopes when opening a session.

### Control Plane API

- [x] Add `POST /api/sandboxes/:sandboxId/route-token`.
- [x] Check sandbox ownership before issuing token.
- [x] Check sandbox running state before issuing token.
- [x] Check account status before issuing token.
- [x] Check quota before issuing token.
- [x] Reject route-token requests for archived sessions.
- [x] Return `routerBaseUrl`, `wsBaseUrl`, and `expiresAt`.
- [x] Audit route-token issuance.

### Router

- [x] Implement HTTP proxy.
- [x] Implement SSE proxy.
- [x] Implement WebSocket proxy.
- [x] Verify route tokens.
- [x] Resolve sandbox endpoint from the control plane or registry.
- [x] Inject internal worker token.
- [x] Strip browser-supplied internal worker headers.
- [x] Strip browser-supplied identity envelope headers.
- [x] Inject signed identity envelope.
- [x] Add request size limits.
- [x] Add idle timeouts.
- [x] Add rate limits.
- [x] Add structured proxy errors.
- [x] Add router health endpoint.
- [x] Add router audit logs.
- [ ] Add staging direct-worker-denial proof.

### Frontend

- [x] Fetch route token before opening worker session.
- [x] Store route token only in memory.
- [x] Refresh route token before expiry.
- [x] Show route authorization failure state.
- [x] Show reconnecting state.
- [ ] Reconnect WebSocket after token refresh.
- [ ] Show sandbox offline state from router failures.
- [ ] Add tests proving route tokens are not persisted in local storage.

### Verification

- [x] Control-plane route-token tests pass.
- [x] Router unit tests pass.
- [x] Local browser-to-router-to-worker smoke passes.
- [ ] Staging browser-to-router-to-worker smoke passes.
- [ ] Staging proves worker is unreachable without router-injected token.

## Phase 6: LLM Gateway Integration

Goal: Codex, Claude Code, and OpenCode use gateway tokens inside the sandbox;
real provider root keys stay outside the sandbox.

### Gateway Choice And Admin Contract

- [ ] Choose phase-one gateway implementation: sub2api or lightweight custom
  gateway.
- [ ] Document gateway deployment shape.
- [ ] Document gateway admin credential requirements.
- [ ] Document gateway admin API endpoints used by Remote Codex.
- [ ] Document required gateway usage-export API shape.
- [ ] Add gateway unavailable/degraded behavior.

### Control Plane Gateway Client

- [ ] Add gateway provider config table or config source.
- [x] Store gateway base URL.
- [x] Store gateway key id per user or sandbox.
- [ ] Store encrypted gateway token only if raw recovery is required.
- [x] Add gateway admin credential config.
- [x] Add gateway client interface.
- [x] Implement gateway user creation.
- [x] Implement gateway key creation.
- [x] Implement gateway key revocation.
- [x] Implement gateway key rotation.
- [x] Attach gateway credential to sandbox provisioning.
- [x] Add admin endpoint to reconcile gateway keys.
- [x] Add mocked gateway client tests.

### Worker Provider Bootstrap

- [x] Render Codex config pointing to the gateway `/v1` endpoint.
- [x] Prove Codex config never contains real provider root keys.
- [x] Render Claude Code config pointing to the gateway.
- [x] Prove Claude Code config never contains real provider root keys.
- [x] Render OpenCode config pointing to the gateway.
- [x] Prove OpenCode config never contains real provider root keys.
- [x] Add startup check that gateway env is present when providers are enabled.
- [x] Redact gateway tokens from logs.
- [x] Redact gateway tokens from API responses.
- [ ] Add staging smoke where Codex reaches the gateway.
- [ ] Add staging smoke where Claude Code reaches the gateway.
- [ ] Add staging smoke where OpenCode reaches the gateway.

### Usage Import

- [x] Define normalized LLM usage event schema.
- [ ] Add usage import adapter for the chosen gateway.
- [ ] Add scheduled usage import job.
- [x] Add manual admin usage import endpoint.
- [x] Deduplicate usage events by gateway event id.
- [x] Map gateway key id to user id.
- [x] Map gateway key id to sandbox id when available.
- [x] Store model, prompt tokens, completion tokens, cached tokens, and cost.
- [x] Add user usage summary endpoint.
- [x] Add user usage events endpoint.

### Frontend

- [ ] Add LLM usage summary UI.
- [ ] Add LLM usage detail UI.
- [ ] Add gateway unavailable UI.
- [ ] Add quota exceeded UI for LLM usage.

### Verification

- [x] Gateway client tests pass with mocked gateway API.
- [x] Worker provider bootstrap tests pass for Codex, Claude Code, and OpenCode.
- [x] Usage import tests pass.
- [ ] Frontend usage UI tests pass.
- [ ] Staging gateway smoke validates no provider root key enters the sandbox.

## Phase 7: ElAgenteHarness Integration

Goal: sandbox agents can call computational chemistry workflow tools through
ElAgenteHarness using scoped `INACT_X_APP_KEY` credentials.

### Credential Provisioning

- [x] Add harness base URL config.
- [ ] Add harness admin credential config if required.
- [ ] Add harness credential table.
- [ ] Decide whether Remote Codex stores only key hashes or encrypted raw keys.
- [ ] Generate `INACT_X_APP_KEY` during user or sandbox provisioning.
- [ ] Bind harness key to user id.
- [ ] Bind harness key to sandbox id.
- [ ] Bind harness key to scopes.
- [ ] Bind harness key to quota profile.
- [ ] Add harness key rotation endpoint.
- [ ] Add harness key revocation endpoint.
- [ ] Add harness credential ownership tests.

### Worker Bootstrap

- [x] Inject `ELAGENTE_HARNESS_BASE_URL` into the worker.
- [x] Inject `INACT_X_APP_KEY` into the worker.
- [x] Report harness integration status in worker metadata without exposing raw
  key.
- [x] Validate harness env in worker mode when chemistry tools are enabled.
- [ ] Redact harness key from logs.
- [ ] Redact harness key from API responses.
- [ ] Add staging smoke where worker calls harness with injected key.

### Tool Surface

- [ ] Decide whether the first tool surface is MCP, shell wrappers, provider
  config, or a combination.
- [ ] Render ElAgenteHarness MCP config if MCP is used.
- [ ] Render ElAgenteHarness shell/tool wrappers if wrappers are used.
- [ ] Integrate harness tools into Codex config.
- [ ] Integrate harness tools into Claude Code config.
- [ ] Integrate harness tools into OpenCode config.
- [ ] Add tests for harness tool config rendering.

### Product API And UI

- [ ] Add workflow catalog endpoint or proxy integration.
- [ ] Add task list endpoint or proxy integration.
- [ ] Add task detail endpoint or proxy integration.
- [ ] Add artifact metadata endpoint or proxy integration.
- [ ] Add workflow catalog UI.
- [ ] Add task status UI.
- [ ] Add job status UI.
- [ ] Add chemistry artifact display hooks.
- [ ] Add missing-harness-key error state.
- [ ] Add harness-unavailable error state.

### Usage

- [ ] Define normalized harness usage event schema.
- [ ] Add harness webhook receiver or polling importer.
- [ ] Map harness usage to user id.
- [ ] Map harness usage to sandbox id.
- [ ] Map harness usage to project/workspace/session when available.
- [ ] Store workflow id, job id, usage units, estimated cost, and actual cost.
- [ ] Add harness usage to billing summary.

### Verification

- [ ] Harness credential tests pass.
- [x] Harness bootstrap tests pass.
- [ ] Harness tool config tests pass.
- [ ] Harness usage import tests pass.
- [ ] Frontend workflow/task UI tests pass.
- [ ] Staging harness smoke validates worker-to-harness authentication.

## Phase 8: MCP And Tool Policy

Goal: MCP and tool execution stay inside the sandbox, are auditable, and do not
mount host-local resources.

### Policy

- [ ] Define approved MCP server registry.
- [ ] Define stdio MCP launch policy.
- [ ] Define remote MCP allowlist policy.
- [ ] Define env-var allowlist for MCP stdio servers.
- [ ] Define cwd policy requiring stdio MCP servers to run under `/workspace`.
- [ ] Block host-local filesystem MCP servers by default.
- [ ] Block host-local Docker MCP servers by default.
- [ ] Block host-local database MCP servers by default.
- [ ] Add ElAgenteHarness tools to the approved MCP/tool registry.

### Config Rendering

- [ ] Render Codex MCP config under the sandbox provider home.
- [ ] Render Claude Code MCP config under the sandbox provider home.
- [ ] Render OpenCode MCP config under the sandbox provider home.
- [ ] Validate rendered config path and permissions at worker startup.
- [ ] Add tests proving stdio MCP cwd is inside `/workspace`.
- [ ] Add tests proving MCP env is allowlisted.

### Audit And UI

- [ ] Add MCP startup audit events.
- [ ] Add MCP tool-call audit events.
- [ ] Add MCP failure timeline items where useful.
- [ ] Add UI for MCP status and failures.

### Verification

- [ ] MCP config rendering tests pass.
- [ ] MCP startup audit tests pass.
- [ ] Worker typecheck passes.

## Phase 9: Workspace Persistence, Diffs, And Artifacts

Goal: workspaces survive sandbox restarts and users can review files/artifacts
created by agents and chemistry jobs.

### Persistence

- [ ] Choose phase-one persistence backend: EFS, S3 snapshots, or temporary MVP
  workspace.
- [ ] Document EFS tradeoffs.
- [ ] Document S3 snapshot tradeoffs.
- [ ] Document temporary workspace limitations if chosen for MVP.
- [ ] Define maximum workspace size.
- [ ] Define maximum artifact size.
- [ ] Add snapshot metadata table.
- [ ] Restore snapshot before worker readiness.
- [ ] Save snapshot before sandbox stop.
- [ ] Add manual snapshot endpoint.
- [ ] Add snapshot status endpoint.
- [ ] Add snapshot failure handling.
- [ ] Add snapshot retry policy.
- [ ] Add snapshot retention policy.

### Diffs

- [ ] Initialize baseline in `/workspace`.
- [ ] Preserve git metadata when source is a git repository.
- [ ] Create synthetic baseline commit when source is not a git repository.
- [ ] Add worker changed-files endpoint.
- [ ] Add worker text-diff endpoint.
- [ ] Add worker binary-diff metadata endpoint.
- [ ] Add patch size limit.
- [ ] Add file size limit.
- [ ] Add symlink policy.
- [ ] Add executable-bit policy.
- [ ] Add delete policy.
- [ ] Add generated credential exclusion policy.
- [ ] Add diff review UI.
- [ ] Add apply accepted changes path.

### Artifacts

- [ ] Define artifact ownership model.
- [ ] Define object storage path format.
- [ ] Add artifact upload from worker or harness.
- [ ] Add artifact download/view URL endpoint.
- [ ] Add artifact retention policy.
- [ ] Add chemistry artifact type mapping.

### Verification

- [ ] Snapshot restore smoke passes.
- [ ] Snapshot save smoke passes.
- [ ] Diff endpoint tests pass.
- [ ] Diff review UI tests pass.
- [ ] Artifact upload/download tests pass.

## Phase 10: Billing, Quotas, And Usage Ledger

Goal: Remote Codex normalizes paid-resource usage from gateway, harness,
compute, storage, and sandbox runtime into one billing surface.

### Usage Ledger

- [ ] Finalize usage ledger schema.
- [ ] Add source enum for `llm`.
- [ ] Add source enum for `harness`.
- [ ] Add source enum for `compute`.
- [ ] Add source enum for `storage`.
- [ ] Add source enum for `sandbox_runtime`.
- [ ] Add dedupe key.
- [ ] Store user id.
- [ ] Store sandbox id.
- [ ] Store project id when available.
- [ ] Store workspace id when available.
- [ ] Store session id when available.
- [ ] Store units.
- [ ] Store cost amount.
- [ ] Store currency.
- [ ] Store metadata JSON.

### Quotas

- [ ] Add quota profile schema.
- [ ] Add user quota assignment.
- [x] Add quota check service.
- [x] Add LLM spend quota.
- [ ] Add compute spend quota.
- [ ] Add storage quota.
- [ ] Add sandbox runtime quota.
- [x] Add quota preflight before route-token issuance.
- [ ] Add quota preflight before harness job creation when visible to Remote
  Codex.
- [x] Add quota exceeded API response shape.

### Frontend And Admin

- [ ] Add usage dashboard.
- [ ] Add LLM usage breakdown.
- [ ] Add workflow usage breakdown.
- [ ] Add compute usage breakdown.
- [ ] Add quota remaining display.
- [ ] Add quota exceeded banner.
- [ ] Add admin usage reconciliation page or export endpoint.

### Verification

- [ ] Usage ledger tests pass.
- [x] Quota service tests pass.
- [ ] Usage UI tests pass.
- [ ] Staging usage import smoke proves imported usage maps to the right user.

## Phase 11: Deployment, Operations, And CI

Goal: the product can be deployed, observed, and recovered without manual
guesswork.

### Railway

- [ ] Add Railway service definition for frontend.
- [ ] Add Railway service definition for control-plane API.
- [ ] Add Railway Postgres configuration.
- [ ] Add required frontend env documentation.
- [ ] Add required control-plane env documentation.
- [ ] Add migration command for deploy.
- [ ] Add frontend health check.
- [ ] Add control-plane health check.

### AWS

- [ ] Add AWS account and environment naming convention.
- [ ] Add ECR repository for worker image.
- [ ] Add sandbox router deployment plan.
- [ ] Add sandbox worker runtime plan.
- [ ] Add VPC networking plan.
- [ ] Add egress policy.
- [ ] Add secrets injection plan.
- [ ] Add logs and metrics plan.
- [ ] Add S3 workspace snapshot plan if snapshots are chosen.

### Secrets

- [ ] Store route-token signing secret securely.
- [ ] Store worker internal token material securely.
- [ ] Store gateway admin credentials securely.
- [ ] Store harness admin credentials securely.
- [ ] Store AWS credentials securely.
- [ ] Define secret rotation procedure.
- [ ] Define emergency revoke procedure.

### Observability

- [ ] Add control-plane structured logs.
- [ ] Add router structured logs.
- [ ] Add worker structured logs.
- [ ] Add usage import logs.
- [ ] Add sandbox lifecycle metrics.
- [ ] Add route-token issuance metrics.
- [ ] Add worker connection metrics.
- [ ] Add gateway usage import metrics.
- [ ] Add harness usage import metrics.
- [ ] Add error dashboards.

### CI

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

### Verification

- [ ] Staging deploy succeeds.
- [ ] Staging browser-to-worker smoke succeeds.
- [ ] Staging gateway usage import smoke succeeds.
- [ ] Staging harness key injection smoke succeeds.
- [ ] Staging worker image rollback procedure is documented and tested.

## Phase-One Definition Of Done

The first usable product phase is complete only when all of these are checked:

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

## Recommended Execution Order

- [ ] 1. Finish frontend auth shell and provider auth smoke.
- [ ] 2. Finish project detail and open-session flow.
- [x] 3. Add worker session checkpoint caller and wrong-user/wrong-sandbox tests.
- [x] 4. Validate harness env when chemistry tools are enabled.
- [x] 5. Add gateway client interface and mocked gateway admin tests.
- [ ] 6. Decide and document gateway deployment shape.
- [x] 7. Implement gateway user/key create, revoke, rotate, and reconcile APIs.
- [ ] 8. Implement harness credential table, key generation, rotation, and
  revocation.
- [ ] 9. Define MCP registry and render provider MCP configs.
- [ ] 10. Build and smoke-test the worker Docker image.
- [ ] 11. Add staging start/stop sandbox smoke.
- [ ] 12. Add LLM usage import and user usage UI.
- [ ] 13. Add harness workflow/task UI and harness usage import.
- [ ] 14. Add workspace persistence, diffs, snapshots, and artifacts.
- [ ] 15. Add Railway/AWS deployment definitions and CI smoke jobs.

## Completion Evidence Template

Use this format in commit messages, PR descriptions, or the nearest
verification note when checking an item:

```text
Task: <phase and exact checklist item>
Files: <main implementation/test/docs files>
Verification: <command, smoke test, migration check, or staging check>
Residual risk: <what remains unchecked>
```
