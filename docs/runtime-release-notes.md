Remote Codex now installs and updates its Rust runtime directly from **GitHub Releases**. npm is no longer a runtime distribution or update source.

- macOS/Linux: run the setup command from the Devices page. SH downloads the matching native executable and verifies SHA256 plus its actual version. Download progress and actionable network errors are visible.
- Existing devices: rerun the same setup command once to migrate an npm installation through its management updater. Device configuration, SQLite history and identity are preserved; active turns use the existing maintenance/resume flow.
- Settings → Check updates / Update: independent Rust updater downloads immutable native + Web artifacts from GitHub, verifies ownership and health, and avoids database downgrades.
- Node.js is only prepared when installing an Agent/ACP dependency that needs it. Native setup and future runtime updates do not require Node or npm.

All four supported native platforms, the pinned Web bundle, `runtime-version.txt` and `SHA256SUMS` belong to this version. Binaries are unsigned; verify checksums. Windows Device Manager is an independently released legacy bootstrap; this runtime release does not change its version or installer.

- New threads ask before installing a missing Codex/Claude ACP adapter, then continue the original creation. Versioned adapter installation avoids stale npm rename failures.
- Native subagents have a compact list with creation and relative update times. Execution history is paginated; individual record bodies load only when expanded, including records beyond the old 200-item limit.

- Chat history keeps mixed command/read/search sequences in a unified collapsible operation group, preserving intermediate assistant paragraphs and lazy tool detail loads.
