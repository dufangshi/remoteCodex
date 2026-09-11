import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  worker,
  readJob,
} from '../npm/remote-codex/bin/supervisor-update.mjs';

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
