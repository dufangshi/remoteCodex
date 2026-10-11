# Development

Pockymoe was formerly **Remote Codex**. Installed devices keep updating and the
`remote-codex` command still works; see [the rename notes](rename-pockymoe.md).

The Supervisor, relay and CLI are Rust. Harnesses speak **ACP** through thin
adapters. The thread UI is React, shared through the separate
[`pockymoe-thread-ui-rust`](https://github.com/dufangshi/pockymoe-thread-ui-rust)
repository, checked out at `pockymoe-thread-ui/`.

Read [AGENTS.md](../AGENTS.md) before changing or releasing this project.

## Layout

- `crates/protocol`: wire DTOs
- `crates/runtime`: journal, files, ACP catalog, thread service
- `crates/supervisor`: HTTP and WebSocket
- `crates/relay`: public relay
- `crates/cli`: the `pockymoe` command
- `apps/supervisor-web`: the product Web UI

## Run locally

```bash
cargo run -p pockymoe -- supervisor
# another terminal
pnpm install
pnpm --filter @pockymoe/supervisor-web exec vite --host localhost --port 5173
```

Open `http://localhost:5173`. Local mode has no login.

A local relay and a device connected to it:

```bash
POCKYMOE_ADMIN_USERNAME=admin POCKYMOE_ADMIN_PASSWORD=change-me-please \
  cargo run -p pockymoe -- relay
POCKYMOE_MODE=relay POCKYMOE_RELAY_SERVER_URL=ws://127.0.0.1:8788 \
  POCKYMOE_RELAY_AGENT_TOKEN=rcd_... cargo run -p pockymoe -- relay-supervisor
```

Running a public relay is described in [Self-hosting a relay](self-host-relay.md).

## Installation and releases

The native Supervisor serves the Web UI itself. Copy a setup command from the
Devices page: macOS and Linux use SH, Windows uses PowerShell. Both download the
matching Rust executable from GitHub Releases and verify its SHA256 and actual
version. Installing or updating Pockymoe needs no Node.js or npm; Node.js is only
prepared on demand for agent and ACP dependencies that require it.

GitHub Releases are the authoritative runtime versions. Each immutable release
contains all four supported binaries, the pinned Web bundle,
`runtime-version.txt` and `SHA256SUMS`. See
[native installation and releases](github-runtime.md) and the
[release skill](../.agents/skills/release-runtime/SKILL.md).

The Windows Device Manager is an independently released legacy bootstrap. Prefer
the PowerShell setup and Web Settings for native installation and updates.
Existing npm installations need the one-time migration described in
[native installation and releases](github-runtime.md).

## Updating a running Supervisor

Prefer a running Supervisor's own device-scoped update API, the same
**Check updates** and **Update** controls as in Settings, over replacing its
executable and killing the process:

- `POST /api/management/supervisor/check`
- `POST /api/management/supervisor/update`
- `GET /api/management/supervisor` to follow progress

Through a relay, prefix these paths with `/relay/devices/<deviceId>` and use the
device owner's authenticated session.

Updates run independently of the browser or agent that started them. They
restart the Supervisor and resume the threads interrupted by that update, with
their saved sessions, permissions and queued input. Threads already stopped by
the user stay stopped. If installation or restart fails, rollback restores the
previous service and resumes its interrupted work where possible; recovery
failures are reported on the affected thread.

Use the original installation method only to bootstrap a version without this
API, or when the API is unavailable. See
[the update and recovery design](supervisor-update-recovery.md).

## Migrating from Node 0.11

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

The local Supervisor keeps the Node 0.11 tables in
`~/.remote-codex/supervisor.sqlite` and applies additive, transactional Rust
migrations. Existing workspaces, turns, history, queued input and settings are
backfilled when the Rust Supervisor first opens the database.

## Tests

Run the checks relevant to a change; see [CI scope](ci.md) and the
[focused E2E skill](../.agents/skills/focused-e2e/SKILL.md).

```bash
cargo test -p pockymoe-runtime --lib <name>
POCKYMOE_E2E_FAKE_RUNTIME=1 pnpm exec playwright test e2e/<spec>.spec.ts --project=desktop-chromium
```

Deterministic E2E uses `POCKYMOE_E2E_FAKE_RUNTIME=1`. Production uses ACP
(`codex-acp`, `claude-agent-acp`, `grok agent stdio`, `opencode acp`, …).
