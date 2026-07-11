#!/usr/bin/env bash
set -euo pipefail

bridge="${REMOTE_CODEX_INCUS_BRIDGE:-rcdbr0}"
if [[ ! "${bridge}" =~ ^[a-zA-Z0-9_.-]{1,15}$ ]]; then
  echo "Invalid Incus bridge name." >&2
  exit 1
fi

# Incus and Docker both own forwarding base chains. Docker's DROP policy wins
# unless traffic from the managed Incus bridge is admitted in DOCKER-USER.
# New inbound connections remain blocked; only guest-originated traffic and its
# established return path are allowed here. Fine-grained egress policy is
# applied separately by the hosted-sandbox policy layer.
if ! ip link show "${bridge}" >/dev/null 2>&1; then
  exit 0
fi
if ! iptables -nL DOCKER-USER >/dev/null 2>&1; then
  exit 0
fi

iptables -C DOCKER-USER -i "${bridge}" -j ACCEPT 2>/dev/null || \
  iptables -I DOCKER-USER 1 -i "${bridge}" -j ACCEPT
iptables -C DOCKER-USER -o "${bridge}" -m conntrack \
  --ctstate RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || \
  iptables -I DOCKER-USER 1 -o "${bridge}" -m conntrack \
    --ctstate RELATED,ESTABLISHED -j ACCEPT
