# Remote Codex 0.12.68

Shared UI: `eceaaa66354df43e731cf91a0edd8d72898762d0`.

- Render complete `.drawio`/`.dio` files in Explorer, including compressed pages,
  page navigation, zoom and a source toggle. Use pinned local viewer assets and
  external initialization scripts compatible with the public Relay’s CSP;
  inherited CSP no longer causes a blank white diagram.
- Add private device HTTP previews over separate outbound binary WebSockets.
  The thread tools toolbar includes Port mappings beside sharing. Chat localhost
  links ask before enabling/opening a mapping, even with the toolbar collapsed.
  Support streamed bodies, binary assets, WebSocket connections and immediate
  stop/reconnect cancellation. Account/session revocation closes long-lived
  streams within 15 seconds. Mapping management keeps the encrypted API path;
  preview content uses ordinary HTTPS, as requested.
- Configure previews with `REMOTE_CODEX_PORT_PREVIEW_BASE_URL` after installing
  wildcard DNS, TLS and ingress routing. The feature remains unavailable until
  configured; see [setup and limits](relay-port-preview-proposal.md). Local
  upstreams use HTTP and must be reachable from the Supervisor’s loopback.
- Include the CPU temperature and hardware power sensor fixes from `75ee99c4`.

Validation: targeted Relay preview and Supervisor tunnel regressions, Web
component tests/typecheck/build, isolated real Relay/Supervisor HTTP/WebSocket
integration with desktop and mobile Chromium, and actual public draw.io rendering
under the production CSP. The release workflow gates publication on workspace
tests, all four supported native platform assets and the pinned Web build.
Windows Device Manager is not changed by this runtime release.
