# Android iOS Parity Phase 0 Inventory

日期：2026-07-02

本文档是 `docs/android-ios-parity-thread-ui-migration-plan.zh.md` 的 Phase 0
代码级基线。它记录当前 iOS 目标行为、当前 Android 差距、要替换的原生 thread
surface，以及后续 phase 仍需用 emulator 截图/E2E 验证的项目。

## Evidence Sources

- `apps/ios/RemoteCodex/Features/Connection/ConnectionScreen.swift`
- `apps/ios/RemoteCodex/Features/Home/HomeScreen.swift`
- `apps/ios/RemoteCodex/Features/ThreadDetail/ThreadDetailWebViewScreen.swift`
- `apps/ios/WebThread/src/IOSApiClient.ts`
- `apps/ios/WebThread/src/IOSConnection.ts`
- `apps/ios/WebThread/src/IOSNativeBridge.ts`
- `apps/android/app/src/main/java/com/remotecodex/android/MainActivity.kt`
- `apps/android/app/src/main/java/com/remotecodex/android/settings/AppSettingsRepository.kt`
- `apps/android/app/src/main/java/com/remotecodex/android/ui/screen/SupervisorConnectionSetupScreen.kt`
- `apps/android/app/src/main/java/com/remotecodex/android/ui/screen/SupervisorHomeScreen.kt`
- `apps/android/app/src/main/java/com/remotecodex/android/ui/screen/WorkspaceDetailScreen.kt`
- `apps/android/app/src/main/java/com/remotecodex/android/ui/screen/ThreadDetailScreen.kt`
- `apps/android/app/src/main/java/com/remotecodex/android/ui/components/ThreadTopBar.kt`
- `apps/android/app/src/main/java/com/remotecodex/android/ui/components/ThreadComposer.kt`
- `apps/android/app/src/main/java/com/remotecodex/android/ui/components/WorkspacePanel.kt`
- `apps/android/app/src/main/java/com/remotecodex/android/ui/components/ThreadTimelineComponents.kt`

## Current iOS Baseline

- Connection surface has been reshaped into a Devices model:
  - Saved devices are represented by `SavedSupervisorDevice`.
  - Local/Server/Relay can be saved and reconnected as device cards.
  - Relay cards open Relay Devices instead of directly connecting to a supervisor device.
  - Saved devices can be edited and deleted.
  - Relay Devices can be loaded, connected, created and revoked.
- Home screen owns workspace and new-thread workflows:
  - New thread loads agent backends and model options from the supervisor.
  - New thread stores provider and model separately.
  - Home settings include theme, runtime config, workspace settings, plugins and backends.
- Thread detail is already a WebView route:
  - `ThreadDetailWebViewScreen` loads bundled `WebThreadDist/index.html`.
  - Native chrome is hidden; WebView ignores top and bottom safe area.
  - A top-right floating menu exposes Workspace, Home and Devices.
  - Edge swipe returns to workspace level.
  - Swift injects base URL, mode, auth token, relay device id, thread id and theme.
  - Swift bridge supports open thread/workspace, theme changes, sharing exports and attachment
    picker results.
- `apps/ios/WebThread` owns iOS-specific web shell logic:
  - REST path generation supports local/server and relay selected-device forwarding.
  - WebSocket URL generation supports server token and relay session query parameters.
  - Tests cover model options, relay thread detail paths, thread settings, rename/delete,
    pending request response, fork/export, workspace tree/preview/download/upload and image
    asset URL generation.

## Current Android Baseline

- `MainActivity.kt` routes directly to native Compose screens:
  - `SupervisorConnectionSetupScreen`
  - `SupervisorHomeScreen`
  - `WorkspaceDetailScreen`
  - `ThreadDetailScreen`
  - `ThreadDetailPreviewScreen`
- Android still has a single persisted supervisor connection:
  - `AppSettingsRepository` stores one mode/base URL/auth token/relay device id tuple.
  - It does not yet store a list of saved Local/Server/Relay device cards.
  - It does store last route by mode/base URL/relay device id, including thread detail.
- Android connection setup supports Local/Server/Relay but is not yet the iOS Devices model:
  - It has mode selection, server auth, relay auth and relay devices routes.
  - Relay Devices auto-refreshes every 5 seconds.
  - It has create/revoke device flows, but not the iOS card-based saved-device UX.
- Android home is broader than the iOS target:
  - It includes app shell/settings/plugin/runtime behavior.
  - It maintains global thread filter/sort/query state.
  - It is not yet reduced to the iOS-style Workspaces-focused home surface.
- Android workspace detail is not yet aligned with iOS:
  - It has `Mark opened`, `Star` and inline `New Thread` actions.
  - New Thread uses a freeform `modelDraft` with default `gpt-5.4`.
  - It does not yet use provider/model list selection.
  - Workspace detail still presents actions that the iOS parity plan wants removed or moved
    into the floating menu.
- Android thread detail is a large native Compose implementation:
  - It fetches thread bundles, maintains `ThreadProjectionState`, applies WebSocket events and
    optimistic prompt state.
  - It owns composer, timeline, pending requests, settings, workspace panel, shell, upload,
    download, export, fork, rename and delete behavior.
  - This is the main surface to replace with WebView-hosted `@remote-codex/thread-ui`.

