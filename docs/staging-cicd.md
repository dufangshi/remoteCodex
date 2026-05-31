# Staging CI/CD Pipeline

This document describes the staging build and deployment path for the
`sandbox-worker-control-plane` branch.

Current source branch:

```text
sandbox-worker-control-plane
```

Main workflow:

```text
.github/workflows/staging-images.yml
```

## Pipeline Summary

On a matching push to `sandbox-worker-control-plane`, `staging-images.yml`:

1. Builds the worker image.
2. Smoke-tests the worker image locally in Docker.
3. Pushes the worker image to ECR.
4. Updates Railway control-plane worker image variables when `RAILWAY_TOKEN` is
   configured.
5. Builds the sandbox-router image.
6. Smoke-tests the sandbox-router image locally in Docker.
7. Pushes the sandbox-router image to ECR.
8. Updates the EKS sandbox-router Deployment image.
9. Waits for the EKS sandbox-router rollout to complete.

The image tag defaults to the GitHub commit SHA:

```text
${GITHUB_SHA}
```

Manual workflow runs may override the tag through the `image_tag` input.

## Trigger Paths

The workflow runs on pushes to `sandbox-worker-control-plane` when any of these
paths change:

```text
Dockerfile.worker
Dockerfile.sandbox-router
Dockerfile.control-plane
package.json
pnpm-lock.yaml
pnpm-workspace.yaml
tsconfig.base.json
apps/supervisor-api/**
apps/sandbox-router/**
apps/control-plane-api/**
packages/**
config/**
.github/workflows/staging-images.yml
```

Docs-only commits do not trigger this workflow.

## GitHub Secrets

Required for ECR push and EKS router deploy:

```text
AWS_STAGING_GITHUB_ACTIONS_ROLE_ARN
```

Optional, but required for automatic Railway worker tag updates:

```text
RAILWAY_TOKEN
```

Without `RAILWAY_TOKEN`, the workflow still builds, smokes, pushes images, and
rolls out the sandbox-router in EKS. It explicitly skips the Railway worker
image variable update.

## AWS And EKS Access

GitHub Actions assumes:

```text
arn:aws:iam::918876873590:role/remote-codex-github-actions-staging
```

That role is trusted by the GitHub OIDC provider and currently covers these
repositories:

```text
dufangshi/remoteCodex
EvoEvolver/ElAgenteHarness
EvoEvolver/inact
EvoEvolver/InactWorker
```

IAM permissions:

- Attached policy `remote-codex-gh-ecr-push-staging` allows pushing the staging
  worker and sandbox-router images to ECR.
- Inline policy `remote-codex-gh-eks-router-deploy-staging` allows
  `eks:DescribeCluster` on `inact-harness-agents`.

EKS access:

```text
Cluster: inact-harness-agents
Region: ca-central-1
Namespace: remote-codex-staging
EKS access entry principal: arn:aws:iam::918876873590:role/remote-codex-github-actions-staging
Kubernetes group: remote-codex-github-actions-staging
```

Kubernetes RBAC:

```text
Role: remote-codex-router-deployer
RoleBinding: remote-codex-router-deployer-github-actions
```

The RBAC role is intentionally narrow:

- It can patch/update/get `deployment/remote-codex-sandbox-router`.
- It can read deployments, replicasets, pods, and events for rollout status.
- It cannot delete the router Deployment.

## ECR Images

Worker repository:

```text
918876873590.dkr.ecr.ca-central-1.amazonaws.com/remote-codex-worker-staging
```

Sandbox-router repository:

```text
918876873590.dkr.ecr.ca-central-1.amazonaws.com/remote-codex-sandbox-router-staging
```

Both images are tagged with the workflow image tag. For normal push-triggered
runs, that is the full commit SHA.

## Worker Image Flow

The control-plane uses these Railway variables when creating new worker Pods:

```text
SANDBOX_WORKER_IMAGE_REPOSITORY
SANDBOX_WORKER_IMAGE_TAG
```

The current compatibility variable is also maintained:

```text
SANDBOX_DEFAULT_IMAGE
```

`staging-images.yml` updates these after the worker image is pushed, but only
when `RAILWAY_TOKEN` exists:

```text
SANDBOX_WORKER_IMAGE_TAG=<image-tag>
SANDBOX_DEFAULT_IMAGE=<worker-ecr-repository>:<image-tag>
```

Changing these Railway variables triggers a Railway control-plane deployment.
Once that deployment is healthy, newly started worker Pods should use the new
worker image tag.

Existing worker Pods are not updated in place. They need to be recreated by
stopping/restarting the sandbox, or by starting a new sandbox/session path that
creates a fresh worker Pod.

## Sandbox-Router Image Flow

The workflow updates the EKS router Deployment after the router image is pushed:

