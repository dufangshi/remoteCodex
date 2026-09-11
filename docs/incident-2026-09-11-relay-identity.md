# Relay identity changed after launching from another project

The 0.12.27 npm launcher loaded `.env` from its working directory for every command. Starting `relay-supervisor` inside a project with a PostgreSQL `DATABASE_URL` imported that value and persisted it in `~/.remote-codex/relay-supervisor.json`.

The Rust runtime treated the value as a SQLite file path. On macOS, it created a relative `postgres:` directory, an empty database and a new transport identity. Starting from a fresh terminal did not fix this: the saved value survived, and a different working directory created another database and identity. Browser identity pinning correctly rejected these replacements.

The incident inspection found the original database and transport identity intact, with five workspaces and twelve threads. The accidental project database contained no workspaces or threads. The fingerprint displayed after launching from the home directory matched the accidental database under that directory. No private keys or device tokens are included here.

## Changes in 0.12.28

- `relay-supervisor` and `relay-fingerprint` do not load project or package `.env` files.
- Public connection configuration accepts only `REMOTE_CODEX_RELAY_SERVER_URL`, `REMOTE_CODEX_RELAY_AGENT_TOKEN` and `REMOTE_CODEX_RELAY_SUPERVISOR_PORT`. Port values are validated before writing configuration. The listener remains on loopback.
- Generic runtime variables and unrecognized `REMOTE_CODEX_*` overrides are removed before the native relay device starts. Distribution and isolated-test launcher controls remain an explicit, namespaced allowlist. System environment and harness-owned credentials remain available to subprocesses.
- Saved absolute database paths migrate to `REMOTE_CODEX_DATABASE_PATH`. A previously saved database URI recovers the standard original database only when both that database and its identity exist. Ambiguous relative paths fail with repair instructions. Accidental databases are not deleted or merged.
- Rust relay mode ignores generic database, workspace, host, port, app and ACP configuration variables. The standalone native relay defaults to the same stable database path as the npm launcher. Local development retains its existing aliases.
- SQLite rejects database URIs before creating directories and does not include URI credentials in errors.
- `relay-fingerprint` reads the same saved database selection as the launcher.
- Workspaces exposes identity details directly from the error panel. Trust confirmation records exactly the displayed public key, rechecks its fingerprint, and does not delete the old pin to trust an arbitrary subsequent responder. Cached handshakes recheck the persisted pin; a successful verified reconnection clears the stale warning.

## Verification before the combined release

- `cargo test --workspace`: 250 tests passed.
- `pnpm npm:publish:test`: 18 tests passed, including dotenv contamination, saved-path recovery, explicit override rejection and stale tmux environment coverage.
- Device encryption component: two tests passed; Web typecheck and production build passed.
- Desktop Chromium: the Workspaces identity verification regression passed, including a different identity arriving while confirmation is open.
- Treer Apple container: four launcher regressions passed. A real Rust relay and supervisor restarted under a second working directory, retained identical identity bytes and public key, ignored generic environment overrides, and resolved the same fingerprint through the native diagnostic command. Test data and processes were isolated from the host Supervisor.

The release is being held for the concurrently developed Gemini ACP fix, as requested. The final combined commit and deployment results will be recorded after integration.
