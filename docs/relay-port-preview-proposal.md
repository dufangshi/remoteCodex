# Device web previews through the relay (proposal)

Status: design discussion only; no port-forwarding endpoint is implemented by this change.

## Goal

Open a web application listening on a device's `127.0.0.1:4013` from the
Remote Codex browser UI, without exposing an inbound port on that device.
The first version should support private, owner-only HTTP(S) applications,
including Vite/Next.js WebSocket hot reload and streamed responses.

## Existing foundation and missing pieces

The Supervisor already initiates a persistent outbound relay connection.
However, `forward_device` in `crates/relay/src/lib.rs` is an API request/response
bridge with a default 30-second response deadline; it buffers a completed
JSON response. `forward_local` in `crates/supervisor/src/tunnel.rs` dispatches
approved Supervisor API paths and enforces the encrypted transport boundary.
Neither is a generic HTTP reverse proxy or a WebSocket upgrade tunnel.

Reuse the device registration, authentication and connection lifecycle. Add
a separate, bounded data channel for previews, rather than sending large asset
bodies through the existing chat/control queue. Each request needs a stream ID,
headers, binary chunks, completion/cancellation, backpressure and limits.
WebSocket upgrades need bidirectional frames; SSE and other streamed HTTP
responses need streaming rather than the ordinary API's completion deadline.

## Recommended address and flow

```text
Browser: https://p-<random-mapping-id>.preview.example.net/path?query
  -> Relay: authenticate owner and resolve explicitly enabled mapping
  -> Outbound device preview channel
  -> Supervisor: http://127.0.0.1:4013/path?query
```

Use one origin per mapping. A separately registered preview domain offers the
strongest separation from the control-plane login; a wildcard subdomain under
the existing site is simpler but requires strict host-only control-plane
cookies and protection against parent-domain cookies. Configure wildcard DNS
and TLS when implementing this feature.

A mapping-specific origin preserves root-relative assets, client-side routes,
cookies and WebSockets more reliably than `/devices/.../ports/4013/...` path
prefixes. Keep the browser's original path/query; forward method, content type,
body, response status and the necessary headers. Strip hop-by-hop headers and
control-plane credentials; handle upstream `Location`, cookie domains and
WebSocket `Host`/`Origin` consistently.

This cannot transparently repair JavaScript which hardcodes `localhost`, or an
application's origin/host allowlist. Vite-style servers may need an allowed
preview hostname and public HMR URL. Do not disable origin checks globally.

Open in a new tab by default. Optional embedding must respect the target app's
`X-Frame-Options` and CSP `frame-ancestors` restrictions.

## Access and lifecycle

- Explicitly enable a mapping for a validated loopback port; arbitrary network
  destinations and public sharing are outside the initial scope.
- Keep mappings private to the device owner. An unpredictable ID is a routing
  identifier, not authentication.
- Exchange a short-lived, single-use launch code for a mapping-scoped, secure,
  HttpOnly session on the preview origin. Do not put durable device/account
  credentials in the URL or forward relay cookies to the local application.
- Validate authorization on HTTP requests and WebSocket upgrades. Stop/revoke
  must close active streams; an offline device returns a clear unavailable
  response. Bound concurrent streams, body sizes and idle times without breaking
  legitimate SSE/WebSocket connections.
- Keep local application cookies separate from preview gateway authentication.
  Prevent the app from setting or overwriting gateway session cookies.

## Platform behavior

The same Rust loopback client works on native macOS, Windows and Linux. In WSL
and containers, loopback means the Supervisor's own network namespace; a
service on the Windows host or another container may require a separately
configured, explicit destination in a later version.

## Encryption decision

A conventional reverse proxy terminates HTTPS at the relay, so the relay can
read the forwarded web traffic. This is a different trust boundary from the
existing browser-to-Supervisor encrypted API transport and must be explicit.
TLS still protects browser-to-relay and device-to-relay traffic.

Keeping preview traffic opaque to the relay would require a browser-side
encrypted transport gateway (and special handling for ordinary subresource,
navigation and WebSocket requests). It is a larger design, not something the
current encrypted JSON API provides automatically. Decide this before building
the data path.

## Suggested UI and validation

A device-level Ports panel: port, optional label, status, Open, Copy address,
Stop. The local service continues running independently when its mapping stops.

Before enabling a public deployment, cover owner isolation and revocation;
binary GET/POST bodies; root-relative assets, SPA routes, redirects and cookies;
WebSocket hot reload; SSE and disconnect cancellation; reconnect/offline states;
and bounded load alongside ongoing chat traffic. These are future implementation
gates, not additional checks for the draw.io viewer change.

## References

- [Browser same-origin policy](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin_policy)
- [WebSocket API](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API)
- [Set-Cookie semantics](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie)
- [Vite host and WebSocket configuration](https://vite.dev/config/server-options.html)
