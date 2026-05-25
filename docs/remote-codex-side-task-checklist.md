# Remote Codex Side Task Checklist

This document is the implementation checklist for work that belongs in this
repository. It is intentionally narrower than the full Agente product
architecture.

Remote Codex owns:

- The browser product surface.
- The control-plane API.
- User, project, workspace, session, sandbox, usage, and audit records.
- Sandbox lifecycle orchestration.
- Route-token issuance and, if kept here, the sandbox router.
- The sandbox worker image and worker-mode supervisor API.
- Worker bootstrap for Codex, Claude Code, OpenCode, MCP, the LLM gateway, and
  ElAgenteHarness.

Remote Codex does not own:

- The internals of the LLM gateway.
- The internals of ElAgenteHarness.
- Modal, AWS Batch, HPC, or chemistry compute worker implementations.
- Real provider root key storage when a gateway owns those keys.

Each checkbox should be updated only when the corresponding code, tests, and
docs are merged on this branch. If a task is only designed but not implemented,
leave it unchecked.

## Checklist Rules

- `[ ]` means not implemented or not verified.
- `[x]` means implemented and verified in this repository.
- Every checked task should have a concrete verification path: test, typecheck,
  smoke test, migration, or deployment check.
- Prefer small commits that complete one visible group of tasks.
- Do not check tasks that are implemented only in an external service.
- If a task moves out of this repository, mark the Remote Codex item as the
  integration contract only and add the external service link in the note.

## Phase 0: Repository Baseline And Architecture

Goal: keep this branch as the product-control-plane foundation and make the
scope clear to future contributors.

### Documents

- [x] Create the `sandbox-worker-control-plane` branch.
- [x] Document the overall Agente product architecture.
- [x] Document the control-plane to sandbox-worker architecture.
- [x] Document the control-plane auth approach.
- [x] Document the control-plane session to worker contract.
- [x] Keep `docs/README.md` as the document index.
- [x] Keep `docs/remote-codex-implementation-checklist.md` as the broad
  architecture checklist.
- [x] Add this Remote Codex side implementation checklist.

### Repository Hygiene

- [ ] Add a top-level architecture decision log for major deployment decisions.
- [ ] Add a `docs/status.md` or equivalent current-state summary before each
  larger phase handoff.
- [ ] Keep obsolete docs removed from this branch.
- [ ] Ensure docs describe the difference between local-dev mode, staging mode,
  and production mode.

### Verification

- [x] `docs/README.md` links to this file.
- [x] New contributors can identify what Remote Codex owns without reading
  external repositories.

## Phase 1: Product Auth And User Accounts

Goal: users can register, log in, and manage their Remote Codex product account
without exposing product identity tokens to sandbox workers.

### Backend Auth Boundary

- [x] Add an auth verifier interface in the control-plane API.
- [x] Keep local `dev:<subject>` bearer auth for development.
- [x] Add JWT verifier support for production-style auth.
- [x] Add tests for local-dev auth success paths.
- [x] Add tests for production verifier failure paths.
- [ ] Choose the production phase-one auth provider.
- [ ] Document required auth provider environment variables.
- [ ] Document how auth subjects map to Remote Codex users.
- [ ] Add auth-provider-specific integration tests or smoke tests.
- [ ] Add token issuer and audience checks for production mode.
- [ ] Add clock-skew tolerance for provider JWT validation.
- [ ] Add clear `401` and `403` error response shapes.

### User Model

- [x] Store user account status.
- [x] Store display name.
- [x] Store billing customer id.
- [x] Store quota profile.
- [x] Store created and updated timestamps.
- [x] Add `GET /api/me`.
- [x] Add `PATCH /api/me`.
- [x] Add admin user list filters.
- [x] Add admin user status update endpoint.
- [x] Add admin user quota profile update endpoint.
- [x] Add audit events for admin user updates.
- [ ] Add user deletion or deactivation policy.
- [ ] Add user data export policy.
- [ ] Add user email verification state if the provider does not own it.
- [ ] Add account bootstrap idempotency tests.

### Frontend Auth Surface

