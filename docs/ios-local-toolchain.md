# iOS Local Toolchain

This Mac is prepared for native iOS development with Xcode installed at:

```text
/Applications/Xcode.app
```

Verified toolchain:

```text
Xcode 26.5
Build version 17F42
iPhoneSimulator SDK 26.5
iPhoneOS SDK 26.5
iOS Simulator runtime 26.5
Swift 6.3.2
```

Verified command-line helpers:

```text
xcbeautify 3.2.1
swiftlint 0.63.3
swiftformat 0.61.1
mas 7.0.0
xcodegen 2.45.4
```

## Developer Directory

Global `xcode-select` is configured for the full Xcode install:

```text
/Applications/Xcode.app/Contents/Developer
```

`xcodebuild`, `xcrun`, iOS SDK lookup, and `simctl` now work without a
`DEVELOPER_DIR` prefix.

Xcode license and first-launch setup were verified after running:

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
sudo xcodebuild -license accept
sudo xcodebuild -runFirstLaunch
```

## Default E2E Simulator

Use this simulator for initial iOS app build, test, and UI/E2E work:

```text
Name: iPhone 17 Pro
UDID: B9E0BB3C-4FB0-4C86-A0E1-E578E1AFCBC9
Runtime: iOS 26.5
Model: iPhone18,1
```

It was booted successfully and screenshot capture was verified.

## Useful Commands

Show Xcode version:

```bash
xcodebuild -version
```

Show SDKs:

```bash
xcodebuild -showsdks
```

Boot the default simulator:

```bash
xcrun simctl boot B9E0BB3C-4FB0-4C86-A0E1-E578E1AFCBC9 || true

xcrun simctl bootstatus B9E0BB3C-4FB0-4C86-A0E1-E578E1AFCBC9 -b
```

Capture a simulator screenshot:

```bash
xcrun simctl io B9E0BB3C-4FB0-4C86-A0E1-E578E1AFCBC9 screenshot /tmp/remote-codex-ios-simulator-check.png
```

Future iOS app test command shape:

```bash
cd apps/ios
xcodegen generate

xcodebuild test \
  -project RemoteCodex.xcodeproj \
  -scheme RemoteCodex \
  -destination 'platform=iOS Simulator,id=B9E0BB3C-4FB0-4C86-A0E1-E578E1AFCBC9' \
  | xcbeautify
```

## Current Verification

Verified on June 15, 2026:

```bash
cd apps/ios
xcodegen generate
xcodebuild test -project RemoteCodex.xcodeproj -scheme RemoteCodex \
  -destination 'platform=iOS Simulator,id=B9E0BB3C-4FB0-4C86-A0E1-E578E1AFCBC9' \
  -only-testing:RemoteCodexTests
xcodebuild test -project RemoteCodex.xcodeproj -scheme RemoteCodex \
  -destination 'platform=iOS Simulator,id=B9E0BB3C-4FB0-4C86-A0E1-E578E1AFCBC9' \
  -only-testing:RemoteCodexUITests
```

Results:

```text
RemoteCodexTests: 72 tests, 0 failures
RemoteCodexUITests: 3 tests, 0 failures
```
