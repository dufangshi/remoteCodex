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

Relay:

```bash
cargo run -p remote-codex -- relay
REMOTE_CODEX_MODE=relay REMOTE_CODEX_RELAY_SERVER_URL=ws://127.0.0.1:8788 \
  REMOTE_CODEX_RELAY_AGENT_TOKEN=rcd_... cargo run -p remote-codex -- relay-supervisor
```

## Tests

```bash
cargo test --workspace
REMOTE_CODEX_E2E_FAKE_RUNTIME=1 pnpm test:e2e
```

Deterministic e2e uses `REMOTE_CODEX_E2E_FAKE_RUNTIME=1`. Production uses ACP (`codex-acp`, `claude-agent-acp`, `grok agent stdio`, `opencode acp`, …).
