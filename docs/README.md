# Remote Codex Sandbox Architecture

This branch documents the product direction where Remote Codex becomes a
multi-tenant control plane plus a per-sandbox workspace worker.

Recommended reading order:

1. [Agente Product Architecture](./agente-product-architecture.md)
2. [Remote Codex Side Product Task Checklist](./remote-codex-side-product-task-checklist.zh.md)
3. [Current Branch Status](./status.md)
4. [Staging Release Readiness](./staging-release-readiness.md)
5. [Release Gates](./release-gates.md)
6. [Architecture Decision Log](./architecture-decisions.md)
7. [User Data Export And Deletion Policy](./user-data-policy.md)
8. [LLM Gateway Contract](./llm-gateway-contract.md)
9. [Control Plane To Sandbox Worker](./control-plane-sandbox-worker.md)
10. [Control Plane Auth](./control-plane-auth.md)
11. [Control Plane Session To Worker Contract](./control-plane-session-worker-contract.md)
12. [Local Control Plane, Router, And Worker Smoke](./local-control-plane-worker-smoke.md)
13. [Remote Codex Side Detailed Checklist](./remote-codex-side-detailed-checklist.md)
14. [Remote Codex Side Action Checklist](./remote-codex-side-action-checklist.zh.md)
15. [Remote Codex Side Work Breakdown And Checklist](./remote-codex-side-work-breakdown.md)

Use the Chinese product task checklist as the primary step-by-step task board
for new Remote Codex side work. Each checkbox is intended to be small enough to
implement, verify, check off, and commit as a standalone slice. It covers the
current product direction from Phase 0-6 staging evidence through
ElAgenteHarness, MCP/tool policy, persistence, billing, deployment, and
end-to-end acceptance.

Use the detailed checklist as the authoritative Phase 0-6 evidence board
because the Phase 0-6 verification scripts read it directly. The work breakdown
keeps the near-term queue, while the execution checklist, action checklist, and
status document keep phase evidence and current release risk. Older delivery,
implementation, and task checklist files are historical references unless a
current status note explicitly points to them.

The control plane owns users, projects, sandbox lifecycle, routing, secrets,
policy, and durable indexes. The worker runs inside each sandbox and owns the
workspace, agent runtime, shell, MCP servers, live thread events, and local
provider state.
