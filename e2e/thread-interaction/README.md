# Real local thread E2E

The disposable runtime image installs pinned Codex CLI 0.154.0, codex-acp 1.10.0 and Grok 1.0.25. The Grok installer is from [xAI's official CLI endpoint](https://x.ai/cli/install.sh). No credentials are copied into the image.

Build from the repository root:

```sh
docker build -f e2e/thread-interaction/Dockerfile -t remote-codex-thread-e2e:local .
```

Use an isolated writable state directory mounted at `/test-state`, a read-only checkout at `/src`, and a Cargo target volume at `/build`. Set `CARGO_TARGET_DIR=/build`, `CODEX_HOME=/test-state/codex`, `GROK_HOME=/test-state/grok`, `DATABASE_URL=/test-state/supervisor.sqlite`, `WORKSPACE_ROOT=/test-state/workspaces`, `HOST=0.0.0.0`, `PORT=8787` and `REMOTE_CODEX_ENABLED_AGENT_PROVIDERS=codex,acp`. Publish only a loopback host port. Copy authorized test authentication into the isolated homes; do not mount writable host agent homes or print tokens.

Inside the container, `cargo build -p remote-codex`, link `/build/debug/remote-codex` into `/usr/local/bin`, and run `remote-codex supervisor`. Model discovery must actually advertise `gpt-6-astra` and `grok-4.6` with `xhigh`; do not silently substitute.

Place this file at `/test-state/workspaces/compile-demo/hello.c`:

```c
#include <stdio.h>
int main(void) { puts("thread-compile-ok"); return 0; }
```

Use the normal Web UI through a Docker static gateway with `/api/` and `/ws` proxied to the test Supervisor. Create the workspace and a `Grok manual peer` **using computer use**, selecting ACP → Grok Build → Grok 4.6 → xhigh. Record the resulting thread ID. This manual action is part of the requested browser coverage and is not replaced by an API fixture.

Create the Astra main thread using the CLI or Web, model `gpt-6-astra`. Give it these scenarios as separate prompts, waiting for each scenario's final artifact before the next:

1. Main creates exactly one `Grok auto compiler` via CLI with an initial compile prompt and `--notify-on-complete`, saves `auto-peer.json`, and ends its turn without polling. Peer compiles `auto-program`, runs it and writes `auto-build.txt`, then finishes without a manual reply. On system notification, main reads the peer transcript, independently runs the binary and writes `auto-followup.txt` containing `AUTO_NOTIFY_FOLLOWUP_OK` and the peer ID.
2. Main sends the manually created peer a compile prompt **without** automatic notification, saves `manual-send.json`, and ends its turn. Peer builds/runs `manual-program`, saves `manual-build.txt`, then uses the project CLI to send main `MANUAL_COMPILE_REPLY_OK`. Main reads the peer transcript, independently runs the binary and writes `manual-followup.txt` containing `MANUAL_REPLY_FOLLOWUP_OK`.
3. Main sends the manual peer a prompt to write `queue-one.txt` containing `QUEUE_ONE_OK`, sleep 3 seconds and finish without replying. Main saves `queue-send-one.json`, waits 1 second, records the peer's status in `queue-state-before-second.json`, and sends another prompt while the first is running. The second asks the peer to verify the first file, write `queue-two.txt` containing `QUEUE_TWO_OK`, and manually send `QUEUE_REPLY_OK` to main. Save the second receipt as `queue-send-two.json`. Main ends its turn, then on reply reads the last two peer turns and writes `queue-followup.txt` containing `QUEUED_MESSAGES_FOLLOWUP_OK`.

All compilation uses `cc -Wall -Wextra -Werror`. The main thread performs its own CLI actions; the test operator must not create its automatic peer or send its peer messages on its behalf.

Verify artifacts, actual recorded CLI creation, configured models and persisted causal ordering:

```sh
python3 e2e/thread-interaction/verify.py \
  --state-dir .local/thread-e2e \
  --main-id MAIN_THREAD_ID --manual-id MANUAL_PEER_ID
```

The verifier is read-only and prints no credentials or full history. Keep live state, provider transcripts and credentials under an ignored local directory. Fixture/API tests cover interruption, cancellation, multi-steer notification subscriptions, authentication, content continuation and context rebinding. Process restart/recovery testing belongs on the project's Treer Apple container machine; these scenarios do not require interrupting any active Supervisor.

## Passive inbox and delivery modes (0.12.32)

`inbox.py` exercises the actual CLI/HTTP/storage integration in the isolated Docker image with `REMOTE_CODEX_E2E_FAKE_RUNTIME=1`. Start the candidate Supervisor with `DATABASE_URL=/test-state/db.sqlite`, `REMOTE_CODEX_WORKSPACE_ROOT=/test-state/workspaces`, and `PORT=8787`, then execute:

```sh
python3 /src/e2e/thread-interaction/inbox.py
```

The candidate native binary defaults to `/build/debug/remote-codex` (`E2E_BINARY` overrides it); `/src` must contain the candidate launcher and `/test-state` must be a disposable writable directory. The test creates its own workspace and Codex/ACP-Grok fixture threads. It checks passive mail without a turn, explicit acknowledgement, idempotent sends, initial-task execution, passive and queued completion notifications, adoption of a busy peer's queue, steering within the same active turn, and real launcher subcommand help. No model credentials or real model calls are used. It writes `/test-state/result.json`.

Earlier real-model scenarios above describe 0.12.30 defaults. When repeating a task-dispatch scenario on 0.12.32, use `--delivery queue` and opt into waking callbacks with `--notify-delivery queue`; ordinary replies now default to the inbox.
