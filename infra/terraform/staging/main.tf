terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.30"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

data "aws_eks_cluster" "staging" {
  name = var.eks_cluster_name
}

data "aws_eks_cluster_auth" "staging" {
  name = var.eks_cluster_name
}

provider "kubernetes" {
  host                   = data.aws_eks_cluster.staging.endpoint
  cluster_ca_certificate = base64decode(data.aws_eks_cluster.staging.certificate_authority[0].data)
  token                  = data.aws_eks_cluster_auth.staging.token
}

locals {
  common_tags = merge(
    {
      Project     = "remote-codex"
      Environment = var.environment
      ManagedBy   = "terraform"
    },
    var.tags,
  )

  worker_labels = {
    "app.kubernetes.io/name"        = "remote-codex-worker"
    "app.kubernetes.io/part-of"     = "remote-codex"
    "app.kubernetes.io/component"   = "sandbox-worker"
    "remote-codex.dev/runtime-role" = "worker"
    "remote-codex.dev/environment"  = var.environment
  }

  sandbox_manager_labels = {
    "app.kubernetes.io/name"      = "remote-codex-sandbox-manager"
    "app.kubernetes.io/part-of"   = "remote-codex"
    "app.kubernetes.io/component" = "sandbox-manager"
  }

  router_labels = {
    "app.kubernetes.io/name"      = "remote-codex-sandbox-router"
    "app.kubernetes.io/part-of"   = "remote-codex"
    "app.kubernetes.io/component" = "sandbox-router"
  }

  worker_image_repository_url = aws_ecr_repository.worker.repository_url

  control_plane_env = {
    SANDBOX_AWS_REGION                     = var.aws_region
    SANDBOX_ENVIRONMENT                    = var.environment
    SANDBOX_EKS_CLUSTER_NAME               = var.eks_cluster_name
    SANDBOX_K8S_NAMESPACE                  = kubernetes_namespace_v1.remote_codex.metadata[0].name
    SANDBOX_K8S_SERVICE_ACCOUNT            = kubernetes_service_account_v1.sandbox_manager.metadata[0].name
    SANDBOX_WORKER_IMAGE_REPOSITORY        = local.worker_image_repository_url
    SANDBOX_WORKER_IMAGE_TAG               = var.worker_image_tag
    SANDBOX_ROUTER_BASE_URL                = var.sandbox_router_base_url
    SANDBOX_WORKER_AUTH_TOKEN_SECRET_NAME  = var.worker_auth_token_secret_name
    SANDBOX_WORKER_IDENTITY_SECRET         = var.router_worker_identity_secret
    SANDBOX_WORKER_ENABLED_AGENT_PROVIDERS = var.worker_enabled_agent_providers
    LLM_GATEWAY_TOKEN_SECRET_NAME          = var.llm_gateway_token_secret_name
    LLM_GATEWAY_STATIC_TOKEN_SECRET_KEY    = var.llm_gateway_static_token_secret_key
    SANDBOX_SUBNET_IDS                     = join(",", var.private_subnet_ids)
    SANDBOX_SECURITY_GROUP_IDS             = join(",", var.worker_security_group_ids)
    SANDBOX_RESOURCE_PROFILE               = var.default_resource_profile
  }

  aws_staging_evidence_env = {
    AWS_STAGING_REVIEWED_BY              = var.aws_staging_reviewed_by
    AWS_STAGING_REGION                   = var.aws_region
    AWS_STAGING_ACCOUNT_ID               = var.aws_account_id
    AWS_STAGING_EKS_CLUSTER_NAME         = var.eks_cluster_name
    AWS_STAGING_K8S_NAMESPACE            = kubernetes_namespace_v1.remote_codex.metadata[0].name
    AWS_STAGING_FARGATE_PROFILE_NAME     = var.fargate_profile_name
    AWS_STAGING_K8S_SERVICE_ACCOUNT      = kubernetes_service_account_v1.sandbox_manager.metadata[0].name
    AWS_STAGING_K8S_ROLE_ARN             = var.sandbox_manager_role_arn
    AWS_STAGING_WORKER_IMAGE_REPOSITORY  = local.worker_image_repository_url
    AWS_STAGING_WORKER_IMAGE_TAG         = var.worker_image_tag
    AWS_STAGING_LOG_GROUP_NAMES          = join(",", [aws_cloudwatch_log_group.worker.name, aws_cloudwatch_log_group.router.name])
    AWS_STAGING_VPC_ID                   = var.vpc_id
    AWS_STAGING_SUBNET_IDS               = join(",", var.private_subnet_ids)
    AWS_STAGING_SECURITY_GROUP_IDS       = join(",", var.worker_security_group_ids)
    AWS_STAGING_CONFIG_REVIEWED          = tostring(var.aws_staging_config_reviewed)
    AWS_STAGING_CREDENTIAL_REVIEW_PASSED = tostring(var.aws_staging_credential_review_passed)
  }
}

