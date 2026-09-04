# Hosted supervisor runtime releases

The Relay container and the supervisor running inside an Incus VM are separate deployable units. A Relay deployment does not update the globally installed `remote-codex` package inside existing VMs.

## Release flow

1. Any change to publishable runtime paths must include a new root `package.json` version.
2. Validate and pack the runtime locally, then publish it manually with the existing project-level `.npmrc` credentials:

   ```bash
   pnpm typecheck
   pnpm --filter @remote-codex/supervisor-api test
   pnpm --filter @remote-codex/incus-host-agent test
   mkdir -p artifacts
   npm pack --pack-destination artifacts
   npm publish ./artifacts/remote-codex-<version>.tgz --access public
   ```

3. After npm confirms the published version, manually dispatch `Hosted supervisor runtime rollout` with that exact version. For example:

   ```bash
   gh workflow run hosted-runtime-rollout.yml -f version=<version>
   ```

4. The rollout records the desired version on every managed Incus VM.
5. Running VMs upgrade serially. Stopped VMs remain stopped and upgrade automatically on their next start.

The `.npmrc` remains local and uncommitted. The rollout workflow has no npm publishing permission and only accepts a version that is already visible in the public registry.

## Turn-aware behavior

The supervisor health response includes `activeTurnCount`. Before stopping the service, the guest upgrader checks this value. If any turn is running, it creates a five-minute retry timer and exits without interrupting the turn. Older runtimes that do not expose the field are checked through their local SQLite database during the first upgrade.

## Failure and rollback

Before installation, the guest stops the supervisor cleanly and stores a protected SQLite backup. It installs the exact npm version, restarts the service, and waits for `/healthz`. If installation or health verification fails, it reinstalls the previous npm version and restarts the previous runtime. The host rollout is locked and serial, so at most one running VM is being changed at a time.

Useful files:

- `.github/workflows/hosted-runtime-rollout.yml`
- `packages/incus-host-agent/deploy/rollout-runtime.sh`
- `packages/incus-host-agent/guest/remote-codex-upgrade-runtime`
