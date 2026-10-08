---
name: thread-interaction
description: Coordinate peer remoteCodex threads on this device or on another device of the same owner through passive result handoffs, dependency-aware waiting, explicit task dispatch, urgent corrections and file exchange. Use when creating, messaging or collecting work from remoteCodex peers.
---

# Interact with remoteCodex threads

Threads are peers. Each can create others, message existing threads, read state/history, or receive requests. This is a Supervisor-level interface across Codex, ACP Grok, and other installed providers. Creation does not copy your conversation. Peers in one workspace share files unless you create them with `--worktree`; give each delegate its own files, or its own worktree, for overlapping edits.

`remote-codex skill` reads the running Supervisor's guide, falling back to the CLI's bundled guide offline or with an older Supervisor. Data commands return JSON; help and this guide return text. Use command-specific help to discover exact flags. If your CLI lacks a flag required by this guide, use the installed runtime's CLI; do not bypass the delivery rule. Check exit status and the returned delivery state. A receipt is not proof of task completion.

## The orchestration loop

For an existing peer, choose by what must change **in its current turn**, before
calling something a task:

- Stop, replace, reprioritize or correct its active work: use `steer` (or `direct`
  when its state is uncertain) with the concrete wasted work/harm in
  `--interrupt-reason`. Do not queue “use the existing implementation instead,”
  “switch the primary strategy,” or “stop launching work under the old grant.”
- Give it distinct work that can wait until its current turn ends: use `queue`.
  Queue waits for the **entire turn**, not the next tool result, checkpoint or
  compute batch. A long-running turn can defer that instruction for hours.
- Provide ready inputs, results, adoption notices or report-only updates: use
  `inbox`. “Already received,” “task complete” and “no action needed” are not tasks.

When another peer needs a running worker's output now, split the request: steer
the minimal unblock/correction, and queue any independent later work. A waiting
consumer should collect ready inputs through inbox in its existing turn.

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

Use **remoteCodex thread IDs**, the last segment of `/devices/DEVICE_ID/threads/THREAD_ID`, not native Codex/ACP session IDs. A target may be a UUID, a full Web thread URL, or `DEVICE/THREAD_UUID`. Names of open threads in your lineage and `parent`, `root` or `self` resolve only locally. `self` identifies your caller. `list` defaults to 20 entries, capped at 100, without transcripts. `status`/`show` return lightweight metadata including `activeTurnId`, `queuedCount`, `unreadMessageCount`, `waitingForInput`, and `lastError`.

Reuse a peer when its workspace, model, and earlier work fit. Read status and only enough recent transcript to assess context. Create when separate context or another model is useful.

## Other devices

Devices must belong to the same relay owner, with peer access enabled on both. The
CLI still connects to your local Supervisor; it routes encrypted requests through
the relay. Use a relay device ID or a unique device name (case insensitive).
`device list` works before opting in and reports this device's `peerAccess`.

```bash
remote-codex device list
remote-codex device access                    # inspect; managed threads can view
remote-codex device access on                 # local machine credential required
remote-codex device workspaces DEVICE
remote-codex thread list --device DEVICE --workspace WORKSPACE_ID
remote-codex thread backends --device DEVICE
remote-codex thread models --device DEVICE --workspace WORKSPACE_ID
remote-codex thread create --device DEVICE --workspace WORKSPACE_ID --title helper
remote-codex thread status DEVICE/THREAD_UUID
remote-codex transcript DEVICE/THREAD_UUID --limit 1
remote-codex thread send DEVICE/THREAD_UUID --text 'Please inspect these files' \
  --attach ./report.txt --attach ./sources
remote-codex fs ls DEVICE --workspace WORKSPACE_ID
remote-codex fs get DEVICE --workspace WORKSPACE_ID path/to/file --out ./copy
remote-codex outbox
```

The delivery policy is the same across devices: queue needs `--kind task`, and
direct/steer need `--interrupt-reason`. Remote creation requires an existing target workspace and creates no local lineage;
it does not inherit your approval mode. Remote send supports inbox/direct/queue/steer
and `--notify-on-complete`; results return to your local passive inbox. Reply to
cross-device mail using its `replyTo` (`DEVICE/THREAD_UUID`). Remote wait, wake, tree,
task, close, delete and inbox operations are unavailable; inspect status/transcript
or wait for local inbox results instead.

