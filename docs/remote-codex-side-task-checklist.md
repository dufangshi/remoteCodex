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
- A task is not complete when it is only documented. Documentation-only work can
  check documentation tasks, but implementation tasks need code and verification.
- When checking a task, update the nearest `Verification` section or add a short
  note with the command, smoke test, migration, or deployment check that proves
  it.
- If a task is intentionally deferred, keep it unchecked and add a short reason
  near the item or in `docs/status.md`.

## Phase Gate Rules

Use these gates to keep the branch shippable while the implementation grows.

- Phase 0 is the documentation and repository baseline. It is complete when new
  contributors can read the docs index, understand the product boundaries, and
  see the current branch status without external context.
- Phase 1 is complete when product auth works in local and production-style
  modes, frontend auth states are covered, and product identity never crosses
  into worker APIs.
- Phase 2 is complete when users can create projects, workspaces, and sessions
  from the UI, and the control plane owns durable metadata with ownership tests.
- Phase 3 is complete when local development and AWS sandbox lifecycle paths can
  start, stop, observe, and recover one sandbox per user.
- Phase 4 is complete when the worker image is reproducible, non-root, pinned,
  and rejects unsafe startup or unauthorized worker API access.
- Phase 5 is complete when browser traffic reaches workers only through
  route-token proxying, and direct worker access is not viable in staging.
- Phase 6 is complete when Codex, Claude Code, and OpenCode bootstrap against
  the LLM gateway without exposing real provider root keys to the sandbox.

## Detailed Remote Codex Execution Board

Use this board as the practical one-item-at-a-time task list for this
repository. The phase sections below remain the full inventory; this section is
the execution-oriented view that should be updated as commits land.

Each task should be checked only when all three statements are true:

- The code or document change is merged on this branch.
- The related tests, typechecks, smoke checks, or manual deployment checks have
  passed.
- The completion evidence is recorded in the commit message, PR, or nearby
  verification note.

### A. Repository And Architecture Baseline

- [x] Create and push the `sandbox-worker-control-plane` branch.
- [x] Remove obsolete docs that do not match the sandbox-worker product shape.
- [x] Add the docs index in `docs/README.md`.
- [x] Document the full Agente product architecture.
- [x] Document the control-plane to sandbox-worker architecture.
- [x] Document product auth and control-plane identity boundaries.
- [x] Document the session-to-worker contract.
- [x] Document current branch status and known gaps.
- [x] Document architecture decisions for AWS runtime, sandbox shape, and local
  development mode.
- [x] Add this Remote Codex side task checklist.
- [x] Add the Remote Codex side implementation plan with phase-by-phase
  execution checklists.
- [x] Add local onboarding and smoke documentation for the control plane,
  sandbox router, and worker.
- [x] Add a short release-readiness document before the first staging deploy.

Verification:

- [x] `docs/README.md` links to the architecture docs and checklist docs.
- [x] `docs/status.md` names completed work and remaining risks.
- [x] `docs/local-control-plane-worker-smoke.md` documents the local smoke path.
- [x] First staging release notes link back to this checklist.

### B. Product Auth, Users, And Admin Boundary

- [x] Define the control-plane auth verifier interface.
- [x] Keep `dev:<subject>` bearer auth for local development.
- [x] Implement production-style JWT verifier support.
- [x] Validate JWT issuer.
- [x] Validate JWT audience.
- [x] Add clock-skew tolerance.
- [x] Standardize `401` and `403` error responses.
- [x] Bootstrap a product user record idempotently from authenticated identity.
- [x] Store user status.
- [x] Store display name.
- [x] Store billing customer id.
- [x] Store quota profile.
- [x] Add `GET /api/me`.
- [x] Add `PATCH /api/me`.
- [x] Add admin user listing.
- [x] Add admin user status update.
- [x] Add admin quota-profile update.
- [x] Add audit events for admin user updates.
- [ ] Add provider-specific auth integration or smoke tests.
- [x] Add explicit user deactivation policy.
- [x] Add user data export policy.
- [ ] Add email verification state only if the chosen auth provider does not
  own it.
