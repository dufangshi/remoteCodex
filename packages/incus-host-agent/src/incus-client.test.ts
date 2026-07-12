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
    guestProvisionScript: '/opt/remote-codex-incus-host-agent/guest/remote-codex-provision',
    secretMasterKey: Buffer.alloc(32, 1),
  };
}

function result(stdout = '', exitCode = 0, stderr = ''): CommandResult {
  return { stdout, stderr, exitCode };
}

describe('IncusClient policy', () => {
  it('reads and writes only the two fixed Codex paths through guest-agent stdin', async () => {
    const sandboxId = '11111111-1111-4111-8111-111111111111';
    const instance = `rcd-${sandboxId}`;
    const running = result(
      JSON.stringify([{ status: 'Running', status_code: 103 }]),
    );
    const run = vi
      .fn<CommandRunner['run']>()
      .mockResolvedValueOnce(running)
      .mockResolvedValueOnce(result())
      .mockResolvedValueOnce(result('model = "gpt-test"\n'))
      .mockResolvedValueOnce(result('{"OPENAI_API_KEY":"sk-test"}\n'))
      .mockResolvedValueOnce(running)
      .mockResolvedValueOnce(result())
      .mockResolvedValueOnce(result());
    const client = new IncusClient(config(), { run });

    await expect(client.readCodexFiles(sandboxId)).resolves.toEqual({
      configToml: 'model = "gpt-test"\n',
      authJson: '{"OPENAI_API_KEY":"sk-test"}\n',
    });
    await client.writeCodexFiles(sandboxId, {
      configToml: 'model = "gpt-updated"\n',
      authJson: '{"OPENAI_API_KEY":"sk-updated"}\n',
    });

    expect(run.mock.calls[2]?.[1]).toContain(instance);
    expect(run.mock.calls[2]?.[1]).toContain(
      '/home/remote-codex/.codex/config.toml',
    );
    expect(run.mock.calls[6]?.[3]).toBe(
      JSON.stringify({
        configToml: 'model = "gpt-updated"\n',
        authJson: '{"OPENAI_API_KEY":"sk-updated"}\n',
      }),
    );
    expect(run.mock.calls[6]?.[1]).toEqual(expect.arrayContaining(['sh', '-c']));
  });
  it('uses argv without a shell and only the configured project/image/resources', async () => {
    const sandboxId = '11111111-1111-4111-8111-111111111111';
    const run = vi
      .fn<CommandRunner['run']>()
      .mockResolvedValueOnce(result('', 1))
      .mockResolvedValueOnce(result('[]'))
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

    expect(run.mock.calls[2]?.[0]).toBe('incus');
    expect(run.mock.calls[2]?.[1]).toEqual([
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

  it('enforces total and running capacity before mutating Incus', async () => {
    const existingId = '22222222-2222-4222-8222-222222222222';
    const createId = '11111111-1111-4111-8111-111111111111';
    const createRun = vi
      .fn<CommandRunner['run']>()
      .mockResolvedValueOnce(result('', 1))
      .mockResolvedValueOnce(
        result(
          JSON.stringify([
            { name: `rcd-${existingId}`, status: 'Stopped' },
            { name: 'unmanaged-instance', status: 'Running' },
          ]),
        ),
      );
    const createClient = new IncusClient(
      { ...config(), maxInstances: 1 },
      { run: createRun },
    );
    await expect(
      createClient.create(createId, 'ubuntu-24.04-v1', {
        cpuCount: 1,
        memoryMiB: 1536,
        diskGiB: 10,
      }),
    ).rejects.toThrow('capacity limit');
    expect(createRun).toHaveBeenCalledTimes(2);

    const startRun = vi
      .fn<CommandRunner['run']>()
      .mockResolvedValueOnce(
        result(JSON.stringify([{ status: 'Stopped', status_code: 102 }])),
      )
      .mockResolvedValueOnce(
        result(
          JSON.stringify([{ name: `rcd-${existingId}`, status: 'Running' }]),
        ),
      );
    const startClient = new IncusClient(config(), { run: startRun });
    await expect(startClient.start(createId)).rejects.toThrow(
      'running instance limit',
    );
    expect(startRun).toHaveBeenCalledTimes(2);
  });

  it('lists only managed UUID instances and their snapshot names', async () => {
    const sandboxId = '11111111-1111-4111-8111-111111111111';
    const run = vi
      .fn<CommandRunner['run']>()
      .mockResolvedValueOnce(
        result(
          JSON.stringify([
            { name: `rcd-${sandboxId}`, status: 'Stopped' },
            { name: 'unmanaged-instance', status: 'Running' },
          ]),
        ),
      )
      .mockResolvedValueOnce(
        result(JSON.stringify([{ name: 'checkpoint' }, { name: 'daily' }])),
      );
    const client = new IncusClient(config(), { run });

    await expect(client.inventory()).resolves.toEqual({
      instances: [
        {
          id: sandboxId,
          status: 'Stopped',
          snapshots: ['checkpoint', 'daily'],
        },
      ],
    });
    expect(run.mock.calls[1]?.[1]).toEqual([
      '--force-local',
      '--project',
      'remote-codex-hosted',
      'snapshot',
      'list',
      `rcd-${sandboxId}`,
      '--format=json',
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

  it('powers off through guest systemd before waiting for Incus stop', async () => {
    const sandboxId = '11111111-1111-4111-8111-111111111111';
    const instance = `rcd-${sandboxId}`;
    const run = vi
      .fn<CommandRunner['run']>()
      .mockResolvedValueOnce(
        result(JSON.stringify([{ status: 'Running', status_code: 103 }])),
      )
      .mockResolvedValueOnce(result())
      .mockResolvedValueOnce(
        result(JSON.stringify([{ status: 'Running', status_code: 103 }])),
      )
      .mockResolvedValueOnce(result())
      .mockResolvedValueOnce(
        result(JSON.stringify([{ status: 'Stopped', status_code: 102 }])),
      );
    const client = new IncusClient(config(), { run });

    await expect(client.stop(sandboxId)).resolves.toMatchObject({
      status: 'Stopped',
    });
    expect(run.mock.calls[1]?.[1]).toEqual([
      '--force-local',
      '--project',
      'remote-codex-hosted',
      'exec',
      instance,
      '--',
      'systemctl',
      'poweroff',
    ]);
    expect(run.mock.calls[3]?.[1]).toEqual([
      '--force-local',
      '--project',
      'remote-codex-hosted',
      'stop',
      instance,
      '--timeout',
      '120',
    ]);
  });

  it('force-stops only after graceful shutdown fails and the VM is still running', async () => {
    const sandboxId = '11111111-1111-4111-8111-111111111111';
    const instance = `rcd-${sandboxId}`;
    const run = vi
      .fn<CommandRunner['run']>()
      .mockResolvedValueOnce(
        result(JSON.stringify([{ status: 'Running', status_code: 103 }])),
      )
      .mockResolvedValueOnce(result())
      .mockResolvedValueOnce(
        result(JSON.stringify([{ status: 'Running', status_code: 103 }])),
      )
      .mockResolvedValueOnce(result('', 1))
      .mockResolvedValueOnce(
        result(JSON.stringify([{ status: 'Running', status_code: 103 }])),
      )
      .mockResolvedValueOnce(result())
      .mockResolvedValueOnce(
        result(JSON.stringify([{ status: 'Stopped', status_code: 102 }])),
      );
    const client = new IncusClient(config(), { run });

    await expect(client.stop(sandboxId)).resolves.toMatchObject({
      status: 'Stopped',
    });
    expect(run.mock.calls[5]?.[1]).toEqual([
      '--force-local',
      '--project',
      'remote-codex-hosted',
      'stop',
      instance,
      '--force',
    ]);
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
    expect(run.mock.calls[3]?.[1]).toContain('file');
    const args = run.mock.calls[4]?.[1] ?? [];
    expect(args).toContain('/usr/local/sbin/remote-codex-provision');
    expect(JSON.stringify(args)).not.toContain(secret);
    expect(run.mock.calls[4]?.[3]).toContain(secret);
  });

  it('waits for the guest agent before invoking the provision helper', async () => {
    vi.useFakeTimers();
    try {
      const sandboxId = '11111111-1111-4111-8111-111111111111';
      const run = vi
        .fn<CommandRunner['run']>()
        .mockResolvedValueOnce(
          result(JSON.stringify([{ status: 'Running', status_code: 103 }])),
        )
        .mockResolvedValueOnce(result('', 1))
        .mockResolvedValueOnce(result())
        .mockResolvedValueOnce(result())
        .mockResolvedValueOnce(result())
        .mockResolvedValueOnce(result('{"status":"provisioned"}'));
      const client = new IncusClient(config(), { run });
      const provision = client.provision(sandboxId, {
        relayServerUrl: 'wss://relay.example.test',
        relayAgentToken: 'rcd_test_device_token',
        openaiApiKey: 'sk-test-not-a-real-secret-123456789',
        localAdminUsername: 'admin',
      });

      await vi.advanceTimersByTimeAsync(2_000);
      await expect(provision).resolves.toEqual({
        id: sandboxId,
        provisioned: true,
      });
      expect(run).toHaveBeenCalledTimes(6);
      expect(run.mock.calls[3]?.[1]).toContain('cloud-init');
      expect(run.mock.calls[4]?.[1]).toContain('file');
      expect(run.mock.calls[5]?.[1]).toContain(
        '/usr/local/sbin/remote-codex-provision',
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
