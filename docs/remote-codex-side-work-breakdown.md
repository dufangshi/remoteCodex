# Remote Codex Side Work Breakdown And Checklist

This document is the detailed one-step-at-a-time checklist for the work that
must happen inside the `remoteCodex` repository to support the Agente
sandbox-worker product architecture.

Use this as the day-to-day implementation board for future work. A developer
should be able to pick the first unchecked item in a milestone, implement it,
run the named verification, update the checkbox, and commit that small slice.

This document is focused on Remote Codex deliverables only. Historical phase
status and evidence are still tracked in
`docs/remote-codex-side-execution-checklist.md` and `docs/status.md`; when a
task is completed here, update those files if the task changes release status
or phase evidence.

## Scope

Remote Codex owns:

- Railway-facing frontend and product app shell.
- Railway-facing control-plane API.
- Product users, projects, workspaces, sessions, sandbox registry, quotas,
  usage, billing summaries, and audit records.
- Phase-one one-user-to-one-sandbox lifecycle orchestration.
- Sandbox route-token issuance and sandbox-router integration.
- Worker-mode supervisor API that runs inside each sandbox.
- Worker image bootstrap for Codex, Claude Code, OpenCode, MCP,
  ElAgenteHarness, and LLM gateway credentials.
- Integration contracts and clients for the LLM gateway, ElAgenteHarness, AWS
  sandbox runtime, object storage, and compute job pools.

Remote Codex does not own:

- Real provider root-key storage when the LLM gateway owns provider keys.
- LLM gateway model-routing internals.
- ElAgenteHarness workflow execution internals.
- Modal, AWS Batch, Slurm, ORCA, or other heavy-compute worker internals.
- Untrusted command execution outside sandbox workers.

## Completion Rules

- Check a box only when the code, tests, smoke check, deployment wiring, or
  deliberately scoped documentation deliverable exists on this branch.
- Do not check staging, production, CI-pass, or AWS-live tasks until the named
  environment or CI job has actually run and passed.
- For every checked group, add a short evidence note in the relevant status,
  release, or checklist doc.
- Prefer one commit per coherent group of checked items.
- If the implementation proves a task should be split, split it before checking
  the original task.
- If a task is intentionally deferred, leave it unchecked and add the deferral
  reason to `docs/status.md`.
- Keep raw provider keys, gateway tokens, harness keys, product JWTs, and worker
  internal tokens out of logs, browser storage, API responses, and task output.

Evidence format:

```text
Evidence:
- Files: <main files>
- Verification: <commands, smoke checks, or deployment checks>
- Residual risk: <remaining unchecked edge>
```

## Checkbox Workflow

For every implementation slice:

1. Pick one unchecked task or a tightly related group of unchecked tasks.
2. Confirm whether it is local, CI, staging, production, or external-service
   work.
3. Implement only the Remote Codex side of that slice.
4. Add or update tests, smoke scripts, deployment wiring, or docs required by
   the task.
5. Run the verification named under the task.
6. Check the box only if verification passes.
7. Add an evidence note when the completion affects a phase or release gate.
8. Update `docs/status.md` when the next implementation focus or residual risk
   changes materially.
9. Commit the checked slice with a message that names the completed task.

Task types:

- Local code: check after tests/typechecks pass in this repository.
- CI: check after the workflow exists and a CI run has passed.
- Staging: check after the staging smoke has actually run.
- Production: check after production deployment or production smoke evidence
  exists.
- External integration: check only after the Remote Codex contract, client,
  fixture, mock, or deployment wiring exists here.

## Current Priority Queue

This queue is the recommended order for the next small commits. The detailed
milestone sections below remain the full backlog.

- [x] Add worker Docker CI workflow.
  - Done when CI builds `Dockerfile.worker` on branch or PR push.
  - Verify with workflow config review; passing CI run is tracked separately.

- [x] Add CI worker `/readyz` smoke.
  - Done when CI starts the built worker image and verifies readiness.
  - Verify with CI logs showing `/readyz` success.

- [x] Add CI worker auth denial smoke.
  - Done when CI proves non-health worker routes reject requests without the
    internal worker token.
  - Verify with CI logs showing the expected `401` or `403`.

- [x] Add CI worker auth success smoke.
  - Done when CI proves worker metadata is reachable with the internal worker
    token.
  - Verify with CI logs showing successful metadata response.

- [ ] Add local worker checkpoint-to-control-plane smoke.
  - Done when a worker-mode supervisor sends a checkpoint and the control-plane
    session record changes.
  - Verify with documented command output or automated smoke.

