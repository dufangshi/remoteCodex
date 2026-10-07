# Claude reply delivered with an unresolved ACP prompt

Observed on Supervisor 0.12.63, thread `bf8cee0b-f8f6-4f33-bac6-40ae6713768c`, native session `7e6594b2-b876-4064-a2f8-02df6298884a`. Version 0.12.64 has identical ACP runtime code and does not fix this case. Installed Claude ACP 0.86.0 already contains the older abandoned-tool and background-agent handling; reinstalling that adapter is not a fix.

## Evidence

On 2026-10-07, a task notification started an autonomous Claude cycle at 04:20 UTC. It waited for an A1 inbox result. A new human prompt arrived at 04:24:43 and was recorded as a human `attachment.queued_command`, rather than an ordinary user echo. The inbox wait returned at 04:28:36. Claude read A4/A5 results and delivered the requested final answer at 04:29:47 with native `stop_reason: end_turn`.

The corresponding Remote turn `48223b46-9509-45b6-b1b2-ff192e8c7d5f` remained `inProgress`, all its visible tools were completed, and the device's authoritative `activeSubagents` and `pendingRequests` arrays were empty. The ACP adapter retained the queued prompt's promise while attributing the result to the autonomous task-notification cycle. Peer A1–A5 threads are independent sessions; their existence does not keep this ACP prompt open.

## Narrow reconciliation

The Claude overlay requests filtered `_claude/sdkMessage` lifecycle notifications when creating or loading a session. It keeps session-level task membership, including tasks from previous turns. It does not duplicate assistant output or expose raw SDK payloads in history.

Housekeeping requires all of these signals:

- The native queued human command exactly matches the prepared prompt, with a valid source UUID and no ambiguous later human input or unfinished native tool.
- The native `end_turn` text exactly matches the delivered reply, with a complete JSONL tail.
- That same UUID has SDK `started` and `completed` bookends within this turn, followed by a successful nonempty task-notification result and SDK idle state.
- The session task registry is known and empty, and both native and ACP agent registries are empty.
- The proof remains stable for three seconds. Incoming updates or steering invalidate it.

Only then does the runtime send ACP cancellation to drain the already-executed queued request. It awaits the real prompt response (`cancelled`, `end_turn`, or request-cancelled error) before finishing the Remote turn successfully. It never resubmits the prompt. User cancellation remains interrupted; provider errors remain failures. Steering and the final proof/write share the session lock, so housekeeping cannot sweep a new steer. Missing native files or unsupported SDK lifecycle extensions leave the ordinary ACP behavior in place.

The Web footer continues to show confirmed background-agent counts. With an idle delivered reply and no visible running tool, it explains that the turn is still waiting to finish. This UI works with 0.12.63; the runtime reconciliation requires an updated Supervisor and newly opened adapter connection.

## Validation

Targeted Claude native-reader and SDK lifecycle units, the existing abandoned-tool/background-agent protocol fixture, ACP turn integration tests, and a coalescing fixture cover successful draining, cancellation errors, previous-turn background tasks, missing/mismatched proof, unfinished tools, provider failures, explicit user cancellation and steering accepted before its native echo. The fixture verifies a subsequent prompt completes once on the same session. No production agent was cancelled or restarted for validation.

Shared UI regressions cover overlapping deferred/live step snapshots, repeated expansion and polling, waiting/completed/background states. Two desktop Chromium flows cover expansion, reload, completion and background-agent visibility, including a 320px viewport.

Treer Apple container verification is still pending: the Mac mini is reachable, but this workspace has no authenticated SSH identity for its `mac` account. Runtime publication must wait for that required recovery check; Web deployment is independent.
