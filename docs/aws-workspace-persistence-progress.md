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

EKS/staging configuration checklist:

- EKS addon `aws-efs-csi-driver` must be installed and `ACTIVE`.
- The CSI controller service account `kube-system/efs-csi-controller-sa` must have an IRSA role with `AmazonEFSCSIDriverPolicy`.
- Worker Fargate Pods must be able to reach EFS mount targets on `tcp/2049`; staging uses worker security group `sg-096882e17d18914f1` and EFS security group `sg-09e6f258f246ed6a5`.
- The EFS filesystem must have mount targets in the worker private subnets used by the Fargate profile.
- Worker workspace mounts must use an EFS access point with POSIX UID/GID `1000:1000` and root directory `/remote-codex-workspaces`; without this, the non-root `agent` user can fail on `/workspace` with `EACCES`.
- Kubernetes must expose a static RWX PV/PVC named `staging-remote-codex-worker-workspace` / `remote-codex-worker-workspace`; the PV CSI `volumeHandle` must be `fs-0cae987596d071653::fsap-043567466c8c901a9` for current staging.
- Railway/control-plane variables must include `SANDBOX_WORKSPACE_PVC_NAME=remote-codex-worker-workspace` and `SANDBOX_WORKSPACE_VOLUME_SUBPATH_PREFIX=staging`.

Progress log:

- 2026-06-10: Continued after merge to `main` for the active goal. Current branch is `main` at `9380a7d Merge EFS workspace persistence`; local worktree started clean. Next actions are to re-verify the AWS/EKS/Fargate side from live CLI state first, then address remaining lifecycle/deployment risks, run Docker-based CI/e2e validation, and deploy only if those checks pass.
- 2026-06-10: Live CLI preflight failed immediately and work stopped per the active goal's "do not bypass failures" instruction:
  - `aws sts get-caller-identity` failed with `aws: [ERROR]: Your session has expired. Please reauthenticate using 'aws login'.`
  - `railway status --json` failed with `Unauthorized. Please run railway login again.`
  - `RAILWAY_CALLER=skill:use-railway@1.2.2 RAILWAY_AGENT_SESSION=railway-skill-aws-workspace-20260610 railway whoami --json` failed after OAuth refresh warning `invalid_grant`, then `Unauthorized. Please run railway login again.`
  - Non-mutating local context still showed AWS region `ca-central-1` and kubectl context `remote-codex-staging`, but Kubernetes AWS exec auth cannot be trusted while AWS login is expired.
  - Because the requested first real action was to apply/verify Fargate-side changes with AWS CLI, no AWS mutation, Railway mutation, Docker CI, e2e, or deploy was attempted after this preflight failure.
- 2026-06-10: Retried the live preflight after goal continuation; the same external-auth blocker remained:
  - `aws sts get-caller-identity` failed with `aws: [ERROR]: Your session has expired. Please reauthenticate using 'aws login'.`
  - `kubectl get namespace remote-codex-staging` failed because Kubernetes exec auth shells out to `aws`, which exited `255` with the same expired-session error.
  - `RAILWAY_CALLER=skill:use-railway@1.2.2 RAILWAY_AGENT_SESSION=railway-skill-aws-workspace-20260610 railway whoami --json` failed with `Unauthorized. Please run railway login again.`
  - Work stopped again at preflight. No Fargate/EKS mutation, Railway mutation, Docker CI, e2e, or deploy was attempted.
- 2026-06-10: Retried the live preflight a third consecutive time; the same external-auth blocker remained:
  - `aws sts get-caller-identity` failed with `aws: [ERROR]: Your session has expired. Please reauthenticate using 'aws login'.`
  - `kubectl get namespace remote-codex-staging` failed because Kubernetes exec auth shells out to `aws`, which exited `255` with the same expired-session error.
  - `RAILWAY_CALLER=skill:use-railway@1.2.2 RAILWAY_AGENT_SESSION=railway-skill-aws-workspace-20260610 railway whoami --json` failed with `Unauthorized. Please run railway login again.`
  - This is now the third consecutive goal turn blocked by the same AWS/Railway authentication condition, so the active goal is blocked until `aws login` and `railway login` are refreshed in this workspace.
- 2026-06-10: Resumed after refreshed login. Live preflight is now unblocked:
  - `aws sts get-caller-identity` returned account `918876873590` with assumed AdministratorAccess SSO role.
  - AWS region is `ca-central-1`.
  - `kubectl get namespace remote-codex-staging` returned namespace `Active`.
  - `railway whoami --json` succeeded for the Matter Lab workspace.
