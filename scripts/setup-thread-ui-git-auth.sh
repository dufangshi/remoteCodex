#!/usr/bin/env bash
set -euo pipefail

key_b64="${REMOTE_CODEX_THREAD_UI_DEPLOY_KEY_B64:-}"
key="${REMOTE_CODEX_THREAD_UI_DEPLOY_KEY:-}"
ssh_dir="${HOME}/.ssh"
key_path="${REMOTE_CODEX_THREAD_UI_DEPLOY_KEY_PATH:-${ssh_dir}/remote_codex_thread_ui_deploy_key}"
key_file="${REMOTE_CODEX_THREAD_UI_DEPLOY_KEY_FILE:-}"

if [[ -n "${key_file}" && ! -f "${key_file}" ]]; then
  key_file=""
fi

if [[ "${1:-}" == "--cleanup" ]]; then
  git config --global --unset core.sshCommand 2>/dev/null || true
  git config --global --unset-all \
    url."ssh://git@github.com/dufangshi/remote-codex-thread-ui.git".insteadOf \
    2>/dev/null || true
  rm -f "${key_path}"
  exit 0
fi

if [[ -z "${key_b64}" && -z "${key}" && -z "${key_file}" ]]; then
  echo "REMOTE_CODEX_THREAD_UI_DEPLOY_KEY_B64 is not set; using existing Git credentials."
  exit 0
fi

known_hosts_path="${ssh_dir}/known_hosts"

mkdir -p "${ssh_dir}"
chmod 700 "${ssh_dir}"

if [[ -n "${key_file}" ]]; then
  if grep -q "BEGIN OPENSSH PRIVATE KEY" "${key_file}"; then
    cp "${key_file}" "${key_path}"
  else
    base64 -d "${key_file}" > "${key_path}"
  fi
elif [[ -n "${key_b64}" ]]; then
  printf '%s' "${key_b64}" | base64 -d > "${key_path}"
else
  printf '%s\n' "${key}" > "${key_path}"
fi
chmod 600 "${key_path}"

touch "${known_hosts_path}"
chmod 600 "${known_hosts_path}"
if ! ssh-keygen -F github.com -f "${known_hosts_path}" >/dev/null; then
  ssh-keyscan github.com >> "${known_hosts_path}"
fi

git config --global \
  url."ssh://git@github.com/dufangshi/remote-codex-thread-ui.git".insteadOf \
  "https://github.com/dufangshi/remote-codex-thread-ui.git"
git config --global \
  core.sshCommand \
  "ssh -i ${key_path} -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes"
