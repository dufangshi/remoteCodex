# LLM Gateway Contract

This document fixes the phase-one contract between Remote Codex and the LLM
gateway. It is scoped to Remote Codex integration behavior; the gateway service
owns its own provider routing internals.

## Decision

Phase one uses a sub2api-compatible LLM gateway contract.

Remote Codex treats the gateway as an external service that owns:

- real OpenAI, Anthropic, and other provider root keys;
- provider request forwarding;
- provider-side model limits and routing;
- raw model-provider usage records;
- gateway-scoped user and key management.

Remote Codex owns:

- product users, projects, workspaces, sessions, sandboxes, usage summaries,
  quotas, and audit records;
- gateway user/key provisioning requests;
- gateway key metadata in the control-plane database;
- injecting gateway base URL and scoped key references into sandbox workers;
- importing normalized gateway usage into the Remote Codex usage ledger.

The fallback plan is a lightweight custom gateway that implements the same
admin and usage-export contract below. Remote Codex code should not depend on
sub2api UI screens or vendor-specific database tables.

## Deployment Shape

For phase-one staging and production, deploy the gateway as its own backend
service, separate from the Railway frontend, Railway control-plane API, sandbox
router, and AWS worker Pods.

Expected path:

```text
Worker Pod
  -> LLM Gateway model API
     -> real provider APIs

Control Plane API
  -> LLM Gateway admin API
  -> LLM Gateway usage export API
```

Placement:

- Staging can run the gateway on Railway or another managed container runtime.
- Production should run it as a separately scaled service with its own database
  and backup policy.
- Worker Pods need egress to the gateway model API.
- The control-plane API needs egress to the gateway admin and usage export API.
- Browser clients must never call the gateway admin API directly.

Storage and backup:

- The gateway database owns real provider root keys and raw request records.
- Backups are controlled by the gateway deployment, not by Remote Codex.
- Remote Codex stores gateway metadata only: provider name, external user id,
  external key id, key status, and optional encrypted gateway token material if
  raw recovery is explicitly enabled.

Upgrade path:

- Keep Remote Codex pointed at a stable gateway admin base URL.
- Deploy gateway updates independently.
- Run a staging smoke that provisions a user, provisions a sandbox key, sends
  one provider request through each enabled runtime, exports usage, and imports
  it into Remote Codex.

## Required Configuration

Control-plane API:

```text
LLM_GATEWAY_BASE_URL=https://llm-gateway.example.com
LLM_GATEWAY_ADMIN_BASE_URL=https://llm-gateway-admin.example.com
LLM_GATEWAY_ADMIN_TOKEN=<admin-token>
LLM_GATEWAY_TOKEN_SECRET_NAME=<aws-secret-containing-sandbox-key-material>
```

Worker environment injected by the sandbox manager:

```text
REMOTE_CODEX_LLM_GATEWAY_BASE_URL=https://llm-gateway.example.com
REMOTE_CODEX_LLM_GATEWAY_TOKEN=<sandbox-scoped-gateway-token>
```

The worker token must be user or sandbox scoped. Real provider root keys must
not enter worker env, generated provider config, browser local storage,
control-plane route tokens, or worker identity headers.

## Admin Credentials

`LLM_GATEWAY_ADMIN_TOKEN` is a control-plane secret.

Requirements:

- Store it only in the control-plane deployment secret store.
- Do not expose it through frontend env, worker env, route-token payloads, logs,
  API responses, audit metadata, or generated provider config.
- Rotate it through the gateway admin mechanism and redeploy the control-plane
  API with the new secret.
- Use least privilege when the gateway supports scoped admin tokens:
  user ensure, key ensure, key rotate, key revoke, key reconcile, and usage
  export are sufficient for Remote Codex.
- Record rotation and emergency revoke steps in release operations before
  production.

Current code redacts `LLM_GATEWAY_ADMIN_TOKEN`, `llmGatewayAdminToken`, and
gateway key ciphertext fields from control-plane logs and API responses.

## Admin API Endpoints

Remote Codex currently calls these gateway admin endpoints through
`HttpLlmGatewayAdmin`.

### Ensure User

```text
POST /api/admin/users/ensure
Authorization: Bearer <LLM_GATEWAY_ADMIN_TOKEN>
Content-Type: application/json
```

Request:

```json
{
  "externalId": "remote-codex-user-id",
  "email": "user@example.com",
  "displayName": "User Name"
}
```

Response:

```json
{
  "externalUserId": "gateway-user-id"
}
```

The response may also return `id` instead of `externalUserId`; the current
client accepts either shape.

### Ensure Sandbox Key

```text
POST /api/admin/users/:externalUserId/keys/ensure
Authorization: Bearer <LLM_GATEWAY_ADMIN_TOKEN>
Content-Type: application/json
```

Request:

```json
{
  "externalId": "remote-codex-sandbox-id",
  "userId": "remote-codex-user-id",
  "sandboxId": "remote-codex-sandbox-id"
}
```

Response:

```json
{
  "externalKeyId": "gateway-key-id",
  "keyCiphertext": "optional-encrypted-token-material"
}
```

