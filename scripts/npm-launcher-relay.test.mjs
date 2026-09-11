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
}, async () => {
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
    REMOTE_CODEX_DATABASE_PATH: '/stale/database.sqlite',
    REMOTE_CODEX_E2E_FAKE_RUNTIME: '1',
    DATABASE_URL: 'postgres://stale:private@db/app',
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
  genericDatabase: process.env.DATABASE_URL,
  fake: process.env.REMOTE_CODEX_E2E_FAKE_RUNTIME,
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
    // Detached tmux startup can outlive the launcher's acknowledgement.
    for (let attempt = 0; attempt < 100 && !fs.existsSync(output); attempt++) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(fs.existsSync(output), 'The isolated tmux fixture did not start');
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

function isolatedLauncher(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-config-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const native = path.join(root, 'native');
  fs.writeFileSync(native, `#!${process.execPath}\nconsole.log(JSON.stringify({ database: process.env.REMOTE_CODEX_DATABASE_PATH, generic: process.env.DATABASE_URL, host: process.env.REMOTE_CODEX_RELAY_SUPERVISOR_HOST, fake: process.env.REMOTE_CODEX_E2E_FAKE_RUNTIME, args: process.argv.slice(2) }));\n`, { mode: 0o700 });
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('REMOTE_CODEX_') && !['DATABASE_URL', 'WORKSPACE_ROOT'].includes(key)));
  Object.assign(env, {
    HOME: root,
    USERPROFILE: root,
    REMOTE_CODEX_NATIVE_BINARY: native,
    REMOTE_CODEX_RELAY_SUPERVISOR_CONFIG: path.join(root, 'relay.json'),
    REMOTE_CODEX_RELAY_SERVER_URL: 'wss://fixture.invalid',
    REMOTE_CODEX_RELAY_AGENT_TOKEN: 'fixture-token',
  });
  const run = (args, cwd = root, extra = {}) => spawnSync(process.execPath, [launcher, ...args], { cwd, env: { ...env, ...extra }, encoding: 'utf8' });
  return { root, env, run };
}

test('relay accepts only connection settings and keeps its database across cwd changes', t => {
  const { root, env, run } = isolatedLauncher(t);
  fs.writeFileSync(path.join(root, '.env'), 'DATABASE_URL=postgres://user:private@db/workspace\nREMOTE_CODEX_RELAY_AGENT_TOKEN=wrong-device\n');
  const database = path.join(root, 'original.sqlite');
  fs.writeFileSync(env.REMOTE_CODEX_RELAY_SUPERVISOR_CONFIG, JSON.stringify({ DATABASE_URL: database }));
  const hostile = { DATABASE_URL: 'postgres://user:private@db/app', PORT: '1', HOST: '0.0.0.0', WORKSPACE_ROOT: '/wrong', ACP_COMMAND: 'wrong', REMOTE_CODEX_DATABASE_PATH: '/wrong.sqlite', REMOTE_CODEX_RELAY_SUPERVISOR_HOST: '0.0.0.0', REMOTE_CODEX_E2E_FAKE_RUNTIME: '1' };
  let result = run(['relay-supervisor', 'run'], root, hostile);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { database, host: '127.0.0.1', args: ['relay-supervisor'] });
  const saved = JSON.parse(fs.readFileSync(env.REMOTE_CODEX_RELAY_SUPERVISOR_CONFIG));
  assert.equal(saved.REMOTE_CODEX_RELAY_AGENT_TOKEN, 'fixture-token');
  assert.equal(saved.REMOTE_CODEX_DATABASE_PATH, database);
  assert.ok(Object.keys(saved).every(key => key.startsWith('REMOTE_CODEX_')));
  assert.equal(saved.DATABASE_URL, undefined);
  const other = path.join(root, 'other'); fs.mkdirSync(other);
  for (const args of [['relay-supervisor', 'run'], ['relay-fingerprint']]) {
    result = run(args, other, hostile);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).database, database);
  }
});

test('relay refuses ambiguous saved paths and recovers a poisoned URI only with original database and identity', t => {
  const { root, env, run } = isolatedLauncher(t);
  for (const value of ['data/relative.sqlite', 'postgres://user:private@db/app']) {
    const saved = JSON.stringify({ DATABASE_URL: value });
    fs.writeFileSync(env.REMOTE_CODEX_RELAY_SUPERVISOR_CONFIG, saved);
    const result = run(['relay-supervisor', 'run']);
    assert.equal(result.status, 1);
    assert.doesNotMatch(result.stderr, /private/);
    assert.equal(fs.readFileSync(env.REMOTE_CODEX_RELAY_SUPERVISOR_CONFIG, 'utf8'), saved);
  }
  const directory = path.join(root, '.remote-codex'); fs.mkdirSync(directory);
  const database = path.join(directory, 'relay-supervisor.sqlite');
  fs.writeFileSync(database, 'preserved');
  assert.equal(run(['relay-supervisor', 'run']).status, 1);
  fs.writeFileSync(path.join(directory, 'relay-supervisor.transport-identity'), 'preserved identity');
  const result = run(['relay-supervisor', 'run']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).database, database);
  assert.equal(fs.readFileSync(database, 'utf8'), 'preserved');
  assert.equal(JSON.parse(fs.readFileSync(env.REMOTE_CODEX_RELAY_SUPERVISOR_CONFIG)).DATABASE_URL, undefined);
});

test('relay rejects invalid ports before saving configuration', t => {
  const { root, env, run } = isolatedLauncher(t);
  for (const port of ['0', '65536', '8787x']) {
    assert.equal(run(['relay-supervisor', 'run'], root, { REMOTE_CODEX_RELAY_SUPERVISOR_PORT: port }).status, 1);
    assert.equal(fs.existsSync(env.REMOTE_CODEX_RELAY_SUPERVISOR_CONFIG), false);
  }
});
