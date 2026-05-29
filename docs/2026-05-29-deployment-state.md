# 2026-05-29 Deployment State

This is the current implementation and operations handoff for the
`sandbox-worker-control-plane` branch after the first Railway to EKS worker
deployment.

## Executive Summary

The control-plane to worker HTTP path is now routed through the public
sandbox-router instead of trying to call Kubernetes cluster-local worker Service
DNS from Railway.

The backend can create a control-plane workspace/session, materialize a worker
workspace/session, and send a prompt request to the worker. However, two
important items are not complete:

- The browser cannot open the worker WebSocket from the production HTTPS
  frontend because the sandbox-router is currently exposed as plain HTTP and
  returns `ws://`, not `wss://`.
- The current staging smoke only proves that a prompt request creates/returns a
  worker turn. It does not yet prove that Codex completed a real LLM response
  through sub2api.

## Git And Deployment

- Branch: `sandbox-worker-control-plane`
- Remote: `git@github.com:dufangshi/remoteCodex.git`
- Latest pushed commit at this handoff: `5da80c4`
- Commit message: `Proxy control-plane worker calls through sandbox router`

Railway:

- Project: `TaskMarket`
- Environment: `production`
- Frontend service: `remote-codex-frontend`
- Frontend URL: `https://remote-codex-frontend-production.up.railway.app`
- Control-plane service: `remote-codex-control-plane`
- Control-plane URL: `https://remote-codex-control-plane-production.up.railway.app`
- Control-plane deployment id verified after `5da80c4`: `08e9395b-9a96-494b-a823-56e0647b5726`
- Control-plane deployment status at verification time: `SUCCESS`

Control-plane health:

```text
GET https://remote-codex-control-plane-production.up.railway.app/healthz
-> {"ok":true,"service":"control-plane-api"}
```

Opening the control-plane API root is expected to return a 404:

```text
GET https://remote-codex-control-plane-production.up.railway.app/
-> {"message":"Route GET:/ not found","error":"Not Found","statusCode":404}
```

The browser UI is:

```text
https://remote-codex-frontend-production.up.railway.app/control-plane
```

## Current AWS Runtime

- AWS account: `918876873590`
- Region: `ca-central-1`
- EKS cluster: `inact-harness-agents`
- Namespace: `remote-codex-staging`

EKS cluster compute configuration currently has EKS Auto Mode enabled:

```json
{
  "enabled": true,
  "nodePools": ["general-purpose", "system"],
  "nodeRoleArn": "arn:aws:iam::918876873590:role/AmazonEKSAutoNodeRole"
}
```

There are no EKS managed node groups:

```text
aws eks list-nodegroups --cluster-name inact-harness-agents
-> []
```

The worker Fargate profile exists and is active:

```json
{
  "name": "remote-codex-staging-workers",
  "status": "ACTIVE",
  "selectors": [
    {
      "namespace": "remote-codex-staging",
      "labels": {
        "remote-codex.dev/runtime-role": "worker"
      }
    }
  ]
}
```

Observed Kubernetes nodes on 2026-05-29:

```text
fargate-ip-10-0-143-21.ca-central-1.compute.internal
  compute: Fargate
  running: remote-codex worker Pod

i-016eb4a532b54ab20
  type: c6a.large
  arch: amd64
  nodepool: general-purpose
  running: remote-codex-sandbox-router

i-0b6fc226ebdb909d9
  type: c6g.large
  arch: arm64
  nodepool: system
  running: one metrics-server Pod

i-007fef9bdcfb7d666
  type: c6g.large
  arch: arm64
  nodepool: system
  running: one metrics-server Pod
  taint: CriticalAddonsOnly:NoSchedule
```

Observed services:

```text
remote-codex-sandbox-router
  type: LoadBalancer
  external hostname: k8s-remoteco-remoteco-7dd92e25ca-b41c163a458fb214.elb.ca-central-1.amazonaws.com
  port: 80

remote-codex-worker-9ed35585-4d38-494d-be8e-cff65f5b3f15
  type: ClusterIP
  port: 8787
```

