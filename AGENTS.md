# Agent Notes

## `@remote-codex/thread-ui` Build Boundary

`apps/supervisor-web` consumes `@remote-codex/thread-ui` through the package entrypoint, which points at `packages/thread-ui/dist/index.js`. Local supervisor-web tests can therefore exercise the built `dist` output rather than freshly edited `packages/thread-ui/src` files.

When changing anything under `packages/thread-ui/src`, always rebuild the package before validating supervisor-web behavior:

```bash
pnpm --filter @remote-codex/thread-ui build
```

Then run the relevant supervisor-web tests or build. Without this step, tests and local production builds may still use stale `thread-ui` output, which can make a source fix appear ineffective or make a deployment miss the intended UI behavior.

The frontend Dockerfile does rebuild `@remote-codex/thread-ui` during deployment, so committed source changes are included online. The local validation step is still required before pushing.
