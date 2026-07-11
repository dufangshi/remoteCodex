import { describe, expect, it, vi } from 'vitest';

import type { IncusHostAgentConfig } from './config';
import { readHostMetrics } from './host-metrics';

function config(): IncusHostAgentConfig {
  return {
    host: '127.0.0.1',
    port: 8801,
    token: 'x'.repeat(32),
    incusBinary: 'incus',
    project: 'remote-codex-hosted',
    instancePrefix: 'rcd-',
    imageVersion: 'ubuntu-24.04-v2',
    imageSource: 'remote-codex-ubuntu-24.04-v2',
    maxCpu: 2,
    maxMemoryMiB: 2048,
    maxDiskGiB: 12,
    maxInstances: 4,
    maxRunningInstances: 1,
    monitorPath: '/var/lib/incus',
    minAvailableMemoryMiB: 2048,
    minAvailableDiskGiB: 20,
    maxLoadPerCpu: 1.5,
    commandTimeoutMs: 120_000,
    operationDir: '/tmp/operations',
    auditLog: '/tmp/audit.jsonl',
    secretDir: '/tmp/credentials',
    secretMasterKey: Buffer.alloc(32, 1),
  };
}

describe('host metrics', () => {
  it('reports bounded telemetry without alerts when thresholds are healthy', async () => {
    const result = await readHostMetrics(config(), {
      cpuCount: () => 4,
      loadavg: () => [2, 1, 0.5],
      totalmem: () => 16 * 1024 ** 3,
      freemem: () => 8 * 1024 ** 3,
      readFile: vi.fn().mockResolvedValue('MemAvailable:    8388608 kB\n'),
      statfs: vi.fn().mockResolvedValue({
        blocks: 100 * 1024 ** 3,
        bavail: 50 * 1024 ** 3,
        bsize: 1,
      }),
    });

    expect(result.metrics).toMatchObject({
      cpuCount: 4,
      loadPerCpu: 0.5,
      memoryAvailableMiB: 8192,
      diskAvailableGiB: 50,
      monitorPath: '/var/lib/incus',
    });
    expect(result.alerts).toEqual([]);
  });

  it('emits memory, disk, and load warnings without exposing host paths in messages', async () => {
    const result = await readHostMetrics(config(), {
      cpuCount: () => 2,
      loadavg: () => [4, 4, 4],
      totalmem: () => 4 * 1024 ** 3,
      freemem: () => 1024 ** 3,
      readFile: vi.fn().mockRejectedValue(new Error('not linux')),
      statfs: vi.fn().mockResolvedValue({
        blocks: 100 * 1024 ** 3,
        bavail: 10 * 1024 ** 3,
        bsize: 1,
      }),
    });

    expect(result.alerts.map((alert) => alert.code)).toEqual([
      'host_memory_low',
      'host_disk_low',
      'host_load_high',
    ]);
    expect(JSON.stringify(result.alerts)).not.toContain('/var/lib/incus');
  });
});
