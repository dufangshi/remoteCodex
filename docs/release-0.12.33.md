# Remote Codex 0.12.33

## Scope

- Add `thread send ID --delivery direct`: choose a durable new-turn continuation when idle or steering when running, on the server at acceptance. Default inbox remains passive; queue and steer remain explicit alternatives.
- Resolve delivery after request-ID deduplication. Pin new steering messages to the selected turn; a completed/replaced turn or backend failure cannot silently turn the message into queued work. Return resolved delivery and requestedDelivery in the receipt. Reject unsupported active steering and non-idle/non-running direct targets.
- Update native subcommand help and the embedded/project thread-interaction skill. Completion notification delivery remains inbox or queue.
- Include the previously committed temporary adoption-command removal and minimal-core test cleanup, plus main's reconnect ownership, update recovery, installed-version repair and lightweight CI fixes.
- Pin shared UI to published `8a3df59ab9fe8294a3b3f7856240f7b642604f9d` from `dufangshi/remote-codex-thread-ui-rust`, including its upstream uncertain-execution status label fix. Windows Device Manager is unchanged.

## Validation

- Runtime interaction regressions: six passing cases covering progressive reads, caller identity, passive durable inbox, direct completion, same-turn steering/retry, replacement-turn fencing and unsupported/state rejection. The final rejection fixture uses real ACP capability defaults because fake runtimes advertise steering.
- Authenticated HTTP CLI regression passed with direct idle dispatch to an ACP Grok fixture.
- Isolated Docker candidate binary and real npm launcher passed passive mail/ack, request deduplication, create-with-task, inbox notification, queued wakeup, direct idle dispatch, active direct steering, retry after completion without an extra turn, and subcommand help. This uses fake Codex/ACP Grok providers, without real model calls. Reproduce with `e2e/thread-interaction/inbox.py`.
- Rust formatting, diff checks and skill structural validation passed. Main's included recovery/updater/component checks passed during integration; the release workflow runs its workspace gate and builds all four supported native platforms.

No active host Supervisor restart is part of release verification. Release and public Relay deployment use the same pinned shared UI SHA.

## Publication

[PR #20](https://github.com/dufangshi/remoteCodex/pull/20) merged as `994095300315d145357416067f35c3bd86fe4c95`. [Runtime/npm release](https://github.com/dufangshi/remoteCodex/actions/runs/34661487436) succeeded on attempt 2, and [public Relay deployment](https://github.com/dufangshi/remoteCodex/actions/runs/34661488729) succeeded on the same runtime commit and pinned UI. npm latest is 0.12.33; [GitHub v0.12.33](https://github.com/dufangshi/remoteCodex/releases/tag/v0.12.33) contains four native assets plus SHA256SUMS.

The registry launcher tarball matches the original CI tarball byte-for-byte and its registry SHA-512. Its four-platform native manifest matches every GitHub checksum entry. The downloaded macOS native executable reports 0.12.33; its embedded skill matches the source (the CLI adds one terminal newline). The actual packaged launcher exposes direct and notification flags in thread send help, and no longer exposes adopt-queued in inbox help. The two relevant upstream UI status-label regressions also passed locally. The isolated Docker Supervisor was stopped; the active host Supervisor was not restarted.

Timing (UTC, 2026-09-12): final candidate committed before 00:22; release dispatched at 00:23:49. Web took 39 seconds, Rust gate 1m27s, and the slowest parallel native build (Windows) 4m22s. Packaging took 20 seconds. Relay deployment completed at 00:26:03; GitHub assets completed at 00:28:55. npm accepted the launcher at 00:29:07 but reported it was still processing. The visibility timeout at 00:30:14 was incorrectly reported by the existing script as an integrity mismatch. Once registry visibility and original artifact integrity were confirmed, only the failed npm job was rerun; it completed at 00:33:12 without rebuilding or overwriting assets. Final downloaded-artifact checks completed by 00:33:45.
