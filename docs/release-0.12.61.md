# Remote Codex 0.12.61

Routine peer reports no longer start or interrupt execution. At acceptance the
Supervisor requires `kind=task` for queued assignments, and `kind=task|question`
plus `--interrupt-reason` for urgent direct/steer corrections or unblock requests.
Managed credentials bind the sender, including when a client omits attribution.
Rejected requests receive an actionable error; already accepted request-ID retries
retain their original receipts. Human Web prompts keep their existing behavior.

Senders can opt full inbox status snapshots into coalescing with `--topic-key`.
Only older active status from that sender to that recipient on that topic is
superseded. Results, questions, tasks and replies remain distinct; historical
snapshots remain readable without being marked acknowledged. Inbox list supports
repeatable sender/kind filters, wait filters before its limit, and `--new` excludes
the entire existing backlog. Notices prioritize questions/tasks over routine status.

The collaboration skill now requires usable batch handoffs to actual dependents,
short artifact references, silent acknowledgements and receiver-owned collection
or waits. It explains urgent exceptions, status snapshot scope and question handling.
The CLI reads the running Supervisor's guide, falling back to its bundled guide
offline or with an older Supervisor. The ACP startup hint includes these rules.

Upgrade the running Supervisor to activate the checks. Peer scripts must label
queued tasks and provide interrupt reasons for direct/steer; ordinary reports should
use inbox. Existing queued work is preserved. A CLI missing the new flags must be
updated before sending urgent corrections. Status coalescing is explicit rather
than inferred from message text, and requires full snapshots published in order.

Validation: 36 runtime coordination/interaction/lineage regressions, three CLI tests,
four selected HTTP tests, skill validation and an isolated native CLI/launcher test
covering passive delivery, dispatch rejection, status replacement, filtered waits,
urgent steering and idempotent retry. Release gates validate the workspace, Web
package and all four supported native platforms.

UI: `dufangshi/remote-codex-thread-ui-rust@c365cc474ba66c0efff626f2b980f394e4a32365`.
