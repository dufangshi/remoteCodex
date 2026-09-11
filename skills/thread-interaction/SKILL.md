---
name: thread-interaction
description: Create, message, and inspect peer remoteCodex threads on this device. Use for cross-provider collaboration, passive inbox exchange, explicit task dispatch or steering, completion callbacks, and progressively reading conversation history.
---

# Interact with remoteCodex threads

Threads are peers. Each can create others, message existing threads, read state/history, or receive requests. This is a Supervisor-level interface across Codex, ACP Grok, and other installed providers. Creation does not copy your conversation or allocate a separate checkout. Peers in one workspace share files; assign ownership or existing separate worktrees for overlapping edits.

`remote-codex skill` prints this entire bundled guide. Data commands return JSON; help and this guide return text. Use `remote-codex thread send --help`, `remote-codex inbox --help`, and other command-specific help to discover exact flags. Check exit status and the returned delivery state. A receipt is not proof of task completion.

## Identity and discovery

```bash
remote-codex thread self
remote-codex thread list --limit 20
remote-codex thread list --workspace WORKSPACE_ID --limit 10
remote-codex thread status THREAD_ID
remote-codex thread backends
remote-codex thread models --provider codex
remote-codex thread models --provider acp --agent grok
```

Use **remoteCodex thread IDs**, the last segment of `/devices/DEVICE_ID/threads/THREAD_ID`, not native Codex/ACP session IDs. A target may be a UUID or a full Web thread URL on the current device; the CLI does not route across devices. `self` identifies your caller. `list` defaults to 20 entries, capped at 100, without transcripts. `status`/`show` return lightweight metadata including `activeTurnId`, `queuedCount`, `unreadMessageCount`, `waitingForInput`, and `lastError`.

Reuse a peer when its workspace, model, and earlier work fit. Read status and only enough recent transcript to assess context. Create when separate context or another model is useful. Save useful peer IDs and their purpose in working notes; there is no separate child-thread registry.

Model IDs and effort options come from local discovery. Preserve explicitly requested models; do not invent an ID from a display name or silently substitute another model. Availability depends on the installed harness and working directory.

## Choose the delivery semantics explicitly

| Intent | Delivery | Behavior |
| --- | --- | --- |
| Report, question, result, intermediate finding | `inbox` (send default) | Durable passive mail. Does not start, queue, or interrupt a turn. Receiver reads it via CLI. |
| Assign work and have the peer execute | `queue` | Durable continuation. Starts when idle; waits behind active execution. |
| Correct an active task immediately | `steer` | Requires an active turn and backend steering capability. Requests input in that turn; not a guaranteed interruption of a blocking tool. |

```bash
remote-codex thread send PEER_ID --text 'Build artifact is ready at /path/to/artifact.'
remote-codex thread send PEER_ID --delivery queue --text-file /tmp/task.txt
remote-codex thread send PEER_ID --delivery steer --text 'Pause publication: use the corrected version number.'
```

Do not use queue or steer for every acknowledgement. Passive mail avoids chains of agents repeatedly creating turns for each other. Mail is not automatically pushed into an active model's context: the receiver must check its inbox. When collaborating, check at natural checkpoints, after relevant long commands, before dependent work, and before ending a turn while expecting a peer result. There is no automatic hidden polling or guaranteed response deadline.

Use queue to wake an idle peer or delegate a task without relying on inbox polling. Use steer only when the current task needs the input promptly. A provider without steering rejects the request; it is not silently downgraded to queue. If a steering race or backend error occurs after acceptance, the receipt reports `delivery: "held"`, an `error`, and the pending ID. The held message cannot auto-run as a continuation. Inspect history/status before retrying an uncertain acknowledgement, or move the held message to the inbox. Successful steering reports `steered`; a provider acknowledgement does not prove the agent followed the instruction.

## Read and acknowledge your inbox