- [ ] Add frontend login route.
- [x] Add frontend registration/signup entry.
- [x] Add frontend logout action.
- [ ] Add authenticated app-shell guard.
- [ ] Add auth-loading state.
- [ ] Add expired-session state.
- [ ] Add disabled-account state.
- [x] Add account/profile page.
- [ ] Add admin user management UI.
- [x] Prove product user JWTs are never forwarded to worker APIs.

Verification:

- [x] Control-plane auth unit tests pass.
- [x] Control-plane typecheck passes.
- [x] Supervisor-web typecheck passes.
- [ ] Frontend auth tests cover login, logout, loading, expired session, and
  disabled account.
- [ ] Local or staging e2e smoke test covers login to authenticated shell.

### C. Product Data Model: Projects, Workspaces, Sessions

- [x] Create durable project records.
- [x] Create durable workspace records.
- [x] Create durable session records.
- [x] Link workspaces to projects.
- [x] Link sessions to workspaces.
- [x] Track worker session id separately from control-plane session id.
- [x] Enforce one-user-to-one-sandbox invariant for phase one.
- [x] Define project archive/delete semantics.
- [x] Define workspace archive/delete semantics.
- [x] Define session archive/delete semantics.
- [x] Document forward-only migration policy.
- [x] Add project CRUD API.
- [x] Add workspace creation and update API.
- [x] Add session creation and update API.
- [x] Enforce ownership checks on project APIs.
- [x] Enforce ownership checks on workspace APIs.
- [x] Enforce ownership checks on session APIs.
- [x] Add cross-user denial tests.
- [x] Add pagination for project lists.
- [x] Add pagination for workspace lists.
- [x] Add pagination for session lists.
- [x] Add search/filter support for product lists.
- [x] Add project list UI.
- [x] Add project creation UI.
- [ ] Add project detail UI.
- [x] Add workspace list UI inside project context.
- [x] Add workspace creation UI.
- [x] Add session list UI inside workspace context.
- [x] Add session creation UI.
- [ ] Add session open flow that acquires a route token.
- [x] Add empty states for project/workspace/session lists.
- [ ] Add loading states for every project/workspace/session list.
- [x] Add create/update error states.

Verification:

- [x] Control-plane CRUD and ownership tests pass.
- [x] Frontend project/workspace/session navigation tests pass.
- [ ] E2E smoke test covers create project, create workspace, create session,
  and open session.

### D. Session-To-Worker Contract

- [x] Define how a control-plane session maps to a worker thread/session.
- [x] Define worker metadata fields required by the session registry.
- [x] Add worker metadata endpoint fields.
- [x] Add explicit session checkpoint endpoint.
- [x] Add worker-to-control-plane heartbeat or checkpoint call.
- [x] Add session close/finalize sync behavior.
- [x] Reject worker session sync for the wrong user.
- [x] Reject worker session sync for the wrong sandbox.
- [x] Add retry/backoff policy for session checkpoint submission.
- [x] Add audit events for session sync failures.

Verification:

- [x] Worker metadata tests cover safe metadata shape.
- [x] Session sync tests cover wrong-user and wrong-sandbox denial.
- [ ] Local smoke test verifies worker checkpoint reaches the control plane.

### E. Sandbox Lifecycle And AWS Adapter

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
- [x] Choose EKS Fargate for phase-one sandbox workers.
- [x] Document the EKS Fargate decision and ECS fallback.
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
- [x] Add sandbox start API.
- [x] Add sandbox stop API.
- [x] Add sandbox restart API.
- [x] Add sandbox health API.
- [x] Add admin sandbox list API.
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
- [ ] Add sandbox idle-timeout policy.
- [ ] Add admin sandbox view.
- [ ] Add local smoke script that starts control plane plus local worker.
- [x] Add local route-token smoke test against the worker process.
- [ ] Run staging start-one-sandbox smoke test.
- [ ] Run staging stop-one-sandbox smoke test.

