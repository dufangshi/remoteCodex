# Remote Codex Implementation Checklist

This document tracks the work that belongs in the `remoteCodex` repository for
the Agente product architecture.

Related systems have their own implementation plans:

- ElAgenteHarness owns chemistry workflows, task state, job orchestration, and
  compute artifact metadata.
- The LLM gateway owns real provider keys, request forwarding, key management,
  model limits, and raw model usage records.
- Modal, AWS Batch, ECS, EKS, or HPC workers own heavy compute execution.

Remote Codex must integrate with those systems through stable contracts, but it
should not absorb their internal responsibilities.

## Progress Legend

- `[ ]` Not started.
- `[x]` Complete.
- Keep each item small enough that a future commit can clearly mark it done.
- Prefer adding the commit hash or PR link next to checked items when work is
  completed.

## Phase 0: Current Branch Baseline

Goal: keep this branch as the control-plane and sandbox-worker foundation.

- [x] Create `sandbox-worker-control-plane` branch.
- [x] Add initial control-plane API package.
- [x] Add initial control-plane DB migration.
- [x] Add worker runtime role to shared config.
- [x] Add worker entrypoint for `supervisor-api`.
- [x] Add worker gateway bootstrap for Codex, Claude Code, and OpenCode.
- [x] Add worker auth token guard for worker-mode APIs.
- [x] Disable local-supervisor management APIs in worker mode.
- [x] Add `Dockerfile.worker`.
- [x] Add worker image build script.
- [x] Document control-plane to sandbox-worker architecture.
- [x] Document Agente product architecture.
- [x] Commit and push the architecture docs update.

Acceptance criteria:

- [x] `docs/README.md` links to all architecture and checklist docs.
- [x] `docs/agente-product-architecture.md` describes the full product shape.
- [x] `docs/control-plane-sandbox-worker.md` describes the worker/control-plane
  implementation shape.
- [x] `docs/remote-codex-implementation-checklist.md` is maintained as the
  working task tracker.

## Phase 1: Product Auth And User Management

Goal: users can register, log in, and access a product account in the control
plane. Browser identity must stay outside sandbox service credentials.

### Control Plane Backend

- [ ] Choose production auth provider for phase one.
- [x] Document the chosen auth provider and local-dev auth behavior.
- [x] Add production auth verifier interface.
- [x] Implement production auth verifier.
- [x] Keep `dev:<subject>` auth verifier available for local development.
- [x] Add tests for production verifier failure paths.
- [x] Add tests for local dev auth success paths.
- [x] Add user account status field.
- [x] Add user billing identity field.
- [x] Add user display name field if missing.
- [x] Add user created/updated timestamp fields if missing.
- [x] Add migration for user account status and billing identity.
- [x] Add `GET /api/me` response fields for account status and billing identity.
- [x] Add `PATCH /api/me` for user-editable profile fields.
- [x] Add admin-only user list endpoint filters.
- [x] Add admin-only user status update endpoint.
- [x] Add admin-only user quota profile update endpoint.
- [x] Add audit events for admin user updates.

### Frontend

- [ ] Add login page.
- [ ] Add register/signup entry.
- [ ] Add logout action.
- [ ] Add authenticated app shell guard.
- [ ] Add loading state while product auth is resolving.
- [ ] Add unauthorized state for expired or invalid sessions.
- [ ] Add account/profile page.
- [ ] Add admin user management page or admin-only minimal table.
- [x] Ensure frontend never sends product user JWT directly to worker APIs.

### Verification

- [x] `pnpm --filter @remote-codex/control-plane-api typecheck`
- [x] `pnpm --filter @remote-codex/control-plane-api test`
- [x] `pnpm --filter @remote-codex/supervisor-web typecheck`
- [ ] Add auth e2e smoke test for login to app shell.

## Phase 2: Project, Workspace, And Session Registry

Goal: the control plane owns durable product metadata while each worker owns
live runtime state.

### Schema And API