- [ ] Add login route.
- [x] Add registration or signup route.
- [x] Add logout action.
- [ ] Add authenticated app-shell guard.
- [ ] Add loading state while product auth resolves.
- [ ] Add expired-session state.
- [ ] Add unauthorized or disabled-account state.
- [x] Add account/profile page.
- [ ] Add admin-only user table or user management route.
- [ ] Ensure product user JWT is never passed to worker APIs.

### Verification

- [x] `pnpm --filter @remote-codex/control-plane-api typecheck`
- [x] `pnpm --filter @remote-codex/control-plane-api test`
- [x] `pnpm --filter @remote-codex/supervisor-web typecheck`
- [ ] Frontend auth tests cover login, logout, loading, and unauthorized states.
- [ ] End-to-end smoke test covers login to authenticated shell.

## Phase 2: Projects, Workspaces, And Sessions

Goal: Remote Codex owns durable product metadata, while sandbox workers own live
runtime state.

### Control-Plane Schema

- [x] Add control-plane user schema.
- [x] Add control-plane sandbox schema.
- [x] Add control-plane project schema.
- [x] Add control-plane workspace schema.
- [x] Add control-plane session schema.
- [x] Add one-user-to-one-sandbox invariant for phase one.
- [x] Link workspaces to projects.
- [x] Link sessions to workspaces.
- [x] Track worker session id separately from control-plane session id.
- [ ] Add archive/delete semantics for projects.
- [ ] Add archive/delete semantics for workspaces.
- [ ] Add archive/delete semantics for sessions.
- [ ] Add migration rollback notes or forward-only migration notes.

### Control-Plane API

- [x] Add `GET /api/projects`.
- [x] Add `POST /api/projects`.
- [x] Add `GET /api/projects/:projectId`.
- [x] Add `PATCH /api/projects/:projectId`.
- [x] Add `DELETE /api/projects/:projectId` or archived status.
- [x] Add `GET /api/projects/:projectId/workspaces`.
- [x] Add `POST /api/projects/:projectId/workspaces`.
- [x] Add `PATCH /api/workspaces/:workspaceId`.
- [x] Add `GET /api/workspaces/:workspaceId/sessions`.
- [x] Add `POST /api/workspaces/:workspaceId/sessions`.
- [x] Add `PATCH /api/sessions/:sessionId`.
- [x] Add ownership checks for all project, workspace, and session endpoints.
- [x] Add cross-user access denial tests.
- [ ] Add pagination for project lists.
- [ ] Add pagination for workspace lists.
- [ ] Add pagination for session lists.
- [ ] Add search or filtering for product UI lists.

### Frontend Product Flow

- [x] Add project list route.
- [x] Add project creation flow.
- [ ] Add project detail route.
- [x] Add workspace list inside project context.
- [x] Add workspace creation flow.
- [x] Add session list inside workspace context.
- [x] Add session creation flow.
- [ ] Add session open flow that acquires a route token.
- [x] Add empty states for no projects, workspaces, and sessions.
- [ ] Add loading states for every list.
- [x] Add error states for failed create/update requests.

### Worker Contract

- [x] Define how a control-plane session maps to a worker thread/session.
- [x] Define session metadata sync from worker to control plane.
- [x] Add worker metadata fields needed by the session registry.
- [x] Add explicit session checkpoint endpoint.
- [ ] Add worker-to-control-plane session heartbeat or checkpoint call.
- [ ] Add session close/finalize sync behavior.
- [ ] Add tests that reject session sync for the wrong user or sandbox.

### Verification

- [x] Control-plane API tests cover CRUD and ownership.
- [x] Web typecheck passes.
- [x] Frontend tests cover project, workspace, and session navigation.
- [ ] End-to-end smoke test covers create project to open session.

## Phase 3: Sandbox Lifecycle

Goal: one user gets one isolated sandbox, and the control plane can create,
start, stop, observe, and eventually snapshot it.

### Sandbox Manager Interface

