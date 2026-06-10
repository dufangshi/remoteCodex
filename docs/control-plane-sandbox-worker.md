# Control Plane To Sandbox Worker

## Objective

Remote Codex should run coding agents inside per-user EKS Fargate sandbox pods
while keeping a central service responsible for users, projects, routing, and
sandbox lifecycle.

The first implementation target is the route-token model:

```text
Browser
  |
  | HTTPS
  v
Railway Control Plane API
  |
  | short-lived route token
  v
AWS Sandbox Router
  |
  | HTTP / WSS proxy
  v
Sandbox Worker
  |
  | local process / SDK calls inside sandbox
  v
Codex app-server, Claude Code, OpenCode
```

The control plane does not carry normal worker WebSocket or streaming traffic.
It authenticates the user, checks ownership and quota, then issues a scoped
route token for the AWS router. Agent code, shell commands, MCP stdio servers,
dependency installs, tests, and dev servers all run inside the sandbox, not in
the control plane process.

## Chosen Shape

Use one long-lived sandbox per user in the first product phase. Inside that
sandbox, run a worker service that is intentionally similar to the current
Remote Codex server, but scoped to a single user sandbox. A sandbox can contain
many workspaces, and each workspace can contain many sessions.

```text
Railway Control Plane API
  user auth
  user management
  sandbox registry
  workspace registry
  session index
  sandbox lifecycle
  route-token issuance
  sub2api user/key management
  usage import
  audit / billing / quotas

EKS Fargate Sandbox Pod
  /workspace
  /home/agent/.codex
  /home/agent/.claude
  /home/agent/.opencode
  /opt/remote-codex-worker
    worker API
    worker websocket
    provider adapters
    local state
    shell and file services
    MCP server launcher
```

The worker is not a global backend. It should not own user registration, billing,
organization membership, project ownership, or sandbox creation. It only serves
requests for the sandbox where it runs.

## Phase-One AWS Runtime Decision

Use EKS Fargate for phase one sandbox workers.

Reasons:

- Kubernetes gives a durable abstraction for one user to one Pod, labels,
  namespaces, service discovery, network policy, and future multi-container
  sidecars.
- Fargate keeps the first deployment away from node-pool management while still
  giving per-Pod isolation and resource sizing.
- The control plane can start with a small AWS adapter that creates, stops, and
  watches Pods, then grow into richer scheduling without changing the worker
  contract.
- EKS keeps the router and worker routing model close to the eventual
  production shape. ECS Fargate remains a fallback if Kubernetes operational
  overhead becomes too high.

The first implementation should use:

- One active sandbox equals one EKS Fargate Pod.
- One Pod contains one worker container.
- One user owns one sandbox in phase one.
- One sandbox can contain many workspaces and sessions.
- Pods run in private subnets.
- The sandbox router is the only public worker entry point.

## Worker Image

Use ECR for the worker image repository:

```text
<aws-account-id>.dkr.ecr.<region>.amazonaws.com/remote-codex-worker
```

Use immutable tags that encode source and release identity:

```text
remote-codex-worker:<git-sha>
remote-codex-worker:<release-version>
remote-codex-worker:staging-<git-sha>
```

`latest` should not be used for sandbox creation. The control plane should store
the exact image tag on the sandbox record and pass it to the AWS adapter.

## Resource Profiles

Phase one should start with named profiles rather than arbitrary user-supplied
CPU and memory:

| Profile | vCPU | Memory | Ephemeral storage | Intended use |
| --- | ---: | ---: | ---: | --- |
| `small` | 0.5 | 1 GB | 20 GB | Light chat, file edits, metadata inspection. |
| `standard` | 1 | 2 GB | 40 GB | Default agent coding and chemistry workflow prep. |
| `large` | 2 | 4 GB | 80 GB | Heavier local package installs and artifact prep. |

Heavy chemistry compute should go through ElAgenteHarness and the job pool, not
through the interactive sandbox profile by default.

## Scaling And Capacity Process

Phase-one scale target:

- Initial staging target: 1-5 active sandboxes.
- Initial production target: 100 active sandboxes.
- Near-term production planning target: 300 active sandboxes.
- Each active sandbox is one EKS Fargate Pod with one worker container.
- One registered user owns one sandbox in phase one; workspaces and sessions
  share that sandbox.

Capacity planning should use resource profiles instead of per-user custom
resources. The default profile is `standard`, so 100 active production sandboxes
means planning for roughly 100 vCPU, 200 GiB memory, and 4 TiB ephemeral storage
requests before router, gateway, database, and observability overhead. `large`
users should be explicitly counted because each one consumes twice the default
vCPU and memory.

