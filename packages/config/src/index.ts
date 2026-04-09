import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';

export interface RuntimeConfig {
  nodeEnv: 'development' | 'test' | 'production';
  host: string;
  port: number;
  appName: string;
  appVersion: string;
  workspaceRoot: string;
  databaseUrl: string;
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).optional(),
  HOST: z.string().min(1).optional(),
  PORT: z.coerce.number().int().positive().optional(),
  APP_NAME: z.string().min(1).optional(),
  APP_VERSION: z.string().min(1).optional(),
  WORKSPACE_ROOT: z.string().optional(),
  DATABASE_URL: z.string().optional()
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

  return {
    nodeEnv,
    host: parsed.HOST ?? '127.0.0.1',
    port: parsed.PORT ?? 8787,
    appName: parsed.APP_NAME ?? 'Remote Codex Supervisor',
    appVersion: parsed.APP_VERSION ?? '0.1.0',
    workspaceRoot,
    databaseUrl: resolveDatabaseUrl(nodeEnv, parsed.DATABASE_URL)
  };
}
