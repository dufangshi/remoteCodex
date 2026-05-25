# Remote Codex Side Detailed Checklist

This is the execution checklist for the work that belongs in the
`remoteCodex` repository for the Agente sandbox-worker product.

Use this document as a task board. Each checkbox should be small enough that a
developer can finish it, run the named verification, update the checkbox, and
commit that slice without needing to complete a whole product phase.

## Ownership Boundary

Remote Codex owns:

- Product frontend and authenticated app shell.
- Control-plane API.
- Product users, projects, workspaces, sessions, sandboxes, quotas, usage, and
  audit records.
- One-user-to-one-sandbox lifecycle orchestration for phase one.
- Sandbox router integration and route-token issuance.
- Worker-mode supervisor API that runs inside each sandbox.
- Worker image bootstrap for Codex, Claude Code, OpenCode, MCP,
  ElAgenteHarness, and gateway-scoped model credentials.
- Integration contracts and clients for the LLM gateway, ElAgenteHarness, AWS
  sandbox runtime, object storage, and usage import.

Remote Codex does not own:

- Real model-provider root-key storage when the LLM gateway owns those keys.
- Internal model routing inside the LLM gateway.
- ElAgenteHarness workflow execution internals.
- Modal, AWS Batch, Slurm, ORCA, or other chemistry compute workers.
- Running user commands outside isolated sandbox workers.

## Checkbox Rules

- Check a task only after code, tests, smoke evidence, deployment wiring, or a
  deliberately scoped documentation deliverable exists on this branch.
- Do not check a staging, AWS-live, provider-runtime, or production item until
  the real target environment has run and passed the named smoke.
- Keep raw provider keys, gateway tokens, harness keys, product JWTs, and
  worker internal tokens out of logs, browser storage, API responses, and task
  output.
- When a task changes release status, update `docs/status.md`,
  `docs/staging-release-readiness.md`, or
  `docs/remote-codex-side-execution-checklist.md`.
- If a task moves to another repository, leave the implementation task
  unchecked here and add only a checked Remote Codex integration-contract task
  once the local contract/client exists.

Evidence template for checking a task:

```text
Task:
- <exact checkbox text>

Evidence:
- Files: <main files changed>
- Verification: <commands, CI run, smoke output, or deployment record>
- Residual risk: <remaining unchecked edge>
```

## Phase 0: Documentation And Release Baseline

Goal: the branch is understandable, scoped, and safe to continue from.

### Architecture Docs

- [ ] D0.01 Confirm `docs/README.md` points to the current product architecture.
  - Done when the docs index names the control plane, sandbox worker, router,
    LLM gateway, ElAgenteHarness, and release checklists.
  - Verify with docs review and `git diff --check`.

- [ ] D0.02 Keep the Agente product architecture document current.
  - Done when the architecture doc matches the current decision: Railway
    frontend/API, AWS sandbox runtime, gateway-scoped model keys, and
    ElAgenteHarness integration.
  - Verify with docs review against this checklist.

- [ ] D0.03 Keep the control-plane to sandbox-worker contract current.
  - Done when lifecycle, route-token, worker-token, identity-envelope, and
    checkpoint responsibilities are documented.
  - Verify with docs review and links to the relevant API tests.

- [ ] D0.04 Keep architecture decisions current.
  - Done when decisions for EKS Fargate, one Pod per active sandbox, one
    container per sandbox, route-token proxying, and gateway-owned provider
    roots are recorded.
  - Verify with docs review.

### Release Baseline

- [ ] D0.05 Maintain staging release-readiness notes.
  - Done when staging services, env vars, smoke commands, blocked gates, and
    rollback steps are listed.
  - Verify with `docs/staging-release-readiness.md`.

- [ ] D0.06 Maintain production release gates.
  - Done when auth, sandbox lifecycle, router, gateway, harness, worker image,
    usage import, quota, observability, and rollback gates are explicit.
  - Verify with `docs/release-gates.md`.

- [ ] D0.07 Keep current branch status updated after major slices.
  - Done when `docs/status.md` names completed work, current focus, and
    residual risks.
  - Verify in the same commit as the larger implementation slice.

- [ ] D0.08 Keep one authoritative day-to-day checklist.
  - Done when this document is linked from the docs index and future completed
    tasks are reflected here.
  - Verify with docs review.

## Phase 1: Product Auth, Users, And Admin Boundary

Goal: users can enter the product safely, and product identity never becomes a
worker credential.

### Auth Provider And Session Boundary

- [ ] A1.01 Finalize the phase-one product auth provider.
  - Done when the selected provider or JWT-compatible issuer is named with
    required issuer, audience, JWKS, and local-dev fallback settings.
  - Verify with auth config docs and control-plane config tests.

- [ ] A1.02 Keep local `dev:<subject>` auth for development.
  - Done when local development can bootstrap a product user without a live
    auth provider.
  - Verify with control-plane auth tests.

- [ ] A1.03 Validate production-style JWTs.
  - Done when issuer, audience, expiry, not-before, issued-at, and clock skew
    are validated.
  - Verify with `pnpm smoke:production-auth` and auth unit tests.

