import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import crossSpawn from 'cross-spawn';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(scriptDir, '..');
const temporaryRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'Remote Codex Relay Smoke '));
const workspaceRoot = path.join(temporaryRoot, 'workspace root 开发');
const relayPort = await reservePort();
const supervisorPort = await reservePort();
const relayBaseUrl = `http://127.0.0.1:${relayPort}`;
const processes = [];

try {
  await fsp.mkdir(workspaceRoot, { recursive: true });
  const relayEnvironment = {
    REMOTE_CODEX_ADMIN_USERNAME: 'smoke-admin',
    REMOTE_CODEX_ADMIN_PASSWORD: 'smoke-admin-password',
    REMOTE_CODEX_RELAY_SESSION_SECRET: 'smoke-session-secret-32-characters',
    REMOTE_CODEX_RELAY_REGISTRATION_ENABLED: 'true',
    REMOTE_CODEX_RELAY_DATA_DIR: path.join(temporaryRoot, 'relay data'),
    REMOTE_CODEX_RELAY_HOST: '127.0.0.1',
    REMOTE_CODEX_RELAY_PORT: String(relayPort),
  };
  const relayEntry = path.join(packageRoot, 'apps', 'relay-server', 'dist', 'index.js');
  const relay = startProcess(relayEntry, relayEnvironment);
  processes.push(relay);
  await waitForHttp(`${relayBaseUrl}/healthz`, relay, 20_000);

  const username = `relay-smoke-${crypto.randomBytes(4).toString('hex')}`;
  const registration = await jsonRequest(`${relayBaseUrl}/relay/auth/register`, {
    method: 'POST',
    body: { email: `${username}@example.test`, username, password: 'relay-smoke-password' },
  });
  const userToken = requiredString(registration.token, 'registration token');
  const deviceRegistration = await jsonRequest(`${relayBaseUrl}/relay/devices`, {
    method: 'POST', token: userToken, body: { name: `Windows smoke ${process.platform}` },
  });
  const deviceId = requiredString(deviceRegistration.device?.id, 'device id');
  const deviceToken = requiredString(deviceRegistration.token, 'device token');

  const instanceId = crypto.randomUUID();
  const controlToken = crypto.randomBytes(32).toString('base64url');
  const controlEndpoint = process.platform === 'win32'
    ? `\\\\.\\pipe\\remote-codex-relay-smoke-${instanceId}`
    : path.join('/tmp', `rc-relay-${instanceId.slice(0, 12)}.sock`);
  const supervisor = startProcess(path.join(packageRoot, 'apps', 'supervisor-api', 'dist', 'index.js'), {
    HOST: '127.0.0.1',
    PORT: String(supervisorPort),
    DATABASE_URL: path.join(temporaryRoot, 'supervisor.sqlite'),
    WORKSPACE_ROOT: workspaceRoot,
    CODEX_HOME: path.join(temporaryRoot, '.codex'),
    REMOTE_CODEX_PACKAGE_ROOT: packageRoot,
    REMOTE_CODEX_MODE: 'relay',
    REMOTE_CODEX_ADMIN_USERNAME: 'supervisor-admin',
    REMOTE_CODEX_ADMIN_PASSWORD: 'supervisor-admin-password',
    REMOTE_CODEX_SESSION_SECRET: 'supervisor-session-secret-32-characters',
    REMOTE_CODEX_RELAY_SERVER_URL: `ws://127.0.0.1:${relayPort}`,
    REMOTE_CODEX_RELAY_AGENT_TOKEN: deviceToken,
    REMOTE_CODEX_ENABLED_AGENT_PROVIDERS: 'relay-smoke-fake-only',
    REMOTE_CODEX_E2E_FAKE_RUNTIME: 'true',
    REMOTE_CODEX_LIFECYCLE_CONTROL_ENDPOINT: controlEndpoint,
    REMOTE_CODEX_LIFECYCLE_CONTROL_TOKEN: controlToken,
    REMOTE_CODEX_LIFECYCLE_INSTANCE_ID: instanceId,
  });
  processes.push(supervisor);

  const deviceApi = `${relayBaseUrl}/relay/devices/${deviceId}`;
  await waitForHttp(`${deviceApi}/healthz`, supervisor, 30_000, userToken);
  const workspace = await jsonRequest(`${deviceApi}/api/workspaces`, {
    method: 'POST', token: userToken,
    body: { absPath: path.join(workspaceRoot, 'project with spaces 项目') },
  });
  const workspaceId = requiredString(workspace.id, 'workspace id');
  const thread = await jsonRequest(`${deviceApi}/api/threads/start`, {
    method: 'POST', token: userToken,
    body: {
      workspaceId, provider: 'claude', model: 'ios-e2e-stream',
      approvalMode: 'yolo', title: 'Windows relay smoke',
    },
  });
  const threadId = requiredString(thread.id, 'thread id');
  await jsonRequest(`${deviceApi}/api/threads/${threadId}/prompt`, {
    method: 'POST', token: userToken, body: { prompt: 'WINDOWS_RELAY_SMOKE' },
  });
  await waitForJson(
    `${deviceApi}/api/threads/${threadId}`, userToken,
    (value) => {
      const serialized = JSON.stringify(value);
      return serialized.includes('IOS_STREAM_DELTA_READY') &&
        !serialized.includes('IOS_STREAM_COMPLETED');
    }, 5_000,
  );
  const detail = await waitForJson(
    `${deviceApi}/api/threads/${threadId}`, userToken,
    (value) => JSON.stringify(value).includes('IOS_STREAM_COMPLETED'), 35_000,
  );
  const lastTurn = detail.turns?.at?.(-1);
  if (lastTurn?.status !== 'completed') {
    throw new Error(`Fake runtime turn did not complete: ${JSON.stringify(lastTurn)}`);
  }

  await jsonRequest(`${deviceApi}/api/threads/${threadId}/prompt`, {
    method: 'POST', token: userToken, body: { prompt: 'WINDOWS_RELAY_FOLLOWUP' },
  });
  await waitForJson(
    `${deviceApi}/api/threads/${threadId}`, userToken,
    (value) => value.turns?.length === 2 && value.turns.at(-1)?.status === 'completed', 35_000,
  );

  await stopProcess(relay);
  const restartedRelay = startProcess(relayEntry, relayEnvironment);
  processes.push(restartedRelay);
  await waitForHttp(`${relayBaseUrl}/healthz`, restartedRelay, 20_000);
  await waitForHttp(`${deviceApi}/healthz`, supervisor, 30_000, userToken);
  const reloadedAfterReconnect = await jsonRequest(`${deviceApi}/api/threads/${threadId}`, {
    token: userToken,
  });
  if (reloadedAfterReconnect.turns?.length !== 2) {
    throw new Error('Transcript did not survive Relay disconnect and reconnect.');
  }

  const status = await requestControl({ controlEndpoint, controlToken, instanceId }, 'status');
  if (status.ok !== true || status.instanceId !== instanceId) {
    throw new Error(`Unexpected lifecycle status: ${JSON.stringify(status)}`);
  }
  await requestControl({ controlEndpoint, controlToken, instanceId }, 'shutdown');
  await waitForExit(supervisor, 10_000);
  console.log(`Relay supervisor smoke passed on ${process.platform}: device ${deviceId}, thread ${threadId}.`);
} catch (error) {
  const diagnostics = processes
    .map((child) => `${path.basename(child.entry)} output:\n${child.output()}`).join('\n');
  throw new Error(`${error instanceof Error ? error.message : String(error)}\n${diagnostics}`);
} finally {
  await Promise.allSettled(processes.map((child) => stopProcess(child)));
  await fsp.rm(temporaryRoot, { recursive: true, force: true });
}

