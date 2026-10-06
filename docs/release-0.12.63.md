# Remote Codex 0.12.63

Claude can finish a user-facing reply while an async `Agent` is still reviewing
files. Its ACP adapter keeps the same prompt open until that agent returns and
the main model processes the result. The turn remains active during that work.
Previously, the successful launch receipt completed the Agent tool call and
removed it from the native subagent list. The remaining running dots and Stop
button gave no indication of the background work keeping the turn open.

The runtime now tracks confirmed native async Agent launch receipts until their
SDK-origin task notifications. Active subagent snapshots and updates include
these tasks even after the launching tool call completes. The Web UI shows the
background agent count in the turn footer and labels the agent as running in
background in its details panel. This information survives a page reload.
After the background result and main response finish, normal ACP completion
clears the active tasks and ends the turn.

The native reader excludes earlier turns, other sessions and sidechains. Human
messages quoting task notification XML cannot finish a tracked agent. The reader
also observes confirmed resumes of background agents within the current turn.
Devices need runtime 0.12.63 to supply this additional activity information;
0.12.61 and 0.12.62 do not include it.

Validation covers the gated ACP sequence of final text, live background work,
task notification and follow-up completion; launch/notification provenance and
history filters; footer and native subagent rendering; and a mobile browser
sequence including reload, WebSocket updates and a 320px viewport. Relevant
crate, formatting, compilation, UI type and build checks pass.
