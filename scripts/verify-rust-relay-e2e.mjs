#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const relayUrl = requiredUrl('REMOTE_CODEX_E2E_RELAY_URL');
const username = required('REMOTE_CODEX_E2E_USERNAME');
const password = required('REMOTE_CODEX_E2E_PASSWORD');
const binary = path.resolve(
  process.env.REMOTE_CODEX_E2E_BINARY ??
    path.resolve('target/debug/remote-codex'),
);
if (!fs.existsSync(binary))
  throw new Error(`Rust binary does not exist: ${binary}`);

const testRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), 'remote-codex-relay-e2e-'),
);
const workspaceRoot = path.join(testRoot, 'workspace');
fs.mkdirSync(workspaceRoot);
let sessionToken = null;
let deviceId = null;
let supervisor = null;
let eventSocket = null;
let failure = null;

try {
  const login = await requestJson('/relay/auth/login', {
    method: 'POST',
    body: { identifier: username, password },
    authenticated: false,
  });
  assert(
    login.session?.authenticated === true,
    'relay login was not authenticated',
  );
  assert(
    login.session?.user?.username === username,
    'relay login returned the wrong user',
  );
  sessionToken = login.token;
  assert(
    typeof sessionToken === 'string' && sessionToken.length > 20,
    'relay token is missing',
  );

  const before = await requestJson('/relay/portal');
  const deviceName = `Rust E2E ${new Date().toISOString()}`;
  const created = await requestJson('/relay/devices', {
    method: 'POST',
    body: { name: deviceName },
  });
  deviceId = created.device?.id;
  const deviceToken = created.token;
  assert(
    typeof deviceId === 'string' && deviceId,
    'created relay device has no id',
  );
  assert(
    typeof deviceToken === 'string' && deviceToken.startsWith('rcd_'),
    'created relay device has no token',
  );

  const supervisorPort = await availablePort();
  const relaySocketBase = new URL(relayUrl);
  relaySocketBase.protocol =
    relaySocketBase.protocol === 'https:' ? 'wss:' : 'ws:';
  supervisor = spawn(binary, ['relay-supervisor'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      REMOTE_CODEX_MODE: 'relay',
      REMOTE_CODEX_E2E_FAKE_RUNTIME: '1',
      REMOTE_CODEX_ENABLED_AGENT_PROVIDERS: 'codex',
      REMOTE_CODEX_ADMIN_USERNAME: 'e2e-admin',
      REMOTE_CODEX_ADMIN_PASSWORD: crypto.randomBytes(24).toString('base64url'),
      REMOTE_CODEX_SESSION_SECRET: crypto.randomBytes(32).toString('base64url'),
      REMOTE_CODEX_RELAY_SERVER_URL: relaySocketBase.toString(),
      REMOTE_CODEX_RELAY_AGENT_TOKEN: deviceToken,
      DATABASE_URL: path.join(testRoot, 'supervisor.sqlite'),
      WORKSPACE_ROOT: workspaceRoot,
      HOST: '127.0.0.1',
      PORT: String(supervisorPort),
      REMOTE_CODEX_RELAY_SUPERVISOR_HOST: '127.0.0.1',
      REMOTE_CODEX_RELAY_SUPERVISOR_PORT: String(supervisorPort),
      RUST_LOG: 'info',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let supervisorLog = '';
  supervisor.stdout.on('data', (chunk) => {
    supervisorLog = appendLog(supervisorLog, chunk);
  });
  supervisor.stderr.on('data', (chunk) => {
    supervisorLog = appendLog(supervisorLog, chunk);
  });

  const connectedDevice = await poll(
    async () => {
      ensureChildAlive(supervisor, supervisorLog);
      const portal = await requestJson('/relay/portal');
      return (
        portal.devices?.find(
          (device) => device.id === deviceId && device.connected,
        ) ?? null
      );
    },
    30_000,
    'local Rust supervisor did not connect to relay',
  );
  assert(
    connectedDevice.connected === true,
    'new relay device is not connected',
  );

  const deviceApi = `/relay/devices/${encodeURIComponent(deviceId)}/api`;
  const health = await requestJson(
    `/relay/devices/${encodeURIComponent(deviceId)}/healthz`,
  );
  assert(health.status === 'ok', 'forwarded supervisor health is not ok');

  const workspace = await requestJson(`${deviceApi}/workspaces`, {
    method: 'POST',
    body: { absPath: workspaceRoot, label: 'Relay Rust E2E' },
  });
  assert(
    path.resolve(workspace.absPath) ===
      path.resolve(fs.realpathSync(workspaceRoot)),
    'forwarded workspace path changed',
  );

  const binaryFixture = Uint8Array.from([0, 255, 10, 13, 42, 128, 1]);
  const upload = new FormData();
  upload.append('path', 'fixtures/relay-binary.bin');
  upload.append('file', new Blob([binaryFixture]), 'relay-binary.bin');
  const uploadResult = await requestJson(
    `${deviceApi}/workspaces/${encodeURIComponent(workspace.id)}/files/upload`,
    { method: 'POST', body: upload, rawBody: true },
  );
  assert(
    uploadResult.file?.size === binaryFixture.byteLength,
    'binary upload size changed',
  );
  const rawResponse = await request(
    `${deviceApi}/workspaces/${encodeURIComponent(workspace.id)}/files/raw?path=${encodeURIComponent('fixtures/relay-binary.bin')}`,
  );
  const downloaded = new Uint8Array(await rawResponse.arrayBuffer());
  assert(
    equalBytes(downloaded, binaryFixture),
    'binary relay round trip changed bytes',
  );

  const thread = await requestJson(`${deviceApi}/threads/start`, {
    method: 'POST',
    body: {
      workspaceId: workspace.id,
      title: 'Relay Rust E2E',
      provider: 'codex',
      agentId: 'codex',
      model: 'gpt-5.4',
      reasoningEffort: 'medium',
      approvalMode: 'guarded',
    },
  });
  assert(
    thread.workspaceId === workspace.id,
    'thread was created in the wrong workspace',
  );
  assert(
    thread.approvalMode === 'guarded',
    'thread approval mode was not preserved',
  );

  eventSocket = new WebSocket(relayWebSocketUrl(deviceId, thread.id));
  const connectedEvent = waitForSocketMessage(
    eventSocket,
    (message) => message.type === 'supervisor.connected',
    15_000,
    'relay websocket did not receive supervisor.connected',
  );
  await waitForSocketOpen(eventSocket, 15_000);
  await connectedEvent;

  const pingTimestamp = new Date().toISOString();
  const pong = waitForSocketMessage(
    eventSocket,
    (message) => message.type === 'supervisor.pong',
    10_000,
    'relay websocket did not return supervisor.pong',
  );
  eventSocket.send(
    JSON.stringify({ type: 'supervisor.ping', timestamp: pingTimestamp }),
  );
  await pong;

  const completion = waitForSocketMessage(
    eventSocket,
    (message) =>
      message.type === 'thread.turn.completed' &&
      message.threadId === thread.id,
    30_000,
    'relay websocket did not receive thread completion',
  );
  const marker = `RELAY_RUST_E2E_OK_${Date.now()}`;
  await requestJson(
    `${deviceApi}/threads/${encodeURIComponent(thread.id)}/prompt`,
    {
      method: 'POST',
      body: { prompt: marker, clientRequestId: crypto.randomUUID() },
    },
  );
  await completion;

  const detail = await poll(
    async () => {
      const value = await requestJson(
        `${deviceApi}/threads/${encodeURIComponent(thread.id)}?view=summary&limit=10`,
      );
      return value.thread?.status === 'idle' && value.turns?.length > 0
        ? value
        : null;
    },
    30_000,
    'forwarded thread did not become idle',
  );
  const items = detail.turns.flatMap((turn) => turn.items ?? []);
  assert(
    items.some(
      (item) => item.kind === 'userMessage' && item.text.includes(marker),
    ),
    'user prompt is missing',
  );
  assert(
    items.some((item) => item.kind === 'agentMessage'),
    'agent response is missing',
  );

  console.log(
    JSON.stringify(
      {
        relay: relayUrl.origin,
        user: username,
        migratedPortal: {
          ownedDevices: before.devices?.length ?? 0,
          sharedWithMe: before.sharedWithMe?.length ?? 0,
          sharedByMe: before.sharedByMe?.length ?? 0,
          sharedDevicesWithMe: before.sharedDevicesWithMe?.length ?? 0,
          sharedThreadsWithMe: before.sharedThreadsWithMe?.length ?? 0,
        },
        supervisorConnected: true,
        workspaceCreated: true,
        binaryRoundTrip: true,
        threadCompleted: true,
        websocketPing: true,
        websocketTurnCompletion: true,
      },
      null,
      2,
    ),
  );
} catch (error) {
  failure = error;
} finally {
  try {
    eventSocket?.close();
  } catch {}
  if (supervisor) await stopChild(supervisor);
  if (deviceId && sessionToken) {
    try {
      await requestJson(`/relay/devices/${encodeURIComponent(deviceId)}`, {
        method: 'DELETE',
      });
    } catch (cleanupError) {
      console.error(
        `Warning: failed to remove E2E relay device: ${safeMessage(cleanupError)}`,
      );
    }
  }
  fs.rmSync(testRoot, { recursive: true, force: true });
}

if (failure) throw failure;

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function requiredUrl(name) {
  const value = new URL(required(name));
  value.pathname = '/';
  value.search = '';
  value.hash = '';
  return value;
}

async function requestJson(relative, options = {}) {
  const response = await request(relative, options);
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      `${options.method ?? 'GET'} ${relative} returned non-JSON HTTP ${response.status}`,
    );
  }
}

