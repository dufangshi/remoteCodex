---
name: android-local-e2e
description: Use this skill when running or expanding the Remote Codex Android app end-to-end test against the local supervisor service from an Android Studio emulator. Covers building/installing apps/android, starting local mode, connecting to http://10.0.2.2:8787, creating a workspace under ~/dev, creating a Codex thread, choosing model/reasoning settings such as gpt-5.4 medium, sending flexible smoke or complex prompts, and verifying streamed messages, loaded transcript state, and steering behavior.
---

# Android Local E2E

## Purpose

Run a real local-mode Android E2E for this repo: compile and install the app, start the local supervisor API, drive the Android emulator UI, create a workspace/thread, send prompts, and verify the response through both the app UI and the API.

Use this only for local supervisor mode. Server and relay modes should get separate skills.

## Defaults

- Repo root: current project root, usually `/Users/mac/dev/remoteCodex`.
- Android app: `apps/android`.
- Emulator URL for local API: `http://10.0.2.2:8787`.
- Host API URL: `http://127.0.0.1:8787`.
- Workspace root: `$HOME/dev`.
- Test workspace: `$HOME/dev/remote-codex-android-e2e`.
- Default model and effort: `gpt-5.4`, `medium`.
- App package/activity: `com.remotecodex.android/.MainActivity`.

If the user gives a different prompt, workspace, model, effort, or scenario, use that instead.

## Helper Script

Prefer the bundled helper for repeatable setup:

```bash
.agents/skills/android-local-e2e/scripts/android-local-e2e-helper.sh doctor
.agents/skills/android-local-e2e/scripts/android-local-e2e-helper.sh build-install
.agents/skills/android-local-e2e/scripts/android-local-e2e-helper.sh api-check
.agents/skills/android-local-e2e/scripts/android-local-e2e-helper.sh create-workspace
.agents/skills/android-local-e2e/scripts/android-local-e2e-helper.sh launch-app
.agents/skills/android-local-e2e/scripts/android-local-e2e-helper.sh dump-ui
```

The script sets `JAVA_HOME` from Android Studio's bundled JBR and adds platform-tools when the usual macOS locations exist.

## Workflow

1. Confirm an emulator is running:

```bash
PATH="$HOME/Library/Android/sdk/platform-tools:$PATH" adb devices -l
```

2. Build and install the Android app:

```bash
JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" \
ANDROID_HOME="$HOME/Library/Android/sdk" \
PATH="$HOME/Library/Android/sdk/platform-tools:$PATH" \
./gradlew :app:assembleDebug

PATH="$HOME/Library/Android/sdk/platform-tools:$PATH" \
adb install -r apps/android/app/build/outputs/apk/debug/app-debug.apk
```

Run the Gradle command from `apps/android`; run the install command from the repo root.

3. Start or reuse the local supervisor service:

```bash
WORKSPACE_ROOT="$HOME/dev" pnpm db:migrate
WORKSPACE_ROOT="$HOME/dev" pnpm dev
```

Leave the service running when the user asks to continue later. If `pnpm dev` reports missing built packages, build the missing workspace packages and continue if the API at `127.0.0.1:8787` is healthy.

4. Verify API availability:

```bash
curl -sS http://127.0.0.1:8787/healthz
curl -sS http://127.0.0.1:8787/api/config/runtime
```

The runtime config should show local mode and `workspaceRoot` under `$HOME/dev`.

5. Drive the Android app:

```bash
PATH="$HOME/Library/Android/sdk/platform-tools:$PATH" \
adb shell am start -n com.remotecodex.android/.MainActivity
```

Use `uiautomator dump` and `adb shell input tap/text/keyevent` to navigate when no richer browser/app automation is available. After launch, connect with Intranet/local mode and URL `http://10.0.2.2:8787`.

6. Create the test workspace from the Android UI. Use an absolute host path, for example:

```text
/Users/mac/dev/remote-codex-android-e2e
```

7. Create a thread from that workspace. Set model to `gpt-5.4`; verify the composer shows `Medium` for reasoning effort. If needed, use the composer model and effort controls after thread creation.

8. Send the requested prompt. For quick smoke, use a deterministic prompt such as:

```text
Reply with ANDROID_E2E_OK only.
```

For richer tests, use a prompt that forces streaming and state updates, for example:

```text
Create a three-step plan, inspect README.md, summarize what you found, then finish with ANDROID_E2E_COMPLEX_OK.
```

9. Verify results from both surfaces:

- Android UI: transcript item count increments, turn moves to complete/idle, assistant message appears, usage updates.
- API: `GET /api/threads/:id?limit=30` shows `thread.model`, `thread.reasoningEffort`, `turns[].status`, `turns[].items`, and no `lastError`.

Example API check:

```bash
curl -sS "http://127.0.0.1:8787/api/threads/$THREAD_ID?limit=30" |
  node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s); console.log(JSON.stringify({thread:j.thread, turns:j.turns}, null, 2));})'
```

## Prompt Variants

Adapt the test prompt to the behavior under test:

- **Smoke response**: exact-token reply, validates end-to-end connectivity.
- **Streaming**: ask for a numbered multi-part answer with short pauses or staged work; poll UI dumps during the turn for partial state.
- **Workspace loading**: ask the agent to read or list known files in the test workspace, then verify the workspace tab/file preview still loads.
- **Steering**: while a long turn is running, send a steer/follow-up from the composer if the UI exposes it; verify the API shows the additional user item and the final answer incorporates it.
- **Transcript reload**: background/relaunch the app or navigate away and back; verify existing user/assistant messages reload from the API.

Prefer prompts with a unique final sentinel such as `ANDROID_E2E_OK` so success is easy to confirm in API payloads and UI dumps.

## Android UI Notes

- `adb shell input text` does not type spaces literally; use `%s` for spaces or paste via clipboard if available. It may leave encoded `%20` in Compose fields, so prefer simple prompts or verify what was actually sent in the API.
- If the software keyboard is open, hide it with `adb shell input keyevent 4` before tapping the send button.
- Capture UI evidence with:

```bash
adb exec-out screencap -p > /tmp/remote-codex-android-local-e2e.png
adb shell uiautomator dump /sdcard/window.xml >/dev/null
adb exec-out cat /sdcard/window.xml
```

## Completion Criteria

Report these facts in the final answer:

- APK build/install result.
- Emulator id.
- Local service health and whether it was left running.
- Workspace path and label.
- Thread id/title, model, reasoning effort, final thread status.
- Prompt scenario used and assistant response or sentinel.
- Any app/API errors, UI quirks, or commands that could not be run.

Do not stop the local service or emulator when the user asks to keep testing.
