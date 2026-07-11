#!/usr/bin/env bash
set -euo pipefail

if [ "${EUID}" -ne 0 ]; then
  echo "Run this uninstaller as root." >&2
  exit 1
fi

systemctl disable --now remote-codex-incus-host-agent.service 2>/dev/null || true
rm -f /etc/systemd/system/remote-codex-incus-host-agent.service
rm -rf /opt/remote-codex-incus-host-agent
systemctl daemon-reload
echo "State and configuration were preserved. Remove them explicitly only after auditing hosted VMs."
