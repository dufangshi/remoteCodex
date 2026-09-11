# Remote Codex 0.12.31

## Changes

- A database has one cooperating Supervisor owner, enforced by an OS lock before migrations or recovery. Playwright supplies isolated primary and legacy database settings so inherited production configuration cannot select its database.
- Execution observations use the common runtime/harness adapter contract for Codex, Claude, OpenCode and ACP. A live backend repairs stale persisted status; uncertain execution is shown as “Confirming status”. Late turn events are fenced, completion is saved before broadcast, and interruption wording does not incorrectly attribute cancellation to the user.
- Prompt acceptance is durable before HTTP acknowledgement. Full pending payloads survive restart, and per-thread request IDs prevent duplicate delivery after consumption or retry. Uncertain execution does not blindly replay the original prompt.
- Settings shows Supervisor uptime and supports manual restart through the independent maintenance worker without changing the installed version. Only device owners can use management endpoints; thread, workspace and device sharing grants do not authorize restart. Maintenance preserves session IDs and pending input, and resumes only maintenance-interrupted tasks.

See [execution-reliability.md](execution-reliability.md) for state authority, ACP limitations, delivery semantics and recovery details. Windows Device Manager is unchanged. Existing devices need Check/Update to install the runtime changes; deploying Web does not update their running Supervisor.

## Validation

- Final local `cargo test --workspace`: 267 passed; one existing installed-Gemini manual test ignored. [Platform CI](https://github.com/dufangshi/remoteCodex/actions/runs/34624380776) passed on macOS, Linux and Windows, including Linux formatting and Clippy checks.
- Web: typecheck, production build, five focused runtime-management tests and 23 shared presentation/timeline tests passed. The explicit desktop Chromium recovery test verifies live-state repair, composer queueing, reload retention and one subsequent user turn with a hostile inherited database setting.
- Nine updater tests passed, including restart without registry access or package installation. CI also verified the installed npm product's startup, Web/API, status and shutdown.
- Treer Apple Container ran the real 0.12.31 Supervisor and independent restart worker with deterministic harnesses for all four providers. Each retained its session and produced one interrupted turn, one maintenance continuation and one queued turn. An idle task remained idle. Evidence: `/home/mac/remote-codex-update-test/restart-Mv3mUQ/result.json`. Real ACP lifecycle behavior is covered separately by protocol fixtures. The active host Supervisor was not restarted.
- The first macOS CI attempt exposed a test-only fork/exec timing race: a concurrently spawned child can briefly inherit the lock descriptor. The restart test now waits with a bounded deadline for actual lock release. The final platform run passed.

## Published result

- [PR #16](https://github.com/dufangshi/remoteCodex/pull/16) merged as `a6ec5fdfab0e4b524271645f93727bb87a15d7ac`.
- Shared UI: `ce7a46b4dabccee3e01ba751c4d0dc466de7608e`, merged through [shared UI PR #3](https://github.com/dufangshi/remote-codex-thread-ui-rust/pull/3). Both release workflows use this exact pushed SHA.
- [Runtime/npm release](https://github.com/dufangshi/remoteCodex/actions/runs/34625671875): success, attempt 2. [GitHub v0.12.31](https://github.com/dufangshi/remoteCodex/releases/tag/v0.12.31) contains all four native assets and `SHA256SUMS`; npm `latest` is `0.12.31`.
- The downloaded npm archive was byte-identical to the original CI artifact. Its four-platform native manifest matched GitHub checksums. The downloaded macOS executable matched its SHA-256 and reported `0.12.31`; the published npm launcher also reported `0.12.31`. Packaged Web contains the new settings and status UI.
- [Public Relay deployment](https://github.com/dufangshi/remoteCodex/actions/runs/34625674680): success. Public assets changed to `index-c9QITkY-.js` and `thread-ui-DKVh0Elj.js`; fetched content contains restart, uptime, owner-only management and uncertain-state labels. Health was `ok` with ten connected Supervisors after deployment. Browser interaction and permission enforcement were verified by the focused local and server tests above.

Timing (UTC, 2026-09-11): the implementation was committed at 16:45:14. Final local workspace tests ran 16:50:04–16:51:11; the final candidate was committed at 16:51:19 and merged at 17:04:48 after cross-platform CI (Windows 12m50s). Release dispatch was 17:04:59. Web took 41s, the Rust release gate 2m04s, the slowest parallel native build (Windows) 4m43s, and packaging 18s. GitHub assets finished at 17:10:21; Relay deployment finished at 17:07:34. Downloaded-package checks completed at 17:16:04; npm confirmation finished at 17:16:19.

npm accepted the upload at 17:10:39 but reported that processing could take a few minutes. The publishing script exhausted its visibility check at 17:11:47 and called the missing registry entry an integrity mismatch. Once the version became visible with the exact expected SHA-512, only the failed publishing job was rerun. It skipped the matching immutable package and confirmed `latest`; no package or native asset was overwritten.
