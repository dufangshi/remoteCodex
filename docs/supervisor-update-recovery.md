# Supervisor updates and interrupted-task recovery

When a Supervisor is already running, prefer its device-scoped management API (the same API as Settings → Supervisor → Check updates / Update). See [AGENTS.md](../AGENTS.md). Do not replace its npm package and kill its process independently when this API is available.

- `POST /api/management/supervisor/check`: installed/running/latest versions and update availability.
- `POST /api/management/supervisor/update`: check availability, return `202` with a preparing job, then continue independently of the HTTP connection.
- `GET /api/management/supervisor`: progress, resulting version, or failure details.

Through a relay, use the selected device's `/relay/devices/<deviceId>` prefix and existing authenticated owner access. These are device-specific operations. Local mode remains bound to the configured local interface. Update errors and progress are available after a browser refresh; keep polling through the brief restart disconnect.

## Restart contract

1. Reject concurrent updates and avoid pausing anything if no update is available.
2. Block new turns, record the currently running turn IDs in SQLite, and request cancellation. Wait for runtime cancellation and history persistence before installing/restarting.
3. Launch an updater outside the Supervisor's process lifetime: launchd on macOS, systemd user service on Linux, WMI on Windows. Linux machines without a user service manager use `setsid` to create a separate OS session.
4. Back up the npm package, install the new version in the owning npm prefix, verify the downloaded native binary and version, stop the old PID, then start the new Supervisor with its existing configuration. Verify HTTP health, process/version change, and relay reconnection in relay mode. Roll back on failure.
5. On startup, wait for the independent worker to finish health/relay verification, then automatically continue only tasks carrying an update recovery marker. A rollback therefore keeps the recovery journal intact. Retain the native session, workspace, model, permission settings and queued instructions. Continuation tells the agent to inspect partial work before resuming; a filesystem operation or external request already completed cannot be rolled back automatically.

The recovery marker is consumed in the same SQLite transaction as the new turn. Repeated recovery notifications do not create duplicate turns. Queued prompts follow the recovered task. Internal recovery markers do not appear as pending user input; the actual continuation is recorded in conversation history for transparency.

An ordinary crash or a user-interrupted thread does **not** opt into recovery. An explicit user stop clears an update recovery marker. If installation fails before restart, the old process resumes the paused tasks; if the new runtime cannot start, the rollback runtime uses the same journal. A recovery failure leaves a visible thread error rather than retrying indefinitely.

This is task continuation, not transparent process checkpointing. Running shell commands may have been interrupted or may have already performed side effects; agents must inspect state before repeating them. A very old Supervisor that lacks this API still needs a one-time bootstrap upgrade.

## Verification

Fast tests:

```sh
cargo test --workspace
node --test scripts/supervisor-update.test.mjs
```

The opt-in live test runs **inside an isolated Linux machine**, with two distinct test-version builds from the candidate source, an isolated npm prefix containing npm, and Codex plus codex-acp on PATH. Never point it at the host Supervisor. It uses real provider authentication and tokens:

```sh
node scripts/test-supervisor-update-live.mjs \
  --allow-token-use \
  --directory /home/mac/remote-codex-update-test \
  --prefix /home/mac/remote-codex-update-test/prefix \
  --seed-binary /home/mac/remote-codex-update-test/seed-binary \
  --candidate-binary /home/mac/remote-codex-update-test/candidate-binary
```

Only release distribution is served from a loopback test registry, using distinct unpublished test versions. The production management API, npm installation, native binary hash validation, independent update worker, process restart, SQLite recovery, and real ACP/Codex session execute normally. The test triggers Update during a multi-step task, checks that the PID/version changes, then requires the same native session to finish a five-line checkpoint without duplicate lines. Evidence is written to the isolated run directory's `result.json`.

### Recorded live verification (2026-09-07)

On the existing Treer Apple Container machine (Linux ARM64), a real `gpt-5.6-luna` Codex session was interrupted through the management Update endpoint. The separate updater replaced unpublished fixture version `0.0.900` with `0.0.901`, verified health under a different PID, and the same session completed its checkpoint exactly once (`1,2,3,4,5`). History retained one interrupted turn and one completed continuation, with `danger-full-access` unchanged. The host Supervisor was not restarted for this test. These fixture version numbers are not published runtime releases.
