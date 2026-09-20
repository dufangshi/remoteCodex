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
    if (!['--relay', '--code', '--port'].includes(args[i]) || !args[i + 1])
      throw Error('Usage: setup --relay URL --code CODE [--port PORT]');
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
  if (!options['--code']) throw Error('A setup code is required');
  const receiptPath = `${config}.setup.json`;
  const digest = (value) => createHash('sha256').update(value).digest('hex');
  const identity = digest(
    JSON.stringify([url.origin, port, options['--code']]),
  );
  let resume = false;
  try {
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    resume =
      receipt.identity === identity &&
      receipt.configHash === digest(fs.readFileSync(config));
  } catch {}
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
    const h = await (
      await fetch(`http://127.0.0.1:${port}/healthz`, {
        signal: AbortSignal.timeout(3000),
      })
    ).json();
    if (h.relayConnected === true) {
      console.log('This device is already online.');
      return;
    }
    throw Error(
      'The selected port is already in use. Choose another port or manage the existing device from Settings.',
    );
  }
  if (fs.existsSync(config) && !resume)
    throw Error(
      'This user already has a device configuration. Manage it from Settings; setup will not overwrite it.',
    );
  await nativePath(); // Fetch and checksum the runtime before consuming the code.
  if (!resume) {
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
        console.log(
          'Device is online. Open its Settings on the relay to install harnesses and configure upstreams.',
        );
        return;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw Error(
    `Setup was saved, but relay connection could not be verified. Logs: ${log}`,
  );
}
