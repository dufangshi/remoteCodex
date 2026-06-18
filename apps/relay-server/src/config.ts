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
  webDistDir: string | null;
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
  REMOTE_CODEX_RELAY_WEB_DIST_DIR: z.string().min(1).optional(),
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
    REMOTE_CODEX_RELAY_DATA_DIR: optionalNonEmpty(env.REMOTE_CODEX_RELAY_DATA_DIR),
    REMOTE_CODEX_RELAY_SESSION_SECRET: optionalNonEmpty(
      env.REMOTE_CODEX_RELAY_SESSION_SECRET,
    ),
    REMOTE_CODEX_RELAY_REGISTRATION_ENABLED: optionalNonEmpty(
      env.REMOTE_CODEX_RELAY_REGISTRATION_ENABLED,
    ),
    REMOTE_CODEX_RELAY_REGISTRATION_PASSWORD: optionalNonEmpty(
      env.REMOTE_CODEX_RELAY_REGISTRATION_PASSWORD,
    ),
    REMOTE_CODEX_RELAY_WEB_DIST_DIR: optionalNonEmpty(
      env.REMOTE_CODEX_RELAY_WEB_DIST_DIR,
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
    registrationPassword: parsed.REMOTE_CODEX_RELAY_REGISTRATION_PASSWORD ?? null,
    webDistDir: parsed.REMOTE_CODEX_RELAY_WEB_DIST_DIR ?? defaultRelayWebDistDir(),
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
