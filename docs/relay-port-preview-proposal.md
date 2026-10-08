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

### Current production ingress

The `lnz-study.com` preview ingress was enabled on 2026-10-08. Cloudflare proxies
`*.lnz-study.com` to the existing `remote.lnz-study.com` ingress; its active
Universal SSL certificate covers these first-level preview hosts. The origin
keeps the existing main-site HTTP ingress path. This setup does not install a
wildcard origin certificate or change the zone's SSL mode.

On the Relay host, Nginx Proxy Manager runs with host networking. Its mounted
`/opt/nginx-proxy-manager/data/nginx/custom/http.conf` includes
`/data/nginx/custom/remote-codex-preview.conf`. That separate file only matches
`p-<32 lowercase hex digits>.lnz-study.com`, preserving unrelated wildcard
domains and existing NPM-managed services:

```nginx
map $http_upgrade $rc_preview_upgrade {
    default upgrade;
    '' close;
}
server {
    listen 80;
    listen [::]:80;
    server_name "~^p-[a-f0-9]{32}\.lnz-study\.com$";
    access_log off;
    error_log /data/logs/remote-codex-preview-error.log warn;
    client_max_body_size 64m;
    location / {
        proxy_pass http://127.0.0.1:18791;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $x_forwarded_proto;
        proxy_set_header X-Forwarded-Scheme $x_forwarded_proto;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $rc_preview_upgrade;
        proxy_connect_timeout 15s;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_buffering off;
        proxy_request_buffering off;
        proxy_cache off;
        proxy_hide_header Cache-Control;
        proxy_hide_header Expires;
        add_header Cache-Control "private, no-store" always;
        add_header Referrer-Policy "no-referrer" always;
    }
}
```

Access logging is disabled for this route so one-use launch tickets do not enter
the origin's URL logs. `private, no-store` keeps authenticated preview responses
out of shared caches. Any Cloudflare cache rules must also respect this policy.

Validate and gracefully reload with
`docker exec nginx-proxy-manager-app-1 nginx -t` followed by
`docker exec nginx-proxy-manager-app-1 nginx -s reload`. The Relay environment
file contains `REMOTE_CODEX_PORT_PREVIEW_BASE_URL=https://lnz-study.com`; Relay
deployments preserve that file. Only `remote-codex-rust-relay.service` needs a
restart when changing this variable. Existing device Supervisors reconnect.

The pre-configuration environment and custom HTTP configuration are backed up
under `/opt/remote-codex-rust-relay/preview-setup-backup-20261008`, with restricted
permissions. To undo this setup, restore those two files, validate/reload NPM,
remove the now-unused custom preview file, and restart the Relay. Do not copy
credentials from the environment backup into documentation or command output.

Production validation used an isolated temporary account, device Supervisor and
loopback service. Public HTTPS returned the HTML with `private, no-store`, SSE
delivered its first event, and WSS upgraded with an echoed message. Anonymous
access returned 401; stopping the mapping produced 404 after the next device
heartbeat. All test resources were removed. The 27 existing containers retained
their IDs, and existing ingress routes retained their pre-change HTTP statuses.

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
