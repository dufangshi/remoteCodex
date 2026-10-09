# remote-codex guide messaging

Labels, delivery choice, batches, receipts and retries for thread send.

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
