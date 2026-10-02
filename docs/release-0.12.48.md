# Remote Codex 0.12.48

- Completion callbacks are always passive inbox mail. Parents collect child completion/results at checkpoints instead of starting a new turn for each child. Queued callback requests are rejected; still-pending legacy subscriptions also become passive after upgrade. Already-enqueued input is preserved.
- CLI-created descendants carry parent/root lineage with bounded nesting/fan-out and appear under grouped workspace tabs. Historical threads without recorded lineage need a separately verified repair; no title-based guessing is performed.
- Claude steering refuses detached new-turn fallback when the active turn finishes during delivery. Only an injected acknowledgement counts as delivery.

Publishing this runtime does not install it or restart any running Supervisor.
