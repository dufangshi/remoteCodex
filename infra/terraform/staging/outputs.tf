output "worker_image_repository_url" {
  description = "ECR repository URL for worker images."
  value       = aws_ecr_repository.worker.repository_url
}

output "router_image_repository_url" {
  description = "ECR repository URL for sandbox-router images, when created."
  value       = var.create_router_ecr_repository ? aws_ecr_repository.router[0].repository_url : null
}

output "kubernetes_namespace" {
  description = "Remote Codex staging Kubernetes namespace."
  value       = kubernetes_namespace_v1.remote_codex.metadata[0].name
}

output "worker_service_account_name" {
  description = "Runtime worker service account."
  value       = kubernetes_service_account_v1.worker.metadata[0].name
}

output "sandbox_manager_service_account_name" {
  description = "Namespace-scoped sandbox manager service account."
  value       = kubernetes_service_account_v1.sandbox_manager.metadata[0].name
}

output "worker_auth_token_secret_name" {
  description = "Kubernetes Secret expected to contain worker internal auth token."
  value       = var.worker_auth_token_secret_name
}

output "router_service_name" {
  description = "Sandbox-router Kubernetes Service name, when router_image is set."
  value       = var.router_image == null ? null : kubernetes_service_v1.sandbox_router[0].metadata[0].name
}

output "control_plane_env" {
  description = "Environment variables for the control-plane AWS sandbox adapter."
  value       = local.control_plane_env
}

output "aws_staging_evidence_env" {
  description = "Environment variables for AWS-only staging preflight evidence."
  value       = local.aws_staging_evidence_env
}

output "github_staging_environment_vars" {
  description = "Non-secret GitHub Environment variables for the manual staging evidence workflow."
  value = merge(local.aws_staging_evidence_env, {
    STAGING_CONTROL_PLANE_BASE_URL        = var.control_plane_base_url
    STAGING_SANDBOX_READY_TIMEOUT_MS      = "900000"
    STAGING_SANDBOX_STOP_TIMEOUT_MS       = "900000"
    STAGING_IDEMPOTENT_LIFECYCLE_SMOKE    = "1"
    STAGING_STOP_SANDBOX_AFTER_SMOKE      = "1"
    STAGING_DIRECT_WORKER_NETWORK_MODE    = "private"
    STAGING_DIRECT_WORKER_INGRESS_POLICY  = "router-only"
  })
}
