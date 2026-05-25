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
- Local worker checkpoint smoke verifies that the worker sync client reaches the
  control-plane internal checkpoint endpoint and updates durable session
  `workerSessionId`, `status`, and `lastActivityAt`.
- Phase-one staging smoke runner exists as `pnpm smoke:staging-phase-one`; it
  can produce JSON evidence for lifecycle, route-token, router, direct-worker,
  idempotent lifecycle, admin runtime detail, and optional provider gateway
  staging checks once real staging URLs and tokens are available.
- Staging smoke evidence verifier exists as
  `pnpm verify:staging-phase-one-evidence -- <smoke-json>`; it audits the
  remaining Phase 3, Phase 5, and Phase 6 staging checkboxes without mutating
  the checklist.
- AWS staging preflight evidence verifier exists as
  `pnpm verify:aws-staging-preflight-evidence -- <evidence-json>` with template
  `docs/aws-staging-preflight-evidence-template.json`; it audits S3.04 and
  S3.05 evidence before those boxes are checked.
- AWS staging preflight evidence collector exists as
  `scripts/collect-aws-staging-preflight-evidence.ts`; it can gather a first
  evidence draft from `aws` CLI, `kubectl auth can-i`, and deployment env
  values before the verifier is run. Use `pnpm exec tsx ... > file` when
  redirecting clean JSON to a file.
- Provider gateway smoke helper exists as
  `scripts/provider-gateway-smoke.ts`; it wraps a real provider CLI command,
  checks generated provider config, checks raw root-key absence, and emits the
  JSON fields required by the G6.11-G6.13 staging verifier.
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

- Phase 0 documentation and release baseline is complete in
  `docs/remote-codex-side-detailed-checklist.md`; live staging verification has
  not run yet.
- `docs/remote-codex-side-detailed-checklist.md` is the active one-item-at-a-time
  implementation checklist. Use it for task selection and checkbox updates.
  Keep `docs/remote-codex-side-work-breakdown.md` aligned for the near-term
  queue, and keep `docs/remote-codex-side-execution-checklist.md` synchronized
  when a completed item changes phase evidence or release risk.
- AWS sandbox adapter implementation exists with local manager and mocked
  EKS/Fargate adapter tests; real staging AWS/EKS lifecycle verification has not
  run yet.
- Frontend auth shell covers the local login route, authenticated route guard,
  loading state, expired-session state, disabled-account state, and admin user
  management for list/status/quota/non-admin denial. Production-style
  JWT-compatible auth smoke passes for valid, expired, wrong-issuer, and
  wrong-audience tokens. `docs/remote-codex-side-detailed-checklist.md` Phase 1
  is complete locally, including router tests and local route-token smoke
  proving browser `Authorization` is stripped before upstream worker traffic.
  Staging proof remains a release gate.
- Project detail and product metadata loading states are implemented in the
  control-plane panel; opening a session now gets an in-memory route token,
  opens a sandbox-router WebSocket, reconnects after token refresh, and shows
  sandbox-offline UI when the router socket fails.
- `docs/remote-codex-side-detailed-checklist.md` Phase 2 is complete locally:
  worker checkpoint sync updates durable session state, product session close
  calls the worker disconnect API and marks the durable session idle, and
  product session resume calls the worker resume API and marks the durable
  session active. Staging route-token/router/worker proof remains tracked under
  Phase 5 and release gates.
- Browser-to-worker route-token connection flow; route token issuance, refresh,
  browser WebSocket connection, and reconnect are in place, while staging router
  smoke checks remain open.
- `docs/remote-codex-side-detailed-checklist.md` Phase 5 is complete for local
  route-token contract, router proxying, and worker authorization. Staging
  router deployment, direct-worker-denial proof, and browser-to-router-to-worker
  smoke remain unchecked.
- `docs/remote-codex-side-detailed-checklist.md` Phase 3 is complete locally
  through local sandbox manager, local route-token smoke, capacity/image-pull
  failure mapping, runtime lifecycle audit, idle warning and idle stop policy,
  and admin force-stop audit. Real staging AWS/EKS configuration, credentials,
  Pod start/stop, and lifecycle idempotency remain unchecked.
- Worker image runtime pinning, local Docker build, local `/readyz` smoke, local
  worker auth denial/success smoke, and GitHub Actions worker image CI smoke
  are verified. CI run `26396842026` passed on
  `sandbox-worker-control-plane` at commit
  `4530b9148d9ba293d29200420d58c9ae8bba6cdb`.
- `docs/remote-codex-side-detailed-checklist.md` Phase 4 is complete for local
  worker image/runtime guardrails and CI worker image smoke.
- Worker artifact register, metadata/list, download, and delete routes exist
  behind signed identity-envelope `artifact:read` and `artifact:write` scopes.
- `docs/remote-codex-side-detailed-checklist.md` Phase 6 is complete for local
  LLM gateway integration: the gateway contract, admin client,
  provisioning/reconciliation, safe key metadata storage, redaction, degraded
  API/UI states, worker provider config rendering for Codex/Claude
  Code/OpenCode, startup diagnostics, usage import, scheduled import, LLM quota
  preflight, and usage UI are verified by local tests. Staging
  provider-runtime gateway smokes remain open.
- LLM gateway contract is fixed on a sub2api-compatible shape; provisioning,
  provider selection config, worker provider config rendering, manual usage
  import, gateway usage-export adapter, frontend degraded state, LLM usage
  summary, LLM usage detail UI, quota-exceeded UI, scheduled usage-import job,
  and usage import metrics exist.
- Gateway token storage is documented as metadata plus optional encrypted
  ciphertext only; raw provider keys and raw gateway tokens are not returned by
  Remote Codex APIs.
- Gateway admin/provider failures return stable `gateway_unavailable` API
  errors and the control-plane panel shows a dedicated gateway degraded state.
- ElAgenteHarness credential provisioning and worker bootstrap.

## Immediate Next Implementation Queue

1. Run `pnpm smoke:staging-phase-one` with staging product/admin JWTs against
   the real staging control plane, router, and worker runtime, then attach the
   JSON output to release evidence.
2. Generate or fill AWS/EKS/RBAC preflight evidence with
   `pnpm exec tsx scripts/collect-aws-staging-preflight-evidence.ts > <evidence-json>`,
   review it for real staging values, and run
   `pnpm verify:aws-staging-preflight-evidence -- <evidence-json>`.
3. Run `pnpm verify:staging-phase-one-evidence -- <smoke-json>` on the
   captured JSON before checking any staging boxes.
4. Capture staging AWS/EKS proof for sandbox start, readiness, stop, and
   idempotent lifecycle.
5. Capture staging router proof for direct-worker denial and
   browser-to-router-to-worker traffic.
6. Run staging provider-runtime gateway smokes for Codex, Claude Code, and
   OpenCode, including gateway usage records and worker env/config root-key
   absence. Use `pnpm exec tsx scripts/provider-gateway-smoke.ts <provider>`
   inside the worker to produce the required evidence JSON.

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
