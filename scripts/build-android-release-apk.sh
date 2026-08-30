#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
android_dir="$repo_root/apps/android"
keystore_path="${REMOTE_CODEX_ANDROID_KEYSTORE:-$HOME/.remote-codex/signing/android-release.jks}"
key_alias="${REMOTE_CODEX_ANDROID_KEY_ALIAS:-remote-codex-release}"

export JAVA_HOME="${JAVA_HOME:-/Applications/Android Studio.app/Contents/jbr/Contents/Home}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$ANDROID_HOME}"

if [[ ! -f "$keystore_path" ]]; then
  echo "Android release keystore not found: $keystore_path" >&2
  exit 1
fi

keystore_password="${REMOTE_CODEX_ANDROID_KEYSTORE_PASSWORD:-}"
if [[ -z "$keystore_password" ]] && [[ "$(uname -s)" == "Darwin" ]]; then
  keystore_password="$(security find-generic-password \
    -a remote-codex \
    -s remote-codex-android-release-password \
    -w 2>/dev/null || true)"
fi
if [[ -z "$keystore_password" ]]; then
  echo "Set REMOTE_CODEX_ANDROID_KEYSTORE_PASSWORD or add the local Keychain entry." >&2
  exit 1
fi

export REMOTE_CODEX_ANDROID_KEYSTORE="$keystore_path"
export REMOTE_CODEX_ANDROID_KEYSTORE_PASSWORD="$keystore_password"
export REMOTE_CODEX_ANDROID_KEY_ALIAS="$key_alias"
export REMOTE_CODEX_ANDROID_KEY_PASSWORD="${REMOTE_CODEX_ANDROID_KEY_PASSWORD:-$keystore_password}"

cd "$android_dir"
./gradlew --no-configuration-cache assembleRelease

apk_path="$android_dir/app/build/outputs/apk/release/app-release.apk"
if [[ ! -f "$apk_path" ]]; then
  echo "Expected release APK was not produced: $apk_path" >&2
  exit 1
fi

build_tools_dir="$(find "$ANDROID_HOME/build-tools" -mindepth 1 -maxdepth 1 -type d -print | sort -V | tail -1)"
"$build_tools_dir/apksigner" verify --verbose --print-certs "$apk_path"
"$build_tools_dir/aapt" dump badging "$apk_path" | sed -n '1p'
ls -lh "$apk_path"
shasum -a 256 "$apk_path"
printf 'APK_PATH=%s\n' "$apk_path"
