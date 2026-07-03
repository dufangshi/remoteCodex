# Remote Codex iOS

Native SwiftUI client for Remote Codex.

## Generate Project

```bash
cd apps/ios
xcodegen generate
```

## Test

```bash
swiftformat RemoteCodex RemoteCodexTests RemoteCodexUITests --config .swiftformat
swiftlint lint --config .swiftlint.yml RemoteCodex RemoteCodexTests RemoteCodexUITests
```

```bash
xcodebuild test \
  -project RemoteCodex.xcodeproj \
  -scheme RemoteCodex \
  -destination 'platform=iOS Simulator,id=B9E0BB3C-4FB0-4C86-A0E1-E578E1AFCBC9' \
  | xcbeautify
```

## Local Simulator Smoke

Thread detail routes use the bundled WebView thread UI. The old native SwiftUI
thread detail fallback has been retired, so the live local route smoke verifies
Home -> Workspace -> Thread navigation opens the WebView surface.

Start an isolated local supervisor from the repository root:

```bash
mkdir -p .local/ios-e2e
DATABASE_URL="$PWD/.local/ios-e2e/supervisor-ios-e2e-local.sqlite" \
  WORKSPACE_ROOT="$PWD" \
  HOST=127.0.0.1 \
  PORT=8797 \
  REMOTE_CODEX_MODE=local \
  REMOTE_CODEX_DISABLE_BUILD_RESTART=true \
  pnpm --filter @remote-codex/supervisor-api exec tsx src/index.ts
```

Then run the live Local UI smoke from another shell:

```bash
printf 'http://127.0.0.1:8797' > .local/ios-e2e/base-url.txt
cd apps/ios
xcodebuild test \
  -project RemoteCodex.xcodeproj \
  -scheme RemoteCodex \
  -destination 'platform=iOS Simulator,id=B9E0BB3C-4FB0-4C86-A0E1-E578E1AFCBC9' \
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testLiveLocalHomeWorkspaceAndWebThreadRoute \
  -parallel-testing-enabled NO \
  | xcbeautify
rm -f ../../.local/ios-e2e/base-url.txt
```

The same local supervisor can run the workspace files smoke:

```bash
printf 'http://127.0.0.1:8797' > .local/ios-e2e/base-url.txt
cd apps/ios
xcodebuild test \
  -project RemoteCodex.xcodeproj \
  -scheme RemoteCodex \
  -destination 'platform=iOS Simulator,id=B9E0BB3C-4FB0-4C86-A0E1-E578E1AFCBC9' \
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testLiveLocalWorkspaceFilesRoundTripTreePreviewDownloadUpload \
  -parallel-testing-enabled NO \
  | xcbeautify
rm -f ../../.local/ios-e2e/base-url.txt
```

For the iOS Thread WebView live local smoke, start the supervisor with WebView
CORS enabled:

```bash
mkdir -p .local/ios-e2e
DATABASE_URL="$PWD/.local/ios-e2e/supervisor-ios-webview-e2e.sqlite" \
  WORKSPACE_ROOT="$PWD" \
  HOST=127.0.0.1 \
  PORT=8797 \
  REMOTE_CODEX_MODE=local \
  REMOTE_CODEX_DISABLE_BUILD_RESTART=true \
  REMOTE_CODEX_ENABLE_WEBVIEW_CORS=true \
  pnpm --filter @remote-codex/supervisor-api exec tsx src/index.ts
```

Then run the WebView route smoke from another shell:

```bash
printf 'http://127.0.0.1:8797' > .local/ios-e2e/base-url.txt
cd apps/ios
xcodebuild test \
  -project RemoteCodex.xcodeproj \
  -scheme RemoteCodex \
  -destination 'platform=iOS Simulator,id=B9E0BB3C-4FB0-4C86-A0E1-E578E1AFCBC9' \
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testLiveLocalThreadWebViewLoadsRealThreadDetail \
  -parallel-testing-enabled NO \
  | xcbeautify
rm -f ../../.local/ios-e2e/base-url.txt
```

For a deterministic Thread WebView refresh smoke, start the supervisor with the
fake E2E runtime and WebView CORS enabled:

```bash
mkdir -p .local/ios-e2e
DATABASE_URL="$PWD/.local/ios-e2e/supervisor-ios-webview-streaming-e2e.sqlite" \
  WORKSPACE_ROOT="$PWD" \
  HOST=127.0.0.1 \
  PORT=8801 \
  REMOTE_CODEX_MODE=local \
  REMOTE_CODEX_E2E_FAKE_RUNTIME=1 \
  REMOTE_CODEX_ENABLED_AGENT_PROVIDERS=claude \
  REMOTE_CODEX_DISABLE_BUILD_RESTART=true \
  REMOTE_CODEX_ENABLE_WEBVIEW_CORS=true \
  pnpm --filter @remote-codex/supervisor-api exec tsx src/index.ts
```

Then run the WebView refresh smoke from another shell:

```bash
printf 'http://127.0.0.1:8801' > .local/ios-e2e/base-url.txt
cd apps/ios
xcodebuild test \
  -project RemoteCodex.xcodeproj \
  -scheme RemoteCodex \
  -destination 'platform=iOS Simulator,id=B9E0BB3C-4FB0-4C86-A0E1-E578E1AFCBC9' \
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testLiveLocalThreadWebViewRefreshesAfterExternalPrompt \
  -parallel-testing-enabled NO \
  | xcbeautify
rm -f ../../.local/ios-e2e/base-url.txt
```

The same supervisor can run the WebView composer submit smoke:

```bash
printf 'http://127.0.0.1:8801' > .local/ios-e2e/base-url.txt
cd apps/ios
xcodebuild test \
  -project RemoteCodex.xcodeproj \
  -scheme RemoteCodex \
  -destination 'platform=iOS Simulator,id=B9E0BB3C-4FB0-4C86-A0E1-E578E1AFCBC9' \
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testLiveLocalThreadWebViewComposerSubmitsPromptAndRefreshesCompletion \
  -parallel-testing-enabled NO \
  | xcbeautify
rm -f ../../.local/ios-e2e/base-url.txt
```

The same supervisor can run the WebView WebSocket refresh smoke:

```bash
printf 'http://127.0.0.1:8801' > .local/ios-e2e/base-url.txt
cd apps/ios
xcodebuild test \
  -project RemoteCodex.xcodeproj \
  -scheme RemoteCodex \
  -destination 'platform=iOS Simulator,id=B9E0BB3C-4FB0-4C86-A0E1-E578E1AFCBC9' \
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testLiveLocalThreadWebViewRefreshesFromWebSocketEvent \
  -parallel-testing-enabled NO \
  | xcbeautify
rm -f ../../.local/ios-e2e/base-url.txt
```

The same supervisor can run the WebView reasoning setting smoke:

```bash
printf 'http://127.0.0.1:8801' > .local/ios-e2e/base-url.txt
cd apps/ios
xcodebuild test \
  -project RemoteCodex.xcodeproj \
  -scheme RemoteCodex \
  -destination 'platform=iOS Simulator,id=B9E0BB3C-4FB0-4C86-A0E1-E578E1AFCBC9' \
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testLiveLocalThreadWebViewReasoningSettingSubmitsPrompt \
  -parallel-testing-enabled NO \
  | xcbeautify
rm -f ../../.local/ios-e2e/base-url.txt
```

The same supervisor can run the live WebView PDF export-to-native-share smoke:

```bash
printf 'http://127.0.0.1:8801' > .local/ios-e2e/base-url.txt
cd apps/ios
xcodebuild test \
  -project RemoteCodex.xcodeproj \
  -scheme RemoteCodex \
  -destination 'platform=iOS Simulator,id=B9E0BB3C-4FB0-4C86-A0E1-E578E1AFCBC9' \
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testLiveLocalThreadWebViewExportsPDFToNativeShareLink \
  -parallel-testing-enabled NO \
  | xcbeautify
rm -f ../../.local/ios-e2e/base-url.txt
```

The same supervisor can run the live WebView HTML export-to-native-share smoke:

```bash
printf 'http://127.0.0.1:8801' > .local/ios-e2e/base-url.txt
cd apps/ios
xcodebuild test \
  -project RemoteCodex.xcodeproj \
  -scheme RemoteCodex \
  -destination 'platform=iOS Simulator,id=B9E0BB3C-4FB0-4C86-A0E1-E578E1AFCBC9' \
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testLiveLocalThreadWebViewExportsHTMLToNativeShareLink \
  -parallel-testing-enabled NO \
  | xcbeautify
rm -f ../../.local/ios-e2e/base-url.txt
```

The same supervisor can run the WebView workspace tree, file preview,
preview load-more, and workspace file action smoke:

```bash
printf 'http://127.0.0.1:8801' > .local/ios-e2e/base-url.txt
cd apps/ios
xcodebuild test \
  -project RemoteCodex.xcodeproj \
  -scheme RemoteCodex \
  -destination 'platform=iOS Simulator,id=B9E0BB3C-4FB0-4C86-A0E1-E578E1AFCBC9' \
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testLiveLocalThreadWebViewLoadsWorkspaceTreeAndFilePreview \
  -parallel-testing-enabled NO \
  | xcbeautify
rm -f ../../.local/ios-e2e/base-url.txt
```

The same supervisor can run the WebView deferred history detail smoke:

```bash
printf 'http://127.0.0.1:8801' > .local/ios-e2e/base-url.txt
cd apps/ios
xcodebuild test \
  -project RemoteCodex.xcodeproj \
  -scheme RemoteCodex \
  -destination 'platform=iOS Simulator,id=B9E0BB3C-4FB0-4C86-A0E1-E578E1AFCBC9' \
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testLiveLocalThreadWebViewLoadsDeferredHistoryDetail \
  -parallel-testing-enabled NO \
  | xcbeautify
rm -f ../../.local/ios-e2e/base-url.txt
```

The visible history detail button smoke uses the same kind of fake-runtime
supervisor and taps the shared WebView command controls:

```bash
mkdir -p .local/ios-e2e
DATABASE_URL="$PWD/.local/ios-e2e/supervisor-ios-webview-visible-history-detail-e2e.sqlite" \
  WORKSPACE_ROOT="$PWD" \
  HOST=127.0.0.1 \
  PORT=8810 \
  REMOTE_CODEX_MODE=local \
  REMOTE_CODEX_E2E_FAKE_RUNTIME=1 \
  REMOTE_CODEX_ENABLED_AGENT_PROVIDERS=claude \
  REMOTE_CODEX_DISABLE_BUILD_RESTART=true \
  REMOTE_CODEX_ENABLE_WEBVIEW_CORS=true \
  pnpm --filter @remote-codex/supervisor-api exec tsx src/index.ts
```

Then run the visible history detail tap smoke from another shell:

```bash
printf 'http://127.0.0.1:8810' > .local/ios-e2e/base-url.txt
cd apps/ios
xcodebuild test \
  -project RemoteCodex.xcodeproj \
  -scheme RemoteCodex \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testLiveLocalThreadWebViewTapsVisibleHistoryDetailButton \
  -parallel-testing-enabled NO \
  | xcbeautify
rm -f ../../.local/ios-e2e/base-url.txt
```

For a deterministic local streaming smoke, start the supervisor with the fake E2E runtime:

```bash
mkdir -p .local/ios-e2e
DATABASE_URL="$PWD/.local/ios-e2e/supervisor-ios-e2e-streaming.sqlite" \
  WORKSPACE_ROOT="$PWD" \
  HOST=127.0.0.1 \
  PORT=8799 \
  REMOTE_CODEX_MODE=local \
  REMOTE_CODEX_E2E_FAKE_RUNTIME=1 \
  REMOTE_CODEX_ENABLED_AGENT_PROVIDERS=claude \
  REMOTE_CODEX_DISABLE_BUILD_RESTART=true \
  pnpm --filter @remote-codex/supervisor-api exec tsx src/index.ts
```

Then run the streaming UI smoke from another shell:

```bash
printf 'http://127.0.0.1:8799' > .local/ios-e2e/base-url.txt
cd apps/ios
xcodebuild test \
  -project RemoteCodex.xcodeproj \
  -scheme RemoteCodex \
  -destination 'platform=iOS Simulator,id=B9E0BB3C-4FB0-4C86-A0E1-E578E1AFCBC9' \
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testLiveLocalStreamingPromptRendersDeltaAndCompletion \
  -parallel-testing-enabled NO \
  | xcbeautify
rm -f ../../.local/ios-e2e/base-url.txt
```

The same deterministic supervisor can run the pending-request round-trip smoke:

```bash
printf 'http://127.0.0.1:8799' > .local/ios-e2e/base-url.txt
cd apps/ios
xcodebuild test \
  -project RemoteCodex.xcodeproj \
  -scheme RemoteCodex \
  -destination 'platform=iOS Simulator,id=B9E0BB3C-4FB0-4C86-A0E1-E578E1AFCBC9' \
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testLiveLocalPendingRequestsSubmitApprovalQuestionAndPlanDecision \
  -parallel-testing-enabled NO \
  | xcbeautify
rm -f ../../.local/ios-e2e/base-url.txt
```

The pending-request WebView responder fixture smoke does not need a supervisor:

```bash
cd apps/ios
xcodebuild test \
  -project RemoteCodex.xcodeproj \
  -scheme RemoteCodex \
  -destination 'platform=iOS Simulator,id=B9E0BB3C-4FB0-4C86-A0E1-E578E1AFCBC9' \
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testPendingRequestFixtureAutoResolvesApprovalQuestionAndPlanDecisionThroughWebView \
  -parallel-testing-enabled NO \
  | xcbeautify
```

The export fixture UI smoke covers PDF and HTML custom-turn export plus the saved share entry:

```bash
cd apps/ios
xcodebuild test \
  -project RemoteCodex.xcodeproj \
  -scheme RemoteCodex \
  -destination 'platform=iOS Simulator,id=B9E0BB3C-4FB0-4C86-A0E1-E578E1AFCBC9' \
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testThreadExportFixtureExportsPDFAndHTMLCustomTurns \
  -parallel-testing-enabled NO \
  | xcbeautify
```

The WebView export fixture smoke covers the JS export bridge into the native share handoff:

```bash
cd apps/ios
xcodebuild test \
  -project RemoteCodex.xcodeproj \
  -scheme RemoteCodex \
  -destination 'platform=iOS Simulator,id=B9E0BB3C-4FB0-4C86-A0E1-E578E1AFCBC9' \
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testThreadWebViewFixtureExportsPDFToNativeShareLink \
  -parallel-testing-enabled NO \
  | xcbeautify
```

The HTML variant uses the same bridge with a test-only export-format flag:

```bash
cd apps/ios
xcodebuild test \
  -project RemoteCodex.xcodeproj \
  -scheme RemoteCodex \
  -destination 'platform=iOS Simulator,id=B9E0BB3C-4FB0-4C86-A0E1-E578E1AFCBC9' \
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testThreadWebViewFixtureExportsHTMLToNativeShareLink \
  -parallel-testing-enabled NO \
  | xcbeautify
```

The deterministic supervisor can also run the relaunch restoration smoke:

```bash
printf 'http://127.0.0.1:8799' > .local/ios-e2e/base-url.txt
cd apps/ios
xcodebuild test \
  -project RemoteCodex.xcodeproj \
  -scheme RemoteCodex \
  -destination 'platform=iOS Simulator,id=B9E0BB3C-4FB0-4C86-A0E1-E578E1AFCBC9' \
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testLiveLocalRelaunchRestoresHomeWorkspaceAndThreadByConnectionKey \
  -parallel-testing-enabled NO \
  | xcbeautify
rm -f ../../.local/ios-e2e/base-url.txt
```

## Server Simulator Smoke

Start an isolated server-mode supervisor from the repository root:

