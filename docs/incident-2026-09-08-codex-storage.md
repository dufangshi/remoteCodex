# Codex history failure after network interruption

Affected Remote Codex thread: `532bd205-a638-4160-b396-50ccafbe541b`.
Provider session: `01a07276-c3cc-7e80-a1b5-f0c71eba2dee` (Codex ACP).

## Evidence

The public thread page reproduces `-32603`, `failed to list thread history`, and SQLite code 11 (`database disk image is malformed`) when connecting. The Supervisor database passes `quick_check`. Both the local Codex `state_5.sqlite` and `thread_history_1.sqlite` fail integrity checks; the latter includes damage to the `thread_items` table, not only an index. A Supervisor restart cannot repair these files. The available evidence does not establish that the network interruption caused the database damage.

Online SQLite backups are retained locally in `.local/codex-db-incident-20260908/`. Recovery was performed only on copies. Raw SQLite salvage passes integrity checks but includes orphaned records; it is not safe to claim lossless recovery of the entire shared database from salvage alone.

A second isolated Codex home reconstructed the affected session's history using its original 52 MB JSONL rollout. Native `thread/resume` accepts the original session ID and `thread/turns/list` returns 31 turns. All nonempty text prompts and the final reply match Remote Codex's retained history. Remote Codex shows 32 turns because it also retains an empty interrupted turn. This validates recovery of the affected conversation, not every other Codex conversation. Original databases and original rollouts were not replaced.

## Preventive changes

The Supervisor previously sent application heartbeats without a receive deadline. TCP writes alone cannot detect a half-open connection after a network change. The tunnel now sends WebSocket pings and reconnects if no frame arrives for 90 seconds; ping/pong writes have bounded timeouts. Existing exponential reconnect backoff remains in place.

SQLite corruption responses are classified as `harness_storage_corrupt` (503) with an actionable backup/recovery message, rather than displaying an opaque nested JSON-RPC failure.

Validation: `cargo test --workspace -- --test-threads=2` passed all 241 tests, including the half-open WebSocket receive deadline, the corruption error mapping, and the existing relay client routing integration tests. No production Supervisor restart or shared database replacement was performed.

## Recovery boundary

Multiple live Codex processes hold the shared original databases. Do not replace, truncate, or remove their WAL/SHM files while these processes are running. Global repair requires a quiescent window, fresh backups after writers stop, and reconciliation of all affected sessions against their rollouts. Preserve rollback copies and verify the native history API before reopening normal writers.

Do not test network interruption by disconnecting the active host Supervisor. The requested Treer Apple container validation machine was unavailable in this session: the local container list was empty and Treer CLI required operator authentication. Protocol fixture tests can run locally; live machine reconnect verification remains pending.
