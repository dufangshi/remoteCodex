import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildRelayServer } from './app';
import type { RelayServerConfig } from './config';
import {
  DisabledHostedSandboxProvider,
  type HostedSandboxProvider,
} from './hosted-sandbox-provider';

const dataDirs: string[] = [];

function config(dataDir = `/tmp/rcd-hosted-saga-${crypto.randomUUID()}`) {
  dataDirs.push(dataDir);
  return {
    host: '127.0.0.1',
    port: 0,
    supervisorToken: null,
    clientToken: null,
    adminUsername: 'admin',
    adminEmail: 'admin@example.test',
    adminPassword: 'password123',
    dataDir,
    sessionSecret: 'hosted-saga-session-secret',
    registrationEnabled: true,
    registrationEnabledConfigured: false,
    registrationPassword: null,
    webDistDir: null,
    hostedSandbox: {
      provider: 'incus',
      agentUrl: 'http://127.0.0.1:8801',
      agentToken: 'host-agent-token-long-enough',
      relayServerUrl: 'wss://relay.example.test',
      requestTimeoutMs: 25,
      idleTimeoutMs: 600_000,
      reconcileIntervalMs: 300_000,
    },
  } satisfies RelayServerConfig;
}

function provider(options: { provisionFails?: boolean } = {}) {
  const result = new DisabledHostedSandboxProvider();
  result.capability = vi.fn().mockResolvedValue({
    provider: 'incus',
    configured: true,
    reachable: true,
    available: true,
    reasonCode: null,
    reason: null,
    checkedAt: new Date().toISOString(),
  });
  result.createCredential = vi.fn().mockResolvedValue('rcc_'.padEnd(36, 'x'));
  result.createCodexCredential = vi.fn().mockResolvedValue('rcc_'.padEnd(36, 'x'));
  result.deleteCredential = vi.fn().mockResolvedValue(undefined);
  result.create = vi.fn(async (input) => ({
    id: input.id,
    name: `rcd-${input.id}`,
    status: 'Stopped',
    statusCode: 102,
  }));
  result.start = vi.fn(async (id) => ({
    id,
    name: `rcd-${id}`,
    status: 'Running',
    statusCode: 103,
  }));
  result.stop = vi.fn(async (id) => ({
    id,
    name: `rcd-${id}`,
    status: 'Stopped',
    statusCode: 102,
  }));
  result.snapshot = vi.fn().mockResolvedValue(undefined);
  result.delete = vi.fn().mockResolvedValue(undefined);
  result.provision = options.provisionFails
    ? vi.fn().mockRejectedValue(new Error('private provider failure'))
    : vi.fn().mockResolvedValue(undefined);
  result.readCodexFiles = vi.fn().mockResolvedValue({
    configToml: 'model = "gpt-test"\n',
    authJson: '{"OPENAI_API_KEY":"sk-test"}\n',
  });
  result.writeCodexFiles = vi.fn().mockResolvedValue(undefined);
  return result as HostedSandboxProvider;
}

async function loginAndUser(app: ReturnType<typeof buildRelayServer>) {
  const admin = await app.inject({
    method: 'POST',
    url: '/relay/auth/login',
    payload: { identifier: 'admin', password: 'password123' },
  });
  const registration = await app.inject({
    method: 'POST',
    url: '/relay/auth/register',
    payload: {
      email: 'hosted-user@example.test',
      username: 'hosted-user',
      password: 'password123',
    },
  });
  return {
    adminToken: admin.json().token as string,
    assignedUserId: registration.json().session.user.id as string,
    assignedUserToken: registration.json().token as string,
  };
}

async function waitFor(
  assertion: () => Promise<void> | void,
  timeoutMs = 1_000,
) {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      await assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw lastError;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    dataDirs
      .splice(0)
      .map((dataDir) => fs.rm(dataDir, { recursive: true, force: true })),
  );
});