Attachments copy up to 20 local paths; directories become zip files. The receipt's
`attachments` and the delivered message both name where each file landed on the target. `fs` reads only within a target
workspace. Downloads default to the caller's `.temp/threads/THREAD/downloads/`
directory (or workspace `.temp/downloads/` without a caller).

Retryable relay/offline/timeout failures save only inbox/queue sends in this device's
outbox (`delivery: "outboxed"`); direct/steer and create fail immediately. Outboxed
mail retries for seven days, then reports failure to the local sender's inbox.
Identity changes stop delivery. Verify the peer's `remote-codex relay-fingerprint`
before `remote-codex device trust DEVICE --reset` with a local machine credential.

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
remote-codex thread send PEER_ID --delivery queue --kind task --subject 'Port the auth tests' \
  --text-file /tmp/task.txt
remote-codex thread send PEER_ID --kind question --subject 'Which staging key?' \
  --in-reply-to MESSAGE_ID --text 'The task did not say which credential to use.'
```

## Prefer the inbox. Escalate only with a reason.

Results, progress, ordinary questions and acknowledgements must stay passive. Do not
request `direct` merely because a result is important, the recipient is idle, a parent
asked for frequent reports, or you want a quicker acknowledgement. The recipient
controls when to collect results; sending mail does not entitle you to start its turn.

| Intent | Delivery |
| --- | --- |
| Change the active task before more obsolete/invalid work is dispatched | `steer` or `direct`, kind `task` or `question`, with `--interrupt-reason` |
| A usable result or a question awaiting a decision | `inbox`, kind `result` or `question` |
| A distinct assignment that should execute after the entire current turn ends | `queue`, kind `task` |
| Correction/unblock request that cannot wait for a checkpoint | `direct` or `steer`, kind `task` or `question`, with `--interrupt-reason` |
| Routine progress | Shared progress file; send a batched inbox `status` only if a dependent needs it |

For peer sends the server rejects queued reports and direct/steer without the proper
kind and a nonempty reason. Explain the actual harm or wasted work if handling waits;
"urgent", "please read now" and "peer is idle" are not useful reasons. Examples of
valid urgency: a running calculation uses invalid inputs, a worker exceeds an agreed
resource allocation, or an imminent publication must stop. Classify active-task
corrections before new assignments; kind `task` does not imply queue. A routine
milestone belongs in inbox. Do not relabel a report as a task or
invent urgency to evade this rule. Explicit user instructions take precedence over
workflow preferences, but do not bypass the API's delivery requirements.

Steering is not guaranteed to interrupt a blocking tool. Check the receipt; a held
correction requires inspection, not a flood of retries.

Before launching resource-consuming work, read the current authoritative grant;
an old queued resource notice must not restore a superseded allowance. If a scope
change also replaces an earlier queued assignment, inspect that continuation and
explicitly cancel/supersede it through the available queue controls. Steering a
replacement does not remove the original queued task. Do not send duplicate work
through both queue and inbox/direct just to improve delivery odds.

## Deliver usable batches to actual dependents

At assignment time agree on the artifact owner, dependent recipients, usable handoff
condition, final result location and when consumers will check or wait. A parent
should request inbox milestones and collect them, not instruct every child to
"direct me when done". Keep the same contract in subsequent prompts and runbooks.

Publish one notification per usable batch, with a stable batch/topic name, revision,
changed scope, artifact path/commit/hash, limitations and any action the consumer
needs. Finish writing the artifact before declaring it ready. Keep detailed evidence
in files and maintain one authoritative index; do not paste long reports into every
mailbox. Notify only agents that depend on that change. Preserve independent-review
or blinded-data boundaries when selecting recipients.

First usable output, a material correction and final delivery should be timely.
Combine intermediate progress at a useful batch boundary; do not create a timer just
to send progress. A build, report, QA commit and archive of the same unchanged result
are one handoff, not four. Formatting/translations do not require consumers to redo
work. Distinct financial, safety and independent verification results remain distinct.

For a full replaceable progress snapshot, opt into status coalescing:

```bash
remote-codex thread send PEER_ID --kind status --subject 'Simulation batch progress' \
  --topic-key simulation-progress --request-id progress-r3 --text-file /tmp/progress.txt
