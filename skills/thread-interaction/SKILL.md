---
name: thread-interaction
description: Create, message, and inspect peer remoteCodex threads on this device. Use for cross-provider collaboration, passive inbox exchange, explicit task dispatch or steering, completion callbacks, and progressively reading conversation history.
---

# Interact with remoteCodex threads

Threads are peers. Each can create others, message existing threads, read state/history, or receive requests. This is a Supervisor-level interface across Codex, ACP Grok, and other installed providers. Creation does not copy your conversation. Peers in one workspace share files unless you create them with `--worktree`; give each delegate its own files, or its own worktree, for overlapping edits.

`remote-codex skill` prints this entire bundled guide. Data commands return JSON; help and this guide return text. Use `remote-codex thread send --help`, `remote-codex inbox --help`, and other command-specific help to discover exact flags. Check exit status and the returned delivery state. A receipt is not proof of task completion.

## The orchestration loop

Most delegation is this, and every step is one command:

```bash
remote-codex thread create --name tests --kind task --subject 'Fix the flaky auth test' \
  --text-file /tmp/tests.txt                      # 1. delegate, with a name
remote-codex thread create --name docs --worktree --kind task \
  --subject 'Document the new flag' --text-file /tmp/docs.txt
# 2. do your own independent work here, if you have any
remote-codex thread wait tests docs --timeout 600 # 3. block until both settle
remote-codex thread close tests docs              # 4. free their slots once collected
```

`thread wait` returns each delegate's state and its **closing message** inline, so you
usually need no transcript call. It returns early with `blocked: true` when a delegate
waits on an approval, or has mailed you a `--kind question` that nobody has answered
(`--in-reply-to`) or acknowledged - `waitingOn` names the message; answer it, then wait
again. `--any` returns as soon as one settles (`allSettled` tells you whether the rest
did), so you can handle results as they land. `--any` and `--wake` cannot be combined.

Choose by how long you expect to wait:

- **Short (about a minute or less), or you will act immediately:** block with
  `thread wait`. Your shell tool may return before the wait does (Codex yields about
  every 30 s); just keep waiting on the same command. Each of those returns costs you
  a model call, so a long blocking wait is not free.
- **Long, and nothing else to do:** `remote-codex thread wait tests docs --wake`, then
  end your turn saying what you are waiting for. Exactly one turn is queued on you when
  they all settle (or one blocks), carrying their closing messages; it costs nothing
  while you wait. That is the only way delegates wake you, and only because you asked.

Run `remote-codex thread tree` any time for the whole picture: every delegate's state,
unread mail, current task and worktree.

A settled delegate finished *executing*; that is not proof the work is right. Ask
every delegate to end with evidence - files changed, commit hash on its branch, the
exact test command and its result - and check it before you merge or close.

## Identity and discovery

```bash
remote-codex thread self
remote-codex thread tree
remote-codex thread list --limit 20
remote-codex thread list --workspace WORKSPACE_ID --limit 10
remote-codex thread status THREAD_ID
remote-codex thread backends
remote-codex thread models --provider codex
remote-codex thread models --provider acp --agent grok
```

Use **remoteCodex thread IDs**, the last segment of `/devices/DEVICE_ID/threads/THREAD_ID`, not native Codex/ACP session IDs. A target may be a UUID, a full Web thread URL on the current device, the `--name` of an open thread in your lineage, or `parent`, `root` or `self`; the CLI does not route across devices. `self` identifies your caller. `list` defaults to 20 entries, capped at 100, without transcripts. `status`/`show` return lightweight metadata including `activeTurnId`, `queuedCount`, `unreadMessageCount`, `waitingForInput`, and `lastError`.

Reuse a peer when its workspace, model, and earlier work fit. Read status and only enough recent transcript to assess context. Create when separate context or another model is useful.

## Lineage: threads you create group under you

A thread you create records you as its parent and inherits your lineage root — the
thread a person actually started. `thread list` shows only those roots by default,
each with the number of agent threads beneath it, so a fan-out does not bury the
person's own conversations. Pass `--all` to see every thread flat, or
`--group THREAD_ID` to list one root's descendants.

Two bounds apply, and both are refusals rather than queues:

- **Depth 3.** You may delegate, and your delegate may delegate once more. Past that,
  creation fails; delegate from the root instead of chaining deeper.
- **20 open threads per root.** A delegate that finished its turn is `idle`, not gone:
  it stays addressable and keeps its slot until you `thread close` it. Failed and
  interrupted threads release theirs. So close delegates once you have collected their
  work, and a long sequential fan-out stays unrestricted.

When either refusal arrives, **do not retry the same call** — it will fail identically.
Close what you have collected, wait for outstanding work, or reuse an idle peer. Prefer
a handful of concurrent delegates (3-5) over a large burst.

### Names, closing, roles and worktrees

- `--name reviewer` gives a delegate an address unique among the open threads of your
  lineage; any command that takes a thread id accepts it. Names match
  `[a-z][a-z0-9_-]{0,31}`.
- `remote-codex thread close NAME...` frees each slot and name. History stays readable,
  and prompting it again reopens it. Only an ancestor (or the thread itself) can close
  it, and not while it is running or has queued work. The command exits nonzero if any
  target fails; `failed` lists which and why. After a name is reused, refer to the old,
  closed thread by its UUID.
- `--role ROLE` starts from `.remote-codex/agents/ROLE.md` (workspace, then
  `~/.remote-codex/agents/`). Front matter `model`, `effort`, `agent` become defaults
  you can still override; the body is prepended to the delegate's first prompt.
  `remote-codex thread roles` lists them.
- `--worktree` runs the delegate in its own git worktree, `../REPO.worktrees/NAME` on
  branch `agent/NAME` (or `--worktree-branch`), checked out from **committed** HEAD -
  uncommitted changes in your checkout are not in it, so commit what a delegate builds
  on first. If `agent/NAME` already exists from an earlier delegate, a fresh
  `agent/NAME-2` is used; pass `--worktree-branch` to continue an existing branch.
  Tell the delegate to commit on its branch; you merge it. `thread close NAME --remove-worktree` removes the checkout
  and refuses if it has uncommitted changes. Use worktrees for parallel edits that
  could touch the same files; skip them for read-only work.

Model IDs and effort options come from local discovery. Preserve explicitly requested models; do not invent an ID from a display name or silently substitute another model. Availability depends on the installed harness and working directory.

## Clean up your own child threads

`thread close` and `thread delete` both free a delegate's slot. Close keeps its
history readable and lets you reopen it by prompting; delete removes its Remote Codex
conversation for good. Close by default; delete when nothing about it is worth keeping.

After recording the result you need, delete a finished direct child with:

```bash
remote-codex thread delete CHILD_THREAD_ID
```

The Supervisor verifies your managed credential and the stored parent relationship.
You cannot delete yourself, a parent, sibling, another root, or a grandchild. `--from`
does not change the authenticated parent. A machine connection file alone cannot
authorize deletion; use your managed session, reconnecting it after a runtime upgrade
if its credential predates this feature.

Unused idle children may also be removed. Running/recovering children, active or
queued turns, and children that still own descendants are refused. There is no force
or recursive delete. Have each direct parent finish and clean up its own children
first. Deletion removes the child's saved Remote Codex conversation/mailbox and
releases its idle, independently owned harness process. Workspace files, branches,
worktrees, native harness history, and results already delivered to your inbox are
preserved. Save needed transcripts/artifacts before deleting; the Remote Codex
conversation cannot be restored by the CLI.

## Always label a message

Every send takes `--subject` (one line) and `--kind`. Use them. They are not
decoration: `inbox list` and the unread notice a receiver sees at the start of its
turn show the subject and kind, so a labelled message can be triaged without being
opened, and an unlabelled one cannot.

| `--kind` | Means | Does the receiver owe you anything? |
| --- | --- | --- |
| `task` | You are asking it to do work | Yes, eventually |
| `question` | You are blocked until it answers | Yes, and you are waiting |
| `result` | Work you were asked for is done | No |
| `status` | Progress, FYI, context | No |

`question` is the only kind that announces you are waiting; the receiver's notice
calls it out. Do not mark routine updates as questions, or that signal stops meaning
anything. Use `--in-reply-to MESSAGE_ID` when answering so the exchange correlates.