describe('hosted sandbox create saga', () => {
  it('persists device + sandbox then provisions asynchronously without returning secrets', async () => {
    const fake = provider();
    const app = buildRelayServer(config(), { hostedSandboxProvider: fake });
    await app.ready();
    const { adminToken, assignedUserId, assignedUserToken } =
      await loginAndUser(app);
    const secret = 'sk-test-not-a-real-secret-123456789';
    const create = await app.inject({
      method: 'POST',
      url: '/relay/admin/hosted-sandboxes',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        assignedUserIds: [assignedUserId],
        deviceName: 'Hosted Codex',
        imageVersion: 'ubuntu-24.04-v1',
        resources: { cpuCount: 1, memoryMiB: 1536, diskGiB: 10 },
        backends: ['codex'],
        codexFiles: {
          configToml: 'model = "gpt-test"\n',
          authJson: JSON.stringify({ OPENAI_API_KEY: secret }),
        },
      },
    });
    expect(create.statusCode).toBe(202);
    expect(create.body).not.toContain(secret);
    expect(create.body).not.toContain('rcd_');
    const sandboxId = create.json().sandbox.id as string;
    const deviceId = create.json().sandbox.deviceId as string;
    expect(create.json().sandbox.workspaceIsolationEnabled).toBe(false);

    const isolation = await app.inject({
      method: 'PATCH',
      url: `/relay/admin/hosted-sandboxes/${sandboxId}/settings`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { workspaceIsolationEnabled: true },
    });
    expect(isolation.statusCode).toBe(200);
    expect(isolation.json().workspaceIsolationEnabled).toBe(true);

    await waitFor(async () => {
      const detail = await app.inject({
        method: 'GET',
        url: `/relay/admin/hosted-sandboxes/${sandboxId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(detail.json()).toMatchObject({
        status: 'starting',
        assignedUsers: [{ userId: assignedUserId, username: 'hosted-user' }],
        resources: { cpuCount: 1, memoryMiB: 1536, diskGiB: 10 },
        operations: [{ action: 'create', status: 'succeeded' }],
      });
    });
    expect(fake.provision).toHaveBeenCalledWith(
      expect.objectContaining({
        id: sandboxId,
        relayServerUrl: 'wss://relay.example.test',
        relayAgentToken: expect.stringMatching(/^rcd_/),
        credentialRef: 'rcc_'.padEnd(36, 'x'),
        codexConfig: expect.objectContaining({
          modelProvider: 'OpenAI',
          model: 'gpt-5.4',
          baseUrl: 'https://api.openai.com/v1',
        }),
      }),
      `relay-sandbox-provision-${sandboxId}`,
    );

    const codexFiles = await app.inject({
      method: 'GET',
      url: `/relay/admin/hosted-sandboxes/${sandboxId}/backends/codex/files`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(codexFiles.statusCode).toBe(200);
    expect(codexFiles.json().configToml).toContain('gpt-test');
    const updatedFiles = {
      configToml: 'model = "gpt-updated"\n',
      authJson: '{"OPENAI_API_KEY":"sk-updated"}\n',
    };
    const updateCodexFiles = await app.inject({
      method: 'PUT',
      url: `/relay/admin/hosted-sandboxes/${sandboxId}/backends/codex/files`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: updatedFiles,
    });
    expect(updateCodexFiles.statusCode).toBe(200);
    expect(fake.writeCodexFiles).toHaveBeenCalledWith(
      sandboxId,
      updatedFiles,
      expect.stringMatching(/^relay-codex-files-/),
    );

    const secondRegistration = await app.inject({
      method: 'POST',
      url: '/relay/auth/register',
      payload: {
        email: 'hosted-second@example.test',
        username: 'hosted-second',
        password: 'password123',
      },
    });
    const secondUserId = secondRegistration.json().session.user.id as string;
    const members = await app.inject({
      method: 'PUT',
      url: `/relay/admin/hosted-sandboxes/${sandboxId}/members`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { assignedUserIds: [assignedUserId, secondUserId] },
    });
    expect(members.statusCode).toBe(200);
    expect(members.json().assignedUsers).toEqual([
      expect.objectContaining({ userId: assignedUserId }),
      expect.objectContaining({ userId: secondUserId }),
    ]);
    const secondPortal = await app.inject({
      method: 'GET',
      url: '/relay/portal',
      headers: {
        authorization: `Bearer ${secondRegistration.json().token as string}`,
      },
    });
    expect(secondPortal.statusCode).toBe(200);
    expect(secondPortal.json().devices).toEqual([
      expect.objectContaining({ id: deviceId, hostedStatus: 'starting' }),
    ]);

    const ordinaryDelete = await app.inject({
      method: 'DELETE',
      url: `/relay/devices/${deviceId}`,
      headers: { authorization: `Bearer ${assignedUserToken}` },
    });
    expect(ordinaryDelete.statusCode).toBe(409);

    const stop = await app.inject({
      method: 'POST',
      url: `/relay/admin/hosted-sandboxes/${sandboxId}/stop`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(stop.statusCode).toBe(202);
    await waitFor(async () => {
      const detail = await app.inject({
        method: 'GET',
        url: `/relay/admin/hosted-sandboxes/${sandboxId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(detail.json().status).toBe('stopped');
    });

    const wake = await app.inject({
      method: 'POST',
      url: `/relay/devices/${deviceId}/api/threads/start`,
      headers: { authorization: `Bearer ${assignedUserToken}` },
      payload: { workspaceId: crypto.randomUUID() },
    });
    expect(wake.statusCode).toBe(503);
    expect(wake.json().details.reason).toBe('hosted_sandbox_starting');
    await waitFor(async () => {
      const detail = await app.inject({
        method: 'GET',
        url: `/relay/admin/hosted-sandboxes/${sandboxId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(detail.json().operations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ action: 'start', status: 'succeeded' }),
        ]),
      );
    });
    expect(fake.start).toHaveBeenCalledTimes(2);

    const snapshot = await app.inject({
      method: 'POST',
      url: `/relay/admin/hosted-sandboxes/${sandboxId}/snapshots`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: 'manual-checkpoint' },
    });
    expect(snapshot.statusCode).toBe(202);
    await waitFor(() => expect(fake.snapshot).toHaveBeenCalledOnce());

    vi.mocked(fake.createCredential).mockResolvedValueOnce(
      'rcc_'.padEnd(36, 'y'),
    );
    const rotatedSecret = 'sk-test-rotated-not-a-real-secret-123456';
    const rotation = await app.inject({
      method: 'POST',
      url: `/relay/admin/hosted-sandboxes/${sandboxId}/rotate-credential`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { openaiApiKey: rotatedSecret },
    });
    expect(rotation.statusCode).toBe(202);
    expect(rotation.body).not.toContain(rotatedSecret);
    await waitFor(() => expect(fake.provision).toHaveBeenCalledTimes(2));
    expect(fake.deleteCredential).toHaveBeenCalledWith(
      'rcc_'.padEnd(36, 'x'),
      expect.stringContaining('relay-credential-retire-'),
    );
    await waitFor(async () => {
      const detail = await app.inject({
        method: 'GET',
        url: `/relay/admin/hosted-sandboxes/${sandboxId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(detail.json().operations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: 'rotate_credential',
            status: 'succeeded',
          }),
        ]),
      );
    });

    const deletion = await app.inject({
      method: 'DELETE',
      url: `/relay/admin/hosted-sandboxes/${sandboxId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(deletion.statusCode).toBe(202);
    await waitFor(async () => {
      const detail = await app.inject({
        method: 'GET',
        url: `/relay/admin/hosted-sandboxes/${sandboxId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(detail.statusCode).toBe(404);
    });
    expect(fake.deleteCredential).toHaveBeenCalledWith(
      'rcc_'.padEnd(36, 'y'),
      expect.stringContaining('relay-credential-delete-'),
    );
    await app.close();
  });

  it('contains provider failure to the hosted record while ordinary devices still work', async () => {
    const fake = provider({ provisionFails: true });
    const app = buildRelayServer(config(), { hostedSandboxProvider: fake });
    await app.ready();
    const { adminToken, assignedUserId } = await loginAndUser(app);
    const create = await app.inject({
      method: 'POST',
      url: '/relay/admin/hosted-sandboxes',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        assignedUserIds: [assignedUserId],
        deviceName: 'Failing hosted VM',
        imageVersion: 'ubuntu-24.04-v1',
        resources: { cpuCount: 1, memoryMiB: 1536, diskGiB: 10 },
        backends: ['codex'],
        codexFiles: {
          configToml: 'model = "gpt-test"\n',
          authJson: '{"OPENAI_API_KEY":"sk-test-not-a-real-secret-123456789"}',
        },
      },
    });
    const sandboxId = create.json().sandbox.id as string;
    await waitFor(async () => {
      const detail = await app.inject({
        method: 'GET',
        url: `/relay/admin/hosted-sandboxes/${sandboxId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(detail.json()).toMatchObject({
        status: 'error',
        lastErrorCode: 'hosted_sandbox_create_failed',
      });
      expect(detail.body).not.toContain('private provider failure');
    });

    const registration = await app.inject({
      method: 'POST',
      url: '/relay/auth/register',
      payload: {
        email: 'ordinary-after-failure@example.test',
        username: 'ordinary-after-failure',
        password: 'password123',
      },
    });
    const device = await app.inject({
      method: 'POST',
      url: '/relay/devices',
      headers: {
        authorization: `Bearer ${registration.json().token as string}`,
      },
      payload: { name: 'Ordinary device' },
    });
    expect(device.statusCode).toBe(200);
    await app.close();
  });

  it('reconciles an unfinished starting record after relay restart', async () => {
    const dataDir = `/tmp/rcd-hosted-restart-${crypto.randomUUID()}`;
    const firstProvider = provider();
    const first = buildRelayServer(config(dataDir), {
      hostedSandboxProvider: firstProvider,
    });
    await first.ready();
    const { adminToken, assignedUserId } = await loginAndUser(first);
    const create = await first.inject({
      method: 'POST',
      url: '/relay/admin/hosted-sandboxes',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        assignedUserIds: [assignedUserId],
        deviceName: 'Restart reconcile VM',
        imageVersion: 'ubuntu-24.04-v1',
        resources: { cpuCount: 1, memoryMiB: 1536, diskGiB: 10 },
        backends: ['codex'],
        codexFiles: {
          configToml: 'model = "gpt-test"\n',
          authJson: '{"OPENAI_API_KEY":"sk-test-not-a-real-secret-123456789"}',
        },
      },
    });
    const sandboxId = create.json().sandbox.id as string;
    await waitFor(() => expect(firstProvider.provision).toHaveBeenCalledOnce());
    await first.close();

    const secondProvider = provider();
    const second = buildRelayServer(config(dataDir), {
      hostedSandboxProvider: secondProvider,
    });
    await second.ready();
    await waitFor(() =>
      expect(secondProvider.provision).toHaveBeenCalledOnce(),
    );
    expect(secondProvider.create).toHaveBeenCalledWith(
      expect.objectContaining({ id: sandboxId }),
      `relay-sandbox-create-${sandboxId}`,
    );
    await second.close();
  });
});