Fargate and networking constraints to check before increasing capacity:

- The EKS Fargate profile must match the sandbox namespace and worker labels.
- Private subnets must have enough available IP addresses for the target active
  sandbox count plus rollout/retry headroom.
- NAT or controlled egress must have enough throughput for package installs,
  LLM gateway calls, harness calls, and remote MCP endpoints.
- The worker security group must allow router-to-worker traffic only on the
  worker API port.
- ECR pull throughput and image size must support burst starts.
- CloudWatch log ingestion limits must cover worker stdout/stderr.
- AWS regional Fargate On-Demand vCPU quotas must cover the target active
  profile mix with at least 30 percent headroom.

Capacity request process:

1. Estimate target active sandboxes by profile: `small`, `standard`, `large`.
2. Convert the mix to total requested vCPU and memory using the resource profile
   table above.
3. Add 30 percent headroom for restart storms, failed image pulls, rolling image
   updates, and short-lived duplicate Pods during retries.
4. Confirm subnet free IP capacity exceeds the headroom-adjusted Pod target.
5. Confirm AWS regional Fargate vCPU quota exceeds the headroom-adjusted vCPU
   target.
6. If quota is insufficient, file an AWS Service Quotas request for Fargate
   On-Demand vCPU in the sandbox region and record the requested target in the
   staging readiness notes.
7. Run the staging lifecycle smoke before raising production limits.

The control plane should treat unschedulable Pods and `FailedScheduling` as
capacity failures. Those failures surface as `lastFailureCode=capacity` and
should be visible in admin sandbox detail.

## Namespace And Label Strategy

Phase one uses one Kubernetes namespace per Remote Codex environment:

| Environment | Namespace example | Purpose |
| --- | --- | --- |
| `development` | `remote-codex-sandboxes-dev` | Local or shared developer AWS tests. |
| `staging` | `remote-codex-sandboxes-staging` | Release validation and smoke tests. |
| `production` | `remote-codex-sandboxes` | Customer sandboxes. |

The namespace is configured by `SANDBOX_K8S_NAMESPACE`. The logical
environment name is configured by `SANDBOX_ENVIRONMENT`; if omitted, the AWS
adapter falls back to `NODE_ENV` and then `development`.

Use a single namespace per environment for the first few hundred users. Per-user
namespaces are intentionally deferred because the phase-one model needs fast Pod
creation, simple Fargate profile management, and predictable router discovery.
The boundary for one user to one sandbox is the deterministic Pod/Service name,
control-plane ownership checks, worker route tokens, and Kubernetes labels.

Every sandbox worker Pod and Service must carry these labels:

| Label | Example | Purpose |
| --- | --- | --- |
| `app.kubernetes.io/name` | `remote-codex-worker` | Standard app identity. |
| `app.kubernetes.io/part-of` | `remote-codex` | Groups all product resources. |
| `app.kubernetes.io/component` | `sandbox-worker` | Separates workers from router/control-plane resources. |
| `app.kubernetes.io/managed-by` | `remote-codex-control-plane` | Marks control-plane ownership. |
| `app.kubernetes.io/instance` | `sbx_abc123` | Stable sandbox instance id. |
| `remote-codex.dev/runtime-role` | `worker` | Runtime role for policy and metrics. |
| `remote-codex.dev/cleanup-scope` | `sandbox-worker` | Selector used by cleanup and reaper jobs. |
| `remote-codex.dev/environment` | `production` | Prevents cross-environment cleanup. |
| `remote-codex.dev/sandbox-id` | `sbx_abc123` | Links Kubernetes resources to the sandbox registry. |
| `remote-codex.dev/user-id` | `user_abc123` | Links runtime resources to the owning user. |
| `remote-codex.dev/image-tag` | `staging-a1b2c3d` | Supports image rollout audits. |
| `remote-codex.dev/resource-profile` | `standard` | Supports capacity and cost analysis. |

The adapter also keeps the older `remote-codex/*` labels during migration so
existing tests, dashboards, and exploratory scripts do not break. New code
should use the `remote-codex.dev/*` labels.

Cleanup selectors:

```text
remote-codex.dev/cleanup-scope=sandbox-worker
remote-codex.dev/environment=<environment>
```

For a single sandbox, add:

```text
remote-codex.dev/sandbox-id=<sandbox-id>
```

Reapers, admin detail lookups, route diagnostics, and capacity reports should
use these selectors instead of scanning the full namespace. This keeps the
runtime model viable for hundreds of users while leaving room to move large
customers or high-risk workloads into dedicated namespaces later.

