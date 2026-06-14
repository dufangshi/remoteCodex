---
name: android-relay-e2e
description: Use this skill when running or expanding the Remote Codex Android app end-to-end test against relay mode from an Android Studio emulator. Covers building/installing apps/android, creating or validating the relay-only Dockerfile/image, starting the relay server and relay supervisor with a registered device token, connecting the Android app in Relay mode at http://10.0.2.2:8788, creating a workspace under ~/dev, creating a Codex thread with gpt-5.4 medium or another requested backend, sending flexible smoke or complex prompts, verifying streamed relay WebSocket updates, reloaded transcript state, and steering/follow-up behavior while the agent is running.
---

# Android Relay E2E

## Purpose

Run a real relay-mode Android E2E for this repo: build and install the latest APK, run a relay server plus a private relay supervisor on the current machine, register a relay device, connect the Android emulator through the relay, and verify prompt streaming, transcript reload, and steering behavior.

Use this only for relay mode. Local and direct server modes have separate skills.

## Defaults

- Repo root: current project root, usually `/Users/mac/dev/remoteCodex`.
- Android app: `apps/android`.
- Relay server host URL: `http://127.0.0.1:8788`.
- Relay server emulator URL: `http://10.0.2.2:8788`.
- Private supervisor host URL: `http://127.0.0.1:8787`.
- Workspace root: `$HOME/dev`.
- Test workspace: `$HOME/dev/remote-codex-android-relay-e2e`.
- Default relay admin username/password: `admin` / `relay-admin-password`.
- Default relay session secret: `relay-session-secret-123456`.
- Default private supervisor username/password: `admin` / `relay-supervisor-password`.
- Default private supervisor session secret: `relay-supervisor-session-secret-123`.
- Default model and effort: `gpt-5.4`, `medium`.
- App package/activity: `com.remotecodex.android/.MainActivity`.

Use user-provided credentials, ports, prompt, workspace, model, effort, or scenario when supplied.

## Helper Script

Prefer the bundled helper for repeatable setup:

```bash
.agents/skills/android-relay-e2e/scripts/android-relay-e2e-helper.sh doctor
.agents/skills/android-relay-e2e/scripts/android-relay-e2e-helper.sh build-install
.agents/skills/android-relay-e2e/scripts/android-relay-e2e-helper.sh build-relay-image
.agents/skills/android-relay-e2e/scripts/android-relay-e2e-helper.sh start-relay
.agents/skills/android-relay-e2e/scripts/android-relay-e2e-helper.sh register-device
.agents/skills/android-relay-e2e/scripts/android-relay-e2e-helper.sh start-relay-supervisor
.agents/skills/android-relay-e2e/scripts/android-relay-e2e-helper.sh seed-debug-connection
.agents/skills/android-relay-e2e/scripts/android-relay-e2e-helper.sh launch-app
.agents/skills/android-relay-e2e/scripts/android-relay-e2e-helper.sh stream-steer
```

`start-relay` and `start-relay-supervisor` run foreground services; use them in persistent terminal sessions and leave them running when the user wants more tests.

## Relay Dockerfile

The relay-only container should use the project root `Dockerfile.relay`. Validate it before relying on container deployment:

```bash
docker build -f Dockerfile.relay -t remote-codex-relay:e2e .
```

Run the image with admin credentials, a session secret, and a mounted data directory:

```bash
docker run --rm -p 8788:8788 \
  -e REMOTE_CODEX_ADMIN_USERNAME=admin \
  -e REMOTE_CODEX_ADMIN_PASSWORD=relay-admin-password \
  -e REMOTE_CODEX_RELAY_SESSION_SECRET=relay-session-secret-123456 \
  -v remote-codex-relay-data:/var/lib/remote-codex-relay \
  remote-codex-relay:e2e
```

## Workflow

1. Free old services on `127.0.0.1:8787` or `127.0.0.1:8788` unless the existing process is the relay stack for this test.

2. Build and install the current Android debug APK:

```bash
JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" \
ANDROID_HOME="$HOME/Library/Android/sdk" \
PATH="$HOME/Library/Android/sdk/platform-tools:$PATH" \
./gradlew :app:assembleDebug

PATH="$HOME/Library/Android/sdk/platform-tools:$PATH" \
adb install -r apps/android/app/build/outputs/apk/debug/app-debug.apk
```

Run Gradle from `apps/android`; run install from the repo root.

3. Build the relay server and optionally the relay image:

```bash
pnpm --filter @remote-codex/relay-server build
docker build -f Dockerfile.relay -t remote-codex-relay:e2e .
```

4. Start the relay server:

```bash
REMOTE_CODEX_ADMIN_USERNAME=admin \
REMOTE_CODEX_ADMIN_PASSWORD=relay-admin-password \
REMOTE_CODEX_RELAY_SESSION_SECRET=relay-session-secret-123456 \
REMOTE_CODEX_RELAY_DATA_DIR="$PWD/.local/relay-e2e" \
HOST=127.0.0.1 PORT=8788 \
node apps/relay-server/dist/index.js
```

5. Register a relay device. Prefer the Android Relay setup UI when possible: log into the relay portal, create a device, copy its device token, and then start the backend with that token. If emulator text entry blocks progress, register through the relay API and seed the debug app settings.

