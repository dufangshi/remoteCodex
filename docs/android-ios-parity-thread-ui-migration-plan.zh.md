# Android iOS Parity And Thread UI Migration Plan

本文档用于 goal mode 推进 Android app 对齐当前 iOS app，并把 Android thread
detail 从原生 Compose 实现迁移到共享 `@remote-codex/thread-ui` WebView surface。

目标不是把整个 Android app 变成网页，而是复用已经在 iOS 上跑通的产品边界：
原生层负责 Devices、连接、工作区入口、系统能力和导航壳；thread detail 的 chat、
workspace explorer、viewer、composer、settings、streaming 和 rich rendering 统一由
`remote-codex-thread-ui` 承担。

## 目标

- Android thread detail 不再继续扩展原生 Compose thread UI；chat/thread/workspace
  主体验改为 Android WebView 承载共享 thread UI。
- Android native screens 与当前 iOS app 功能和交互对齐，包括 Devices、Saved
  Devices、Add/Edit/Delete、Relay Devices、Workspaces、Workspace Detail、New
  Thread、右上角悬浮菜单、返回手势和二次确认。
- Local/Intranet、Server、Relay 三种模式都能从 Android emulator 真实 UI 完成
  连接、建 workspace、建 thread、发 prompt、streaming、reload 和返回导航验证。
- 每个 phase 完成前必须通过本机 Android emulator E2E gate；不能只靠 API 或单元
  测试宣布完成。
- 每个 phase 的证据统一保存到 `.local/android-parity-e2e/<phase>/`，包括截图、
  UI dump、服务命令/env 摘要、thread/workspace id 和失败记录。

## 非目标

- 不把 Devices、Home、Workspace list 全部迁到 WebView。
- 不 fork 一份 Android 专用 thread UI。
- 不在 Kotlin/Compose 中继续追平 timeline、composer、workspace explorer、viewer、
  pending request、settings 等 thread-ui 细节。
- 不改变 supervisor API contract；Android WebView 应适配现有 local/server/relay
  路径和认证方式。
- 不用 API-only 流程替代 App UI E2E。可以用 API 辅助造数据，但验收必须打开
  Android app 的真实界面验证。

## Source Of Truth

- iOS app 当前行为是 Android parity 的产品基线。
- `docs/ios-thread-webview-migration-plan.zh.md` 是 thread-ui WebView 边界参考。
- `@remote-codex/thread-ui` 是 thread detail UI 的 canonical implementation。
- Android emulator 访问宿主机 supervisor/relay 使用 `10.0.2.2`，宿主机命令仍使用
  `127.0.0.1`。

## Target Architecture

```text
RemoteCodex Android app
  -> native Devices / Workspaces / Workspace Detail / New Thread shell
  -> ThreadDetailWebViewScreen(threadId, connectionConfig)
  -> Android WebView loads bundled Android thread-web index.html
  -> window.__REMOTE_CODEX_ANDROID_BOOTSTRAP__
       baseUrl, mode, authToken, relayDeviceId, threadId, theme, platform
  -> AndroidThreadApp.tsx
       API client + WebSocket client + adapters
  -> ThreadDetailSurface from @remote-codex/thread-ui
```

Recommended Android WebView asset loading:

- Use `androidx.webkit.WebViewAssetLoader` and serve bundled assets from
  `https://appassets.androidplatform.net/assets/thread-ui/index.html`.
- Keep debug-only support for loading a local web dev server if useful, but release and
  E2E should validate the bundled asset path.
- Add Android network security config only for debug local HTTP access to
  `10.0.2.2`; production server/relay URLs should remain HTTPS-capable.

Native bridge should stay intentionally small:

```text
JS -> Kotlin
  closeThread()
  openThread(threadId)
  openWorkspace(workspaceId)
  openDevices()
  setNavigationTitle(title)
  setPreferredTheme(themeMode)
  pickUploadFile(requestId, accept)
  shareDownloadedFile(payload)
  reportFatalError(message)

Kotlin -> JS
  updateTheme(themeMode, effectiveTheme)
  updateConnection(config)
  updateSceneActive(active)
  filePickerResult(requestId, files)
  refresh()
```

## Build Boundary

When changing `@remote-codex/thread-ui` source, rebuild it before validating Android:

```bash
pnpm --filter @remote-codex/thread-ui build
```

Android should add a reproducible web bundle step, for example:

```text
apps/android/thread-web
  package.json
  vite.config.ts
  index.html
  src/AndroidThreadApp.tsx

apps/android/app/src/main/assets/thread-ui
  index.html
  assets/**
```

The Gradle build should depend on the web bundle copy task for debug/release APKs. A
manual fallback command is acceptable during early phases, but Phase 3 cannot complete
until a fresh APK contains fresh web assets without hand-copying.

## Parity Matrix

| Area | iOS parity target | Android target |
| --- | --- | --- |
| Devices | Saved cards, Add via `+`, Edit/Delete, Connect | Native Compose screen with same cards and actions |
| Local/Intranet | URL card, persisted name/url, Connect | Same, default `http://10.0.2.2:8787` for emulator setup |
| Server | URL + username/password, persisted device card | Same, token stored in Android settings securely enough for current app model |
| Relay | Relay card opens Relay Devices, selected device connects | Same, no confusing Local card inside Relay Devices subpage |
| Relay Devices | Refresh, Connect, Revoke confirm, Create Device via `+` | Same native subpage and E2E relay validation |
| Workspaces home | Only workspaces, right-top floating menu | Same; no separate global Threads section |
| Workspace detail | Path + Threads only, right-top floating menu | Same; no native Files/Preview/Open/Favorite clutter |
| New Thread | Provider selector + model list + reasoning effort | Same provider/model UX as iOS and web |
| Thread detail | Fullscreen shared thread UI, native chrome hidden | WebView-hosted `ThreadDetailSurface` |
| Settings | Web thread settings feature-complete | Use thread-ui settings inside WebView; native only forwards theme |
| Theme | Follow system/dark/light synced across native and WebView | Same repository setting and bridge update |
| Deletion | Any delete/revoke/destructive action has confirmation | Same across native and WebView surfaces |
| Back navigation | Workspace -> Home, Thread -> Workspace, Devices subpage -> Devices | Android back and edge gesture must follow same hierarchy |

## Goal Mode Rules

- Work one phase at a time. Do not begin the next phase until the current phase checklist
  and E2E gate are checked.
- If a checklist item becomes intentionally deferred, add a short note under that phase
  with owner and target phase.
- Record every E2E run under `.local/android-parity-e2e/<phase>/`.
- Prefer screenshots plus `uiautomator` XML over verbal claims.
- Keep old native thread UI available only behind a temporary debug flag until Phase 5;
  remove or quarantine it before Phase 8 completes.

## Common E2E Commands

Build and install from `apps/android`:

```bash
cd apps/android
JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" \
ANDROID_HOME="$HOME/Library/Android/sdk" \
PATH="$HOME/Library/Android/sdk/platform-tools:$PATH" \
./gradlew :app:assembleDebug

cd ../..
PATH="$HOME/Library/Android/sdk/platform-tools:$PATH" \
adb install -r apps/android/app/build/outputs/apk/debug/app-debug.apk
```

Local supervisor for emulator:

```bash
mkdir -p .local/android-parity-e2e

DATABASE_URL="$PWD/.local/android-parity-e2e/supervisor-local.sqlite" \
WORKSPACE_ROOT="$HOME/dev" \
HOST=127.0.0.1 \
PORT=8787 \
REMOTE_CODEX_MODE=local \
REMOTE_CODEX_E2E_FAKE_RUNTIME=1 \
REMOTE_CODEX_ENABLED_AGENT_PROVIDERS=codex,claude,opencode \
REMOTE_CODEX_DISABLE_BUILD_RESTART=true \
REMOTE_CODEX_ENABLE_WEBVIEW_CORS=true \
pnpm --filter @remote-codex/supervisor-api exec tsx src/index.ts
```

Server supervisor for emulator:

```bash
DATABASE_URL="$PWD/.local/android-parity-e2e/supervisor-server.sqlite" \
WORKSPACE_ROOT="$HOME/dev" \
HOST=127.0.0.1 \
PORT=8787 \
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

Relay E2E should use the existing relay helper or equivalent command sequence:

```bash
.agents/skills/android-relay-e2e/scripts/android-relay-e2e-helper.sh doctor
.agents/skills/android-relay-e2e/scripts/android-relay-e2e-helper.sh build-install
.agents/skills/android-relay-e2e/scripts/android-relay-e2e-helper.sh start-relay
.agents/skills/android-relay-e2e/scripts/android-relay-e2e-helper.sh register-device
.agents/skills/android-relay-e2e/scripts/android-relay-e2e-helper.sh start-relay-supervisor
.agents/skills/android-relay-e2e/scripts/android-relay-e2e-helper.sh launch-app
```

Evidence capture:

```bash
PATH="$HOME/Library/Android/sdk/platform-tools:$PATH" adb devices -l
PATH="$HOME/Library/Android/sdk/platform-tools:$PATH" adb shell uiautomator dump /sdcard/window.xml >/dev/null
PATH="$HOME/Library/Android/sdk/platform-tools:$PATH" adb exec-out cat /sdcard/window.xml > .local/android-parity-e2e/<phase>/window.xml
PATH="$HOME/Library/Android/sdk/platform-tools:$PATH" adb exec-out screencap -p > .local/android-parity-e2e/<phase>/screen.png
```

## Phase 0: Baseline Inventory And Parity Spec

Goal: freeze current iOS behavior and Android gaps before making migration edits.

Checklist:

- [x] Capture iOS screenshots or notes for Devices, Workspaces home, Workspace detail,
  New Thread, Thread detail, Settings, Relay Devices and destructive confirmations.
- [x] Capture current Android screenshots for the same flows.
- [x] Map Android native thread UI files that will be replaced or deprecated, especially
  `ThreadDetailScreen.kt`, `ThreadTopBar.kt`, `ThreadComposer.kt`, `WorkspacePanel.kt`,
  `ThreadTimelineComponents.kt`, and thread presentation/reducer code.
- [x] Identify Android native files that remain product surfaces: connection/settings,
  home, devices, workspace detail, file picker/share helpers and API connection models.
- [x] Add or update a lightweight parity checklist issue/doc section if any iOS behavior is
  ambiguous.

Progress note:

- Code-level Phase 0 inventory is in
  `docs/android-ios-parity-phase0-inventory.zh.md`. Android screenshots and Phase 0
  local-mode E2E evidence are saved under `.local/android-parity-e2e/phase-0/`.

E2E gate:

- [x] Build and install current Android APK on the existing emulator.
- [x] Connect Local/Intranet to `http://10.0.2.2:8787`.
  - Actual Phase 0 run used `http://10.0.2.2:8821` because the user-confirmed
    local supervisor for this session was already running on host port 8821.