## Pod TTL, Cleanup, And Reaper

Sandbox cleanup is owned by the control plane. Runtime resources are treated as
repairable state derived from the sandbox registry, not as the source of truth.

The phase-one cleanup policy is:

| Case | Default threshold | Action |
| --- | ---: | --- |
| `starting` too long | 15 minutes since `updatedAt` | Poll runtime status and update the registry to `running`, `starting`, `failed`, or `stopped`. |
| `stopping` too long | 10 minutes since `updatedAt` | Poll runtime status. If absent, mark `stopped`; otherwise request stop again. |
| `running` or `degraded` idle | 4 hours since `lastSeenAt`, or fallback `lastStartedAt`/`updatedAt` | Request stop and move registry toward `stopping` or `stopped`. |
| `failed` runtime retained | 1 hour since `updatedAt` | Request runtime cleanup after operators have had time to inspect failure metadata. |
| Runtime resource with no registry row | immediate when listed by cleanup selector | Request runtime cleanup and audit `sandbox.orphan_runtime_cleaned`. |

`lastSeenAt` is the worker heartbeat/activity timestamp used for idle timeout.
If a worker has never reported heartbeat, the reaper falls back to
`lastStartedAt` and then `updatedAt`.

The first implementation exposes:

```text
POST /api/internal/sandboxes/reap
```

The endpoint requires `X-Remote-Codex-Service-Token` and runs one bounded reaper
pass. This shape supports Railway cron, an AWS scheduled job, or a future
control-plane worker process without changing the cleanup logic.

Reaper behavior is intentionally idempotent:

- Repeated stale `starting` checks only poll and rewrite registry state.
- Repeated stale `stopping` checks either keep retrying stop or keep the row
  converged at `stopped`.
- Repeated idle checks use the normal `stopSandbox` path and do not create a new
  runtime.
- Orphan runtime cleanup uses `SandboxManager.cleanupRuntimeResource` when the
  adapter supports runtime listing. Adapters that cannot list runtime resources
  simply skip orphan cleanup while still repairing registry rows.

Before production, the internal endpoint should be triggered every 1-5 minutes.
The interval is deployment policy, not business logic; the thresholds above
remain inside the reaper policy.

## AWS Network Requirements

Minimum phase-one AWS requirements:

- VPC with private subnets for Fargate worker Pods.
- Public entry point only for the sandbox router, for example an ALB or API
  gateway in front of the router service.
- Security group that allows browser-facing traffic to the router and
  router-to-worker traffic on the worker API port.
- No direct public inbound path to worker Pods.
- NAT or controlled egress for package installs, provider gateway calls,
  ElAgenteHarness calls, and approved remote MCP endpoints.
- ECR pull permissions for the worker Pod execution role.
- CloudWatch logs for worker stdout/stderr.
- Secrets injection from AWS Secrets Manager, Kubernetes secrets, or an
  equivalent secret source controlled by the sandbox manager.

The AWS adapter should treat missing subnets, security groups, image repository,
execution role, or route-token signing configuration as configuration errors,
not provider capacity errors.

## Component Responsibilities

### Control Plane

The control plane is the high-trust, multi-tenant layer.

Responsibilities:

- Register, authenticate, and authorize users.
- Manage organizations, memberships, roles, quotas, and billing.
- Store project records and sandbox records.
- Create, start, stop, pause, resume, snapshot, and destroy sandboxes.
- Select sandbox image versions and resource limits.
- Prepare workspace snapshots and upload them to sandboxes.
- Create sub2api users and sandbox API keys.
- Import sub2api usage for quota and billing.
- Issue short-lived route tokens for the AWS sandbox router.
- Store durable thread indexes and worker checkpoints.
- Persist audit logs.
- Apply reviewed sandbox diffs back to the canonical project source.

Non-responsibilities:

- Do not execute user code.
- Do not run Codex, Claude Code, or OpenCode directly.
- Do not launch stdio MCP servers directly for a user workspace.
- Do not proxy normal worker streaming traffic in production.
- Do not parse provider-specific event streams except for coarse indexing and
  billing imports.

### Sandbox Worker

The worker is the low-trust, single-sandbox workspace server.

Responsibilities:

- Serve thread, file, shell, diff, artifact, and runtime APIs for one sandbox.
- Start and manage Codex app-server inside the sandbox.
- Run Claude Code / Claude Agent SDK inside the sandbox.
- Run OpenCode SDK/server inside the sandbox.
- Launch MCP stdio servers inside the sandbox.
- Connect to approved remote MCP servers through sandbox egress.
- Stream agent events to the browser through the control plane proxy.
- Maintain local provider session state.
- Maintain local worker SQLite state.
- Manage `/workspace` file tree and baseline diff state.
- Provide dev server and shell integration.
- Report heartbeat, health, usage, thread summaries, and checkpoints upstream.