- [x] Define the `SandboxManager` interface.
- [x] Add `createSandbox`.
- [x] Add `startSandbox`.
- [x] Add `stopSandbox`.
- [x] Add `restartSandbox`.
- [x] Add `deleteSandbox`.
- [x] Add `getSandboxStatus`.
- [x] Add `getSandboxEndpoint`.
- [x] Add `prepareSandboxEnvironment`.
- [x] Add structured errors for quota, capacity, config, and provider failures.
- [ ] Add a sandbox lifecycle state machine document.
- [ ] Add idempotency rules for start, stop, restart, and delete.

### Local Development Adapter

- [x] Implement local no-op sandbox adapter for tests.
- [x] Implement local worker-process sandbox adapter for development.
- [x] Add local adapter tests.
- [x] Document local sandbox development environment variables.
- [ ] Add a local smoke script that starts control plane plus local worker.
- [ ] Add local route-token smoke test against the worker process.

### AWS Adapter

- [ ] Choose phase-one runtime: EKS Fargate or ECS Fargate.
- [ ] Document why that runtime was chosen.
- [ ] Define the worker image repository.
- [ ] Define the worker image tag format.
- [ ] Define CPU, memory, and ephemeral storage profiles.
- [ ] Define VPC, subnet, security group, and egress requirements.
- [ ] Implement AWS adapter configuration loading.
- [ ] Implement Pod/task creation.
- [ ] Implement Pod/task stop.
- [ ] Implement Pod/task status polling.
- [ ] Implement worker endpoint discovery.
- [ ] Implement worker environment injection.
- [ ] Implement worker secret injection.
- [ ] Add AWS adapter tests with mocked AWS clients.
- [ ] Add failure handling for AWS capacity errors.
- [ ] Add failure handling for image pull errors.
- [ ] Add failure handling for worker readiness timeout.

### Control-Plane Sandbox API

- [x] Add `GET /api/sandbox`.
- [x] Add `POST /api/sandbox/start`.
- [x] Add `POST /api/sandbox/stop`.
- [x] Add `POST /api/sandbox/restart`.
- [x] Add `GET /api/sandbox/health`.
- [x] Add admin sandbox list endpoint.
- [x] Add admin sandbox force-stop endpoint.
- [x] Track sandbox heartbeat timestamp.
- [x] Track sandbox image version.
- [x] Track sandbox resource profile.
- [x] Track sandbox endpoint.
- [x] Track sandbox status reason.
- [ ] Add startup progress fields.
- [ ] Add last failure code and last failure message.
- [ ] Add sandbox idle-timeout policy.
- [ ] Add admin restart with reason audit event.

### Frontend Sandbox Surface

- [x] Add sandbox status indicator.
- [x] Add start sandbox action.
- [x] Add stop sandbox action.
- [x] Add restart sandbox action.
- [ ] Add degraded/offline banner.
- [ ] Add startup progress state.
- [ ] Add failure reason display.
- [ ] Add admin sandbox view.

### Verification

- [x] Unit tests cover sandbox lifecycle transitions.
- [x] Local dev adapter can start a worker process.
- [x] Control-plane typecheck passes.
- [x] Web typecheck passes.
- [ ] AWS adapter unit tests pass.
- [ ] Staging can start one sandbox from the control plane.
- [ ] Staging can stop one sandbox from the control plane.

## Phase 4: Worker Image And Runtime Hardening

Goal: the sandbox worker starts from a pinned image and fails closed when
required identity, filesystem, or token settings are missing.

### Worker Image

- [x] Keep `Dockerfile.worker` as the canonical worker image.
- [x] Pin the Node base image version.
- [ ] Pin `@openai/codex`.
- [ ] Pin `@anthropic-ai/claude-code`.
- [ ] Pin `@anthropic-ai/claude-agent-sdk`.
- [ ] Pin `opencode-ai`.
- [ ] Pin `@opencode-ai/sdk`.
- [x] Add image labels for git SHA and image version.
- [x] Run the image as non-root `agent`.
- [x] Set `/workspace` as the default workspace root.
- [x] Set provider homes under `/home/agent`.
- [x] Ensure the worker listens on `0.0.0.0`.
- [ ] Add a build-time version manifest for all provider runtimes.
- [ ] Add a runtime endpoint that reports safe version metadata.

### Worker Startup Validation

