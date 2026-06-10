variable "aws_region" {
  description = "AWS region containing the existing staging EKS cluster."
  type        = string
}

variable "aws_account_id" {
  description = "AWS account id used in staging evidence."
  type        = string
}

variable "environment" {
  description = "Logical Remote Codex environment name."
  type        = string
  default     = "staging"
}

variable "eks_cluster_name" {
  description = "Existing EKS cluster name."
  type        = string
}

variable "fargate_profile_name" {
  description = "Existing EKS Fargate profile name that matches Remote Codex worker Pods."
  type        = string
}

variable "vpc_id" {
  description = "VPC id used by the existing EKS cluster."
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnet ids used by Fargate worker Pods."
  type        = list(string)
}

variable "public_load_balancer_subnet_ids" {
  description = "Public subnet ids tagged for internet-facing EKS Auto Mode load balancers."
  type        = list(string)
  default     = []
}

variable "worker_security_group_ids" {
  description = "Security group ids used by worker Pods or the worker-facing network path."
  type        = list(string)
}

variable "kubernetes_namespace" {
  description = "Kubernetes namespace for Remote Codex staging runtime resources."
  type        = string
  default     = "remote-codex-staging"
}

variable "worker_service_account_name" {
  description = "Service account used by runtime worker Pods."
  type        = string
  default     = "remote-codex-worker"
}

variable "sandbox_manager_service_account_name" {
  description = "Service account used by the component that creates and deletes worker Pods."
  type        = string
  default     = "remote-codex-sandbox-manager"
}

variable "sandbox_manager_role_arn" {
  description = "Optional IAM role ARN for the sandbox manager service account."
  type        = string
  default     = ""
}

variable "worker_ecr_repository_name" {
  description = "ECR repository name for immutable worker images."
  type        = string
  default     = "remote-codex-worker-staging"
}

variable "worker_ecr_images_to_keep" {
  description = "Maximum number of worker images to keep in ECR."
  type        = number
  default     = 50
}

variable "worker_image_tag" {
  description = "Immutable worker image tag expected by the control plane and staging evidence."
  type        = string
  default     = "replace-with-git-sha"
}

variable "worker_auth_token_secret_name" {
  description = "Kubernetes Secret name containing worker internal auth token under key `token`."
  type        = string
  default     = "remote-codex-worker-auth-token"
}

variable "worker_auth_token" {
  description = "Optional worker internal auth token. If null, create the Secret outside Terraform."
  type        = string
  sensitive   = true
  nullable    = true
  default     = null
}

variable "llm_gateway_token_secret_name" {
  description = "Kubernetes Secret name containing worker LLM gateway API keys."
  type        = string
  default     = "remote-codex-llm-gateway-tokens"
}

variable "llm_gateway_static_token_secret_key" {
  description = "Secret data key used when all staging Codex workers share one sub2api token."
  type        = string
  default     = "sub2api-api-key"
}

variable "llm_gateway_static_token" {
  description = "Optional staging sub2api API key. If null, create the Secret outside Terraform."
  type        = string
  sensitive   = true
  nullable    = true
  default     = null
}

variable "worker_log_group_name" {
  description = "CloudWatch log group name for worker logs."
  type        = string
  default     = "/remote-codex/staging/worker"
}

variable "router_log_group_name" {
  description = "CloudWatch log group name for sandbox router logs."
  type        = string
  default     = "/remote-codex/staging/sandbox-router"
}

variable "log_retention_days" {
  description = "CloudWatch log retention in days."
  type        = number
  default     = 14
}

variable "default_resource_profile" {
  description = "Default worker resource profile used by the control plane."
  type        = string
  default     = "standard"

  validation {
    condition     = contains(["small", "standard", "large"], var.default_resource_profile)
    error_message = "default_resource_profile must be one of: small, standard, large."
  }
}

variable "efs_csi_driver_role_name" {
  description = "IAM role name used by the EKS aws-efs-csi-driver addon."
  type        = string
  default     = "remote-codex-staging-efs-csi-driver"
}

variable "efs_csi_driver_addon_version" {
  description = "EKS addon version for aws-efs-csi-driver."
  type        = string
  default     = "v3.2.0-eksbuild.1"
}