Non-responsibilities:

- Do not manage users or organizations.
- Do not store global secrets.
- Do not access host project files directly.
- Do not route requests to other sandboxes.
- Do not trust browser requests without a control-plane-signed token.

## Dependency Placement

Provider runtimes must be installed and executed inside the sandbox.

| Dependency | Location | Reason |
| --- | --- | --- |
| `codex app-server` | Sandbox | Codex tools and shell commands must see sandbox FS only. |
| `@openai/codex` CLI | Sandbox | Same boundary as app-server. |
| Claude Code CLI | Sandbox | Claude tools and subprocesses stay isolated. |
| Claude Agent SDK | Sandbox worker | SDK drives local Claude Code runtime. |
| OpenCode CLI / SDK | Sandbox worker | OpenCode tools and sessions stay isolated. |
| MCP stdio servers | Sandbox | Prevent MCP from bypassing sandbox filesystem. |
| Remote MCP connections | Sandbox | Egress policy can allowlist endpoints. |
| Worker package | Sandbox | Owns local runtime control plane. |
| Control plane app | Outside sandbox | Multi-tenant orchestrator; no user code. |

Use a pinned worker image for normal operation.

```dockerfile
FROM node:22-bookworm

RUN npm install -g \
  @openai/codex@<pinned> \
  @anthropic-ai/claude-code@<pinned> \
  @anthropic-ai/claude-agent-sdk@<pinned> \
  opencode-ai@<pinned> \
  @opencode-ai/sdk@<pinned>

WORKDIR /opt/remote-codex-worker
COPY worker/package.json ./
COPY worker/dist ./dist
RUN npm install --omit=dev

ENV HOME=/home/agent
ENV CODEX_HOME=/home/agent/.codex
ENV CLAUDE_HOME=/home/agent/.claude
ENV CLAUDE_CONFIG_DIR=/home/agent/.claude
ENV OPENCODE_HOME=/home/agent/.opencode

CMD ["node", "/opt/remote-codex-worker/dist/server.js"]
```

Dynamic installation is acceptable for early proof-of-concept work, but the
product path should use pinned images for reproducibility and faster startup.

## Worker Container

The current container worker entrypoint is:

```text
apps/supervisor-api/src/worker-index.ts
```

It is built into the worker image by:

```text
Dockerfile.worker
```

Build locally with:

```bash
pnpm build:worker-image
```

Worker-mode defaults are enabled by:

```text
REMOTE_CODEX_RUNTIME_ROLE=worker
HOST=0.0.0.0
PORT=8787
WORKSPACE_ROOT=/workspace
HOME=/home/agent
CODEX_HOME=/home/agent/.codex
CLAUDE_HOME=/home/agent/.claude
OPENCODE_HOME=/home/agent/.opencode
DATABASE_URL=/home/agent/.remote-codex/worker.sqlite
REMOTE_CODEX_DISABLE_BUILD_RESTART=true
```

## Local Sandbox Development

Local development can run the control plane outside the worker and use the
`LocalWorkerProcessSandboxManager` to start a worker process on the same
machine. This is only for development and tests; production must use an
isolated container or VM runtime.

Control-plane environment:

```text
NODE_ENV=development
CONTROL_PLANE_DATABASE_URL=.local/control-plane-dev.sqlite
CONTROL_PLANE_AUTH_MODE=dev
CONTROL_PLANE_ADMIN_IDENTITIES=dev:admin
SANDBOX_ROUTER_BASE_URL=http://127.0.0.1:8791
SANDBOX_ROUTE_TOKEN_TTL_SECONDS=300
SANDBOX_DEFAULT_IMAGE=remote-codex-worker:development
SANDBOX_DEFAULT_REGION=local
SANDBOX_S3_PREFIX_BASE=s3://remote-codex-sandboxes/dev
CONTROL_PLANE_JWT_SECRET_ID=local-current
CONTROL_PLANE_JWT_SECRET=<local-route-token-secret-at-least-16-chars>
CONTROL_PLANE_JWT_PREVIOUS_SECRETS=local-old:<old-secret-if-rotating>
```

Local worker-process adapter configuration:

```text
SANDBOX_LOCAL_WORKER_COMMAND=<node-or-script-command>
SANDBOX_LOCAL_WORKER_ARGS=<optional-args>
REMOTE_CODEX_WORKER_AUTH_TOKEN=<local-worker-internal-token>
WORKSPACE_ROOT=/workspace
HOME=/home/agent
```

