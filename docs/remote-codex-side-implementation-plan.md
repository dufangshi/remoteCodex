# Remote Codex Side Implementation Plan

This document is the execution plan for the work that belongs in this
repository for the Agente sandbox-worker product direction.

It is intentionally scoped to Remote Codex. It does not track the internal
implementation work for the LLM gateway, ElAgenteHarness, Modal workers, AWS
Batch workers, HPC adapters, or provider root-key management services. Remote
Codex tracks only the integration contracts and product surfaces for those
systems.

## How To Use This Checklist

- Check an item only after the implementation is merged on this branch.
- Each checked item must have a concrete verification path: unit test,
  typecheck, smoke test, migration check, or staging deployment check.
- Keep implementation commits small enough that a checked group can be
  reviewed, tested, and reverted independently.
- If a task moves to another service, keep the Remote Codex item unchecked
  until the integration contract, API client, test fixture, or deployment
  wiring exists in this repository.
- If a task is intentionally deferred, leave it unchecked and add the reason to
  `docs/status.md`.
- Prefer checking items from the top down. Later phases can start early when
  useful, but phase gates should not be considered complete until every required
  verification item passes.

## Product Shape To Preserve

Remote Codex becomes:

- A Railway-hosted browser app.
- A Railway-hosted control-plane API.
- A database-backed product system for users, projects, workspaces, sessions,
  sandboxes, usage, quotas, and audit logs.
- A sandbox lifecycle manager for one sandbox per user in phase one.
- A route-token issuer and, for now, the sandbox router implementation.
- A worker-mode supervisor API that runs inside each sandbox.
- A worker image that contains Codex, Claude Code, OpenCode, MCP bootstrap code,
  and ElAgenteHarness integration wiring.

Remote Codex must not become:

- A runtime for untrusted user shell commands outside the sandbox.
- A storage location for real provider root keys when the gateway owns those
  keys.
- The implementation of chemistry workflows or heavy compute workers.
- A direct public proxy from browser product auth to naked worker APIs.

## Phase 0: Repository And Architecture Baseline

Goal: make the branch understandable and safe to build on.

### Deliverables

- A clean branch for the sandbox-worker/control-plane product shape.
- A docs index that points to the architecture, decisions, status, and task
  checklists.
- Clear boundaries between Remote Codex, the LLM gateway, ElAgenteHarness, and
  compute workers.
- A status document that names what is implemented, what is stubbed, and what
  remains risky.

### Checklist

- [x] Create and push the `sandbox-worker-control-plane` branch.
- [x] Remove obsolete docs that describe an incompatible product shape.
- [x] Add `docs/README.md` as the docs index.
- [x] Document the full Agente product architecture.
- [x] Document the control-plane to sandbox-worker architecture.
- [x] Document architecture decisions for AWS runtime, sandbox shape, gateway
  key handling, and local development mode.
- [x] Document product auth and worker identity boundaries.
- [x] Document the control-plane session to worker contract.
- [x] Add the Remote Codex side checklist.
- [x] Add this implementation plan.
- [x] Add first staging release notes and link them back to the checklist.
- [x] Add a short onboarding note for local development of the control plane,
  router, and worker together.

### Verification

- [x] `docs/README.md` links to the architecture and checklist docs.
- [x] `docs/status.md` describes current branch status and known gaps.
- [x] A fresh contributor can follow the docs to run control-plane API,
  supervisor-web, sandbox-router, and a local worker-mode supervisor API.

## Phase 1: Product Auth, Users, And Admin Boundary

Goal: product identity is owned by the control plane and never leaks into
worker credentials.

### Deliverables

- A pluggable auth verifier that supports local development and
  production-style JWT validation.
- Durable product user records.
- Account status and quota profile fields.
- Admin-only user management APIs.
- Browser auth states for login, logout, loading, disabled account, and expired
  sessions.
- Tests proving worker APIs do not receive product JWTs.

### Backend Checklist

- [x] Define the control-plane auth verifier interface.
- [x] Support `dev:<subject>` bearer auth for local development.
- [x] Support production-style JWT verification.
- [x] Validate JWT issuer.
- [x] Validate JWT audience.
- [x] Add JWT clock-skew tolerance.
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
- [ ] Add integration smoke tests for the selected production auth provider.
- [x] Add explicit user deactivation behavior for route-token issuance,
  sandbox lifecycle, and usage import.
