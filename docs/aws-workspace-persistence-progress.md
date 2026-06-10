# AWS Workspace Persistence Progress

Date: 2026-06-10

Branch: `feature/aws-efs-workspace-persistence`

Objective:

- Use AWS CLI / kubectl first to apply the Fargate/EKS side of workspace persistence before credentials expire.
- Then fix agent container lifecycle risks around shutdown, Pod termination state, and restart/stop edge cases.
- Run targeted validation, then Docker-based CI/e2e tests where possible.
- Deploy directly if the infrastructure and tests are in a deployable state.
- Do not bypass failures. If a required external step fails and cannot be safely completed, stop and report the exact blocker.

Current baseline:

- Feature branch already contains EFS workspace persistence code and Terraform for staging.
- Latest `origin/sandbox-worker-control-plane` has been merged into the feature branch.
- Previous validation passed:
  - `pnpm --filter @remote-codex/control-plane-api test -- adapters.test.ts`
  - `pnpm --filter @remote-codex/control-plane-api build`
  - `terraform -chdir=infra/terraform/staging validate`

Planned checkpoints:

1. AWS/EKS/Fargate persistence infrastructure
   - Confirm AWS identity, region, EKS cluster, namespace, Fargate profile, VPC/subnets/security groups.
   - Ensure EFS CSI driver support is installed and healthy.
   - Create or verify EFS file system, mount targets, NFS security group access, static PV, and PVC.
   - Record exact resource IDs and kubectl evidence here.

2. Agent container lifecycle fixes
   - Add worker SIGTERM/SIGINT graceful shutdown that calls `app.close()`.
   - Add a shutdown hard timeout below the Pod termination grace period.
   - Add explicit Pod `terminationGracePeriodSeconds`.
   - Detect Kubernetes Pod `metadata.deletionTimestamp` as `stopping`.
   - Prefer non-blocking Pod delete behavior if appropriate.

3. Validation
   - Run focused unit tests around adapter lifecycle and worker entrypoint changes.
   - Run control-plane build.
   - Run Terraform fmt/validate.
   - Run Docker-based worker smoke and any available e2e/staging smoke that can execute with current credentials.

4. Deployment
   - If tests and infrastructure pass, deploy updated images/services.
   - Verify Railway control-plane health and EKS/router health after deploy.

Progress log:

- 2026-06-10: Created this progress document before mutating AWS or code.
- 2026-06-10: AWS preflight confirmed account `918876873590`, region `ca-central-1`, EKS cluster `inact-harness-agents`, context `remote-codex-staging`, namespace `remote-codex-staging`, Fargate profile `remote-codex-staging-workers`, worker/cluster security group `sg-096882e17d18914f1`, worker subnets `subnet-0fa48208a8b2bd15d` and `subnet-0c214d167d8d51b5f`.
- 2026-06-10: Installed EKS addon `aws-efs-csi-driver` version `v3.2.0-eksbuild.1` with IRSA role `arn:aws:iam::918876873590:role/remote-codex-staging-efs-csi-driver`; addon status became `ACTIVE`, controller/node Pods are running in `kube-system`.
- 2026-06-10: Created EFS security group `sg-09e6f258f246ed6a5` named `staging-remote-codex-worker-workspace-efs` with NFS ingress `tcp/2049` from `sg-096882e17d18914f1`.
- 2026-06-10: Created encrypted elastic-throughput EFS filesystem `fs-0cae987596d071653` named `staging-remote-codex-worker-workspace`; lifecycle policy `TransitionToIA=AFTER_30_DAYS`.
- 2026-06-10: Created EFS mount targets `fsmt-0643d87aa101b9f12` in `subnet-0fa48208a8b2bd15d` and `fsmt-00765d91c00368c7b` in `subnet-0c214d167d8d51b5f`; initial state was `creating`.
- 2026-06-10: Created Kubernetes static PV `staging-remote-codex-worker-workspace` and PVC `remote-codex-worker-workspace` in namespace `remote-codex-staging`; both are `Bound`.
- 2026-06-10: Confirmed both EFS mount targets are `available`.
- 2026-06-10: Ran real Fargate mount smoke Pod `remote-codex-efs-mount-smoke` using PVC `remote-codex-worker-workspace`; it scheduled onto `fargate-ip-10-0-129-196.ca-central-1.compute.internal`, wrote and read `/workspace/efs-smoke.txt`, exited `Succeeded` with code `0`, and was deleted afterward.
- 2026-06-10: Implemented lifecycle fixes:
  - Worker entrypoint handles `SIGTERM`/`SIGINT`, calls `app.close()`, and hard exits after 55 seconds.
  - Worker Pod manifest sets `terminationGracePeriodSeconds = 60`.
  - Normal stop requests use non-blocking `kubectl delete pod --wait=false`.
  - Kubernetes Pod `metadata.deletionTimestamp` maps to sandbox state `stopping`.
  - Terraform now declares the EFS CSI addon and IRSA role used by the AWS CLI changes.
- 2026-06-10: Validation passed:
  - `pnpm --filter @remote-codex/control-plane-api test -- adapters.test.ts`
  - `pnpm --filter @remote-codex/control-plane-api build`
  - `pnpm --filter @remote-codex/supervisor-api build`
  - `terraform fmt infra/terraform/staging`
  - `terraform -chdir=infra/terraform/staging validate`
- 2026-06-10: Docker-based CI smoke failed and work stopped per objective:
  - Command: `docker build -f Dockerfile.worker -t remote-codex-worker:lifecycle-smoke --build-arg REMOTE_CODEX_IMAGE_VERSION=lifecycle-smoke --build-arg REMOTE_CODEX_GIT_SHA=$(git rev-parse HEAD) .`
  - Failure stage: Dockerfile.worker `pnpm install --frozen-lockfile`.
  - Error: `Command failed with exit code 128: git fetch --depth 1 origin 313a74466f4ace00bfb8c449c51b3b029f3e1b7c` followed by `fatal: could not read Username for 'https://github.com': No such device or address`.
  - Interpretation: the worker Docker build needs GitHub credentials/deploy key access for a locked git dependency. The local Docker build did not receive `REMOTE_CODEX_THREAD_UI_DEPLOY_KEY_B64` or a BuildKit secret, and the Dockerfile fell back to unavailable in-container Git credentials.
  - Per instruction, no workaround, e2e run, commit, push, or deployment was attempted after this failure.
- 2026-06-10: Continued after resume. Verified GitHub repo secrets include `REMOTE_CODEX_THREAD_UI_DEPLOY_KEY_B64` and workflow `.github/workflows/staging-images.yml` passes it to Docker BuildKit as `--secret id=remote_codex_thread_ui_deploy_key,env=REMOTE_CODEX_THREAD_UI_DEPLOY_KEY_B64`. This means the true CI Docker path has the intended deploy key even though the local shell environment does not.
