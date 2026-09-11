import { describe, expect, it, vi } from 'vitest';

import type { CommandResult, CommandRunner } from './command-runner';
import type { IncusHostAgentConfig } from './config';
import { IncusClient } from './incus-client';

function config(): IncusHostAgentConfig {
  return {
    host: '127.0.0.1',
    port: 8801,
    token: 'x'.repeat(32),
    incusBinary: 'incus',
    project: 'remote-codex-hosted',
    instancePrefix: 'rcd-',
    imageVersion: 'ubuntu-24.04-v1',
    imageSource: 'images:ubuntu/24.04/cloud',
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
    guestProvisionScript:
      '/opt/remote-codex-incus-host-agent/guest/remote-codex-provision',
    guestRuntimeVersion: '0.11.32',
    guestRuntimeUpgradeScript:
      '/opt/remote-codex-incus-host-agent/guest/remote-codex-upgrade-runtime',
    secretMasterKey: Buffer.alloc(32, 1),
  };
}

function result(stdout = '', exitCode = 0, stderr = ''): CommandResult {
  return { stdout, stderr, exitCode };
}

describe('IncusClient policy', () => {

  it('rejects instance and snapshot names that could become command injection', async () => {
    const run = vi.fn<CommandRunner['run']>();
    const client = new IncusClient(config(), { run });

    await expect(client.start('x; touch /tmp/owned')).rejects.toThrow();
    await expect(
      client.snapshot('11111111-1111-4111-8111-111111111111', '../escape'),
    ).rejects.toThrow();
    expect(run).not.toHaveBeenCalled();
  });

  it('passes provision secrets only through stdin to the fixed guest helper', async () => {
    const sandboxId = '11111111-1111-4111-8111-111111111111';
    const secret = 'sk-test-not-a-real-secret-123456789';
    const run = vi
      .fn<CommandRunner['run']>()
      .mockResolvedValueOnce(
        result(JSON.stringify([{ status: 'Running', status_code: 103 }])),
      )
      .mockResolvedValueOnce(result())
      .mockResolvedValueOnce(result())
      .mockResolvedValueOnce(result())
      .mockResolvedValueOnce(result())
      .mockResolvedValueOnce(result())
      .mockResolvedValueOnce(result('{"status":"provisioned"}'));
    const client = new IncusClient(config(), { run });

    await client.provision(sandboxId, {
      relayServerUrl: 'wss://relay.example.test',
      relayAgentToken: 'rcd_test_device_token',
      openaiApiKey: secret,
      localAdminUsername: 'admin',
    });

    expect(run.mock.calls[1]?.[1]).toEqual([
      '--force-local',
      '--project',
      'remote-codex-hosted',
      'exec',
      `rcd-${sandboxId}`,
      '--',
      'true',
    ]);
    expect(run.mock.calls[2]?.[1]).toContain('cloud-init');
    expect(JSON.stringify(run.mock.calls[3]?.[1])).toContain(
      'remote-codex-upgrade-runtime',
    );
    expect(run.mock.calls[5]?.[1]).toContain('file');
    const args = run.mock.calls[6]?.[1] ?? [];
    expect(args).toContain('/usr/local/sbin/remote-codex-provision');
    expect(JSON.stringify(args)).not.toContain(secret);
    expect(run.mock.calls[6]?.[3]).toContain(secret);
  });
});
