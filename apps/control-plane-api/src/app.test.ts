import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createSignedToken } from '../../../packages/shared/src/index';
import type { SandboxManager, SandboxProvisionResult, SandboxStartInput } from './adapters';
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

  async stopSandbox(): Promise<SandboxProvisionResult> {
    return { state: 'stopped' };
  }

  async restartSandbox(input: SandboxStartInput): Promise<SandboxProvisionResult> {
    return this.startSandbox(input);
  }

  async deleteSandbox(): Promise<SandboxProvisionResult> {
    return { state: 'deleted' };
  }

  async getSandboxStatus(): Promise<SandboxProvisionResult> {
    return { state: 'running' };
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
}

describe('control plane api', () => {
  const apps: ReturnType<typeof buildControlPlaneApp>[] = [];

  afterEach(async () => {
    await Promise.all(apps.map((app) => app.close()));
    apps.length = 0;
  });

  it('configures log redaction for gateway credentials', () => {
    expect(CONTROL_PLANE_LOG_REDACTION_PATHS).toEqual(
      expect.arrayContaining([
        'req.headers.authorization',
        'req.headers["x-remote-codex-service-token"]',
        'LLM_GATEWAY_ADMIN_TOKEN',
        'llmGatewayAdminToken',
        'gatewayKey.keyCiphertext',
        '*.gatewayKey.keyCiphertext',
        '*.keyCiphertext',
      ]),
    );
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

    const workspaceResponse = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      headers: auth,
      payload: {
        name: 'Project A',
        slug: 'project-a',
      },
    });
    expect(workspaceResponse.statusCode).toBe(200);
    const workspace = workspaceResponse.json().workspace;
    expect(workspace.path).toBe('/workspace/project-a');

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
