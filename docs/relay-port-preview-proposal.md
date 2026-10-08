# Device web previews through the relay

## Usage

The thread toolbar’s **Port mappings** button is next to sharing. Enter an HTTP
port and optional label, then enable and open it in a new tab. Clicking a chat
link to `http://localhost:4013/...` or `http://127.0.0.1:4013/...` offers a
confirmation before enabling and opening that port. Cancelling makes no change.
Mappings belong to the device, persist across Supervisor restarts, and are
private to its account owner. Shared-thread control does not grant port access.

**Open** signs the current browser in to that preview. **Copy address** copies
the stable private address, without a login ticket; a different browser must use
Open from its own signed-in device page first. **Stop** revokes the mapping and
closes its connections; the local service keeps running. Re-enabling a stopped
port creates a new address. Supervisors predating this feature must be updated.

## Deployment: DNS, proxy and TLS

Example configuration for the existing site:

```ini
REMOTE_CODEX_PORT_PREVIEW_BASE_URL=https://lnz-study.com
```

This produces `https://p-<32-hex-mapping-id>.lnz-study.com`. Each mapping has its
own origin, so root-relative assets, client routing, application cookies and
WebSocket paths do not need a device/path prefix. The random ID is a route,
not an access credential; the Relay authenticates the owner separately.

Before setting that environment variable on the Relay:

1. Add a wildcard DNS record, `*.lnz-study.com`, pointing to the same ingress as
   the Relay. An existing exact record such as `remote.lnz-study.com` takes
   precedence. Cloudflare can proxy the wildcard. Do not add records per port.
2. Configure the ingress/reverse proxy to route `p-*.lnz-study.com` to the
   **same Rust Relay HTTP listener** as `remote.lnz-study.com`. Preserve the
   original Host, allow WebSocket upgrades, disable response buffering for
   streaming, and choose long-lived connection timeouts. DNS alone does not
   install this proxy route. The preview Host must not be rewritten to `remote`.
3. Provide TLS for these first-level subdomains on the public edge and, when
   using Full (strict), on the origin. Cloudflare Universal SSL ordinarily covers
   the root and first-level wildcard; `p-id.preview.lnz-study.com` is deeper and
   needs a different certificate arrangement. A dedicated preview domain is also
   supported by choosing it as the base URL.
4. Add the variable to the Relay service environment (on the current server,
   `/opt/remote-codex-rust-relay/relay.env`) and restart that Relay service. This
   configures the Relay, not device Supervisors. Check `/relay/port-mappings/config`
   while signed in, then open a real mapping and test a WebSocket application.

Unset configuration disables opening/enabling from the Web UI and explains the
missing setup. Existing mappings can still be stopped. Mapping/session routing
lives in Relay memory and is restored from Supervisor heartbeats after a Relay
restart; preview tabs may need **Open** again to obtain a fresh gateway session.

For isolated local tests, use `http://preview.localhost:<relay-port>`; Chromium
resolves its subdomains to loopback. Plain HTTP is for local development only.

## Data path and authentication

```text
Browser -- HTTPS --> p-ID.example.com (Relay)
                       |
                       | dedicated binary WebSocket, initiated by Supervisor
                       v
                 Supervisor -- HTTP --> 127.0.0.1:4013
```

The implementation is an ordinary HTTPS reverse proxy; preview content is not
end-to-end encrypted and the Relay can read it. The existing encrypted chat/API
transport stays in use for mapping management. The device requires no inbound
port, and only its explicitly enabled loopback ports can be connected.

The main account session stays at the Relay. **Open** exchanges a one-use,
60-second launch ticket for a mapping-scoped, HttpOnly, Secure, host-only cookie
on the preview origin. The ticket is removed with a redirect before requesting
the application. The preview gateway checks the original account session and
device ownership on every HTTP request and WebSocket upgrade. Main account and
gateway cookies are filtered out of requests to the local application; the
application cannot set gateway cookies through its HTTP responses. Cross-origin
Origin headers are rejected. Stop, device disconnect and connection replacement
cancel active tunnels. A copied address does not grant another user access.
Long-lived connections recheck session validity every 15 seconds and close after
logout, account disablement, session expiry or ownership revocation.

Each HTTP connection uses a separate bounded binary WebSocket; HTTP bodies are
streamed with backpressure rather than buffered onto the chat control channel.
WebSocket upgrades and SSE are supported. There are at most 32 enabled mappings
per device, 32 simultaneous preview connections per device and 256 per Relay.
Connecting a data channel has a 10-second deadline; response headers have a
30-second deadline. A successful streaming body/WebSocket can continue beyond
the ordinary JSON API response deadline.

## Compatibility and limits

The same Rust loopback transport works on macOS, Windows and Linux. On WSL or
containers, loopback means the Supervisor’s own network namespace. Start the
web service there; forwarding arbitrary LAN/Windows-host addresses is outside
this version. IPv6-only loopback services are tried when IPv4 connection fails.

The local upstream must use **HTTP**, not a self-signed HTTPS server or arbitrary
TCP service. Browser-to-Relay and Supervisor-to-Relay use TLS in a public setup.
Absolute localhost HTTP redirects are rewritten to the preview origin, and
application cookie Domain attributes are removed so cookies belong to that
mapping. Application CSP and frame restrictions are preserved.

A web application that hardcodes localhost in JavaScript, checks its public
origin, or uses a second port for hot reload may need application configuration.
Use same-origin WebSocket URLs or explicitly configure the app’s public HMR URL.
Do not disable its host/origin checks globally. Previews open in new tabs.

## Validation

`e2e/port-preview.spec.ts` starts isolated, real Rust Relay and Supervisor
processes plus a local HTTP/WebSocket service. It covers encrypted management,
owner isolation, binary POST/GET, redirects, cookie filtering, streamed responses,
WebSocket echo and stopping a live socket, plus confirmation/cancellation of
chat-localhost links. `preview::tests` covers origin/config validation, header
rewrites, reconnect cancellation and failed-upgrade resource cleanup. Web unit
tests cover local link parsing, confirmation and unavailable configuration.

## References

- [Cloudflare Universal SSL limitations](https://developers.cloudflare.com/ssl/edge-certificates/universal-ssl/limitations/)
- [Set-Cookie semantics](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie)
- [Vite host and WebSocket configuration](https://vite.dev/config/server-options.html)
