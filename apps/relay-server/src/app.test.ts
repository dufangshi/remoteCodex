import { afterEach, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { buildRelayServer, relayRequestBody, relayRequestHeaders } from './app';
import type { RelayServerConfig } from './config';
import { RelayRequestBroker } from './request-broker';

function testConfig(
  overrides: Partial<RelayServerConfig> = {},
): RelayServerConfig {
  return {
    host: '127.0.0.1',
    port: 0,
    supervisorToken: 'supervisor-token',
    clientToken: null,
    adminUsername: 'admin',
    adminEmail: 'admin@example.test',
    adminPassword: 'password123',
    dataDir: `/tmp/remote-codex-relay-test-${crypto.randomUUID()}`,
    sessionSecret: 'test-relay-session-secret',
    registrationEnabled: true,
    registrationEnabledConfigured: false,
    registrationPassword: null,
    webDistDir: null,
    ...overrides,
  };
}

describe('relay server', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports health before a supervisor tunnel is connected', async () => {
    const app = buildRelayServer(testConfig());
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/healthz',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'ok',
      supervisorConnected: false,
      supervisorConnectedAt: null,
      lastSupervisorHeartbeatAt: null,
      supervisorCount: 0,
    });

    await app.close();
  });

  it('rejects non-websocket tunnel requests', async () => {
    const app = buildRelayServer(testConfig());
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/supervisor/tunnel',
    });

    expect(response.statusCode).toBe(426);
    expect(response.json()).toEqual({
      code: 'bad_request',
      message: 'Upgrade to websocket is required.',
    });

    await app.close();
  });

  it('requires client auth for relayed HTTP requests when configured', async () => {
    const app = buildRelayServer(testConfig({ clientToken: 'client-token' }));
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/relay/api/version',
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      code: 'unauthorized',
      message: 'Relay login is required.',
    });

    await app.close();
  });

  it('normalizes relayed request headers and parsed JSON bodies', () => {
    expect(
      relayRequestHeaders({
        authorization: 'Bearer client-token',
        'content-length': '999',
        'transfer-encoding': 'chunked',
        'content-type': 'application/json',
        accept: ['application/json', 'text/plain'],
      }),
    ).toEqual({
      'content-type': 'application/json',
      accept: 'application/json, text/plain',
    });

    expect(relayRequestBody({ absPath: '/repo', label: 'Android E2E' })).toBe(
      '{"absPath":"/repo","label":"Android E2E"}',
    );
  });

  it('registers users and lets them create relay devices', async () => {
    const app = buildRelayServer(testConfig());
    await app.ready();

    const registerResponse = await app.inject({
      method: 'POST',
      url: '/relay/auth/register',
      payload: {
        email: 'dev@example.test',
        username: 'devuser',
        password: 'password123',
      },
    });

    expect(registerResponse.statusCode).toBe(200);
    const registerBody = registerResponse.json();
    expect(registerBody.session.user).toMatchObject({
      email: 'dev@example.test',
      username: 'devuser',
      role: 'user',
    });
    expect(registerBody.token).toEqual(expect.any(String));

    const deviceResponse = await app.inject({
      method: 'POST',
      url: '/relay/devices',
      headers: {
        authorization: `Bearer ${registerBody.token}`,
      },
      payload: {
        name: 'Home workstation',
      },
    });

    expect(deviceResponse.statusCode).toBe(200);
    const deviceBody = deviceResponse.json();
    expect(deviceBody.device).toMatchObject({
      name: 'Home workstation',
      connected: false,
    });
    expect(deviceBody.token).toMatch(/^rcd_/);

    const portalResponse = await app.inject({
      method: 'GET',
      url: '/relay/portal',
      headers: {
        authorization: `Bearer ${registerBody.token}`,
      },
    });

    expect(portalResponse.statusCode).toBe(200);
    expect(portalResponse.json()).toMatchObject({
      user: {
        username: 'devuser',
      },
      devices: [
        {
          name: 'Home workstation',
        },
      ],
      sharedWithMe: [],
      sharedByMe: [],
    });

    await app.close();
  });

  it('requires the configured registration password when registering users', async () => {
    const app = buildRelayServer(
      testConfig({ registrationPassword: 'invite-password-123' }),
    );
    await app.ready();

    const missingPasswordResponse = await app.inject({
      method: 'POST',
      url: '/relay/auth/register',
      payload: {
        email: 'missing@example.test',
        username: 'missing',
        password: 'password123',
      },
    });
    expect(missingPasswordResponse.statusCode).toBe(403);
    expect(missingPasswordResponse.json()).toEqual({
      code: 'forbidden',
      message: 'Invalid registration password.',
    });

    const wrongPasswordResponse = await app.inject({
      method: 'POST',
      url: '/relay/auth/register',
      payload: {
        email: 'wrong@example.test',
        username: 'wrongpw',
        password: 'password123',
        registrationPassword: 'wrong-password',
      },
    });
    expect(wrongPasswordResponse.statusCode).toBe(403);

    const registerResponse = await app.inject({
      method: 'POST',
      url: '/relay/auth/register',
      payload: {
        email: 'invited@example.test',
        username: 'invited',
        password: 'password123',
        registrationPassword: 'invite-password-123',
      },
    });
    expect(registerResponse.statusCode).toBe(200);
    expect(registerResponse.json().session.user).toMatchObject({
      email: 'invited@example.test',
      username: 'invited',
    });

    await app.close();
  });

  it('accepts relay session tokens from websocket-compatible query parameters', async () => {
    const app = buildRelayServer(testConfig());
    await app.ready();

    const loginResponse = await app.inject({
      method: 'POST',
      url: '/relay/auth/login',
      payload: {
        identifier: 'admin',
        password: 'password123',
      },
    });
    const token = loginResponse.json().token;

    for (const queryName of ['relaySession', 'token']) {
      const response = await app.inject({
        method: 'GET',
        url: `/relay/auth/session?${queryName}=${encodeURIComponent(token)}`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        authenticated: true,
        user: {
          username: 'admin',
        },
      });
    }

    await app.close();
  });

  it('lets admin disable registration', async () => {
    const app = buildRelayServer(testConfig());
    await app.ready();

    const loginResponse = await app.inject({
      method: 'POST',
      url: '/relay/auth/login',
      payload: {
        identifier: 'admin',
        password: 'password123',
      },
    });
    const token = loginResponse.json().token;

    const disableResponse = await app.inject({
      method: 'PATCH',
      url: '/relay/admin/settings/registration',
      headers: {
        authorization: `Bearer ${token}`,
      },
      payload: {
        enabled: false,
      },
    });

    expect(disableResponse.statusCode).toBe(200);
    expect(disableResponse.json()).toEqual({
      registrationEnabled: false,
    });

    const registerResponse = await app.inject({
      method: 'POST',
      url: '/relay/auth/register',
      payload: {
        email: 'blocked@example.test',
        username: 'blocked',
        password: 'password123',
      },
    });

    expect(registerResponse.statusCode).toBe(403);

    await app.close();
  });

  it('lets explicit config override a persisted registration setting on restart', async () => {
    const dataDir = `/tmp/remote-codex-relay-test-${crypto.randomUUID()}`;
    const firstApp = buildRelayServer(
      testConfig({ dataDir, registrationEnabled: false }),
    );
    await firstApp.ready();
    await firstApp.close();

    const restartedApp = buildRelayServer(
      testConfig({
        dataDir,
        registrationEnabled: true,
        registrationEnabledConfigured: true,
      }),
    );
    await restartedApp.ready();

    const registerResponse = await restartedApp.inject({
      method: 'POST',
      url: '/relay/auth/register',
      payload: {
        email: 'enabled@example.test',
        username: 'enabled',
        password: 'password123',
      },
    });
    expect(registerResponse.statusCode).toBe(200);

    await restartedApp.close();
  });

  it('shares a device thread with another username', async () => {
    const app = buildRelayServer(testConfig());
    await app.ready();

    const ownerResponse = await app.inject({
      method: 'POST',
      url: '/relay/auth/register',
      payload: {
        email: 'owner@example.test',
        username: 'owner',
        password: 'password123',
      },
    });
    const ownerToken = ownerResponse.json().token;
    const friendResponse = await app.inject({
      method: 'POST',
      url: '/relay/auth/register',
      payload: {
        email: 'friend@example.test',
        username: 'friend',
        password: 'password123',
      },
    });
    const friendToken = friendResponse.json().token;

    const deviceResponse = await app.inject({
      method: 'POST',
      url: '/relay/devices',
      headers: {
        authorization: `Bearer ${ownerToken}`,
      },
      payload: {
        name: 'Owner workstation',
      },
    });
    const deviceId = deviceResponse.json().device.id;

    const shareResponse = await app.inject({
      method: 'POST',
      url: '/relay/shares',
      headers: {
        authorization: `Bearer ${ownerToken}`,
      },
      payload: {
        targetUsername: 'friend',
        deviceId,
        threadId: 'thread-1',
        label: 'Review session',
      },
    });

    expect(shareResponse.statusCode).toBe(200);
    expect(shareResponse.json()).toMatchObject({
      deviceId,
      threadId: 'thread-1',
      label: 'Review session',
      revokedAt: null,
    });

    const friendPortalResponse = await app.inject({
      method: 'GET',
      url: '/relay/portal',
      headers: {
        authorization: `Bearer ${friendToken}`,
      },
    });

    expect(friendPortalResponse.statusCode).toBe(200);
    expect(friendPortalResponse.json().sharedWithMe).toEqual([
      expect.objectContaining({
        deviceId,
        deviceName: 'Owner workstation',
        ownerUsername: 'owner',
        targetUsername: 'friend',
        threadId: 'thread-1',
        label: 'Review session',
      }),
    ]);

    await app.close();
  });

  it('limits shared users to their shared thread routes', async () => {
    const app = buildRelayServer(testConfig());
    await app.ready();

    const ownerResponse = await app.inject({
      method: 'POST',
      url: '/relay/auth/register',
      payload: {
        email: 'owner@example.test',
        username: 'owner',
        password: 'password123',
      },
    });
    const ownerToken = ownerResponse.json().token;
    const friendResponse = await app.inject({
      method: 'POST',
      url: '/relay/auth/register',
      payload: {
        email: 'friend@example.test',
        username: 'friend',
        password: 'password123',
      },
    });
    const friendToken = friendResponse.json().token;
    const deviceResponse = await app.inject({
      method: 'POST',
      url: '/relay/devices',
      headers: {
        authorization: `Bearer ${ownerToken}`,
      },
      payload: {
        name: 'Owner workstation',
      },
    });
    const deviceId = deviceResponse.json().device.id;
    await app.inject({
      method: 'POST',
      url: '/relay/shares',
      headers: {
        authorization: `Bearer ${ownerToken}`,
      },
      payload: {
        targetUsername: 'friend',
        deviceId,
        threadId: '11111111-1111-4111-8111-111111111111',
      },
    });

    const deviceWideResponse = await app.inject({
      method: 'GET',
      url: `/relay/devices/${deviceId}/api/workspaces`,
      headers: {
        authorization: `Bearer ${friendToken}`,
      },
    });
    expect(deviceWideResponse.statusCode).toBe(403);

    const sharedThreadResponse = await app.inject({
      method: 'GET',
      url: `/relay/devices/${deviceId}/api/threads/11111111-1111-4111-8111-111111111111`,
      headers: {
        authorization: `Bearer ${friendToken}`,
      },
    });
    expect(sharedThreadResponse.statusCode).toBe(503);

    const otherThreadResponse = await app.inject({
      method: 'GET',
      url: `/relay/devices/${deviceId}/api/threads/22222222-2222-4222-8222-222222222222`,
      headers: {
        authorization: `Bearer ${friendToken}`,
      },
    });
    expect(otherThreadResponse.statusCode).toBe(403);

    await app.close();
  });

  it('routes device health checks through the selected relay device', async () => {
    const app = buildRelayServer(testConfig());
    await app.ready();

    const registerResponse = await app.inject({
      method: 'POST',
      url: '/relay/auth/register',
      payload: {
        email: 'dev@example.test',
        username: 'devuser',
        password: 'password123',
      },
    });
    const token = registerResponse.json().token;

    const deviceResponse = await app.inject({
      method: 'POST',
      url: '/relay/devices',
      headers: {
        authorization: `Bearer ${token}`,
      },
      payload: {
        name: 'Android workstation',
      },
    });
    const deviceId = deviceResponse.json().device.id;

    const response = await app.inject({
      method: 'GET',
      url: `/relay/devices/${deviceId}/healthz`,
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      code: 'service_unavailable',
      message: 'No supervisor is connected for this device.',
    });

    await app.close();
  });

  it('serves the relay frontend with relay bootstrap config', async () => {
    const distDir = `/tmp/remote-codex-relay-web-${crypto.randomUUID()}`;
    await fs.mkdir(path.join(distDir, 'assets'), { recursive: true });
    await fs.writeFile(
      path.join(distDir, 'index.html'),
      '<!doctype html><html><head><title>Remote Codex</title></head><body><div id="root"></div></body></html>',
      'utf8',
    );
    await fs.writeFile(path.join(distDir, 'assets', 'app.js'), 'console.log("ok");', 'utf8');
    const app = buildRelayServer(testConfig({ webDistDir: distDir }));
    await app.ready();

    const indexResponse = await app.inject({
      method: 'GET',
      url: '/',
    });
    expect(indexResponse.statusCode).toBe(200);
    expect(indexResponse.headers['content-type']).toContain('text/html');
    expect(indexResponse.body).toContain('window.__REMOTE_CODEX_BOOTSTRAP__');
    expect(indexResponse.body).toContain('"mode":"relay"');

    const assetResponse = await app.inject({
      method: 'GET',
      url: '/assets/app.js',
    });
    expect(assetResponse.statusCode).toBe(200);
    expect(assetResponse.body).toBe('console.log("ok");');

    await app.close();
    await fs.rm(distDir, { recursive: true, force: true });
  });

  it('matches relayed HTTP responses to pending tunnel requests', async () => {
    const broker = new RelayRequestBroker(1000);
    const sent: string[] = [];
    const responsePromise = broker.forward(
      {
        send: (message) => {
          sent.push(message);
        },
      },
      {
        type: 'relay.request',
        timestamp: '2026-06-10T00:00:00.000Z',
        requestId: 'request-1',
        payload: {
          method: 'GET',
          path: '/api/version',
          headers: {},
          body: null,
        },
      },
    );

    expect(JSON.parse(sent[0]!)).toMatchObject({
      type: 'relay.request',
      requestId: 'request-1',
      payload: {
        path: '/api/version',
      },
    });

    expect(
      broker.accept({
        type: 'relay.response',
        timestamp: '2026-06-10T00:00:01.000Z',
        requestId: 'request-1',
        payload: {
          statusCode: 200,
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({ version: 'from-home' }),
        },
      }),
    ).toBe(true);

    await expect(responsePromise).resolves.toEqual({
      statusCode: 200,
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ version: 'from-home' }),
    });
  });

  it('rejects pending relay requests when the supervisor does not answer', async () => {
    vi.useFakeTimers();
    const broker = new RelayRequestBroker(30_000);
    const supervisorSocket = {
      sent: [] as string[],
      send(message: string) {
        this.sent.push(message);
      },
    };
    const responsePromise = broker.forward(supervisorSocket, {
      type: 'relay.request',
      timestamp: '2026-06-10T00:00:00.000Z',
      requestId: 'request-1',
      payload: {
        method: 'GET',
        path: '/api/version',
        headers: {},
        body: null,
      },
    });

    expect(JSON.parse(supervisorSocket.sent[0]!)).toMatchObject({
      type: 'relay.request',
      payload: {
        path: '/api/version',
      },
    });
    const rejectionExpectation = expect(responsePromise).rejects.toThrow(
      'Supervisor relay request timed out.',
    );
    await vi.advanceTimersByTimeAsync(30_000);
    await rejectionExpectation;
  });
});
