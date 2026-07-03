# iOS Thread WebView Migration Plan

本文档用于 goal mode 推进 iOS thread detail 从纯原生 SwiftUI 迁移到
`WKWebView` 承载的共享 React thread UI。迁移动机不是为了技术栈统一，而是
因为当前 native thread UI 的 bug 面太大、修复成本高，且需要长期追平 web
thread UI 的 timeline、composer、workspace、shell 和 plugin rendering 行为。

目标是让 iOS app 继续保持原生连接、首页、workspace 列表和导航外壳，但把
thread detail 的主体验切到基于 `../remote-codex-thread-ui` 的 web surface。

## 当前判断

`@remote-codex/thread-ui` 已经是 adapter-driven package。它不直接拥有
supervisor-web API helper、router、REST endpoint、WebSocket endpoint 或 app
local route；宿主通过 adapter 提供导航、图片资源、history detail、prompt
submit、workspace 和 shell transport。

因此 iOS 可以复用这套 UI，但复用方式应该是：

- 推荐：SwiftUI thread detail route 替换为一个 `WKWebView` 宿主，WebView
  内运行 iOS 专用 React shell，React shell 直接使用
  `ThreadDetailSurface`。
- 不推荐：Swift 拉完整 thread state 后逐帧 bridge 给 React 组件。这样 Swift
  和 JS 会同时维护 thread detail、实时事件、乐观 prompt、pending request 和
  workspace state，bug 面会比现在更难控。

## 目标

- iOS thread detail 使用 canonical `@remote-codex/thread-ui` 渲染 timeline、
  composer、workspace panel、export dialog、pending requests、settings slot、
  rich content 和 plugin fallback。
- iOS 原生代码只负责 app shell、连接配置、token 存储、route 恢复、WebView
  宿主、native bridge 和系统能力。
- Thread detail 的 REST/WebSocket 行为由 WebView 内的 TypeScript controller
  直接调用 supervisor API，尽量复用 supervisor-web 现有 adapter 设计。
- 迁移期可短暂保留 feature flag 或 launch argument；Phase 5 完成后，
  thread detail route 不再保留原生回退分支。
- 完成后，native thread UI/projection 代码从 app target 移除，不再作为功能
  演进面。

## 非目标

- 不把整个 iOS app 改成 WebView。
- 不迁移连接设置、Relay 设备管理、Home、Workspace detail 的原生页面，除非
  后续 goal 单独要求。
- 不 fork `@remote-codex/thread-ui` 到 iOS repo 内部。
- 不在 Swift 中重写 React component 的子控件。
- 不因为 iOS 迁移而改变 supervisor API contract。
- 不要求首个切片完成所有 shell/terminal parity；可以先禁用 shell adapter，
  等 chat/workspace/pending request 稳定后再打开。

## 架构目标

```text
RemoteCodex iOS app
  -> native connection/auth/settings/home/workspace shell
  -> ThreadDetailWebViewScreen(threadId, connectionConfig)
  -> WKWebView loads bundled ios-thread-web/index.html
  -> window.__REMOTE_CODEX_IOS_BOOTSTRAP__
       baseUrl, mode, authToken, relayDeviceId, threadId, theme
  -> iOSThreadApp.tsx
       API client + websocket client + adapters
  -> ThreadDetailSurface from @remote-codex/thread-ui
```

Native bridge should stay intentionally small:

```text
JS -> Swift
  closeThread()
  openThread(threadId)
  openWorkspace(workspaceId)
  shareDownloadedFile({ filename, contentType, base64? }) or shareUrl(...)
  pickAttachments(requestId, kind)
  setNavigationTitle(title)
  reportFatalError(message)

Swift -> JS
  updateTheme(theme)
  updateSceneActive(active)
  attachmentPickerResult(requestId, files)
  refresh()
```

## Proposed Files

Recommended layout:

```text
apps/ios
  RemoteCodex
    Features
      ThreadDetail
        ThreadDetailWebViewScreen.swift
        ThreadDetailWebBridge.swift
        ThreadDetailWebResourceLoader.swift
  WebThread
    package.json
    tsconfig.json
    vite.config.ts
    index.html
    src
      main.tsx
      IOSBootstrap.ts
      IOSApiClient.ts
      IOSConnection.ts
      IOSNativeBridge.ts
      IOSThreadDetailPage.tsx
      IOSWorkspaceAdapter.ts
      IOSShellAdapter.ts
      styles.css
```

Alternative layout is acceptable if the same boundaries remain clear. Avoid
placing iOS-only web controller code inside `../remote-codex-thread-ui`; that
package should remain shared UI.

## Connection And Auth Rules

The WebView app must mirror `SupervisorConnectionConfig` exactly:

- `local` and `server` REST paths use `/api/...`.
- `relay` with selected device uses
  `/relay/devices/:deviceId/api/...`.
- Relay account/session-only paths still use `/relay/...` when no selected
  device exists.
- `server` WebSocket auth uses `?token=...`.
- `relay` WebSocket auth uses `?relaySession=...`.
- Base URL must be normalized as an origin, not a page path.

Token injection options:

- Preferred for first implementation: Swift injects bootstrap JSON before page
  load with base URL, mode, auth token, and relay device id.
- Later hardening: use a short-lived native-issued WebView session token or
  cookie instead of directly exposing long-lived token to JS.

## Build Boundary

`apps/supervisor-web` currently consumes `@remote-codex/thread-ui` from sibling
repo `../remote-codex-thread-ui/packages/thread-ui`. The iOS web shell should do
the same in local development.

If a task changes `../remote-codex-thread-ui/packages/thread-ui/src`, rebuild
that package before validating any host:

```bash
pnpm --dir ../remote-codex-thread-ui --filter @remote-codex/thread-ui build
```

For iOS bundle work, add an Xcode build phase or documented local command that
runs the iOS web build and copies `dist` into app resources. The exact command
can be finalized during Phase 1.

## Phase 0: Spike And Decision Gate

Goal: prove that iOS can load the shared thread UI in a `WKWebView` and talk to
the same supervisor API without involving native thread projection.

Tasks:

- [x] Create a temporary iOS web shell that imports `ThreadDetailSurface`.
- [x] Feed it a hardcoded or fixture thread detail and verify it renders on
  iPhone simulator.
- [x] Add a minimal `WKWebView` Swift screen that loads bundled local assets.
- [x] Inject bootstrap config from Swift into JS.
- [x] Verify JS can call one authenticated API endpoint in local mode.
- [x] Verify JS can call one authenticated API endpoint in server mode.
- [x] Verify relay path generation for a selected device id.
- [x] Verify relay session-only REST and WebSocket fallback paths when no
  selected device id exists.
- [x] Verify JS can load a real thread detail through relay selected-device
  forwarding.
- [x] Decide whether shell/terminal is disabled or included in the next phase.

Acceptance:

- Simulator shows a nonblank thread UI from the bundled web shell.
- The web shell can fetch real thread detail from a configured supervisor.
- Native app can return from WebView screen to Home without app restart.
- Decision note records whether to proceed, pause, or change approach.

Evidence:

```text
Files:
- apps/ios/RemoteCodex/Features/ThreadDetail/ThreadDetailWebViewScreen.swift
- apps/ios/RemoteCodex/Features/ThreadDetail/ThreadDetailWebBridge.swift
- apps/ios/RemoteCodex/App/RootView.swift
- apps/ios/RemoteCodex/App/AppEnvironment.swift
- apps/ios/WebThread/**
Verification:
- pnpm --filter @remote-codex/ios-thread-web typecheck
- pnpm --filter @remote-codex/ios-thread-web build
- pnpm --filter @remote-codex/ios-thread-web test
- xcodebuild test -project apps/ios/RemoteCodex.xcodeproj -scheme RemoteCodex
  -destination 'platform=iOS Simulator,id=B9E0BB3C-4FB0-4C86-A0E1-E578E1AFCBC9'
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testThreadWebViewFixtureLoadsSharedThreadUI
  -parallel-testing-enabled NO
- DATABASE_URL="$PWD/.local/ios-e2e/supervisor-ios-webview-e2e.sqlite"
  WORKSPACE_ROOT="$PWD" HOST=127.0.0.1 PORT=8797 REMOTE_CODEX_MODE=local
  REMOTE_CODEX_DISABLE_BUILD_RESTART=true REMOTE_CODEX_ENABLE_WEBVIEW_CORS=true
  pnpm --filter @remote-codex/supervisor-api exec tsx src/index.ts
- printf 'http://127.0.0.1:8797' > .local/ios-e2e/base-url.txt
- xcodebuild test -project apps/ios/RemoteCodex.xcodeproj -scheme RemoteCodex
  -destination 'platform=iOS Simulator,id=B9E0BB3C-4FB0-4C86-A0E1-E578E1AFCBC9'
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testLiveLocalThreadWebViewLoadsRealThreadDetail
  -parallel-testing-enabled NO
- pnpm --filter @remote-codex/supervisor-api typecheck
- pnpm --filter @remote-codex/supervisor-api test -- app.test.ts
- DATABASE_URL="$PWD/.local/ios-e2e/supervisor-ios-webview-server-e2e.sqlite"
  WORKSPACE_ROOT="$PWD" HOST=127.0.0.1 PORT=8802 REMOTE_CODEX_MODE=server
  REMOTE_CODEX_ADMIN_USERNAME=ios-admin REMOTE_CODEX_ADMIN_PASSWORD=ios-password
  REMOTE_CODEX_SESSION_SECRET=ios-e2e-session-secret
  REMOTE_CODEX_DISABLE_BUILD_RESTART=true REMOTE_CODEX_ENABLE_WEBVIEW_CORS=true
  pnpm --filter @remote-codex/supervisor-api exec tsx src/index.ts
- printf 'http://127.0.0.1:8802' > .local/ios-e2e/server-base-url.txt
- xcodebuild test -project apps/ios/RemoteCodex.xcodeproj -scheme RemoteCodex
  -destination 'platform=iOS Simulator,id=B9E0BB3C-4FB0-4C86-A0E1-E578E1AFCBC9'
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testLiveServerThreadWebViewLoadsAuthenticatedThreadDetail
  -parallel-testing-enabled NO
- REMOTE_CODEX_ADMIN_USERNAME=ios-relay-admin
  REMOTE_CODEX_ADMIN_PASSWORD=ios-relay-password
  REMOTE_CODEX_RELAY_SESSION_SECRET=ios-relay-session-secret
  REMOTE_CODEX_RELAY_DATA_DIR="$PWD/.local/ios-e2e/relay-webview-server-data"
  REMOTE_CODEX_ENABLE_WEBVIEW_CORS=true HOST=127.0.0.1 PORT=8803
  pnpm --filter @remote-codex/relay-server exec tsx src/index.ts
- DATABASE_URL="$PWD/.local/ios-e2e/supervisor-ios-webview-relay-e2e.sqlite"
  WORKSPACE_ROOT="$PWD" REMOTE_CODEX_RELAY_SERVER_URL=ws://127.0.0.1:8803
  REMOTE_CODEX_RELAY_AGENT_TOKEN="<created relay device token>"
  REMOTE_CODEX_RELAY_SUPERVISOR_HOST=127.0.0.1
  REMOTE_CODEX_RELAY_SUPERVISOR_PORT=8804
  REMOTE_CODEX_DISABLE_BUILD_RESTART=true REMOTE_CODEX_ENABLE_WEBVIEW_CORS=true
  node bin/remote-codex.mjs relay-supervisor
- xcodebuild test -project apps/ios/RemoteCodex.xcodeproj -scheme RemoteCodex
  -destination 'platform=iOS Simulator,id=B9E0BB3C-4FB0-4C86-A0E1-E578E1AFCBC9'
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testLiveRelayThreadWebViewLoadsForwardedThreadDetail
  -parallel-testing-enabled NO
- DATABASE_URL="$PWD/.local/ios-e2e/supervisor-ios-webview-relay-composer-e2e.sqlite"
  WORKSPACE_ROOT="$PWD" REMOTE_CODEX_RELAY_SERVER_URL=ws://127.0.0.1:8799
  REMOTE_CODEX_RELAY_AGENT_TOKEN="<created relay device token>"
  REMOTE_CODEX_RELAY_SUPERVISOR_HOST=127.0.0.1
  REMOTE_CODEX_RELAY_SUPERVISOR_PORT=8796
  REMOTE_CODEX_DISABLE_BUILD_RESTART=true
  REMOTE_CODEX_ENABLE_WEBVIEW_CORS=true
  REMOTE_CODEX_E2E_FAKE_RUNTIME=1
  REMOTE_CODEX_ENABLED_AGENT_PROVIDERS=claude
  node bin/remote-codex.mjs relay-supervisor
- xcodebuild test -project apps/ios/RemoteCodex.xcodeproj -scheme RemoteCodex
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testLiveRelayThreadWebViewSubmitsPromptThroughComposer
  -parallel-testing-enabled NO
Residual risk:
- 2026-07-01 live local slice opens a real workspace/thread and loads the real
  thread detail through WebView mode. WebView composer submit now has local
  fake-runtime E2E coverage. WebSocket event refresh is covered in local mode,
  and core live turn stream projection is now covered by a no-refresh-fallback
  local simulator E2E.
- Server-mode authenticated WebView fetch is covered by simulator E2E. This
  proves Bearer token bootstrap, WebView CORS, protected thread detail fetch,
  and native title bridge in server mode.
- Relay selected-device WebView fetch is covered by simulator E2E. This proves
  relay token bootstrap, relay-server WebView CORS, forwarded protected thread
  detail fetch, and native title bridge in relay mode. Relay selected-device
  prompt submit is also covered through the shared WebView composer against the
  fake runtime.
- Shell/terminal is intentionally disabled in this slice via `shell: null`.
- Relay WebSocket open, relay prompt submit, and relay core live turn stream
  projection are covered. Both local and relay no-refresh-fallback E2Es now
  prove `IOS_STREAM_COMPLETED` can render from projected WebSocket events.
```