Verification:

- [x] Unit tests cover lifecycle transitions.
- [x] AWS adapter tests pass with mocked AWS clients.
- [x] Local worker-process adapter can start a worker.
- [ ] Staging can create, start, observe, and stop one EKS Fargate sandbox.

### F. Worker Image, Runtime, And Startup Guardrails

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
- [x] Validate worker-mode required environment.
- [x] Validate `REMOTE_CODEX_SANDBOX_ID`.
- [x] Validate `REMOTE_CODEX_USER_ID`.
- [x] Validate `REMOTE_CODEX_WORKER_AUTH_TOKEN`.
- [x] Validate `WORKSPACE_ROOT=/workspace` in production worker mode.
- [x] Validate `HOME=/home/agent` in production worker mode.
- [x] Fail fast on missing provider home directories.
- [x] Fail fast on unwritable workspace.
- [x] Redact service tokens from startup logs.
- [x] Add startup metadata logs without secrets.
- [x] Validate gateway environment when provider runtimes are enabled.
- [x] Validate ElAgenteHarness environment when chemistry tools are enabled.
- [ ] Validate MCP config path and permissions.
- [ ] Build the worker image locally from a clean checkout.
- [ ] Run the worker container locally and verify `/readyz`.

Verification:

- [x] Supervisor API typecheck passes.
- [x] Config typecheck passes.
- [ ] `docker build -f Dockerfile.worker -t remote-codex-worker:verify .`
- [ ] Local worker container smoke test passes.

### G. Worker API Authorization And Scope Policy

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
- [x] Sign identity envelope in the router or local test client.
- [x] Verify identity envelope signature in the worker.
- [x] Verify identity envelope expiry.
- [x] Verify identity envelope sandbox id matches `REMOTE_CODEX_SANDBOX_ID`.
- [x] Verify identity envelope scopes.
- [x] Add `shell:write` checks to shell write, terminate, and update routes.
- [x] Add `file:write` checks to file write, move, delete, and upload routes.
- [x] Add `provider:turn:create` checks to provider turn creation routes.
- [x] Add `provider:turn:interrupt` checks to provider interrupt routes.
- [ ] Add artifact read/write scopes to artifact routes once the artifact model
  is finalized.
- [x] Deny scope-protected routes when the envelope is missing.
- [x] Deny scope-protected routes when the envelope is expired.
- [x] Deny scope-protected routes when the envelope sandbox is wrong.
- [x] Deny scope-protected routes when required scope is missing.

Verification:

- [x] Worker token auth tests pass.
- [x] Disabled management-route tests pass.
- [x] Scope-denial tests cover every checked scope-protected route.
- [x] `pnpm --filter @remote-codex/supervisor-api test`

### H. Sandbox Router And Route Tokens

- [x] Define route token payload schema.
- [x] Include user id, sandbox id, scopes, expiry, and nonce/token id.
- [x] Sign route tokens with a control-plane secret.
- [x] Add route-token key id.
- [x] Document route-token signing key rotation.
- [x] Add route-token tests for expiry, tampering, and wrong sandbox.
- [x] Add `POST /api/sandboxes/:sandboxId/route-token`.
- [x] Check sandbox ownership before issuing a route token.
- [x] Check sandbox running state before issuing a route token.
- [x] Check account status before issuing a route token.
- [x] Reject route-token requests for archived sessions.
- [x] Return `routerBaseUrl`, `wsBaseUrl`, and `expiresAt`.
- [x] Audit route-token issuance.
- [x] Decide whether the router package lives in this repository or another
  service.
- [x] Add router package if it lives in this repository.
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
- [x] Add idle timeouts.
- [x] Add rate limits.
- [x] Add structured proxy errors.
- [x] Add router health endpoint.
- [x] Add router audit logs.
- [x] Fetch route token before opening a worker session from the frontend.
- [x] Store route token only in memory.
- [x] Refresh route token before expiry.
- [ ] Reconnect WebSocket after token refresh.
- [x] Show route authorization failure state.
- [x] Show reconnecting state.

