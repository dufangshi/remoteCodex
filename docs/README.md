# Remote Codex Sandbox Architecture

This branch documents the product direction where Remote Codex becomes a
multi-tenant control plane plus a per-sandbox workspace worker.

The chosen first architecture is:

```text
Browser
  -> Control Plane / Gateway
    -> OpenSandbox Sandbox Worker
      -> Codex, Claude Code, or OpenCode runtime
```

The control plane owns users, projects, sandbox lifecycle, routing, secrets,
policy, and durable indexes. The worker runs inside each sandbox and owns the
workspace, agent runtime, shell, MCP servers, live thread events, and local
provider state.

Start with [Control Plane To Sandbox Worker](./control-plane-sandbox-worker.md).