The response may also return `id` instead of `externalKeyId`; the current
client accepts either shape.

### Rotate Sandbox Key

```text
POST /api/admin/users/:externalUserId/keys/:externalKeyId/rotate
Authorization: Bearer <LLM_GATEWAY_ADMIN_TOKEN>
Content-Type: application/json
```

Request:

```json
{
  "userId": "remote-codex-user-id",
  "sandboxId": "remote-codex-sandbox-id"
}
```

Response:

```json
{
  "externalKeyId": "rotated-gateway-key-id",
  "keyCiphertext": "optional-encrypted-token-material"
}
```

### Revoke Sandbox Key

```text
POST /api/admin/users/:externalUserId/keys/:externalKeyId/revoke
Authorization: Bearer <LLM_GATEWAY_ADMIN_TOKEN>
Content-Type: application/json
```

Request:

```json
{
  "userId": "remote-codex-user-id",
  "sandboxId": "remote-codex-sandbox-id"
}
```

Response:

```json
{
  "ok": true
}
```

### Reconcile Sandbox Key

```text
POST /api/admin/users/:externalUserId/keys/reconcile
Authorization: Bearer <LLM_GATEWAY_ADMIN_TOKEN>
Content-Type: application/json
```

Request:

```json
{
  "externalId": "remote-codex-sandbox-id",
  "userId": "remote-codex-user-id",
  "sandboxId": "remote-codex-sandbox-id",
  "externalKeyId": "existing-gateway-key-id-or-null"
}
```

Response:

```json
{
  "externalKeyId": "current-gateway-key-id",
  "keyCiphertext": "optional-encrypted-token-material"
}
```

## Usage Export Shape

The gateway should expose a paginated or watermark-based export that Remote
Codex can normalize into `POST /api/admin/usage/import`.

Minimum gateway event fields:

```json
{
  "eventId": "gateway_req_1",
  "externalKeyId": "gateway-key-id",
  "model": "gpt-5.1-codex",
  "inputTokens": 200,
  "outputTokens": 50,
  "cachedTokens": 25,
  "costUsd": 0.42,
  "currency": "USD",
  "occurredAt": "2026-05-23T01:00:00.000Z"
}
```

Remote Codex import payload:

```json
{
  "events": [
    {
      "gatewayExternalKeyId": "gateway-key-id",
      "provider": "sub2api",
      "model": "gpt-5.1-codex",
      "inputTokens": 200,
      "outputTokens": 50,
      "cachedTokens": 25,
      "costUsd": 0.42,
      "externalRequestId": "gateway_req_1",
      "occurredAt": "2026-05-23T01:00:00.000Z"
    }
  ]
}
```

Import behavior:

- `gatewayExternalKeyId` maps usage to a Remote Codex gateway key, user, and
  sandbox.
- `externalRequestId` is the dedupe key together with provider.
- Duplicate imports must return the existing Remote Codex usage event and must
  not double count usage summaries.
- If a gateway event cannot be mapped to a known gateway key, Remote Codex
  rejects the import with `usage_identity_unresolved`.
- `currency` is currently documented as required from the gateway, but Remote
  Codex phase-one storage normalizes to `costUsd`; multi-currency ledger work
  remains tracked in the unified usage phase.

Pagination/watermark requirements for the gateway export:

- Accept `from` or `cursor` input.
- Return events in stable chronological order.
- Return `nextCursor` or an equivalent watermark.
- Keep already exported events stable for at least the billing reconciliation
  window.

The scheduled puller is not implemented yet. Until then, imports use the
admin-only Remote Codex endpoint and a staging script or operator task.

## Degraded Behavior

Gateway admin failures are mapped to provider-class sandbox manager errors.
Control-plane bootstrap or admin key actions should fail closed rather than
creating a sandbox with missing or unknown gateway key state.

Expected product behavior:

- If user/key provisioning fails, return a stable API error and do not expose
  raw gateway secrets.
- If gateway key rotation fails, keep the last known key metadata and report the
  provider error.
- If usage export/import fails, keep route-token and sandbox lifecycle features
  available, but mark usage import status degraded once scheduler/status
  plumbing exists.
- If the model proxy is unavailable from a worker, provider turns fail in the
  worker while control-plane identity and sandbox lifecycle remain available.

Frontend degraded UI and scheduled usage-import status are still tracked as
open Remote Codex tasks.

## Verification

Existing tests cover:

- gateway admin user ensure;
- sandbox key ensure, rotate, revoke, and reconcile;
- gateway admin error mapping;
- gateway credential attachment to sandbox start/restart;
- gateway token redaction from control-plane responses;
- worker provider config rendering for Codex, Claude Code, and OpenCode;
- gateway usage import by external key;
- usage import dedupe by provider and external request id;
- unresolved gateway usage identity rejection.

Useful commands:

```bash
pnpm --filter @remote-codex/control-plane-api test
pnpm --filter @remote-codex/control-plane-api typecheck
pnpm --filter @remote-codex/supervisor-api test
pnpm --filter @remote-codex/supervisor-api typecheck
```