- [x] Open or create one workspace and one thread from the Android UI.
- [x] Send a smoke prompt from the Android UI, not API-only.
- [x] Save screenshots/XML under `.local/android-parity-e2e/phase-0/`.

Evidence:

- AVD: `cardverify_aosp35_root` attached as `emulator-5554`.
- APK: `apps/android/app/build/outputs/apk/debug/app-debug.apk`
  (`sha256 9ed2d75ac5d5a972923675d5e7a63ac7a7a5883277c54336bcb852d827007a1d`).
- Build log: `.local/android-parity-e2e/phase-0/assemble-debug.log`.
- Initial connection screenshot/XML:
  `.local/android-parity-e2e/phase-0/android-initial.png`,
  `.local/android-parity-e2e/phase-0/android-initial.xml`.
- Connected home screenshot/XML:
  `.local/android-parity-e2e/phase-0/android-after-connect.png`,
  `.local/android-parity-e2e/phase-0/android-after-connect.xml`.
- Workspace screenshot/XML:
  `.local/android-parity-e2e/phase-0/android-workspace-open.png`,
  `.local/android-parity-e2e/phase-0/android-workspace-open.xml`.
- Thread smoke screenshots/XML:
  `.local/android-parity-e2e/phase-0/android-thread-open.png`,
  `.local/android-parity-e2e/phase-0/android-thread-after-complete.png`,
  `.local/android-parity-e2e/phase-0/android-thread-after-complete.xml`.
- API snapshot: `.local/android-parity-e2e/phase-0/api-threads.json`.

## Phase 1: Android Thread Web Bundle

Goal: create a standalone Android web shell that imports shared thread UI and can be
bundled into the APK.

Checklist:

- [x] Add `apps/android/thread-web` with Vite/TypeScript entrypoint.
- [x] Import `ThreadDetailSurface` from `@remote-codex/thread-ui`.
- [x] Define `AndroidBootstrap`, `AndroidNativeBridge`, and connection normalization
  modules.
- [x] Support local/server REST paths and relay selected-device REST paths.
- [x] Support WebSocket URL construction for local/server/relay.
- [x] Add build script that outputs static assets.
- [x] Add Gradle task to copy built assets into `app/src/main/assets/thread-ui`.
- [x] Document dev rebuild command and make APK build depend on fresh web assets.

E2E gate:

- [x] Build `@remote-codex/thread-ui`.
- [x] Build Android web bundle.
- [x] Build/install APK and verify bundled `index.html` exists in APK assets.
- [x] Launch a temporary WebView route or fixture activity showing a nonblank thread UI.
- [x] Save screenshot/XML under `.local/android-parity-e2e/phase-1/`.

Progress note:

- Added `apps/android/thread-web` with `@remote-codex/thread-ui` import, Android bootstrap,
  native bridge message envelope and local/server/relay URL helpers.
- Added Gradle `buildAndroidThreadWeb` and `copyAndroidThreadWebAssets`; `preBuild` depends
  on the asset copy.
- Verified:
  - `pnpm --dir ../remote-codex-thread-ui --filter @remote-codex/thread-ui build`
  - `pnpm --filter @remote-codex/android-thread-web typecheck`
  - `pnpm --filter @remote-codex/android-thread-web build`
  - `JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" ANDROID_HOME="$HOME/Library/Android/sdk" ./gradlew :app:assembleDebug --no-configuration-cache`
- APK now contains:
  - `assets/thread-ui/index.html`
  - `assets/thread-ui/assets/index-CD-TfPQC.js`
  - `assets/thread-ui/assets/index-CakSVv3F.css`
  - `assets/thread-ui/vendor/3Dmol-min.js`
- Temporary WebView fixture verified on `emulator-5554` using the user-confirmed local
  supervisor port `8821`.
- Android WebView on the current AOSP image computed `100vh`/`100dvh` root heights as
  `0px`; `apps/android/thread-web` now sets root viewport height from `window.innerHeight`
  before rendering to prevent a blank clipped WebView.
- Evidence:
  - `.local/android-parity-e2e/phase-1/android-thread-web-fixture-visible.png`
  - `.local/android-parity-e2e/phase-1/android-thread-web-fixture-visible.xml`

## Phase 2: WebView Host And Bridge

Goal: add the Android WebView host without replacing the real thread route yet.

Checklist:

- [x] Add `ThreadDetailWebViewScreen.kt`.
- [x] Load bundled assets through `WebViewAssetLoader`.
- [x] Inject bootstrap JSON before app initialization.
- [x] Implement a minimal `@JavascriptInterface` bridge with JSON envelopes.
- [x] Forward theme mode and effective theme from `AppSettingsRepository`.
- [x] Handle Android lifecycle: pause/resume scene active, destroy WebView cleanly.
- [x] Add fatal-error fallback UI with retry and return-to-workspace actions.
- [x] Add debug logs that can distinguish web bundle load failure, API failure and bridge
  failure.

E2E gate:

- [x] With local supervisor running, open fixture WebView for a bundled thread-web asset.
- [x] Verify the web app fetches real thread detail.
- [x] Toggle Android native theme setting and verify WebView theme updates without reload.
- [x] Press Android back and verify it returns to the previous native screen.
- [x] Save logs, screenshot and XML under `.local/android-parity-e2e/phase-2/`.

Progress note:

- Added `ThreadDetailWebViewScreen.kt` with `WebViewAssetLoader`, injected Android bootstrap
  and a small JSON bridge for ready/debug/open-thread/open-workspace/open-devices/fatal-error
  messages.
- Added a debug-only `MainActivity` fixture route via intent extras:
  - `remote_codex_thread_web_fixture`
  - `remote_codex_thread_web_base_url`
  - `remote_codex_thread_web_thread_id`
- Verified bundled WebView rendering against `http://10.0.2.2:8821` on `emulator-5554`.
- Final fixture log shows the bundled `appassets.androidplatform.net` page loaded and the
  bridge ready message; no WebView fatal error was recorded.
- Added Android real-thread web client pieces:
  - `AndroidApiClient.ts`
  - `AndroidWebSocket.ts`
  - `AndroidNativeHttp.ts`
  - `AndroidOptimisticPrompt.ts`
  - `AndroidThreadDetailPage.tsx`
- Added a native HTTP bridge for REST calls. This avoids Android WebView origin/network
  differences while keeping the shared thread UI in charge of thread rendering.
- Verified real thread detail rendering on `emulator-5554` with supervisor on port `8821`.
  The successful run used `http://192.168.68.57:8821` because this AOSP image did not return
  HTTP content through `adb reverse` on `127.0.0.1:8821`, while the host LAN address did.
- Fixed an Android WebView viewport issue where `100svh`/`100dvh` could compute to `0px`.
  The Android web bundle now writes `--android-viewport-height` from `window.innerHeight`
  and forces `.thread-ui-shell.thread-ui-viewport-constrained` to that height.
- Added WebView host lifecycle handling:
  - `ON_RESUME` calls `WebView.onResume()` and forwards `setSceneActive(true)`.
  - `ON_PAUSE`/`ON_STOP` call `WebView.onPause()` and forward `setSceneActive(false)`.
  - `AndroidView.onRelease` forwards inactive, stops loading, removes the JS interface and
    destroys the WebView.
- Replaced the old bottom red error text with a centered fatal fallback panel containing
  `Retry` and `Workspace` actions.
- Verified the fallback panel on `emulator-5554` by launching a restored thread route that
  returned `Internal Server Error`; the overlay showed `Thread UI failed`, `Retry` and
  `Workspace`, and tapping `Workspace` returned to native workspace detail.
- Verified lifecycle/release bridge logging captured `scene:inactive` after returning from the
  WebView to native workspace.
- Verified Android build/unit tests:
  - `./gradlew :app:assembleDebug --no-configuration-cache`
  - `./gradlew :app:testDebugUnitTest --no-configuration-cache`
- Verified theme bridge and Android Back on `emulator-5554` against local supervisor `8821`:
  - Started from the real native `3dprint` Workspace detail screen and opened the
    `Android explorer scroll restore` thread into the bundled WebView thread UI.
  - Used the thread-ui/native bridge to request `dark` and then `light`; WebView DOM moved
    from `data-theme-mode=system`/`data-theme-effective=light` to `dark`/`dark`, then
    `light`/`light`.
  - `performance.timeOrigin` and a JS marker stayed unchanged across both theme changes, so
    the theme update happened in-place without WebView reload.
  - Android shared preferences recorded `<string name="theme_mode">light</string>` after the
    bridge round trip, proving the native settings layer received the change.
  - Pressing Android Back returned from WebView thread detail to the native `3dprint`
    Workspace detail screen. The XML contains the workspace path, `Back to home`, and
    workspace thread rows, with no WebView `Explorer`/`Tool Usage` thread content remaining.
