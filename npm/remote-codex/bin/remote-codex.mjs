#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const launcherPath = fileURLToPath(import.meta.url);
const packageRoot = path.resolve(path.dirname(launcherPath), '..');
for (const envFile of new Set([
  path.join(process.cwd(), '.env'),
  path.join(packageRoot, '.env'),
])) {
  if (fs.existsSync(envFile)) process.loadEnvFile?.(envFile);
}
const webDist = path.join(packageRoot, 'web');
const packageJson = JSON.parse(
  fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'),
);
const packageVersion = packageJson.version;
const serviceDir = process.env.REMOTE_CODEX_SERVICE_DIR
  ? path.resolve(
      process.env.INIT_CWD ?? process.cwd(),
      process.env.REMOTE_CODEX_SERVICE_DIR,
    )
  : path.join(os.homedir(), '.remote-codex', 'service');
const serviceStatePath = path.join(serviceDir, 'service-state.json');
const relayConfigPath = process.env.REMOTE_CODEX_RELAY_SUPERVISOR_CONFIG
  ? path.resolve(process.env.REMOTE_CODEX_RELAY_SUPERVISOR_CONFIG)
  : path.join(os.homedir(), '.remote-codex', 'relay-supervisor.json');
const relayStatePath = process.env.REMOTE_CODEX_RELAY_SUPERVISOR_STATE
  ? path.resolve(process.env.REMOTE_CODEX_RELAY_SUPERVISOR_STATE)
  : path.join(os.homedir(), '.remote-codex', 'relay-supervisor-state.json');
const relayLogPath = process.env.REMOTE_CODEX_RELAY_SUPERVISOR_LOG
  ? path.resolve(process.env.REMOTE_CODEX_RELAY_SUPERVISOR_LOG)
  : path.join(os.homedir(), '.remote-codex', 'logs', 'relay-supervisor.log');
const relayTmuxSession =
  process.env.REMOTE_CODEX_RELAY_SUPERVISOR_TMUX_SESSION?.trim() ||
  'remote-codex-relay-supervisor';

const relayConfigKeys = [
  'REMOTE_CODEX_RELAY_SERVER_URL',
  'REMOTE_CODEX_RELAY_AGENT_TOKEN',
  'REMOTE_CODEX_ADMIN_USERNAME',
  'REMOTE_CODEX_ADMIN_PASSWORD',
  'REMOTE_CODEX_SESSION_SECRET',
  'REMOTE_CODEX_RELAY_SUPERVISOR_HOST',
  'REMOTE_CODEX_RELAY_SUPERVISOR_PORT',
  'DATABASE_URL',
  'WORKSPACE_ROOT',
  'CODEX_HOME',
  'CLAUDE_HOME',
  'OPENCODE_HOME',
  'GROK_HOME',
  'ACP_COMMAND',
  'REMOTE_CODEX_ENABLED_AGENT_PROVIDERS',
  'LOG_LEVEL',
];

const aliases = new Map([
  ['service:start', 'start'],
  ['service:status', 'status'],
  ['service:stop', 'stop'],
]);
const rawCommand = process.argv[2] ?? 'help';
const command = aliases.get(rawCommand) ?? rawCommand;