- 2026-06-10: Re-verified live Fargate/EFS side before code or deploy work:
  - EKS Fargate profile `remote-codex-staging-workers` on cluster `inact-harness-agents` is `ACTIVE`, selects namespace `remote-codex-staging` with label `remote-codex.dev/runtime-role=worker`, and uses subnets `subnet-0fa48208a8b2bd15d` and `subnet-0c214d167d8d51b5f`.
  - EKS addon `aws-efs-csi-driver` is `ACTIVE`, version `v3.2.0-eksbuild.1`, with IRSA role `arn:aws:iam::918876873590:role/remote-codex-staging-efs-csi-driver`; EFS CSI controller/node Pods are `Running`.
  - EFS filesystem `fs-0cae987596d071653` is `available`, encrypted, elastic throughput, with 2 mount targets.
  - EFS mount targets `fsmt-0643d87aa101b9f12` in `subnet-0fa48208a8b2bd15d` and `fsmt-00765d91c00368c7b` in `subnet-0c214d167d8d51b5f` are both `available`.
  - EFS security group `sg-09e6f258f246ed6a5` allows NFS `tcp/2049` from worker security group `sg-096882e17d18914f1`.
  - EFS access point `fsap-043567466c8c901a9` is `available`, enforces POSIX user `1000:1000`, and uses root directory `/remote-codex-workspaces` with creation owner `1000:1000` and permissions `700`.
  - Kubernetes PV `staging-remote-codex-worker-workspace` is `Bound` with CSI volume handle `fs-0cae987596d071653::fsap-043567466c8c901a9`.
  - Kubernetes PVC `remote-codex-worker-workspace` in namespace `remote-codex-staging` is `Bound`.
  - Railway production `remote-codex-control-plane` variables include `SANDBOX_WORKSPACE_PVC_NAME=remote-codex-worker-workspace` and `SANDBOX_WORKSPACE_VOLUME_SUBPATH_PREFIX=staging`.
- 2026-06-10: Re-ran a live worker-shaped Fargate/EFS subPath smoke Pod `remote-codex-efs-resumed-subpath-smoke` before Docker CI/e2e/deploy. Work stopped per the active goal because this smoke failed:
  - Pod namespace: `remote-codex-staging`.
  - Pod labels matched the Fargate worker selector `remote-codex.dev/runtime-role=worker`; it scheduled to Fargate node `fargate-ip-10-0-142-205.ca-central-1.compute.internal`.
  - Pod used PVC `remote-codex-worker-workspace`, init mount `/mnt/remote-codex-workspaces`, main mount `/workspace`, and `subPath: staging/resumed-subpath-smoke`.
  - Pod stayed `Pending` / `Init:0/1`.
  - Events included an early warning: `MountVolume.MountDevice failed ... driver name efs.csi.aws.com not found in the list of registered CSI drivers`.
  - Final inspected init container state was `ImagePullBackOff`, with message `Back-off pulling image "918876873590.dkr.ecr.ca-central-1.amazonaws.com/remote-codex-worker-staging:9380a7da4589f0557ebdd58d47ad085ca05051f4": ErrImagePull ... failed to extract layer ... context canceled`.
  - Init and main container logs were unavailable because containers never started.
  - No Docker CI, e2e, or deploy was attempted after this Fargate smoke failure.
- 2026-06-10: Continued investigation of the failed Fargate smoke instead of treating it as a deployment pass:
  - The failed `remote-codex-efs-resumed-subpath-smoke` Pod was BestEffort, so Fargate provisioned only `0.25vCPU 0.5GB` for a worker image that is about `1.26GB`; this did not match the real control-plane standard worker profile.
  - The old failed smoke Pod was later deleted and confirmed absent.
  - Re-ran the same EFS subPath smoke as `remote-codex-efs-standard-subpath-smoke` with real standard worker resources: main container requests/limits `1000m CPU`, `2Gi memory`, `40Gi ephemeral-storage`, and the same init-container resource shape used by the control-plane manifest.
  - The standard smoke still emitted an early one-time Fargate event `MountVolume.MountDevice failed ... driver name efs.csi.aws.com not found in the list of registered CSI drivers`, then recovered and successfully pulled the worker image in about `1m29s`.
  - The standard smoke Pod reached `Succeeded`; init and main containers exited `0`.
  - Init log showed the prepared subPath directory as `drwx------` owned by uid/gid `1000:1000`.
  - Main container ran as uid/gid `1000:1000`, saw `/workspace` as `drwx------`, created `/workspace/.venv/bin/python` and `/workspace/node_modules/pkg/index.js`, executed/read both as `ok`, and `stat` reported `/workspace` as `1000:1000 700` with `.venv` and `node_modules` owned by `1000:1000`.
  - `remote-codex-efs-standard-subpath-smoke` was deleted after collecting logs.