- [x] Finalize project schema.
- [x] Finalize workspace schema.
- [x] Finalize session index schema.
- [x] Define one-user-to-one-sandbox invariant for phase one.
- [x] Add migration for missing project fields.
- [x] Add migration for missing workspace fields.
- [x] Add migration for missing session fields.
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
- [x] Add ownership checks for all project/workspace/session endpoints.
- [x] Add tests for cross-user access denial.

### Frontend

- [ ] Add projects list page.
- [ ] Add project creation flow.
- [ ] Add project detail route.
- [ ] Add workspaces list inside a project.
- [ ] Add workspace creation flow.
- [ ] Add sessions list inside a workspace.
- [ ] Add session creation flow.
- [ ] Add empty states for no projects, no workspaces, and no sessions.
- [ ] Add clear loading and error states.

### Worker Contract

- [x] Define how a control-plane session maps to a worker thread/session.
- [x] Define session metadata sync from worker to control plane.
- [x] Add worker metadata endpoint fields needed by session registry.
- [x] Add explicit control-plane session checkpoint endpoint.

### Verification

- [x] Control-plane API tests cover CRUD and ownership.
- [x] Web typecheck passes.
- [ ] Add frontend tests for project/workspace/session navigation.

## Phase 3: Sandbox Lifecycle

Goal: the control plane can create, start, stop, and observe one sandbox per
user.

### Sandbox Manager Interface

- [x] Define `SandboxManager` interface.
- [x] Add `createSandbox` method.
- [x] Add `startSandbox` method.
- [x] Add `stopSandbox` method.
- [x] Add `restartSandbox` method.
- [x] Add `deleteSandbox` method.
- [x] Add `getSandboxStatus` method.
- [x] Add `getSandboxEndpoint` method.
- [x] Add `prepareSandboxEnvironment` method.
- [x] Add structured errors for quota, capacity, config, and provider failures.

### Local/Dev Adapter

- [x] Implement local no-op sandbox adapter for tests.
- [x] Implement local worker-process adapter for development.
- [x] Add local adapter tests.
- [ ] Document local sandbox development environment variables.

### AWS Adapter

- [ ] Choose phase-one runtime: EKS Fargate or ECS Fargate.
- [ ] Document why that runtime is chosen.
- [ ] Define sandbox image repository and tag format.
- [ ] Define CPU/memory/storage resource profiles.
- [ ] Define VPC/subnet/security group requirements.
- [ ] Implement AWS adapter configuration loading.
- [ ] Implement sandbox Pod/task creation.
- [ ] Implement sandbox Pod/task stop.
- [ ] Implement sandbox status polling.
- [ ] Implement sandbox endpoint discovery.
- [ ] Implement worker secret injection.
- [ ] Implement worker environment injection.
- [ ] Add AWS adapter tests with mocked AWS clients.

### Control Plane API

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

### Frontend

- [ ] Add sandbox status indicator.
- [ ] Add start sandbox action.
- [ ] Add stop sandbox action.
- [ ] Add restart sandbox action.
- [ ] Add degraded/offline banner.
- [ ] Add sandbox startup progress state.

### Verification

- [x] Unit tests cover sandbox lifecycle transitions.
- [x] Local dev adapter can start a worker process.
- [x] Control-plane typecheck passes.
- [x] Web typecheck passes.

## Phase 4: Worker Image And Runtime Hardening

Goal: the worker image is reproducible, pinned, non-root, and ready for
container deployment.

### Image

- [x] Keep `Dockerfile.worker` as the canonical worker image.
- [x] Pin Node base image version.
- [ ] Pin `@openai/codex` version.
- [ ] Pin `@anthropic-ai/claude-code` version.
- [ ] Pin `@anthropic-ai/claude-agent-sdk` version.
- [ ] Pin `opencode-ai` version.
- [ ] Pin `@opencode-ai/sdk` version.
- [x] Add labels for git SHA and image version.
- [x] Ensure image runs as non-root `agent`.
- [x] Ensure default workdir is `/workspace`.
- [x] Ensure provider homes are under `/home/agent`.
- [x] Ensure worker listens on `0.0.0.0`.
- [x] Ensure `/readyz` works without auth.
- [x] Ensure all non-health APIs require token when configured.