try {
  if (
    command !== '--help' &&
    command !== '-h' &&
    command !== 'help' &&
    process.argv.slice(3).some((value) => value === '--help' || value === '-h')
  ) {
    printHelp();
  } else if (
    command === '--version' ||
    command === '-v' ||
    command === 'version'
  ) {
    console.log(packageVersion);
  } else if (command === '--help' || command === '-h' || command === 'help') {
    printHelp();
  } else if (command === 'start') {
    await startService();
  } else if (command === 'status') {
    await serviceStatus();
  } else if (command === 'stop') {
    await stopService();
  } else if (command === 'relay') {
    await runForeground(['relay'], relayEnvironment());
  } else if (command === 'relay-supervisor') {
    await relaySupervisor(process.argv[3] ?? 'start');
  } else {
    await runForeground(process.argv.slice(2), nativeEnvironment());
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

async function resolveNativeBinary() {
  if (process.env.REMOTE_CODEX_NATIVE_BINARY) {
    const override = path.resolve(process.env.REMOTE_CODEX_NATIVE_BINARY);
    if (!fs.existsSync(override)) {
      throw new Error(`REMOTE_CODEX_NATIVE_BINARY does not exist: ${override}`);
    }
    return override;
  }
  const key = platformKey();
  const nativeManifest = JSON.parse(
    fs.readFileSync(path.join(packageRoot, 'native-manifest.json'), 'utf8'),
  );
  if (nativeManifest.version !== packageVersion) {
    throw new Error(
      `Native manifest version ${nativeManifest.version} does not match package ${packageVersion}.`,
    );
  }
  const target = nativeManifest.assets?.[key];
  if (!target?.name || !target?.sha256) {
    throw new Error(
      `Remote Codex does not publish a native binary for ${key}.`,
    );
  }
  const cacheRoot = process.env.REMOTE_CODEX_NATIVE_CACHE_DIR
    ? path.resolve(process.env.REMOTE_CODEX_NATIVE_CACHE_DIR)
    : path.join(os.homedir(), '.remote-codex', 'bin');
  const binary = path.join(cacheRoot, packageVersion, key, target.name);
  if (await validNativeBinary(binary, target.sha256)) return binary;

  const baseUrl = (
    process.env.REMOTE_CODEX_NATIVE_DOWNLOAD_BASE_URL ??
    nativeManifest.releaseBaseUrl
  ).replace(/\/$/, '');
  const url = `${baseUrl}/${encodeURIComponent(target.name)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  let contents;
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} from ${url}`);
    }
    contents = Buffer.from(await response.arrayBuffer());
  } catch (error) {
    throw new Error(
      `Unable to download Remote Codex ${packageVersion} for ${key} from ${url}: ${error instanceof Error ? error.message : error}`,
    );
  } finally {
    clearTimeout(timer);
  }
  const actual = crypto.createHash('sha256').update(contents).digest('hex');
  if (actual !== target.sha256) {
    throw new Error(
      `Downloaded Remote Codex ${packageVersion} for ${key} failed SHA-256 verification.`,
    );
  }
  fs.mkdirSync(path.dirname(binary), { recursive: true, mode: 0o700 });
  const temporary = `${binary}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  fs.writeFileSync(temporary, contents, { mode: 0o700, flag: 'wx' });
  try {
    fs.renameSync(temporary, binary);
  } catch (error) {
    if (!['EEXIST', 'EPERM'].includes(error?.code)) throw error;
    if (!(await validNativeBinary(binary, target.sha256))) {
      removeFile(binary);
      fs.renameSync(temporary, binary);
    }
  } finally {
    removeFile(temporary);
  }
  if (!(await validNativeBinary(binary, target.sha256))) {
    throw new Error(
      `Cached Remote Codex binary failed verification: ${binary}`,
    );
  }
  return binary;
}

async function validNativeBinary(binary, expectedSha256) {
  try {
    const contents = await fs.promises.readFile(binary);
    const actual = crypto.createHash('sha256').update(contents).digest('hex');
    if (actual !== expectedSha256) return false;
    if (process.platform !== 'win32') fs.chmodSync(binary, 0o700);
    return true;
  } catch {
    return false;
  }
}

function platformKey() {
  if (process.platform === 'linux') {
    return `linux-${process.arch}-${linuxLibc()}`;
  }
  if (process.platform === 'win32') {
    return `win32-${process.arch}-msvc`;
  }
  return `${process.platform}-${process.arch}`;
}

function linuxLibc() {
  try {
    const report = process.report?.getReport?.();
    if (report?.header?.glibcVersionRuntime) return 'gnu';
    if (report?.header?.musl) return 'musl';
  } catch {
    // Fall through to ldd detection.
  }
  const result = spawnSync('ldd', ['--version'], { encoding: 'utf8' });
  return `${result.stdout ?? ''}${result.stderr ?? ''}`
    .toLowerCase()
    .includes('musl')
    ? 'musl'
    : 'gnu';
}

function nativeEnvironment(extra = {}) {
  const environment = {
    ...process.env,
    APP_VERSION: process.env.APP_VERSION ?? packageVersion,
    REMOTE_CODEX_PACKAGE_ROOT:
      process.env.REMOTE_CODEX_PACKAGE_ROOT ?? packageRoot,
    REMOTE_CODEX_WEB_DIST_DIR: process.env.REMOTE_CODEX_WEB_DIST_DIR ?? webDist,
    ...extra,
  };
  return environment;
}

function relaySupervisorEnvironment(extra = {}) {
  const environment = nativeEnvironment(extra);
  if (environment.REMOTE_CODEX_RELAY_SUPERVISOR_HOST) {
    environment.HOST = environment.REMOTE_CODEX_RELAY_SUPERVISOR_HOST;
  }
  if (environment.REMOTE_CODEX_RELAY_SUPERVISOR_PORT) {
    environment.PORT = environment.REMOTE_CODEX_RELAY_SUPERVISOR_PORT;
  }
  return environment;
}

function relayEnvironment() {
  const environment = nativeEnvironment({
    REMOTE_CODEX_RELAY_WEB_DIST_DIR:
      process.env.REMOTE_CODEX_RELAY_WEB_DIST_DIR ?? webDist,
  });
  if (environment.REMOTE_CODEX_RELAY_HOST)
    environment.HOST = environment.REMOTE_CODEX_RELAY_HOST;
  if (environment.REMOTE_CODEX_RELAY_PORT)
    environment.PORT = environment.REMOTE_CODEX_RELAY_PORT;
  return environment;
}

async function runForeground(args, environment) {
  const binary = await resolveNativeBinary();
  const child = spawn(binary, args, {
    cwd: process.cwd(),
    env: environment,
    stdio: 'inherit',
    windowsHide: false,
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      try {
        child.kill(signal);
      } catch {
        /* The child may already have exited. */
      }
    });
  }
  const result = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  if (result.signal) {
    process.exitCode = 1;
  } else {
    process.exitCode = result.code ?? 1;
  }
}

async function startService() {
  const host =
    process.env.SERVICE_HOST ?? process.env.SERVICE_API_HOST ?? '127.0.0.1';
  const port = parsePort(
    process.env.SERVICE_PORT ?? process.env.SERVICE_API_PORT,
    45673,
  );
  const probeHost = localProbeHost(host);
  const current = readJson(serviceStatePath);
  if (current && statePids(current).some(isProcessAlive)) {
    throw new Error(
      `Remote Codex is already running. State: ${serviceStatePath}`,
    );
  }
  fs.mkdirSync(serviceDir, { recursive: true, mode: 0o700 });
  if (current) removeFile(serviceStatePath);
  await assertPortAvailable(host, port);
  const logPath = path.join(serviceDir, 'supervisor.log');
  rotateLog(logPath);
  const environment = nativeEnvironment({
    NODE_ENV: 'production',
    HOST: host,
    PORT: String(port),
  });
  delete environment.REMOTE_CODEX_RELAY_SUPERVISOR_HOST;
  delete environment.REMOTE_CODEX_RELAY_SUPERVISOR_PORT;
  if (environment.REMOTE_CODEX_MODE !== 'relay') {
    delete environment.REMOTE_CODEX_RELAY_SERVER_URL;
    delete environment.REMOTE_CODEX_RELAY_AGENT_TOKEN;
  }
  const pid = spawnDetached(
    await resolveNativeBinary(),
    ['supervisor'],
    logPath,
    environment,
  );
  try {
    await waitForHttp(`http://${probeHost}:${port}/healthz`, pid, 20_000);
    await waitForHttp(`http://${probeHost}:${port}/`, pid, 5_000);
  } catch (error) {
    stopPid(pid, true);
    throw appendLog(error, logPath);
  }
  writePrivateJson(serviceStatePath, {
    formatVersion: 2,
    runtime: 'rust',
    version: packageVersion,
    startedAt: new Date().toISOString(),
    runtimePid: pid,
    apiPid: pid,
    webPid: null,
    serviceHost: host,
    servicePort: port,
    apiHost: host,
    apiPort: port,
    logPath,
    apiLogPath: logPath,
  });
  console.log('Started Remote Codex.');
  console.log(`Web and API: http://${host}:${port} (pid ${pid})`);
  console.log(`Logs: ${logPath}`);
}