Do not hand-write `Subject:` or `Kind:` into the message text. The flags populate a
real envelope; prose in the body does not.

```bash
remote-codex thread send PEER_ID --kind task --subject 'Port the auth tests' \
  --text-file /tmp/task.txt
remote-codex thread send PEER_ID --kind question --subject 'Which staging key?' \
  --in-reply-to MESSAGE_ID --text 'The task did not say which credential to use.'
```

## Prefer the inbox. Escalate only with a reason.

Passive inbox is the default and should stay the default for nearly everything,
including results, progress and questions. Waiting mail is announced to the receiver
at the start of its next turn, with your subject and kind, so passive no longer means
unnoticed - it means it arrives without destroying what the peer was doing.

Reach past it only when the cost of waiting is real:

- `queue` - the peer must act on this, but after its current work. The normal way to
  assign a task to an idle or busy peer.
- `direct` - the peer is idle and will not look at mail on its own, or a correction
  cannot wait. The server decides between starting a turn and steering.
- `steer` - only to correct the turn that is running right now, when letting it finish
  would waste or damage work.

Interrupting is not free: a steered agent loses its train of thought, and steering is
not a guaranteed interruption of a blocking tool anyway. An inbox message with a clear
subject usually gets handled sooner than a steer that derails a peer into confusion.
If you are tempted to steer because you are impatient rather than because the work is
wrong, send inbox mail instead.

## When to read your inbox

Waiting mail is announced at the start of each of your turns, listing every subject
and kind. You do not need to poll defensively - but the announcement only reaches a
turn that is *starting*, so these are the moments to actually look:

- **When the notice names something.** It tells you what is waiting; decide then
  whether it changes what you are about to do.
- **Before work that depends on a peer.** A result you never read is a result you do
  not have.
- **After a long command.** Mail may have arrived while you were blocked.
- **When you have nothing else to do but expect mail:** block on it with
  `remote-codex inbox wait` rather than ending your turn or looping.

```bash
remote-codex inbox wait --timeout 600                   # any unacknowledged mail
remote-codex inbox wait --from-thread reviewer --kind question
remote-codex inbox wait --new                           # ignore mail already waiting
```

`inbox wait` returns the matching messages with text inline. Unacknowledged mail
satisfies it immediately, so acknowledge what you have handled (or use `--new` / a
filter while deliberately deferring something). Acknowledge with `inbox ack` only what
you have handled or deliberately recorded; acknowledging to clear the notice loses the
message.

### Ending your turn discards nothing, but nothing will wake you

An idle thread does not run, so it cannot read mail. Completion notifications are
passive too - `--notify-on-complete` files a message, it does not start a turn for you.
So if you delegate and then simply end your turn, the result **sits in your inbox**
until a person or a peer starts your next turn.

- **If you must act on the result, stay in your turn** and block on it:
  `thread wait NAME` or `inbox wait`. Do independent work first if you have any.
- **If your turn must end, hand off explicitly** with `thread wait NAME... --wake`, and
  say in your final message what you delegated and that you will resume when it lands.

Do not work around this by steering the peer, polling `status` in a loop, or sending
yourself direct messages; `wait` is cheaper than all of them.

## Share work through the task board

For more than two or three pieces of work, or work with ordering between pieces, put it
on the lineage's task board instead of in prompts. Every thread in your lineage sees
the same board; it outlives any one agent's context.

```bash
remote-codex task add 'Design the schema' --detail-file /tmp/schema.txt
remote-codex task add 'Write the migration' --after 1 --assign migrator
remote-codex task list            # open tasks: owner, blockedBy, ready
remote-codex task claim           # take the lowest ready task for you or nobody
remote-codex task claim --wait    # ...or block until one is ready / the board is done
remote-codex task show 2
remote-codex task done 2 --result 'Migration in db/0042.sql; tests pass'
remote-codex task done 3 --failed --result 'Blocked: no staging credentials'
remote-codex task release 2       # give it back
```

