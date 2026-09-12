# Local thread interaction

The `remote-codex` CLI can create peer threads, send prompts, inspect runtime state, and progressively read stored conversations. These operations use the Supervisor's existing threads, prompt queue, turns and history items. No database tables or separate Task/Message lifecycle are added.

## Commands

```sh
remote-codex skill
remote-codex thread self
remote-codex thread list --workspace WORKSPACE_ID
remote-codex thread status THREAD_ID
remote-codex thread models --provider acp --agent grok
remote-codex thread create --provider acp --agent grok \
  --model grok-4.6 --reasoning-effort xhigh --title helper
remote-codex thread send THREAD_ID --text-file task.txt --notify-on-complete
remote-codex transcript THREAD_ID
remote-codex transcript THREAD_ID --limit 5 --before-turn TURN_ID
remote-codex transcript THREAD_ID --turn TURN_ID
remote-codex transcript THREAD_ID --turn TURN_ID --view overview
remote-codex transcript THREAD_ID --turn TURN_ID --item ITEM_ID
remote-codex transcript THREAD_ID --turn TURN_ID --item ITEM_ID --raw
```

`thread create` also accepts `--text` / `--text-file` for an initial prompt. Without a managed caller, specify `--workspace`. Model IDs and reasoning levels must be advertised by the target harness. Creation inherits the caller's workspace and approval mode unless explicitly overridden. It does not copy the caller's history.

Messages can be sent repeatedly, to one or several threads, without waiting for a reply. `send` durably inserts into the existing continuation queue and returns a small receipt with `pendingSteerId`. Idle recipients start automatically; running recipients process continuations serially. The receiver sees the sender's remoteCodex thread ID and can use the same CLI to reply. `--request-id KEY` makes retries of the same send return the original receipt; reusing a key with different content is rejected. A send receipt does not mean execution has completed.

`--notify-on-complete` is optional per send. It requires a caller identity, obtained from the managed environment or explicit global `--from ID`. When that receiving turn ends, the Supervisor queues a brief prompt to the caller containing the peer/turn IDs and completed, failed or interrupted status. The caller is awakened when idle, or receives the notification after its current turn. Notifications do not themselves subscribe to another notification. Multiple opted-in messages steered into one turn keep independent subscriptions; cancelling an unconsumed queued prompt removes its subscription.

An Agent may instead be asked to send a message at any appropriate point. That is independent of the automatic turn-end option. No protocol rule enforces one message, one reply or a fixed parent/child hierarchy.

## Progressive reads

The default is the **latest 3 turns**, oldest first within the page, containing user input and **all** stored agent-facing text, including progress and final replies. This shares the Web's conversation query and storage, but does not apply the Web summary's final-reply-only folding. Status queries contain no conversation history.

`--turn` expands a paged item directory; `--item` reads its text/detail; `--raw` reads chunks of the exact stored JSON, including provider extensions. References lead to the existing attachment interfaces. Unknown or missing timestamps remain null. No unstored provider logs are synthesized.

Every response includes discovery/continuation commands when more content exists. The overview bounds turn count, item count and text preview size, with roughly 16,000 preview characters across a page; individual detailed reads return up to 8,192 Unicode characters. `truncated` is explicit. Follow `next`, `detail`, `expand`, `nextOffset` or `nextTextOffset` to continue. Text offsets count Unicode characters, not bytes. Active records are mutable; `observedAt`, `updatedAt` and turn status distinguish live reads from completed history. Re-read a growing item to fetch its latest tail.

## Local connection and identity

A serving Supervisor creates a private connection file next to its SQLite database, replacing the `.sqlite` suffix with `.cli.json`. Unix creation permissions are `0600`. A local shell can use:

```sh
remote-codex --cli-config /path/to/supervisor.cli.json thread list
remote-codex --cli-config /path/to/supervisor.cli.json --from THREAD_ID thread send OTHER_ID --text hello
```

Managed ACP processes receive `REMOTE_CODEX_URL`, `REMOTE_CODEX_TOKEN` and `REMOTE_CODEX_THREAD_ID`, plus a PATH containing the running binary. The same context reaches client-owned ACP terminal commands. Creation and session loading bind identity to the remoteCodex thread. A fork that shares a parent process is loaded independently when it needs a different CLI identity. Each real turn includes a short discovery hint for `remote-codex skill`.

CLI connections use a loopback HTTP URL and a machine-scoped bearer credential. `POST /api/cli` rejects missing/invalid credentials even in local mode and rejects trusted Relay-forwarded requests. This credential grants local thread management; `--from` is attribution within that trusted local scope, not an impersonation-resistant per-Agent security boundary. Do not publish or print the connection file/token. Full thread URLs are accepted only when their device ID matches this Supervisor.

The JSON facade has `operation` values `info`, `list`, `show`, `status`, `backends`, `models`, `create`, `send` and `transcript`. It delegates to the existing runtime service; it does not connect directly to a provider app-server. Request DTOs use camelCase in `crates/protocol/src/interaction.rs`.

Optional notification subscriptions and explicit retry receipts use the existing KV table. Retry records store a content hash rather than duplicate prompt text. Subscriptions bind to the consumed turn in the queue-consumption transaction; turn completion and notification enqueue commit together. A lightweight worker resumes pending continuations and checks terminal subscriptions. Harness setup failures leave the accepted prompt queued, expose `lastError` and back off before retrying. An in-progress external operation interrupted by a process crash is not automatically re-executed by this feature.

## Validation

See [the Docker E2E record](thread-interaction-e2e.md). The bundled [skill](../skills/thread-interaction/SKILL.md) teaches discovery, reuse, creation, messaging and reading only the relevant detail. `remote-codex skill` prints that same embedded file.

## 0.12.32 delivery and inbox revision

This section supersedes the earlier default-delivery examples above. Ordinary `thread send` defaults to `--delivery inbox`; the create command's initial prompt defaults to `queue`. Explicit `queue` submits execution and explicit `steer` requires a running capable backend. Steering failures after durable acceptance return a held receipt; held input is excluded from background draining.

`inbox` / `inbox list` returns bounded unread previews; `inbox read ID` expands one message; `inbox ack ID...` marks handled messages while retaining history. `--thread ID` selects a mailbox. Listing and reading never trigger turns or mark messages processed. `status` includes `unreadMessageCount`. Mail uses namespaced records in the existing KV store, with no schema migration or new tables.

Completion subscriptions on executable messages default to inbox delivery; `--notify-delivery queue` explicitly wakes the caller. Legacy subscription values remain queued for compatibility. Passive mail rejects completion subscriptions because there is no corresponding receiving turn.

## Direct delivery (0.12.33)

`thread send ID --delivery direct --text TEXT` requests immediate handling. The server resolves idle to a durable continuation and running to steering within the acceptance transaction, after request-ID deduplication. Other states are rejected. The receipt includes `requestedDelivery` and the actual `delivery` (`queued`, `steered`, or `held`); a queued receipt is not proof that execution has started. An idle-route continuation keeps its original route if other work starts first.

Unsupported active steering is rejected without enqueueing. Accepted steering targets that specific turn; failures or a replaced/finished turn remain held, never silently becoming a continuation or steering a replacement turn. Retries reuse the original route. Existing unpinned steering from older versions retains its previous behavior.

Inbox remains passive by default. Use direct for immediate correction or to wake an idle collaborator; use queue when processing after current work is intentional. Completion notification delivery remains inbox or queue; a peer can send an explicit direct reply when immediate handling is needed.