Verification:

- [x] Control-plane route-token tests pass.
- [x] Router unit tests pass.
- [x] Local browser-to-router-to-worker smoke test passes.
- [ ] Staging browser-to-router-to-worker smoke test passes.
- [ ] Worker is unreachable without router-injected token in staging.

### I. LLM Gateway Integration

- [ ] Choose the phase-one gateway implementation and deployment shape.
- [ ] Document gateway admin credential requirements.
- [ ] Add gateway provider config table or config source.
- [x] Store gateway base URL.
- [x] Store gateway key id per user or sandbox.
- [ ] Store encrypted gateway token only if raw recovery is required.
- [x] Add gateway client interface.
- [x] Implement gateway user creation.
- [x] Implement gateway key creation.
- [x] Implement gateway key revocation.
- [x] Implement gateway key rotation.
- [x] Attach gateway credential to sandbox provisioning.
- [x] Add admin endpoint to reconcile gateway keys.
- [x] Render Codex config pointing to the gateway `/v1` endpoint.
- [x] Prove Codex config never contains real provider root keys.
- [x] Render Claude Code config pointing to the gateway.
- [x] Prove Claude Code config never contains real provider root keys.
- [x] Render OpenCode config pointing to the gateway.
- [x] Prove OpenCode config never contains real provider root keys.
- [x] Add startup check that gateway env is present when providers are enabled.
- [x] Redact gateway tokens from logs.
- [x] Redact gateway tokens from API responses.
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
- [ ] Add LLM usage summary UI.
- [ ] Add LLM usage detail UI.
- [ ] Add gateway unavailable UI.
- [ ] Add quota exceeded UI for LLM usage.

Verification:

- [x] Gateway client tests pass with mocked gateway API.
- [x] Worker provider bootstrap tests pass for Codex, Claude Code, and OpenCode.
- [x] Usage import tests pass.
- [ ] Frontend usage UI tests pass.

### J. ElAgenteHarness Integration

- [x] Add harness base URL config.
- [ ] Add harness admin credential config if the harness requires one.
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
- [ ] Decide whether the tool surface is MCP, shell wrappers, provider config,
  or a combination.
- [ ] Render ElAgenteHarness MCP config if MCP is used.
- [ ] Render ElAgenteHarness shell/tool wrappers if wrappers are used.
- [ ] Integrate harness tools into Codex config.
- [ ] Integrate harness tools into Claude Code config.
- [ ] Integrate harness tools into OpenCode config.
- [ ] Add workflow catalog endpoint or proxy integration.
- [ ] Add task list endpoint or proxy integration.
- [ ] Add task detail endpoint or proxy integration.
- [ ] Add artifact metadata endpoint or proxy integration.
- [ ] Add workflow catalog UI.
- [ ] Add task status UI.
- [ ] Add job status UI.
- [ ] Add chemistry artifact display hooks.
- [ ] Define normalized harness usage event schema.
- [ ] Add harness webhook receiver or polling importer.
- [ ] Map harness usage to user, sandbox, project, workspace, and session when
  available.
- [ ] Store workflow id, job id, usage units, estimated cost, and actual cost.

Verification:

- [ ] Harness credential tests pass.
- [x] Harness bootstrap tests pass.
- [ ] Harness tool config tests pass.
- [ ] Harness usage import tests pass.
- [ ] Frontend workflow/task UI tests pass.

### K. MCP And Tool Policy

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

Verification:

- [ ] MCP config rendering tests pass.
- [ ] MCP startup audit tests pass.
- [ ] Worker typecheck passes.

### L. Workspace Persistence, Diffs, And Artifacts

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
- [ ] Define artifact ownership model.
- [ ] Define object storage path format.
- [ ] Add artifact upload from worker or harness.
- [ ] Add artifact download/view URL endpoint.
- [ ] Add artifact retention policy.
- [ ] Add chemistry artifact type mapping.

Verification:

- [ ] Snapshot restore smoke test passes.
- [ ] Snapshot save smoke test passes.
- [ ] Diff endpoint tests pass.
- [ ] Diff review UI tests pass.

### M. Billing, Quotas, And Usage Ledger

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
- [ ] Add usage dashboard.
- [ ] Add LLM usage breakdown.
- [ ] Add workflow usage breakdown.
- [ ] Add compute usage breakdown.
- [ ] Add quota remaining display.
- [ ] Add quota exceeded banner.
- [ ] Add admin usage reconciliation page or export endpoint.

Verification:

- [ ] Usage ledger tests pass.
- [x] Quota service tests pass.
- [ ] Usage UI tests pass.

### N. Deployment, Operations, And CI

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
- [ ] Store gateway admin credentials securely.
- [ ] Store harness admin credentials securely.
- [ ] Store AWS credentials securely.
- [ ] Define secret rotation procedure.
- [ ] Define emergency revoke procedure.
- [ ] Add control-plane structured logs.
- [ ] Add router structured logs.
- [ ] Add worker structured logs.
- [ ] Add usage import logs.
- [ ] Add sandbox lifecycle metrics.
- [ ] Add route-token issuance metrics.
- [ ] Add worker connection metrics.
- [ ] Add error dashboards.
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

Verification:

- [ ] Staging deploy succeeds.
- [ ] Staging browser-to-worker smoke test succeeds.
- [ ] Staging gateway usage import smoke test succeeds.
- [ ] Staging harness key injection smoke test succeeds.

## Work Item Completion Template

When finishing a checklist item, use this evidence pattern in the commit or PR
description:

- Task: the exact checklist item that changed from `[ ]` to `[x]`.
- Files: the code, migration, docs, or tests that implement it.
- Verification: the exact command or smoke test that passed.
- Residual risk: any known limitation that stays unchecked elsewhere.

Example:

```text
Task: Phase 3 / AWS Adapter / Implement worker environment injection
Files: apps/control-plane-api/src/adapters.ts, apps/control-plane-api/src/adapters.test.ts
Verification: pnpm --filter @remote-codex/control-plane-api test
Residual risk: live EKS start/stop smoke test remains unchecked
```

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

- [x] Add a top-level architecture decision log for major deployment decisions.
- [x] Add a `docs/status.md` or equivalent current-state summary before each
  larger phase handoff.
- [x] Keep obsolete docs removed from this branch.
- [x] Ensure docs describe the difference between local-dev mode, staging mode,
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
- [x] Choose the production phase-one auth provider.
- [x] Document required auth provider environment variables.
- [x] Document how auth subjects map to Remote Codex users.
- [ ] Add auth-provider-specific integration tests or smoke tests.
- [x] Add token issuer and audience checks for production mode.
- [x] Add clock-skew tolerance for provider JWT validation.
- [x] Add clear `401` and `403` error response shapes.

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
- [x] Add user deletion or deactivation policy.
- [x] Add user data export policy.
- [ ] Add user email verification state if the provider does not own it.
- [x] Add account bootstrap idempotency tests.

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
- [x] Add archive/delete semantics for projects.
- [x] Add archive/delete semantics for workspaces.
- [x] Add archive/delete semantics for sessions.
- [x] Add migration rollback notes or forward-only migration notes.

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
- [x] Add pagination for project lists.
- [x] Add pagination for workspace lists.
- [x] Add pagination for session lists.
- [x] Add search or filtering for product UI lists.

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
- [x] Add worker-to-control-plane session heartbeat or checkpoint call.
- [x] Add session close/finalize sync behavior.
- [x] Add tests that reject session sync for the wrong user or sandbox.

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
- [x] Add a sandbox lifecycle state machine document.
- [x] Add idempotency rules for start, stop, restart, and delete.

### Local Development Adapter

- [x] Implement local no-op sandbox adapter for tests.
- [x] Implement local worker-process sandbox adapter for development.
- [x] Add local adapter tests.
- [x] Document local sandbox development environment variables.
- [ ] Add a local smoke script that starts control plane plus local worker.
- [x] Add local route-token smoke test against the worker process.

