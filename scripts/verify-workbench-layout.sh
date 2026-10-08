#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export E2E_API_PORT="${E2E_API_PORT:-18185}"
export E2E_WEB_PORT="${E2E_WEB_PORT:-15185}"
export E2E_DATABASE_URL="$PWD/.temp/workbench/supervisor.sqlite"
export E2E_WORKSPACE_ROOT="$PWD/.temp/workbench/workspaces"
export WORKBENCH_SCREENSHOT_DIR="${WORKBENCH_SCREENSHOT_DIR:-$PWD/.temp/workbench/screenshots}"
mkdir -p .temp/bin .temp/workbench
cat > .temp/bin/pnpm <<'SHIM'
#!/bin/sh
exec corepack pnpm "$@"
SHIM
chmod +x .temp/bin/pnpm
export PATH="$PWD/.temp/bin:$PATH"
# The existing Playwright webServer clears inherited REMOTE_CODEX_* settings
# and overrides the high-priority DB/workspace settings for the fake Supervisor.
./target/debug/remote-codex --version
corepack pnpm exec playwright test e2e/workbench-panels.spec.ts e2e/thread-groups.spec.ts --project=desktop-chromium
corepack pnpm exec playwright test e2e/workbench-panels.spec.ts --grep 'comparison keeps' --project=mobile-chromium
