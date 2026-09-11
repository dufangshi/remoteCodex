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