```bash
mkdir -p .local/ios-e2e
DATABASE_URL="$PWD/.local/ios-e2e/supervisor-ios-e2e-server.sqlite" \
  WORKSPACE_ROOT="$PWD" \
  HOST=127.0.0.1 \
  PORT=8798 \
  REMOTE_CODEX_MODE=server \
  REMOTE_CODEX_ADMIN_USERNAME=ios-admin \
  REMOTE_CODEX_ADMIN_PASSWORD=ios-password \
  REMOTE_CODEX_SESSION_SECRET=ios-e2e-session-secret \
  REMOTE_CODEX_DISABLE_BUILD_RESTART=true \
  pnpm --filter @remote-codex/supervisor-api exec tsx src/index.ts
```

Then run the live Server UI smoke from another shell:

```bash
printf 'http://127.0.0.1:8798' > .local/ios-e2e/server-base-url.txt
cd apps/ios
REMOTE_CODEX_IOS_E2E_SERVER_USERNAME=ios-admin \
REMOTE_CODEX_IOS_E2E_SERVER_PASSWORD=ios-password \
xcodebuild test \
  -project RemoteCodex.xcodeproj \
  -scheme RemoteCodex \
  -destination 'platform=iOS Simulator,id=B9E0BB3C-4FB0-4C86-A0E1-E578E1AFCBC9' \
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testLiveServerConnectionAuthenticatesLoadsAndRestoresThread \
  -parallel-testing-enabled NO \
  | xcbeautify
rm -f ../../.local/ios-e2e/server-base-url.txt
```

For the iOS Thread WebView server smoke, start a server-mode supervisor with
WebView CORS enabled:

```bash
mkdir -p .local/ios-e2e
DATABASE_URL="$PWD/.local/ios-e2e/supervisor-ios-webview-server-e2e.sqlite" \
  WORKSPACE_ROOT="$PWD" \
  HOST=127.0.0.1 \
  PORT=8802 \
  REMOTE_CODEX_MODE=server \
  REMOTE_CODEX_ADMIN_USERNAME=ios-admin \
  REMOTE_CODEX_ADMIN_PASSWORD=ios-password \
  REMOTE_CODEX_SESSION_SECRET=ios-e2e-session-secret \
  REMOTE_CODEX_DISABLE_BUILD_RESTART=true \
  REMOTE_CODEX_ENABLE_WEBVIEW_CORS=true \
  pnpm --filter @remote-codex/supervisor-api exec tsx src/index.ts
```

Then run the WebView server route smoke from another shell:

```bash
printf 'http://127.0.0.1:8802' > .local/ios-e2e/server-base-url.txt
cd apps/ios
xcodebuild test \
  -project RemoteCodex.xcodeproj \
  -scheme RemoteCodex \
  -destination 'platform=iOS Simulator,id=B9E0BB3C-4FB0-4C86-A0E1-E578E1AFCBC9' \
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testLiveServerThreadWebViewLoadsAuthenticatedThreadDetail \
  -parallel-testing-enabled NO \
  | xcbeautify
rm -f ../../.local/ios-e2e/server-base-url.txt
```

For the authenticated WebView image asset smoke, start a server-mode supervisor
with the fake E2E runtime and WebView CORS enabled:

```bash
mkdir -p .local/ios-e2e
DATABASE_URL="$PWD/.local/ios-e2e/supervisor-ios-webview-image-asset-e2e.sqlite" \
  WORKSPACE_ROOT="$PWD" \
  HOST=127.0.0.1 \
  PORT=8809 \
  REMOTE_CODEX_MODE=server \
  REMOTE_CODEX_ADMIN_USERNAME=ios-admin \
  REMOTE_CODEX_ADMIN_PASSWORD=ios-password \
  REMOTE_CODEX_SESSION_SECRET=ios-e2e-session-secret \
  REMOTE_CODEX_E2E_FAKE_RUNTIME=1 \
  REMOTE_CODEX_ENABLED_AGENT_PROVIDERS=claude \
  REMOTE_CODEX_DISABLE_BUILD_RESTART=true \
  REMOTE_CODEX_ENABLE_WEBVIEW_CORS=true \
  pnpm --filter @remote-codex/supervisor-api exec tsx src/index.ts
```

Then run the WebView image asset smoke from another shell:

