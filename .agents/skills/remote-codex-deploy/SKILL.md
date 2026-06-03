---
name: remote-codex-deploy
description: Deploy and verify this remoteCodex repository's sandbox-worker-control-plane staging stack. Use when the user asks to deploy, push上线, refresh Railway production, check GitHub Actions deployment, verify the latest remote-codex frontend/control-plane/router build, or make the post-push staging deployment workflow smoother and lower-token.
---

# Remote Codex Deploy

Use this project-level skill for the `sandbox-worker-control-plane` staging deployment path. Prefer the bundled script so deployment status is collected with one command instead of many manual checks.

## Quick Command

From the repo root:

```bash
node .agents/skills/remote-codex-deploy/scripts/deploy-staging.mjs --help
```

Common flows:

```bash
# After edits are already committed, push and wait for deployment.
node .agents/skills/remote-codex-deploy/scripts/deploy-staging.mjs --push --watch

# Commit all current changes, push, wait, and verify health endpoints.
node .agents/skills/remote-codex-deploy/scripts/deploy-staging.mjs --commit "Your commit message" --push --watch

# Only inspect current branch, recent runs, and health.
node .agents/skills/remote-codex-deploy/scripts/deploy-staging.mjs --status
```

## Workflow

1. Run targeted tests before deploy when code changed. The script intentionally does not guess the right test set.
2. Run the script with `--commit` only when the user asked to commit all current changes or the diff is clearly yours.
3. Use `--push --watch` to trigger and wait for GitHub Actions.
4. Treat `Staging Images` success as the deploy closure for Railway frontend/control-plane and EKS sandbox-router.
5. Confirm `https://remote-codex-control-plane-production.up.railway.app/healthz` reports the pushed SHA.
6. If UI behavior changed, do a Playwright smoke on `https://remote-codex-frontend-production.up.railway.app/control-plane`.

## Guardrails

- Do not push secrets in commits or logs.
- Do not use destructive git commands.
- Do not commit unrelated dirty files unless the user explicitly asks.
- Redact route tokens or bearer tokens if command output includes them.
- If GitHub Actions fail, inspect the failing job log before changing code.

## Fixed Deployment Facts

- Branch: `sandbox-worker-control-plane`.
- Main deploy workflow: `Staging Images`.
- Supporting workflow: `Worker Image`.
- Frontend URL: `https://remote-codex-frontend-production.up.railway.app/control-plane`.
- Control-plane health: `https://remote-codex-control-plane-production.up.railway.app/healthz`.
- Router health: `https://sandbox-router.lnz.app/healthz`.