resource "aws_ecr_repository" "worker" {
  name                 = var.worker_ecr_repository_name
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = local.common_tags
}

resource "aws_ecr_lifecycle_policy" "worker" {
  repository = aws_ecr_repository.worker.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep recent staging worker images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = var.worker_ecr_images_to_keep
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}

resource "aws_ecr_repository" "router" {
  count = var.create_router_ecr_repository ? 1 : 0

  name                 = var.router_ecr_repository_name
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = local.common_tags
}

resource "aws_cloudwatch_log_group" "worker" {
  name              = var.worker_log_group_name
  retention_in_days = var.log_retention_days

  tags = local.common_tags
}

resource "aws_cloudwatch_log_group" "router" {
  name              = var.router_log_group_name
  retention_in_days = var.log_retention_days

  tags = local.common_tags
}

resource "aws_ec2_tag" "public_load_balancer_subnets" {
  for_each = toset(var.public_load_balancer_subnet_ids)

  resource_id = each.value
  key         = "kubernetes.io/role/elb"
  value       = "1"
}

resource "kubernetes_namespace_v1" "remote_codex" {
  metadata {
    name = var.kubernetes_namespace

    labels = {
      "app.kubernetes.io/part-of"    = "remote-codex"
      "remote-codex.dev/environment" = var.environment
    }
  }
}

resource "kubernetes_service_account_v1" "worker" {
  metadata {
    name      = var.worker_service_account_name
    namespace = kubernetes_namespace_v1.remote_codex.metadata[0].name
    labels    = local.worker_labels
  }

  automount_service_account_token = false
}

resource "kubernetes_service_account_v1" "sandbox_manager" {
  metadata {
    name      = var.sandbox_manager_service_account_name
    namespace = kubernetes_namespace_v1.remote_codex.metadata[0].name
    labels    = local.sandbox_manager_labels

    annotations = var.sandbox_manager_role_arn == "" ? {} : {
      "eks.amazonaws.com/role-arn" = var.sandbox_manager_role_arn
    }
  }

  automount_service_account_token = true
}

resource "kubernetes_role_v1" "sandbox_manager" {
  metadata {
    name      = "remote-codex-sandbox-manager"
    namespace = kubernetes_namespace_v1.remote_codex.metadata[0].name
    labels    = local.sandbox_manager_labels
  }

  rule {
    api_groups = [""]
    resources  = ["pods"]
    verbs      = ["create", "get", "list", "watch", "patch", "delete"]
  }

  rule {
    api_groups = [""]
    resources  = ["pods/log"]
    verbs      = ["get"]
  }

  rule {
    api_groups = [""]
    resources  = ["services"]
    verbs      = ["create", "get", "list", "delete"]
  }

  rule {
    api_groups = [""]
    resources  = ["secrets"]
    verbs      = ["create", "get", "list", "patch", "delete"]
  }
}

resource "kubernetes_role_binding_v1" "sandbox_manager" {
  metadata {
    name      = "remote-codex-sandbox-manager"
    namespace = kubernetes_namespace_v1.remote_codex.metadata[0].name
    labels    = local.sandbox_manager_labels
  }

  role_ref {
    api_group = "rbac.authorization.k8s.io"
    kind      = "Role"
    name      = kubernetes_role_v1.sandbox_manager.metadata[0].name
  }

  subject {
    kind      = "ServiceAccount"
    name      = kubernetes_service_account_v1.sandbox_manager.metadata[0].name
    namespace = kubernetes_namespace_v1.remote_codex.metadata[0].name
  }
}

resource "kubernetes_secret_v1" "worker_auth_token" {
  count = var.worker_auth_token == null ? 0 : 1

  metadata {
    name      = var.worker_auth_token_secret_name
    namespace = kubernetes_namespace_v1.remote_codex.metadata[0].name
    labels    = local.worker_labels
  }

  data = {
    token           = var.worker_auth_token
    identity-secret = var.router_worker_identity_secret
  }

  type = "Opaque"
}

