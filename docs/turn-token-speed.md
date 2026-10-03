# Turn output token speed

`tokenUsage.generationSpeed` is optional; historical turns without trustworthy
timing do not receive an invented wall-clock speed. Runtime events start the LLM
clock at turn admission and pause it while any tools are executing (including
parallel tool waits). They resume it only once every outstanding tool completes.
This includes model response latency and reasoning, but excludes tool execution
and explicit user-input/permission waits.

The finished turn displays actual total output tokens divided by this accumulated
LLM response time. Output includes reasoning and tool arguments, matching billing.
The live footer displays a trailing **wall-clock** 60-second average using only
LLM intervals within that window; a minute spent entirely in tools is unavailable,
not a low model speed. The runtime refreshes it every two seconds. Until a usage
counter arrives, the UI displays `— tok/s`, never a character-count estimate.

Usage counters arrive at API-request boundaries, not necessarily per streamed
token. The live window apportions each reported request's actual output uniformly
over its observed LLM intervals; it is an interval average, not instantaneous
decoder throughput. Final timing is stored with the turn usage and survives reload
and restart. Tools never alter billable token counts or price categories.

Targeted checks:

```sh
cargo test -p remote-codex-runtime service::generation --lib
cargo test -p remote-codex-runtime gpt_61_sol --lib
cargo test -p remote-codex-runtime --test generation_speed
```

The real-token browser acceptance is opt-in. Copy credentials/config into a new
isolated Codex home with owner-only permissions; do not print or commit them.
Use independent database/workspace paths and ports, then run only:

```sh
E2E_REAL_CODEX=1 E2E_CODEX_HOME=/absolute/isolated/codex-home \
E2E_API_PORT=19987 E2E_WEB_PORT=16273 \
E2E_DATABASE_URL=.local/token-speed.sqlite \
E2E_WORKSPACE_ROOT=.local/token-speed-workspaces \
pnpm exec playwright test e2e/token-speed.spec.ts --project=desktop-chromium
```

The scenario uses exactly `gpt-6.1-sol`, checks the live footer during a real tool
wait, verifies all price categories and completed speed, and reloads at desktop
and phone widths. It never touches an active device Supervisor or relay.