- [ ] A1.04 Normalize auth error responses.
  - Done when missing, expired, wrong-audience, wrong-issuer, disabled-user,
    and non-admin requests have stable `401` or `403` response shapes.
  - Verify with control-plane API tests.

- [ ] A1.05 Prove product JWTs do not reach workers.
  - Done when router or worker diagnostics prove browser `Authorization`
    headers are stripped before worker traffic.
  - Verify with local or staging smoke output; staging proof remains required
    before production.

### User And Admin Model

- [ ] A1.06 Bootstrap product users idempotently.
  - Done when repeated authenticated requests map to one durable user record.
  - Verify with account bootstrap tests.

- [ ] A1.07 Store user account status.
  - Done when active, disabled, and deleted/anonymized or deferred policy
    states are represented.
  - Verify with DB migration and repository tests.

- [ ] A1.08 Store billing and quota identifiers on users.
  - Done when billing customer id and quota profile are persisted and returned
    only to authorized callers.
  - Verify with user API tests.

- [ ] A1.09 Add user profile APIs.
  - Done when `GET /api/me` and allowed profile updates are implemented.
  - Verify with control-plane API tests.

- [ ] A1.10 Add admin user management APIs.
  - Done when admins can list users, update account status, and update quota
    profile; non-admin users are denied.
  - Verify with admin API tests.

- [ ] A1.11 Add user-data export or explicit deferral.
  - Done when launch policy states whether export is implemented or deferred.
  - Verify with `docs/user-data-policy.md` or API tests.

- [ ] A1.12 Add user deletion/anonymization or explicit deferral.
  - Done when launch policy states whether deletion/anonymization is
    implemented or deferred.
  - Verify with `docs/user-data-policy.md` or API tests.

### Frontend Auth Surface

- [ ] A1.13 Add login and registration entry points.
  - Done when unauthenticated users have clear routes into the auth provider.
  - Verify with frontend tests.

- [ ] A1.14 Add authenticated app-shell guard.
  - Done when protected routes do not render product data before auth resolves.
  - Verify with frontend tests for anonymous, loading, authenticated, and
    expired states.

- [ ] A1.15 Add logout and expired-session behavior.
  - Done when users can log out and expired sessions prompt re-auth without
    leaking stale data.
  - Verify with frontend tests.

- [ ] A1.16 Add disabled-account UI.
  - Done when disabled users see a blocked account state and cannot open
    sandbox sessions.
  - Verify with frontend tests using disabled-account API responses.

- [ ] A1.17 Add admin user management UI.
  - Done when admins can inspect users, status, and quota profile from the
    product UI.
  - Verify with frontend tests for admin and non-admin paths.

## Phase 2: Projects, Workspaces, Sessions, And Session Open

Goal: the control plane owns durable product metadata while workers own live
runtime state.

### Data Model And API

- [ ] P2.01 Finalize project schema and ownership.
  - Done when projects store owner, name, status, timestamps, and archive/delete
    semantics.
  - Verify with migration and ownership tests.

- [ ] P2.02 Finalize workspace schema and ownership.
  - Done when workspaces are linked to projects and have status, source,
    timestamps, and archive/delete semantics.
  - Verify with migration and ownership tests.

- [ ] P2.03 Finalize session schema and ownership.
  - Done when sessions link to workspaces and track control-plane session id,
    worker session id, status, last activity, and archive semantics.
  - Verify with migration and ownership tests.

- [ ] P2.04 Add project CRUD APIs.
  - Done when list, create, detail, update, and archive/delete paths exist.
  - Verify with API tests including cross-user denial.

- [ ] P2.05 Add workspace APIs.
  - Done when workspaces can be listed, created, updated, and archived under
    the correct project.
  - Verify with API tests including wrong-project and wrong-user denial.

- [ ] P2.06 Add session APIs.
  - Done when sessions can be listed, created, updated, archived, and opened
    only by the owner.
  - Verify with API tests including wrong-workspace and wrong-user denial.

- [ ] P2.07 Add bounded pagination and filters.
  - Done when project, workspace, and session lists have safe limits, offsets
    or cursors, and search/status filters where needed.
  - Verify with API tests for defaults, max limits, and filters.

### Frontend Product Flow

- [ ] P2.08 Add project list and creation UI.
  - Done when users can view, create, and recover from errors in the project
    list.
  - Verify with frontend tests.

- [ ] P2.09 Add project detail and workspace UI.
  - Done when users can open a project, see workspaces, create a workspace, and
    inspect loading/error/empty states.
  - Verify with frontend tests.

- [ ] P2.10 Add session list and creation UI.
  - Done when users can list and create sessions inside a workspace.
  - Verify with frontend tests.

- [ ] P2.11 Add session open action.
  - Done when opening a session requests a route token scoped to user, sandbox,
    project, workspace, and session.
  - Verify with frontend tests and a local smoke.

- [ ] P2.12 Keep route tokens in memory only.
  - Done when route tokens are never written to localStorage, sessionStorage,
    IndexedDB, URLs, logs, or persisted app state.
  - Verify with code review and frontend tests.

### Worker Session Sync