### Worker Startup

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

### CI

- [ ] Add CI job for `pnpm build:worker-image`.
- [ ] Add CI smoke test for `/readyz`.
- [ ] Add CI smoke test for unauthorized worker metadata access.
- [ ] Add CI smoke test for authorized worker metadata access.
- [ ] Push image to registry from main branch.
- [ ] Push image to registry from release tags.

### Verification

- [x] `pnpm --filter @remote-codex/supervisor-api typecheck`
- [x] `pnpm --filter @remote-codex/config typecheck`
- [ ] `docker build -f Dockerfile.worker -t remote-codex-worker:verify .`
- [ ] Run container locally and verify `/readyz`.
- [ ] Verify worker rejects requests without token.

## Phase 5: Sandbox Router And Worker Proxy

Goal: browser traffic reaches workers only through a route-token checked proxy.

### Route Token Contract

- [x] Define route token payload schema.
- [x] Include user id.
- [x] Include sandbox id.
- [x] Include scopes.
- [x] Include expiry.
- [x] Include nonce or token id.
- [x] Sign route tokens with control-plane secret.
- [ ] Add key rotation strategy for route-token signing.
- [x] Add tests for expired route token.
- [x] Add tests for wrong sandbox route token.
- [x] Add tests for tampered route token.

### Control Plane API

- [x] Add or harden `POST /api/sandboxes/:sandboxId/route-token`.
- [x] Check user owns sandbox before issuing route token.
- [x] Check sandbox is running before issuing route token.
- [ ] Check quota before issuing route token.
- [x] Return `routerBaseUrl`.
- [x] Return `wsBaseUrl`.
- [x] Return `expiresAt`.
- [x] Audit route-token issuance.

### Router

- [ ] Decide router location in this repo or separate service.
- [ ] Add router package if kept in this repo.
- [ ] Implement HTTP proxy.
- [ ] Implement WebSocket proxy.
- [ ] Implement route token verification.
- [ ] Resolve sandbox endpoint from control plane or registry.
- [ ] Inject `X-Remote-Codex-Worker-Token`.
- [ ] Strip browser-supplied internal worker headers.
- [ ] Add request size limits.
- [ ] Add idle timeout.
- [ ] Add basic rate limit.
- [ ] Add structured proxy errors.
- [ ] Add router health endpoint.

### Frontend

- [ ] Fetch route token before connecting to a worker.
- [ ] Store route token only in memory.
- [ ] Refresh route token before expiry.
- [ ] Reconnect WebSocket after token refresh.
- [ ] Show sandbox offline state.
- [ ] Show route authorization failure state.

### Verification

- [ ] Router unit tests pass.
- [x] Control-plane route-token tests pass.
- [ ] Browser to router to worker smoke test passes.
- [ ] Worker is not reachable without router token in staging.

## Phase 6: Worker Authorization And Policy

Goal: worker APIs enforce sandbox-local authorization even if traffic reaches
the worker endpoint.

- [x] Keep `/healthz` public.
- [x] Keep `/readyz` public.
- [x] Require `REMOTE_CODEX_WORKER_AUTH_TOKEN` in production worker mode.
- [x] Reject missing worker token.
- [x] Reject incorrect worker token.
- [x] Support `Authorization: Bearer <token>` for internal calls if needed.
- [x] Support `X-Remote-Codex-Worker-Token`.
- [x] Strip or ignore browser-supplied user identity headers.
- [ ] Add optional signed identity envelope schema.
- [ ] Verify signed identity envelope expiry.
- [ ] Verify signed identity envelope sandbox id.
- [ ] Verify signed identity envelope scopes.
- [ ] Add scope checks for shell write.
- [ ] Add scope checks for file write.
- [ ] Add scope checks for provider turn creation.
- [ ] Add scope checks for provider interrupt.
- [ ] Add scope checks for artifact read/write.
- [x] Keep provider host config read disabled in worker mode.
- [x] Keep provider host config write disabled in worker mode.
- [x] Keep build restart disabled in worker mode.
- [x] Keep runtime install/update disabled in worker mode.
- [x] Redact worker token from logs.
- [x] Redact gateway token from logs.
- [ ] Redact harness key from logs.

