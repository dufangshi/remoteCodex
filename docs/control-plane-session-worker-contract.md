# Control Plane Session To Worker Contract

The control plane owns durable product session metadata. The sandbox worker owns
live provider runtime state.

## Identifiers

Control-plane sessions use:

```text
control_sessions.id
```

Worker/provider sessions use:

```text
control_sessions.worker_session_id
```

The control-plane `session.id` is stable for product navigation, billing
attribution, route-token scopes, and durable indexes. `worker_session_id` is
nullable until the worker creates or resumes the provider-side session.

## Creation Flow

```text
Browser
  -> Control Plane API
     POST /api/workspaces/:workspaceId/sessions
       creates control_sessions row

Browser
  -> Sandbox Router
  -> Worker
     creates provider session/thread
     returns worker/provider session id

Browser or worker sync
  -> Control Plane API
     PATCH /api/sessions/:sessionId
       workerSessionId=<provider-session-id>
       status=active
```

## Route Tokens

Route tokens can include:

```text
workspace_id
session_id
scopes
```

The control plane verifies that any requested workspace/session belongs to the
same user and sandbox before issuing the token.

## Checkpointing

The first implementation supports explicit metadata sync through:

```text
PATCH /api/sessions/:sessionId
```

Future worker checkpointing should add a dedicated endpoint that accepts:

- worker session id
- title
- status
- last activity timestamp
- transcript archive pointer
- artifact summary
- usage summary pointer

## Ownership Boundary

The worker should not query the global user database. It receives only the
route-authorized request through the router and serves the sandbox-local
workspace/runtime state.