- [ ] Add selected production auth-provider smoke.
  - Done when staging-like config validates a real provider-issued token and
    rejects expired, wrong-issuer, and wrong-audience tokens.
  - Verify with an integration smoke or documented staging run.

- [ ] Run staging sandbox lifecycle smoke.
  - Done when start, stop, restart, readiness, and idempotency have been tested
    against a real sandbox runtime.
  - Verify with Pod name, sandbox id, final registry state, and `/readyz`.

- [ ] Run staging browser-to-router-to-worker smoke.
  - Done when a real browser reaches a real worker through the router using a
    route token.
  - Verify with route-token issue, router connection, and worker response.

- [ ] Run staging Codex, Claude Code, and OpenCode gateway smokes.
  - Done when each provider runtime makes one model request through the gateway
    and no provider root key exists inside the worker.
  - Verify with staging smoke records for each runtime.

## Target Runtime Shape

```text
Browser
  -> Railway Frontend
  -> Railway Control Plane API
     - auth
     - users/projects/workspaces/sessions
     - quotas/billing/usage
     - sandbox registry
     - route-token issuance
     - gateway credential mapping
     - harness credential mapping

Browser
  -> Sandbox Router
     - validates short-lived route token
     - resolves sandbox endpoint
     - injects worker token
     - injects signed identity envelope
     - proxies HTTP, SSE, and WebSocket

Control Plane API
  -> AWS Sandbox Manager
     - creates/stops EKS Fargate Pods
     - injects worker env and secrets
     - tracks status, endpoint, image, resource profile, and failures
     - snapshots workspace when persistence is enabled

AWS EKS Fargate
  -> one active sandbox = one Pod = one container
     - remote-codex supervisor-api in worker mode
     - Codex / Claude Code / OpenCode
     - /workspace
     - approved MCP/tool configs
     - ElAgenteHarness client config
     - gateway-scoped model credentials

Worker
  -> LLM Gateway
     - gateway-scoped token only
     - no real provider root keys inside sandbox

Worker
  -> ElAgenteHarness
     - INACT_X_APP_KEY
     - workflow catalog/task/job/artifact APIs

ElAgenteHarness
  -> Compute Job Pool
     - Modal/AWS Batch/ECS/EKS/HPC workers
```

## Milestone 1: Product Auth And Account Boundary

Goal: users can enter the product safely, and product identity never becomes a
worker credential.

### Frontend App Shell

- [x] Add a dedicated login route.
  - Done when unauthenticated users have a stable route that starts the chosen
    auth-provider flow.
  - Verify with frontend tests for anonymous render and redirect/action.

- [x] Add an authenticated app-shell guard.
  - Done when protected product routes do not render user, project, sandbox, or
    usage data before auth resolves.
  - Verify with tests for unauthenticated, pending, and authenticated states.

- [x] Add auth loading state.
  - Done when the app shows a non-destructive loading state while the product
    auth session is being resolved.
  - Verify with frontend test coverage.

- [ ] Add expired-session state.
  - Done when expired or invalid auth prompts re-login without silently losing
    the intended destination.
  - Verify with frontend tests for expired token responses.

- [ ] Add disabled-account state.
  - Done when disabled users see an account-blocked state and cannot open
    sandbox sessions.
  - Verify with frontend tests for disabled-account API responses.

- [ ] Add admin user management UI.
  - Done when admins can list users, update account status, and update quota
    profile from the product UI.
  - Verify with frontend tests for admin success and non-admin denial.

### Auth Provider Integration

- [ ] Add production auth-provider smoke procedure.
  - Done when staging-like config can validate a real provider-issued token.
  - Verify success, expired token, wrong issuer, and wrong audience.

- [ ] Add local or staging login-to-shell smoke.
  - Done when a browser can complete login and reach the authenticated shell.
  - Verify with an e2e or documented staging smoke artifact.

- [ ] Add staging proof that product JWTs do not reach workers.
  - Done when worker logs or a diagnostic endpoint prove browser
    `Authorization` headers are stripped before worker traffic.
  - Verify with direct staging smoke output.

## Milestone 2: Product Metadata And Session Open Flow

Goal: users can create product metadata in the control plane, then open a real
worker session through the router.

### Session Opening

- [x] Add open-session action in the project/workspace/session UI.
  - Done when selecting a session requests a route token scoped to user,
    sandbox, project, workspace, and session.
  - Verify with frontend tests that include the selected project/workspace/
    session ids.

- [x] Connect the browser to the sandbox router after route-token issue.
  - Done when the UI opens a live worker connection without exposing the worker
    endpoint or internal worker token.
  - Verify with local e2e or integration smoke.

