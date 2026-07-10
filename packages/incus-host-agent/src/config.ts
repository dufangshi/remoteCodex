import path from 'node:path';
import { z } from 'zod';

const schema = z.object({
  REMOTE_CODEX_INCUS_HOST_AGENT_HOST: z.string().min(1).optional(),
  REMOTE_CODEX_INCUS_HOST_AGENT_PORT: z.coerce
    .number()
    .int()
    .positive()
    .max(65_535)
    .optional(),
  REMOTE_CODEX_INCUS_HOST_AGENT_TOKEN: z.string().min(32),
  REMOTE_CODEX_INCUS_BINARY: z.string().min(1).optional(),
  REMOTE_CODEX_INCUS_PROJECT: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,62}$/)
    .optional(),
  REMOTE_CODEX_INCUS_INSTANCE_PREFIX: z
    .string()
    .regex(/^[a-z][a-z0-9-]{1,20}$/)
    .optional(),
  REMOTE_CODEX_INCUS_IMAGE_VERSION: z
    .string()
    .regex(/^[a-zA-Z0-9._-]{1,80}$/)
    .optional(),
  REMOTE_CODEX_INCUS_IMAGE_SOURCE: z.string().min(1).optional(),
  REMOTE_CODEX_INCUS_MAX_CPU: z.coerce
    .number()
    .int()
    .positive()
    .max(64)
    .optional(),
  REMOTE_CODEX_INCUS_MAX_MEMORY_MIB: z.coerce
    .number()
    .int()
    .positive()
    .max(262_144)
    .optional(),
  REMOTE_CODEX_INCUS_MAX_DISK_GIB: z.coerce
    .number()
    .int()
    .positive()
    .max(4_096)
    .optional(),
  REMOTE_CODEX_INCUS_COMMAND_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .max(30 * 60_000)
    .optional(),
  REMOTE_CODEX_INCUS_OPERATION_DIR: z.string().min(1).optional(),
  REMOTE_CODEX_INCUS_AUDIT_LOG: z.string().min(1).optional(),
  REMOTE_CODEX_INCUS_SECRET_DIR: z.string().min(1).optional(),
  REMOTE_CODEX_INCUS_SECRET_MASTER_KEY: z
    .string()
    .regex(/^[a-fA-F0-9]{64}$/)
    .optional(),
});

export interface IncusHostAgentConfig {
  host: string;
  port: number;
  token: string;
  incusBinary: string;
  project: string;
  instancePrefix: string;
  imageVersion: string;
  imageSource: string;
  maxCpu: number;
  maxMemoryMiB: number;
  maxDiskGiB: number;
  commandTimeoutMs: number;
  operationDir: string;
  auditLog: string;
  secretDir: string;
  secretMasterKey: Buffer | null;
}

export function loadIncusHostAgentConfig(
  env: NodeJS.ProcessEnv = process.env,
): IncusHostAgentConfig {
  const parsed = schema.parse(env);
  return {
    host: parsed.REMOTE_CODEX_INCUS_HOST_AGENT_HOST ?? '127.0.0.1',
    port: parsed.REMOTE_CODEX_INCUS_HOST_AGENT_PORT ?? 8801,
    token: parsed.REMOTE_CODEX_INCUS_HOST_AGENT_TOKEN,
    incusBinary: parsed.REMOTE_CODEX_INCUS_BINARY ?? 'incus',
    project: parsed.REMOTE_CODEX_INCUS_PROJECT ?? 'remote-codex-hosted',
    instancePrefix: parsed.REMOTE_CODEX_INCUS_INSTANCE_PREFIX ?? 'rcd-',
    imageVersion: parsed.REMOTE_CODEX_INCUS_IMAGE_VERSION ?? 'ubuntu-24.04-v1',
    imageSource:
      parsed.REMOTE_CODEX_INCUS_IMAGE_SOURCE ?? 'images:ubuntu/24.04/cloud',
    maxCpu: parsed.REMOTE_CODEX_INCUS_MAX_CPU ?? 2,
    maxMemoryMiB: parsed.REMOTE_CODEX_INCUS_MAX_MEMORY_MIB ?? 2_048,
    maxDiskGiB: parsed.REMOTE_CODEX_INCUS_MAX_DISK_GIB ?? 12,
    commandTimeoutMs: parsed.REMOTE_CODEX_INCUS_COMMAND_TIMEOUT_MS ?? 120_000,
    operationDir: path.resolve(
      parsed.REMOTE_CODEX_INCUS_OPERATION_DIR ??
        '.local/incus-host-agent/operations',
    ),
    auditLog: path.resolve(
      parsed.REMOTE_CODEX_INCUS_AUDIT_LOG ??
        '.local/incus-host-agent/audit.jsonl',
    ),
    secretDir: path.resolve(
      parsed.REMOTE_CODEX_INCUS_SECRET_DIR ??
        '.local/incus-host-agent/credentials',
    ),
    secretMasterKey: parsed.REMOTE_CODEX_INCUS_SECRET_MASTER_KEY
      ? Buffer.from(parsed.REMOTE_CODEX_INCUS_SECRET_MASTER_KEY, 'hex')
      : null,
  };
}
