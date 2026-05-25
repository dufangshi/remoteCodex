# Remote Codex Branch Status

This file is the current-state handoff for the
`sandbox-worker-control-plane` branch. Update it before larger phase handoffs or
when the next implementation focus changes materially.

## Current Scope

Remote Codex is being shaped into the Agente product control plane plus sandbox
worker runtime:

- Railway-facing product frontend and control-plane API.
- Product users, projects, workspaces, sessions, sandbox registry, usage, quota,
  and audit records.
- Per-user sandbox lifecycle orchestration.
- Worker-mode supervisor API inside each sandbox.
- Worker bootstrap for Codex, Claude Code, OpenCode, MCP, the LLM gateway, and
  ElAgenteHarness.

Remote Codex integrates with, but does not own, the internals of the LLM
gateway, ElAgenteHarness, or chemistry compute workers.

## Current Mode Definitions

- Local development: dev bearer auth, local control-plane API, local database,
  local worker-process sandbox adapter, and mocked or manually configured
  gateway/harness dependencies.
- Staging: production-style JWT auth, real deployed control plane, real sandbox
  runtime, staging gateway credentials, staging harness credentials, and staging
  AWS/database/object-storage resources.
- Production: production auth, production database and object storage,
  least-privilege AWS permissions, secure secrets, route-token key rotation,
  credential rotation, usage import, quota enforcement, and operational alerts.

## Implemented Baseline

- Architecture docs and task checklists exist under `docs/`.
- Staging release-readiness notes and production release gates exist under
  `docs/`.
- Control-plane auth supports local dev bearer auth and production-style JWT
  verification with issuer, audience, expiry, not-before, issued-at, and clock
  skew checks.
- Control-plane schema and APIs cover users, projects, workspaces, sessions,
  sandboxes, route tokens, and admin user/sandbox operations.
- Project, workspace, and session list APIs support bounded `limit`/`offset`
  pagination with response metadata plus search/status filters.
- Worker-mode session checkpoint sync can call the control plane through the
  internal service-token endpoint with bounded retry/backoff.
- Control-plane session checkpoint sync rejects wrong-user and wrong-sandbox
  updates and audits sync failures.
- Inactive account behavior is implemented for route-token issuance, sandbox
  start/restart, and usage import.
- User data export and deletion/anonymization APIs are explicitly deferred in
  `docs/user-data-policy.md`; account suspension is the implemented phase-one
  control.
- Project, workspace, session, and sandbox ownership tests exist.
- Worker mode validates required sandbox identity and internal worker token
  settings.
- Worker mode disables host/provider management APIs that should not be exposed
  in sandbox runtime.
- Route-token signing supports key ids and previous-key verification.
- Route tokens carry validated project, workspace, and session scopes, and the
  sandbox router forwards project scope in the signed worker identity envelope.
- Phase-one route-token revocation strategy is documented as short TTL plus
  signing-key rotation; per-token revocation remains deferred unless launch
  requirements change.
- Local worker-process sandbox adapter exists for development.
- Phase-one AWS runtime decision is EKS Fargate with one Pod per active user
  sandbox.

## In Progress

- Phase 0 documentation and release baseline is complete for this branch; live
  staging verification has not run yet.
- AWS sandbox adapter implementation.
- Frontend auth shell covers the local login route, authenticated route guard,
  loading state, expired-session state, disabled-account state, and admin user
  management for list/status/quota/non-admin denial. Production auth-provider
  smoke coverage remains open.
- Project detail and product metadata loading states are implemented in the
  control-plane panel; opening a session now gets an in-memory route token,
  opens a sandbox-router WebSocket, reconnects after token refresh, and shows
  sandbox-offline UI when the router socket fails.
- Browser-to-worker route-token connection flow; route token issuance, refresh,
  browser WebSocket connection, and reconnect are in place, while staging router
  smoke checks remain open.
- Worker image runtime pinning, local Docker build, local `/readyz` smoke, and
  local worker auth denial/success smoke are verified. CI image checks remain
  open.
- Worker artifact register, metadata/list, download, and delete routes exist
  behind signed identity-envelope `artifact:read` and `artifact:write` scopes.
- LLM gateway contract is fixed on a sub2api-compatible shape; provisioning,
  provider selection config, worker provider config rendering, manual usage
  import, gateway usage-export adapter, frontend degraded state, LLM usage
  summary, LLM usage detail UI, quota-exceeded UI, scheduled usage-import job,
  and usage import metrics exist, while staging provider-runtime smokes remain
  open.
- Gateway token storage is documented as metadata plus optional encrypted
  ciphertext only; raw provider keys and raw gateway tokens are not returned by
  Remote Codex APIs.
- Gateway admin/provider failures return stable `gateway_unavailable` API
  errors and the control-plane panel shows a dedicated gateway degraded state.
- ElAgenteHarness credential provisioning and worker bootstrap.

## Immediate Next Implementation Queue

1. Add production auth-provider smoke coverage or staging smoke procedure for
   valid, expired, wrong-issuer, and wrong-audience tokens.
2. Add staging lifecycle smokes for start, stop, idempotent restart, and
   readiness.
3. Add CI worker image build plus CI `/readyz` and worker auth smokes.
4. Run staging provider-runtime gateway smokes for Codex, Claude Code, and
   OpenCode.

## Verification Commands

Use the focused command for the area changed, then add broader checks before a
handoff.

```bash
pnpm --filter @remote-codex/control-plane-api typecheck
pnpm --filter @remote-codex/control-plane-api test
pnpm --filter @remote-codex/supervisor-web typecheck
pnpm --filter @remote-codex/supervisor-web test
pnpm --filter @remote-codex/supervisor-api typecheck
pnpm --filter @remote-codex/supervisor-api test
pnpm --filter @remote-codex/config typecheck
pnpm --filter @remote-codex/db typecheck
```

## Migration Policy

Control-plane migrations are forward-only in this branch. Do not edit a
published migration after it has been pushed. Add a new numbered migration for
schema fixes, additive fields, indexes, backfills, or compatibility changes.

Rollback is handled operationally by restoring the database from backups or by
applying a new forward migration that reverts the undesired schema/data change.
Every migration that affects product-control-plane tables should preserve
existing user, project, workspace, session, sandbox, usage, and audit records
unless a later checklist item explicitly defines a deletion policy.

Before marking a schema checklist item complete, verify at least:

```bash
pnpm --filter @remote-codex/db typecheck
pnpm --filter @remote-codex/control-plane-api test
```

Worker image verification target:

```bash
docker build -f Dockerfile.worker -t remote-codex-worker:verify .
```

Staging smoke targets:

- User login to authenticated shell.
- Project creation to workspace creation to session creation.
- Control plane starts one sandbox.
- Browser connects through router to worker.
- Worker rejects direct non-health requests without internal token.
- Worker runs Codex, Claude Code, and OpenCode through the LLM gateway.
- Worker calls ElAgenteHarness with the injected `INACT_X_APP_KEY`.
- Usage import shows LLM and harness usage for the correct product user.