async function serviceStatus() {
  const state = readJson(serviceStatePath);
  if (!state) {
    console.log('Remote Codex is not running.');
    return;
  }
  const pids = statePids(state);
  const alive = pids.filter(isProcessAlive);
  const host = localProbeHost(
    state.serviceHost ?? state.apiHost ?? '127.0.0.1',
  );
  const port = state.servicePort ?? state.apiPort ?? 45673;
  const healthy =
    alive.length > 0 && (await probeHttp(`http://${host}:${port}/healthz`));
  console.log(
    `State: ${alive.length === pids.length && healthy ? 'running' : 'degraded'}`,
  );
  console.log(`Version: ${state.version ?? 'legacy-node'}`);
  console.log(`Process: ${alive.length > 0 ? alive.join(', ') : 'down'}`);
  console.log(`Web and API: http://${state.serviceHost ?? host}:${port}`);
  console.log(`State file: ${serviceStatePath}`);
}

async function stopService() {
  const state = readJson(serviceStatePath);
  if (!state) {
    console.log('Remote Codex is not running.');
    return;
  }
  if (
    state.apiControlEndpoint &&
    state.apiControlToken &&
    state.apiInstanceId
  ) {
    await requestLegacyShutdown(state).catch(() => undefined);
  }
  await stopPids(statePids(state));
  removeFile(serviceStatePath);
  console.log('Stopped Remote Codex.');
}

