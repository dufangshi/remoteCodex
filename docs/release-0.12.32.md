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