- [ ] P2.13 Define worker session metadata contract.
  - Done when worker metadata needed by the control-plane session registry is
    documented and tested.
  - Verify with worker metadata tests.

- [ ] P2.14 Add worker-to-control-plane checkpoint sync.
  - Done when worker mode can update durable session status, worker session id,
    and last activity.
  - Verify with `pnpm smoke:local-worker-checkpoint`.

- [ ] P2.15 Add session close/finalize flow.
  - Done when user close asks the worker to finalize state and updates durable
    session status.
  - Verify with API, worker, and frontend tests.

- [ ] P2.16 Add session resume flow.
  - Done when reopening an existing session restores worker context or clearly
    reports unavailable worker state.
  - Verify with local restart/resume smoke.

## Phase 3: Sandbox Lifecycle And AWS Runtime

Goal: one user has one sandbox, and the control plane can start, stop, observe,
and recover it.

### Sandbox Manager

- [ ] S3.01 Keep the `SandboxManager` interface stable.
  - Done when create, start, stop, restart, delete, status, endpoint, and env
    preparation methods exist behind one interface.
  - Verify with control-plane typecheck and adapter tests.

- [ ] S3.02 Keep local sandbox adapters working.
  - Done when tests can use a no-op adapter and local development can spawn a
    worker-process adapter.
  - Verify with local adapter tests.

- [ ] S3.03 Add local lifecycle smoke.
  - Done when one command starts control plane plus local worker and verifies
    route-token to worker connectivity.
  - Verify with the local smoke command and documented output.

### AWS EKS Fargate Adapter

- [ ] S3.04 Finalize AWS staging configuration.
  - Done when account, region, EKS cluster, namespace, Fargate profile, VPC,
    subnets, security groups, IAM roles, image registry, and log groups are
    named.
  - Verify with staging config review and AWS access smoke.

- [ ] S3.05 Add least-privilege Kubernetes credentials.
  - Done when the control plane can create, inspect, and delete only the worker
    Pods and related resources it owns.
  - Verify with config validation and staging lifecycle smoke.

- [ ] S3.06 Create a real worker Pod from the control plane.
  - Done when a staging API call starts one EKS Fargate Pod from an immutable
    worker image tag.
  - Verify with staging smoke recording user id, sandbox id, Pod name, image,
    endpoint, and `/readyz`.

- [ ] S3.07 Stop a real worker Pod from the control plane.
  - Done when stop moves the registry to stopped and the Pod terminates.
  - Verify with staging smoke recording final registry state and Pod deletion.

- [ ] S3.08 Add idempotent lifecycle smoke.
  - Done when repeated start, stop, and restart calls cannot corrupt registry
    state or create duplicate active sandboxes.
  - Verify with staging smoke logs and final registry state.

- [ ] S3.09 Add capacity preflight.
  - Done when AWS Fargate quota, subnet IP capacity, and image-pull failure
    modes are mapped to predictable API errors.
  - Verify with tests for error mapping and staging readiness notes.

### Sandbox Operations

- [ ] S3.10 Add sandbox runtime event log.
  - Done when lifecycle transitions, readiness failures, image-pull failures,
    capacity failures, and admin actions are auditable without secrets.
  - Verify with API tests and log review.

- [ ] S3.11 Add idle warning and idle stop.
  - Done when users get a warning before idle timeout and idle sandboxes stop
    according to policy.
  - Verify with job tests and frontend tests.

- [ ] S3.12 Add admin force-stop with audit trail.
  - Done when admins can force-stop a sandbox with reason and operator id.
  - Verify with API tests and audit assertions.

## Phase 4: Worker Image And Runtime Guardrails

Goal: sandboxes start from a reproducible image and fail closed if runtime
configuration is unsafe.

### Worker Image

- [ ] W4.01 Keep `Dockerfile.worker` as the canonical worker image.
  - Done when the image builds from a clean checkout without relying on local
    dirty files.
  - Verify with `docker build -f Dockerfile.worker -t remote-codex-worker:verify .`.

- [ ] W4.02 Pin runtime dependency versions.
  - Done when Node, package manager, Codex, Claude Code, OpenCode, SDKs, and
    required system packages are pinned or intentionally floated with an update
    policy.
  - Verify with image manifest review and image build logs.

- [ ] W4.03 Run the worker as a non-root user.
  - Done when the image runs as `agent`, uses `/workspace`, and places provider
    homes under `/home/agent`.
  - Verify with container smoke and image inspection.

- [ ] W4.04 Add safe runtime metadata.
  - Done when the worker can report image version and provider runtime versions
    without secrets.
  - Verify with worker metadata tests and container smoke.

- [ ] W4.05 Add CI worker image build and smoke.
  - Done when CI builds the image, starts it, checks `/readyz`, verifies auth
    denial, and verifies auth success.
  - Verify with passing GitHub Actions run.

### Worker Startup Safety

- [ ] W4.06 Validate required worker identity env.
  - Done when worker mode refuses to start without sandbox id, user id, worker
    token, and expected runtime role.
  - Verify with supervisor-api startup tests.