The adapter injects these worker identity variables for each sandbox start:

```text
REMOTE_CODEX_RUNTIME_ROLE=worker
REMOTE_CODEX_SANDBOX_ID=<sandbox-id>
REMOTE_CODEX_USER_ID=<user-id>
REMOTE_CODEX_WORKER_AUTH_TOKEN=<local-worker-internal-token>
WORKSPACE_ROOT=/workspace
HOME=/home/agent
```

The local adapter does not provide filesystem or process isolation by itself.
Use it to validate control-plane API flows, route-token issuance, worker
startup, and UI behavior. Use the worker image or an AWS adapter for isolation
testing.

## Sandbox Lifecycle State Machine

The control plane stores one sandbox row per product user in phase one. The
stored row is the durable product record; the sandbox manager adapter is the
runtime reconciler for local worker processes, EKS Fargate Pods, or a future
runtime.

Canonical control-plane states:

| State | Meaning | Browser behavior |
| --- | --- | --- |
| `stopped` | No worker should be serving traffic for the sandbox. | Show start action. |
| `starting` | Runtime creation has been requested but the worker is not ready. | Show startup progress and disable duplicate starts. |
| `running` | Worker endpoint is routable and ready for route-token traffic. | Allow session open and worker connection. |
| `degraded` | Worker exists but health/readiness checks are failing or incomplete. | Show degraded banner and allow retry/restart. |
| `stopping` | Runtime deletion or graceful shutdown has been requested. | Disable new sessions and show stopping state. |
| `failed` | The last lifecycle transition failed and needs retry or admin action. | Show failure reason and retry/restart action. |
| `deleted` | Sandbox record or runtime is intentionally retired. | Hide from normal user flows except audit/history. |
| `unknown` | Adapter cannot determine runtime state. | Treat as offline and require refresh/reconcile. |

Allowed lifecycle transitions:

```text
stopped  -> starting -> running
starting -> running
starting -> failed
running  -> degraded
degraded -> running
running  -> stopping -> stopped
degraded -> stopping -> stopped
failed   -> starting
failed   -> deleted
stopped  -> deleted
unknown  -> starting
unknown  -> stopping
unknown  -> failed
```

The local adapter currently moves directly to `running` or `stopped` because it
starts a local child process synchronously. The AWS adapter may return
`starting`, `stopping`, `failed`, or `unknown` while Kubernetes reconciles the
Pod and Service.

State fields:

- `state` is the user-visible lifecycle state.
- `statusReason` is a short operator-facing reason for the latest transition or
  failure.
- `k8sNamespace`, `k8sPodName`, and `workerServiceName` identify the runtime
  target when the AWS adapter is used.
- `routerBaseUrl` identifies the public router entry point, not a direct worker
  URL.
- `lastStartedAt` is set when the control plane stores `running`.
- `lastSeenAt` is for future worker heartbeat updates.
- `idleTimeoutAt` is for future idle shutdown policy.

The control plane should persist every lifecycle transition and audit it as
`sandbox.<state>`. Adapter failures should use structured
`SandboxManagerError` codes:

- `quota`: user or plan cannot start the sandbox.
- `capacity`: runtime has no available capacity.
- `config`: local or deployment configuration is invalid.
- `provider`: AWS, Kubernetes, or another provider failed unexpectedly.

## Sandbox Lifecycle Idempotency

All sandbox lifecycle APIs must be safe to retry. Browser retries, Railway
request retries, Kubernetes reconciliation, and admin retries should not create
duplicate sandboxes or leak worker Pods.

Idempotency rules:

- `GET /api/sandbox` must create at most one sandbox row for a user. Repeated
  calls return the same sandbox id.
- `POST /api/sandbox/start` must be idempotent for a sandbox that is already
  `starting` or `running`. The adapter should return the existing target Pod or
  service metadata instead of creating a second runtime.
- `POST /api/sandbox/stop` must be idempotent for `stopping`, `stopped`, and
  missing-runtime cases. Deleting a missing Pod should still converge the
  control-plane row toward `stopped`.
- `POST /api/sandbox/restart` is a composed stop-then-start operation. It must
  reuse the same sandbox id and should replace the runtime target only after the
  old runtime has been stopped or marked failed.
- Admin force-stop uses the same stop path as user stop, but records an
  operator-facing `statusReason` and audit event.
- Future `deleteSandbox` behavior must be idempotent for `deleted` and
  missing-runtime cases. Deletion must not remove audit history.

AWS adapter idempotency requirements:

- Pod names must be deterministic from the sandbox id, for example
  `remote-codex-worker-<sandbox-id>`.
- Kubernetes labels must include sandbox id, user id, runtime role, image tag,
  and resource profile so reconciliation can find existing resources.
- `startSandbox` should create or patch the desired Pod/Service and then return
  `starting` until readiness is observed.
- `stopSandbox` should delete the deterministic Pod/Service if present and then
  return `stopping` or `stopped` depending on observed deletion state.
- `getSandboxStatus` should map Kubernetes `Pending`, `Running`, readiness
  failures, image pull failures, unschedulable capacity, and deleted Pods into
  the canonical control-plane states.
- Endpoint discovery must return the router base URL plus worker service
  identity. It must not expose direct Pod IPs to browsers.

Route-token issuance depends on lifecycle state. The control plane should issue
route tokens only when the stored sandbox state is `running`, the account is
active, and quota checks pass.

Worker metadata is exposed for the router/control plane:

```text
GET /readyz
GET /api/worker/metadata
```

If `REMOTE_CODEX_WORKER_AUTH_TOKEN` is set, all worker APIs except
`/healthz` and `/readyz` require either:

```text
Authorization: Bearer <token>
```

or:

```text
X-Remote-Codex-Worker-Token: <token>
```

The AWS sandbox router should inject this token after validating the user-facing
route token issued by the control plane. Browser-provided identity headers must
not be trusted by the worker directly.

Worker mode disables host-management operations that are appropriate for a
local supervisor but not for an immutable container:

- `POST /api/service/build-restart`
- `POST /api/agent-runtimes/:provider/build-restart`
- `POST /api/agent-runtimes/:provider/install`
- `PATCH /api/config/workspace-settings`
- provider config read/write and archive routes

Runtime status, model listing, workspaces, threads, shell, plugin, and websocket
routes remain available because they are part of the sandbox runtime surface.

## LLM Gateway Bootstrap

The worker can write provider configuration that points Codex, Claude Code, and
OpenCode at the internal LLM gateway instead of real provider keys:

```text
REMOTE_CODEX_LLM_GATEWAY_BASE_URL=https://llm-gateway.example.com
REMOTE_CODEX_LLM_GATEWAY_TOKEN=<sandbox-scoped-token>
```

On startup, worker mode writes:

- `CODEX_HOME/config.toml`
- `CLAUDE_HOME/settings.json`
- `OPENCODE_HOME/opencode.json`

These files point runtimes at the gateway. They do not contain the real OpenAI
or Anthropic provider keys; those stay in sub2api or the future gateway service.
The gateway token should be short-lived, sandbox-scoped, quota-limited, and
revocable.

## Implemented Control Plane API

The current `apps/control-plane-api` implementation is the first pass at this
control plane. It provides:

- `POST /api/auth/register`
- `POST /api/me/bootstrap`
- `GET /api/me`
- `GET /api/admin/users`
- `PATCH /api/admin/users/:userId`
- `GET /api/sandbox`
- `POST /api/sandbox/start`
- `POST /api/sandbox/stop`
- `GET /api/workspaces`
- `POST /api/workspaces`
- `GET /api/workspaces/:workspaceId/sessions`
- `POST /api/workspaces/:workspaceId/sessions`
- `POST /api/sandboxes/:sandboxId/route-token`

Local development can run it with:

```bash
pnpm dev:control-plane
```

The first auth adapter accepts development identities through either:

- `Authorization: Bearer dev:<subject>`
- `X-Auth-Provider` plus `X-Auth-Subject`

Production should replace this verifier with Clerk JWT validation while keeping
the local `control_users` table as the product user record.

Admin APIs require the authenticated identity to be listed in
`CONTROL_PLANE_ADMIN_IDENTITIES` as comma-separated `provider:subject` values,
for example:

```text
CONTROL_PLANE_ADMIN_IDENTITIES=clerk:user_123,dev:admin
```

The admin identity still has to bootstrap into the local `control_users` table
before it can call admin APIs.

Usage data is imported through an admin-only endpoint:

```text
POST /api/admin/usage/import
```

Users read their own usage through:

```text
GET /api/usage/summary
GET /api/usage/events
```

The intended production source for these imported events is sub2api usage data,
normalized into the control plane ledger. The panel should read usage from the
control plane, not directly from sub2api.

## Route Token Flow

The browser should connect to the control plane for product APIs. For worker
traffic, the browser asks the control plane for a route token:

```text
POST /api/sandboxes/:sandboxId/route-token
```

The response contains:

- `routerBaseUrl`
- `wsBaseUrl`
- `token`
- `expiresAt`

