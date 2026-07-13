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
  REMOTE_CODEX_INCUS_MAX_INSTANCES: z.coerce
    .number()
    .int()
    .positive()
    .max(1_000)
    .optional(),
  REMOTE_CODEX_INCUS_MAX_RUNNING_INSTANCES: z.coerce
    .number()
    .int()
    .positive()
    .max(1_000)
    .optional(),
  REMOTE_CODEX_INCUS_MONITOR_PATH: z.string().min(1).optional(),
  REMOTE_CODEX_INCUS_MIN_AVAILABLE_MEMORY_MIB: z.coerce
    .number()
    .int()
    .nonnegative()
    .max(262_144)
    .optional(),
  REMOTE_CODEX_INCUS_MIN_AVAILABLE_DISK_GIB: z.coerce
    .number()
    .nonnegative()
    .max(4_096)
    .optional(),
  REMOTE_CODEX_INCUS_MAX_LOAD_PER_CPU: z.coerce
    .number()
    .positive()
    .max(100)
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
  REMOTE_CODEX_INCUS_GUEST_PROVISION_SCRIPT: z.string().min(1).optional(),
  REMOTE_CODEX_GUEST_RUNTIME_VERSION: z
    .string()
    .regex(/^[0-9]+\.[0-9]+\.[0-9]+(?:[.-][0-9A-Za-z.-]+)?$/)
    .optional(),
  REMOTE_CODEX_GUEST_RUNTIME_UPGRADE_SCRIPT: z.string().min(1).optional(),
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
  maxInstances: number;
  maxRunningInstances: number;
  monitorPath: string;
  minAvailableMemoryMiB: number;
  minAvailableDiskGiB: number;
  maxLoadPerCpu: number;
  commandTimeoutMs: number;
  operationDir: string;
  auditLog: string;
  secretDir: string;
  guestProvisionScript: string;
  guestRuntimeVersion: string;
  guestRuntimeUpgradeScript: string;
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
    imageVersion: parsed.REMOTE_CODEX_INCUS_IMAGE_VERSION ?? 'ubuntu-24.04-v5',
    imageSource:
      parsed.REMOTE_CODEX_INCUS_IMAGE_SOURCE ?? 'images:ubuntu/24.04/cloud',
    maxCpu: parsed.REMOTE_CODEX_INCUS_MAX_CPU ?? 2,
    maxMemoryMiB: parsed.REMOTE_CODEX_INCUS_MAX_MEMORY_MIB ?? 2_048,
    maxDiskGiB: parsed.REMOTE_CODEX_INCUS_MAX_DISK_GIB ?? 12,
    maxInstances: parsed.REMOTE_CODEX_INCUS_MAX_INSTANCES ?? 4,
    maxRunningInstances: parsed.REMOTE_CODEX_INCUS_MAX_RUNNING_INSTANCES ?? 1,
    monitorPath: path.resolve(
      parsed.REMOTE_CODEX_INCUS_MONITOR_PATH ?? '/var/lib/incus',
    ),
    minAvailableMemoryMiB:
      parsed.REMOTE_CODEX_INCUS_MIN_AVAILABLE_MEMORY_MIB ?? 2_048,
    minAvailableDiskGiB: parsed.REMOTE_CODEX_INCUS_MIN_AVAILABLE_DISK_GIB ?? 20,
    maxLoadPerCpu: parsed.REMOTE_CODEX_INCUS_MAX_LOAD_PER_CPU ?? 1.5,
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
    guestProvisionScript: path.resolve(
      parsed.REMOTE_CODEX_INCUS_GUEST_PROVISION_SCRIPT ??
        '/opt/remote-codex-incus-host-agent/guest/remote-codex-provision',
    ),
    guestRuntimeVersion:
      parsed.REMOTE_CODEX_GUEST_RUNTIME_VERSION ?? '0.11.34',
    guestRuntimeUpgradeScript: path.resolve(
      parsed.REMOTE_CODEX_GUEST_RUNTIME_UPGRADE_SCRIPT ??
        '/opt/remote-codex-incus-host-agent/guest/remote-codex-upgrade-runtime',
    ),
    secretMasterKey: parsed.REMOTE_CODEX_INCUS_SECRET_MASTER_KEY
      ? Buffer.from(parsed.REMOTE_CODEX_INCUS_SECRET_MASTER_KEY, 'hex')
      : null,
  };
}
