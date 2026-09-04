import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

test(
  'downloads, verifies, and reuses the current platform binary',
  { skip: process.platform === 'win32' },
  async () => {
    const temporaryRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'remote-codex-launcher-'),
    );
    const packageRoot = path.join(temporaryRoot, 'package');
    const cacheRoot = path.join(temporaryRoot, 'cache');
    const launcherDir = path.join(packageRoot, 'bin');
    fs.mkdirSync(launcherDir, { recursive: true });
    fs.copyFileSync(
      path.join(repoRoot, 'npm', 'remote-codex', 'bin', 'remote-codex.mjs'),
      path.join(launcherDir, 'remote-codex.mjs'),
    );
    fs.writeFileSync(
      path.join(packageRoot, 'package.json'),
      `${JSON.stringify({ version: '9.8.7', type: 'module' })}\n`,
    );

    const executable = Buffer.from(
      '#!/usr/bin/env node\nconsole.log(`native:${process.argv.slice(2).join(",")}:${process.env.APP_VERSION}`);\n',
    );
    const assetName = `remote-codex-${platformKey()}`;
    const sha256 = crypto.createHash('sha256').update(executable).digest('hex');
    let requests = 0;
    const server = http.createServer((request, response) => {
      requests += 1;
      if (request.url !== `/${assetName}`) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, { 'content-type': 'application/octet-stream' });
      response.end(executable);
    });

    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      const { port } = server.address();
      fs.writeFileSync(
        path.join(packageRoot, 'native-manifest.json'),
        `${JSON.stringify({
          version: '9.8.7',
          releaseBaseUrl: `http://127.0.0.1:${port}`,
          assets: {
            [platformKey()]: {
              name: assetName,
              sha256,
              size: executable.length,
            },
          },
        })}\n`,
      );
      const { APP_VERSION: _ignoredAppVersion, ...baseEnvironment } =
        process.env;
      const environment = {
        ...baseEnvironment,
        REMOTE_CODEX_NATIVE_CACHE_DIR: cacheRoot,
      };
      const first = await run(
        process.execPath,
        [path.join(launcherDir, 'remote-codex.mjs'), 'doctor', 'one'],
        environment,
      );
      const second = await run(
        process.execPath,
        [path.join(launcherDir, 'remote-codex.mjs'), 'doctor', 'two'],
        environment,
      );
      const cachedBinary = path.join(
        cacheRoot,
        '9.8.7',
        platformKey(),
        assetName,
      );
      fs.writeFileSync(cachedBinary, 'corrupt');
      const third = await run(
        process.execPath,
        [path.join(launcherDir, 'remote-codex.mjs'), 'doctor', 'three'],
        environment,
      );
      assert.equal(first.stdout.trim(), 'native:doctor,one:9.8.7');
      assert.equal(second.stdout.trim(), 'native:doctor,two:9.8.7');
      assert.equal(third.stdout.trim(), 'native:doctor,three:9.8.7');
      assert.equal(requests, 2);
    } finally {
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  },
);

function platformKey() {
  if (process.platform === 'linux') {
    const glibc = process.report?.getReport?.().header?.glibcVersionRuntime;
    return `linux-${process.arch}-${glibc ? 'gnu' : 'musl'}`;
  }
  return `${process.platform}-${process.arch}`;
}

function run(command, args, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`launcher exited ${code}: ${stdout}${stderr}`));
    });
  });
}