- [ ] Keep route tokens in memory only.
  - Done when route tokens are never written to localStorage, sessionStorage,
    IndexedDB, URL query params, or logs.
  - Verify with frontend tests and code review around token handling.

- [x] Add worker connection lifecycle UI.
  - Done when the UI distinguishes connecting, connected, reconnecting,
    offline, expired token, and unauthorized states.
  - Verify with frontend tests for each state.

- [x] Add WebSocket/SSE reconnect after token refresh.
  - Done when long-running sessions refresh route tokens and reconnect without a
    full app reload.
  - Verify with frontend or e2e test that simulates token expiry.

### Session Synchronization

- [ ] Add local smoke proving worker checkpoint reaches the control plane.
  - Done when a worker-mode supervisor sends a checkpoint to the control plane
    and the durable session record changes.
  - Verify with documented command output or e2e smoke.

- [ ] Add user-facing session close/finalize flow.
  - Done when closing a session asks the worker to finalize state and updates
    control-plane session status.
  - Verify with API and frontend tests.

- [ ] Add session resume flow.
  - Done when opening an existing session restores enough worker-local context
    to continue work or clearly reports that the worker state is unavailable.
  - Verify with local smoke covering restart/resume behavior.

## Milestone 3: Sandbox Lifecycle And AWS Runtime

Goal: the control plane can reliably run one sandbox per user on EKS Fargate.

### AWS Runtime Wiring

- [ ] Finalize staging AWS account and cluster configuration.
  - Done when EKS cluster, Fargate profile, namespace, subnets, security groups,
    IAM roles, and image registry are named in staging config.
  - Verify with deployment config review and AWS access smoke.

- [ ] Add sandbox manager deployment credentials.
  - Done when the control plane can call the Kubernetes API through
    least-privilege credentials without embedding long-lived secrets in code.
  - Verify with config validation and staging smoke.

- [ ] Create one real EKS Fargate worker Pod from the control plane.
  - Done when the control plane starts a Pod from the configured immutable image
    tag for one user sandbox.
  - Verify with staging smoke recording sandbox id, Pod name, image, and
    `/readyz`.

- [ ] Stop one real EKS Fargate worker Pod from the control plane.
  - Done when stop moves the registry to stopped and the Pod terminates.
  - Verify with staging smoke recording Pod deletion/termination.

- [ ] Add idempotent lifecycle smoke.
  - Done when repeated start, stop, and restart calls do not corrupt sandbox
    registry state.
  - Verify with staging smoke logs and final registry state.

- [ ] Add capacity preflight for hundreds of users.
  - Done when startup rejects or degrades predictably if AWS Fargate quota,
    subnet IP capacity, or image-pull capacity is insufficient.
  - Verify with tests for capacity error mapping and staging readiness notes.

### Sandbox Operations

- [ ] Add sandbox idle warning.
  - Done when users see a warning before idle timeout stops a sandbox.
  - Verify with frontend tests for warning and cancellation behavior.

- [ ] Add sandbox idle stop execution.
  - Done when idle sandboxes are stopped according to policy and optional
    snapshot behavior.
  - Verify with reaper/job tests and local smoke.

- [ ] Add admin force-stop audit trail.
  - Done when admin force-stop records who stopped which sandbox and why.
  - Verify with API tests and audit record assertions.

- [ ] Add sandbox runtime event log.
  - Done when lifecycle transitions, readiness failures, image-pull failures,
    and capacity failures can be inspected without exposing secrets.
  - Verify with repository/API tests.

## Milestone 4: Worker Image And Runtime Guardrails

Goal: each sandbox starts from a reproducible image and fails closed if runtime
configuration is unsafe.

### Image Build And Smoke

- [x] Build the worker image locally from a clean checkout.
  - Done when `Dockerfile.worker` builds without relying on local dirty files.
  - Verify with `docker build -f Dockerfile.worker -t remote-codex-worker:verify .`.

- [x] Run the worker image locally and verify `/readyz`.
  - Done when the built image starts in worker mode with minimal required env
    and returns healthy readiness.
  - Verify with local container smoke output.

- [x] Add CI worker image build.
  - Done when CI builds the worker image on PR or branch push.
  - Verify with passing CI job.

- [x] Add CI worker readiness smoke.
  - Done when CI starts the image and verifies `/readyz`.
  - Verify with passing CI logs.

- [ ] Pin installed agent/runtime dependency versions.
  - Done when Codex, Claude Code, OpenCode, Node, package manager, and required
    system packages are pinned or intentionally floated with a documented
    update policy.
  - Verify with image build logs and dependency manifest review.

