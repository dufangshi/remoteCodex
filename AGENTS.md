# Agent notes

This branch is a Rust rewrite of the Remote Codex control plane.

- Runtime and HTTP live under `crates/`. Do not reintroduce the TypeScript supervisor or the 15-coordinator split.
- ACP is the default harness path. Add a thin adapter in `crates/runtime/src/acp.rs` for command/capability differences.
- Keep JSON field names camelCase. The React app in `apps/supervisor-web` still consumes `@remote-codex/shared`.
- After changing `crates/`, run `cargo test --workspace`.
- Web E2E: follow the project [focused-e2e skill](.agents/skills/focused-e2e/SKILL.md) when selecting, writing, or running tests. Select relevant spec files/tests and an explicit browser project; do not run the full suite by default.
- Treat `apps/windows-device-manager` as a stable, independently released bootstrap. A runtime, HTTP, ACP, model, or harness fix must not by itself bump the Device Manager version, change its bundled seed version, or create a `windows-device-manager-v*` release. Publish the new `remote-codex` runtime/npm version and let existing Device Managers install it through Check/Update.
- Bump or release Windows Device Manager only when its WinForms UI, installer, tray/startup behavior, self-update path, or other bootstrap-owned behavior changes. Keep the independent Manager release separate from runtime releases.
- A versioned runtime release is immutable and includes the supported platform assets at one version. Path-filter PR CI to the affected code, but do not publish a partial replacement of one platform under an existing runtime version.
- Do not copy Android/iOS/Windows sources into this tree; stay under 50k lines.
- After completing a change and its checks, commit the relevant files in each affected repository. Keep unrelated work out of the commit.
