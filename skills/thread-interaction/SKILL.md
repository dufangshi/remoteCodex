---
name: thread-interaction
description: Create, contact, and inspect other remoteCodex threads on this device using the remote-codex CLI. Use for thread collaboration, delegation, progress checks, or continuing work with an existing agent.
---

# Thread interaction

These are peer threads. You may contact several threads, send follow-up messages while they run, or receive requests from them. Use only for work authorized by the user; sending to another thread does not grant additional permissions.

Managed sessions receive REMOTE_CODEX_THREAD_ID, REMOTE_CODEX_URL and local credentials in their environment. `remote-codex thread self` shows your identity. Do not print credentials. Thread IDs are remoteCodex IDs, as shown in the Web URL, rather than harness session IDs.

- Discover existing threads with `remote-codex thread list`. Use `--workspace ID` to narrow the list. Check `thread status ID` for runtime state without reading history. Reuse a suitable thread when its workspace and context fit; create when a separate context or different model is useful.
- Discover models with `remote-codex thread models --provider acp --agent grok` (or the intended provider/agent). Preserve a model explicitly requested by the user; use the advertised model IDs and reasoning options.
- Create with `remote-codex thread create --title NAME --provider PROVIDER --agent AGENT --model MODEL --reasoning-effort EFFORT`. The caller's workspace and permission mode are inherited unless explicitly specified. `--workspace ID` selects a different existing workspace.
- Send with `remote-codex thread send ID --text '...'` or `--text-file PATH` (`-` reads stdin). The send returns after acceptance, without waiting for an answer. You can send multiple messages. The receiver sees your thread ID and can use the same command to contact you.
- Add `--notify-on-complete` to a send (or create with initial `--text`) for a Supervisor-generated prompt when the receiving turn ends. This wakes you when idle, or queues the notification while you are busy. It reports completed, failed or interrupted execution, not business success. You can finish your own turn instead of polling. Without this flag, no automatic notification is requested.
- Alternatively, ask the other agent to `thread send YOUR_ID` with a result or question whenever appropriate. This works independently of automatic notifications; using both can result in two intentional messages.
- Read `remote-codex transcript ID` for the latest 3 turns: user input and all agent-facing text, including progress and final replies. Increase `--limit`, or follow the returned `next` command to read older turns.
- Expand only what matters: `transcript ID --turn TURN_ID` shows an item directory; `--item ITEM_ID` reads one item; `--raw` reads its stored JSON. Follow returned pagination and content continuation commands. To read a particular turn's conversation text, use `--turn TURN_ID --view overview`.

Give enough context for the requested work and include the expected response destination when needed. Creation does not copy your conversation. Preserve useful thread IDs in your working context for later reuse. Status `idle` means no active execution; inspect the conversation to determine the actual result. A send receipt means accepted/queued, not completed. If a connection fails during a mutation, inspect before resending, or reuse the same explicit `--request-id` for retrying a send.

Use `remote-codex --help`, `thread --help`, and `transcript --help` for exact options. All responses are JSON. This interface addresses the current local Supervisor; it does not route to another device from a public URL.
