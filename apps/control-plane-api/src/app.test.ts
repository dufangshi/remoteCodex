import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildControlPlaneApp } from './app';

function testEnv(name: string) {
  return {
    NODE_ENV: 'test',
    CONTROL_PLANE_DATABASE_URL: path.join(os.tmpdir(), `remote-codex-control-plane-${name}-${Date.now()}.sqlite`),
    CONTROL_PLANE_JWT_SECRET: 'test-control-plane-secret-key',
    SANDBOX_ROUTER_BASE_URL: 'https://sandbox-gateway.test',
    CONTROL_PLANE_ADMIN_IDENTITIES: 'dev:admin',
  };
}

describe('control plane api', () => {
  const apps: ReturnType<typeof buildControlPlaneApp>[] = [];

  afterEach(async () => {
    await Promise.all(apps.map((app) => app.close()));
    apps.length = 0;
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
    expect(body.gatewayKey.externalKeyId).toBe(`sub2api-key-${body.sandbox.id}`);
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
      },
    });
    expect(update.statusCode).toBe(200);
    expect(update.json().user.plan).toBe('pro');
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
});