## Phase 1: Production-Shape Web Shell

Goal: replace temporary spike code with a maintainable iOS thread web app.

Tasks:

- [x] Add package scripts for `typecheck`, `build`, and focused tests.
- [x] Configure Vite output for static local loading in `WKWebView`.
- [x] Include `@remote-codex/thread-ui` styles and required host CSS tokens.
- [x] Implement TypeScript connection config normalization.
- [x] Implement REST helper for JSON, downloads, multipart upload, and API
  error parsing.
- [x] Implement WebSocket helper for thread events.
- [x] Implement thread detail controller:
  - [x] initial detail load
  - [x] refresh
  - [x] older history load
  - [x] WebSocket-triggered refresh fallback
  - [x] optimistic prompt behavior
- [x] Implement `ThreadDetailUiAdapter`.
- [x] Disable unavailable adapters explicitly, especially shell if out of
  scope.

Acceptance:

- `pnpm --dir apps/ios/WebThread typecheck` passes.
- `pnpm --dir apps/ios/WebThread build` produces deterministic bundled assets.
- Web shell loads thread detail, sends prompt, updates after WebSocket events,
  and handles refresh.

Evidence:

```text
Files:
- apps/ios/WebThread/**
- apps/ios/WebThread/src/IOSApiClient.ts
- apps/ios/WebThread/src/IOSApiClient.test.ts
- apps/ios/WebThread/src/IOSHistoryPaging.ts
- apps/ios/WebThread/src/IOSOptimisticPrompt.ts
- apps/ios/WebThread/src/IOSThreadDetailPage.test.ts
- apps/ios/RemoteCodex/Features/ThreadDetail/ThreadDetailWebBridge.swift
- apps/ios/RemoteCodex/Features/ThreadDetail/ThreadDetailWebViewScreen.swift
- apps/ios/RemoteCodexUITests/RemoteCodexUITests.swift
Verification:
- pnpm --filter @remote-codex/ios-thread-web typecheck
- pnpm --filter @remote-codex/ios-thread-web build
- pnpm --filter @remote-codex/ios-thread-web test
- pnpm --filter @remote-codex/supervisor-api typecheck
- DATABASE_URL="$PWD/.local/ios-e2e/supervisor-ios-webview-ws-e2e.sqlite"
  WORKSPACE_ROOT="$PWD" HOST=127.0.0.1 PORT=8805 REMOTE_CODEX_MODE=local
  REMOTE_CODEX_E2E_FAKE_RUNTIME=1 REMOTE_CODEX_ENABLED_AGENT_PROVIDERS=claude
  REMOTE_CODEX_DISABLE_BUILD_RESTART=true REMOTE_CODEX_ENABLE_WEBVIEW_CORS=true
  pnpm --filter @remote-codex/supervisor-api exec tsx src/index.ts
- xcodebuild test -project apps/ios/RemoteCodex.xcodeproj -scheme RemoteCodex
  -destination 'platform=iOS Simulator,id=B9E0BB3C-4FB0-4C86-A0E1-E578E1AFCBC9'
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testLiveLocalThreadWebViewRefreshesFromWebSocketEvent
  -parallel-testing-enabled NO
- DATABASE_URL="$PWD/.local/ios-e2e/supervisor-ios-webview-optimistic-e2e.sqlite"
  WORKSPACE_ROOT="$PWD" HOST=127.0.0.1 PORT=8815 REMOTE_CODEX_MODE=local
  REMOTE_CODEX_E2E_FAKE_RUNTIME=1 REMOTE_CODEX_ENABLED_AGENT_PROVIDERS=claude
  REMOTE_CODEX_DISABLE_BUILD_RESTART=true REMOTE_CODEX_ENABLE_WEBVIEW_CORS=true
  pnpm --filter @remote-codex/supervisor-api exec tsx src/index.ts
- xcodebuild test -project apps/ios/RemoteCodex.xcodeproj -scheme RemoteCodex
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testLiveLocalThreadWebViewOptimisticallyRendersSubmittedPrompt
  -parallel-testing-enabled NO
- DATABASE_URL="$PWD/.local/ios-e2e/supervisor-ios-webview-older-history-e2e.sqlite"
  WORKSPACE_ROOT="$PWD" HOST=127.0.0.1 PORT=8816 REMOTE_CODEX_MODE=local
  REMOTE_CODEX_E2E_FAKE_RUNTIME=1 REMOTE_CODEX_ENABLED_AGENT_PROVIDERS=claude
  REMOTE_CODEX_DISABLE_BUILD_RESTART=true REMOTE_CODEX_ENABLE_WEBVIEW_CORS=true
  pnpm --filter @remote-codex/supervisor-api exec tsx src/index.ts
- xcodebuild test -project apps/ios/RemoteCodex.xcodeproj -scheme RemoteCodex
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testLiveLocalThreadWebViewLoadsOlderHistory
  -parallel-testing-enabled NO
Residual risk:
- Current REST helper covers JSON request/error flow, API error parsing,
  downloads, multipart upload, and typed paths for initial thread, paged thread
  detail, prompt, history detail, workspace tree/preview/upload/write/download,
  pending request, export-turn, and transcript download endpoints.
- WebSocket helper is implemented and validated in local simulator E2E. It
  projects core live turn stream events locally
  (`thread.turn.started`, `thread.item.started`, `thread.output.delta`,
  `thread.item.completed`, `thread.turn.completed`, and `thread.turn.failed`)
  and keeps refresh-after-event as a production safety net for unprojected or
  edge event families.
- WebView composer submit now has a direct iOS simulator E2E for a default
  prompt against the fake runtime. Reasoning setting update now has direct
  iOS simulator E2E coverage through the WebView settings update path. Visible
  model, reasoning, Plan/collaboration, and sandbox controls now have simulator
  E2E coverage through the shared WebView composer.
- WebView optimistic prompt rendering is covered by a TypeScript unit test and
  a live local simulator smoke. The WebView inserts a local in-progress turn
  immediately, preserves existing pending requests, records a stable native
  test marker through `threadWebOptimisticPrompt`, and then replaces local state
  with the supervisor detail after the fake runtime completes.
- Older history loading is covered by TypeScript pagination tests and a live
  local simulator smoke. The WebView starts at `limit=30`, expands to
  `limit=40` through the same controller path used by the shared timeline, and
  renders `IOS_HISTORY_PAGE_TURN_6` from a 45-turn fake-runtime transcript.
```

## Phase 2: Native WKWebView Host

Goal: make WebView thread detail feel like a first-class iOS route.

Tasks:

- [x] Add `ThreadDetailWebViewScreen`.
- [x] Add `ThreadDetailWebBridge` with typed message names and payloads.
- [x] Load bundled `index.html` from app resources.
- [x] Inject bootstrap JSON before page scripts execute.
- [x] Wire native callbacks:
  - [x] close thread
  - [x] open linked thread
  - [x] open workspace
  - [x] set navigation title
  - [x] report fatal error
- [x] Forward theme changes from native settings to JS.
- [x] Forward foreground/background state so JS can pause or reconnect sockets.
- [x] Add a temporary feature flag or setting to choose web thread UI during the
  migration window. This switch was removed in Phase 5.

Acceptance:

- Existing iOS navigation can open a thread in WebView mode.
- Back/Home behavior works.
- Native title reflects thread title.
- Background/foreground does not leave duplicate sockets running.
- WebView mode remains reachable during migration; Phase 5 removes the fallback
  branch.

Evidence:

```text
Files:
- apps/ios/RemoteCodex/Features/ThreadDetail/ThreadDetailWebViewScreen.swift
- apps/ios/RemoteCodex/Features/ThreadDetail/ThreadDetailWebBridge.swift
- apps/ios/RemoteCodex/App/* route changes
- apps/ios/project.yml
- apps/ios/RemoteCodex/Info.plist
Verification:
- xcodebuild test -project apps/ios/RemoteCodex.xcodeproj -scheme RemoteCodex
  -destination 'platform=iOS Simulator,id=B9E0BB3C-4FB0-4C86-A0E1-E578E1AFCBC9'
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testThreadWebViewFixtureLoadsSharedThreadUI
  -parallel-testing-enabled NO
- xcodebuild test -project apps/ios/RemoteCodex.xcodeproj -scheme RemoteCodex
  -destination 'platform=iOS Simulator,id=B9E0BB3C-4FB0-4C86-A0E1-E578E1AFCBC9'
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testThreadDetailFixtureShowsComposerAndTimeline
  -parallel-testing-enabled NO
- xcodebuild build -project apps/ios/RemoteCodex.xcodeproj -scheme RemoteCodex
  -destination 'platform=iOS Simulator,id=B9E0BB3C-4FB0-4C86-A0E1-E578E1AFCBC9'
- /usr/libexec/PlistBuddy -c 'Print :NSAppTransportSecurity'
  ~/Library/Developer/Xcode/DerivedData/RemoteCodex-*/Build/Products/Debug-iphonesimulator/RemoteCodex.app/Info.plist
- DATABASE_URL="$PWD/.local/ios-e2e/supervisor-ios-webview-lifecycle-e2e.sqlite"
  WORKSPACE_ROOT="$PWD" HOST=127.0.0.1 PORT=8825 REMOTE_CODEX_MODE=local
  REMOTE_CODEX_E2E_FAKE_RUNTIME=1 REMOTE_CODEX_ENABLED_AGENT_PROVIDERS=claude
  REMOTE_CODEX_DISABLE_BUILD_RESTART=true REMOTE_CODEX_ENABLE_WEBVIEW_CORS=true
  pnpm --filter @remote-codex/supervisor-api exec tsx src/index.ts
- xcodebuild test -project apps/ios/RemoteCodex.xcodeproj -scheme RemoteCodex
  -destination 'platform=iOS Simulator,name=iPhone 17'
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testLiveLocalThreadWebViewReconnectsAfterBackgroundForeground
  -parallel-testing-enabled NO
Residual risk:
- WebView mode was initially behind launch arguments during Phase 2; Phase 5
  made it the only thread detail route.
- Foreground/background lifecycle is covered by a live local simulator smoke.
  The native host forwards scene lifecycle notifications into the WebView, and
  the WebView also listens for visibility/page lifecycle events. The E2E allows
  WebKit to either preserve a single socket during a short Home/activate cycle
  or reconnect once, then sends another prompt and verifies the post-foreground
  stream renders without a duplicated `IOS_STREAM_COMPLETED` projection.
  Transcript/workspace downloads use the native share bridge, and composer
  attachments use the native file picker bridge.
- The native fallback route was removed in Phase 5 after WebView coverage
  reached the critical workflow threshold.
```

## Phase 3: Feature Parity Slice

Goal: cover the user-critical thread workflows that are currently bug-prone in
native UI.

Tasks:

- [x] Timeline renders user/assistant/tool/history/pending request content.
- [x] Prompt submit works from the WebView composer for the default local fake
  runtime path.
- [x] Prompt submit preserves a WebView-updated reasoning setting against the
  local fake runtime path.
- [x] Prompt submit works through visible model/reasoning/Plan collaboration
  and sandbox UI controls where supported.
- [x] Composer photo/file attachment picker uses a JS-to-Swift bridge in iOS
  WebView mode, with browser file input retained as the non-native fallback.
- [x] Interrupt, compact, resume, rename, delete actions work or are hidden
  until wired.
- [x] Pending request responder is wired in the WebView controller for
  approval, question, and plan decision payloads.
- [x] Pending request answer flow works for approval, question, and plan
  decision through visible WebView controls.
- [x] Workspace tree loads one level at a time and initial file preview works.
- [x] Workspace preview load-more handler can fetch the next preview chunk in
  WebView mode.
- [x] Workspace raw/download/upload/write adapters are wired in WebView mode and
  covered by a live local E2E hook.
- [x] Workspace raw/download/upload/write visible-control accessibility and
  native picker bridge coverage.
- [x] History detail loading works through the WebView adapter and live local E2E
  hook.
- [x] Visible history-detail button accessibility/tap coverage for command output.
- [x] Export PDF/HTML works and can hand off to native share sheet.
- [x] WebView export download can hand off a downloaded file to native share
  sheet.
- [x] WebView export dialog visible custom selection controls are covered by a
  fixture simulator smoke.
- [x] Live local WebView PDF export downloads from supervisor and reaches the
  native share entry.
- [x] Live local WebView HTML export downloads from supervisor and reaches the
  native share entry.
- [x] Fork latest and fork selected turn work.
- [x] Rename/delete thread management actions are wired or visibly covered:
  rename has a live local WebView E2E; delete has API adapter coverage and
  fixture visibility coverage.
- [x] Skills/MCP/hooks panels render equivalent information or a clear fallback.
- [x] Image assets load through authenticated API in server WebView mode.

Acceptance:

- A real thread can be opened, monitored, prompted, answered, exported, and
  forked from iOS WebView mode.
- Workflows that are not yet implemented are visibly unavailable, not broken
  buttons.
- Native thread UI bugs no longer block these workflows when WebView mode is on.

Evidence:

```text
Files:
- ../remote-codex-thread-ui/packages/thread-ui/src/adapters.ts
- ../remote-codex-thread-ui/packages/thread-ui/src/components/graph-workspace/GraphWorkspaceExplorer.tsx
- ../remote-codex-thread-ui/packages/thread-ui/src/components/graph-workspace/GraphWorkspacePreviewPane.tsx
- ../remote-codex-thread-ui/packages/thread-ui/src/components/ThreadComposer.tsx
- apps/ios/WebThread/src/IOSApiClient.ts
- apps/ios/WebThread/src/IOSConnection.ts
- apps/ios/WebThread/src/IOSThreadDetailPage.tsx
- apps/ios/WebThread/src/IOSBootstrap.ts
- apps/ios/WebThread/src/IOSNativeBridge.ts
- apps/ios/WebThread/src/mockData.ts
- apps/ios/WebThread/src/IOSApiClient.test.ts
- apps/ios/RemoteCodex/Features/ThreadDetail/ThreadDetailWebViewScreen.swift
- apps/ios/RemoteCodex/Features/ThreadDetail/ThreadDetailWebBridge.swift
- apps/ios/RemoteCodex/App/RootView.swift
- apps/ios/RemoteCodexTests/JSONValueTests.swift
- apps/ios/RemoteCodexUITests/RemoteCodexExportUITestSupport.swift
- apps/ios/RemoteCodexUITests/RemoteCodexWorkspaceFileUITestSupport.swift
- apps/ios/RemoteCodexUITests/RemoteCodexUITests.swift
- apps/supervisor-api/src/e2e-fake-runtime.ts
Verification:
- pnpm --dir ../remote-codex-thread-ui --filter @remote-codex/thread-ui typecheck
- pnpm --dir ../remote-codex-thread-ui --filter @remote-codex/thread-ui build
- pnpm --filter @remote-codex/ios-thread-web typecheck
- pnpm --filter @remote-codex/ios-thread-web test -- IOSConnection IOSWebSocket
  IOSThreadDetailPage IOSApiClient
- pnpm --filter @remote-codex/ios-thread-web build
- xcodebuild test -project apps/ios/RemoteCodex.xcodeproj -scheme RemoteCodex
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
  -only-testing:RemoteCodexTests/ThreadDetailWebBridgeTests
  -parallel-testing-enabled NO
- xcodebuild test -project apps/ios/RemoteCodex.xcodeproj -scheme RemoteCodex
  -destination 'platform=iOS Simulator,id=B9E0BB3C-4FB0-4C86-A0E1-E578E1AFCBC9'
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testPendingRequestFixtureAutoResolvesApprovalQuestionAndPlanDecisionThroughWebView
  -parallel-testing-enabled NO
- xcodebuild test -project apps/ios/RemoteCodex.xcodeproj -scheme RemoteCodex
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testPendingRequestFixtureClicksVisibleWebViewControls
  -parallel-testing-enabled NO
- xcodebuild test -project apps/ios/RemoteCodex.xcodeproj -scheme RemoteCodex
  -destination 'platform=iOS Simulator,id=B9E0BB3C-4FB0-4C86-A0E1-E578E1AFCBC9'
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testThreadWebViewFixtureExportsPDFToNativeShareLink
  -parallel-testing-enabled NO
- xcodebuild test -project apps/ios/RemoteCodex.xcodeproj -scheme RemoteCodex
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testThreadWebViewFixtureExportsHTMLToNativeShareLink
  -parallel-testing-enabled NO
- xcodebuild test -project apps/ios/RemoteCodex.xcodeproj -scheme RemoteCodex
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testThreadWebViewFixtureClicksVisibleExportCustomSelectionControls
  -parallel-testing-enabled NO
- xcodebuild test -project apps/ios/RemoteCodex.xcodeproj -scheme RemoteCodex
  -destination 'platform=iOS Simulator,name=iPhone 17'
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testThreadWebViewFixtureShowsThreadManagementAndHidesUnavailableRuntimeActions
  -parallel-testing-enabled NO
- DATABASE_URL="$PWD/.local/ios-e2e/supervisor-ios-webview-rename-e2e.sqlite"
  WORKSPACE_ROOT="$PWD" HOST=127.0.0.1 PORT=8821 REMOTE_CODEX_MODE=local
  REMOTE_CODEX_E2E_FAKE_RUNTIME=1 REMOTE_CODEX_ENABLED_AGENT_PROVIDERS=claude
  REMOTE_CODEX_DISABLE_BUILD_RESTART=true REMOTE_CODEX_ENABLE_WEBVIEW_CORS=true
  pnpm --filter @remote-codex/supervisor-api exec tsx src/index.ts
- xcodebuild test -project apps/ios/RemoteCodex.xcodeproj -scheme RemoteCodex
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testLiveLocalThreadWebViewRenamesThreadThroughAdapter
  -parallel-testing-enabled NO
- DATABASE_URL="$PWD/.local/ios-e2e/supervisor-ios-webview-delete-e2e.sqlite"
  WORKSPACE_ROOT="$PWD" HOST=127.0.0.1 PORT=8824 REMOTE_CODEX_MODE=local
  REMOTE_CODEX_E2E_FAKE_RUNTIME=1 pnpm --filter
  @remote-codex/supervisor-api dev
- xcodebuild test -project apps/ios/RemoteCodex.xcodeproj -scheme RemoteCodex
  -destination 'platform=iOS Simulator,name=iPhone 17'
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testLiveLocalThreadWebViewDeletesThreadThroughAdapter
- xcodebuild test -project apps/ios/RemoteCodex.xcodeproj -scheme RemoteCodex
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testThreadWebViewFixtureRendersTimelineAndPendingRequestContent
  -parallel-testing-enabled NO
- DATABASE_URL="$PWD/.local/ios-e2e/supervisor-ios-webview-settings-e2e.sqlite"
  WORKSPACE_ROOT="$PWD" HOST=127.0.0.1 PORT=8801 REMOTE_CODEX_MODE=local
  REMOTE_CODEX_E2E_FAKE_RUNTIME=1 REMOTE_CODEX_ENABLED_AGENT_PROVIDERS=claude
  REMOTE_CODEX_DISABLE_BUILD_RESTART=true REMOTE_CODEX_ENABLE_WEBVIEW_CORS=true
  pnpm --filter @remote-codex/supervisor-api exec tsx src/index.ts
- xcodebuild test -project apps/ios/RemoteCodex.xcodeproj -scheme RemoteCodex
  -destination 'platform=iOS Simulator,id=B9E0BB3C-4FB0-4C86-A0E1-E578E1AFCBC9'
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testLiveLocalThreadWebViewReasoningSettingSubmitsPrompt
  -parallel-testing-enabled NO
- DATABASE_URL="$PWD/.local/ios-e2e/supervisor-ios-webview-visible-settings-e2e.sqlite"
  WORKSPACE_ROOT="$PWD" HOST=127.0.0.1 PORT=8811 REMOTE_CODEX_MODE=local
  REMOTE_CODEX_E2E_FAKE_RUNTIME=1 REMOTE_CODEX_ENABLED_AGENT_PROVIDERS=claude
  REMOTE_CODEX_DISABLE_BUILD_RESTART=true REMOTE_CODEX_ENABLE_WEBVIEW_CORS=true
  pnpm --filter @remote-codex/supervisor-api exec tsx src/index.ts
- xcodebuild test -project apps/ios/RemoteCodex.xcodeproj -scheme RemoteCodex
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testLiveLocalThreadWebViewVisibleSettingsControlsSubmitPrompt
  -parallel-testing-enabled NO
- DATABASE_URL="$PWD/.local/ios-e2e/supervisor-ios-webview-live-export-e2e.sqlite"
  WORKSPACE_ROOT="$PWD" HOST=127.0.0.1 PORT=8806 REMOTE_CODEX_MODE=local
  REMOTE_CODEX_E2E_FAKE_RUNTIME=1 REMOTE_CODEX_ENABLED_AGENT_PROVIDERS=claude
  REMOTE_CODEX_DISABLE_BUILD_RESTART=true REMOTE_CODEX_ENABLE_WEBVIEW_CORS=true
  pnpm --filter @remote-codex/supervisor-api exec tsx src/index.ts
- xcodebuild test -project apps/ios/RemoteCodex.xcodeproj -scheme RemoteCodex
  -destination 'platform=iOS Simulator,id=B9E0BB3C-4FB0-4C86-A0E1-E578E1AFCBC9'
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testLiveLocalThreadWebViewExportsPDFToNativeShareLink
  -parallel-testing-enabled NO
- DATABASE_URL="$PWD/.local/ios-e2e/supervisor-ios-webview-live-html-export-e2e.sqlite"
  WORKSPACE_ROOT="$PWD" HOST=127.0.0.1 PORT=8811 REMOTE_CODEX_MODE=local
  REMOTE_CODEX_E2E_FAKE_RUNTIME=1 REMOTE_CODEX_ENABLED_AGENT_PROVIDERS=claude
  REMOTE_CODEX_DISABLE_BUILD_RESTART=true REMOTE_CODEX_ENABLE_WEBVIEW_CORS=true
  pnpm --filter @remote-codex/supervisor-api exec tsx src/index.ts
- xcodebuild test -project apps/ios/RemoteCodex.xcodeproj -scheme RemoteCodex
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testLiveLocalThreadWebViewExportsHTMLToNativeShareLink
  -parallel-testing-enabled NO
- DATABASE_URL="$PWD/.local/ios-e2e/supervisor-ios-webview-workspace-actions-e2e.sqlite"
  WORKSPACE_ROOT="$PWD" HOST=127.0.0.1 PORT=8808 REMOTE_CODEX_MODE=local
  REMOTE_CODEX_DISABLE_BUILD_RESTART=true REMOTE_CODEX_ENABLE_WEBVIEW_CORS=true
  pnpm --filter @remote-codex/supervisor-api exec tsx src/index.ts
- xcodebuild test -project apps/ios/RemoteCodex.xcodeproj -scheme RemoteCodex
  -destination 'platform=iOS Simulator,id=B9E0BB3C-4FB0-4C86-A0E1-E578E1AFCBC9'
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testLiveLocalThreadWebViewLoadsWorkspaceTreeAndFilePreview
  -parallel-testing-enabled NO
- DATABASE_URL="$PWD/.local/ios-e2e/supervisor-ios-webview-visible-workspace-controls-e2e.sqlite"
  WORKSPACE_ROOT="$PWD" HOST=127.0.0.1 PORT=8813 REMOTE_CODEX_MODE=local
  REMOTE_CODEX_E2E_FAKE_RUNTIME=1 REMOTE_CODEX_ENABLED_AGENT_PROVIDERS=claude
  REMOTE_CODEX_DISABLE_BUILD_RESTART=true REMOTE_CODEX_ENABLE_WEBVIEW_CORS=true
  pnpm --filter @remote-codex/supervisor-api exec tsx src/index.ts
- xcodebuild test -project apps/ios/RemoteCodex.xcodeproj -scheme RemoteCodex
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testLiveLocalThreadWebViewClicksVisibleWorkspaceFileControls
  -parallel-testing-enabled NO
- DATABASE_URL="$PWD/.local/ios-e2e/supervisor-ios-webview-history-detail-e2e.sqlite"
  WORKSPACE_ROOT="$PWD" HOST=127.0.0.1 PORT=8801 REMOTE_CODEX_MODE=local
  REMOTE_CODEX_E2E_FAKE_RUNTIME=1 REMOTE_CODEX_ENABLED_AGENT_PROVIDERS=claude
  REMOTE_CODEX_DISABLE_BUILD_RESTART=true REMOTE_CODEX_ENABLE_WEBVIEW_CORS=true
  pnpm --filter @remote-codex/supervisor-api exec tsx src/index.ts
- xcodebuild test -project apps/ios/RemoteCodex.xcodeproj -scheme RemoteCodex
  -destination 'platform=iOS Simulator,id=B9E0BB3C-4FB0-4C86-A0E1-E578E1AFCBC9'
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testLiveLocalThreadWebViewLoadsDeferredHistoryDetail
  -parallel-testing-enabled NO
- DATABASE_URL="$PWD/.local/ios-e2e/supervisor-ios-webview-visible-history-detail-e2e.sqlite"
  WORKSPACE_ROOT="$PWD" HOST=127.0.0.1 PORT=8810 REMOTE_CODEX_MODE=local
  REMOTE_CODEX_E2E_FAKE_RUNTIME=1 REMOTE_CODEX_ENABLED_AGENT_PROVIDERS=claude
  REMOTE_CODEX_DISABLE_BUILD_RESTART=true REMOTE_CODEX_ENABLE_WEBVIEW_CORS=true
  pnpm --filter @remote-codex/supervisor-api exec tsx src/index.ts
- xcodebuild test -project apps/ios/RemoteCodex.xcodeproj -scheme RemoteCodex
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testLiveLocalThreadWebViewTapsVisibleHistoryDetailButton
- xcodebuild test -project apps/ios/RemoteCodex.xcodeproj -scheme RemoteCodex
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testThreadWebViewFixtureOpensVisibleHistoryDetailKinds
  -parallel-testing-enabled NO
- DATABASE_URL="$PWD/.local/ios-e2e/supervisor-ios-webview-image-asset-e2e.sqlite"
  WORKSPACE_ROOT="$PWD" HOST=127.0.0.1 PORT=8809 REMOTE_CODEX_MODE=server
  REMOTE_CODEX_ADMIN_USERNAME=ios-admin REMOTE_CODEX_ADMIN_PASSWORD=ios-password
  REMOTE_CODEX_SESSION_SECRET=ios-e2e-session-secret
  REMOTE_CODEX_E2E_FAKE_RUNTIME=1 REMOTE_CODEX_ENABLED_AGENT_PROVIDERS=claude
  REMOTE_CODEX_DISABLE_BUILD_RESTART=true REMOTE_CODEX_ENABLE_WEBVIEW_CORS=true
  pnpm --filter @remote-codex/supervisor-api exec tsx src/index.ts
- xcodebuild test -project apps/ios/RemoteCodex.xcodeproj -scheme RemoteCodex
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testLiveServerThreadWebViewLoadsAuthenticatedImageAsset
- DATABASE_URL="$PWD/.local/ios-e2e/supervisor-ios-webview-fork-e2e.sqlite"
  WORKSPACE_ROOT="$PWD" HOST=127.0.0.1 PORT=8812 REMOTE_CODEX_MODE=local
  REMOTE_CODEX_E2E_FAKE_RUNTIME=1 REMOTE_CODEX_ENABLED_AGENT_PROVIDERS=claude
  REMOTE_CODEX_DISABLE_BUILD_RESTART=true REMOTE_CODEX_ENABLE_WEBVIEW_CORS=true
  pnpm --filter @remote-codex/supervisor-api exec tsx src/index.ts
- xcodebuild test -project apps/ios/RemoteCodex.xcodeproj -scheme RemoteCodex
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testLiveLocalThreadWebViewForksLatestThroughVisibleControls
  -parallel-testing-enabled NO
- xcodebuild test -project apps/ios/RemoteCodex.xcodeproj -scheme RemoteCodex
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testLiveLocalThreadWebViewForksSelectedTurnThroughVisibleControls
  -parallel-testing-enabled NO
Residual risk:
- The visible-settings iOS UI test uses a test-only bootstrap hook because
  WKWebView accessibility does not reliably expose the shared composer toolbar
  chips to XCTest. The hook still clicks the production shared UI model,
  reasoning, and Plan collaboration controls inside the WebView DOM,
  verifies the native-visible thread settings via the production API, and
  submits a real prompt afterward.
- Sandbox mode was removed from this repository; the fake `claude` runtime now
  reports `planMode=true` and `sandboxMode=false` so the shared composer exposes
  Plan but no Sandbox menu. Live visible-settings smoke should verify
  `collaborationMode=plan` and rely on the supervisor full-access default.
- Timeline fixture coverage renders user and assistant messages, a plan item,
  context compaction, command/tool-call/web-search/file-read/file-change history
  kinds, pending approval/question/plan requests, and the initial visible
  history controls exposed by the shared UI. Command/tool-call/search/read rows
  start as accordions (`Expand ... history item`); file-change exposes `Open
  file change details` directly. Expanded detail tap coverage is still tracked
  by the history-detail E2Es below.
- Pending request WebView responder is covered by fixture simulator smokes for
  approval, question, and plan decision payloads. One smoke calls the adapter
  responder directly; the visible-control smoke clicks the real shared UI
  buttons inside the WebView DOM (`Allow`, `Detailed`, and `Implement
  (Recommended)`), waits for those controls to disappear, and then reports the
  resolved request ids through the native debug bridge. Native XCUITest still
  does not directly tap those WebView internals because WebKit accessibility is
  unreliable on the simulator.
- Export native handoff is covered by fixture and live local simulator smokes.
  The fixture creates PDF and HTML blobs, and the live local smokes download
  supervisor PDF and HTML exports, then send them through `shareDownloadedFile`
  so Swift writes a temporary file and exposes a native `ShareLink`. Visible
  custom selection is covered by a fixture smoke that clicks the shared WebView
  export controls for `Export transcript`, `Custom selection`, `HTML`, `Clear`,
  one turn checkbox, and `Export HTML`, then waits for the native HTML share
  entry. XCTest still uses a test-only WebView bootstrap hook to click those
  DOM controls because WKWebView accessibility does not reliably expose the
  internal dialog controls as native elements.
- Thread-management actions are partially wired through the iOS WebView
  adapter. Rename and delete now call the supervisor API from the shared UI
  adapter; fixture simulator coverage verifies rename/delete are visible while
  unsupported runtime actions remain hidden. The fixture also asserts that
  stop/current-turn interrupt controls, shell switching/tools/input, resume,
  compact, fork, skills, MCP, and hooks controls are absent when their adapters
  are unavailable. Live local E2E verifies rename through WebView -> supervisor
  API -> native navigation title. Live local E2E also verifies delete through
  WebView -> supervisor API by creating a temporary thread and waiting for the
  deleted thread detail to return 404. Interrupt, shell, and compact remain
  unavailable/hidden.
  Fork is wired through the backend toolbox item path and covered for both
  latest and selected-turn modes against the live local fake runtime. Resume is
  not currently exposed as a visible thread action in the shared thread UI.
- Live local WebView workspace tree, initial file preview, preview load-more,
  and file action adapters are covered. The test opens a real thread with a
  workspace fixture, focuses `Sources/Long.txt`, verifies the shared UI adapter
  loads root and `path=Sources` tree nodes, then verifies preview requests for
  `limit=24000` and `offset=24000&limit=24000`. The same test-only WebView hook
  writes `Sources/ios-webview-write.txt`, uploads
  `Sources/ios-webview-upload.txt`, rereads both markers through preview, and
  downloads `Sources/Long.txt` through the native share bridge path.
- Visible workspace controls are covered by a live local simulator smoke that
  clicks the real shared UI buttons for `Editable.txt`, `Edit file`, `Save
  file`, `Download Editable.txt`, `Preview.png`, and `Upload file`. The smoke
  validates raw image URLs, write/save persistence, download handoff to the
  native share bridge, and upload through the shared UI
  `ThreadWorkspaceAdapter.pickUploadFile` hook. The iOS host responds to
  `pickAttachments(..., kind: "file")` and the smoke uses a test-only automatic
  picker result so the bridge and upload adapter are deterministic. XCTest still
  does not drive the real iOS Files picker sheet; if picker-specific UI behavior
  becomes product-critical, keep that as a narrower future check.
- History detail coverage uses a fake-runtime prompt marker to create a deferred
  command output item, then opens the completed thread in WebView mode and invokes
  the same adapter detail loader used by the shared UI. Visible WKWebView tap
  coverage now taps the shared `Expand command history item` accordion trigger and
  `Open full command` button, then verifies the selected full output through the
  native debug bridge. Fixture simulator coverage also clicks the production DOM
  buttons for visible `tool_call`, `web_search`, and `file_read` detail rows and
  verifies their detail markers through the native debug bridge.
- Server-mode image asset coverage uses a fake-runtime prompt marker to create a
  real PNG under the test workspace, then opens the completed thread in WebView
  mode and waits for the browser image element to report `naturalWidth > 0`.
  Supervisor logs also show `/assets/image?...&token=...` returning 200. Relay
  image asset coverage now uses the same fake-runtime marker through the selected
  relay device route and verifies the WebView image load with
  `relaySession=...`.
```