- [x] Add required env validation for worker mode.
- [x] Validate `REMOTE_CODEX_SANDBOX_ID`.
- [x] Validate `REMOTE_CODEX_USER_ID`.
- [x] Validate `REMOTE_CODEX_WORKER_AUTH_TOKEN`.
- [x] Validate `WORKSPACE_ROOT=/workspace` in production worker mode.
- [x] Validate `HOME=/home/agent` in production worker mode.
- [x] Fail fast on missing provider home directories.
- [x] Fail fast on unwritable workspace.
- [x] Redact service tokens from startup logs.
- [x] Add startup metadata logs without secrets.
- [ ] Validate gateway env when provider runtimes are enabled.
- [ ] Validate ElAgenteHarness env when chemistry tools are enabled.
- [ ] Validate MCP config path and permissions.

### Worker API Hardening

- [x] Keep `/healthz` public.
- [x] Keep `/readyz` public.
- [x] Require worker token for non-health APIs in worker mode.
- [x] Support `Authorization: Bearer <token>`.
- [x] Support `X-Remote-Codex-Worker-Token`.
- [x] Disable provider host config read in worker mode.
- [x] Disable provider host config write in worker mode.
- [x] Disable build restart in worker mode.
- [x] Disable runtime install/update in worker mode.
- [ ] Add signed identity envelope verification.
- [ ] Add scope checks for shell write.
- [ ] Add scope checks for file write.
- [ ] Add scope checks for provider turn creation.
- [ ] Add scope checks for provider interrupt.
- [ ] Add scope checks for artifact read/write.
- [ ] Add denial tests for every scope-protected route.

### Verification

- [x] `pnpm --filter @remote-codex/supervisor-api typecheck`
- [x] `pnpm --filter @remote-codex/config typecheck`
- [ ] `pnpm --filter @remote-codex/supervisor-api test`
- [ ] `docker build -f Dockerfile.worker -t remote-codex-worker:verify .`
- [ ] Run the worker container locally and verify `/readyz`.
- [ ] Verify the worker rejects non-health requests without token.
- [ ] Verify the worker accepts non-health requests with the internal token.

## Phase 5: Sandbox Router And Route Tokens

Goal: the browser never talks to a naked worker with long-lived credentials.
Worker traffic goes through a short-lived route token and an internal worker
token.

### Route Token Contract

- [x] Define route token payload schema.
- [x] Include user id.
- [x] Include sandbox id.
- [x] Include scopes.
- [x] Include expiry.
- [x] Include nonce or token id.
- [x] Sign route tokens with a control-plane secret.
- [x] Add tests for expired tokens.
- [x] Add tests for tampered tokens.
- [x] Add tests for wrong-sandbox tokens.
- [x] Add key id to route token header or payload.
- [x] Add route-token signing key rotation strategy.
- [ ] Add route-token revocation strategy if required.

### Control-Plane Route Token API

- [x] Add `POST /api/sandboxes/:sandboxId/route-token`.
- [x] Check that the user owns the sandbox.
- [x] Check that the sandbox is running.
- [x] Return `routerBaseUrl`.
- [x] Return `wsBaseUrl`.
- [x] Return `expiresAt`.
- [x] Audit route-token issuance.
- [ ] Check user quota before issuing route tokens.
- [x] Check account status before issuing route tokens.
- [ ] Include project, workspace, and session scopes when requested.
- [x] Reject route-token requests for archived sessions.

### Router Implementation

- [ ] Decide whether the router package lives in this repository or a separate
  repository.
- [ ] Add router package if it lives in this repository.
- [ ] Implement HTTP proxy.
- [ ] Implement SSE proxy.
- [ ] Implement WebSocket proxy.
- [ ] Verify route tokens.
- [ ] Resolve sandbox endpoint from the control plane or sandbox registry.
- [ ] Inject `X-Remote-Codex-Worker-Token`.
- [ ] Strip browser-supplied internal worker headers.
- [ ] Strip browser-supplied identity envelope headers.
- [ ] Add request size limits.
- [ ] Add idle timeouts.
- [ ] Add rate limits.
- [ ] Add structured proxy errors.
- [ ] Add router health endpoint.
- [ ] Add router audit logs.

### Frontend Worker Connection

