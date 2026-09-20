import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  worker,
  readJob,
  needsUpdate,
  captureRelaySession,
  retireRelaySession,
} from '../npm/remote-codex/bin/supervisor-update.mjs';

test('tmux handover captures native ancestry and retires only the original single-pane session', () => {
  const plan = { mode: 'relay', pid: 103, env: { TMUX: '/tmp/test socket,10,0', TMUX_PANE: '%4' } };
  const calls = [];
  let pane = '%4\t101\n';
  const command = (program, args) => {
    calls.push([program, ...args]);
    if (program === 'ps') return { status: 0, stdout: args[1] === '103' ? '102\n' : '101\n' };
    assert.deepEqual(args.slice(0, 2), ['-S', '/tmp/test socket']);
    if (args[2] === 'display-message') return { status: 0, stdout: '$2\tremote-codex-relay-supervisor\t%4\t101\n' };
    if (args[2] === 'list-panes') return { status: 0, stdout: args.at(-1).includes('pane_pid') ? pane : '%4\n' };
    return { status: 0, stdout: '' };
  };
  const owner = captureRelaySession(plan, command);
  retireRelaySession(owner, plan.env, command);
  assert.deepEqual(calls.at(-1), ['tmux', '-S', '/tmp/test socket', 'kill-session', '-t', '$2']);
  const before = calls.filter(c => c.includes('kill-session')).length;
  for (const changed of ['%4\t101\n%5\t104\n', '%4\t999\n']) {
    pane = changed;
    assert.throws(() => retireRelaySession(owner, plan.env, command), /changed during update/);
  }
  assert.equal(calls.filter(c => c.includes('kill-session')).length, before);
  assert.equal(captureRelaySession({ ...plan, env: {} }, command), null);
  assert.throws(() => captureRelaySession(plan, (program, args) => program === 'ps' ? { status: 0, stdout: '1' } : command(program, args)), /does not own/);
  assert.throws(() => captureRelaySession(plan, (program, args) => args.includes('list-panes') ? { status: 0, stdout: '%4\n%5\n' } : command(program, args)), /other panes/);
  retireRelaySession(owner, plan.env, () => ({ status: 1 }));
});

test('worker releases a lingering tmux pipeline after native exit and before launching the replacement', async () => {
  const plan = fixture();
  plan.action = 'restart'; plan.mode = 'relay'; plan.version = plan.runningVersion;
  plan.env.TMUX = '/tmp/fixture,1,0'; plan.env.TMUX_PANE = '%1';
  let stopped = false, retired = false, started = false;
  try {
    await worker(plan, {
      captureRelaySession: () => { assert.equal(stopped, false); return { session: '$1' }; },
      retireRelaySession: owner => { assert.equal(stopped, true); assert.equal(owner.session, '$1'); retired = true; },
      sleep: async () => {}, alive: () => !stopped,
      health: async () => started ? { status: 'ok', processId: 987, runningVersion: plan.version, relayConnected: true } : { processId: plan.pid, activeTurnCount: 0 },
      run: async () => plan.version,
      stop: () => { stopped = true; },
      start: (_exe, args, env) => {
        assert.equal(retired, true);
        assert.deepEqual(args, [plan.launcher, 'relay-supervisor', 'start']);
        assert.equal(env.TMUX, undefined); assert.equal(env.TMUX_PANE, undefined);
        started = true;
      },
    });
    assert.equal(readJob(plan.statusFile, plan.lock).phase, 'completed');
  } finally { fs.rmSync(plan.directory, { recursive: true, force: true }); }
});

test('update eligibility includes a rolled-back npm installation under a newer running binary', () => {
  assert.equal(needsUpdate('0.12.32', '0.12.32', '0.12.30'), true);
  assert.equal(needsUpdate('0.12.32', '0.12.30', '0.12.32'), true);
  assert.equal(needsUpdate('0.12.32', '0.12.32', '0.12.32'), false);
});

function fixture() {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'supervisor-updater-test-'),
  );
  const root = path.join(directory, 'prefix/lib/node_modules/remote-codex');
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'remote-codex', version: '1.0.0' }),
  );
  const plan = {
    directory,
    root,
    prefix: path.resolve(root, '../../..'),
    npm: '/fixture/npm-cli.js',
    node: process.execPath,
    launcher: path.join(root, 'bin/remote-codex.mjs'),
    version: '1.0.1',
    runningVersion: '1.0.0',
    pid: 2147483646,
    port: 48123,
    host: '127.0.0.1',
    mode: 'local',
    cwd: directory,
    executable: '/fixture/old-native',
    statusFile: path.join(directory, 'status.json'),
    lock: path.join(directory, 'lock'),
    env: {
      TEST_CONFIG: 'preserved',
      APP_VERSION: 'stale',
      REMOTE_CODEX_NATIVE_BINARY: '/stale',
    },
  };
  return plan;
}

