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

The phase-one production provider choice is a JWT-compatible product auth
issuer operated outside sandbox workers. In the first deployment this can be a
managed auth product, for example Clerk, Auth0, Cognito, or a custom Railway API
that issues signed product-session JWTs. Remote Codex should only depend on the
verified JWT claims, not on a provider SDK in route handlers.

For the current repository implementation, production mode means:

- The frontend obtains a product-session JWT from the chosen auth service.
- The browser sends that JWT only to the control-plane API.
- The control plane validates signature, issuer, audience, time claims, and
  subject.
- The control plane maps the verified subject into `control_users`.
- Worker traffic uses route tokens and worker tokens instead of the product JWT.

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

## Subject Mapping

The product user identity is keyed by:

```text
authProvider + authSubject
```

For JWT mode:

- `authProvider` is `CONTROL_PLANE_AUTH_JWT_PROVIDER`.
- `authSubject` is the JWT `sub` claim.
- `email` and `displayName` still come from the bootstrap/register payload for
  now, because provider-specific claim mapping is intentionally not coupled to
  the control-plane route code.

Recommended phase-one values:

```text
CONTROL_PLANE_AUTH_MODE=jwt
CONTROL_PLANE_AUTH_JWT_PROVIDER=clerk
CONTROL_PLANE_AUTH_JWT_ISSUER=<clerk-or-auth-service-issuer>
CONTROL_PLANE_AUTH_JWT_AUDIENCE=remote-codex-control-plane
```

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

The browser product session is used only with the control plane. It must not be
forwarded to sandbox workers. Worker traffic uses separate short-lived route
tokens and router-injected worker tokens.

## Error Shape

Authentication and authorization failures use the standard control-plane error
shape:

```json
{
  "code": "unauthorized",
  "message": "Authentication is required."
}
```

Admin-only routes return:

```json
{
  "code": "forbidden",
  "message": "Administrator access is required."
}
```