- [x] Add user data export policy and API shape if required for launch.
- [x] Add user deletion or anonymization policy if required for launch.
- [x] Prove product JWTs are stripped before router-to-worker traffic.

### Frontend Checklist

- [x] Add dedicated login route or auth-provider redirect entry.
- [x] Add registration/signup entry.
- [x] Add logout action.
- [x] Add authenticated app-shell guard.
- [x] Add auth loading state.
- [x] Add expired-session state.
- [x] Add disabled-account state.
- [x] Add account/profile page.
- [x] Add admin user management UI.

### Verification

- [x] Control-plane auth tests pass.
- [x] Control-plane typecheck passes.
- [x] Supervisor-web typecheck passes.
- [ ] Frontend auth tests cover login, logout, loading, expired session, and
  disabled account.
- [ ] Local or staging e2e smoke test covers login into the authenticated app
  shell.
- [x] Router or worker tests prove browser product JWT headers do not reach the
  worker.

## Phase 2: Projects, Workspaces, Sessions, And Worker Session Contract

Goal: the control plane owns durable product metadata while the worker owns
live sandbox-local execution state.

### Deliverables

- Durable project, workspace, and session records.
- Ownership checks on every product metadata API.
- UI for creating and browsing projects, workspaces, and sessions.
- A clear mapping from a control-plane session to a worker thread/session.
- Checkpoint APIs so workers can sync metadata and summaries back to the
  control plane.

### Data Model Checklist

- [x] Create durable project records.
- [x] Create durable workspace records.
- [x] Create durable session records.
- [x] Link workspaces to projects.
- [x] Link sessions to workspaces.
- [x] Track worker session id separately from control-plane session id.
- [x] Enforce one-user-to-one-sandbox invariant for phase one.
- [x] Define archive/delete semantics for projects.
- [x] Define archive/delete semantics for workspaces.
- [x] Define archive/delete semantics for sessions.
- [x] Document forward-only migration policy.
- [x] Add pagination for project lists.
- [x] Add pagination for workspace lists.
- [x] Add pagination for session lists.
- [x] Add search and filter support for product lists.

### API Checklist

- [x] Add project CRUD APIs.
- [x] Add workspace create/update APIs.
- [x] Add session create/update APIs.
- [x] Enforce ownership checks on project APIs.
- [x] Enforce ownership checks on workspace APIs.
- [x] Enforce ownership checks on session APIs.
- [x] Add cross-user denial tests.
- [x] Define how a control-plane session maps to a worker session.
- [x] Define required worker metadata fields.
- [x] Add worker metadata endpoint fields.
- [x] Add explicit session checkpoint endpoint.
- [x] Add worker-to-control-plane heartbeat or checkpoint call.
- [x] Reject worker session sync for the wrong user.
- [x] Reject worker session sync for the wrong sandbox.
- [x] Add retry and backoff policy for checkpoint submission.
- [x] Add audit events for session sync failures.
- [x] Add session close/finalize sync behavior.

### Frontend Checklist

- [x] Add project list UI.
- [x] Add project creation UI.
- [x] Add project detail UI.
- [x] Add workspace list UI inside project context.
- [x] Add workspace creation UI.
- [x] Add session list UI inside workspace context.
- [x] Add session creation UI.
- [x] Add empty states for project, workspace, and session lists.
- [x] Add loading states for all product metadata lists.
- [x] Add create/update error states.
- [x] Add open-session flow that obtains a route token and connects through the
  router.

### Verification

- [x] Control-plane CRUD and ownership tests pass.
- [x] Frontend project/workspace/session navigation tests pass.
- [x] Worker metadata tests cover safe metadata shape.
- [x] Session sync tests cover wrong-user and wrong-sandbox denial.
- [ ] E2E smoke test creates a project, workspace, session, and opens the
  session through the router.
- [ ] Local smoke test proves a worker checkpoint reaches the control plane.

## Phase 3: Sandbox Lifecycle And AWS Runtime

