import test from 'node:test';
import assert from 'node:assert/strict';
import { serviceDefinition, setup, matchesDeviceConfig, ensureExistingDeviceOnline } from '../npm/remote-codex/bin/setup.mjs';
import { managedService } from '../npm/remote-codex/bin/supervisor-update.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
test('service definitions preserve literal paths and keep credentials out of service files', () => {
  const opts = {
    node: '/Node Folder/node',
    launcher: '/User $Name/a"b/launcher.mjs',
    home: '/User $Name',
    config: '/User $Name/config.json',
    log: '/User $Name/log',
    searchPath: '/Node Folder:/usr/bin',
  };
  const linux = serviceDefinition('linux', opts);
  assert(linux.includes('ExecStart="/Node Folder/node"'));
  assert(!linux.includes('API_KEY'));
  assert(linux.includes('Restart=always'));
  assert(linux.includes('/User $$Name/a'));
  assert(linux.includes('WorkingDirectory=%h\n'));
  const mac = serviceDefinition('darwin', opts);
  assert(mac.includes('a&quot;b'));
  assert(mac.includes('<key>KeepAlive</key><true/>'));
  const calls = [];
  const command = (...args) => {
    calls.push(args);
    return { status: 0 };
  };
  assert.equal(managedService({}, 'stop', command), false);
  assert.equal(
    managedService(
      { REMOTE_CODEX_MANAGED_SERVICE: 'systemd-user' },
      'stop',
      command,
    ),
    true,
  );
  assert.deepEqual(calls[0].slice(0, 2), [
    'systemctl',
    ['--user', 'stop', 'remote-codex-supervisor.service'],
  ]);
  assert.throws(() =>
    managedService(
      { REMOTE_CODEX_MANAGED_SERVICE: 'invalid' },
      'start',
      command,
    ),
  );
});

test('systemd fields use their own escaping rules rather than shell quoting', () => {
  const linux = serviceDefinition('linux', {
    node: '/usr/bin/node', launcher: '/home/a $USER %h/launcher.mjs',
    home: '/home/a "quoted" \\ %h $USER',
    config: '/home/a "quoted" \\ %h $USER/config.json',
    searchPath: '/bin:/path\nRestart=no\r\t', log: '/unused',
  });
  assert.match(linux, /^WorkingDirectory=%h$/m);
  assert.match(linux, /"\/home\/a \$\$USER %%h\/launcher.mjs"/);
  assert(linux.includes('Environment="REMOTE_CODEX_RELAY_SUPERVISOR_CONFIG=/home/a \\"quoted\\" \\\\ %%h $USER/config.json"'));
  assert(linux.includes('Environment="PATH=/bin:/path\\nRestart=no\\r\\t"'));
  assert.equal(linux.split('\n').filter(line => line.startsWith('Restart=')).length, 1);
});

// Run explicitly in Linux with systemd installed; never touch a host service.
test('real systemd accepts generated units and rejects the old quoted working directory', {
  skip: process.env.REMOTE_CODEX_TEST_SYSTEMD !== '1',
}, (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-systemd-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const unit = path.join(root, 'remote-codex-fixture.service');
  const definition = serviceDefinition('linux', {
    node: process.execPath, launcher: '/home/ubuntu/a "b" %h $USER/launcher.mjs',
    home: '/home/ubuntu', config: '/home/ubuntu/a "b" %h $USER/config.json',
    log: '/unused', searchPath: '/usr/bin:/bin',
  });
  const verify = () => spawnSync('systemd-analyze', ['verify', '--man=no', unit], { encoding: 'utf8', env: { ...process.env, SYSTEMD_UNIT_PATH: `${root}:/usr/lib/systemd/system:/lib/systemd/system` } });
  fs.writeFileSync(unit, definition.replace('WorkingDirectory=%h', 'WorkingDirectory="/home/ubuntu"'));
  const broken = verify();
  assert.notEqual(broken.status, 0);
  assert.match(broken.stderr, /WorkingDirectory=.*not absolute/);
  // Re-running setup writes the complete corrected unit before daemon-reload.
  for (let i = 0; i < 2; i++) {
    fs.writeFileSync(unit, definition);
    const fixed = verify();
    assert.equal(fixed.status, 0, fixed.stderr || String(fixed.error));
    assert.equal(fixed.stderr, '');
  }
});

test('legacy setup uses matching connection settings, preserving different device configurations', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-resume-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const server = http.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  const config = path.join(root, 'config.json');
  const saved = { REMOTE_CODEX_RELAY_SERVER_URL: 'wss://relay.example.test', REMOTE_CODEX_RELAY_AGENT_TOKEN: 'rcd_fixture', REMOTE_CODEX_RELAY_SUPERVISOR_PORT: String(port), REMOTE_CODEX_DATABASE_PATH: '/existing/history.sqlite', unrelated: 'preserve' };
  const original = JSON.stringify(saved);
  fs.writeFileSync(config, original);
  assert(matchesDeviceConfig(saved, 'https://relay.example.test/', 'rcd_fixture', port));
  assert(!matchesDeviceConfig(saved, 'https://other.example.test', 'rcd_fixture', port));
  assert(!matchesDeviceConfig(saved, 'https://relay.example.test', 'different', port));
  assert(!matchesDeviceConfig(saved, 'https://relay.example.test', 'rcd_fixture', port + 1));
  const run = token => setup({
    args: ['--relay', 'https://relay.example.test', '--token', token, '--port', String(port)],
    launcher: fileURLToPath(new URL('../npm/remote-codex/bin/remote-codex.mjs', import.meta.url)), config,
    ensureConfig: () => assert.fail('Preflight must complete before saving configuration'),
    nativePath: () => { throw Error('native-preflight-reached'); },
  });
  await assert.rejects(run('rcd_fixture'), /native-preflight-reached/);
  await assert.rejects(run('different'), /already has a device configuration/);
  assert.equal(fs.readFileSync(config, 'utf8'), original);
  assert(!fs.existsSync(config + '.setup.json'));
});

test('an existing service updates through management and verifies its actual running version', async (t) => {
  let version = '0.0.1', updates = 0, logins = 0;
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/auth/login') {
      assert.deepEqual(JSON.parse(Buffer.concat(chunks)), { username: 'admin', password: 'synthetic' });
      logins++; res.end(JSON.stringify({ token: 'test-session' }));
    } else if (req.url === '/healthz') {
      res.end(JSON.stringify({ status: 'ok', relayConnected: true }));
    } else {
      assert.equal(req.headers.authorization, 'Bearer test-session');
      if (req.url === '/api/management/supervisor/update') {
        assert.equal(req.method, 'POST'); updates++; version = '9.9.9';
      }
      res.end(JSON.stringify({ runningVersion: version, canUpdate: true }));
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const saved = { REMOTE_CODEX_ADMIN_USERNAME: 'admin', REMOTE_CODEX_ADMIN_PASSWORD: 'synthetic' };
  await ensureExistingDeviceOnline(server.address().port, saved, '9.9.9');
  await ensureExistingDeviceOnline(server.address().port, saved, '9.9.9');
  assert.equal(updates, 1);
  assert(logins >= 3);
});
