# Remote Codex Branch Status

This file is the current-state handoff for the
`sandbox-worker-control-plane` branch. Update it before larger phase handoffs or
when the next implementation focus changes materially.

## 2026-05-30 (afternoon) CI/CD & WSS Handoff

### Merge: ui-optimization → sandbox-worker-control-plane

Merged `origin/ui-optimization` (1 commit: `9f31ff4`) into this branch.
Resolved one conflict in `apps/control-plane-api/src/app.ts` (crypto imports).

The `ui-optimization` branch brought:

- Product auth: Google OAuth, GitHub OAuth, email/password login
- HMAC-signed product session tokens (14-day TTL)
- DB tables: `control_auth_identities`, `control_password_credentials`
- Refactored `ControlPlanePage.tsx` and new `ControlPlaneLoginPage.tsx`
- `controlPlaneAuthStorage.ts` for persistent auth
- Uses scrypt for password hashing

### CI/CD: GitHub Actions auto build + push

- Created AWS OIDC provider for GitHub Actions
- Created IAM Role `remote-codex-github-actions-staging` with ECR push permissions
- Trust policy covers 4 repos: `dufangshi/remoteCodex`, `EvoEvolver/ElAgenteHarness`, `EvoEvolver/inact`, `EvoEvolver/InactWorker`
- Added `push` trigger to `staging-images.yml`:
  - Watches `sandbox-worker-control-plane` branch
  - Path filters: Dockerfiles, apps/\*\*, packages/\*\*, config/\*\*
  - Auto-builds worker + router images, smoke-tests, pushes to ECR
- Latest run: `e52d81f` → both images pushed to ECR ✅

### Browser WebSocket: Cloudflare Flexible SSL

- CNAME: `sandbox-router.lnz.app` → NLB DNS (proxied, orange cloud)
- Cloudflare SSL mode: Flexible (browser→CF encrypted, CF→NLB plain HTTP)
- Cloudflare WebSockets: On
- Verified: `https://sandbox-router.lnz.app/healthz` → `{"ok":true,"role":"sandbox-router"}`
- Railway `SANDBOX_ROUTER_BASE_URL` is already `https://sandbox-router.lnz.app`
- **No ACM certificate needed** — Cloudflare handles TLS termination

### Remaining Gaps

- Railway not auto-deploying: watches `main` branch, not `sandbox-worker-control-plane`
- EKS router Deployment not auto-updated when ECR image changes (missing CD step)
- No ACM/terraform changes needed (Cloudflare approach supersedes that)

---

## 2026-05-30 Current Branch Handoff

The branch is now focused on the Railway control-plane to EKS worker runtime
path. The old 2026-05-27 CORS handoff is superseded by this status and by the
more detailed deployment note in:

```text
docs/2026-05-29-deployment-state.md
```

## Git State

- Branch: `sandbox-worker-control-plane`
- Remote: `git@github.com:dufangshi/remoteCodex.git`
- Upstream: `origin/sandbox-worker-control-plane`
- Current pushed HEAD after today's work: `e52d81f`
- Current pushed HEAD message: `Add push trigger for staging-images workflow on sandbox-worker-control-plane`
- Merge commit: `ee657a9` (`Merge origin/ui-optimization: product auth and UI refresh`)
- Mainline comparison: `0 behind / 198 ahead` relative to `origin/main`
- Working tree at this handoff: clean (only `docs/status.md` modified)

Recent commits (newest first):

```text
e52d81f Add push trigger for staging-images workflow on sandbox-worker-control-plane
ee657a9 Merge origin/ui-optimization: product auth and UI refresh
9f31ff4 Add control plane product auth and UI refresh
ba3df41 .
0e415b8 Prefer configured router URL for route tokens
5da80c4 Proxy control-plane worker calls through sandbox router
```

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

Cloudflare:

```text
CNAME: sandbox-router.lnz.app → k8s-remoteco-remoteco-7dd92e25ca-b41c163a458fb214.elb.ca-central-1.amazonaws.com
Proxy: Proxied (orange cloud)
SSL mode: Flexible
WebSockets: On
```

AWS/EKS:

```text
Account: 918876873590
Region: ca-central-1
Cluster: inact-harness-agents
Namespace: remote-codex-staging
Worker Fargate profile: remote-codex-staging-workers
ECR worker repo: remote-codex-worker-staging
ECR router repo: remote-codex-sandbox-router-staging
```

Current sandbox-router exposure:

```text
URL (via Cloudflare): https://sandbox-router.lnz.app
Backend NLB: k8s-remoteco-remoteco-7dd92e25ca-b41c163a458fb214.elb.ca-central-1.amazonaws.com
Port: 443 (Cloudflare) → 80 (NLB) → 8791 (router Pod)
Role: public router to private worker Services
```

## Next Recommended Work

1. Configure Railway GitHub integration to watch `sandbox-worker-control-plane` branch for auto-deploy, or manually `railway redeploy` to get the merged `ui-optimization` code online.
2. Add kubeconfig/EKS access for GitHub Actions so `staging-images.yml` can update the router Deployment image tag after pushing to ECR.
3. Implement workspace materialization per `docs/sandbox-requirements.md` (create `/workspace/<slug>` directories in worker Pods).
4. Implement worker session binding (control-plane sessions → real Codex threads).
5. Tighten `codex_worker_prompt_e2e` smoke to wait for real LLM completion.
6. Review EKS Auto Mode capacity before leaving staging running long-term.
