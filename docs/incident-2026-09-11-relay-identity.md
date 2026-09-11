# Relay identity changed after launching from another project

The 0.12.27 npm launcher loaded `.env` from its working directory for every command. Starting `relay-supervisor` inside a project with a PostgreSQL `DATABASE_URL` imported that value and persisted it in `~/.remote-codex/relay-supervisor.json`.

The Rust runtime treated the value as a SQLite file path. On macOS, it created a relative `postgres:` directory, an empty database and a new transport identity. Starting from a fresh terminal did not fix this: the saved value survived, and a different working directory created another database and identity. Browser identity pinning correctly rejected these replacements.

The incident inspection found the original database and transport identity intact, with five workspaces and twelve threads. The accidental project database contained no workspaces or threads. The fingerprint displayed after launching from the home directory matched the accidental database under that directory. No private keys or device tokens are included here.

## Changes in 0.12.29

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

## Combined release and live recovery

Gemini ACP commit `0b1d60f8af598e1b8748ca8909a7494604deaafb` was integrated into the release. The combined source passed 254 Rust tests, with one explicitly manual installed-Gemini test ignored. PR #12 merged as `aed9ce8783b6848a98d028d20e4af5f9733681b9`. The shared UI is pinned to `f3cc41eb494dc85c6efe77914b8150bc38251bd6`.

Before publishing, the stopped Mac Supervisor was recovered using its original absolute database path, with a private backup of its saved configuration. Chrome loaded the original five workspaces successfully without deleting or changing the browser's identity pin. The running 0.12.27 instance exposed a working management Update API for the subsequent upgrade.

Gemini validation boundary: the real 0.59.0 CLI completed two turns against a local mock API. The user's external gateway independently returned `503 model_not_found` for `gemini-3.5-flash`, and native CLI history recovery reported `No previous sessions found`. Neither external behavior is claimed fixed by this release.

The first release workflow reached GitHub asset publication for 0.12.28 before cancellation. npm latest remained 0.12.27. A final installation preflight identified inherited `RUST_LOG=warn`, which would hide the connection log required by the updater. `RUST_LOG` and `LOG_LEVEL` are now stripped too, including stale tmux values; all 18 launcher/update tests passed again. The already published assets remain immutable. PR #13, merged as `2658a51b93cfc1284aaccfca9376ac53ef5985b2`, prepares the complete corrected release as 0.12.29.

The first 0.12.29 attempt stopped before publication because the version bump had not synchronized Cargo.lock. PR #14 updates only the five workspace versions; `cargo check --locked -p remote-codex` passes. Final release source: `bb574f6722eecf95de65e2a8d9865d0c354746fa`.

Release workflow: https://github.com/dufangshi/remoteCodex/actions/runs/34563352958

Relay deployment: https://github.com/dufangshi/remoteCodex/actions/runs/34562863440

## Final result

The npm upload was accepted at 04:49:32 UTC, but registry processing outlasted the publisher's visibility retry window. Its initial “integrity mismatch” was an unavailable version, not a different hash. Once visible, the registry tarball matched the retained CI tarball byte for byte, and every native-manifest hash and size matched the four immutable GitHub assets. Retrying only the failed publish job reused the same verified package; the release workflow finished successfully and npm `latest` is 0.12.29.

The device-scoped management Check/Update API upgraded the Mac from 0.12.27 to 0.12.29. The independent updater reported `completed`. Both the ordinary PATH command and npm-prefix command return 0.12.29, and `/healthz` confirms the running process is also 0.12.29. The new process logged a successful relay connection at 04:54:11 UTC. `relay-fingerprint` invoked from the original project directory reports the original fingerprint, and the saved configuration contains only namespaced keys with the original absolute database path. Chrome loaded all five original workspaces after the upgrade without changing the browser's identity pin.

Timing: combined local checks and recovery completed by 04:36 UTC. The final four-platform build's slowest platform was Windows at 3m50s; macOS took 2m34s, Linux x64 1m48s, and Linux ARM64 1m59s. Rust CI tests took 1m53s, Web 43s, package verification 12s, and native asset publication 10s. These stages overlapped and must not be summed as elapsed time. Registry processing and the publish-only retry occurred after packaging. Installed-version and browser verification completed at 04:55 UTC.

No Windows Device Manager version or bundled seed was changed. The original checkout's unrelated relay edits were preserved.