- [ ] Fetch a route token before opening a worker session.
- [x] Store route token only in memory.
- [ ] Refresh route token before expiry.
- [ ] Reconnect WebSocket after token refresh.
- [ ] Show sandbox offline state.
- [ ] Show route authorization failure state.
- [ ] Show reconnecting state.
- [ ] Avoid persisting route tokens in local storage.

### Verification

- [x] Control-plane route-token tests pass.
- [ ] Router unit tests pass.
- [ ] Browser to router to worker local smoke test passes.
- [ ] Browser to router to worker staging smoke test passes.
- [ ] Worker is unreachable without router-injected token in staging.

## Phase 6: LLM Gateway Integration

Goal: Codex, Claude Code, and OpenCode use a gateway token inside the sandbox.
Real provider root keys stay outside the sandbox.

### Control-Plane Gateway Client

- [ ] Add gateway provider config table or config source.
- [ ] Store gateway base URL.
- [ ] Store gateway key id per user or sandbox.
- [ ] Store encrypted gateway token only if raw recovery is required.
- [ ] Add gateway admin credential configuration.
- [ ] Add gateway client interface.
- [ ] Implement gateway user creation.
- [ ] Implement gateway key creation.
- [ ] Implement gateway key revocation.
- [ ] Implement gateway key rotation.
- [ ] Attach gateway credential to sandbox provisioning.
- [ ] Add admin endpoint to reconcile gateway keys.
- [ ] Add tests with mocked gateway client.

### Worker Provider Bootstrap

- [ ] Render Codex config that points to the gateway `/v1` endpoint.
- [ ] Ensure Codex config never contains a real provider root key.
- [ ] Render Claude Code config that points to the gateway.
- [ ] Ensure Claude Code config never contains a real provider root key.
- [ ] Render OpenCode config that points to the gateway.
- [ ] Ensure OpenCode config never contains a real provider root key.
- [ ] Add startup check that gateway env is present when providers are enabled.
- [ ] Add regression test for generated Codex config.
- [ ] Add regression test for generated Claude config.
- [ ] Add regression test for generated OpenCode config.
- [ ] Redact gateway tokens from logs and API responses.

### Usage Import

- [ ] Define normalized LLM usage event schema.
- [ ] Add usage import adapter for the chosen gateway.
- [ ] Add scheduled usage import job.
- [ ] Add manual admin usage import endpoint.
- [ ] Deduplicate usage events by gateway event id.
- [ ] Map gateway key id to user id.
- [ ] Map gateway key id to sandbox id when available.
- [ ] Store model, prompt tokens, completion tokens, cached tokens, and cost.
- [ ] Add user usage summary endpoint.
- [ ] Add user usage events endpoint.

### Frontend

- [ ] Add LLM usage summary card.
- [ ] Add LLM usage detail table.
- [ ] Add gateway unavailable state.
- [ ] Add quota exceeded state.

### Verification

- [ ] Control-plane gateway tests pass.
- [ ] Worker gateway bootstrap tests pass.
- [ ] Usage import tests pass.
- [ ] Frontend usage UI tests pass.

## Phase 7: ElAgenteHarness Integration

Goal: sandbox agents can call computational chemistry workflows through
ElAgenteHarness using scoped, revocable `INACT_X_APP_KEY` credentials.

### Control-Plane Harness Credentials

- [ ] Add harness base URL config.
- [ ] Add harness admin credential config if needed.
- [ ] Add harness credential table.
- [ ] Store only key hash when raw recovery is not needed.
- [ ] Store encrypted key when sandbox reinjection needs the raw key.
- [ ] Generate `INACT_X_APP_KEY` during user or sandbox provisioning.
- [ ] Bind harness key to user id.
- [ ] Bind harness key to sandbox id.
- [ ] Bind harness key to scopes.
- [ ] Bind harness key to quota profile.
- [ ] Add key rotation endpoint.
- [ ] Add key revocation endpoint.
- [ ] Add tests for key generation and ownership.

### Worker Harness Bootstrap

