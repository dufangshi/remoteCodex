#!/usr/bin/env bash
set -euo pipefail

if [[ -n "${SANDBOX_EKS_CLUSTER_NAME:-}" ]]; then
  aws eks update-kubeconfig \
    --region "${SANDBOX_AWS_REGION:-${AWS_REGION:-ca-central-1}}" \
    --name "${SANDBOX_EKS_CLUSTER_NAME}"
fi

exec node /opt/remote-codex/apps/control-plane-api/dist/index.js
