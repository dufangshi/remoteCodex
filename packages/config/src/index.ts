import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';

export interface RuntimeConfig {
  nodeEnv: 'development' | 'test' | 'production';
  host: string;
  port: number;
  logLevel: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  disableRequestLogging: boolean;
  appName: string;
  appVersion: string;
  workspaceRoot: string;
  databaseUrl: string;
  codexHome: string;
  codexCommand: string;
  codexAppServerStartTimeoutMs: number;
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).optional(),
  HOST: z.string().min(1).optional(),
  PORT: z.coerce.number().int().positive().optional(),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).optional(),
  DISABLE_REQUEST_LOGGING: z.string().optional(),
  APP_NAME: z.string().min(1).optional(),
  APP_VERSION: z.string().min(1).optional(),
  WORKSPACE_ROOT: z.string().optional(),
  DATABASE_URL: z.string().optional(),
  CODEX_HOME: z.string().optional(),
  CODEX_COMMAND: z.string().min(1).optional(),
  CODEX_APP_SERVER_START_TIMEOUT_MS: z.coerce.number().int().positive().optional()
});

export function resolveDatabaseUrl(
  nodeEnv: RuntimeConfig['nodeEnv'],
  value?: string
): string {
  if (value && value.trim()) {
    return path.resolve(value);
  }

  if (nodeEnv === 'production') {
    return path.join(os.homedir(), '.remote-codex', 'supervisor.sqlite');
  }

  return path.resolve('.local', 'supervisor-dev.sqlite');
}

export function loadRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const parsed = envSchema.parse(env);
  const nodeEnv = parsed.NODE_ENV ?? 'development';
  const workspaceRoot = parsed.WORKSPACE_ROOT?.trim()
    ? path.resolve(parsed.WORKSPACE_ROOT)
    : os.homedir();
  const disableRequestLogging =
    parsed.DISABLE_REQUEST_LOGGING === undefined
      ? nodeEnv === 'production'
      : ['1', 'true', 'yes', 'on'].includes(parsed.DISABLE_REQUEST_LOGGING.toLowerCase());

  return {
    nodeEnv,
    host: parsed.HOST ?? '127.0.0.1',
    port: parsed.PORT ?? 8787,
    logLevel: parsed.LOG_LEVEL ?? (nodeEnv === 'production' ? 'warn' : 'info'),
    disableRequestLogging,
    appName: parsed.APP_NAME ?? 'Remote Codex Supervisor',
    appVersion: parsed.APP_VERSION ?? '0.1.0',
    workspaceRoot,
    databaseUrl: resolveDatabaseUrl(nodeEnv, parsed.DATABASE_URL),
    codexHome: parsed.CODEX_HOME?.trim()
      ? path.resolve(parsed.CODEX_HOME)
      : path.join(os.homedir(), '.codex'),
    codexCommand: parsed.CODEX_COMMAND ?? 'codex',
    codexAppServerStartTimeoutMs: parsed.CODEX_APP_SERVER_START_TIMEOUT_MS ?? 10_000
  };
}