- [ ] Inject `ELAGENTE_HARNESS_BASE_URL`.
- [ ] Inject `INACT_X_APP_KEY`.
- [ ] Validate harness env in worker mode when chemistry tools are enabled.
- [ ] Redact harness key from logs.
- [ ] Add worker metadata that reports harness integration status without the
  raw key.
- [ ] Add ElAgenteHarness MCP config renderer if MCP is the chosen tool surface.
- [ ] Add ElAgenteHarness shell/tool wrapper renderer if wrappers are used.
- [ ] Add Codex config integration for harness tools.
- [ ] Add Claude Code config integration for harness tools.
- [ ] Add OpenCode config integration for harness tools.
- [ ] Add tests for harness config rendering.

### Product API And UI

- [ ] Add workflow catalog endpoint or proxy integration.
- [ ] Add task list endpoint or proxy integration.
- [ ] Add task detail endpoint or proxy integration.
- [ ] Add artifact metadata endpoint or proxy integration.
- [ ] Add workflow catalog UI.
- [ ] Add task status panel.
- [ ] Add job status panel.
- [ ] Add chemistry artifact display hooks.
- [ ] Add error state when harness key is missing.
- [ ] Add error state when harness service is unavailable.

### Usage

- [ ] Define normalized harness usage event schema.
- [ ] Add webhook receiver for harness usage events or task updates.
- [ ] Add polling importer if webhook is not available.
- [ ] Map harness usage to control-plane user id.
- [ ] Map harness usage to sandbox id.
- [ ] Map harness usage to project, workspace, and session when available.
- [ ] Store workflow id, job id, units, estimated cost, and actual cost.
- [ ] Add task and job usage to billing summary.

### Verification

- [ ] Harness credential tests pass.
- [ ] Harness bootstrap tests pass.
- [ ] Harness usage import tests pass.
- [ ] Frontend workflow and task UI tests pass.

## Phase 8: MCP And Tool Policy

Goal: MCP and tool execution stay inside the sandbox and are auditable.

### MCP Configuration

- [ ] Define approved MCP server registry.
- [ ] Define stdio MCP launch policy.
- [ ] Define remote MCP allowlist policy.
- [ ] Render Codex MCP config in the sandbox provider home.
- [ ] Render Claude MCP config in the sandbox provider home.
- [ ] Render OpenCode MCP config in the sandbox provider home.
- [ ] Ensure stdio MCP servers run with cwd inside `/workspace`.
- [ ] Ensure stdio MCP servers inherit only approved environment variables.
- [ ] Block host-local filesystem MCP servers by default.
- [ ] Block host-local Docker MCP servers by default.
- [ ] Block host-local database MCP servers by default.

### Auditing And UI

- [ ] Add MCP startup audit events.
- [ ] Add MCP tool-call audit events.
- [ ] Add MCP failure timeline items where useful.
- [ ] Add ElAgenteHarness tools to the approved MCP/tool registry.
- [ ] Add UI for MCP status and failures.

### Verification

- [ ] MCP config rendering tests pass.
- [ ] MCP startup audit tests pass.
- [ ] Worker typecheck passes.

## Phase 9: Workspace Persistence, Diffs, And Artifacts

Goal: workspaces survive sandbox restarts, and user changes can be reviewed
before being applied back to durable project storage.

### Persistence

- [ ] Choose phase-one persistence backend.
- [ ] Document EFS option tradeoffs.
- [ ] Document S3 snapshot option tradeoffs.
- [ ] Document temporary workspace limitations if chosen for MVP.
- [ ] Define maximum workspace size.
- [ ] Define maximum artifact size.
- [ ] Add snapshot metadata table.
- [ ] Add snapshot restore hook before worker ready.
- [ ] Add snapshot save hook before sandbox stop.
- [ ] Add manual snapshot endpoint.
- [ ] Add snapshot status endpoint.
- [ ] Add snapshot failure handling and retry policy.
- [ ] Add snapshot retention policy.

### Diff And Apply

- [ ] Initialize a baseline in `/workspace`.
- [ ] Preserve git metadata when workspace source is a git repository.
- [ ] Create synthetic baseline commit when source is not a git repository.
- [ ] Add worker endpoint for changed files.
- [ ] Add worker endpoint for text diff.
- [ ] Add worker endpoint for binary diff metadata.
- [ ] Add patch size limit.
- [ ] Add file size limit.
- [ ] Add symlink policy.
- [ ] Add executable bit policy.
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

