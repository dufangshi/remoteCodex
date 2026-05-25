# Staging Release Readiness

This document is the first staging release-readiness note for the
`sandbox-worker-control-plane` branch.

It does not claim that staging is already deployed. It defines the exact
services, environment, smoke checks, rollback steps, and blocking gates that
must be satisfied before the first staging deploy is considered ready.

## Release Target

Phase-one staging should exercise the real product shape with non-production
credentials:

```text
Browser
  -> Railway frontend
  -> Railway control-plane API
  -> sandbox router
  -> AWS EKS Fargate worker Pod
  -> staging LLM gateway
  -> staging ElAgenteHarness
```

The staging environment must prove that product auth, sandbox routing, worker
identity, gateway credential bootstrap, harness credential bootstrap, and usage
import work together without exposing root provider keys or product JWTs inside
the worker.

## Required Services

- Railway frontend service.
- Railway control-plane API service.
- Product Postgres database.
- Sandbox router service.
- AWS EKS cluster with Fargate profile for worker Pods.
- ECR or selected image registry for `Dockerfile.worker` images.
- Staging LLM gateway.
- Staging ElAgenteHarness service.
- Object storage if workspace snapshots or artifacts are enabled.
- Log and metrics sink for control-plane, router, and worker logs.

## Required Control-Plane Environment

- `DATABASE_URL`
- Product auth mode and JWT verifier settings:
  - `REMOTE_CODEX_AUTH_MODE`
  - issuer
  - audience
  - JWKS URL or public key source
- Route-token signing current key and key id.
- Previous route-token signing key only during rotation windows.
- Router public HTTP base URL.
- Router public WebSocket base URL.
- Worker internal token material or secret reference.
- Sandbox manager provider set to the AWS/EKS adapter.
- AWS region, cluster, namespace, service account, Fargate profile, subnet, and
  security group settings.
- Worker image repository and immutable image tag.
- Worker resource profile defaults.
- Gateway base URL and gateway admin credential.
- Harness base URL and harness admin credential if the harness requires admin
  provisioning.
- Usage import schedule disabled or enabled explicitly for staging.

## Required Worker Environment

These values must be injected by the control plane or sandbox manager and must
not be accepted from the browser:

- `REMOTE_CODEX_SANDBOX_ID`
- `REMOTE_CODEX_USER_ID`
- `REMOTE_CODEX_WORKER_AUTH_TOKEN`
- `REMOTE_CODEX_LLM_GATEWAY_BASE_URL`
- scoped gateway token or configured provider credential file generated from
  that token
- `ELAGENTE_HARNESS_BASE_URL`
- scoped `INACT_X_APP_KEY`
- `WORKSPACE_ROOT=/workspace`
- `HOME=/home/agent`

The worker must not receive raw OpenAI, Anthropic, or other provider root keys.

## Required Smoke Checks

Run these checks before marking any staging checkbox complete:

- Auth smoke:
  - valid staging user token reaches `GET /api/me`;
  - expired token is rejected;
  - wrong issuer is rejected;
  - wrong audience is rejected.
- Product metadata smoke:
  - create project;
  - create workspace inside project;
  - create session inside workspace.
- Sandbox lifecycle smoke:
  - start one sandbox;
  - observe worker Pod status;
  - wait for worker `/readyz`;
  - stop the sandbox;
  - confirm registry and Pod state converge.
- Router smoke:
  - issue route token;
  - connect browser or scripted client through router;
  - verify direct worker non-health request fails without router-injected token;
  - verify browser product JWT is not forwarded to worker.
- Provider gateway smoke:
  - Codex reaches the staging gateway;
  - Claude Code reaches the staging gateway;
  - OpenCode reaches the staging gateway;
  - worker env/config contains only scoped gateway credentials.
- Harness smoke:
  - worker calls staging ElAgenteHarness with injected `INACT_X_APP_KEY`;
  - raw harness key is not returned by any Remote Codex API response.
- Usage smoke:
  - import one gateway usage event;
  - event maps to the correct user and sandbox;
  - duplicate import does not double-count usage.
- Rollback smoke:
  - stop one sandbox;
  - redeploy previous Railway control-plane image or documented rollback target;
  - confirm route-token issuance and sandbox status endpoints still respond.

## Blocking Gates

The first staging deploy is not release-ready while any of these are true:

- Production-style auth provider smoke has not run.
- Worker image has not been built from a clean checkout.
- A real EKS Fargate sandbox cannot reach `/readyz`.
- Browser-to-router-to-worker traffic has not been exercised.
- Direct worker access without the router-injected token succeeds.
- Raw provider root keys enter the worker environment or provider config.
- Gateway or harness secrets appear in logs or API responses.
- Usage import cannot map gateway usage to the correct product user.
- There is no rollback path for Railway control-plane/frontend deployments.

## Rollback Steps

For the first staging deploy, rollback is operational rather than automated:

1. Stop active staging sandboxes through the control-plane admin endpoint.
2. Scale down or redeploy the sandbox router to the last known working version.
3. Redeploy the previous Railway frontend and control-plane API builds.
4. Repoint the worker image tag in staging config to the previous immutable
   image tag if worker bootstrap changed.
5. Rotate staging route-token signing material if route-token handling changed
   and compromise is suspected.
6. Revoke or rotate staging gateway and harness user keys if credential
   injection or redaction failed.
7. Restore the staging database from backup only if a forward migration cannot
   be repaired by a new forward migration.

## Checklist Links

- Primary execution board:
  [Remote Codex Side Execution Checklist](./remote-codex-side-execution-checklist.md)
- Delivery board:
  [Remote Codex Side Delivery Checklist](./remote-codex-side-delivery-checklist.md)
- Current branch status:
  [Remote Codex Branch Status](./status.md)
- Production release gates:
  [Release Gates](./release-gates.md)

