# Remote Codex Sandbox Requirements

Last updated: 2026-05-28

This document describes what a usable Remote Codex sandbox must contain and what is still missing in the current EKS/Railway deployment. It is intended as an implementation handoff for the next agent.

## Current Deployed Baseline

The current branch can create an EKS/Fargate worker Pod and a private worker Service from the Railway control-plane.

Observed running sandbox:

- AWS region: `ca-central-1`
- EKS namespace: `remote-codex-staging`
- Worker Pod: `remote-codex-worker-9ed35585-4d38-494d-be8e-cff65f5b3f15`
- Worker Service type: `ClusterIP`
- Worker port: `8787`
- Router: public LoadBalancer forwarding to private worker Services
- Worker image: `918876873590.dkr.ecr.ca-central-1.amazonaws.com/remote-codex-worker-staging:ea97a72`
- Branch pushed to: `origin/sandbox-worker-control-plane`
- Worker image source commit: `ea97a72`
- Latest control-plane branch commit: `5fdf4f8`

Current worker `/readyz` response is healthy and reports Codex as the only enabled runtime:

```json
{
  "status": "ready",
  "worker": {
    "role": "worker",
    "sandboxId": "9ed35585-4d38-494d-be8e-cff65f5b3f15",
    "userId": "7811a2dd-a2d8-43f2-a637-bdfacb50ef90",
    "workspaceRoot": "/workspace"
  },
  "runtimes": [
    {
      "provider": "codex",
      "enabled": true,
      "status": {
        "state": "ready"
      }
    }
  ]
}
```

The important remaining limitation is that control-plane workspace/session rows are not yet materialized into real worker workspaces and Codex sessions. The sandbox has a ready Codex runtime, but the product path does not yet run a real prompt through that runtime.

## Required Sandbox Contract

A usable sandbox must provide all of the following.

## 1. Worker API

The worker must run the supervisor API in worker mode and expose it on the internal worker port.

Required:

- `REMOTE_CODEX_RUNTIME_ROLE=worker`
- `REMOTE_CODEX_SANDBOX_ID=<sandbox id>`
- `REMOTE_CODEX_USER_ID=<control-plane user id>`
- `WORKSPACE_ROOT=/workspace`
- `HOME=/home/agent`
- HTTP API listening on `0.0.0.0:8787`
- `/healthz` returns ok
- `/readyz` returns ready
- `/api/worker/metadata` returns worker metadata when called through the router with valid worker auth

Important files:

- `apps/supervisor-api/src/app.ts`
- `apps/supervisor-api/src/routes/system.ts`
- `apps/supervisor-api/src/worker-environment.ts`
- `apps/supervisor-api/src/worker-identity.ts`
- `packages/config/src/index.ts`

Current status:

- Worker API starts and is ready.
- `/api/worker/metadata` is protected and works only through router/internal headers.
- Runtime manifest reports Codex as enabled and ready in staging.

## 2. Workspace Filesystem

`/workspace` must be the canonical user workspace root inside the sandbox.

Required:

- `/workspace` exists and is writable by the non-root agent user.
- Each control-plane workspace must have a real directory under `/workspace/<workspace-slug>`.
- Workspace creation must materialize the directory in the running worker, not only create a database row.
- Workspace paths must stay inside `/workspace`; path traversal must be impossible.
- Empty workspaces should initialize at least an empty directory.
- Git workspaces should clone the configured repo into the workspace directory.
- Upload/snapshot workspaces should extract or restore files into the workspace directory.

Current status:

- `/workspace` exists but is empty.
- Control-plane `POST /api/workspaces` creates DB rows only.
- Example DB row exists with `path=/workspace/molecule-study`, but the actual directory did not exist in the worker.

Relevant control-plane files:

- `apps/control-plane-api/src/app.ts`
- `apps/control-plane-api/src/repository.ts`
- `packages/db/src/schema.ts`

Relevant worker files:

- `apps/supervisor-api/src/routes/workspaces.ts`
- `apps/supervisor-api/src/app.ts`

Implementation requirement:

- Add a worker-side endpoint or internal action that can create/materialize a workspace directory.
- Make control-plane call that worker action after DB workspace creation when the sandbox is running.
- If sandbox is stopped, store pending workspace materialization and apply it on sandbox start.
- Workspace materialization must be idempotent.

## 3. Session Runtime

Creating a control-plane session must create or bind a real worker/runtime session.

Required:

- `POST /api/workspaces/:workspaceId/sessions` should not only create a DB row.
- It should create a worker session under the selected workspace path.
- `control_sessions.workerSessionId` must be set once the worker creates the runtime session.
- `control_sessions.status` should reflect real lifecycle: `created`, `active`, `idle`, `archived`, `deleted`.
- Resume/close must call real worker lifecycle endpoints and update DB state.

Current status:

- Control-plane session creation creates a DB row only.
- `workerSessionId` stays `null`.
- Worker has a ready Codex runtime, but control-plane session creation is not yet bound to a real worker/Codex session.

Relevant files:

- `apps/control-plane-api/src/app.ts`
- `apps/control-plane-api/src/repository.ts`
- `apps/supervisor-api/src/routes/threads.ts`
- `apps/supervisor-api/src/routes/agent-runtimes.ts`
- `packages/agent-runtime/src/types.ts`
- `packages/codex/src/runtimeAdapter.ts`
- `packages/opencode/src/runtimeAdapter.ts`

Implementation requirement:

- Define the worker session creation contract clearly.
- Either reuse existing supervisor thread/session routes or add worker-scoped internal session endpoints.
- Control-plane should persist the returned worker session id.
- Control-plane must validate that selected workspace belongs to the same sandbox before calling worker.

## 4. Agent Runtimes

A useful sandbox must expose at least one enabled runtime provider.

Required:

- At least one of `codex`, `claude`, or `opencode` is installed and enabled.
- `/readyz` must report available runtimes, not `[]`.
- Provider credentials must be injected through the configured LLM gateway or provider-specific secret flow.
- Runtime config must be written under `/home/agent` without leaking secrets in logs.
- If no provider is available, UI/API should clearly report `gateway_unavailable` or `runtime_unavailable`.

Current status:

- Staging enables Codex only with `REMOTE_CODEX_ENABLED_AGENT_PROVIDERS=codex`.
- `/readyz` returns Codex as ready.
- Worker launch injects the sub2api gateway base URL and token from Kubernetes Secret-backed environment variables.
- A full user prompt through Codex/sub2api has not yet been added to the staging smoke because control-plane session binding is still incomplete.

Relevant files:

- `apps/supervisor-api/src/routes/agent-runtimes.ts`
- `apps/supervisor-api/src/worker-environment.ts`
- `packages/agent-runtime/src/unavailable-runtime.ts`
- `packages/codex/src/runtimeAdapter.ts`
- `packages/opencode/src/runtimeAdapter.ts`
- `docs/llm-gateway-contract.md`

Implementation requirement:

- Keep Codex as the first staging runtime.
- Add worker session binding so control-plane session creation starts or resumes a real Codex thread.
- Add smoke test proving a trivial Codex turn can be started through sub2api.

## 4a. Codex Gateway Launch Configuration

The worker image must not bake mutable provider configuration or raw API keys. Codex must be configured when the sandbox container starts.

Required launch-time environment:

- `REMOTE_CODEX_ENABLED_AGENT_PROVIDERS=codex`
- `REMOTE_CODEX_LLM_GATEWAY_BASE_URL=<Railway sub2api base URL>`
- `REMOTE_CODEX_LLM_GATEWAY_TOKEN=<sub2api API key from Kubernetes Secret>`
- `CODEX_HOME=/home/agent/.codex`
- `HOME=/home/agent`

Required files written by worker startup:

- `/home/agent/.codex/config.toml`
- `/home/agent/.codex/auth.json`

The current Codex config shape is:

```toml
model_provider = "sub2api"
forced_login_method = "api"
sandbox_mode = "workspace-write"
approval_policy = "never"

[model_providers.sub2api]
name = "sub2api"
base_url = "<REMOTE_CODEX_LLM_GATEWAY_BASE_URL without trailing slash>"
wire_api = "responses"
requires_openai_auth = true
```

The current Codex auth shape is:

```json
{
  "OPENAI_API_KEY": "<REMOTE_CODEX_LLM_GATEWAY_TOKEN>"
}
```

Current status:

- Implemented in `apps/supervisor-api/src/worker-bootstrap.ts`.
- The AWS sandbox adapter injects the gateway base URL as a normal environment variable.
- The AWS sandbox adapter injects the token as `REMOTE_CODEX_LLM_GATEWAY_TOKEN` from Kubernetes Secret `remote-codex-llm-gateway-tokens`, key `sub2api-api-key`.
- The token must not be printed, logged, committed, added to Terraform state, or returned by any API response.

## 5. Router And Browser Connectivity

The browser must connect to the worker through the sandbox router, not directly to the private worker Service.

Required:

- Worker Service remains private `ClusterIP`.
- Router is the only public ingress.
- Route token scopes are enforced by router and worker identity headers.
- Browser frontend receives a route token from control-plane.
- Browser connects to router via `wss://...`, not `ws://...`, when frontend is served over HTTPS.
- Router forwards HTTP and WebSocket traffic to the correct worker Service.

Current status:

- Router exists and can proxy HTTP to private workers.
- Route token issuance works when sandbox state is `running`.
- Current router URL is plain HTTP, so route tokens return `ws://...`.
- HTTPS frontend cannot reliably open a browser WebSocket to `ws://...` because of mixed content.

Relevant files:

- `apps/sandbox-router/src/app.ts`
- `apps/sandbox-router/src/config.ts`
- `apps/sandbox-router/src/worker-identity.ts`
- `apps/control-plane-api/src/app.ts`
- `apps/supervisor-web/src/pages/ControlPlanePage.tsx`

Implementation requirement:

- Put sandbox-router behind TLS-capable ingress or ALB.
- Configure control-plane `SANDBOX_ROUTER_BASE_URL=https://...`.
- Ensure route token response returns `wss://...`.
- Add browser-level smoke or Playwright check for WebSocket open.

## 6. Persistence And Lifecycle

The sandbox lifecycle must be clear about what persists and what is ephemeral.

Required:

- Control-plane DB persists users, sandboxes, workspaces, sessions, gateway keys, usage, and audit logs.
- Worker Pod is ephemeral.
- Workspace filesystem persistence must be intentionally designed.
- If workspaces should survive sandbox restarts, implement snapshot/S3/EFS/persistent volume restore.
- If workspaces are ephemeral, UI and docs must say so explicitly and provide export/snapshot behavior.

Current status:

- Railway control-plane DB persists on Railway volume.
- Worker Pod filesystem is ephemeral Fargate storage.
- `/workspace` is empty after start because no workspace materialization exists.
- S3 prefix is stored on sandbox records but no complete workspace sync/restore flow is implemented.

Relevant files:

- `apps/control-plane-api/src/adapters.ts`
- `apps/control-plane-api/src/repository.ts`
- `packages/db/src/schema.ts`

Implementation requirement:

- Decide persistence model:
  - S3 snapshot per workspace/session, or
  - EFS mounted into worker Pods, or
  - ephemeral-only for staging.
- Implement startup restore and stop/checkpoint behavior according to that decision.
- Make current behavior explicit in UI.

## 7. Security Boundaries

The sandbox must keep user execution isolated and avoid exposing direct worker access.

Required:

- Worker Service is private.
- Route tokens are short-lived and scoped.
- Router strips browser-forged internal headers.
- Worker requires internal worker auth token for protected routes.
- Worker verifies signed identity envelope from router.
- Agent processes run as non-root where possible.
- Workspace paths are constrained under `/workspace`.
- Secrets are not printed in logs, docs, or API responses.

Current status:

- Private worker Service and public router model are in place.
- Direct worker access denial was previously smoke-tested.
- Worker auth token and identity envelope paths exist.
- Need continued review when adding file/session materialization endpoints.

Relevant files:

- `apps/sandbox-router/src/app.ts`
- `apps/sandbox-router/src/worker-identity.ts`
- `apps/supervisor-api/src/worker-identity.ts`
- `apps/control-plane-api/src/app.ts`

## 8. Minimum Acceptance Criteria

The next implementation should satisfy these checks before calling the sandbox usable.

1. Start sandbox from control-plane.
2. EKS shows one worker Pod `Ready=1/1` and one private worker Service.
3. `/readyz` reports Codex as the enabled runtime provider.
4. Create workspace through frontend/API.
5. Worker contains `/workspace/<slug>`.
6. Create session through frontend/API.
7. Control-plane session row has a non-null `workerSessionId` or explicitly documented pending state.
8. Issue route token.
9. Browser can open `wss://router/.../ws?token=...`.
10. Router can proxy `/api/worker/metadata` to worker.
11. Direct worker access remains impossible from the public internet.
12. Stop sandbox deletes worker Pod and Service.
13. Restart sandbox restores or clearly resets workspace state according to the chosen persistence model.
14. A smoke test can send one trivial prompt through Codex and the sub2api gateway.

## Recommended Task Split

Recommended order for the next agent:

1. Implement workspace materialization.
2. Implement worker session binding.
3. Add a real Codex prompt smoke through sub2api.
4. Add TLS/WSS for sandbox-router.
5. Add end-to-end smoke covering workspace -> session -> route token -> worker metadata -> WebSocket.
6. Decide and implement workspace persistence model.

## Current Known Gaps

- Workspace DB rows do not create directories in `/workspace`.
- Sessions are DB rows only; no real worker session binding.
- Codex runtime is ready, but no full control-plane -> worker -> Codex prompt path is wired yet.
- Route token currently returns `ws://...`, which is not suitable for an HTTPS frontend.
- Worker filesystem is ephemeral.
- Frontend control-plane page is diagnostic/dev UI, not a polished user workflow.
- Repeated workspace slug now returns `409 workspace_slug_conflict`, but UI can still be improved.

## Useful Commands

Inspect current worker:

```bash
kubectl get pods,svc -n remote-codex-staging -o wide
kubectl exec -n remote-codex-staging pod/<worker-pod> -- sh -lc 'find /workspace -maxdepth 3 -mindepth 1 -print'
kubectl exec -n remote-codex-staging pod/<worker-pod> -- sh -lc 'curl -fsS http://127.0.0.1:8787/readyz'
```

Check Railway control-plane:

```bash
railway service status --service remote-codex-control-plane --environment production --json
curl -fsS https://remote-codex-control-plane-production.up.railway.app/healthz
```

Check router:

```bash
curl -fsS http://k8s-remoteco-remoteco-7dd92e25ca-b41c163a458fb214.elb.ca-central-1.amazonaws.com/healthz
```

Do not print or commit secrets from Railway variables, AWS credentials, kubeconfig, local `.temp` files, or Terraform state.
