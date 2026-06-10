import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

export interface RelayServerConfig {
  host: string;
  port: number;
  supervisorToken: string;
  clientToken: string | null;
  adminUsername: string;
  adminEmail: string;
  adminPassword: string;
  dataDir: string;
  sessionSecret: string;
  registrationEnabled: boolean;
  webDistDir: string | null;
}

const envSchema = z.object({
  HOST: z.string().min(1).optional(),
  PORT: z.coerce.number().int().positive().optional(),
  REMOTE_CODEX_RELAY_SUPERVISOR_TOKEN: z.string().min(1),
  REMOTE_CODEX_RELAY_CLIENT_TOKEN: z.string().min(1).optional(),
  REMOTE_CODEX_ADMIN_USERNAME: z.string().min(3),
  REMOTE_CODEX_ADMIN_PASSWORD: z.string().min(8),
  REMOTE_CODEX_ADMIN_EMAIL: z.string().email().optional(),
  REMOTE_CODEX_RELAY_DATA_DIR: z.string().min(1).optional(),
  REMOTE_CODEX_RELAY_SESSION_SECRET: z.string().min(16).optional(),
  REMOTE_CODEX_RELAY_REGISTRATION_ENABLED: z.string().optional(),
  REMOTE_CODEX_RELAY_WEB_DIST_DIR: z.string().min(1).optional(),
});

export function loadRelayServerConfig(
  env: NodeJS.ProcessEnv = process.env,
): RelayServerConfig {
  const parsed = envSchema.parse(env);
  return {
    host: parsed.HOST ?? '0.0.0.0',
    port: parsed.PORT ?? 8788,
    supervisorToken: parsed.REMOTE_CODEX_RELAY_SUPERVISOR_TOKEN,
    clientToken: parsed.REMOTE_CODEX_RELAY_CLIENT_TOKEN ?? null,
    adminUsername: parsed.REMOTE_CODEX_ADMIN_USERNAME,
    adminEmail:
      parsed.REMOTE_CODEX_ADMIN_EMAIL ??
      `${parsed.REMOTE_CODEX_ADMIN_USERNAME}@relay.local`,
    adminPassword: parsed.REMOTE_CODEX_ADMIN_PASSWORD,
    dataDir: parsed.REMOTE_CODEX_RELAY_DATA_DIR ?? '.local/relay-server',
    sessionSecret:
      parsed.REMOTE_CODEX_RELAY_SESSION_SECRET ??
      parsed.REMOTE_CODEX_RELAY_SUPERVISOR_TOKEN,
    registrationEnabled:
      parsed.REMOTE_CODEX_RELAY_REGISTRATION_ENABLED === undefined
        ? true
        : ['1', 'true', 'yes', 'on'].includes(
            parsed.REMOTE_CODEX_RELAY_REGISTRATION_ENABLED.toLowerCase(),
          ),
    webDistDir: parsed.REMOTE_CODEX_RELAY_WEB_DIST_DIR ?? defaultRelayWebDistDir(),
  };
}

function defaultRelayWebDistDir() {
  const candidate = path.resolve('apps/supervisor-web/dist');
  if (fs.existsSync(path.join(candidate, 'index.html'))) {
    return candidate;
  }
  return null;
}