- [ ] Snapshot restore smoke test passes.
- [ ] Snapshot save smoke test passes.
- [ ] Diff endpoint tests pass.
- [ ] Diff review UI tests pass.

## Phase 10: Billing, Quotas, And Usage Ledger

Goal: Remote Codex normalizes paid-resource usage from gateway, harness, compute,
storage, and sandbox runtime into one product ledger.

### Ledger

- [ ] Finalize usage ledger schema.
- [ ] Add event source enum for `llm`.
- [ ] Add event source enum for `harness`.
- [ ] Add event source enum for `compute`.
- [ ] Add event source enum for `storage`.
- [ ] Add event source enum for `sandbox_runtime`.
- [ ] Add dedupe key.
- [ ] Add user id.
- [ ] Add sandbox id.
- [ ] Add project id when available.
- [ ] Add workspace id when available.
- [ ] Add session id when available.
- [ ] Add units.
- [ ] Add cost amount.
- [ ] Add currency.
- [ ] Add metadata JSON.

### Quotas

- [ ] Add quota profile schema.
- [ ] Add user quota assignment.
- [ ] Add quota check service.
- [ ] Add LLM spend quota.
- [ ] Add compute spend quota.
- [ ] Add storage quota.
- [ ] Add sandbox runtime quota.
- [ ] Add quota preflight before route-token issuance.
- [ ] Add quota preflight before harness job creation when visible to Remote
  Codex.
- [ ] Add quota exceeded API response shape.

### UI

- [ ] Add usage dashboard.
- [ ] Add LLM usage breakdown.
- [ ] Add workflow usage breakdown.
- [ ] Add compute usage breakdown.
- [ ] Add quota remaining display.
- [ ] Add quota exceeded banner.
- [ ] Add admin usage reconciliation page or export endpoint.

### Verification

- [ ] Usage ledger tests pass.
- [ ] Quota service tests pass.
- [ ] Usage UI tests pass.

## Phase 11: Deployment, Operations, And CI

Goal: Remote Codex can be deployed repeatably, observed, and tested before
production traffic.

### Railway

- [ ] Add Railway service definition for frontend.
- [ ] Add Railway service definition for the control-plane API.
- [ ] Add Railway Postgres configuration.
- [ ] Add required control-plane environment variables.
- [ ] Add required frontend environment variables.
- [ ] Add migration command for deploy.
- [ ] Add health checks.

### AWS

- [ ] Add AWS account and environment naming convention.
- [ ] Add container registry for worker image.
- [ ] Add sandbox router deployment plan.
- [ ] Add sandbox worker runtime plan.
- [ ] Add VPC networking plan.
- [ ] Add egress policy.
- [ ] Add secrets injection plan.
- [ ] Add logs and metrics plan.

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
- [ ] Staging browser to worker smoke test succeeds.
- [ ] Staging gateway usage import smoke test succeeds.
- [ ] Staging harness key injection smoke test succeeds.

## Phase-One Definition Of Done

The first shippable product phase is complete only when all of these are true:

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
- [ ] Staging can run browser to worker to gateway to harness smoke tests.

## Suggested Execution Order

- [ ] 1. Finish production auth decision and frontend auth shell.
- [ ] 2. Finish project, workspace, and session frontend flows.
- [ ] 3. Finish local sandbox development docs and smoke scripts.
- [ ] 4. Pin worker image provider runtime versions.
- [ ] 5. Implement route-token router or decide it belongs in a separate repo.
- [ ] 6. Implement AWS sandbox adapter.
- [ ] 7. Add gateway key provisioning and provider config rendering.
- [ ] 8. Add ElAgenteHarness key provisioning and worker bootstrap.
- [ ] 9. Add MCP policy and auditing.
- [ ] 10. Add workspace persistence, snapshots, diffs, and artifacts.
- [ ] 11. Add usage ledger, quotas, and billing summaries.
- [ ] 12. Add deployment definitions, observability, and CI smoke tests.