test('worker verifies before stopping and starts the new launcher with preserved configuration', async () => {
  const plan = fixture();
  let health = { processId: plan.pid, activeTurnCount: 0 },
    stops = 0;
  try {
    await worker(plan, {
      sleep: async () => {},
      health: async () => health,
      run: async (_exe, args) => {
        assert.equal(stops, 0);
        if (args.includes('install'))
          fs.writeFileSync(
            path.join(plan.root, 'package.json'),
            JSON.stringify({ name: 'remote-codex', version: plan.version }),
          );
        return args.includes('native-path')
          ? '/fixture/new-native'
          : plan.version;
      },
      stop: (pid) => {
        assert.equal(pid, plan.pid);
        stops++;
      },
      start: (_exe, args, env, cwd) => {
        assert.deepEqual(args, [plan.launcher, 'start']);
        assert.equal(cwd, plan.cwd);
        assert.equal(env.SERVICE_PORT, '48123');
        assert.equal(env.SERVICE_HOST, '127.0.0.1');
        assert.equal(env.TEST_CONFIG, 'preserved');
        assert.equal(env.APP_VERSION, undefined);
        assert.equal(env.REMOTE_CODEX_NATIVE_BINARY, undefined);
        health = {
          processId: 2147483645,
          runningVersion: plan.version,
          status: 'ok',
        };
      },
    });
    assert.equal(stops, 1);
    assert.equal(
      JSON.parse(fs.readFileSync(plan.statusFile)).phase,
      'completed',
    );
  } finally {
    fs.rmSync(plan.directory, { recursive: true, force: true });
  }
});

for (const failure of ['download', 'startup', 'new-turn'])
  test(`worker safely handles ${failure} failure`, async () => {
    const plan = fixture();
    let health = { processId: plan.pid, activeTurnCount: 0 },
      stops = [],
      launches = [];
    try {
      await worker(plan, {
        sleep: async () => {},
        health: async () => health,
        run: async (_exe, args) => {
          if (failure === 'download') throw Error('download failed');
          if (args.includes('install'))
            fs.writeFileSync(
              path.join(plan.root, 'package.json'),
              JSON.stringify({ name: 'remote-codex', version: plan.version }),
            );
          if (failure === 'new-turn') health.activeTurnCount = 1;
          return args.includes('native-path') ? '/fixture/new' : plan.version;
        },
        stop: (pid) => {
          stops.push(pid);
          health = null;
        },
        start: (_exe, _args, env) => {
          launches.push(env);
          if (env.REMOTE_CODEX_NATIVE_BINARY === plan.executable) {
            const job = readJob(plan.statusFile, plan.lock);
            assert.equal(job.phase, 'restarting', 'rollback must retain an active job until health verification');
            assert.equal(job.rollingBack, true);
            health = {
              processId: 2147483645,
              runningVersion: plan.runningVersion,
              status: 'ok',
            };
          }
        },
      });
      assert.equal(
        JSON.parse(fs.readFileSync(path.join(plan.root, 'package.json')))
          .version,
        failure === 'startup' ? '1.0.1' : '1.0.0',
      );
      assert.equal(
        JSON.parse(fs.readFileSync(plan.statusFile)).phase,
        'failed',
      );
      assert.equal(stops.length, failure === 'startup' ? 1 : 0);
      assert.equal(launches.length, failure === 'startup' ? 1 : 0);
      if (failure === 'startup') assert.equal(JSON.parse(fs.readFileSync(plan.statusFile)).keptInstalledVersion, true);
    } finally {
      fs.rmSync(plan.directory, { recursive: true, force: true });
    }
  });

test('a supervisor that refuses to stop is kept running without a duplicate rollback process', async () => {
  const plan = fixture();
  let starts = 0;
  try {
    await worker(plan, {
      sleep: async () => {},
      alive: () => true,
      health: async () => ({ processId: plan.pid, activeTurnCount: 0 }),
      stop: () => {},
      start: () => {
        starts++;
      },
      run: async (_exe, args) => {
        if (args.includes('install'))
          fs.writeFileSync(
            path.join(plan.root, 'package.json'),
            JSON.stringify({ version: plan.version }),
          );
        return args.includes('native-path') ? '/fixture/new' : plan.version;
      },
    });
    assert.equal(starts, 0);
    assert.equal(JSON.parse(fs.readFileSync(plan.statusFile)).phase, 'failed');
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(plan.root, 'package.json'))).version,
      plan.runningVersion,
    );
  } finally {
    fs.rmSync(plan.directory, { recursive: true, force: true });
  }
});
