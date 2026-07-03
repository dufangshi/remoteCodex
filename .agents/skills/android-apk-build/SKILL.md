---
name: android-apk-build
description: Build the Remote Codex Android APK from apps/android. Use when the user asks to compile, rebuild, package, locate, or provide the latest Android APK for this repo, especially when Gradle cannot find Java, Android SDK paths, or fails on configuration cache.
---

# Android APK Build

Use this skill to build the Android app in `apps/android` and return the APK path.

## Command

Prefer the bundled script from the repo root:

```bash
.agents/skills/android-apk-build/scripts/build-android-apk.sh
```

The script sets the known-good local paths:

- `JAVA_HOME=/Applications/Android Studio.app/Contents/jbr/Contents/Home`
- `ANDROID_HOME=$HOME/Library/Android/sdk`
- `ANDROID_SDK_ROOT=$ANDROID_HOME`

It runs Gradle with `--no-configuration-cache` because this project can otherwise package the APK and then fail while storing the configuration cache.

## Output

Default output:

```text
apps/android/app/build/outputs/apk/debug/app-debug.apk
```

After a successful build, report the absolute APK path and size to the user.

## If It Fails

- If Java is missing, confirm Android Studio's JBR exists at `/Applications/Android Studio.app/Contents/jbr/Contents/Home`.
- If SDK location is missing, confirm `$HOME/Library/Android/sdk` exists and includes `platform-tools`.
- If the APK task succeeds but Gradle reports a configuration-cache serialization error, rerun with `--no-configuration-cache`.
- Do not edit or commit Android build outputs unless the user explicitly asks for deliverable artifacts to be committed.