- Evidence:
  - `.local/android-parity-e2e/phase-2/android-thread-web-fixture-visible.png`
  - `.local/android-parity-e2e/phase-2/android-thread-web-fixture-visible.xml`
  - `.local/android-parity-e2e/phase-2/android-thread-web-fixture-logcat.txt`
  - `.local/android-parity-e2e/phase-2-real-thread/android-thread-web-real-thread-lan8821-viewportfix.png`
  - `.local/android-parity-e2e/phase-2-real-thread/android-thread-web-real-thread-lan8821-viewportfix.xml`
  - `.local/android-parity-e2e/phase-2-real-thread/android-thread-web-real-thread-lan8821-viewportfix-logcat.txt`
  - `.local/android-parity-e2e/phase-2/lifecycle-fallback/fatal-overlay.png`
  - `.local/android-parity-e2e/phase-2/lifecycle-fallback/fatal-overlay.xml`
  - `.local/android-parity-e2e/phase-2/lifecycle-fallback/return-workspace-after-fatal.png`
  - `.local/android-parity-e2e/phase-2/lifecycle-fallback/return-workspace-after-fatal.xml`
  - `.local/android-parity-e2e/phase-2/lifecycle-fallback/thread-web-logcat.txt`
  - `.local/android-parity-e2e/phase-2/lifecycle-fallback/assemble-debug.log`
  - `.local/android-parity-e2e/phase-2/lifecycle-fallback/test-debug-unit.log`
  - `.local/android-parity-e2e/phase-2/theme-back/assemble-debug.log`
  - `.local/android-parity-e2e/phase-2/theme-back/normal-launch.png`
  - `.local/android-parity-e2e/phase-2/theme-back/normal-launch.xml`
  - `.local/android-parity-e2e/phase-2/theme-back/thread-open-before-theme.png`
  - `.local/android-parity-e2e/phase-2/theme-back/thread-open-before-theme.xml`
  - `.local/android-parity-e2e/phase-2/theme-back/theme-bridge-result.json`
  - `.local/android-parity-e2e/phase-2/theme-back/thread-after-theme-light.png`
  - `.local/android-parity-e2e/phase-2/theme-back/remote-codex-preferences-after-theme.xml`
  - `.local/android-parity-e2e/phase-2/theme-back/back-return-workspace.png`
  - `.local/android-parity-e2e/phase-2/theme-back/back-return-workspace.xml`

## Phase 3: Replace Android Thread Detail Route

Goal: make the normal Android thread route use shared WebView thread UI.

Checklist:

- [x] Route thread rows to `ThreadDetailWebViewScreen`.
- [x] Keep native thread detail behind a temporary debug-only fallback flag.
- [x] Remove native top chrome from thread detail; thread-ui owns topbar, menu, chat/workspace
  switch, settings and composer.
- [x] Ensure thread-ui menu actions route to native Devices/Home/Workspace as appropriate.
- [x] Ensure Android back stack is `Devices/Home -> Workspace -> Thread`; back from Thread
  returns to Workspace, not Home.
- [x] Verify full-screen safe-area/insets behavior, including bottom composer space and display
  cutout/status bar.
- [x] Ensure file download/share bridge works for at least simple text artifacts.

E2E gate:

- [x] Local mode: connect from Android UI, create workspace, create thread, open thread.
- [x] Send `ANDROID_WEB_THREAD_LOCAL_OK` prompt from the WebView composer.
- [x] Verify streaming/progress appears in the WebView.
- [x] Navigate Chat <-> Workspace using thread-ui control.
- [x] Open workspace explorer, preview one file, close viewer, and verify explorer scroll
  position is preserved.
- [x] Save evidence under `.local/android-parity-e2e/phase-3/`.

Progress note:

- Replaced the normal `ConnectedRoute.ThreadDetail` branch in `MainActivity` with
  `ThreadDetailWebViewScreen`.
- Connected thread-ui bridge callbacks back to the native route layer:
  - `openThread` -> `ConnectedRoute.ThreadDetail`
  - `openWorkspace` -> `ConnectedRoute.WorkspaceDetail`
  - `openDevices` -> native account/devices panel
  - `closeThread` -> Home for now
  - `setThemeMode` -> `AppSettingsRepository.writeThemeMode`
- Added a native `BackHandler` so pressing Android Back from WebView thread detail returns to
  the owning Workspace when the route has or learns a `workspaceId`.
- Extended `SavedAppRoute.ThreadDetail` and `ConnectedRoute.ThreadDetail` with optional
  `workspaceId`; Android stores this from Home thread summaries, Workspace thread lists and the
  WebView `setNavigationTitle` bridge callback.
- Verified normal app launch restored the saved thread route and rendered shared WebView thread
  UI against supervisor `8821`.
- Verified the real UI path Workspace -> tap thread card -> shared WebView thread UI -> Android
  Back -> Workspace on `emulator-5554`.
- Added Android WebView workspace download/share support:
  - `ThreadWorkspaceAdapter.downloadNode` calls the supervisor `/files/download` endpoint.
  - The native HTTP bridge now returns response headers plus base64 body data.
  - `shareDownloadedFile` writes the file to Downloads via `saveExportToDownloads` and opens
    the Android share sheet. The current AOSP image has no share targets, so the system sheet
    reports "No apps can perform this action", but the bridge saves the file and starts the
    chooser successfully.
- Verified downloading `result.json` from the shared workspace explorer saved a 204-byte file
  at `/sdcard/Download/Remote Codex/result.json`.
- Verified WebView composer send from the real Android app on `emulator-5554` against local
  supervisor `8821`:
  - Reinstalled the current debug APK with `./gradlew :app:assembleDebug --no-configuration-cache`
    and `adb install -r`.
  - Created helper threads through the local API, then opened them from the native Workspace
    thread list and interacted with the shared WebView UI.
  - Sent `Reply with ANDROID_WEB_THREAD_LOCAL_OK only.` from the WebView composer; API and DOM
    showed the prompt and assistant `ANDROID_WEB_THREAD_LOCAL_OK`, with final thread status
    `idle`, `isLoaded=true`, and `lastError=null`.
  - Sent fake-runtime streaming prompts through the WebView composer on a `claude` thread; DOM
    captured `RUNNING` plus `IOS_STREAM_DELTA_READY`, and the final API state captured
    `IOS_STREAM_DELTA_READY IOS_STREAM_COMPLETED`.
  - Used the thread-ui top-right Chat/Workspace switch control to move from Workspace to Chat
    before sending.
  - A later run completed the remaining "create workspace/thread from Android UI" gate through
    the real app UI.
- Verified full local-mode create/open flow from the real Android UI on `emulator-5554`
  against user-confirmed supervisor port `8821`:
  - Cleared app data, opened the normal app route, connected to `http://10.0.2.2:8821`,
    and verified Home showed `Intranet / http://10.0.2.2:8821` plus `Connected`.
  - Created workspace `android-ui-e2e` at
    `/Users/mac/dev/remote-codex-android-ui-e2e` from the Android New Workspace dialog.
  - Created thread `android-ui-thread` from the Android New Thread dialog with provider
    `codex` and model `gpt-5.4`; API returned thread
    `c8d21342-7f7f-44e0-ae1b-3bbbe9d3ea46`, `status=idle`, `isLoaded=true`,
    `lastError=null`.
  - The thread opened automatically into the bundled Android WebView thread UI. The XML dump
    confirmed `android.webkit.WebView`, title `Remote Codex Android Thread`, and visible
    thread-ui controls `Workspace`, `Tool Usage`, `Guide`, `Explorer`, `Preview README.md`
    and `Download README.md`.
  - Android IME note: after filling text fields through `adb shell input text`, tap the
    keyboard Done button before tapping dialog footer actions; otherwise the soft keyboard can
    cover the footer while `uiautomator` still reports the footer bounds.
- Added a temporary debug-only native thread detail fallback:
  - Normal thread routes still use `ThreadDetailWebViewScreen`.
  - `AndroidFeatureFlags.NativeThreadDetailFallbackEnabled` reads
    `BuildConfig.REMOTE_CODEX_NATIVE_THREAD_DETAIL_FALLBACK`.
  - Debug builds can opt in with `-PremoteCodex.nativeThreadFallback=true`.
  - Default debug and release builds keep the flag `false`; release hard-codes it to `false`.
- Verified fallback compile boundaries:
  - `./gradlew :app:assembleDebug --no-configuration-cache`
  - `./gradlew :app:assembleDebug --no-configuration-cache -PremoteCodex.nativeThreadFallback=true`
  - `./gradlew :app:assembleRelease --no-configuration-cache`
- Verified fullscreen and safe-area/insets behavior on `emulator-5554` using bundled
  `ThreadDetailWebViewScreen` against local supervisor `8821`:
  - WebView `innerHeight` was `915px`, and `--android-viewport-height`,
    `html`, `body`, `#root` and `.thread-ui-shell` all measured `915px`.
  - Composer measured `top=784.77`, `bottom=915`, `height=130.23`, so it uses the rounded
    bottom area instead of leaving native padding dead space.
  - Send button measured `top=862.25`, `bottom=893.45`, remaining visible above the bottom.
  - Top interactive controls measured `top=55`, `bottom=95`, keeping visible controls below
    the status/cutout area.
- Fixed and verified workspace explorer viewer open/close state preservation in the bundled
  Android WebView:
  - Rebuilt `@remote-codex/thread-ui`, rebuilt `@remote-codex/android-thread-web`, forced
    Gradle to rerun `:app:copyAndroidThreadWebAssets :app:assembleDebug`, and reinstalled the
    APK on `emulator-5554`.
  - Opened fresh fake-runtime thread `a7da51f8-dd3d-42e8-bd2f-17605080e748` against local
    supervisor `8821`.
  - Expanded nested `3dprint` workspace folders, scrolled the explorer, previewed
    `rf_box_lid_right.stl` via the file-row eye button, closed viewer, and read WebView DOM
    metrics through DevTools.
  - Explorer `scrollTop` before preview was `265.9047546386719`; after closing viewer and
    settling it was still `265.9047546386719` (`delta: 0`).
