# Remote Codex 0.12.36

## Scope and pinned sources

Release the managed ACP dependency fixes described in [managed-acp-adapters.md](managed-acp-adapters.md): user-owned adapter installation, shared executable resolution for detection and launch, independent component and connection status, visible installation/repair controls, and queued task recovery after missing dependencies become available. Windows command quoting is preserved when invoking managed npm installations.

- Immutable runtime source: `1bc9875f88a9e850a51bc977acd2c4c3a1280357`.
- Shared UI: `7a0e00976b35f14462532f3eaa34892683c3a3db` in `dufangshi/remote-codex-thread-ui-rust`.
- Windows Device Manager is unchanged.

## Validation

Before release, focused ACP and RuntimeManagement regressions, Web typechecking, and locked Rust compilation passed. Ubuntu 24.04 E2E used an ordinary user, a root-owned system npm prefix, real Codex 0.154.0 and codex-acp 1.12.0, and a local mock inference endpoint. It covered automatic installation, model discovery and thread creation, install failure/backoff, later dependency discovery without a Supervisor restart, and exactly-once execution of the original queued input. See the implementation document for fixture details and coverage limits. Windows built and passed the release smoke check; the Ubuntu dependency recovery scenario was not run on Windows.

The version-only changes passed `cargo check --locked -p remote-codex-runtime`. Release CI passed `cargo test --workspace --locked`, the Web build, all four native builds, and package verification.

## Publication and verification

- [Runtime/npm workflow](https://github.com/dufangshi/remoteCodex/actions/runs/35122387188): success, attempt 2.
- [GitHub v0.12.36](https://github.com/dufangshi/remoteCodex/releases/tag/v0.12.36): targets the pinned source and contains all four native assets plus SHA256SUMS.
- npm `remote-codex` latest is `0.12.36`. Downloaded registry bytes match both the registry SHA-512 and the original CI launcher tarball byte-for-byte.
- Launcher package and native manifest both report `0.12.36`; the package includes `web/index.html`. All four downloaded native assets match manifest sizes and SHA-256 values and the release checksum file. The downloaded macOS executable reports `0.12.36`.
- The Web fixes were already deployed by [Relay workflow 35111373796](https://github.com/dufangshi/remoteCodex/actions/runs/35111373796), using the same shared UI SHA. Version-only release changes did not require another Web deployment.

No active host Supervisor was updated or restarted. Devices can install this release through Settings Check/Update.

## Timing and registry visibility

UTC, 2026-09-16: version preparation committed at 16:30:15; final lockfile synchronization at 16:30:36; workflow dispatched at 16:30:55. The Rust gate took 1m35s, Web 45s, and the slowest native build (Windows) 4m18s. Packaging took 16s. GitHub assets completed at 16:35:58.

npm accepted the upload at 16:36:13, but the registry initially returned no version metadata. The visibility timeout failed at 16:37:23. After registry availability, latest and exact original artifact bytes were verified at approximately 16:41 UTC. Only the failed npm job was retried, reusing the original artifacts; it completed at 16:41:32. Final workflow success and artifact audit completed at approximately 16:42 UTC.
