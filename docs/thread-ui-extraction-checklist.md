# `@remote-codex/thread-ui` External Package Notes

This repository no longer owns a local `packages/thread-ui` workspace package.

The supervisor web app consumes the shared thread UI from the sibling repository package at:

```text
/home/u/dev/remote-codex-thread-ui/packages/thread-ui
```

The dependency is declared from `apps/supervisor-web/package.json` as:

```json
"@remote-codex/thread-ui": "file:../../../remote-codex-thread-ui/packages/thread-ui"
```

## Current Ownership

- `apps/supervisor-web` owns supervisor-specific routing, REST calls, websocket handling, optimistic state, settings dialogs, shell adapters, and app shell behavior.
- `@remote-codex/thread-ui` owns the reusable thread surface, composer, timeline, workspace layout, plugin provider, plugin renderer types, and related presentation components.
- Android does not compile or execute the TypeScript/React thread UI package. Android has native Kotlin UI and presentation models.

## Local Build Integration

`apps/supervisor-web/src/index.css` must scan the external package source so Tailwind generates utility classes used by `@remote-codex/thread-ui`:

```css
@source "../../../../remote-codex-thread-ui/packages/thread-ui/src/**/*.{ts,tsx}";
```

`apps/supervisor-web/vite.config.ts` also allows that sibling repository path for dev-server file access and keeps the shared UI in its own Rollup chunk.

## Removed Local Workspace Package

The old in-repository package at `packages/thread-ui` was removed because `apps/supervisor-web` already depends on the external package. Keeping both copies made the workspace misleading and allowed unused local changes to appear dirty even though the web app was resolving `@remote-codex/thread-ui` from the sibling repository.

When changing shared thread UI behavior, edit and test the external package instead of recreating `packages/thread-ui` in this repository.

## Verification

After removing the local workspace package, the expected checks are:

```bash
pnpm install --lockfile-only
pnpm --filter @remote-codex/supervisor-web typecheck
pnpm --filter @remote-codex/supervisor-web build
```

`pnpm --filter @remote-codex/thread-ui ...` is no longer a valid check in this repository because `@remote-codex/thread-ui` is not a local workspace importer here.