### Worker Startup Safety

- [ ] Validate required worker identity env at startup.
  - Done when worker mode refuses to start without sandbox id, user id, worker
    token, and expected runtime role.
  - Verify with supervisor-api startup tests.

- [ ] Validate provider home paths.
  - Done when Codex, Claude Code, and OpenCode homes are under `/home/agent` and
    are not world-writable.
  - Verify with provider bootstrap tests.

- [ ] Validate workspace root.
  - Done when worker APIs cannot resolve project paths outside `/workspace`.
  - Verify with path traversal tests, including symlink cases if supported.

- [x] Add local worker auth denial smoke.
  - Done when non-health worker routes reject requests without the internal
    worker token.
  - Verify with local container smoke.

- [x] Add local worker auth success smoke.
  - Done when non-health worker routes accept the router-injected worker token
    and valid identity envelope.
  - Verify with local container smoke.

## Milestone 5: Router, Route Tokens, And Worker Authorization

Goal: browsers reach workers only through short-lived route tokens and
router-injected identity.

### Router Runtime

- [ ] Deploy sandbox-router in staging.
  - Done when the browser can reach the router endpoint and the router can
    resolve a sandbox endpoint from the control-plane registry.
  - Verify with staging smoke.

- [ ] Add direct-worker-denial proof.
  - Done when a direct request to a worker public endpoint fails without the
    router-injected token.
  - Verify with staging smoke recording direct denial.

- [ ] Add browser-to-router-to-worker smoke.
  - Done when a real browser reaches a real worker through the router using a
    control-plane-issued route token.
  - Verify with staging smoke recording route-token issue, router proxy, and
    worker response.

- [ ] Add router traffic audit.
  - Done when route-token validation failures, worker upstream failures, and
    successful connections are auditable without secrets.
  - Verify with router tests and structured log review.

### Worker Scope Enforcement

- [ ] Enforce project/workspace/session scopes on worker APIs.
  - Done when worker endpoints reject identity envelopes for the wrong project,
    workspace, or session.
  - Verify with worker tests.

- [x] Add artifact read/write scope checks.
  - Done when artifact download, upload, metadata, and delete routes require
    appropriate identity-envelope scopes.
  - Verify with missing, wrong, and valid scope tests.

- [ ] Add shell/session scope checks.
  - Done when shell and agent operations cannot cross into another control-plane
    session.
  - Verify with worker tests.

- [ ] Add route-token signing-key rotation runbook.
  - Done when operators can rotate active and previous signing keys without
    breaking valid short-lived sessions unexpectedly.
  - Verify with documented smoke or test.

## Milestone 6: LLM Gateway And Billing

Goal: Codex, Claude Code, and OpenCode use gateway-scoped credentials inside
the sandbox, and Remote Codex can bill usage by product user.

### Gateway Provisioning

- [ ] Add gateway admin client.
  - Done when the control plane can create, rotate, revoke, and reconcile
    user/sandbox gateway keys against the chosen gateway API.
  - Verify with gateway client tests using documented fixtures.

- [ ] Add gateway key provisioning on user or sandbox creation.
  - Done when a new user/sandbox receives a scoped gateway token before worker
    startup.
  - Verify with provisioning tests.

- [ ] Store gateway key metadata.
  - Done when Remote Codex stores external key id, user id, sandbox id,
    provider, status, scopes, timestamps, and rotation metadata.
  - Verify with migration and repository tests.

- [ ] Redact gateway tokens everywhere.
  - Done when raw gateway tokens never appear in API responses, logs, frontend
    state dumps, route-token payloads, or audit events.
  - Verify with tests for API redaction and startup log redaction.

- [ ] Add gateway key rotation endpoint.
  - Done when admins or automation can rotate a user's gateway key and future
    sandbox starts receive the new token.
  - Verify with API tests for rotate, audit, and old-key state.

- [ ] Add gateway key revocation endpoint.
  - Done when disabled users or admins can revoke gateway access.
  - Verify with API tests and provider client fixture.

### Worker Provider Bootstrap

- [ ] Render Codex gateway config.
  - Done when Codex inside the worker uses the gateway base URL and scoped
    token, not a provider root key.
  - Verify with provider bootstrap tests.

- [ ] Render Claude Code gateway config.
  - Done when Claude Code inside the worker uses the gateway base URL and scoped
    token, not a provider root key.
  - Verify with provider bootstrap tests.

- [ ] Render OpenCode gateway config.
  - Done when OpenCode inside the worker uses the gateway base URL and scoped
    token, not a provider root key.
  - Verify with provider bootstrap tests.

