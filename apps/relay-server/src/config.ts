import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

export interface RelayServerConfig {
  host: string;
  port: number;
  supervisorToken: string | null;
  clientToken: string | null;
  adminUsername: string;
  adminEmail: string;
  adminPassword: string;
  dataDir: string;
  sessionSecret: string;
  registrationEnabled: boolean;
  registrationEnabledConfigured: boolean;
  registrationPassword: string | null;
  publicBaseUrl?: string | null;
  googleOAuthClientId?: string | null;
  googleOAuthClientSecret?: string | null;
  googleOAuthEnabled?: boolean;
  githubOAuthClientId?: string | null;
  githubOAuthClientSecret?: string | null;
  githubOAuthEnabled?: boolean;
  emailVerificationConfigured?: boolean;
  webDistDir: string | null;
  hostedSandbox: {
    provider: 'disabled' | 'incus';
    agentUrl: string | null;
    agentToken: string | null;
    relayServerUrl: string | null;
    requestTimeoutMs: number;
    idleTimeoutMs: number;
    reconcileIntervalMs: number;
  };
}

const envSchema = z.object({
  HOST: z.string().min(1).optional(),
  PORT: z.coerce.number().int().positive().optional(),
  REMOTE_CODEX_RELAY_HOST: z.string().min(1).optional(),
  REMOTE_CODEX_RELAY_PORT: z.coerce.number().int().positive().optional(),
  REMOTE_CODEX_RELAY_SUPERVISOR_TOKEN: z.string().min(1).optional(),
  REMOTE_CODEX_RELAY_CLIENT_TOKEN: z.string().min(1).optional(),
  REMOTE_CODEX_ADMIN_USERNAME: z.string().min(3),
  REMOTE_CODEX_ADMIN_PASSWORD: z.string().min(8),
  REMOTE_CODEX_ADMIN_EMAIL: z.string().email().optional(),
  REMOTE_CODEX_RELAY_DATA_DIR: z.string().min(1).optional(),
  REMOTE_CODEX_RELAY_SESSION_SECRET: z.string().min(16).optional(),
  REMOTE_CODEX_RELAY_REGISTRATION_ENABLED: z.string().optional(),
  REMOTE_CODEX_RELAY_REGISTRATION_PASSWORD: z.string().min(8).optional(),
  REMOTE_CODEX_PUBLIC_BASE_URL: z.string().url().optional(),
  REMOTE_CODEX_GOOGLE_OAUTH_CLIENT_ID: z.string().min(1).optional(),
  REMOTE_CODEX_GOOGLE_OAUTH_CLIENT_SECRET: z.string().min(1).optional(),
  REMOTE_CODEX_GOOGLE_OAUTH_ENABLED: z.string().optional(),
  REMOTE_CODEX_GITHUB_OAUTH_CLIENT_ID: z.string().min(1).optional(),
  REMOTE_CODEX_GITHUB_OAUTH_CLIENT_SECRET: z.string().min(1).optional(),
  REMOTE_CODEX_GITHUB_OAUTH_ENABLED: z.string().optional(),
  REMOTE_CODEX_EMAIL_VERIFICATION_SECRET: z.string().min(16).optional(),
  REMOTE_CODEX_POSTMARK_SERVER_TOKEN: z.string().min(1).optional(),
  REMOTE_CODEX_RELAY_WEB_DIST_DIR: z.string().min(1).optional(),
  REMOTE_CODEX_HOSTED_SANDBOX_PROVIDER: z
    .enum(['disabled', 'incus'])
    .optional(),
  REMOTE_CODEX_INCUS_HOST_AGENT_URL: z.string().url().optional(),
  REMOTE_CODEX_INCUS_HOST_AGENT_TOKEN: z.string().min(16).optional(),
  REMOTE_CODEX_HOSTED_RELAY_SERVER_URL: z
    .string()
    .url()
    .refine((value) => value.startsWith('ws://') || value.startsWith('wss://'))
    .optional(),
  REMOTE_CODEX_INCUS_HOST_AGENT_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .max(30_000)
    .optional(),
  REMOTE_CODEX_HOSTED_IDLE_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .max(24 * 60 * 60_000)
    .optional(),
  REMOTE_CODEX_HOSTED_RECONCILE_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(10_000)
    .max(24 * 60 * 60_000)
    .optional(),
});

