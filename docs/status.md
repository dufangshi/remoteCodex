# Remote Codex Branch Status

This file is the current-state handoff for the
`sandbox-worker-control-plane` branch. Update it before larger phase handoffs or
when the next implementation focus changes materially.

The former detailed note in `docs/2026-05-29-deployment-state.md` has been
merged into this file. Treat this file as the current source of truth; the
2026-05-29 note is now historical context only.

## 2026-05-30 Current Handoff

### Executive Summary

The branch is focused on the Railway control-plane to EKS worker runtime path.
The control-plane reaches private worker Services through the public
sandbox-router instead of attempting to call Kubernetes cluster-local DNS from
Railway.

Current shape:

- Product auth and the UI refresh from `origin/ui-optimization` are merged.
- GitHub Actions can build, smoke-test, and push worker/router images to ECR on
  pushes to this branch.
- Browser-facing router traffic uses Cloudflare Flexible SSL:
  browser -> Cloudflare is HTTPS/WSS, Cloudflare -> NLB is plain HTTP.
- `SANDBOX_ROUTER_BASE_URL` is configured as
  `https://sandbox-router.lnz.app`.
- Workspace materialization and control-plane session binding to real worker
  Codex threads are implemented in code.
- The staging smoke currently proves prompt start/turn creation, but still does
  not prove final LLM completion and assistant output through sub2api.

### Remaining Gaps

- Railway is not auto-deploying this branch; it watches `main`, not
  `sandbox-worker-control-plane`.
- EKS router Deployment is not auto-updated when ECR images change; the missing
  CD step is kubeconfig/EKS access plus a deployment image update from GitHub
  Actions.
- `codex_worker_prompt_e2e` needs to wait for final LLM completion and assert
  the expected assistant text.
- EKS Auto Mode capacity should be reviewed before leaving staging running
  long-term.

## Git State

- Branch: `sandbox-worker-control-plane`
- Remote: `git@github.com:dufangshi/remoteCodex.git`
- Upstream: `origin/sandbox-worker-control-plane`
- Current pushed HEAD before this docs merge: `5cd2240`
- Current pushed HEAD message:
  `Update status docs: CI/CD pipeline, Cloudflare WSS, ui-optimization merge`
- Merge commit: `ee657a9`
  (`Merge origin/ui-optimization: product auth and UI refresh`)
- Upstream comparison before this docs merge: `0 behind / 0 ahead` relative to
  `origin/sandbox-worker-control-plane`
- Mainline comparison before this docs merge: `0 behind / 201 ahead` relative
  to `origin/main`
- Working tree before this docs merge: only `docs/status.md` had local edits

Recent commits before this docs merge, newest first:

```text
5cd2240 Update status docs: CI/CD pipeline, Cloudflare WSS, ui-optimization merge
e52d81f Add push trigger for staging-images workflow on sandbox-worker-control-plane
ee657a9 Merge origin/ui-optimization: product auth and UI refresh
9f31ff4 Add control plane product auth and UI refresh
ba3df41 .
0e415b8 Prefer configured router URL for route tokens
5da80c4 Proxy control-plane worker calls through sandbox router
3cc03a4 Bind control-plane sessions to worker Codex threads
```

## Product Auth And UI Merge

Merged `origin/ui-optimization` into this branch.

The `ui-optimization` branch brought:

- Google OAuth, GitHub OAuth, and email/password login.
- HMAC-signed product session tokens with a 14-day TTL.
- DB tables:
  - `control_auth_identities`
  - `control_password_credentials`
- Refactored `ControlPlanePage.tsx`.
- New `ControlPlaneLoginPage.tsx`.
- `controlPlaneAuthStorage.ts` for persistent auth.
- scrypt password hashing.

Conflict resolved:

- `apps/control-plane-api/src/app.ts`
- Conflict area: crypto imports.

## CI/CD State

GitHub Actions work completed:

- Created AWS OIDC provider for GitHub Actions.
- Created IAM Role `remote-codex-github-actions-staging` with ECR push
  permissions.
- Added EKS deploy access for the same GitHub Actions role:
  - IAM inline policy `remote-codex-gh-eks-router-deploy-staging` allows
    `eks:DescribeCluster` on `inact-harness-agents`
  - EKS access entry maps the role to Kubernetes group
    `remote-codex-github-actions-staging`
  - namespace RBAC role `remote-codex-router-deployer` allows updating
    `deployment/remote-codex-sandbox-router` and reading rollout state in
    `remote-codex-staging`
- Trust policy covers:
  - `dufangshi/remoteCodex`
  - `EvoEvolver/ElAgenteHarness`
  - `EvoEvolver/inact`
  - `EvoEvolver/InactWorker`
- Added a `push` trigger to `staging-images.yml`:
  - watches the `sandbox-worker-control-plane` branch
  - path filters: Dockerfiles, `apps/**`, `packages/**`, `config/**`
  - builds worker and router images
  - runs smoke checks
  - pushes images to ECR
  - updates the EKS sandbox-router Deployment image
  - waits for router rollout completion

