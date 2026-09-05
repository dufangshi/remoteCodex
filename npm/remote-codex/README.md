# Remote Codex

Remote Codex is a self-hosted Rust supervisor and relay for coding agents. The npm package installs a small JavaScript launcher. On first use it downloads the matching native binary from the same-version GitHub Release, verifies its SHA-256 digest, and caches it under `~/.remote-codex/bin`.

```bash
npm install -g remote-codex
remote-codex start
```

No install script or local Rust toolchain is required. The first service command needs access to GitHub Releases; later runs use the verified versioned cache.

## Updating

Use the same package manager for installation and updates:

```bash
npm install -g remote-codex@latest
remote-codex version
```

If the version stays old, check which installation your shell actually runs:

```bash
type -a remote-codex
npm prefix -g
npm ls -g remote-codex --depth=0
```

On macOS/Linux, npm puts its executable under `$(npm prefix -g)/bin`. Compare it directly:

```bash
"$(npm prefix -g)/bin/remote-codex" version
```

A previous pnpm installation can take precedence in `PATH` even after npm updates successfully. If `pnpm list -g --depth=0` confirms that duplicate and you want npm to manage Remote Codex, remove only the pnpm copy with `pnpm remove -g remote-codex`. Then run `rehash` in zsh (or `hash -r` in bash) and check the version again. For multiple Node installations, also compare `command -v npm` and the paths reported by `type -a remote-codex`.

`remote-codex version` reports the selected launcher version. An already running service continues using its current process until restarted.