Observed running worker:

```text
sandbox id: 9ed35585-4d38-494d-be8e-cff65f5b3f15
worker Pod: remote-codex-worker-9ed35585-4d38-494d-be8e-cff65f5b3f15
worker image: 918876873590.dkr.ecr.ca-central-1.amazonaws.com/remote-codex-worker-staging:3cc03a4
router URL: http://k8s-remoteco-remoteco-7dd92e25ca-b41c163a458fb214.elb.ca-central-1.amazonaws.com
```

## What Was Implemented

### Control-Plane Worker Calls Use The Router

Before `5da80c4`, Railway control-plane attempted to reach worker Services at
cluster-local Kubernetes DNS names:

```text
http://<worker-service>.<namespace>.svc.cluster.local:8787
```

That cannot work from Railway because `*.svc.cluster.local` only resolves inside
the Kubernetes cluster.

After `5da80c4`, control-plane worker calls use:

```text
<SANDBOX_ROUTER_BASE_URL>/api/sandboxes/<sandbox-id>/...
```

The control plane signs a short-lived backend route token and sends it as:

```text
Authorization: Bearer <route-token>
```

The router validates the token, identifies the sandbox, and forwards the request
to the private worker Service inside the EKS cluster.

Operations now using the router path:

- materialize/create worker workspace
- look up worker workspace by path fallback
- create worker thread/session
- send prompt to a worker thread/session
- close worker thread/session
- resume worker thread/session

Main files:

- `apps/control-plane-api/src/app.ts`
- `apps/control-plane-api/src/app.test.ts`

### Worker Launch-Time Codex Configuration

Codex provider configuration is intended to be mutable launch configuration, not
baked into the image.

The AWS sandbox adapter injects:

```text
REMOTE_CODEX_ENABLED_AGENT_PROVIDERS=codex
REMOTE_CODEX_LLM_GATEWAY_BASE_URL=<sub2api base URL>
REMOTE_CODEX_LLM_GATEWAY_TOKEN=<secret-backed token>
CODEX_HOME=/home/agent/.codex
HOME=/home/agent
```

The worker bootstrap writes:

```text
/home/agent/.codex/config.toml
/home/agent/.codex/auth.json
```

The intended `config.toml` shape is:

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

The intended `auth.json` shape is:

```json
{
  "OPENAI_API_KEY": "<REMOTE_CODEX_LLM_GATEWAY_TOKEN>"
}
```

Do not print the token value, commit it, or put it in Terraform state.

Main files:

- `apps/control-plane-api/src/adapters.ts`
- `apps/supervisor-api/src/worker-bootstrap.ts`

## What Was Verified

Local code checks after the router-proxy control-plane change:

```text
pnpm --filter @remote-codex/control-plane-api typecheck
pnpm --filter @remote-codex/control-plane-api test
pnpm exec tsc --noEmit --allowImportingTsExtensions --module NodeNext --moduleResolution NodeNext --target ES2022 scripts/staging-phase-one-smoke.ts
git diff --check
```

Railway deployment health:

```text
GET /healthz -> ok
```

Prompt route exists in deployed control-plane:

```text
POST /api/sessions/00000000-0000-4000-8000-000000000000/prompt
-> 404 {"code":"not_found","message":"Session not found."}
```

The route returning a business 404 proves the deployed API includes the prompt
route; it does not prove LLM execution.

The staging smoke returned `ok: true` and included:

```text
bootstrap_user_and_sandbox
start_sandbox
sandbox_health
sandbox_ready
create_project_workspace_session
issue_route_token
router_health
browser_to_router_to_worker
worker_codex_runtime_enabled
codex_worker_prompt_e2e
```

Important caveat: the `codex_worker_prompt_e2e` smoke step currently checks only
that a `turn` object is returned. It does not wait for the turn to complete and
does not inspect assistant output.

