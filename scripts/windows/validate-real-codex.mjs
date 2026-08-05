import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import crossSpawn from 'cross-spawn';

if (process.platform !== 'win32') {
  throw new Error('This validation script must run on native Windows.');
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(scriptDir, '..', '..');
const cliEntry = path.join(packageRoot, 'bin', 'remote-codex.mjs');
const relayEntry = path.join(
  packageRoot,
  'apps',
  'relay-server',
  'dist',
  'index.js',
);
const codexExe = requiredEnv('REMOTE_CODEX_REAL_CODEX_EXE');
const codexCmd = requiredEnv('REMOTE_CODEX_REAL_CODEX_CMD');
const codexHome = path.resolve(
  process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex'),
);
const temporaryRoot = await fsp.mkdtemp(
  path.join(os.tmpdir(), 'Remote Codex Real Windows '),
);
const workspaceRoot = path.join(temporaryRoot, 'workspace root validation');
const relayPort = await reservePort();
const relayBaseUrl = `http://127.0.0.1:${relayPort}`;
const processes = [];
let relay;
let foreground;
let backgroundStarted = false;
let clientSocket;

try {
  await fsp.mkdir(workspaceRoot, { recursive: true });
  await verifyCodexCommand(codexExe, 'codex.exe');
  await verifyCodexCommand(codexCmd, 'codex.cmd');

  const relayEnvironment = {
    REMOTE_CODEX_ADMIN_USERNAME: 'windows-real-admin',
    REMOTE_CODEX_ADMIN_PASSWORD: 'windows-real-admin-password',
    REMOTE_CODEX_RELAY_SESSION_SECRET:
      'windows-real-session-secret-32-characters',
    REMOTE_CODEX_RELAY_REGISTRATION_ENABLED: 'true',
    REMOTE_CODEX_RELAY_DATA_DIR: path.join(temporaryRoot, 'relay data'),
    REMOTE_CODEX_RELAY_HOST: '127.0.0.1',
    REMOTE_CODEX_RELAY_PORT: String(relayPort),
  };
  relay = startNode(relayEntry, relayEnvironment);
  processes.push(relay);
  await waitForHttp(`${relayBaseUrl}/healthz`, relay, 30_000);

  const username = `windows-real-${crypto.randomBytes(4).toString('hex')}`;
  const registration = await jsonRequest(
    `${relayBaseUrl}/relay/auth/register`,
    {
      method: 'POST',
      body: {
        email: `${username}@example.test`,
        username,
        password: 'windows-real-user-password',
      },
    },
  );
  const userToken = requiredString(registration.token, 'registration token');
  const deviceRegistration = await jsonRequest(
    `${relayBaseUrl}/relay/devices`,
    {
      method: 'POST',
      token: userToken,
      body: { name: 'Windows real Codex validation' },
    },
  );
  const deviceId = requiredString(deviceRegistration.device?.id, 'device id');
  const deviceToken = requiredString(deviceRegistration.token, 'device token');
  const deviceApi = `${relayBaseUrl}/relay/devices/${deviceId}`;

  const foregroundPort = await reservePort();
  const foregroundInstanceId = crypto.randomUUID();
  const foregroundControlToken = crypto.randomBytes(32).toString('base64url');
  const foregroundControlEndpoint = `\\\\.\\pipe\\remote-codex-real-${foregroundInstanceId}`;
  const foregroundEnv = supervisorEnvironment({
    name: 'foreground-exe',
    port: foregroundPort,
    command: codexExe,
    deviceToken,
    extra: {
      REMOTE_CODEX_LIFECYCLE_CONTROL_ENDPOINT: foregroundControlEndpoint,
      REMOTE_CODEX_LIFECYCLE_CONTROL_TOKEN: foregroundControlToken,
      REMOTE_CODEX_LIFECYCLE_INSTANCE_ID: foregroundInstanceId,
    },
  });
  foreground = startNode(cliEntry, foregroundEnv, ['relay-supervisor', 'run']);
  processes.push(foreground);
  await waitForHttp(`${deviceApi}/healthz`, foreground, 60_000, userToken);

  const projectPath = path.join(workspaceRoot, 'project with spaces');
  const workspace = await jsonRequest(`${deviceApi}/api/workspaces`, {
    method: 'POST',
    token: userToken,
    body: { absPath: projectPath },
  });
  const workspaceId = requiredString(workspace.id, 'workspace id');
  const model = await selectDefaultModel(deviceApi, userToken);
  const thread = await jsonRequest(`${deviceApi}/api/threads/start`, {
    method: 'POST',
    token: userToken,
    body: {
      workspaceId,
      provider: 'codex',
      model,
      approvalMode: 'yolo',
      title: 'Windows codex.exe validation',
    },
  });
  const threadId = requiredString(thread.id, 'thread id');
  const socketEvents = [];
  clientSocket = new WebSocket(
    `${relayBaseUrl.replace(/^http/, 'ws')}/relay/devices/${deviceId}/ws` +
      `?threadId=${encodeURIComponent(threadId)}&relaySession=${encodeURIComponent(userToken)}`,
  );
  clientSocket.addEventListener('message', (event) => {
    try {
      socketEvents.push(JSON.parse(String(event.data)));
    } catch {
      // Ignore non-JSON diagnostics.
    }
  });
  await waitForSocketOpen(clientSocket, 10_000);

  await jsonRequest(`${deviceApi}/api/threads/${threadId}/prompt`, {
    method: 'POST',
    token: userToken,
    body: {
      prompt: 'Reply with exactly WINDOWS_REAL_CODEX_EXE_OK and nothing else.',
    },
  });
  const firstDetail = await waitForJson(
    `${deviceApi}/api/threads/${threadId}`,
    userToken,
    (value) =>
      value.turns?.at?.(-1)?.status === 'completed' &&
      JSON.stringify(value).includes('WINDOWS_REAL_CODEX_EXE_OK'),
    120_000,
  );
  await waitForCondition(
    () =>
      socketEvents.some(
        (event) =>
          event.type === 'thread.updated' &&
          event.threadId === threadId &&
          event.payload?.status === 'running',
      ),
    10_000,
    'WebSocket running event',
  );
  if (firstDetail.turns?.length !== 1) {
    throw new Error(
      `Unexpected first transcript: ${JSON.stringify(firstDetail)}`,
    );
  }
  const reloaded = await jsonRequest(`${deviceApi}/api/threads/${threadId}`, {
    token: userToken,
  });
  if (!JSON.stringify(reloaded).includes('WINDOWS_REAL_CODEX_EXE_OK')) {
    throw new Error('Transcript reload lost the first real Codex response.');
  }

  await stopProcess(relay);
  relay = startNode(relayEntry, relayEnvironment);
  processes.push(relay);
  await waitForHttp(`${relayBaseUrl}/healthz`, relay, 30_000);
  await waitForHttp(`${deviceApi}/healthz`, foreground, 60_000, userToken);

  await jsonRequest(`${deviceApi}/api/threads/${threadId}/prompt`, {
    method: 'POST',
    token: userToken,
    body: {
      prompt:
        'Reply with exactly WINDOWS_REAL_CODEX_EXE_FOLLOWUP_OK and nothing else.',
    },
  });
  const followUpDetail = await waitForJson(
    `${deviceApi}/api/threads/${threadId}`,
    userToken,
    (value) =>
      value.turns?.length === 2 &&
      value.turns.at(-1)?.status === 'completed' &&
      JSON.stringify(value).includes('WINDOWS_REAL_CODEX_EXE_FOLLOWUP_OK'),
    120_000,
  );
  if (!JSON.stringify(followUpDetail).includes('WINDOWS_REAL_CODEX_EXE_OK')) {
    throw new Error('Relay reconnect lost the first transcript turn.');
  }

  await requestControl(
    {
      controlEndpoint: foregroundControlEndpoint,
      controlToken: foregroundControlToken,
      instanceId: foregroundInstanceId,
    },
    'shutdown',
  );
  await waitForExit(foreground, 15_000);
  await waitForPortClosed(foregroundPort, 10_000);
  clientSocket.close();
  clientSocket = undefined;

  const backgroundPort = await reservePort();
  const backgroundEnv = supervisorEnvironment({
    name: 'background-cmd',
    port: backgroundPort,
    command: codexCmd,
    deviceToken,
  });
  const startResult = await runNode(
    cliEntry,
    backgroundEnv,
    ['relay-supervisor', 'start'],
    30_000,
  );
  if (
    startResult.code !== 0 ||
    !startResult.output.includes('Started remote-codex relay-supervisor')
  ) {
    throw new Error(`Background start failed: ${startResult.output}`);
  }
  backgroundStarted = true;
  const statusResult = await runNode(
    cliEntry,
    backgroundEnv,
    ['relay-supervisor', 'status'],
    10_000,
  );
  if (
    statusResult.code !== 0 ||
    !statusResult.output.includes('State: running')
  ) {
    throw new Error(`Background status failed: ${statusResult.output}`);
  }
  await waitForHttp(`${deviceApi}/healthz`, null, 60_000, userToken);

  const backgroundWorkspace = await jsonRequest(`${deviceApi}/api/workspaces`, {
    method: 'POST',
    token: userToken,
    body: { absPath: path.join(workspaceRoot, 'cmd project') },
  });
  const backgroundModel = await selectDefaultModel(deviceApi, userToken);
  const backgroundThread = await jsonRequest(`${deviceApi}/api/threads/start`, {
    method: 'POST',
    token: userToken,
    body: {
      workspaceId: requiredString(
        backgroundWorkspace.id,
        'background workspace id',
      ),
      provider: 'codex',
      model: backgroundModel,
      approvalMode: 'yolo',
      title: 'Windows codex.cmd validation',
    },
  });
  const backgroundThreadId = requiredString(
    backgroundThread.id,
    'background thread id',
  );
  await jsonRequest(`${deviceApi}/api/threads/${backgroundThreadId}/prompt`, {
    method: 'POST',
    token: userToken,
    body: {
      prompt: 'Reply with exactly WINDOWS_REAL_CODEX_CMD_OK and nothing else.',
    },
  });
  await waitForJson(
    `${deviceApi}/api/threads/${backgroundThreadId}`,
    userToken,
    (value) =>
      value.turns?.at?.(-1)?.status === 'completed' &&
      JSON.stringify(value).includes('WINDOWS_REAL_CODEX_CMD_OK'),
    120_000,
  );

  const stopResult = await runNode(
    cliEntry,
    backgroundEnv,
    ['relay-supervisor', 'stop'],
    30_000,
  );
  backgroundStarted = false;
  if (
    stopResult.code !== 0 ||
    !stopResult.output.includes('Stopped remote-codex relay-supervisor')
  ) {
    throw new Error(`Background stop failed: ${stopResult.output}`);
  }
  await waitForPortClosed(backgroundPort, 10_000);

  console.log(
    JSON.stringify(
      {
        passed: true,
        platform: process.platform,
        arch: process.arch,
        deviceId,
        foreground: {
          command: codexExe,
          threadId,
          turns: 2,
          streamedRunningEvent: true,
          relayReconnect: true,
          gracefulExit: true,
        },
        background: {
          command: codexCmd,
          threadId: backgroundThreadId,
          startStatusStop: true,
          realPrompt: true,
        },
      },
      null,
      2,
    ),
  );
} catch (error) {
  const diagnostics = processes
    .map((child) => `${child.label} output:\n${child.output()}`)
    .join('\n');
  throw new Error(
    `${error instanceof Error ? error.message : String(error)}\n${diagnostics}`,
  );
} finally {
  clientSocket?.close();
  if (backgroundStarted) {
    const backgroundEnv = supervisorEnvironment({
      name: 'background-cmd',
      port: 1,
      command: codexCmd,
      deviceToken: 'cleanup-placeholder',
    });
    await runNode(
      cliEntry,
      backgroundEnv,
      ['relay-supervisor', 'stop'],
      15_000,
    ).catch(() => {});
  }
  await Promise.allSettled(processes.map((child) => stopProcess(child)));
  await fsp.rm(temporaryRoot, { recursive: true, force: true });
}

function supervisorEnvironment({
  name,
  port,
  command,
  deviceToken,
  extra = {},
}) {
  const stateRoot = path.join(temporaryRoot, name);
  return {
    NODE_ENV: 'production',
    LOG_LEVEL: 'warn',
    REMOTE_CODEX_RELAY_SERVER_URL: `ws://127.0.0.1:${relayPort}`,
    REMOTE_CODEX_RELAY_AGENT_TOKEN: deviceToken,
    REMOTE_CODEX_ADMIN_USERNAME: 'supervisor-admin',
    REMOTE_CODEX_ADMIN_PASSWORD: 'supervisor-admin-password',
    REMOTE_CODEX_SESSION_SECRET: 'supervisor-session-secret-32-characters',
    REMOTE_CODEX_RELAY_SUPERVISOR_HOST: '127.0.0.1',
    REMOTE_CODEX_RELAY_SUPERVISOR_PORT: String(port),
    REMOTE_CODEX_ENABLED_AGENT_PROVIDERS: 'codex',
    DATABASE_URL: path.join(stateRoot, 'supervisor.sqlite'),
    WORKSPACE_ROOT: workspaceRoot,
    CODEX_HOME: codexHome,
    CODEX_COMMAND: command,
    REMOTE_CODEX_RELAY_SUPERVISOR_CONFIG: path.join(
      stateRoot,
      'relay-supervisor.json',
    ),
    REMOTE_CODEX_RELAY_SUPERVISOR_STATE: path.join(
      stateRoot,
      'relay-supervisor-state.json',
    ),
    REMOTE_CODEX_RELAY_SUPERVISOR_LOG: path.join(
      stateRoot,
      'relay-supervisor.log',
    ),
    ...extra,
  };
}

async function verifyCodexCommand(command, label) {
  const result = await runCommand(command, ['--version'], 15_000);
  if (result.code !== 0 || !/codex-cli/i.test(result.output)) {
    throw new Error(`${label} --version failed: ${result.output}`);
  }
}

async function selectDefaultModel(deviceApi, token) {
  const models = await waitForJson(
    `${deviceApi}/api/agent-runtimes/codex/models`,
    token,
    (value) => Array.isArray(value) && value.length > 0,
    60_000,
  );
  const selected =
    models.find((model) => model.isDefault && !model.hidden) ??
    models.find((model) => !model.hidden) ??
    models[0];
  return requiredString(selected?.model, 'Codex model');
}

function startNode(entry, additionalEnv, args = []) {
  const child = crossSpawn(process.execPath, [entry, ...args], {
    cwd: packageRoot,
    windowsHide: true,
    env: { ...process.env, ...additionalEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout?.on('data', (chunk) => {
    output += String(chunk);
  });
  child.stderr?.on('data', (chunk) => {
    output += String(chunk);
  });
  return Object.assign(child, {
    label: `${path.basename(entry)} ${args.join(' ')}`.trim(),
    output: () => output,
  });
}

function runNode(entry, additionalEnv, args, timeoutMs) {
  return runCommand(
    process.execPath,
    [entry, ...args],
    timeoutMs,
    additionalEnv,
  );
}

function runCommand(command, args, timeoutMs, additionalEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = crossSpawn(command, args, {
      cwd: packageRoot,
      windowsHide: true,
      env: { ...process.env, ...additionalEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout?.on('data', (chunk) => {
      output += String(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      output += String(chunk);
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${command} timed out after ${timeoutMs} ms.`));
    }, timeoutMs);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });
}

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, {
    method: options.method ?? 'GET',
    headers: {
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.body ? { 'content-type': 'application/json' } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  let value;
  try {
    value = text ? JSON.parse(text) : null;
  } catch {
    value = text;
  }
  if (!response.ok) {
    throw new Error(
      `${options.method ?? 'GET'} ${url} returned ${response.status}: ${text}`,
    );
  }
  return value;
}

async function waitForHttp(url, child, timeoutMs, token) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child?.exitCode !== null && child?.exitCode !== undefined) {
      throw new Error(`${child.label} exited with ${child.exitCode}.`);
    }
    try {
      await jsonRequest(url, { token });
      return;
    } catch {
      await delay(250);
    }
  }
  throw new Error(`Timed out waiting for ${url}.`);
}

async function waitForJson(url, token, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let latest = null;
  while (Date.now() < deadline) {
    try {
      latest = await jsonRequest(url, { token });
      if (predicate(latest)) {
        return latest;
      }
    } catch {
      // Relay reconnects and runtime startup are expected to be transient.
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${url}: ${JSON.stringify(latest)}`);
}

async function waitForSocketOpen(socket, timeoutMs) {
  if (socket.readyState === WebSocket.OPEN) return;
  await Promise.race([
    new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener(
        'error',
        () => reject(new Error('WebSocket failed to open.')),
        {
          once: true,
        },
      );
    }),
    delay(timeoutMs).then(() => {
      throw new Error('WebSocket open timed out.');
    }),
  ]);
}

async function waitForCondition(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(50);
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

function requestControl(state, action) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(state.controlEndpoint);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('Lifecycle control timed out.'));
    }, 5_000);
    let output = '';
    socket.setEncoding('utf8');
    socket.once('connect', () =>
      socket.write(
        `${JSON.stringify({
          action,
          token: state.controlToken,
          instanceId: state.instanceId,
        })}\n`,
      ),
    );
    socket.on('data', (chunk) => {
      output += chunk;
      const newline = output.indexOf('\n');
      if (newline < 0) return;
      clearTimeout(timer);
      socket.end();
      const result = JSON.parse(output.slice(0, newline));
      if (result.ok !== true || result.instanceId !== state.instanceId) {
        reject(
          new Error(`Lifecycle request failed: ${JSON.stringify(result)}`),
        );
        return;
      }
      resolve(result);
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) return;
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    delay(timeoutMs).then(() => {
      throw new Error(`${child.label} did not exit.`);
    }),
  ]);
}

async function waitForPortClosed(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await canConnect(port))) return;
    await delay(100);
  }
  throw new Error(`Port ${port} remained open after shutdown.`);
}

function canConnect(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
    socket.setTimeout(500, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  const result = crossSpawn.sync(
    'taskkill.exe',
    ['/PID', String(child.pid), '/T', '/F'],
    {
      windowsHide: true,
      stdio: 'ignore',
    },
  );
  if (result.status !== 0 && child.exitCode === null) {
    child.kill();
  }
  await waitForExit(child, 10_000).catch(() => {});
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close(() =>
        port ? resolve(port) : reject(new Error('Unable to reserve a port.')),
      );
    });
  });
}

function requiredString(value, label) {
  if (typeof value !== 'string' || !value) {
    throw new Error(`Missing ${label}: ${JSON.stringify(value)}`);
  }
  return value;
}

function requiredEnv(name) {
  return requiredString(process.env[name], name);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
