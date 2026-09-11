# Remote Codex 0.12.30

## Changes

- Provider-independent local CLI: create peer threads, submit messages without blocking, inspect status, and read progressively paginated transcripts. Optional per-send terminal-turn notifications and explicit peer replies both use the existing continuation queue. No new database tables.
- Detailed agent instructions in `skills/thread-interaction/SKILL.md`, embedded in the binary as `remote-codex skill`. Includes reuse, model discovery, asynchronous delivery, callback patterns, idempotent sends, progressive reads, and local connection troubleshooting.
- The device portal now probes each online device with a small encrypted version request. The lock no longer depends on which device that particular browser previously visited. Unknown/error states remain visible, and identity-change warnings cannot be overwritten by a later probe result.

Shared UI pinned to already-published `dufangshi/remote-codex-thread-ui-rust` commit `f3cc41eb494dc85c6efe77914b8150bc38251bd6`; no shared UI source change is needed. Supervisor Web changes are included in the runtime package and require deployment of the public relay. Windows Device Manager versions remain unchanged.

## Validation

- Combined runtime sources: `cargo test --workspace`: 260 passed, 1 existing installed-Gemini manual test ignored.
- Detailed skill: skill-creator `quick_validate.py` passed; the rebuilt binary prints the embedded guide.
- Web: TypeScript check, production build, and `DeviceEncryptionStatus.test.tsx` (3 tests) passed.
- Browser: `device-encryption-status.spec.ts`, explicit `desktop-chromium`, passed against a Docker-hosted real Rust relay and two independent real Supervisors built from the 0.12.30 candidate. Two fresh browser contexts each first pin only the opposite device, then verify both lock icons and fingerprints on the portal, including reload. Model calls are unnecessary at this encryption boundary.
- Browser: existing `Workspaces exposes identity verification and pins only the confirmed replacement` regression passed on `desktop-chromium`.
- Prior real Docker thread interaction validation: 13 completed turns across GPT-6 Astra/high and ACP Grok 4.6/xhigh, including agent-created and manually UI-created peers, automatic completion prompts, explicit reverse prompts, compile artifacts, and messages queued while busy. See [thread-interaction-e2e.md](thread-interaction-e2e.md).

The lock regression can run self-contained with the locally built binary and Web assets:

```bash
E2E_API_PORT=18979 E2E_WEB_PORT=18980 pnpm exec playwright test \
  e2e/device-encryption-status.spec.ts --project=desktop-chromium
```

For Docker validation, `E2E_DEVICE_LOCK_RELAY` selects an isolated, externally started relay containing exactly two online fixture devices owned by `lockowner`. Supply that fixture user's password through `E2E_DEVICE_LOCK_PASSWORD`; never use a production account. The same browser assertions then run against Docker while keeping the two browser identity stores independent.

## Published result

- [PR #15](https://github.com/dufangshi/remoteCodex/pull/15) merged into `main` as `9ccee132a2a032ba139fdb76d824b4f5efa06d40`.
- [Runtime/npm release run](https://github.com/dufangshi/remoteCodex/actions/runs/34619227851): success, attempt 2. All native builds and package checks were reused; only the failed npm publishing job was rerun.
- [Public Relay deployment](https://github.com/dufangshi/remoteCodex/actions/runs/34619230427): success at the same runtime and shared UI revisions. Browser verification on the real site showed WSL, Mac, and Win simultaneously marked encrypted after device reconnection.
- [GitHub v0.12.30](https://github.com/dufangshi/remoteCodex/releases/tag/v0.12.30): all four native assets and `SHA256SUMS` present. npm `latest` is `0.12.30`.
- Downloaded npm archive was byte-identical to the original CI artifact. Its four-platform native manifest matched GitHub's checksum file. The downloaded macOS native binary's SHA-256 matched, it reported `0.12.30`, and both the native executable and the published npm launcher printed the project skill exactly (apart from the command's trailing newline).

Timing (UTC, 2026-09-11): local integration began at 15:45; the final local candidate was committed at 15:56:32 and merged at 15:58:01. Release dispatch was 15:58:05. The Web build took 38 seconds, Rust gate 2m15s, and the slowest parallel native build (Windows) 3m58s; packaging took 16 seconds. GitHub assets finished at 16:02:47. Relay deployment finished at 16:00:40. Final registry/package checks completed by 16:08:54.

npm initially accepted the upload at 16:03:12 but reported that processing could take several minutes. The publishing script's visibility check exhausted its retry window at 16:04:19 and labeled the missing registry value an integrity mismatch. The version subsequently appeared with the exact expected SHA-512. Only then was the failed job rerun; it skipped the matching immutable package, confirmed the `latest` tag, and finished successfully at 16:08:04. No version or asset was overwritten and no duplicate package was uploaded.
