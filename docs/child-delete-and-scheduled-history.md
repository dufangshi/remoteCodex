# Parent cleanup and Claude timer verification

`pockymoe thread delete CHILD_ID` deletes one finished or unused direct child.
The managed bearer token identifies its caller; a different `--from`, machine
credential, sibling, ancestor, unrelated root or indirect descendant is refused.
Active/recovering/queued work and descendants prevent deletion. No force or
recursive option exists. Cleanup releases only an independently owned idle harness
process and keeps workspace files, native history and delivered parent results.

Claude's native `CronCreate` was checked against two actual scheduled turns from
2026-10-04 at 16:50 and 17:11 UTC. Their native JSONL records include scheduled
prompts, assistant text, tools and terminal responses. Native triggering works,
but the released main branch did not yet include the scheduled-history recovery
commit. A claim such as “a watch will wake me” alone does not establish that a
scheduling tool succeeded.

The history fix now joins the parent-cleanup branch. An isolated Supervisor replay
used those two actual native record segments, without executing their prompts or
touching the live Supervisor. It verified:

- Both completed timer turns appear through the Web thread API and real CLI transcript.
- The idle WebSocket receives `scheduled_history_recovered` after persistence.
- Assistant messages and tool records are retained.
- Repeated reads and an isolated restart keep exactly two turns, with stable IDs.

Native timers remain session-only. Harness exit, child deletion or a Supervisor
restart discards pending native jobs; persistent scheduling is not implemented
here. Scheduled output is backfilled after a completed native turn, not streamed
as a new Supervisor-controlled live turn. Automatic child completion still only
stores passive inbox mail and does not wake a parent.

Targeted checks:

```sh
cargo test -p pockymoe-runtime --test thread_lineage --locked
cargo test -p pockymoe-runtime --test thread_interaction --locked
cargo test -p pockymoe-runtime claude_history --lib --locked
cargo test -p pockymoe-runtime codex_fork_releases_writer_before_independent_load --lib --locked
cargo test -p pockymoe-supervisor --test http_e2e cli_ --locked
cargo test -p pockymoe child_delete_is --locked
cargo check -p pockymoe-supervisor -p pockymoe --locked
cargo fmt --all -- --check
```

The real replay's generated logs/receipts are ignored under `.local/wake-replay`;
its temporary Supervisor was stopped and CLI credential removed. No production
thread was deleted, restarted or sent a prompt during verification.