Verification:

- [x] Add worker auth tests.
- [x] Add disabled-management-route tests.
- [ ] Add scope-denial tests.
- [ ] `pnpm --filter @remote-codex/supervisor-api test`

## Phase 7: LLM Gateway Integration

Goal: Codex, Claude Code, and OpenCode inside the sandbox use the gateway, while
real provider keys stay outside the sandbox.

### Control Plane

- [ ] Add gateway provider config table or config source.
- [ ] Store gateway base URL.
- [ ] Store gateway key id per user or sandbox.
- [ ] Store encrypted gateway token only if needed.
- [ ] Add gateway admin credential config.
- [ ] Add gateway client interface.
- [ ] Implement gateway user creation.
- [ ] Implement gateway key creation.
- [ ] Implement gateway key revocation.
- [ ] Implement gateway key rotation.
- [ ] Attach gateway credential to sandbox provisioning.
- [ ] Add admin endpoint to reconcile gateway keys.
- [ ] Add tests with mocked gateway client.

### Worker Bootstrap

- [ ] Confirm Codex gateway config uses gateway `/v1`.
- [ ] Confirm Codex config does not write real provider key.
- [ ] Confirm Claude Code config uses gateway base URL.
- [ ] Confirm Claude Code config does not write real provider key.
- [ ] Confirm OpenCode config uses gateway provider.
- [ ] Confirm OpenCode config does not write real provider key.
- [ ] Add startup check that gateway env is present when providers are enabled.
- [ ] Add regression test for generated Codex config.
- [ ] Add regression test for generated Claude config.
- [ ] Add regression test for generated OpenCode config.

### Usage Import

- [ ] Define normalized LLM usage event schema.
- [ ] Add usage import adapter for sub2api or chosen gateway.
- [ ] Add scheduled import job.
- [ ] Add manual admin import endpoint.
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

Verification:

- [ ] Control-plane gateway tests pass.
- [ ] Worker gateway bootstrap tests pass.
- [ ] Usage import tests pass.
- [ ] Frontend typecheck passes.

## Phase 8: ElAgenteHarness Integration

Goal: sandbox agents can discover and call computational chemistry workflows
through ElAgenteHarness using scoped app keys.

### Control Plane Credentials

- [ ] Add harness base URL config.
- [ ] Add harness admin credential config if needed.
- [ ] Add harness credential table.
- [ ] Store only key hash when raw key does not need to be recovered.
- [ ] Store encrypted key when sandbox reinjection requires raw key.
- [ ] Generate `INACT_X_APP_KEY` during user provisioning or sandbox creation.
- [ ] Bind harness key to user id.
- [ ] Bind harness key to sandbox id.
- [ ] Bind harness key to scopes.
- [ ] Bind harness key to quota profile.
- [ ] Add key rotation endpoint.
- [ ] Add key revocation endpoint.
- [ ] Add tests for key generation and ownership.

### Worker Environment

- [ ] Inject `ELAGENTE_HARNESS_BASE_URL`.
- [ ] Inject `INACT_X_APP_KEY`.
- [ ] Validate harness env in worker mode when chemistry tools are enabled.
- [ ] Redact harness key from logs.
- [ ] Add worker metadata that reports harness integration status without key.

### Worker Tool Bootstrap

- [ ] Decide tool surface: MCP server, shell wrapper, provider config, or all.
- [ ] Add ElAgenteHarness MCP config renderer.
- [ ] Add ElAgenteHarness tool wrapper config renderer.
- [ ] Add Codex config integration for harness tools.
- [ ] Add Claude Code config integration for harness tools.
- [ ] Add OpenCode config integration for harness tools.
- [ ] Add tests for harness config rendering.
- [ ] Add docs for required ElAgenteHarness environment variables.