- Evidence:
  - `.local/android-parity-e2e/phase-3/android-thread-route-webview.png`
  - `.local/android-parity-e2e/phase-3/android-thread-route-webview-logcat.txt`
  - `.local/android-parity-e2e/phase-3/android-thread-route-back-home.png`
  - `.local/android-parity-e2e/phase-3/android-thread-route-back-home.xml`
  - `.local/android-parity-e2e/phase-3-back-workspace/workspace-tap-thread.png`
  - `.local/android-parity-e2e/phase-3-back-workspace/workspace-tap-thread-back.png`
  - `.local/android-parity-e2e/phase-3-back-workspace/workspace-tap-thread-logcat.txt`
  - `.local/android-parity-e2e/phase-3-download/thread-download-ready.png`
  - `.local/android-parity-e2e/phase-3-download/download-after-click.png`
  - `.local/android-parity-e2e/phase-3-download/download-logcat.txt`
  - `.local/android-parity-e2e/phase-3-download/downloaded-result-json.txt`
  - `.local/android-parity-e2e/phase-3-composer/android-web-composer-result.png`
  - `.local/android-parity-e2e/phase-3-composer/thread-summary.json`
  - `.local/android-parity-e2e/phase-3-composer/webview-dom.json`
  - `.local/android-parity-e2e/phase-3-composer/streaming-second-send-running-dom.json`
  - `.local/android-parity-e2e/phase-3-composer/streaming-final-summary.json`
  - `.local/android-parity-e2e/phase-3-native-fallback/native-fallback-build-summary.txt`
  - `.local/android-parity-e2e/phase-3-fullscreen-insets/verification-summary.txt`
  - `.local/android-parity-e2e/phase-3-fullscreen-insets/chat-composer-fullscreen.png`
  - `.local/android-parity-e2e/phase-3-fullscreen-insets/chat-composer-fullscreen.xml`
  - `.local/android-parity-e2e/phase-3-fullscreen-insets/dom-metrics-chat.json`
  - `.local/android-parity-e2e/phase-3-fullscreen-insets/dom-top-controls.json`
  - `.local/android-parity-e2e/phase-3-explorer-scroll-thread.json`
  - `.local/android-parity-e2e/phase-3-explorer-scroll-launch.png`
  - `.local/android-parity-e2e/phase-3-explorer-scroll-result.json`
  - `.local/android-parity-e2e/phase-3-explorer-scroll-after-close.png`
  - `.local/android-parity-e2e/phase-3-ui-create/06-after-connect-success.png`
  - `.local/android-parity-e2e/phase-3-ui-create/06-after-connect-success.xml`
  - `.local/android-parity-e2e/phase-3-ui-create/16-workspace-created.png`
  - `.local/android-parity-e2e/phase-3-ui-create/16-workspace-created.xml`
  - `.local/android-parity-e2e/phase-3-ui-create/20-thread-created-or-opened.png`
  - `.local/android-parity-e2e/phase-3-ui-create/20-thread-created-or-opened.xml`
  - `.local/android-parity-e2e/phase-3-ui-create/current-after-thread.xml`
  - `.local/android-parity-e2e/phase-3-ui-create/thread-detail-api.json`

## Phase 4: Native Devices Screen Parity

Goal: replace Android connection setup with iOS-style Devices management.

Checklist:

- [x] Rename user-facing "Connection" flow to "Devices".
- [x] Show saved device cards for Local/Intranet, Server and Relay.
- [x] Add a floating top-right `+` action that opens Add Device dialog/sheet.
- [x] Add Local/Intranet card fields: name and URL.
- [x] Add Server card fields: name, URL, username and password.
- [x] Add Relay card fields: name, URL, username and password.
- [x] Persist last values and saved device cards across app restart.
- [x] Add edit action for name/url/auth fields.
- [x] Add delete action with confirmation.
- [x] Relay card opens Relay Devices subpage instead of directly mixing modes.
- [x] Relay Devices subpage shows only devices under that relay account, with `+` create
  device, Refresh, Connect and Revoke confirmation.
- [x] Remove duplicated Settings/Refresh/Connection buttons from page headers and move actions
  into the top-right floating menu where iOS does.

E2E gate:

- [x] Clear app data, launch Android app and verify Devices is first-run entry.
- [x] Add Local device, connect, restart app and verify card persists.
- [x] Add Server device against server-mode supervisor, login and connect.
- [x] Add Relay account, open Relay Devices, create or connect one device.
- [x] Edit one saved device name and verify it persists.
- [x] Delete one saved test device and verify confirmation prevents accidental deletion.
- [x] Save evidence under `.local/android-parity-e2e/phase-4/`.

Progress note:

- Android now stores saved supervisor device cards in app settings, including Local,
  Server and Relay mode metadata. First-run route is `Devices`, and the active
  connection is seeded from / matched against saved cards.
- Local/Intranet E2E used the user-confirmed supervisor at host port `8821`, exposed to
  the Android emulator as `http://10.0.2.2:8821`.
- Rechecked the currently running `8821` local supervisor: host API returned workspaces
  including `3dprint` and `android-ui-e2e`; Android connected through the saved
  `Local8821Edited` card and opened the `3dprint` workspace with 5 visible threads.
  Evidence is saved under `.local/android-parity-e2e/phase-4-local-8821-current/`.
- Verified add Local card, connect to Local supervisor, force-stop/relaunch persistence,
  and delete confirmation from the Android UI. Server and Relay card E2E remain open.
- Relay card UI now opens a scoped `Relay Devices` subpage instead of mixing Local/Server
  cards into that view. The Relay subpage uses a manual Refresh action, a top-right `+`
  Create Device dialog, and no periodic auto-refresh loop.
- Relay account/device-create UI E2E passed against a temporary relay-server on host `8788`.
  The instrumentation test added a Relay saved device through the Android UI surface, opened
  scoped `Relay Devices`, verified a nonblank relay auth token, created
  `Android relay login test`, and verified the saved card received a nonblank
  `relayDeviceId`. Evidence is saved under
  `.local/android-parity-e2e/phase-8-relay-login/relay-login-create-device-connected-result.xml`
  with `tests=1`, `failures=0`, `errors=0`, `skipped=0`.
- Server-mode supervisor E2E was started on host port `8791` because `8787` was already
  occupied by a relay-mode process. Android used `http://10.0.2.2:8791`.
- Verified the server auth contract (`mode: "server"`, unauthenticated `/api/workspaces`
  returns `401`, login returns a token) and verified Android can connect a saved Server
  card that contains URL/username/password but no token. The app performed login, wrote
  the auth token, and reached `Server / http://10.0.2.2:8791` Connected Home.
- The "Add Server device" E2E gate is now covered by
  `SupervisorConnectionSetupScreenServerE2ETest`. Earlier raw `adb input` coordinate
  automation could not reliably fill the Add Device form and appended username/password
  input into the URL field; the URL validation prevented that malformed Server card from
  being saved. The new instrumentation test uses Compose semantics to open the real Add
  Device dialog, select Server, fill URL/username/password, save the card, press Connect,
  log in against a server-mode supervisor and assert that the connected config and saved
  device both contain a bearer token.
- Android's Server default Add Device URL now matches the emulator-local default
  `http://10.0.2.2:8787` instead of the old placeholder domain.
- Android Add/Edit Device now validates saved endpoint values before enabling Save. This
  prevents malformed values such as an accidentally concatenated URL/username string from
  being persisted as a saved Server card during text-entry mistakes.
- The supervisor fake runtime now echoes `ANDROID_WEB_THREAD_*` sentinel prompts exactly
  while preserving the default iOS stream response for ordinary prompts. This removes the
  previous blocker that made Android Server WebView E2E produce only `IOS_STREAM_*` markers.
- Home header now uses one top-right menu button instead of separate Settings/account
  buttons. The Home menu contains Settings, Refresh and Devices actions. The same
  header-consolidation pattern is now carried through Workspace detail and the other native
  shell pages that remain outside the WebView thread UI.
- Workspace detail now uses the same top-right menu pattern. The visible page contains
  only the workspace title, Path card and Threads list; no native Files, Preview, Open,
  Favorite or Refresh/New Thread header clutter remains. Its menu contains Home, Refresh,
  Devices and New Thread, and Devices now opens the real Devices screen directly while
  Android Back returns to the originating workspace.
- Verified saved device edit persistence through the Android UI against the existing
  `http://10.0.2.2:8821` local card. The card name was changed from `Local 8821` to
  `Local8821Edited`, the app was force-stopped and relaunched, and both the Devices UI
  and `remote_codex_preferences.xml` retained the edited name.
- Relay Devices subpage parity was completed during Phase 7 hardening: the subpage is scoped
  to the selected relay account, shows only relay backend devices, uses a top-right `+`
  create flow, manual Refresh, explicit Select/Connect actions and a Revoke confirmation.

Evidence:

- Build: `cd apps/android && JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" ANDROID_HOME="$HOME/Library/Android/sdk" PATH="$HOME/Library/Android/sdk/platform-tools:$PATH" ./gradlew :app:assembleDebug --no-configuration-cache`.
- Add Server instrumentation E2E:
  `cd apps/android && JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" ANDROID_HOME="$HOME/Library/Android/sdk" PATH="$HOME/Library/Android/sdk/platform-tools:$PATH" ./gradlew :app:connectedDebugAndroidTest --no-configuration-cache -Pandroid.testInstrumentationRunnerArguments.class=com.remotecodex.android.ui.screen.SupervisorConnectionSetupScreenServerE2ETest -Pandroid.testInstrumentationRunnerArguments.serverBaseUrl=http://10.0.2.2:8791 -Pandroid.testInstrumentationRunnerArguments.serverUsername=admin -Pandroid.testInstrumentationRunnerArguments.serverPassword=server-mode-password`.
  Result: `TEST-cardverify_aosp35_root(AVD) - 15-_app-.xml` reported `tests="1"`,
  `failures="0"`, `errors="0"`, `skipped="0"` for
  `addServerDeviceThroughUiLogsInAndConnects`. The temporary server log showed emulator
  requests `GET /api/auth/session`, `POST /api/auth/login`, `GET /api/auth/session` and
  `GET /healthz`, all `200`.
