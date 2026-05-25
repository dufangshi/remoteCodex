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
7. [Local Control Plane, Router, And Worker Smoke](./local-control-plane-worker-smoke.md)
8. [Remote Codex Side Delivery Checklist](./remote-codex-side-delivery-checklist.md)
9. [Remote Codex Side Execution Checklist](./remote-codex-side-execution-checklist.md)
10. [Remote Codex Side Implementation Plan](./remote-codex-side-implementation-plan.md)
11. [Remote Codex Side Task Checklist](./remote-codex-side-task-checklist.md)
12. [Remote Codex Implementation Checklist](./remote-codex-implementation-checklist.md)

Use the delivery checklist as the active execution board. The implementation
checklist is the detailed one-item-at-a-time board for unchecked Remote Codex
side work. The implementation plan and task checklist keep the broader
inventory and historical phase detail.

The control plane owns users, projects, sandbox lifecycle, routing, secrets,
policy, and durable indexes. The worker runs inside each sandbox and owns the
workspace, agent runtime, shell, MCP servers, live thread events, and local
provider state.