Route-token signing supports key rotation:

```text
CONTROL_PLANE_JWT_SECRET_ID=<current-key-id>
CONTROL_PLANE_JWT_SECRET=<current-secret>
CONTROL_PLANE_JWT_PREVIOUS_SECRETS=<old-key-id>:<old-secret>,<older-key-id>:<older-secret>
```

New tokens are signed with the current key and include the current key id in the
JWT header. Verification accepts the current key and configured previous keys.
After all tokens signed by an old key have expired, remove that key from
`CONTROL_PLANE_JWT_PREVIOUS_SECRETS`. Keep route-token TTLs short so rotation
windows stay small.

## Route Token Revocation Strategy

Phase one uses short-lived route tokens plus signing-key rotation rather than a
per-token revocation database.

Current strategy:

- Route tokens default to a 300 second TTL through
  `SANDBOX_ROUTE_TOKEN_TTL_SECONDS`.
- Browser storage must keep route tokens in memory only.
- Account disablement blocks new route-token issuance.
- Session archive/delete blocks new session-scoped route-token issuance.
- Signing-key rotation is the emergency revoke mechanism for all outstanding
  route tokens.
- Removing a previous signing key after the TTL window invalidates any old
  token still presented to the router.

Risk acceptance:

- A single issued token can remain valid until `exp` if it is stolen before
  expiry.
- Production TTL should stay at or below five minutes unless a jti denylist or
  introspection-backed revocation check is added.
- Add per-token revocation before launch if product requirements need immediate
  single-session revoke, admin kill-switch for one browser session, or long
  route-token TTLs.

The AWS sandbox router validates the signed token, checks that the path
`sandboxId` matches the token payload, and proxies HTTP/SSE/WSS to the worker
pod. The worker should only trust identity headers injected by the router, not
browser-supplied headers.

Forwarded requests must include a short-lived signed identity envelope:

```text
X-Remote-Codex-User: user_...
X-Remote-Codex-Project: project_...
X-Remote-Codex-Sandbox: sandbox_...
X-Remote-Codex-Scopes: threads:read threads:write files:read shell:write
X-Remote-Codex-Expires-At: 2026-05-23T...
X-Remote-Codex-Signature: ...
```

The worker verifies the signature, expiry, sandbox id, and scopes before serving
any request. The worker should not query the global user database.

## Why Not Direct `execd` For Agent Protocols

OpenSandbox `execd` is useful for starting commands, managing files, and running
bootstrap tasks. It should not be the primary long-lived protocol bridge for
agent runtimes.

Good uses for `execd`:

- Start the worker process.
- Run image bootstrap commands.
- Install dependencies during proof-of-concept work.
- Perform health checks.
- Run one-off diagnostic commands.
- Upload or download files if the OpenSandbox file API is not enough.

Poor uses for `execd`:

- Holding the Codex app-server stdio JSON-RPC stream directly from the control
  plane.
- Wrapping Claude Agent SDK calls as one-off scripts for every turn.
- Wrapping OpenCode SDK calls as one-off scripts for every turn.
- Treating stdout as the authoritative provider event stream.
- Implementing user-facing WebSocket semantics over a raw command session.

Reasons:

- Codex app-server expects a stable stdio JSON-RPC connection. A remote exec
  stream adds lifecycle, framing, reconnect, stderr, timeout, and backpressure
  failure modes.
- Claude Code and OpenCode are SDK-driven in this codebase. The SDKs should be
  imported by a long-running Node worker inside the sandbox.
- Interrupts should use provider-native APIs, not just kill a process.
- The UI needs semantic events such as `turn.started`, `item.completed`,
  `request.created`, usage updates, and MCP calls. Raw stdout is not enough.
- Browser disconnects should not kill provider sessions.

`execd` should start the worker. The worker should manage provider runtimes.

## Workspace Model

Default to copy, diff, and apply rather than bind mounting the host project.

```text
host canonical project
  -> tar/git snapshot
  -> sandbox /workspace
  -> agent changes files
  -> worker computes diff
  -> user reviews diff
  -> control plane applies accepted changes back to host/project storage
```

If the source project is a git repository, preserve git metadata when useful.
If it is not, initialize a baseline repository inside the sandbox:

```bash
cd /workspace
git init
git add .
git commit -m baseline
```

Then use `git diff --binary HEAD` to export changes. The apply step must enforce
policy before writing back:

- Maximum changed file size.
- Maximum patch size.
- Whether binary patches are allowed.
- Whether symlinks are allowed.
- Whether executable bit changes are allowed.
- Whether deletes are allowed.
- Whether `.git`, secret files, generated credentials, or lockfiles are special.