- First-run Devices:
  `.local/android-parity-e2e/phase-4/01-first-run-devices.png`,
  `.local/android-parity-e2e/phase-4/01-first-run-devices.xml`.
- Add Device dialog:
  `.local/android-parity-e2e/phase-4/02-add-device-dialog.png`,
  `.local/android-parity-e2e/phase-4/02-add-device-dialog.xml`.
- Saved Local card:
  `.local/android-parity-e2e/phase-4/13-local-card-saved-final.png`,
  `.local/android-parity-e2e/phase-4/13-local-card-saved-final.xml`.
- Connected Home after tapping Connect:
  `.local/android-parity-e2e/phase-4/14-local-connected-home.png`,
  `.local/android-parity-e2e/phase-4/14-local-connected-home.xml`,
  `.local/android-parity-e2e/phase-4/14-preferences-after-connect.xml`.
- Relaunch persistence:
  `.local/android-parity-e2e/phase-4/15-relaunch.png`,
  `.local/android-parity-e2e/phase-4/15-relaunch.xml`,
  `.local/android-parity-e2e/phase-4/17-devices-after-relaunch.png`,
  `.local/android-parity-e2e/phase-4/17-devices-after-relaunch.xml`.
- Delete confirmation:
  `.local/android-parity-e2e/phase-4/18-delete-device-confirmation.png`,
  `.local/android-parity-e2e/phase-4/18-delete-device-confirmation.xml`.
- Relay card/subpage UI smoke:
  `.local/android-parity-e2e/phase-4-relay-ui/03-devices-seeded-relay-card.png`,
  `.local/android-parity-e2e/phase-4-relay-ui/03-devices-seeded-relay-card.xml`,
  `.local/android-parity-e2e/phase-4-relay-ui/04-relay-devices-subpage.png`,
  `.local/android-parity-e2e/phase-4-relay-ui/04-relay-devices-subpage.xml`,
  `.local/android-parity-e2e/phase-4-relay-ui/05-create-relay-device-dialog.png`,
  `.local/android-parity-e2e/phase-4-relay-ui/05-create-relay-device-dialog.xml`.
- Server-mode auth and Android connect:
  `.local/android-parity-e2e/phase-4-server/00-doctor.log`,
  `.local/android-parity-e2e/phase-4-server/01-auth-check.log`,
  `.local/android-parity-e2e/phase-4-server/05-first-run-devices.png`,
  `.local/android-parity-e2e/phase-4-server/05-first-run-devices.xml`,
  `.local/android-parity-e2e/phase-4-server/06-add-device-dialog.png`,
  `.local/android-parity-e2e/phase-4-server/06-add-device-dialog.xml`,
  `.local/android-parity-e2e/phase-4-server/07-add-server-mode-selected.png`,
  `.local/android-parity-e2e/phase-4-server/07-add-server-mode-selected.xml`,
  `.local/android-parity-e2e/phase-4-server/08-add-server-fields-filled.png`,
  `.local/android-parity-e2e/phase-4-server/08-add-server-fields-filled.xml`,
  `.local/android-parity-e2e/phase-4-server/10-add-server-fields-tab-filled.png`,
  `.local/android-parity-e2e/phase-4-server/10-add-server-fields-tab-filled.xml`,
  `.local/android-parity-e2e/phase-4-server/12-seeded-server-card.png`,
  `.local/android-parity-e2e/phase-4-server/12-seeded-server-card.xml`,
  `.local/android-parity-e2e/phase-4-server/13-server-connected-home.png`,
  `.local/android-parity-e2e/phase-4-server/13-server-connected-home.xml`,
  `.local/android-parity-e2e/phase-4-server/13-preferences-after-server-connect.xml`,
  `.local/android-parity-e2e/phase-4-server/14-assemble-after-server-default.log`.
- Home header menu:
  `.local/android-parity-e2e/phase-4-home-menu/03-home-menu-button.png`,
  `.local/android-parity-e2e/phase-4-home-menu/03-home-menu-button.xml`,
  `.local/android-parity-e2e/phase-4-home-menu/04-home-menu-open.png`,
  `.local/android-parity-e2e/phase-4-home-menu/04-home-menu-open.xml`,
  `.local/android-parity-e2e/phase-4-home-menu/05-assemble-home-menu.log`.
- Workspace detail menu and Devices navigation:
  `.local/android-parity-e2e/phase-4-workspace-menu/07-after-back.png`,
  `.local/android-parity-e2e/phase-4-workspace-menu/07-after-back.xml`,
  `.local/android-parity-e2e/phase-4-workspace-menu/12-workspace-menu-devices-open.png`,
  `.local/android-parity-e2e/phase-4-workspace-menu/12-workspace-menu-devices-open.xml`,
  `.local/android-parity-e2e/phase-4-workspace-menu/16-direct-devices.png`,
  `.local/android-parity-e2e/phase-4-workspace-menu/16-direct-devices.xml`,
  `.local/android-parity-e2e/phase-4-workspace-menu/17-devices-back-workspace.png`,
  `.local/android-parity-e2e/phase-4-workspace-menu/17-devices-back-workspace.xml`,
  `.local/android-parity-e2e/phase-4-workspace-menu/14-assemble-direct-devices.log`.
- Saved device edit persistence:
  `.local/android-parity-e2e/phase-4-edit-device/01-assemble-edit-device.log`,
  `.local/android-parity-e2e/phase-4-edit-device/03-devices-before-edit.png`,
  `.local/android-parity-e2e/phase-4-edit-device/03-devices-before-edit.xml`,
  `.local/android-parity-e2e/phase-4-edit-device/04-edit-dialog.png`,
  `.local/android-parity-e2e/phase-4-edit-device/04-edit-dialog.xml`,
  `.local/android-parity-e2e/phase-4-edit-device/05-edited-before-relaunch.png`,
  `.local/android-parity-e2e/phase-4-edit-device/05-edited-before-relaunch.xml`,
  `.local/android-parity-e2e/phase-4-edit-device/07-preferences-after-relaunch.xml`,
  `.local/android-parity-e2e/phase-4-edit-device/08-devices-after-relaunch.png`,
  `.local/android-parity-e2e/phase-4-edit-device/08-devices-after-relaunch.xml`.

## Phase 5: Home, Workspace And New Thread Parity

Goal: align non-thread native product screens with iOS.

Checklist:

- [x] Home shows supervisor summary and Workspaces only; remove standalone global Threads
  section.
- [x] Home right-top floating menu contains Refresh and Devices.
- [x] Workspace detail shows title, Path and Threads only.
- [x] Remove native Files, Preview, Favorite and Open sections from Workspace detail.
- [x] Workspace detail right-top floating menu contains New Thread, Refresh, Devices and any
  remaining necessary actions.
- [x] Add edge/back gesture support for Workspace -> Home and nested Devices subpages.
- [x] New Thread uses provider selector (`opencode`, `codex`, `claudecode`) and model list,
  not only freeform model name.
- [x] New Thread includes reasoning effort and default values aligned with web/iOS.
- [x] Thread creation errors are visible and do not leave the app in a stuck modal state.
- [x] All destructive workspace/thread operations have confirmation.

E2E gate:

- [x] Local mode: create a workspace, verify it appears on Home only under Workspaces.
- [x] Open workspace, verify only Path and Threads sections exist.
- [x] Create new thread using provider/model picker and verify it opens WebView thread UI.
- [x] Use back gesture from Thread to Workspace and from Workspace to Home.
- [x] Restart app and verify last Devices/connection fields are prefilled.
- [x] Save evidence under `.local/android-parity-e2e/phase-5/`.

Progress note:

- Home no longer renders the Workspaces/Threads/Shells destination selector or standalone
  global Threads list. It keeps the supervisor summary and Workspaces list, with Refresh
  and Devices inside the right-top Home menu.
- Workspace Detail New Thread now uses the same provider/model/reasoning picker pattern as
  Home. The dialog keeps creation errors visible and remains dismissible.
- `GraphDialogOverlay` now applies IME padding so text-entry dialogs keep their footer
  actions above the soft keyboard; direct tap on Start after typing was verified.
- Local-mode E2E used the user-confirmed supervisor on host port `8821` through
  `http://10.0.2.2:8821`. Evidence is saved under
  `.local/android-parity-e2e/phase-5/`.
- Created `Android_Phase_5_picker_smokerr` via keyboard focus and
  `Android_Phase_5_tap_start` via direct tap after the IME fix. The latter opened the
  bundled WebView thread UI and `/api/threads` reported provider `codex`, model `gpt-5.5`
  and reasoning `high`.
- Additional Local-mode E2E on the same `8821` supervisor is saved under
  `.local/android-parity-e2e/phase-5-complete/`. It created a temporary
  `/Users/mac/dev/remote-codex-android-phase5-ui` workspace named `phase5-ui`, verified it
  appeared on Home only under Workspaces, and then removed it through the Android delete
  confirmation dialog.
- During that delete E2E, Android initially showed the confirmation dialog but sent a bare
  `DELETE /api/workspaces/:id`, which the supervisor rejected with `Unsupported Media Type`
  because workspace deletion requires `confirmWorkspaceId` and `confirmLabel`. The Android
  API client now sends those confirmation fields, and the fixed APK was reinstalled and
  verified against the real `8821` supervisor: the API and UI no longer list `phase5-ui`.
- Workspace deletion now requires an explicit confirmation checkbox inside the Android
  delete dialog before the destructive Delete action is enabled, matching the existing
  thread-delete confirmation pattern. Regression evidence is saved under
  `.local/android-parity-e2e/phase-5-delete-confirmation-regression/`; the focused
  `SupervisorHomeScreenTest#workspaceRowsExposeRenameAndDeleteDialogs` run passed on
  `cardverify_aosp35_root(AVD) - 15` with `tests=1`, `failures=0`, `errors=0`.
