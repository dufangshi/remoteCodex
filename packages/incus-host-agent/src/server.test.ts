import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AuditEvent, AuditLogger } from './audit-log';
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
    guestProvisionScript:
      '/opt/remote-codex-incus-host-agent/guest/remote-codex-provision',
    guestRuntimeVersion: '0.11.32',
    guestRuntimeUpgradeScript:
      '/opt/remote-codex-incus-host-agent/guest/remote-codex-upgrade-runtime',
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
});
