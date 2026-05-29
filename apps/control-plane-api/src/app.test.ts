import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSignedToken } from '../../../packages/shared/src/tokens';
import type {
  SandboxManager,
  SandboxProvisionResult,
  SandboxRuntimeResource,
  SandboxStartInput,
} from './adapters';
import { CONTROL_PLANE_LOG_REDACTION_PATHS, buildControlPlaneApp } from './app';

function testEnv(name: string) {
  return {
    NODE_ENV: 'test',
    CONTROL_PLANE_DATABASE_URL: path.join(os.tmpdir(), `remote-codex-control-plane-${name}-${Date.now()}.sqlite`),
    CONTROL_PLANE_JWT_SECRET: 'test-control-plane-secret-key',
    SANDBOX_ROUTER_BASE_URL: 'https://sandbox-gateway.test',
    CONTROL_PLANE_ADMIN_IDENTITIES: 'dev:admin',
  };
}

function testEnvWithInternalService(name: string) {
  return {
    ...testEnv(name),
    CONTROL_PLANE_INTERNAL_SERVICE_TOKEN: 'test-internal-service-token',
  };
}

function decodeTokenHeader(token: string) {
  const [encodedHeader] = token.split('.');
  if (!encodedHeader) {
    throw new Error('Missing token header.');
  }
  const normalized = encodedHeader.replaceAll('-', '+').replaceAll('_', '/');
  const padding = '='.repeat((4 - (normalized.length % 4)) % 4);
  return JSON.parse(Buffer.from(`${normalized}${padding}`, 'base64').toString('utf8')) as {
    kid?: string;
  };
}

class RecordingSandboxManager implements SandboxManager {
  readonly starts: SandboxStartInput[] = [];
  readonly stops: Array<{ sandboxId: string; userId: string }> = [];
  readonly cleanupRequests: Array<{ sandboxId: string; userId?: string | null; reason: string }> = [];
  runtimeResources: SandboxRuntimeResource[] = [];
  statusResult: SandboxProvisionResult = { state: 'running' };
  stopResult: SandboxProvisionResult = { state: 'stopped' };

  async createSandbox(input: SandboxStartInput): Promise<SandboxProvisionResult> {
    return this.startSandbox(input);
  }

  async startSandbox(input: SandboxStartInput): Promise<SandboxProvisionResult> {
    this.starts.push(input);
    return {
      state: 'running',
      routerBaseUrl: 'https://sandbox-gateway.test',
      workerServiceName: `worker-${input.sandboxId}`,
    };
  }

  async stopSandbox(input: { sandboxId: string; userId: string }): Promise<SandboxProvisionResult> {
    this.stops.push(input);
    return this.stopResult;
  }

  async restartSandbox(input: SandboxStartInput): Promise<SandboxProvisionResult> {
    return this.startSandbox(input);
  }

  async deleteSandbox(): Promise<SandboxProvisionResult> {
    return { state: 'deleted' };
  }

  async getSandboxStatus(): Promise<SandboxProvisionResult> {
    return this.statusResult;
  }

  async getSandboxEndpoint() {
    return { routerBaseUrl: 'https://sandbox-gateway.test' };
  }

  async prepareSandboxEnvironment(input: SandboxStartInput) {
    return {
      env: {
        REMOTE_CODEX_SANDBOX_ID: input.sandboxId,
      },
    };
  }

  async listRuntimeResources(): Promise<SandboxRuntimeResource[]> {
    return this.runtimeResources;
  }

  async cleanupRuntimeResource(input: {
    sandboxId: string;
    userId?: string | null;
    reason: string;
  }): Promise<SandboxProvisionResult> {
    this.cleanupRequests.push(input);
    return this.stopResult;
  }
}

