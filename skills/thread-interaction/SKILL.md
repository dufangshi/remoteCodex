---
name: thread-interaction
description: Create, message, and inspect peer remoteCodex threads on the current device with the remote-codex CLI. Use for delegation, cross-provider collaboration, progress checks, completion callbacks, or resuming work with an existing agent.
---

# Interact with remoteCodex threads

Use this interface for peer-to-peer collaboration. Threads have equal capabilities: any thread may create another, contact an existing thread, or read its state and history. There is no mandatory parent/child hierarchy, one-message limit, or requirement to wait for a reply before sending again. The Supervisor owns this interface; it works across providers and is independent of native Codex or ACP session APIs.

This skill is also embedded in the runtime: `remote-codex skill` prints this entire guide without needing a project checkout. Use command-specific `--help` for option syntax. Data commands return JSON; `skill` and help return text. Logs and errors go to stderr. Check the exit status before treating output as a successful result.

## Identify yourself and choose a peer

```bash
remote-codex thread self
remote-codex thread list --limit 20
remote-codex thread list --workspace WORKSPACE_ID --limit 10
remote-codex thread status THREAD_ID
```

`self` returns your remoteCodex identity and status. `list` returns lightweight metadata, not transcripts; its limit defaults to 20 and is capped at 100. `show THREAD_ID` and `status THREAD_ID` return the same lightweight thread state, including workspace, provider, agent, model, effort, active turn, queued count, waiting-for-input state, and last error.

Use **remoteCodex thread IDs**, not native Codex session IDs or ACP session IDs. The last segment of a Web URL such as `/devices/DEVICE_ID/threads/THREAD_ID` is the thread ID. Commands accepting a target ID also accept a full Web thread URL, but reject URLs for another device. A URL does not turn this local CLI into a cross-device router.

Reuse a suitable thread when its workspace, earlier work, and model match the task. Read its status first and a small transcript only if needed to assess context. Create a new thread when separate context, another model, or independent work is useful. Keep useful peer IDs with their purpose in your working notes; the CLI does not provide a separate child-thread registry. Creation does not copy your conversation or allocate an isolated checkout. Peers in the same workspace can touch the same files: agree on ownership or assign existing separate worktrees when concurrent edits would overlap.

## Discover providers and create threads

```bash
remote-codex thread backends
remote-codex thread models --provider codex
remote-codex thread models --provider acp --agent grok
```

Use the advertised provider, agent, model IDs, and supported reasoning options. Preserve an explicitly requested model and effort. Availability depends on the local device and installed harness; do not infer an ID from a marketing name or silently substitute a different model. Model discovery uses the caller's working directory when available.

For example, when these IDs appear in discovery:

```bash
remote-codex thread create --title 'Build helper' \
  --provider acp --agent grok --model grok-4.6 --reasoning-effort xhigh

remote-codex thread create --title 'Implementation reviewer' \
  --provider codex --model gpt-6-astra --reasoning-effort high
```

Check the actual returned model IDs before using these examples. `create` defaults to provider `acp` and model `default`; it does not implicitly inherit the caller's model. The caller's workspace and approval mode are inherited unless explicitly supplied. `--workspace WORKSPACE_ID` selects an **existing** workspace; an unscoped shell must supply one. `--approval-mode guarded|yolo` is available, but another thread does not gain permissions beyond the user's authorization just because you can create it.

Creation can leave the new thread idle or submit its first prompt:

```bash
remote-codex thread create --workspace WORKSPACE_ID --title 'Build helper' \
  --provider acp --agent grok --model MODEL_ID --reasoning-effort EFFORT \
  --text-file /tmp/build-request.txt --notify-on-complete
```

Save the returned thread ID and, when present, the send receipt. Creating the thread and sending its first prompt are sequential operations, not one idempotent transaction. If sending fails after creation, the error includes the created thread ID; contact that thread instead of creating another by accident.

## Send messages without waiting

```bash
remote-codex thread send THREAD_ID --text 'Please inspect the last build failure.'
remote-codex thread send THREAD_ID --text-file /tmp/build-request.txt
```

