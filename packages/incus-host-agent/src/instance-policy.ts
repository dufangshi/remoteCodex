import { z } from 'zod';
import type { IncusHostAgentConfig } from './config';

export const hostedSandboxIdSchema = z.string().uuid();
export const snapshotNameSchema = z.string().regex(/^[a-z][a-z0-9-]{0,62}$/);

export interface HostedInstanceResources {
  cpuCount: number;
  memoryMiB: number;
  diskGiB: number;
}

export function instanceName(config: IncusHostAgentConfig, id: string): string {
  return `${config.instancePrefix}${hostedSandboxIdSchema.parse(id)}`;
}

export function validateResources(
  config: IncusHostAgentConfig,
  resources: HostedInstanceResources,
): HostedInstanceResources {
  const parsed = z
    .object({
      cpuCount: z.number().int().positive().max(config.maxCpu),
      memoryMiB: z.number().int().positive().max(config.maxMemoryMiB),
      diskGiB: z.number().int().positive().max(config.maxDiskGiB),
    })
    .parse(resources);
  return parsed;
}