- [ ] Add staging Codex gateway smoke.
  - Done when Codex in a real worker makes one model request through the
    gateway and no root key exists in worker env/config.
  - Verify with staging smoke.

- [ ] Add staging Claude Code gateway smoke.
  - Done when Claude Code in a real worker makes one model request through the
    gateway and no root key exists in worker env/config.
  - Verify with staging smoke.

- [ ] Add staging OpenCode gateway smoke.
  - Done when OpenCode in a real worker makes one model request through the
    gateway and no root key exists in worker env/config.
  - Verify with staging smoke.

### Usage Import And Quota

- [ ] Add usage import adapter for the chosen gateway.
  - Done when the control plane fetches gateway usage and normalizes it into the
    product usage event schema.
  - Verify with tests for import, identity mapping, dedupe, pagination, and
    malformed gateway responses.

- [x] Add scheduled usage import job.
  - Done when import runs on a schedule with stored watermark and bounded batch
    size.
  - Verify with job tests for initial import, incremental import, retry, and
    idempotency.

- [x] Add usage import logs and metrics.
  - Done when import records source count, imported count, duplicate count,
    failure count, and last successful watermark without secrets.
  - Verify with tests or smoke logs.

- [ ] Add LLM quota enforcement before route-token issue or model use.
  - Done when users over quota are blocked with stable API error shape and
    without starting avoidable paid model calls.
  - Verify with control-plane tests.

- [ ] Add LLM usage summary UI.
  - Done when users can see current-period requests, tokens, and cost.
  - Verify with frontend tests for loading, empty, populated, and error states.

- [ ] Add LLM usage detail UI.
  - Done when users can inspect usage events by time, model, provider, and
    project/session when available.
  - Verify with frontend tests for list, pagination, and filters.

- [ ] Add quota exceeded UI.
  - Done when users see a clear blocked state when LLM quota is exceeded.
  - Verify with frontend tests for `quota_exceeded` responses.

## Milestone 7: ElAgenteHarness Integration

Goal: sandbox agents can use computational chemistry workflows through
ElAgenteHarness with scoped credentials.

### Harness Credentials

- [ ] Add harness admin credential config.
  - Done when Remote Codex can call harness admin APIs without exposing admin
    credentials to workers.
  - Verify with config tests for missing and valid settings.

- [ ] Add harness credential table.
  - Done when Remote Codex stores safe credential metadata for user/sandbox
    harness keys.
  - Verify with migration and repository tests.

- [ ] Decide key storage model for harness credentials.
  - Done when docs and schema state whether Remote Codex stores only hashes,
    encrypted raw keys, or write-only metadata.
  - Verify with redaction tests and architecture decision.

- [ ] Generate `INACT_X_APP_KEY` during user or sandbox provisioning.
  - Done when a user/sandbox has a scoped harness key before worker startup.
  - Verify with provisioning tests.

- [ ] Bind harness key to user id.
  - Done when a key cannot be used across product users.
  - Verify with ownership tests.

- [ ] Bind harness key to sandbox id where required.
  - Done when a phase-one sandbox receives only its own scoped key.
  - Verify with sandbox mismatch tests.

- [ ] Bind harness key to scopes.
  - Done when allowed workflow/task/job/artifact actions are explicit.
  - Verify with allowed and denied scope tests.

- [ ] Bind harness key to quota profile.
  - Done when harness usage can be associated with product quota limits.
  - Verify with quota/provisioning tests.

- [ ] Add harness key rotation endpoint.
  - Done when admins or automation can rotate a user's harness key and update
    future sandbox env injection.
  - Verify with API tests for rotate, audit, and old-key state.

- [ ] Add harness key revocation endpoint.
  - Done when admins can revoke harness access for a user or sandbox.
  - Verify with API tests for revoke and non-admin denial.

### Harness Tool Surface

- [ ] Decide first harness tool surface: MCP, shell wrappers, provider config,
    or a combination.
  - Done when an architecture decision explains the initial surface and
    fallback.
  - Verify with linked decision doc.

- [ ] Render ElAgenteHarness MCP config if MCP is used.
  - Done when worker renders an approved MCP server entry pointing to harness
    with scoped env.
  - Verify with config rendering tests.

- [ ] Render ElAgenteHarness shell/tool wrappers if wrappers are used.
  - Done when wrappers call harness with scoped env and no host-local paths.
  - Verify with wrapper or worker tests.

- [ ] Integrate harness tools into Codex config.
  - Done when Codex can discover the approved harness tool surface.
  - Verify with provider bootstrap tests.

