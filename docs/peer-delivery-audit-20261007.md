# XP1 peer delivery audit, 2026-10-07

Read-only audit of Remote Codex root `bf8cee0b-f8f6-4f33-bac6-40ae6713768c`
and its A1–A6 children, covering approximately 12:00–18:44 UTC. Evidence comes
from persisted peer input, actual sender commands, turn timestamps and inbox
envelopes. The audit did not send instructions, acknowledge other agents' mail,
cancel their work or alter their queues.

## Findings

Most child reporting already uses inbox: 150 peer inbox messages in this window,
including 90 status, 44 result and 16 question messages. Of these, 77 went to the
parent and 73 between children. Inbox delivery prevents automatic interruptions,
but the volume still imposes reading and triage costs. No status in this sample
used `topicKey`. Several progress sequences can become one usable batch summary.

The meaningful problems are choosing queue for an active-task correction and
labelling routine information as executable tasks:

| UTC | Actual behavior | Assessment |
| --- | --- | --- |
| 13:17 | Parent queued A4's r29 search behind its running r8 turn, while A5's new experiment needed A4's shared rule library. | A future assignment may be queued, but this dependency needed an explicit boundary: publish the rules now, run financial search later. |
| 13:28–14:01 | A5 asked the parent through inbox, waited about 32 minutes, then sent direct with a concrete blocked-dependency reason. Parent used direct/steer to deliver the missing A4 task. | This escalation was justified. The original A4 continuation still existed in the audit snapshot, so a later duplicate-dispatch risk remains. |
| 13:51–17:11 | A4 queued A2's P7 blind reproduction. At 14:06 it also sent the usable package through inbox; A2 completed the reproduction in its existing turn, reported at 14:52, then received the queued task at 17:11. | Queue was redundant once the waiting consumer could continue from inbox. A2 detected the repeat and returned its existing certificate instead of rerunning financial work. |
| 14:36–17:27 | A4 queued “audit A5's existing scoring implementation; the duplicate new core is no longer needed” while A3 was implementing the original core. A3 published its new core at 14:37; the correction only became a turn at 17:27. | An active scope correction that avoids wasted work should be steer/direct with that reason, rather than a continuation. |
| 14:01 | Parent queued “standard adopted; A3 task complete, enter idle” to A3/A2. | Adoption information is inbox status/result; a genuine follow-up audit should be a separate concrete task. |
| 14:46–17:36 | A2 received a queued r31 resource notice only at 17:36, after newer resource revisions existed. | Resource changes need an authoritative current grant checked before launching work. Reductions that affect active dispatch warrant steering; FYI belongs in inbox. |
| 16:43 | Parent queued “A4 unchanged, no action needed” and “A5 result received, enter idle.” | These are passive status/acknowledgement messages, not executable tasks. |
| 17:32 / 17:56 | A1 queued A6's independent read-only acceptance, then the remaining natural-sample acceptance stage. | Appropriate queue use: concrete work, staged behind current activity. |
| 18:16 / 18:27 | Parent directly changed A5's fee rerun priority and A2/A5's primary strategy. | Appropriate active corrections: continuing with the old scope would waste computation. |
| 18:29 | Parent steered A4's changed selection gate, but queued report-only standard updates to A2/A3/A5. | A4's active selection change merits steering. Report-only updates should be inbox; if they affect a currently running selection, explicitly steer instead. |

Some apparent queue deliveries were actually `requestedDelivery=direct` resolving
to `delivery=queued` because the receiver was idle. A5's 14:00 unblock request is
one such case. Inspect the requested route and actual content before judging a
queued receipt. A queued receipt proves acceptance, not execution.

The parent also pipes send output through `grep -c requestedDelivery`. This hides
the actual `queued`/`steered`/`held` route and any diagnostic details. Preserve the
JSON receipt and inspect its delivery and error instead of treating a count of one
as proof of handling.

## Recommended coordination contract

- New work that should follow the current turn: queue, kind task.
- Ready inputs/results, ordinary questions and report-only changes: inbox, with
  a real subject/kind and correlated replies. A consumer waiting for an input
  collects it in its existing turn; it does not need a new task for each artifact.
- Stop, replace or reprioritize the active task when waiting would cause wasted
  work or harm: steer/direct with a concrete interrupt reason. New work alone is
  not a reason to interrupt.
- Publish one authoritative artifact and notify actual dependents once per usable
  batch. Coalesce replaceable status snapshots using a stable topic; questions,
  corrections and results must remain individually traceable.
- Before replacing a task that is already queued, inspect the old continuation
  and prevent it from later launching duplicate work. A task identifier/revision
  and explicit use of the available pending-message cancellation controls are
  needed; changing delivery defaults does not remove already queued input.
- Before dispatching resource-consuming work, read the current grant rather than
  executing a stale resource message in arrival order.

Existing runtime policy checks kind/reason syntax. It cannot establish whether
arbitrary prose labelled task is really a task. The bundled skill already prohibits
relabelled reports; this trace shows an agent choosing the wrong semantics despite
those instructions, not inbox being automatically upgraded to queue. The skill
now classifies active-task corrections before future assignments, and the ACP
managed prompt replaces the ambiguous “assign concrete tasks with queue” wording
with the same distinction. It also makes whole-turn queue latency, obsolete queued
assignments and full receipt inspection explicit. These are agent instructions;
the runtime cannot infer a natural-language correction from an arbitrary task body.
Existing agents/queued input are not rewritten by this repository change. The
managed-prompt and bundled-guide changes need an updated device Supervisor;
deploying the public Web alone updates the navigation indicator.

## Parent navigation indicator

The Web now distinguishes an idle/unread parent with running descendants using a
purple double-ring indicator and an accessible running-agent count. The parent's
real backend status remains idle; failure, interruption, unknown state and its own
running state retain precedence. The recent list, favorites and group tabs use the
same rule, including grandchildren and device-scoped family keys. It returns to
the ordinary idle/unread indicator when the last running descendant settles.
