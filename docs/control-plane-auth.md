# Control Plane Auth

Remote Codex control-plane auth supports product accounts while keeping sandbox
and worker authorization separate. Browser product sessions are accepted only by
the control-plane API. Worker access still uses route tokens and router-injected
worker tokens.

## Supported Sign-In Methods

The current implementation supports three product login methods:

- Google OAuth.
- GitHub OAuth.
- Email and password.

Email/password registration currently asks only for an email address and a
password. There is no email verification yet because no email provider is wired
in. A later email provider should add verification, password reset, and account
recovery without changing worker authorization.

## Product Session Tokens

Successful OAuth or email/password login returns a short product session:

```json
{
  "session": {
    "token": "<signed-control-plane-session>",
    "expiresAt": "2026-06-01T00:00:00.000Z"
  }
}
```

The token is an HMAC-signed bearer token whose subject is the durable
`control_users.id`. The control-plane API maps this token to the product user
through the `control-plane:<userId>` identity path. The frontend stores this
session in local storage for the control-plane shell.

Configure the signing secret and TTL with:

```text
CONTROL_PLANE_PRODUCT_SESSION_SECRET=<secret-at-least-16-chars>
CONTROL_PLANE_PRODUCT_SESSION_TTL_SECONDS=1209600
```

If `CONTROL_PLANE_PRODUCT_SESSION_SECRET` is omitted, the control plane falls
back to `CONTROL_PLANE_AUTH_JWT_SECRET` and then `CONTROL_PLANE_JWT_SECRET`.
Production deployments should set an explicit product-session secret.

## Database Records

Product identity is stored in SQLite:

- `control_users` is the durable account row.
- `control_auth_identities` links OAuth/password identities to a user.
- `control_password_credentials` stores normalized email addresses and password
  hashes.

Passwords are stored as scrypt hashes. Plaintext passwords are never persisted.

## OAuth Configuration

Google and GitHub OAuth use the control-plane API as the callback receiver. Set
the public API base URL and frontend base URL:

```text
CONTROL_PLANE_PUBLIC_BASE_URL=https://control.example.com
CONTROL_PLANE_FRONTEND_BASE_URL=https://app.example.com
```

Google:

```text
CONTROL_PLANE_GOOGLE_CLIENT_ID=<google-oauth-client-id>
CONTROL_PLANE_GOOGLE_CLIENT_SECRET=<google-oauth-client-secret>
```

The Google OAuth callback URL is:

```text
https://control.example.com/api/auth/oauth/google/callback
```

GitHub:

```text
CONTROL_PLANE_GITHUB_CLIENT_ID=<github-oauth-client-id>
CONTROL_PLANE_GITHUB_CLIENT_SECRET=<github-oauth-client-secret>
```

The GitHub OAuth callback URL is:

```text
https://control.example.com/api/auth/oauth/github/callback
```

The OAuth start endpoints are:

```text
GET /api/auth/oauth/google/start
GET /api/auth/oauth/github/start
```

The optional `returnTo` query parameter must be on the configured frontend
origin. This prevents the control plane from redirecting a freshly issued
product session token to an arbitrary domain.

## Email And Password Endpoints

```text
POST /api/auth/password/register
POST /api/auth/password/login
```

Register payload:

```json
{
  "email": "user@example.com",
  "password": "correct horse battery staple",
  "displayName": "User"
}
```

`displayName` is optional. The current registration flow intentionally does not
send a verification email.

Login payload:

```json
{
  "email": "user@example.com",
  "password": "correct horse battery staple"
}
```

Both successful endpoints return `{ user, sandbox, session }`.

## Legacy Dev And JWT Modes

Local development auth remains supported:

```text
Authorization: Bearer dev:<subject>
```

or:

```text
X-Auth-Provider: <provider>
X-Auth-Subject: <subject>
```

The generic JWT verifier also remains for staging-style integration with a
separate auth service:

```text
CONTROL_PLANE_AUTH_MODE=dev | jwt
CONTROL_PLANE_AUTH_JWT_SECRET=<secret-for-jwt-mode>
CONTROL_PLANE_AUTH_JWT_PROVIDER=jwt
CONTROL_PLANE_AUTH_JWT_ISSUER=<expected-iss>
CONTROL_PLANE_AUTH_JWT_AUDIENCE=<expected-aud>
CONTROL_PLANE_AUTH_JWT_CLOCK_SKEW_SECONDS=60
```

JWT mode validates signature, time claims, optional issuer, optional audience,
and maps the `sub` claim into `control_users`.

## Local Production-Style Smoke

Use this smoke before staging auth-provider wiring changes:

```bash
pnpm smoke:production-auth
```

The smoke starts a temporary control-plane API in `CONTROL_PLANE_AUTH_MODE=jwt`
with issuer and audience checks enabled. It verifies that a valid
JWT-compatible product-session token is accepted, while expired, wrong-issuer,
and wrong-audience tokens are rejected with `401`.

OAuth provider callbacks are covered by control-plane API tests with mocked
provider token and profile responses. Live Google/GitHub OAuth still needs a
deployed environment with real OAuth client credentials.

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
