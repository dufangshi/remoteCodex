# Agente Product Architecture

## Goal

Agente should let users run agent-driven computational chemistry work through a
simple web interface, while hiding the complexity of model providers,
sandboxing, workflow services, job queues, and compute clusters.

The product should provide:

- A simple login and project/session UI.
- Per-user isolated agent runtimes.
- Uniform billing across LLM usage, workflow usage, heavy compute, and storage.
- Automatic configuration for Codex, Claude Code, OpenCode, MCP, and chemistry
  workflow tools.
- Access to computational chemistry workflows through ElAgenteHarness.
- Heavy compute execution through a managed job pool instead of the interactive
  sandbox.

## High-Level Shape

```text
Browser
  -> Remote Codex Web
  -> Control Plane API
     - auth
     - users
     - projects
     - workspaces
     - sessions
     - sandbox registry
     - billing / quotas
     - route-token issuance
     - gateway usage import
     - harness usage import

  -> Sandbox Router
     - validates short-lived route tokens
     - proxies HTTP / WSS to one worker
     - injects internal worker token

  -> Sandbox Worker
     - remote-codex supervisor-api in worker mode
     - Codex / Claude Code / OpenCode
     - workspace files
     - shell / tmux
     - MCP servers
     - local timeline and provider state
     - ElAgenteHarness client config

Sandbox Worker
  -> LLM Gateway
     - sub2api or lightweight gateway
     - real provider keys
     - user/sandbox scoped gateway tokens
     - LLM usage accounting

Sandbox Worker
  -> ElAgenteHarness / inact
     - workflow skills
     - task state
     - chemistry tool APIs
     - job submission
     - artifact metadata

ElAgenteHarness / inact
  -> Job Pool
     - Modal workers
     - AWS Batch / ECS / Kubernetes workers
     - HPC / Slurm adapters
     - ORCA and other heavy compute
```

## Component Responsibilities

### Remote Codex Web

Deploy on Railway for the first product phase.

Responsibilities:

- Login and registration UI.
- Project, workspace, and session UI.
- Chat, timeline, shell, artifact, and diff views.
- User usage and billing views.
- Route-token acquisition from the control plane.
- Browser connection to the sandbox router.

Non-responsibilities:

- Do not hold real OpenAI, Anthropic, Modal, AWS, or ElAgenteHarness root
  credentials.
- Do not connect directly to a naked worker public URL.
- Do not own sandbox lifecycle decisions.
- Do not execute chemistry workflows or heavy compute.

### Control Plane API

Deploy on Railway initially. It may later move to AWS if tighter integration
with sandbox infrastructure becomes necessary.

Responsibilities:

- User registration, login, and product identity.
- User DB and product records.
- Project, workspace, and session metadata.
- Sandbox registry and lifecycle.
- Sandbox image version and resource policy.
- Short-lived worker route-token issuance.
- Generation and rotation of sandbox-scoped service credentials.
- Mapping users to LLM gateway tokens.
- Mapping users to ElAgenteHarness `INACT_X_APP_KEY` credentials.
- Usage import from the LLM gateway.
- Usage import or webhook ingestion from ElAgenteHarness.
- Billing ledger, quotas, limits, and audit logs.

Non-responsibilities:

- Do not run Codex, Claude Code, or OpenCode.
- Do not run user shell commands.
- Do not launch MCP stdio servers.
- Do not run ORCA or other heavy compute directly.
- Do not store real provider root keys when a gateway can own them.

### Business DB

Use Railway Postgres, AWS RDS, or a managed Postgres service.

Core records:

- Users.
- Projects.
- Workspaces.
- Sessions.
- Sandbox registry entries.
- LLM gateway credentials and key ids.
- ElAgenteHarness credentials.
- Usage ledger entries.
- Billing and quota records.
- Audit events.

The business DB should not be the store for raw provider root keys. If any
sensitive token must be stored, store it encrypted and keep its scope narrow.

### Sandbox Router

The router is the production entry point to workers.

Responsibilities:

- Validate control-plane-issued route tokens.
- Confirm route token user, sandbox, scopes, and expiry.
- Resolve `sandboxId` to a live worker endpoint.
- Proxy HTTP, SSE, and WebSocket traffic to the worker.
- Inject the internal worker token:

```text
X-Remote-Codex-Worker-Token: <internal-worker-token>
```

- Optionally inject a signed identity envelope for worker-side scope checks.
- Rate limit and audit worker traffic.

Non-responsibilities:

- Do not own product auth.
- Do not issue user sessions.
- Do not expose the internal worker token to the browser.
- Do not do agent runtime orchestration.

The browser should not connect to a worker public URL without this router layer.
If a worker needs a public URL for infrastructure reasons, it should still
reject requests that do not carry the router-injected token.

### Sandbox Worker

Deploy inside AWS EKS Fargate, ECS Fargate, OpenSandbox, or another isolated
container/VM environment. The first phase is one user to one sandbox, with one
Pod and one container per sandbox.

