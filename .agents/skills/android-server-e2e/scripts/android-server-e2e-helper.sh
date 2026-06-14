#!/usr/bin/env bash
set -euo pipefail

ROOT="${ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
JAVA_HOME="${JAVA_HOME:-/Applications/Android Studio.app/Contents/jbr/Contents/Home}"
WORKSPACE_ROOT="${WORKSPACE_ROOT:-$HOME/dev}"
WORKSPACE_PATH="${WORKSPACE_PATH:-$WORKSPACE_ROOT/remote-codex-android-e2e}"
APP_PACKAGE="${APP_PACKAGE:-com.remotecodex.android}"
APP_ACTIVITY="${APP_ACTIVITY:-com.remotecodex.android/.MainActivity}"
API_URL="${API_URL:-http://127.0.0.1:8787}"
EMULATOR_API_URL="${EMULATOR_API_URL:-http://10.0.2.2:8787}"
ADMIN_USERNAME="${REMOTE_CODEX_ADMIN_USERNAME:-admin}"
ADMIN_PASSWORD="${REMOTE_CODEX_ADMIN_PASSWORD:-server-mode-password}"
SESSION_SECRET="${REMOTE_CODEX_SESSION_SECRET:-server-mode-session-secret}"

export ANDROID_HOME JAVA_HOME
export PATH="$ANDROID_HOME/platform-tools:$PATH"

usage() {
  cat <<'USAGE'
Usage: android-server-e2e-helper.sh <command>

Commands:
  doctor                 Print Java, Android, adb, pnpm, node, and emulator status.
  build                  Build apps/android debug APK.
  install                Install the debug APK on the running emulator.
  build-install          Build and install the debug APK.
  start-server           Run pnpm dev in REMOTE_CODEX_MODE=server.
  auth-check             Verify server auth session, 401 protection, and login.
  login-token            Print a server auth token.
  seed-debug-connection  Write server URL/token into debug app SharedPreferences.
  create-workspace       Create the default host test workspace directory.
  launch-app             Launch com.remotecodex.android/.MainActivity.
  dump-ui                Dump current Android UI XML to stdout.
  screenshot             Save a screenshot to /tmp/remote-codex-android-server-e2e.png.
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
}

build_apk() {
  (cd "$ROOT/apps/android" && ./gradlew :app:assembleDebug)
}

install_apk() {
  adb install -r "$ROOT/apps/android/app/build/outputs/apk/debug/app-debug.apk"
}

start_server() {
  cd "$ROOT"
  REMOTE_CODEX_MODE=server \
    REMOTE_CODEX_ADMIN_USERNAME="$ADMIN_USERNAME" \
    REMOTE_CODEX_ADMIN_PASSWORD="$ADMIN_PASSWORD" \
    REMOTE_CODEX_SESSION_SECRET="$SESSION_SECRET" \
    WORKSPACE_ROOT="$WORKSPACE_ROOT" \
    pnpm dev
}

login_token() {
  curl -sS -H 'Content-Type: application/json' \
    -d "{\"username\":\"$ADMIN_USERNAME\",\"password\":\"$ADMIN_PASSWORD\"}" \
    "$API_URL/api/auth/login" |
    node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>process.stdout.write(JSON.parse(s).token));'
}

auth_check() {
  echo "session:"
  curl -sS "$API_URL/api/auth/session"
  printf '\nunauthenticated /api/workspaces status: '
  curl -sS -o /tmp/remote-codex-server-unauth.json -w '%{http_code}\n' "$API_URL/api/workspaces"
  printf 'login has token: '
  token="$(login_token)"
  [ -n "$token" ] && echo true || echo false
}

seed_debug_connection() {
  token="$(login_token)"
  tmp_xml="$(mktemp /tmp/remote-codex-server-prefs.XXXXXX.xml)"
  cat > "$tmp_xml" <<EOF
<?xml version='1.0' encoding='utf-8' standalone='yes' ?>
<map>
    <string name="supervisor_mode">server</string>
    <string name="supervisor_base_url">$EMULATOR_API_URL</string>
    <string name="supervisor_auth_token">$token</string>
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

create_workspace() {
  mkdir -p "$WORKSPACE_PATH"
  if [ ! -f "$WORKSPACE_PATH/README.md" ]; then
    printf 'Remote Codex Android server E2E workspace\n' > "$WORKSPACE_PATH/README.md"
  fi
  ls -la "$WORKSPACE_PATH"
}

launch_app() {
  adb shell am start -n "$APP_ACTIVITY"
}

dump_ui() {
  adb shell uiautomator dump /sdcard/window.xml >/dev/null
  adb exec-out cat /sdcard/window.xml
}

screenshot() {
  adb exec-out screencap -p > /tmp/remote-codex-android-server-e2e.png
  echo "/tmp/remote-codex-android-server-e2e.png"
}

case "${1:-}" in
  doctor) doctor ;;
  build) build_apk ;;
  install) install_apk ;;
  build-install) build_apk; install_apk ;;
  start-server) start_server ;;
  auth-check) auth_check ;;
  login-token) login_token ;;
  seed-debug-connection) seed_debug_connection ;;
  create-workspace) create_workspace ;;
  launch-app) launch_app ;;
  dump-ui) dump_ui ;;
  screenshot) screenshot ;;
  ""|-h|--help|help) usage ;;
  *) echo "Unknown command: $1" >&2; usage >&2; exit 2 ;;
esac
