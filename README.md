# Remote Codex Supervisor

Phase 1 implements the base supervisor foundation for a local `Codex` control surface:

- `Fastify` API with health checks, runtime config, workspace registry, and WebSocket skeleton
- `React + Vite` web shell with a single-user landing page, workspace list, add flow, and read-only tree
- `Drizzle + better-sqlite3` persistence with explicit SQL migrations
- Workspace browsing constrained to a configurable root path

## Requirements

- Node.js `>= 20`
- pnpm `>= 10`

## Install

```bash
pnpm install
cp .env.example .env
```

Optional overrides:

- `WORKSPACE_ROOT=/absolute/path`
- `DATABASE_URL=/absolute/path/to/sqlite.db`

Defaults:

- development database: `.local/supervisor-dev.sqlite`
- production database: `~/.remote-codex/supervisor.sqlite`
- workspace root: current user home directory

## Development

```bash
pnpm db:migrate
pnpm dev
```

This starts:

- API: `http://127.0.0.1:8787`
- Web: `http://127.0.0.1:5173`

## Service Mode

Build first, then use the service manager:

```bash
pnpm build
pnpm service:start
pnpm service:status
pnpm service:stop
```

This starts a quieter long-running stack:

- API: `http://127.0.0.1:8787`
- Web: `http://127.0.0.1:4173`

Logs are written to `.local/service/`.

## Remote Access via Tailscale

If you want to open the supervisor from another device on your tailnet:

```bash
pnpm dev
tailscale serve --bg 5173
```

Or, if you are using service mode:

```bash
pnpm build
pnpm service:start
tailscale serve --bg 4173
```

Useful Tailscale commands:

```bash
tailscale serve status
tailscale serve reset
```

Notes:

- `tailscale serve --bg 5173` is required for the current remote-access workflow and was previously undocumented.
- In both dev mode and service mode, the web entrypoint proxies `/api`, `/healthz`, and `/ws` to the API on
  `127.0.0.1:8787`, so you do not need a separate `tailscale serve` rule for the API port.
- If the Tailscale hostname for the target machine changes, update `allowedHosts` in
  `apps/supervisor-web/vite.config.ts` before using remote access.


## Common Commands

```bash
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm db:migrate
```

## API Endpoints

- `GET /healthz`
- `GET /api/version`
- `GET /api/config/runtime`
- `GET /api/workspaces`
- `GET /api/workspaces/:id`
- `POST /api/workspaces`
- `POST /api/workspaces/:id/favorite`
- `POST /api/workspaces/:id/open`
- `GET /api/workspaces/tree?path=...&showHidden=...`
- `GET /ws`

## Manual Acceptance

1. Remove prior build and local state:

```bash
rm -rf node_modules .local apps/*/dist packages/*/dist
```

2. Reinstall and start:

```bash
pnpm install
pnpm db:migrate
pnpm dev
```

3. Verify API health:

```bash
curl http://127.0.0.1:8787/healthz
curl http://127.0.0.1:8787/api/version
curl http://127.0.0.1:8787/api/config/runtime
```

4. Open the web UI at `http://127.0.0.1:5173`, add a valid workspace, then verify:

- it appears in the workspace list
- the detail page shows the tree
- hidden files can be toggled on and off

5. Verify failure paths by attempting to add:

- a non-existent directory
- a directory outside `WORKSPACE_ROOT`
- a non-directory path

6. Run the full quality gate:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```