Claims are atomic, so delegates may self-serve with `task claim` without colliding.
`--assign` sends the assignee passive mail; finishing a task mails its creator the
result, and mails the owners of tasks it unblocks. A task with unfinished `--after`
dependencies cannot be claimed. A delegate given a board should loop: `task claim
--wait`, do it, `task done --result`, and repeat until the response has `finished:
true` (nothing left you could claim; `boardComplete` says whether every task is
done or others still hold some). Do **not** stop at a plain `claimed: null` with `finished: false` - that means
work is only blocked on tasks in progress, and a worker that quits there leaves the
rest to one peer. Keep results short and point at files or commits for anything long.

A harness-native timer such as Claude `CronCreate` / `/loop` is a separate, explicit
scheduled prompt, not a completion subscription. It can wake that native session
while its harness process remains alive. Remote Codex recovers its finished reply
and tool history and notifies open pages; intermediate scheduled output is backfilled
after completion. Native timers are session-only and do not survive harness exit or
Supervisor restart. Do not claim you configured a watch merely because you wrote
that one will wake you: verify the scheduling tool's successful result and job ID.

## Choose the delivery semantics explicitly

| Intent | Delivery | Behavior |
| --- | --- | --- |
| Report, question, result, intermediate finding | `inbox` (send default) | Durable passive mail. Does not start, queue, or interrupt a turn. Receiver reads it via CLI. |
| Wake an idle peer or correct a running task promptly | `direct` | Server selects a new turn when idle or steering when running. Use only when immediate handling is needed. |
| Intentionally execute after current work | `queue` | Durable continuation. Starts when idle; waits behind active execution. |
| Correct an active task immediately | `steer` | Requires an active turn and backend steering capability. Requests input in that turn; not a guaranteed interruption of a blocking tool. |

```bash
remote-codex thread send PEER_ID --kind result --subject 'Build artifact ready' \
  --text 'Artifact at /path/to/artifact.'
remote-codex thread send PEER_ID --delivery queue --kind task --subject 'Port auth tests' \
  --text-file /tmp/task.txt
remote-codex thread send PEER_ID --delivery direct --kind task --subject 'Stop: wrong version' \
  --text 'Pause publication: use the corrected version number.'
```

Do not use direct, queue or steer for every acknowledgement. Passive mail avoids chains of agents repeatedly creating turns for each other. Unread mail is announced at the start of the receiver's next turn, listing each subject and kind, but it is still not pushed into a turn already in flight, and the announcement is a prompt to look rather than the message itself. When collaborating, check at natural checkpoints, after relevant long commands, before dependent work, and before ending a turn while expecting a peer result. There is no automatic hidden polling or guaranteed response deadline.

Use direct when the peer must act now, including an idle peer that will not check its inbox. The server chooses the route in the acceptance transaction, so callers need not check status first. Only idle and running states qualify: recovering, interrupted or failed peers require inspection before another deliberate action. Use queue when work should wait behind any active turn; use steer when only the current active turn should receive it. A provider without steering rejects the request; it is not silently downgraded to queue. Direct returns `requestedDelivery: "direct"` plus the resolved `delivery`: `queued` for an idle peer (durable new-turn dispatch, not proof of execution), or `steered` after an active backend acknowledges. The idle route keeps its accepted continuation if other work starts before dispatch; it does not later change into steering. Active direct/steer messages target the turn selected at acceptance and cannot move to a replacement turn. If a steering race or backend error occurs after acceptance, the receipt reports `delivery: "held"`, an `error`, and the pending ID. The held message cannot auto-run as a continuation. Inspect history/status before retrying an uncertain acknowledgement. Successful steering reports `steered`; a provider acknowledgement does not prove the agent followed the instruction.

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

An idle sender will not wake for that default passive reply. If immediate handling is needed and authorized, use `--delivery direct`; it wakes an idle sender or steers a running sender. Use queue only when the reply should wait behind current work. Include the concrete response destination and delivery expectation in delegated instructions. Avoid reflexive mutual acknowledgements or reciprocal completion subscriptions.

## Create and dispatch a task

```bash
remote-codex thread create --title 'Build helper' \
  --provider acp --agent grok --model MODEL_ID --reasoning-effort EFFORT \
  --kind task --subject 'Build the release artifact' \
  --text-file /tmp/build-request.txt --notify-on-complete
```

