# 0.12.19: ACP interruption and queued prompts

Fix commit: `006c2f70`. Shared UI: `c34bb966936655eb80b294ba8289dae4ed8cdcda`.

For ACP harnesses such as Grok Build, interrupting the active turn now waits for its prompt RPC to settle before sending the next queued prompt. Cancellation errors remain interrupted, not failed. A harness that does not acknowledge cancellation within five seconds is stopped; the continuation resumes the persisted session in a fresh process.

The interrupt endpoint no longer sends a duplicate cancellation or forcibly reconciles a subsequent live turn. Pending messages are removed only after their replacement turn has been persisted, so session-resume failures retain the queue.

Validation: runtime integration fixtures cover fast acknowledgement with a still-running continuation, delayed cancellation returning an RPC error, and an unresponsive cancellation requiring process recovery. Full local workspace tests passed (228 tests); the release workflow gates publishing on its own test suite and all four native platform assets.

This is a runtime change: update the device Supervisor to 0.12.19. There are no Web UI or Windows Device Manager changes in this release.