function optionalNonEmpty(value: string | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function normalizeOptionalEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...env,
    HOST: optionalNonEmpty(env.HOST),
    PORT: optionalNonEmpty(env.PORT),
    REMOTE_CODEX_RELAY_HOST: optionalNonEmpty(env.REMOTE_CODEX_RELAY_HOST),
    REMOTE_CODEX_RELAY_PORT: optionalNonEmpty(env.REMOTE_CODEX_RELAY_PORT),
    REMOTE_CODEX_RELAY_SUPERVISOR_TOKEN: optionalNonEmpty(
      env.REMOTE_CODEX_RELAY_SUPERVISOR_TOKEN,
    ),
    REMOTE_CODEX_RELAY_CLIENT_TOKEN: optionalNonEmpty(
      env.REMOTE_CODEX_RELAY_CLIENT_TOKEN,
    ),
    REMOTE_CODEX_ADMIN_EMAIL: optionalNonEmpty(env.REMOTE_CODEX_ADMIN_EMAIL),
    REMOTE_CODEX_RELAY_DATA_DIR: optionalNonEmpty(
      env.REMOTE_CODEX_RELAY_DATA_DIR,
    ),
    REMOTE_CODEX_RELAY_SESSION_SECRET: optionalNonEmpty(
      env.REMOTE_CODEX_RELAY_SESSION_SECRET,
    ),
    REMOTE_CODEX_RELAY_REGISTRATION_ENABLED: optionalNonEmpty(
      env.REMOTE_CODEX_RELAY_REGISTRATION_ENABLED,
    ),
    REMOTE_CODEX_RELAY_REGISTRATION_PASSWORD: optionalNonEmpty(
      env.REMOTE_CODEX_RELAY_REGISTRATION_PASSWORD,
    ),
    REMOTE_CODEX_PUBLIC_BASE_URL: optionalNonEmpty(env.REMOTE_CODEX_PUBLIC_BASE_URL),
    REMOTE_CODEX_GOOGLE_OAUTH_CLIENT_ID: optionalNonEmpty(env.REMOTE_CODEX_GOOGLE_OAUTH_CLIENT_ID),
    REMOTE_CODEX_GOOGLE_OAUTH_CLIENT_SECRET: optionalNonEmpty(env.REMOTE_CODEX_GOOGLE_OAUTH_CLIENT_SECRET),
    REMOTE_CODEX_GOOGLE_OAUTH_ENABLED: optionalNonEmpty(env.REMOTE_CODEX_GOOGLE_OAUTH_ENABLED),
    REMOTE_CODEX_GITHUB_OAUTH_CLIENT_ID: optionalNonEmpty(env.REMOTE_CODEX_GITHUB_OAUTH_CLIENT_ID),
    REMOTE_CODEX_GITHUB_OAUTH_CLIENT_SECRET: optionalNonEmpty(env.REMOTE_CODEX_GITHUB_OAUTH_CLIENT_SECRET),
    REMOTE_CODEX_GITHUB_OAUTH_ENABLED: optionalNonEmpty(env.REMOTE_CODEX_GITHUB_OAUTH_ENABLED),
    REMOTE_CODEX_EMAIL_VERIFICATION_SECRET: optionalNonEmpty(env.REMOTE_CODEX_EMAIL_VERIFICATION_SECRET),
    REMOTE_CODEX_POSTMARK_SERVER_TOKEN: optionalNonEmpty(env.REMOTE_CODEX_POSTMARK_SERVER_TOKEN),
    REMOTE_CODEX_RELAY_WEB_DIST_DIR: optionalNonEmpty(
      env.REMOTE_CODEX_RELAY_WEB_DIST_DIR,
    ),
    REMOTE_CODEX_HOSTED_SANDBOX_PROVIDER: optionalNonEmpty(
      env.REMOTE_CODEX_HOSTED_SANDBOX_PROVIDER,
    ),
    REMOTE_CODEX_INCUS_HOST_AGENT_URL: optionalNonEmpty(
      env.REMOTE_CODEX_INCUS_HOST_AGENT_URL,
    ),
    REMOTE_CODEX_INCUS_HOST_AGENT_TOKEN: optionalNonEmpty(
      env.REMOTE_CODEX_INCUS_HOST_AGENT_TOKEN,
    ),
    REMOTE_CODEX_HOSTED_RELAY_SERVER_URL: optionalNonEmpty(
      env.REMOTE_CODEX_HOSTED_RELAY_SERVER_URL,
    ),
    REMOTE_CODEX_INCUS_HOST_AGENT_TIMEOUT_MS: optionalNonEmpty(
      env.REMOTE_CODEX_INCUS_HOST_AGENT_TIMEOUT_MS,
    ),
    REMOTE_CODEX_HOSTED_IDLE_TIMEOUT_MS: optionalNonEmpty(
      env.REMOTE_CODEX_HOSTED_IDLE_TIMEOUT_MS,
    ),
    REMOTE_CODEX_HOSTED_RECONCILE_INTERVAL_MS: optionalNonEmpty(
      env.REMOTE_CODEX_HOSTED_RECONCILE_INTERVAL_MS,
    ),
  };
}

