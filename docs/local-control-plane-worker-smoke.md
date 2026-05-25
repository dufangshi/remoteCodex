# Local Control Plane, Router, And Worker Smoke

This document describes the local smoke path for the phase-one sandbox-worker
shape.

The smoke does not require AWS, Docker, Railway, or a real LLM gateway. It uses
in-process Fastify apps to exercise the same route-token, router proxy, and
worker-auth code paths used by the deployed services.

## Command

```bash
pnpm smoke:local-route-token
```

The command runs `scripts/local-route-token-smoke.ts`.

## What It Starts

The script creates a temporary local environment and starts:

- A worker-mode `supervisor-api` instance.
- A `sandbox-router` instance.
- A `control-plane-api` instance.

All three services listen on ephemeral localhost ports and are closed when the
script exits. Temporary SQLite databases, provider homes, and workspace
directories are removed at the end of the run.

## What It Verifies

The smoke verifies this path:

1. The control plane bootstraps a local dev user.
2. The control plane creates the user's phase-one sandbox record.
3. The control plane starts the sandbox through the local manager path.
4. The control plane issues a short-lived route token.
5. The browser-style request calls the sandbox router with the route token.
6. The router validates the route token.
7. The router strips the browser `Authorization` header from worker traffic.
8. The router injects the internal worker token and signed worker identity.
9. The worker accepts the proxied request.
10. The worker returns `/api/worker/metadata` in worker mode.

Expected output:

```json
{
  "ok": true,
  "sandboxId": "<control-plane-sandbox-id>",
  "workerRole": "worker",
  "workerSandboxId": "local-smoke-sandbox",
  "routerBaseUrl": "http://127.0.0.1:<ephemeral-port>"
}
```

## What It Does Not Verify

This smoke is intentionally local and narrow. It does not verify:

- EKS Fargate Pod creation.
- Real worker container startup from `Dockerfile.worker`.
- Railway deployment configuration.
- Browser rendering.
- WebSocket reconnect behavior.
- Real Codex, Claude Code, or OpenCode provider calls.
- LLM gateway credential provisioning.
- ElAgenteHarness key injection.
- Workspace snapshot persistence.

Those checks remain separate checklist items.

## Troubleshooting

- If the script cannot bind a localhost port, rerun it. Ports are ephemeral.
- If route-token verification fails, confirm `CONTROL_PLANE_JWT_SECRET` and
  `CONTROL_PLANE_JWT_SECRET_ID` are shared between the control plane and router
  setup inside the script.
- If worker metadata returns `401`, confirm
  `SANDBOX_ROUTER_WORKER_AUTH_TOKEN` matches
  `REMOTE_CODEX_WORKER_AUTH_TOKEN`.
- If worker metadata returns `403`, confirm
  `SANDBOX_ROUTER_WORKER_IDENTITY_SECRET` matches
  `REMOTE_CODEX_WORKER_IDENTITY_SECRET`.

