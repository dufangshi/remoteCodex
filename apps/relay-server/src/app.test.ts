import { afterEach, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { buildRelayServer, relayRequestBody, relayRequestHeaders } from './app';
import type { RelayServerConfig } from './config';
import { RelayRequestBroker } from './request-broker';

const SHARED_THREAD_ID = '11111111-1111-4111-8111-111111111111';
const SHARED_WORKSPACE_ID = '33333333-3333-4333-8333-333333333333';

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

async function setupSharedRelaySession(options: {
  threadAccess?: 'read' | 'control';
  workspaceAccess?: 'none' | 'read' | 'write';
  workspaceId?: string | null;
  expiresAt?: string | null;
} = {}) {
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
  const ownerToken = ownerResponse.json().token as string;
  const friendResponse = await app.inject({
    method: 'POST',
    url: '/relay/auth/register',
    payload: {
      email: 'friend@example.test',
      username: 'friend',
      password: 'password123',
    },
  });
  const friendToken = friendResponse.json().token as string;
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
  const deviceId = deviceResponse.json().device.id as string;
  const deviceToken = deviceResponse.json().token as string;
  const shareResponse = await app.inject({
    method: 'POST',
    url: '/relay/shares',
    headers: {
      authorization: `Bearer ${ownerToken}`,
    },
    payload: {
      targetIdentifier: 'friend',
      deviceId,
      threadId: SHARED_THREAD_ID,
      workspaceId: options.workspaceId ?? SHARED_WORKSPACE_ID,
      threadAccess: options.threadAccess ?? 'read',
      workspaceAccess: options.workspaceAccess ?? 'read',
      expiresAt: options.expiresAt ?? null,
    },
  });

  expect(shareResponse.statusCode).toBe(200);

  return {
    app,
    ownerToken,
    friendToken,
    deviceId,
    deviceToken,
    shareId: shareResponse.json().id as string,
  };
}

function websocketBaseUrl(app: ReturnType<typeof buildRelayServer>) {
  const address = app.server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected relay server to listen on a TCP address.');
  }
  return `ws://${address.address}:${address.port}`;
}

async function waitForSocketOpen(socket: WebSocket) {
  if (socket.readyState === WebSocket.OPEN) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true });
    socket.addEventListener('error', () => reject(new Error('WebSocket failed to open.')), {
      once: true,
    });
  });
}

async function waitForSocketClose(socket: WebSocket) {
  return new Promise<CloseEvent>((resolve) => {
    socket.addEventListener('close', (event) => resolve(event), { once: true });
  });
}

async function waitForSocketMessage(socket: WebSocket) {
  return new Promise<any>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Timed out waiting for websocket message.'));
    }, 1000);
    socket.addEventListener(
      'message',
      (event) => {
        clearTimeout(timeout);
        resolve(JSON.parse(String(event.data)));
      },
      { once: true },
    );
    socket.addEventListener(
      'error',
      () => {
        clearTimeout(timeout);
        reject(new Error('WebSocket failed while waiting for a message.'));
      },
      { once: true },
    );
  });
}

async function waitForSocketMessageMatching(
  socket: WebSocket,
  predicate: (message: any) => boolean,
) {
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    const message = await waitForSocketMessage(socket);
    if (predicate(message)) {
      return message;
    }
  }
  throw new Error('Timed out waiting for matching websocket message.');
}

function expectNoSocketMessage(socket: WebSocket, durationMs = 80) {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(resolve, durationMs);
    socket.addEventListener(
      'message',
      (event) => {
        clearTimeout(timeout);
        reject(new Error(`Unexpected websocket message: ${String(event.data)}`));
      },
      { once: true },
    );
  });
}

