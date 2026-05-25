# Release Gates

This checklist blocks production release until the required implementation,
smoke, deployment, rollback, and security gates have passed.

It is intentionally stricter than the normal implementation checklists. A task
being implemented locally is not enough for production readiness when the gate
requires staging evidence.

## Gate Rules

- Leave a gate unchecked until the named evidence exists.
- A passing unit test can satisfy a unit-test gate only.
- A local smoke can satisfy a local-smoke gate only.
- A staging smoke can satisfy a staging gate only after it has run against the
  real staging services.
- Do not use mocked gateway, mocked harness, or local worker-process adapters
  as evidence for a production gate.

## Production Blocking Gates

### Auth And User Boundary

- [ ] Production auth-provider smoke passes for valid, expired, wrong-issuer,
  and wrong-audience tokens.
- [x] Disabled users cannot issue route tokens.
- [x] Disabled users cannot start or restart sandboxes.
- [ ] Product JWTs are stripped before router-to-worker traffic in staging.
- [ ] Admin user management has non-admin denial tests.

### Sandbox Lifecycle

- [ ] Worker image builds from a clean checkout.
- [ ] Worker image is pushed with an immutable tag.
- [ ] Staging control plane starts one EKS Fargate sandbox.
- [ ] Staging worker reaches `/readyz`.
- [ ] Staging control plane stops the sandbox and state converges.
- [ ] Sandbox lifecycle errors are visible in control-plane status.
- [ ] There is a cleanup or reaper path for stale starting/stopping sandboxes.

### Router And Worker Identity

- [ ] Staging browser-to-router-to-worker smoke passes.
- [ ] Direct worker non-health requests fail without router-injected worker
  token.
- [ ] Route tokens are short-lived and stored only in browser memory.
- [ ] Worker validates signed identity envelope expiry, sandbox id, and scopes.
- [ ] Worker denies protected shell/file/provider routes without required
  scopes.

### LLM Gateway

- [x] Gateway deployment shape and admin endpoint contract are documented.
- [ ] Gateway admin credentials are stored outside frontend and worker env.
- [ ] Codex reaches the gateway in staging.
- [ ] Claude Code reaches the gateway in staging.
- [ ] OpenCode reaches the gateway in staging.
- [ ] No raw provider root key is present in worker env or generated provider
  config.
- [ ] Gateway tokens are redacted from logs and API responses.
- [ ] Gateway usage import maps usage to the correct product user and sandbox.
- [ ] Duplicate gateway usage imports do not double-count usage.

### ElAgenteHarness

- [ ] Harness credential provisioning is implemented or explicitly blocked for
  launch.
- [ ] Worker receives a scoped `INACT_X_APP_KEY`.
- [ ] Worker calls staging ElAgenteHarness successfully.
- [ ] Harness keys are redacted from logs and API responses.
- [ ] Harness usage import or launch deferral is documented.

### MCP And Tool Policy

- [ ] Approved MCP server registry exists.
- [ ] Stdio MCP servers run with cwd inside `/workspace`.
- [ ] MCP env vars are allowlisted.
- [ ] Host-local filesystem, Docker, and database MCP servers are blocked by
  default.
- [ ] MCP config rendering tests pass for enabled provider runtimes.

### Usage, Billing, And Quotas

- [ ] User-facing usage summary exists for LLM usage.
- [ ] Basic LLM spend quota is enforced before route-token issuance or provider
  usage path.
- [ ] Usage ledger stores enough data for billing reconciliation.
- [ ] Admin usage reconciliation path or export exists.
- [ ] Quota-exceeded UI state exists.

### Deployment And Operations

- [ ] Railway frontend deployment config is documented or versioned.
- [ ] Railway control-plane deployment config is documented or versioned.
- [ ] Control-plane migrations run as part of deployment.
- [ ] Required environment variables are documented.
- [ ] Route-token signing secrets are stored securely.
- [ ] Worker internal token material is stored securely.
- [ ] AWS permissions are least-privilege or explicitly scoped for staging.
- [ ] Control-plane, router, and worker logs are structured and redact secrets.
- [ ] Sandbox lifecycle, route-token, worker connection, and usage import
  metrics exist or are explicitly deferred before production.

### Rollback And Emergency Response

- [ ] Railway frontend rollback procedure is documented.
- [ ] Railway control-plane rollback procedure is documented.
- [ ] Worker image rollback procedure is documented and tested in staging.
- [ ] Route-token signing key rotation procedure is documented.
- [ ] Gateway key revoke/rotate procedure is documented.
- [ ] Harness key revoke/rotate procedure is documented.
- [ ] Emergency stop for active sandboxes is available to admins.

## Minimum Phase-One Release Condition

Production release is blocked until every item below is checked:

- [ ] A user can register and log in.
- [ ] The user gets exactly one sandbox.
- [ ] The sandbox starts from a pinned worker image.
- [ ] The browser connects to the worker through route-token proxying.
- [ ] Codex, Claude Code, and OpenCode can use the LLM gateway.
- [ ] Real provider root keys never enter the sandbox.
- [ ] The worker receives and uses `INACT_X_APP_KEY`.
- [ ] The user can see workflow/task state or the launch deferral is explicit.
- [ ] The control plane imports LLM usage.
- [ ] The user can see a usage summary.
- [ ] Basic quota enforcement exists.
- [ ] Staging browser-to-worker-to-gateway-to-harness smoke has passed.

## Related Documents

- [Staging Release Readiness](./staging-release-readiness.md)
- [Remote Codex Side Execution Checklist](./remote-codex-side-execution-checklist.md)
- [Remote Codex Branch Status](./status.md)
