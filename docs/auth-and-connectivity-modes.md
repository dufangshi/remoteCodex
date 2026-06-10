# Auth And Connectivity Modes

Remote Codex supports three backend connectivity modes through `REMOTE_CODEX_MODE`.

The default remains compatible with the existing supervisor behavior.

## Modes

### `local`

This is the default when `REMOTE_CODEX_MODE` is unset.

The supervisor is treated as a trusted local or private-network service, such as a machine shared over Tailscale. Existing REST and `/ws` behavior stays unchanged: no login is required and clients can call the API directly.

Use this for development and trusted LAN/VPN setups.

### `server`

The supervisor is deployed as a reachable server and must protect API access.

Required environment variables:

```bash
REMOTE_CODEX_MODE=server
REMOTE_CODEX_ADMIN_USERNAME=admin
REMOTE_CODEX_ADMIN_PASSWORD=change-me
REMOTE_CODEX_SESSION_SECRET=at-least-16-characters
```

In this mode:

- `POST /api/auth/login` accepts the configured admin username and password.
- `GET /api/auth/session` returns the current auth state.
- `POST /api/auth/logout` clears the session token.
- All other `/api/*` routes require auth.
- `/ws` requires auth before the websocket is accepted.

The first implementation uses a signed bearer/session token suitable for simple single-admin deployments. It is intentionally minimal and should be replaced or extended before multi-user SaaS usage.

Clients can authenticate in two ways:

- Same-origin web clients can rely on the `remote_codex_session` HttpOnly cookie set by login.
- Native clients should send `Authorization: Bearer <token>` on REST calls.
- Browser websocket clients cannot set custom headers, so `/ws?token=<token>` is accepted for websocket authentication.

### `relay`

The supervisor runs on a private machine and connects outward to a public relay. Mobile and web clients connect to the relay, and the relay forwards traffic to the private supervisor over that outbound tunnel.

This mode exists because the private supervisor often cannot accept inbound public connections due to NAT, firewalls, or dynamic IPs. The durable connection must therefore be initiated by the supervisor:

```text
Mobile app / browser
  -> public relay
    -> existing outbound supervisor-to-relay websocket
      -> home Remote Codex supervisor
```

Expected environment variables:

```bash
REMOTE_CODEX_MODE=relay
REMOTE_CODEX_ADMIN_USERNAME=admin
REMOTE_CODEX_ADMIN_PASSWORD=change-me
REMOTE_CODEX_SESSION_SECRET=at-least-16-characters
REMOTE_CODEX_RELAY_SERVER_URL=wss://relay.example.com
REMOTE_CODEX_RELAY_AGENT_TOKEN=shared-or-issued-agent-token
```

Relay mode requires the same supervisor admin login as `server` mode. The relay
edge token controls access to the public relay, and the supervisor admin token
controls access to Remote Codex API operations once traffic reaches the private
supervisor.

The public relay server is packaged in the main `remote-codex` npm package and
is started with `remote-codex relay`.

On the public server:

```bash
npm install -g remote-codex
REMOTE_CODEX_RELAY_SUPERVISOR_TOKEN=shared-or-issued-agent-token
REMOTE_CODEX_RELAY_CLIENT_TOKEN=client-edge-token
HOST=0.0.0.0
PORT=8788
remote-codex relay
```

In a source checkout, the same relay can still be developed and tested through
`pnpm --filter @remote-codex/relay-server dev`.

Relay mode is a separate transport layer from the normal supervisor API. The relay should:

- authenticate client sessions at the public edge,
- authenticate the private supervisor tunnel,
- multiplex REST-like requests and websocket events over the outbound supervisor connection,
- preserve request IDs and backpressure,
- enforce a strict allowlist of supervisor operations,
- avoid exposing the home supervisor directly to the public internet.

The current implementation establishes the supervisor-initiated outbound tunnel, heartbeat, minimal REST request multiplexing, and a narrow websocket event bridge:

- the home supervisor validates `REMOTE_CODEX_RELAY_SERVER_URL` and `REMOTE_CODEX_RELAY_AGENT_TOKEN`,
- the home supervisor requires the configured admin username/password for Remote Codex API access,
- the home supervisor connects outward to `/supervisor/tunnel`,
- the relay authenticates that tunnel with `REMOTE_CODEX_RELAY_SUPERVISOR_TOKEN`,
- `/healthz` on the relay reports whether a supervisor is connected.
- clients call `GET|POST|PATCH|DELETE /relay/api/...` on the public relay,
- the relay authenticates clients with `REMOTE_CODEX_RELAY_CLIENT_TOKEN` when configured,
- the relay forwards allowed requests to the home supervisor through the outbound websocket tunnel,
- the home supervisor executes the request locally with Fastify injection and returns the response over the tunnel.
- clients can connect to `GET /relay/ws` on the public relay,
- the relay authenticates websocket clients with `REMOTE_CODEX_RELAY_CLIENT_TOKEN` when configured,
- thread and shell event envelopes are forwarded from the home supervisor to relay websocket clients,
- relay websocket clients can use `supervisor.ping` and receive `supervisor.pong`,
- relay websocket client messages are routed through the home supervisor websocket plugin handlers, so terminal plugin messages such as shell attach, input, resize, clear, and detach can use the relay path.

The first relay forwarding layer is intentionally narrow:

- it allows `/api/*` and `/healthz` targets only,
- it is intended for JSON/text REST calls,
- it relays supervisor event stream output and websocket plugin commands,
- it does not yet optimize binary downloads, file streams, or large multipart uploads,
- it does not yet implement request backpressure beyond per-request timeout cleanup.

Those capabilities should be added on top of the same outbound tunnel rather than by exposing the home supervisor directly.

## Security Notes

- Use `local` only on trusted loopback, LAN, or VPN networks.
- Use HTTPS/TLS in `server` mode when accessed by mobile clients.
- Do not reuse the admin password as `REMOTE_CODEX_SESSION_SECRET`.
- Keep destructive actions behind existing confirmation flows even after login.
- For mobile apps, store tokens in Keychain or Android Keystore.
