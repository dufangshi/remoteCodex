# Remote Codex 0.12.35

## Scope and pinned sources

Merge the DSH adapter and New Chat fixes described in [dsh-adapter.md](dsh-adapter.md). This includes readiness-aware ACP discovery, the complete configured model catalog and per-model reasoning choices, temporary probe cleanup, and the `/harness` settings panel with a searchable read-only startup plugin inventory. Native DSH presets remain unavailable through its upstream ACP interface and are not advertised as supported.

- Runtime main and immutable release source: `4b28cefc6f7b03b0c841684e5b759c6350f9a8b6`.
- Shared UI main: `555afc80e524a7a20a954fa58cad3e95b61e2010` in `dufangshi/remote-codex-thread-ui-rust`.
- Both release workflows pin that full shared UI SHA. Windows Device Manager is unchanged.

## Validation

The merged application source passed `cargo test --workspace`, Web typechecking, the DSH discovery regression, and five shared toolbox tests before release. Focused desktop Chromium E2E used real DSH/Grok 4.6: New Chat creation, model/reasoning discovery, harness settings and plugin inventory, compiling and running C code, and disconnect/resume followed by file operations. API checks verified empty/default reasoning and invalid-model rejection. See the implementation document for reproduction and coverage limits; this does not claim real generation with every configured provider.

The version-only release change passed locked offline workspace metadata validation. CI's workspace/migration gate and all four native builds passed. Existing successful functional checks were reused without rerunning unrelated E2E.

## Publication and artifact verification

- [Runtime/npm workflow](https://github.com/dufangshi/remoteCodex/actions/runs/34701462440): success on attempt 2.
- [Public Relay deployment](https://github.com/dufangshi/remoteCodex/actions/runs/34701463619): success.
- [GitHub v0.12.35](https://github.com/dufangshi/remoteCodex/releases/tag/v0.12.35): four native platform assets and SHA256SUMS, targeting the pinned runtime commit.
- npm `remote-codex` latest resolves to `0.12.35`. The downloaded registry tarball matches its registry SHA-512 and the original CI tarball byte-for-byte. Package and native manifest versions are `0.12.35`; all four manifest checksums and sizes match GitHub release assets.
- The public Web entry `/assets/index-CnJr7Pc1.js` matches both the Relay CI artifact and the npm-packaged Web entry byte-for-byte (SHA-256 `f457b9912cfb404c382ba4e549129313d29f9dbce76217f5820caa5b41a19dd4`). Public Relay health was healthy after deployment.

No active host Supervisor update or restart was performed for this release. Devices can install the new adapter through Settings Check/Update.

## Timing and npm visibility retry

UTC, 2026-09-12: release commit prepared at 15:10:55; runtime workflow dispatched at 15:11:11 and Relay at 15:11:12. The Rust gate took 1m37s, Web 41s, and the slowest native build (Windows) 4m04s. Packaging took 10s. Relay deployment completed at 15:13:56 and GitHub assets at 15:15:44.

npm accepted the upload at 15:16:01 but initially kept the version invisible while processing it. The existing visibility timeout reported an integrity mismatch at 15:17:12 because registry metadata was still absent. Once npm latest and the original artifact's exact bytes were verified, only the failed npm job was retried. It completed successfully at 15:22:33, reusing the original artifacts without rebuilding or replacing release assets.
