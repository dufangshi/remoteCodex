#!/usr/bin/env bash
set -euo pipefail

ROOT="${ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
JAVA_HOME="${JAVA_HOME:-/Applications/Android Studio.app/Contents/jbr/Contents/Home}"
WORKSPACE_ROOT="${WORKSPACE_ROOT:-$HOME/dev}"
WORKSPACE_PATH="${WORKSPACE_PATH:-$WORKSPACE_ROOT/remote-codex-android-relay-e2e}"
APP_PACKAGE="${APP_PACKAGE:-com.remotecodex.android}"
APP_ACTIVITY="${APP_ACTIVITY:-com.remotecodex.android/.MainActivity}"
RELAY_URL="${RELAY_URL:-http://127.0.0.1:8788}"
EMULATOR_RELAY_URL="${EMULATOR_RELAY_URL:-http://10.0.2.2:8788}"
SUPERVISOR_URL="${SUPERVISOR_URL:-http://127.0.0.1:8787}"
RELAY_WS_URL="${RELAY_WS_URL:-ws://127.0.0.1:8788}"
RELAY_DATA_DIR="${RELAY_DATA_DIR:-$ROOT/.local/relay-e2e}"
REGISTRATION_FILE="${REGISTRATION_FILE:-$ROOT/.local/relay-e2e-registration.json}"
THREAD_FILE="${THREAD_FILE:-$ROOT/.local/relay-e2e-thread.json}"
SUPERVISOR_DB="${SUPERVISOR_DB:-$ROOT/.local/relay-supervisor-e2e.sqlite}"
RELAY_ADMIN_USERNAME="${REMOTE_CODEX_ADMIN_USERNAME:-admin}"
RELAY_ADMIN_PASSWORD="${REMOTE_CODEX_ADMIN_PASSWORD:-relay-admin-password}"
RELAY_SESSION_SECRET="${REMOTE_CODEX_RELAY_SESSION_SECRET:-relay-session-secret-123456}"
SUPERVISOR_ADMIN_USERNAME="${REMOTE_CODEX_SUPERVISOR_USERNAME:-admin}"
SUPERVISOR_ADMIN_PASSWORD="${REMOTE_CODEX_SUPERVISOR_PASSWORD:-relay-supervisor-password}"
SUPERVISOR_SESSION_SECRET="${REMOTE_CODEX_SESSION_SECRET:-relay-supervisor-session-secret-123}"
MODEL="${MODEL:-gpt-5.4}"
REASONING_EFFORT="${REASONING_EFFORT:-medium}"

export ANDROID_HOME JAVA_HOME
export PATH="$ANDROID_HOME/platform-tools:$PATH"

usage() {
  cat <<'USAGE'
Usage: android-relay-e2e-helper.sh <command>

Commands:
  doctor                  Print Java, Android, adb, docker, pnpm, node, and port status.
  build                   Build apps/android debug APK.
  install                 Install the debug APK on the running emulator.
  build-install           Build and install the debug APK.
  build-relay             Build @remote-codex/relay-server.
  build-relay-image       Build Dockerfile.relay as remote-codex-relay:e2e.
  start-relay             Run the relay server on 127.0.0.1:8788.
  relay-login-token       Print a relay admin session token.
  register-device         Create a relay device and save registration JSON.
  start-relay-supervisor  Run private supervisor in relay mode on 127.0.0.1:8787.
  relay-health            Print relay /healthz and forwarded workspace API status.
  seed-debug-connection   Write relay URL/token/device id into debug app SharedPreferences.
  create-workspace-thread Create default workspace/thread through the relay API.
  launch-app              Launch com.remotecodex.android/.MainActivity.
  dump-ui                 Dump current Android UI XML to stdout.
  screenshot              Save screenshot to /tmp/remote-codex-android-relay-e2e.png.
  stream-steer            Send slow streaming prompt and a steer through the relay API.
USAGE
}

doctor() {
  echo "ROOT=$ROOT"
  echo "JAVA_HOME=$JAVA_HOME"
  "$JAVA_HOME/bin/java" -version
  echo "ANDROID_HOME=$ANDROID_HOME"
  adb version
  adb devices -l
  node --version
  pnpm --version
  docker --version || true
  lsof -nP -iTCP:8787 -sTCP:LISTEN || true
  lsof -nP -iTCP:8788 -sTCP:LISTEN || true
}

build_apk() {
  (cd "$ROOT/apps/android" && ./gradlew :app:assembleDebug)
}

install_apk() {
  adb install -r "$ROOT/apps/android/app/build/outputs/apk/debug/app-debug.apk"
}

build_relay() {
  (cd "$ROOT" && pnpm --filter @remote-codex/relay-server build)
}

build_relay_image() {
  (cd "$ROOT" && docker build -f Dockerfile.relay -t remote-codex-relay:e2e .)
}