- [ ] Integrate harness tools into Claude Code config.
  - Done when Claude Code can discover the approved harness tool surface.
  - Verify with provider bootstrap tests.

- [ ] Integrate harness tools into OpenCode config.
  - Done when OpenCode can discover the approved harness tool surface.
  - Verify with provider bootstrap tests.

- [ ] Add staging worker-to-harness smoke.
  - Done when a real worker calls staging harness with injected
    `INACT_X_APP_KEY` and receives an authenticated response.
  - Verify with staging smoke recording worker id, harness endpoint, and no raw
    key exposure.

### Harness Product UI And Usage

- [ ] Add workflow catalog endpoint or approved proxy.
  - Done when the frontend can list available harness workflows through a safe
    Remote Codex path.
  - Verify with API tests for success, unavailable harness, and auth.

- [ ] Add workflow catalog UI.
  - Done when users can browse available computational chemistry workflows.
  - Verify with frontend tests for loading, empty, populated, and error states.

- [ ] Add harness task list endpoint.
  - Done when users can list their harness tasks with ownership and pagination.
  - Verify with API tests.

- [ ] Add harness task detail endpoint.
  - Done when users can inspect task status, inputs, outputs, linked jobs, and
    linked artifacts.
  - Verify with API tests for ownership and missing task states.

- [ ] Add task status UI.
  - Done when users can track running, failed, completed, and canceled harness
    tasks.
  - Verify with frontend tests for each task state.

- [ ] Add job status UI.
  - Done when users can see external compute job progress when harness exposes
    it.
  - Verify with frontend tests for pending, running, complete, and failed jobs.

- [ ] Define normalized harness usage event schema.
  - Done when schema covers workflow id, task id, job id, usage units,
    estimated cost, actual cost, currency, user id, sandbox id, project/workspace
    /session ids when available, and timestamps.
  - Verify with schema tests.

- [ ] Add harness webhook receiver or polling importer.
  - Done when Remote Codex can ingest harness usage idempotently.
  - Verify with tests for dedupe, retry, and malformed payloads.

- [ ] Add harness usage to billing summary.
  - Done when user usage summary includes harness totals alongside LLM usage.
  - Verify with summary endpoint tests.

## Milestone 8: MCP And Tool Policy

Goal: tool execution stays inside the sandbox, is auditable, and cannot mount
host-local resources.

### Policy Registry

- [ ] Define approved MCP server registry.
  - Done when registry entries include command, args, env, cwd, scopes, owner,
    and risk classification.
  - Verify with config schema tests.

- [ ] Define stdio MCP launch policy.
  - Done when stdio MCP servers can run only inside the sandbox with bounded env
    and cwd under `/workspace`.
  - Verify with policy tests for allowed and denied configs.

- [ ] Define remote MCP allowlist policy.
  - Done when remote MCP endpoints are allowlisted by origin and scope.
  - Verify with policy tests for allowed and denied origins.

- [ ] Define MCP env-var allowlist.
  - Done when MCP servers receive only explicit env vars, not the full worker
    environment.
  - Verify with rendering tests that secrets are excluded.

- [ ] Block filesystem MCP access outside `/workspace`.
  - Done when filesystem MCP servers cannot mount or traverse host paths outside
    the workspace.
  - Verify with path validation tests.

- [ ] Block Docker socket access by default.
  - Done when MCP config cannot expose host/container runtime sockets unless a
    future explicit exception is approved.
  - Verify with policy tests.

- [ ] Add ElAgenteHarness tools to approved registry.
  - Done when harness tools are registered with scoped env and allowed commands.
  - Verify with registry tests.

### Provider Config Rendering

- [ ] Render Codex MCP config under sandbox provider home.
  - Done when Codex config is under `/home/agent` and references only approved
    servers.
  - Verify with provider bootstrap tests.

- [ ] Render Claude Code MCP config under sandbox provider home.
  - Done when Claude Code config is under `/home/agent` and references only
    approved servers.
  - Verify with provider bootstrap tests.

- [ ] Render OpenCode MCP config under sandbox provider home.
  - Done when OpenCode config is under `/home/agent` and references only
    approved servers.
  - Verify with provider bootstrap tests.

- [ ] Validate rendered config path and permissions at startup.
  - Done when worker rejects missing, unsafe, or externally writable MCP config.
  - Verify with startup tests.

### Audit And UX

- [ ] Add MCP startup audit events.
  - Done when worker/control plane records which approved MCP servers started
    without logging secrets.
  - Verify with audit tests.

- [ ] Add MCP tool-call audit events.
  - Done when tool calls produce auditable metadata without sensitive payloads.
  - Verify with success and failure tests.