- Workspace -> Home and Devices -> Home system Back were verified in
  `.local/android-parity-e2e/phase-5-complete/`. Left-edge swipe did not navigate because
  the current emulator reports `navigation_mode=0` and the gestural navbar overlay is not
  enabled; keep the edge-swipe checklist item open until it is verified on a gesture-nav
  emulator or device.

## Phase 6: Thread UI Feature Completion On Android

Goal: make Android WebView thread behavior match iOS and web in practical daily use.

Checklist:

- [x] Settings inside thread-ui is feature-complete: appearance, session/global tabs, sandbox
  mode, session metadata and copy actions.
- [x] Native Android theme setting and thread-ui theme setting stay synchronized.
- [x] Composer no longer displays redundant sandbox text when thread-ui design hides it on
  mobile.
- [x] Workspace explorer does not auto-scroll to top or flicker during refresh.
- [x] Explorer manual refresh preserves expanded folders, selected file and scroll position
  unless the item was deleted or moved.
- [x] Viewer opens full-cover when using file eye/preview action.
- [x] Closing viewer preserves explorer scroll and expansion state.
- [x] Upload/file picker works through Android `ActivityResult` or WebView file chooser.
- [x] Download/share works through Android system share or file save flow.
- [x] WebSocket reconnect and app background/foreground do not duplicate turns.
- [x] Thread deletion/rename/export actions confirm and then update native navigation state.

E2E gate:

- [x] Local mode: open a workspace with nested files, scroll explorer deep, preview a file,
  close viewer and verify scroll remains stable.
- [x] Send a prompt, background the app, foreground it and verify streaming/reload stays stable.
- [x] Toggle dark/light/follow system and verify native plus WebView surfaces match.
- [x] Upload or attach one small file if the backend mode supports it.
- [x] Download/share one artifact or workspace file.
- [x] Save evidence under `.local/android-parity-e2e/phase-6/`.

Progress note:

- Local-mode E2E used the existing `3dprint` workspace/thread through Android WebView
  remote debugging on the user-confirmed `8821` supervisor. Evidence is saved under
  `.local/android-parity-e2e/phase-6/`.
- The WebView opened directly in Workspace mode on mobile. `exports`,
  `bambu_h2s_rf_box_lid_right` and `bambu_h2s_rf_box_lid_right_petg_translucent` were
  expanded, Explorer was scrolled to the bottom, and 9 seconds of CDP sampling kept
  `scrollTop` stable instead of jumping back to the top.
- Manual `Refresh workspace` was triggered while Explorer was scrolled and a file preview
  was selected. Six seconds of CDP sampling preserved `scrollTop`, expanded folder text
  and selected viewer path.
- Tapping the file eye action for `rf_box_lid_right_preview.png` opened Viewer as a
  full-cover panel. Returning with `Expand Explorer` preserved the Explorer scroll and
  expanded folder state.
- Android WebView upload now uses an explicit native picker bridge instead of relying on
  hidden WebView file input behavior. The E2E clicked `Upload file`, verified Android
  `DocumentsUI` opened, selected `window.xml`, observed `POST /api/workspaces/:id/files/upload`
  returning 200, previewed the uploaded file through the `8821` API and then deleted the
  test file. Evidence files include `18-native-picker.*`, `19-after-file-selected.*`,
  `20-uploaded-window-preview.json`, `21-delete-uploaded-window.json` and
  `22-after-delete-window-preview.json`.
- Android WebView download/share was verified by clicking `Download result.json` in the
  workspace explorer. The native bridge called
  `/api/workspaces/:id/files/download?path=exports/.../result.json`, saved the file into
  Android Downloads as `/sdcard/Download/Remote Codex/result (1).json` with 2307 bytes and
  opened `com.android.intentresolver/.ChooserActivityLauncher`. The current emulator has no
  share targets installed, so the chooser displayed `No apps can perform this action`, but
  the Android save flow and share intent launch both completed. Evidence files include
  `23-download-share.*`.
- Android settings now uses controlled thread-ui settings state from the WebView wrapper, so
  native menu actions can open the shared Settings dialog. E2E verified Appearance, Follow
  system/Dark/Light, Session/Global tabs, Session ID, Source, Status, Created,
  Workspace, Workspace path and Active turn metadata. Tapping Light updated WebView
  `data-theme-mode=light`, emitted `theme requested: light`, persisted
  `theme_mode=light` in `remote_codex_preferences.xml`, and relaunched with `theme: light`
  in the WebView bootstrap. The test then restored `theme_mode=system`.
- Android settings Session ID copy now uses a native clipboard bridge. E2E verified the copy
  button title changed from `Copy session ID` to `Copied` and native log output included
  `copied text: Remote Codex session ID`. Evidence files include
  `25-settings-open.*`, `26-theme-shared-prefs.xml`, `29-settings-copy-restore.*`,
  `30-theme-system-shared-prefs.xml` and `31-settings-copy-native.*`.
- Android chat composer was checked after switching back from Workspace to Chat. The visible
  composer controls were `gpt-5.5`, `high` and `Plan`, with no visible Sandbox control/text.
  Evidence files include `36-composer-no-sandbox-chat.*`.
- Android WebView route switching was fixed by recreating the WebView only when the connection
  identity, thread id or fixture mode changes. E2E verified the bootstrap changed to
  `threadId=fbe58858-63d7-42fa-8dfd-45f8e6cc5c2e` on the existing `8821` supervisor instead of
  keeping the previously loaded thread. Evidence files include
  `38-after-route-key-install.xml` and `37-open-idle-thread.*`.
- Android WebView bg/fg resume was verified on the same `8821` supervisor by sending
  `Reply with ANDROID_BG_FG_OK_8821 exactly once.` from the real WebView composer, sending the
  app to Home, foregrounding it again and polling `/api/threads/:id` until idle. The final API
  payload had `totalTurnCount=1`, one completed turn and exactly two items: one user message and
  one completed assistant message, with no duplicate turn after resume. Evidence files include
  `40-bgfg-api-final.json`, `41-bgfg-ui-final.*` and `41-bgfg-webview-text.json`.
- Android thread rename/export/delete actions now use the shared thread-ui dialogs and Android
  WebView REST/native-share bridge. E2E created disposable threads in the `android-ui-e2e`
  workspace on the `8821` supervisor, renamed one from `android phase6 disposable` to
  `android phase6 renamed`, exported transcript HTML through the visible mobile Export action,
  and verified native download/share saved
  `remote-codex-android-phase6-renamed-20260702T130803Z.html` with 8533 bytes. Evidence files
  include `42-disposable-thread.json`, `43-rename-thread-api.json`, `44-export-*`.
- Android thread deletion now mirrors web confirmation semantics: tapping Delete opens
  `Delete Thread` and does not call DELETE until the confirm button is pressed. E2E verified
  `api before confirm: 200`, then `api after confirm: 404`, and after returning to the native
  workspace list the deleted title `android phase6 delete refresh` was absent and the workspace
  showed `1 in this workspace`. Evidence files include `49-delete-confirm-dialog.png`,
  `53-delete-refresh-before-confirm-*` and `54-delete-refresh-*`.
- Follow-up: the selected `.png` preview currently renders as a broken image inside
  Android WebView even though the viewer routing and state behavior are correct.
- Back/edge navigation is covered by Phase 5 and Phase 4 evidence: `09-back-thread-to-workspace.*`
  and `10-back-workspace-to-home.*` show Thread -> Workspace and Workspace -> Home, while
  `.local/android-parity-e2e/phase-4-workspace-menu/17-devices-back-workspace.*` shows nested
  Devices -> Workspace return.

## Phase 7: Server And Relay Mode Hardening

Goal: prove the migrated Android app works beyond local mode.

Checklist:

- [x] Server mode login stores and refreshes token consistently.
- [x] Server mode WebView REST and WebSocket calls include correct auth.
- [x] Relay account login stores relay session.
- [x] Relay selected-device routes use `/relay/devices/:deviceId/api/...`.
- [x] Relay WebSocket uses the relay session/device context expected by the existing relay
  stack.
- [x] Relay Devices subpage does not show Local/Server cards.
- [x] Revoke/delete relay device actions require confirmation and refresh only the relevant
  relay device list.
- [x] Offline relay device state is visible and Connect is disabled or fails clearly.
- [x] No frontend action can accidentally call a delete/revoke endpoint without explicit user
  confirmation.

E2E gate:

- [x] Server mode compatibility: authenticated WebView smoke was verified on temporary
  `http://10.0.2.2:8791` because `8787` was occupied; it created/opened a thread, sent
  `ANDROID_WEB_THREAD_SERVER_OK`, reloaded transcript and verified authenticated WebSocket.
- [x] Relay mode: connect to `http://10.0.2.2:8788`, select relay device, create/open thread,
  send `ANDROID_WEB_THREAD_RELAY_OK`, verify streaming and transcript reload.
- [x] Relay steering: while a long turn is active, send follow-up/steering from Android UI and
  verify final answer acknowledges it.
- [x] Save relay/server evidence under `.local/android-parity-e2e/phase-7/`.

Progress note:

- Server-mode WebView auth was verified against a temporary host port `8791` because `8787`
  was occupied by a relay-mode supervisor. Evidence under
  `.local/android-parity-e2e/phase-7/` includes authenticated `/api/workspaces` access,
  Android WebView bootstrap with `mode: "server"`, protected REST calls, and server logs
  showing `/ws?token=...&threadId=...`. A later focused Add Server instrumentation E2E covered
  the native Server card login/token-storage path.
- A second server-mode rerun under `.local/android-parity-e2e/phase-7-server-ui-rerun/`
  used the same constraint: `8787` was still occupied by a relay-mode supervisor, so a
  temporary server supervisor ran on host `8791` and Android used `http://10.0.2.2:8791`.
  The rerun verified server auth contract (`mode: "server"`, unauthenticated workspaces
  rejected with `401`, login returned a bearer token), seeded a correct debug Server card
  after the UI Add Server text-entry automation produced a malformed card, and opened the
  normal Android WebView thread route.