## Phase 4: Testing And Regression Coverage

Goal: keep the WebView route from becoming another hard-to-debug UI surface.

Tasks:

- [x] Add TypeScript tests for iOS connection path generation.
- [x] Add TypeScript tests for iOS API client runtime/model/settings paths and
  auth behavior.
- [x] Add TypeScript tests for broader adapter request paths and auth behavior.
- [x] Add Swift unit tests for bootstrap JSON construction.
- [x] Add Swift unit tests for bridge message decoding.
- [x] Add iOS UI smoke for opening a fixture thread route in WebView mode.
- [x] Add at least one live local E2E smoke, matching existing iOS local/server
  or relay E2E style.
- [x] Add live local WebView refresh smoke against the fake E2E runtime.
- [x] Add live local WebView composer submit smoke against the fake E2E runtime.
- [x] Add live local WebView reasoning setting smoke against the fake E2E
  runtime.
- [x] Add live server WebView authenticated thread-detail smoke.
- [x] Add relay-server WebView CORS regression coverage.
- [x] Add live relay WebView forwarded thread-detail smoke.
- [x] Add live relay WebView composer submit smoke.
- [x] Add live local WebView WebSocket event refresh smoke.
- [x] Add live local WebView WebSocket incremental projection smoke without
  refresh fallback.
- [x] Add live relay WebView WebSocket incremental projection smoke without
  refresh fallback.
- [x] Add live local WebView foreground/background reconnect smoke.
- [x] Add live local WebView optimistic prompt render smoke.
- [x] Add live local WebView older history load smoke.
- [x] Add WebView pending-request responder fixture smoke for approval,
  question, and plan decision payloads.
- [x] Add WebView export-to-native-share fixture smoke.
- [x] Add WebView export visible custom-selection fixture smoke.
- [x] Add Swift bridge decode coverage for the native composer attachment picker.
- [x] Add Swift bridge decode coverage for WebView ready/debug/optimistic/error
  diagnostic messages.
- [x] Add live local WebView PDF export-to-native-share smoke.
- [x] Add live local WebView HTML export-to-native-share smoke.
- [x] Add live local WebView workspace tree and file preview smoke.
- [x] Add live local WebView visible workspace file controls smoke.
- [x] Add live local WebView deferred history detail smoke.
- [x] Add live local WebView visible history detail button smoke.
- [x] Add WebView fixture visible detail smoke for tool call, web search, and
  file read history rows.
- [x] Add live server WebView authenticated image asset smoke.
- [x] Add live relay WebView forwarded image asset smoke.
- [x] Add live local WebView fork latest and selected-turn smokes.
- [x] Add WebView thread-management smoke for rename/delete visibility, live
  local rename, and live local delete.
- [x] Add troubleshooting logs gated behind debug builds.

Acceptance:

- Local typecheck/build/test commands catch broken bundle or bridge contracts.
- UI test can prove the WebView route starts and displays thread content.
- Live smoke proves auth and refresh behavior against a real supervisor.

Evidence:

```text
Files:
- ../remote-codex-thread-ui/packages/thread-ui/src/components/ThreadComposer.tsx
- apps/ios/WebThread/src/IOSNativeBridge.ts
- apps/ios/WebThread/src/IOSBootstrap.ts
- apps/ios/WebThread/src/IOSThreadDetailPage.tsx
- apps/ios/RemoteCodex/Features/ThreadDetail/ThreadDetailWebBridge.swift
- apps/ios/RemoteCodex/Features/ThreadDetail/ThreadDetailWebViewScreen.swift
- apps/ios/WebThread/src/IOSConnection.test.ts
- apps/ios/WebThread/src/IOSApiClient.test.ts
- apps/ios/WebThread/src/IOSWebSocket.test.ts
- apps/ios/RemoteCodexUITests/RemoteCodexPendingRequestUITestSupport.swift
- apps/ios/RemoteCodexUITests/RemoteCodexExportUITestSupport.swift
- apps/ios/RemoteCodexUITests/RemoteCodexWorkspaceFileUITestSupport.swift
- apps/ios/RemoteCodexUITests/RemoteCodexUITests.swift
- apps/relay-server/src/app.ts
- apps/relay-server/src/app.test.ts
- apps/supervisor-api/src/app.ts
- apps/supervisor-api/src/app.test.ts
- apps/supervisor-api/src/e2e-fake-runtime.ts
Verification:
- pnpm --filter @remote-codex/ios-thread-web typecheck
- pnpm --filter @remote-codex/ios-thread-web build
- pnpm --filter @remote-codex/ios-thread-web test
- pnpm --dir ../remote-codex-thread-ui --filter @remote-codex/thread-ui typecheck
- pnpm --dir ../remote-codex-thread-ui --filter @remote-codex/thread-ui build
- xcodebuild test -project apps/ios/RemoteCodex.xcodeproj -scheme RemoteCodex
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
  -only-testing:RemoteCodexTests/ThreadDetailWebBridgeTests
  -parallel-testing-enabled NO
- xcodebuild test -project apps/ios/RemoteCodex.xcodeproj -scheme RemoteCodex
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
  -only-testing:RemoteCodexTests/ThreadDetailWebBootstrapTests
  -parallel-testing-enabled NO
- xcodebuild test -project apps/ios/RemoteCodex.xcodeproj -scheme RemoteCodex
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testThreadWebViewFixtureOpensVisibleHistoryDetailKinds
  -parallel-testing-enabled NO
- DATABASE_URL="$PWD/.local/ios-e2e/supervisor-ios-webview-rename-e2e.sqlite"
  WORKSPACE_ROOT="$PWD" HOST=127.0.0.1 PORT=8821 REMOTE_CODEX_MODE=local
  REMOTE_CODEX_E2E_FAKE_RUNTIME=1 REMOTE_CODEX_ENABLED_AGENT_PROVIDERS=claude
  REMOTE_CODEX_DISABLE_BUILD_RESTART=true REMOTE_CODEX_ENABLE_WEBVIEW_CORS=true
  pnpm --filter @remote-codex/supervisor-api exec tsx src/index.ts
- xcodebuild test -project apps/ios/RemoteCodex.xcodeproj -scheme RemoteCodex
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testLiveLocalThreadWebViewRenamesThreadThroughAdapter
  -parallel-testing-enabled NO
- DATABASE_URL="$PWD/.local/ios-e2e/supervisor-ios-webview-delete-e2e.sqlite"
  WORKSPACE_ROOT="$PWD" HOST=127.0.0.1 PORT=8824 REMOTE_CODEX_MODE=local
  REMOTE_CODEX_E2E_FAKE_RUNTIME=1 pnpm --filter
  @remote-codex/supervisor-api dev
- xcodebuild test -project apps/ios/RemoteCodex.xcodeproj -scheme RemoteCodex
  -destination 'platform=iOS Simulator,name=iPhone 17'
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testLiveLocalThreadWebViewDeletesThreadThroughAdapter
- xcodebuild test -project apps/ios/RemoteCodex.xcodeproj -scheme RemoteCodex
  -destination 'platform=iOS Simulator,id=B9E0BB3C-4FB0-4C86-A0E1-E578E1AFCBC9'
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testThreadWebViewFixtureLoadsSharedThreadUI
  -parallel-testing-enabled NO
- xcodebuild test -project apps/ios/RemoteCodex.xcodeproj -scheme RemoteCodex
  -destination 'platform=iOS Simulator,id=B9E0BB3C-4FB0-4C86-A0E1-E578E1AFCBC9'
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testLiveLocalThreadWebViewLoadsRealThreadDetail
  -parallel-testing-enabled NO
- DATABASE_URL="$PWD/.local/ios-e2e/supervisor-ios-webview-streaming-e2e.sqlite"
  WORKSPACE_ROOT="$PWD" HOST=127.0.0.1 PORT=8801 REMOTE_CODEX_MODE=local
  REMOTE_CODEX_E2E_FAKE_RUNTIME=1 REMOTE_CODEX_ENABLED_AGENT_PROVIDERS=claude
  REMOTE_CODEX_DISABLE_BUILD_RESTART=true REMOTE_CODEX_ENABLE_WEBVIEW_CORS=true
  pnpm --filter @remote-codex/supervisor-api exec tsx src/index.ts
- xcodebuild test -project apps/ios/RemoteCodex.xcodeproj -scheme RemoteCodex
  -destination 'platform=iOS Simulator,id=B9E0BB3C-4FB0-4C86-A0E1-E578E1AFCBC9'
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testLiveLocalThreadWebViewRefreshesAfterExternalPrompt
  -parallel-testing-enabled NO
- xcodebuild test -project apps/ios/RemoteCodex.xcodeproj -scheme RemoteCodex
  -destination 'platform=iOS Simulator,id=B9E0BB3C-4FB0-4C86-A0E1-E578E1AFCBC9'
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testLiveLocalThreadWebViewComposerSubmitsPromptAndRefreshesCompletion
  -parallel-testing-enabled NO
- xcodebuild test -project apps/ios/RemoteCodex.xcodeproj -scheme RemoteCodex
  -destination 'platform=iOS Simulator,id=B9E0BB3C-4FB0-4C86-A0E1-E578E1AFCBC9'
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testLiveLocalThreadWebViewReasoningSettingSubmitsPrompt
  -parallel-testing-enabled NO
- DATABASE_URL="$PWD/.local/ios-e2e/supervisor-ios-webview-server-e2e.sqlite"
  WORKSPACE_ROOT="$PWD" HOST=127.0.0.1 PORT=8802 REMOTE_CODEX_MODE=server
  REMOTE_CODEX_ADMIN_USERNAME=ios-admin REMOTE_CODEX_ADMIN_PASSWORD=ios-password
  REMOTE_CODEX_SESSION_SECRET=ios-e2e-session-secret
  REMOTE_CODEX_DISABLE_BUILD_RESTART=true REMOTE_CODEX_ENABLE_WEBVIEW_CORS=true
  pnpm --filter @remote-codex/supervisor-api exec tsx src/index.ts
- xcodebuild test -project apps/ios/RemoteCodex.xcodeproj -scheme RemoteCodex
  -destination 'platform=iOS Simulator,id=B9E0BB3C-4FB0-4C86-A0E1-E578E1AFCBC9'
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testLiveServerThreadWebViewLoadsAuthenticatedThreadDetail
  -parallel-testing-enabled NO
- pnpm --filter @remote-codex/relay-server typecheck
- pnpm --filter @remote-codex/relay-server test -- app.test.ts
- xcodebuild test -project apps/ios/RemoteCodex.xcodeproj -scheme RemoteCodex
  -destination 'platform=iOS Simulator,id=B9E0BB3C-4FB0-4C86-A0E1-E578E1AFCBC9'
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testLiveRelayThreadWebViewLoadsForwardedThreadDetail
  -parallel-testing-enabled NO
- xcodebuild test -project apps/ios/RemoteCodex.xcodeproj -scheme RemoteCodex
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testLiveRelayThreadWebViewSubmitsPromptThroughComposer
  -parallel-testing-enabled NO
- DATABASE_URL="$PWD/.local/ios-e2e/supervisor-ios-webview-ws-e2e.sqlite"
  WORKSPACE_ROOT="$PWD" HOST=127.0.0.1 PORT=8805 REMOTE_CODEX_MODE=local
  REMOTE_CODEX_E2E_FAKE_RUNTIME=1 REMOTE_CODEX_ENABLED_AGENT_PROVIDERS=claude
  REMOTE_CODEX_DISABLE_BUILD_RESTART=true REMOTE_CODEX_ENABLE_WEBVIEW_CORS=true
  pnpm --filter @remote-codex/supervisor-api exec tsx src/index.ts
- xcodebuild test -project apps/ios/RemoteCodex.xcodeproj -scheme RemoteCodex
  -destination 'platform=iOS Simulator,id=B9E0BB3C-4FB0-4C86-A0E1-E578E1AFCBC9'
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testLiveLocalThreadWebViewRefreshesFromWebSocketEvent
  -parallel-testing-enabled NO
- DATABASE_URL="$PWD/.local/ios-e2e/supervisor-ios-webview-ws-projection-e2e.sqlite"
  WORKSPACE_ROOT="$PWD" HOST=127.0.0.1 PORT=8818 REMOTE_CODEX_MODE=local
  REMOTE_CODEX_E2E_FAKE_RUNTIME=1 REMOTE_CODEX_ENABLED_AGENT_PROVIDERS=claude
  REMOTE_CODEX_DISABLE_BUILD_RESTART=true REMOTE_CODEX_ENABLE_WEBVIEW_CORS=true
  pnpm --filter @remote-codex/supervisor-api exec tsx src/index.ts
- REMOTE_CODEX_IOS_E2E_BASE_URL=http://127.0.0.1:8818
  xcodebuild test -project apps/ios/RemoteCodex.xcodeproj -scheme RemoteCodex
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testLiveLocalThreadWebViewProjectsWebSocketEventsWithoutRefreshFallback
  -parallel-testing-enabled NO
- REMOTE_CODEX_ADMIN_USERNAME=ios-relay-admin
  REMOTE_CODEX_ADMIN_PASSWORD=ios-relay-password
  REMOTE_CODEX_RELAY_SESSION_SECRET=ios-relay-ws-projection-secret
  REMOTE_CODEX_RELAY_DATA_DIR="$PWD/.local/ios-e2e/relay-ws-projection-server-data"
  REMOTE_CODEX_ENABLE_WEBVIEW_CORS=true HOST=127.0.0.1 PORT=8819
  pnpm --filter @remote-codex/relay-server exec tsx src/index.ts
- DATABASE_URL="$PWD/.local/ios-e2e/supervisor-ios-webview-relay-ws-projection-e2e.sqlite"
  WORKSPACE_ROOT="$PWD" REMOTE_CODEX_RELAY_SERVER_URL=ws://127.0.0.1:8819
  REMOTE_CODEX_RELAY_AGENT_TOKEN="<created relay device token>"
  REMOTE_CODEX_RELAY_SUPERVISOR_HOST=127.0.0.1
  REMOTE_CODEX_RELAY_SUPERVISOR_PORT=8820
  REMOTE_CODEX_DISABLE_BUILD_RESTART=true
  REMOTE_CODEX_ENABLE_WEBVIEW_CORS=true
  REMOTE_CODEX_E2E_FAKE_RUNTIME=1
  REMOTE_CODEX_ENABLED_AGENT_PROVIDERS=claude
  node bin/remote-codex.mjs relay-supervisor
- REMOTE_CODEX_IOS_E2E_RELAY_BASE_URL=http://127.0.0.1:8819
  xcodebuild test -project apps/ios/RemoteCodex.xcodeproj -scheme RemoteCodex
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testLiveRelayThreadWebViewProjectsWebSocketEventsWithoutRefreshFallback
  -parallel-testing-enabled NO
- DATABASE_URL="$PWD/.local/ios-e2e/supervisor-ios-webview-lifecycle-e2e.sqlite"
  WORKSPACE_ROOT="$PWD" HOST=127.0.0.1 PORT=8825 REMOTE_CODEX_MODE=local
  REMOTE_CODEX_E2E_FAKE_RUNTIME=1 REMOTE_CODEX_ENABLED_AGENT_PROVIDERS=claude
  REMOTE_CODEX_DISABLE_BUILD_RESTART=true REMOTE_CODEX_ENABLE_WEBVIEW_CORS=true
  pnpm --filter @remote-codex/supervisor-api exec tsx src/index.ts
- xcodebuild test -project apps/ios/RemoteCodex.xcodeproj -scheme RemoteCodex
  -destination 'platform=iOS Simulator,name=iPhone 17'
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testLiveLocalThreadWebViewReconnectsAfterBackgroundForeground
  -parallel-testing-enabled NO
- DATABASE_URL="$PWD/.local/ios-e2e/supervisor-ios-webview-optimistic-e2e.sqlite"
  WORKSPACE_ROOT="$PWD" HOST=127.0.0.1 PORT=8815 REMOTE_CODEX_MODE=local
  REMOTE_CODEX_E2E_FAKE_RUNTIME=1 REMOTE_CODEX_ENABLED_AGENT_PROVIDERS=claude
  REMOTE_CODEX_DISABLE_BUILD_RESTART=true REMOTE_CODEX_ENABLE_WEBVIEW_CORS=true
  pnpm --filter @remote-codex/supervisor-api exec tsx src/index.ts
- xcodebuild test -project apps/ios/RemoteCodex.xcodeproj -scheme RemoteCodex
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testLiveLocalThreadWebViewOptimisticallyRendersSubmittedPrompt
  -parallel-testing-enabled NO
- DATABASE_URL="$PWD/.local/ios-e2e/supervisor-ios-webview-older-history-e2e.sqlite"
  WORKSPACE_ROOT="$PWD" HOST=127.0.0.1 PORT=8816 REMOTE_CODEX_MODE=local
  REMOTE_CODEX_E2E_FAKE_RUNTIME=1 REMOTE_CODEX_ENABLED_AGENT_PROVIDERS=claude
  REMOTE_CODEX_DISABLE_BUILD_RESTART=true REMOTE_CODEX_ENABLE_WEBVIEW_CORS=true
  pnpm --filter @remote-codex/supervisor-api exec tsx src/index.ts
- xcodebuild test -project apps/ios/RemoteCodex.xcodeproj -scheme RemoteCodex
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testLiveLocalThreadWebViewLoadsOlderHistory
  -parallel-testing-enabled NO
- xcodebuild test -project apps/ios/RemoteCodex.xcodeproj -scheme RemoteCodex
  -destination 'platform=iOS Simulator,id=B9E0BB3C-4FB0-4C86-A0E1-E578E1AFCBC9'
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testPendingRequestFixtureAutoResolvesApprovalQuestionAndPlanDecisionThroughWebView
  -parallel-testing-enabled NO
- xcodebuild test -project apps/ios/RemoteCodex.xcodeproj -scheme RemoteCodex
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
  -only-testing:RemoteCodexTests/ThreadDetailWebBootstrapTests
  -parallel-testing-enabled NO
- xcodebuild test -project apps/ios/RemoteCodex.xcodeproj -scheme RemoteCodex
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
  -only-testing:RemoteCodexTests/ThreadDetailWebBridgeTests
  -parallel-testing-enabled NO
- xcodebuild test -project apps/ios/RemoteCodex.xcodeproj -scheme RemoteCodex
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testPendingRequestFixtureAutoResolvesApprovalQuestionAndPlanDecisionThroughWebView
  -parallel-testing-enabled NO
- xcodebuild build -project apps/ios/RemoteCodex.xcodeproj -scheme RemoteCodex
  -configuration Release -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
- xcodebuild test -project apps/ios/RemoteCodex.xcodeproj -scheme RemoteCodex
  -destination 'platform=iOS Simulator,id=B9E0BB3C-4FB0-4C86-A0E1-E578E1AFCBC9'
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testThreadWebViewFixtureExportsPDFToNativeShareLink
  -parallel-testing-enabled NO
- DATABASE_URL="$PWD/.local/ios-e2e/supervisor-ios-webview-live-export-e2e.sqlite"
  WORKSPACE_ROOT="$PWD" HOST=127.0.0.1 PORT=8806 REMOTE_CODEX_MODE=local
  REMOTE_CODEX_E2E_FAKE_RUNTIME=1 REMOTE_CODEX_ENABLED_AGENT_PROVIDERS=claude
  REMOTE_CODEX_DISABLE_BUILD_RESTART=true REMOTE_CODEX_ENABLE_WEBVIEW_CORS=true
  pnpm --filter @remote-codex/supervisor-api exec tsx src/index.ts
- xcodebuild test -project apps/ios/RemoteCodex.xcodeproj -scheme RemoteCodex
  -destination 'platform=iOS Simulator,id=B9E0BB3C-4FB0-4C86-A0E1-E578E1AFCBC9'
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testLiveLocalThreadWebViewExportsPDFToNativeShareLink
  -parallel-testing-enabled NO
- DATABASE_URL="$PWD/.local/ios-e2e/supervisor-ios-webview-workspace-actions-e2e.sqlite"
  WORKSPACE_ROOT="$PWD" HOST=127.0.0.1 PORT=8808 REMOTE_CODEX_MODE=local
  REMOTE_CODEX_DISABLE_BUILD_RESTART=true REMOTE_CODEX_ENABLE_WEBVIEW_CORS=true
  pnpm --filter @remote-codex/supervisor-api exec tsx src/index.ts
- xcodebuild test -project apps/ios/RemoteCodex.xcodeproj -scheme RemoteCodex
  -destination 'platform=iOS Simulator,id=B9E0BB3C-4FB0-4C86-A0E1-E578E1AFCBC9'
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testLiveLocalThreadWebViewLoadsWorkspaceTreeAndFilePreview
  -parallel-testing-enabled NO
- DATABASE_URL="$PWD/.local/ios-e2e/supervisor-ios-webview-visible-workspace-controls-e2e.sqlite"
  WORKSPACE_ROOT="$PWD" HOST=127.0.0.1 PORT=8813 REMOTE_CODEX_MODE=local
  REMOTE_CODEX_E2E_FAKE_RUNTIME=1 REMOTE_CODEX_ENABLED_AGENT_PROVIDERS=claude
  REMOTE_CODEX_DISABLE_BUILD_RESTART=true REMOTE_CODEX_ENABLE_WEBVIEW_CORS=true
  pnpm --filter @remote-codex/supervisor-api exec tsx src/index.ts
- xcodebuild test -project apps/ios/RemoteCodex.xcodeproj -scheme RemoteCodex
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testLiveLocalThreadWebViewClicksVisibleWorkspaceFileControls
  -parallel-testing-enabled NO
- DATABASE_URL="$PWD/.local/ios-e2e/supervisor-ios-webview-history-detail-e2e.sqlite"
  WORKSPACE_ROOT="$PWD" HOST=127.0.0.1 PORT=8801 REMOTE_CODEX_MODE=local
  REMOTE_CODEX_E2E_FAKE_RUNTIME=1 REMOTE_CODEX_ENABLED_AGENT_PROVIDERS=claude
  REMOTE_CODEX_DISABLE_BUILD_RESTART=true REMOTE_CODEX_ENABLE_WEBVIEW_CORS=true
  pnpm --filter @remote-codex/supervisor-api exec tsx src/index.ts
- xcodebuild test -project apps/ios/RemoteCodex.xcodeproj -scheme RemoteCodex
  -destination 'platform=iOS Simulator,id=B9E0BB3C-4FB0-4C86-A0E1-E578E1AFCBC9'
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testLiveLocalThreadWebViewLoadsDeferredHistoryDetail
  -parallel-testing-enabled NO
- DATABASE_URL="$PWD/.local/ios-e2e/supervisor-ios-webview-visible-history-detail-e2e.sqlite"
  WORKSPACE_ROOT="$PWD" HOST=127.0.0.1 PORT=8810 REMOTE_CODEX_MODE=local
  REMOTE_CODEX_E2E_FAKE_RUNTIME=1 REMOTE_CODEX_ENABLED_AGENT_PROVIDERS=claude
  REMOTE_CODEX_DISABLE_BUILD_RESTART=true REMOTE_CODEX_ENABLE_WEBVIEW_CORS=true
  pnpm --filter @remote-codex/supervisor-api exec tsx src/index.ts
- xcodebuild test -project apps/ios/RemoteCodex.xcodeproj -scheme RemoteCodex
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testLiveLocalThreadWebViewTapsVisibleHistoryDetailButton
- DATABASE_URL="$PWD/.local/ios-e2e/supervisor-ios-webview-image-asset-e2e.sqlite"
  WORKSPACE_ROOT="$PWD" HOST=127.0.0.1 PORT=8809 REMOTE_CODEX_MODE=server
  REMOTE_CODEX_ADMIN_USERNAME=ios-admin REMOTE_CODEX_ADMIN_PASSWORD=ios-password
  REMOTE_CODEX_SESSION_SECRET=ios-e2e-session-secret
  REMOTE_CODEX_E2E_FAKE_RUNTIME=1 REMOTE_CODEX_ENABLED_AGENT_PROVIDERS=claude
  REMOTE_CODEX_DISABLE_BUILD_RESTART=true REMOTE_CODEX_ENABLE_WEBVIEW_CORS=true
  pnpm --filter @remote-codex/supervisor-api exec tsx src/index.ts
- xcodebuild test -project apps/ios/RemoteCodex.xcodeproj -scheme RemoteCodex
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testLiveServerThreadWebViewLoadsAuthenticatedImageAsset
- DATABASE_URL="$PWD/.local/ios-e2e/supervisor-ios-webview-fork-e2e.sqlite"
  WORKSPACE_ROOT="$PWD" HOST=127.0.0.1 PORT=8812 REMOTE_CODEX_MODE=local
  REMOTE_CODEX_E2E_FAKE_RUNTIME=1 REMOTE_CODEX_ENABLED_AGENT_PROVIDERS=claude
  REMOTE_CODEX_DISABLE_BUILD_RESTART=true REMOTE_CODEX_ENABLE_WEBVIEW_CORS=true
  pnpm --filter @remote-codex/supervisor-api exec tsx src/index.ts
- xcodebuild test -project apps/ios/RemoteCodex.xcodeproj -scheme RemoteCodex
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testLiveLocalThreadWebViewForksLatestThroughVisibleControls
  -parallel-testing-enabled NO
- xcodebuild test -project apps/ios/RemoteCodex.xcodeproj -scheme RemoteCodex
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testLiveLocalThreadWebViewForksSelectedTurnThroughVisibleControls
  -parallel-testing-enabled NO
- pnpm --filter @remote-codex/supervisor-api typecheck
- pnpm --filter @remote-codex/supervisor-api test -- app.test.ts
Residual risk:
- Live local, live server, and live relay initial detail load are covered for
  WebView mode. Visible model, reasoning, Plan/collaboration, and sandbox
  prompt setting controls are covered. Core local and relay WebSocket stream
  projection is covered without refresh fallback; production still keeps refresh
  fallback for unprojected or edge event families.
- TypeScript adapter-path coverage includes relay selected-device thread-detail
  REST forwarding with Bearer auth, relay session-only REST/WebSocket fallback,
  prompt submit JSON body/client request id, workspace tree/preview/download/
  upload/write, history detail, transcript export, raw file URLs, and
  authenticated image asset URLs.
- Live local and relay fake-runtime refresh/projection paths are covered for
  WebView mode after an external prompt. The no-refresh-fallback projection
  smokes prove `IOS_STREAM_COMPLETED` can render from projected WebSocket events
  alone in both transport modes.
- Live local fake-runtime composer submit is covered for WebView mode with a
  default prompt. This proves the shared composer to adapter to supervisor path,
  but not every composer menu or setting.
- Live local fake-runtime reasoning setting submit is covered for WebView mode.
  The test updates the setting through the WebView API client before prompt
  submission, then verifies the supervisor thread detail reports
  `reasoningEffort=high`.
- Live local visible settings controls are covered for WebView mode. The test
  clicks the shared WebView model, reasoning, and Plan controls,
  verifies the supervisor thread detail reports `model=ios-e2e-alt`,
  `reasoningEffort=high` and `collaborationMode=plan`, then submits a prompt through the shared
  composer.
- Live server WebView authenticated detail load is covered. The test verifies
  unauthenticated `/api/workspaces` returns 401, logs in through
  `/api/auth/login`, creates a workspace/thread with Bearer auth, opens the
  thread in WebView mode, and waits for the WebView-provided native navigation
  title.
- Live relay WebView forwarded detail load is covered. The test creates a relay
  user/device, waits for the private supervisor tunnel, creates a workspace and
  thread through `/relay/devices/:deviceId/api/...`, opens the thread in WebView
  mode, and waits for the WebView-provided native navigation title.
- Live relay WebView composer submit is covered. The test creates a relay
  user/device, waits for the private supervisor tunnel with
  `REMOTE_CODEX_E2E_FAKE_RUNTIME=1`, opens the thread in WebView mode, types a
  prompt into the shared composer, taps `Send Prompt`, then verifies the
  forwarded relay thread detail contains both the prompt and
  `IOS_STREAM_COMPLETED` before checking the WebView transcript.
- Live local WebView WebSocket event refresh is covered. The test waits for
  `ws:open`, triggers an external prompt, waits for a `ws:thread.*` debug
  marker from the WebView subscription, and verifies the completed transcript
  renders.
- Live local foreground/background lifecycle is covered. The test opens a
  WebView thread, verifies the initial `ws:open`, sends the app to the home
  screen, activates it again, accepts either a preserved single socket or one
  reconnect, then sends another prompt and verifies a post-foreground
  `ws:thread.*` event plus the completed transcript. It also asserts that the
  WebView does not render `IOS_STREAM_COMPLETEDIOS_STREAM_COMPLETED`, guarding
  against duplicate sockets after lifecycle transitions.
- Live local optimistic prompt rendering is covered. The WebView creates a
  local in-progress turn before the POST returns, exposes a stable native marker
  for the submitted prompt, verifies the prompt is visible in the shared thread
  UI, then waits for the fake runtime's completed transcript. This catches
  regressions where composer submit waits for a full refresh before showing the
  user message.
- Live local older history loading is covered. The fake runtime creates a
  45-turn transcript for prompt marker `IOS_HISTORY_PAGE_45`; the WebView opens
  the thread with the default 30-turn page, triggers the production older-history
  controller from a test-only bootstrap flag, observes
  `history-page:loaded:40:45`, and verifies `IOS_HISTORY_PAGE_TURN_6` renders.
- WebView pending request responder is covered by a fixture simulator smoke.
  The test launches the bundled WebView fixture with a test-only auto-resolve
  bootstrap flag and waits for the bridge marker proving approval, question,
  and plan decision requests went through the WebView responder path.
- WebView export-to-native-share is covered by fixture simulator smokes. The
  tests launch the bundled WebView fixture with test-only auto-export flags and
  wait for the native `Share ios-webview-fixture.pdf` and
  `Share ios-webview-fixture.html` actions.
- WebView export visible custom selection is covered by a fixture simulator
  smoke. It launches the bundled WebView fixture with a test-only visible-click
  bootstrap flag, clicks the shared export dialog controls for custom HTML
  selection, selects a single turn, and waits for both a WebView debug marker
  and native `Share ios-webview-fixture.html` action.
- Live local WebView PDF/HTML export-to-native-share is covered. The tests
  create a fake-runtime thread, wait for completion, open it in WebView mode
  with test-only auto-export flags, verify the supervisor export requests
  succeed, and wait for native share entries containing the exported thread
  slugs and `.html` for the HTML case.
- Live local WebView workspace tree, initial file preview, preview load-more,
  and file action adapters are covered. The test creates a workspace fixture
  containing `Sources/Long.txt`, opens its thread in WebView mode with a
  test-only focus path plus workspace action hooks, waits for adapter debug
  markers proving `tree?path=Sources`,
  `preview?path=Sources/Long.txt&limit=24000`, the next chunk at
  `offset=24000&limit=24000`, write/reread of
  `Sources/ios-webview-write.txt`, upload/reread of
  `Sources/ios-webview-upload.txt`, and download handoff for `Sources/Long.txt`.
  The hooks exercise the same WebView adapter methods used by the shared UI
  controls.
- Live local WebView visible workspace control coverage now clicks the shared UI
  edit/save/download/raw-preview/upload controls in a real WebView. Upload is
  covered through the shared UI `ThreadWorkspaceAdapter.pickUploadFile` native
  picker hook. The simulator smoke uses a test-only Swift auto response to
  return a deterministic `File` to the WebView; real iOS Files picker sheet
  automation remains a separate optional check if picker-specific behavior needs
  coverage.
- Live local WebView deferred history detail loading is covered. The fake runtime
  creates a completed command item with deferred detail for prompt marker
  `IOS_HISTORY_DETAIL`, the WebView opens the completed thread with a test-only
  auto-load flag, calls the production history detail adapter, and waits for a
  bridge debug marker proving `IOS_HISTORY_DETAIL_FULL_OUTPUT` was loaded. Visible
  command history detail tap is also covered by a separate simulator smoke: it
  taps the shared accordion trigger and `Open full command` button, observes the
  production `/items/:itemId/detail` request, and waits for
  `history-detail-selected:*:Command Output:true`.
- Live server WebView authenticated image asset loading is covered. The fake
  runtime creates a completed image item for prompt marker `IOS_IMAGE_ASSET`, the
  WebView builds the image URL through the iOS API client with `?token=...`, and
  the test waits for `image-asset:loaded:true` after the DOM image reports a
  natural width. Live relay WebView image asset loading is also covered; the
  smoke creates the same completed image item through
  `/relay/devices/:deviceId/api/...`, then verifies
  `image-asset:loaded:true` for an image URL carrying `relaySession=...`.
- Live local WebView fork latest and selected-turn flows are covered. The fake
  runtime exposes the `/fork` backend toolbox item, the WebView clicks the
  shared slash toolbox and fork controls, calls `/fork` with either
  `{mode:"latest"}` or `{mode:"turn", turnId}`, reloads the native WebView route
  to the forked thread, and verifies the source thread activity note records the
  expected `turnIndex`.
- Swift bridge/bootstrap decoding has focused unit coverage. Bootstrap tests
  verify connection, UI-test fields, and JSON escaping. Bridge tests cover
  navigation/open, share download, native picker, ready/debug/optimistic/error
  diagnostics, and unreadable message rejection.
```