export function loadRelayServerConfig(
  env: NodeJS.ProcessEnv = process.env,
): RelayServerConfig {
  const parsed = envSchema.parse(normalizeOptionalEnv(env));
  return {
    host: parsed.REMOTE_CODEX_RELAY_HOST ?? parsed.HOST ?? '0.0.0.0',
    port: parsed.REMOTE_CODEX_RELAY_PORT ?? parsed.PORT ?? 8788,
    supervisorToken: parsed.REMOTE_CODEX_RELAY_SUPERVISOR_TOKEN ?? null,
    clientToken: parsed.REMOTE_CODEX_RELAY_CLIENT_TOKEN ?? null,
    adminUsername: parsed.REMOTE_CODEX_ADMIN_USERNAME,
    adminEmail:
      parsed.REMOTE_CODEX_ADMIN_EMAIL ??
      `${parsed.REMOTE_CODEX_ADMIN_USERNAME}@relay.local`,
    adminPassword: parsed.REMOTE_CODEX_ADMIN_PASSWORD,
    dataDir: parsed.REMOTE_CODEX_RELAY_DATA_DIR ?? '.local/relay-server',
    sessionSecret:
      parsed.REMOTE_CODEX_RELAY_SESSION_SECRET ??
      parsed.REMOTE_CODEX_ADMIN_PASSWORD,
    registrationEnabled:
      parsed.REMOTE_CODEX_RELAY_REGISTRATION_ENABLED === undefined
        ? true
        : ['1', 'true', 'yes', 'on'].includes(
            parsed.REMOTE_CODEX_RELAY_REGISTRATION_ENABLED.toLowerCase(),
          ),
    registrationEnabledConfigured:
      parsed.REMOTE_CODEX_RELAY_REGISTRATION_ENABLED !== undefined,
    registrationPassword:
      parsed.REMOTE_CODEX_RELAY_REGISTRATION_PASSWORD ?? null,
    publicBaseUrl: parsed.REMOTE_CODEX_PUBLIC_BASE_URL?.replace(/\/$/, '') ?? null,
    googleOAuthClientId: parsed.REMOTE_CODEX_GOOGLE_OAUTH_CLIENT_ID ?? null,
    googleOAuthClientSecret: parsed.REMOTE_CODEX_GOOGLE_OAUTH_CLIENT_SECRET ?? null,
    googleOAuthEnabled: parsed.REMOTE_CODEX_GOOGLE_OAUTH_ENABLED !== 'false',
    githubOAuthClientId: parsed.REMOTE_CODEX_GITHUB_OAUTH_CLIENT_ID ?? null,
    githubOAuthClientSecret: parsed.REMOTE_CODEX_GITHUB_OAUTH_CLIENT_SECRET ?? null,
    githubOAuthEnabled: parsed.REMOTE_CODEX_GITHUB_OAUTH_ENABLED !== 'false',
    emailVerificationConfigured: Boolean(
      parsed.REMOTE_CODEX_EMAIL_VERIFICATION_SECRET &&
        parsed.REMOTE_CODEX_POSTMARK_SERVER_TOKEN,
    ),
    webDistDir:
      parsed.REMOTE_CODEX_RELAY_WEB_DIST_DIR ?? defaultRelayWebDistDir(),
    hostedSandbox: {
      provider: parsed.REMOTE_CODEX_HOSTED_SANDBOX_PROVIDER ?? 'disabled',
      agentUrl: parsed.REMOTE_CODEX_INCUS_HOST_AGENT_URL ?? null,
      agentToken: parsed.REMOTE_CODEX_INCUS_HOST_AGENT_TOKEN ?? null,
      relayServerUrl: parsed.REMOTE_CODEX_HOSTED_RELAY_SERVER_URL ?? null,
      requestTimeoutMs:
        parsed.REMOTE_CODEX_INCUS_HOST_AGENT_TIMEOUT_MS ?? 1_500,
      idleTimeoutMs: parsed.REMOTE_CODEX_HOSTED_IDLE_TIMEOUT_MS ?? 30 * 60_000,
      reconcileIntervalMs:
        parsed.REMOTE_CODEX_HOSTED_RECONCILE_INTERVAL_MS ?? 5 * 60_000,
    },
  };
}

function defaultRelayWebDistDir() {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve('apps/supervisor-web/dist'),
    path.resolve(moduleDir, '../../supervisor-web/dist'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'index.html'))) {
      return candidate;
    }
  }
  return null;
}