## Secrets

The control plane owns secrets. The worker receives only the minimum secrets
needed for the sandbox session.

Preferred path:

- Store provider keys encrypted in the control plane.
- Issue short-lived sandbox credentials or model-proxy tokens.
- Inject credentials as environment variables or mounted secret files.
- Never expose secrets through worker APIs.
- Redact secrets in logs and transcripts.
- Revoke or expire credentials when the sandbox is stopped or destroyed.

Long term, prefer a model gateway:

```text
Sandbox Worker
  -> Control Plane Model Proxy
    -> OpenAI / Anthropic / other provider
```

Then the worker only receives a short-lived sandbox token, not the user's raw
provider key.

## MCP Policy

MCP can bypass filesystem isolation if pointed at host services. Treat MCP as a
privileged integration surface.

Default rules:

- Run stdio MCP servers inside the sandbox.
- Use remote MCP servers only through sandbox egress allowlists.
- Do not connect sandbox workers to host-local filesystem, shell, database, or
  Docker MCP servers by default.
- Store MCP configuration in sandbox-local provider homes.
- Enable only approved MCP servers and tools.
- Audit MCP tool calls and server startup failures.

Codex, Claude Code, and OpenCode each have their own MCP configuration format.
The worker should own provider-specific config rendering.

## State Ownership

Control plane state:

- Users, organizations, roles, sessions.
- Projects and sandbox records.
- Sandbox image, resource, route, and lifecycle state.
- Durable thread index: id, title, owner, sandbox id, status, last activity.
- Checkpoint pointers and transcript archives.
- Usage summaries and billing aggregates.
- Audit logs.
- Encrypted secrets.

Worker state:

- Provider session ids.
- Detailed turns and history items.
- Live request state and pending approvals.
- Shell sessions and PTY process state.
- Workspace file baseline.
- Local provider config and caches.
- Local artifacts and temporary files.

Workers should checkpoint summaries and archives back to the control plane on
thread completion, idle timeout, pause, and sandbox shutdown.

## Security Invariants

- The control plane never runs user code.
- Provider runtimes run only inside sandboxes.
- The worker can only serve requests for its sandbox id.
- The worker receives scoped, short-lived credentials.
- Browser requests reach the worker only after control-plane authorization.
- Worker routes still verify signed identity envelopes.
- The sandbox cannot reach private/internal networks unless explicitly allowed.
- Host project files are not writable by the sandbox by default.
- Diffs are reviewed and policy-checked before write-back.
- MCP stdio servers run inside the sandbox unless explicitly trusted otherwise.

## Initial Milestones

### Milestone 1: Worker Shell

- Build a minimal worker image.
- Start the worker through OpenSandbox.
- Proxy `/health` and `/ready` through the control plane.
- Validate signed request headers in the worker.

### Milestone 2: Workspace Snapshot

- Upload a project snapshot to `/workspace`.
- Initialize a baseline.
- Return file tree and diff through worker APIs.
- Destroy sandbox without touching host project files.

### Milestone 3: Codex In Sandbox

- Install pinned Codex in the worker image.
- Start `codex app-server` from the worker.
- Support `startSession`, `startTurn`, `readSession`, and `interrupt`.
- Stream provider events through the worker WebSocket.

### Milestone 4: Review And Apply

- Export diff from `/workspace`.
- Show diff in the control-plane UI.
- Apply accepted changes back to the canonical project.
- Reject policy-violating patches.

### Milestone 5: Claude And OpenCode

- Move Claude Agent SDK execution into the worker.
- Move OpenCode SDK execution into the worker.
- Preserve the same worker RPC contract across providers.

### Milestone 6: MCP And Network Policy

- Render sandbox-local MCP configs for each provider.
- Launch stdio MCP servers inside the sandbox.
- Configure remote MCP egress allowlists.
- Audit MCP tool calls.

### Milestone 7: Checkpoints

- Save worker transcript archives.
- Save sandbox snapshots.
- Resume a stopped sandbox into the same worker state.

## Open Questions

- Is one sandbox per thread enough, or should a sandbox own multiple threads for
  one workspace?
- Should the canonical project live in local host storage, object storage, or a
  git remote in the first cloud-oriented version?
- Should provider keys be injected directly at first, or should a model proxy be
  built before external users?
- Which OpenSandbox runtime should be required for untrusted workloads: Docker,
  gVisor, Kata Containers, or Firecracker?
- How much of the current supervisor API should be reused directly in the
  worker package versus split into provider-neutral libraries first?
