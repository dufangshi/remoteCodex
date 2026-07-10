#!/usr/bin/env bash
set -euo pipefail

if [ "${EUID}" -ne 0 ]; then
  echo "Run this installer as root." >&2
  exit 1
fi

artifact="${1:-dist/index.cjs}"
if [ ! -f "${artifact}" ]; then
  echo "Missing host-agent artifact: ${artifact}" >&2
  exit 1
fi
if ! getent group incus-admin >/dev/null; then
  echo "The incus-admin group is missing. Install and initialize Incus first." >&2
  exit 1
fi

getent group remote-codex-incus >/dev/null || groupadd --system remote-codex-incus
id -u remote-codex-incus >/dev/null 2>&1 || \
  useradd --system --gid remote-codex-incus --home /var/lib/remote-codex-incus-host-agent --shell /usr/sbin/nologin remote-codex-incus
usermod -aG incus-admin remote-codex-incus
install -d -o root -g root -m 0755 /opt/remote-codex-incus-host-agent /etc/remote-codex
install -d -o remote-codex-incus -g remote-codex-incus -m 0700 \
  /var/lib/remote-codex-incus-host-agent /var/log/remote-codex-incus-host-agent
install -o root -g root -m 0755 "${artifact}" /opt/remote-codex-incus-host-agent/index.cjs
install -o root -g root -m 0644 deploy/remote-codex-incus-host-agent.service \
  /etc/systemd/system/remote-codex-incus-host-agent.service

if [ ! -f /etc/remote-codex/incus-host-agent.env ]; then
  install -o root -g remote-codex-incus -m 0640 deploy/incus-host-agent.env.example \
    /etc/remote-codex/incus-host-agent.env
  echo "Edit /etc/remote-codex/incus-host-agent.env before starting the service." >&2
  exit 2
fi

systemctl daemon-reload
systemctl enable remote-codex-incus-host-agent.service
systemctl restart remote-codex-incus-host-agent.service
