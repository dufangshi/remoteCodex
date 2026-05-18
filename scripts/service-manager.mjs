import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const serviceDir = process.env.REMOTE_CODEX_SERVICE_DIR
  ? path.resolve(process.env.INIT_CWD ?? process.cwd(), process.env.REMOTE_CODEX_SERVICE_DIR)
  : path.join(os.homedir(), '.remote-codex', 'service');
const stateFile = path.join(serviceDir, 'service-state.json');
const apiEntry = path.join(repoRoot, 'apps', 'supervisor-api', 'dist', 'index.js');
const webEntry = path.join(repoRoot, 'scripts', 'run-web-service.mjs');
const webIndex = path.join(repoRoot, 'apps', 'supervisor-web', 'dist', 'index.html');
const supportsSourceRestart =
  fs.existsSync(path.join(repoRoot, 'pnpm-workspace.yaml')) &&
  fs.existsSync(path.join(repoRoot, 'scripts', 'service-restart.mjs'));

const serviceHost = process.env.SERVICE_HOST ?? '127.0.0.1';
const servicePort = parsePort(process.env.SERVICE_PORT, 4173);
const apiHost = process.env.SERVICE_API_HOST ?? '127.0.0.1';
const apiPort = parsePort(process.env.SERVICE_API_PORT, 8787);

const command = process.argv[2];

switch (command) {
  case 'start':
    await startService();
    break;
  case 'stop':
    await stopService();
    break;
  case 'status':
    await printStatus();
    break;
  default:
    console.error('Usage: node scripts/service-manager.mjs <start|stop|status>');
    process.exit(1);
}

async function startService() {
  ensureBuildArtifacts();
  await fsp.mkdir(serviceDir, { recursive: true });

  const existingState = await readState();
  if (existingState && serviceStateAlive(existingState)) {
    console.error('Service is already running.');
    await printStatus();
    process.exit(1);
  }
  if (existingState) {
    await removeStateFile();
  }

  const apiLogPath = path.join(serviceDir, 'api.log');
  const webLogPath = path.join(serviceDir, 'web.log');
  prepareLogFile(apiLogPath);
  prepareLogFile(webLogPath);
  const apiPid = spawnDetached(process.execPath, [apiEntry], apiLogPath, {
    NODE_ENV: 'production',
    HOST: apiHost,
    PORT: String(apiPort),
    LOG_LEVEL: process.env.LOG_LEVEL ?? 'warn',
    DISABLE_REQUEST_LOGGING: process.env.DISABLE_REQUEST_LOGGING ?? 'true',
    REMOTE_CODEX_PACKAGE_ROOT: repoRoot,
    REMOTE_CODEX_DISABLE_BUILD_RESTART:
      process.env.REMOTE_CODEX_DISABLE_BUILD_RESTART ?? (supportsSourceRestart ? 'false' : 'true'),
  });

  try {
    await waitForHttp(`http://${apiHost}:${apiPort}/healthz`, apiPid, 15_000);
  } catch (error) {
    stopPid(apiPid);
    throw error;
  }

  const webPid = spawnDetached(process.execPath, [webEntry], webLogPath, {
    SERVICE_HOST: serviceHost,
    SERVICE_PORT: String(servicePort),
    SERVICE_API_HOST: apiHost,
    SERVICE_API_PORT: String(apiPort),
    SERVICE_WEB_DIST_DIR: path.join(repoRoot, 'apps', 'supervisor-web', 'dist'),
  });

  try {
    await waitForHttp(`http://${serviceHost}:${servicePort}/`, webPid, 15_000);
  } catch (error) {
    stopPid(webPid);
    stopPid(apiPid);
    throw error;
  }

  const state = {
    startedAt: new Date().toISOString(),
    serviceHost,
    servicePort,
    apiHost,
    apiPort,
    apiPid,
    webPid,
    apiLogPath,
    webLogPath,
  };
  await fsp.writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`, 'utf8');

  console.log(`Started supervisor service.`);
  console.log(`Web: http://${serviceHost}:${servicePort} (pid ${webPid})`);
  console.log(`API: http://${apiHost}:${apiPort} (pid ${apiPid})`);
  console.log(`Logs: ${serviceDir}`);
}

async function stopService() {
  const state = await readState();
  if (!state) {
    console.log('Supervisor service is not running.');
    return;
  }

  await stopState(state);
  await removeStateFile();
  console.log('Stopped supervisor service.');
}