start_relay() {
  mkdir -p "$RELAY_DATA_DIR"
  cd "$ROOT"
  REMOTE_CODEX_ADMIN_USERNAME="$RELAY_ADMIN_USERNAME" \
    REMOTE_CODEX_ADMIN_PASSWORD="$RELAY_ADMIN_PASSWORD" \
    REMOTE_CODEX_RELAY_SESSION_SECRET="$RELAY_SESSION_SECRET" \
    REMOTE_CODEX_RELAY_DATA_DIR="$RELAY_DATA_DIR" \
    HOST=127.0.0.1 PORT=8788 \
    node apps/relay-server/dist/index.js
}

relay_login_token() {
  curl -sS -H 'Content-Type: application/json' \
    -d "{\"identifier\":\"$RELAY_ADMIN_USERNAME\",\"password\":\"$RELAY_ADMIN_PASSWORD\"}" \
    "$RELAY_URL/relay/auth/login" |
    node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>process.stdout.write(JSON.parse(s).token));'
}

register_device() {
  mkdir -p "$(dirname "$REGISTRATION_FILE")"
  token="$(relay_login_token)"
  curl -sS -H "Authorization: Bearer $token" \
    -H 'Content-Type: application/json' \
    -d '{"name":"Android relay E2E backend"}' \
    "$RELAY_URL/relay/devices" |
    RELAY_TOKEN="$token" node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s); const out={relayToken:process.env.RELAY_TOKEN,deviceId:j.device.id,deviceToken:j.token}; console.log(JSON.stringify(out,null,2));})' > "$REGISTRATION_FILE"
  sed -E 's/"(relayToken|deviceToken)": "[^"]+"/"\1": "[redacted]"/g' "$REGISTRATION_FILE"
}

start_relay_supervisor() {
  device_token="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).deviceToken)" "$REGISTRATION_FILE")"
  cd "$ROOT"
  REMOTE_CODEX_ADMIN_USERNAME="$SUPERVISOR_ADMIN_USERNAME" \
    REMOTE_CODEX_ADMIN_PASSWORD="$SUPERVISOR_ADMIN_PASSWORD" \
    REMOTE_CODEX_SESSION_SECRET="$SUPERVISOR_SESSION_SECRET" \
    REMOTE_CODEX_RELAY_SERVER_URL="$RELAY_WS_URL" \
    REMOTE_CODEX_RELAY_AGENT_TOKEN="$device_token" \
    WORKSPACE_ROOT="$WORKSPACE_ROOT" \
    DATABASE_URL="$SUPERVISOR_DB" \
    HOST=127.0.0.1 PORT=8787 \
    node bin/remote-codex.mjs relay-supervisor
}

relay_health() {
  curl -sS "$RELAY_URL/healthz"
  printf '\n'
  node --input-type=module - "$REGISTRATION_FILE" "$RELAY_URL" <<'NODE'
import fs from 'node:fs';
const [registrationFile, relayUrl] = process.argv.slice(2);
const reg = JSON.parse(fs.readFileSync(registrationFile, 'utf8'));
const res = await fetch(`${relayUrl}/relay/devices/${reg.deviceId}/api/workspaces`, {
  headers: { authorization: `Bearer ${reg.relayToken}` },
});
console.log(`forwarded /api/workspaces ${res.status}`);
NODE
}

seed_debug_connection() {
  relay_token="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).relayToken)" "$REGISTRATION_FILE")"
  device_id="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).deviceId)" "$REGISTRATION_FILE")"
  tmp_xml="$(mktemp /tmp/remote-codex-relay-prefs.XXXXXX)"
  cat > "$tmp_xml" <<EOF
<?xml version='1.0' encoding='utf-8' standalone='yes' ?>
<map>
    <string name="supervisor_mode">relay</string>
    <string name="supervisor_base_url">$EMULATOR_RELAY_URL</string>
    <string name="supervisor_auth_token">$relay_token</string>
    <string name="supervisor_relay_device_id">$device_id</string>
</map>
EOF
  adb shell am force-stop "$APP_PACKAGE" || true
  adb push "$tmp_xml" /data/local/tmp/remote_codex_preferences.xml >/dev/null
  adb shell chmod 644 /data/local/tmp/remote_codex_preferences.xml
  adb shell run-as "$APP_PACKAGE" mkdir -p shared_prefs
  adb shell run-as "$APP_PACKAGE" cp /data/local/tmp/remote_codex_preferences.xml shared_prefs/remote_codex_preferences.xml
  adb shell run-as "$APP_PACKAGE" cat shared_prefs/remote_codex_preferences.xml |
    sed -E 's#(<string name="supervisor_auth_token">).*(</string>)#\1[redacted]\2#'
}

