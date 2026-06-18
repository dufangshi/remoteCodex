---
name: android-server-e2e
description: Use this skill when running or expanding the Remote Codex Android app end-to-end test against the authenticated supervisor server mode from an Android Studio emulator. Covers starting REMOTE_CODEX_MODE=server with admin credentials, verifying auth-required REST behavior, logging the Android app into Server mode at http://10.0.2.2:8787, optionally seeding the debug app's server auth token when emulator text entry blocks progress, creating or loading a workspace under ~/dev, creating a Codex thread, choosing gpt-5.4 medium or another requested backend, sending smoke or complex prompts from the app, and verifying tokenized REST/WebSocket traffic, transcript loading, streaming updates, steering, and completed agent responses.
---

# Android Server E2E

## Purpose

Run a real authenticated server-mode Android E2E for this repo: start the supervisor with server auth, compile/install the Android app, connect the emulator through Server mode, create or load a workspace/thread, submit prompts from the Android UI, and verify results through both UI state and authenticated API payloads.

Use this only for direct server mode. Local and relay modes should use separate skills.

## Defaults

- Repo root: current project root, usually `/Users/mac/dev/remoteCodex`.
- Android app: `apps/android`.
- Host API URL: `http://127.0.0.1:8787`.
- Emulator API URL: `http://10.0.2.2:8787`.
- Workspace root: `$HOME/dev`.
- Test workspace: `$HOME/dev/remote-codex-android-e2e`.
- Default admin username/password for local testing: `admin` / `server-mode-password`.
- Default session secret: `server-mode-session-secret`.
- Default model and effort: `gpt-5.4`, `medium`.
- App package/activity: `com.remotecodex.android/.MainActivity`.

Use user-provided credentials, prompt, workspace, model, effort, or scenario when supplied.

## Helper Script

Prefer the bundled helper for repeatable setup:

```bash
.agents/skills/android-server-e2e/scripts/android-server-e2e-helper.sh doctor
.agents/skills/android-server-e2e/scripts/android-server-e2e-helper.sh build-install
.agents/skills/android-server-e2e/scripts/android-server-e2e-helper.sh start-server
.agents/skills/android-server-e2e/scripts/android-server-e2e-helper.sh auth-check
.agents/skills/android-server-e2e/scripts/android-server-e2e-helper.sh seed-debug-connection
.agents/skills/android-server-e2e/scripts/android-server-e2e-helper.sh launch-app
.agents/skills/android-server-e2e/scripts/android-server-e2e-helper.sh dump-ui
```

`start-server` runs a foreground `pnpm dev`; use it in a persistent terminal session. Leave it running if the user plans more tests.

## Workflow

1. Stop any local-mode process occupying `127.0.0.1:8787` before starting server mode.

2. Build/install the Android app:

```bash
JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" \
ANDROID_HOME="$HOME/Library/Android/sdk" \
PATH="$HOME/Library/Android/sdk/platform-tools:$PATH" \
./gradlew :app:assembleDebug

PATH="$HOME/Library/Android/sdk/platform-tools:$PATH" \
adb install -r apps/android/app/build/outputs/apk/debug/app-debug.apk
```

Run Gradle from `apps/android`; run install from the repo root.

3. Start server mode from the repo root:

```bash
REMOTE_CODEX_MODE=server \
REMOTE_CODEX_ADMIN_USERNAME=admin \
REMOTE_CODEX_ADMIN_PASSWORD=server-mode-password \
REMOTE_CODEX_SESSION_SECRET=server-mode-session-secret \
WORKSPACE_ROOT="$HOME/dev" \
pnpm dev
```

4. Verify the auth contract:

```bash
curl -sS http://127.0.0.1:8787/api/auth/session
curl -sS -o /tmp/server-unauth.json -w '%{http_code}\n' http://127.0.0.1:8787/api/workspaces
curl -sS -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"server-mode-password"}' \
  http://127.0.0.1:8787/api/auth/login
```