`--text` and `--text-file` are mutually exclusive; `--text-file -` reads stdin. For multiline instructions or text containing shell syntax, use a file or a quoted heredoc so the shell does not execute backticks, dollar expansions, or command substitutions:

```bash
remote-codex thread send THREAD_ID --text-file - <<'PROMPT'
Build the assigned checkout with the project's documented build command.
Report the command, exit code, output artifact paths, and any blocker.
Do not publish packages as part of this build task.
PROMPT
```

Give enough context to act independently: goal, workspace or checkout, relevant files, boundaries, expected artifacts, and how to report back. Do not dump the full originating conversation by default. The recipient sees the sender's remoteCodex thread ID in the message and can use it to reply.

A successful send returns a durable receipt with `threadId`, `pendingSteerId`, `acceptedAt`, and `delivery: "queued"`. It means **accepted**, not completed or successful. Messages can be sent while the receiver runs; they are queued as continuations. Several peers can exchange messages in either direction. Do not interpret a queued follow-up as immediately interrupting the current turn, and do not assume each message must map to a distinct turn if pending input is steered into an active turn through the UI.

Use a stable `--request-id` when a particular send may need retrying:

```bash
remote-codex thread send THREAD_ID --text-file /tmp/build-request.txt \
  --notify-on-complete --request-id build-check-001
```

Retry an uncertain send with the same target, sender, request ID, text, and notification choice. The same request returns the original receipt; different content with that key is rejected. Choose a new key for a genuinely new message. Without a request ID, inspect the peer's status/history before resending after a lost connection. This deduplication applies to sends, including a create's initial send; it does **not** deduplicate thread creation itself.

## Choose how results come back

### Supervisor completion notification

Add `--notify-on-complete` to the specific send, or to a create with an initial prompt. It requires a caller thread identity and subscribes to the receiving turn's terminal event, including `completed`, `failed`, or `interrupted`.

The Supervisor sends you a short prompt containing the peer thread ID, turn ID, terminal status, timestamp, and a transcript command. An idle recipient starts a new turn; a busy recipient receives queued input. You may finish your own turn after delegating instead of keeping it alive with polling. This flag is per send, not a permanent subscription to all future peer activity.

On notification, read that specific turn with `--view overview`, then verify the reported artifact or task result before performing dependent work. Turn completion is not proof that compilation, CI, or publication succeeded. The notification contains a pointer rather than the entire result, and does not itself request a return notification, avoiding an automatic callback loop.

### An explicit message from the peer

For intermediate questions, progress reports, or a tailored result, include your concrete thread ID in the peer's instructions:

```text
After the build finishes, use:
remote-codex thread send CALLER_THREAD_ID --text-file /tmp/build-result.txt
Include the build exit code, artifact path, and any follow-up needed.
If blocked, send me a question through the same command.
```

Replace `CALLER_THREAD_ID` with the result of `thread self` before sending. This works from ACP Grok to Codex and from Codex to ACP Grok, or between other available providers. It also works with a thread the user created manually in the Web UI. Without `--notify-on-complete`, an explicit peer message is the only requested callback; if the peer fails before sending it, no automatic notification is promised. Using both modes intentionally produces two messages. Do not reflexively acknowledge every message with another prompt or request reciprocating completion notifications indefinitely.

## Read history progressively

Start with the smallest useful view. The CLI reads the same saved turns and items used by the Web UI, including intermediate assistant text; it does not synthesize a final-answer-only summary.

| Need | Command |
| --- | --- |
| Runtime state without history | `remote-codex thread status THREAD_ID` |
| Recent conversation | `remote-codex transcript THREAD_ID` |
| Only the latest turn | `remote-codex transcript THREAD_ID --limit 1` |
| Older conversation page | `remote-codex transcript THREAD_ID --before-turn TURN_ID --limit 3` |
| Conversation text of one turn | `remote-codex transcript THREAD_ID --turn TURN_ID --view overview` |
| Directory of all items in a turn | `remote-codex transcript THREAD_ID --turn TURN_ID` |
| One item's detailed text | `remote-codex transcript THREAD_ID --turn TURN_ID --item ITEM_ID` |
| Exact stored JSON of that item | `remote-codex transcript THREAD_ID --turn TURN_ID --item ITEM_ID --raw` |