```bash
printf 'http://127.0.0.1:8809' > .local/ios-e2e/server-base-url.txt
cd apps/ios
xcodebuild test \
  -project RemoteCodex.xcodeproj \
  -scheme RemoteCodex \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testLiveServerThreadWebViewLoadsAuthenticatedImageAsset \
  -parallel-testing-enabled NO \
  | xcbeautify
rm -f ../../.local/ios-e2e/server-base-url.txt
```

## Relay Simulator Smoke

Start an isolated relay server from the repository root:

```bash
rm -rf .local/ios-e2e/relay-server-data
mkdir -p .local/ios-e2e/relay-server-data
REMOTE_CODEX_ADMIN_USERNAME=ios-relay-admin \
  REMOTE_CODEX_ADMIN_PASSWORD=ios-relay-password \
  REMOTE_CODEX_RELAY_SESSION_SECRET=ios-relay-session-secret \
  REMOTE_CODEX_RELAY_DATA_DIR="$PWD/.local/ios-e2e/relay-server-data" \
  REMOTE_CODEX_ENABLE_WEBVIEW_CORS=true \
  HOST=127.0.0.1 \
  PORT=8799 \
  pnpm --filter @remote-codex/relay-server exec tsx src/index.ts
```

Create a relay user and backend device from another shell:

```bash
node --input-type=module <<'NODE'
import fs from 'node:fs';
const relayUrl = 'http://127.0.0.1:8799';
const suffix = `${Date.now()}`;
async function post(path, body, token) {
  const res = await fetch(`${relayUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} ${res.status}: ${text}`);
  return JSON.parse(text);
}
const registered = await post('/relay/auth/register', {
  email: `ios-relay-${suffix}@example.test`,
  username: `ios-relay-${suffix}`,
  password: 'ios-relay-user-password',
});
const created = await post('/relay/devices', { name: 'iOS relay E2E backend' }, registered.token);
fs.mkdirSync('.local/ios-e2e', { recursive: true });
fs.writeFileSync('.local/ios-e2e/relay-registration.json', `${JSON.stringify({
  relayToken: registered.token,
  deviceId: created.device.id,
  deviceToken: created.token,
}, null, 2)}\n`);
fs.writeFileSync('.local/ios-e2e/relay-base-url.txt', `${relayUrl}\n`);
NODE
```

Start the private relay supervisor:

```bash
DEVICE_TOKEN=$(node -e "console.log(JSON.parse(require('fs').readFileSync('.local/ios-e2e/relay-registration.json','utf8')).deviceToken)")
DATABASE_URL="$PWD/.local/ios-e2e/supervisor-ios-e2e-relay.sqlite" \
  WORKSPACE_ROOT="$PWD" \
  REMOTE_CODEX_ADMIN_USERNAME=ios-relay-supervisor \
  REMOTE_CODEX_ADMIN_PASSWORD=ios-relay-supervisor-password \
  REMOTE_CODEX_SESSION_SECRET=ios-relay-supervisor-session-secret \
  REMOTE_CODEX_RELAY_SERVER_URL=ws://127.0.0.1:8799 \
  REMOTE_CODEX_RELAY_AGENT_TOKEN="$DEVICE_TOKEN" \
  REMOTE_CODEX_RELAY_SUPERVISOR_HOST=127.0.0.1 \
  REMOTE_CODEX_RELAY_SUPERVISOR_PORT=8796 \
  REMOTE_CODEX_DISABLE_BUILD_RESTART=true \
  REMOTE_CODEX_ENABLE_WEBVIEW_CORS=true \
  node bin/remote-codex.mjs relay-supervisor
```

For the relay WebView image asset smoke, rebuild the supervisor package before
starting `relay-supervisor` if you changed `apps/supervisor-api/src`; the CLI
uses `apps/supervisor-api/dist`. Also add the fake runtime flags to the
supervisor command:

```bash
pnpm --filter @remote-codex/supervisor-api build

DEVICE_TOKEN=$(node -e "console.log(JSON.parse(require('fs').readFileSync('.local/ios-e2e/relay-registration.json','utf8')).deviceToken)")
DATABASE_URL="$PWD/.local/ios-e2e/supervisor-ios-webview-relay-image-e2e.sqlite" \
  WORKSPACE_ROOT="$PWD" \
  REMOTE_CODEX_ADMIN_USERNAME=ios-relay-supervisor \
  REMOTE_CODEX_ADMIN_PASSWORD=ios-relay-supervisor-password \
  REMOTE_CODEX_SESSION_SECRET=ios-relay-supervisor-session-secret \
  REMOTE_CODEX_RELAY_SERVER_URL=ws://127.0.0.1:8799 \
  REMOTE_CODEX_RELAY_AGENT_TOKEN="$DEVICE_TOKEN" \
  REMOTE_CODEX_RELAY_SUPERVISOR_HOST=127.0.0.1 \
  REMOTE_CODEX_RELAY_SUPERVISOR_PORT=8796 \
  REMOTE_CODEX_DISABLE_BUILD_RESTART=true \
  REMOTE_CODEX_ENABLE_WEBVIEW_CORS=true \
  REMOTE_CODEX_E2E_FAKE_RUNTIME=1 \
  REMOTE_CODEX_ENABLED_AGENT_PROVIDERS=claude \
  node bin/remote-codex.mjs relay-supervisor
```

Verify the relay WebSocket opens:

```bash
node --input-type=module <<'NODE'
import fs from 'node:fs';
const reg = JSON.parse(fs.readFileSync('.local/ios-e2e/relay-registration.json', 'utf8'));
const url = new URL(`/relay/devices/${reg.deviceId}/ws`, 'ws://127.0.0.1:8799');
url.searchParams.set('relaySession', reg.relayToken);
const ws = new WebSocket(url);
const timeout = setTimeout(() => {
  ws.close();
  throw new Error('Timed out waiting for relay websocket open.');
}, 5000);
ws.addEventListener('open', () => {
  clearTimeout(timeout);
  console.log('relay websocket open');
  ws.close();
});
NODE
```

Then run the live Relay UI smoke:

```bash
cd apps/ios
xcodebuild test \
  -project RemoteCodex.xcodeproj \
  -scheme RemoteCodex \
  -destination 'platform=iOS Simulator,id=B9E0BB3C-4FB0-4C86-A0E1-E578E1AFCBC9' \
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testLiveRelayConnectionLoadsForwardedRestAndWebSocket \
  -parallel-testing-enabled NO \
  | xcbeautify
rm -f ../../.local/ios-e2e/relay-base-url.txt ../../.local/ios-e2e/relay-registration.json
```

The same relay setup can run the WebView relay route smoke:

```bash
cd apps/ios
xcodebuild test \
  -project RemoteCodex.xcodeproj \
  -scheme RemoteCodex \
  -destination 'platform=iOS Simulator,id=B9E0BB3C-4FB0-4C86-A0E1-E578E1AFCBC9' \
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testLiveRelayThreadWebViewLoadsForwardedThreadDetail \
  -parallel-testing-enabled NO \
  | xcbeautify
rm -f ../../.local/ios-e2e/relay-base-url.txt ../../.local/ios-e2e/relay-registration.json
```

The same relay setup with the fake runtime flags can run the WebView relay image
asset smoke:

```bash
cd apps/ios
xcodebuild test \
  -project RemoteCodex.xcodeproj \
  -scheme RemoteCodex \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -only-testing:RemoteCodexUITests/RemoteCodexUITests/testLiveRelayThreadWebViewLoadsForwardedImageAsset \
  -parallel-testing-enabled NO \
  | xcbeautify
rm -f ../../.local/ios-e2e/relay-base-url.txt ../../.local/ios-e2e/relay-registration.json
```

The default UI test suite skips live smokes unless `REMOTE_CODEX_IOS_E2E_BASE_URL`, `REMOTE_CODEX_IOS_E2E_SERVER_BASE_URL`, `REMOTE_CODEX_IOS_E2E_RELAY_BASE_URL`, `.local/ios-e2e/base-url.txt`, `.local/ios-e2e/server-base-url.txt`, or `.local/ios-e2e/relay-base-url.txt` is present.