```bash
aws eks update-kubeconfig \
  --region ca-central-1 \
  --name inact-harness-agents \
  --alias remote-codex-staging

kubectl -n remote-codex-staging set image \
  deployment/remote-codex-sandbox-router \
  sandbox-router=918876873590.dkr.ecr.ca-central-1.amazonaws.com/remote-codex-sandbox-router-staging:<image-tag>

kubectl -n remote-codex-staging rollout status \
  deployment/remote-codex-sandbox-router \
  --timeout=5m
```

The public router endpoint should remain:

```text
https://sandbox-router.lnz.app
```

## Railway Token Setup

Railway CLI CI authentication uses a project-scoped token:

```text
RAILWAY_TOKEN
```

Official Railway docs describe this as the token for project-level CLI actions.
Project tokens are created from the tokens page in the Railway project settings
and are scoped to a specific project environment.

For this repo:

1. Open the Railway dashboard.
2. Open project `TaskMarket`.
3. Open project settings.
4. Open the tokens page.
5. Create a project token for the `production` environment.
6. Add it to GitHub repository secrets as:

```text
RAILWAY_TOKEN
```

GitHub location:

```text
dufangshi/remoteCodex -> Settings -> Secrets and variables -> Actions -> Repository secrets
```

Do not use the local Railway OAuth access token from `~/.railway/config.json`.
It is not accepted by the Railway CLI as `RAILWAY_TOKEN` for CI project actions.

Do not set both `RAILWAY_TOKEN` and `RAILWAY_API_TOKEN` in the same workflow
environment. Railway CLI treats them as separate authentication modes.

Useful docs:

- Railway CLI authentication and token env vars:
  `https://docs.railway.com/cli/login`
- Railway project tokens:
  `https://docs.railway.com/deploy/integrations`
- Railway public API token types:
  `https://docs.railway.com/guides/public-api`

## Current Runtime State

Latest verified staging image run:

```text
Workflow: Staging Images
Run: 26703070983
Commit: 1f27c3f
Result: success
```

Railway production control-plane variables are currently aligned to:

```text
SANDBOX_WORKER_IMAGE_REPOSITORY=918876873590.dkr.ecr.ca-central-1.amazonaws.com/remote-codex-worker-staging
SANDBOX_WORKER_IMAGE_TAG=1f27c3f4e85742ca1bbff5d31ba5ad2d2ed19f3f
SANDBOX_DEFAULT_IMAGE=918876873590.dkr.ecr.ca-central-1.amazonaws.com/remote-codex-worker-staging:1f27c3f4e85742ca1bbff5d31ba5ad2d2ed19f3f
```

EKS sandbox-router Deployment is currently aligned to:

```text
918876873590.dkr.ecr.ca-central-1.amazonaws.com/remote-codex-sandbox-router-staging:1f27c3f5f69025c762c72e7a2abc17d493cb02df
```

Control-plane health:

```text
GET https://remote-codex-control-plane-production.up.railway.app/healthz
-> {"ok":true,"service":"control-plane-api"}
```

Router health:

```text
GET https://sandbox-router.lnz.app/healthz
-> {"ok":true,"role":"sandbox-router"}
```

## Verification Commands

Check recent GitHub runs:

```bash
gh run list --branch sandbox-worker-control-plane --limit 10
```

Watch a staging image run:

```bash
gh run watch <run-id> --exit-status
```

Check Railway worker image variables:

```bash
railway variable list \
  --service remote-codex-control-plane \
  --environment production \
  --kv | rg '^(SANDBOX_WORKER_IMAGE_REPOSITORY|SANDBOX_WORKER_IMAGE_TAG|SANDBOX_DEFAULT_IMAGE)='
```

Check Railway control-plane deployment:

```bash
railway service status \
  --service remote-codex-control-plane \
  --environment production \
  --json
```

Check control-plane health:

```bash
curl -fsS https://remote-codex-control-plane-production.up.railway.app/healthz
```

Check EKS router image:

```bash
kubectl --context remote-codex-staging \
  -n remote-codex-staging \
  get deploy remote-codex-sandbox-router \
  -o jsonpath='{.status.readyReplicas}/{.spec.replicas}{"\n"}{.spec.template.spec.containers[?(@.name=="sandbox-router")].image}{"\n"}'
```

Check router health:

```bash
curl -fsS https://sandbox-router.lnz.app/healthz
```

## Known Limits

- `RAILWAY_TOKEN` is not configured in GitHub repository secrets yet. Until it
  is added, Railway worker image variables must be updated manually after image
  pushes.
- Railway still needs to be configured to deploy this branch automatically, or
  deployments must be triggered manually/through variable changes.
- Worker image tag changes only affect newly created worker Pods.
- `codex_worker_prompt_e2e` still needs to wait for final LLM completion and
  assert assistant output.
