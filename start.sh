#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${repo_root}"

relay_env_file="${REMOTE_CODEX_RELAY_ENV_FILE:-${repo_root}/.local/relay.env}"

random_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 32 | tr -d '=+/' | cut -c 1-32
    return
  fi

  node -e "process.stdout.write(require('node:crypto').randomBytes(24).toString('base64url'))"
}

ensure_relay_env() {
  mkdir -p "$(dirname "${relay_env_file}")"
  if [[ -f "${relay_env_file}" ]]; then
    return
  fi

  admin_password="$(random_secret)"
  session_secret="$(random_secret)"
  cat > "${relay_env_file}" <<EOF
REMOTE_CODEX_ADMIN_USERNAME=admin
REMOTE_CODEX_ADMIN_PASSWORD=${admin_password}
REMOTE_CODEX_RELAY_SESSION_SECRET=${session_secret}
REMOTE_CODEX_RELAY_REGISTRATION_ENABLED=true
EOF
  chmod 600 "${relay_env_file}" || true

  echo "Created ${relay_env_file}"
  echo "Initial relay login: admin / ${admin_password}"
  echo "Store this password now; it is saved in ${relay_env_file}."
}

ensure_pnpm() {
  if command -v pnpm >/dev/null 2>&1; then
    return
  fi
  if command -v corepack >/dev/null 2>&1; then
    corepack enable
  fi
  if ! command -v pnpm >/dev/null 2>&1; then
    echo "pnpm is required. Install Node.js 20+ with corepack, then rerun ./start.sh." >&2
    exit 1
  fi
}

ensure_thread_ui() {
  bash ./scripts/setup-thread-ui-git-auth.sh
  thread_ui_dir="${REMOTE_CODEX_THREAD_UI_DIR:-$(cd .. && pwd)/remote-codex-thread-ui}"

  pnpm --dir "${thread_ui_dir}" install --frozen-lockfile
  pnpm --dir "${thread_ui_dir}" --filter @remote-codex/plugin-xyz-viewer build
  pnpm --dir "${thread_ui_dir}" --filter @remote-codex/thread-ui build
}

ensure_relay_env
set -a
# shellcheck disable=SC1090
. "${relay_env_file}"
set +a

export REMOTE_CODEX_RELAY_HOST="${REMOTE_CODEX_RELAY_HOST:-0.0.0.0}"
export REMOTE_CODEX_RELAY_PORT="${REMOTE_CODEX_RELAY_PORT:-8798}"
export HOST="${HOST:-${REMOTE_CODEX_RELAY_HOST}}"
export PORT="${PORT:-${REMOTE_CODEX_RELAY_PORT}}"
export REMOTE_CODEX_RELAY_DATA_DIR="${REMOTE_CODEX_RELAY_DATA_DIR:-${repo_root}/.local/relay-server}"
export REMOTE_CODEX_RELAY_WEB_DIST_DIR="${REMOTE_CODEX_RELAY_WEB_DIST_DIR:-${repo_root}/apps/supervisor-web/dist}"

ensure_pnpm
ensure_thread_ui

pnpm install --frozen-lockfile
pnpm --filter @remote-codex/shared build
pnpm --filter @remote-codex/plugin-runtime build
pnpm --filter @remote-codex/plugin-terminal build
pnpm --filter @remote-codex/relay-server build
pnpm --filter @remote-codex/supervisor-web build

echo "Starting Remote Codex relay on ${REMOTE_CODEX_RELAY_HOST}:${REMOTE_CODEX_RELAY_PORT}"
exec pnpm --filter @remote-codex/relay-server exec node dist/index.js