function startProcess(entry, additionalEnv) {
  const child = crossSpawn(process.execPath, [entry], {
    cwd: packageRoot,
    windowsHide: true,
    env: { ...process.env, NODE_ENV: 'production', LOG_LEVEL: 'warn', ...additionalEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout?.on('data', (chunk) => { output += String(chunk); });
  child.stderr?.on('data', (chunk) => { output += String(chunk); });
  return Object.assign(child, { entry, output: () => output });
}

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, {
    method: options.method ?? 'GET',
    headers: {
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.body ? { 'content-type': 'application/json' } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    signal: AbortSignal.timeout(5_000),
  });
  const text = await response.text();
  let value;
  try { value = text ? JSON.parse(text) : null; } catch { value = text; }
  if (!response.ok) {
    throw new Error(`${options.method ?? 'GET'} ${url} returned ${response.status}: ${text}`);
  }
  return value;
}

async function waitForHttp(url, child, timeoutMs, token) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`${path.basename(child.entry)} exited with ${child.exitCode}.`);
    try { await jsonRequest(url, { token }); return; } catch { await delay(200); }
  }
  throw new Error(`Timed out waiting for ${url}.`);
}

async function waitForJson(url, token, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let latest = null;
  while (Date.now() < deadline) {
    latest = await jsonRequest(url, { token });
    if (predicate(latest)) return latest;
    await delay(100);
  }
  throw new Error(`Timed out waiting for expected response from ${url}: ${JSON.stringify(latest)}`);
}

function requiredString(value, label) {
  if (typeof value !== 'string' || !value) throw new Error(`Missing ${label}: ${JSON.stringify(value)}`);
  return value;
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close(() => port ? resolve(port) : reject(new Error('Unable to reserve a port.')));
    });
  });
}

function requestControl(state, action) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(state.controlEndpoint);
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('Lifecycle control timed out.')); }, 2_000);
    let output = '';
    socket.setEncoding('utf8');
    socket.once('connect', () => socket.write(`${JSON.stringify({
      action, token: state.controlToken, instanceId: state.instanceId,
    })}\n`));
    socket.on('data', (chunk) => {
      output += chunk;
      const newline = output.indexOf('\n');
      if (newline < 0) return;
      clearTimeout(timer);
      socket.end();
      resolve(JSON.parse(output.slice(0, newline)));
    });
    socket.once('error', (error) => { clearTimeout(timer); reject(error); });
  });
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${path.basename(child.entry)} did not exit cleanly.`)), timeoutMs);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
  });
}

async function stopProcess(child) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  try {
    await waitForExit(child, 3_000);
  } catch {
    if (process.platform === 'win32' && child.pid) {
      await new Promise((resolve) => {
        const killer = crossSpawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        killer.once('close', resolve);
        killer.once('error', resolve);
      });
    } else {
      child.kill('SIGKILL');
    }
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