Goal: the control plane can start, stop, observe, and recover one sandbox per
user.

### Deliverables

- A `SandboxManager` interface.
- Local adapters for tests and development.
- An AWS adapter for EKS Fargate phase-one workers.
- Sandbox lifecycle APIs.
- UI for sandbox state and lifecycle operations.
- Idempotent lifecycle behavior and structured failure reporting.

### Sandbox Manager Checklist

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
- [x] Document local sandbox environment variables.

### AWS Adapter Checklist

- [x] Choose EKS Fargate for phase-one sandbox workers.
- [x] Document the EKS Fargate decision and ECS fallback.
- [x] Define worker image repository and immutable tag format.
- [x] Define CPU, memory, and ephemeral storage profiles.
- [x] Define VPC, subnet, security group, and egress requirements.
- [x] Implement AWS adapter configuration loading.
- [x] Implement Kubernetes Pod creation.
- [x] Implement Kubernetes Pod stop.
- [x] Implement Kubernetes Pod status polling.
- [x] Implement worker endpoint discovery.
- [x] Implement worker environment injection.
- [x] Implement worker secret injection.
- [x] Handle AWS capacity errors.
- [x] Handle image pull errors.
- [x] Handle worker readiness timeout.
- [x] Add namespace or label strategy for production multi-user isolation.
- [x] Add idle-timeout policy.
- [x] Add sandbox reaper job for stale `starting`, `stopping`, and orphaned
  runtime records.
- [x] Define scaling and capacity request process.
- [ ] Add snapshot hooks before stop/restart if persistence is enabled.

### API And UI Checklist

- [x] Add `GET /api/sandbox`.
- [x] Add `POST /api/sandbox/start`.
- [x] Add `POST /api/sandbox/stop`.
- [x] Add `POST /api/sandbox/restart`.
- [x] Add `GET /api/sandbox/health`.
- [x] Add admin sandbox list API.
- [x] Add admin sandbox detail API.
- [x] Add admin force-stop API.
- [x] Track sandbox heartbeat timestamp.
- [x] Track image version.
- [x] Track resource profile.
- [x] Track endpoint.
- [x] Track status reason.
- [x] Track startup progress.
- [x] Track last failure code and message.
- [x] Add sandbox status indicator UI.
- [x] Add start/stop/restart actions in the UI.
- [x] Add degraded/offline UI.
- [x] Add startup progress UI.
- [x] Add failure reason UI.
- [x] Add admin sandbox detail UI.
- [ ] Add local smoke script that starts control plane plus local worker.
- [x] Add local route-token smoke test against the worker-process adapter.

### Verification

- [x] Unit tests cover lifecycle transitions.
- [x] AWS adapter tests pass with mocked AWS clients.
- [x] Local worker-process adapter can start a worker.
- [ ] Staging can create, start, observe, and stop one EKS Fargate sandbox.
- [ ] Staging validates that repeated start/stop/restart calls are idempotent.
- [ ] Staging validates that an unreachable worker becomes degraded or offline.

## Phase 4: Worker Image, Runtime, And Worker-Side Policy

Goal: the sandbox worker image is reproducible, non-root, scoped to
`/workspace`, and rejects unauthorized worker API access.

### Deliverables

- A canonical worker image.
- Pinned provider runtimes.
- Worker-mode startup validation.
- Worker token enforcement.
- Signed router identity envelope validation.
- Scope checks for sensitive worker routes.

### Image Checklist

- [x] Keep `Dockerfile.worker` as the canonical worker image.
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
- [x] Build the worker image locally from a clean checkout.
- [x] Run the worker container locally and verify `/readyz`.
- [ ] Push an immutable image tag to the chosen registry.

### Startup Guardrail Checklist

- [x] Add safe worker runtime metadata endpoint.
- [x] Validate worker-mode required environment.
- [x] Validate `REMOTE_CODEX_SANDBOX_ID`.
- [x] Validate `REMOTE_CODEX_USER_ID`.
- [x] Validate `REMOTE_CODEX_WORKER_AUTH_TOKEN`.
- [x] Validate `WORKSPACE_ROOT=/workspace` in production worker mode.
- [x] Validate `HOME=/home/agent` in production worker mode.
- [x] Fail fast on missing provider home directories.
- [x] Fail fast on unwritable workspace.
- [x] Redact service tokens from startup logs.
- [x] Redact harness key from startup logs.
- [x] Redact gateway token from startup logs.
- [x] Add startup metadata logs without secrets.
- [x] Validate gateway environment when provider runtimes are enabled.
- [x] Validate ElAgenteHarness environment when chemistry tools are enabled.
- [x] Validate MCP config path and permissions.

