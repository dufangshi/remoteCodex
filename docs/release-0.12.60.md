# Remote Codex 0.12.60

When a follow-up prompt interrupts Claude while a tool call is still streaming, Claude ACP can retain the discarded tool placeholder and report `incomplete_tool_call` after delivering the final answer. The runtime now reconciles this specific error against the current native transcript after draining queued ACP updates.

A turn completes only when the native transcript contains both prompts and a normal `end_turn` answer matching the delivered answer, and none of the reported unfinished tool IDs was committed as a native tool call or result. Discarded placeholders remain visible as interrupted work with no recorded execution. Commands are never retried by this reconciliation. Genuine missing tool results, absent completion evidence, other provider errors, and user cancellation retain their existing behavior.

This fixes future turns after updating the running Supervisor. It does not rewrite previously failed turns. Version 0.12.59 contained the timeline UI fixes, but did not contain this ACP fix.

Validation: isolated ACP process regression covering discarded placeholders, real unfinished tools, and missing native completion; native transcript and item-mapping regressions; existing ACP turn, steering and error regressions; Rust formatting and runtime compilation checks. Release gates validate the workspace, Web package and all four supported native platforms.

Shared UI remains `dufangshi/remote-codex-thread-ui-rust@c365cc474ba66c0efff626f2b980f394e4a32365`.