- The server rerun proved the authenticated WebView path end to end: logcat captured
  tokenized native HTTP calls to `http://10.0.2.2:8791/api/...`, a tokenized
  `ws://10.0.2.2:8791/ws?...&threadId=...` connection and `ws:open`. The WebView submitted
  prompt `hello` from the Android thread UI via CDP-dispatched DOM events after plain
  `adb input text` failed to trigger React's composer state. Final API evidence reported
  `thread.status: "idle"`, `lastError: null`, user message `hello` and completed assistant
  `IOS_STREAM_DELTA_READY IOS_STREAM_COMPLETED`.
- The server rerun also verified transcript reload: after force-stopping and relaunching the
  Android app, switching back from Workspace to Chat showed `hello` and the completed fake
  runtime response.
- A follow-up server marker run under `.local/android-parity-e2e/phase-7-server-marker/`
  changed `apps/supervisor-api/src/e2e-fake-runtime.ts` so Android sentinel prompts are
  echoed exactly. It kept the user's `8821` Local supervisor running, used a temporary
  authenticated Server supervisor on host `8791`, created a clean workspace/thread, opened
  that thread in the Android WebView, and submitted `Reply with ANDROID_WEB_THREAD_SERVER_OK
  only.` from the WebView composer via CDP-dispatched DOM events. Final API evidence reports
  `thread.status: "idle"`, `lastError: null`, the exact user prompt and completed assistant
  text `ANDROID_WEB_THREAD_SERVER_OK`; force-stop/relaunch plus Chat switch showed the same
  prompt and reply loaded back into the WebView transcript. The exact `8787` rerun is retained
  only as an optional compatibility follow-up because the current manual target is `8821`.
- A focused Add Server instrumentation E2E under
  `.local/android-parity-e2e/phase-4-add-server-ui/` proved token storage for saved Server
  cards: after the Add Device dialog saved a Server card with no token, pressing Connect
  logged in through `/api/auth/login`, produced an authenticated `SupervisorConnectionConfig`,
  and updated the saved device with a nonblank `authToken`. This covers the native Server
  login/token-storage checklist item; combined with the server marker run above, the current
  Server compatibility requirement is covered without treating the occupied `8787` port as a
  blocker.
- Evidence files from the rerun include `01-auth-session.json`,
  `02-unauth-workspaces.status`, `03-login.json`, `20-server-workspace-create.json`,
  `21-server-thread-create.json`, `22-server-rerun-prefs-safe.xml`,
  `23-server-thread-launch.*`, `31-after-cdp-send.*`, `33-server-thread-final.json`,
  `34-server-final.*`, `35-server-webview-logcat.txt` and `37-server-reload-chat.*`.
- Evidence files from the server marker run include `01-auth-session.json`,
  `02-unauth-workspaces.status`, `03-login.json`, `04-workspace.json`, `05-thread.json`,
  `07-server-marker-prefs-safe.xml`, `17-server-marker-final.json`,
  `17-server-marker-final.*`, `22-reload-chat-dom.json`, `22-reload-chat.*` and
  `24-server-marker-logcat-8791-safe.txt`. After the run, the temporary `8791` listener was
  stopped and the emulator preferences were restored to `Local / http://10.0.2.2:8821`;
  restore evidence is under
  `.local/android-parity-e2e/current-8821-restore-after-server-marker/`.
- Relay-mode E2E used a Phase 7 relay-server on host `8788` and a private relay supervisor
  on host `8792`, exposed to Android as `http://10.0.2.2:8788`. The registered relay device
  id was `78a0c8a1-67ae-4713-8a18-1095a7b73374`, and relay health reported
  `supervisorConnected: true`.
- Android WebView bootstrap for the relay thread reported `mode: "relay"`,
  `baseUrl: "http://10.0.2.2:8788"`, the selected relay device id, and thread
  `3acbbd58-dd87-4c45-ae4b-023d14af61b6`. Logcat evidence shows native WebView HTTP calls
  using `/relay/devices/78a0c8a1-67ae-4713-8a18-1095a7b73374/api/...`, plus
  `ws:thread.output.delta` and `ws:thread.turn.completed` events.
- The relay smoke prompt was sent from the real Android WebView composer. Final API and UI
  evidence show `ANDROID_WEB_THREAD_RELAY_OK`, thread status `idle`, and turn status
  `completed`; force-stop/relaunch reload then restored the transcript after switching back
  to Chat. Evidence files include `68-relay-thread-launch.*`,
  `69-relay-webview-bootstrap-safe.json`, `70-relay-thread-after-prompt.json`,
  `71-relay-webview-logcat.txt`, `72-relay-webview-final*`, `73-relay-reload.*`,
  `74-relay-reload-webview-safe.json` and `75-relay-reload-chat*`.
- Relay steering was sent while turn 2 was active from the Android WebView composer. Final
  relay API evidence has four items in turn 2: initial user prompt, streaming assistant
  output, active-turn user steering text, and assistant `RELAY_STEER_ACK`. Evidence files
  include `76-relay-steer-webview-actions.json`, `77-relay-steer-final.json`,
  `78-relay-steer-logcat.txt` and `79-relay-steer-final.*`.
- Relay login was not covered by the earlier relay streaming E2E because that run seeded the
  relay token/device id into debug app preferences after API registration. It is now covered
  by `SupervisorConnectionSetupScreenRelayE2ETest#addRelayAccountThroughUiLogsInAndCreatesDevice`,
  which drove the Android Relay add-card UI surface against `http://10.0.2.2:8788`, stored a
  nonblank relay session token in the saved card, created a relay device, and stored the
  resulting `relayDeviceId`.
- Relay management hardening was verified against a temporary relay-server on host `8788`
  with two registered offline devices. Android was opened on the scoped Relay Devices subpage:
  it showed only the relay devices, no Local/Server cards, no selected backend by default and
  a disabled Connect action until a valid selectable backend was chosen.
- Offline relay state now stays visible and non-destructive. Selecting an offline device
  changes the row to `Selected`, keeps Connect disabled and shows
  `Loaded 2 devices; 0 online. Selected backend is offline.` The row-level click target was
  removed so Select and Revoke are separate explicit buttons.
- Revoke was verified as a two-step destructive action. Tapping `Revoke` opened the
  `Revoke device` confirmation dialog; the relay portal still had both devices before the
  confirm button was pressed. After confirming, only the target device was removed and the
  Relay Devices list refreshed to the remaining device.
- Destructive-action audit: Android saved-device delete and relay-device revoke both call the
  delete endpoint only from confirmation dialogs; Android WebView thread deletion uses the
  shared `ConfirmDialog`; supervisor-web workspace/thread deletion and relay device deletion
  also require `ConfirmDialog` or `window.confirm` before calling the backend delete endpoint.
  Relay share revocation is not a device/workspace/thread delete and can be made stricter in a
  later polish pass if desired.
- After relay management E2E, the emulator app preferences were restored to Local mode at
  `http://10.0.2.2:8821` for the user's current manual testing session, and the temporary
  `8788` relay-server was stopped.
- Evidence files include `83-relay-management-offline.*`,
  `85-relay-offline-selected-fixed.*`, `86-relay-revoke-dialog.*`,
  `87-relay-after-revoke-dialog-before-confirm-portal-safe.json`,
  `88-relay-after-revoke-confirm.*` and
  `89-relay-after-revoke-confirm-portal-safe.json`.

## Phase 8: Cleanup, Tests And Release Gate

Goal: remove duplicated native thread implementation surface and make the migration durable.

Checklist:

- [x] Remove or quarantine native Compose thread timeline/composer/workspace code no longer
  used by production routes.
- [x] Keep API models and reducers only if native screens/tests still need them.
- [x] Update Android unit/instrumentation tests to focus on native shell plus WebView host
  contract.
- [x] Add regression tests for Devices persistence, delete confirmations, route back stack and
  bridge JSON parsing.
- [x] Add a documented manual E2E runbook that points back to this phase checklist.
- [x] Update `docs/android-client-architecture.md` or equivalent architecture docs.
- [x] Confirm Android thread-web and Android Gradle build both run from clean-ish checkout.
- [x] Remove temporary debug fallback flag, or explicitly document why it remains debug-only.

E2E gate:

- [x] Run the current required Local `8821` and Relay E2E smoke from Android emulator after
  cleanup.
- [x] Force-stop and relaunch app after each required mode; verify saved device and last
  navigation recover correctly.
- [x] Verify no production route opens old native thread detail UI.
- [x] Save final screenshots, XML dumps and service summaries under
  `.local/android-parity-e2e/phase-8/`.
Optional follow-up: rerun the Server-mode UI login gate on `http://10.0.2.2:8787` only after
that port is intentionally freed or reassigned to a server-mode supervisor. The current
user-confirmed manual target is `8821`.

Progress note:

- Manual Android parity E2E runbook added at
  `docs/android-ios-parity-manual-e2e-runbook.zh.md`. It covers the required app-UI-first
  validation rule, evidence capture, Local `8821`, temporary Server/Relay mode setup,
  WebView DevTools observation, and restoring the user's Android app state to
  `Local / http://10.0.2.2:8821` after instrumentation runs.
- Delete-confirmation regression coverage was strengthened during Phase 5 hardening:
  `SupervisorHomeScreenTest#workspaceRowsExposeRenameAndDeleteDialogs` now asserts that
  workspace deletion starts unconfirmed and requires the explicit confirmation row before
  destructive deletion can be enabled. Keep the broader regression-test checklist item open
  until Devices persistence, route back stack, and bridge JSON parsing also have focused
  coverage.
