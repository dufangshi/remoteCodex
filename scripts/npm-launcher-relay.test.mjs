import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const launcher = fileURLToPath(
  new URL('../npm/remote-codex/bin/remote-codex.mjs', import.meta.url),
);
const tmux = spawnSync('which', ['tmux'], { encoding: 'utf8' }).stdout?.trim();
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;

test('relay start overrides stale tmux server configuration', {
  skip: process.platform === 'win32' || !tmux,
}, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-tmux-test-'));
  const socket = path.join(root, 'socket');
  const config = path.join(root, 'config.json');
  const output = path.join(root, 'environment.json');
  const native = path.join(root, 'native');
  const log = path.join(root, 'relay.log');
  const stale = {
    ...process.env,
    REMOTE_CODEX_RELAY_SERVER_URL: 'wss://old.example.com',
    REMOTE_CODEX_RELAY_AGENT_TOKEN: 'old-token',
    REMOTE_CODEX_RELAY_SUPERVISOR_PORT: '11111',
  };
  const expected = {
    url: 'wss://new.example.com',
    token: "new-token-with-'-$-and spaces",
    port: '45679',
  };
  const environment = {
    ...process.env,
    PATH: `${root}:${process.env.PATH}`,
    REMOTE_CODEX_RELAY_SERVER_URL: expected.url,
    REMOTE_CODEX_RELAY_AGENT_TOKEN: expected.token,
    REMOTE_CODEX_RELAY_SUPERVISOR_PORT: expected.port,
    REMOTE_CODEX_RELAY_SUPERVISOR_CONFIG: config,
    REMOTE_CODEX_RELAY_SUPERVISOR_LOG: log,
    REMOTE_CODEX_RELAY_SUPERVISOR_TMUX_SESSION: 'relay-test',
    REMOTE_CODEX_RELAY_SUPERVISOR_TMUX: 'true',
    REMOTE_CODEX_NATIVE_BINARY: native,
    DATABASE_URL: path.join(root, 'unused.sqlite'),
  };
  try {
    fs.writeFileSync(path.join(root, 'tmux'),
      `#!/bin/sh\nexec ${quote(tmux)} -S ${quote(socket)} "$@"\n`,
      { mode: 0o700 });
    fs.writeFileSync(native, `#!${process.execPath}
const fs = require('node:fs');
fs.writeFileSync(${JSON.stringify(output)}, JSON.stringify({
  url: process.env.REMOTE_CODEX_RELAY_SERVER_URL,
  token: process.env.REMOTE_CODEX_RELAY_AGENT_TOKEN,
  port: process.env.REMOTE_CODEX_RELAY_SUPERVISOR_PORT,
}));
setInterval(() => {}, 1000);
`, { mode: 0o700 });
    const server = spawnSync(tmux, [
      '-S', socket, '-f', '/dev/null', 'new-session', '-d', '-s', 'keeper', 'sleep 60',
    ], { env: stale, encoding: 'utf8' });
    assert.equal(server.status, 0, server.stderr);
    const result = spawnSync(process.execPath, [launcher, 'relay-supervisor'], {
      env: environment, cwd: root, encoding: 'utf8', timeout: 15000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(fs.readFileSync(output, 'utf8')), expected);
    const saved = JSON.parse(fs.readFileSync(config, 'utf8'));
    assert.equal(saved.REMOTE_CODEX_RELAY_SERVER_URL, expected.url);
    assert.equal(saved.REMOTE_CODEX_RELAY_AGENT_TOKEN, expected.token);
    assert.equal(saved.REMOTE_CODEX_RELAY_SUPERVISOR_PORT, expected.port);
    const global = spawnSync(tmux, [
      '-S', socket, 'show-environment', '-g', 'REMOTE_CODEX_RELAY_SERVER_URL',
    ], { encoding: 'utf8' });
    assert.equal(global.stdout.trim(), 'REMOTE_CODEX_RELAY_SERVER_URL=wss://old.example.com');
  } finally {
    spawnSync(tmux, ['-S', socket, 'kill-server']);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
