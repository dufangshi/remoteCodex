import path from 'node:path';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).optional(),
  HOST: z.string().min(1).optional(),
  PORT: z.coerce.number().int().positive().optional(),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).optional(),
  DISABLE_REQUEST_LOGGING: z.string().optional(),
  CONTROL_PLANE_DATABASE_URL: z.string().optional(),
  DATABASE_URL: z.string().optional(),
  CONTROL_PLANE_JWT_SECRET: z.string().min(16).optional(),
  CONTROL_PLANE_JWT_SECRET_ID: z.string().min(1).optional(),
  CONTROL_PLANE_JWT_PREVIOUS_SECRETS: z.string().optional(),
  SANDBOX_ROUTER_BASE_URL: z.string().url().optional(),
  SANDBOX_ROUTE_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().optional(),
  SANDBOX_DEFAULT_IMAGE: z.string().min(1).optional(),
  SANDBOX_DEFAULT_REGION: z.string().min(1).optional(),
  SANDBOX_S3_PREFIX_BASE: z.string().min(1).optional(),
  CONTROL_PLANE_ADMIN_IDENTITIES: z.string().optional(),
  CONTROL_PLANE_AUTH_MODE: z.enum(['dev', 'jwt']).optional(),
  CONTROL_PLANE_AUTH_JWT_SECRET: z.string().min(16).optional(),
  CONTROL_PLANE_AUTH_JWT_PROVIDER: z.string().min(1).optional(),
  CONTROL_PLANE_AUTH_JWT_ISSUER: z.string().min(1).optional(),
  CONTROL_PLANE_AUTH_JWT_AUDIENCE: z.string().min(1).optional(),
  CONTROL_PLANE_AUTH_JWT_CLOCK_SKEW_SECONDS: z.coerce.number().int().nonnegative().optional(),
});

export interface ControlPlaneConfig {
  nodeEnv: 'development' | 'test' | 'production';
  host: string;
  port: number;
  logLevel: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  disableRequestLogging: boolean;
  databaseUrl: string;
  jwtSecret: string;
  routerBaseUrl: string;
  routeTokenTtlSeconds: number;
  sandboxDefaultImage: string;
  sandboxDefaultRegion: string;
  sandboxS3PrefixBase: string;
  adminIdentities: Set<string>;
  authMode: 'dev' | 'jwt';
  authJwtSecret: string | null;
  authJwtProvider: string;
  authJwtIssuer: string | null;
  authJwtAudience: string | null;
  authJwtClockSkewSeconds: number;
  routeTokenSigningKeys: Array<{ id: string; secret: string }>;
}

function parsePreviousSigningKeys(value: string | undefined) {
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

export function loadControlPlaneConfig(
  env: NodeJS.ProcessEnv = process.env,
): ControlPlaneConfig {
  const parsed = envSchema.parse(env);
  const nodeEnv = parsed.NODE_ENV ?? 'development';
  const disableRequestLogging =
    parsed.DISABLE_REQUEST_LOGGING === undefined
      ? nodeEnv === 'production'
      : ['1', 'true', 'yes', 'on'].includes(parsed.DISABLE_REQUEST_LOGGING.toLowerCase());

  const jwtSecret =
    parsed.CONTROL_PLANE_JWT_SECRET ??
    'dev-control-plane-route-token-secret';
  const routeTokenSigningKeys = [
    {
      id: parsed.CONTROL_PLANE_JWT_SECRET_ID ?? 'current',
      secret: jwtSecret,
    },
    ...parsePreviousSigningKeys(parsed.CONTROL_PLANE_JWT_PREVIOUS_SECRETS),
  ];
  const signingKeyIds = new Set<string>();
  for (const key of routeTokenSigningKeys) {
    if (signingKeyIds.has(key.id)) {
      throw new Error(`Duplicate route-token signing key id: ${key.id}`);
    }
    if (key.secret.length < 16) {
      throw new Error(`Route-token signing key ${key.id} must be at least 16 characters.`);
    }
    signingKeyIds.add(key.id);
  }

  return {
    nodeEnv,
    host: parsed.HOST ?? '127.0.0.1',
    port: parsed.PORT ?? 8790,
    logLevel: parsed.LOG_LEVEL ?? (nodeEnv === 'production' ? 'warn' : 'info'),
    disableRequestLogging,
    databaseUrl: path.resolve(
      parsed.CONTROL_PLANE_DATABASE_URL ??
        parsed.DATABASE_URL ??
        path.join('.local', 'control-plane-dev.sqlite'),
    ),
    jwtSecret,
    routerBaseUrl: parsed.SANDBOX_ROUTER_BASE_URL ?? 'http://127.0.0.1:8791',
    routeTokenTtlSeconds: parsed.SANDBOX_ROUTE_TOKEN_TTL_SECONDS ?? 300,
    sandboxDefaultImage:
      parsed.SANDBOX_DEFAULT_IMAGE ?? 'remote-codex-worker:development',
    sandboxDefaultRegion: parsed.SANDBOX_DEFAULT_REGION ?? 'us-east-1',
    sandboxS3PrefixBase:
      parsed.SANDBOX_S3_PREFIX_BASE ?? 's3://remote-codex-sandboxes/dev',
    adminIdentities: new Set(
      (parsed.CONTROL_PLANE_ADMIN_IDENTITIES ?? '')
        .split(',')
        .map((identity) => identity.trim())
        .filter(Boolean),
    ),
    authMode: parsed.CONTROL_PLANE_AUTH_MODE ?? 'dev',
    authJwtSecret: parsed.CONTROL_PLANE_AUTH_JWT_SECRET ?? null,
    authJwtProvider: parsed.CONTROL_PLANE_AUTH_JWT_PROVIDER ?? 'jwt',
    authJwtIssuer: parsed.CONTROL_PLANE_AUTH_JWT_ISSUER ?? null,
    authJwtAudience: parsed.CONTROL_PLANE_AUTH_JWT_AUDIENCE ?? null,
    authJwtClockSkewSeconds: parsed.CONTROL_PLANE_AUTH_JWT_CLOCK_SKEW_SECONDS ?? 60,
    routeTokenSigningKeys,
  };
}
