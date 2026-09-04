# Remote Codex

Remote Codex is a self-hosted Rust supervisor and relay for coding agents. The npm package installs a small JavaScript launcher and the native binary for the current operating system and CPU architecture.

```bash
npm install -g remote-codex
remote-codex start
```

The platform binary is installed through an optional npm dependency. Do not install with `--omit=optional`.