async function relaySupervisor(action) {
  if (action === 'reset') {
    removeFile(relayConfigPath);
    console.log(`Removed relay supervisor config: ${relayConfigPath}`);
    return;
  }
  if (action === 'status') {
    if (process.platform !== 'win32') {
      const running = tmuxSessionExists();
      console.log(`Relay supervisor: ${running ? 'running' : 'stopped'}`);
      if (running) console.log(`Attach: tmux attach -t ${relayTmuxSession}`);
      console.log(`Logs: ${relayLogPath}`);
      return;
    }
    await managedRelayStatus();
    return;
  }
  if (action === 'stop') {
    if (process.platform !== 'win32') {
      const result = spawnSync(
        'tmux',
        ['kill-session', '-t', relayTmuxSession],
        { stdio: 'ignore' },
      );
      console.log(
        result.status === 0
          ? 'Stopped relay supervisor.'
          : 'Relay supervisor is not running.',
      );
      return;
    }
    await stopManagedRelay();
    return;
  }
  if (action !== 'start' && action !== 'run') {
    throw new Error(
      'relay-supervisor action must be start, run, status, stop, or reset',
    );
  }
  const environment = await ensureRelayConfig();
  if (action === 'run') {
    await runForeground(['relay-supervisor'], environment);
    return;
  }
  if (process.platform !== 'win32' && useTmux()) {
    if (tmuxSessionExists())
      throw new Error(`tmux session ${relayTmuxSession} is already running`);
    fs.mkdirSync(path.dirname(relayLogPath), { recursive: true, mode: 0o700 });
    rotateLog(relayLogPath);
    const launch = [process.execPath, launcherPath, 'relay-supervisor', 'run']
      .map(shellQuote)
      .join(' ');
    const commandText = `${launch} 2>&1 | tee -a ${shellQuote(relayLogPath)}`;
    // An existing tmux server does not inherit the client's environment.
    const sessionEnvironment = Object.entries(environment).flatMap(
      ([name, value]) => ['-e', `${name}=${value}`],
    );
    const result = spawnSync(
      'tmux',
      ['new-session', '-d', '-s', relayTmuxSession, ...sessionEnvironment, commandText],
      { cwd: process.cwd(), env: environment, stdio: 'inherit' },
    );
    if (result.status !== 0)
      throw new Error('Failed to start relay supervisor in tmux');
    await sleep(750);
    if (!tmuxSessionExists()) {
      throw appendLog(
        new Error('Relay supervisor exited during startup'),
        relayLogPath,
      );
    }
    console.log(
      `Started relay supervisor in tmux session ${relayTmuxSession}.`,
    );
    console.log(`Attach: tmux attach -t ${relayTmuxSession}`);
    console.log(`Logs: ${relayLogPath}`);
    return;
  }
  if (process.platform !== 'win32') {
    await runForeground(['relay-supervisor'], environment);
    return;
  }
  fs.mkdirSync(path.dirname(relayLogPath), { recursive: true, mode: 0o700 });
  rotateLog(relayLogPath);
  const pid = spawnDetached(
    await resolveNativeBinary(),
    ['relay-supervisor'],
    relayLogPath,
    environment,
  );
  const relayPort = parsePort(
    environment.REMOTE_CODEX_RELAY_SUPERVISOR_PORT ?? environment.PORT,
    8787,
  );
  try {
    await waitForHttp(`http://127.0.0.1:${relayPort}/healthz`, pid, 20_000);
  } catch (error) {
    stopPid(pid, true);
    throw appendLog(error, relayLogPath);
  }
  writePrivateJson(relayStatePath, {
    formatVersion: 2,
    runtime: 'rust',
    version: packageVersion,
    pid,
    logPath: relayLogPath,
    port: relayPort,
    startedAt: new Date().toISOString(),
  });
  console.log(`Started relay supervisor (pid ${pid}).`);
  console.log(`Logs: ${relayLogPath}`);
}

