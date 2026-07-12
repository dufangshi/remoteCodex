import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AuditEvent, AuditLogger } from './audit-log';
import { SpawnCommandRunner } from './command-runner';
import type { IncusHostAgentConfig } from './config';
import type { IncusClient } from './incus-client';
import { FileOperationStore } from './operation-store';
import { buildIncusHostAgent } from './server';
import type { CredentialSecretStore } from './secret-store';

const tempDirs: string[] = [];

async function setup(
  clientOverrides: Partial<IncusClient> = {},
  secretOverrides: Partial<CredentialSecretStore> = {},
) {
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'incus-host-agent-test-'),
  );
  tempDirs.push(tempDir);
  const token = 'test-token-'.padEnd(32, 'x');
  const config: IncusHostAgentConfig = {
    host: '127.0.0.1',
    port: 0,
    token,
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
    monitorPath: '/tmp',
    minAvailableMemoryMiB: 2048,
    minAvailableDiskGiB: 20,
    maxLoadPerCpu: 1.5,
    commandTimeoutMs: 100,
    operationDir: path.join(tempDir, 'operations'),
    auditLog: path.join(tempDir, 'audit.jsonl'),
    secretDir: path.join(tempDir, 'credentials'),
    secretMasterKey: Buffer.alloc(32, 1),
  };
  const events: AuditEvent[] = [];
  const audit: AuditLogger = {
    write: async (event) => {
      events.push(event);
    },
  };
  const client = {
    capability: vi.fn().mockResolvedValue({ available: true }),
    inventory: vi.fn().mockResolvedValue({ instances: [] }),
    create: vi.fn().mockResolvedValue({ status: 'Stopped' }),
    status: vi.fn().mockResolvedValue({ status: 'Stopped' }),
    start: vi.fn().mockResolvedValue({ status: 'Running' }),
    stop: vi.fn().mockResolvedValue({ status: 'Stopped' }),
    snapshot: vi.fn().mockResolvedValue({ name: 'checkpoint' }),
    restoreSnapshot: vi.fn().mockResolvedValue({ status: 'Stopped' }),
    provision: vi.fn().mockResolvedValue({ provisioned: true }),
    readCodexFiles: vi.fn().mockResolvedValue({
      configToml: 'model = "gpt-test"\n',
      authJson: '{"OPENAI_API_KEY":"sk-test"}\n',
    }),
    writeCodexFiles: vi.fn().mockResolvedValue({ updated: true }),
    delete: vi.fn().mockResolvedValue({ deleted: true }),
    ...clientOverrides,
  } as unknown as IncusClient;
  const secrets: CredentialSecretStore = {
    create: vi.fn().mockResolvedValue('rcc_'.padEnd(36, 'x')),
    read: vi.fn().mockResolvedValue('sk-test-not-a-real-secret-123456789'),
    delete: vi.fn().mockResolvedValue(true),
    list: vi.fn().mockResolvedValue([]),
    ...secretOverrides,
  };
  const app = buildIncusHostAgent({
    config,
    client,
    operations: new FileOperationStore(config.operationDir),
    audit,
    secrets,
  });
  await app.ready();
  return { app, client, config, token, events };
}

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe('Incus host-agent API', () => {
  it('keeps health public but requires the bearer token for management', async () => {
    const { app } = await setup();
    expect(
      (await app.inject({ method: 'GET', url: '/healthz' })).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ method: 'GET', url: '/v1/capability' })).statusCode,
    ).toBe(401);
    await app.close();
  });

  it('reads and atomically updates only the managed Codex files', async () => {
    const sandboxId = crypto.randomUUID();
    const readCodexFiles = vi.fn().mockResolvedValue({
      configToml: 'model = "gpt-test"\n',
      authJson: '{"OPENAI_API_KEY":"sk-test"}\n',
    });
    const writeCodexFiles = vi.fn().mockResolvedValue({ updated: true });
    const { app, token } = await setup({ readCodexFiles, writeCodexFiles });
    const headers = { authorization: `Bearer ${token}` };

    const read = await app.inject({
      method: 'GET',
      url: `/v1/instances/${sandboxId}/backends/codex/files`,
      headers,
    });
    expect(read.statusCode).toBe(200);
    expect(read.json().configToml).toContain('gpt-test');

    const files = {
      configToml: 'model = "gpt-updated"\n',
      authJson: '{"OPENAI_API_KEY":"sk-updated"}\n',
    };
    const update = await app.inject({
      method: 'PUT',
      url: `/v1/instances/${sandboxId}/backends/codex/files`,
      headers: { ...headers, 'idempotency-key': crypto.randomUUID() },
      payload: files,
    });
    expect(update.statusCode).toBe(200);
    expect(writeCodexFiles).toHaveBeenCalledWith(sandboxId, files);
    await app.close();
  });

  it('returns restricted instance, snapshot, and opaque credential inventory', async () => {
    const sandboxId = crypto.randomUUID();
    const credentialRef = 'rcc_'.padEnd(36, 'z');
    const inventory = vi.fn().mockResolvedValue({
      instances: [
        { id: sandboxId, status: 'Stopped', snapshots: ['checkpoint'] },
      ],
    });
    const list = vi
      .fn()
      .mockResolvedValue([
        { credentialRef, createdAt: '2026-07-10T00:00:00.000Z' },
      ]);
    const { app, token } = await setup({ inventory }, { list });

    const response = await app.inject({
      method: 'GET',
      url: '/v1/inventory',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      instances: [
        { id: sandboxId, status: 'Stopped', snapshots: ['checkpoint'] },
      ],
      credentials: [{ credentialRef, createdAt: '2026-07-10T00:00:00.000Z' }],
      checkedAt: expect.any(String),
    });
    expect(response.body).not.toContain('sk-');
    await app.close();
  });

  it('validates IDs/resources and executes a repeated idempotency key only once', async () => {
    const { app, client, token, events } = await setup();
    const sandboxId = '11111111-1111-4111-8111-111111111111';
    const request = {
      method: 'POST' as const,
      url: '/v1/instances',
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': `create-${sandboxId}`,
      },
      payload: {
        id: sandboxId,
        imageVersion: 'ubuntu-24.04-v1',
        resources: { cpuCount: 1, memoryMiB: 1536, diskGiB: 10 },
      },
    };
    const first = await app.inject(request);
    const second = await app.inject(request);

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(client.create).toHaveBeenCalledTimes(1);
    expect(events).toEqual([
      expect.objectContaining({
        action: 'create',
        outcome: 'started',
        sandboxId,
      }),
      expect.objectContaining({
        action: 'create',
        outcome: 'succeeded',
        sandboxId,
      }),
    ]);

    const invalid = await app.inject({
      ...request,
      headers: {
        ...request.headers,
        'idempotency-key': `invalid-${crypto.randomUUID()}`,
      },
      payload: { ...request.payload, id: '../host' },
    });
    expect(invalid.statusCode).toBe(400);
    expect(client.create).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it('does not leak Incus error details', async () => {
    const create = vi
      .fn()
      .mockRejectedValue(new Error('private host path /var/lib/incus'));
    const { app, token } = await setup({ create } as Partial<IncusClient>);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/instances',
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': `create-${crypto.randomUUID()}`,
      },
      payload: {
        id: crypto.randomUUID(),
        imageVersion: 'ubuntu-24.04-v1',
        resources: { cpuCount: 1, memoryMiB: 1536, diskGiB: 10 },
      },
    });
    expect(response.statusCode).toBe(502);
    expect(response.body).not.toContain('/var/lib/incus');
    expect(response.json()).toEqual({
      code: 'incus_operation_failed',
      message: 'Incus operation failed.',
    });
    await app.close();
  });

  it('returns an actionable conflict when the running VM limit is reached', async () => {
    const start = vi
      .fn()
      .mockRejectedValue(
        new Error('The hosted running instance limit has been reached.'),
      );
    const { app, token } = await setup({ start } as Partial<IncusClient>);
    const response = await app.inject({
      method: 'POST',
      url: `/v1/instances/${crypto.randomUUID()}/start`,
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': `start-${crypto.randomUUID()}`,
      },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      code: 'running_instance_limit_reached',
      message: 'The hosted running instance limit has been reached.',
    });
    await app.close();
  });

  it('requires an idempotency key for mutations', async () => {
    const { app, token } = await setup();
    const response = await app.inject({
      method: 'POST',
      url: `/v1/instances/${crypto.randomUUID()}/start`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('idempotency_key_required');
    await app.close();
  });

  it('rejects reusing an idempotency key for another sandbox', async () => {
    const { app, token } = await setup();
    const key = `shared-${crypto.randomUUID()}`;
    const first = await app.inject({
      method: 'POST',
      url: `/v1/instances/${crypto.randomUUID()}/start`,
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': key },
    });
    const second = await app.inject({
      method: 'POST',
      url: `/v1/instances/${crypto.randomUUID()}/start`,
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': key },
    });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe('idempotency_key_conflict');
    await app.close();
  });

  it('exposes snapshot restore as a validated idempotent operation', async () => {
    const { app, client, token } = await setup();
    const sandboxId = crypto.randomUUID();
    const key = `restore-${crypto.randomUUID()}`;
    const request = {
      method: 'POST' as const,
      url: `/v1/instances/${sandboxId}/snapshots/phase3-checkpoint/restore`,
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': key,
      },
    };
    expect((await app.inject(request)).statusCode).toBe(200);
    expect((await app.inject(request)).statusCode).toBe(200);
    expect(client.restoreSnapshot).toHaveBeenCalledTimes(1);
    expect(client.restoreSnapshot).toHaveBeenCalledWith(
      sandboxId,
      'phase3-checkpoint',
    );

    const invalid = await app.inject({
      ...request,
      url: `/v1/instances/${sandboxId}/snapshots/..%2Fescape/restore`,
      headers: { ...request.headers, 'idempotency-key': `${key}-invalid` },
    });
    expect(invalid.statusCode).toBe(400);
    await app.close();
  });

  it('validates secret provisioning without returning or auditing credentials', async () => {
    const { app, client, token, events } = await setup();
    const sandboxId = crypto.randomUUID();
    const secret = 'sk-test-not-a-real-secret-123456789';
    const response = await app.inject({
      method: 'POST',
      url: `/v1/instances/${sandboxId}/provision`,
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': `provision-${crypto.randomUUID()}`,
      },
      payload: {
        relayServerUrl: 'wss://relay.example.test',
        relayAgentToken: 'rcd_test_device_token',
        credentialRef: 'rcc_'.padEnd(36, 'x'),
        localAdminUsername: 'admin',
        codexConfig: {
          modelProvider: 'OpenAI',
          model: 'gpt-5.6-sol',
          reviewModel: 'gpt-5.6-sol',
          reasoningEffort: 'low',
          baseUrl: 'https://example.test/responses',
          wireApi: 'responses',
          requiresOpenaiAuth: true,
          disableResponseStorage: true,
          networkAccess: 'enabled',
          goals: true,
        },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain(secret);
    expect(JSON.stringify(events)).not.toContain(secret);
    expect(client.provision).toHaveBeenCalledOnce();
    expect(client.provision).toHaveBeenCalledWith(
      sandboxId,
      expect.objectContaining({
        codexConfig: expect.objectContaining({
          model: 'gpt-5.6-sol',
          reasoningEffort: 'low',
        }),
      }),
    );
    await app.close();
  });

  it('encrypts credential input behind an opaque reference API contract', async () => {
    const create = vi.fn().mockResolvedValue('rcc_'.padEnd(36, 'y'));
    const { app, token, events } = await setup({}, { create });
    const secret = 'sk-test-not-a-real-secret-987654321';
    const response = await app.inject({
      method: 'POST',
      url: '/v1/credentials',
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': `credential-${crypto.randomUUID()}`,
      },
      payload: { openaiApiKey: secret },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ credentialRef: 'rcc_'.padEnd(36, 'y') });
    expect(response.body).not.toContain(secret);
    expect(JSON.stringify(events)).not.toContain(secret);
    expect(create).toHaveBeenCalledWith(secret);
    await app.close();
  });
});

describe('command timeout', () => {
  it('kills a command that exceeds its deadline', async () => {
    const runner = new SpawnCommandRunner();
    await expect(
      runner.run(process.execPath, ['-e', 'setTimeout(() => {}, 1000)'], 10),
    ).rejects.toThrow('timed out');
  });
});