- [ ] Add MCP status UI.
  - Done when users can see enabled tools and failure state.
  - Verify with frontend tests for enabled, disabled, and failed states.

## Milestone 9: Workspace Persistence, Files, Diffs, And Artifacts

Goal: users do not lose useful work when sandboxes restart, and outputs are
visible through safe product surfaces.

### Persistence

- [ ] Choose phase-one persistence backend.
  - Done when an architecture decision chooses EFS, S3 snapshots, or temporary
    MVP workspace and names tradeoffs.
  - Verify with linked decision doc.

- [ ] Define maximum workspace size.
  - Done when size limit is enforced or measured before snapshot.
  - Verify with tests for limit behavior or measurement output.

- [ ] Add snapshot metadata table.
  - Done when DB stores snapshot id, user id, sandbox id, workspace id, object
    path, size, status, and timestamps.
  - Verify with migration and repository tests.

- [ ] Restore snapshot before worker readiness.
  - Done when worker is not marked ready for a workspace until restore completes
    or fails according to policy.
  - Verify with lifecycle tests.

- [ ] Save snapshot before sandbox stop.
  - Done when controlled stop saves workspace state when persistence is enabled.
  - Verify with lifecycle tests.

- [ ] Add manual snapshot endpoint.
  - Done when user or admin can trigger a snapshot according to ownership and
    quota policy.
  - Verify with API tests.

- [ ] Add snapshot status UI.
  - Done when users can see pending, complete, and failed snapshot states.
  - Verify with frontend tests.

- [ ] Add snapshot retention job.
  - Done when old snapshots are retained or deleted according to policy.
  - Verify with retention job tests.

### Files, Diffs, And Artifacts

- [ ] Initialize workspace diff baseline.
  - Done when each workspace has a known baseline after setup or restore.
  - Verify with worker tests.

- [ ] Preserve git metadata when source is a git repository.
  - Done when git workspaces keep commit history and remotes unless policy says
    otherwise.
  - Verify with restore/diff tests.

- [ ] Create synthetic baseline for non-git workspaces.
  - Done when non-git workspaces still support changed-file and diff views.
  - Verify with worker tests.

- [ ] Add worker changed-files endpoint.
  - Done when worker returns path, status, size, and binary flag for changed
    files.
  - Verify with worker tests.

- [ ] Add worker file-read endpoint with path scope checks.
  - Done when file reads cannot escape `/workspace`.
  - Verify with traversal and symlink tests.

- [ ] Add worker file-write endpoint with path scope checks.
  - Done when writes cannot escape `/workspace` and obey size/type limits.
  - Verify with worker tests.

- [ ] Add artifact metadata endpoint.
  - Done when users can inspect artifact metadata without storage credentials.
  - Verify with API tests.

- [ ] Add artifact upload/download path.
  - Done when artifacts can be uploaded/downloaded through signed URLs or a
    safe proxy path with size limits.
  - Verify with API and worker tests.

- [ ] Add chemistry artifact display hooks.
  - Done when the UI can link to or preview supported chemistry artifact types.
  - Verify with frontend tests using known artifact metadata fixtures.

## Milestone 10: Billing, Quota, And User Visibility

Goal: users and admins can understand spend across LLM, harness workflows, and
storage/compute-adjacent usage.

### Ledger And Billing Summary

- [ ] Define unified usage ledger schema.
  - Done when ledger supports LLM events, harness workflow usage, compute job
    usage references, storage/snapshot usage, currency, cost, and timestamps.
  - Verify with schema and repository tests.

- [ ] Add quota profile policy table or config.
  - Done when quota limits are environment-specific and not hard-coded in route
    handlers.
  - Verify with config/repository tests.

- [ ] Add quota evaluation service.
  - Done when LLM, harness, and storage quotas can be checked through one
    service.
  - Verify with unit tests for below-limit, at-limit, and over-limit cases.

- [ ] Add user billing summary endpoint.
  - Done when users can fetch current-period totals and quota state.
  - Verify with API tests.

- [ ] Add admin usage inspection endpoint.
  - Done when admins can inspect usage by user, source, period, and status.
  - Verify with API tests and non-admin denial.

- [ ] Add user-facing billing/usage page.
  - Done when users can see current-period totals, quota profile, and recent
    usage.
  - Verify with frontend tests.

- [ ] Add admin billing/usage page.
  - Done when admins can inspect usage and quota state for a selected user.
  - Verify with frontend tests.

## Milestone 11: Deployment, Operations, And Release Gates

