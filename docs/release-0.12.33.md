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
