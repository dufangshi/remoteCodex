# Remote Codex Infrastructure

This directory contains infrastructure-as-code for Remote Codex deployment
targets.

The first target is a staging AWS/EKS setup that assumes the EKS cluster and
VPC already exist. Terraform creates the Remote Codex-specific resources around
that cluster:

- ECR repositories for worker and optional router images.
- CloudWatch log groups.
- Kubernetes namespace.
- Worker runtime service account.
- Namespace-scoped sandbox manager service account and RBAC.
- Optional worker internal auth Kubernetes secret.
- Optional sandbox-router Deployment and LoadBalancer Service.

The staging module outputs the environment variable names expected by the
control plane and the Phase 0-6 staging evidence scripts.

## Staging

```bash
cd infra/terraform/staging
cp terraform.tfvars.example terraform.tfvars
# Fill terraform.tfvars with the existing EKS/VPC values.
terraform init
terraform plan
terraform apply
```

Do not commit `terraform.tfvars`, state files, plans, or secret values.

The initial module is intentionally conservative: it does not create or mutate
the EKS cluster, VPC, subnets, or Fargate profile. Those are supplied as inputs
so this repo can safely attach Remote Codex staging resources to an existing
cluster first.