Goal: the system can be deployed and operated with hundreds of users, one active
sandbox per user, and clear rollback gates.

### Railway Services

- [ ] Define Railway frontend deployment config.
  - Done when build command, start command, env vars, health checks, and domains
    are documented and reproducible.
  - Verify with staging deployment.

- [ ] Define Railway control-plane deployment config.
  - Done when API deployment has env vars, DB connection, auth config, gateway
    admin config, harness admin config, and health checks.
  - Verify with staging deployment.

- [ ] Add database migration runbook.
  - Done when staging and production migration commands, rollback expectations,
    and backup requirements are documented.
  - Verify with staging migration dry run or deployment log.

- [ ] Add control-plane scheduled jobs.
  - Done when usage import, sandbox reaper, idle stop, snapshot retention, and
    reconciliation jobs have deployment wiring.
  - Verify with staging job execution logs.

### AWS Services

- [ ] Define EKS Fargate deployment config.
  - Done when namespace, Fargate profile, Pod labels, service discovery, ingress
    or private routing, and security groups are documented.
  - Verify with staging cluster smoke.

- [ ] Define image publishing pipeline.
  - Done when worker images are built, tagged immutably, scanned if required,
    and pushed to the target registry.
  - Verify with CI/deployment logs.

- [ ] Define object storage config.
  - Done when S3 bucket names, prefixes, encryption, lifecycle policy, and
    access roles are documented.
  - Verify with staging storage smoke if persistence/artifacts are enabled.

- [ ] Define secrets management.
  - Done when route-token keys, worker-token material, gateway admin token,
    harness admin token, DB credentials, and AWS credentials have storage and
    rotation policy.
  - Verify with config validation and staging smoke.

- [ ] Add observability baseline.
  - Done when control plane, router, and worker expose structured logs, health
    checks, key metrics, and trace/correlation ids where useful.
  - Verify with staging log/metric review.

### Release Gates

- [ ] Add staging release checklist execution record.
  - Done when each required staging smoke has a date, operator, environment,
    and result.
  - Verify by updating release-readiness docs.

- [ ] Add production rollback plan.
  - Done when rollback covers frontend, API, DB migrations, worker image,
    router, gateway credential changes, and sandbox cleanup.
  - Verify with release-gate review.

- [ ] Add incident response notes.
  - Done when common incidents have first actions: gateway outage, AWS capacity,
    bad worker image, auth outage, DB outage, runaway usage, and stuck sandbox.
  - Verify with docs review.

## Milestone 12: End-To-End Acceptance

Goal: the full product path works from signup to sandbox work to chemistry
workflow usage and billing visibility.

- [ ] User can register or log in.
  - Verify with staging browser smoke.

- [ ] User can create project, workspace, and session.
  - Verify with staging browser smoke.

- [ ] User can start one sandbox.
  - Verify with staging control-plane and AWS smoke.

- [ ] User can open a session through the router.
  - Verify with staging browser-to-router-to-worker smoke.

- [ ] Worker rejects direct unauthenticated access.
  - Verify with staging direct-worker-denial smoke.

- [ ] Codex works through the LLM gateway.
  - Verify with staging worker provider smoke.

- [ ] Claude Code works through the LLM gateway.
  - Verify with staging worker provider smoke.

- [ ] OpenCode works through the LLM gateway.
  - Verify with staging worker provider smoke.

- [ ] Worker can call ElAgenteHarness with scoped `INACT_X_APP_KEY`.
  - Verify with staging worker-to-harness smoke.

- [ ] Harness can submit or simulate one chemistry workflow task.
  - Verify with harness staging task smoke and Remote Codex task visibility.

- [ ] LLM usage appears in user billing summary.
  - Verify with gateway usage import smoke.

- [ ] Harness usage appears in user billing summary.
  - Verify with harness usage import smoke.

- [ ] Quota exceeded state blocks further paid usage cleanly.
  - Verify with API and frontend staging smoke.

- [ ] Admin can inspect user, sandbox, usage, and recent audit events.
  - Verify with staging admin smoke.

- [ ] No raw provider root keys, gateway tokens, harness keys, product JWTs, or
  internal worker tokens appear in logs or browser storage during the smoke.
  - Verify with targeted log and storage inspection.

## Suggested Verification Commands

Run focused checks for the changed area, then broaden before handoff.

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

## Handoff Template

Use this template when a milestone or task group is completed.

```text
Completed:
- <checked items>

Evidence:
- Files: <files changed>
- Verification: <commands or smoke checks>
- Deployment: <environment, if any>

Not completed:
- <unchecked follow-ups>

Residual risk:
- <known risk>
```
