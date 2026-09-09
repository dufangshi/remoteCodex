# Independent Treer App releases

This is an additional distribution channel for the **Treer browser console**.
It does not alter the standalone Supervisor/runtime, NPM packages, shared thread UI,
Windows Device Manager, or relay. The prebuilt bundle records the actual pinned
upstream revisions; the release's publisher commit is not a claim that the bundle
was rebuilt from the current runtime HEAD.

Existing `npm-release.yml`, `relay-deploy.yml`, `hosted-runtime-rollout.yml` and
`incus-host-agent-deploy.yml` are manual `workflow_dispatch` workflows. This script
does not dispatch any workflow, run NPM, change a package version, build a runtime,
or modify another Release. Recheck this boundary if release triggers are changed.

## Publisher workflow

Build a `.treer-app.json` with the Treer App packer first. Generated bundles do not
belong in Git. In this repository, prepare and inspect:

```sh
python3 -m unittest discover -s scripts/treer-app -p 'test_*.py'
python3 scripts/treer-app/publish.py --bundle /absolute/path/to/bundle.treer-app.json \
  --out /tmp/treer-console-release
```

This only writes files locally. To publish the reviewed immutable bundle, push the
publisher source commit, then add `--publish --target FULL_40_CHARACTER_COMMIT_SHA`.
GitHub CLI must be authenticated with Release write access to `dufangshi/remoteCodex`.

The script creates **`treer-app-remote-codex-console-v<VERSION>`**, initially as a
draft, uploads both assets, downloads and compares their exact bytes, then publishes
with **`make_latest=false`**. Existing tags fail instead of replacing assets. If an
upload or verification fails, inspect the draft before retrying; do not replace an
already public App version. The runtime's `v<VERSION>` and Windows installer tags
are independent. No GitHub Action is needed for this App release channel.

## Release contract and Treer discovery

Every App Release contains these two assets (other assets are allowed):

- `treer-app-release.json`: index with schema `treer.app.release/v1`.
- `remote-codex-console-<VERSION>.treer-app.json`: prebuilt browser bundle.

```json
{
  "schema": "treer.app.release/v1",
  "apps": [{
    "app_id": "org.remote-codex.console",
    "version": "0.6.2",
    "asset": "remote-codex-console-0.6.2.treer-app.json",
    "sha256": "<64 lowercase hex characters, SHA-256 of the exact bundle bytes>"
  }]
}
```

The publisher computes this digest; do not hand-copy it from an earlier version.
The maintained schema lives in Treer at `apps/app-kit/schemas/release.schema.json`.
Each index has 1–16 entries with unique App IDs and plain asset filenames. Versions
are stable `MAJOR.MINOR.PATCH` without prerelease/build suffixes. The bundle uses
`treer.app.bundle/v1`, contains a `treer.app/v1` manifest, and includes per-file
SHA-256 checksums. Manifest App ID/version must equal the index entry.

In Treer, open **Switch App → GitHub subscription** and use:

- Repository: `https://github.com/dufangshi/remoteCodex`
- App ID: `org.remote-codex.console`

Preview, review permissions, then Subscribe and install. An existing JSON-installed
console can attach this subscription during installation. Afterwards use **Check
updates → Update App**; uploading a new JSON is unnecessary. Older installed
versions remain available for rollback.

Treer scans published stable Releases, ignores ones without this index, and selects
the highest semantic version **for this App ID**, regardless of GitHub's Latest
marker, tag prefix, release order, runtime/NPM versions or Windows installers.
It bounds discovery to 1,000 Releases/128 App indexes and reports errors rather than
silently selecting from an incomplete scan. Private repositories are not supported
by the current subscription client.