`thread create` accepts the same `--subject`/`--kind` flags as `thread send`, and the
initial prompt is a message like any other - label it. Create defaults to provider
`acp`, model `default`; it does not inherit the caller's model. Workspace and approval mode inherit from the caller unless specified. `--workspace WORKSPACE_ID` selects an **existing** workspace; provide it from an unscoped shell. `--approval-mode guarded|yolo` is supported; thread creation does not expand user authorization.

Unlike ordinary `send`, a create's initial prompt defaults to **queue**, so the new peer actually starts its assigned task. Creating without prompt leaves it idle. `--delivery inbox` explicitly makes the initial message passive. Creation and first send are sequential, not one idempotent transaction. If send fails after creation, the error includes the created thread ID: reuse it instead of creating a duplicate.

`--text` and `--text-file` are mutually exclusive. `--text-file -` reads stdin. Use a quoted heredoc or a file for multiline text so the shell cannot execute dollar expansions/backticks:

```bash
remote-codex thread send PEER_ID --delivery queue --kind task \
  --subject 'Build the assigned checkout' --text-file - <<'PROMPT'
Build the assigned checkout with the documented command.
Report command, exit code, artifact paths, and blockers.
Send the result to CALLER_THREAD_ID using default inbox delivery.
Do not publish packages as part of this build task.
PROMPT
```

Replace placeholders before sending. Provide goal, checkout, relevant files, constraints, expected artifacts, and reply destination. Do not copy your entire transcript by default. Execute external actions such as publication only within the user's authorization.

## Completion notifications

`--notify-on-complete` subscribes to the receiving **execution turn**, so it requires direct/queue/steer delivery plus a caller identity. Passive inbox messages have no execution turn and reject this flag. It is a per-send subscription, not a permanent watch of future activity.

Completion notifications always go to the caller's passive inbox. They include peer/thread IDs, terminal status (`completed`, `failed`, or `interrupted`), timestamp, a transcript command, and the delegate's closing message (truncated at 4000 characters). They never wake, steer, or queue a turn on the caller - `thread wait` and `inbox wait` are how you block on them, `--wake` how you hand off.

```bash
remote-codex thread wait PEER_ID          # usually all you need
remote-codex inbox wait --kind result
remote-codex transcript PEER_ID --limit 1 # when the closing message is not enough
```

`--notify-delivery queue` is no longer supported. Do not send direct/queue/steer messages to the parent just to report completion; keep results passive and let the parent collect them. Completion describes execution, not business success: read that turn and verify artifacts/exit codes before dependent actions. Using explicit inbox replies and automatic notifications together can produce two passive messages; avoid redundant reports.

After upgrade, still-pending legacy completion subscriptions also deliver to inbox, regardless of their stored choice. Already-enqueued input is not cancelled or moved automatically. Upgrading the runtime does not change behavior of an older Supervisor that is still running.

## Retries and progressive transcript reads

Use a stable `--request-id` for a send that might need retrying. Exact same target/sender/key/text/delivery/notification choices reuse its durable receipt and originally chosen route, even if the peer has since changed state; conflicting input is rejected. New messages need new keys. Without a key, inspect before resending after a lost connection. Deduplication applies to sends, not thread creation. Delivery defaults changed in 0.12.32: preserve explicit delivery choices in automation; inspect older receipts rather than blindly retrying a pre-upgrade request with new defaults.

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

A normal shell may use `--cli-config PATH` / `REMOTE_CODEX_CLI_CONFIG`; otherwise the CLI discovers a protected `.cli.json` sibling of the configured Supervisor database. `--url` / `REMOTE_CODEX_URL` and `--token` / `REMOTE_CODEX_TOKEN` override connection fields. Prefer the environment or protected file over a command-line token. Managed credentials identify the parent for restricted child deletion; the machine connection file cannot grant that right. Agents sharing a user account and workspace still do not have filesystem isolation.

Only loopback HTTP is accepted; redirects are refused. Run on the target device. A missing connection is a configuration issue, not a reason to copy credentials into a prompt. After Supervisor restart use the current connection file if inherited credentials are stale. Invalid model, unknown thread, missing caller, and unsupported steering need corrected input, not repeated dispatch. `idle` is not task success: inspect errors, pending input, unread mail, and the relevant result.