- [ ] W4.07 Validate filesystem roots.
  - Done when worker mode requires `WORKSPACE_ROOT=/workspace`,
    `HOME=/home/agent`, safe provider homes, and a writable workspace.
  - Verify with startup tests.

- [ ] W4.08 Validate gateway and harness env only when enabled.
  - Done when provider runtimes require gateway env and chemistry tools require
    harness env, while disabled features do not block startup.
  - Verify with config tests.

- [ ] W4.09 Redact secrets from startup logs and metadata.
  - Done when service tokens, gateway tokens, harness keys, product JWTs, and
    worker tokens cannot appear in logs or metadata responses.
  - Verify with redaction tests.

- [ ] W4.10 Validate MCP config path and permissions.
  - Done when missing, unsafe, or externally writable MCP configs are rejected.
  - Verify with startup tests.

## Phase 5: Router, Route Tokens, And Worker Authorization

Goal: browsers reach workers only through short-lived route tokens and
router-injected worker identity.

### Route Token Contract

- [ ] R5.01 Define route-token payload schema.
  - Done when tokens include user id, sandbox id, project/workspace/session
    ids, scopes, expiry, nonce or token id, and signing key id.
  - Verify with schema tests.

- [ ] R5.02 Sign and verify route tokens.
  - Done when expiry, tampering, wrong sandbox, wrong scope, and previous-key
    verification are tested.
  - Verify with control-plane and router tests.

- [ ] R5.03 Add signing-key rotation runbook.
  - Done when operators can rotate active and previous route-token keys without
    unexpectedly breaking valid short-lived sessions.
  - Verify with docs and rotation tests or smoke.

- [ ] R5.04 Enforce account, sandbox, session, and quota checks before token
  issue.
  - Done when disabled users, stopped sandboxes, archived sessions, wrong
    owners, and over-quota users cannot receive a route token.
  - Verify with control-plane API tests.

### Sandbox Router

- [ ] R5.05 Keep router package deployable.
  - Done when sandbox-router has health checks, config validation, and
    deployment env documentation.
  - Verify with router typecheck and tests.

- [ ] R5.06 Implement HTTP, SSE, and WebSocket proxying.
  - Done when all worker traffic modes proxy through the router with route-token
    verification.
  - Verify with router tests and local smoke.

- [ ] R5.07 Inject internal worker token.
  - Done when the router injects `X-Remote-Codex-Worker-Token` and the browser
    never receives that token.
  - Verify with router tests.

- [ ] R5.08 Inject signed identity envelope.
  - Done when the router strips browser-supplied identity headers and injects a
    signed envelope with user, sandbox, project, workspace, session, scopes, and
    expiry.
  - Verify with router and worker tests.

- [ ] R5.09 Add router limits and audits.
  - Done when request size limits, idle timeouts, rate limits, structured
    errors, and secret-safe audit logs exist.
  - Verify with router tests.

- [ ] R5.10 Deploy sandbox-router in staging.
  - Done when the staging browser can reach router health and the router can
    resolve a live sandbox endpoint.
  - Verify with staging deployment smoke.

- [ ] R5.11 Add direct-worker-denial proof.
  - Done when direct requests to a worker public endpoint fail without the
    router-injected token.
  - Verify with staging smoke.

- [ ] R5.12 Add browser-to-router-to-worker smoke.
  - Done when a real browser reaches a real worker through the router using a
    control-plane-issued route token.
  - Verify with staging smoke recording route-token issue, router proxy, and
    worker response.

### Worker Scope Enforcement

- [ ] R5.13 Verify worker token on non-health APIs.
  - Done when `/healthz` and `/readyz` stay public, but all other worker-mode
    APIs require the internal worker token.
  - Verify with worker auth tests and container smoke.

- [ ] R5.14 Verify identity envelopes on scoped APIs.
  - Done when shell, file, provider-turn, artifact, and session operations
    reject missing, expired, wrong-sandbox, or wrong-scope envelopes.
  - Verify with worker scope tests.

- [ ] R5.15 Enforce project/workspace/session scope on worker APIs.
  - Done when worker endpoints cannot cross into another control-plane project,
    workspace, or session.
  - Verify with worker tests.

## Phase 6: LLM Gateway And Provider Runtime Bootstrap

Goal: Codex, Claude Code, and OpenCode use gateway-scoped credentials inside
the sandbox, while real provider root keys stay outside the sandbox.

### Gateway Control-Plane Integration

- [ ] G6.01 Finalize gateway contract.
  - Done when Remote Codex knows the gateway base URL, admin auth shape,
    user/key provisioning API, usage export API, and failure response shape.
  - Verify with gateway contract docs and fixture tests.

- [ ] G6.02 Add gateway admin client.
  - Done when the control plane can create users, create keys, rotate keys,
    revoke keys, and reconcile key status against the gateway.
  - Verify with mocked gateway client tests.

- [ ] G6.03 Provision gateway keys on user or sandbox creation.
  - Done when a scoped gateway credential exists before worker startup.
  - Verify with provisioning tests.

- [ ] G6.04 Store gateway key metadata safely.
  - Done when Remote Codex stores external key id, user id, sandbox id,
    provider/model scopes, status, timestamps, and optional encrypted
    ciphertext only if raw recovery is required.
  - Verify with migration and repository tests.

