#!/usr/bin/env node
// The worker is copied outside the npm package and owned by the OS service manager.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const read = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};
function write(file, value) {
  fs.writeFileSync(`${file}.next`, JSON.stringify(value), { mode: 0o600 });
  fs.renameSync(`${file}.next`, file);
}
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const xml = (v) =>
  String(v)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

export function npmInstallation(launcher, node) {
  const root = path.dirname(path.dirname(fs.realpathSync(launcher)));
  if (read(path.join(root, 'package.json'))?.name !== 'remote-codex')
    throw Error('Unrecognized launcher package');
  const modules = path.dirname(root);
  if (path.basename(modules) !== 'node_modules')
    throw Error('This is a source checkout, not a global npm installation');
  const parent = path.dirname(modules);
  const prefix =
    path.basename(parent) === 'lib' ? path.dirname(parent) : parent;
  let npm = path.join(modules, 'npm/bin/npm-cli.js');
  if (process.platform === 'win32' && !fs.existsSync(npm))
    npm = path.join(path.dirname(node), 'node_modules/npm/bin/npm-cli.js');
  if (!fs.existsSync(npm) || !fs.existsSync(node))
    throw Error('Cannot identify the npm installation that owns this launcher');
  return {
    root,
    prefix,
    npm,
    node,
    launcher,
    installedVersion: read(path.join(root, 'package.json')).version,
  };
}

async function run(program, args, env, cwd, timeout = 300_000) {
  return await new Promise((resolve, reject) => {
    const child = spawn(program, args, {
      env,
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
    let result = '';
    child.stdout.on('data', (chunk) => {
      if (result.length < 64_000) result += chunk;
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(Error('Update command timed out'));
    }, timeout);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      code === 0
        ? resolve(result.trim())
        : reject(Error(`Update command exited with code ${code}`));
    });
  });
}

async function latest() {
  const response = await fetch(
    'https://registry.npmjs.org/remote-codex/latest',
    { signal: AbortSignal.timeout(8000) },
  );
  if (!response.ok) throw Error(`Registry returned ${response.status}`);
  const version = (await response.json()).version;
  if (!/^\d+\.\d+\.\d+$/.test(version))
    throw Error('Invalid stable release version');
  return version;
}
async function health(port, host = '127.0.0.1') {
  try {
    return await (
      await fetch(
        `http://${host === '::' ? '[::1]' : host === '0.0.0.0' ? '127.0.0.1' : host.includes(':') ? `[${host}]` : host}:${port}/healthz`,
        { signal: AbortSignal.timeout(1500) },
      )
    ).json();
  } catch {
    return null;
  }
}
function cleanEnvironment(env) {
  const next = { ...env };
  for (const key of Object.keys(next))
    if (
      key.startsWith('REMOTE_CODEX_UPDATE_') ||
      [
        'REMOTE_CODEX_NATIVE_BINARY',
        'REMOTE_CODEX_WEB_DIST_DIR',
        'REMOTE_CODEX_PACKAGE_ROOT',
        'APP_VERSION',
      ].includes(key)
    )
      delete next[key];
  return next;
}
function detachedService(program, args, env, cwd, log) {
  const fd = fs.openSync(log, 'a', 0o600);
  const child = spawn(program, args, {
    env,
    cwd,
    detached: true,
    stdio: ['ignore', fd, fd],
    windowsHide: true,
  });
  child.on('error', () => {}); // Health verification reports startup failure and handles rollback.
  child.unref();
  fs.closeSync(fd);
  return child;
}

