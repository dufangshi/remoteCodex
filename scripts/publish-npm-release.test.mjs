import assert from 'node:assert/strict';
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
    {
      kind: 'native',
      name: '@remote-codex/native-linux-x64-gnu',
      version: '0.12.0',
      filename: 'native-linux-x64-gnu-0.12.0.tgz',
      integrity: 'sha512-linux',
    },
    {
      kind: 'native',
      name: '@remote-codex/native-darwin-arm64',
      version: '0.12.0',
      filename: 'native-darwin-arm64-0.12.0.tgz',
      integrity: 'sha512-darwin',
    },
  ],
};

test('promotes every matching package to latest with the launcher last', () => {
  const npm = mockNpm({
    '@remote-codex/native-linux-x64-gnu@0.12.0': 'sha512-linux',
    '@remote-codex/native-darwin-arm64@0.12.0': 'sha512-darwin',
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
    ['dist-tag', 'add', '@remote-codex/native-linux-x64-gnu@0.12.0', 'latest'],
    ['dist-tag', 'add', '@remote-codex/native-darwin-arm64@0.12.0', 'latest'],
    ['dist-tag', 'add', 'remote-codex@0.12.0', 'latest'],
  ]);
});

test('detects every integrity conflict before changing the registry', () => {
  const npm = mockNpm({
    '@remote-codex/native-linux-x64-gnu@0.12.0': 'sha512-linux',
    '@remote-codex/native-darwin-arm64@0.12.0': 'sha512-wrong',
    'remote-codex@0.12.0': 'sha512-launcher',
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

test('does not promote the launcher after a native dist-tag failure', () => {
  const npm = mockNpm(
    {
      '@remote-codex/native-linux-x64-gnu@0.12.0': 'sha512-linux',
      '@remote-codex/native-darwin-arm64@0.12.0': 'sha512-darwin',
      'remote-codex@0.12.0': 'sha512-launcher',
    },
    { failTagFor: '@remote-codex/native-darwin-arm64@0.12.0' },
  );

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
    /npm dist-tag add failed/,
  );
  assert.deepEqual(npm.commands('dist-tag'), [
    ['dist-tag', 'add', '@remote-codex/native-linux-x64-gnu@0.12.0', 'latest'],
    ['dist-tag', 'add', '@remote-codex/native-darwin-arm64@0.12.0', 'latest'],
  ]);
});

test('finishes native publishing and tagging before touching the launcher', () => {
  const npm = mockNpm({
    '@remote-codex/native-linux-x64-gnu@0.12.0': 'sha512-linux',
  });

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
      '/release/native-darwin-arm64-0.12.0.tgz',
      '--tag',
      'latest',
      '--access',
      'public',
    ],
    [
      'publish',
      '/release/remote-codex-0.12.0.tgz',
      '--tag',
      'latest',
      '--access',
      'public',
    ],
  ]);
  const launcherPublish = npm.calls.findIndex(
    (args) =>
      args[0] === 'publish' && args[1] === '/release/remote-codex-0.12.0.tgz',
  );
  const lastNativeTag = npm.calls.findLastIndex(
    (args) => args[0] === 'dist-tag' && args[2].startsWith('@remote-codex/'),
  );
  assert.ok(launcherPublish > lastNativeTag);
});

test('does not treat an npm view transport failure as an unpublished version', () => {
  const npm = mockNpm(
    {
      '@remote-codex/native-darwin-arm64@0.12.0': 'sha512-darwin',
      'remote-codex@0.12.0': 'sha512-launcher',
    },
    { viewErrorFor: '@remote-codex/native-linux-x64-gnu@0.12.0' },
  );

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

  return {
    run(args) {
      calls.push(args);
      if (args[0] === 'view') {
        if (args[1] === options.viewErrorFor) {
          return { status: 1, stdout: '', stderr: 'ECONNRESET' };
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
        const filename = args[1].split('/').at(-1);
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
