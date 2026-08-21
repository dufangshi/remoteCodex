import fsp from 'node:fs/promises';
import crypto from 'node:crypto';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import crossSpawn from 'cross-spawn';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(scriptDir, '..');
const temporaryRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'Remote Codex Package Smoke '));
const installRoot = path.join(temporaryRoot, 'install with spaces 开发');
const workspaceRoot = path.join(temporaryRoot, 'workspace with spaces 开发');

try {
  await fsp.mkdir(installRoot, { recursive: true });
  await fsp.mkdir(workspaceRoot, { recursive: true });
  await fsp.writeFile(path.join(installRoot, 'package.json'), '{"private":true}\n');

  const pack = await runCommand('npm', [
    'pack',
    '--json',
    '--pack-destination',
    temporaryRoot,
  ], packageRoot, 180_000);
  const packRecords = parsePackOutput(pack.stdout);
  const tarballName = packRecords[0]?.filename;
  if (!tarballName) throw new Error(`npm pack did not return a filename: ${pack.stdout}`);
  const tarballPath = path.join(temporaryRoot, tarballName);

  await runCommand('npm', [
    'install',
    '--no-audit',
    '--no-fund',
    tarballPath,
  ], installRoot, 180_000);

  const installedRoot = path.join(installRoot, 'node_modules', 'remote-codex');
  const cliEntry = path.join(installedRoot, 'bin', 'remote-codex.mjs');
  await Promise.all([
    assertPackagedFile(path.join(installedRoot, 'docs', 'windows.md')),
    assertPackagedFile(path.join(installedRoot, 'scripts', 'windows', 'install-relay-supervisor-task.ps1')),
    assertPackagedFile(path.join(installedRoot, 'scripts', 'windows', 'relay-smoke.ps1')),
    assertPackagedFile(path.join(installedRoot, 'packages', 'process-runtime', 'src', 'index.ts')),
  ]);
  const version = await runCommand(process.execPath, [cliEntry, '--version'], installRoot, 15_000);
  if (!version.stdout.trim()) throw new Error('Installed CLI did not print a version.');

  // Windows does not install the optional PTY addon. Removing it here proves that
  // Supervisor startup and relay-only operation do not accidentally load it.
  await fsp.rm(
    path.join(installRoot, 'node_modules', '@homebridge', 'node-pty-prebuilt-multiarch'),
    { recursive: true, force: true },
  );

  const port = await reservePort();
  const instanceId = crypto.randomUUID();
  const controlToken = crypto.randomBytes(32).toString('base64url');
  const controlEndpoint = process.platform === 'win32'
    ? `\\\\.\\pipe\\remote-codex-package-smoke-${instanceId}`
    : path.join('/tmp', `remote-codex-${instanceId}.sock`);
  const apiEntry = path.join(installedRoot, 'apps', 'supervisor-api', 'dist', 'index.js');
  const child = crossSpawn(process.execPath, [apiEntry], {
    cwd: installRoot,
    windowsHide: true,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      LOG_LEVEL: 'info',
      HOST: '127.0.0.1',
      PORT: String(port),
      DATABASE_URL: path.join(temporaryRoot, 'smoke.sqlite'),
      WORKSPACE_ROOT: workspaceRoot,
      CODEX_HOME: path.join(temporaryRoot, '.codex'),
      REMOTE_CODEX_PACKAGE_ROOT: installedRoot,
      REMOTE_CODEX_ENABLED_AGENT_PROVIDERS: 'package-smoke-fake-only',
      REMOTE_CODEX_E2E_FAKE_RUNTIME: 'true',
      REMOTE_CODEX_LIFECYCLE_CONTROL_ENDPOINT: controlEndpoint,
      REMOTE_CODEX_LIFECYCLE_CONTROL_TOKEN: controlToken,
      REMOTE_CODEX_LIFECYCLE_INSTANCE_ID: instanceId,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let childOutput = '';
  child.stdout?.on('data', (chunk) => { childOutput += String(chunk); });
  child.stderr?.on('data', (chunk) => { childOutput += String(chunk); });

  try {
    await waitForHealth(`http://127.0.0.1:${port}/healthz`, child, 20_000);
    const status = await requestControl({ controlEndpoint, controlToken, instanceId }, 'status');
    if (status.ok !== true || status.instanceId !== instanceId) {
      throw new Error(`Unexpected lifecycle status: ${JSON.stringify(status)}`);
    }
    const shutdown = await requestControl({ controlEndpoint, controlToken, instanceId }, 'shutdown');
    if (shutdown.ok !== true) throw new Error(`Shutdown failed: ${JSON.stringify(shutdown)}`);
    await waitForExit(child, 10_000);
  } catch (error) {
    child.kill('SIGTERM');
    throw new Error(`${error instanceof Error ? error.message : String(error)}\nSupervisor output:\n${childOutput}`);
  }

  if (process.platform === 'win32') {
    await verifyWindowsManagedLifecycle({
      cliEntry,
      installRoot,
      installedRoot,
      temporaryRoot,
      workspaceRoot,
    });
  }

  console.log(`Package smoke passed for remote-codex ${version.stdout.trim()} on ${process.platform}.`);
} finally {
  await fsp.rm(temporaryRoot, { recursive: true, force: true });
}

async function verifyWindowsManagedLifecycle(input) {
  const managedPort = await reservePort();
  const env = {
    ...process.env,
    REMOTE_CODEX_RELAY_SUPERVISOR_CONFIG: path.join(input.temporaryRoot, 'managed config.json'),
    REMOTE_CODEX_RELAY_SUPERVISOR_STATE: path.join(input.temporaryRoot, 'managed state.json'),
    REMOTE_CODEX_RELAY_SUPERVISOR_LOG: path.join(input.temporaryRoot, 'managed logs', 'supervisor.log'),
    REMOTE_CODEX_RELAY_SERVER_URL: 'ws://127.0.0.1:9',
    REMOTE_CODEX_RELAY_AGENT_TOKEN: 'package-smoke-device-token',
    REMOTE_CODEX_ADMIN_USERNAME: 'package-smoke-admin',
    REMOTE_CODEX_ADMIN_PASSWORD: 'package-smoke-password',
    REMOTE_CODEX_SESSION_SECRET: 'package-smoke-session-secret-32-characters',
    REMOTE_CODEX_RELAY_SUPERVISOR_HOST: '127.0.0.1',
    REMOTE_CODEX_RELAY_SUPERVISOR_PORT: String(managedPort),
    DATABASE_URL: path.join(input.temporaryRoot, 'managed.sqlite'),
    WORKSPACE_ROOT: input.workspaceRoot,
    CODEX_HOME: path.join(input.temporaryRoot, '.managed-codex'),
    REMOTE_CODEX_PACKAGE_ROOT: input.installedRoot,
    REMOTE_CODEX_ENABLED_AGENT_PROVIDERS: 'package-smoke-fake-only',
    REMOTE_CODEX_E2E_FAKE_RUNTIME: 'true',
  };
  await runCommand(process.execPath, [input.cliEntry, 'relay-supervisor', 'start'], input.installRoot, 30_000, env);
  try {
    const status = await runCommand(process.execPath, [input.cliEntry, 'relay-supervisor', 'status'], input.installRoot, 10_000, env);
    if (!status.stdout.includes('State: running')) {
      throw new Error(`Managed status was unexpected:\n${status.stdout}${status.stderr}`);
    }
  } finally {
    await runCommand(process.execPath, [input.cliEntry, 'relay-supervisor', 'stop'], input.installRoot, 20_000, env);
  }
}

function runCommand(command, args, cwd, timeoutMs, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = crossSpawn(command, args, {
      cwd,
      windowsHide: true,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`${command} timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
    child.stdout?.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr?.on('data', (chunk) => { stderr += String(chunk); });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} exited with ${code}.\n${stderr || stdout}`));
    });
  });
}

