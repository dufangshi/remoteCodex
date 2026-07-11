import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RelayServerConfig } from './config';
import {
  DisabledHostedSandboxProvider,
  type HostedSandboxProvider,
  type HostedSandboxProviderInventory,
} from './hosted-sandbox-provider';
import { HostedSandboxReconciler } from './hosted-sandbox-reconciler';
import { RelayStore, RelayStoreError } from './relay-store';

const dataDirs: string[] = [];

function config(): RelayServerConfig['hostedSandbox'] {
  return {
    provider: 'incus',
    agentUrl: 'http://127.0.0.1:8801',
    agentToken: 'host-agent-token-long-enough',
    relayServerUrl: 'wss://relay.example.test',
    requestTimeoutMs: 25,
    idleTimeoutMs: 600_000,
    reconcileIntervalMs: 300_000,
  };
}

function setup() {
  const dataDir = `/tmp/rcd-hosted-reconcile-${crypto.randomUUID()}`;
  dataDirs.push(dataDir);
  const store = RelayStore.fromDataDir(dataDir, 'reconcile-secret', true);
  const admin = store.seedAdmin({ username: 'admin', password: 'password123' });
  const user = store.register({
    email: 'reconcile@example.test',
    username: 'reconcile-user',
    password: 'password123',
  });
  const credentialRef = `rcc_${'x'.repeat(32)}`;
  const created = store.createHostedSandboxRequested({
    createdByAdminUserId: admin.id,
    assignedUserId: user.session.user!.id,
    deviceName: 'Reconcile VM',
    imageVersion: 'ubuntu-24.04-v1',
    resources: { cpuCount: 1, memoryMiB: 1536, diskGiB: 10 },
    credentialRef,
  });
  return { store, created, credentialRef };
}

function provider(inventory: HostedSandboxProviderInventory) {
  const result = new DisabledHostedSandboxProvider();
  result.inventory = vi.fn().mockResolvedValue(inventory);
  result.delete = vi.fn().mockResolvedValue(undefined);
  result.deleteCredential = vi.fn().mockResolvedValue(undefined);
  return result as HostedSandboxProvider;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    dataDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe('hosted sandbox reconciliation', () => {
  it('reports a healthy exact inventory match', async () => {
    const { store, created, credentialRef } = setup();
    const fake = provider({
      instances: [{ id: created.sandbox.id, status: 'Running', snapshots: [] }],
      credentials: [{ credentialRef, createdAt: '2026-07-10T00:00:00.000Z' }],
      checkedAt: '2026-07-10T00:01:00.000Z',
    });

    await expect(
      new HostedSandboxReconciler(store, fake, config()).run(),
    ).resolves.toMatchObject({
      status: 'healthy',
      missingInstanceSandboxIds: [],
      missingCredentialSandboxIds: [],
      orphanInstances: [],
      orphanCredentials: [],
      orphanSnapshotCount: 0,
    });
  });

  it('classifies missing and orphan resources without deleting them', async () => {
    const { store, created } = setup();
    const orphanId = crypto.randomUUID();
    const orphanCredential = `rcc_${'o'.repeat(32)}`;
    const fake = provider({
      instances: [
        {
          id: orphanId,
          status: 'Stopped',
          snapshots: ['before-update', 'idle-stop'],
        },
      ],
      credentials: [
        {
          credentialRef: orphanCredential,
          createdAt: '2026-07-10T00:00:00.000Z',
        },
      ],
      checkedAt: '2026-07-10T00:01:00.000Z',
    });

    const report = await new HostedSandboxReconciler(
      store,
      fake,
      config(),
    ).run();
    expect(report).toMatchObject({
      status: 'issues',
      missingInstanceSandboxIds: [created.sandbox.id],
      missingCredentialSandboxIds: [created.sandbox.id],
      orphanInstances: [
        { id: orphanId, snapshots: ['before-update', 'idle-stop'] },
      ],
      orphanCredentials: [{ credentialRef: orphanCredential }],
      orphanSnapshotCount: 2,
    });
    expect(fake.delete).not.toHaveBeenCalled();
    expect(fake.deleteCredential).not.toHaveBeenCalled();
  });

  it('fails open when inventory is unavailable', async () => {
    const { store } = setup();
    const fake = provider({ instances: [], credentials: [], checkedAt: '' });
    fake.inventory = vi
      .fn()
      .mockRejectedValue(new Error('private upstream error'));

    await expect(
      new HostedSandboxReconciler(store, fake, config()).run(),
    ).resolves.toMatchObject({
      status: 'unavailable',
      errorCode: 'hosted_inventory_unavailable',
    });
  });

  it('rechecks orphan status immediately before explicit deletion', async () => {
    const { store, created, credentialRef } = setup();
    const orphanId = crypto.randomUUID();
    const fake = provider({
      instances: [{ id: orphanId, status: 'Stopped', snapshots: [] }],
      credentials: [],
      checkedAt: '2026-07-10T00:01:00.000Z',
    });
    const reconciler = new HostedSandboxReconciler(store, fake, config());
    await reconciler.run();
    vi.mocked(fake.inventory).mockResolvedValue({
      instances: [{ id: created.sandbox.id, status: 'Running', snapshots: [] }],
      credentials: [{ credentialRef, createdAt: '2026-07-10T00:00:00.000Z' }],
      checkedAt: '2026-07-10T00:02:00.000Z',
    });

    await expect(reconciler.deleteOrphanInstance(orphanId)).rejects.toEqual(
      expect.objectContaining<Partial<RelayStoreError>>({
        statusCode: 409,
        code: 'conflict',
      }),
    );
    expect(fake.delete).not.toHaveBeenCalled();
  });
});
