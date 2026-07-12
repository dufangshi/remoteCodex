#!/usr/bin/env bash
set -euo pipefail

add_path_dir() {
  if [[ -d "$1" ]]; then
    PATH="$1:$PATH"
  fi
}

# Xcode launched from Finder does not inherit the interactive shell PATH. Add
# the common Node/pnpm install locations we use locally before invoking pnpm.
add_path_dir "/opt/homebrew/bin"
add_path_dir "/usr/local/bin"
add_path_dir "$HOME/.local/bin"
add_path_dir "$HOME/.local/share/pnpm"
add_path_dir "$HOME/Library/pnpm"
add_path_dir "$HOME/Library/pnpm/bin"

for dir in "$HOME"/.local/state/fnm_multishells/*/bin \
  "$HOME"/.cache/codex-runtimes/*/dependencies/bin; do
  add_path_dir "$dir"
done

export PATH

if command -v pnpm >/dev/null 2>&1; then
  PNPM_COMMAND=(pnpm)
elif command -v corepack >/dev/null 2>&1; then
  PNPM_COMMAND=(corepack pnpm)
else
  cat >&2 <<EOF
error: pnpm was not found while building the bundled iOS thread WebView UI.

Xcode launched from Finder often has a minimal PATH. Install pnpm in a standard
location, or launch Xcode from a terminal that can already run pnpm:

  open -a Xcode-beta "$SRCROOT/RemoteCodex.xcodeproj"

Searched PATH:
  $PATH

EOF
  exit 127
fi

cd "$SRCROOT/../.."
"${PNPM_COMMAND[@]}" --filter @remote-codex/ios-thread-web build

rm -rf "$SRCROOT/RemoteCodex/Resources/WebThreadDist"
mkdir -p "$SRCROOT/RemoteCodex/Resources/WebThreadDist"
cp -R "$SRCROOT/WebThread/dist/." "$SRCROOT/RemoteCodex/Resources/WebThreadDist/"

if [[ -n "${TARGET_BUILD_DIR:-}" && -n "${UNLOCALIZED_RESOURCES_FOLDER_PATH:-}" ]]; then
  WEB_THREAD_BUNDLE_DIR="$TARGET_BUILD_DIR/$UNLOCALIZED_RESOURCES_FOLDER_PATH/WebThreadDist"
  rm -rf "$WEB_THREAD_BUNDLE_DIR"
  mkdir -p "$WEB_THREAD_BUNDLE_DIR"
  cp -R "$SRCROOT/WebThread/dist/." "$WEB_THREAD_BUNDLE_DIR/"
fi
