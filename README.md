# Pockymoe (Rust rewrite)

<img src="apps/supervisor-web/public/pockymoe-icon.png" alt="Pockymoe icon" width="96" />

Formerly **Remote Codex**. Installed devices keep updating; the `remote-codex`
command still works. See [the rename notes](docs/rename-pockymoe.md).

Self-hosted control plane for long-running coding agents. The supervisor is Rust. Harnesses speak **ACP** through thin adapters. The thread UI is still React (`pockymoe-thread-ui`).

This branch replaces the TypeScript `supervisor-api` / `relay-server` / per-harness SDK stacks.

## Updates and agent guidance

Read [AGENTS.md](AGENTS.md) before changing or releasing this project.
When a Supervisor is already running, prefer its own device-scoped update API
(the same **Check updates** / **Update** controls in Settings) over manually replacing its executable and killing the process:

- `POST /api/management/supervisor/check`
- `POST /api/management/supervisor/update`
- `GET /api/management/supervisor` to follow progress

Through the public relay, prefix these paths with `/relay/devices/<deviceId>`
and use the device owner's authenticated session. Updates run independently of
the initiating browser or agent, restart the Supervisor, and resume the threads
interrupted by that update with their saved sessions, permissions, and queued
input. Threads already stopped by the user stay stopped. If installation or
restart fails, rollback restores the previous service and resumes its interrupted
work where possible; recovery failures are reported on the affected thread.

Use the existing installation method only to bootstrap a version without this
API or when the API is unavailable. See [the update and recovery design](docs/supervisor-update-recovery.md).

## Layout

- `crates/protocol` — wire DTOs
- `crates/runtime` — journal, files, ACP catalog, thread service
- `crates/supervisor` — HTTP + WebSocket
- `crates/relay` — public relay
- `crates/cli` — `pockymoe`
- `apps/supervisor-web` — existing product UI

## Run

```bash
cargo run -p pockymoe -- supervisor
# another terminal
pnpm install
pnpm --filter @pockymoe/supervisor-web exec vite --host localhost --port 5173
```

Open `http://localhost:5173`. Local mode has no login.

The native supervisor serves the Web UI itself. Copy a setup command from the
Devices page: macOS/Linux use SH, Windows uses PowerShell. Both download the
matching Rust executable directly from GitHub Releases and verify its SHA256 and
actual version. No Node/npm is required to install or update Pockymoe.

GitHub Releases are the authoritative runtime versions. Each immutable release
contains all four supported binaries, the pinned Web bundle, `runtime-version.txt`
and `SHA256SUMS`. See [native installation and releases](docs/github-runtime.md).
Node.js is only prepared on demand for Agent/ACP dependencies that require it.

The Windows Device Manager remains an independently released legacy bootstrap;
this runtime migration does not change its installer or version. Prefer the new
PowerShell setup and Web Settings for GitHub-native installation/updates. Existing
npm installations require the one-time migration described in the runbook.

Relay:

```bash
cargo run -p pockymoe -- relay
POCKYMOE_MODE=relay POCKYMOE_RELAY_SERVER_URL=ws://127.0.0.1:8788 \
  POCKYMOE_RELAY_AGENT_TOKEN=rcd_... cargo run -p pockymoe -- relay-supervisor
```

Before replacing a Node 0.11 relay, stop the Node process and inspect the
existing data directory without changing it:

```bash
pockymoe relay-migrate --data-dir /var/lib/remote-codex-relay --dry-run
pockymoe relay-migrate --data-dir /var/lib/remote-codex-relay
```

The migration keeps `relay-store.sqlite`, writes an online-backup snapshot, and
does not delete a legacy `relay.sqlite`. Normal relay startup refuses an
unmigrated legacy store unless `POCKYMOE_RELAY_AUTO_MIGRATE=1` is explicitly
set.

The local supervisor keeps the Node 0.11 tables in
`~/.remote-codex/supervisor.sqlite` and applies additive, transactional Rust
migrations. Existing workspaces, turns, history, queued input, and settings are
backfilled when the Rust supervisor first opens the database.

## Tests

```bash
cargo test --workspace
POCKYMOE_E2E_FAKE_RUNTIME=1 pnpm test:e2e
```

Deterministic e2e uses `POCKYMOE_E2E_FAKE_RUNTIME=1`. Production uses ACP (`codex-acp`, `claude-agent-acp`, `grok agent stdio`, `opencode acp`, …).