- [ ] G6.05 Redact gateway tokens everywhere.
  - Done when raw tokens never appear in API responses, logs, frontend state,
    route tokens, identity envelopes, audit events, or smoke output.
  - Verify with redaction tests.

- [ ] G6.06 Add gateway degraded API and UI states.
  - Done when provisioning or usage-import failures return stable errors and
    the UI shows a non-secret degraded state.
  - Verify with API and frontend tests.

### Provider Config Rendering

- [ ] G6.07 Render Codex gateway config.
  - Done when Codex inside the worker uses the gateway base URL and scoped
    token, not a provider root key.
  - Verify with provider bootstrap tests.

- [ ] G6.08 Render Claude Code gateway config.
  - Done when Claude Code inside the worker uses the gateway base URL and
    scoped token, not a provider root key.
  - Verify with provider bootstrap tests.

- [ ] G6.09 Render OpenCode gateway config.
  - Done when OpenCode inside the worker uses the gateway base URL and scoped
    token, not a provider root key.
  - Verify with provider bootstrap tests.

- [ ] G6.10 Add provider runtime startup diagnostics.
  - Done when worker startup can report whether provider configs are present
    and safe without exposing tokens.
  - Verify with worker metadata tests.

### Provider Staging Smokes

- [ ] G6.11 Run staging Codex gateway smoke.
  - Done when Codex in a real worker makes one model request through the
    gateway and no provider root key exists in worker env/config.
  - Verify with staging smoke and gateway usage record.

- [ ] G6.12 Run staging Claude Code gateway smoke.
  - Done when Claude Code in a real worker makes one model request through the
    gateway and no provider root key exists in worker env/config.
  - Verify with staging smoke and gateway usage record.

- [ ] G6.13 Run staging OpenCode gateway smoke.
  - Done when OpenCode in a real worker makes one model request through the
    gateway and no provider root key exists in worker env/config.
  - Verify with staging smoke and gateway usage record.

### LLM Usage And Quota

- [ ] G6.14 Add gateway usage import adapter.
  - Done when usage import maps gateway events to product user, sandbox,
    provider, model, tokens, cost, currency, timestamps, and dedupe key.
  - Verify with import tests covering pagination, malformed responses, and
    duplicates.

- [ ] G6.15 Add scheduled and manual usage import.
  - Done when imports run on a schedule with watermarks and admins can trigger
    a bounded manual import.
  - Verify with job tests.

- [ ] G6.16 Add LLM quota preflight.
  - Done when over-quota users are blocked before avoidable paid model use.
  - Verify with quota tests.

- [ ] G6.17 Add LLM usage UI.
  - Done when users can see current-period summary, usage details, gateway
    unavailable state, and quota exceeded state.
  - Verify with frontend tests.

## Phase 7: ElAgenteHarness Integration

Goal: sandbox agents can call computational chemistry workflows through
ElAgenteHarness with scoped, revocable credentials.

### Harness Credentials

- [ ] H7.01 Finalize Remote Codex to Harness admin contract.
  - Done when base URL, admin credential shape, key creation, key rotation, key
    revocation, task listing, artifact metadata, and usage/event APIs are
    documented.
  - Verify with contract docs and fixture tests.

- [ ] H7.02 Add harness admin credential config.
  - Done when the control plane can call harness admin APIs without exposing
    admin credentials to workers.
  - Verify with config tests.

- [ ] H7.03 Add harness credential table.
  - Done when user/sandbox harness credentials have metadata, status, scopes,
    timestamps, rotation fields, and safe storage policy.
  - Verify with migration and repository tests.

- [ ] H7.04 Decide harness key storage model.
  - Done when docs and schema state whether Remote Codex stores only key
    hashes, encrypted raw keys, or write-only metadata.
  - Verify with architecture decision and redaction tests.

- [ ] H7.05 Generate `INACT_X_APP_KEY`.
  - Done when user or sandbox provisioning creates a scoped harness key before
    worker startup.
  - Verify with provisioning tests.

- [ ] H7.06 Bind harness key to identity, scopes, and quota.
  - Done when keys are bound to user id, sandbox id where required, allowed
    workflow/task/artifact scopes, and quota profile.
  - Verify with ownership and scope tests.

- [ ] H7.07 Add harness key rotation and revocation.
  - Done when admins or automation can rotate and revoke harness keys, with
    audit records and future sandbox injection using the new state.
  - Verify with API tests.

### Worker Harness Bootstrap

- [ ] H7.08 Inject harness env into workers.
  - Done when workers receive `ELAGENTE_HARNESS_BASE_URL` and scoped
    `INACT_X_APP_KEY` only.
  - Verify with worker env tests and redaction tests.

- [ ] H7.09 Validate harness env in worker mode.
  - Done when chemistry tools fail closed if required harness env is missing
    and remain disabled if chemistry integration is intentionally off.
  - Verify with startup tests.

- [ ] H7.10 Redact harness keys everywhere.
  - Done when raw harness keys cannot appear in logs, worker metadata, API
    responses, browser state, route tokens, or identity envelopes.
  - Verify with redaction tests.