### Worker Authorization Checklist

- [x] Keep `/healthz` public.
- [x] Keep `/readyz` public.
- [x] Require worker token for non-health APIs in worker mode.
- [x] Accept `Authorization: Bearer <token>`.
- [x] Accept `X-Remote-Codex-Worker-Token`.
- [x] Disable provider host config read in worker mode.
- [x] Disable provider host config write in worker mode.
- [x] Disable build restart in worker mode.
- [x] Disable runtime install/update in worker mode.
- [x] Strip or ignore browser-supplied user identity headers.
- [x] Define signed identity envelope headers.
- [x] Verify identity envelope signature.
- [x] Verify identity envelope expiry.
- [x] Verify identity envelope sandbox id matches `REMOTE_CODEX_SANDBOX_ID`.
- [x] Verify identity envelope scopes.
- [x] Add `shell:write` checks to shell write, terminate, and update routes.
- [x] Add `file:write` checks to file write, move, delete, and upload routes.
- [x] Add `provider:turn:create` checks to provider turn creation routes.
- [x] Add `provider:turn:interrupt` checks to provider interrupt routes.
- [ ] Add artifact read/write scopes after the artifact model is finalized.
- [x] Deny scope-protected routes when the envelope is missing.
- [x] Deny scope-protected routes when the envelope is expired.
- [x] Deny scope-protected routes when the envelope sandbox is wrong.
- [x] Deny scope-protected routes when required scope is missing.

### Verification

- [x] Supervisor API typecheck passes.
- [x] Worker token auth tests pass.
- [x] Disabled management-route tests pass.
- [x] Scope-denial tests cover checked protected routes.
- [x] `docker build -f Dockerfile.worker -t remote-codex-worker:verify .`
  passes.
- [x] Local worker container smoke test passes.

## Phase 5: Sandbox Router And Route Tokens

Goal: browser traffic reaches a worker only through short-lived
control-plane-issued route tokens and router-injected worker identity.

### Deliverables

- Route-token signing and verification.
- A router package that supports HTTP, SSE, and WebSocket worker traffic.
- Endpoint resolution from control plane or registry.
- Internal worker token and signed identity envelope injection.
- Request limits, timeout handling, rate limiting, and audit logs.
- Frontend token acquisition and refresh.

### Control Plane Checklist

- [x] Define route token payload schema.
- [x] Include user id, sandbox id, scopes, expiry, and nonce/token id.
- [x] Sign route tokens with a control-plane secret.
- [x] Add route-token key id.
- [x] Document route-token signing key rotation.
- [x] Document route-token revocation strategy.
- [x] Add route-token tests for expiry, tampering, and wrong sandbox.
- [x] Add `POST /api/sandboxes/:sandboxId/route-token`.
- [x] Check sandbox ownership before issuing a route token.
- [x] Check sandbox running state before issuing a route token.
- [x] Check account status before issuing a route token.
- [x] Reject route-token requests for archived sessions.
- [x] Return `routerBaseUrl`, `wsBaseUrl`, and `expiresAt`.
- [x] Audit route-token issuance.
- [x] Check user quota before issuing route tokens.
- [x] Include project, workspace, and session scopes when requested.
- [x] Return a stable quota-exceeded API error shape.

### Router Checklist

- [x] Keep the router package in this repository for phase one.
- [x] Implement HTTP proxy.
- [x] Implement SSE proxy.
- [x] Implement WebSocket proxy.
- [x] Verify route tokens in the router.
- [x] Resolve sandbox endpoint from control plane or registry.
- [x] Inject internal worker token.
- [x] Strip browser-supplied internal worker headers.
- [x] Strip browser-supplied identity envelope headers.
- [x] Inject signed identity envelope when worker scope checks are enabled.
- [x] Add request size limits.
- [x] Add upstream idle timeouts.
- [x] Add rate limits.
- [x] Add structured proxy errors.
- [x] Add router health endpoint.
- [x] Add router audit logs.
- [x] Add local browser-to-router-to-worker smoke script.
- [ ] Add staging direct-worker-denial check.