```

The newest accepted snapshot replaces older unread status from **you**, to this
recipient, on this topic. Old records remain readable with `read` / `list --all` and
show `supersededBy`; replacing is not acknowledging. Send snapshots in order, and
retry with the same request ID. Do not use topics for incremental patches, independent
results, questions, corrections, tasks or replies. Topic similarity is never inferred.

Read/verify/record ordinary mail, then ack it without replying "received", "SHA
checked" or "archived". Reply only with a needed answer, new dependent result,
conflict or correction. Use `--in-reply-to` for answers. A question is not resolved
by "received": answer it before ack, or leave it visible while blocked. Choose one
business completion signal (explicit result, task done or automatic completion)
instead of sending the same outcome through all three. Do not subscribe peers to
each other's completion just to keep them active.

## When to read your inbox

Waiting mail is announced at the start of a turn with a bounded digest, prioritizing
questions/tasks over results/status. It is not a complete mailbox and does not enter
an already running turn. Batch reads at natural boundaries:

- **When the notice names something.** It tells you what is waiting; decide then
  whether it changes what you are about to do.
- **Before work that depends on a peer.** A result you never read is a result you do
  not have.
- **After a meaningful build/test/batch finishes.** Mail may have arrived meanwhile;
  do not reread the entire inbox after every small tool call.
- **When you have nothing else to do but expect mail:** block on it with
  `remote-codex inbox wait` rather than ending your turn or looping.

```bash
remote-codex inbox list --kind question --kind task
remote-codex inbox list --from-thread producer --kind result
remote-codex inbox wait --kind result --kind question   # result or an upstream blocker
remote-codex inbox wait --from-thread reviewer --kind result --kind question
remote-codex inbox wait --new                           # deliberately defer old mail
```

`inbox wait` returns the matching messages with text inline. Unacknowledged mail
satisfies it immediately, so acknowledge what you have handled (or use `--new` / a
filter while deliberately deferring something). Filtering happens before the bounded
page is selected. Preserve the filters when paging with `--before`. Acknowledge only
what you have handled or deliberately recorded. Ack removes mail from unread views;
it neither deletes history nor proves task success. Do not ack an unanswered question
merely to hide it: current thread waits treat its ack as no longer waiting.

When waiting for results, include questions so a producer asking you for missing input
can unblock you. Sender filters must include any peer whose question you must answer.
Do not have two agents wait on each other's result without naming and resolving the
dependency; expose blockers in the task board or a question instead of repeatedly
waking both to ask for status. For a long-lived producer's intermediate batches, wait
for inbox results rather than its whole thread to finish.

### Ending your turn discards nothing, but nothing will wake you

An idle thread does not run, so it cannot read mail. Completion notifications are
passive too - `--notify-on-complete` files a message, it does not start a turn for you.
So if you delegate and then simply end your turn, the result **sits in your inbox**
until a person or a peer starts your next turn.

- **If you must act on the result, stay in your turn** and block on it:
  `thread wait NAME` or `inbox wait`. Do independent work first if you have any.
- **If your turn must end, hand off explicitly** with `thread wait NAME... --wake`, and
  say in your final message what you delegated and that you will resume when it lands.

`--wake` is a receiver-owned, one-shot wait for your descendants, not a subscription
to arbitrary sibling artifacts. Only register it when you need the continuation.

Do not work around this by steering the peer, polling `status` in a loop, or sending
yourself direct messages; `wait` is cheaper than all of them.

## Share work through the task board

For more than two or three pieces of work, or work with ordering between pieces, put it
on the lineage's task board instead of in prompts. Every thread in your lineage sees
the same board; it outlives any one agent's context.

Use tasks for meaningful phases and dependencies, not every progress update, SHA
check or formatting change. An assigned task sends passive mail; an idle assignee
still needs an explicit queued assignment or an already-running claim/wait loop.

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
after completion. Native timers require an active harness to execute; persistence/resume depends on
the installed harness and task kind and is not confirmed by the history projection. Do not claim you configured a watch merely because you wrote
that one will wake you: verify the scheduling tool's successful result and job ID.

## Execution receipts and steering failures

```bash
remote-codex thread send PEER_ID --kind result --subject 'Build artifact ready' \
  --text 'Artifact at /path/to/artifact.'
remote-codex thread send PEER_ID --delivery queue --kind task --subject 'Port auth tests' \
  --text-file /tmp/task.txt