async function answerNextRelayRequest(
  supervisorSocket: WebSocket,
  predicate: (message: any) => boolean,
  body: unknown = { ok: true },
) {
  const requestMessage = await waitForSocketMessageMatching(
    supervisorSocket,
    (message) => message.type === 'relay.request' && predicate(message),
  );
  supervisorSocket.send(JSON.stringify({
    type: 'relay.response',
    timestamp: '2026-07-01T00:00:04.000Z',
    requestId: requestMessage.requestId,
    payload: {
      statusCode: 200,
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    },
  }));
  return requestMessage;
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

  it('adds WebView CORS headers only when explicitly enabled', async () => {
    const disabled = buildRelayServer(testConfig());
    await disabled.ready();

    const disabledResponse = await disabled.inject({
      method: 'OPTIONS',
      url: '/relay/devices/11111111-1111-4111-8111-111111111111/api/threads',
      headers: {
        origin: 'null',
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'authorization',
      },
    });

    expect(disabledResponse.headers['access-control-allow-origin']).toBeUndefined();
    await disabled.close();

    const enabled = buildRelayServer(testConfig(), {
      env: {
        REMOTE_CODEX_ENABLE_WEBVIEW_CORS: 'true',
      } as NodeJS.ProcessEnv,
    });
    await enabled.ready();

    const enabledResponse = await enabled.inject({
      method: 'OPTIONS',
      url: '/relay/devices/11111111-1111-4111-8111-111111111111/api/threads',
      headers: {
        origin: 'null',
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'authorization',
      },
    });

    expect(enabledResponse.statusCode).toBe(204);
    expect(enabledResponse.headers['access-control-allow-origin']).toBe('null');
    expect(enabledResponse.headers['access-control-allow-methods']).toContain('GET');
    expect(enabledResponse.headers['access-control-allow-headers']).toContain('authorization');
    expect(enabledResponse.headers.vary).toBe('Origin');

    await enabled.close();
  });

  it('normalizes relayed request headers and parsed JSON bodies', () => {
    expect(
      relayRequestHeaders({
        authorization: 'Bearer client-token',
        cookie: 'remote_codex_relay_session=session-token',
        'content-length': '999',
        'transfer-encoding': 'chunked',
        host: 'relay.example.test',
        origin: 'https://relay.example.test',
        referer: 'https://relay.example.test/relay-portal',
        'x-forwarded-for': '203.0.113.10',
        'x-forwarded-host': 'relay.example.test',
        'x-real-ip': '203.0.113.10',
        'x-remote-codex-relay-forwarded': '1',
        'content-type': 'application/json',
        accept: ['application/json', 'text/plain'],
        range: 'bytes=0-99',
      }),
    ).toEqual({
      'content-type': 'application/json',
      accept: 'application/json, text/plain',
      range: 'bytes=0-99',
    });

    expect(relayRequestBody({ absPath: '/repo', label: 'Android E2E' })).toEqual({
      body: '{"absPath":"/repo","label":"Android E2E"}',
    });
    expect(relayRequestBody(Buffer.from([0, 1, 255]))).toEqual({
      body: 'AAH/',
      bodyEncoding: 'base64',
    });
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
      token: deviceBody.token,
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
          token: deviceBody.token,
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

  it('lets relay users update username and password', async () => {
    const app = buildRelayServer(testConfig());
    await app.ready();

    const registerResponse = await app.inject({
      method: 'POST',
      url: '/relay/auth/register',
      payload: {
        email: 'account@example.test',
        username: 'account',
        password: 'password123',
      },
    });
    const token = registerResponse.json().token;

    const accountResponse = await app.inject({
      method: 'PATCH',
      url: '/relay/account',
      headers: { authorization: `Bearer ${token}` },
      payload: { username: 'renamed' },
    });
    expect(accountResponse.statusCode).toBe(200);
    expect(accountResponse.json()).toMatchObject({
      username: 'renamed',
      email: 'account@example.test',
    });

    const passwordResponse = await app.inject({
      method: 'PATCH',
      url: '/relay/account/password',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        currentPassword: 'password123',
        newPassword: 'new-password-123',
      },
    });
    expect(passwordResponse.statusCode).toBe(200);

    const oldLoginResponse = await app.inject({
      method: 'POST',
      url: '/relay/auth/login',
      payload: {
        identifier: 'renamed',
        password: 'password123',
      },
    });
    expect(oldLoginResponse.statusCode).toBe(401);

    const newLoginResponse = await app.inject({
      method: 'POST',
      url: '/relay/auth/login',
      payload: {
        identifier: 'renamed',
        password: 'new-password-123',
      },
    });
    expect(newLoginResponse.statusCode).toBe(200);

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
    expect(disableResponse.json()).toMatchObject({
      registrationEnabled: false,
      settings: {
        enabled: false,
        registrationPassword: null,
        approvalRequired: false,
      },
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

  it('lets admin configure registration password and approve pending registrations', async () => {
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
    const token = loginResponse.json().token as string;

    const settingsResponse = await app.inject({
      method: 'PATCH',
      url: '/relay/admin/settings/registration',
      headers: {
        authorization: `Bearer ${token}`,
      },
      payload: {
        enabled: true,
        registrationPassword: 'invite-password-123',
        approvalRequired: true,
      },
    });

    expect(settingsResponse.statusCode).toBe(200);
    expect(settingsResponse.json()).toMatchObject({
      settings: {
        enabled: true,
        registrationPassword: 'invite-password-123',
        approvalRequired: true,
      },
    });

    const pendingResponse = await app.inject({
      method: 'POST',
      url: '/relay/auth/register',
      payload: {
        email: 'pending@example.test',
        username: 'pending',
        password: 'password123',
        registrationPassword: 'invite-password-123',
      },
    });

    expect(pendingResponse.statusCode).toBe(202);
    expect(pendingResponse.json()).toMatchObject({
      pendingApproval: true,
      request: {
        email: 'pending@example.test',
        username: 'pending',
      },
    });
    const requestId = pendingResponse.json().request.id as string;

    const adminSummaryResponse = await app.inject({
      method: 'GET',
      url: '/relay/admin?days=30',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });
    expect(adminSummaryResponse.statusCode).toBe(200);
    expect(adminSummaryResponse.json()).toMatchObject({
      conversationWindowDays: 30,
      settings: {
        registrationPassword: 'invite-password-123',
        approvalRequired: true,
      },
      pendingRegistrations: [
        expect.objectContaining({
          id: requestId,
          username: 'pending',
        }),
      ],
    });

    const approveResponse = await app.inject({
      method: 'POST',
      url: `/relay/admin/registrations/${requestId}/approve`,
      headers: {
        authorization: `Bearer ${token}`,
      },
    });
    expect(approveResponse.statusCode).toBe(200);
    expect(approveResponse.json()).toMatchObject({
      username: 'pending',
      email: 'pending@example.test',
    });

    const userLoginResponse = await app.inject({
      method: 'POST',
      url: '/relay/auth/login',
      payload: {
        identifier: 'pending',
        password: 'password123',
      },
    });
    expect(userLoginResponse.statusCode).toBe(200);

    await app.close();
  });

  it('keeps admin accounts out of normal relay workspace and device flows', async () => {
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
    const token = loginResponse.json().token as string;

    const portalResponse = await app.inject({
      method: 'GET',
      url: '/relay/portal',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });
    expect(portalResponse.statusCode).toBe(403);
    expect(portalResponse.json()).toMatchObject({
      message: 'Use the relay admin panel for this account.',
    });

    const deviceResponse = await app.inject({
      method: 'POST',
      url: '/relay/devices',
      headers: {
        authorization: `Bearer ${token}`,
      },
      payload: {
        name: 'Admin workstation',
      },
    });
    expect(deviceResponse.statusCode).toBe(403);

    await app.close();
  });

  it('lets admin reset and delete ordinary relay users', async () => {
    const app = buildRelayServer(testConfig());
    await app.ready();

    const adminLoginResponse = await app.inject({
      method: 'POST',
      url: '/relay/auth/login',
      payload: {
        identifier: 'admin',
        password: 'password123',
      },
    });
    const adminToken = adminLoginResponse.json().token as string;

    const userResponse = await app.inject({
      method: 'POST',
      url: '/relay/auth/register',
      payload: {
        email: 'managed@example.test',
        username: 'managed',
        password: 'password123',
      },
    });
    const userId = userResponse.json().session.user.id as string;

    const resetResponse = await app.inject({
      method: 'POST',
      url: `/relay/admin/users/${userId}/reset-password`,
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
      payload: {
        password: 'new-password-123',
      },
    });
    expect(resetResponse.statusCode).toBe(200);
    expect(resetResponse.json()).toMatchObject({
      id: userId,
      username: 'managed',
    });

    const oldLoginResponse = await app.inject({
      method: 'POST',
      url: '/relay/auth/login',
      payload: {
        identifier: 'managed',
        password: 'password123',
      },
    });
    expect(oldLoginResponse.statusCode).toBe(401);

    const newLoginResponse = await app.inject({
      method: 'POST',
      url: '/relay/auth/login',
      payload: {
        identifier: 'managed',
        password: 'new-password-123',
      },
    });
    expect(newLoginResponse.statusCode).toBe(200);

    const deleteResponse = await app.inject({
      method: 'DELETE',
      url: `/relay/admin/users/${userId}`,
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
    });
    expect(deleteResponse.statusCode).toBe(200);
    expect(deleteResponse.json()).toEqual({ id: userId });

    const deletedLoginResponse = await app.inject({
      method: 'POST',
      url: '/relay/auth/login',
      payload: {
        identifier: 'managed',
        password: 'new-password-123',
      },
    });
    expect(deletedLoginResponse.statusCode).toBe(401);

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
        targetIdentifier: 'friend@example.test',
        deviceId,
        threadId: 'thread-1',
        workspaceId: '33333333-3333-4333-8333-333333333333',
        label: 'Review session',
        threadAccess: 'read',
        workspaceAccess: 'read',
      },
    });

    expect(shareResponse.statusCode).toBe(200);
    expect(shareResponse.json()).toMatchObject({
      deviceId,
      threadId: 'thread-1',
      workspaceId: '33333333-3333-4333-8333-333333333333',
      label: 'Review session',
      threadAccess: 'read',
      workspaceAccess: 'read',
      expiresAt: null,
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
        workspaceId: '33333333-3333-4333-8333-333333333333',
        label: 'Review session',
        threadAccess: 'read',
        workspaceAccess: 'read',
      }),
    ]);

    const ownerPortalBeforeAccessResponse = await app.inject({
      method: 'GET',
      url: '/relay/portal',
      headers: {
        authorization: `Bearer ${ownerToken}`,
      },
    });
    expect(ownerPortalBeforeAccessResponse.statusCode).toBe(200);
    expect(ownerPortalBeforeAccessResponse.json().sharedByMe).toEqual([
      expect.objectContaining({
        deviceId,
        targetUsername: 'friend',
        threadId: 'thread-1',
        lastAccessedAt: null,
        lastAccessedByUsername: null,
        accessEvents: [],
      }),
    ]);

    const sharedThreadResponse = await app.inject({
      method: 'GET',
      url: `/relay/devices/${deviceId}/api/threads/thread-1`,
      headers: {
        authorization: `Bearer ${friendToken}`,
      },
    });
    expect(sharedThreadResponse.statusCode).toBe(503);

    const ownerPortalAfterAccessResponse = await app.inject({
      method: 'GET',
      url: '/relay/portal',
      headers: {
        authorization: `Bearer ${ownerToken}`,
      },
    });
    expect(ownerPortalAfterAccessResponse.statusCode).toBe(200);
    expect(ownerPortalAfterAccessResponse.json().sharedByMe).toEqual([
      expect.objectContaining({
        deviceId,
        targetUsername: 'friend',
        threadId: 'thread-1',
        lastAccessedByUsername: 'friend',
        accessEvents: [
          expect.objectContaining({
            username: 'friend',
            shareId: shareResponse.json().id,
          }),
        ],
      }),
    ]);
    expect(ownerPortalAfterAccessResponse.json().sharedByMe[0].lastAccessedAt).toEqual(expect.any(String));

    const accessResponse = await app.inject({
      method: 'GET',
      url: `/relay/access?deviceId=${deviceId}&threadId=thread-1&workspaceId=33333333-3333-4333-8333-333333333333`,
      headers: {
        authorization: `Bearer ${friendToken}`,
      },
    });
    expect(accessResponse.statusCode).toBe(200);
    expect(accessResponse.json()).toMatchObject({
      kind: 'shared',
      shareId: shareResponse.json().id,
      threadAccess: 'read',
      workspaceAccess: 'read',
      workspaceId: '33333333-3333-4333-8333-333333333333',
    });

    await app.close();
  });

  it('limits shared users by thread and workspace access levels', async () => {
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
        targetIdentifier: 'friend',
        deviceId,
        threadId: '11111111-1111-4111-8111-111111111111',
        workspaceId: '33333333-3333-4333-8333-333333333333',
        threadAccess: 'read',
        workspaceAccess: 'read',
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

    const readonlyPromptResponse = await app.inject({
      method: 'POST',
      url: `/relay/devices/${deviceId}/api/threads/11111111-1111-4111-8111-111111111111/prompt`,
      headers: {
        authorization: `Bearer ${friendToken}`,
      },
      payload: {
        prompt: 'hello',
      },
    });
    expect(readonlyPromptResponse.statusCode).toBe(403);

    const readonlyGoalUpdateResponse = await app.inject({
      method: 'PATCH',
      url: `/relay/devices/${deviceId}/api/threads/11111111-1111-4111-8111-111111111111/goal`,
      headers: {
        authorization: `Bearer ${friendToken}`,
      },
      payload: {
        status: 'blocked',
      },
    });
    expect(readonlyGoalUpdateResponse.statusCode).toBe(403);

    const readonlyForkTurnsResponse = await app.inject({
      method: 'GET',
      url: `/relay/devices/${deviceId}/api/threads/11111111-1111-4111-8111-111111111111/fork-turns`,
      headers: {
        authorization: `Bearer ${friendToken}`,
      },
    });
    expect(readonlyForkTurnsResponse.statusCode).toBe(403);

    const otherThreadResponse = await app.inject({
      method: 'GET',
      url: `/relay/devices/${deviceId}/api/threads/22222222-2222-4222-8222-222222222222`,
      headers: {
        authorization: `Bearer ${friendToken}`,
      },
    });
    expect(otherThreadResponse.statusCode).toBe(403);

    const workspaceReadResponse = await app.inject({
      method: 'GET',
      url: `/relay/devices/${deviceId}/api/workspaces/33333333-3333-4333-8333-333333333333/files/tree`,
      headers: {
        authorization: `Bearer ${friendToken}`,
      },
    });
    expect(workspaceReadResponse.statusCode).toBe(503);

    const workspaceWriteResponse = await app.inject({
      method: 'PUT',
      url: `/relay/devices/${deviceId}/api/workspaces/33333333-3333-4333-8333-333333333333/files`,
      headers: {
        authorization: `Bearer ${friendToken}`,
      },
      payload: {
        path: 'README.md',
        content: 'hello',
      },
    });
    expect(workspaceWriteResponse.statusCode).toBe(403);

    const otherWorkspaceResponse = await app.inject({
      method: 'GET',
      url: `/relay/devices/${deviceId}/api/workspaces/44444444-4444-4444-8444-444444444444/files/tree`,
      headers: {
        authorization: `Bearer ${friendToken}`,
      },
    });
    expect(otherWorkspaceResponse.statusCode).toBe(403);

    const updateShareResponse = await app.inject({
      method: 'POST',
      url: '/relay/shares',
      headers: {
        authorization: `Bearer ${ownerToken}`,
      },
      payload: {
        targetIdentifier: 'friend',
        deviceId,
        threadId: '11111111-1111-4111-8111-111111111111',
        workspaceId: '33333333-3333-4333-8333-333333333333',
        threadAccess: 'control',
        workspaceAccess: 'write',
      },
    });
    expect(updateShareResponse.statusCode).toBe(200);
    expect(updateShareResponse.json()).toMatchObject({
      threadAccess: 'control',
      workspaceAccess: 'write',
    });

    const controlPromptResponse = await app.inject({
      method: 'POST',
      url: `/relay/devices/${deviceId}/api/threads/11111111-1111-4111-8111-111111111111/prompt`,
      headers: {
        authorization: `Bearer ${friendToken}`,
      },
      payload: {
        prompt: 'hello',
      },
    });
    expect(controlPromptResponse.statusCode).toBe(503);

    const workspaceWriteAllowedResponse = await app.inject({
      method: 'PUT',
      url: `/relay/devices/${deviceId}/api/workspaces/33333333-3333-4333-8333-333333333333/files`,
      headers: {
        authorization: `Bearer ${friendToken}`,
      },
      payload: {
        path: 'README.md',
        content: 'hello',
      },
    });
    expect(workspaceWriteAllowedResponse.statusCode).toBe(503);

    await app.close();
  });

  it('allows documented read-only thread routes for shared viewers', async () => {
    const { app, friendToken, deviceId } = await setupSharedRelaySession({
      threadAccess: 'read',
      workspaceAccess: 'none',
      workspaceId: null,
    });

    const threadReadUrls = [
      `/relay/devices/${deviceId}/api/threads/${SHARED_THREAD_ID}`,
      `/relay/devices/${deviceId}/api/threads/${SHARED_THREAD_ID}/items/item-1/detail`,
      `/relay/devices/${deviceId}/api/threads/${SHARED_THREAD_ID}/export-turns`,
      `/relay/devices/${deviceId}/api/threads/${SHARED_THREAD_ID}/exports/pdf?format=html`,
      `/relay/devices/${deviceId}/api/threads/${SHARED_THREAD_ID}/assets/image?path=image.png`,
      `/relay/devices/${deviceId}/api/threads/${SHARED_THREAD_ID}/goal`,
      `/relay/devices/${deviceId}/api/threads/${SHARED_THREAD_ID}/skills`,
      `/relay/devices/${deviceId}/api/threads/${SHARED_THREAD_ID}/mcp-servers`,
      `/relay/devices/${deviceId}/api/threads/${SHARED_THREAD_ID}/hooks`,
    ];

    for (const url of threadReadUrls) {
      const response = await app.inject({
        method: 'GET',
        url,
        headers: {
          authorization: `Bearer ${friendToken}`,
        },
      });
      expect(response.statusCode, url).toBe(503);
    }

    await app.close();
  });

  it('allows shared viewers to read runtime metadata required by the slash toolbox', async () => {
    const { app, friendToken, deviceId } = await setupSharedRelaySession({
      threadAccess: 'control',
      workspaceAccess: 'read',
    });

    const runtimeMetadataUrls = [
      `/relay/devices/${deviceId}/api/agent-runtimes`,
      `/relay/devices/${deviceId}/api/agent-runtimes/codex/status`,
      `/relay/devices/${deviceId}/api/agent-runtimes/codex/models`,
    ];

    for (const url of runtimeMetadataUrls) {
      const response = await app.inject({
        method: 'GET',
        url,
        headers: {
          authorization: `Bearer ${friendToken}`,
        },
      });
      expect(response.statusCode).toBe(503);
    }

    const restartResponse = await app.inject({
      method: 'POST',
      url: `/relay/devices/${deviceId}/api/agent-runtimes/codex/restart`,
      headers: {
        authorization: `Bearer ${friendToken}`,
      },
    });
    expect(restartResponse.statusCode).toBe(403);

    await app.close();
  });

  it('returns only shared thread records for shared room list refreshes', async () => {
    const { app, friendToken, deviceId, deviceToken } = await setupSharedRelaySession({
      threadAccess: 'read',
      workspaceAccess: 'none',
      workspaceId: null,
    });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const baseUrl = websocketBaseUrl(app);
    const supervisorSocket = new WebSocket(
      `${baseUrl}/supervisor/tunnel?deviceToken=${encodeURIComponent(deviceToken)}`,
    );

    try {
      await waitForSocketOpen(supervisorSocket);
      const listResponsePromise = app.inject({
        method: 'GET',
        url: `/relay/devices/${deviceId}/api/threads`,
        headers: {
          authorization: `Bearer ${friendToken}`,
        },
      });

      await expect(
        answerNextRelayRequest(
          supervisorSocket,
          (message) =>
            message.payload.method === 'GET' &&
            message.payload.path === `/api/threads/${SHARED_THREAD_ID}?limit=1`,
          {
            thread: {
              id: SHARED_THREAD_ID,
              workspaceId: SHARED_WORKSPACE_ID,
              title: 'Shared running thread',
              status: 'running',
              activeTurnId: 'turn-1',
              isLoaded: true,
            },
          },
        ),
      ).resolves.toMatchObject({
        payload: {
          method: 'GET',
          path: `/api/threads/${SHARED_THREAD_ID}?limit=1`,
        },
      });

      const listResponse = await listResponsePromise;
      expect(listResponse.statusCode).toBe(200);
      expect(listResponse.json()).toEqual([
        {
          id: SHARED_THREAD_ID,
          workspaceId: SHARED_WORKSPACE_ID,
          title: 'Shared running thread',
          status: 'running',
          activeTurnId: 'turn-1',
          isLoaded: true,
        },
      ]);
    } finally {
      supervisorSocket.close();
      await app.close();
    }
  });

  it('allows documented read-only workspace routes for shared workspace readers', async () => {
    const { app, friendToken, deviceId } = await setupSharedRelaySession({
      threadAccess: 'read',
      workspaceAccess: 'read',
    });

    const workspaceReadUrls = [
      `/relay/devices/${deviceId}/api/workspaces/${SHARED_WORKSPACE_ID}`,
      `/relay/devices/${deviceId}/api/workspaces/${SHARED_WORKSPACE_ID}/files/tree`,
      `/relay/devices/${deviceId}/api/workspaces/${SHARED_WORKSPACE_ID}/files/preview?path=README.md`,
      `/relay/devices/${deviceId}/api/workspaces/${SHARED_WORKSPACE_ID}/files/raw?path=README.md`,
      `/relay/devices/${deviceId}/api/workspaces/${SHARED_WORKSPACE_ID}/files/download?path=README.md`,
      `/relay/devices/${deviceId}/api/workspaces/${SHARED_WORKSPACE_ID}/artifacts`,
      `/relay/devices/${deviceId}/api/workspaces/${SHARED_WORKSPACE_ID}/artifacts/artifact-1`,
      `/relay/devices/${deviceId}/api/workspaces/${SHARED_WORKSPACE_ID}/artifacts/artifact-1/download`,
    ];

    for (const url of workspaceReadUrls) {
      const response = await app.inject({
        method: 'GET',
        url,
        headers: {
          authorization: `Bearer ${friendToken}`,
        },
      });
      expect(response.statusCode, url).toBe(503);
    }

    await app.close();
  });

  it('keeps collaborator shares out of owner-only thread operations', async () => {
    const { app, friendToken, deviceId } = await setupSharedRelaySession({
      threadAccess: 'control',
      workspaceAccess: 'write',
    });

    const deleteThreadResponse = await app.inject({
      method: 'DELETE',
      url: `/relay/devices/${deviceId}/api/threads/${SHARED_THREAD_ID}`,
      headers: {
        authorization: `Bearer ${friendToken}`,
      },
    });

    expect(deleteThreadResponse.statusCode).toBe(403);

    const ownerOnlyRequests = [
      {
        method: 'PATCH',
        url: `/relay/devices/${deviceId}/api/threads/${SHARED_THREAD_ID}`,
        payload: { title: 'Renamed thread' },
      },
    ] as const;

    for (const request of ownerOnlyRequests) {
      const response = await app.inject({
        method: request.method,
        url: request.url,
        headers: {
          authorization: `Bearer ${friendToken}`,
        },
        payload: request.payload,
      });
      expect(response.statusCode, `${request.method} ${request.url}`).toBe(403);
    }

    await app.close();
  });

  it('allows documented collaborator thread control routes', async () => {
    const { app, friendToken, deviceId } = await setupSharedRelaySession({
      threadAccess: 'control',
      workspaceAccess: 'read',
    });

    const collaboratorRequests = [
      {
        method: 'POST',
        url: `/relay/devices/${deviceId}/api/threads/${SHARED_THREAD_ID}/interrupt`,
        payload: {},
      },
      {
        method: 'POST',
        url: `/relay/devices/${deviceId}/api/threads/${SHARED_THREAD_ID}/resume`,
        payload: {},
      },
      {
        method: 'POST',
        url: `/relay/devices/${deviceId}/api/threads/${SHARED_THREAD_ID}/requests/request-1/respond`,
        payload: { response: 'approved' },
      },
      {
        method: 'PATCH',
        url: `/relay/devices/${deviceId}/api/threads/${SHARED_THREAD_ID}/goal`,
        payload: { status: 'blocked' },
      },
      {
        method: 'PATCH',
        url: `/relay/devices/${deviceId}/api/threads/${SHARED_THREAD_ID}/settings`,
        payload: { fastMode: true },
      },
      {
        method: 'POST',
        url: `/relay/devices/${deviceId}/api/threads/${SHARED_THREAD_ID}/compact`,
        payload: {},
      },
      {
        method: 'POST',
        url: `/relay/devices/${deviceId}/api/threads/${SHARED_THREAD_ID}/fork`,
        payload: { mode: 'latest' },
      },
      {
        method: 'POST',
        url: `/relay/devices/${deviceId}/api/threads/${SHARED_THREAD_ID}/hooks`,
        payload: {
          scope: 'global',
          event: 'stop',
          matcher: '',
          command: 'echo ok',
          timeoutSec: 30,
        },
      },
      {
        method: 'PUT',
        url: `/relay/devices/${deviceId}/api/threads/${SHARED_THREAD_ID}/hooks`,
        payload: {
          target: {
            scope: 'global',
            event: 'stop',
            matcher: '',
            command: 'echo ok',
          },
          scope: 'global',
          event: 'stop',
          matcher: '',
          command: 'echo next',
          timeoutSec: 30,
        },
      },
      {
        method: 'POST',
        url: `/relay/devices/${deviceId}/api/threads/${SHARED_THREAD_ID}/hooks/trust`,
        payload: {
          scope: 'global',
          event: 'stop',
          matcher: '',
          command: 'echo ok',
          hash: 'sha256:abc',
        },
      },
      {
        method: 'POST',
        url: `/relay/devices/${deviceId}/api/threads/${SHARED_THREAD_ID}/hooks/untrust`,
        payload: {
          scope: 'global',
          event: 'stop',
          matcher: '',
          command: 'echo ok',
        },
      },
    ] as const;
    const collaboratorRequestsWithoutPayload = [
      {
        method: 'DELETE',
        url: `/relay/devices/${deviceId}/api/threads/${SHARED_THREAD_ID}/goal`,
      },
      {
        method: 'GET',
        url: `/relay/devices/${deviceId}/api/threads/${SHARED_THREAD_ID}/fork-turns`,
      },
    ] as const;

    for (const request of collaboratorRequests) {
      const response = await app.inject({
        method: request.method,
        url: request.url,
        headers: {
          authorization: `Bearer ${friendToken}`,
        },
        payload: request.payload,
      });
      expect(response.statusCode, `${request.method} ${request.url}`).toBe(503);
    }
    for (const request of collaboratorRequestsWithoutPayload) {
      const response = await app.inject({
        method: request.method,
        url: request.url,
        headers: {
          authorization: `Bearer ${friendToken}`,
        },
      });
      expect(response.statusCode, `${request.method} ${request.url}`).toBe(503);
    }

    await app.close();
  });

  it('forwards collaborator prompt HTTP requests to the supervisor', async () => {
    const { app, friendToken, deviceId, deviceToken } = await setupSharedRelaySession({
      threadAccess: 'control',
      workspaceAccess: 'read',
    });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const baseUrl = websocketBaseUrl(app);
    const supervisorSocket = new WebSocket(
      `${baseUrl}/supervisor/tunnel?deviceToken=${encodeURIComponent(deviceToken)}`,
    );

    try {
      await waitForSocketOpen(supervisorSocket);
      const promptResponsePromise = app.inject({
        method: 'POST',
        url: `/relay/devices/${deviceId}/api/threads/${SHARED_THREAD_ID}/prompt`,
        headers: {
          authorization: `Bearer ${friendToken}`,
        },
        payload: {
          prompt: 'hello from collaborator',
        },
      });

      const requestMessage = await waitForSocketMessageMatching(
        supervisorSocket,
        (message) => message.type === 'relay.request',
      );
      expect(requestMessage).toMatchObject({
        type: 'relay.request',
        payload: {
          method: 'POST',
          path: `/api/threads/${SHARED_THREAD_ID}/prompt`,
        },
      });
      expect(JSON.parse(requestMessage.payload.body)).toEqual({
        prompt: 'hello from collaborator',
      });

      supervisorSocket.send(JSON.stringify({
        type: 'relay.response',
        timestamp: '2026-07-01T00:00:04.000Z',
        requestId: requestMessage.requestId,
        payload: {
          statusCode: 200,
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({ ok: true }),
        },
      }));

      const promptResponse = await promptResponsePromise;
      expect(promptResponse.statusCode).toBe(200);
      expect(promptResponse.json()).toEqual({ ok: true });
    } finally {
      supervisorSocket.close();
      await app.close();
    }
  });

  it('keeps workspace write shares out of owner-only workspace operations', async () => {
    const { app, friendToken, deviceId } = await setupSharedRelaySession({
      threadAccess: 'control',
      workspaceAccess: 'write',
    });

    const ownerOnlyRequests = [
      {
        method: 'PATCH',
        url: `/relay/devices/${deviceId}/api/workspaces/${SHARED_WORKSPACE_ID}`,
        payload: { label: 'Renamed workspace' },
      },
      {
        method: 'PATCH',
        url: `/relay/devices/${deviceId}/api/workspaces/${SHARED_WORKSPACE_ID}/favorite`,
        payload: { isFavorite: true },
      },
      {
        method: 'POST',
        url: `/relay/devices/${deviceId}/api/workspaces/${SHARED_WORKSPACE_ID}/open`,
        payload: {},
      },
      {
        method: 'POST',
        url: `/relay/devices/${deviceId}/api/workspaces/${SHARED_WORKSPACE_ID}/artifacts`,
        payload: { kind: 'generated', title: 'Artifact' },
      },
      {
        method: 'DELETE',
        url: `/relay/devices/${deviceId}/api/workspaces/${SHARED_WORKSPACE_ID}/artifacts/artifact-1`,
        payload: {},
      },
    ] as const;

    for (const request of ownerOnlyRequests) {
      const response = await app.inject({
        method: request.method,
        url: request.url,
        headers: {
          authorization: `Bearer ${friendToken}`,
        },
        payload: request.payload,
      });
      expect(response.statusCode, `${request.method} ${request.url}`).toBe(403);
    }

    await app.close();
  });

  it('blocks workspace access when a share has no workspace permission', async () => {
    const { app, friendToken, deviceId } = await setupSharedRelaySession({
      threadAccess: 'read',
      workspaceAccess: 'none',
      workspaceId: null,
    });

    const workspaceResponse = await app.inject({
      method: 'GET',
      url: `/relay/devices/${deviceId}/api/workspaces/${SHARED_WORKSPACE_ID}/files/tree`,
      headers: {
        authorization: `Bearer ${friendToken}`,
      },
    });

    expect(workspaceResponse.statusCode).toBe(403);

    await app.close();
  });

  it('revokes shared HTTP access immediately', async () => {
    const { app, ownerToken, friendToken, deviceId, shareId } = await setupSharedRelaySession({
      threadAccess: 'read',
      workspaceAccess: 'read',
    });

    const allowedBeforeRevokeResponse = await app.inject({
      method: 'GET',
      url: `/relay/devices/${deviceId}/api/threads/${SHARED_THREAD_ID}`,
      headers: {
        authorization: `Bearer ${friendToken}`,
      },
    });
    expect(allowedBeforeRevokeResponse.statusCode).toBe(503);

    const revokeResponse = await app.inject({
      method: 'DELETE',
      url: `/relay/shares/${shareId}`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
      },
    });
    expect(revokeResponse.statusCode).toBe(200);

    const blockedAfterRevokeResponse = await app.inject({
      method: 'GET',
      url: `/relay/devices/${deviceId}/api/threads/${SHARED_THREAD_ID}`,
      headers: {
        authorization: `Bearer ${friendToken}`,
      },
    });
    expect(blockedAfterRevokeResponse.statusCode).toBe(403);

    await app.close();
  });

  it('lets share owners update shared thread permissions', async () => {
    const { app, ownerToken, friendToken, shareId } = await setupSharedRelaySession({
      threadAccess: 'read',
      workspaceAccess: 'read',
    });

    const friendUpdateResponse = await app.inject({
      method: 'PATCH',
      url: `/relay/shares/${shareId}`,
      headers: {
        authorization: `Bearer ${friendToken}`,
      },
      payload: {
        threadAccess: 'control',
        workspaceAccess: 'write',
      },
    });
    expect(friendUpdateResponse.statusCode).toBe(404);

    const ownerUpdateResponse = await app.inject({
      method: 'PATCH',
      url: `/relay/shares/${shareId}`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
      },
      payload: {
        label: 'Pair review',
        threadAccess: 'control',
        workspaceAccess: 'write',
      },
    });
    expect(ownerUpdateResponse.statusCode).toBe(200);
    expect(ownerUpdateResponse.json()).toMatchObject({
      id: shareId,
      label: 'Pair review',
      threadAccess: 'control',
      workspaceAccess: 'write',
      threadId: SHARED_THREAD_ID,
    });

    const friendPortalResponse = await app.inject({
      method: 'GET',
      url: '/relay/portal',
      headers: {
        authorization: `Bearer ${friendToken}`,
      },
    });
    expect(friendPortalResponse.json().sharedWithMe[0]).toMatchObject({
      id: shareId,
      label: 'Pair review',
      threadAccess: 'control',
      workspaceAccess: 'write',
      threadId: SHARED_THREAD_ID,
    });

    await app.close();
  });

  it('keeps expired shares out of portal summaries and shared HTTP access', async () => {
    const { app, friendToken, deviceId, shareId } = await setupSharedRelaySession({
      threadAccess: 'read',
      workspaceAccess: 'read',
      expiresAt: '2000-01-01T00:00:00.000Z',
    });

    const friendPortalResponse = await app.inject({
      method: 'GET',
      url: '/relay/portal',
      headers: {
        authorization: `Bearer ${friendToken}`,
      },
    });
    expect(friendPortalResponse.statusCode).toBe(200);
    expect(friendPortalResponse.json().sharedWithMe).toEqual([]);

    const accessResponse = await app.inject({
      method: 'GET',
      url: `/relay/access?deviceId=${deviceId}&threadId=${SHARED_THREAD_ID}&workspaceId=${SHARED_WORKSPACE_ID}`,
      headers: {
        authorization: `Bearer ${friendToken}`,
      },
    });
    expect(accessResponse.statusCode).toBe(403);

    const threadResponse = await app.inject({
      method: 'GET',
      url: `/relay/devices/${deviceId}/api/threads/${SHARED_THREAD_ID}`,
      headers: {
        authorization: `Bearer ${friendToken}`,
      },
    });
    expect(threadResponse.statusCode).toBe(403);

    const workspaceResponse = await app.inject({
      method: 'GET',
      url: `/relay/devices/${deviceId}/api/workspaces/${SHARED_WORKSPACE_ID}/files/tree`,
      headers: {
        authorization: `Bearer ${friendToken}`,
      },
    });
    expect(workspaceResponse.statusCode).toBe(403);

    expect(shareId).toBeTruthy();
    await app.close();
  });

  it('forwards read-only shared thread and workspace HTTP reads to the supervisor', async () => {
    const { app, friendToken, deviceId, deviceToken } = await setupSharedRelaySession({
      threadAccess: 'read',
      workspaceAccess: 'read',
    });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const baseUrl = websocketBaseUrl(app);
    const supervisorSocket = new WebSocket(
      `${baseUrl}/supervisor/tunnel?deviceToken=${encodeURIComponent(deviceToken)}`,
    );

    try {
      await waitForSocketOpen(supervisorSocket);

      const threadResponsePromise = app.inject({
        method: 'GET',
        url: `/relay/devices/${deviceId}/api/threads/${SHARED_THREAD_ID}`,
        headers: {
          authorization: `Bearer ${friendToken}`,
        },
      });
      await expect(
        answerNextRelayRequest(
          supervisorSocket,
          (message) =>
            message.payload.method === 'GET' &&
            message.payload.path === `/api/threads/${SHARED_THREAD_ID}`,
          { threadId: SHARED_THREAD_ID },
        ),
      ).resolves.toMatchObject({
        payload: {
          method: 'GET',
          path: `/api/threads/${SHARED_THREAD_ID}`,
        },
      });
      const threadResponse = await threadResponsePromise;
      expect(threadResponse.statusCode).toBe(200);
      expect(threadResponse.json()).toEqual({ threadId: SHARED_THREAD_ID });

      const workspaceResponsePromise = app.inject({
        method: 'GET',
        url: `/relay/devices/${deviceId}/api/workspaces/${SHARED_WORKSPACE_ID}/files/tree`,
        headers: {
          authorization: `Bearer ${friendToken}`,
        },
      });
      await expect(
        answerNextRelayRequest(
          supervisorSocket,
          (message) =>
            message.payload.method === 'GET' &&
            message.payload.path === `/api/workspaces/${SHARED_WORKSPACE_ID}/files/tree`,
          { workspaceId: SHARED_WORKSPACE_ID },
        ),
      ).resolves.toMatchObject({
        payload: {
          method: 'GET',
          path: `/api/workspaces/${SHARED_WORKSPACE_ID}/files/tree`,
        },
      });
      const workspaceResponse = await workspaceResponsePromise;
      expect(workspaceResponse.statusCode).toBe(200);
      expect(workspaceResponse.json()).toEqual({ workspaceId: SHARED_WORKSPACE_ID });
    } finally {
      supervisorSocket.close();
      await app.close();
    }
  });

  it('blocks sensitive relayed response headers from the supervisor', async () => {
    const { app, friendToken, deviceId, deviceToken } = await setupSharedRelaySession({
      threadAccess: 'read',
      workspaceAccess: 'read',
    });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const baseUrl = websocketBaseUrl(app);
    const supervisorSocket = new WebSocket(
      `${baseUrl}/supervisor/tunnel?deviceToken=${encodeURIComponent(deviceToken)}`,
    );

    try {
      await waitForSocketOpen(supervisorSocket);

      const responsePromise = app.inject({
        method: 'GET',
        url: `/relay/devices/${deviceId}/api/threads/${SHARED_THREAD_ID}`,
        headers: {
          authorization: `Bearer ${friendToken}`,
        },
      });
      const requestMessage = await waitForSocketMessageMatching(
        supervisorSocket,
        (message) => message.type === 'relay.request',
      );
      supervisorSocket.send(JSON.stringify({
        type: 'relay.response',
        timestamp: '2026-07-01T00:00:04.000Z',
        requestId: requestMessage.requestId,
        payload: {
          statusCode: 200,
          headers: {
            'content-type': 'application/json',
            'cache-control': 'no-store',
            'set-cookie': 'remote_codex_relay_session=attacker',
            location: 'https://evil.example.test',
            refresh: '0; url=https://evil.example.test',
            'access-control-allow-origin': '*',
            'transfer-encoding': 'chunked',
          },
          body: JSON.stringify({ ok: true }),
        },
      }));

      const response = await responsePromise;
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('application/json');
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['set-cookie']).toBeUndefined();
      expect(response.headers.location).toBeUndefined();
      expect(response.headers.refresh).toBeUndefined();
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
      expect(response.headers['transfer-encoding']).toBeUndefined();
    } finally {
      supervisorSocket.close();
      await app.close();
    }
  });

  it('forwards matching thread updates to read-only shared websocket clients', async () => {
    const { app, friendToken, deviceId, deviceToken } = await setupSharedRelaySession({
      threadAccess: 'read',
      workspaceAccess: 'read',
    });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const baseUrl = websocketBaseUrl(app);
    const supervisorSocket = new WebSocket(
      `${baseUrl}/supervisor/tunnel?deviceToken=${encodeURIComponent(deviceToken)}`,
    );
    let clientSocket: WebSocket | null = null;

    try {
      await waitForSocketOpen(supervisorSocket);
      const connectedMessagePromise = waitForSocketMessageMatching(
        supervisorSocket,
        (message) => message.type === 'relay.client.connected',
      );
      clientSocket = new WebSocket(
        `${baseUrl}/relay/devices/${deviceId}/ws?threadId=${encodeURIComponent(SHARED_THREAD_ID)}&relaySession=${encodeURIComponent(friendToken)}`,
      );
      await waitForSocketOpen(clientSocket);
      const connectedMessage = await connectedMessagePromise;
      const clientId = connectedMessage.clientId as string;

      const matchingThreadUpdatePromise = waitForSocketMessage(clientSocket);
      supervisorSocket.send(JSON.stringify({
        type: 'relay.server.message',
        timestamp: '2026-07-01T00:00:01.000Z',
        clientId,
        payload: {
          type: 'thread.turn.started',
          threadId: SHARED_THREAD_ID,
          timestamp: '2026-07-01T00:00:01.000Z',
          payload: {
            turnId: 'turn-1',
          },
        },
      }));

      await expect(matchingThreadUpdatePromise).resolves.toMatchObject({
        type: 'thread.turn.started',
        threadId: SHARED_THREAD_ID,
        payload: {
          turnId: 'turn-1',
        },
      });

      const otherThreadUpdatePromise = expectNoSocketMessage(clientSocket);
      supervisorSocket.send(JSON.stringify({
        type: 'relay.server.message',
        timestamp: '2026-07-01T00:00:02.000Z',
        clientId,
        payload: {
          type: 'thread.turn.started',
          threadId: '22222222-2222-4222-8222-222222222222',
          timestamp: '2026-07-01T00:00:02.000Z',
          payload: {
            turnId: 'turn-other',
          },
        },
      }));

      await expect(otherThreadUpdatePromise).resolves.toBeUndefined();
    } finally {
      clientSocket?.close();
      supervisorSocket.close();
      await app.close();
    }
  });

  it('forwards collaborator websocket client messages to the supervisor', async () => {
    const { app, friendToken, deviceId, deviceToken } = await setupSharedRelaySession({
      threadAccess: 'control',
      workspaceAccess: 'read',
    });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const baseUrl = websocketBaseUrl(app);
    const supervisorSocket = new WebSocket(
      `${baseUrl}/supervisor/tunnel?deviceToken=${encodeURIComponent(deviceToken)}`,
    );
    let clientSocket: WebSocket | null = null;

    try {
      await waitForSocketOpen(supervisorSocket);
      const connectedMessagePromise = waitForSocketMessageMatching(
        supervisorSocket,
        (message) => message.type === 'relay.client.connected',
      );
      clientSocket = new WebSocket(
        `${baseUrl}/relay/devices/${deviceId}/ws?threadId=${encodeURIComponent(SHARED_THREAD_ID)}&relaySession=${encodeURIComponent(friendToken)}`,
      );
      await waitForSocketOpen(clientSocket);
      await connectedMessagePromise;

      const clientMessagePromise = waitForSocketMessageMatching(
        supervisorSocket,
        (message) => message.type === 'relay.client.message',
      );

      clientSocket.send(JSON.stringify({
        type: 'supervisor.ping',
        timestamp: '2026-07-01T00:00:03.000Z',
      }));

      await expect(clientMessagePromise).resolves.toMatchObject({
        type: 'relay.client.message',
        payload: {
          type: 'supervisor.ping',
          timestamp: '2026-07-01T00:00:03.000Z',
        },
      });
    } finally {
      clientSocket?.close();
      supervisorSocket.close();
      await app.close();
    }
  });

  it('closes read-only shared websocket clients that send control messages', async () => {
    const { app, friendToken, deviceId, deviceToken } = await setupSharedRelaySession({
      threadAccess: 'read',
      workspaceAccess: 'read',
    });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const baseUrl = websocketBaseUrl(app);
    const supervisorSocket = new WebSocket(
      `${baseUrl}/supervisor/tunnel?deviceToken=${encodeURIComponent(deviceToken)}`,
    );
    let clientSocket: WebSocket | null = null;

    try {
      await waitForSocketOpen(supervisorSocket);
      const connectedMessagePromise = waitForSocketMessageMatching(
        supervisorSocket,
        (message) => message.type === 'relay.client.connected',
      );
      clientSocket = new WebSocket(
        `${baseUrl}/relay/devices/${deviceId}/ws?threadId=${encodeURIComponent(SHARED_THREAD_ID)}&relaySession=${encodeURIComponent(friendToken)}`,
      );
      await waitForSocketOpen(clientSocket);
      await connectedMessagePromise;

      const closeEventPromise = waitForSocketClose(clientSocket);
      clientSocket.send(JSON.stringify({ type: 'thread.prompt', prompt: 'not allowed' }));
      const closeEvent = await closeEventPromise;

      expect(closeEvent.code).toBe(1008);
      expect(closeEvent.reason).toContain('read-only');
    } finally {
      clientSocket?.close();
      supervisorSocket.close();
      await app.close();
    }
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

  it('preserves binary relayed HTTP responses from pending tunnel requests', async () => {
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
        requestId: 'request-binary',
        payload: {
          method: 'GET',
          path: '/api/threads/thread-1/exports/pdf',
          headers: {},
          body: null,
        },
      },
    );

    expect(JSON.parse(sent[0]!)).toMatchObject({
      type: 'relay.request',
      requestId: 'request-binary',
      payload: {
        path: '/api/threads/thread-1/exports/pdf',
      },
    });

    const pdfBytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0x20]);
    expect(
      broker.accept({
        type: 'relay.response',
        timestamp: '2026-06-10T00:00:01.000Z',
        requestId: 'request-binary',
        payload: {
          statusCode: 200,
          headers: {
            'content-type': 'application/pdf',
          },
          body: pdfBytes.toString('base64'),
          bodyEncoding: 'base64',
        },
      }),
    ).toBe(true);

    const response = await responsePromise;
    expect(response.bodyEncoding).toBe('base64');
    expect(Buffer.from(response.body, 'base64')).toEqual(pdfBytes);
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