- [ ] H7.11 Run staging worker-to-harness smoke.
  - Done when a real worker calls staging harness with injected
    `INACT_X_APP_KEY` and receives an authenticated response.
  - Verify with staging smoke recording user, sandbox, harness endpoint, and no
    raw key exposure.

### Harness Tools, API, And UI

- [ ] H7.12 Decide first harness tool surface.
  - Done when MCP, shell wrappers, provider-native tool config, or a combination
    is chosen with fallback behavior.
  - Verify with architecture decision.

- [ ] H7.13 Render harness MCP config or wrappers.
  - Done when approved harness tools are available inside the sandbox with
    scoped env and no host-local paths.
  - Verify with config rendering tests.

- [ ] H7.14 Integrate harness tools into provider configs.
  - Done when Codex, Claude Code, and OpenCode can discover the approved
    harness tool surface.
  - Verify with provider bootstrap tests.

- [ ] H7.15 Add workflow catalog endpoint or proxy.
  - Done when the frontend can list workflows through a safe Remote Codex path.
  - Verify with API tests for success, unavailable harness, and auth denial.

- [ ] H7.16 Add harness task and job endpoints.
  - Done when users can list and inspect their tasks, job status, and linked
    artifacts with ownership checks.
  - Verify with API tests.

- [ ] H7.17 Add workflow, task, job, and artifact UI.
  - Done when users can browse workflows, inspect task/job state, and see
    chemistry artifact metadata or previews where supported.
  - Verify with frontend tests.

- [ ] H7.18 Add harness usage import.
  - Done when usage events map workflow id, task id, job id, units, estimated
    cost, actual cost, currency, user, sandbox, and optional project/workspace
    /session.
  - Verify with webhook or polling importer tests.

## Phase 8: MCP And Tool Policy

Goal: tool execution stays inside the sandbox, is auditable, and cannot mount
host-local resources.

### MCP Policy

- [ ] M8.01 Define approved MCP server registry.
  - Done when entries include id, owner, command or remote origin, args, env,
    cwd, scopes, risk class, and enabled state.
  - Verify with schema tests.

- [ ] M8.02 Define stdio MCP launch policy.
  - Done when stdio MCP servers can run only inside the sandbox with cwd under
    `/workspace` or another explicitly approved sandbox path.
  - Verify with policy tests.

- [ ] M8.03 Define remote MCP allowlist policy.
  - Done when remote MCP endpoints are allowlisted by origin and scope.
  - Verify with policy tests.

- [ ] M8.04 Define MCP env-var allowlist.
  - Done when MCP servers receive only explicit env vars and never inherit the
    full worker environment.
  - Verify with rendering tests.

- [ ] M8.05 Block filesystem access outside `/workspace`.
  - Done when filesystem MCP servers cannot mount, traverse, or symlink-escape
    outside the workspace.
  - Verify with path validation tests.

- [ ] M8.06 Block Docker and host-local resources by default.
  - Done when MCP configs cannot expose Docker sockets, host databases, host
    SSH agents, or other runtime sockets without a future explicit exception.
  - Verify with policy tests.

### Provider MCP Rendering

- [ ] M8.07 Render Codex MCP config.
  - Done when Codex config under `/home/agent` references only approved MCP
    servers.
  - Verify with provider bootstrap tests.

- [ ] M8.08 Render Claude Code MCP config.
  - Done when Claude Code config under `/home/agent` references only approved
    MCP servers.
  - Verify with provider bootstrap tests.

- [ ] M8.09 Render OpenCode MCP config.
  - Done when OpenCode config under `/home/agent` references only approved MCP
    servers.
  - Verify with provider bootstrap tests.

- [ ] M8.10 Add ElAgenteHarness tools to the registry.
  - Done when harness tools are approved with scoped env, allowed commands or
    remote origins, and audit metadata.
  - Verify with registry tests.

### MCP Audit And UX

- [ ] M8.11 Add MCP startup audit events.
  - Done when worker/control plane records which approved MCP servers started,
    failed, or were disabled without logging secrets.
  - Verify with audit tests.

- [ ] M8.12 Add MCP tool-call audit events.
  - Done when tool calls produce useful metadata without sensitive payloads.
  - Verify with success and failure tests.

- [ ] M8.13 Add MCP status UI.
  - Done when users can see enabled tools and failure state.
  - Verify with frontend tests.

## Phase 9: Workspace Persistence, Files, Diffs, And Artifacts

Goal: users do not lose useful work when sandboxes restart, and outputs are
visible through safe product surfaces.

### Persistence

- [ ] F9.01 Choose phase-one persistence backend.
  - Done when EFS, S3 snapshots, or temporary MVP workspace storage is selected
    with tradeoffs and launch limitations.
  - Verify with architecture decision.

- [ ] F9.02 Define workspace and artifact size limits.
  - Done when maximum workspace size, artifact size, file size, and patch size
    are documented and enforced where needed.
  - Verify with config and worker tests.

- [ ] F9.03 Add snapshot metadata model.
  - Done when snapshots store id, user id, sandbox id, workspace id, object
    path, size, status, error, and timestamps.
  - Verify with migration and repository tests.