### Product API And UI

- [ ] Add workflow catalog endpoint in control plane or worker proxy.
- [ ] Add task list endpoint or integration.
- [ ] Add task detail endpoint or integration.
- [ ] Add artifact metadata endpoint or integration.
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
- [ ] Map harness usage to sandbox id and task id.
- [ ] Store workflow id, job id, units, cost estimate, and cost actual.
- [ ] Add task/job usage to billing summary.

Verification:

- [ ] Harness credential tests pass.
- [ ] Harness bootstrap tests pass.
- [ ] Harness usage import tests pass.
- [ ] Frontend workflow/task UI tests pass.

## Phase 9: Workspace Persistence And Snapshots

Goal: user workspaces survive sandbox restarts and have controlled write-back.

### Persistence Decision

- [ ] Decide phase-one persistence backend.
- [ ] Document EFS option tradeoffs.
- [ ] Document S3 snapshot option tradeoffs.
- [ ] Document temporary workspace limitations if chosen for MVP.
- [ ] Define maximum workspace size for phase one.
- [ ] Define maximum artifact size for phase one.

### Snapshot Lifecycle

- [ ] Add snapshot metadata table.
- [ ] Add snapshot restore hook before worker ready.
- [ ] Add snapshot save hook before sandbox stop.
- [ ] Add manual snapshot endpoint.
- [ ] Add snapshot status endpoint.
- [ ] Add snapshot failure handling.
- [ ] Add snapshot retry policy.
- [ ] Add snapshot retention policy.

### Workspace Diff

- [ ] Initialize baseline in `/workspace`.
- [ ] Preserve git metadata when workspace source is a git repo.
- [ ] Create synthetic baseline commit when source is not a git repo.
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

Verification:

- [ ] Snapshot restore smoke test.
- [ ] Snapshot save smoke test.
- [ ] Diff endpoint tests.
- [ ] Diff review UI tests.

## Phase 10: MCP And Tool Policy

Goal: MCP and tool execution stay inside the sandbox and are auditable.

- [ ] Define approved MCP server registry.
- [ ] Define stdio MCP launch policy.
- [ ] Define remote MCP allowlist policy.
- [ ] Render Codex MCP config in sandbox provider home.
- [ ] Render Claude MCP config in sandbox provider home.
- [ ] Render OpenCode MCP config in sandbox provider home.
- [ ] Ensure stdio MCP servers run with cwd inside `/workspace`.
- [ ] Ensure stdio MCP servers inherit only approved env vars.
- [ ] Block host-local filesystem MCP servers by default.
- [ ] Block host-local Docker MCP servers by default.
- [ ] Block host-local database MCP servers by default.
- [ ] Add MCP startup audit events.
- [ ] Add MCP tool-call audit events.
- [ ] Add MCP failure timeline items where useful.
- [ ] Add ElAgenteHarness tools to approved MCP/tool registry.
- [ ] Add UI for MCP status and failures.

Verification:

- [ ] MCP config rendering tests pass.
- [ ] MCP startup audit tests pass.
- [ ] Worker typecheck passes.

## Phase 11: Billing, Quotas, And Usage Ledger

Goal: all paid resources are normalized into the control-plane ledger.

### Ledger

- [ ] Finalize usage ledger schema.
- [ ] Add event source enum for `llm`.
- [ ] Add event source enum for `harness`.
- [ ] Add event source enum for `compute`.
- [ ] Add event source enum for `storage`.
- [ ] Add dedupe key.
- [ ] Add user id.
- [ ] Add sandbox id.
- [ ] Add project id if available.
- [ ] Add session id if available.
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
- [ ] Add quota preflight before harness job creation when visible to control
  plane.
- [ ] Add quota exceeded API response shape.

### UI

- [ ] Add usage dashboard.
- [ ] Add LLM usage breakdown.
- [ ] Add workflow usage breakdown.
- [ ] Add compute usage breakdown.
- [ ] Add quota remaining display.
- [ ] Add quota exceeded banner.
- [ ] Add admin usage reconciliation page or export endpoint.

