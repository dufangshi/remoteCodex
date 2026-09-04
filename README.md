# Remote Codex (Rust rewrite)

Self-hosted control plane for long-running coding agents. The supervisor is Rust. Harnesses speak **ACP** through thin adapters. The thread UI is still React (`remote-codex-thread-ui`).

This branch replaces the TypeScript `supervisor-api` / `relay-server` / per-harness SDK stacks.

## Layout

- `crates/protocol` — wire DTOs
- `crates/runtime` — journal, files, ACP catalog, thread service
- `crates/supervisor` — HTTP + WebSocket
- `crates/relay` — public relay
- `crates/cli` — `remote-codex`
- `apps/supervisor-web` — existing product UI

## Run

```bash
cargo run -p remote-codex -- supervisor
# another terminal
pnpm install
pnpm --filter @remote-codex/supervisor-web exec vite --host localhost --port 5173
```

Open `http://localhost:5173`. Local mode has no login.

The packaged supervisor serves the Web UI itself:

```bash
npm install -g remote-codex@next
remote-codex start
remote-codex status
remote-codex stop
```

The npm launcher downloads a prebuilt Rust executable for the current OS, CPU,
and Linux libc on first use, verifies its pinned SHA-256 digest, and caches it.
It does not compile Rust or run network access in `postinstall`.

See [the native npm release design](docs/npm-native-release.zh.md).
The controlled main/relay rollout is documented in
[the Rust main cutover runbook](docs/rust-main-cutover.zh.md).

The native Windows Relay Device Manager is a stable bootstrap application. Its
WinForms UI manages pasted Relay configuration, workspace and port selection,
the private `remote-codex` npm runtime, connect/disconnect, runtime updates,
login startup, recovery, logs, and the notification-area icon. Runtime releases
do not rebuild the Device Manager: its Check and Update actions install the
newest `remote-codex` npm version. The `-cli.exe` asset in each runtime release
is used by the npm launcher and retains the general-purpose command surface.

Relay:

```bash
cargo run -p remote-codex -- relay
REMOTE_CODEX_MODE=relay REMOTE_CODEX_RELAY_SERVER_URL=ws://127.0.0.1:8788 \
  REMOTE_CODEX_RELAY_AGENT_TOKEN=rcd_... cargo run -p remote-codex -- relay-supervisor
```

Before replacing a Node 0.11 relay, stop the Node process and inspect the
existing data directory without changing it:

```bash
remote-codex relay-migrate --data-dir /var/lib/remote-codex-relay --dry-run
remote-codex relay-migrate --data-dir /var/lib/remote-codex-relay
```

The migration keeps `relay-store.sqlite`, writes an online-backup snapshot, and
does not delete a legacy `relay.sqlite`. Normal relay startup refuses an
unmigrated legacy store unless `REMOTE_CODEX_RELAY_AUTO_MIGRATE=1` is explicitly
set.

The local supervisor keeps the Node 0.11 tables in
`~/.remote-codex/supervisor.sqlite` and applies additive, transactional Rust
migrations. Existing workspaces, turns, history, queued input, and settings are
backfilled when the Rust supervisor first opens the database.

## Tests

```bash
cargo test --workspace
REMOTE_CODEX_E2E_FAKE_RUNTIME=1 pnpm test:e2e
```

Deterministic e2e uses `REMOTE_CODEX_E2E_FAKE_RUNTIME=1`. Production uses ACP (`codex-acp`, `claude-agent-acp`, `grok agent stdio`, `opencode acp`, …).
