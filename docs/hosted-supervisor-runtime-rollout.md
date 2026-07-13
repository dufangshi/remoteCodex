# Hosted supervisor runtime releases

The Relay container and the supervisor running inside an Incus VM are separate deployable units. A Relay deployment does not update the globally installed `remote-codex` package inside existing VMs.

## Release flow

1. Any change to publishable runtime paths must include a new root `package.json` version.
2. `Publish npm package` validates the repository, packs the complete runtime, and publishes `remote-codex` with npm trusted publishing and provenance.
3. A successful npm publication triggers `Hosted supervisor runtime rollout`.
4. The rollout records the desired version on every managed Incus VM.
5. Running VMs upgrade serially. Stopped VMs remain stopped and upgrade automatically on their next start.

The npm package must configure GitHub Actions trusted publishing for:

- repository: `dufangshi/remoteCodex`
- workflow: `npm-release.yml`
- environment: none

No long-lived npm token is stored in GitHub.

## Turn-aware behavior

The supervisor health response includes `activeTurnCount`. Before stopping the service, the guest upgrader checks this value. If any turn is running, it creates a five-minute retry timer and exits without interrupting the turn. Older runtimes that do not expose the field are checked through their local SQLite database during the first upgrade.

## Failure and rollback

Before installation, the guest stops the supervisor cleanly and stores a protected SQLite backup. It installs the exact npm version, restarts the service, and waits for `/healthz`. If installation or health verification fails, it reinstalls the previous npm version and restarts the previous runtime. The host rollout is locked and serial, so at most one running VM is being changed at a time.

Useful files:

- `.github/workflows/npm-release.yml`
- `.github/workflows/hosted-runtime-rollout.yml`
- `packages/incus-host-agent/deploy/rollout-runtime.sh`
- `packages/incus-host-agent/guest/remote-codex-upgrade-runtime`
