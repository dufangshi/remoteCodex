# Supervisor updates and interrupted-task recovery

When a Supervisor is already running, prefer its device-scoped management API (the same API as Settings → Supervisor → Check updates / Update). See [AGENTS.md](../AGENTS.md). Do not replace its npm package and kill its process independently when this API is available.

- `POST /api/management/supervisor/check`: installed/running/latest versions and update availability.
- `POST /api/management/supervisor/restart`: restart the currently running version without downloading or installing a package, then continue only tasks paused by this restart.
- `POST /api/management/supervisor/update`: check availability, return `202` with a preparing job, then continue independently of the HTTP connection.
- `GET /api/management/supervisor`: progress, resulting version, failure details, process identity and uptime.

See [execution reliability](execution-reliability.md) for owner-only access, state authority, uncertain execution and durable input.

Through a relay, use the selected device's `/relay/devices/<deviceId>` prefix and existing authenticated owner access. These are device-specific operations. Local mode remains bound to the configured local interface. Update errors and progress are available after a browser refresh; keep polling through the brief restart disconnect.

## Restart contract

1. Reject concurrent updates and avoid pausing anything if no update is available.
2. Block new turns, record the currently running turn IDs in SQLite, and request cancellation. Wait for runtime cancellation and history persistence before installing/restarting.
3. Launch an updater outside the Supervisor's process lifetime: launchd on macOS, systemd user service on Linux, WMI on Windows. Linux machines without a user service manager use `setsid` to create a separate OS session.
4. Back up the npm package, install the new version in the owning npm prefix, verify the downloaded native binary and version, stop the old PID, then start the new Supervisor with its existing configuration. Verify HTTP health, process/version change, and relay reconnection in relay mode. The `verifying` phase distinguishes a started process from a fully verified operation. Before the new process is launched, installation failure can restore the previous package. Once launch has been attempted, retain the current installation: even an unsuccessful startup may have migrated the database, so a package-only downgrade is unsafe.
5. On startup, wait for the independent worker to finish health/relay verification, then automatically continue only tasks carrying an update recovery marker. The recovery journal remains intact while verification is active. Retain the native session, workspace, model, permission settings and queued instructions. Continuation tells the agent to inspect partial work before resuming; a filesystem operation or external request already completed cannot be rolled back automatically.

The recovery marker is consumed in the same SQLite transaction as the new turn. Repeated recovery notifications do not create duplicate turns. Queued prompts follow the recovered task. Internal recovery markers do not appear as pending user input; the actual continuation is recorded in conversation history for transparency.

An ordinary crash or a user-interrupted thread does **not** opt into recovery. An explicit user stop clears an update recovery marker. If installation fails before restart, the old process resumes the paused tasks; if the new runtime cannot start, retain its installation and journal for diagnosis and explicit recovery rather than launching an older incompatible binary. A recovery failure leaves a visible thread error rather than retrying indefinitely.

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


### Relay verification and the 2026-09-11 offline incident

The 0.12.29 worker treated an empty `REMOTE_CODEX_RELAY_SUPERVISOR_LOG` exported by tmux as a real path. Although the 0.12.31 process was running and reachable through Relay, the worker could not find its connection log, timed out, and restored 0.12.29. The database already used migration 8, so the old runtime could not start. Recovery reinstalled the already-published 0.12.31 package in the same npm prefix and started it with the existing database and device identity. Incident evidence is retained under `~/.remote-codex/recovery/update-0.12.31-offline/`.

The unreleased fix reads `relayConnected` from the new process's health endpoint. The Supervisor sets this flag only after the relay's registration greeting and clears it when its tunnel exits or is cancelled. Compatibility with old runtimes resolves an empty log override to the launcher's default and interprets file offsets as bytes. Explicit `relayConnected: false` always wins over a historical connection log. A verification failure keeps the new process and installed package rather than blindly downgrading a migrated database.

Settings labels the installed/running version separately from the ongoing operation, explains temporarily disabled controls, and clears stale jobs when a current snapshot no longer contains one. Polling does not overlap during a reconnect.

`test-supervisor-relay-restart-live.mjs` exercises the real relay, Supervisor and independent worker twice through the owner's device-scoped API in Treer, with an empty log override and registry access blocked. It makes no model calls. Together with the worker's failure tests and UI reconnect tests, this covers the branch omitted by the earlier local-mode restart test. These fixes are committed without a version bump or deployment.

Unreleased verification (2026-09-11): workspace tests passed (267 passed, one existing real-Gemini test ignored), updater tests 13/13, runtime-settings component tests 8/8, Web typecheck and production build passed. Treer relay evidence: `/home/mac/remote-codex-update-test/relay-restart-ZMBMoR/result.json`; PID sequence `3639 → 3695 → 3786`, both jobs completed with the same version and the device connected. The initial fixture lacked the relay's required administrator settings; it was corrected before the successful run. The production device was restored using the already-published 0.12.31 package, and its failed maintenance record was explicitly marked `recovered` with the original error retained.
