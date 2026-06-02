# @remote-codex/thread-ui

Shared Remote Codex thread UI components and plugin rendering helpers.

This package is intentionally adapter-driven. It does not import supervisor-web
API helpers, router libraries, local REST endpoints, websocket endpoint strings,
or app-local thread routes. Hosts provide navigation, asset URL,
history-detail loading, prompt submission, and shell transport through props and
adapters.

## Styling

The first extraction keeps thread-specific CSS in
`apps/supervisor-web/src/index.css` to preserve the current visual output. Host
apps that consume this package must provide the same theme tokens and classes
until thread-specific styles are moved into a package stylesheet.

Required style coverage includes the thread workspace layout, timeline,
composer, sidebar cards, empty/error/status surfaces, shell panel, and XYZ
viewer styles imported by the package plugin renderer.