function parsePackOutput(output) {
  for (let index = output.lastIndexOf('['); index >= 0; index = output.lastIndexOf('[', index - 1)) {
    try {
      const parsed = JSON.parse(output.slice(index));
      if (Array.isArray(parsed) && parsed[0]?.filename) {
        return parsed;
      }
    } catch {
      // Continue searching before build/prepack log lines.
    }
  }
  throw new Error(`Unable to parse npm pack output:\n${output}`);
}

async function assertPackagedFile(filePath) {
  try {
    await fsp.access(filePath);
  } catch {
    throw new Error(`Expected packaged file is missing: ${filePath}`);
  }
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

async function waitForHealth(url, child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Supervisor exited with ${child.exitCode}.`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {
      // Retry while the process initializes native dependencies and migrations.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for ${url}.`);
}

function requestControl(state, action) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(state.controlEndpoint);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('Lifecycle control timed out.'));
    }, 2_000);
    let output = '';
    socket.setEncoding('utf8');
    socket.once('connect', () => socket.write(`${JSON.stringify({
      action,
      token: state.controlToken,
      instanceId: state.instanceId,
    })}\n`));
    socket.on('data', (chunk) => {
      output += chunk;
      const newline = output.indexOf('\n');
      if (newline < 0) return;
      clearTimeout(timer);
      socket.end();
      resolve(JSON.parse(output.slice(0, newline)));
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Supervisor did not exit cleanly.')), timeoutMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
