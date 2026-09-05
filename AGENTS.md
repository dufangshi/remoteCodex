# Agent notes

This branch is a Rust rewrite of the Remote Codex control plane.

- Runtime and HTTP live under `crates/`. Do not reintroduce the TypeScript supervisor or the 15-coordinator split.
- ACP is the default harness path. Add a thin adapter in `crates/runtime/src/acp.rs` for command/capability differences.
- Keep JSON field names camelCase. The React app in `apps/supervisor-web` still consumes `@remote-codex/shared`.
- After changing `crates/`, run `cargo test --workspace`.
- Web e2e: `REMOTE_CODEX_E2E_FAKE_RUNTIME=1 pnpm test:e2e`.
- Do not copy Android/iOS/Windows sources into this tree; stay under 50k lines.
- After completing a change and its checks, commit the relevant files in each affected repository. Keep unrelated work out of the commit.
