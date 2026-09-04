# Remote Codex

Remote Codex is a self-hosted Rust supervisor and relay for coding agents. The npm package installs a small JavaScript launcher. On first use it downloads the matching native binary from the same-version GitHub Release, verifies its SHA-256 digest, and caches it under `~/.remote-codex/bin`.

```bash
npm install -g remote-codex
remote-codex start
```

No install script or local Rust toolchain is required. The first service command needs access to GitHub Releases; later runs use the verified versioned cache.
