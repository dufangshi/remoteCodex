# Claude native background waits and wakes

A background Bash, Monitor, or asynchronous Agent task does not finish the
owning Pockymoe turn when the foreground ACP reply ends. The same turn stays
cancellable and retains its output subscription while it awaits task notices
and the autonomous follow-up. Follow-up tools, messages and usage use that
turn's existing durable event channel.

The timeline saves a small waiting anchor. A task notification updates that
anchor with its wake cause and timestamp; subsequent execution and reports
follow it. Repeated delivery of a terminal notice does not create another row.
Monitor progress events are distinct from terminal completion notices. A user
steer can temporarily resume work without consuming the eventual wake anchor.

SDK task snapshots and session state are the primary lifecycle evidence. SDK
`init` also occurs during autonomous cycles and must not reset task ownership.
When an adapter lacks these task bookends, native launch receipts and trusted
`task-notification` entries provide fallback ownership. The native reader starts
at the current file tail and excludes older turns, other sessions, sidechains,
and human-quoted task XML. This change does not backfill old history.

Lightweight history responses and collapsed turns keep waiting/wake anchors
and narrative visible; operation
steps remain expandable. After cancellation or disconnection the marker must
not keep claiming that the turn is waiting.

Targeted acceptance lives in `acp::runtime::completion_tests` (durable SQLite
history, native-only Bash, Monitor updates, duplicates, steering, cancellation,
and disconnect) and `e2e/thread-reading-polish.spec.ts` (desktop/mobile waiting,
wake, same-turn rendering, and reload). The opt-in real-harness test
`haiku_native_background_wake_stays_in_one_durable_turn` in
`crates/runtime/tests/claude_usage_live.rs` uses an isolated session and database;
it checks the wake anchor, post-wake command, final report and usage. The
companion `haiku_monitor_events_and_final_report_stay_in_one_durable_turn`
checks intermediate Monitor wakes as well as completion.

## Folding progress and final replies

Background waits, wakes and progress stay inside the same expandable execution history. A folded turn exposes only its native-confirmed final reply. The runtime writes `responsePhase: commentary | final` on background-turn agent messages: only the last delivered reply matching a complete native `end_turn`, with no pending tools/background tasks, receives `final`; cancellation, incomplete tails and unmatched text remain commentary. The UI conservatively folds untyped legacy background replies rather than treating the last progress update as a final answer. Expanding still shows all saved text; no old database rows are rewritten.