- [ ] F9.04 Restore snapshot before worker readiness.
  - Done when a worker is not marked ready for a workspace until restore
    completes or fails according to policy.
  - Verify with lifecycle tests.

- [ ] F9.05 Save snapshot before sandbox stop.
  - Done when controlled stop saves workspace state when persistence is enabled.
  - Verify with lifecycle tests.

- [ ] F9.06 Add manual snapshot and snapshot status UI.
  - Done when users or admins can trigger snapshots and see pending, complete,
    and failed states.
  - Verify with API and frontend tests.

- [ ] F9.07 Add snapshot retention job.
  - Done when old snapshots are retained or deleted according to policy.
  - Verify with job tests.

### Files And Diffs

- [ ] F9.08 Initialize workspace diff baseline.
  - Done when every workspace has a known baseline after setup or restore.
  - Verify with worker tests.

- [ ] F9.09 Preserve git metadata when present.
  - Done when git workspaces keep commit history and remotes unless policy says
    otherwise.
  - Verify with restore and diff tests.

- [ ] F9.10 Create synthetic baseline for non-git workspaces.
  - Done when non-git workspaces still support changed-file and diff views.
  - Verify with worker tests.

- [ ] F9.11 Add changed-files and diff endpoints.
  - Done when worker returns changed files, text diffs, and binary metadata
    with size limits.
  - Verify with worker tests.

- [ ] F9.12 Add scoped file read/write endpoints.
  - Done when file reads and writes cannot escape `/workspace`, including path
    traversal and supported symlink cases.
  - Verify with worker tests.

- [ ] F9.13 Add generated-credential exclusion policy.
  - Done when generated provider, gateway, harness, and MCP credential files are
    excluded from diffs, snapshots, downloads, and UI previews unless explicitly
    safe.
  - Verify with worker tests.

- [ ] F9.14 Add diff review and apply UI.
  - Done when users can inspect changed files and apply accepted changes back
    to durable project storage.
  - Verify with frontend and API tests.

### Artifacts

- [ ] F9.15 Define artifact ownership model and storage path format.
  - Done when artifact ownership, object-storage prefixes, retention, and
    access rules are documented.
  - Verify with docs and schema tests.

- [ ] F9.16 Add artifact upload/download path.
  - Done when artifacts can be uploaded and viewed through signed URLs or a
    safe proxy path with size limits.
  - Verify with API and worker tests.

- [ ] F9.17 Add chemistry artifact display hooks.
  - Done when supported chemistry artifact types can be linked or previewed in
    the frontend.
  - Verify with frontend tests using fixtures.

## Phase 10: Billing, Quotas, And Unified Usage

Goal: Remote Codex normalizes paid-resource usage from gateway, harness,
compute, storage, and sandbox runtime into one product ledger.

### Usage Ledger

- [ ] B10.01 Finalize usage ledger schema.
  - Done when ledger supports source, dedupe key, user, sandbox, project,
    workspace, session, units, cost, currency, timestamps, and metadata.
  - Verify with migration and repository tests.

- [ ] B10.02 Add source-specific event mapping.
  - Done when `llm`, `harness`, `compute`, `storage`, and `sandbox_runtime`
    sources have explicit normalization rules.
  - Verify with mapper tests.

- [ ] B10.03 Add idempotent import semantics.
  - Done when duplicate gateway/harness/compute events cannot double-charge a
    user.
  - Verify with dedupe tests.

- [ ] B10.04 Add usage summary endpoints.
  - Done when users and admins can fetch current-period totals and recent usage
    across sources.
  - Verify with API tests.

### Quotas

- [ ] B10.05 Add quota profile schema or config.
  - Done when quotas are environment-specific and not hard-coded in route
    handlers.
  - Verify with config or repository tests.

- [ ] B10.06 Add quota evaluation service.
  - Done when LLM, harness, compute, storage, and sandbox runtime quotas can be
    checked through one service.
  - Verify with unit tests for below-limit, at-limit, and over-limit cases.

- [ ] B10.07 Enforce LLM quota.
  - Done when over-quota users are blocked before route-token issuance or model
    use, depending on the final enforcement point.
  - Verify with API tests.

- [ ] B10.08 Enforce harness and compute quota.
  - Done when Remote Codex blocks or warns before expensive harness or compute
    actions when those actions are visible to Remote Codex.
  - Verify with API tests and harness integration tests.

- [ ] B10.09 Add quota exceeded UI.
  - Done when users see a stable blocked state and next action when over quota.
  - Verify with frontend tests.

### Billing UI

- [ ] B10.10 Add user billing dashboard.
  - Done when users can see current-period totals, quota remaining, source
    breakdowns, and recent usage.
  - Verify with frontend tests.

- [ ] B10.11 Add admin usage inspection.
  - Done when admins can inspect usage by user, source, period, and status.
  - Verify with API and frontend tests.

## Phase 11: Deployment, Operations, And CI

Goal: the system can be deployed and operated with hundreds of users, one
active sandbox per user, and clear rollback gates.

### Railway Services

