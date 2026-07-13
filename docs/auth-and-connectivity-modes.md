# Auth And Connectivity Modes

Remote Codex supports three backend connectivity modes through `REMOTE_CODEX_MODE`.

The default remains compatible with the existing supervisor behavior.

## Modes

### `local`

This is the default when `REMOTE_CODEX_MODE` is unset.

The supervisor is treated as a trusted local or private-network service, such as a machine shared over Tailscale. Existing REST and `/ws` behavior stays unchanged: no login is required and clients can call the API directly.

Use this for development and trusted LAN/VPN setups.

`remote-codex start` listens on `0.0.0.0` for both the Web UI and supervisor API
unless `SERVICE_HOST` or `SERVICE_API_HOST` is set. Other devices on the same
trusted LAN can therefore connect using the host machine's LAN address. Local
mode has no login requirement, so do not expose these ports to an untrusted
network. To restrict access to the host machine, set both listener variables to
`127.0.0.1`.

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
REMOTE_CODEX_RELAY_AGENT_TOKEN=rcd_device_token_from_relay_portal
```

Relay mode still requires the local supervisor admin configuration, but public
clients authenticate against the relay user system. Requests forwarded over the
supervisor-initiated tunnel are trusted as relay-authorized requests and are not
asked to send the private supervisor admin password over the public edge.

The public relay server is packaged in the main `remote-codex` npm package and
is started with `remote-codex relay`.

On the public server, run the relay server:

```bash
npm install -g remote-codex
REMOTE_CODEX_ADMIN_USERNAME=admin
REMOTE_CODEX_ADMIN_PASSWORD=change-me-now
REMOTE_CODEX_RELAY_SESSION_SECRET=at-least-16-characters
REMOTE_CODEX_RELAY_DATA_DIR=/var/lib/remote-codex-relay
REMOTE_CODEX_RELAY_REGISTRATION_ENABLED=true
HOST=0.0.0.0
PORT=8788
remote-codex relay
```

`remote-codex relay` requires:

- `REMOTE_CODEX_ADMIN_USERNAME`
- `REMOTE_CODEX_ADMIN_PASSWORD`

It should normally also be given:

- `REMOTE_CODEX_RELAY_SESSION_SECRET`
- `REMOTE_CODEX_RELAY_DATA_DIR`
- `REMOTE_CODEX_RELAY_REGISTRATION_ENABLED`
- `HOST`
- `PORT`

On the private machine that will run Codex and access local workspaces, run the
relay-connected supervisor backend:

```bash
npm install -g remote-codex
REMOTE_CODEX_ADMIN_USERNAME=admin
REMOTE_CODEX_ADMIN_PASSWORD=change-me-locally
REMOTE_CODEX_SESSION_SECRET=at-least-16-characters
REMOTE_CODEX_RELAY_SERVER_URL=wss://relay.example.com
REMOTE_CODEX_RELAY_AGENT_TOKEN=rcd_device_token_from_relay_portal
HOST=127.0.0.1
PORT=8787
remote-codex relay-supervisor
```

`remote-codex relay-supervisor` sets `REMOTE_CODEX_MODE=relay` for the child
supervisor process. It requires:

- `REMOTE_CODEX_ADMIN_USERNAME`
- `REMOTE_CODEX_ADMIN_PASSWORD`
- `REMOTE_CODEX_SESSION_SECRET`
- `REMOTE_CODEX_RELAY_SERVER_URL`
- `REMOTE_CODEX_RELAY_AGENT_TOKEN`

When running a relay-connected supervisor beside another local Remote Codex
service, also set separate values for:

- `PORT`
- `DATABASE_URL`
- `WORKSPACE_ROOT`

`REMOTE_CODEX_RELAY_SERVER_URL` is a websocket base URL. Use `ws://host:port`
for a plain relay port, or `wss://relay.example.com` when the relay is behind
TLS.