create_workspace_thread() {
  mkdir -p "$WORKSPACE_PATH"
  if [ ! -f "$WORKSPACE_PATH/README.md" ]; then
    printf '# Android Relay E2E\n\nInitial test workspace.\n' > "$WORKSPACE_PATH/README.md"
  fi
  node --input-type=module - "$REGISTRATION_FILE" "$THREAD_FILE" "$RELAY_URL" "$WORKSPACE_PATH" "$MODEL" "$REASONING_EFFORT" <<'NODE'
import fs from 'node:fs';
const [registrationFile, threadFile, relayUrl, workspacePath, model, reasoningEffort] = process.argv.slice(2);
const reg = JSON.parse(fs.readFileSync(registrationFile, 'utf8'));
const headers = { 'content-type': 'application/json', authorization: `Bearer ${reg.relayToken}` };
const base = `${relayUrl}/relay/devices/${reg.deviceId}`;
async function req(method, path, body) {
  const res = await fetch(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}
const workspaces = await req('GET', '/api/workspaces');
const workspace = workspaces.find((item) => item.absPath === workspacePath) ??
  await req('POST', '/api/workspaces', { absPath: workspacePath, label: 'Android_Relay_E2E' });
const thread = await req('POST', '/api/threads/start', {
  workspaceId: workspace.id,
  title: 'Android_Relay_E2E_Stream_Steer',
  provider: 'codex',
  model,
  reasoningEffort,
  approvalMode: 'yolo',
});
fs.writeFileSync(threadFile, JSON.stringify({ workspaceId: workspace.id, threadId: thread.id, workspaceDir: workspacePath }, null, 2));
console.log(JSON.stringify({ workspaceId: workspace.id, threadId: thread.id, model: thread.model, reasoningEffort: thread.reasoningEffort }, null, 2));
NODE
}

launch_app() {
  adb shell am start -n "$APP_ACTIVITY"
}

dump_ui() {
  adb shell uiautomator dump /sdcard/window.xml >/dev/null
  adb exec-out cat /sdcard/window.xml
}

screenshot() {
  adb exec-out screencap -p > /tmp/remote-codex-android-relay-e2e.png
  echo "/tmp/remote-codex-android-relay-e2e.png"
}

stream_steer() {
  node --input-type=module - "$REGISTRATION_FILE" "$THREAD_FILE" "$RELAY_URL" "$MODEL" "$REASONING_EFFORT" <<'NODE'
import fs from 'node:fs';
const [registrationFile, threadFile, relayUrl, model, reasoningEffort] = process.argv.slice(2);
const reg = JSON.parse(fs.readFileSync(registrationFile, 'utf8'));
const ids = JSON.parse(fs.readFileSync(threadFile, 'utf8'));
const headers = { 'content-type': 'application/json', authorization: `Bearer ${reg.relayToken}` };
const base = `${relayUrl}/relay/devices/${reg.deviceId}`;
async function req(method, path, body) {
  const res = await fetch(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}
const prompt = `Run a relay mode Android E2E streaming check.

Do these steps in order:
1. Inspect README.md in this workspace and report a short finding.
2. Run a shell command that prints relay_step_1, sleeps 10 seconds, prints relay_step_2, sleeps 10 seconds, prints relay_step_3, sleeps 10 seconds, then prints relay_step_done.
3. Create relay-e2e-stream.txt containing the three step names and the phrase RELAY_E2E_STREAM_OK.
4. Before your final answer, check whether a steering/follow-up message arrived. If it did, include RELAY_STEER_ACK and adjust the final answer to be concise.

Keep the turn active while the sleep command runs so the Android app can receive streaming updates.`;
let summary = await req('POST', `/api/threads/${ids.threadId}/prompt`, { prompt, model, reasoningEffort });
console.log('initial', JSON.stringify({ status: summary.status, activeTurnId: summary.activeTurnId }));
await new Promise((resolve) => setTimeout(resolve, 8500));
summary = await req('POST', `/api/threads/${ids.threadId}/prompt`, {
  prompt: 'Steering while active: acknowledge with RELAY_STEER_ACK and make the final answer concise.',
  model,
  reasoningEffort,
});
console.log('steer', JSON.stringify({ status: summary.status, activeTurnId: summary.activeTurnId }));
for (let i = 0; i < 12; i += 1) {
  await new Promise((resolve) => setTimeout(resolve, 10000));
  const detail = await req('GET', `/api/threads/${ids.threadId}`);
  const turn = detail.turns?.at?.(-1);
  console.log('poll', JSON.stringify({ turnStatus: turn?.status, items: turn?.items?.length, lastError: detail.lastError }));
  if (turn?.status === 'completed') {
    const text = JSON.stringify(detail);
    console.log('contains', JSON.stringify({
      streamOk: text.includes('RELAY_E2E_STREAM_OK'),
      steerAck: text.includes('RELAY_STEER_ACK'),
      stepDone: text.includes('relay_step_done'),
    }));
    process.exit(0);
  }
}
throw new Error('turn did not complete within timeout');
NODE
}

case "${1:-}" in
  doctor) doctor ;;
  build) build_apk ;;
  install) install_apk ;;
  build-install) build_apk; install_apk ;;
  build-relay) build_relay ;;
  build-relay-image) build_relay_image ;;
  start-relay) start_relay ;;
  relay-login-token) relay_login_token ;;
  register-device) register_device ;;
  start-relay-supervisor) start_relay_supervisor ;;
  relay-health) relay_health ;;
  seed-debug-connection) seed_debug_connection ;;
  create-workspace-thread) create_workspace_thread ;;
  launch-app) launch_app ;;
  dump-ui) dump_ui ;;
  screenshot) screenshot ;;
  stream-steer) stream_steer ;;
  ""|-h|--help|help) usage ;;
  *) echo "Unknown command: $1" >&2; usage >&2; exit 2 ;;
esac
