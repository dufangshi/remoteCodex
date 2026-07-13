#!/usr/bin/env bash
set -euo pipefail

# Ignore a deploy user's project-level npm settings (notably `prefix`), which
# otherwise make read-only registry checks fail when this script runs via sudo.
export NPM_CONFIG_USERCONFIG=/dev/null

target_version="${1:-}"
if [[ ! "${target_version}" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]]; then
  echo "Usage: $0 <remote-codex-version>" >&2
  exit 2
fi

project="${REMOTE_CODEX_INCUS_PROJECT:-remote-codex-hosted}"
prefix="${REMOTE_CODEX_INCUS_INSTANCE_PREFIX:-rcd-}"
upgrade_script="${REMOTE_CODEX_GUEST_RUNTIME_UPGRADE_SCRIPT:-/opt/remote-codex-incus-host-agent/guest/remote-codex-upgrade-runtime}"
lock_file="${REMOTE_CODEX_RUNTIME_ROLLOUT_LOCK:-/run/lock/remote-codex-runtime-rollout.lock}"

exec 9>"${lock_file}"
flock -n 9 || {
  echo "Another hosted runtime rollout is already running." >&2
  exit 3
}

npm_version="$(npm view "remote-codex@${target_version}" version --json | tr -d '"[:space:]')"
test "${npm_version}" = "${target_version}"

mapfile -t instances < <(
  incus --force-local --project "${project}" list --format json | \
    jq -r --arg prefix "${prefix}" '.[] | select(.name | startswith($prefix)) | [.name, (.status // "Unknown")] | @tsv'
)

for entry in "${instances[@]}"; do
  IFS=$'\t' read -r name status <<<"${entry}"
  incus --force-local --project "${project}" config set \
    "${name}" user.remote-codex.runtime-version="${target_version}"

  if [ "${status,,}" != "running" ]; then
    echo "Deferred ${name}: it will upgrade to ${target_version} on its next start."
    continue
  fi

  echo "Upgrading ${name} to remote-codex ${target_version}."
  incus --force-local --project "${project}" file push \
    "${upgrade_script}" "${name}/usr/local/sbin/remote-codex-upgrade-runtime" \
    --mode=0700 --uid=0 --gid=0
  incus --force-local --project "${project}" exec "${name}" -- \
    /usr/local/sbin/remote-codex-upgrade-runtime "${target_version}"
done

echo "Hosted runtime rollout completed for ${target_version}."
