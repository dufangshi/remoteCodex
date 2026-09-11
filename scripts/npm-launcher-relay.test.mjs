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

function isolatedLauncher(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-config-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const native = path.join(root, 'native');
  fs.writeFileSync(native, `#!${process.execPath}\nconsole.log(JSON.stringify({ database: process.env.REMOTE_CODEX_DATABASE_PATH, generic: process.env.DATABASE_URL, rustLog: process.env.RUST_LOG, logLevel: process.env.LOG_LEVEL, host: process.env.REMOTE_CODEX_RELAY_SUPERVISOR_HOST, fake: process.env.REMOTE_CODEX_E2E_FAKE_RUNTIME, args: process.argv.slice(2) }));\n`, { mode: 0o700 });
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

test('native subcommand help preserves every dispatch argument', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'native-help-'));
  try {
    for (const command of ['thread','transcript','inbox']) {
      // Node is a portable fake native executable; its input script has the
      // command's name, so arguments after the command remain observable.
      fs.writeFileSync(path.join(root,command),'process.stdout.write(JSON.stringify(process.argv.slice(2)))');
      const args=command==='thread'?['send','--help']:command==='inbox'?['read','--help']:['--help'];
      const result=spawnSync(process.execPath,[launcher,command,...args],{
        cwd:root,encoding:'utf8',env:{...process.env,REMOTE_CODEX_NATIVE_BINARY:process.execPath,REMOTE_CODEX_SERVICE_DIR:path.join(root,'service')},
      });
      assert.equal(result.status,0,result.stderr);
      assert.deepEqual(JSON.parse(result.stdout),args);
    }
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
