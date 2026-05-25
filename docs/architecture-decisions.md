# Architecture Decision Log

This document records product and deployment decisions that affect the Remote
Codex side of the Agente architecture. It is intentionally short: each entry
captures the current decision, why it exists, and what would require revisiting
it.

## ADR-001: Remote Codex Owns The Product Control Plane

Status: accepted.

Decision: Remote Codex owns the browser product surface, control-plane API,
user/project/workspace/session records, sandbox registry, route-token issuance,
worker image, and worker bootstrap.

Remote Codex integrates with external systems through explicit contracts:

- The LLM gateway owns real provider keys, request forwarding, model limits, and
  raw provider usage records.
- ElAgenteHarness owns chemistry workflow definitions, task state, and
  chemistry compute orchestration.
- Modal, AWS Batch, HPC, or similar compute workers own heavy chemistry job
  execution.

Rationale: this keeps Remote Codex focused on product identity, workspace UX,
sandbox lifecycle, routing, and billing aggregation without absorbing every
provider or chemistry backend.

Revisit when: gateway, harness, or compute responsibilities move into this
repository, or when a separate control-plane service replaces this repository's
control-plane API.

## ADR-002: Phase One Uses One EKS Fargate Pod Per User Sandbox

Status: accepted for phase one.

Decision: phase one uses EKS on Fargate as the AWS sandbox runtime. One active
sandbox maps to one Kubernetes Pod, and one product user maps to one sandbox.
The first implementation uses a single container in each Pod.

The sandbox worker owns:

- `/workspace`.
- Multiple workspace directories under the same user sandbox.
- Multiple sessions per workspace.
- Codex, Claude Code, OpenCode, MCP, shell, and local timeline state.

Rationale: Kubernetes gives us Pod lifecycle APIs, service discovery, logs,
resource controls, and a path to more advanced scheduling later. Fargate avoids
managing EC2 node groups during the first production phase.

Revisit when: cold start, cost, network routing, GPU/HPC adjacency, or custom
kernel/filesystem requirements make Fargate unsuitable.

## ADR-003: Real Provider Root Keys Stay Outside The Sandbox

Status: accepted.

Decision: sandbox workers do not receive raw OpenAI, Anthropic, or other
provider root keys. Provider CLIs and SDKs inside the sandbox point to the LLM
gateway base URL and use scoped gateway tokens.

The control plane may provision or rotate gateway credentials through gateway
admin APIs, but the gateway is the system that stores and uses real provider
root keys.

Rationale: users and agents can read and write inside `/workspace`, and agents
can invoke tools. Keeping root provider keys outside the sandbox reduces the
impact of prompt injection, tool compromise, and accidental file disclosure.

Revisit when: a provider runtime cannot operate through the gateway or requires
a credential model that cannot be scoped per user or sandbox.

## ADR-004: Browser Traffic Reaches Workers Through Route Tokens

Status: accepted.

Decision: browsers do not call a naked worker endpoint with long-lived internal
worker credentials. The control plane issues short-lived route tokens, and a
router or proxy validates those tokens before forwarding traffic to the worker.
The router injects the internal worker token and strips browser-supplied
internal headers.

Rationale: this separates product identity from worker-internal authentication,
limits token lifetime, supports revocation and audit, and makes direct worker
exposure less dangerous.

Revisit when: workers become private-only with no browser path, or when a
managed edge/gateway product supplies equivalent token verification and header
injection semantics.

## ADR-005: Product Auth Terminates At The Control Plane

Status: accepted.

Decision: product login, signup, account status, and admin user management live
at the Railway-hosted frontend/control-plane layer. Product auth tokens are
validated by the control plane and are not forwarded to sandbox worker APIs.

Local development can use `dev:<subject>` bearer auth. Production-style
deployments use a JWT-compatible auth provider with issuer and audience checks.

Rationale: sandbox workers should not need to understand product auth provider
semantics. They receive sandbox identity, worker internal credentials, scoped
gateway credentials, and scoped harness credentials instead.

Revisit when: a worker-side feature requires user-level authorization decisions
that cannot be expressed as route-token scopes or signed identity envelopes.

## ADR-006: Local, Staging, And Production Modes Are Separate

Status: accepted.

Decision: Remote Codex uses three operational modes with different safety and
integration expectations.

- Local development mode can use dev bearer auth, a local worker-process sandbox
  adapter, local databases, and mock gateway or harness clients.
- Staging mode should use production-style JWT auth, the real control-plane API,
  a real sandbox runtime, test gateway credentials, test harness credentials,
  and staging object/database resources.
- Production mode should use production auth, production databases, secure
  secret storage, route-token key rotation, gateway/harness credential rotation,
  audited sandbox lifecycle events, and least-privilege AWS permissions.

Rationale: mixing local shortcuts into staging or production would make sandbox
and credential boundaries hard to reason about.

Revisit when: CI or preview environments need an additional documented mode.
