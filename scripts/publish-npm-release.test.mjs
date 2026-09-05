import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { publishRelease } from './publish-npm-release.mjs';

const manifest = {
  packages: [
    {
      kind: 'launcher',
      name: 'remote-codex',
      version: '0.12.0',
      filename: 'remote-codex-0.12.0.tgz',
      integrity: 'sha512-launcher',
    },
  ],
};

test('promotes an existing matching package to latest', () => {
  const npm = mockNpm({
    'remote-codex@0.12.0': 'sha512-launcher',
  });

  publishRelease({
    channel: 'latest',
    inputDir: '/release',
    manifest,
    allowLatest: true,
    runNpm: npm.run,
    log() {},
  });

  assert.deepEqual(npm.commands('publish'), []);
  assert.deepEqual(npm.commands('dist-tag'), [
    ['dist-tag', 'add', 'remote-codex@0.12.0', 'latest'],
  ]);
});

test('detects an integrity conflict before changing the registry', () => {
  const npm = mockNpm({
    'remote-codex@0.12.0': 'sha512-wrong',
  });

  assert.throws(
    () =>
      publishRelease({
        channel: 'latest',
        inputDir: '/release',
        manifest,
        allowLatest: true,
        runNpm: npm.run,
        log() {},
      }),
    /already exists with different integrity/,
  );
  assert.deepEqual(npm.mutations(), []);
});

test('publishes and tags the launcher', () => {
  const npm = mockNpm({});

  publishRelease({
    channel: 'latest',
    inputDir: '/release',
    manifest,
    allowLatest: true,
    runNpm: npm.run,
    log() {},
  });

  assert.deepEqual(npm.commands('publish'), [
    [
      'publish',
      path.join('/release', 'remote-codex-0.12.0.tgz'),
      '--tag',
      'latest',
      '--access',
      'public',
    ],
  ]);
  assert.deepEqual(npm.commands('dist-tag'), [
    ['dist-tag', 'add', 'remote-codex@0.12.0', 'latest'],
  ]);
});

test('retries registry visibility after publishing', () => {
  const npm = mockNpm({}, { notFoundViews: 8 });

  publishRelease({
    channel: 'latest',
    inputDir: '/release',
    manifest,
    allowLatest: true,
    registryRetryDelayMs: 0,
    registryVisibilityAttempts: 10,
    runNpm: npm.run,
    log() {},
  });

  assert.equal(npm.commands('publish').length, 1);
  assert.deepEqual(npm.commands('dist-tag'), [
    ['dist-tag', 'add', 'remote-codex@0.12.0', 'latest'],
  ]);
});

test('does not treat an npm view transport failure as an unpublished version', () => {
  const npm = mockNpm({}, { viewErrorFor: 'remote-codex@0.12.0' });

  assert.throws(
    () =>
      publishRelease({
        channel: 'latest',
        inputDir: '/release',
        manifest,
        allowLatest: true,
        runNpm: npm.run,
        log() {},
      }),
    /npm view failed.*ECONNRESET/,
  );
  assert.deepEqual(npm.mutations(), []);
});

function mockNpm(initialRegistry, options = {}) {
  const registry = new Map(Object.entries(initialRegistry));
  const calls = [];
  let notFoundViews = options.notFoundViews ?? 0;

  return {
    run(args) {
      calls.push(args);
      if (args[0] === 'view') {
        if (args[1] === options.viewErrorFor) {
          return { status: 1, stdout: '', stderr: 'ECONNRESET' };
        }
        if (notFoundViews > 0) {
          notFoundViews -= 1;
          return { status: 1, stdout: '', stderr: 'npm error code E404' };
        }
        const integrity = registry.get(args[1]);
        if (!integrity) {
          return { status: 1, stdout: '', stderr: 'npm error code E404' };
        }
        return {
          status: 0,
          stdout: `${JSON.stringify(integrity)}\n`,
          stderr: '',
        };
      }
      if (args[0] === 'publish') {
        const filename = path.basename(args[1]);
        const entry = manifest.packages.find(
          (candidate) => candidate.filename === filename,
        );
        registry.set(`${entry.name}@${entry.version}`, entry.integrity);
      }
      if (args[0] === 'dist-tag' && args[2] === options.failTagFor) {
        return { status: 1, stdout: '', stderr: 'simulated tag failure' };
      }
      return { status: 0, stdout: '', stderr: '' };
    },
    commands(command) {
      return calls.filter((args) => args[0] === command);
    },
    mutations() {
      return calls.filter((args) => ['publish', 'dist-tag'].includes(args[0]));
    },
    calls,
  };
}
