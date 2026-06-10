import { z } from 'zod';

export interface RelayServerConfig {
  host: string;
  port: number;
  supervisorToken: string;
  clientToken: string | null;
}

const envSchema = z.object({
  HOST: z.string().min(1).optional(),
  PORT: z.coerce.number().int().positive().optional(),
  REMOTE_CODEX_RELAY_SUPERVISOR_TOKEN: z.string().min(1),
  REMOTE_CODEX_RELAY_CLIENT_TOKEN: z.string().min(1).optional(),
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
  };
}