Verification:

- [ ] Usage ledger tests pass.
- [ ] Quota service tests pass.
- [ ] Usage UI typecheck passes.

## Phase 12: Frontend Product Surface

Goal: the web app feels like a product, not a local supervisor panel.

- [ ] Add product-aware app shell.
- [ ] Add login/register routes.
- [ ] Add account route.
- [ ] Add project route.
- [ ] Add workspace route.
- [ ] Add session route.
- [ ] Add sandbox status surface.
- [ ] Add route-token reconnect handling.
- [ ] Add disconnected worker state.
- [ ] Add worker starting state.
- [ ] Add worker failed state.
- [ ] Add gateway missing state.
- [ ] Add harness missing state.
- [ ] Add quota exceeded state.
- [ ] Add chemistry workflow catalog page or panel.
- [ ] Add chemistry task status page or panel.
- [ ] Add artifact viewer entry points.
- [ ] Add billing/usage route.
- [ ] Add admin route guard.
- [ ] Add admin user view.
- [ ] Add admin sandbox view.

Verification:

- [ ] `pnpm --filter @remote-codex/supervisor-web typecheck`
- [ ] Frontend unit tests pass.
- [ ] Key e2e flows pass locally.

## Phase 13: Deployment And Operations

Goal: the product can be deployed in repeatable dev, staging, and production
environments.

### Railway

- [ ] Add Railway service definition for frontend.
- [ ] Add Railway service definition for control-plane API.
- [ ] Add Railway Postgres configuration.
- [ ] Add required control-plane environment variables.
- [ ] Add required frontend environment variables.
- [ ] Add migration command for deploy.
- [ ] Add health checks.

### AWS

- [ ] Add AWS account/environment naming convention.
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

Verification:

- [ ] Staging deploy succeeds.
- [ ] Staging browser to worker smoke test succeeds.
- [ ] Staging usage import smoke test succeeds.
- [ ] Staging harness key injection smoke test succeeds.

## Phase 14: Test Matrix And CI

Goal: regressions are caught before deployment.

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

## Suggested Execution Order

Use this order unless a blocking dependency forces a different split.

- [ ] 1. Commit the current architecture docs.
- [ ] 2. Harden product auth and user management.
- [ ] 3. Finish project/workspace/session registry.
- [ ] 4. Harden worker image and startup validation.
- [ ] 5. Implement sandbox manager interface and local adapter.
- [ ] 6. Implement sandbox router and route-token proxy path.
- [ ] 7. Implement AWS sandbox adapter for one user to one worker.
- [ ] 8. Implement LLM gateway key provisioning and usage import.
- [ ] 9. Implement ElAgenteHarness key injection and tool bootstrap.
- [ ] 10. Implement workflow/task/artifact UI.
- [ ] 11. Implement workspace persistence and snapshots.
- [ ] 12. Implement quotas and billing summaries.
- [ ] 13. Add full browser-to-worker CI smoke tests.
- [ ] 14. Prepare staging deployment.

## Definition Of Done For Phase One

The first product phase is complete when all of these are checked:

- [ ] A new user can register and log in.
- [ ] The user gets exactly one sandbox.
- [ ] The sandbox starts from a pinned worker image.
- [ ] The browser connects to the worker through route-token proxying.
- [ ] The worker can run Codex through the gateway.
- [ ] The worker can run Claude Code through the gateway.
- [ ] The worker can run OpenCode through the gateway.
- [ ] Real provider keys never enter the sandbox.
- [ ] The worker receives `INACT_X_APP_KEY`.
- [ ] The worker can call ElAgenteHarness with the injected key.
- [ ] The user can see workflow/task status in the frontend.
- [ ] The control plane imports LLM usage.
- [ ] The control plane imports or receives harness/compute usage.
- [ ] The user can see a usage summary.
- [ ] Basic quota enforcement exists.
- [ ] The worker image can be built in CI.
- [ ] Staging can run browser to worker to gateway to harness smoke tests.