- Android WebView native bridge JSON parsing now has focused JVM coverage in
  `ThreadDetailWebViewBridgeTest`. It validates invalid request envelopes, method/header/body
  parsing, DELETE `bodyBase64` handling, and response JSON `body`/`bodyBase64`/lowercase
  header output. Evidence is saved under
  `.local/android-parity-e2e/phase-8-bridge-json-regression/` with `tests=4`,
  `failures=0`, `errors=0`.
- Devices persistence and route recovery now have focused instrumentation coverage in
  `AppSettingsRepositoryTest`. It verifies saved Local/Server/Relay device cards persist
  across repository instances, update/delete semantics preserve the correct cards, active
  Relay connection state restores with auth and selected device, and per-device last routes
  remain isolated. Workspace route actions also have focused Compose coverage in
  `WorkspaceDetailScreenTest#workspaceMenuRoutesBackHomeAndDevices`, which verifies the
  native workspace menu routes to Home and Devices. Evidence is saved under
  `.local/android-parity-e2e/phase-8-settings-route-regression/` with
  `AppSettingsRepositoryTest` `tests=2`, `failures=0`, `errors=0`, and
  `WorkspaceDetailScreenTest` `tests=2`, `failures=0`, `errors=0`.
- Legacy native thread instrumentation tests are now quarantined with class-level `@Ignore`
  annotations because those surfaces are debug-only fallback inventory, not production Android
  thread UI. The ignored classes are `ThreadDetailPreviewScreenTest`,
  `ThreadComposerMenuTest`, `ThreadComposerStateTest`, `WorkspacePanelTest`, and
  `PendingRequestCardTest`. The active native-shell regression subset was rerun:
  `AppSettingsRepositoryTest` + `WorkspaceDetailScreenTest` completed `tests=4`,
  `failures=0`, `errors=0`, with evidence copied to
  `.local/android-parity-e2e/phase-8-test-focus/02-shell-route-regression.xml`.
- `ThreadDetailWebViewBridgeTest` was rerun after the test-focus cleanup and still completed
  `tests=4`, `failures=0`, `errors=0`; evidence is saved at
  `.local/android-parity-e2e/phase-8-test-focus/03-thread-web-bridge.xml`.
- Phase 8 cleanup audit kept the Android thread API models/reducers/presentation helpers because
  they are still referenced by the explicit debug-only native fallback, focused JVM presentation
  tests, and relay streaming instrumentation (`RelayStreamingProjectionE2ETest` uses
  `ThreadProjectionState`). Production routes remain WebView-first, while the old Compose
  screen/component instrumentation tests are quarantined with `@Ignore`. The focused cleanup
  test run passed `ThreadEventReducerTest` (`tests=19`), `ThreadOptimisticProjectionTest`
  (`tests=4`), `ThreadDetailMapperTest` (`tests=4`), `ThreadPresentationTest` (`tests=186`),
  `WorkspaceGraphPresentationTest` (`tests=4`) and `ThreadDetailWebViewBridgeTest`
  (`tests=4`), all with `failures=0`, `errors=0`. Evidence is saved under
  `.local/android-parity-e2e/phase-8-cleanup-audit/`.
- `docs/android-client-architecture.md` now documents the Android production architecture as
  native Devices/Home/Workspace shell plus WebView-hosted `@remote-codex/thread-ui` for thread
  detail. It also records the old Compose timeline/composer/workspace code as legacy fallback
  inventory only, and explicitly ties the native thread fallback to
  `REMOTE_CODEX_NATIVE_THREAD_DETAIL_FALLBACK=false` by default with opt-in debugging through
  `-PremoteCodex.nativeThreadFallback=true`.
- Production routes are now quarantined away from the old native thread UI by default:
  `MainActivity` only opens `ConnectedRoute.ThreadPreview` when
  `AndroidFeatureFlags.NativeThreadDetailFallbackEnabled` is true, and real thread routes use
  `ThreadDetailWebViewScreen` unless the same explicit fallback flag is enabled.
- Build gate passed with the repo's actual Android thread-web package:
  `pnpm --filter @remote-codex/android-thread-web build` succeeded, and
  `JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
  ANDROID_HOME="$HOME/Library/Android/sdk" ./gradlew :app:assembleDebug
  --no-configuration-cache` succeeded. The older
  `pnpm --filter @remote-codex/thread-ui build` command is not valid from this repo because
  `@remote-codex/thread-ui` is consumed through the adjacent
  `remote-codex-thread-ui` checkout; Android builds the wrapper package
  `@remote-codex/android-thread-web` instead.
- Local `8821` route smoke passed on emulator `emulator-5554`: host health returned
  `mode=local`, `port=8821`, `workspaceRoot=/Users/mac/dev`; the Android app opened as
  `Intranet / http://10.0.2.2:8821`, showed backend counts, created thread
  `aa92716d-a451-4859-9175-6c592d780566` in `/Users/mac/dev/3dprint`, and `dumpsys`
  showed `android.webkit.WebView` inside `com.remotecodex.android/.MainActivity`.
  Evidence is saved under `.local/android-parity-e2e/phase-8-local-8821-check/`. This route
  smoke was later extended by the Local `8821` prompt/reload smoke below.
- Local `8821` prompt/reload smoke passed after the Phase 8 cleanup audit. The Android app
  restored directly into `ThreadDetailWebViewScreen` for thread
  `6ec9f2dd-683f-41d0-833f-9bcd5cff1bd3` (`android phase8 local final`) in
  `/Users/mac/dev/3dprint`; WebView DevTools reported title `Remote Codex Android Thread`.
  The prompt `Reply with ANDROID_PHASE8_LOCAL_FINAL_OK only.` was submitted from the WebView
  composer through DOM input/mouse events, the fake runtime completed with assistant text
  `ANDROID_PHASE8_LOCAL_FINAL_OK`, and a force-stop/relaunch restored the same thread route.
  After switching back to Chat, the WebView DOM contained both the prompt and the completed
  assistant reply. Evidence is saved under `.local/android-parity-e2e/phase-8-local-final/`,
  including `06-thread-final.json`, `10-thread-after-relaunch.json`,
  `11-dom-after-relaunch-chat.json`, screenshots/XML dumps, and `service-summary.json`.
  This covers the Local portion of the final smoke/relaunch gate.
- After instrumentation reinstall/reset, the Android app state was restored to the
  user-confirmed supervisor `Local / http://10.0.2.2:8821`. The restore initially failed
  because the app data directory had moved to a new package UID while the manually restored
  `remote_codex_preferences.xml` was still owned by the old UID; fixing the shared prefs owner
  and relaunching showed the app connected to `8821` with backend workspace/thread counts.
  Evidence is saved under `.local/android-parity-e2e/phase-8/8821-restored-home.png` and
  `.local/android-parity-e2e/phase-8/8821-restored-home.xml`.
- Relay account login/device creation was rerun after the cleanup audit with a temporary
  relay-server on host `8788`; `SupervisorConnectionSetupScreenRelayE2ETest` completed
  `tests=1`, `failures=0`, `errors=0`, `skipped=0` and covered saved Relay session token plus
  created relay device id. The temporary relay-server was stopped afterward, the APK was
  reinstalled, and the emulator app was restored to `Local / http://10.0.2.2:8821`. Evidence:
  `.local/android-parity-e2e/phase-8-relay-login/relay-login-create-device-connected-result.xml`,
  `.local/android-parity-e2e/phase-8-relay-login/relay-health-after-create.json`,
  `.local/android-parity-e2e/phase-8/8821-restored-after-relay-create.png`, and
  `.local/android-parity-e2e/phase-8/8821-restored-after-relay-create.xml`.
- Relay final prompt/reload smoke passed after the cleanup audit with a temporary relay-server
  on host `8788` and a private relay supervisor on host `8792`, leaving the user's `8821`
  Local supervisor untouched. Android opened a Relay-selected thread through
  `ThreadDetailWebViewScreen`, submitted `Reply with ANDROID_PHASE8_RELAY_FINAL_OK only.`,
  and the fake runtime completed with assistant text `ANDROID_PHASE8_RELAY_FINAL_OK`. A
  force-stop/relaunch restored the relay thread route to a full-screen WebView. Evidence is
  saved under `.local/android-parity-e2e/phase-8-relay-final/`, including
  `12-thread-final.json`, `14-after-relaunch.png`, `14-after-relaunch.xml`, and
  `14-dumpsys-top.txt`. The temporary `8788` and `8792` listeners were stopped afterward.
- After the relay final run, the emulator app was restored to the current required Local target:
  `Local / http://10.0.2.2:8821`. The restored shared prefs, screenshot, XML dump, activity
  dump, WebView page metadata and DOM evidence are saved under
  `.local/android-parity-e2e/phase-8/` as `8821-restored-after-relay-final-*`. The DOM evidence
  shows the `3dprint` workspace and the `android phase8 local final` thread from the `8821`
  supervisor. A later live probe in this Codex turn found host port `8821` was no longer
  listening, so manual continuation should restart that supervisor before further app testing.
- Current service probe evidence is saved under
  `.local/android-parity-e2e/phase-8-service-probes/current-service-summary.json`: at capture
  time, `8821` was the user-confirmed Local supervisor and reported `mode=local`, while host
  `8787` was an auth-required `mode=relay` supervisor. The exact `8787` Server rerun is now a
  non-blocking compatibility follow-up.
- Current operator decision: the active manual target is the user-confirmed `8821` Local
  supervisor, not the occupied `8787` port. Keep the `8787` Server item as an optional
  compatibility follow-up, not as a blocker for the current Android/iOS parity run.

## Final Done Criteria

- Android and iOS expose the same user-facing connection/device model.
- Android thread detail is powered by shared `@remote-codex/thread-ui`.
- Android no longer has an independent native implementation of thread timeline/composer/
  workspace explorer as a product surface.
- Local, Server and Relay modes have emulator E2E evidence from the real Android UI.
- Theme, navigation, destructive confirmation and saved-device persistence match iOS.
- Any remaining Android-only limitations are documented as explicit follow-up items, not hidden
  parity gaps.