```bash
remote-codex inbox
remote-codex inbox list --limit 10
remote-codex inbox read MESSAGE_ID
remote-codex inbox ack MESSAGE_ID
remote-codex inbox list --all --limit 10
```

The caller's identity selects the mailbox. `--thread THREAD_ID` explicitly selects another mailbox, including from a shell without managed thread identity. IDs/URLs address the same local Supervisor; attribution is not a per-agent security boundary.

List returns bounded previews (240 characters), sender, recipient, creation timestamp, and acknowledgement timestamp. It defaults to 20 unread messages, capped at 100, displaying the selected page chronologically. Follow `nextBefore` with `inbox list --before MESSAGE_ID` for older pages, preserving `--all` if used. Default listing does not guarantee every unread message fits on one page.

Read returns at most 8192 Unicode characters. Follow `nextTextOffset` with `inbox read MESSAGE_ID --text-offset OFFSET` when needed. Reading does **not** mark mail processed, including after a crash. Acknowledge only messages you have handled or deliberately recorded for later action. `ack` accepts 1–100 explicit IDs atomically and is safe to repeat; acknowledged messages remain accessible with `--all` or `read`. Do not mark messages acknowledged merely to hide a queue count.

A reply uses the sender's `fromThreadId`:

```bash
remote-codex thread send SENDER_ID --text-file /tmp/result.txt
remote-codex inbox ack MESSAGE_ID
```

An idle sender will not wake for that default passive reply. If a wake-up is needed and authorized, use `--delivery queue`. Include the concrete response destination and delivery expectation in delegated instructions. Avoid reflexive mutual acknowledgements or reciprocal completion subscriptions.

## Create and dispatch a task

```bash
remote-codex thread create --title 'Build helper' \
  --provider acp --agent grok --model MODEL_ID --reasoning-effort EFFORT \
  --text-file /tmp/build-request.txt --notify-on-complete
```

Create defaults to provider `acp`, model `default`; it does not inherit the caller's model. Workspace and approval mode inherit from the caller unless specified. `--workspace WORKSPACE_ID` selects an **existing** workspace; provide it from an unscoped shell. `--approval-mode guarded|yolo` is supported; thread creation does not expand user authorization.

Unlike ordinary `send`, a create's initial prompt defaults to **queue**, so the new peer actually starts its assigned task. Creating without prompt leaves it idle. `--delivery inbox` explicitly makes the initial message passive. Creation and first send are sequential, not one idempotent transaction. If send fails after creation, the error includes the created thread ID: reuse it instead of creating a duplicate.

`--text` and `--text-file` are mutually exclusive. `--text-file -` reads stdin. Use a quoted heredoc or a file for multiline text so the shell cannot execute dollar expansions/backticks:

```bash
remote-codex thread send PEER_ID --delivery queue --text-file - <<'PROMPT'
Build the assigned checkout with the documented command.
Report command, exit code, artifact paths, and blockers.
Send the result to CALLER_THREAD_ID using default inbox delivery.
Do not publish packages as part of this build task.
PROMPT
```

Replace placeholders before sending. Provide goal, checkout, relevant files, constraints, expected artifacts, and reply destination. Do not copy your entire transcript by default. Execute external actions such as publication only within the user's authorization.

## Completion notifications

`--notify-on-complete` subscribes to the receiving **execution turn**, so it requires queue/steer delivery plus a caller identity. Passive inbox messages have no execution turn and reject this flag. It is a per-send subscription, not a permanent watch of future activity.

The default completion notification goes to the caller's inbox. It includes peer/thread IDs, terminal status (`completed`, `failed`, or `interrupted`), timestamp, and a transcript command, rather than dumping the result. It does not automatically wake the caller.

To finish your own turn and resume when the peer completes, explicitly request a queued callback:

```bash
remote-codex thread send PEER_ID --delivery queue --text-file /tmp/task.txt \
  --notify-on-complete --notify-delivery queue
```

