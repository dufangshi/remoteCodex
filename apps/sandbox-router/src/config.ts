import { z } from 'zod';

import type { SigningKey } from '../../../packages/shared/src/tokens';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).optional(),
  HOST: z.string().min(1).optional(),
  PORT: z.coerce.number().int().positive().optional(),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).optional(),
  DISABLE_REQUEST_LOGGING: z.string().optional(),
  CONTROL_PLANE_JWT_SECRET: z.string().min(16).optional(),
  CONTROL_PLANE_JWT_SECRET_ID: z.string().min(1).optional(),
  CONTROL_PLANE_JWT_PREVIOUS_SECRETS: z.string().optional(),
  SANDBOX_ROUTER_WORKER_AUTH_TOKEN: z.string().min(1).optional(),
  SANDBOX_ROUTER_WORKER_IDENTITY_SECRET: z.string().min(1).optional(),
  SANDBOX_ROUTER_STATIC_ENDPOINTS: z.string().optional(),
  SANDBOX_ROUTER_DEFAULT_WORKER_BASE_URL: z.string().url().optional(),
  SANDBOX_ROUTER_CONTROL_PLANE_BASE_URL: z.string().url().optional(),
  SANDBOX_ROUTER_CONTROL_PLANE_SERVICE_TOKEN: z.string().min(16).optional(),
  SANDBOX_ROUTER_MAX_REQUEST_BYTES: z.coerce.number().int().positive().optional(),
  SANDBOX_ROUTER_UPSTREAM_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
  SANDBOX_ROUTER_RATE_LIMIT_REQUESTS: z.coerce.number().int().positive().optional(),
  SANDBOX_ROUTER_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().optional(),
});

export interface SandboxRouterConfig {
  nodeEnv: 'development' | 'test' | 'production';
  host: string;
  port: number;
  logLevel: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  disableRequestLogging: boolean;
  routeTokenSigningKeys: SigningKey[];
  workerAuthToken: string | null;
  workerIdentitySecret: string | null;
  staticEndpoints: Map<string, string>;
  defaultWorkerBaseUrl: string | null;
  controlPlaneBaseUrl: string | null;
  controlPlaneServiceToken: string | null;
  maxRequestBytes: number;
  upstreamTimeoutMs: number;
  rateLimitRequests: number;
  rateLimitWindowMs: number;
}

function parseBoolean(value: string | undefined, defaultValue: boolean) {
  if (value === undefined) {
    return defaultValue;
  }
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function parsePreviousSigningKeys(value: string | undefined): SigningKey[] {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const separator = entry.indexOf(':');
      if (separator <= 0 || separator === entry.length - 1) {
        throw new Error('CONTROL_PLANE_JWT_PREVIOUS_SECRETS entries must use kid:secret format.');
      }
      return {
        id: entry.slice(0, separator),
        secret: entry.slice(separator + 1),
      };
    });
}

function parseStaticEndpoints(value: string | undefined) {
  const endpoints = new Map<string, string>();
  if (!value) {
    return endpoints;
  }

  for (const rawEntry of value.split(',')) {
    const entry = rawEntry.trim();
    if (!entry) {
      continue;
    }
    const separator = entry.indexOf('=');
    if (separator <= 0 || separator === entry.length - 1) {
      throw new Error('SANDBOX_ROUTER_STATIC_ENDPOINTS entries must use sandboxId=url format.');
    }
    const sandboxId = entry.slice(0, separator);
    const workerBaseUrl = entry.slice(separator + 1);
    new URL(workerBaseUrl);
    endpoints.set(sandboxId, workerBaseUrl);
  }

  return endpoints;
}

function routeTokenSigningKeys(parsed: z.infer<typeof envSchema>) {
  const keys: SigningKey[] = [
    {
      id: parsed.CONTROL_PLANE_JWT_SECRET_ID ?? 'current',
      secret: parsed.CONTROL_PLANE_JWT_SECRET ?? 'dev-control-plane-route-token-secret',
    },
    ...parsePreviousSigningKeys(parsed.CONTROL_PLANE_JWT_PREVIOUS_SECRETS),
  ];
  const seen = new Set<string>();
  for (const key of keys) {
    if (seen.has(key.id)) {
      throw new Error(`Duplicate route-token signing key id: ${key.id}`);
    }
    if (key.secret.length < 16) {
      throw new Error(`Route-token signing key ${key.id} must be at least 16 characters.`);
    }
    seen.add(key.id);
  }
  return keys;
}

export function loadSandboxRouterConfig(
  env: NodeJS.ProcessEnv = process.env,
): SandboxRouterConfig {
  const parsed = envSchema.parse(env);
  const nodeEnv = parsed.NODE_ENV ?? 'development';
  if (
    Boolean(parsed.SANDBOX_ROUTER_CONTROL_PLANE_BASE_URL) !==
    Boolean(parsed.SANDBOX_ROUTER_CONTROL_PLANE_SERVICE_TOKEN)
  ) {
    throw new Error(
      'SANDBOX_ROUTER_CONTROL_PLANE_BASE_URL and SANDBOX_ROUTER_CONTROL_PLANE_SERVICE_TOKEN must be configured together.',
    );
  }

  return {
    nodeEnv,
    host: parsed.HOST ?? '127.0.0.1',
    port: parsed.PORT ?? 8791,
    logLevel: parsed.LOG_LEVEL ?? (nodeEnv === 'production' ? 'warn' : 'info'),
    disableRequestLogging: parseBoolean(parsed.DISABLE_REQUEST_LOGGING, nodeEnv === 'production'),
    routeTokenSigningKeys: routeTokenSigningKeys(parsed),
    workerAuthToken: parsed.SANDBOX_ROUTER_WORKER_AUTH_TOKEN ?? null,
    workerIdentitySecret: parsed.SANDBOX_ROUTER_WORKER_IDENTITY_SECRET ?? null,
    staticEndpoints: parseStaticEndpoints(parsed.SANDBOX_ROUTER_STATIC_ENDPOINTS),
    defaultWorkerBaseUrl: parsed.SANDBOX_ROUTER_DEFAULT_WORKER_BASE_URL ?? null,
    controlPlaneBaseUrl: parsed.SANDBOX_ROUTER_CONTROL_PLANE_BASE_URL ?? null,
    controlPlaneServiceToken: parsed.SANDBOX_ROUTER_CONTROL_PLANE_SERVICE_TOKEN ?? null,
    maxRequestBytes: parsed.SANDBOX_ROUTER_MAX_REQUEST_BYTES ?? 1024 * 1024 * 8,
    upstreamTimeoutMs: parsed.SANDBOX_ROUTER_UPSTREAM_TIMEOUT_MS ?? 1000 * 60,
    rateLimitRequests: parsed.SANDBOX_ROUTER_RATE_LIMIT_REQUESTS ?? 120,
    rateLimitWindowMs: parsed.SANDBOX_ROUTER_RATE_LIMIT_WINDOW_MS ?? 1000 * 60,
  };
}
