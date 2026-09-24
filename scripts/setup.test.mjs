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
  assert(linux.includes('WorkingDirectory="/User $Name"'));
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

test('public setup script installs the latest runtime with a permanent token', () => {
  const script = fs.readFileSync(new URL('./setup.sh', import.meta.url), 'utf8');
  assert.match(script, /remote-codex@latest/);
  assert.match(script, /--token/);
  assert.doesNotMatch(script, /__REMOTE_CODEX_VERSION__/);
  assert.match(script, /--registry=https:\/\/registry.npmjs.org/);
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

test('bootstrap resolves official latest on each run, skips reinstall and upgrades a stale copy', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrap-latest-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, 'bin'); fs.mkdirSync(bin);
  fs.symlinkSync(process.execPath, path.join(bin, 'node'));
  const log = path.join(root, 'npm-calls.jsonl');
  const mock = `#!${process.execPath}
const fs=require('fs'),path=require('path');
const args=process.argv.slice(2);fs.appendFileSync(process.env.TEST_NPM_LOG,JSON.stringify(args)+'\\n');
if(args[0]==='view'){console.log(JSON.stringify(process.env.TEST_LATEST));process.exit(0);}
if(args[0]!=='install')process.exit(1);
const pkg=path.join(args[args.indexOf('--prefix')+1],'lib/node_modules/remote-codex');fs.mkdirSync(path.join(pkg,'bin'),{recursive:true});
fs.writeFileSync(path.join(pkg,'package.json'),JSON.stringify({version:args.find(a=>a.startsWith('remote-codex@')).slice(13)}));
fs.writeFileSync(path.join(pkg,'bin/remote-codex.mjs'),"console.log('setup-arguments '+JSON.stringify(process.argv.slice(2))); ");
`;
  fs.writeFileSync(path.join(bin, 'npm'), mock, { mode: 0o755 });
  const run = version => {
    const result = spawnSync('/bin/sh', [fileURLToPath(new URL('./setup.sh', import.meta.url)), '--relay', 'https://relay.example.test', '--token', 'rcd_synthetic', '--port', '45679'], {
      encoding: 'utf8', env: { ...process.env, HOME: root, PATH: `${bin}:/usr/bin:/bin`, TEST_NPM_LOG: log, TEST_LATEST: version, npm_config_registry: 'https://stale-mirror.invalid' },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /setup-arguments.*--token.*rcd_synthetic/, result.stderr);
    return result.stdout;
  };
  run('9.1.0');
  assert.match(run('9.1.0'), /already installed/);
  run('9.2.0');
  const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(calls.filter(c => c[0] === 'view').length, 3);
  assert.equal(calls.filter(c => c[0] === 'install').length, 2);
  assert(calls.every(c => c.includes('--registry=https://registry.npmjs.org')));
  assert(calls.at(-1).includes('remote-codex@9.2.0'));
});
