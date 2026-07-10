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

const tempDirs: string[] = [];

async function setup(clientOverrides: Partial<IncusClient> = {}) {
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
    commandTimeoutMs: 100,
    operationDir: path.join(tempDir, 'operations'),
    auditLog: path.join(tempDir, 'audit.jsonl'),
  };
  const events: AuditEvent[] = [];
  const audit: AuditLogger = {
    write: async (event) => {
      events.push(event);
    },
  };
  const client = {
    capability: vi.fn().mockResolvedValue({ available: true }),
    create: vi.fn().mockResolvedValue({ status: 'Stopped' }),
    status: vi.fn().mockResolvedValue({ status: 'Stopped' }),
    start: vi.fn().mockResolvedValue({ status: 'Running' }),
    stop: vi.fn().mockResolvedValue({ status: 'Stopped' }),
    snapshot: vi.fn().mockResolvedValue({ name: 'checkpoint' }),
    restoreSnapshot: vi.fn().mockResolvedValue({ status: 'Stopped' }),
    delete: vi.fn().mockResolvedValue({ deleted: true }),
    ...clientOverrides,
  } as unknown as IncusClient;
  const app = buildIncusHostAgent({
    config,
    client,
    operations: new FileOperationStore(config.operationDir),
    audit,
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
});

describe('command timeout', () => {
  it('kills a command that exceeds its deadline', async () => {
    const runner = new SpawnCommandRunner();
    await expect(
      runner.run(process.execPath, ['-e', 'setTimeout(() => {}, 1000)'], 10),
    ).rejects.toThrow('timed out');
  });
});