Latest known successful image build:

```text
commit: e52d81f
result: worker and router images pushed to ECR
```

Still missing:

- Railway service deployment is not yet wired to this branch.
- Worker image publication is automatic, but control-plane/Railway still needs
  to consume the desired worker image tag before newly started worker Pods will
  use it.

## Current Deployment Shape

Railway:

```text
Project: TaskMarket
Environment: production
Frontend service: remote-codex-frontend
Frontend URL: https://remote-codex-frontend-production.up.railway.app
Control-plane service: remote-codex-control-plane
Control-plane URL: https://remote-codex-control-plane-production.up.railway.app
SANDBOX_ROUTER_BASE_URL: https://sandbox-router.lnz.app
```

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

Browser UI:

```text
https://remote-codex-frontend-production.up.railway.app/control-plane
```

Cloudflare:

```text
CNAME: sandbox-router.lnz.app -> k8s-remoteco-remoteco-7dd92e25ca-b41c163a458fb214.elb.ca-central-1.amazonaws.com
Proxy: Proxied
SSL mode: Flexible
WebSockets: On
```

Sandbox-router exposure:

```text
Public URL: https://sandbox-router.lnz.app
Backend NLB: k8s-remoteco-remoteco-7dd92e25ca-b41c163a458fb214.elb.ca-central-1.amazonaws.com
Path: browser HTTPS/WSS -> Cloudflare -> NLB port 80 -> router Pod port 8791
Role: public router to private worker Services
```

Verified after Cloudflare setup:

```text
GET https://sandbox-router.lnz.app/healthz
-> {"ok":true,"role":"sandbox-router"}
```

No ACM certificate is currently needed for this path because Cloudflare handles
browser-side TLS termination.

## AWS/EKS Runtime

```text
Account: 918876873590
Region: ca-central-1
Cluster: inact-harness-agents
Namespace: remote-codex-staging
Worker Fargate profile: remote-codex-staging-workers
ECR worker repo: remote-codex-worker-staging
ECR router repo: remote-codex-sandbox-router-staging
```

EKS cluster compute configuration observed on 2026-05-29:

```json
{
  "enabled": true,
  "nodePools": ["general-purpose", "system"],
  "nodeRoleArn": "arn:aws:iam::918876873590:role/AmazonEKSAutoNodeRole"
}
```

There were no EKS managed node groups at that time:

```text
aws eks list-nodegroups --cluster-name inact-harness-agents
-> []
```

Worker Fargate profile observed active:

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

Observed services on 2026-05-29:

```text
remote-codex-sandbox-router
  type: LoadBalancer
  external hostname: k8s-remoteco-remoteco-7dd92e25ca-b41c163a458fb214.elb.ca-central-1.amazonaws.com
  port: 80

remote-codex-worker-9ed35585-4d38-494d-be8e-cff65f5b3f15
  type: ClusterIP
  port: 8787
```

Observed running worker on 2026-05-29:

```text
sandbox id: 9ed35585-4d38-494d-be8e-cff65f5b3f15
worker Pod: remote-codex-worker-9ed35585-4d38-494d-be8e-cff65f5b3f15
worker image: 918876873590.dkr.ecr.ca-central-1.amazonaws.com/remote-codex-worker-staging:3cc03a4
router URL: http://k8s-remoteco-remoteco-7dd92e25ca-b41c163a458fb214.elb.ca-central-1.amazonaws.com
```

## Worker Routing Architecture

Before `5da80c4`, the Railway control-plane attempted to reach worker Services
at cluster-local Kubernetes DNS names:

```text
http://<worker-service>.<namespace>.svc.cluster.local:8787
```

That cannot work from Railway because `*.svc.cluster.local` only resolves
inside the Kubernetes cluster.

After `5da80c4`, control-plane worker calls use:

```text
<SANDBOX_ROUTER_BASE_URL>/api/sandboxes/<sandbox-id>/...
```

The control plane signs a short-lived backend route token and sends it as:

```text
Authorization: Bearer <route-token>
```

The router validates the token, identifies the sandbox, and forwards the request
to the private worker Service inside EKS.

Operations using the router path:

- Materialize/create worker workspace.
- Look up worker workspace by path fallback.
- Create worker thread/session.
- Send prompt to a worker thread/session.
- Close worker thread/session.
- Resume worker thread/session.

Main files:

- `apps/control-plane-api/src/app.ts`
- `apps/control-plane-api/src/app.test.ts`
- `scripts/staging-phase-one-smoke.ts`

## Workspace And Session State

Implemented in code:

- Control-plane workspace creation can materialize a matching worker workspace.
- Control-plane session creation can start a real worker Codex thread.
- Control-plane stores the returned worker session id separately from the
  durable control-plane session id.
- Prompt requests are forwarded to the bound worker session.
- Session lifecycle calls can close and resume the worker session.

Important boundary:

