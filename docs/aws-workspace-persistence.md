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
