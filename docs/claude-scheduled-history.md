# Claude scheduled-turn history

Claude's `CronCreate` / `/loop` turns can run between Remote Codex prompts. Older
Claude ACP/SDK versions may execute them in the native session JSONL without
sending the idle client their output. The runtime's prompt-scoped ACP receiver
cannot be relied on to capture those turns.

Opening/polling thread history or requesting a CLI transcript now recovers
**finished** turns explicitly marked `turnOrigin: scheduled` from that session's
local JSONL. The saved turn contains the timer prompt, assistant progress/final
messages, reasoning and tool calls/results. Native timestamps and stable IDs are
used; repeated reads and runtime restarts do not create duplicate turns.

The existing background execution observer keeps checking sessions registered by
history readers. New recovered turns emit `thread.updated` after the transaction
commits, so an already-open idle page refreshes without a manual reload. Repeated
checks of the same completed turn emit no duplicate update.

This is a read-only recovery path, not a second scheduler or a second writer.
It does not wake the agent, modify its native logs, import ordinary prompts or
subagent transcripts, or claim that a still-running task has finished. Recovery
waits for terminal assistant text and never races a client-owned active turn.
There is no live autonomous execution/control claim: intermediate messages are
backfilled after that scheduled turn finishes. An SDK that fails to execute the
task at all still needs an upstream fix or a Supervisor/CLI-based scheduler.

File checks are throttled to five seconds per thread; unchanged files are not
parsed again. Only the exact native session UUID's file is inspected. No OAuth
requests, harness probes, native credential access or inference are involved.
