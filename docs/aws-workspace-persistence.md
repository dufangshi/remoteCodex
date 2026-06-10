# AWS Workspace Persistence

## Decision

Use Amazon EFS mounted into EKS Fargate worker Pods through the EFS CSI driver
as the phase-one persistent workspace backend.

The worker keeps `WORKSPACE_ROOT=/workspace`. When
`SANDBOX_WORKSPACE_PVC_NAME` is configured, the AWS sandbox adapter mounts that
PVC at `/workspace` and uses a sandbox-specific subpath:

```text
<SANDBOX_WORKSPACE_VOLUME_SUBPATH_PREFIX>/<sandbox-id>
```

For staging, Terraform sets the prefix to the environment name. A resumed or
recreated container for the same sandbox id mounts the same EFS directory, so
the worker sees the previous `/workspace/<workspace-slug>` tree.

## Why EFS

The workspace needs a real Unix filesystem interface. Agent runs commonly create
virtual environments, `node_modules`, package manager caches, symlinks, lock
files, executable bits, and many small files. EFS is a managed NFS filesystem
that can be mounted by Kubernetes Pods as a normal filesystem. This fits online
workspace use better than S3 snapshots or object-store FUSE layers.

S3 remains useful for offline snapshots, export, and disaster recovery. It
should not be the primary live workspace filesystem for interactive agent runs.

## Runtime Shape

- One environment-level EFS file system backs worker workspace storage.
- One Kubernetes PV/PVC exposes that EFS file system in the sandbox namespace.
- Each worker Pod mounts only its sandbox subdirectory at `/workspace`.
- An init container creates and owns the sandbox subdirectory before the worker
  container starts.
- The control-plane workspace records still use paths like
  `/workspace/<workspace-slug>`.
- If `SANDBOX_WORKSPACE_PVC_NAME` is unset, the worker keeps the existing
  ephemeral Fargate filesystem behavior.

## AWS Requirements

- EKS cluster has EFS CSI support available for Fargate volume mounting.
- EFS mount targets exist in the private subnets used by worker Pods.
- The EFS security group allows NFS TCP/2049 from the worker Pod security
  groups.
- The sandbox namespace has the PVC named by `SANDBOX_WORKSPACE_PVC_NAME`.

## EKS Configuration Plan

1. Confirm the EKS cluster can mount EFS from Fargate Pods.
   - The worker Pods run on EKS Fargate, so use EFS CSI static provisioning.
   - Do not rely on dynamic EFS provisioning for Fargate.
   - Confirm the cluster has the EFS CSI support required by the AWS account and
     cluster version.

2. Create the persistent workspace EFS file system.
   - Use encryption at rest.
   - Use `generalPurpose` performance mode for interactive workspace latency.
   - Use elastic throughput for the first production shape unless measured load
     justifies provisioned throughput.
   - Keep lifecycle transition enabled for older inactive files.

3. Create EFS mount targets in the worker private subnets.
   - Use the same private subnet set that is passed to the control plane as
     `SANDBOX_SUBNET_IDS`, or a subnet set that those worker Pods can reach.
   - Confirm VPC DNS resolution and DNS hostnames are enabled; EFS mount helpers
     depend on DNS.

4. Configure NFS security group access.
   - Attach an EFS security group to the EFS mount targets.
   - Allow inbound TCP `2049` from every worker Pod security group in
     `SANDBOX_SECURITY_GROUP_IDS`.
   - Keep the worker security groups restricted to the router and required
     egress paths; the EFS rule should not make workers publicly reachable.

5. Create the Kubernetes static PV and PVC.
   - Use `driver = "efs.csi.aws.com"`.
   - Set `volume_handle` to the EFS file system id.
   - Set access mode `ReadWriteMany`.
   - Set reclaim policy `Retain` so deleting the PV/PVC does not delete
     workspace data.
   - Use an empty `storageClassName` for the static PV/PVC binding.
   - Create the PVC in the sandbox worker namespace.

6. Inject the control-plane adapter variables.
   - `SANDBOX_WORKSPACE_PVC_NAME=<pvc name>`
   - `SANDBOX_WORKSPACE_VOLUME_SUBPATH_PREFIX=<environment name>`
   - The staging Terraform module writes both values into `control_plane_env`.

7. Confirm the Fargate profile still matches worker Pods.
   - The namespace and labels used by worker Pods must still match the existing
     Fargate profile.
   - Adding a PVC should not change the labels used for scheduling.

8. Verify runtime mount behavior.
   - Start a sandbox and confirm the worker Pod has the
     `workspace-persistence` volume.
   - Confirm the init container completes and creates
     `<prefix>/<sandbox-id>` on EFS.
   - Confirm the main worker container sees `/workspace` as writable by uid
     `1000`.
   - Create a file under `/workspace`, stop/restart the sandbox, and confirm the
     file still exists after resume.

## Tradeoffs

EFS gives the best live Unix filesystem compatibility among managed AWS options,
but it is still network storage. Large dependency trees and many tiny metadata
operations can be slower than local NVMe or container ephemeral storage. Keep
language caches inside the persistent workspace only when they must survive
resume; otherwise prefer runtime package caches that can be rebuilt.

The current implementation isolates workers by Kubernetes `subPathExpr`, not by
separate file systems. The worker container only sees its sandbox subdirectory,
but the shared EFS file system should still be treated as multi-tenant storage:
use conservative permissions, avoid privileged containers, and consider EFS
access points per sandbox if stronger storage isolation becomes necessary.