## Phase 5: Rollout And Native UI Retirement

Goal: move web thread UI to the default path and shrink native thread UI
maintenance.

Tasks:

- [x] Turn WebView thread UI on by default for debug or TestFlight builds.
- [x] Keep the native branch behind a setting or launch argument during the
  migration window, then remove it in Phase 5.
- [x] Collect a short bug list comparing native vs WebView mode.
- [x] Remove duplicated native thread UI code only after WebView mode covers the
  critical workflows.
- [x] Keep protocol/client code that is still used by Home, Workspace, Relay, or
  tests.
- [x] Update `docs/ios-native-app-implementation-plan.zh.md` to mark native
  thread detail as superseded by this migration.

Acceptance:

- Default iOS thread route uses WebView mode.
- Native fallback is removed with tests updated.
- No app-wide connection or route restoration regression.

Short native-vs-WebView bug list:

- Native Thread detail has the highest bug surface because it duplicates thread
  projection, timeline rich rendering, composer behavior, settings controls,
  history detail, export, workspace side panel, pending requests, and fork
  flows that already exist in shared web UI.
- WebView mode now covers the critical workflows with live local/server/relay
  smokes, including relay selected-device composer submit. Composer photo/file
  attachments use a native `fileImporter` bridge; workspace panel upload uses
  the same native picker bridge through the shared UI `pickUploadFile` adapter
  hook, with browser file input retained as the non-native fallback.
