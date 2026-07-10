#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
manifest="${script_dir}/image-manifest.json"
project="${REMOTE_CODEX_INCUS_PROJECT:-remote-codex-hosted}"
builder="${REMOTE_CODEX_INCUS_IMAGE_BUILDER:-rcd-image-builder}"
base_image="$(jq -r .baseImageFingerprint "${manifest}")"
alias="$(jq -r .alias "${manifest}")"
node_version="$(jq -r .node.version "${manifest}")"
node_sha256="$(jq -r .node.sha256 "${manifest}")"
codex_version="$(jq -r .codex.version "${manifest}")"
remote_codex_version="$(jq -r .remoteCodex.version "${manifest}")"
remote_codex_package="${REMOTE_CODEX_GUEST_PACKAGE_TARBALL:-}"

cleanup() {
  incus --project "${project}" delete "${builder}" --force >/dev/null 2>&1 || true
}
trap cleanup EXIT

if incus --project "${project}" image info "${alias}" >/dev/null 2>&1; then
  echo "Image alias already exists: ${alias}" >&2
  exit 2
fi

incus --project "${project}" init "${base_image}" "${builder}" --vm \
  --config limits.cpu=2 --config limits.memory=2048MiB \
  --device root,size=10GiB </dev/null
incus --project "${project}" start "${builder}"
for _ in $(seq 1 120); do
  if incus --project "${project}" exec "${builder}" -- true >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
incus --project "${project}" exec "${builder}" -- cloud-init status --wait

incus --project "${project}" file push \
  "${script_dir}/remote-codex-provision" \
  "${builder}/usr/local/sbin/remote-codex-provision" --mode 0700 --uid 0 --gid 0
incus --project "${project}" file push \
  "${script_dir}/remote-codex-relay-supervisor.service" \
  "${builder}/etc/systemd/system/remote-codex-relay-supervisor.service" \
  --mode 0644 --uid 0 --gid 0
incus --project "${project}" file push \
  "${manifest}" "${builder}/usr/local/share/remote-codex-image-manifest.json" \
  --mode 0644 --uid 0 --gid 0
remote_codex_spec="remote-codex@${remote_codex_version}"
if [ -n "${remote_codex_package}" ]; then
  if [ ! -f "${remote_codex_package}" ]; then
    echo "Guest package tarball not found: ${remote_codex_package}" >&2
    exit 2
  fi
  incus --project "${project}" file push \
    "${remote_codex_package}" "${builder}/tmp/remote-codex-package.tgz" \
    --mode 0600 --uid 0 --gid 0
  remote_codex_spec="/tmp/remote-codex-package.tgz"
fi

incus --project "${project}" exec "${builder}" -- env \
  NODE_VERSION="${node_version}" NODE_SHA256="${node_sha256}" \
  CODEX_VERSION="${codex_version}" REMOTE_CODEX_SPEC="${remote_codex_spec}" \
  bash -s <<'GUEST_SETUP'
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get -o Acquire::ForceIPv4=true update
apt-get -o Acquire::ForceIPv4=true install -y --no-install-recommends ca-certificates curl git jq openssl xz-utils build-essential
archive="node-v${NODE_VERSION}-linux-x64.tar.xz"
curl -4 -fsSLo "/tmp/${archive}" "https://nodejs.org/dist/v${NODE_VERSION}/${archive}"
printf '%s  %s\n' "${NODE_SHA256}" "/tmp/${archive}" | sha256sum -c -
tar -xJf "/tmp/${archive}" -C /usr/local --strip-components=1
rm -f "/tmp/${archive}"
npm install --global --omit=dev \
  "@openai/codex@${CODEX_VERSION}" \
  "${REMOTE_CODEX_SPEC}"
id remote-codex >/dev/null 2>&1 || useradd --create-home --shell /bin/bash remote-codex
install -d -o remote-codex -g remote-codex -m 0700 \
  /home/remote-codex/.codex /home/remote-codex/.remote-codex /home/remote-codex/workspaces
install -d -o root -g root -m 0755 /etc/remote-codex
systemctl daemon-reload
systemctl disable remote-codex-relay-supervisor.service >/dev/null 2>&1 || true
codex --version
remote-codex version
apt-get clean
rm -rf /var/lib/apt/lists/* /tmp/*
GUEST_SETUP

incus --project "${project}" exec "${builder}" -- systemctl poweroff >/dev/null 2>&1 || true
for _ in $(seq 1 60); do
  if [ "$(incus --project "${project}" list "${builder}" --format csv -c s)" = "STOPPED" ]; then
    break
  fi
  sleep 1
done
if [ "$(incus --project "${project}" list "${builder}" --format csv -c s)" != "STOPPED" ]; then
  incus --project "${project}" stop "${builder}" --force
fi
incus --project "${project}" publish "${builder}" --alias "${alias}" \
  description="Remote Codex hosted supervisor ${alias}"
echo "Published ${alias}."
