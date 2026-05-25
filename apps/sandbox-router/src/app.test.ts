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

function testEnv(overrides: Record<string, string> = {}) {
  return {
    NODE_ENV: 'test',
    CONTROL_PLANE_JWT_SECRET: signingSecret,
    CONTROL_PLANE_JWT_SECRET_ID: 'current',
    SANDBOX_ROUTER_WORKER_AUTH_TOKEN: 'internal-worker-token',
    SANDBOX_ROUTER_WORKER_IDENTITY_SECRET: workerIdentitySecret,
    ...overrides,
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
    envOverrides: Record<string, string> = {},
  ) {
    const app = buildSandboxRouterApp({
      env: testEnv(envOverrides),
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

  it('resolves sandbox endpoints from the control-plane registry when configured', async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            sandboxId: 'sandbox_1',
            userId: 'user_1',
            workerBaseUrl: 'http://worker.svc.cluster.local:8787',
          }),
          {
            status: 200,
            headers: {
              'content-type': 'application/json',
            },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
          },
        }),
      );
    const app = buildSandboxRouterApp({
      env: testEnv({
        SANDBOX_ROUTER_CONTROL_PLANE_BASE_URL: 'https://control-plane.example.test',
        SANDBOX_ROUTER_CONTROL_PLANE_SERVICE_TOKEN: 'internal-router-service-token',
      }),
    });
    apps.push(app);

    const response = await app.inject({
      method: 'GET',
      url: `/api/sandboxes/sandbox_1/api/worker/metadata?token=${encodeURIComponent(routeToken())}`,
    });

    expect(response.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [registryUrl, registryInit] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(registryUrl.toString()).toBe(
      'https://control-plane.example.test/api/internal/sandboxes/sandbox_1/endpoint?userId=user_1',
    );
    expect((registryInit.headers as Record<string, string>)['x-remote-codex-service-token']).toBe(
      'internal-router-service-token',
    );
    const [workerUrl] = fetchMock.mock.calls[1] as [URL, RequestInit];
    expect(workerUrl.toString()).toBe('http://worker.svc.cluster.local:8787/api/worker/metadata');
  });

  it('rejects proxied request bodies that exceed the configured byte limit', async () => {
    vi.stubGlobal('fetch', fetchMock);
    const app = buildApp(undefined, {
      SANDBOX_ROUTER_MAX_REQUEST_BYTES: '16',
    });
    const response = await app.inject({
      method: 'POST',
      url: `/api/sandboxes/sandbox_1/api/threads/thread_1/prompt?token=${encodeURIComponent(routeToken())}`,
      headers: {
        'content-type': 'application/json',
      },
      payload: {
        prompt: 'this body is too large',
      },
    });

    expect(response.statusCode).toBe(413);
    expect(response.json()).toMatchObject({
      code: 'request_too_large',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rate limits proxied requests per route-token user and sandbox', async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockImplementation(
      () =>
        Promise.resolve(
          new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: {
              'content-type': 'application/json',
            },
          }),
        ),
    );
    const app = buildApp(undefined, {
      SANDBOX_ROUTER_RATE_LIMIT_REQUESTS: '2',
      SANDBOX_ROUTER_RATE_LIMIT_WINDOW_MS: '60000',
    });
    const token = routeToken();
    const url = `/api/sandboxes/sandbox_1/api/worker/metadata?token=${encodeURIComponent(token)}`;

    const first = await app.inject({ method: 'GET', url });
    const second = await app.inject({ method: 'GET', url });
    const third = await app.inject({ method: 'GET', url });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(third.statusCode).toBe(429);
    expect(third.json()).toMatchObject({
      code: 'rate_limited',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns a structured timeout error when the worker does not respond in time', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockImplementation(
      (_url: URL, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        }),
    );
    const app = buildApp(undefined, {
      SANDBOX_ROUTER_UPSTREAM_TIMEOUT_MS: '25',
    });

    const request = app.inject({
      method: 'GET',
      url: `/api/sandboxes/sandbox_1/api/worker/metadata?token=${encodeURIComponent(routeToken())}`,
    });
    await vi.advanceTimersByTimeAsync(25);
    const response = await request;

    expect(response.statusCode).toBe(504);
    expect(response.json()).toMatchObject({
      code: 'worker_timeout',
    });
    vi.useRealTimers();
  });
});