remote-codex thread send PEER_ID --delivery direct --kind task --subject 'Stop: wrong version' \
  --interrupt-reason 'Publication is about to use an invalid version; waiting risks publishing it' \
  --text 'Pause publication: use the corrected version number.'
```

For an eligible urgent request, direct resolves idle to a new turn and running to steering in the acceptance transaction. Only idle and running states qualify; inspect other states before acting. Unsupported steering is rejected, with no silent queue fallback. Receipts include `requestedDelivery`, resolved `delivery`, kind and any interrupt reason. `queued` is acceptance, not execution. An idle route stays queued if other work starts first; an active route stays pinned to its selected turn. A race/backend failure returns `held` plus an error and pending ID, never an automatic continuation. Inspect status/history before retrying uncertain acknowledgement. `steered` proves backend acknowledgement, not that the agent followed it.

Preserve and inspect the full JSON receipt. Counting a field with `grep -c`, or
checking only the exit code, hides whether the send was queued, steered or held.
For a correction to an active turn, verify the actual receipt says `steered`;
`requestedDelivery=direct` with `delivery=queued` means the receiver was idle at
acceptance, not that queue was chosen for an active correction.

## Read and acknowledge your inbox

```bash
remote-codex inbox
remote-codex inbox list --limit 10
remote-codex inbox list --kind result --kind question --from-thread producer
remote-codex inbox read MESSAGE_ID
remote-codex inbox ack MESSAGE_ID
remote-codex inbox list --all --limit 10
```

The caller's identity selects the mailbox. `--thread THREAD_ID` explicitly selects another mailbox, including from a shell without managed thread identity. IDs/URLs address the same local Supervisor; attribution is not a per-agent security boundary.

List returns bounded previews (240 characters) and envelope metadata. It defaults to 20 active unread messages, capped at 100, displaying the selected page chronologically. `--kind` and `--from-thread` are repeatable on list/wait. Follow `nextBefore` with `--before MESSAGE_ID`, preserving filters and `--all` if used. `--all` includes acknowledged and superseded history. One page need not contain every unread message.

Read returns at most 8192 Unicode characters. Follow `nextTextOffset` with `inbox read MESSAGE_ID --text-offset OFFSET` when needed. Reading does **not** mark mail processed, including after a crash. Acknowledge only messages you have handled or deliberately recorded for later action. `ack` accepts 1–100 explicit IDs atomically and is safe to repeat; acknowledged messages remain accessible with `--all` or `read`. Do not mark messages acknowledged merely to hide a queue count.

A reply uses the sender's `fromThreadId`:

```bash
remote-codex thread send SENDER_ID --kind result --subject 'Requested build result' \
  --in-reply-to MESSAGE_ID --text-file /tmp/result.txt
remote-codex inbox ack MESSAGE_ID
```

An idle sender will not wake for a passive reply. The sender must collect or register
its own wake; do not upgrade results to direct/queue to compensate. Include the
concrete response destination and handoff conditions in delegated instructions.

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

Only loopback HTTP is accepted; redirects are refused. Run on the sending device and select another device explicitly when needed. A missing connection is a configuration issue, not a reason to copy credentials into a prompt. After Supervisor restart use the current connection file if inherited credentials are stale. Invalid model, unknown thread, missing caller, and unsupported steering need corrected input, not repeated dispatch. `idle` is not task success: inspect errors, pending input, unread mail, and the relevant result.


## Durable device hooks (explicitly registered automations)

Use `remote-codex automation` (aliases `hooks` / `hook`) for an authorized
interval/at prompt, precise turn/task completion reminder, or script action.
Definitions use typed JSON; use `automation create --file hook.json` or `--json`.
Run `automation --help`, `automation create --help` and `command run --help` for
current flags. The registry is shared with the Web Automations panel and REST.

```bash
remote-codex automation create --thread self --request-id hourly-check --json '{"name":"Hourly check","trigger":{"kind":"interval","everySeconds":3600},"action":{"kind":"prompt","text":"Check the authorized project."}}'
remote-codex automation list --thread self
remote-codex automation runs --thread self AUTOMATION_ID
remote-codex automation pause --thread self AUTOMATION_ID
remote-codex automation resume --thread self AUTOMATION_ID
remote-codex automation cancel --thread self AUTOMATION_ID
remote-codex command run --thread self --command-key build --cwd . --timeout-seconds 120 -- cargo check -p remote-codex-runtime
```

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