Expected: session has `mode: "server"` and `authRequired: true`; unauthenticated `/api/workspaces` returns `401`; login returns a token.

5. Connect the Android app through Server mode:

- Clear app data if an old connection is persisted: `adb shell pm clear com.remotecodex.android`.
- Launch app: `adb shell am start -n com.remotecodex.android/.MainActivity`.
- Select `Server`.
- Use URL `http://10.0.2.2:8787`.
- Enter admin credentials and connect.

If emulator text entry blocks progress, use the debug-only fallback:

```bash
.agents/skills/android-server-e2e/scripts/android-server-e2e-helper.sh seed-debug-connection
.agents/skills/android-server-e2e/scripts/android-server-e2e-helper.sh launch-app
```

This logs in with the server API, writes the returned token into the debug app SharedPreferences with `run-as`, and launches the app. Treat this as test setup, not a substitute for checking server-mode UI state.

6. Confirm the Android home header says `Server / http://10.0.2.2:8787` and `Connected`. API logs should show authenticated Android REST calls and a WebSocket request like `/ws?token=...`.

7. Create or reuse a workspace under `$HOME/dev`, then create a fresh thread from the Android UI. Set or verify `gpt-5.4` and `Medium`. If UI model entry fails, use authenticated `PATCH /api/threads/:id/settings`, then verify the Android composer updates.

8. Send the prompt from the Android composer. For a smoke test, use a short prompt that is easy to type by `adb`, for example:

```text
hello
```

For richer tests, use UI paste/manual entry or API-assisted setup only when necessary:

```text
Create a three-step plan, read README.md, summarize the workspace, and finish with SERVER_E2E_COMPLEX_OK.
```

9. Verify success:

- Android UI shows transcript count increased, completed turn(s), assistant response, `Connected`, and usage update.
- API `GET /api/threads/:id?limit=30` with bearer token shows `thread.status: "idle"`, `lastError: null`, `model`, `reasoningEffort`, completed turns, user item(s), and agent item(s).
- Server logs show Android requests from `10.0.2.2:8787` with `200` responses and tokenized `/ws`.

## Prompt Variants

Adapt the prompt to the requested behavior:

- **Smoke**: short input such as `hello` to validate app submit and response.
- **Exact sentinel**: use manual keyboard or reliable paste when exact uppercase/underscore output matters.
- **Streaming**: ask for multiple numbered sections and poll `uiautomator dump` during the turn.
- **Transcript reload**: relaunch or navigate away/back after completion and verify prior turns load.
- **Steering**: start a longer turn, submit a follow-up or steer if the app exposes it, then verify final response and API items.
- **Auth resilience**: clear or corrupt token, verify server rejects protected REST, then login/seed a fresh token and recover.

## Android UI Notes

- `adb shell input text` is unreliable with Compose text fields, uppercase, underscores, and some punctuation. Prefer short lowercase prompts for smoke tests, or use manual entry when exact text matters.
- Tap inside the text box body, not the placeholder label. In the observed emulator layout, `x=600 y=2100` focused the composer more reliably than tapping the left edge.
- Hide the keyboard with `adb shell input keyevent 4` before tapping `Send Prompt`.
- If the send button is enabled but the first tap misses, dump UI XML and tap the current `content-desc="Send Prompt"` bounds.

Capture evidence:

```bash
adb shell uiautomator dump /sdcard/window.xml >/dev/null
adb exec-out cat /sdcard/window.xml
adb exec-out screencap -p > /tmp/remote-codex-android-server-e2e.png
```

## Completion Criteria

Report these facts:

- APK build/install result.
- Emulator id.
- Server-mode command/env and service health; whether it remains running.
- Auth verification: unauthenticated protected route rejected and login token worked.
- Android connection state: Server mode, URL, connected.
- Workspace path/label.
- Thread id/title, model, reasoning effort, final status.
- Prompt(s) sent from the app and exact API-confirmed assistant response(s).
- Any UI automation quirks, especially text-entry limitations or debug-token seeding.
