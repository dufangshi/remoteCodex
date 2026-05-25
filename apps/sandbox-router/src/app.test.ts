import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSignedToken, RouteTokenPayload } from '../../../packages/shared/src/index';
import { buildSandboxRouterApp, SandboxEndpointResolver } from './app';

const signingSecret = 'test-control-plane-secret-key';
const workerIdentitySecret = 'test-worker-identity-secret';

function routeToken(input: Partial<RouteTokenPayload> = {}) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const payload: RouteTokenPayload = {
    sub: input.sub ?? 'user_1',
    sandbox_id: input.sandbox_id ?? 'sandbox_1',
    scopes: input.scopes ?? ['provider:turn:create'],
    iat: input.iat ?? nowSeconds,
    exp: input.exp ?? nowSeconds + 300,
    jti: input.jti ?? 'token_1',
    ...(input.workspace_id ? { workspace_id: input.workspace_id } : {}),
    ...(input.session_id ? { session_id: input.session_id } : {}),
  };
  return createSignedToken(payload, signingSecret, { kid: 'current' });
}

function testEnv() {
  return {
    NODE_ENV: 'test',
    CONTROL_PLANE_JWT_SECRET: signingSecret,
    CONTROL_PLANE_JWT_SECRET_ID: 'current',
    SANDBOX_ROUTER_WORKER_AUTH_TOKEN: 'internal-worker-token',
    SANDBOX_ROUTER_WORKER_IDENTITY_SECRET: workerIdentitySecret,
  };
}

describe('sandbox router', () => {
  const apps: ReturnType<typeof buildSandboxRouterApp>[] = [];
  const fetchMock = vi.fn();

  afterEach(async () => {
    await Promise.all(apps.map((app) => app.close()));
    apps.length = 0;
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  function buildApp(
    resolver: SandboxEndpointResolver = {
      async resolve() {
        return { workerBaseUrl: 'https://worker.example.test' };
      },
    },
  ) {
    const app = buildSandboxRouterApp({
      env: testEnv(),
      endpointResolver: resolver,
    });
    apps.push(app);
    return app;
  }

  it('returns router health', async () => {
    const app = buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/healthz',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, role: 'sandbox-router' });
  });

  it('rejects missing, invalid, expired, and wrong-sandbox route tokens', async () => {
    const app = buildApp();
    const missing = await app.inject({
      method: 'GET',
      url: '/api/sandboxes/sandbox_1/api/worker/metadata',
    });
    expect(missing.statusCode).toBe(401);

    const invalid = await app.inject({
      method: 'GET',
      url: '/api/sandboxes/sandbox_1/api/worker/metadata?token=bad',
    });
    expect(invalid.statusCode).toBe(401);

    const expired = await app.inject({
      method: 'GET',
      url: `/api/sandboxes/sandbox_1/api/worker/metadata?token=${encodeURIComponent(routeToken({
        exp: Math.floor(Date.now() / 1000) - 1,
      }))}`,
    });
    expect(expired.statusCode).toBe(401);

    const wrongSandbox = await app.inject({
      method: 'GET',
      url: `/api/sandboxes/sandbox_2/api/worker/metadata?token=${encodeURIComponent(routeToken())}`,
    });
    expect(wrongSandbox.statusCode).toBe(403);
  });

  it('proxies HTTP requests with internal worker headers and signed identity', async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 201,
        headers: {
          'content-type': 'application/json',
        },
      }),
    );
    const app = buildApp();
    const token = routeToken({
      scopes: ['provider:turn:create', 'file:write'],
    });

    const response = await app.inject({
      method: 'POST',
      url: `/api/sandboxes/sandbox_1/api/threads/thread_1/prompt?token=${encodeURIComponent(token)}&trace=1`,
      headers: {
        'content-type': 'application/json',
        'x-remote-codex-worker-token': 'browser-forged-token',
        'x-remote-codex-user': 'browser-forged-user',
      },
      payload: {
        prompt: 'hello',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe('https://worker.example.test/api/threads/thread_1/prompt?trace=1');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ prompt: 'hello' }));
    const headers = init.headers as Headers;
    expect(headers.get('x-remote-codex-worker-token')).toBe('internal-worker-token');
    expect(headers.get('x-remote-codex-user')).toBe('user_1');
    expect(headers.get('x-remote-codex-sandbox')).toBe('sandbox_1');
    expect(headers.get('x-remote-codex-scopes')).toBe('file:write,provider:turn:create');
    expect(headers.get('x-remote-codex-signature')).toEqual(expect.any(String));
  });

  it('returns 502 when the sandbox endpoint cannot be resolved', async () => {
    const app = buildApp({
      async resolve() {
        return { workerBaseUrl: null };
      },
    });
    const response = await app.inject({
      method: 'GET',
      url: `/api/sandboxes/sandbox_1/api/worker/metadata?token=${encodeURIComponent(routeToken())}`,
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({
      code: 'worker_unavailable',
    });
  });
});
