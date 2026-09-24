import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';

const xml = (s) =>
  String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
const quote = (s) =>
  `"${String(s).replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('%', '%%')}"`;
export function matchesDeviceConfig(saved, relay, token, port) {
  try {
    const stored = new URL(saved.REMOTE_CODEX_RELAY_SERVER_URL);
    stored.protocol = stored.protocol.replace(/^ws/, 'http');
    return stored.href === new URL(relay).href &&
      saved.REMOTE_CODEX_RELAY_AGENT_TOKEN === token &&
      Number(saved.REMOTE_CODEX_RELAY_SUPERVISOR_PORT ?? 8787) === port;
  } catch {
    return false;
  }
}

async function deviceApi(port, saved, route, method = 'GET') {
  const base = `http://127.0.0.1:${port}`;
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: saved.REMOTE_CODEX_ADMIN_USERNAME, password: saved.REMOTE_CODEX_ADMIN_PASSWORD }),
    redirect: 'error', signal: AbortSignal.timeout(10000),
  });
  if (!login.ok) throw Error('Unable to authenticate the existing device using its saved configuration.');
  const auth = await login.json();
  const result = await fetch(`${base}${route}`, {
    method, headers: auth.token ? { Authorization: `Bearer ${auth.token}` } : {},
    redirect: 'error', signal: AbortSignal.timeout(25000),
  });
  if (!result.ok) throw Error(`Device management request failed (HTTP ${result.status}).`);
  return result.json();
}