- 2026-06-10: Local targeted validation after live Fargate/EFS verification passed:
  - `pnpm --filter @remote-codex/control-plane-api test -- adapters.test.ts` passed: 5 files / 112 tests.
  - `terraform -chdir=infra/terraform/staging validate` passed.
  - `pnpm --filter @remote-codex/control-plane-api build` passed.
  - `pnpm --filter @remote-codex/supervisor-api build` passed.
- 2026-06-10: Docker-based local CI smoke passed:
  - Worker image build passed with `docker build -f Dockerfile.worker -t remote-codex-worker:local-workspace-persistence --build-arg REMOTE_CODEX_IMAGE_VERSION=local-workspace-persistence --build-arg REMOTE_CODEX_GIT_SHA=9380a7da4589f0557ebdd58d47ad085ca05051f4 .`.
  - Worker container smoke passed: container `remote-codex-worker-local-smoke` returned `/readyz` with `status=ready`, `role=worker`, sandbox id `sbx_verify`, user id `user_verify`, workspace root `/workspace`, and empty runtimes because agent providers were disabled for the smoke.
  - Worker smoke container was removed.
  - Sandbox router image build passed with `docker build -f Dockerfile.sandbox-router -t remote-codex-router:local-workspace-persistence --build-arg REMOTE_CODEX_IMAGE_VERSION=local-workspace-persistence --build-arg REMOTE_CODEX_GIT_SHA=9380a7da4589f0557ebdd58d47ad085ca05051f4 .`.
  - Router container smoke passed: container `remote-codex-router-local-smoke` returned `/healthz` with `{ "ok": true, "role": "sandbox-router" }`.
  - Router smoke container was removed.
- 2026-06-10: Staging phase-one e2e smoke passed after Docker CI:
  - Command: `STAGING_STOP_SANDBOX_AFTER_SMOKE=1 STAGING_IDEMPOTENT_LIFECYCLE_SMOKE=1 STAGING_SANDBOX_READY_TIMEOUT_MS=900000 STAGING_SANDBOX_STOP_TIMEOUT_MS=900000 pnpm exec tsx scripts/staging-phase-one-smoke.ts`.
  - Smoke generated at `2026-06-10T13:27:09.093Z` and returned top-level `ok: true`.
  - Started sandbox `cced27cb-c543-4425-b0fd-6211e5baf41e` with image `918876873590.dkr.ecr.ca-central-1.amazonaws.com/remote-codex-worker-staging:9380a7da4589f0557ebdd58d47ad085ca05051f4` and resource profile `standard`.
  - Sandbox reached `running` with `startupProgress=100`.
  - Idempotent lifecycle smoke passed for first start, second start, and restart paths.
  - Created project/workspace/session and worker session successfully.
  - Router health passed and browser-to-router-to-worker metadata request reached the worker.
  - Codex runtime was `ready` with provider `codex`, transport `stdio`, and restart count `0`.
  - Codex worker prompt e2e passed.
  - Stop sandbox returned `stopping` and final health converged to `stopped`.
  - Post-smoke checks confirmed the smoke worker Pod and the standard Fargate smoke Pod were absent after cleanup.
  - Live health after smoke: control-plane `/healthz` returned build SHA `9380a7da4589f0557ebdd58d47ad085ca05051f4`; router `/healthz` returned `{ "ok": true, "role": "sandbox-router" }`.
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
- 2026-06-10: Committed lifecycle hardening as `2db7f21 Harden EFS workspace lifecycle` and pushed `feature/aws-efs-workspace-persistence`.
- 2026-06-10: Dispatched GitHub Actions `Staging Images` run `27259900937` on `feature/aws-efs-workspace-persistence`; it passed in 6m31s. CI evidence:
  - Worker Docker build passed.
  - Worker Docker smoke passed.
  - Sandbox router Docker build/smoke passed.
  - Worker image pushed.
  - Railway control-plane variables updated.
  - Railway frontend deployed.
  - Sandbox router image pushed and EKS router rollout passed.
- 2026-06-10: Post-deploy health checks passed:
  - `https://remote-codex-control-plane-production.up.railway.app/healthz` returned build SHA `2db7f210c16c2083a0eb76a5a7b405a178e007c9`.
  - `https://sandbox-router.lnz.app/healthz` returned `{ "ok": true, "role": "sandbox-router" }`.
  - EKS router deployment was rolled out with image tag `2db7f210c16c2083a0eb76a5a7b405a178e007c9`.
