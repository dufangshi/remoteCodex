# Remote Codex 0.12.65

This release includes the Claude autonomous-cycle prompt reconciliation described in [the completion investigation](claude-coalesced-prompt-completion.md), together with native watch state reconciliation.

## Watch investigation

Device `c19d012d-0ef1-4a9a-826a-8d4ff33ebf6d`, thread `6a434983-da70-44b0-b6ef-562d93f7160b`, was running Supervisor 0.12.64 when inspected over SSH. Its native job `0fbe7173` was created on 2026-10-02 at 12:42 device time and successfully cancelled at 12:44, before its first 12:47 firing. The user had instructed Claude to replace the continuous monitor with an explicit wait-and-review loop. Native JSONL records confirm a successful `CronDelete` result. A later successful `CronList` on 2026-10-05 at 23:50 device time returned no scheduled jobs. Neither the native session nor the Supervisor contains a scheduled firing of this watch.

The old runtime overwrote the completed deletion tool with its enclosing turn's `interrupted` status. The watch history reader skipped that cancellation and ignored `CronList`, leaving a historical creation unconfirmed. The browser was refreshing normally every 30 seconds; the incorrect state was rebuilt on every request.

The runtime now preserves completed tool results when the enclosing prompt is cancelled or fails. The watch reader also recovers old outcomes from the mapper-generated tool header, accepts only successful cancellation results, and reconciles a successful empty scheduler snapshot. A known new harness process rules out old session-only watches, while unknown or durable watches remain unconfirmed when no stronger evidence exists. Cancellation and scheduler checks bound trigger/cost attribution. The UI displays the status check time, distinguishes watches no longer scheduled, and explains unconfirmed records. No watch is recreated or cancelled by this read-only status lookup.

The legacy Treer validation requirement was removed from `AGENTS.md` at the user's request. Supervisor updates still use the independent management updater; this change does not alter the Windows Device Manager bootstrap.

## Validation

Targeted watch regressions cover cancellation in an interrupted turn, false/unfinished deletion results, empty scheduler snapshots, process epochs, lifetime bounds, trigger counts and cost totals. ACP integration verifies completed and unfinished tools keep distinct statuses on cancellation. Existing Claude completion protocol fixtures protect background work, user cancellation, steering and subsequent turns. Mobile Chromium watch flows verify cost/details compatibility and a 30-second poll moving stale watches into the past section.

The shared UI remains pinned to `71505384e9ea4e60ec4bfa7e9cab1cb8498931b2`, which also includes stable deferred/live step counts and the pending-turn completion hint. Publication uses the normal workspace/migration test gate and all four platform assets at 0.12.65; no partial asset replacement or Device Manager release is intended.