export async function ensureExistingDeviceOnline(port, saved, targetVersion) {
  const status = await deviceApi(port, saved, '/api/management/supervisor');
  if (status.runningVersion !== targetVersion) {
    if (!status.canUpdate) throw Error('The existing Supervisor cannot update itself. Update it from its original installation.');
    console.log(`Updating the running Supervisor to ${targetVersion}…`);
    const update = await deviceApi(port, saved, '/api/management/supervisor/update', 'POST');
    if (update.job?.phase === 'failed') throw Error('The Supervisor updater failed. Check the device update log.');
  }
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    try {
      const health = await (await fetch(`http://127.0.0.1:${port}/healthz`, {
        redirect: 'error', signal: AbortSignal.timeout(3000),
      })).json();
      if (health.status === 'ok' && health.relayConnected === true) {
        const running = await deviceApi(port, saved, '/api/management/supervisor');
        if (running.runningVersion === targetVersion) {
          console.log(`Device is online and running Remote Codex ${targetVersion}.`);
          return;
        }
        if (['failed', 'rolled-back', 'rollback-failed'].includes(running.job?.phase))
          throw Error('The Supervisor update did not complete. Check the device update log.');
      }
    } catch (error) {
      if (error.message.startsWith('The Supervisor update')) throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw Error('The device did not come online at the requested version. Check the relay URL, token, network and device update log.');
}
export function serviceDefinition(
  platform,
  { node, launcher, home, config, log, searchPath },
) {
  if (platform === 'darwin')
    return `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>
<key>Label</key><string>com.remote-codex.supervisor</string><key>ProgramArguments</key><array>${[node, launcher, 'relay-supervisor', 'run'].map((v) => `<string>${xml(v)}</string>`).join('')}</array>
<key>WorkingDirectory</key><string>${xml(home)}</string><key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(searchPath)}</string><key>REMOTE_CODEX_RELAY_SUPERVISOR_CONFIG</key><string>${xml(config)}</string><key>REMOTE_CODEX_MANAGED_SERVICE</key><string>launchd</string></dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer><key>StandardOutPath</key><string>${xml(log)}</string><key>StandardErrorPath</key><string>${xml(log)}</string></dict></plist>\n`;
  return `[Unit]\nDescription=Remote Codex Supervisor\nAfter=network-online.target\n[Service]\nType=simple\nExecStart=${[node, launcher, 'relay-supervisor', 'run'].map((v) => quote(v).replaceAll('$', () => '$$')).join(' ')}\nWorkingDirectory=${quote(home)}\nEnvironment=${quote(`PATH=${searchPath}`)}\nEnvironment=${quote(`REMOTE_CODEX_RELAY_SUPERVISOR_CONFIG=${config}`)}\nEnvironment=REMOTE_CODEX_MANAGED_SERVICE=systemd-user\nRestart=always\nRestartSec=5\n[Install]\nWantedBy=default.target\n`;
}
export async function setup({
  args,
  launcher,
  config,
  ensureConfig,
  nativePath,
}) {
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--relay', '--token', '--code', '--port'].includes(args[i]) || !args[i + 1])
      throw Error('Usage: setup --relay URL --token TOKEN [--port PORT]');
    options[args[i]] = args[i + 1];
  }
  const url = new URL(options['--relay']);
  if (
    url.protocol !== 'https:' &&
    !(
      url.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    )
  )
    throw Error('Relay must use HTTPS');
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw Error('Use the relay origin without a path');
  const port = Number(options['--port'] ?? 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw Error('Invalid port');
  const credential = options['--token'] ?? options['--code'];
  if (!credential) throw Error('A permanent device token is required');
  if (options['--token'] && options['--code'])
    throw Error('Choose either a device token or a setup code.');
  const receiptPath = `${config}.setup.json`;
  const targetVersion = JSON.parse(fs.readFileSync(path.resolve(path.dirname(launcher), '../package.json'), 'utf8')).version;
  const digest = (value) => createHash('sha256').update(value).digest('hex');
  const identity = digest(
    JSON.stringify([url.origin, port, options['--token'] ? 'token' : 'code', credential]),
  );
  let resume = false;
  let saved;
  let configBytes;
  try {
    configBytes = fs.readFileSync(config);
    saved = JSON.parse(configBytes);
  } catch (error) {
    if (error.code !== 'ENOENT')
      throw Error('The existing device configuration cannot be read. Repair it before running setup.');
  }
  try {
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    resume =
      receipt.identity === identity &&
      receipt.configHash === digest(configBytes);
    // Before permanent-token setup, code receipts did not include a kind field.
    if (!resume && options['--code'])
      resume = receipt.identity === digest(JSON.stringify([url.origin, port, credential])) &&
        receipt.configHash === digest(configBytes);
  } catch {}
  // Legacy/manual installations have no receipt. Identify them by the actual
  // connection settings; never replace a different device or its database.
  if (options['--token'])
    resume = matchesDeviceConfig(saved, url.origin, options['--token'], port);
  // Do not overwrite a working device or commandeer an unrelated listening port.
  const occupied = await new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(true));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(false)));
  });
  if (occupied) {
    if (!resume)
      throw Error(
        'The selected port is already in use. Manage the existing device from Settings.',
      );
    await ensureExistingDeviceOnline(port, saved, targetVersion);
    return;
  }
  if (fs.existsSync(config) && !resume)
    throw Error(
      'This user already has a device configuration. Manage it from Settings; setup will not overwrite it.',
    );
  await nativePath(); // Fetch and checksum the runtime before consuming the code.
  if (options['--token']) {
    process.env.REMOTE_CODEX_RELAY_SERVER_URL = url.origin.replace(/^http/, 'ws');
    process.env.REMOTE_CODEX_RELAY_AGENT_TOKEN = options['--token'];
    process.env.REMOTE_CODEX_RELAY_SUPERVISOR_PORT = String(port);
  } else if (resume) {
    for (const name of ['REMOTE_CODEX_RELAY_SERVER_URL', 'REMOTE_CODEX_RELAY_AGENT_TOKEN', 'REMOTE_CODEX_RELAY_SUPERVISOR_PORT'])
      process.env[name] = saved[name];
  } else {
    const response = await fetch(new URL('/relay/setup/redeem', url), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: options['--code'] }),
      redirect: 'error',
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok)
      throw Error(
        `Setup code could not be redeemed (HTTP ${response.status}). It may have expired or already been used. Copy a new command.`,
      );
    const enrollment = await response.json();
    if (typeof enrollment.token !== 'string' || !enrollment.token)
      throw Error('Invalid enrollment response');
    process.env.REMOTE_CODEX_RELAY_SERVER_URL = url.origin.replace(
      /^http/,
      'ws',
    );
    process.env.REMOTE_CODEX_RELAY_AGENT_TOKEN = enrollment.token;
    process.env.REMOTE_CODEX_RELAY_SUPERVISOR_PORT = String(port);
  }
  const environment = await ensureConfig();
  fs.writeFileSync(
    receiptPath,
    JSON.stringify({ identity, configHash: digest(fs.readFileSync(config)) }),
    { mode: 0o600 },
  );
  const home = os.homedir();
  const log = path.join(home, '.remote-codex/logs/relay-supervisor.log');
  fs.mkdirSync(path.dirname(log), { recursive: true, mode: 0o700 });
  const settings = {
    node: process.execPath,
    launcher,
    home,
    config,
    log,
    searchPath: process.env.PATH ?? '/usr/bin:/bin',
  };
  const run = (cmd, args) => {
    const result = spawnSync(cmd, args, { stdio: 'pipe' });
    if (result.status !== 0)
      throw Error(
        `Unable to start background service (${cmd}). Credentials have been saved; rerun setup to retry.`,
      );
  };
  if (process.platform === 'darwin') {
    const file = path.join(
      home,
      'Library/LaunchAgents/com.remote-codex.supervisor.plist',
    );
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, serviceDefinition('darwin', settings), {
      mode: 0o600,
    });
    const domain = `gui/${process.getuid()}`;
    spawnSync(
      '/bin/launchctl',
      ['bootout', `${domain}/com.remote-codex.supervisor`],
      { stdio: 'ignore' },
    );
    run('/bin/launchctl', ['bootstrap', domain, file]);
  } else if (
    spawnSync('systemctl', ['--user', 'show-environment'], { stdio: 'ignore' })
      .status === 0
  ) {
    const file = path.join(
      home,
      '.config/systemd/user/remote-codex-supervisor.service',
    );
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, serviceDefinition('linux', settings), {
      mode: 0o600,
    });
    run('systemctl', ['--user', 'daemon-reload']);
    run('systemctl', [
      '--user',
      'enable',
      '--now',
      'remote-codex-supervisor.service',
    ]);
  } else {
    const fd = fs.openSync(log, 'a', 0o600);
    const child = spawn(
      process.execPath,
      [launcher, 'relay-supervisor', 'run'],
      {
        cwd: home,
        env: environment,
        detached: true,
        stdio: ['ignore', fd, fd],
      },
    );
    child.unref();
    fs.closeSync(fd);
    console.log(
      'No user service manager is available. Running detached; automatic startup after reboot is unavailable on this system.',
    );
  }
  for (let i = 0; i < 60; i++) {
    try {
      const h = await (
        await fetch(`http://127.0.0.1:${port}/healthz`, {
          signal: AbortSignal.timeout(1500),
        })
      ).json();
      if (h.status === 'ok' && h.relayConnected === true) {
        await ensureExistingDeviceOnline(port, JSON.parse(fs.readFileSync(config)), targetVersion);
        return;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw Error(
    `Setup was saved, but relay connection could not be verified. Logs: ${log}`,
  );
}
