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
    commandTimeoutMs: 120_000,
    operationDir: '/tmp/operations',
    auditLog: '/tmp/audit.jsonl',
    secretDir: '/tmp/credentials',
    secretMasterKey: Buffer.alloc(32, 1),
  };
}

function result(stdout = '', exitCode = 0, stderr = ''): CommandResult {
  return { stdout, stderr, exitCode };
}

describe('IncusClient policy', () => {
  it('uses argv without a shell and only the configured project/image/resources', async () => {
    const sandboxId = '11111111-1111-4111-8111-111111111111';
    const run = vi
      .fn<CommandRunner['run']>()
      .mockResolvedValueOnce(result('', 1))
      .mockResolvedValueOnce(result())
      .mockResolvedValueOnce(
        result(JSON.stringify([{ status: 'Stopped', status_code: 102 }])),
      );
    const client = new IncusClient(config(), { run });

    await expect(
      client.create(sandboxId, 'ubuntu-24.04-v1', {
        cpuCount: 1,
        memoryMiB: 1536,
        diskGiB: 10,
      }),
    ).resolves.toMatchObject({
      name: `rcd-${sandboxId}`,
      status: 'Stopped',
    });

    expect(run.mock.calls[1]?.[0]).toBe('incus');
    expect(run.mock.calls[1]?.[1]).toEqual([
      '--force-local',
      '--project',
      'remote-codex-hosted',
      'init',
      'images:ubuntu/24.04/cloud',
      `rcd-${sandboxId}`,
      '--vm',
      '--config',
      'limits.cpu=1',
      '--config',
      'limits.memory=1536MiB',
      '--device',
      'root,size=10GiB',
    ]);
  });

  it('rejects resource and image values outside the allowlist before running Incus', async () => {
    const run = vi.fn<CommandRunner['run']>();
    const client = new IncusClient(config(), { run });

    await expect(
      client.create('11111111-1111-4111-8111-111111111111', 'evil:image', {
        cpuCount: 1,
        memoryMiB: 1536,
        diskGiB: 10,
      }),
    ).rejects.toThrow('image version is not allowed');
    await expect(
      client.create('11111111-1111-4111-8111-111111111111', 'ubuntu-24.04-v1', {
        cpuCount: 32,
        memoryMiB: 1536,
        diskGiB: 10,
      }),
    ).rejects.toThrow();
    expect(run).not.toHaveBeenCalled();
  });

  it('rejects instance and snapshot names that could become command injection', async () => {
    const run = vi.fn<CommandRunner['run']>();
    const client = new IncusClient(config(), { run });

    await expect(client.start('x; touch /tmp/owned')).rejects.toThrow();
    await expect(
      client.snapshot('11111111-1111-4111-8111-111111111111', '../escape'),
    ).rejects.toThrow();
    expect(run).not.toHaveBeenCalled();
  });

  it('restores only a validated snapshot of a stopped managed instance', async () => {
    const sandboxId = '11111111-1111-4111-8111-111111111111';
    const run = vi
      .fn<CommandRunner['run']>()
      .mockResolvedValueOnce(
        result(JSON.stringify([{ status: 'Stopped', status_code: 102 }])),
      )
      .mockResolvedValueOnce(result())
      .mockResolvedValueOnce(
        result(JSON.stringify([{ status: 'Stopped', status_code: 102 }])),
      );
    const client = new IncusClient(config(), { run });

    await expect(
      client.restoreSnapshot(sandboxId, 'phase3-checkpoint'),
    ).resolves.toMatchObject({ status: 'Stopped' });
    expect(run.mock.calls[1]?.[1]).toEqual([
      '--force-local',
      '--project',
      'remote-codex-hosted',
      'snapshot',
      'restore',
      `rcd-${sandboxId}`,
      'phase3-checkpoint',
    ]);
  });

  it('passes provision secrets only through stdin to the fixed guest helper', async () => {
    const sandboxId = '11111111-1111-4111-8111-111111111111';
    const secret = 'sk-test-not-a-real-secret-123456789';
    const run = vi
      .fn<CommandRunner['run']>()
      .mockResolvedValueOnce(
        result(JSON.stringify([{ status: 'Running', status_code: 103 }])),
      )
      .mockResolvedValueOnce(result('{"status":"provisioned"}'));
    const client = new IncusClient(config(), { run });

    await client.provision(sandboxId, {
      relayServerUrl: 'wss://relay.example.test',
      relayAgentToken: 'rcd_test_device_token',
      openaiApiKey: secret,
      localAdminUsername: 'admin',
    });

    const args = run.mock.calls[1]?.[1] ?? [];
    expect(args).toContain('/usr/local/sbin/remote-codex-provision');
    expect(JSON.stringify(args)).not.toContain(secret);
    expect(run.mock.calls[1]?.[3]).toContain(secret);
  });
});