async function ensureRelayConfig() {
  const saved = readJson(relayConfigPath) ?? {};
  const defaults = {
    REMOTE_CODEX_ADMIN_USERNAME: 'admin',
    REMOTE_CODEX_ADMIN_PASSWORD: crypto.randomBytes(24).toString('base64url'),
    REMOTE_CODEX_SESSION_SECRET: crypto.randomBytes(32).toString('base64url'),
    REMOTE_CODEX_RELAY_SUPERVISOR_HOST: '127.0.0.1',
    DATABASE_URL: path.join(
      os.homedir(),
      '.remote-codex',
      'relay-supervisor.sqlite',
    ),
  };
  for (const [name, value] of Object.entries({ ...defaults, ...saved })) {
    if (!nonempty(process.env[name])) process.env[name] = value;
  }
  const missing = [
    [
      'REMOTE_CODEX_RELAY_SERVER_URL',
      'Relay websocket URL (ws:// or wss://): ',
    ],
    ['REMOTE_CODEX_RELAY_AGENT_TOKEN', 'Relay device token: '],
  ].filter(([name]) => !nonempty(process.env[name]));
  if (missing.length > 0 && process.stdin.isTTY && process.stderr.isTTY) {
    const prompt = readline.createInterface({
      input: process.stdin,
      output: process.stderr,
    });
    try {
      for (const [name, question] of missing) {
        let value = '';
        while (!value) value = (await prompt.question(question)).trim();
        process.env[name] = value;
      }
    } finally {
      prompt.close();
    }
  }
  if (
    !nonempty(process.env.REMOTE_CODEX_RELAY_SERVER_URL) ||
    !/^wss?:\/\//.test(process.env.REMOTE_CODEX_RELAY_SERVER_URL)
  ) {
    throw new Error(
      'REMOTE_CODEX_RELAY_SERVER_URL must start with ws:// or wss://',
    );
  }
  if (!nonempty(process.env.REMOTE_CODEX_RELAY_AGENT_TOKEN)) {
    throw new Error('REMOTE_CODEX_RELAY_AGENT_TOKEN is required');
  }
  const persisted = { ...saved };
  for (const key of relayConfigKeys) {
    if (nonempty(process.env[key])) persisted[key] = process.env[key];
  }
  writePrivateJson(relayConfigPath, persisted);
  return relaySupervisorEnvironment({ REMOTE_CODEX_MODE: 'relay' });
}

async function managedRelayStatus() {
  const state = readJson(relayStatePath);
  const alive = Boolean(state && isProcessAlive(state.pid));
  const healthy =
    alive && state.port
      ? await probeHttp(`http://127.0.0.1:${state.port}/healthz`)
      : false;
  console.log(
    `Relay supervisor: ${alive && healthy ? 'running' : alive ? 'degraded' : 'stopped'}`,
  );
  if (state?.logPath) console.log(`Logs: ${state.logPath}`);
}

async function stopManagedRelay() {
  const state = readJson(relayStatePath);
  if (!state) {
    console.log('Relay supervisor is not running.');
    return;
  }
  await stopPids([state.pid]);
  removeFile(relayStatePath);
  console.log('Stopped relay supervisor.');
}

function useTmux() {
  const disabled = ['0', 'false', 'no', 'off'].includes(
    String(process.env.REMOTE_CODEX_RELAY_SUPERVISOR_TMUX ?? '').toLowerCase(),
  );
  return (
    !disabled && spawnSync('tmux', ['-V'], { stdio: 'ignore' }).status === 0
  );
}

function tmuxSessionExists() {
  return (
    spawnSync('tmux', ['has-session', '-t', relayTmuxSession], {
      stdio: 'ignore',
    }).status === 0
  );
}

function spawnDetached(binary, args, logPath, environment) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true, mode: 0o700 });
  const log = fs.openSync(logPath, 'a');
  const child = spawn(binary, args, {
    cwd: process.cwd(),
    detached: true,
    env: environment,
    stdio: ['ignore', log, log],
    windowsHide: true,
  });
  fs.closeSync(log);
  child.unref();
  if (!child.pid) throw new Error('Native process did not return a pid');
  return child.pid;
}

function statePids(state) {
  return [
    ...new Set([state.runtimePid, state.apiPid, state.webPid].filter(validPid)),
  ];
}