### Frontend Checklist

- [x] Fetch route token before opening a worker session.
- [x] Store route token only in memory.
- [x] Refresh route token before expiry.
- [x] Avoid persisting route tokens in local storage.
- [x] Reconnect worker WebSocket after token refresh.
- [x] Show route authorization failure state.
- [x] Show reconnecting state during route refresh or WebSocket reconnect.
- [x] Show sandbox offline state when the router reports worker unavailable.

### Verification

- [x] Control-plane route-token tests pass.
- [x] Router unit tests pass.
- [x] Sandbox-router typecheck passes.
- [x] Local browser-to-router-to-worker smoke test passes.
- [ ] Staging browser-to-router-to-worker smoke test passes.
- [ ] Staging proves the worker is unreachable without router-injected token.

## Phase 6: Provider Gateway, Harness Bootstrap, MCP, Usage, And Quotas

Goal: Codex, Claude Code, OpenCode, and chemistry tools work inside the sandbox
through scoped credentials while Remote Codex can account for usage and enforce
launch quotas.

This phase is broad. It should be implemented in small vertical slices:
gateway credential provisioning first, provider config rendering second, usage
import third, then quota enforcement and UI.

### LLM Gateway Checklist

- [x] Choose the phase-one gateway implementation and deployment shape.
- [x] Document gateway admin credential requirements.
- [x] Add gateway provider config table or config source.
- [x] Store gateway base URL.
- [x] Store gateway key id per user or sandbox.
- [x] Store encrypted gateway token only if raw recovery is required.
- [x] Add gateway client interface.
- [x] Implement gateway user creation.
- [x] Implement gateway key creation.
- [x] Implement gateway key revocation.
- [x] Implement gateway key rotation.
- [x] Attach gateway credential to sandbox provisioning.
- [x] Add admin endpoint to reconcile gateway keys.
- [x] Redact gateway tokens from logs.
- [x] Redact gateway tokens from API responses.

### Provider Bootstrap Checklist

- [x] Render Codex config pointing to the gateway `/v1` endpoint.
- [x] Prove Codex config never contains real provider root keys.
- [x] Render Claude Code config pointing to the gateway.
- [x] Prove Claude Code config never contains real provider root keys.
- [x] Render OpenCode config pointing to the gateway.
- [x] Prove OpenCode config never contains real provider root keys.
- [x] Add startup check that gateway env is present when providers are enabled.
- [x] Add provider bootstrap tests for Codex.
- [x] Add provider bootstrap tests for Claude Code.
- [x] Add provider bootstrap tests for OpenCode.

### ElAgenteHarness Checklist

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
- [x] Inject `ELAGENTE_HARNESS_BASE_URL` into the worker.
- [x] Inject `INACT_X_APP_KEY` into the worker.
- [x] Validate harness env in worker mode when chemistry tools are enabled.
- [ ] Redact harness key from logs.
- [x] Report harness integration status in worker metadata without exposing the
  raw key.

### MCP And Tool Policy Checklist

- [ ] Define approved MCP server registry.
- [ ] Define stdio MCP launch policy.
- [ ] Define remote MCP allowlist policy.
- [ ] Render Codex MCP config under the sandbox provider home.
- [ ] Render Claude MCP config under the sandbox provider home.
- [ ] Render OpenCode MCP config under the sandbox provider home.
- [ ] Ensure stdio MCP servers run with cwd inside `/workspace`.
- [ ] Ensure stdio MCP servers inherit only approved env vars.
- [ ] Block host-local filesystem MCP servers by default.
- [ ] Block host-local Docker MCP servers by default.
- [ ] Block host-local database MCP servers by default.
- [ ] Add MCP startup audit events.
- [ ] Add MCP tool-call audit events.
- [ ] Add MCP failure timeline items where useful.
- [ ] Add ElAgenteHarness tools to the approved MCP/tool registry.
- [ ] Add UI for MCP status and failures.