export async function worker(plan, hooks = {}) {
  const execute = hooks.run ?? run;
  const getHealth = hooks.health ?? health;
  const pause = hooks.sleep ?? sleep;
  const stop = hooks.stop ?? ((pid) => process.kill(pid, 'SIGTERM'));
  const start = hooks.start ?? detachedService;
  const env = cleanEnvironment(plan.env);
  const isAlive = hooks.alive ?? alive;
  if (plan.mode !== 'relay') {
    env.SERVICE_HOST = plan.host ?? '127.0.0.1';
    env.SERVICE_PORT = String(plan.port);
  }
  const backup = path.join(plan.directory, 'previous-package');
  let installed = false,
    stopped = false,
    newPid;
  const status = (phase, extra = {}) =>
    write(plan.statusFile, {
      phase,
      targetVersion: plan.version,
      runningVersion: plan.runningVersion,
      logPath: path.join(plan.directory, 'update.log'),
      updatedAt: Date.now(),
      workerPid: process.pid,
      ...extra,
    });
  async function verify(version) {
    for (let i = 0; i < 60; i++) {
      const result = await getHealth(plan.port, plan.host);
      if (
        result?.status === 'ok' &&
        result.runningVersion === version &&
        result.processId !== plan.pid
      ) {
        newPid = result.processId;
        return result;
      }
      await pause(1000);
    }
    throw Error('Supervisor did not become healthy after the update');
  }
  try {
    status('preparing');
    if ((await getHealth(plan.port, plan.host))?.processId !== plan.pid)
      throw Error('The running Supervisor changed; check for updates again');
    fs.cpSync(plan.root, backup, { recursive: true });
    installed = true;
    status('installing');
    await execute(
      plan.node,
      [
        plan.npm,
        'install',
        '--global',
        '--prefix',
        plan.prefix,
        `remote-codex@${plan.version}`,
        '--no-audit',
        '--no-fund',
      ],
      env,
      plan.cwd,
    );
    if (read(path.join(plan.root, 'package.json'))?.version !== plan.version)
      throw Error('Installed launcher version mismatch');
    const binary = await execute(
      plan.node,
      [plan.launcher, 'native-path'],
      env,
      plan.cwd,
    );
    if ((await execute(binary, ['version'], env, plan.cwd)) !== plan.version)
      throw Error('Native version mismatch');
    status('restarting');
    await pause(3000);
    const beforeStop = await getHealth(plan.port, plan.host);
    if (beforeStop?.processId !== plan.pid)
      throw Error('The running Supervisor changed before restart');
    if (beforeStop.activeTurnCount > 0)
      throw Error(
        'A turn started during preparation. Try updating after it finishes.',
      );
    stopped = true;
    stop(plan.pid);
    for (let i = 0; i < 30 && isAlive(plan.pid); i++) await pause(500);
    if (isAlive(plan.pid))
      throw Error(
        'Old Supervisor did not stop; refusing to kill another process',
      );
    const log =
      plan.env.REMOTE_CODEX_RELAY_SUPERVISOR_LOG ??
      path.join(os.homedir(), '.remote-codex/logs/relay-supervisor.log');
    const previousLog = fs.existsSync(log) ? fs.statSync(log) : null;
    start(
      plan.node,
      [
        plan.launcher,
        plan.mode === 'relay' ? 'relay-supervisor' : 'start',
        ...(plan.mode === 'relay' ? ['start'] : []),
      ],
      env,
      plan.cwd,
      path.join(plan.directory, 'launch.log'),
    );
    const result = await verify(plan.version);
    // Relay mode must reconnect as well as bind its local HTTP port.
    if (plan.mode === 'relay') {
      let connected = false;
      for (let i = 0; i < 60; i++) {
        if (fs.existsSync(log)) {
          const current = fs.statSync(log);
          const offset =
            previousLog?.ino === current.ino && current.size >= previousLog.size
              ? previousLog.size
              : 0;
          if (
            fs
              .readFileSync(log, 'utf8')
              .slice(offset)
              .includes('relay tunnel connected')
          ) {
            connected = true;
            break;
          }
        }
        await pause(1000);
      }
      if (!connected)
        throw Error('Supervisor started, but relay reconnection failed');
    }
    status('completed', {
      runningVersion: plan.version,
      processId: result.processId,
    });
  } catch (error) {
    // Keep the job active until rollback finishes; the old runtime must stay paused.
    status('restarting', { rollingBack: true, error: error.message });
    try {
      // Never kill a process found only by port: only the child started by this worker.
      if (newPid && isAlive(newPid)) {
        stop(newPid);
        for (let i = 0; i < 30 && isAlive(newPid); i++) await pause(500);
      }
      if (installed && fs.existsSync(backup)) {
        fs.rmSync(plan.root, { recursive: true, force: true });
        fs.cpSync(backup, plan.root, { recursive: true });
      }
      if (stopped && !isAlive(plan.pid)) {
        start(
          plan.node,
          [
            plan.launcher,
            plan.mode === 'relay' ? 'relay-supervisor' : 'start',
            ...(plan.mode === 'relay' ? ['start'] : []),
          ],
          { ...env, REMOTE_CODEX_NATIVE_BINARY: plan.executable },
          plan.cwd,
          path.join(plan.directory, 'rollback.log'),
        );
        await verify(plan.runningVersion);
      }
      status(stopped && !isAlive(plan.pid) ? 'rolled-back' : 'failed', {
        error: error.message,
      });
    } catch (rollback) {
      status('rollback-failed', {
        error: `${error.message}; ${rollback.message}`,
      });
    }
  } finally {
    fs.rmSync(plan.lock, { recursive: true, force: true });
    fs.rmSync(path.join(plan.directory, 'plan.json'), { force: true });
  }
}

