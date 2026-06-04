import path from 'node:path';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).optional(),
  HOST: z.string().min(1).optional(),
  PORT: z.coerce.number().int().positive().optional(),
  LOG_LEVEL: z
    .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal'])
    .optional(),
  DISABLE_REQUEST_LOGGING: z.string().optional(),
  CONTROL_PLANE_DATABASE_URL: z.string().optional(),
  DATABASE_URL: z.string().optional(),
  CONTROL_PLANE_JWT_SECRET: z.string().min(16).optional(),
  CONTROL_PLANE_JWT_SECRET_ID: z.string().min(1).optional(),
  CONTROL_PLANE_JWT_PREVIOUS_SECRETS: z.string().optional(),
  SANDBOX_ROUTER_BASE_URL: z.string().url().optional(),
  SANDBOX_ROUTE_TOKEN_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .optional(),
  SANDBOX_DEFAULT_IMAGE: z.string().min(1).optional(),
  SANDBOX_DEFAULT_REGION: z.string().min(1).optional(),
  SANDBOX_DEFAULT_RESOURCE_PROFILE: z
    .enum(['small', 'standard', 'large'])
    .optional(),
  SANDBOX_S3_PREFIX_BASE: z.string().min(1).optional(),
  SANDBOX_WORKER_INTERNAL_PORT: z.coerce.number().int().positive().optional(),
  SANDBOX_WORKER_ENABLED_AGENT_PROVIDERS: z.string().optional(),
  SANDBOX_WORKER_DEFAULT_CODEX_MODEL: z.string().trim().min(1).optional(),
  SANDBOX_WORKER_DEFAULT_REASONING_EFFORT: z
    .enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh'])
    .optional(),
  SANDBOX_WORKER_AUTH_TOKEN: z.string().min(1).optional(),
  SANDBOX_WORKER_IDENTITY_SECRET: z.string().min(1).optional(),
  CONTROL_PLANE_INTERNAL_SERVICE_TOKEN: z.string().min(16).optional(),
  LLM_GATEWAY_BASE_URL: z.string().url().optional(),
  LLM_GATEWAY_PROVIDER: z.string().trim().min(1).optional(),
  LLM_GATEWAY_TOKEN_SECRET_NAME: z.string().min(1).optional(),
  LLM_GATEWAY_STATIC_TOKEN_SECRET_KEY: z.string().min(1).optional(),
  LLM_GATEWAY_STATIC_TOKEN: z.string().min(1).optional(),
  LLM_GATEWAY_ADMIN_BASE_URL: z.string().url().optional(),
  LLM_GATEWAY_ADMIN_TOKEN: z.string().min(1).optional(),
  LLM_GATEWAY_GROUP_ID: z.coerce.number().int().positive().optional(),
  ELAGENTE_HARNESS_BASE_URL: z.string().url().optional(),
  ELAGENTE_HARNESS_PROVIDER: z.string().trim().min(1).optional(),
  ELAGENTE_HARNESS_APP_KEY_SECRET_NAME: z.string().min(1).optional(),
  ELAGENTE_HARNESS_ADMIN_BASE_URL: z.string().url().optional(),
  ELAGENTE_HARNESS_ADMIN_KEY: z.string().min(1).optional(),
  ELAGENTE_HARNESS_LEGACY_ADMIN_FALLBACK: z.string().optional(),
  REMOTE_CODEX_CHEMISTRY_TOOLS_ENABLED: z.string().optional(),
  CONTROL_PLANE_ADMIN_IDENTITIES: z.string().optional(),
  CONTROL_PLANE_AUTH_MODE: z.enum(['dev', 'jwt']).optional(),
  CONTROL_PLANE_AUTH_JWT_SECRET: z.string().min(16).optional(),
  CONTROL_PLANE_AUTH_JWT_PROVIDER: z.string().min(1).optional(),
  CONTROL_PLANE_AUTH_JWT_ISSUER: z.string().min(1).optional(),
  CONTROL_PLANE_AUTH_JWT_AUDIENCE: z.string().min(1).optional(),
  CONTROL_PLANE_AUTH_JWT_CLOCK_SKEW_SECONDS: z.coerce
    .number()
    .int()
    .nonnegative()
    .optional(),
  CONTROL_PLANE_PRODUCT_SESSION_SECRET: z.string().min(16).optional(),
  CONTROL_PLANE_PRODUCT_SESSION_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .optional(),
  CONTROL_PLANE_PUBLIC_BASE_URL: z.string().url().optional(),
  CONTROL_PLANE_FRONTEND_BASE_URL: z.string().url().optional(),
  CONTROL_PLANE_GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  CONTROL_PLANE_GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  CONTROL_PLANE_GITHUB_CLIENT_ID: z.string().min(1).optional(),
  CONTROL_PLANE_GITHUB_CLIENT_SECRET: z.string().min(1).optional(),
  CONTROL_PLANE_CORS_ALLOWED_ORIGINS: z.string().optional(),
  CONTROL_PLANE_BUILD_SHA: z.string().min(1).optional(),
});

