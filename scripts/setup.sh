#!/bin/sh
# Public bootstrap served by the relay from the same immutable runtime version.
set -eu
umask 077
relay_url=''
setup_code=''
setup_port=8787
while [ "$#" -gt 0 ]; do
  case "$1" in
    --relay) relay_url=${2:?Missing relay URL}; shift 2 ;;
    --code) setup_code=${2:?Missing setup code}; shift 2 ;;
    --port) setup_port=${2:?Missing port}; shift 2 ;;
    *) echo "Usage: setup.sh --relay URL --code CODE [--port PORT]" >&2; exit 1 ;;
  esac
done
[ -n "$relay_url" ] && [ -n "$setup_code" ] || { echo 'Copy a setup command from the Devices page.' >&2; exit 1; }
case "$relay_url" in https://*|http://localhost:*|http://127.0.0.1:*) ;; *) echo 'Relay must use HTTPS.' >&2; exit 1 ;; esac
case "$setup_port" in *[!0-9]*|'') echo 'Invalid port' >&2; exit 1 ;; esac
download() {
  if command -v curl >/dev/null 2>&1; then curl --fail --silent --show-error --location --connect-timeout 20 --max-time 300 "$1" -o "$2"
  elif command -v wget >/dev/null 2>&1; then wget -q --timeout=300 "$1" -O "$2"
  else echo 'curl or wget is required.' >&2; exit 1; fi
}
case "$(uname -s)" in Darwin) setup_os=darwin ;; Linux) setup_os=linux ;; *) echo 'This installer supports macOS and Linux.' >&2; exit 1 ;; esac
case "$(uname -m)" in arm64|aarch64) setup_arch=arm64 ;; x86_64|amd64) setup_arch=x64 ;; *) echo 'Unsupported CPU architecture.' >&2; exit 1 ;; esac
if [ "$setup_os" = darwin ] && [ "$setup_arch" != arm64 ]; then
  echo 'The macOS runtime currently requires Apple Silicon.' >&2; exit 1
fi
if [ "$setup_os" = linux ] && [ -f /etc/alpine-release ]; then
  echo 'The Linux runtime requires glibc (for example Ubuntu or Debian).' >&2; exit 1
fi
setup_root="$HOME/.local/share/remote-codex"
mkdir -p "$setup_root"
setup_tmp=$(mktemp -d "$setup_root/bootstrap.XXXXXX")
trap 'rm -f "$setup_tmp/node.tar.gz" "$setup_tmp/SHASUMS256.txt"; rmdir "$setup_tmp" 2>/dev/null || true' EXIT HUP INT TERM
setup_node=$(command -v node || true)
if [ -z "$setup_node" ] || ! "$setup_node" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' 2>/dev/null || ! command -v npm >/dev/null 2>&1; then
  echo 'Installing a private Node.js LTS runtime…'
  setup_node_version=v22.22.0
  setup_archive="node-${setup_node_version}-${setup_os}-${setup_arch}"
  setup_node_root="$setup_root/$setup_archive"
  if [ ! -x "$setup_node_root/bin/node" ]; then
    download "https://nodejs.org/dist/$setup_node_version/$setup_archive.tar.gz" "$setup_tmp/node.tar.gz"
    download "https://nodejs.org/dist/$setup_node_version/SHASUMS256.txt" "$setup_tmp/SHASUMS256.txt"
    setup_expected=$(awk -v name="$setup_archive.tar.gz" '$2 == name {print $1}' "$setup_tmp/SHASUMS256.txt")
    if command -v sha256sum >/dev/null 2>&1; then setup_actual=$(sha256sum "$setup_tmp/node.tar.gz" | awk '{print $1}'); else setup_actual=$(shasum -a 256 "$setup_tmp/node.tar.gz" | awk '{print $1}'); fi
    [ -n "$setup_expected" ] && [ "$setup_actual" = "$setup_expected" ] || { echo 'Node.js checksum failed.' >&2; exit 1; }
    tar -xzf "$setup_tmp/node.tar.gz" -C "$setup_root"
  fi
  PATH="$setup_node_root/bin:$PATH"; export PATH
  setup_node="$setup_node_root/bin/node"
fi
echo 'Installing Remote Codex…'
setup_launcher="$setup_root/runtime/lib/node_modules/remote-codex/bin/remote-codex.mjs"
# Reuse the managed installation on retries; updates belong to Settings.
if [ ! -f "$setup_launcher" ]; then
  npm install --global --prefix "$setup_root/runtime" 'remote-codex@__REMOTE_CODEX_VERSION__' npm@10 --no-audit --no-fund
fi
rm -f "$setup_tmp/node.tar.gz" "$setup_tmp/SHASUMS256.txt"
rmdir "$setup_tmp"
trap - EXIT HUP INT TERM
exec "$setup_node" "$setup_launcher" setup --relay "$relay_url" --code "$setup_code" --port "$setup_port"
