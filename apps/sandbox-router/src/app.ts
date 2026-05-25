import { Readable } from 'node:stream';

import Fastify, { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z, ZodError } from 'zod';

import type { RouteTokenPayload } from '../../../packages/shared/src/index';
import { verifySignedTokenWithKeys } from '../../../packages/shared/src/index';
import { loadSandboxRouterConfig, SandboxRouterConfig } from './config';
import {
  WORKER_IDENTITY_HEADERS,
  workerIdentityHeadersForRouteToken,
} from './worker-identity';

const INTERNAL_WORKER_HEADERS = new Set([
  'x-remote-codex-worker-token',
  ...Object.values(WORKER_IDENTITY_HEADERS),
]);

class RouterHttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface SandboxEndpointResolver {
  resolve(input: { sandboxId: string; routeToken: RouteTokenPayload }): Promise<{
    workerBaseUrl: string | null;
  }>;
}

class StaticSandboxEndpointResolver implements SandboxEndpointResolver {
  constructor(private readonly config: SandboxRouterConfig) {}

  async resolve(input: { sandboxId: string }) {
    return {
      workerBaseUrl:
        this.config.staticEndpoints.get(input.sandboxId) ??
        this.config.defaultWorkerBaseUrl,
    };
  }
}

class ControlPlaneSandboxEndpointResolver implements SandboxEndpointResolver {
  constructor(private readonly config: SandboxRouterConfig) {}

  async resolve(input: { sandboxId: string; routeToken: RouteTokenPayload }) {
    if (!this.config.controlPlaneBaseUrl || !this.config.controlPlaneServiceToken) {
      return new StaticSandboxEndpointResolver(this.config).resolve(input);
    }

    const base = this.config.controlPlaneBaseUrl.endsWith('/')
      ? this.config.controlPlaneBaseUrl
      : `${this.config.controlPlaneBaseUrl}/`;
    const url = new URL(
      `api/internal/sandboxes/${encodeURIComponent(input.sandboxId)}/endpoint`,
      base,
    );
    url.searchParams.set('userId', input.routeToken.sub);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'x-remote-codex-service-token': this.config.controlPlaneServiceToken,
      },
    });
    if (response.status === 404 || response.status === 409) {
      return { workerBaseUrl: null };
    }
    if (!response.ok) {
      throw new RouterHttpError(
        502,
        'sandbox_registry_error',
        'Sandbox registry lookup failed.',
      );
    }

    const body = z.object({
      sandboxId: z.string().min(1),
      userId: z.string().min(1),
      workerBaseUrl: z.string().url(),
    }).parse(await response.json());
    if (body.sandboxId !== input.sandboxId || body.userId !== input.routeToken.sub) {
      throw new RouterHttpError(
        502,
        'sandbox_registry_mismatch',
        'Sandbox registry returned a mismatched endpoint.',
      );
    }
    return { workerBaseUrl: body.workerBaseUrl };
  }
}

export interface SandboxRouterServices {
  config: SandboxRouterConfig;
  endpointResolver: SandboxEndpointResolver;
  rateLimiter: FixedWindowRateLimiter;
  auditSink: SandboxRouterAuditSink;
}

declare module 'fastify' {
  interface FastifyInstance {
    services: SandboxRouterServices;
  }
}

class FixedWindowRateLimiter {
  private readonly buckets = new Map<string, { count: number; resetAtMs: number }>();

  constructor(
    private readonly input: {
      limit: number;
      windowMs: number;
      nowMs?: () => number;
    },
  ) {}

  consume(key: string) {
    const now = this.input.nowMs?.() ?? Date.now();
    const existing = this.buckets.get(key);
    if (!existing || existing.resetAtMs <= now) {
      this.buckets.set(key, {
        count: 1,
        resetAtMs: now + this.input.windowMs,
      });
      return { allowed: true, remaining: this.input.limit - 1, resetAtMs: now + this.input.windowMs };
    }

    if (existing.count >= this.input.limit) {
      return { allowed: false, remaining: 0, resetAtMs: existing.resetAtMs };
    }

    existing.count += 1;
    return {
      allowed: true,
      remaining: this.input.limit - existing.count,
      resetAtMs: existing.resetAtMs,
    };
  }
}

export interface SandboxRouterAuditEvent {
  action: 'proxy.forwarded' | 'proxy.denied' | 'proxy.failed';
  userId: string | null;
  sandboxId: string | null;
  routeTokenId: string | null;
  method: string;
  path: string;
  statusCode: number;
  code?: string | undefined;
  workerStatusCode?: number | undefined;
  scopes?: string[] | undefined;
}