### Usage And Quota Checklist

- [ ] Finalize normalized usage ledger schema.
- [ ] Add usage source enum for `llm`.
- [ ] Add usage source enum for `harness`.
- [ ] Add usage source enum for `compute`.
- [ ] Add usage source enum for `storage`.
- [ ] Add usage source enum for `sandbox_runtime`.
- [ ] Add dedupe key for imported usage events.
- [ ] Store user id on usage events.
- [ ] Store sandbox id on usage events.
- [ ] Store project id when available.
- [ ] Store workspace id when available.
- [ ] Store session id when available.
- [ ] Store usage units.
- [ ] Store cost amount.
- [ ] Store currency.
- [ ] Store metadata JSON.
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
- [x] Add scheduled LLM gateway usage import job.
- [x] Add manual admin LLM usage import endpoint.
- [x] Deduplicate gateway usage events by gateway event id.
- [x] Map gateway key id to user id.
- [x] Map gateway key id to sandbox id when available.
- [ ] Add harness webhook receiver or polling importer.
- [ ] Map harness usage to user, sandbox, project, workspace, and session when
  available.

### Frontend Checklist

- [x] Add LLM usage summary UI.
- [x] Add LLM usage detail UI.
- [x] Add gateway unavailable UI.
- [x] Add quota exceeded UI for LLM usage.
- [ ] Add workflow catalog UI.
- [ ] Add task status UI.
- [ ] Add job status UI.
- [ ] Add chemistry artifact display hooks.
- [ ] Add usage dashboard.
- [ ] Add quota remaining display.
- [ ] Add quota exceeded banner.
- [ ] Add admin usage reconciliation page or export endpoint.

### Verification

- [x] Gateway client tests pass with mocked gateway API.
- [x] Worker provider bootstrap tests pass for Codex, Claude Code, and OpenCode.
- [ ] Harness credential tests pass.
- [x] Harness bootstrap tests pass.
- [ ] Harness tool config tests pass.
- [ ] MCP config rendering tests pass.
- [ ] MCP startup audit tests pass.
- [ ] Usage ledger tests pass.
- [x] Quota service tests pass.
- [ ] Usage UI tests pass.

## Later Phases: Persistence, Deployment, Operations, And CI

These are required before production launch but can be sequenced after the
first provider/harness bootstrap path works.

### Workspace Persistence And Diffs

- [ ] Choose phase-one persistence backend.
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

### Deployment And Operations

- [ ] Add Railway service definition for frontend.
- [ ] Add Railway service definition for control-plane API.
- [ ] Add Railway Postgres configuration.
- [ ] Add required frontend env documentation.
- [ ] Add required control-plane env documentation.
- [ ] Add migration command for deploy.
- [ ] Add frontend health check.
- [ ] Add control-plane health check.
- [ ] Add AWS account and environment naming convention.
- [ ] Add ECR repository for worker image.
- [ ] Add sandbox router deployment plan.
- [ ] Add sandbox worker runtime plan.
- [ ] Add VPC networking plan.
- [ ] Add egress policy.
- [ ] Add secrets injection plan.
- [ ] Add logs and metrics plan.
- [ ] Store route-token signing secret securely.
- [ ] Store worker internal token material securely.
- [ ] Add sandbox lifecycle metrics.
- [ ] Add route-token issuance metrics.
- [ ] Add router request metrics.
- [x] Add gateway usage import metrics.
- [ ] Add harness usage import metrics.
- [ ] Add quota denial metrics.

### CI And Release Gates

- [ ] Add CI for control-plane API typecheck and tests.
- [ ] Add CI for supervisor-web typecheck and tests.
- [ ] Add CI for supervisor-api typecheck and tests.
- [ ] Add CI for sandbox-router typecheck and tests.
- [ ] Add CI for worker image build.
- [ ] Add CI migration check.
- [ ] Add local integration smoke script for control plane, router, and local
  worker.
- [ ] Add staging smoke script for one sandbox lifecycle.
- [ ] Add staging smoke script for browser-to-router-to-worker traffic.
- [x] Add release checklist that blocks production when required smoke tests are
  unchecked.
