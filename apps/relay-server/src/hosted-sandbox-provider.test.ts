import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RelayHostedSandboxCapabilityDto } from '../../../packages/shared/src/index';
import { buildRelayServer } from './app';
import type { RelayServerConfig } from './config';
import {
  DisabledHostedSandboxProvider,
  HostedSandboxCapabilityService,
  IncusHostedSandboxProvider,
  type HostedSandboxProvider,
} from './hosted-sandbox-provider';

const dataDirs: string[] = [];

function testConfig(): RelayServerConfig {
  const dataDir = `/tmp/remote-codex-hosted-capability-${crypto.randomUUID()}`;
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
    sessionSecret: 'hosted-capability-session-secret',
    registrationEnabled: true,
    registrationEnabledConfigured: false,
    registrationPassword: null,
    webDistDir: null,
    hostedSandbox: {
      provider: 'disabled',
      agentUrl: null,
      agentToken: null,
      relayServerUrl: null,
      requestTimeoutMs: 20,
      idleTimeoutMs: 600_000,
    },
  };
}

function availableCapability(): RelayHostedSandboxCapabilityDto {
  return {
    provider: 'incus',
    configured: true,
    reachable: true,
    available: true,
    reasonCode: null,
    reason: null,
    checkedAt: '2026-07-10T00:00:00.000Z',
  };
}

function providerWithCapability(
  capability: HostedSandboxProvider['capability'],
): HostedSandboxProvider {
  const provider = new DisabledHostedSandboxProvider();
  provider.capability = capability;
  return provider;
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

describe('hosted sandbox capability', () => {
  it('is disabled by default without affecting relay health', async () => {
    const app = buildRelayServer(testConfig());
    await app.ready();

    const health = await app.inject({ method: 'GET', url: '/healthz' });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({ status: 'ok' });

    const login = await app.inject({
      method: 'POST',
      url: '/relay/auth/login',
      payload: { identifier: 'admin', password: 'password123' },
    });
    const capability = await app.inject({
      method: 'GET',
      url: '/relay/admin/hosted-sandboxes/capability',
      headers: { authorization: `Bearer ${login.json().token as string}` },
    });

    expect(capability.statusCode).toBe(200);
    expect(capability.json()).toMatchObject({
      provider: 'disabled',
      configured: false,
      reachable: false,
      available: false,
      reasonCode: 'hosted_sandbox_disabled',
    });
    await app.close();
  });

  it('contains provider failure to the hosted capability route', async () => {
    const provider = providerWithCapability(
      vi.fn().mockRejectedValue(new Error('secret upstream details')),
    );
    const app = buildRelayServer(testConfig(), {
      hostedSandboxProvider: provider,
    });
    await app.ready();

    const login = await app.inject({
      method: 'POST',
      url: '/relay/auth/login',
      payload: { identifier: 'admin', password: 'password123' },
    });
    const adminToken = login.json().token as string;
    const capability = await app.inject({
      method: 'GET',
      url: '/relay/admin/hosted-sandboxes/capability',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(capability.statusCode).toBe(200);
    expect(capability.json()).toMatchObject({
      available: false,
      reasonCode: 'hosted_provider_unreachable',
    });
    expect(capability.body).not.toContain('secret upstream details');

    const register = await app.inject({
      method: 'POST',
      url: '/relay/auth/register',
      payload: {
        email: 'ordinary@example.test',
        username: 'ordinary',
        password: 'password123',
      },
    });
    const device = await app.inject({
      method: 'POST',
      url: '/relay/devices',
      headers: { authorization: `Bearer ${register.json().token as string}` },
      payload: { name: 'Ordinary device' },
    });
    expect(device.statusCode).toBe(200);
    expect(device.json().device.name).toBe('Ordinary device');
    await app.close();
  });

  it('returns provider capability when the provider is healthy', async () => {
    const provider = providerWithCapability(
      vi.fn().mockResolvedValue(availableCapability()),
    );
    const service = new HostedSandboxCapabilityService(provider, {
      timeoutMs: 20,
    });

    await expect(service.read()).resolves.toEqual(availableCapability());
  });

  it('times out and opens a circuit after repeated provider failures', async () => {
    const capability = vi.fn(
      () => new Promise<RelayHostedSandboxCapabilityDto>(() => undefined),
    );
    const service = new HostedSandboxCapabilityService(
      providerWithCapability(capability),
      { timeoutMs: 5, failureThreshold: 2, circuitResetMs: 60_000 },
    );

    await expect(service.read()).resolves.toMatchObject({
      available: false,
      reasonCode: 'hosted_provider_timeout',
    });
    await expect(service.read()).resolves.toMatchObject({
      available: false,
      reasonCode: 'hosted_provider_timeout',
    });
    await expect(service.read()).resolves.toMatchObject({
      available: false,
      reasonCode: 'hosted_provider_circuit_open',
    });
    expect(capability).toHaveBeenCalledTimes(2);
  });

  it('uses authenticated typed requests without leaking credentials into URLs', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            available: true,
            credentialStoreReady: true,
            limits: { maxInstances: 4, maxRunningInstances: 1 },
            capacity: { totalInstances: 2, runningInstances: 1 },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ credentialRef: 'rcc_reference' }), {
          status: 200,
        }),
      );
    const provider = new IncusHostedSandboxProvider({
      provider: 'incus',
      agentUrl: 'http://127.0.0.1:8801/',
      agentToken: 'host-agent-secret-token',
      relayServerUrl: 'wss://relay.example.test',
      requestTimeoutMs: 25,
      idleTimeoutMs: 600_000,
    });

    await expect(provider.capability()).resolves.toMatchObject({
      available: true,
      reachable: true,
      limits: { maxInstances: 4, maxRunningInstances: 1 },
      capacity: { totalInstances: 2, runningInstances: 1 },
    });
    await expect(
      provider.createCredential(
        'sk-test-not-a-real-secret-123456789',
        'credential-idempotency-key',
      ),
    ).resolves.toBe('rcc_reference');
    const [url, request] = fetchMock.mock.calls[1]!;
    expect(String(url)).toBe('http://127.0.0.1:8801/v1/credentials');
    expect(String(url)).not.toContain('sk-test');
    expect(request?.headers).toMatchObject({
      authorization: 'Bearer host-agent-secret-token',
      'idempotency-key': 'credential-idempotency-key',
    });
  });

  it('does not expose the capability route to ordinary relay users', async () => {
    const app = buildRelayServer(testConfig(), {
      hostedSandboxProvider: new DisabledHostedSandboxProvider(),
    });
    await app.ready();
    const register = await app.inject({
      method: 'POST',
      url: '/relay/auth/register',
      payload: {
        email: 'user@example.test',
        username: 'relay-user',
        password: 'password123',
      },
    });
    const capability = await app.inject({
      method: 'GET',
      url: '/relay/admin/hosted-sandboxes/capability',
      headers: { authorization: `Bearer ${register.json().token as string}` },
    });

    expect(capability.statusCode).toBe(403);
    await app.close();
  });
});