resource "kubernetes_secret_v1" "llm_gateway_token" {
  count = var.llm_gateway_static_token == null ? 0 : 1

  metadata {
    name      = var.llm_gateway_token_secret_name
    namespace = kubernetes_namespace_v1.remote_codex.metadata[0].name
    labels    = local.worker_labels
  }

  data = {
    (var.llm_gateway_static_token_secret_key) = var.llm_gateway_static_token
  }

  type = "Opaque"
}

resource "kubernetes_deployment_v1" "sandbox_router" {
  count = var.router_image == null ? 0 : 1

  metadata {
    name      = "remote-codex-sandbox-router"
    namespace = kubernetes_namespace_v1.remote_codex.metadata[0].name
    labels    = local.router_labels
  }

  spec {
    replicas = var.router_replicas

    selector {
      match_labels = local.router_labels
    }

    template {
      metadata {
        labels = merge(local.router_labels, {
          "remote-codex.dev/environment" = var.environment
        })
      }

      spec {
        container {
          name  = "sandbox-router"
          image = var.router_image

          port {
            name           = "http"
            container_port = var.router_container_port
          }

          env {
            name  = "NODE_ENV"
            value = "production"
          }

          env {
            name  = "HOST"
            value = "0.0.0.0"
          }

          env {
            name  = "PORT"
            value = tostring(var.router_container_port)
          }

          env {
            name  = "LOG_LEVEL"
            value = var.router_log_level
          }

          env {
            name  = "CONTROL_PLANE_JWT_SECRET_ID"
            value = var.route_token_signing_key_id
          }

          env {
            name = "CONTROL_PLANE_JWT_SECRET"
            value_from {
              secret_key_ref {
                name = kubernetes_secret_v1.router_runtime[0].metadata[0].name
                key  = "route-token-signing-secret"
              }
            }
          }

          env {
            name = "SANDBOX_ROUTER_WORKER_AUTH_TOKEN"
            value_from {
              secret_key_ref {
                name = kubernetes_secret_v1.router_runtime[0].metadata[0].name
                key  = "worker-auth-token"
              }
            }
          }

          env {
            name = "SANDBOX_ROUTER_WORKER_IDENTITY_SECRET"
            value_from {
              secret_key_ref {
                name = kubernetes_secret_v1.router_runtime[0].metadata[0].name
                key  = "worker-identity-secret"
              }
            }
          }

          env {
            name  = "SANDBOX_ROUTER_CONTROL_PLANE_BASE_URL"
            value = var.control_plane_base_url
          }

          env {
            name = "SANDBOX_ROUTER_CONTROL_PLANE_SERVICE_TOKEN"
            value_from {
              secret_key_ref {
                name = kubernetes_secret_v1.router_runtime[0].metadata[0].name
                key  = "control-plane-service-token"
              }
            }
          }

          readiness_probe {
            http_get {
              path = "/healthz"
              port = "http"
            }
            initial_delay_seconds = 5
            period_seconds        = 10
          }

          liveness_probe {
            http_get {
              path = "/healthz"
              port = "http"
            }
            initial_delay_seconds = 10
            period_seconds        = 30
          }
        }
      }
    }
  }
}

resource "kubernetes_secret_v1" "router_runtime" {
  count = var.router_image == null ? 0 : 1

  metadata {
    name      = "remote-codex-sandbox-router-runtime"
    namespace = kubernetes_namespace_v1.remote_codex.metadata[0].name
    labels    = local.router_labels
  }

  data = {
    route-token-signing-secret  = var.route_token_signing_secret
    worker-auth-token           = var.router_worker_auth_token
    worker-identity-secret      = var.router_worker_identity_secret
    control-plane-service-token = var.control_plane_service_token
  }

  type = "Opaque"
}

resource "kubernetes_service_v1" "sandbox_router" {
  count = var.router_image == null ? 0 : 1

  metadata {
    name      = "remote-codex-sandbox-router"
    namespace = kubernetes_namespace_v1.remote_codex.metadata[0].name
    labels    = local.router_labels

    annotations = var.router_service_annotations
  }

  spec {
    type                = var.router_service_type
    load_balancer_class = var.router_load_balancer_class

    selector = local.router_labels

    port {
      name        = "http"
      port        = var.router_service_port
      target_port = "http"
    }
  }
}