The default overview selects the latest **3 turns**, displayed in chronological order. `--limit` is capped at 20. It includes user input and all saved assistant progress/final messages with available timestamps; missing saved timestamps remain null. `--before-turn` pages strictly before a known turn and cannot be combined with `--turn`.

Overview text is bounded, and a selected turn's default view is an item directory with short previews of tools, reasoning, commands, and other saved items. Follow the returned `next`, `detail`, or `expand` commands only for the part relevant to your question. Do not fetch every detailed log automatically.

There are separate pagination dimensions:

- `--before-turn` selects older turns.
- `--offset` continues the item list within a turn.
- `--text-offset` continues a long item's text or raw JSON in Unicode-character chunks. Follow the returned continuation command, preserving `--raw` when present.

An overview or directory can contain a partial message or only some items. Follow its continuation when you need the complete result; absence from the first page does not prove absence from the history. `--raw` returns the saved JSON as bounded **text chunks**, not necessarily one independently parseable JSON object per chunk. Reassemble only when exact stored data is needed. A running turn can gain new items between reads; use its status and returned observation/update timestamps to interpret the snapshot.

## Example: delegate a slow build or CI watch

1. Read `thread self`, find or create a suitable peer, and save its ID. For a manually created peer, use the supplied Web thread ID and check its workspace/model with `status`.
2. Send a bounded task with the checkout, build command or exact CI run ID, expected result, and `--notify-on-complete`. The peer may perform the necessary waiting inside its own turn. Only ask it to publish or otherwise mutate external systems when already authorized by the user.
3. Continue independent work or finish your turn. Send follow-up information whenever useful; the protocol does not require waiting for the first reply.
4. When notified, read the referenced turn's overview. Expand the relevant command result if the exit code or failure details are unclear. Validate the artifact or remote result, then perform the authorized follow-up.
5. Reuse that peer for a later related task when its context still fits. Use explicit peer messages instead of automatic completion notifications when the useful trigger is an intermediate finding or a question.

## Connection and failure handling

Managed sessions receive `REMOTE_CODEX_THREAD_ID`, `REMOTE_CODEX_URL`, and local credentials in their environment. Use those as supplied; do not print tokens, dump the environment, or include connection secrets in messages or transcripts. `--from` overrides attribution for an explicitly selected remoteCodex caller; it is not a permission boundary or a way to invent an identity.

An ordinary local shell can use the Supervisor's protected connection file with `--cli-config PATH` / `REMOTE_CODEX_CLI_CONFIG`. Otherwise the CLI looks for a `.cli.json` sibling of the configured Supervisor database. `--url` / `REMOTE_CODEX_URL` and `--token` / `REMOTE_CODEX_TOKEN` override connection values. Prefer the environment or protected file over putting a token on the command line. The credential grants access to this local Supervisor; it is not an isolated credential for just one thread.

The CLI accepts loopback HTTP only (`localhost`, `127.0.0.1`, or IPv6 loopback), and refuses redirects. Run it on the device hosting the target threads. Missing connection data means you need the correct local Supervisor/configuration, not credentials copied into the prompt. After a Supervisor restart, use the current protected connection file if the inherited connection token is stale.

If a request is rejected, inspect the error before retrying: wrong device/ID, unavailable model, missing caller for notifications, missing workspace, and mismatched request IDs require correcting the request. `idle` alone is not evidence of task success; check `lastError`, queued input, waiting-for-input state, and the relevant transcript. When a peer needs user input or has a runtime failure, report the actual blocker instead of repeatedly enqueueing the same task. Local status reads are cheap, but avoid a tight polling loop when completion notification satisfies the need.