- This path still needs deployment verification from the latest branch state,
  especially after the `ui-optimization` merge and Cloudflare WSS setup.
- The current smoke proves only that the prompt request returns a `turn` object.
  It does not wait for completion or inspect assistant text.

## Worker Launch-Time Codex Configuration

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

Intended `config.toml` shape:

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

Intended `auth.json` shape:

```json
{
  "OPENAI_API_KEY": "<REMOTE_CODEX_LLM_GATEWAY_TOKEN>"
}
```

Do not print the token value, commit it, or put it in Terraform state.

Main files:

- `apps/control-plane-api/src/adapters.ts`
- `apps/supervisor-api/src/worker-bootstrap.ts`

## Verification Evidence

Local checks that were run after the router-proxy control-plane change:

```text
pnpm --filter @remote-codex/control-plane-api typecheck
pnpm --filter @remote-codex/control-plane-api test
pnpm exec tsc --noEmit --allowImportingTsExtensions --module NodeNext --moduleResolution NodeNext --target ES2022 scripts/staging-phase-one-smoke.ts
git diff --check
```

The deployed control-plane prompt route existed during the 2026-05-29 check:

```text
POST /api/sessions/00000000-0000-4000-8000-000000000000/prompt
-> 404 {"code":"not_found","message":"Session not found."}
```

That business 404 proves the deployed API included the prompt route. It does
not prove LLM execution.

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

Important caveat:

- `codex_worker_prompt_e2e` currently checks that a `turn` object is returned.
- It does not poll turn history/status until completion.
- It does not assert the final assistant output.
- A returned `turn` can be in `running` status and only prove prompt start.

The stricter smoke should:

1. Send a prompt such as
   `Reply with exactly: remote-codex-codex-e2e-ok`.
2. Poll session/turn detail until the turn completes or fails.
3. Assert that final assistant output contains the expected text.
4. Fail with a non-secret error summary if sub2api/provider execution fails.

If sub2api has no valid upstream API key configured, true LLM completion is
expected to fail even though the current weak smoke can pass.

## Browser WebSocket State

The old 2026-05-29 note described a blocker where the production HTTPS frontend
would receive a plain `ws://` route-token URL and browsers would block it.

That blocker is superseded by the 2026-05-30 Cloudflare setup:

```text
sandbox-router.lnz.app -> NLB DNS
Cloudflare proxy: on
Cloudflare SSL mode: Flexible
Cloudflare WebSockets: on
Railway SANDBOX_ROUTER_BASE_URL: https://sandbox-router.lnz.app
```

Expected browser-facing route-token behavior after this setup:

```text
https://sandbox-router.lnz.app
wss://sandbox-router.lnz.app
```

The remaining browser follow-up is to verify the production UI can actually
open the routed worker WebSocket from the HTTPS frontend after Railway deploys
the branch state that includes the auth/UI merge.

## EC2 Cost And Capacity Notes

Current observed EC2 Auto Mode capacity on 2026-05-29 was likely more than
needed for the staging load:

- One `c6a.large` ran only the sandbox-router.
- Two `c6g.large` system nodes each ran only one metrics-server Pod.
- The worker itself ran on Fargate, not on EC2 nodes.

The EC2 nodes are EKS Auto Mode managed capacity, not manually created managed
node group instances. Do not terminate individual EC2 instances by hand; EKS or
Karpenter may recreate them.

Recommended cost follow-up:

- Decide whether to keep EKS Auto Mode enabled for system/router Pods or move
  the router to Fargate as well.
- If keeping Auto Mode, define explicit NodePool/NodeClass constraints and
  resource requests so the system does not keep oversized idle nodes.
- Add CPU/memory requests to `remote-codex-sandbox-router`; the observed router
  Pod had no requests, making capacity behavior less explicit.
- Consider whether metrics-server should run with two replicas in this staging
  cluster.
- Change EKS Auto Mode/node pool/Fargate/Kubernetes configuration rather than
  terminating EC2 instances directly.

## Next Recommended Work

1. Configure Railway GitHub integration to watch
   `sandbox-worker-control-plane`, or manually run `railway redeploy`, so the
   merged `ui-optimization` code is online.
2. Run and verify `staging-images.yml` deploys the EKS sandbox-router image
   after pushing to ECR.
3. Wire the published worker image tag into the control-plane/Railway runtime
   config used for newly started worker Pods.
4. Deploy and verify the already-implemented workspace/session path from the
   current branch:
   - control-plane materializes worker workspaces through the sandbox-router
   - control-plane session creation starts a real worker Codex thread
   - prompts are forwarded to the bound worker session
5. Tighten `codex_worker_prompt_e2e` to wait for final LLM completion and assert
   the expected response text, not just the presence of a returned turn.
6. Confirm sub2api has a valid upstream key, then rerun the stricter e2e.
7. Verify the production HTTPS frontend can open the routed worker WebSocket via
   `wss://sandbox-router.lnz.app` after Railway deploys this branch.
8. Review EKS Auto Mode capacity before leaving staging running long-term.
