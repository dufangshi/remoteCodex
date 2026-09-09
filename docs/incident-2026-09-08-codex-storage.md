# Codex history failure after network interruption

Affected Remote Codex thread: `532bd205-a638-4160-b396-50ccafbe541b`.
Provider session: `01a07276-c3cc-7e80-a1b5-f0c71eba2dee` (Codex ACP).

## Evidence

The public thread page reproduces `-32603`, `failed to list thread history`, and SQLite code 11 (`database disk image is malformed`) when connecting. The Supervisor database passes `quick_check`. Both the local Codex `state_5.sqlite` and `thread_history_1.sqlite` fail integrity checks; the latter includes damage to the `thread_items` table, not only an index. A Supervisor restart cannot repair these files. The available evidence does not establish that the network interruption caused the database damage.

Further inspection found damage in `logs_2.sqlite` too; goals, queue and memories databases passed integrity checks. The database headers identify SQLite 3.51.3 as the last writer, which includes the upstream WAL-reset fix. This does not rule out all historical writer bugs.

## Reproduced storage hazard

The local Supervisor runs directly on macOS. Separately, Apple container machine `treer` has `/home/mac/.codex` symlinked to `/Users/mac/.codex` over virtiofs. Mac Codex processes and the VM had open handles to the same database files. The state database also contains guest `/home/mac/...` rollout paths, confirming it has held both systems' session metadata.

A scratch-file probe reproduced broken cross-system coordination: while macOS held a byte-range lock, the guest acquired the same lock; while macOS held a SQLite WAL `BEGIN IMMEDIATE` write transaction, the guest also acquired a write transaction against that same file. No production database was used for this experiment. This is a demonstrated corruption mechanism and the leading explanation for the repeated damage, not proof of the exact historical write that first corrupted a page. [SQLite requires WAL readers and writers to share working locking and shared-memory coordination](https://sqlite.org/wal.html); [its corruption guide explains the consequences of broken locking](https://sqlite.org/howtocorrupt.html).

A second disposable-database test demonstrated actual lost committed data. A same-host competing writer correctly received `database is locked`. The guest instead inserted row 2 and committed while the Mac transaction inserting row 1 was still open. Both commits reported success, but reopening the database returned only row 2. `integrity_check` still returned `ok`, so structural checks alone do not detect this lost update. The result is preserved locally in `concurrent-write-result.json` alongside the probes.

The earlier Treer discovery failure was an inspection mistake: `container list` lists regular containers, whereas `container machine list` shows the running `treer` Linux VM. The separate Treer CLI error came from missing operator authentication; supplying the saved credential then exposed an unreachable configured Proxy address. Neither prevents local `container machine run -n treer -- ...` access.

Online SQLite backups are retained locally in `.local/codex-db-incident-20260908/`. Recovery was performed only on copies. Raw SQLite salvage passes integrity checks but includes orphaned records; it is not safe to claim lossless recovery of the entire shared database from salvage alone.

A second isolated Codex home reconstructed the affected session's history using its original 52 MB JSONL rollout. Native `thread/resume` accepts the original session ID and `thread/turns/list` returns 31 turns. All nonempty text prompts and the final reply match Remote Codex's retained history. Remote Codex shows 32 turns because it also retains an empty interrupted turn. This validates recovery of the affected conversation, not every other Codex conversation. Original databases and original rollouts were not replaced.

## Preventive changes

The Supervisor previously sent application heartbeats without a receive deadline. TCP writes alone cannot detect a half-open connection after a network change. The tunnel now sends WebSocket pings and reconnects if no frame arrives for 90 seconds; ping/pong writes have bounded timeouts. Existing exponential reconnect backoff remains in place.

SQLite corruption responses are classified as `harness_storage_corrupt` (503) with an actionable backup/recovery message, rather than displaying an opaque nested JSON-RPC failure.

Local-session import now respects Codex's `sqlite_home` setting and `CODEX_SQLITE_HOME` fallback, including machine-relative `~` expansion. Explicit relocation does not fall back to corrupt shared legacy files. Shared config takes precedence over the environment override, matching the native app-server experiment.

Validation: `cargo test --workspace -- --test-threads=2` passed all 243 tests, including the half-open WebSocket receive deadline, corruption error mapping, relocated history import and existing relay client routing integrations. A candidate Supervisor built and run in the Treer Apple container reconnected after 91.01 seconds when its original WebSocket stopped responding while TCP stayed open. Its process ID stayed unchanged and the new connection sent a heartbeat. Only the isolated test server was disrupted.

## Recovery boundary

Multiple live Codex processes hold the shared original databases. Do not replace, truncate, or remove their WAL/SHM files while these processes are running. Global repair requires a quiescent window, fresh backups after writers stop, and reconciliation of all affected sessions against their rollouts. Preserve rollback copies and verify the native history API before reopening normal writers.

## Applied recovery

Rather than replace shared files still held by other Codex processes, prepared new per-machine SQLite directories and retained the originals. Fresh metadata salvage preserves 359 thread records; history for the affected session was reconstructed through native resume from its rollout. Healthy goals, queue and memories databases were copied with SQLite's backup API. The damaged diagnostic log was backed up and a clean log database retained. Other conversations retain their original rollout files and metadata; complete recovery of every other conversation was not asserted.

The shared `config.toml` now contains top-level `sqlite_home = "~/.local/state/codex"`. Native Mac Codex 0.153.4 resolves this to `/Users/mac/.local/state/codex`; guest Codex 0.151.0 resolves it to `/home/mac/.local/state/codex`. Native probes verified all six SQLite databases follow this setting. The config and auth files remain the same shared files, and guest `account/read` still returns ChatGPT authentication. No one-time credential copy or second login is needed. Existing Codex processes need reopening to adopt the setting; their old open files were not replaced or deleted.

After the user authorized stopping the local Supervisor, restarted it and verified the original public thread through the browser. Its encrypted device connection recovered, the corruption banner disappeared, and a no-tools prompt received `RECOVERY_OK`. The original history remains available. The verification adds one turn after the 31 nonempty native history turns; the Remote Codex history additionally includes its preexisting empty interrupted turn.

The Treer Apple container installation skill was corrected in commit `a4b4afd` to require local SQLite while preserving shared config/auth, avoiding the original whole-directory sharing hazard on future setups.