### AWS Adapter

- [x] Choose phase-one runtime: EKS Fargate or ECS Fargate.
- [x] Document why that runtime was chosen.
- [x] Define the worker image repository.
- [x] Define the worker image tag format.
- [x] Define CPU, memory, and ephemeral storage profiles.
- [x] Define VPC, subnet, security group, and egress requirements.
- [x] Implement AWS adapter configuration loading.
- [x] Implement Pod/task creation.
- [x] Implement Pod/task stop.
- [x] Implement Pod/task status polling.
- [x] Implement worker endpoint discovery.
- [x] Implement worker environment injection.
- [x] Implement worker secret injection.
- [x] Add AWS adapter tests with mocked AWS clients.
- [x] Add namespace and label strategy for production multi-user isolation.
- [x] Add failure handling for AWS capacity errors.
- [x] Add failure handling for image pull errors.
- [x] Add failure handling for worker readiness timeout.

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
- [x] Add startup progress fields.
- [x] Add last failure code and last failure message.
- [ ] Add sandbox idle-timeout policy.
- [x] Add admin restart with reason audit event.

### Frontend Sandbox Surface

- [x] Add sandbox status indicator.
- [x] Add start sandbox action.
- [x] Add stop sandbox action.
- [x] Add restart sandbox action.
- [x] Add degraded/offline banner.
- [x] Add startup progress state.
- [x] Add failure reason display.
- [ ] Add admin sandbox view.

### Verification

- [x] Unit tests cover sandbox lifecycle transitions.
- [x] Local dev adapter can start a worker process.
- [x] Control-plane typecheck passes.
- [x] Web typecheck passes.
- [x] AWS adapter unit tests pass.
- [ ] Staging can start one sandbox from the control plane.
- [ ] Staging can stop one sandbox from the control plane.

## Phase 4: Worker Image And Runtime Hardening

Goal: the sandbox worker starts from a pinned image and fails closed when
required identity, filesystem, or token settings are missing.

### Worker Image

- [x] Keep `Dockerfile.worker` as the canonical worker image.
- [x] Pin the Node base image version.
- [x] Pin `@openai/codex`.
- [x] Pin `@anthropic-ai/claude-code`.
- [x] Pin `@anthropic-ai/claude-agent-sdk`.
- [x] Pin `opencode-ai`.
- [x] Pin `@opencode-ai/sdk`.
- [x] Add image labels for git SHA and image version.
- [x] Run the image as non-root `agent`.
- [x] Set `/workspace` as the default workspace root.
- [x] Set provider homes under `/home/agent`.
- [x] Ensure the worker listens on `0.0.0.0`.
- [x] Add a build-time version manifest for all provider runtimes.
- [x] Add a runtime endpoint that reports safe version metadata.

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
- [x] Validate gateway env when provider runtimes are enabled.
- [x] Validate ElAgenteHarness env when chemistry tools are enabled.
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
- [x] Add signed identity envelope verification.
- [x] Add scope checks for shell write.
- [x] Add scope checks for file write.
- [x] Add scope checks for provider turn creation.
- [x] Add scope checks for provider interrupt.
- [ ] Add scope checks for artifact read/write.
- [x] Add denial tests for every checked scope-protected route.

### Verification

- [x] `pnpm --filter @remote-codex/supervisor-api typecheck`
- [x] `pnpm --filter @remote-codex/config typecheck`
- [x] `pnpm --filter @remote-codex/supervisor-api test`
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
- [x] Check user quota before issuing route tokens.
- [x] Check account status before issuing route tokens.
- [ ] Include project, workspace, and session scopes when requested.
- [x] Reject route-token requests for archived sessions.

### Router Implementation

- [x] Decide whether the router package lives in this repository or a separate
  repository.
