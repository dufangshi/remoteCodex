import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RelayServerConfig } from './config';
import {
  DisabledHostedSandboxProvider,
  type HostedSandboxProvider,
} from './hosted-sandbox-provider';
import { HostedSandboxService } from './hosted-sandbox-service';
import { RelayStore } from './relay-store';

const dataDirs: string[] = [];

function lifecycleConfig(): RelayServerConfig['hostedSandbox'] {
  return {
    provider: 'incus',
    agentUrl: 'http://127.0.0.1:8801',
    agentToken: 'host-agent-token-long-enough',
    relayServerUrl: 'wss://relay.example.test',
    requestTimeoutMs: 25,
    idleTimeoutMs: 30 * 60_000,
    reconcileIntervalMs: 5 * 60_000,
  };
}

function provider() {
  const result = new DisabledHostedSandboxProvider();
  result.stop = vi.fn(async (id) => ({
    id,
    name: `rcd-${id}`,
    status: 'Stopped',
    statusCode: 102,
  }));
  result.start = vi.fn(async (id) => ({
    id,
    name: `rcd-${id}`,
    status: 'Running',
    statusCode: 103,
  }));
  return result as HostedSandboxProvider;
}

function setup() {
  const dataDir = `/tmp/rcd-hosted-idle-${crypto.randomUUID()}`;
  dataDirs.push(dataDir);
  const store = RelayStore.fromDataDir(dataDir, 'idle-session-secret', true);
  const admin = store.seedAdmin({ username: 'admin', password: 'password123' });
  const registration = store.register({
    email: 'idle-user@example.test',
    username: 'idle-user',
    password: 'password123',
  });
  const fake = provider();
  const service = new HostedSandboxService(store, fake, lifecycleConfig());
  const created = store.createHostedSandboxRequested({
    createdByAdminUserId: admin.id,
    assignedUserIds: [registration.session.user!.id],
    deviceName: 'Idle VM',
    imageVersion: 'ubuntu-24.04-v1',
    resources: { cpuCount: 1, memoryMiB: 1536, diskGiB: 10 },
    credentialRef: 'rcc_'.padEnd(36, 'x'),
  });
  service.markOnline(created.sandbox.deviceId);
  return { store, service, fake, created };
}

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await Promise.all(
    dataDirs
      .splice(0)
      .map((dataDir) => fs.rm(dataDir, { recursive: true, force: true })),
  );
});

describe('turn-aware hosted sandbox idle lifecycle', () => {
  it('never stops during an active turn and waits thirty minutes after terminal', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-10T00:00:00.000Z'));
    const { service, fake, created, store } = setup();
    service.recordTurnActivity({
      deviceId: created.sandbox.deviceId,
      threadId: 'thread-1',
      turnId: 'turn-1',
      kind: 'turn_started',
    });
    // Duplicate delivery from reconnect must not over-count the active turn.
    service.recordTurnActivity({
      deviceId: created.sandbox.deviceId,
      threadId: 'thread-1',
      turnId: 'turn-1',
      kind: 'turn_started',
    });
    expect(
      store.getHostedSandboxDetail(created.sandbox.id)?.activeTurnCount,
    ).toBe(1);

    await vi.advanceTimersByTimeAsync(20 * 60_000);
    expect(fake.stop).not.toHaveBeenCalled();

    service.recordTurnActivity({
      deviceId: created.sandbox.deviceId,
      threadId: 'thread-1',
      turnId: 'turn-1',
      kind: 'turn_terminal',
    });
    await vi.advanceTimersByTimeAsync(30 * 60_000 - 1);
    expect(fake.stop).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await vi.runAllTicks();
    expect(fake.stop).toHaveBeenCalledOnce();
    expect(store.getHostedSandboxDetail(created.sandbox.id)?.status).toBe(
      'stopped',
    );
    service.close();
  });

  it('resets the deadline on real user activity and wakes a stopped VM', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-10T00:00:00.000Z'));
    const { service, fake, created, store } = setup();
    await vi.advanceTimersByTimeAsync(15 * 60_000);
    expect(service.recordUserActivity(created.sandbox.deviceId)).toMatchObject({
      hosted: true,
      waking: false,
    });
    await vi.advanceTimersByTimeAsync(15 * 60_000);
    expect(fake.stop).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(15 * 60_000);
    await vi.runAllTicks();
    expect(fake.stop).toHaveBeenCalledOnce();

    const wake = service.recordUserActivity(created.sandbox.deviceId);
    expect(wake).toEqual({ hosted: true, waking: true });
    await vi.runAllTicks();
    expect(fake.start).toHaveBeenCalledOnce();
    expect(store.getHostedSandboxDetail(created.sandbox.id)).toMatchObject({
      status: 'starting',
      lastUserActivityAt: new Date().toISOString(),
      idleDeadlineAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    });
    service.close();
  });

  it('does not extend the idle deadline when the supervisor reconnects', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-10T00:00:00.000Z'));
    const { service, fake, created, store } = setup();
    const originalDeadline = store.getHostedSandboxDetail(
      created.sandbox.id,
    )?.idleDeadlineAt;

    await vi.advanceTimersByTimeAsync(20 * 60_000);
    service.markOnline(created.sandbox.deviceId);
    expect(
      store.getHostedSandboxDetail(created.sandbox.id)?.idleDeadlineAt,
    ).toBe(originalDeadline);

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    await vi.runAllTicks();
    expect(fake.stop).toHaveBeenCalledOnce();
    service.close();
  });

  it('normalizes an incorrectly extended deadline while restoring timers', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-10T00:00:00.000Z'));
    const { service, fake, created, store } = setup();
    service.recordUserActivity(created.sandbox.deviceId);
    service.close();

    await vi.advanceTimersByTimeAsync(60 * 60_000);
    const restarted = new HostedSandboxService(
      store,
      fake,
      lifecycleConfig(),
    );
    restarted.reconcilePending();
    await vi.advanceTimersByTimeAsync(1);
    await vi.runAllTicks();
    expect(fake.stop).toHaveBeenCalledOnce();
    restarted.close();
  });
});