Responsibilities:

- Run `remote-codex supervisor-api` in worker mode.
- Own `/workspace`.
- Own local provider homes under `/home/agent`.
- Manage Codex, Claude Code, and OpenCode inside the sandbox.
- Manage shell, tmux, files, artifacts, diffs, and local provider sessions.
- Launch approved MCP stdio servers inside the sandbox.
- Store local worker state.
- Call the LLM gateway using a sandbox/user-scoped gateway token.
- Call ElAgenteHarness using `INACT_X_APP_KEY`.
- Report health, readiness, and metadata to the router/control plane.

Non-responsibilities:

- Do not manage user registration.
- Do not own billing logic.
- Do not store real provider root keys.
- Do not create or destroy other sandboxes.
- Do not access project files outside `/workspace`.
- Do not trust browser-supplied identity headers.

### LLM Gateway

The first implementation can use sub2api or a lightweight compatible gateway.

Responsibilities:

- Store real provider root keys.
- Issue user-scoped or sandbox-scoped gateway tokens.
- Route OpenAI-compatible and Anthropic-compatible requests.
- Apply model allowlists and rate limits.
- Track usage by user, sandbox, key, model, and time.
- Expose usage data to the control plane for billing.
- Revoke or rotate individual user/sandbox tokens.

The sandbox receives only:

```text
REMOTE_CODEX_LLM_GATEWAY_BASE_URL=https://gateway.example.com
REMOTE_CODEX_LLM_GATEWAY_TOKEN=<sandbox-scoped-token>
```

It should not receive real OpenAI or Anthropic keys.

### ElAgenteHarness / inact

Project path:

```text
/home/u/dev/ElAgente/harness/ElAgenteHarness
```

Deploy as a separate service, likely on Railway in the first phase.

Responsibilities:

- Provide computational chemistry workflow skills.
- Provide workflow metadata and tool descriptions to agents.
- Manage task creation, task status, and task artifacts.
- Provide chemistry-specific APIs.
- Accept authenticated requests from sandbox agents.
- Submit heavy compute jobs to a job pool.
- Track job status and artifact metadata.
- Expose usage records or usage webhooks to the control plane.

Sandbox authentication should use:

```text
ELAGENTE_HARNESS_BASE_URL=https://harness.example.com
INACT_X_APP_KEY=<sandbox-or-user-scoped-key>
```

The key should be generated by the control plane when a user or sandbox is
created, then injected into the sandbox environment. Treat this key as
potentially readable inside the sandbox, so it must be scoped, revocable,
rotatable, and quota-limited.

Recommended key binding:

```text
key -> userId
key -> sandboxId
key -> scopes
key -> quota profile
key -> createdAt / expiresAt / revokedAt
```

Recommended initial scopes:

- `workflow:read`
- `task:create`
- `task:read`
- `job:create`
- `job:read`
- `artifact:read`
- `artifact:write`

### Job Pool

Heavy compute should not run in the interactive sandbox by default. The sandbox
should call ElAgenteHarness, and ElAgenteHarness should submit work to a job
pool.

Candidate backends:

- Modal workers.
- AWS Batch.
- ECS or EKS worker pools.
- HPC / Slurm adapters.

Responsibilities:

- Run ORCA and other expensive computational chemistry tasks.
- Fetch job inputs.
- Execute the job.
- Upload logs, results, and artifacts.
- Report status and cost metadata back to ElAgenteHarness.

This keeps sandbox startup fast, makes compute billing easier, and avoids
placing Modal or HPC credentials in the agent sandbox.

## Request Flows

### User Login

```text
Browser
  -> Control Plane API
  -> Business DB
```

The browser receives a normal product session. This session is only for the
control plane and should not be injected into the sandbox.

### Enter A Project Or Session

```text
Browser
  -> Control Plane API
     -> validates user session
     -> loads project/workspace/session metadata
     -> ensures user sandbox exists
     -> creates route token
```

The response includes:

- `sandboxId`
- `routerBaseUrl`
- `wsBaseUrl`
- `routeToken`
- `expiresAt`

### Connect To Worker

```text
Browser
  -> Sandbox Router with route token
  -> Sandbox Worker with internal worker token
```

The worker accepts the request only if the router-injected worker token is
valid. For higher assurance, the worker can also verify a signed identity
envelope that includes user, sandbox, scopes, and expiry.

### Agent Calls An LLM

```text
Codex / Claude Code / OpenCode inside sandbox
  -> LLM Gateway
  -> OpenAI / Anthropic / other provider
```

The worker image and startup bootstrap configure each provider runtime to use
the gateway URL and sandbox-scoped gateway token.

### Agent Calls A Chemistry Workflow

```text
Agent inside sandbox
  -> MCP / skill / local tool wrapper
  -> ElAgenteHarness / inact with INACT_X_APP_KEY
```