- [x] Add router package if it lives in this repository.
- [x] Implement HTTP proxy.
- [x] Implement SSE proxy.
- [x] Implement WebSocket proxy.
- [x] Verify route tokens.
- [x] Resolve sandbox endpoint from the control plane or sandbox registry.
- [x] Inject `X-Remote-Codex-Worker-Token`.
- [x] Strip browser-supplied internal worker headers.
- [x] Strip browser-supplied identity envelope headers.
- [x] Add request size limits.
- [x] Add idle timeouts.
- [x] Add rate limits.
- [x] Add structured proxy errors.
- [x] Add router health endpoint.
- [x] Add router audit logs.

### Frontend Worker Connection

- [x] Fetch a route token before opening a worker session.
- [x] Store route token only in memory.
- [x] Refresh route token before expiry.
- [ ] Reconnect WebSocket after token refresh.
- [ ] Show sandbox offline state.
- [x] Show route authorization failure state.
- [x] Show reconnecting state.
- [ ] Avoid persisting route tokens in local storage.

### Verification

- [x] Control-plane route-token tests pass.
- [x] Router unit tests pass.
- [x] Browser to router to worker local smoke test passes.
- [ ] Browser to router to worker staging smoke test passes.
- [ ] Worker is unreachable without router-injected token in staging.

## Phase 6: LLM Gateway Integration

Goal: Codex, Claude Code, and OpenCode use a gateway token inside the sandbox.
Real provider root keys stay outside the sandbox.

### Control-Plane Gateway Client

- [ ] Add gateway provider config table or config source.
- [x] Store gateway base URL.
- [x] Store gateway key id per user or sandbox.
- [ ] Store encrypted gateway token only if raw recovery is required.
- [x] Add gateway admin credential configuration.
- [x] Add gateway client interface.
- [x] Implement gateway user creation.
- [x] Implement gateway key creation.
- [x] Implement gateway key revocation.
- [x] Implement gateway key rotation.
- [x] Attach gateway credential to sandbox provisioning.
- [x] Add admin endpoint to reconcile gateway keys.
- [x] Add tests with mocked gateway client.

### Worker Provider Bootstrap

- [x] Render Codex config that points to the gateway `/v1` endpoint.
- [x] Ensure Codex config never contains a real provider root key.
- [x] Render Claude Code config that points to the gateway.
- [x] Ensure Claude Code config never contains a real provider root key.
- [x] Render OpenCode config that points to the gateway.
- [x] Ensure OpenCode config never contains a real provider root key.
- [x] Add startup check that gateway env is present when providers are enabled.
- [x] Add regression test for generated Codex config.
- [x] Add regression test for generated Claude config.
- [x] Add regression test for generated OpenCode config.
- [x] Redact gateway tokens from logs and API responses.

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

- [ ] Add LLM usage summary card.
- [ ] Add LLM usage detail table.
- [ ] Add gateway unavailable state.
- [ ] Add quota exceeded state.

### Verification

- [ ] Control-plane gateway tests pass.
- [ ] Worker gateway bootstrap tests pass.
- [x] Usage import tests pass.
- [ ] Frontend usage UI tests pass.

## Phase 7: ElAgenteHarness Integration

Goal: sandbox agents can call computational chemistry workflows through
ElAgenteHarness using scoped, revocable `INACT_X_APP_KEY` credentials.

### Control-Plane Harness Credentials

- [x] Add harness base URL config.
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

- [x] Inject `ELAGENTE_HARNESS_BASE_URL`.
- [x] Inject `INACT_X_APP_KEY`.
- [x] Validate harness env in worker mode when chemistry tools are enabled.
- [ ] Redact harness key from logs.
- [x] Add worker metadata that reports harness integration status without the
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
- [x] Harness bootstrap tests pass.
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
- [x] Add quota check service.
- [x] Add LLM spend quota.
- [ ] Add compute spend quota.
- [ ] Add storage quota.
- [ ] Add sandbox runtime quota.
- [x] Add quota preflight before route-token issuance.
- [ ] Add quota preflight before harness job creation when visible to Remote
  Codex.
- [x] Add quota exceeded API response shape.

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
- [x] Quota service tests pass.
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
