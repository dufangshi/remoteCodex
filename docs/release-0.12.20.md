# 0.12.20: tracked Codex goals and relay request recovery

Fix commit: `a220522a`. Shared UI: `c34bb966936655eb80b294ba8289dae4ed8cdcda`.

Codex ACP goal control can await an entire model turn, rather than only acknowledge a setting. Previously the HTTP goal endpoint waited for that extension while holding the ACP sessions mutex, without a tracked turn to capture output and permissions. This could keep the composer pending and exhaust the Supervisor tunnel request pool, including encryption handshakes.

Codex goal set/resume now uses the harness goal command inside the normal tracked prompt lifecycle, for both Codex and ACP Codex provider entries. The endpoint acknowledges after persisting the goal and user message; output, cancellation, and completion use the same path as ordinary turns. A running turn must be interrupted before starting another goal. Failed startup retains the composer draft. Control-only goal extensions release the global sessions mutex while awaiting their response and have a bounded exchange timeout.

The Supervisor tunnel bounds each forwarded request to 60 seconds and reserves a separate, bounded pool for encryption handshakes. Stalled application requests release their permits and cannot consume handshake capacity indefinitely.

Validation: 232 Rust workspace tests and 7 existing Goal composer tests passed. New fixtures cover tracked goal output under both provider modes, prompt acknowledgement before completion, interruption and subsequent prompts, stalled goal control followed by recovery, and release of forwarding capacity after timeout. Tests use protocol fixtures; no production model turn was submitted.

Update the device Supervisor to 0.12.20 to apply the fix. No shared Web UI or Windows Device Manager changes are included, and this release does not restart an already-running Supervisor automatically.