- WebView incremental WebSocket projection now covers the core local and relay
  live turn stream without refresh fallback. Refresh-after-event remains as the
  production safety net for unprojected or less common event families.
- WebView visible-control coverage is broad for settings, Plan/collaboration,
  sandbox, workspace actions, history detail, fork, export, pending requests,
  optimistic prompt, older history, and relay image assets. The remaining
  low-priority parity gap is expanding no-refresh-fallback projection beyond
  the core turn stream into less common event families.

Evidence:

```text
Files:
- apps/ios/RemoteCodex/App/RootView.swift
- apps/ios/RemoteCodex/Core/API/PendingRequestAnswerDraft.swift
- apps/ios/RemoteCodex/Features/ThreadDetail/ThreadDetailWebViewScreen.swift
- apps/ios/RemoteCodex/Features/ThreadDetail/ThreadDetailWebBridge.swift
- apps/ios/RemoteCodexUITests/RemoteCodexUITests.swift
- apps/ios/README.md
- docs/ios-native-app-implementation-plan.zh.md
Verification:
- xcodegen generate --spec project.yml
- pnpm --filter @remote-codex/ios-thread-web test -- IOSApiClient
- xcodebuild test -project apps/ios/RemoteCodex.xcodeproj -scheme RemoteCodex
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
  -only-testing:RemoteCodexTests/ThreadDetailWebBootstrapTests
  -only-testing:RemoteCodexTests/ThreadDetailWebBridgeTests
  -only-testing:RemoteCodexTests/SupervisorThreadAPIClientTests
  -only-testing:RemoteCodexTests/PendingRequestAnswerDraftTests
  -parallel-testing-enabled NO
- xcodebuild test -project apps/ios/RemoteCodex.xcodeproj -scheme RemoteCodex
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testThreadWebViewFixtureRendersTimelineAndPendingRequestContent
  -parallel-testing-enabled NO
- xcodebuild test -project apps/ios/RemoteCodex.xcodeproj -scheme RemoteCodex
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testLiveLocalHomeWorkspaceAndWebThreadRoute
  -parallel-testing-enabled NO
  (with local fake-runtime supervisor on http://127.0.0.1:8827 and
  REMOTE_CODEX_ENABLE_WEBVIEW_CORS=true)
- xcodebuild test -project apps/ios/RemoteCodex.xcodeproj -scheme RemoteCodex
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testLiveRelayThreadWebViewLoadsForwardedImageAsset
  -parallel-testing-enabled NO
- git diff --check
Residual risk:
- Native SwiftUI Thread detail and native projection code have been removed.
  Shared protocol/client code remains for Home, Workspace, Relay, WebView
  bootstrap, and tests.
- Existing WebView live server and relay detail plus image-asset smokes remain
  the evidence for authenticated and forwarded modes; this phase verifies the
  default local Home -> Workspace -> Thread route with no native branch.
```

## Verification Commands

Exact simulator names may differ by machine. Prefer the existing iOS e2e skill
or project README if it specifies a current destination.

```bash
pnpm --filter @remote-codex/ios-thread-web typecheck
pnpm --filter @remote-codex/ios-thread-web build
pnpm --filter @remote-codex/ios-thread-web test
xcodebuild test -project apps/ios/RemoteCodex.xcodeproj -scheme RemoteCodex -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
```

If `../remote-codex-thread-ui` is edited:

```bash
pnpm --dir ../remote-codex-thread-ui --filter @remote-codex/thread-ui typecheck
pnpm --dir ../remote-codex-thread-ui --filter @remote-codex/thread-ui build
```

If supervisor-web behavior is used as a reference:

```bash
pnpm --filter @remote-codex/supervisor-web typecheck
pnpm --filter @remote-codex/supervisor-web test -- ThreadDetailPage
```

## Known Risks

- `WKWebView` local file loading can break asset paths if Vite emits absolute
  URLs. Keep bundle output relative.
- Long-lived auth token exposure to JS is acceptable for a first local spike but
  should be revisited before broad distribution.
- Composer attachment picking uses a JS-to-Swift `fileImporter` bridge and
  falls back to the browser file input when no native bridge exists. Workspace
  panel upload now uses the same native picker request/result bridge through
  `ThreadWorkspaceAdapter.pickUploadFile`, with shared WebView file input kept
  as the browser fallback. The automated iOS smoke verifies a deterministic
  test-only picker response; manual real Files picker QA is still useful before
  broad release.
- Transcript export and workspace download now use the native share bridge.
  Additional download surfaces should continue to use the same bridge instead
  of relying on WebView default download behavior.
- WebSocket lifecycle handling is covered by the foreground/background simulator
  smoke. Continue preserving its single-stream invariant when changing WebView
  scene, visibility, or socket code.
- WebView local-file fetches require explicit host permission. The current
  slice uses `allowUniversalAccessFromFileURLs`, iOS ATS web-content allowance,
  supervisor CORS gated by `REMOTE_CODEX_ENABLE_WEBVIEW_CORS=true`, and
  relay-server CORS gated by the same environment variable.
- Mobile layout may need targeted `@remote-codex/thread-ui` fixes. If those touch
  sibling package source, rebuild and validate through the package boundary.
- If iOS shell/terminal is enabled, xterm sizing and keyboard behavior need
  separate QA.

## Completion Rule For Goal Mode

Do not check a task only because a plan exists. Check a task after code,
verification, and an evidence note are present. If a task turns out too broad,
split it in this document before implementing it.

When reporting progress, include:

```text
Completed:
- <checked tasks>
Verification:
- <commands run, exact simulator destination, and manual smoke result if any>
Next:
- <smallest remaining task>
Blocked:
- <only if genuinely blocked>
```
