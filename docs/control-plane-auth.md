# Control Plane Auth

Remote Codex uses a pluggable auth verifier in the control plane.

## Phase-One Choice

Phase one keeps the product auth provider behind an interface instead of
binding the business logic directly to a vendor SDK. The implementation supports
two modes:

- `dev`: local development identities.
- `jwt`: production-style signed bearer tokens.

The `jwt` mode is intentionally generic. It validates a signed bearer token and
maps its `sub` claim to a product user identity. A later Clerk, Auth0, Cognito,
or custom auth provider can replace the verifier without changing the
repository or route ownership checks.

## Environment

```text
CONTROL_PLANE_AUTH_MODE=dev | jwt
CONTROL_PLANE_AUTH_JWT_SECRET=<secret-for-jwt-mode>
CONTROL_PLANE_AUTH_JWT_PROVIDER=jwt
CONTROL_PLANE_AUTH_JWT_ISSUER=<expected-iss>
CONTROL_PLANE_AUTH_JWT_AUDIENCE=<expected-aud>
CONTROL_PLANE_AUTH_JWT_CLOCK_SKEW_SECONDS=60
```

`CONTROL_PLANE_AUTH_MODE=dev` is the default for local development and tests.

## Local Development Auth

The dev verifier accepts either:

```text
Authorization: Bearer dev:<subject>
```

or:

```text
X-Auth-Provider: <provider>
X-Auth-Subject: <subject>
```

This is only for development and tests. Production deployments should use
`CONTROL_PLANE_AUTH_MODE=jwt` or a provider-specific verifier.

The generic `jwt` verifier checks:

- HMAC signature.
- Expiry with configured clock-skew tolerance.
- `nbf` and future `iat` with configured clock-skew tolerance.
- `iss` when `CONTROL_PLANE_AUTH_JWT_ISSUER` is set.
- `aud` when `CONTROL_PLANE_AUTH_JWT_AUDIENCE` is set.

## Product User Records

External identities are mapped to local `control_users` records by:

```text
authProvider + authSubject
```

The browser product session is used only with the control plane. It must not be
forwarded to sandbox workers. Worker traffic uses separate short-lived route
tokens and router-injected worker tokens.