- 2026-06-10: Found deployment workflow gap after health checks: production Railway control-plane did not have `SANDBOX_WORKSPACE_PVC_NAME` or `SANDBOX_WORKSPACE_VOLUME_SUBPATH_PREFIX`, so workers would not mount the PVC even though code and EKS resources existed.
- 2026-06-10: Updated local workflow `.github/workflows/staging-images.yml` to set and verify:
  - `SANDBOX_WORKSPACE_PVC_NAME=remote-codex-worker-workspace`
  - `SANDBOX_WORKSPACE_VOLUME_SUBPATH_PREFIX=staging`
- 2026-06-10: Applied those two Railway variables directly to production control-plane with Railway CLI. Railway started a new control-plane deployment `ebf4b5e1-7d37-460b-bafc-6baab7dd69e6`, which reached `SUCCESS`. Filtered variable readback confirmed both workspace variables are set.
- 2026-06-10: Ran staging smoke command:
  - `STAGING_STOP_SANDBOX_AFTER_SMOKE=1 STAGING_IDEMPOTENT_LIFECYCLE_SMOKE=1 STAGING_SANDBOX_READY_TIMEOUT_MS=900000 STAGING_SANDBOX_STOP_TIMEOUT_MS=900000 pnpm exec tsx scripts/staging-phase-one-smoke.ts`
- 2026-06-10: Staging smoke failed. Do not continue until this is fixed. Failure evidence:
  - Smoke error: route-token request failed with `409 sandbox_not_running` because sandbox never reached running.
  - Smoke `sandbox_ready` step observed sandbox state `failed`, status reason `PodFailed`.
  - Worker Pod: `remote-codex-worker-cced27cb-c543-4425-b0fd-6211e5baf41e`, namespace `remote-codex-staging`, image tag `2db7f210c16c2083a0eb76a5a7b405a178e007c9`.
  - Pod did include EFS configuration: PVC `remote-codex-worker-workspace`, subpath `staging/cced27cb-c543-4425-b0fd-6211e5baf41e`, `/workspace` mount, and env `REMOTE_CODEX_WORKSPACE_PERSISTENCE=efs`.
  - Init container `prepare-workspace-volume` completed with exit code `0`.
  - Worker container exited with code `1`.
  - Worker log: `Error: EACCES: permission denied, access '/workspace'` from `validateWorkerEntrypointEnvironment`.
  - Interpretation: the EFS-backed `/workspace` mount exists, but the non-root `agent` user cannot access the mounted subPath. The init container currently creates/chowns/chmods the sandbox subdirectory on the init mount, but Kubernetes mounts that subPath itself at `/workspace`; the effective root of `/workspace` is not accessible to the worker user. Fix likely needs a mount/subPath ownership strategy change, e.g. mount the EFS root elsewhere and bind/use the prepared subdirectory as workspace, use an EFS access point with enforced UID/GID, or adjust Pod security/fsGroup behavior if supported on Fargate/EFS.
- 2026-06-10: Created EFS access point `fsap-043567466c8c901a9` for filesystem `fs-0cae987596d071653`, name/client token `staging-remote-codex-worker-workspace-ap`, POSIX user `1000:1000`, root directory `/remote-codex-workspaces`, creation owner `1000:1000`, permissions `700`; access point state became `available`.
- 2026-06-10: Recreated static PV/PVC with the same Kubernetes names but with EFS CSI volume handle `fs-0cae987596d071653::fsap-043567466c8c901a9`; `kubectl get pv` showed `Bound` and the access-point volume handle, and PVC `remote-codex-worker-workspace` in namespace `remote-codex-staging` returned `Bound`.
- 2026-06-10: Ran Fargate access point smoke Pod `remote-codex-efs-ap-smoke` using UID/GID `1000:1000`; it mounted PVC `remote-codex-worker-workspace` at `/workspace`, created `.venv` and `node_modules`-style directories under `/workspace/staging/ap-smoke`, wrote/read files, and exited `Succeeded` with code `0`.
- 2026-06-10: Ran worker-shaped Fargate subPath smoke Pod `remote-codex-efs-subpath-smoke`:
  - Init container mounted the PVC root at `/mnt/remote-codex-workspaces`, created `staging/subpath-smoke`, and logged `drwx------ 2 1000 1000 ... /mnt/remote-codex-workspaces/staging/subpath-smoke`.
  - Main container ran as UID/GID `1000:1000`, mounted the same PVC with `subPath: staging/subpath-smoke` at `/workspace`, logged `/workspace` as `drwx------ 2 1000 1000`, created `/workspace/.venv/bin/python` and `/workspace/node_modules/pkg/index.js`, read both files back as `ok`, and exited `Succeeded` with code `0`.
- 2026-06-10: Updated Terraform to codify the EFS access point and PV `volume_handle = "${aws_efs_file_system.worker_workspace.id}::${aws_efs_access_point.worker_workspace.id}"`, with variables for access point UID/GID/root path/permissions.