async function stopPids(pids) {
  for (const pid of [...new Set(pids)].filter(validPid)) stopPid(pid, false);
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline && pids.some(isProcessAlive)) await sleep(100);
  for (const pid of pids.filter(isProcessAlive)) stopPid(pid, true);
}

function stopPid(pid, force) {
  if (!validPid(pid)) return;
  if (process.platform === 'win32') {
    spawnSync(
      'taskkill.exe',
      ['/PID', String(pid), '/T', ...(force ? ['/F'] : [])],
      {
        windowsHide: true,
        stdio: 'ignore',
      },
    );
    return;
  }
  const signal = force ? 'SIGKILL' : 'SIGTERM';
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      /* It already stopped. */
    }
  }
}

function isProcessAlive(pid) {
  if (!validPid(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function validPid(pid) {
  return Number.isInteger(pid) && pid > 1;
}

function writePrivateJson(filePath, value) {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(directory, 0o700);
  } catch {
    /* Windows ACLs are applied below. */
  }
  const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  const descriptor = fs.openSync(temporary, 'wx', 0o600);
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fs.renameSync(temporary, filePath);
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    /* Windows uses inherited ACLs. */
  }
  if (process.platform === 'win32') {
    restrictWindowsAcl(directory, true);
    restrictWindowsAcl(filePath, false);
  }
}

function restrictWindowsAcl(target, directory) {
  const username =
    process.env.USERDOMAIN && process.env.USERNAME
      ? `${process.env.USERDOMAIN}\\${process.env.USERNAME}`
      : (process.env.USERNAME ?? os.userInfo().username);
  const permission = directory ? '(OI)(CI)F' : 'F';
  const result = spawnSync(
    'icacls.exe',
    [
      target,
      '/inheritance:r',
      '/grant:r',
      `${username}:${permission}`,
      `SYSTEM:${permission}`,
    ],
    { windowsHide: true, stdio: 'ignore' },
  );
  if (result.status !== 0)
    throw new Error(`Unable to restrict Windows ACL for ${target}`);
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function removeFile(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

function rotateLog(logPath) {
  const previous = `${logPath}.1`;
  removeFile(previous);
  if (fs.existsSync(logPath)) fs.renameSync(logPath, previous);
}

async function assertPortAvailable(host, port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', (error) =>
      reject(
        error?.code === 'EADDRINUSE'
          ? new Error(`Port ${host}:${port} is already in use`)
          : error,
      ),
    );
    server.listen(port, host, () => server.close(resolve));
  });
}

async function waitForHttp(url, pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid))
      throw new Error(`Process ${pid} exited before becoming ready`);
    if (await probeHttp(url)) return;
    await sleep(150);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function probeHttp(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1_000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function requestLegacyShutdown(state) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(state.apiControlEndpoint);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('Legacy shutdown timed out'));
    }, 2_000);
    let output = '';
    socket.setEncoding('utf8');
    socket.once('connect', () =>
      socket.write(
        `${JSON.stringify({
          action: 'shutdown',
          token: state.apiControlToken,
          instanceId: state.apiInstanceId,
        })}\n`,
      ),
    );
    socket.on('data', (chunk) => {
      output += chunk;
      if (!output.includes('\n')) return;
      clearTimeout(timer);
      socket.end();
      resolve(output);
    });
    socket.once('error', reject);
  });
}

function appendLog(error, logPath) {
  let tail = '';
  try {
    tail = fs
      .readFileSync(logPath, 'utf8')
      .trim()
      .split(/\r?\n/)
      .slice(-80)
      .join('\n');
  } catch {}
  return new Error(
    `${error instanceof Error ? error.message : error}\nLog: ${logPath}${tail ? `\n\n${tail}` : ''}`,
  );
}

function localProbeHost(host) {
  return host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
}

function parsePort(value, fallback) {
  if (!nonempty(value)) return fallback;
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error(`Invalid port: ${value}`);
  return port;
}

function nonempty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function printHelp() {
  console.log(`remote-codex ${packageVersion}

Usage: remote-codex <command>

Commands:
  start                         Start the managed local web app and supervisor
  status                        Show managed local service status
  stop                          Stop the managed local service
  supervisor                    Run the supervisor in the foreground
  relay                         Run the public relay in the foreground
  relay-migrate                 Inspect or migrate a relay data directory offline
  relay-supervisor [action]     start, run, status, stop, or reset
  version                       Print the installed version

The npm package downloads and verifies the matching Rust binary from the
same-version GitHub release on first use. Set REMOTE_CODEX_NATIVE_BINARY only
when testing a local build.`);
}
