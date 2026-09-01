import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);
const cliEntry = path.join(packageRoot, 'bin', 'remote-codex.mjs');
const supervisorEntry = path.join(
  packageRoot,
  'apps',
  'supervisor-api',
  'dist',
  'index.js',
);
const temporaryRoot = await fs.mkdtemp(
  path.join(os.tmpdir(), 'remote-codex-windows-acp-'),
);
const workspaceRoot = path.join(temporaryRoot, 'workspace');
const localAppData = path.join(temporaryRoot, 'local-app-data');
const managerRoot = path.join(localAppData, 'RemoteCodex', 'DeviceManager');
const configPath = path.join(
  temporaryRoot,
  '.remote-codex',
  'relay-supervisor.json',
);
const statePath = path.join(temporaryRoot, 'relay-supervisor-state.json');
const logPath = path.join(temporaryRoot, 'relay-supervisor.log');
const port = await reservePort();
const username = 'isolated-admin';
const password = 'isolated-admin-password';
let started = false;

const supervisorEnvironment = {
  ...process.env,
  USERPROFILE: temporaryRoot,
  LOCALAPPDATA: localAppData,
  NODE_ENV: 'production',
  LOG_LEVEL: 'warn',
  REMOTE_CODEX_ENABLED_AGENT_PROVIDERS: 'codex',
  REMOTE_CODEX_RELAY_SERVER_URL: 'ws://127.0.0.1:1',
  REMOTE_CODEX_RELAY_AGENT_TOKEN: 'rcd_isolated_acp_test',
  REMOTE_CODEX_RELAY_SUPERVISOR_HOST: '127.0.0.1',
  REMOTE_CODEX_RELAY_SUPERVISOR_PORT: String(port),
  REMOTE_CODEX_ADMIN_USERNAME: username,
  REMOTE_CODEX_ADMIN_PASSWORD: password,
  REMOTE_CODEX_SESSION_SECRET: 'isolated-session-secret-32-characters',
  REMOTE_CODEX_E2E_FAKE_RUNTIME: '1',
  REMOTE_CODEX_DISABLE_BUILD_RESTART: 'true',
  DATABASE_URL: path.join(temporaryRoot, 'supervisor.sqlite'),
  WORKSPACE_ROOT: workspaceRoot,
  REMOTE_CODEX_RELAY_SUPERVISOR_CONFIG: configPath,
  REMOTE_CODEX_RELAY_SUPERVISOR_STATE: statePath,
  REMOTE_CODEX_RELAY_SUPERVISOR_LOG: logPath,
};
delete supervisorEnvironment.REMOTE_CODEX_WINDOWS_DEVICE_MANAGER;

try {
  await fs.access(supervisorEntry);
  await fs.mkdir(workspaceRoot, { recursive: true });
  await fs.mkdir(managerRoot, { recursive: true });
  await fs.writeFile(
    path.join(managerRoot, 'RemoteCodex.DeviceManager.exe'),
    '',
  );
  await fs.writeFile(path.join(managerRoot, 'settings.json'), '{}\n');
  await runCli(['relay-supervisor', 'start'], supervisorEnvironment, 30_000);
  started = true;

  const persistedConfig = JSON.parse(await fs.readFile(configPath, 'utf8'));
  assert.equal(persistedConfig.REMOTE_CODEX_WINDOWS_DEVICE_MANAGER, '1');
  assert.equal(
    persistedConfig.REMOTE_CODEX_ENABLED_AGENT_PROVIDERS,
    'codex,acp',
  );

  const loginResponse = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
    signal: AbortSignal.timeout(10_000),
  });
  assert.equal(loginResponse.status, 200);
  const cookie = loginResponse.headers.get('set-cookie')?.split(';', 1)[0];
  assert.ok(cookie, 'Supervisor login did not return a session cookie.');

  const runtimesResponse = await fetch(
    `http://127.0.0.1:${port}/api/agent-runtimes`,
    {
      headers: { cookie },
      signal: AbortSignal.timeout(10_000),
    },
  );
  assert.equal(runtimesResponse.status, 200);
  const runtimes = await runtimesResponse.json();
  const providers = runtimes.map((runtime) => runtime.provider);
  assert.ok(
    providers.includes('acp'),
    `ACP was not registered: ${providers.join(',')}`,
  );

  process.stdout.write(
    `${JSON.stringify({
      passed: true,
      managedMarker: persistedConfig.REMOTE_CODEX_WINDOWS_DEVICE_MANAGER,
      persistedProviders: persistedConfig.REMOTE_CODEX_ENABLED_AGENT_PROVIDERS,
      registeredProviders: providers,
    })}\n`,
  );
} finally {
  if (started) {
    await runCli(
      ['relay-supervisor', 'stop'],
      supervisorEnvironment,
      20_000,
    ).catch(() => {});
  }
  await fs.rm(temporaryRoot, { recursive: true, force: true });
}

function runCli(args, environment, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliEntry, ...args], {
      cwd: packageRoot,
      env: environment,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      output += String(chunk);
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`CLI timed out after ${timeoutMs} ms.\n${output}`));
    }, timeoutMs);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(output);
      } else {
        reject(new Error(`CLI exited with code ${code}.\n${output}`));
      }
    });
  });
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const selectedPort =
        typeof address === 'object' && address ? address.port : null;
      server.close((error) => {
        if (error) {
          reject(error);
        } else if (selectedPort) {
          resolve(selectedPort);
        } else {
          reject(new Error('Unable to reserve a local test port.'));
        }
      });
    });
  });
}