In a source checkout, the same relay can still be developed and tested through
`pnpm --filter @remote-codex/relay-server dev`.

The relay server also serves the built web frontend when
`apps/supervisor-web/dist/index.html` is present in the installed package or
source checkout. `REMOTE_CODEX_RELAY_WEB_DIST_DIR` can override that path. The
relay injects a bootstrap config into `index.html` so the browser uses
`/relay/...` APIs instead of trying to contact a local supervisor directly.

Relay mode is a separate transport layer from the normal supervisor API. The relay should:

- authenticate relay users at the public edge,
- authenticate private supervisor tunnels with per-device tokens,
- maintain a user-owned device registry,
- expose a portal for users to create/manage devices and shares,
- expose an admin panel for the configured admin user,
- multiplex REST-like requests and websocket events over the outbound supervisor connection,
- preserve request IDs and backpressure,
- enforce a strict allowlist for shared session operations,
- avoid exposing the home supervisor directly to the public internet.

The current implementation establishes the supervisor-initiated outbound tunnel, heartbeat, multi-device relay registry, relay user accounts, session sharing, REST request multiplexing, and a websocket event bridge:

- the home supervisor validates `REMOTE_CODEX_RELAY_SERVER_URL` and `REMOTE_CODEX_RELAY_AGENT_TOKEN`,
- the home supervisor requires the configured admin username/password for Remote Codex API access,
- the home supervisor connects outward to `/supervisor/tunnel`,
- the relay authenticates that tunnel with a per-device token created in `/relay-portal`,
- optional `REMOTE_CODEX_RELAY_SUPERVISOR_TOKEN` remains as a legacy bootstrap token path,
- `/healthz` on the relay reports whether a supervisor is connected.
- relay users register with email, username, and password at `/relay-portal`,
- relay users create devices and configure the returned `rcd_...` token on the private supervisor as `REMOTE_CODEX_RELAY_AGENT_TOKEN`,
- clients call `GET|POST|PATCH|DELETE /relay/devices/:deviceId/api/...` on the public relay,
- `/relay/api/...` remains a compatibility path that selects the first accessible connected device,
- the relay authenticates clients with relay user sessions,
- the relay forwards allowed requests to the home supervisor through the outbound websocket tunnel,
- the home supervisor executes the request locally with Fastify injection and returns the response over the tunnel.
- clients can connect to `GET /relay/devices/:deviceId/ws` on the public relay,
- `/relay/ws` remains a compatibility path that selects the first accessible connected device,
- the relay authenticates websocket clients with relay user sessions,
- thread and shell event envelopes are forwarded from the home supervisor to relay websocket clients,
- relay websocket clients can use `supervisor.ping` and receive `supervisor.pong`,
- relay websocket client messages are routed through the home supervisor websocket plugin handlers, so terminal plugin messages such as shell attach, input, resize, clear, and detach can use the relay path.

## Relay Users, Devices, And Sharing

The relay server stores users, devices, and shares in
`REMOTE_CODEX_RELAY_DATA_DIR/relay-store.json` by default. The first admin user
is seeded from `REMOTE_CODEX_ADMIN_USERNAME`,
`REMOTE_CODEX_ADMIN_PASSWORD`, and optional `REMOTE_CODEX_ADMIN_EMAIL`.

Relay portal:

- `/relay-portal` lets users log in or register with email, username, and password.
- registered users can create multiple devices.
- creating a device returns a one-time `rcd_...` device token.
- each device token maps one running private Remote Codex supervisor to that user.
- users can share a single `threadId` on one device with another username.
- invited users see those entries under Shared With Me and can continue the shared thread.

Relay admin:

- `/relay-admin` is available to the seeded admin user.
- admin can view all users and devices.
- admin can enable or disable normal users.
- admin can enable or disable open registration.

Shared session access is intentionally narrower than owner access. Device owners
can access their device's full allowed relay API surface. Invited users can only
use the shared thread routes and the websocket stream is scoped to the shared
thread.

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
