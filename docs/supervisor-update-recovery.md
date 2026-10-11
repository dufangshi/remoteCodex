# Supervisor updates and interrupted-task recovery

When a Supervisor is already running, prefer its device-scoped management API (the same API as Settings → Supervisor → Check updates / Update). See [AGENTS.md](../AGENTS.md). Do not replace its native executable and kill its process independently when this API is available.

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
4. Stage an immutable GitHub native release and Web bundle in a versioned user-owned directory, verify SHA256 and the binary version, stop the old PID, then start the new Supervisor with its existing configuration. Verify HTTP health, process/version change, and relay reconnection in relay mode. The `verifying` phase distinguishes a started process from a fully verified operation. Before the new process is launched, installation failure can restore the previous installation. Once launch has been attempted, retain the current installation: even an unsuccessful startup may have migrated the database, so a package-only downgrade is unsafe.
5. On startup, wait for the independent worker to finish health/relay verification, then automatically continue only tasks carrying an update recovery marker. The recovery journal remains intact while verification is active. Retain the native session, workspace, model, permission settings and queued instructions. Continuation tells the agent to inspect partial work before resuming; a filesystem operation or external request already completed cannot be rolled back automatically.

The recovery marker is consumed in the same SQLite transaction as the new turn. Repeated recovery notifications do not create duplicate turns. Queued prompts follow the recovered task. Internal recovery markers do not appear as pending user input; the actual continuation is recorded in conversation history for transparency.

An ordinary crash or a user-interrupted thread does **not** opt into recovery. An explicit user stop clears an update recovery marker. If installation fails before restart, the old process resumes the paused tasks; if the new runtime cannot start, retain its installation and journal for diagnosis and explicit recovery rather than launching an older incompatible binary. A recovery failure leaves a visible thread error rather than retrying indefinitely.

This is task continuation, not transparent process checkpointing. Running shell commands may have been interrupted or may have already performed side effects; agents must inspect state before repeating them. A very old Supervisor that lacks this API still needs a one-time bootstrap upgrade.

## Installation ownership

GitHub Releases are authoritative. See [native installation and migration](github-runtime.md).
The native updater stages each version under `~/.local/share/remote-codex/native/releases/`,
verifies every downloaded asset and the executable's version, and switches the current
installation only after the original Supervisor has drained and stopped. Source and
unmanaged executables are never silently overwritten. Database and device identity
paths are preserved. A failed download leaves the current installation intact.

Existing writable npm installations migrate once by rerunning the same setup command.
A minimal compatibility bridge lets the old management API keep its maintenance and
recovery contract while delegating downloads and restart to the native updater. Future
updates require neither npm nor Node. A legacy installation whose helper cannot be
written needs explicit bootstrap/service recovery; the installer reports this before
stopping anything. Legacy npm tests and incident records below remain historical evidence.

## Verification

Fast tests:

```sh
node --test scripts/supervisor-update.test.mjs scripts/installation.test.mjs
```

The opt-in live test runs **inside an isolated Linux machine**, with two distinct test-version builds from the candidate source, an isolated npm prefix containing npm, and Codex plus codex-acp on PATH. Never point it at the host Supervisor. It uses real provider authentication and tokens:

```sh
node scripts/test-supervisor-update-live.mjs \
  --allow-token-use \
  --directory /path/to/isolated-test \
  --prefix /path/to/isolated-test/prefix \
  --seed-binary /path/to/isolated-test/seed-binary \
  --candidate-binary /path/to/isolated-test/candidate-binary
```

Only release distribution is served from a loopback test registry, using distinct unpublished test versions. The production management API, npm installation, native binary hash validation, independent update worker, process restart, SQLite recovery, and real ACP/Codex session execute normally. The test triggers Update during a multi-step task, checks that the PID/version changes, then requires the same native session to finish a five-line checkpoint without duplicate lines. Evidence is written to the isolated run directory's `result.json`.

`scripts/test-supervisor-relay-restart-live.mjs` runs the real relay, Supervisor and
independent worker twice through the owner's device-scoped API, with registry
access blocked. It makes no model calls.

## Confirming the new process

The worker treats an update as successful only when the new process's health
endpoint reports `relayConnected: true`. The Supervisor sets the flag after the
relay's registration greeting and clears it when its tunnel exits. An explicit
`relayConnected: false` wins over any older connection log, and an empty log
override falls back to the default path.

A failed verification keeps the new process and installation instead of
downgrading: the new version may already have migrated the database, and the old
runtime cannot open it. Settings shows the installed and running versions
separately from the current operation, explains temporarily disabled controls,
and clears a stale job once a fresh snapshot no longer contains it.
