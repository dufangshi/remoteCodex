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

export ANDROID_HOME JAVA_HOME
export PATH="$ANDROID_HOME/platform-tools:$PATH"

usage() {
  cat <<'USAGE'
Usage: android-local-e2e-helper.sh <command>

Commands:
  doctor            Print Java, Android, adb, pnpm, node, and emulator status.
  build             Build apps/android debug APK.
  install           Install the debug APK on the running emulator.
  build-install     Build and install the debug APK.
  migrate           Run database migrations with WORKSPACE_ROOT.
  api-check         Check local supervisor health and runtime config.
  create-workspace  Create the default host test workspace directory.
  launch-app        Launch com.remotecodex.android/.MainActivity.
  dump-ui           Dump current Android UI XML to stdout.
  screenshot        Save a screenshot to /tmp/remote-codex-android-local-e2e.png.
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

migrate() {
  (cd "$ROOT" && WORKSPACE_ROOT="$WORKSPACE_ROOT" pnpm db:migrate)
}

api_check() {
  curl -sS "$API_URL/healthz"
  printf '\n'
  curl -sS "$API_URL/api/config/runtime"
  printf '\n'
}

create_workspace() {
  mkdir -p "$WORKSPACE_PATH"
  if [ ! -f "$WORKSPACE_PATH/README.md" ]; then
    printf 'Remote Codex Android local E2E workspace\n' > "$WORKSPACE_PATH/README.md"
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
  adb exec-out screencap -p > /tmp/remote-codex-android-local-e2e.png
  echo "/tmp/remote-codex-android-local-e2e.png"
}

case "${1:-}" in
  doctor) doctor ;;
  build) build_apk ;;
  install) install_apk ;;
  build-install) build_apk; install_apk ;;
  migrate) migrate ;;
  api-check) api_check ;;
  create-workspace) create_workspace ;;
  launch-app) launch_app ;;
  dump-ui) dump_ui ;;
  screenshot) screenshot ;;
  ""|-h|--help|help) usage ;;
  *) echo "Unknown command: $1" >&2; usage >&2; exit 2 ;;
esac
