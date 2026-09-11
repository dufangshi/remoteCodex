# Test suite pruning (unreleased)

This change removes obsolete or duplicated coverage, without changing the runtime version or publishing a release.

## Removed coverage and retained checks

| Removed | Reason / retained coverage |
| --- | --- |
| `composer-caret.spec.ts`; skipped groups in runtime-bubble and relay-shared-actions | Unconditionally skipped old UI/TS relay fixtures. Keep the active IME, image-paste, streaming, usage, shared-access and fork regressions in those files, plus the shared thread-ui component tests. |
| Phase 4/5 Claude/OpenCode SDK acceptance scripts | Superseded SDK assumptions and real-model waits for queue and slash-command behavior. Keep Rust `pending_prompt_routes_match_the_frontend_contract`, ACP queue/cancel tests and dynamic command negotiation; keep the active browser slash/fork and composer tests. |
| `acp-core-capability.spec.ts` | Requires `fixture-fast` / `FAKE_ACP_PARTIAL_1`, whose fixture is absent. Keep ACP settings/resume/usage tests and browser usage/reload regressions. |
| `runtime-install-availability.spec.ts` | Requires absent Claude SDK installation shims and old SDK version/UI assumptions. Keep the current RuntimeManagement and ThreadCreateForm component tests; this deletion does not claim an equivalent real installation browser test. |
| File API / long-turn cases in files-browser; file API case in real-harness suite | Duplicate Rust HTTP file/prompt/interrupt coverage. The old Files tab assertions were conditional and could all be bypassed. Keep the actual Explorer concurrency/reload browser test, Rust ZIP/size-limit tests and HTTP binary-download tests. |
| Rust fake-provider hello matrix, file wrapper/name smoke tests and fake capability-constant tests | HTTP tests already exercise the same Supervisor calls; constants of the fake runtime are not independent product behavior. Keep real ACP capability tests and the fake-backed fork/compact behavior tests. |

Removed unused fixtures with their tests. No tests were newly skipped or conditionally bypassed to obtain passing results. The shared-access test now verifies the destination URL and thread title, dropping an obsolete cross-route coordinate comparison that assumed mobile rooms controls also existed on desktop. Dedicated mobile navigation/layout tests remain.

## Runtime cost

- Responsive route matrices retain 320, 768 and 1440 px, removing the adjacent 375/390 px repeats. Separate mobile interaction tests remain.
- Removed unconditional screenshots from the runtime-bubble suite; functional/layout assertions and failure traces remain.
- Fixed the Explorer concurrency test's stale `./.cargo` request matcher to accept the current `.cargo` path too. Its request gate and sibling/reload assertions remain. The baseline timed out after 120 seconds; the corrected test passed in 1.8 seconds.
- Repaired two other stale regressions: shared-access fixtures now provide the online field and presence probe required before opening a device; usage assertions distinguish 1,000 uncached input tokens from 500 cached tokens. Navigation and live/reloaded usage assertions remain.
- On the same machine and desktop Chromium, the two route matrices took 3.6 / 3.8 seconds before and 2.3 / 2.4 seconds after. These are individual test timings, not a claim about full-suite speedup. Removing already-skipped suites reduces maintenance/discovery only.

Tracked test source/fixtures decreased from 24,461 to 22,692 lines: 1,769 lines removed overall, including 1,642 of 8,603 E2E lines (19%). Rust inline counts include trailing test modules; the independent thread-ui repository is excluded.

## Validation

- `cargo test --workspace`: 266 passed, one existing real-Gemini test ignored.
- Ten relevant desktop Chromium regressions passed: Explorer concurrency/reload; both responsive route matrices; live usage/reload; refreshed text/deltas; Claude OAuth windows through both providers; shared fork access; shared profiles/history/navigation; device-scoped runtime settings. Failed stale-fixture cases were corrected and rerun individually.
- Launcher tests: five passed. Native and npm CLI smoke checks verified nested help, the embedded skill, and rejection of the removed command.
- Skill validation, Rust formatting and whitespace checks passed. No runtime version change, release, deployment or host Supervisor restart.

## CLI removal

Removed `inbox adopt-queued`, its `inboxAdoptQueued` HTTP dispatch and queue-to-inbox mutation, plus migration-only tests and maintained skill instructions. List/read/ack, inbox/queue/steer delivery and completion notifications remain. Existing queued work is not migrated or cancelled. The 0.12.32 release document is a historical record of that published version.
