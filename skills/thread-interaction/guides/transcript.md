# pockymoe guide transcript

Retrying sends safely and reading peer history progressively.

## Retries and progressive transcript reads

Use a stable `--request-id` for a send that might need retrying. Exact same target/sender/key/text/delivery/notification choices reuse its durable receipt and originally chosen route, even if the peer has since changed state; conflicting input is rejected. New messages need new keys. Without a key, inspect before resending after a lost connection. Deduplication applies to sends, not thread creation. Delivery defaults changed in 0.12.32: preserve explicit delivery choices in automation; inspect older receipts rather than blindly retrying a pre-upgrade request with new defaults.

```bash
pockymoe transcript THREAD_ID
pockymoe transcript THREAD_ID --limit 1
pockymoe transcript THREAD_ID --before-turn TURN_ID --limit 3
pockymoe transcript THREAD_ID --turn TURN_ID --view overview
pockymoe transcript THREAD_ID --turn TURN_ID
pockymoe transcript THREAD_ID --turn TURN_ID --item ITEM_ID
pockymoe transcript THREAD_ID --turn TURN_ID --item ITEM_ID --raw
```

Default transcript: latest 3 turns, chronologically, with saved user input and **all** assistant progress/final text and available timestamps. `--limit` is capped at 20. `--before-turn` selects older turns and cannot be combined with `--turn`. Inbox mail appears in the inbox; merely reading it does not fabricate a user-message turn in the transcript.

A selected turn defaults to a paginated item directory (tools, reasoning, commands, other saved items). `--view overview` selects its conversation text. Expand only relevant items using the returned `detail`, `expand`, and continuation commands. `--offset` continues the item directory; `--text-offset` continues long text. An overview can contain truncated/partial messages: absence from one page is not proof of absence from history. `--raw` is bounded text chunks of exact saved JSON, not necessarily independently parseable JSON objects. Reassemble only when necessary. Running turns can change between reads; use returned observation/update timestamps and status.
