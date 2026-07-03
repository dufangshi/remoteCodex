#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../../.." && pwd)"
ANDROID_DIR="${REPO_ROOT}/apps/android"

export JAVA_HOME="${JAVA_HOME:-/Applications/Android Studio.app/Contents/jbr/Contents/Home}"
export ANDROID_HOME="${ANDROID_HOME:-${HOME}/Library/Android/sdk}"
export ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-${ANDROID_HOME}}"

if [[ ! -x "${JAVA_HOME}/bin/java" ]]; then
  echo "Java runtime not found at JAVA_HOME=${JAVA_HOME}" >&2
  exit 1
fi

if [[ ! -d "${ANDROID_HOME}/platform-tools" ]]; then
  echo "Android SDK not found or incomplete at ANDROID_HOME=${ANDROID_HOME}" >&2
  exit 1
fi

cd "${ANDROID_DIR}"
"${ANDROID_DIR}/gradlew" --no-configuration-cache assembleDebug

APK_PATH="${ANDROID_DIR}/app/build/outputs/apk/debug/app-debug.apk"
if [[ ! -f "${APK_PATH}" ]]; then
  echo "Expected APK was not produced: ${APK_PATH}" >&2
  exit 1
fi

ls -lh "${APK_PATH}"
printf 'APK_PATH=%s\n' "${APK_PATH}"