## Native Thread UI To Replace Or Deprecate

| Android file | Current role | Target disposition |
| --- | --- | --- |
| `ui/screen/ThreadDetailScreen.kt` | Production thread detail route, API calls, WebSocket, projection and actions | Replace route with `ThreadDetailWebViewScreen`; keep only debug fallback during migration |
| `ui/components/ThreadTopBar.kt` | Native thread title, view switch, settings/menu/actions | Deprecated by shared thread-ui topbar/menu |
| `ui/components/ThreadComposer.kt` | Native prompt composer, model/effort/sandbox controls, attachments | Deprecated by shared thread-ui composer |
| `ui/components/ThreadTimelineComponents.kt` | Native message/timeline rendering | Deprecated by shared thread-ui timeline |
| `ui/components/WorkspacePanel.kt` | Native workspace explorer/viewer inside thread detail | Deprecated by shared thread-ui workspace surface |
| `ui/components/PendingRequestCard.kt` | Native pending approval/question UI | Deprecated by shared thread-ui pending request components |
| `ui/components/ShellPanel.kt` | Native shell panel rendering | Deprecated by shared thread-ui shell/plugin surface unless kept as test fixture |
| `ui/presentation/ThreadDetailMapper.kt` | Maps supervisor DTOs into native preview models | Remove once production route no longer uses native previews |
| `ui/presentation/ThreadPresentation.kt` | Native timeline presentation | Remove once native thread UI is gone |
| `thread/ThreadEventReducer.kt` | Native projection of WebSocket events | Remove or keep only for tests if WebView owns projection |
| `thread/ThreadOptimisticProjection.kt` | Native optimistic prompt state | Remove or keep only for debug fallback |
| `ui/sample/ThreadPreviewSample.kt` | Native preview fixture data | Keep only if Compose previews/tests still need it |

## Native Android Surfaces To Keep And Align

| Android file | Target role |
| --- | --- |
| `MainActivity.kt` | Native routing shell, back stack and WebView route host |
| `settings/AppSettingsRepository.kt` | Theme, saved devices, selected connection and last route persistence |
| `api/SupervisorConnection.kt` | Shared native connection config for local/server/relay |
| `api/SupervisorApiClient.kt` | Native Devices/Home/Workspace API client; WebView may use TypeScript client inside web shell |
| `api/SupervisorEventSocketClient.kt` | Keep only for native shell needs; WebView thread route should own thread WebSocket |
| `ui/screen/SupervisorConnectionSetupScreen.kt` | Replace/reshape into Devices screen |
| `ui/screen/SupervisorHomeScreen.kt` | Align with iOS Workspaces home and floating menu |
| `ui/screen/WorkspaceDetailScreen.kt` | Align with iOS Path + Threads only surface |
| `storage/ExportFileStore.kt` | Reuse for WebView share/download bridge |
| Android Activity Result file pickers | Reuse for WebView upload/attachment bridge |
| `ui/theme/RemoteCodexTheme.kt` and `settings/ThemeMode.kt` | Keep as native theme source and sync to WebView |

## Open Product Decisions

- Saved Server/Relay device cards should persist auth tokens. Persisting plaintext account
  passwords is not required unless a later product decision explicitly asks for password
  re-entry avoidance.
- Android Local default should remain developer-friendly for emulator E2E
  (`http://10.0.2.2:8787`) while user-facing copy can still call the mode Local/Intranet.
- The old native thread UI should be protected behind a debug-only fallback no later than
  Phase 3, then removed or quarantined in Phase 8.
- Relay Devices auto-refresh exists today on Android. The parity target should prefer manual
  refresh unless the refresh can be proven not to flicker or change scroll position.

## Phase 0 Checklist Status

- [x] iOS behavior captured as code-level notes.
- [ ] iOS screenshots captured from simulator.
- [x] Android screenshots captured from emulator.
- [x] Android native thread UI replacement/deprecation map completed.
- [x] Android native product surfaces to keep identified.
- [x] Lightweight parity ambiguity list added in this document.
- [x] Android APK build/install baseline completed.
- [x] Local/Intranet Android UI E2E baseline completed.

## Emulator Status

`adb devices -l` was checked before this document was first written. The adb daemon started,
but no emulator/device was attached at that moment. Available AVDs include:

- `Pixel_10_Pro`
- `cardverify_aosp35_root`

The `Pixel_10_Pro` AVD did not become available through adb during this run. The user then
started the AOSP AVD, and Phase 0 continued against `cardverify_aosp35_root` attached as
`emulator-5554`.

Phase 0 Android evidence:

- Build command required `--no-configuration-cache`; the default Gradle configuration cache
  failed before compilation on the current local toolchain.
- APK installed successfully on `emulator-5554`.
- Android UI connected in Local/Intranet mode to `http://10.0.2.2:8821`, matching the
  user-confirmed local supervisor running on host port 8821.
- Workspace `3dprint` and thread `3d` were opened from the Android UI.
- Prompt `say phase zero ok` was sent from the Android UI composer.
- The assistant response appeared in the Android UI as `phase zero ok`.
- API snapshot confirmed thread `3d` returned to `idle` with `lastError: null`.

Evidence files are under `.local/android-parity-e2e/phase-0/`.
