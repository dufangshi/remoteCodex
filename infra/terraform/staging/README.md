# Remote Codex Staging Terraform

This Terraform stack attaches Remote Codex staging resources to an existing EKS
cluster.

It is the first staging infra layer for the `sandbox-worker-control-plane`
branch. It is deliberately scoped to resources that Remote Codex owns:

- ECR repositories.
- CloudWatch log groups.
- Kubernetes namespace.
- Worker service account.
- Sandbox manager service account and namespace-scoped RBAC.
- Optional worker auth secret.
- Optional sandbox-router Deployment and LoadBalancer Service.

## Required Inputs

Fill `terraform.tfvars` from `terraform.tfvars.example` with:

- `aws_region`
- `aws_account_id`
- `eks_cluster_name`
- `fargate_profile_name`
- `vpc_id`
- `private_subnet_ids`
- `worker_security_group_ids`
- `route_token_signing_secret`
- `router_worker_auth_token`
- `router_worker_identity_secret`

Set `worker_auth_token` if Terraform should create the Kubernetes Secret used by
worker Pods. If it is `null`, create the Secret outside Terraform with the same
name as `worker_auth_token_secret_name`.

Set `router_image` only after a sandbox-router image exists in a registry the
cluster can pull from. When `router_image` is `null`, router Kubernetes resources
are not created.

## Common Commands

```bash
terraform init
terraform fmt -recursive
terraform validate
terraform plan
terraform apply
```

After apply, use the outputs:

```bash
terraform output control_plane_env
terraform output aws_staging_evidence_env
terraform output github_staging_environment_vars
```

Those maps are meant to be copied into the control-plane deployment environment
and the Phase 0-6 staging evidence workflow configuration.