variable "workspace_pvc_name" {
  description = "Kubernetes PVC name mounted by sandbox worker Pods at /workspace."
  type        = string
  default     = "remote-codex-worker-workspace"
}

variable "workspace_efs_pv_capacity" {
  description = "Nominal Kubernetes PV capacity for the EFS-backed workspace file system. EFS grows elastically; this is used for PV/PVC binding."
  type        = string
  default     = "1Ti"
}

variable "workspace_efs_pvc_request" {
  description = "Nominal Kubernetes PVC storage request for worker workspace persistence. EFS grows elastically; this is used for PV/PVC binding."
  type        = string
  default     = "1Ti"
}

variable "workspace_efs_transition_to_ia" {
  description = "EFS lifecycle transition policy for infrequently accessed workspace files."
  type        = string
  default     = "AFTER_30_DAYS"
}

variable "worker_enabled_agent_providers" {
  description = "Comma-separated worker runtime providers injected when starting sandbox Pods. Staging defaults to codex only."
  type        = string
  default     = "codex"
}

variable "sandbox_router_base_url" {
  description = "Public HTTPS base URL for the sandbox router."
  type        = string
  default     = "https://router-staging.example.com"
}

variable "create_router_ecr_repository" {
  description = "Whether to create an ECR repository for the sandbox-router image."
  type        = bool
  default     = true
}

variable "router_ecr_repository_name" {
  description = "ECR repository name for sandbox-router images."
  type        = string
  default     = "remote-codex-sandbox-router-staging"
}

variable "router_image" {
  description = "Optional sandbox-router image. If null, router Deployment and Service are not created."
  type        = string
  nullable    = true
  default     = null
}

variable "router_replicas" {
  description = "Sandbox-router replica count when router_image is set."
  type        = number
  default     = 1
}

variable "router_container_port" {
  description = "Sandbox-router container port."
  type        = number
  default     = 8791
}

variable "router_service_port" {
  description = "Sandbox-router Kubernetes Service port."
  type        = number
  default     = 80
}

variable "router_service_type" {
  description = "Sandbox-router Kubernetes Service type."
  type        = string
  default     = "LoadBalancer"
}

variable "router_load_balancer_class" {
  description = "Load balancer class for the sandbox-router Service when using EKS Auto Mode."
  type        = string
  default     = "eks.amazonaws.com/nlb"
}

variable "router_service_annotations" {
  description = "Annotations for the sandbox-router Service."
  type        = map(string)
  default = {
    "service.beta.kubernetes.io/aws-load-balancer-scheme" = "internet-facing"
  }
}

variable "router_log_level" {
  description = "Sandbox-router log level."
  type        = string
  default     = "info"
}

variable "route_token_signing_key_id" {
  description = "Route-token signing key id shared by control plane and router."
  type        = string
  default     = "staging-001"
}

variable "route_token_signing_secret" {
  description = "Route-token signing secret shared by control plane and router."
  type        = string
  sensitive   = true
}

variable "router_worker_identity_secret" {
  description = "Secret used by the router to sign worker identity envelopes."
  type        = string
  sensitive   = true
}

variable "router_worker_auth_token" {
  description = "Worker internal auth token injected by the router when proxying to worker Pods."
  type        = string
  sensitive   = true
}

variable "control_plane_base_url" {
  description = "Control-plane API base URL used by the sandbox-router."
  type        = string
  default     = "https://control-plane-staging.example.com"
}

variable "control_plane_service_token" {
  description = "Internal service token shared by control plane and sandbox-router."
  type        = string
  sensitive   = true
}

variable "aws_staging_reviewed_by" {
  description = "Operator identity used in staging evidence."
  type        = string
  default     = "replace-with-operator-email"
}

variable "aws_staging_config_reviewed" {
  description = "Whether the AWS staging config review is complete."
  type        = bool
  default     = false
}

variable "aws_staging_credential_review_passed" {
  description = "Whether the Kubernetes/AWS credential review passed."
  type        = bool
  default     = false
}

variable "tags" {
  description = "Additional AWS tags."
  type        = map(string)
  default     = {}
}
