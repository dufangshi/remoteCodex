# Minimal core test suite (unreleased)

The user requested removing at least 70% of tests, retaining only the most important behavior. This round is measured against `1a4e08aa`, after the earlier smaller cleanup.

## Retained scope

- Data integrity: migration/backup/atomic rollback, exclusive database ownership, acknowledged input and persisted history, update success/failure recovery without duplicated work.
- Security: authentication/access scope, session revocation, anti-replay encryption/key identity, file traversal, protected attachments, host-agent secrets and command injection.
- Execution: ACP streaming, RPC/process failures, steering/restored settings; inbox, completion callbacks, caller identity, bounded progressive history; real HTTP/CLI authorization/delivery.
- Six browser cases: initial workspace/thread/prompt, queue/reload recovery, independent device locks, Relay security boundaries, offline transport behavior and encrypted interoperability.
- Small component/launcher/host-agent suites: device-scoped controls, uncertain delivery, installation integrity/rollback, API authorization/idempotency.

Removed detailed UI/layout/export permutations, model/provider/pricing permutations, legacy smoke tests, real-harness browser suites and duplicate standalone verify-rust-relay-e2e.mjs. Removed orphan helpers and reduced the fake ACP fixture to retained cases. Encryption still verifies multi-chunk bytes and replay rejection; its 14-download benchmark was removed.

This intentionally reduces regression coverage beyond deduplication. Peripheral cases now depend on manual verification or a targeted regression for a concrete high-impact bug. The separate shared thread-ui repository and independent Windows bootstrap are outside this main-repository cleanup.

## Measurement and verification

Counts use Rust test declarations and JS/TS test call sites; a parameterized declaration counts once, including platform-specific declarations. Source lines include tracked test files, fixtures and Rust cfg(test) modules, not entire production files containing a helper.

| Measure | Before | After | Removed |
| --- | ---: | ---: | ---: |
| Test declarations | 428 | 85 | 80.1% |
| Automated test/fixture lines | 22,425 | 6,573 | 70.7% |
| Rust test declarations | 268 | 58 | 78.4% |
| JS/TS test declarations | 160 | 27 | 83.1% |

The removed 460-line standalone Relay verification script is additional to the automated-source count. Including all four manual live/verification scripts in the denominator gives 23,168 → 6,856 lines, a 70.4% reduction. The three isolated Supervisor restart/update scripts remain available for that operational boundary.

Validation: Rust workspace 58 passed with no warnings; desktop Chromium 6 passed; Web components 7 passed; host-agent 6 passed; Node launcher/publish/update 10 passed. The first browser pass exposed a stale h2 selector in the retained creation test and an incomplete performance-fixture deletion; both were corrected and only those failed cases rerun. The creation test now follows the workspace's New thread link; layout-width assertions were removed from this functional smoke case. One empty Vitest suite left by pruning was removed, with the affected file rerun.

The retained Rust suite takes about 36 seconds across test binaries, versus about 60 seconds before (excluding compilation, same machine). The 25-second update/recovery cases remain intentionally. This is not a benchmark of the former full browser suite.

The default E2E command selects desktop Chromium; the Relay shortcut targets retained security/encryption specs. The obsolete harness shortcut was removed. See the [core test map](../.agents/skills/focused-e2e/references/test-map.md).

Production Rust syntax was compared before/after excluding cfg(test) nodes: no behavior changes. No version bump, publication/deployment, or active host Supervisor restart.
