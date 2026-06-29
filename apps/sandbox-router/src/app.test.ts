import { createServer, type Server } from 'node:http';

import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';

import { createSignedToken, RouteTokenPayload } from '../../../packages/shared/src/tokens';
import {
  buildSandboxRouterApp,
  SandboxEndpointResolver,
  SandboxRouterAuditEvent,
} from './app';

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
    ...(input.project_id ? { project_id: input.project_id } : {}),
    ...(input.workspace_id ? { workspace_id: input.workspace_id } : {}),
    ...(input.session_id ? { session_id: input.session_id } : {}),
  };
  return createSignedToken(payload, signingSecret, { kid: 'current' });
}

function hostRouteToken(input: Partial<RouteTokenPayload> & { host?: string } = {}) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const payload = {
    sub: input.sub ?? 'user_1',
    sandbox_id: input.sandbox_id ?? 'sandbox_1',
    scopes: input.scopes ?? ['sandbox:app'],
    iat: input.iat ?? nowSeconds,
    exp: input.exp ?? nowSeconds + 300,
    jti: input.jti ?? 'host_token_1',
    host: input.host ?? 's-sandbox1.sandbox.example.test',
    app_kind: 'seguro',
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
  const auditEvents: SandboxRouterAuditEvent[] = [];
  const servers: Array<{ server: Server; webSocketServer?: WebSocketServer }> = [];

  afterEach(async () => {
    await Promise.all(apps.map((app) => app.close()));
    await Promise.all(
      servers.map(
        ({ server, webSocketServer }) =>
          new Promise<void>((resolve, reject) => {
            webSocketServer?.clients.forEach((client) => client.terminate());
            webSocketServer?.close();
            server.close((error) => {
              if (error) {
                reject(error);
                return;
              }
              resolve();
            });
          }),
      ),
    );
    apps.length = 0;
    servers.length = 0;
    auditEvents.length = 0;
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
      auditSink: {
        record(event) {
          auditEvents.push(event);
        },
      },
    });
    apps.push(app);
    return app;
  }

  function timeoutAfter(ms: number, label: string) {
    return new Promise<never>((_resolve, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    });
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

  it('answers browser preflight requests before route-token verification', async () => {
    const app = buildApp();
    const response = await app.inject({
      method: 'OPTIONS',
      url: '/api/sandboxes/sandbox_1/api/workspaces',
      headers: {
        origin: 'https://remote-codex-frontend-production.up.railway.app',
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'authorization',
      },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe(
      'https://remote-codex-frontend-production.up.railway.app',
    );
    expect(response.headers['access-control-allow-methods']).toBe('GET,POST,PATCH,DELETE,OPTIONS');
    expect(response.headers['access-control-allow-headers']).toBe('authorization,content-type');
    expect(response.headers['access-control-max-age']).toBe('600');

    const debugResponse = await app.inject({
      method: 'OPTIONS',
      url: '/api/sandboxes/sandbox_1/api/threads/thread_1',
      headers: {
        origin: 'https://debug.lnz-study.com',
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'authorization',
      },
    });
    expect(debugResponse.statusCode).toBe(204);
    expect(debugResponse.headers['access-control-allow-origin']).toBe(
      'https://debug.lnz-study.com',
    );
  });

  it('does not add CORS headers for disallowed browser origins', async () => {
    const app = buildApp();
    const response = await app.inject({
      method: 'OPTIONS',
      url: '/api/sandboxes/sandbox_1/api/workspaces',
      headers: {
        origin: 'https://evil.example.test',
        'access-control-request-method': 'GET',
      },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rejects missing, invalid, expired, and wrong-sandbox route tokens', async () => {
    const app = buildApp();
    const missing = await app.inject({
      method: 'GET',
      url: '/api/sandboxes/sandbox_1/api/worker/metadata',
      headers: {
        origin: 'https://remote-codex-frontend-production.up.railway.app',
      },
    });
    expect(missing.statusCode).toBe(401);
    expect(missing.headers['access-control-allow-origin']).toBe(
      'https://remote-codex-frontend-production.up.railway.app',
    );

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
      project_id: 'project_1',
      scopes: ['provider:turn:create', 'file:write'],
    });

    const response = await app.inject({
      method: 'POST',
      url: `/api/sandboxes/sandbox_1/api/threads/thread_1/prompt?token=${encodeURIComponent(token)}&trace=1`,
      headers: {
        origin: 'https://remote-codex-frontend-production.up.railway.app',
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'x-remote-codex-worker-token': 'browser-forged-token',
        'x-remote-codex-user': 'browser-forged-user',
      },
      payload: {
        prompt: 'hello',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.headers['access-control-allow-origin']).toBe(
      'https://remote-codex-frontend-production.up.railway.app',
    );
    expect(response.json()).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe('https://worker.example.test/api/threads/thread_1/prompt?trace=1');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ prompt: 'hello' }));
    const headers = init.headers as Headers;
    expect(headers.get('authorization')).toBeNull();
    expect(headers.get('x-remote-codex-worker-token')).toBe('internal-worker-token');
    expect(headers.get('x-remote-codex-user')).toBe('user_1');
    expect(headers.get('x-remote-codex-project')).toBe('project_1');
    expect(headers.get('x-remote-codex-sandbox')).toBe('sandbox_1');
    expect(headers.get('x-remote-codex-scopes')).toBe('file:write,provider:turn:create');
    expect(headers.get('x-remote-codex-signature')).toEqual(expect.any(String));
    expect(auditEvents).toContainEqual(
      expect.objectContaining({
        action: 'proxy.forwarded',
        userId: 'user_1',
        sandboxId: 'sandbox_1',
        routeTokenId: 'token_1',
        method: 'POST',
        path: 'api/threads/thread_1/prompt',
        statusCode: 201,
        workerStatusCode: 201,
        scopes: ['provider:turn:create', 'file:write'],
      }),
    );
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
    expect(auditEvents).toContainEqual(
      expect.objectContaining({
        action: 'proxy.failed',
        code: 'worker_unavailable',
        userId: 'user_1',
        sandboxId: 'sandbox_1',
        routeTokenId: 'token_1',
        statusCode: 502,
      }),
    );
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

  it('bootstraps host-based access with an HTTP-only cookie', async () => {
    const app = buildApp();
    const token = hostRouteToken();
    const response = await app.inject({
      method: 'GET',
      url: `/__sandbox_access?token=${encodeURIComponent(token)}`,
      headers: {
        host: 's-sandbox1.sandbox.example.test',
      },
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe('/');
    expect(response.headers['set-cookie']).toContain('sandbox_access=');
    expect(response.headers['set-cookie']).toContain('HttpOnly');
    expect(response.headers['set-cookie']).toContain('Secure');
    expect(response.headers['set-cookie']).toContain('SameSite=Lax');
  });

  it('verifies host-based bootstrap tokens with the control-plane when configured', async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          payload: {
            sub: 'user_1',
            sandbox_id: 'sandbox_1',
            host: 's-sandbox1.sandbox.example.test',
          },
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
          },
        },
      ),
    );
    const app = buildSandboxRouterApp({
      env: testEnv({
        SANDBOX_ROUTER_CONTROL_PLANE_BASE_URL: 'https://remote-codex-control-plane.example.test',
        SANDBOX_ROUTER_CONTROL_PLANE_SERVICE_TOKEN: 'remote-codex-router-service-token',
        SANDBOX_ROUTER_HOST_CONTROL_PLANE_BASE_URL: 'https://seguro-control-plane.example.test',
        SANDBOX_ROUTER_HOST_CONTROL_PLANE_SERVICE_TOKEN: 'seguro-router-service-token',
      }),
    });
    apps.push(app);
    const token = hostRouteToken();

    const response = await app.inject({
      method: 'GET',
      url: `/__sandbox_access?token=${encodeURIComponent(token)}`,
      headers: {
        host: 's-sandbox1.sandbox.example.test',
      },
    });

    expect(response.statusCode).toBe(302);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [verifyUrl, verifyInit] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(verifyUrl.toString()).toBe(
      `https://seguro-control-plane.example.test/api/route-token/verify?token=${encodeURIComponent(token)}`,
    );
    expect((verifyInit.headers as Record<string, string>)['x-remote-codex-service-token']).toBe(
      'seguro-router-service-token',
    );
  });

  it('proxies host-based HTTP requests using the access cookie', async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(
      new Response('<html>Seguro</html>', {
        status: 200,
        headers: {
          'content-type': 'text/html',
        },
      }),
    );
    const app = buildApp();
    const token = hostRouteToken();

    const missingCookie = await app.inject({
      method: 'GET',
      url: '/',
      headers: {
        host: 's-sandbox1.sandbox.example.test',
      },
    });
    expect(missingCookie.statusCode).toBe(401);

    const response = await app.inject({
      method: 'GET',
      url: '/api/health?probe=1',
      headers: {
        host: 's-sandbox1.sandbox.example.test',
        cookie: `sandbox_access=${encodeURIComponent(token)}`,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('<html>Seguro</html>');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [workerUrl, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(workerUrl.toString()).toBe('https://worker.example.test/api/health?probe=1');
    const headers = init.headers as Headers;
    expect(headers.get('cookie')).toBeNull();
    expect(headers.get('x-remote-codex-worker-token')).toBe('internal-worker-token');
    expect(headers.get('x-remote-codex-sandbox')).toBe('sandbox_1');
  });

  it('rejects host-based access when the token host does not match the request host', async () => {
    const app = buildApp();
    const token = hostRouteToken({ host: 's-good.sandbox.example.test' });
    const response = await app.inject({
      method: 'GET',
      url: '/__sandbox_access?token=' + encodeURIComponent(token),
      headers: {
        host: 's-bad.sandbox.example.test',
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'wrong_host' });
  });

  it('streams event-stream worker responses without buffering the whole body first', async () => {
    vi.stubGlobal('fetch', fetchMock);
    const arrayBuffer = vi.fn();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: first\n\n'));
        controller.enqueue(new TextEncoder().encode('data: second\n\n'));
        controller.close();
      },
    });
    fetchMock.mockResolvedValue({
      status: 200,
      headers: new Headers({
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
      }),
      body: stream,
      arrayBuffer,
    });
    const app = buildApp();

    const response = await app.inject({
      method: 'GET',
      url: `/api/sandboxes/sandbox_1/api/events?token=${encodeURIComponent(routeToken())}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.headers['content-length']).toBeUndefined();
    expect(response.body).toBe('data: first\n\ndata: second\n\n');
    expect(arrayBuffer).not.toHaveBeenCalled();
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
    expect(auditEvents).toContainEqual(
      expect.objectContaining({
        action: 'proxy.denied',
        code: 'rate_limited',
        userId: 'user_1',
        sandboxId: 'sandbox_1',
        routeTokenId: 'token_1',
        statusCode: 429,
      }),
    );
  });

  it('proxies websocket traffic with internal worker headers and signed identity', async () => {
    const workerServer = createServer();
    const workerWebSocketServer = new WebSocketServer({ server: workerServer });
    servers.push({ server: workerServer, webSocketServer: workerWebSocketServer });
    const workerMessages: string[] = [];
    let workerRequestHeaders: Record<string, string | string[] | undefined> = {};
    workerWebSocketServer.on('connection', (socket, request) => {
      workerRequestHeaders = request.headers;
      socket.on('message', (message) => {
        workerMessages.push(message.toString());
        socket.send(`worker:${message.toString()}`);
      });
    });
    await new Promise<void>((resolve) => workerServer.listen(0, '127.0.0.1', resolve));
    const address = workerServer.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected local worker server address.');
    }
    const app = buildApp({
      async resolve() {
        return { workerBaseUrl: `http://127.0.0.1:${address.port}` };
      },
    });
    await app.ready();

    await app.listen({ host: '127.0.0.1', port: 0 });
    const routerAddress = app.server.address();
    if (!routerAddress || typeof routerAddress === 'string') {
      throw new Error('Expected local router server address.');
    }
    const socket = new WebSocket(
      `ws://127.0.0.1:${routerAddress.port}/api/sandboxes/sandbox_1/ws?token=${encodeURIComponent(routeToken({
        scopes: ['worker:read', 'worker:write'],
      }))}`,
      {
        headers: {
          authorization: 'Bearer browser-product-jwt',
          'x-remote-codex-worker-token': 'browser-forged-token',
          'x-remote-codex-user': 'browser-forged-user',
        },
      },
    );
    const message = await Promise.race([
      new Promise<string>((resolve, reject) => {
        socket.on('open', () => {
          socket.send('hello-worker');
        });
        socket.on('message', (data) => resolve(data.toString()));
        socket.on('error', reject);
        socket.on('close', (code, reason) => {
          reject(new Error(`client socket closed: ${code} ${reason.toString()}`));
        });
      }),
      timeoutAfter(1000, 'websocket response'),
    ]);

    expect(message).toBe('worker:hello-worker');
    expect(workerMessages).toEqual(['hello-worker']);
    expect(workerRequestHeaders.authorization).toBeUndefined();
    expect(workerRequestHeaders['x-remote-codex-worker-token']).toBe('internal-worker-token');
    expect(workerRequestHeaders['x-remote-codex-user']).toBe('user_1');
    expect(workerRequestHeaders['x-remote-codex-sandbox']).toBe('sandbox_1');
    expect(workerRequestHeaders['x-remote-codex-scopes']).toBe('worker:read,worker:write');
    expect(workerRequestHeaders['x-remote-codex-signature']).toEqual(expect.any(String));
    expect(auditEvents).toContainEqual(
      expect.objectContaining({
        action: 'proxy.forwarded',
        statusCode: 101,
        workerStatusCode: 101,
        path: 'ws',
      }),
    );
    socket.terminate();
    workerWebSocketServer.close();
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

  it('forwards hook callbacks without a route token and without internal headers', async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ accepted: true }), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const app = buildApp();
    // Raw bytes must reach the worker untouched: the harness HMAC signature is
    // computed over Python json.dumps output, which JSON.stringify cannot
    // reproduce.
    const rawBody = '{"type": "notification", "id": 7, "from": "jobs", "message": "id: job-1"}';

    const response = await app.inject({
      method: 'POST',
      url: '/api/sandboxes/sandbox_1/hooks/harness-notify/hook-token-1?u=user_1',
      headers: {
        'content-type': 'application/json',
        'x-webhook-signature': 'abc123',
        'x-remote-codex-worker-token': 'forged-token',
      },
      payload: rawBody,
    });

    expect(response.statusCode).toBe(202);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe(
      'https://worker.example.test/api/hooks/harness-notify/hook-token-1',
    );
    expect(init.method).toBe('POST');
    expect(Buffer.from(init.body as Uint8Array).toString('utf8')).toBe(rawBody);
    const headers = init.headers as Headers;
    expect(headers.get('x-webhook-signature')).toBe('abc123');
    expect(headers.get('x-remote-codex-worker-token')).toBeNull();
    expect(headers.get('x-remote-codex-user')).toBeNull();
    expect(headers.get('x-remote-codex-signature')).toBeNull();
    expect(auditEvents).toContainEqual(
      expect.objectContaining({
        action: 'hook.forwarded',
        sandboxId: 'sandbox_1',
        userId: 'user_1',
        path: 'harness-notify/hook-token-1',
        statusCode: 202,
      }),
    );
  });

  it('requires the u parameter for hooks when the control-plane resolver is configured', async () => {
    const app = buildApp(undefined, {
      SANDBOX_ROUTER_CONTROL_PLANE_BASE_URL: 'https://control-plane.example.test',
      SANDBOX_ROUTER_CONTROL_PLANE_SERVICE_TOKEN: 'service-token-0123456789abcdef',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/sandboxes/sandbox_1/hooks/harness-notify/hook-token-1',
      headers: { 'content-type': 'application/json' },
      payload: '{}',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'missing_user' });
  });

  it('rate limits hook callbacks per sandbox', async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(new Response('{}', { status: 202 }));
    const app = buildApp(undefined, {
      SANDBOX_ROUTER_RATE_LIMIT_REQUESTS: '1',
    });

    const first = await app.inject({
      method: 'POST',
      url: '/api/sandboxes/sandbox_1/hooks/harness-notify/hook-token-1',
      headers: { 'content-type': 'application/json' },
      payload: '{}',
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/sandboxes/sandbox_1/hooks/harness-notify/hook-token-1',
      headers: { 'content-type': 'application/json' },
      payload: '{}',
    });

    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(429);
  });

  it('still requires route tokens on non-hook proxy paths', async () => {
    const app = buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/sandboxes/sandbox_1/api/threads/thread_1/prompt',
      headers: { 'content-type': 'application/json' },
      payload: '{}',
    });
    expect(response.statusCode).toBe(401);
  });
});
