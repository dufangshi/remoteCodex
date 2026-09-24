import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { routingFile, activeLauncher, extractPackage, stagePackage } from '../npm/remote-codex/bin/installation.mjs';
import { npmInstallation, worker, readJob } from '../npm/remote-codex/bin/supervisor-update.mjs';

function pkg(root, version = '1.0.0') {
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'remote-codex', version }));
  const launcher = path.join(root, 'bin/remote-codex.mjs');
  fs.writeFileSync(launcher, '');
  return launcher;
}

test('classifies writable global, read-only, missing npm, pnpm store, local dependency and source installs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'install-layout-'));
  try {
    const launcher = pkg(path.join(dir, 'nvm/v22/lib/node_modules/remote-codex'));
    const npm = path.resolve(launcher, '../../../npm/bin/npm-cli.js');
    fs.mkdirSync(path.dirname(npm), { recursive: true }); fs.writeFileSync(npm, '');
    assert.equal(npmInstallation(launcher, process.execPath, { PATH: '' }, () => true).manager, 'npm');
    const readonly = npmInstallation(launcher, process.execPath, { PATH: '' }, p => !p.startsWith(dir));
    assert.equal(readonly.manager, 'managed-release');
    assert.equal(readonly.origin, launcher);
    assert.throws(() => npmInstallation(launcher, process.execPath, { PATH: '' }, () => false), /Neither/);
    fs.rmSync(npm);
    const fakeNode = path.join(dir, 'node'); fs.writeFileSync(fakeNode, '');
    assert.equal(npmInstallation(launcher, fakeNode, { PATH: '' }).manager, 'managed-release');
    for (const location of ['store/.pnpm/remote-codex@1/node_modules/remote-codex', 'project/node_modules/remote-codex']) {
      assert.equal(npmInstallation(pkg(path.join(dir, location)), process.execPath, { PATH: '' }).manager, 'managed-release');
    }
    assert.throws(() => npmInstallation(pkg(path.join(dir, 'checkout/npm/remote-codex')), process.execPath), /Source checkout/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('persistent routing survives invocation through a symlink, isolates origins and yields to explicit package upgrades', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'install-route-'));
  try {
    const origin = pkg(path.join(dir, 'system/remote-codex'));
    const file = routingFile(origin, dir);
    const next = pkg(path.join(path.dirname(file), 'release-new'), '1.0.1');
    fs.writeFileSync(file, JSON.stringify({ originVersion: '1.0.0', version: '1.0.1', relativeLauncher: path.relative(path.dirname(file), next) }));
    assert.equal(activeLauncher(origin, dir), next);
    if (process.platform !== 'win32') {
      fs.symlinkSync(origin, path.join(dir, 'alias')); assert.equal(activeLauncher(path.join(dir, 'alias'), dir), next);
    }
    const other = pkg(path.join(dir, 'other/remote-codex'));
    assert.equal(activeLauncher(other, dir), other);
    pkg(path.resolve(next, '../..'), '1.0.2');
    assert.throws(() => activeLauncher(origin, dir), /incomplete/);
    pkg(path.resolve(origin, '../..'), '1.0.3');
    assert.equal(activeLauncher(origin, dir), origin);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

function archive(entries) {
  const blocks = [];
  for (const [name, content, type = '0'] of entries) {
    const header = Buffer.alloc(512); header.write(name); header.write('0000644\0', 100);
    const data = Buffer.from(content); header.write(data.length.toString(8).padStart(11, '0') + '\0', 124);
    header.write(type, 156); header.fill(32, 148, 156);
    header.write(header.reduce((a, b) => a + b, 0).toString(8).padStart(6, '0') + '\0 ', 148);
    blocks.push(header, data, Buffer.alloc((512 - data.length % 512) % 512));
  }
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]));
}

test('managed downloads verify integrity and reject archive traversal, links and corrupt headers', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'install-archive-'));
  try {
    for (const name of ['package/../escape', '/tmp/escape', 'package/C:/escape', 'package/dir\\escape'])
      assert.throws(() => extractPackage(archive([[name, 'bad']]), dir), /Unsafe/);
    assert.throws(() => extractPackage(archive([['package/link', '', '2']]), dir), /Unsupported/);
    const entries = [['package/package.json', JSON.stringify({ name: 'remote-codex', version: '1.0.1' })],
      ...['bin/remote-codex.mjs', 'bin/supervisor-update.mjs', 'bin/installation.mjs', 'native-manifest.json'].map(f => [`package/${f}`, '{}'])];
    const data = archive(entries);
    const metadata = { name: 'remote-codex', version: '1.0.1', dist: {
      tarball: 'https://registry.npmjs.org/remote-codex/-/remote-codex-1.0.1.tgz', integrity: 'sha512-' + crypto.createHash('sha512').update(data).digest('base64') } };
    const fetcher = async url => String(url).endsWith('.tgz') ? new Response(data) : Response.json(metadata);
    await stagePackage('1.0.1', dir, fetcher);
    assert(fs.existsSync(path.join(dir, 'bin/installation.mjs')));
    metadata.dist.integrity = 'sha512-bad';
    await assert.rejects(stagePackage('1.0.1', dir, fetcher), /integrity mismatch/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

for (const failure of [null, 'download', 'native', 'busy', 'start']) {
  test(`managed update stages before stopping and preserves routing across ${failure ?? 'success'}`, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'install-worker-'));
    const origin = pkg(path.join(dir, 'readonly/remote-codex'));
    const routeFile = routingFile(origin, dir);
    const plan = { directory: dir, root: path.resolve(origin, '../..'), launcher: origin, origin, originVersion: '1.0.0',
      manager: 'managed-release', routeFile, node: process.execPath, pid: 12345, version: '1.0.1', runningVersion: '1.0.0',
      env: {}, cwd: dir, mode: 'local', port: 1234, executable: '/old/native', statusFile: path.join(dir, 'status'), lock: path.join(dir, 'lock') };
    let stopped = false, started = false;
    try {
      await worker(plan, {
        sleep: async () => {}, captureRelaySession: () => null, retireRelaySession: () => {}, managedService: () => false,
        stagePackage: async (version, root) => { assert.equal(stopped, false); if (failure === 'download') throw Error('download failed'); pkg(root, version); },
        run: async (_exe, args) => { if (failure === 'native') throw Error('native failed'); return args.includes('native-path') ? '/new/native' : plan.version; },
        health: async () => started && failure !== 'start' ? { status: 'ok', processId: 12346, runningVersion: plan.version } : { processId: plan.pid, activeTurnCount: failure === 'busy' ? 1 : 0 },
        alive: () => !stopped, stop: () => { stopped = true; assert.notEqual(activeLauncher(origin, dir), origin); },
        start: (_exe, args, env) => { started = true; assert.equal(env.REMOTE_CODEX_INSTALL_ORIGIN, origin); assert.equal(args[0], activeLauncher(origin, dir)); },
      });
      const job = readJob(plan.statusFile, plan.lock);
      assert.equal(job.phase, failure ? 'failed' : 'completed');
      assert.equal(stopped, !failure || failure === 'start');
      assert.equal(activeLauncher(origin, dir) === origin, !!failure && failure !== 'start');
      assert.equal(JSON.parse(fs.readFileSync(path.join(plan.root, 'package.json'))).version, '1.0.0');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
}