An idle caller starts a new turn; a busy caller receives queued input. This choice deliberately retains a queue and can accumulate if overused. Prefer passive notifications when you are already doing independent work and can check the inbox. Completion describes execution, not business success: read that turn and verify artifacts/exit codes before dependent actions. Using explicit peer replies and automatic notifications together can intentionally produce two messages.

## Reconcile an old backlog

Before 0.12.32, CLI sends and completion callbacks defaulted to queue. Existing entries and already-created subscriptions preserve their old behavior after upgrade; nothing is silently deleted or reinterpreted.

```bash
remote-codex thread status THREAD_ID
remote-codex inbox adopt-queued --thread THREAD_ID
remote-codex inbox list --thread THREAD_ID
```

`adopt-queued` explicitly moves unconsumed peer prompts, completion notices, and held CLI steering requests to passive mail. Ordinary user prompts, already-steered messages, and update/restart markers are excluded. Moved task messages lose their pending completion subscriptions because they no longer promise an execution turn. A message already consumed before the transaction is not moved. This does not cancel an active turn. Read and decide what still needs work; dispatch a new explicit task only when appropriate.

## Retries and progressive transcript reads

Use a stable `--request-id` for a send that might need retrying. Exact same target/sender/key/text/delivery/notification choices return its durable receipt; conflicting input is rejected. New messages need new keys. Without a key, inspect before resending after a lost connection. Deduplication applies to sends, not thread creation. Delivery defaults changed in 0.12.32: preserve explicit delivery choices in automation; inspect older receipts rather than blindly retrying a pre-upgrade request with new defaults.

```bash
remote-codex transcript THREAD_ID
remote-codex transcript THREAD_ID --limit 1
remote-codex transcript THREAD_ID --before-turn TURN_ID --limit 3
remote-codex transcript THREAD_ID --turn TURN_ID --view overview
remote-codex transcript THREAD_ID --turn TURN_ID
remote-codex transcript THREAD_ID --turn TURN_ID --item ITEM_ID
remote-codex transcript THREAD_ID --turn TURN_ID --item ITEM_ID --raw
```

Default transcript: latest 3 turns, chronologically, with saved user input and **all** assistant progress/final text and available timestamps. `--limit` is capped at 20. `--before-turn` selects older turns and cannot be combined with `--turn`. Inbox mail appears in the inbox; merely reading it does not fabricate a user-message turn in the transcript.

A selected turn defaults to a paginated item directory (tools, reasoning, commands, other saved items). `--view overview` selects its conversation text. Expand only relevant items using the returned `detail`, `expand`, and continuation commands. `--offset` continues the item directory; `--text-offset` continues long text. An overview can contain truncated/partial messages: absence from one page is not proof of absence from history. `--raw` is bounded text chunks of exact saved JSON, not necessarily independently parseable JSON objects. Reassemble only when necessary. Running turns can change between reads; use returned observation/update timestamps and status.

## Local connection and failures

Managed sessions receive `REMOTE_CODEX_THREAD_ID`, `REMOTE_CODEX_URL`, and credentials. Use them as supplied. Do not dump environment variables, print tokens, or send credentials in a prompt. `--from` overrides attribution for a known remoteCodex caller; it does not grant permission.

A normal shell may use `--cli-config PATH` / `REMOTE_CODEX_CLI_CONFIG`; otherwise the CLI discovers a protected `.cli.json` sibling of the configured Supervisor database. `--url` / `REMOTE_CODEX_URL` and `--token` / `REMOTE_CODEX_TOKEN` override connection fields. Prefer the environment or protected file over a command-line token. This is a machine-scoped local credential, not per-thread isolation.

Only loopback HTTP is accepted; redirects are refused. Run on the target device. A missing connection is a configuration issue, not a reason to copy credentials into a prompt. After Supervisor restart use the current connection file if inherited credentials are stale. Invalid model, unknown thread, missing caller, and unsupported steering need corrected input, not repeated dispatch. `idle` is not task success: inspect errors, pending input, unread mail, and the relevant result.
