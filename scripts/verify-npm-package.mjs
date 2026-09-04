#!/usr/bin/env node

import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const temporaryRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), 'remote-codex-npm-'),
);
const installRoot = path.join(temporaryRoot, 'install');
const workspaceRoot = path.join(temporaryRoot, 'workspace');
const serviceDir = path.join(temporaryRoot, 'service');
const packageVersion = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'),
).version;
let launcher = null;

try {
  fs.mkdirSync(installRoot, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  if (!process.argv.includes('--prepared')) {
    await run(
      process.execPath,
      [
        path.join(repoRoot, 'scripts', 'prepare-npm-release.mjs'),
        '--current-binary',
        path.join(repoRoot, 'target', 'release', executableName()),
      ],
      { cwd: repoRoot },
    );
  }

  const packDir = path.join(temporaryRoot, 'packs');
  fs.mkdirSync(packDir);
  const launcherPack = await npmPack(
    path.join(repoRoot, 'npm', 'remote-codex'),
    packDir,
  );
  assertPackageContents(launcherPack.metadata);

  fs.writeFileSync(
    path.join(installRoot, 'package.json'),
    `${JSON.stringify(
      {
        private: true,
        dependencies: {
          'remote-codex': `file:${launcherPack.path}`,
        },
      },
      null,
      2,
    )}\n`,
  );
  await run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: installRoot,
  });

  launcher = path.join(
    installRoot,
    'node_modules',
    'remote-codex',
    'bin',
    'remote-codex.mjs',
  );
  const version = await run(process.execPath, [launcher, 'version'], {
    cwd: installRoot,
    capture: true,
  });
  if (version.stdout.trim() !== packageVersion) {
    throw new Error(`Installed CLI version mismatch: ${version.stdout.trim()}`);
  }

  const port = await availablePort();
  const environment = {
    ...process.env,
    REMOTE_CODEX_SERVICE_DIR: serviceDir,
    SERVICE_PORT: String(port),
    DATABASE_URL: path.join(temporaryRoot, 'supervisor.sqlite'),
    WORKSPACE_ROOT: workspaceRoot,
    REMOTE_CODEX_E2E_FAKE_RUNTIME: '1',
    REMOTE_CODEX_NATIVE_BINARY: path.join(
      repoRoot,
      'npm',
      currentPackageDir(),
      'bin',
      executableName(),
    ),
  };
  await run(process.execPath, [launcher, 'start'], {
    cwd: installRoot,
    env: environment,
  });
  const health = await fetch(`http://127.0.0.1:${port}/healthz`);
  if (!health.ok)
    throw new Error(`Packaged health endpoint returned ${health.status}`);
  const home = await fetch(`http://127.0.0.1:${port}/`);
  const html = await home.text();
  if (!home.ok || !html.toLowerCase().includes('<!doctype html>')) {
    throw new Error('Packaged supervisor did not serve the Web UI');
  }
  const status = await run(process.execPath, [launcher, 'status'], {
    cwd: installRoot,
    env: environment,
    capture: true,
  });
  if (!status.stdout.includes('State: running')) {
    throw new Error(`Packaged status was not running:\n${status.stdout}`);
  }
  await run(process.execPath, [launcher, 'stop'], {
    cwd: installRoot,
    env: environment,
  });
  launcher = null;
  console.log(
    `Verified remote-codex@${packageVersion} npm install, native launch, Web, API, status, and stop.`,
  );
} finally {
  if (launcher && fs.existsSync(launcher)) {
    await run(process.execPath, [launcher, 'stop'], {
      cwd: installRoot,
      env: { ...process.env, REMOTE_CODEX_SERVICE_DIR: serviceDir },
      allowFailure: true,
    });
  }
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

async function npmPack(directory, destination) {
  const result = await run(
    'npm',
    ['pack', '--json', '--pack-destination', destination, '--ignore-scripts'],
    { cwd: directory, capture: true },
  );
  const output = JSON.parse(result.stdout);
  const metadata = output[0];
  return { metadata, path: path.join(destination, metadata.filename) };
}

function assertPackageContents(metadata) {
  const files = new Set(metadata.files.map((entry) => entry.path));
  for (const required of [
    'bin/remote-codex.mjs',
    'native-manifest.json',
    'web/index.html',
    'package.json',
  ]) {
    if (!files.has(required))
      throw new Error(`npm tarball is missing ${required}`);
  }
  for (const entry of files) {
    if (
      entry.startsWith('crates/') ||
      entry.startsWith('target/') ||
      entry.startsWith('apps/')
    ) {
      throw new Error(`npm tarball leaked repository source: ${entry}`);
    }
  }
}

function currentPackageDir() {
  if (process.platform === 'linux')
    return `linux-${process.arch}-${linuxLibc()}`;
  if (process.platform === 'win32') return `win32-${process.arch}-msvc`;
  return `${process.platform}-${process.arch}`;
}

function linuxLibc() {
  try {
    return process.report?.getReport?.().header?.glibcVersionRuntime
      ? 'gnu'
      : 'musl';
  } catch {
    return 'gnu';
  }
}

function executableName() {
  return process.platform === 'win32' ? 'remote-codex.exe' : 'remote-codex';
}

async function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0 || options.allowFailure) {
        resolve({ code, stdout, stderr });
      } else {
        reject(
          new Error(
            `${command} ${args.join(' ')} exited ${code}\n${stdout}${stderr}`,
          ),
        );
      }
    });
  });
}
