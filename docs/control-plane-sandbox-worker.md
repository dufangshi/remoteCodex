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
