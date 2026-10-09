# remote-codex guide automation

Durable hooks: schedules, completion triggers and scripts.

## Durable device hooks (explicitly registered automations)

Use `remote-codex automation` (aliases `hooks` / `hook`) for an authorized
interval/at prompt, other-thread completion, precise turn/task reminder, or script action.
Definitions use typed JSON; use `automation create --file hook.json` or `--json`.
Run `automation --help`, `automation create --help` and `command run --help` for
current flags. The registry is shared with the Web Automations panel and REST.

```bash
remote-codex automation create --thread self --request-id hourly-check --json '{"name":"Hourly check","trigger":{"kind":"interval","everySeconds":3600},"action":{"kind":"prompt","text":"Check the authorized project."}}'
# Set SOURCE_THREAD_ID to the other local Remote Codex thread UUID; no turn ID needed.
remote-codex automation create --thread self --request-id source-results --json "{\"name\":\"Other thread results\",\"trigger\":{\"kind\":\"threadEnded\",\"sourceThreadId\":\"$SOURCE_THREAD_ID\"},\"action\":{\"kind\":\"notifyInbox\",\"subject\":\"Source finished\",\"text\":\"Source turn ended.\",\"includeClosingMessage\":true}}"
remote-codex automation list --thread self
remote-codex automation runs --thread self AUTOMATION_ID
remote-codex automation pause --thread self AUTOMATION_ID
remote-codex automation resume --thread self AUTOMATION_ID
remote-codex automation cancel --thread self AUTOMATION_ID
remote-codex command run --thread self --command-key build --cwd . --timeout-seconds 120 -- cargo check -p remote-codex-runtime
```

`threadEnded {sourceThreadId}` listens to each source turn ending after registration,
including a turn already in progress. Only completed/failed/interrupted full turns
count, once per turn; tools/batches, idle, close and delete do not. Use typed
`statusIn` to filter statuses. Historical replay is not supported:
`replayExisting: true` is rejected. A closed/deleted source pauses the hook with sourceUnavailable;
reopening does not silently resume it. `turnEnded {sourceThreadId,turnId}` remains
available for one exact turn.

Only explicit prompt actions wake threads; ordinary results always remain passive
inbox. Busy schedules wait for the entire turn, coalesce extra ticks and survive
Supervisor restarts. Pause/cancel removes only that hook's unexecuted entries;
resume starts from future ticks. User Stop pauses prompt automations.

Command events observe only real `remote-codex command run` wrapper executions,
never arbitrary PTY or transcript text. Scripts can be actions of time or completion
triggers, with fixed argv or an explicit shell, cwd and timeout. Commands receive no
automatic connection credentials. Inspect `uncertain` executions before retrying;
spawned external side effects are not exactly-once and are never automatically
rerun after a crash. CLI request IDs deduplicate acceptance/execution intent;
`queued` is not completion. Native watches remain separate read-only evidence.
See `docs/unified-hooks.md` for complete JSON/HTTP examples and boundaries.
