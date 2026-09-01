# Architecture

Remote Codex is a Treer-shaped control plane for personal coding-agent sessions.

```text
Browser / mobile WebView
  -> Supervisor (Axum, this repo)
      -> Runtime trait
           -> ACP stdio + thin harness adapters
           -> deterministic fake runtime (tests)
      -> SQLite journal (threads, turns, history items)
  -> optional Relay (outbound device tunnel)
```

## Ownership

| Crate | Owns |
| --- | --- |
| `crates/protocol` | JSON DTOs shared with the React client |
| `crates/runtime` | SQLite journal, workspace files, ACP catalog, fake runtime, thread service |
| `crates/supervisor` | HTTP + WebSocket + relay tunnel client |
| `crates/relay` | Public accounts, devices, shares |
| `crates/cli` | `remote-codex` binary |

Harness differences stay in `crates/runtime/src/acp.rs` as command catalog + capability overlays. Supervisor code does not special-case Codex vs Grok.

Native Android/iOS/Windows clients are not duplicated in this rewrite. They keep talking to the same HTTP/WS contract from `main`. The React thread surface stays in `remote-codex-thread-ui`.
