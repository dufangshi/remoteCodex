import fs from 'node:fs/promises';
import os from 'node:os';

import type { IncusHostAgentConfig } from './config';

const MIB = 1024 ** 2;
const GIB = 1024 ** 3;

export interface HostedHostAlert {
  code: 'host_memory_low' | 'host_disk_low' | 'host_load_high';
  severity: 'warning';
  message: string;
}

export interface HostedHostMetrics {
  cpuCount: number;
  load1: number;
  loadPerCpu: number;
  memoryTotalMiB: number;
  memoryAvailableMiB: number;
  diskTotalGiB: number;
  diskAvailableGiB: number;
  monitorPath: string;
}

export async function readHostMetrics(
  config: IncusHostAgentConfig,
  dependencies: {
    cpuCount?: () => number;
    loadavg?: () => number[];
    totalmem?: () => number;
    freemem?: () => number;
    readFile?: typeof fs.readFile;
    statfs?: typeof fs.statfs;
  } = {},
): Promise<{ metrics: HostedHostMetrics; alerts: HostedHostAlert[] }> {
  const cpuCount = Math.max(1, dependencies.cpuCount?.() ?? os.cpus().length);
  const load1 = (dependencies.loadavg ?? os.loadavg)()[0] ?? 0;
  const memoryTotalBytes = (dependencies.totalmem ?? os.totalmem)();
  const memoryAvailableBytes = await readAvailableMemoryBytes(
    dependencies.readFile ?? fs.readFile,
    dependencies.freemem ?? os.freemem,
  );
  const disk = await (dependencies.statfs ?? fs.statfs)(config.monitorPath);
  const metrics: HostedHostMetrics = {
    cpuCount,
    load1: round(load1),
    loadPerCpu: round(load1 / cpuCount),
    memoryTotalMiB: Math.round(memoryTotalBytes / MIB),
    memoryAvailableMiB: Math.round(memoryAvailableBytes / MIB),
    diskTotalGiB: round((Number(disk.blocks) * Number(disk.bsize)) / GIB),
    diskAvailableGiB: round((Number(disk.bavail) * Number(disk.bsize)) / GIB),
    monitorPath: config.monitorPath,
  };
  const alerts: HostedHostAlert[] = [];
  if (metrics.memoryAvailableMiB < config.minAvailableMemoryMiB) {
    alerts.push({
      code: 'host_memory_low',
      severity: 'warning',
      message: `Host available memory is below ${config.minAvailableMemoryMiB} MiB.`,
    });
  }
  if (metrics.diskAvailableGiB < config.minAvailableDiskGiB) {
    alerts.push({
      code: 'host_disk_low',
      severity: 'warning',
      message: `Host available disk is below ${config.minAvailableDiskGiB} GiB.`,
    });
  }
  if (metrics.loadPerCpu > config.maxLoadPerCpu) {
    alerts.push({
      code: 'host_load_high',
      severity: 'warning',
      message: `Host 1-minute load per CPU is above ${config.maxLoadPerCpu}.`,
    });
  }
  return { metrics, alerts };
}

async function readAvailableMemoryBytes(
  readFile: typeof fs.readFile,
  freemem: () => number,
) {
  try {
    const meminfo = await readFile('/proc/meminfo', 'utf8');
    const match = /^MemAvailable:\s+(\d+)\s+kB$/m.exec(meminfo);
    if (match?.[1]) {
      return Number(match[1]) * 1024;
    }
  } catch {
    // Non-Linux development and test hosts use os.freemem().
  }
  return freemem();
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}
