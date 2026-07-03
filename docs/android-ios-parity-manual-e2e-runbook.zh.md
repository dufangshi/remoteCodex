# Android/iOS Parity Manual E2E Runbook

This runbook supports `docs/android-ios-parity-thread-ui-migration-plan.zh.md`.
Use it when advancing the Android parity checklist from goal mode.

## Rules

- Validate through the Android app UI on the local emulator. API calls may seed or inspect
  state, but they do not replace UI verification.
- Save evidence under `.local/android-parity-e2e/<phase-or-scenario>/`.
- Preserve the user's current supervisor and app state. In this workspace, the current manual
  local supervisor is usually host `127.0.0.1:8821`, which the emulator reaches as
  `http://10.0.2.2:8821`.
- Do not kill an existing supervisor, relay server, or emulator unless the user explicitly
  asks. Use a temporary port and database for server or relay checks when needed.
- After any Gradle instrumentation run, check whether `com.remotecodex.android` was removed.
  If it was, reinstall the debug APK and restore app preferences to the user's active local
  connection.

## Common Setup

```bash
export ANDROID_HOME="$HOME/Library/Android/sdk"
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export PATH="$ANDROID_HOME/platform-tools:$PATH"
adb devices -l
```

Build and install:

```bash
cd apps/android
./gradlew :app:assembleDebug --no-configuration-cache
cd ../..
adb install -r apps/android/app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.remotecodex.android/.MainActivity
```

Capture evidence:

```bash
mkdir -p .local/android-parity-e2e/<scenario>
adb shell uiautomator dump /sdcard/window.xml >/dev/null
adb exec-out cat /sdcard/window.xml > .local/android-parity-e2e/<scenario>/screen.xml
adb exec-out screencap -p > .local/android-parity-e2e/<scenario>/screen.png
adb logcat -d -t 400 > .local/android-parity-e2e/<scenario>/logcat.txt
```

## Local Mode

Use the active local supervisor if the user already has one running. Verify it first:

```bash
curl -sS http://127.0.0.1:8821/healthz
curl -sS http://127.0.0.1:8821/api/config/runtime
```

In Android, connect with:

```text
Mode: Local / Intranet
URL:  http://10.0.2.2:8821
```

Required smoke:

- Home shows `Intranet / http://10.0.2.2:8821` and `Connected`.
- Workspaces list matches the supervisor.
- Open a workspace.
- Create or open a thread.
- Verify the thread route uses the bundled WebView `remote-codex-thread-ui`.
- Send a sentinel prompt from the WebView composer when a prompt smoke is required.
- Open Workspace inside thread-ui, scroll Explorer, preview a file, close Viewer, and verify
  expanded folders plus scroll position are preserved.

## Server Mode

Use a temporary port if the user's local service already owns `8821` or another requested
port. Example:

```bash
DATABASE_URL="$PWD/.local/android-parity-e2e/server/supervisor-server.sqlite" \
WORKSPACE_ROOT="$HOME/dev" \
HOST=127.0.0.1 \
PORT=8791 \
REMOTE_CODEX_MODE=server \
REMOTE_CODEX_ADMIN_USERNAME=admin \
REMOTE_CODEX_ADMIN_PASSWORD=server-mode-password \
REMOTE_CODEX_SESSION_SECRET=server-mode-session-secret \
REMOTE_CODEX_E2E_FAKE_RUNTIME=1 \
REMOTE_CODEX_ENABLED_AGENT_PROVIDERS=codex,claude,opencode \
REMOTE_CODEX_DISABLE_BUILD_RESTART=true \
REMOTE_CODEX_ENABLE_WEBVIEW_CORS=true \
pnpm --filter @remote-codex/supervisor-api exec tsx src/index.ts
```

Android flow:

- Open Devices.
- Add a Server card with URL `http://10.0.2.2:8791`, username `admin`, and the configured
  password.
- Connect through the card.
- Verify the saved card stores an auth token and reconnects after relaunch.
- Create or open a thread and send `ANDROID_WEB_THREAD_SERVER_OK` from the WebView composer.
- Reload or relaunch and confirm the transcript and authenticated WebSocket still work.

Stop only the temporary server process you started for this scenario.

## Relay Mode

Use the repo relay E2E helper or an equivalent temporary relay plus supervisor setup. Android
flow:

- Add a Relay card with URL, username, and password.
- Open Relay Devices from that card.
- Verify the page shows only devices for that relay account.
- Create or connect one device.
- Revoke/delete actions must show confirmation and refresh only that relay-device list.
- Connect to a selected device, open/create a thread, send a sentinel prompt, and verify
  streaming plus steering if the phase requires it.

## WebView Debugging

Forward the active WebView DevTools socket:

```bash
pid="$(adb shell pidof com.remotecodex.android | tr -d '\r')"
adb shell cat /proc/net/unix | rg "webview_devtools_remote_$pid"
adb forward tcp:9223 "localabstract:webview_devtools_remote_$pid"
curl -sS http://127.0.0.1:9223/json/list
```

Use this only for observation or deterministic UI-state sampling. Do not replace required
Android UI actions with direct DOM mutation unless the checklist explicitly calls for a
debug-only measurement.

## Restore The User's Local 8821 State

If instrumentation removed the app package or cleared preferences, reinstall and restore the
local card:

```bash
adb install -r apps/android/app/build/outputs/apk/debug/app-debug.apk
adb shell am force-stop com.remotecodex.android || true
cat > /tmp/remote_codex_preferences.xml <<'XML'
<?xml version='1.0' encoding='utf-8' standalone='yes' ?>
<map>
    <string name="supervisor_mode">local</string>
    <string name="supervisor_base_url">http://10.0.2.2:8821</string>
    <string name="saved_supervisor_devices">[{"id":"local-8821","name":"Local 8821","mode":"local","baseUrl":"http://10.0.2.2:8821"}]</string>
    <string name="last_route:local:http://10.0.2.2:8821::type">home</string>
</map>
XML
adb push /tmp/remote_codex_preferences.xml /data/local/tmp/remote_codex_preferences.xml
adb shell run-as com.remotecodex.android mkdir shared_prefs 2>/dev/null || true
adb shell run-as com.remotecodex.android cp /data/local/tmp/remote_codex_preferences.xml shared_prefs/remote_codex_preferences.xml
adb shell run-as com.remotecodex.android chmod 600 shared_prefs/remote_codex_preferences.xml
adb shell am start -n com.remotecodex.android/.MainActivity
```

Then capture XML and screenshot proving Home shows `Intranet / http://10.0.2.2:8821` and
`Connected`.
