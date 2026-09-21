import test from 'node:test';
import assert from 'node:assert/strict';
import { serviceDefinition } from '../npm/remote-codex/bin/setup.mjs';
import { managedService } from '../npm/remote-codex/bin/supervisor-update.mjs';
import fs from 'node:fs';
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
});