async function request(relative, options = {}) {
  const headers = new Headers(options.headers);
  if (options.authenticated !== false && sessionToken) {
    headers.set('authorization', `Bearer ${sessionToken}`);
  }
  let body = options.body;
  if (body !== undefined && !options.rawBody) {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(body);
  }
  const response = await fetch(new URL(relative, relayUrl), {
    method: options.method ?? 'GET',
    headers,
    body,
  });
  if (!response.ok) {
    const text = await response.text();
    let message = text;
    try {
      message = JSON.parse(text).message ?? text;
    } catch {}
    throw new Error(
      `${options.method ?? 'GET'} ${relative} failed HTTP ${response.status}: ${message}`,
    );
  }
  return response;
}

function relayWebSocketUrl(id, threadId) {
  const url = new URL(relayUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = `/relay/devices/${encodeURIComponent(id)}/ws`;
  url.searchParams.set('relaySession', sessionToken);
  url.searchParams.set('threadId', threadId);
  return url;
}

function waitForSocketOpen(socket, timeoutMs) {
  if (socket.readyState === WebSocket.OPEN) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('relay websocket open timed out')),
      timeoutMs,
    );
    socket.addEventListener(
      'open',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
    socket.addEventListener(
      'error',
      () => {
        clearTimeout(timer);
        reject(new Error('relay websocket failed'));
      },
      { once: true },
    );
  });
}

