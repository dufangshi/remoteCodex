Fix Claude native background-task follow-up history.

- Keep recording after the foreground ACP reply while native background tasks are pending, through the SDK's follow-up completion and idle notification.
- Save the task-completion notification, subsequent progress, tool calls and token usage in the original turn. Duplicate notifications are recorded once.
- Preserve streamed history when a user adds input during the follow-up, stops the turn, or the adapter disconnects. Follow-ups without final reply text are also retained.
- This changes future live recording only; it does not backfill previously missing history.

Verified with an isolated ACP fixture and real SQLite persistence/history APIs covering normal completion, no final text, additional user input, cancellation and disconnection, plus Claude lifecycle, stream mapping and coalesced-turn regressions.

This release does not change the independently released Windows Device Manager.