export interface SandboxRouterAuditSink {
  record(event: SandboxRouterAuditEvent, request: FastifyRequest): void;
}

class LoggingSandboxRouterAuditSink implements SandboxRouterAuditSink {
  record(event: SandboxRouterAuditEvent, request: FastifyRequest) {
    request.log.info(
      {
        audit: true,
        service: 'sandbox-router',
        ...event,
      },
      'sandbox router audit event',
    );
  }
}

function readRouteToken(request: FastifyRequest) {
  const header = request.headers.authorization;
  const bearer = typeof header === 'string'
    ? /^Bearer\s+(.+)$/i.exec(header)?.[1]
    : null;
  const query = z.object({ token: z.string().min(1).optional() }).parse(request.query);
  return bearer ?? query.token ?? null;
}

function parseProxyParams(params: unknown) {
  return z.object({
    sandboxId: z.string().min(1),
    '*': z.string().optional(),
  }).parse(params);
}

function verifyRouteTokenForRequest(request: FastifyRequest) {
  const token = readRouteToken(request);
  if (!token) {
    throw new RouterHttpError(401, 'missing_route_token', 'Route token is required.');
  }

  try {
    const payload = verifySignedTokenWithKeys<RouteTokenPayload>(
      token,
      request.server.services.config.routeTokenSigningKeys,
    );
    const params = parseProxyParams(request.params);
    if (payload.sandbox_id !== params.sandboxId) {
      throw new RouterHttpError(403, 'wrong_sandbox', 'Route token does not match this sandbox.');
    }
    return {
      payload,
      path: params['*'] ?? '',
    };
  } catch (error) {
    if (error instanceof RouterHttpError) {
      throw error;
    }
    throw new RouterHttpError(401, 'invalid_route_token', 'Route token is invalid or expired.');
  }
}

function copyForwardHeaders(request: FastifyRequest) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    const lowerName = name.toLowerCase();
    if (
      lowerName === 'host' ||
      lowerName === 'authorization' ||
      lowerName === 'content-length' ||
      lowerName === 'connection' ||
      lowerName === 'upgrade' ||
      INTERNAL_WORKER_HEADERS.has(lowerName)
    ) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        headers.append(name, entry);
      }
      continue;
    }
    if (value !== undefined) {
      headers.set(name, String(value));
    }
  }
  return headers;
}

function buildWorkerUrl(workerBaseUrl: string, pathSuffix: string, request: FastifyRequest) {
  const base = workerBaseUrl.endsWith('/') ? workerBaseUrl : `${workerBaseUrl}/`;
  const url = new URL(pathSuffix, base);
  const incoming = new URL(request.url, 'http://router.local');
  incoming.searchParams.delete('token');
  url.search = incoming.searchParams.toString();
  return url;
}

function serializedRequestBody(request: FastifyRequest, maxBytes: number) {
  if (['GET', 'HEAD'].includes(request.method)) {
    return undefined;
  }

  const body = JSON.stringify(request.body ?? {});
  const byteLength = Buffer.byteLength(body);
  if (byteLength > maxBytes) {
    throw new RouterHttpError(
      413,
      'request_too_large',
      `Request body exceeds the sandbox router limit of ${maxBytes} bytes.`,
    );
  }
  return body;
}

function auditRoute(
  request: FastifyRequest,
  event: SandboxRouterAuditEvent,
) {
  request.server.services.auditSink.record(event, request);
}

function enforceRateLimit(request: FastifyRequest, payload: RouteTokenPayload) {
  const { config, rateLimiter } = request.server.services;
  const key = `${payload.sub}:${payload.sandbox_id}`;
  const result = rateLimiter.consume(key);
  if (!result.allowed) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((result.resetAtMs - Date.now()) / 1000),
    );
    throw new RouterHttpError(
      429,
      'rate_limited',
      `Too many sandbox router requests. Retry after ${retryAfterSeconds} seconds.`,
    );
  }
  request.log.debug(
    {
      userId: payload.sub,
      sandboxId: payload.sandbox_id,
      remaining: result.remaining,
      windowMs: config.rateLimitWindowMs,
    },
    'sandbox router rate limit consumed',
  );
}

function isEventStreamResponse(response: Response) {
  return response.headers.get('content-type')?.toLowerCase().includes('text/event-stream') ?? false;
}

function copyResponseHeaders(response: Response, reply: FastifyReply) {
  response.headers.forEach((value, name) => {
    if (name.toLowerCase() === 'content-length') {
      return;
    }
    reply.header(name, value);
  });
}