export function launchWorker(
  plan,
  workerSource = fileURLToPath(import.meta.url),
) {
  const script = path.join(plan.directory, 'worker.mjs'),
    planFile = path.join(plan.directory, 'plan.json');
  fs.copyFileSync(workerSource, script);
  write(planFile, plan);
  const args = [plan.node, script, 'worker', planFile];
  if (process.platform === 'darwin') {
    const label = `com.remotecodex.update.${crypto.randomUUID()}`;
    const plist = path.join(plan.directory, 'job.plist');
    const log = path.join(plan.directory, 'update.log');
    fs.writeFileSync(
      plist,
      `<?xml version="1.0"?><plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array>${args.map((a) => `<string>${xml(a)}</string>`).join('')}</array><key>RunAtLoad</key><true/><key>AbandonProcessGroup</key><true/><key>StandardOutPath</key><string>${xml(log)}</string><key>StandardErrorPath</key><string>${xml(log)}</string></dict></plist>`,
      { mode: 0o600 },
    );
    const result = spawnSync(
      '/bin/launchctl',
      ['bootstrap', `gui/${process.getuid()}`, plist],
      { stdio: 'ignore' },
    );
    if (result.status !== 0)
      throw Error('Unable to launch independent update job in launchd');
  } else if (process.platform === 'linux') {
    const userManager = spawnSync('systemctl', ['--user', 'show-environment'], { stdio: 'ignore' });
    if (userManager.status === 0) {
      const result = spawnSync(
        'systemd-run',
        ['--user', '--collect', '--property=KillMode=process', '--', ...args],
        { stdio: 'ignore' },
      );
      if (result.status !== 0) throw Error('Unable to launch independent systemd update worker');
    } else {
      // Container machines often have no user D-Bus session. A new OS session
      // survives launcher/Supervisor termination without requiring sudo or a shell.
      const fd = fs.openSync(path.join(plan.directory, 'update.log'), 'a', 0o600);
      try {
        const result = spawnSync('setsid', ['--fork', ...args], { stdio: ['ignore', fd, fd] });
        if (result.status !== 0) throw Error('Unable to detach update worker with setsid');
      } finally { fs.closeSync(fd); }
    }
  } else if (process.platform === 'win32') {
    // WMI creates the worker outside the Supervisor/Device Manager job object.
    const line = args.map((a) => `"${a.replaceAll('"', '\\"')}"`).join(' ');
    const ps = `$r=Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{CommandLine='${line.replaceAll("'", "''")}'}; exit $r.ReturnValue`;
    if (
      spawnSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', ps],
        { stdio: 'ignore', windowsHide: true },
      ).status !== 0
    )
      throw Error('Unable to launch independent Windows update worker');
  } else
    throw Error(
      'Automatic supervisor updates are unavailable on this platform',
    );
}

export function readJob(statusFile, lock, now = Date.now(), isAlive = alive) {
  const job = read(statusFile);
  if (
    !job ||
    !['scheduled', 'preparing', 'installing', 'restarting'].includes(job.phase)
  )
    return job;
  const stale =
    job.phase === 'scheduled'
      ? now - job.updatedAt > 30_000
      : job.workerPid && !isAlive(job.workerPid);
  if (!stale) return job;
  const failed = {
    ...job,
    phase: 'failed',
    error:
      'The independent update worker stopped unexpectedly. Check the update log before retrying.',
    updatedAt: now,
  };
  write(statusFile, failed);
  fs.rmSync(lock, { recursive: true, force: true });
  return failed;
}

async function main(action) {
  if (action === 'worker') return worker(read(process.argv[3]));
  const runningVersion = process.env.REMOTE_CODEX_UPDATE_RUNNING_VERSION;
  const root = path.join(
    path.dirname(process.env.REMOTE_CODEX_UPDATE_DATABASE),
    'updates',
  );
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const statusFile = path.join(root, 'supervisor-update.json'),
    lock = path.join(root, 'supervisor-update.lock');
  let install;
  try {
    install = npmInstallation(
      process.env.REMOTE_CODEX_LAUNCHER_PATH,
      process.env.REMOTE_CODEX_LAUNCHER_NODE,
    );
  } catch (error) {
    return { runningVersion, canUpdate: false, reason: error.message };
  }
  const base = {
    runningVersion,
    installedVersion: install.installedVersion,
    canUpdate: true,
    path: install.launcher,
    manager: 'npm',
    job: readJob(statusFile, lock),
  };
  if (action === 'status') return base;
  const version = await latest();
  if (action === 'check') return { ...base, latestVersion: version };
  if (action !== 'launch') throw Error('Unknown update action');
  if (version === runningVersion) return { ...base, latestVersion: version };
  fs.mkdirSync(lock, { mode: 0o700 }); // atomic cross-request lock
  try {
    const directory = fs.mkdtempSync(path.join(root, 'supervisor-'));
    const plan = {
      ...install,
      directory,
      statusFile,
      lock,
      version,
      runningVersion,
      env: process.env,
      cwd: process.cwd(),
      pid: Number(process.env.REMOTE_CODEX_UPDATE_PID),
      executable: process.env.REMOTE_CODEX_UPDATE_EXECUTABLE,
      mode: process.env.REMOTE_CODEX_UPDATE_MODE,
      port: Number(process.env.REMOTE_CODEX_UPDATE_PORT),
      host: process.env.REMOTE_CODEX_UPDATE_HOST,
    };
    write(statusFile, {
      phase: 'scheduled',
      targetVersion: version,
      updatedAt: Date.now(),
    });
    launchWorker(plan);
    return { ...base, latestVersion: version, job: readJob(statusFile, lock) };
  } catch (error) {
    fs.rmSync(lock, { recursive: true, force: true });
    throw error;
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const result = await main(process.argv[2]);
    if (result) console.log(JSON.stringify(result));
  } catch (error) {
    console.log(JSON.stringify({ canUpdate: false, reason: error.message }));
  }
}