API registration:

```bash
curl -sS -H 'Content-Type: application/json' \
  -d '{"identifier":"admin","password":"relay-admin-password"}' \
  http://127.0.0.1:8788/relay/auth/login

curl -sS -H "Authorization: Bearer $RELAY_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Android relay E2E backend"}' \
  http://127.0.0.1:8788/relay/devices
```

Persist the relay user token, device id, and device token under `.local/relay-e2e-registration.json` for repeatable commands.

6. Start the private relay supervisor with the device token:

```bash
REMOTE_CODEX_ADMIN_USERNAME=admin \
REMOTE_CODEX_ADMIN_PASSWORD=relay-supervisor-password \
REMOTE_CODEX_SESSION_SECRET=relay-supervisor-session-secret-123 \
REMOTE_CODEX_RELAY_SERVER_URL=ws://127.0.0.1:8788 \
REMOTE_CODEX_RELAY_AGENT_TOKEN="$DEVICE_TOKEN" \
WORKSPACE_ROOT="$HOME/dev" \
DATABASE_URL="$PWD/.local/relay-supervisor-e2e.sqlite" \
HOST=127.0.0.1 PORT=8787 \
node bin/remote-codex.mjs relay-supervisor
```

7. Verify relay health:

```bash
curl -sS http://127.0.0.1:8788/healthz
```

Expected: `supervisorConnected: true` and `supervisorCount: 1`. Validate forwarded supervisor APIs through the relay route:

```bash
curl -sS -H "Authorization: Bearer $RELAY_TOKEN" \
  "http://127.0.0.1:8788/relay/devices/$DEVICE_ID/api/workspaces"
```

8. Connect the Android app in Relay mode:

- Clear stale settings if needed: `adb shell pm clear com.remotecodex.android`.
- Launch: `adb shell am start -n com.remotecodex.android/.MainActivity`.
- Select Relay mode, use `http://10.0.2.2:8788`, log in with relay admin credentials, select or create the device, and confirm the header shows `Relay / http://10.0.2.2:8788` and `Connected`.

Debug fallback when text entry blocks Relay setup:

```bash
.agents/skills/android-relay-e2e/scripts/android-relay-e2e-helper.sh seed-debug-connection
.agents/skills/android-relay-e2e/scripts/android-relay-e2e-helper.sh launch-app
```

This writes `supervisor_mode=relay`, the relay URL, relay session token, and relay device id to the debug app SharedPreferences via `run-as`. Treat it as test setup; still verify the APK header and relay WebSocket behavior.

9. Create or load a workspace under `$HOME/dev`, create a fresh thread, and verify the composer shows `gpt-5.4` and `Medium`. API-assisted creation through the relay route is acceptable when the app is open as the live relay client.

10. Run prompt scenarios:

- **Smoke**: send a short prompt and verify any completed assistant response.
- **Streaming**: use a multi-step prompt that runs a slow command, for example a shell loop that prints `relay_step_1`, sleeps, prints `relay_step_2`, sleeps, prints `relay_step_3`, then prints `relay_step_done`.
- **Steering**: while the turn is active, send a follow-up/steer from the app if possible, or through `POST /relay/devices/:deviceId/api/threads/:threadId/prompt`; verify it is accepted against the same active turn and the final answer includes a sentinel such as `RELAY_STEER_ACK`.
- **Transcript reload**: force-stop/relaunch the app or navigate away/back, open the thread, and verify completed transcript item count and usage reload.

11. Verify success from both surfaces:

- Android UI: `Relay / http://10.0.2.2:8788`, `Connected`, running transcript count increments during the active turn, final turn is `complete`, usage appears, model is `gpt-5.4`, effort is `Medium`.
- Relay API: `GET /relay/devices/:deviceId/api/threads/:threadId?limit=30` shows completed turn(s), no `lastError`, expected sentinel text, and no active turn.
- Relay server health remains connected.

## Android UI Notes

- `adb shell input text` is unreliable with Compose fields, uppercase, underscores, and punctuation. Prefer short smoke prompts, manual paste, or API-assisted prompt submission while the app is open for relay streaming verification.
- In the observed emulator layout, the relay header appears on the home screen, thread rows can be opened by tapping the visible row body, and the thread view exposes `content-desc="Send Prompt"` for composer sending.
- Capture evidence:

```bash
adb shell uiautomator dump /sdcard/window.xml >/dev/null
adb exec-out cat /sdcard/window.xml
adb exec-out screencap -p > /tmp/remote-codex-android-relay-e2e.png
```

## Completion Criteria

Report these facts:

- APK build/install result and emulator id.
- Relay Dockerfile/image validation result.
- Relay server and relay supervisor command/env summary; whether both remain running.
- Relay registration method, device id, and health `supervisorConnected` status.
- Android connection state: Relay mode, URL, connected.
- Workspace path/label.
- Thread id/title, model, reasoning effort, final status.
- Prompt scenario, streaming evidence, steering evidence, transcript reload evidence, and final sentinel checks.
- Any UI automation quirks, especially text-entry limitations or debug preference seeding.
