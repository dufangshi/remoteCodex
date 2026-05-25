# Remote Codex Sandbox Architecture

This branch documents the product direction where Remote Codex becomes a
multi-tenant control plane plus a per-sandbox workspace worker.

Recommended reading order:

1. [Agente Product Architecture](./agente-product-architecture.md)
2. [Architecture Decision Log](./architecture-decisions.md)
3. [Current Branch Status](./status.md)
4. [Staging Release Readiness](./staging-release-readiness.md)
5. [Release Gates](./release-gates.md)
6. [User Data Export And Deletion Policy](./user-data-policy.md)
7. [LLM Gateway Contract](./llm-gateway-contract.md)
8. [Control Plane To Sandbox Worker](./control-plane-sandbox-worker.md)
9. [Control Plane Auth](./control-plane-auth.md)
10. [Control Plane Session To Worker Contract](./control-plane-session-worker-contract.md)
11. [Local Control Plane, Router, And Worker Smoke](./local-control-plane-worker-smoke.md)
12. [Remote Codex Side Work Breakdown And Checklist](./remote-codex-side-work-breakdown.md)
13. [Remote Codex Side Detailed Checklist](./remote-codex-side-detailed-checklist.md)
14. [Remote Codex Side Execution Checklist](./remote-codex-side-execution-checklist.md)
15. [Remote Codex Side Delivery Checklist](./remote-codex-side-delivery-checklist.md)
16. [Remote Codex Side Implementation Plan](./remote-codex-side-implementation-plan.md)
17. [Remote Codex Side Task Checklist](./remote-codex-side-task-checklist.md)
18. [Remote Codex Implementation Checklist](./remote-codex-implementation-checklist.md)

Use the detailed checklist as the active one-item-at-a-time execution board.
Update it as each implementation slice lands. The work breakdown keeps the
near-term queue, while the execution checklist and status document keep phase
evidence and current release risk. The delivery checklist, implementation plan,
and task checklist preserve the broader inventory and historical phase detail.

The control plane owns users, projects, sandbox lifecycle, routing, secrets,
policy, and durable indexes. The worker runs inside each sandbox and owns the
workspace, agent runtime, shell, MCP servers, live thread events, and local
provider state.
