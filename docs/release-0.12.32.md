# Remote Codex 0.12.32

## Scope

- Ordinary peer `thread send` defaults to a persistent passive inbox, with bounded list/read and explicit acknowledgement. No new database tables. `thread status` includes unread count.
- `--delivery queue` explicitly schedules work; `--delivery steer` explicitly sends into an active capable backend. Failed steering after acceptance is held, never automatically downgraded into another turn. Initial prompts on create still default to queue.
- Completion notifications default to inbox; `--notify-delivery queue` explicitly wakes the caller. Existing subscriptions retain their previous delivery choice. `inbox adopt-queued` explicitly moves unconsumed peer messages and held steering into the inbox, cancelling their pending completion subscriptions while preserving ordinary user input and update markers.
- The npm launcher forwards native subcommand help instead of replacing it with top-level help. Top-level help lists the peer CLI. The embedded skill documents the delivery change, receipt semantics, inbox checkpoints and backlog migration.
- Includes workspace fix `1fd4ccf2465d161f1fe9358231cd4e79639e9bbc`: verify Supervisor update/restart using actual Relay registration state, handle legacy log paths/byte offsets, keep the new installation on failed verification instead of unsafe downgrade, and clarify Settings update/connection state.

The original checkout's dirty relay file is only a formatting change (canonical rustfmt output matches its base), so it is retained there without introducing formatting noise into this release. Shared UI remains pinned to published `f3cc41eb494dc85c6efe77914b8150bc38251bd6` from `dufangshi/remote-codex-thread-ui-rust`. Windows Device Manager is unchanged.

## Validation

- Rust workspace: 271 passed, 1 existing installed-Gemini manual test ignored.
- Node launcher/updater: 18 passed; native subcommand help is exercised through the real launcher with a portable fake native executable.
- RuntimeManagement component: 8 passed; Web typecheck and production build passed.
- Skill validation passed.
- Isolated Docker actual CLI/HTTP/KV test: passive inbox, ack/read history, request deduplication, create with initial execution, both completion-delivery modes, busy queue adoption, same-turn steering, and launcher help passed. Codex and ACP Grok are fake-runtime provider fixtures at this boundary, with no model calls. Reproduction: `e2e/thread-interaction/inbox.py`.
- The included update/restart fix's unchanged recovery path already passed its recorded Treer Apple Container real relay + independent worker tests (two restarts with registry access blocked and an empty log override). Evidence and exact boundaries are recorded in `docs/supervisor-update-recovery.md`; the active host Supervisor was not restarted for this release.

## Publication

[PR #17](https://github.com/dufangshi/remoteCodex/pull/17) merged as `796298b0fd257a07e4282f0639ca8887188a4aa7`. [Runtime/npm workflow](https://github.com/dufangshi/remoteCodex/actions/runs/34635445866) succeeded on attempt 2; [public Relay deployment](https://github.com/dufangshi/remoteCodex/actions/runs/34635448278) succeeded with the same runtime and pinned shared UI. npm `latest` is `0.12.32`, and [GitHub v0.12.32](https://github.com/dufangshi/remoteCodex/releases/tag/v0.12.32) contains all four native assets plus `SHA256SUMS`.

The registry tarball was downloaded and compared byte-for-byte with the original CI artifact. Its native manifest matches all four GitHub checksum entries. The downloaded macOS executable reports `0.12.32` and its bundled skill matches the project file. Through the actual packaged npm launcher, `thread send --help` exposes delivery/notification flags and `inbox --help` exposes list/read/ack/adopt-queued instead of top-level service help.

Timing (UTC, 2026-09-11): local integration began at 18:32:29 and the final candidate was committed at 18:48:31. Release dispatch was 18:49:25. Web build took 44 seconds, Rust gate 2 minutes, and the slowest parallel native build (Windows) 4m6s; packaging took 15 seconds. Relay deployment finished at 18:51:54 and GitHub assets at 18:54:12. Final registry/download checks finished by 19:00:06.

npm accepted the package at 18:54:37 with a processing-delay notice. The publishing script exhausted its visibility window at 18:55:45 and mislabeled the absent registry integrity as a mismatch. Once the version appeared with the original expected SHA-512, only the failed npm job was rerun; it skipped the existing matching immutable package, checked the requested tag, and completed at 18:59:05. No assets or package versions were overwritten, and no native rebuild was needed. The isolated Docker test service was stopped after verification; the host Supervisor was not restarted.