ElAgenteHarness maps the key to user and sandbox identity, checks quota and
scope, then executes the workflow or submits a job.

### Heavy Compute

```text
Agent
  -> ElAgenteHarness
  -> Job queue
  -> Modal / compute worker
  -> object storage and status update
  -> ElAgenteHarness
  -> Agent / UI
```

Artifacts should be stored in object storage with metadata in ElAgenteHarness
and/or the control plane. The sandbox may cache artifacts, but object storage
should be the durable source.

## Data Model Sketch

Control plane:

```text
User
  id
  email
  displayName
  createdAt

Project
  id
  userId
  name
  createdAt

Sandbox
  id
  userId
  status
  provider
  endpoint
  imageVersion
  resourceProfile
  internalWorkerTokenHash
  createdAt
  lastStartedAt
  lastStoppedAt

Workspace
  id
  userId
  sandboxId
  projectId
  name
  path
  createdAt

Session
  id
  userId
  workspaceId
  sandboxId
  provider
  title
  createdAt
  updatedAt

GatewayCredential
  id
  userId
  sandboxId
  gatewayProvider
  gatewayKeyId
  encryptedGatewayToken
  status
  createdAt
  rotatedAt

HarnessCredential
  id
  userId
  sandboxId
  keyHash
  scopes
  status
  createdAt
  rotatedAt

UsageLedger
  id
  userId
  source
  externalId
  units
  costUsd
  metadata
  createdAt
```

ElAgenteHarness:

```text
Workflow
  id
  name
  version
  description
  requiredInputs
  outputTypes

Task
  id
  userId
  sandboxId
  workflowId
  status
  inputs
  outputs
  createdAt
  updatedAt

ComputeJob
  id
  taskId
  backend
  status
  resourceSpec
  costEstimate
  costActual
  logsUrl
  artifacts
```

## Sandbox Environment Contract

The control plane or sandbox manager should inject:

```text
REMOTE_CODEX_RUNTIME_ROLE=worker
REMOTE_CODEX_SANDBOX_ID=<sandbox-id>
REMOTE_CODEX_USER_ID=<user-id>
REMOTE_CODEX_WORKER_AUTH_TOKEN=<router-to-worker-token>
REMOTE_CODEX_LLM_GATEWAY_BASE_URL=https://gateway.example.com
REMOTE_CODEX_LLM_GATEWAY_TOKEN=<sandbox-scoped-gateway-token>
ELAGENTE_HARNESS_BASE_URL=https://harness.example.com
INACT_X_APP_KEY=<sandbox-or-user-scoped-harness-key>
WORKSPACE_ROOT=/workspace
HOME=/home/agent
CODEX_HOME=/home/agent/.codex
CLAUDE_HOME=/home/agent/.claude
CLAUDE_CONFIG_DIR=/home/agent/.claude
OPENCODE_HOME=/home/agent/.opencode
```

Worker startup should:

- Render Codex gateway config.
- Render Claude Code gateway config.
- Render OpenCode gateway config.
- Render MCP/tool config for ElAgenteHarness.
- Redact service tokens from logs, API responses, and timeline output.
- Disable provider host config read/write APIs in worker mode.

## Security Invariants

- The control plane never executes user code.
- Provider runtimes run only inside the sandbox.
- The browser does not receive internal worker tokens.
- The worker only trusts the router, not browser identity headers.
- Real provider root keys stay in the LLM gateway.
- The sandbox receives only scoped, revocable service tokens.
- `INACT_X_APP_KEY` is treated as leakable and scoped accordingly.
- MCP stdio servers run inside the sandbox.
- Heavy compute credentials stay outside the sandbox.
- Workspace access is limited to `/workspace`.
- Artifacts and usage records have a durable owner and billing account.

## First Product Phase

The first deployable phase should be intentionally narrow:

- Railway:
  - Remote Codex Web.
  - Control Plane API.
  - Business DB.
  - Optional initial LLM gateway if sub2api is hosted there.
- AWS:
  - One sandbox worker per user.
  - One Pod/container per sandbox.
  - Sandbox router.
- ElAgenteHarness:
  - Separate Railway service.
  - `INACT_X_APP_KEY` authentication.
  - Workflow list, task create, task status, artifact metadata.
- Compute:
  - Modal worker for one or two representative chemistry workflows.
- Billing:
  - Usage ledger first.
  - Real payment and invoicing after the usage paths are reliable.

## Later Scaling Direction

- Move sandbox lifecycle from manual adapter to a robust AWS sandbox manager.
- Add autoscaling and idle shutdown for sandboxes.
- Add S3 snapshot or EFS-backed workspace persistence.
- Add per-organization users and team billing.
- Add quota preflight before route-token issuance and job creation.
- Add webhook ingestion from LLM gateway and ElAgenteHarness.
- Add resource profiles for CPU, memory, GPU, and storage.
- Add multiple compute backends behind ElAgenteHarness.
- Add per-workflow cost estimation before job submission.