const DEFAULT_CORS_ALLOWED_ORIGINS = [
  'http://127.0.0.1:5173',
  'http://localhost:5173',
  'https://debug.lnz-study.com',
  'https://remote-codex-frontend-production.up.railway.app',
];

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
  sandboxDefaultResourceProfile: 'small' | 'standard' | 'large';
  sandboxS3PrefixBase: string;
  sandboxWorkerInternalPort: number;
  sandboxWorkerEnabledAgentProviders: string;
  sandboxWorkerDefaultCodexModel: string;
  sandboxWorkerDefaultReasoningEffort:
    | 'none'
    | 'minimal'
    | 'low'
    | 'medium'
    | 'high'
    | 'xhigh';
  sandboxWorkerAuthToken: string | null;
  sandboxWorkerIdentitySecret: string | null;
  internalServiceToken: string | null;
  llmGatewayBaseUrl: string | null;
  llmGatewayProvider: string;
  llmGatewayTokenSecretName: string | null;
  llmGatewayStaticTokenSecretKey: string | null;
  llmGatewayStaticToken: string | null;
  llmGatewayAdminBaseUrl: string | null;
  llmGatewayAdminToken: string | null;
  llmGatewayGroupId: number | null;
  harnessBaseUrl: string | null;
  harnessProvider: string;
  harnessAppKeySecretName: string | null;
  harnessAdminBaseUrl: string | null;
  harnessAdminKey: string | null;
  harnessLegacyAdminFallback: boolean;
  chemistryToolsEnabled: boolean;
  adminIdentities: Set<string>;
  authMode: 'dev' | 'jwt';
  authJwtSecret: string | null;
  authJwtProvider: string;
  authJwtIssuer: string | null;
  authJwtAudience: string | null;
  authJwtClockSkewSeconds: number;
  productSessionSecret: string;
  productSessionTtlSeconds: number;
  publicBaseUrl: string;
  frontendBaseUrl: string | null;
  googleClientId: string | null;
  googleClientSecret: string | null;
  githubClientId: string | null;
  githubClientSecret: string | null;
  routeTokenSigningKeys: Array<{ id: string; secret: string }>;
  corsAllowedOrigins: Set<string>;
  buildSha: string | null;
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
        throw new Error(
          'CONTROL_PLANE_JWT_PREVIOUS_SECRETS entries must use kid:secret format.',
        );
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
      : ['1', 'true', 'yes', 'on'].includes(
          parsed.DISABLE_REQUEST_LOGGING.toLowerCase(),
        );
  const chemistryToolsEnabled =
    parsed.REMOTE_CODEX_CHEMISTRY_TOOLS_ENABLED === undefined
      ? false
      : ['1', 'true', 'yes', 'on'].includes(
          parsed.REMOTE_CODEX_CHEMISTRY_TOOLS_ENABLED.toLowerCase(),
        );
  if (chemistryToolsEnabled && !parsed.ELAGENTE_HARNESS_BASE_URL) {
    throw new Error(
      'ELAGENTE_HARNESS_BASE_URL is required when chemistry tools are enabled.',
    );
  }

  const jwtSecret =
    parsed.CONTROL_PLANE_JWT_SECRET ?? 'dev-control-plane-route-token-secret';
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
      throw new Error(
        `Route-token signing key ${key.id} must be at least 16 characters.`,
      );
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
    sandboxDefaultResourceProfile:
      parsed.SANDBOX_DEFAULT_RESOURCE_PROFILE ?? 'standard',
    sandboxS3PrefixBase:
      parsed.SANDBOX_S3_PREFIX_BASE ?? 's3://remote-codex-sandboxes/dev',
    sandboxWorkerInternalPort: parsed.SANDBOX_WORKER_INTERNAL_PORT ?? 8787,
    sandboxWorkerEnabledAgentProviders:
      parsed.SANDBOX_WORKER_ENABLED_AGENT_PROVIDERS ?? 'codex',
    sandboxWorkerDefaultCodexModel:
      parsed.SANDBOX_WORKER_DEFAULT_CODEX_MODEL ?? 'gpt-5.4',
    sandboxWorkerDefaultReasoningEffort:
      parsed.SANDBOX_WORKER_DEFAULT_REASONING_EFFORT ?? 'medium',
    sandboxWorkerAuthToken: parsed.SANDBOX_WORKER_AUTH_TOKEN ?? null,
    sandboxWorkerIdentitySecret: parsed.SANDBOX_WORKER_IDENTITY_SECRET ?? null,
    internalServiceToken: parsed.CONTROL_PLANE_INTERNAL_SERVICE_TOKEN ?? null,
    llmGatewayBaseUrl: parsed.LLM_GATEWAY_BASE_URL ?? null,
    llmGatewayProvider: parsed.LLM_GATEWAY_PROVIDER ?? 'sub2api',
    llmGatewayTokenSecretName: parsed.LLM_GATEWAY_TOKEN_SECRET_NAME ?? null,
    llmGatewayStaticTokenSecretKey:
      parsed.LLM_GATEWAY_STATIC_TOKEN_SECRET_KEY ?? null,
    llmGatewayStaticToken: parsed.LLM_GATEWAY_STATIC_TOKEN ?? null,
    llmGatewayAdminBaseUrl: parsed.LLM_GATEWAY_ADMIN_BASE_URL ?? null,
    llmGatewayAdminToken: parsed.LLM_GATEWAY_ADMIN_TOKEN ?? null,
    llmGatewayGroupId: parsed.LLM_GATEWAY_GROUP_ID ?? null,
    harnessBaseUrl: parsed.ELAGENTE_HARNESS_BASE_URL ?? null,
    harnessProvider: parsed.ELAGENTE_HARNESS_PROVIDER ?? 'elagente-harness',
    harnessAppKeySecretName:
      parsed.ELAGENTE_HARNESS_APP_KEY_SECRET_NAME ?? null,
    harnessAdminBaseUrl:
      parsed.ELAGENTE_HARNESS_ADMIN_BASE_URL ??
      parsed.ELAGENTE_HARNESS_BASE_URL ??
      null,
    harnessAdminKey: parsed.ELAGENTE_HARNESS_ADMIN_KEY ?? null,
    harnessLegacyAdminFallback:
      parsed.ELAGENTE_HARNESS_LEGACY_ADMIN_FALLBACK === undefined
        ? true
        : ['1', 'true', 'yes', 'on'].includes(
            parsed.ELAGENTE_HARNESS_LEGACY_ADMIN_FALLBACK.toLowerCase(),
          ),
    chemistryToolsEnabled,
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
    authJwtClockSkewSeconds:
      parsed.CONTROL_PLANE_AUTH_JWT_CLOCK_SKEW_SECONDS ?? 60,
    productSessionSecret:
      parsed.CONTROL_PLANE_PRODUCT_SESSION_SECRET ??
      parsed.CONTROL_PLANE_AUTH_JWT_SECRET ??
      jwtSecret,
    productSessionTtlSeconds:
      parsed.CONTROL_PLANE_PRODUCT_SESSION_TTL_SECONDS ?? 60 * 60 * 24 * 14,
    publicBaseUrl:
      parsed.CONTROL_PLANE_PUBLIC_BASE_URL ??
      `http://${parsed.HOST ?? '127.0.0.1'}:${parsed.PORT ?? 8790}`,
    frontendBaseUrl: parsed.CONTROL_PLANE_FRONTEND_BASE_URL ?? null,
    googleClientId: parsed.CONTROL_PLANE_GOOGLE_CLIENT_ID ?? null,
    googleClientSecret: parsed.CONTROL_PLANE_GOOGLE_CLIENT_SECRET ?? null,
    githubClientId: parsed.CONTROL_PLANE_GITHUB_CLIENT_ID ?? null,
    githubClientSecret: parsed.CONTROL_PLANE_GITHUB_CLIENT_SECRET ?? null,
    routeTokenSigningKeys,
    corsAllowedOrigins: new Set([
      ...DEFAULT_CORS_ALLOWED_ORIGINS,
      ...(parsed.CONTROL_PLANE_CORS_ALLOWED_ORIGINS ?? '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ]),
    buildSha: parsed.CONTROL_PLANE_BUILD_SHA ?? null,
  };
}
