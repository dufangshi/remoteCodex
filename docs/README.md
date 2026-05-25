# Remote Codex Sandbox Architecture

This branch documents the product direction where Remote Codex becomes a
multi-tenant control plane plus a per-sandbox workspace worker.

Recommended reading order:

1. [Agente Product Architecture](./agente-product-architecture.md)
2. [Architecture Decision Log](./architecture-decisions.md)
3. [Current Branch Status](./status.md)
4. [Control Plane To Sandbox Worker](./control-plane-sandbox-worker.md)
5. [Control Plane Auth](./control-plane-auth.md)
6. [Control Plane Session To Worker Contract](./control-plane-session-worker-contract.md)
7. [Remote Codex Side Implementation Plan](./remote-codex-side-implementation-plan.md)
8. [Remote Codex Side Task Checklist](./remote-codex-side-task-checklist.md)
9. [Remote Codex Implementation Checklist](./remote-codex-implementation-checklist.md)

The control plane owns users, projects, sandbox lifecycle, routing, secrets,
policy, and durable indexes. The worker runs inside each sandbox and owns the
workspace, agent runtime, shell, MCP servers, live thread events, and local
provider state.