- [ ] O11.01 Define Railway frontend deployment.
  - Done when build command, start command, health check, domains, and required
    env vars are documented and reproducible.
  - Verify with staging deployment.

- [ ] O11.02 Define Railway control-plane deployment.
  - Done when API deployment has build/start commands, health check, database,
    auth, gateway admin, harness admin, route-token, and AWS env docs.
  - Verify with staging deployment.

- [ ] O11.03 Add database migration runbook.
  - Done when staging and production migration commands, backup requirements,
    and rollback expectations are documented.
  - Verify with staging migration dry run or deploy log.

- [ ] O11.04 Add scheduled job deployment wiring.
  - Done when usage import, sandbox reaper, idle stop, snapshot retention, and
    reconciliation jobs have deployment wiring.
  - Verify with staging job logs.

### AWS Services

- [ ] O11.05 Define ECR/image publishing pipeline.
  - Done when worker images are built, tagged immutably, optionally scanned,
    and pushed to the target registry.
  - Verify with CI/deployment logs.

- [ ] O11.06 Define EKS Fargate deployment config.
  - Done when namespace, labels, Fargate profile, service discovery, ingress or
    private routing, and security groups are documented.
  - Verify with staging cluster smoke.

- [ ] O11.07 Define object storage config.
  - Done when S3 bucket names, prefixes, encryption, lifecycle policy, and
    access roles are documented.
  - Verify with staging storage smoke if persistence/artifacts are enabled.

- [ ] O11.08 Define secrets management and rotation.
  - Done when route-token keys, worker-token material, gateway admin token,
    harness admin token, database credentials, and AWS credentials have storage,
    rotation, and emergency revoke procedures.
  - Verify with config validation and runbook review.

### Observability And CI

- [ ] O11.09 Add structured logs.
  - Done when control plane, router, and worker emit secret-safe structured logs
    with correlation ids where useful.
  - Verify with tests or staging log review.

- [ ] O11.10 Add metrics.
  - Done when sandbox lifecycle, route-token issuance, worker connections,
    usage import, harness import, and error rates are measurable.
  - Verify with staging metric review.

- [ ] O11.11 Add error dashboards and alerts.
  - Done when common failures have dashboards or alert entry points: auth,
    gateway, AWS capacity, bad worker image, DB, runaway usage, and stuck
    sandbox.
  - Verify with staging operations review.

- [ ] O11.12 Add CI typecheck and test jobs for all packages.
  - Done when control-plane API, sandbox-router, supervisor-api,
    supervisor-web, config, shared, and DB packages run typecheck/tests in CI
    where applicable.
  - Verify with passing CI run.

- [ ] O11.13 Add CI e2e and smoke jobs.
  - Done when CI covers worker image build, `/readyz`, auth denial/success,
    route-token verification, gateway config rendering, harness env rendering,
    login-to-session-open, and local browser-to-router-to-worker.
  - Verify with passing CI run.

## Phase 12: End-To-End Acceptance

Goal: one real user path works from login to sandbox work to chemistry workflow
usage and billing visibility.

- [ ] E12.01 User can register or log in.
  - Verify with staging browser smoke.

- [ ] E12.02 User gets exactly one sandbox.
  - Verify with staging control-plane state and sandbox registry.

- [ ] E12.03 User can create project, workspace, and session.
  - Verify with staging browser smoke.

- [ ] E12.04 User can start one sandbox.
  - Verify with staging control-plane and AWS smoke.

- [ ] E12.05 User can open a session through the router.
  - Verify with staging browser-to-router-to-worker smoke.

- [ ] E12.06 Worker rejects direct unauthenticated access.
  - Verify with staging direct-worker-denial smoke.

- [ ] E12.07 Codex works through the LLM gateway.
  - Verify with staging provider smoke and usage event.

- [ ] E12.08 Claude Code works through the LLM gateway.
  - Verify with staging provider smoke and usage event.

- [ ] E12.09 OpenCode works through the LLM gateway.
  - Verify with staging provider smoke and usage event.

- [ ] E12.10 Worker can call ElAgenteHarness with scoped `INACT_X_APP_KEY`.
  - Verify with staging worker-to-harness smoke.

- [ ] E12.11 Harness can submit or simulate one chemistry workflow task.
  - Verify with harness staging task smoke and Remote Codex task visibility.

- [ ] E12.12 LLM usage appears in the user billing summary.
  - Verify with gateway usage import smoke.

- [ ] E12.13 Harness or compute usage appears in the user billing summary.
  - Verify with harness usage import or webhook smoke.

- [ ] E12.14 Quota exceeded state blocks further paid usage cleanly.
  - Verify with API and frontend staging smoke.

- [ ] E12.15 Admin can inspect user, sandbox, usage, and audit events.
  - Verify with staging admin smoke.

- [ ] E12.16 No secret leakage appears during the staging smoke.
  - Verify with targeted browser storage, API response, worker metadata, and log
    inspection for provider root keys, gateway tokens, harness keys, product
    JWTs, and internal worker tokens.

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
pnpm smoke:local-worker-checkpoint
pnpm smoke:production-auth
pnpm smoke:staging-phase-one
docker build -f Dockerfile.worker -t remote-codex-worker:verify .
```
