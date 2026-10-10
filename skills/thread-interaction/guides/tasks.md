# pockymoe guide tasks

The lineage task board and harness-native timers.

## Share work through the task board

For more than two or three pieces of work, or work with ordering between pieces, put it
on the lineage's task board instead of in prompts. Every thread in your lineage sees
the same board; it outlives any one agent's context.

Use tasks for meaningful phases and dependencies, not every progress update, SHA
check or formatting change. An assigned task sends passive mail; an idle assignee
still needs an explicit queued assignment or an already-running claim/wait loop.

```bash
pockymoe task add 'Design the schema' --detail-file /tmp/schema.txt
pockymoe task add 'Write the migration' --after 1 --assign migrator
pockymoe task list            # open tasks: owner, blockedBy, ready
pockymoe task claim           # take the lowest ready task for you or nobody
pockymoe task claim --wait    # ...or block until one is ready / the board is done
pockymoe task show 2
pockymoe task done 2 --result 'Migration in db/0042.sql; tests pass'
pockymoe task done 3 --failed --result 'Blocked: no staging credentials'
pockymoe task release 2       # give it back
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
while its harness process remains alive. Pockymoe recovers its finished reply
and tool history and notifies open pages; intermediate scheduled output is backfilled
after completion. Native timers require an active harness to execute; persistence/resume depends on
the installed harness and task kind and is not confirmed by the history projection. Do not claim you configured a watch merely because you wrote
that one will wake you: verify the scheduling tool's successful result and job ID.