function waitForSocketMessage(socket, predicate, timeoutMs, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.removeEventListener('message', onMessage);
      reject(new Error(message));
    }, timeoutMs);
    const onMessage = (event) => {
      try {
        const value = JSON.parse(String(event.data));
        if (!predicate(value)) return;
        clearTimeout(timer);
        socket.removeEventListener('message', onMessage);
        resolve(value);
      } catch {}
    };
    socket.addEventListener('message', onMessage);
  });
}

async function poll(operation, timeoutMs, message) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await operation();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `${message}${lastError ? `: ${safeMessage(lastError)}` : ''}`,
  );
}

async function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

function ensureChildAlive(child, log) {
  if (child.exitCode !== null || child.signalCode !== null) {
    throw new Error(`local Rust supervisor exited early\n${log}`);
  }
}

function appendLog(current, chunk) {
  return `${current}${chunk}`.split(/\r?\n/).slice(-80).join('\n');
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  const exited = await Promise.race([
    new Promise((resolve) => child.once('exit', () => resolve(true))),
    new Promise((resolve) => setTimeout(() => resolve(false), 3_000)),
  ]);
  if (!exited) {
    child.kill('SIGKILL');
    await new Promise((resolve) => child.once('exit', resolve));
  }
}

function equalBytes(left, right) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function safeMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