## What Is Not Yet Proven

### Browser WebSocket Connectivity

The production frontend is HTTPS:

```text
https://remote-codex-frontend-production.up.railway.app
```

The sandbox-router is currently plain HTTP:

```text
http://k8s-remoteco-remoteco-7dd92e25ca-b41c163a458fb214.elb.ca-central-1.amazonaws.com
```

Therefore route tokens return a `ws://` WebSocket base URL. Browsers block this
from an HTTPS page:

```text
Failed to construct 'WebSocket': An insecure WebSocket connection may not be
initiated from a page loaded over HTTPS.
```

This is not a worker API failure. It is a TLS/WSS exposure issue. The production
fix is to put sandbox-router behind HTTPS/WSS and set:

```text
SANDBOX_ROUTER_BASE_URL=https://sandbox-router.<domain>
```

The route-token response should then use:

```text
wss://sandbox-router.<domain>
```

### Real Codex LLM Completion Through sub2api

The current evidence is insufficient to claim that Codex successfully completed
a model response through sub2api.

Known facts:

- worker `/readyz` reports the Codex runtime as ready
- control-plane can create/bind a worker session
- `POST /api/sessions/:sessionId/prompt` can reach the worker and returns a
  `turn` object

Known gap:

- the current smoke does not poll turn history/status until completion
- the current smoke does not assert the final assistant text
- a returned `turn` can be in `running` status and only prove prompt start

The smoke should be tightened to:

1. send a prompt such as `Reply with exactly: remote-codex-codex-e2e-ok`
2. poll the worker/control-plane session detail until the turn completes or
   fails
3. assert that the final assistant output contains the expected text
4. fail with a non-secret error summary if sub2api/provider execution fails

If sub2api has no valid upstream API key configured, true LLM completion is
expected to fail even though the current weak smoke can pass.

## EC2 Cost And Capacity Notes

Current observed EC2 Auto Mode capacity is likely more than needed for the
current staging load:

- one `c6a.large` runs only the sandbox-router
- two `c6g.large` system nodes each run only one metrics-server Pod
- the worker itself runs on Fargate, not on the EC2 nodes

The three EC2 nodes are EKS Auto Mode managed capacity, not manually created
managed node group instances. Do not terminate individual EC2 instances by hand;
EKS/Karpenter may recreate them.

For the current staging workload, the interactive worker does not need a
`c6*.large` EC2 node because it is scheduled onto Fargate via the
`remote-codex-staging-workers` profile. The only visible general-purpose EC2
use is the router Pod.

Recommended cost follow-up:

- Decide whether to keep EKS Auto Mode enabled for system/router Pods or move
  the router to Fargate as well.
- If keeping Auto Mode, define explicit NodePool/NodeClass constraints and
  requests so the system does not keep oversized idle nodes.
- Add CPU/memory requests to `remote-codex-sandbox-router`; currently the
  observed router Pod has no requests, making capacity behavior less explicit.
- Consider whether metrics-server should run with two replicas in this staging
  cluster; two `c6g.large` system nodes for two small metrics-server Pods is
  expensive for the current usage.
- Do not scale or delete by terminating EC2 instances directly. Change the EKS
  Auto Mode/node pool/Fargate/Kubernetes configuration instead.

## Next Recommended Work

1. Put sandbox-router behind HTTPS/WSS.
2. Update `SANDBOX_ROUTER_BASE_URL` in Railway control-plane to the HTTPS router
   URL.
3. Tighten `scripts/staging-phase-one-smoke.ts` so `codex_worker_prompt_e2e`
   waits for final assistant output instead of only checking that a turn object
   exists.
4. Confirm sub2api has a valid upstream key and then rerun the stricter e2e.
5. Review EKS Auto Mode capacity and decide whether router/system workloads
   should run on smaller/cheaper capacity or Fargate.