describe('control plane api', () => {
  const apps: ReturnType<typeof buildControlPlaneApp>[] = [];

  afterEach(async () => {
    await Promise.all(apps.map((app) => app.close()));
    apps.length = 0;
    vi.unstubAllGlobals();
  });

  it('configures log redaction for gateway credentials', () => {
    expect(CONTROL_PLANE_LOG_REDACTION_PATHS).toEqual(
      expect.arrayContaining([
        'req.headers.authorization',
        'req.headers["x-remote-codex-service-token"]',
        'SANDBOX_WORKER_AUTH_TOKEN',
        'sandboxWorkerAuthToken',
        'LLM_GATEWAY_ADMIN_TOKEN',
        'llmGatewayAdminToken',
        'gatewayKey.keyCiphertext',
        '*.gatewayKey.keyCiphertext',
        '*.keyCiphertext',
      ]),
    );
  });

  it('allows configured browser origins to call the API', async () => {
    const app = buildControlPlaneApp({
      env: {
        ...testEnv('cors'),
        CONTROL_PLANE_CORS_ALLOWED_ORIGINS: 'https://frontend.example.test',
      },
    });
    apps.push(app);

    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/api/me/bootstrap',
      headers: {
        origin: 'https://frontend.example.test',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,content-type',
      },
    });

    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBe(
      'https://frontend.example.test',
    );
    expect(preflight.headers['access-control-allow-methods']).toContain('POST');
    expect(preflight.headers['access-control-allow-headers']).toContain('authorization');

    const response = await app.inject({
      method: 'POST',
      url: '/api/me/bootstrap',
      headers: {
        origin: 'https://frontend.example.test',
        authorization: 'Bearer dev:user-cors',
      },
      payload: {
        email: 'cors@example.com',
        displayName: 'Cors User',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe(
      'https://frontend.example.test',
    );
  });

  it('does not allow unconfigured browser origins', async () => {
    const app = buildControlPlaneApp({
      env: {
        ...testEnv('cors-denied'),
        CONTROL_PLANE_CORS_ALLOWED_ORIGINS: 'https://frontend.example.test',
      },
    });
    apps.push(app);

    const response = await app.inject({
      method: 'OPTIONS',
      url: '/api/me/bootstrap',
      headers: {
        origin: 'https://evil.example.test',
        'access-control-request-method': 'POST',
      },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('bootstraps a user, sandbox, and gateway key', async () => {
    const app = buildControlPlaneApp({ env: testEnv('bootstrap') });
    apps.push(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/me/bootstrap',
      headers: {
        authorization: 'Bearer dev:user-1',
      },
      payload: {
        email: 'user@example.com',
        displayName: 'User One',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.user.authProvider).toBe('dev');
    expect(body.user.authSubject).toBe('user-1');
    expect(body.sandbox.userId).toBe(body.user.id);
    expect(body.sandbox).toMatchObject({
      startupProgress: 0,
      lastFailureCode: null,
      lastFailureMessage: null,
    });
    expect(body.gatewayKey.externalKeyId).toBe(`sub2api-key-${body.sandbox.id}`);
  });

  it('uses configured gateway admin credentials during bootstrap', async () => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init });
      if (String(url).endsWith('/api/admin/users/ensure')) {
        return Response.json({ externalUserId: 'gw-user-from-http' });
      }
      return Response.json({
        externalKeyId: 'gw-key-from-http',
        keyCiphertext: 'encrypted-bootstrap-token',
      });
    }) as typeof fetch;

    try {
      const app = buildControlPlaneApp({
        env: {
          ...testEnv('gateway-http-admin'),
          LLM_GATEWAY_ADMIN_BASE_URL: 'https://gateway-admin.example.test',
          LLM_GATEWAY_ADMIN_TOKEN: 'gateway-admin-token',
        },
      });
      apps.push(app);

      const response = await app.inject({
        method: 'POST',
        url: '/api/me/bootstrap',
        headers: { authorization: 'Bearer dev:http-gateway-user' },
        payload: {
          email: 'http-gateway@example.com',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().gatewayKey.externalKeyId).toBe('gw-key-from-http');
      expect(response.json().gatewayKey.keyCiphertext).toBeNull();
      expect(response.json().gatewayKey.hasEncryptedKey).toBe(true);
      expect(requests.map((request) => request.url)).toEqual([
        'https://gateway-admin.example.test/api/admin/users/ensure',
        'https://gateway-admin.example.test/api/admin/users/gw-user-from-http/keys/ensure',
      ]);
      expect(requests[0]!.init!.headers).toMatchObject({
        authorization: 'Bearer gateway-admin-token',
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('returns stable gateway unavailable errors when gateway provisioning fails', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      Response.json({ message: 'gateway unavailable' }, { status: 503 })) as typeof fetch;

    try {
      const app = buildControlPlaneApp({
        env: {
          ...testEnv('gateway-unavailable'),
          LLM_GATEWAY_ADMIN_BASE_URL: 'https://gateway-admin.example.test',
          LLM_GATEWAY_ADMIN_TOKEN: 'gateway-admin-token',
        },
      });
      apps.push(app);

      const response = await app.inject({
        method: 'POST',
        url: '/api/me/bootstrap',
        headers: { authorization: 'Bearer dev:gateway-unavailable-user' },
        payload: {
          email: 'gateway-unavailable@example.com',
        },
      });

      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({
        code: 'gateway_unavailable',
        message: 'gateway unavailable',
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('stores gateway keys under the configured gateway provider', async () => {
    const app = buildControlPlaneApp({
      env: {
        ...testEnv('gateway-provider'),
        LLM_GATEWAY_PROVIDER: 'custom-compatible',
      },
    });
    apps.push(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/me/bootstrap',
      headers: { authorization: 'Bearer dev:custom-gateway-user' },
      payload: {
        email: 'custom-gateway@example.com',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().gatewayKey).toMatchObject({
      provider: 'custom-compatible',
    });
  });

  it('rotates and revokes gateway keys from admin sandbox APIs', async () => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init });
      const urlText = String(url);
      if (urlText.endsWith('/api/admin/users/ensure')) {
        return Response.json({ externalUserId: 'gw-user-admin' });
      }
      if (urlText.endsWith('/keys/ensure')) {
        return Response.json({ externalKeyId: 'gw-key-original' });
      }
      if (urlText.endsWith('/rotate')) {
        return Response.json({
          externalKeyId: 'gw-key-rotated',
          keyCiphertext: 'encrypted-rotated-token',
        });
      }
      return Response.json({ ok: true });
    }) as typeof fetch;

    try {
      const app = buildControlPlaneApp({
        env: {
          ...testEnv('gateway-admin-rotate-revoke'),
          LLM_GATEWAY_ADMIN_BASE_URL: 'https://gateway-admin.example.test',
          LLM_GATEWAY_ADMIN_TOKEN: 'gateway-admin-token',
        },
      });
      apps.push(app);

      const bootstrap = await app.inject({
        method: 'POST',
        url: '/api/me/bootstrap',
        headers: { authorization: 'Bearer dev:admin' },
        payload: {
          email: 'admin-gateway@example.com',
        },
      });
      expect(bootstrap.statusCode).toBe(200);
      const sandboxId = bootstrap.json().sandbox.id;

      const rotate = await app.inject({
        method: 'POST',
        url: `/api/admin/sandboxes/${sandboxId}/gateway-key/rotate`,
        headers: { authorization: 'Bearer dev:admin' },
      });
      expect(rotate.statusCode).toBe(200);
      expect(rotate.json().gatewayKey).toMatchObject({
        externalKeyId: 'gw-key-rotated',
        keyCiphertext: null,
        hasEncryptedKey: true,
        status: 'active',
        revokedAt: null,
      });
      expect(rotate.json().gatewayKey.rotatedAt).toEqual(expect.any(String));

      const revoke = await app.inject({
        method: 'POST',
        url: `/api/admin/sandboxes/${sandboxId}/gateway-key/revoke`,
        headers: { authorization: 'Bearer dev:admin' },
      });
      expect(revoke.statusCode).toBe(200);
      expect(revoke.json().gatewayKey).toMatchObject({
        externalKeyId: 'gw-key-rotated',
        status: 'revoked',
      });
      expect(revoke.json().gatewayKey.revokedAt).toEqual(expect.any(String));
      expect(requests.map((request) => request.url)).toContain(
        'https://gateway-admin.example.test/api/admin/users/gw-user-admin/keys/gw-key-original/rotate',
      );
      expect(requests.map((request) => request.url)).toContain(
        'https://gateway-admin.example.test/api/admin/users/gw-user-admin/keys/gw-key-rotated/revoke',
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('reconciles gateway keys from the admin sandbox API', async () => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init });
      const urlText = String(url);
      if (urlText.endsWith('/api/admin/users/ensure')) {
        return Response.json({ externalUserId: 'gw-user-reconcile' });
      }
      if (urlText.endsWith('/keys/ensure')) {
        return Response.json({ externalKeyId: 'gw-key-before-reconcile' });
      }
      return Response.json({
        externalKeyId: 'gw-key-reconciled',
        keyCiphertext: 'encrypted-reconciled-token',
      });
    }) as typeof fetch;

    try {
      const app = buildControlPlaneApp({
        env: {
          ...testEnv('gateway-admin-reconcile'),
          LLM_GATEWAY_ADMIN_BASE_URL: 'https://gateway-admin.example.test',
          LLM_GATEWAY_ADMIN_TOKEN: 'gateway-admin-token',
        },
      });
      apps.push(app);

      const bootstrap = await app.inject({
        method: 'POST',
        url: '/api/me/bootstrap',
        headers: { authorization: 'Bearer dev:admin' },
        payload: {
          email: 'admin-gateway-reconcile@example.com',
        },
      });
      expect(bootstrap.statusCode).toBe(200);
      const sandboxId = bootstrap.json().sandbox.id;

      const reconcile = await app.inject({
        method: 'POST',
        url: `/api/admin/sandboxes/${sandboxId}/gateway-key/reconcile`,
        headers: { authorization: 'Bearer dev:admin' },
      });
      expect(reconcile.statusCode).toBe(200);
      expect(reconcile.json().gatewayKey).toMatchObject({
        externalKeyId: 'gw-key-reconciled',
        keyCiphertext: null,
        hasEncryptedKey: true,
        status: 'active',
        revokedAt: null,
      });
      expect(reconcile.json().gatewayKey.rotatedAt).toEqual(expect.any(String));
      expect(requests.map((request) => request.url)).toContain(
        'https://gateway-admin.example.test/api/admin/users/gw-user-reconcile/keys/reconcile',
      );
      const reconcileRequest = requests.find((request) =>
        request.url.endsWith('/keys/reconcile'),
      );
      expect(JSON.parse(String(reconcileRequest!.init!.body))).toMatchObject({
        externalKeyId: 'gw-key-before-reconcile',
        sandboxId,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('attaches gateway credential metadata when starting a sandbox', async () => {
    const sandboxManager = new RecordingSandboxManager();
    const app = buildControlPlaneApp({
      env: {
        ...testEnv('gateway-start'),
        LLM_GATEWAY_BASE_URL: 'https://llm-gateway.example.test',
        LLM_GATEWAY_TOKEN_SECRET_NAME: 'remote-codex-gateway-tokens',
        ELAGENTE_HARNESS_BASE_URL: 'https://harness.example.test',
        ELAGENTE_HARNESS_APP_KEY_SECRET_NAME: 'remote-codex-harness-app-keys',
        REMOTE_CODEX_CHEMISTRY_TOOLS_ENABLED: 'true',
      },
      sandboxManager,
    });
    apps.push(app);

    const auth = { authorization: 'Bearer dev:gateway-start-user' };
    const bootstrap = await app.inject({
      method: 'POST',
      url: '/api/me/bootstrap',
      headers: auth,
      payload: {
        email: 'gateway-start@example.com',
      },
    });
    expect(bootstrap.statusCode).toBe(200);

    const started = await app.inject({
      method: 'POST',
      url: '/api/sandbox/start',
      headers: auth,
    });
    expect(started.statusCode).toBe(200);
    expect(sandboxManager.starts).toHaveLength(1);
    expect(sandboxManager.starts[0]).toMatchObject({
      sandboxId: bootstrap.json().sandbox.id,
      gateway: {
        baseUrl: 'https://llm-gateway.example.test',
        keyId: `sub2api-key-${bootstrap.json().sandbox.id}`,
        tokenSecretName: 'remote-codex-gateway-tokens',
      },
      harness: {
        baseUrl: 'https://harness.example.test',
        appKeySecretName: 'remote-codex-harness-app-keys',
        chemistryToolsEnabled: true,
      },
    });
  });

  it('attaches gateway and harness metadata when restarting a sandbox', async () => {
    const sandboxManager = new RecordingSandboxManager();
    const app = buildControlPlaneApp({
      env: {
        ...testEnv('gateway-restart'),
        LLM_GATEWAY_BASE_URL: 'https://llm-gateway.example.test',
        LLM_GATEWAY_TOKEN_SECRET_NAME: 'remote-codex-gateway-tokens',
        ELAGENTE_HARNESS_BASE_URL: 'https://harness.example.test',
        ELAGENTE_HARNESS_APP_KEY_SECRET_NAME: 'remote-codex-harness-app-keys',
        REMOTE_CODEX_CHEMISTRY_TOOLS_ENABLED: 'true',
      },
      sandboxManager,
    });
    apps.push(app);

    const auth = { authorization: 'Bearer dev:gateway-restart-user' };
    const bootstrap = await app.inject({
      method: 'POST',
      url: '/api/me/bootstrap',
      headers: auth,
      payload: {
        email: 'gateway-restart@example.com',
      },
    });
    expect(bootstrap.statusCode).toBe(200);

    const restarted = await app.inject({
      method: 'POST',
      url: '/api/sandbox/restart',
      headers: auth,
    });
    expect(restarted.statusCode).toBe(200);
    expect(sandboxManager.starts).toHaveLength(1);
    expect(sandboxManager.starts[0]).toMatchObject({
      sandboxId: bootstrap.json().sandbox.id,
      gateway: {
        baseUrl: 'https://llm-gateway.example.test',
        keyId: `sub2api-key-${bootstrap.json().sandbox.id}`,
        tokenSecretName: 'remote-codex-gateway-tokens',
      },
      harness: {
        baseUrl: 'https://harness.example.test',
        appKeySecretName: 'remote-codex-harness-app-keys',
        chemistryToolsEnabled: true,
      },
    });
  });

  it('keeps account bootstrap idempotent for the authenticated identity', async () => {
    const app = buildControlPlaneApp({ env: testEnv('bootstrap-idempotent') });
    apps.push(app);

    const auth = { authorization: 'Bearer dev:idempotent-user' };
    const first = await app.inject({
      method: 'POST',
      url: '/api/me/bootstrap',
      headers: auth,
      payload: {
        email: 'first@example.com',
        displayName: 'First Name',
      },
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: 'POST',
      url: '/api/me/bootstrap',
      headers: auth,
      payload: {
        email: 'second@example.com',
        displayName: 'Second Name',
      },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().user.id).toBe(first.json().user.id);
    expect(second.json().sandbox.id).toBe(first.json().sandbox.id);
    expect(second.json().gatewayKey.id).toBe(first.json().gatewayKey.id);
    expect(second.json().user).toMatchObject({
      email: 'second@example.com',
      displayName: 'Second Name',
    });
  });

  it('registers the authenticated identity only', async () => {
    const app = buildControlPlaneApp({ env: testEnv('register') });
    apps.push(app);

    const unauthenticated = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: 'register@example.com',
      },
    });
    expect(unauthenticated.statusCode).toBe(401);

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      headers: {
        authorization: 'Bearer dev:register-user',
      },
      payload: {
        email: 'register@example.com',
        displayName: 'Register User',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().user).toMatchObject({
      authProvider: 'dev',
      authSubject: 'register-user',
      email: 'register@example.com',
    });
  });

  it('registers and logs in with email and password session tokens', async () => {
    const app = buildControlPlaneApp({ env: testEnv('password-auth') });
    apps.push(app);

    const registered = await app.inject({
      method: 'POST',
      url: '/api/auth/password/register',
      payload: {
        email: 'Password.User@Example.com',
        password: 'correct-horse-battery-staple',
        displayName: 'Password User',
      },
    });

    expect(registered.statusCode).toBe(200);
    expect(registered.json().user).toMatchObject({
      authProvider: 'password',
      authSubject: 'password.user@example.com',
      email: 'password.user@example.com',
      displayName: 'Password User',
    });
    expect(registered.json().session.token).toEqual(expect.any(String));

    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/auth/password/register',
      payload: {
        email: 'password.user@example.com',
        password: 'correct-horse-battery-staple',
      },
    });
    expect(duplicate.statusCode).toBe(409);

    const rejected = await app.inject({
      method: 'POST',
      url: '/api/auth/password/login',
      payload: {
        email: 'password.user@example.com',
        password: 'wrong-password',
      },
    });
    expect(rejected.statusCode).toBe(401);

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/password/login',
      payload: {
        email: 'password.user@example.com',
        password: 'correct-horse-battery-staple',
      },
    });
    expect(login.statusCode).toBe(200);
    const token = login.json().session.token;

    const me = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.email).toBe('password.user@example.com');
  });

  it('starts google and github oauth flows with provider callbacks', async () => {
    const app = buildControlPlaneApp({
      env: {
        ...testEnv('oauth-start'),
        CONTROL_PLANE_PUBLIC_BASE_URL: 'https://control.example.test',
        CONTROL_PLANE_FRONTEND_BASE_URL: 'https://frontend.example.test',
        CONTROL_PLANE_GOOGLE_CLIENT_ID: 'google-client',
        CONTROL_PLANE_GOOGLE_CLIENT_SECRET: 'google-secret',
        CONTROL_PLANE_GITHUB_CLIENT_ID: 'github-client',
        CONTROL_PLANE_GITHUB_CLIENT_SECRET: 'github-secret',
      },
    });
    apps.push(app);

    const google = await app.inject({
      method: 'GET',
      url: '/api/auth/oauth/google/start',
    });
    expect(google.statusCode).toBe(302);
    const googleUrl = new URL(google.headers.location as string);
    expect(googleUrl.origin + googleUrl.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(googleUrl.searchParams.get('client_id')).toBe('google-client');
    expect(googleUrl.searchParams.get('scope')).toContain('openid');
    expect(googleUrl.searchParams.get('redirect_uri')).toBe(
      'https://control.example.test/api/auth/oauth/google/callback',
    );

    const github = await app.inject({
      method: 'GET',
      url: '/api/auth/oauth/github/start',
    });
    expect(github.statusCode).toBe(302);
    const githubUrl = new URL(github.headers.location as string);
    expect(githubUrl.origin + githubUrl.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(githubUrl.searchParams.get('client_id')).toBe('github-client');
    expect(githubUrl.searchParams.get('scope')).toContain('user:email');
    expect(githubUrl.searchParams.get('redirect_uri')).toBe(
      'https://control.example.test/api/auth/oauth/github/callback',
    );
  });

  it('rejects oauth return urls outside the configured frontend origin', async () => {
    const app = buildControlPlaneApp({
      env: {
        ...testEnv('oauth-return-origin'),
        CONTROL_PLANE_PUBLIC_BASE_URL: 'https://control.example.test',
        CONTROL_PLANE_FRONTEND_BASE_URL: 'https://frontend.example.test',
        CONTROL_PLANE_GOOGLE_CLIENT_ID: 'google-client',
        CONTROL_PLANE_GOOGLE_CLIENT_SECRET: 'google-secret',
      },
    });
    apps.push(app);

    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/oauth/google/start?returnTo=https%3A%2F%2Fevil.example.test%2Fcallback',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: 'bad_request',
      message: 'OAuth return URL is not allowed.',
    });
  });

  it('completes google oauth callback, stores identity, and issues a product session', async () => {
    const app = buildControlPlaneApp({
      env: {
        ...testEnv('oauth-google-callback'),
        CONTROL_PLANE_PUBLIC_BASE_URL: 'https://control.example.test',
        CONTROL_PLANE_FRONTEND_BASE_URL: 'https://frontend.example.test',
        CONTROL_PLANE_GOOGLE_CLIENT_ID: 'google-client',
        CONTROL_PLANE_GOOGLE_CLIENT_SECRET: 'google-secret',
      },
    });
    apps.push(app);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === 'https://oauth2.googleapis.com/token') {
          return Response.json({ access_token: 'google-access-token' });
        }
        if (url === 'https://openidconnect.googleapis.com/v1/userinfo') {
          return Response.json({
            sub: 'google-user-1',
            email: 'Google.User@Example.com',
            name: 'Google User',
          });
        }
        return Response.json({ message: `Unhandled ${url}` }, { status: 404 });
      }),
    );

    const start = await app.inject({
      method: 'GET',
      url: '/api/auth/oauth/google/start?returnTo=https%3A%2F%2Ffrontend.example.test%2Fcontrol-plane%2Flogin',
    });
    const startUrl = new URL(start.headers.location as string);
    const callback = await app.inject({
      method: 'GET',
      url: `/api/auth/oauth/google/callback?code=google-code&state=${encodeURIComponent(startUrl.searchParams.get('state') ?? '')}`,
    });

    expect(callback.statusCode).toBe(302);
    const redirectUrl = new URL(callback.headers.location as string);
    expect(redirectUrl.origin + redirectUrl.pathname).toBe(
      'https://frontend.example.test/control-plane/login',
    );
    expect(redirectUrl.searchParams.get('control_plane_base_url')).toBe('https://control.example.test');
    const token = redirectUrl.searchParams.get('control_plane_token');
    expect(token).toEqual(expect.any(String));

    const me = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().user).toMatchObject({
      authProvider: 'google',
      authSubject: 'google-user-1',
      email: 'google.user@example.com',
      displayName: 'Google User',
    });
  });

  it('completes github oauth callback using verified email fallback', async () => {
    const app = buildControlPlaneApp({
      env: {
        ...testEnv('oauth-github-callback'),
        CONTROL_PLANE_PUBLIC_BASE_URL: 'https://control.example.test',
        CONTROL_PLANE_FRONTEND_BASE_URL: 'https://frontend.example.test',
        CONTROL_PLANE_GITHUB_CLIENT_ID: 'github-client',
        CONTROL_PLANE_GITHUB_CLIENT_SECRET: 'github-secret',
      },
    });
    apps.push(app);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === 'https://github.com/login/oauth/access_token') {
          return Response.json({ access_token: 'github-access-token' });
        }
        if (url === 'https://api.github.com/user') {
          return Response.json({
            id: 12345,
            login: 'github-user',
            name: 'GitHub User',
            email: null,
          });
        }
        if (url === 'https://api.github.com/user/emails') {
          return Response.json([
            {
              email: 'github.user@example.com',
              primary: true,
              verified: true,
            },
          ]);
        }
        return Response.json({ message: `Unhandled ${url}` }, { status: 404 });
      }),
    );

    const start = await app.inject({
      method: 'GET',
      url: '/api/auth/oauth/github/start',
    });
    const startUrl = new URL(start.headers.location as string);
    const callback = await app.inject({
      method: 'GET',
      url: `/api/auth/oauth/github/callback?code=github-code&state=${encodeURIComponent(startUrl.searchParams.get('state') ?? '')}`,
    });

    expect(callback.statusCode).toBe(302);
    const redirectUrl = new URL(callback.headers.location as string);
    const token = redirectUrl.searchParams.get('control_plane_token');
    expect(token).toEqual(expect.any(String));

    const me = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().user).toMatchObject({
      authProvider: 'github',
      authSubject: '12345',
      email: 'github.user@example.com',
      displayName: 'GitHub User',
    });
  });

  it('manages a sandbox, workspaces, sessions, and route tokens', async () => {
    const app = buildControlPlaneApp({ env: testEnv('route-token') });
    apps.push(app);

    const auth = { authorization: 'Bearer dev:user-2' };
    const bootstrap = await app.inject({
      method: 'POST',
      url: '/api/me/bootstrap',
      headers: auth,
      payload: {
        email: 'route@example.com',
      },
    });
    const user = bootstrap.json().user;
    const sandbox = bootstrap.json().sandbox;

    const start = await app.inject({
      method: 'POST',
      url: '/api/sandbox/start',
      headers: auth,
    });
    expect(start.statusCode).toBe(200);
    expect(start.json().sandbox.state).toBe('running');

    const projectResponse = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: auth,
      payload: {
        name: 'Project A',
        slug: 'project-a',
      },
    });
    expect(projectResponse.statusCode).toBe(200);
    const project = projectResponse.json().project;

    const workspaceResponse = await app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/workspaces`,
      headers: auth,
      payload: {
        name: 'Workspace A',
        slug: 'workspace-a',
      },
    });
    expect(workspaceResponse.statusCode).toBe(200);
    const workspace = workspaceResponse.json().workspace;
    expect(workspace.projectId).toBe(project.id);
    expect(workspace.path).toBe('/workspace/workspace-a');

    const duplicateWorkspaceResponse = await app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/workspaces`,
      headers: auth,
      payload: {
        name: 'Workspace A Again',
        slug: 'workspace-a',
      },
    });
    expect(duplicateWorkspaceResponse.statusCode).toBe(409);
    expect(duplicateWorkspaceResponse.json()).toMatchObject({
      code: 'workspace_slug_conflict',
      message: 'A workspace with this slug already exists for this sandbox.',
    });

    const sessionResponse = await app.inject({
      method: 'POST',
      url: `/api/workspaces/${workspace.id}/sessions`,
      headers: auth,
      payload: {
        provider: 'codex',
        title: 'Implement control plane',
      },
    });
    expect(sessionResponse.statusCode).toBe(200);
    const session = sessionResponse.json().session;
    expect(session.workspaceId).toBe(workspace.id);

    const tokenResponse = await app.inject({
      method: 'POST',
      url: `/api/sandboxes/${sandbox.id}/route-token`,
      headers: auth,
      payload: {
        projectId: project.id,
        workspaceId: workspace.id,
        sessionId: session.id,
        scopes: ['worker:read', 'worker:write', 'session:prompt'],
      },
    });
    expect(tokenResponse.statusCode).toBe(200);
    const route = tokenResponse.json();
    expect(route.routerBaseUrl).toBe('https://sandbox-gateway.test');
    expect(route.wsBaseUrl).toBe('wss://sandbox-gateway.test');
    expect(decodeTokenHeader(route.token).kid).toBe('current');

    const verify = await app.inject({
      method: 'GET',
      url: `/api/route-token/verify?token=${encodeURIComponent(route.token)}`,
    });
    expect(verify.statusCode).toBe(200);
    expect(verify.json().payload).toMatchObject({
      sub: user.id,
      sandbox_id: sandbox.id,
      project_id: project.id,
      workspace_id: workspace.id,
      session_id: session.id,
      scopes: ['worker:read', 'worker:write', 'session:prompt'],
    });

    const expiredToken = createSignedToken(
      {
        sub: user.id,
        sandbox_id: sandbox.id,
        scopes: ['worker:read'],
        iat: 1,
        exp: 2,
        jti: 'expired',
      },
      'test-control-plane-secret-key',
    );
    const expiredVerify = await app.inject({
      method: 'GET',
      url: `/api/route-token/verify?token=${encodeURIComponent(expiredToken)}`,
    });
    expect(expiredVerify.statusCode).toBe(401);

    const tamperedVerify = await app.inject({
      method: 'GET',
      url: `/api/route-token/verify?token=${encodeURIComponent(`${route.token}x`)}`,
    });
    expect(tamperedVerify.statusCode).toBe(401);
  });

  it('refuses route tokens when project, workspace, and session scopes do not match', async () => {
    const app = buildControlPlaneApp({ env: testEnv('route-token-scope-mismatch') });
    apps.push(app);

    const auth = { authorization: 'Bearer dev:scope-user' };
    const bootstrap = await app.inject({
      method: 'POST',
      url: '/api/me/bootstrap',
      headers: auth,
      payload: {
        email: 'scope@example.com',
      },
    });
    const sandbox = bootstrap.json().sandbox;
    await app.inject({
      method: 'POST',
      url: '/api/sandbox/start',
      headers: auth,
    });

    const projectA = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: auth,
      payload: {
        name: 'Project A',
        slug: 'project-a',
      },
    });
    const projectB = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: auth,
      payload: {
        name: 'Project B',
        slug: 'project-b',
      },
    });

    const workspaceA = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectA.json().project.id}/workspaces`,
      headers: auth,
      payload: {
        name: 'Workspace A',
        slug: 'workspace-a',
      },
    });
    const workspaceB = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectB.json().project.id}/workspaces`,
      headers: auth,
      payload: {
        name: 'Workspace B',
        slug: 'workspace-b',
      },
    });

    const sessionA = await app.inject({
      method: 'POST',
      url: `/api/workspaces/${workspaceA.json().workspace.id}/sessions`,
      headers: auth,
      payload: {
        provider: 'codex',
        title: 'Session A',
      },
    });

    const wrongProject = await app.inject({
      method: 'POST',
      url: `/api/sandboxes/${sandbox.id}/route-token`,
      headers: auth,
      payload: {
        projectId: projectB.json().project.id,
        workspaceId: workspaceA.json().workspace.id,
        sessionId: sessionA.json().session.id,
      },
    });
    expect(wrongProject.statusCode).toBe(404);
    expect(wrongProject.json().message).toBe('Workspace not found.');

    const wrongWorkspace = await app.inject({
      method: 'POST',
      url: `/api/sandboxes/${sandbox.id}/route-token`,
      headers: auth,
      payload: {
        projectId: projectA.json().project.id,
        workspaceId: workspaceB.json().workspace.id,
        sessionId: sessionA.json().session.id,
      },
    });
    expect(wrongWorkspace.statusCode).toBe(404);
    expect(wrongWorkspace.json().message).toBe('Workspace not found.');
  });

  it('supports route-token signing key rotation', async () => {
    const app = buildControlPlaneApp({
      env: {
        ...testEnv('route-token-rotation'),
        CONTROL_PLANE_JWT_SECRET_ID: 'key-2026-05',
        CONTROL_PLANE_JWT_SECRET: 'current-route-token-secret',
        CONTROL_PLANE_JWT_PREVIOUS_SECRETS: 'key-2026-04:previous-route-token-secret',
      },
    });
    apps.push(app);

    const auth = { authorization: 'Bearer dev:rotation-user' };
    const bootstrap = await app.inject({
      method: 'POST',
      url: '/api/me/bootstrap',
      headers: auth,
      payload: {
        email: 'rotation@example.com',
      },
    });
    const sandbox = bootstrap.json().sandbox;
    await app.inject({
      method: 'POST',
      url: '/api/sandbox/start',
      headers: auth,
    });

    const route = await app.inject({
      method: 'POST',
      url: `/api/sandboxes/${sandbox.id}/route-token`,
      headers: auth,
      payload: {
        scopes: ['worker:read'],
      },
    });
    expect(route.statusCode).toBe(200);
    expect(decodeTokenHeader(route.json().token).kid).toBe('key-2026-05');

    const previousToken = createSignedToken(
      {
        sub: bootstrap.json().user.id,
        sandbox_id: sandbox.id,
        scopes: ['worker:read'],
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 60,
        jti: 'previous-key-token',
      },
      'previous-route-token-secret',
      { kid: 'key-2026-04' },
    );
    const previousVerify = await app.inject({
      method: 'GET',
      url: `/api/route-token/verify?token=${encodeURIComponent(previousToken)}`,
    });
    expect(previousVerify.statusCode).toBe(200);

    const unknownKeyToken = createSignedToken(
      {
        sub: bootstrap.json().user.id,
        sandbox_id: sandbox.id,
        scopes: ['worker:read'],
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 60,
        jti: 'unknown-key-token',
      },
      'unknown-route-token-secret',
      { kid: 'unknown-key' },
    );
    const unknownKeyVerify = await app.inject({
      method: 'GET',
      url: `/api/route-token/verify?token=${encodeURIComponent(unknownKeyToken)}`,
    });
    expect(unknownKeyVerify.statusCode).toBe(401);
  });

  it('exposes running sandbox worker endpoints to internal router services only', async () => {
    const app = buildControlPlaneApp({
      env: {
        ...testEnv('internal-sandbox-endpoint'),
        CONTROL_PLANE_INTERNAL_SERVICE_TOKEN: 'internal-router-service-token',
        SANDBOX_WORKER_INTERNAL_PORT: '8788',
      },
    });
    apps.push(app);

    const auth = { authorization: 'Bearer dev:internal-endpoint-user' };
    const bootstrap = await app.inject({
      method: 'POST',
      url: '/api/me/bootstrap',
      headers: auth,
      payload: {
        email: 'internal-endpoint@example.com',
      },
    });
    const { user, sandbox } = bootstrap.json();

    const unauthenticated = await app.inject({
      method: 'GET',
      url: `/api/internal/sandboxes/${sandbox.id}/endpoint?userId=${user.id}`,
    });
    expect(unauthenticated.statusCode).toBe(403);

    const stopped = await app.inject({
      method: 'GET',
      url: `/api/internal/sandboxes/${sandbox.id}/endpoint?userId=${user.id}`,
      headers: {
        'x-remote-codex-service-token': 'internal-router-service-token',
      },
    });
    expect(stopped.statusCode).toBe(409);

    await app.inject({
      method: 'POST',
      url: '/api/sandbox/start',
      headers: auth,
    });

    const endpoint = await app.inject({
      method: 'GET',
      url: `/api/internal/sandboxes/${sandbox.id}/endpoint?userId=${user.id}`,
      headers: {
        'x-remote-codex-service-token': 'internal-router-service-token',
      },
    });
    expect(endpoint.statusCode).toBe(200);
    expect(endpoint.json()).toMatchObject({
      sandboxId: sandbox.id,
      userId: user.id,
      workerBaseUrl: `http://sandbox-worker-${sandbox.id}.remote-codex-sandboxes.svc.cluster.local:8788`,
    });
  });

  it('manages projects, project workspaces, session metadata, restart, and health', async () => {
    const app = buildControlPlaneApp({ env: testEnv('projects') });
    apps.push(app);

    const auth = { authorization: 'Bearer dev:project-user' };
    await app.inject({
      method: 'POST',
      url: '/api/me/bootstrap',
      headers: auth,
      payload: {
        email: 'project@example.com',
        displayName: 'Project User',
      },
    });

    const projectResponse = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: auth,
      payload: {
        name: 'Chemistry Project',
        slug: 'chemistry-project',
      },
    });
    expect(projectResponse.statusCode).toBe(200);
    const project = projectResponse.json().project;
    expect(project.status).toBe('active');

    const projectList = await app.inject({
      method: 'GET',
      url: '/api/projects',
      headers: auth,
    });
    expect(projectList.json().projects).toHaveLength(1);

    const patchedProject = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${project.id}`,
      headers: auth,
      payload: {
        name: 'Renamed Chemistry Project',
      },
    });
    expect(patchedProject.statusCode).toBe(200);
    expect(patchedProject.json().project.name).toBe('Renamed Chemistry Project');

    const workspaceResponse = await app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/workspaces`,
      headers: auth,
      payload: {
        name: 'ORCA Workspace',
        slug: 'orca-workspace',
      },
    });
    expect(workspaceResponse.statusCode).toBe(200);
    const workspace = workspaceResponse.json().workspace;
    expect(workspace.projectId).toBe(project.id);

    const projectWorkspaces = await app.inject({
      method: 'GET',
      url: `/api/projects/${project.id}/workspaces`,
      headers: auth,
    });
    expect(projectWorkspaces.json().workspaces).toHaveLength(1);

    const patchedWorkspace = await app.inject({
      method: 'PATCH',
      url: `/api/workspaces/${workspace.id}`,
      headers: auth,
      payload: {
        name: 'Renamed ORCA Workspace',
        status: 'active',
      },
    });
    expect(patchedWorkspace.statusCode).toBe(200);
    expect(patchedWorkspace.json().workspace).toMatchObject({
      name: 'Renamed ORCA Workspace',
      status: 'active',
    });

    const sessionResponse = await app.inject({
      method: 'POST',
      url: `/api/workspaces/${workspace.id}/sessions`,
      headers: auth,
      payload: {
        provider: 'claude',
        title: 'Optimize molecule',
      },
    });
    expect(sessionResponse.statusCode).toBe(200);
    const session = sessionResponse.json().session;

    const patchedSession = await app.inject({
      method: 'PATCH',
      url: `/api/sessions/${session.id}`,
      headers: auth,
      payload: {
        title: 'Optimize molecule with ORCA',
        status: 'active',
        workerSessionId: 'worker-session-1',
      },
    });
    expect(patchedSession.statusCode).toBe(200);
    expect(patchedSession.json().session).toMatchObject({
      title: 'Optimize molecule with ORCA',
      status: 'active',
      workerSessionId: 'worker-session-1',
    });

    const start = await app.inject({
      method: 'POST',
      url: '/api/sandbox/start',
      headers: auth,
    });
    expect(start.statusCode).toBe(200);

    const health = await app.inject({
      method: 'GET',
      url: '/api/sandbox/health',
      headers: auth,
    });
    expect(health.statusCode).toBe(200);
    expect(health.json().status.state).toBe('running');

    const restart = await app.inject({
      method: 'POST',
      url: '/api/sandbox/restart',
      headers: auth,
    });
    expect(restart.statusCode).toBe(200);
    expect(restart.json().sandbox.state).toBe('running');

    const archived = await app.inject({
      method: 'DELETE',
      url: `/api/projects/${project.id}`,
      headers: auth,
    });
    expect(archived.statusCode).toBe(200);
    expect(archived.json().project.status).toBe('archived');

    const archivedWorkspace = await app.inject({
      method: 'PATCH',
      url: `/api/workspaces/${workspace.id}`,
      headers: auth,
      payload: {
        status: 'archived',
      },
    });
    expect(archivedWorkspace.statusCode).toBe(200);
    expect(archivedWorkspace.json().workspace.status).toBe('archived');

    const archivedSession = await app.inject({
      method: 'PATCH',
      url: `/api/sessions/${session.id}`,
      headers: auth,
      payload: {
        status: 'archived',
      },
    });
    expect(archivedSession.statusCode).toBe(200);
    expect(archivedSession.json().session.status).toBe('archived');
  });

  it('closes and resumes control-plane sessions through the worker session API', async () => {
    const workerRequests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      workerRequests.push({ url: String(url), init });
      return Response.json({
        thread: {
          id: 'worker-session-1',
          isLoaded: String(url).endsWith('/resume'),
        },
      });
    }) as typeof fetch;

    try {
      const app = buildControlPlaneApp({
        env: {
          ...testEnv('session-lifecycle-worker'),
          SANDBOX_WORKER_AUTH_TOKEN: 'internal-worker-session-token',
        },
      });
      apps.push(app);

      const auth = { authorization: 'Bearer dev:session-owner' };
      await app.inject({
        method: 'POST',
        url: '/api/me/bootstrap',
        headers: auth,
        payload: {
          email: 'session-owner@example.com',
        },
      });

      const projectResponse = await app.inject({
        method: 'POST',
        url: '/api/projects',
        headers: auth,
        payload: {
          name: 'Lifecycle Project',
          slug: 'lifecycle-project',
        },
      });
      const workspaceResponse = await app.inject({
        method: 'POST',
        url: `/api/projects/${projectResponse.json().project.id}/workspaces`,
        headers: auth,
        payload: {
          name: 'Lifecycle Workspace',
          slug: 'lifecycle-workspace',
        },
      });
      const sessionResponse = await app.inject({
        method: 'POST',
        url: `/api/workspaces/${workspaceResponse.json().workspace.id}/sessions`,
        headers: auth,
        payload: {
          provider: 'codex',
          title: 'Lifecycle Session',
        },
      });
      const session = sessionResponse.json().session;

      await app.inject({
        method: 'POST',
        url: '/api/sandbox/start',
        headers: auth,
      });
      await app.inject({
        method: 'PATCH',
        url: `/api/sessions/${session.id}`,
        headers: auth,
        payload: {
          status: 'active',
          workerSessionId: 'worker-session-1',
        },
      });

      const close = await app.inject({
        method: 'POST',
        url: `/api/sessions/${session.id}/close`,
        headers: auth,
      });
      expect(close.statusCode).toBe(200);
      expect(close.json().session).toMatchObject({
        id: session.id,
        status: 'idle',
        workerSessionId: 'worker-session-1',
      });

      const resume = await app.inject({
        method: 'POST',
        url: `/api/sessions/${session.id}/resume`,
        headers: auth,
      });
      expect(resume.statusCode).toBe(200);
      expect(resume.json().session).toMatchObject({
        id: session.id,
        status: 'active',
        workerSessionId: 'worker-session-1',
      });

      expect(workerRequests.map((request) => request.url)).toEqual([
        `http://sandbox-worker-${app.services.repository.getSandboxByUserId(close.json().session.userId)!.id}.remote-codex-sandboxes.svc.cluster.local:8787/api/threads/worker-session-1/disconnect`,
        `http://sandbox-worker-${app.services.repository.getSandboxByUserId(close.json().session.userId)!.id}.remote-codex-sandboxes.svc.cluster.local:8787/api/threads/worker-session-1/resume`,
      ]);
      for (const request of workerRequests) {
        const headers = new Headers(request.init?.headers);
        expect(headers.get('x-remote-codex-worker-token')).toBe('internal-worker-session-token');
        expect(headers.get('authorization')).toBeNull();
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('paginates project, workspace, and session lists', async () => {
    const app = buildControlPlaneApp({ env: testEnv('product-list-pagination') });
    apps.push(app);

    const auth = { authorization: 'Bearer dev:pagination-user' };
    await app.inject({
      method: 'POST',
      url: '/api/me/bootstrap',
      headers: auth,
      payload: {
        email: 'pagination@example.com',
      },
    });

    const projects = [];
    for (const index of [1, 2, 3]) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/projects',
        headers: auth,
        payload: {
          name: `Project ${index}`,
          slug: `project-${index}`,
        },
      });
      expect(response.statusCode).toBe(200);
      projects.push(response.json().project);
    }

    const projectPage = await app.inject({
      method: 'GET',
      url: '/api/projects?limit=2&offset=1',
      headers: auth,
    });
    expect(projectPage.statusCode).toBe(200);
    expect(projectPage.json().projects).toHaveLength(2);
    expect(projectPage.json().page).toEqual({
      limit: 2,
      offset: 1,
      total: 3,
      hasMore: false,
    });

    const archivedProject = await app.inject({
      method: 'DELETE',
      url: `/api/projects/${projects[1].id}`,
      headers: auth,
    });
    expect(archivedProject.statusCode).toBe(200);

    const filteredProjects = await app.inject({
      method: 'GET',
      url: '/api/projects?search=Project%202&status=archived',
      headers: auth,
    });
    expect(filteredProjects.statusCode).toBe(200);
    expect(filteredProjects.json().projects).toHaveLength(1);
    expect(filteredProjects.json().projects[0]).toMatchObject({
      id: projects[1].id,
      status: 'archived',
    });

    const workspaces = [];
    for (const index of [1, 2, 3]) {
      const response = await app.inject({
        method: 'POST',
        url: `/api/projects/${projects[0].id}/workspaces`,
        headers: auth,
        payload: {
          name: `Workspace ${index}`,
          slug: `workspace-${index}`,
        },
      });
      expect(response.statusCode).toBe(200);
      workspaces.push(response.json().workspace);
    }

    const workspacePage = await app.inject({
      method: 'GET',
      url: `/api/projects/${projects[0].id}/workspaces?limit=1&offset=1`,
      headers: auth,
    });
    expect(workspacePage.statusCode).toBe(200);
    expect(workspacePage.json().workspaces).toHaveLength(1);
    expect(workspacePage.json().page).toEqual({
      limit: 1,
      offset: 1,
      total: 3,
      hasMore: true,
    });

    const globalWorkspacePage = await app.inject({
      method: 'GET',
      url: `/api/workspaces?projectId=${projects[0].id}&limit=2&offset=2`,
      headers: auth,
    });
    expect(globalWorkspacePage.statusCode).toBe(200);
    expect(globalWorkspacePage.json().workspaces).toHaveLength(1);
    expect(globalWorkspacePage.json().page).toEqual({
      limit: 2,
      offset: 2,
      total: 3,
      hasMore: false,
    });

    const archivedWorkspace = await app.inject({
      method: 'PATCH',
      url: `/api/workspaces/${workspaces[1].id}`,
      headers: auth,
      payload: {
        status: 'archived',
      },
    });
    expect(archivedWorkspace.statusCode).toBe(200);

    const filteredWorkspaces = await app.inject({
      method: 'GET',
      url: `/api/projects/${projects[0].id}/workspaces?search=Workspace%202&status=archived`,
      headers: auth,
    });
    expect(filteredWorkspaces.statusCode).toBe(200);
    expect(filteredWorkspaces.json().workspaces).toHaveLength(1);
    expect(filteredWorkspaces.json().workspaces[0]).toMatchObject({
      id: workspaces[1].id,
      status: 'archived',
    });

    const sessions = [];
    for (const index of [1, 2, 3]) {
      const response = await app.inject({
        method: 'POST',
        url: `/api/workspaces/${workspaces[0].id}/sessions`,
        headers: auth,
        payload: {
          provider: index === 2 ? 'claude' : 'codex',
          title: `Session ${index}`,
        },
      });
      expect(response.statusCode).toBe(200);
      sessions.push(response.json().session);
    }

    const sessionPage = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${workspaces[0].id}/sessions?limit=2&offset=0`,
      headers: auth,
    });
    expect(sessionPage.statusCode).toBe(200);
    expect(sessionPage.json().sessions).toHaveLength(2);
    expect(sessionPage.json().page).toEqual({
      limit: 2,
      offset: 0,
      total: 3,
      hasMore: true,
    });

    const activeSession = await app.inject({
      method: 'PATCH',
      url: `/api/sessions/${sessions[1].id}`,
      headers: auth,
      payload: {
        status: 'active',
      },
    });
    expect(activeSession.statusCode).toBe(200);

    const filteredSessions = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${workspaces[0].id}/sessions?search=Session%202&status=active&provider=claude`,
      headers: auth,
    });
    expect(filteredSessions.statusCode).toBe(200);
    expect(filteredSessions.json().sessions).toHaveLength(1);
    expect(filteredSessions.json().sessions[0]).toMatchObject({
      id: sessions[1].id,
      provider: 'claude',
      status: 'active',
    });
  });

  it('prevents cross-user access to projects, workspaces, sessions, and route token resources', async () => {
    const app = buildControlPlaneApp({ env: testEnv('ownership') });
    apps.push(app);

    const ownerAuth = { authorization: 'Bearer dev:owner' };
    const otherAuth = { authorization: 'Bearer dev:other' };
    await app.inject({
      method: 'POST',
      url: '/api/me/bootstrap',
      headers: ownerAuth,
      payload: { email: 'owner@example.com' },
    });
    await app.inject({
      method: 'POST',
      url: '/api/me/bootstrap',
      headers: otherAuth,
      payload: { email: 'other@example.com' },
    });

    const project = (await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: ownerAuth,
      payload: { name: 'Private Project', slug: 'private-project' },
    })).json().project;
    const workspace = (await app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/workspaces`,
      headers: ownerAuth,
      payload: { name: 'Private Workspace', slug: 'private-workspace' },
    })).json().workspace;
    const session = (await app.inject({
      method: 'POST',
      url: `/api/workspaces/${workspace.id}/sessions`,
      headers: ownerAuth,
      payload: { provider: 'codex', title: 'Private Session' },
    })).json().session;

    const projectRead = await app.inject({
      method: 'GET',
      url: `/api/projects/${project.id}`,
      headers: otherAuth,
    });
    expect(projectRead.statusCode).toBe(404);

    const workspacePatch = await app.inject({
      method: 'PATCH',
      url: `/api/workspaces/${workspace.id}`,
      headers: otherAuth,
      payload: { name: 'stolen' },
    });
    expect(workspacePatch.statusCode).toBe(404);

    const sessionPatch = await app.inject({
      method: 'PATCH',
      url: `/api/sessions/${session.id}`,
      headers: otherAuth,
      payload: { title: 'stolen' },
    });
    expect(sessionPatch.statusCode).toBe(404);

    const otherSandbox = (await app.inject({
      method: 'POST',
      url: '/api/sandbox/start',
      headers: otherAuth,
    })).json().sandbox;
    const badRouteToken = await app.inject({
      method: 'POST',
      url: `/api/sandboxes/${otherSandbox.id}/route-token`,
      headers: otherAuth,
      payload: {
        workspaceId: workspace.id,
        sessionId: session.id,
      },
    });
    expect(badRouteToken.statusCode).toBe(404);
  });

  it('accepts internal worker session checkpoints and audits sync failures', async () => {
    const app = buildControlPlaneApp({ env: testEnvWithInternalService('session-checkpoint') });
    apps.push(app);

    const auth = { authorization: 'Bearer dev:checkpoint-user' };
    const bootstrap = await app.inject({
      method: 'POST',
      url: '/api/me/bootstrap',
      headers: auth,
      payload: {
        email: 'checkpoint@example.com',
      },
    });
    expect(bootstrap.statusCode).toBe(200);
    const { user, sandbox } = bootstrap.json();

    const workspaceResponse = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      headers: auth,
      payload: {
        name: 'Checkpoint Workspace',
        slug: 'checkpoint-workspace',
      },
    });
    expect(workspaceResponse.statusCode).toBe(200);
    const workspace = workspaceResponse.json().workspace;

    const sessionResponse = await app.inject({
      method: 'POST',
      url: `/api/workspaces/${workspace.id}/sessions`,
      headers: auth,
      payload: {
        provider: 'codex',
        title: 'Checkpoint Session',
      },
    });
    expect(sessionResponse.statusCode).toBe(200);
    const session = sessionResponse.json().session;

    const wrongUser = await app.inject({
      method: 'POST',
      url: `/api/internal/sessions/${session.id}/checkpoint`,
      headers: {
        'x-remote-codex-service-token': 'test-internal-service-token',
      },
      payload: {
        userId: '00000000-0000-4000-8000-000000000001',
        sandboxId: sandbox.id,
        workerSessionId: 'worker-session-wrong-user',
        status: 'active',
      },
    });
    expect(wrongUser.statusCode).toBe(403);
    expect(wrongUser.json().code).toBe('wrong_user');

    const wrongSandbox = await app.inject({
      method: 'POST',
      url: `/api/internal/sessions/${session.id}/checkpoint`,
      headers: {
        'x-remote-codex-service-token': 'test-internal-service-token',
      },
      payload: {
        userId: user.id,
        sandboxId: '00000000-0000-4000-8000-000000000002',
        workerSessionId: 'worker-session-wrong-sandbox',
        status: 'active',
      },
    });
    expect(wrongSandbox.statusCode).toBe(403);
    expect(wrongSandbox.json().code).toBe('wrong_sandbox');

    const checkpoint = await app.inject({
      method: 'POST',
      url: `/api/internal/sessions/${session.id}/checkpoint`,
      headers: {
        'x-remote-codex-service-token': 'test-internal-service-token',
      },
      payload: {
        userId: user.id,
        sandboxId: sandbox.id,
        workerSessionId: 'worker-session-1',
        status: 'active',
      },
    });
    expect(checkpoint.statusCode).toBe(200);
    expect(checkpoint.json().session).toMatchObject({
      id: session.id,
      userId: user.id,
      sandboxId: sandbox.id,
      workerSessionId: 'worker-session-1',
      status: 'active',
    });
    expect(checkpoint.json().session.lastActivityAt).toEqual(expect.any(String));

    const refreshed = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${workspace.id}/sessions`,
      headers: auth,
    });
    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.json().sessions[0]).toMatchObject({
      id: session.id,
      workerSessionId: 'worker-session-1',
      status: 'active',
    });

    const failures = app.services.repository.listAuditLogs({
      action: 'session.checkpoint_failed',
      resourceId: session.id,
    });
    expect(failures).toHaveLength(2);
    expect(failures.map((entry) => JSON.parse(entry.metadataJson).reason).sort()).toEqual([
      'wrong_sandbox',
      'wrong_user',
    ]);
  });

  it('supports jwt auth mode and rejects invalid production tokens', async () => {
    const env = {
      ...testEnv('jwt-auth'),
      CONTROL_PLANE_AUTH_MODE: 'jwt',
      CONTROL_PLANE_AUTH_JWT_SECRET: 'production-auth-test-secret',
      CONTROL_PLANE_AUTH_JWT_PROVIDER: 'test-jwt',
      CONTROL_PLANE_AUTH_JWT_ISSUER: 'https://issuer.example.test',
      CONTROL_PLANE_AUTH_JWT_AUDIENCE: 'remote-codex',
      CONTROL_PLANE_AUTH_JWT_CLOCK_SKEW_SECONDS: '30',
      CONTROL_PLANE_ADMIN_IDENTITIES: 'test-jwt:admin',
    };
    const app = buildControlPlaneApp({ env });
    apps.push(app);

    const token = createSignedToken(
      {
        sub: 'jwt-user',
        iss: 'https://issuer.example.test',
        aud: 'remote-codex',
        exp: Math.floor(Date.now() / 1000) + 300,
      },
      'production-auth-test-secret',
    );

    const invalid = await app.inject({
      method: 'POST',
      url: '/api/me/bootstrap',
      headers: {
        authorization: 'Bearer invalid-token',
      },
      payload: {
        email: 'jwt@example.com',
      },
    });
    expect(invalid.statusCode).toBe(401);

    const bootstrap = await app.inject({
      method: 'POST',
      url: '/api/me/bootstrap',
      headers: {
        authorization: `Bearer ${token}`,
      },
      payload: {
        email: 'jwt@example.com',
      },
    });
    expect(bootstrap.statusCode).toBe(200);
    expect(bootstrap.json().user).toMatchObject({
      authProvider: 'test-jwt',
      authSubject: 'jwt-user',
    });

    const wrongIssuerToken = createSignedToken(
      {
        sub: 'jwt-user',
        iss: 'https://other-issuer.example.test',
        aud: 'remote-codex',
        exp: Math.floor(Date.now() / 1000) + 300,
      },
      'production-auth-test-secret',
    );
    const wrongIssuer = await app.inject({
      method: 'POST',
      url: '/api/me/bootstrap',
      headers: {
        authorization: `Bearer ${wrongIssuerToken}`,
      },
      payload: {
        email: 'jwt@example.com',
      },
    });
    expect(wrongIssuer.statusCode).toBe(401);

    const wrongAudienceToken = createSignedToken(
      {
        sub: 'jwt-user',
        iss: 'https://issuer.example.test',
        aud: 'other-audience',
        exp: Math.floor(Date.now() / 1000) + 300,
      },
      'production-auth-test-secret',
    );
    const wrongAudience = await app.inject({
      method: 'POST',
      url: '/api/me/bootstrap',
      headers: {
        authorization: `Bearer ${wrongAudienceToken}`,
      },
      payload: {
        email: 'jwt@example.com',
      },
    });
    expect(wrongAudience.statusCode).toBe(401);

    const skewedToken = createSignedToken(
      {
        sub: 'jwt-skewed-user',
        iss: 'https://issuer.example.test',
        aud: ['remote-codex', 'secondary'],
        nbf: Math.floor(Date.now() / 1000) + 20,
        exp: Math.floor(Date.now() / 1000) - 15,
      },
      'production-auth-test-secret',
    );
    const skewed = await app.inject({
      method: 'POST',
      url: '/api/me/bootstrap',
      headers: {
        authorization: `Bearer ${skewedToken}`,
      },
      payload: {
        email: 'jwt-skewed@example.com',
      },
    });
    expect(skewed.statusCode).toBe(200);

    const tooEarlyToken = createSignedToken(
      {
        sub: 'jwt-too-early-user',
        iss: 'https://issuer.example.test',
        aud: 'remote-codex',
        nbf: Math.floor(Date.now() / 1000) + 90,
        exp: Math.floor(Date.now() / 1000) + 300,
      },
      'production-auth-test-secret',
    );
    const tooEarly = await app.inject({
      method: 'POST',
      url: '/api/me/bootstrap',
      headers: {
        authorization: `Bearer ${tooEarlyToken}`,
      },
      payload: {
        email: 'jwt-too-early@example.com',
      },
    });
    expect(tooEarly.statusCode).toBe(401);
  });

  it('exposes user management for control-plane administration', async () => {
    const app = buildControlPlaneApp({ env: testEnv('users') });
    apps.push(app);

    const register = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      headers: {
        authorization: 'Bearer dev:admin',
      },
      payload: {
        email: 'admin-target@example.com',
        displayName: 'Admin Target',
      },
    });
    expect(register.statusCode).toBe(200);
    const userId = register.json().user.id;

    const list = await app.inject({
      method: 'GET',
      url: '/api/admin/users',
      headers: {
        authorization: 'Bearer dev:admin',
      },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().users).toHaveLength(1);

    const update = await app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${userId}`,
      headers: {
        authorization: 'Bearer dev:admin',
      },
      payload: {
        plan: 'pro',
        status: 'active',
        billingCustomerId: 'cus_test',
        quotaProfile: 'pro',
      },
    });
    expect(update.statusCode).toBe(200);
    expect(update.json().user.plan).toBe('pro');
    expect(update.json().user.billingCustomerId).toBe('cus_test');
    expect(update.json().user.quotaProfile).toBe('pro');

    const filtered = await app.inject({
      method: 'GET',
      url: '/api/admin/users?plan=pro&status=active',
      headers: {
        authorization: 'Bearer dev:admin',
      },
    });
    expect(filtered.statusCode).toBe(200);
    expect(filtered.json().users).toHaveLength(1);
  });

  it('returns clear 401 and 403 error response shapes', async () => {
    const app = buildControlPlaneApp({ env: testEnv('auth-errors') });
    apps.push(app);

    const unauthorized = await app.inject({
      method: 'GET',
      url: '/api/me',
    });
    expect(unauthorized.statusCode).toBe(401);
    expect(unauthorized.json()).toEqual({
      code: 'unauthorized',
      message: 'Authentication is required.',
    });

    await app.inject({
      method: 'POST',
      url: '/api/me/bootstrap',
      headers: {
        authorization: 'Bearer dev:not-admin',
      },
      payload: {
        email: 'not-admin@example.com',
      },
    });

    const forbidden = await app.inject({
      method: 'GET',
      url: '/api/admin/users',
      headers: {
        authorization: 'Bearer dev:not-admin',
      },
    });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json()).toEqual({
      code: 'forbidden',
      message: 'Administrator access is required.',
    });
  });

  it('exposes sandbox management for control-plane administration', async () => {
    const app = buildControlPlaneApp({ env: testEnv('admin-sandboxes') });
    apps.push(app);

    const userAuth = { authorization: 'Bearer dev:sandbox-owner' };
    const bootstrap = await app.inject({
      method: 'POST',
      url: '/api/me/bootstrap',
      headers: userAuth,
      payload: {
        email: 'sandbox-owner@example.com',
      },
    });
    const sandboxId = bootstrap.json().sandbox.id;

    await app.inject({
      method: 'POST',
      url: '/api/me/bootstrap',
      headers: {
        authorization: 'Bearer dev:admin',
      },
      payload: {
        email: 'admin@example.com',
      },
    });

    const list = await app.inject({
      method: 'GET',
      url: '/api/admin/sandboxes',
      headers: {
        authorization: 'Bearer dev:admin',
      },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().sandboxes.some((sandbox: { id: string }) => sandbox.id === sandboxId)).toBe(true);

    const detail = await app.inject({
      method: 'GET',
      url: `/api/admin/sandboxes/${sandboxId}`,
      headers: {
        authorization: 'Bearer dev:admin',
      },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      sandbox: {
        id: sandboxId,
        userId: bootstrap.json().user.id,
        image: 'remote-codex-worker:development',
        region: 'us-east-1',
        resourceProfile: 'standard',
      },
      runtimeStatus: {
        state: 'running',
      },
      endpoint: {
        routerBaseUrl: 'https://sandbox-gateway.test',
      },
      recentLifecycleErrors: expect.any(Array),
    });

    const restart = await app.inject({
      method: 'POST',
      url: `/api/admin/sandboxes/${sandboxId}/restart`,
      headers: {
        authorization: 'Bearer dev:admin',
      },
      payload: {
        reason: 'admin requested restart for image refresh',
      },
    });
    expect(restart.statusCode).toBe(200);
    expect(restart.json().sandbox).toMatchObject({
      id: sandboxId,
      state: 'running',
      statusReason: 'admin requested restart for image refresh',
    });

    const forceStop = await app.inject({
      method: 'POST',
      url: `/api/admin/sandboxes/${sandboxId}/force-stop`,
      headers: {
        authorization: 'Bearer dev:admin',
      },
      payload: {
        reason: 'admin requested stop',
      },
    });
    expect(forceStop.statusCode).toBe(200);
    expect(forceStop.json().sandbox).toMatchObject({
      id: sandboxId,
      state: 'stopped',
      statusReason: 'admin requested stop',
    });
    const forceStopAudit = app.services.repository
      .listRecentAuditLogs({
        resourceId: sandboxId,
        actionPrefix: 'sandbox.',
        limit: 20,
      })
      .find((entry) => entry.action === 'sandbox.stopped');
    expect(forceStopAudit).toBeDefined();
    expect(JSON.parse(forceStopAudit!.metadataJson)).toMatchObject({
      adminAction: 'force-stop',
      operatorIdentity: 'dev:admin',
      reason: 'admin requested stop',
      state: 'stopped',
    });

    const forbiddenDetail = await app.inject({
      method: 'GET',
      url: `/api/admin/sandboxes/${sandboxId}`,
      headers: userAuth,
    });
    expect(forbiddenDetail.statusCode).toBe(403);
  });

  it('reaps stale sandbox lifecycle states through the internal API', async () => {
    const sandboxManager = new RecordingSandboxManager();
    sandboxManager.statusResult = {
      state: 'stopped',
      statusReason: 'Worker Pod is absent.',
    };
    sandboxManager.runtimeResources = [
      {
        sandboxId: '00000000-0000-4000-8000-000000000099',
        userId: '00000000-0000-4000-8000-000000000098',
        state: 'running',
        labels: {
          'remote-codex.dev/cleanup-scope': 'sandbox-worker',
          'remote-codex.dev/environment': 'test',
        },
      },
    ];
    const app = buildControlPlaneApp({
      env: testEnvWithInternalService('sandbox-reaper'),
      sandboxManager,
    });
    apps.push(app);

    const oldDate = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const activeDate = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();

    const starting = await app.inject({
      method: 'POST',
      url: '/api/me/bootstrap',
      headers: { authorization: 'Bearer dev:stale-starting' },
      payload: { email: 'stale-starting@example.com' },
    });
    const startingSandbox = starting.json().sandbox;
    app.services.repository.patchSandbox(startingSandbox.id, {
      state: 'starting',
      updatedAt: oldDate,
      statusReason: 'start requested',
    });

    const stopping = await app.inject({
      method: 'POST',
      url: '/api/me/bootstrap',
      headers: { authorization: 'Bearer dev:stale-stopping' },
      payload: { email: 'stale-stopping@example.com' },
    });
    const stoppingSandbox = stopping.json().sandbox;
    app.services.repository.patchSandbox(stoppingSandbox.id, {
      state: 'stopping',
      updatedAt: oldDate,
      statusReason: 'stop requested',
    });

    const idle = await app.inject({
      method: 'POST',
      url: '/api/me/bootstrap',
      headers: { authorization: 'Bearer dev:idle-running' },
      payload: { email: 'idle-running@example.com' },
    });
    const idleSandbox = idle.json().sandbox;
    app.services.repository.patchSandbox(idleSandbox.id, {
      state: 'running',
      updatedAt: activeDate,
      lastSeenAt: activeDate,
      statusReason: 'worker last heartbeat',
    });

    const run = await app.inject({
      method: 'POST',
      url: '/api/internal/sandboxes/reap',
      headers: {
        'x-remote-codex-service-token': 'test-internal-service-token',
      },
    });

    expect(run.statusCode).toBe(200);
    expect(run.json().reaper.decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sandboxId: startingSandbox.id,
          action: 'status_checked',
          reason: 'stale_starting',
          state: 'stopped',
        }),
        expect.objectContaining({
          sandboxId: stoppingSandbox.id,
          action: 'marked_stopped',
          reason: 'stale_stopping_runtime_absent',
          state: 'stopped',
        }),
        expect.objectContaining({
          sandboxId: idleSandbox.id,
          action: 'stop_requested',
          reason: 'idle_timeout',
        }),
        expect.objectContaining({
          sandboxId: '00000000-0000-4000-8000-000000000099',
          action: 'stop_requested',
          reason: 'orphan_runtime',
          state: 'stopped',
        }),
      ]),
    );
    expect(app.services.repository.getSandboxById(startingSandbox.id)).toMatchObject({
      state: 'stopped',
      statusReason: 'Worker Pod is absent.',
    });
    expect(app.services.repository.getSandboxById(stoppingSandbox.id)).toMatchObject({
      state: 'stopped',
      statusReason: 'Worker Pod is absent.',
    });
    expect(sandboxManager.stops).toEqual([
      {
        sandboxId: idleSandbox.id,
        userId: idleSandbox.userId,
      },
    ]);
    expect(sandboxManager.cleanupRequests).toEqual([
      {
        sandboxId: '00000000-0000-4000-8000-000000000099',
        userId: '00000000-0000-4000-8000-000000000098',
        reason: 'orphan_runtime',
      },
    ]);
  });

  it('forbids non-admin users from control-plane administration', async () => {
    const app = buildControlPlaneApp({ env: testEnv('admin-forbidden') });
    apps.push(app);

    await app.inject({
      method: 'POST',
      url: '/api/me/bootstrap',
      headers: {
        authorization: 'Bearer dev:regular',
      },
      payload: {
        email: 'regular@example.com',
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/users',
      headers: {
        authorization: 'Bearer dev:regular',
      },
    });
    expect(response.statusCode).toBe(403);
  });

  it('imports usage as admin and exposes user-scoped usage', async () => {
    const app = buildControlPlaneApp({ env: testEnv('usage') });
    apps.push(app);

    const auth = { authorization: 'Bearer dev:usage-user' };
    const bootstrap = await app.inject({
      method: 'POST',
      url: '/api/me/bootstrap',
      headers: auth,
      payload: {
        email: 'usage@example.com',
      },
    });
    const { user, sandbox, gatewayKey } = bootstrap.json();

    await app.inject({
      method: 'POST',
      url: '/api/me/bootstrap',
      headers: {
        authorization: 'Bearer dev:admin',
      },
      payload: {
        email: 'admin@example.com',
      },
    });

    const forbidden = await app.inject({
      method: 'POST',
      url: '/api/admin/usage/import',
      headers: auth,
      payload: { events: [] },
    });
    expect(forbidden.statusCode).toBe(403);

    const imported = await app.inject({
      method: 'POST',
      url: '/api/admin/usage/import',
      headers: {
        authorization: 'Bearer dev:admin',
      },
      payload: {
        events: [
          {
            userId: user.id,
            sandboxId: sandbox.id,
            gatewayKeyId: gatewayKey.id,
            provider: 'sub2api',
            model: 'gpt-5.1-codex',
            inputTokens: 100,
            outputTokens: 25,
            costUsd: 0.12,
            externalRequestId: 'req_1',
            occurredAt: '2026-05-23T00:00:00.000Z',
          },
        ],
      },
    });
    expect(imported.statusCode).toBe(200);

    const summary = await app.inject({
      method: 'GET',
      url: '/api/usage/summary',
      headers: auth,
    });
    expect(summary.statusCode).toBe(200);
    expect(summary.json().usage).toMatchObject({
      requestCount: 1,
      inputTokens: 100,
      outputTokens: 25,
      costUsd: 0.12,
    });

    const events = await app.inject({
      method: 'GET',
      url: '/api/usage/events',
      headers: auth,
    });
    expect(events.statusCode).toBe(200);
    expect(events.json().events).toHaveLength(1);
  });

  it('imports gateway usage by external key and deduplicates external requests', async () => {
    const app = buildControlPlaneApp({ env: testEnv('gateway-usage-import') });
    apps.push(app);

    const auth = { authorization: 'Bearer dev:gateway-usage-user' };
    const bootstrap = await app.inject({
      method: 'POST',
      url: '/api/me/bootstrap',
      headers: auth,
      payload: {
        email: 'gateway-usage@example.com',
      },
    });
    expect(bootstrap.statusCode).toBe(200);
    const { sandbox, gatewayKey } = bootstrap.json();

    await app.inject({
      method: 'POST',
      url: '/api/me/bootstrap',
      headers: {
        authorization: 'Bearer dev:admin',
      },
      payload: {
        email: 'admin@example.com',
      },
    });

    const imported = await app.inject({
      method: 'POST',
      url: '/api/admin/usage/import',
      headers: {
        authorization: 'Bearer dev:admin',
      },
      payload: {
        events: [
          {
            gatewayExternalKeyId: gatewayKey.externalKeyId,
            provider: 'sub2api',
            model: 'gpt-5.1-codex',
            inputTokens: 200,
            outputTokens: 50,
            cachedTokens: 25,
            costUsd: 0.42,
            externalRequestId: 'gateway_req_1',
            occurredAt: '2026-05-23T01:00:00.000Z',
          },
          {
            gatewayExternalKeyId: gatewayKey.externalKeyId,
            provider: 'sub2api',
            model: 'gpt-5.1-codex',
            inputTokens: 999,
            outputTokens: 999,
            costUsd: 9.99,
            externalRequestId: 'gateway_req_1',
            occurredAt: '2026-05-23T01:01:00.000Z',
          },
        ],
      },
    });
    expect(imported.statusCode).toBe(200);
    expect(imported.json().events).toHaveLength(2);
    expect(imported.json().events[0]).toMatchObject({
      sandboxId: sandbox.id,
      gatewayKeyId: gatewayKey.id,
      inputTokens: 200,
      outputTokens: 50,
      cachedTokens: 25,
      costUsd: 0.42,
      externalRequestId: 'gateway_req_1',
    });
    expect(imported.json().events[1].id).toBe(imported.json().events[0].id);

    const summary = await app.inject({
      method: 'GET',
      url: '/api/usage/summary',
      headers: auth,
    });
    expect(summary.statusCode).toBe(200);
    expect(summary.json().usage).toMatchObject({
      requestCount: 1,
      inputTokens: 200,
      outputTokens: 50,
      cachedTokens: 25,
      costUsd: 0.42,
    });
  });

  it('imports usage pulled from the configured gateway export adapter', async () => {
    const exportedUsage = {
      events: [
        {
          eventId: 'gateway_export_req_1',
          externalKeyId: '',
          model: 'gpt-5.1-codex',
          inputTokens: 300,
          outputTokens: 75,
          cachedTokens: 30,
          costUsd: 0.55,
          currency: 'USD',
          occurredAt: '2026-05-24T01:00:00.000Z',
        },
        {
          eventId: 'gateway_export_req_1',
          externalKeyId: '',
          model: 'gpt-5.1-codex',
          inputTokens: 999,
          outputTokens: 999,
          costUsd: 9.99,
          currency: 'USD',
          occurredAt: '2026-05-24T01:01:00.000Z',
        },
      ],
      nextCursor: 'cursor-next',
    };
    const exportCalls: Array<{ cursor?: string | null; limit?: number }> = [];
    const app = buildControlPlaneApp({
      env: testEnv('gateway-export-usage-import'),
      llmGatewayAdmin: {
        async ensureUser(input) {
          return { externalUserId: `sub2api-user-${input.userId}` };
        },
        async ensureSandboxKey(input) {
          return {
            externalKeyId: `sub2api-key-${input.sandboxId}`,
            keyCiphertext: null,
          };
        },
        async rotateSandboxKey(input) {
          return {
            externalKeyId: `sub2api-key-${input.sandboxId}-rotated`,
            keyCiphertext: null,
          };
        },
        async revokeSandboxKey() {},
        async reconcileSandboxKey(input) {
          return {
            externalKeyId: `sub2api-key-${input.sandboxId}`,
            keyCiphertext: null,
          };
        },
        async exportUsage(input = {}) {
          exportCalls.push(input);
          return exportedUsage;
        },
      },
    });
    apps.push(app);

    const auth = { authorization: 'Bearer dev:gateway-export-user' };
    const bootstrap = await app.inject({
      method: 'POST',
      url: '/api/me/bootstrap',
      headers: auth,
      payload: {
        email: 'gateway-export@example.com',
      },
    });
    expect(bootstrap.statusCode).toBe(200);
    const { gatewayKey } = bootstrap.json();
    exportedUsage.events[0]!.externalKeyId = gatewayKey.externalKeyId;
    exportedUsage.events[1]!.externalKeyId = gatewayKey.externalKeyId;

    await app.inject({
      method: 'POST',
      url: '/api/me/bootstrap',
      headers: {
        authorization: 'Bearer dev:admin',
      },
      payload: {
        email: 'admin-gateway-export@example.com',
      },
    });

    const imported = await app.inject({
      method: 'POST',
      url: '/api/admin/usage/import',
      headers: {
        authorization: 'Bearer dev:admin',
      },
      payload: {
        cursor: 'cursor-current',
        limit: 50,
      },
    });
    expect(imported.statusCode).toBe(200);
    expect(exportCalls).toEqual([{ cursor: 'cursor-current', limit: 50 }]);
    expect(imported.json().events).toHaveLength(2);
    expect(imported.json().events[1].id).toBe(imported.json().events[0].id);
    expect(imported.json().import).toEqual({
      source: 'gateway',
      sourceCount: 2,
      importedCount: 2,
      duplicateCount: 1,
      failureCount: 0,
      nextCursor: 'cursor-next',
    });

    const summary = await app.inject({
      method: 'GET',
      url: '/api/usage/summary',
      headers: auth,
    });
    expect(summary.statusCode).toBe(200);
    expect(summary.json().usage).toMatchObject({
      requestCount: 1,
      inputTokens: 300,
      outputTokens: 75,
      cachedTokens: 30,
      costUsd: 0.55,
    });
  });

  it('runs the scheduled usage import job with stored cursor and metrics', async () => {
    const exportCalls: Array<{ cursor?: string | null; limit?: number }> = [];
    let externalKeyId = '';
    const app = buildControlPlaneApp({
      env: testEnvWithInternalService('scheduled-gateway-usage-import'),
      llmGatewayAdmin: {
        async ensureUser(input) {
          return { externalUserId: `sub2api-user-${input.userId}` };
        },
        async ensureSandboxKey(input) {
          externalKeyId = `sub2api-key-${input.sandboxId}`;
          return {
            externalKeyId,
            keyCiphertext: null,
          };
        },
        async rotateSandboxKey(input) {
          return {
            externalKeyId: `sub2api-key-${input.sandboxId}-rotated`,
            keyCiphertext: null,
          };
        },
        async revokeSandboxKey() {},
        async reconcileSandboxKey(input) {
          return {
            externalKeyId: `sub2api-key-${input.sandboxId}`,
            keyCiphertext: null,
          };
        },
        async exportUsage(input = {}) {
          exportCalls.push(input);
          return {
            events: [
              {
                eventId: `scheduled_req_${exportCalls.length}`,
                externalKeyId,
                model: 'gpt-5.1-codex',
                inputTokens: 10,
                outputTokens: 5,
                cachedTokens: 1,
                costUsd: 0.05,
                currency: 'USD',
                occurredAt: `2026-05-24T0${exportCalls.length}:00:00.000Z`,
              },
            ],
            nextCursor: `cursor-${exportCalls.length}`,
          };
        },
      },
    });
    apps.push(app);

    await app.inject({
      method: 'POST',
      url: '/api/me/bootstrap',
      headers: { authorization: 'Bearer dev:scheduled-usage-user' },
      payload: { email: 'scheduled-usage@example.com' },
    });

    const forbidden = await app.inject({
      method: 'POST',
      url: '/api/internal/jobs/usage-import',
      headers: {
        'x-remote-codex-service-token': 'wrong-token',
      },
      payload: { limit: 50 },
    });
    expect(forbidden.statusCode).toBe(403);

    const firstRun = await app.inject({
      method: 'POST',
      url: '/api/internal/jobs/usage-import',
      headers: {
        'x-remote-codex-service-token': 'test-internal-service-token',
      },
      payload: { limit: 50 },
    });
    expect(firstRun.statusCode).toBe(200);
    expect(firstRun.json().import).toMatchObject({
      source: 'gateway',
      sourceCount: 1,
      importedCount: 1,
      duplicateCount: 0,
      failureCount: 0,
      nextCursor: 'cursor-1',
    });

    const secondRun = await app.inject({
      method: 'POST',
      url: '/api/internal/jobs/usage-import',
      headers: {
        'x-remote-codex-service-token': 'test-internal-service-token',
      },
      payload: { limit: 25 },
    });
    expect(secondRun.statusCode).toBe(200);
    expect(exportCalls).toEqual([
      { cursor: null, limit: 50 },
      { cursor: 'cursor-1', limit: 25 },
    ]);
    expect(secondRun.json().state).toMatchObject({
      provider: 'sub2api',
      source: 'gateway',
      cursor: 'cursor-2',
      lastSourceCount: 1,
      lastImportedCount: 1,
      lastDuplicateCount: 0,
      lastFailureCount: 0,
    });
    expect(
      app.services.repository.listAuditLogs({ action: 'usage.import_completed' }),
    ).toHaveLength(2);
  });

  it('rejects gateway usage import when identity cannot be resolved', async () => {
    const app = buildControlPlaneApp({ env: testEnv('gateway-usage-unresolved') });
    apps.push(app);

    await app.inject({
      method: 'POST',
      url: '/api/me/bootstrap',
      headers: {
        authorization: 'Bearer dev:admin',
      },
      payload: {
        email: 'admin@example.com',
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/usage/import',
      headers: {
        authorization: 'Bearer dev:admin',
      },
      payload: {
        events: [
          {
            gatewayExternalKeyId: 'missing-gateway-key',
            provider: 'sub2api',
            model: 'gpt-5.1-codex',
            externalRequestId: 'gateway_req_missing',
          },
        ],
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: 'usage_identity_unresolved',
    });
  });

  it('refuses route tokens for non-running sandboxes', async () => {
    const app = buildControlPlaneApp({ env: testEnv('stopped') });
    apps.push(app);

    const auth = { authorization: 'Bearer dev:user-3' };
    const bootstrap = await app.inject({
      method: 'POST',
      url: '/api/me/bootstrap',
      headers: auth,
      payload: {
        email: 'stopped@example.com',
      },
    });

    const tokenResponse = await app.inject({
      method: 'POST',
      url: `/api/sandboxes/${bootstrap.json().sandbox.id}/route-token`,
      headers: auth,
      payload: {},
    });
    expect(tokenResponse.statusCode).toBe(409);
    expect(tokenResponse.json().code).toBe('sandbox_not_running');
  });

  it('refuses route tokens for inactive accounts and archived sessions', async () => {
    const app = buildControlPlaneApp({ env: testEnv('route-token-state') });
    apps.push(app);

    const userAuth = { authorization: 'Bearer dev:state-user' };
    const adminAuth = { authorization: 'Bearer dev:admin' };
    await app.inject({
      method: 'POST',
      url: '/api/me/bootstrap',
      headers: adminAuth,
      payload: { email: 'admin-state@example.com' },
    });
    const bootstrap = await app.inject({
      method: 'POST',
      url: '/api/me/bootstrap',
      headers: userAuth,
      payload: { email: 'state@example.com' },
    });
    const user = bootstrap.json().user;
    const sandbox = bootstrap.json().sandbox;
    await app.inject({
      method: 'POST',
      url: '/api/sandbox/start',
      headers: userAuth,
    });
    const workspaceResponse = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      headers: userAuth,
      payload: {
        name: 'State Workspace',
        slug: 'state-workspace',
      },
    });
    const sessionResponse = await app.inject({
      method: 'POST',
      url: `/api/workspaces/${workspaceResponse.json().workspace.id}/sessions`,
      headers: userAuth,
      payload: {
        provider: 'codex',
        title: 'State Session',
      },
    });
    const session = sessionResponse.json().session;

    const archivedSession = await app.inject({
      method: 'PATCH',
      url: `/api/sessions/${session.id}`,
      headers: userAuth,
      payload: {
        status: 'archived',
      },
    });
    expect(archivedSession.statusCode).toBe(200);

    const archivedToken = await app.inject({
      method: 'POST',
      url: `/api/sandboxes/${sandbox.id}/route-token`,
      headers: userAuth,
      payload: {
        sessionId: session.id,
      },
    });
    expect(archivedToken.statusCode).toBe(409);
    expect(archivedToken.json().code).toBe('session_not_active');

    const suspended = await app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${user.id}`,
      headers: adminAuth,
      payload: {
        status: 'suspended',
      },
    });
    expect(suspended.statusCode).toBe(200);

    const suspendedToken = await app.inject({
      method: 'POST',
      url: `/api/sandboxes/${sandbox.id}/route-token`,
      headers: userAuth,
      payload: {},
    });
    expect(suspendedToken.statusCode).toBe(403);
    expect(suspendedToken.json().code).toBe('account_inactive');
  });

  it('refuses sandbox start and restart for inactive accounts', async () => {
    const manager = new RecordingSandboxManager();
    const app = buildControlPlaneApp({
      env: testEnv('inactive-sandbox-lifecycle'),
      sandboxManager: manager,
    });
    apps.push(app);

    const userAuth = { authorization: 'Bearer dev:inactive-lifecycle-user' };
    const adminAuth = { authorization: 'Bearer dev:admin' };
    await app.inject({
      method: 'POST',
      url: '/api/me/bootstrap',
      headers: adminAuth,
      payload: { email: 'admin-inactive-lifecycle@example.com' },
    });
    const bootstrap = await app.inject({
      method: 'POST',
      url: '/api/me/bootstrap',
      headers: userAuth,
      payload: { email: 'inactive-lifecycle@example.com' },
    });
    expect(bootstrap.statusCode).toBe(200);
    const user = bootstrap.json().user;

    const suspended = await app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${user.id}`,
      headers: adminAuth,
      payload: {
        status: 'suspended',
      },
    });
    expect(suspended.statusCode).toBe(200);

    const start = await app.inject({
      method: 'POST',
      url: '/api/sandbox/start',
      headers: userAuth,
    });
    expect(start.statusCode).toBe(403);
    expect(start.json().code).toBe('account_inactive');

    const restart = await app.inject({
      method: 'POST',
      url: '/api/sandbox/restart',
      headers: userAuth,
    });
    expect(restart.statusCode).toBe(403);
    expect(restart.json().code).toBe('account_inactive');
    expect(manager.starts).toHaveLength(0);
  });

  it('refuses usage import for inactive accounts without recording usage', async () => {
    const app = buildControlPlaneApp({ env: testEnv('inactive-usage-import') });
    apps.push(app);

    const userAuth = { authorization: 'Bearer dev:inactive-usage-user' };
    const adminAuth = { authorization: 'Bearer dev:admin' };
    await app.inject({
      method: 'POST',
      url: '/api/me/bootstrap',
      headers: adminAuth,
      payload: { email: 'admin-inactive-usage@example.com' },
    });
    const bootstrap = await app.inject({
      method: 'POST',
      url: '/api/me/bootstrap',
      headers: userAuth,
      payload: { email: 'inactive-usage@example.com' },
    });
    expect(bootstrap.statusCode).toBe(200);
    const { user, sandbox, gatewayKey } = bootstrap.json();

    const suspended = await app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${user.id}`,
      headers: adminAuth,
      payload: {
        status: 'suspended',
      },
    });
    expect(suspended.statusCode).toBe(200);

    const imported = await app.inject({
      method: 'POST',
      url: '/api/admin/usage/import',
      headers: adminAuth,
      payload: {
        events: [
          {
            userId: user.id,
            sandboxId: sandbox.id,
            gatewayKeyId: gatewayKey.id,
            provider: 'sub2api',
            model: 'gpt-5.1-codex',
            inputTokens: 100,
            outputTokens: 25,
            costUsd: 0.12,
            externalRequestId: 'req_inactive_usage',
            occurredAt: '2026-05-23T00:00:00.000Z',
          },
        ],
      },
    });
    expect(imported.statusCode).toBe(403);
    expect(imported.json().code).toBe('account_inactive');

    const reactivated = await app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${user.id}`,
      headers: adminAuth,
      payload: {
        status: 'active',
      },
    });
    expect(reactivated.statusCode).toBe(200);

    const summary = await app.inject({
      method: 'GET',
      url: '/api/usage/summary',
      headers: userAuth,
    });
    expect(summary.statusCode).toBe(200);
    expect(summary.json().usage.requestCount).toBe(0);
  });

  it('refuses route tokens when the quota profile disables worker routing', async () => {
    const app = buildControlPlaneApp({ env: testEnv('route-token-quota-disabled') });
    apps.push(app);

    const userAuth = { authorization: 'Bearer dev:quota-disabled-user' };
    const adminAuth = { authorization: 'Bearer dev:admin' };
    await app.inject({
      method: 'POST',
      url: '/api/me/bootstrap',
      headers: adminAuth,
      payload: { email: 'admin-quota-disabled@example.com' },
    });
    const bootstrap = await app.inject({
      method: 'POST',
      url: '/api/me/bootstrap',
      headers: userAuth,
      payload: { email: 'quota-disabled@example.com' },
    });
    const user = bootstrap.json().user;
    const sandbox = bootstrap.json().sandbox;
    await app.inject({
      method: 'POST',
      url: '/api/sandbox/start',
      headers: userAuth,
    });

    const quotaUpdate = await app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${user.id}`,
      headers: adminAuth,
      payload: {
        quotaProfile: 'disabled',
      },
    });
    expect(quotaUpdate.statusCode).toBe(200);

    const routeToken = await app.inject({
      method: 'POST',
      url: `/api/sandboxes/${sandbox.id}/route-token`,
      headers: userAuth,
      payload: {},
    });
    expect(routeToken.statusCode).toBe(402);
    expect(routeToken.json()).toMatchObject({
      code: 'quota_exceeded',
      message: 'Quota exceeded.',
      details: {
        reason: 'route_tokens_disabled',
        quotaProfile: 'disabled',
        limit: 0,
        used: 0,
      },
    });
  });

  it('refuses route tokens when LLM spend reaches the user quota', async () => {
    const app = buildControlPlaneApp({ env: testEnv('route-token-quota-spend') });
    apps.push(app);

    const userAuth = { authorization: 'Bearer dev:quota-spend-user' };
    const adminAuth = { authorization: 'Bearer dev:admin' };
    await app.inject({
      method: 'POST',
      url: '/api/me/bootstrap',
      headers: adminAuth,
      payload: { email: 'admin-quota-spend@example.com' },
    });
    const bootstrap = await app.inject({
      method: 'POST',
      url: '/api/me/bootstrap',
      headers: userAuth,
      payload: { email: 'quota-spend@example.com' },
    });
    const { user, sandbox, gatewayKey } = bootstrap.json();
    await app.inject({
      method: 'POST',
      url: '/api/sandbox/start',
      headers: userAuth,
    });

    const imported = await app.inject({
      method: 'POST',
      url: '/api/admin/usage/import',
      headers: adminAuth,
      payload: {
        events: [
          {
            userId: user.id,
            sandboxId: sandbox.id,
            gatewayKeyId: gatewayKey.id,
            provider: 'sub2api',
            model: 'gpt-5.1-codex',
            costUsd: 25,
            externalRequestId: 'req_quota_spend',
            occurredAt: '2026-05-23T00:00:00.000Z',
          },
        ],
      },
    });
    expect(imported.statusCode).toBe(200);

    const routeToken = await app.inject({
      method: 'POST',
      url: `/api/sandboxes/${sandbox.id}/route-token`,
      headers: userAuth,
      payload: {},
    });
    expect(routeToken.statusCode).toBe(402);
    expect(routeToken.json()).toMatchObject({
      code: 'quota_exceeded',
      message: 'Quota exceeded.',
      details: {
        reason: 'llm_spend_quota_exceeded',
        quotaProfile: 'developer',
        limit: 25,
        used: 25,
      },
    });
  });
});