async function printStatus() {
  const state = await readState();
  if (!state) {
    console.log('Supervisor service is not running.');
    return;
  }

  const apiAlive = isProcessAlive(state.apiPid);
  const webAlive = isProcessAlive(state.webPid);
  const apiHealthy = apiAlive
    ? await probeHttp(`http://${state.apiHost}:${state.apiPort}/healthz`)
    : false;
  const webHealthy = webAlive
    ? await probeHttp(`http://${state.serviceHost}:${state.servicePort}/`)
    : false;

  console.log(`State: ${apiAlive && webAlive ? 'running' : 'degraded'}`);
  console.log(`Started: ${state.startedAt}`);
  console.log(
    `API: pid ${state.apiPid}, process ${apiAlive ? 'up' : 'down'}, health ${apiHealthy ? 'ok' : 'failed'}, http://${state.apiHost}:${state.apiPort}`
  );
  console.log(
    `Web: pid ${state.webPid}, process ${webAlive ? 'up' : 'down'}, health ${webHealthy ? 'ok' : 'failed'}, http://${state.serviceHost}:${state.servicePort}`
  );
  console.log(`Logs: ${serviceDir}`);
}

function ensureBuildArtifacts() {
  const missing = [apiEntry, webIndex].filter((filePath) => !fs.existsSync(filePath));
  if (missing.length === 0) {
    return;
  }

  console.error('Build artifacts are missing. Run `pnpm build` before starting the service.');
  for (const filePath of missing) {
    console.error(`Missing: ${path.relative(repoRoot, filePath)}`);
  }
  process.exit(1);
}

function spawnDetached(commandToRun, args, logPath, env) {
  const logFd = fs.openSync(logPath, 'a');
  const child = spawn(commandToRun, args, {
    cwd: repoRoot,
    detached: true,
    env: {
      ...process.env,
      ...env,
    },
    stdio: ['ignore', logFd, logFd],
  });

  child.unref();
  fs.closeSync(logFd);

  if (!child.pid) {
    throw new Error(`Failed to start ${args.at(-1) ?? commandToRun}.`);
  }

  return child.pid;
}

function prepareLogFile(logPath) {
  const rotatedPath = `${logPath}.1`;

  if (fs.existsSync(rotatedPath)) {
    fs.rmSync(rotatedPath, { force: true });
  }

  if (fs.existsSync(logPath)) {
    fs.renameSync(logPath, rotatedPath);
  }
}

async function waitForHttp(url, pid, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!isProcessAlive(pid)) {
      throw new Error(`Process ${pid} exited before becoming ready.`);
    }

    if (await probeHttp(url)) {
      return;
    }

    await sleep(250);
  }

  throw new Error(`Timed out waiting for ${url}.`);
}

async function probeHttp(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1_000);
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        connection: 'close',
      },
    });
    clearTimeout(timer);
    return response.ok;
  } catch {
    return false;
  }
}

async function stopState(state) {
  for (const pid of [state.webPid, state.apiPid]) {
    stopPid(pid);
  }

  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (![state.webPid, state.apiPid].some((pid) => isProcessAlive(pid))) {
      return;
    }
    await sleep(250);
  }

  for (const pid of [state.webPid, state.apiPid]) {
    forceStopPid(pid);
  }
}

async function readState() {
  try {
    const raw = await fsp.readFile(stateFile, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function serviceStateAlive(state) {
  return [state.apiPid, state.webPid].some((pid) => isProcessAlive(pid));
}

function stopPid(pid) {
  if (!Number.isInteger(pid) || pid <= 1) {
    return;
  }

  try {
    process.kill(-pid, 'SIGTERM');
    return;
  } catch {
    // Fall back to the direct process if the group is unavailable.
  }

  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // Ignore races where the process already exited.
  }
}

function forceStopPid(pid) {
  if (!Number.isInteger(pid) || pid <= 1) {
    return;
  }

  try {
    process.kill(-pid, 'SIGKILL');
    return;
  } catch {
    // Fall back to the direct process if the group is unavailable.
  }

  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // Ignore races where the process already exited.
  }
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 1) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function removeStateFile() {
  try {
    await fsp.unlink(stateFile);
  } catch {
    // Ignore missing state files.
  }
}

function parsePort(value, fallback) {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid port: ${value}`);
  }

  return parsed;
}

function sleep(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