async function proxyRequest(request: FastifyRequest) {
  const { payload, path } = verifyRouteTokenForRequest(request);
  try {
    enforceRateLimit(request, payload);
  } catch (error) {
    if (error instanceof RouterHttpError) {
      auditRoute(request, {
        action: 'proxy.denied',
        userId: payload.sub,
        sandboxId: payload.sandbox_id,
        routeTokenId: payload.jti,
        method: request.method,
        path,
        statusCode: error.statusCode,
        code: error.code,
        scopes: payload.scopes,
      });
    }
    throw error;
  }
  const { config, endpointResolver } = request.server.services;
  const endpoint = await endpointResolver.resolve({
    sandboxId: payload.sandbox_id,
    routeToken: payload,
  });
  if (!endpoint.workerBaseUrl) {
    auditRoute(request, {
      action: 'proxy.failed',
      userId: payload.sub,
      sandboxId: payload.sandbox_id,
      routeTokenId: payload.jti,
      method: request.method,
      path,
      statusCode: 502,
      code: 'worker_unavailable',
      scopes: payload.scopes,
    });
    throw new RouterHttpError(502, 'worker_unavailable', 'Sandbox worker endpoint is unavailable.');
  }

  const headers = copyForwardHeaders(request);
  if (config.workerAuthToken) {
    headers.set('x-remote-codex-worker-token', config.workerAuthToken);
  }
  if (config.workerIdentitySecret) {
    const identityHeaders = workerIdentityHeadersForRouteToken(
      payload,
      config.workerIdentitySecret,
    );
    for (const [name, value] of Object.entries(identityHeaders)) {
      headers.set(name, value);
    }
  }

  const init: RequestInit = {
    method: request.method,
    headers,
  };
  const body = serializedRequestBody(request, config.maxRequestBytes);
  if (body !== undefined) {
    init.body = body;
  }

  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), config.upstreamTimeoutMs);
  try {
    const response = await fetch(buildWorkerUrl(endpoint.workerBaseUrl, path, request), {
      ...init,
      signal: abortController.signal,
    });
    auditRoute(request, {
      action: 'proxy.forwarded',
      userId: payload.sub,
      sandboxId: payload.sandbox_id,
      routeTokenId: payload.jti,
      method: request.method,
      path,
      statusCode: response.status,
      workerStatusCode: response.status,
      scopes: payload.scopes,
    });
    return response;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      auditRoute(request, {
        action: 'proxy.failed',
        userId: payload.sub,
        sandboxId: payload.sandbox_id,
        routeTokenId: payload.jti,
        method: request.method,
        path,
        statusCode: 504,
        code: 'worker_timeout',
        scopes: payload.scopes,
      });
      throw new RouterHttpError(
        504,
        'worker_timeout',
        'Sandbox worker did not respond before the router timeout.',
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function buildSandboxRouterApp(options: {
  env?: NodeJS.ProcessEnv;
  endpointResolver?: SandboxEndpointResolver;
  auditSink?: SandboxRouterAuditSink;
} = {}) {
  const config = loadSandboxRouterConfig(options.env);
  const app = Fastify({
    logger:
      config.nodeEnv === 'test'
        ? false
        : {
            level: config.logLevel,
          },
    disableRequestLogging: config.disableRequestLogging,
  });

  app.decorate('services', {
    config,
    endpointResolver: options.endpointResolver ?? new ControlPlaneSandboxEndpointResolver(config),
    rateLimiter: new FixedWindowRateLimiter({
      limit: config.rateLimitRequests,
      windowMs: config.rateLimitWindowMs,
    }),
    auditSink: options.auditSink ?? new LoggingSandboxRouterAuditSink(),
  });

  app.get('/healthz', async () => ({ ok: true, role: 'sandbox-router' }));
  app.all('/api/sandboxes/:sandboxId/*', async (request, reply) => {
    const response = await proxyRequest(request);
    reply.status(response.status);
    copyResponseHeaders(response, reply);
    if (isEventStreamResponse(response) && response.body) {
      return reply.send(Readable.fromWeb(response.body as unknown as Parameters<typeof Readable.fromWeb>[0]));
    }
    return reply.send(Buffer.from(await response.arrayBuffer()));
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof RouterHttpError) {
      reply.status(error.statusCode).send({
        code: error.code,
        message: error.message,
      });
      return;
    }

    if (error instanceof ZodError) {
      reply.status(400).send({
        code: 'bad_request',
        message: 'The request payload is invalid.',
        details: {
          issues: error.issues,
        },
      });
      return;
    }

    reply.status(500).send({
      code: 'internal_error',
      message: 'An unexpected router error occurred.',
    });
  });

  return app;
}
