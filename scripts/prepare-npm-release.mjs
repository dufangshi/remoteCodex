#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const npmRoot = path.join(repoRoot, 'npm');
const launcherRoot = path.join(npmRoot, 'remote-codex');
const rootManifest = readJson(path.join(repoRoot, 'package.json'));
const launcherManifest = readJson(path.join(launcherRoot, 'package.json'));
const cargoVersion = readCargoVersion(path.join(repoRoot, 'Cargo.toml'));
const args = process.argv.slice(2);
const artifactsDir = option('--artifacts-dir');
const explicitCurrentBinary = option('--current-binary');
const requireAll = args.includes('--require-all');

const packages = [
  { key: 'darwin-arm64', dir: 'darwin-arm64', executable: 'remote-codex' },
  {
    key: 'linux-arm64-gnu',
    dir: 'linux-arm64-gnu',
    executable: 'remote-codex',
  },
  { key: 'linux-x64-gnu', dir: 'linux-x64-gnu', executable: 'remote-codex' },
  {
    key: 'win32-x64-msvc',
    dir: 'win32-x64-msvc',
    executable: 'remote-codex.exe',
    releaseAsset: 'remote-codex-win32-x64-msvc-cli.exe',
  },
];

assertEqual(
  rootManifest.version,
  cargoVersion,
  'root package and Cargo workspace versions',
);
assertEqual(
  launcherManifest.version,
  cargoVersion,
  'launcher and Cargo workspace versions',
);

const webSource = path.join(repoRoot, 'apps', 'supervisor-web', 'dist');
if (!fs.existsSync(path.join(webSource, 'index.html'))) {
  throw new Error(
    'Supervisor Web is not built. Run pnpm --filter @remote-codex/supervisor-web build.',
  );
}
replaceDirectory(webSource, path.join(launcherRoot, 'web'));
fs.copyFileSync(
  path.join(repoRoot, 'LICENSE'),
  path.join(launcherRoot, 'LICENSE'),
);

for (const entry of packages) {
  const packageDir = path.join(npmRoot, entry.dir);
  fs.mkdirSync(path.join(packageDir, 'bin'), { recursive: true });
  fs.copyFileSync(
    path.join(repoRoot, 'LICENSE'),
    path.join(packageDir, 'LICENSE'),
  );
  fs.copyFileSync(
    path.join(npmRoot, 'README.platform.md'),
    path.join(packageDir, 'README.md'),
  );
  const output = path.join(packageDir, 'bin', entry.executable);
  removeFile(output);

  let input = null;
  if (artifactsDir) {
    input = path.resolve(artifactsDir, entry.key, entry.executable);
  } else if (entry.key === currentPlatformKey()) {
    input = path.resolve(
      explicitCurrentBinary ??
        path.join(repoRoot, 'target', 'release', entry.executable),
    );
  }
  if (!input || !fs.existsSync(input)) {
    if (requireAll)
      throw new Error(
        `Missing native artifact for ${entry.key}: ${input ?? 'not supplied'}`,
      );
    continue;
  }
  fs.copyFileSync(input, output);
  if (!entry.executable.endsWith('.exe')) fs.chmodSync(output, 0o755);
  if (entry.key === currentPlatformKey()) {
    const version = spawnSync(output, ['version'], { encoding: 'utf8' });
    if (version.status !== 0 || version.stdout.trim() !== cargoVersion) {
      throw new Error(
        `Native artifact version mismatch for ${entry.key}: ${version.stdout.trim() || version.stderr.trim()}`,
      );
    }
  }
  console.log(`Prepared ${entry.key}: ${path.relative(repoRoot, output)}`);
}

if (requireAll) {
  for (const entry of packages) {
    const output = path.join(npmRoot, entry.dir, 'bin', entry.executable);
    if (!fs.existsSync(output))
      throw new Error(`Native artifact was not staged: ${entry.key}`);
  }
}

const nativeAssets = {};
for (const entry of packages) {
  const executable =
    entry.releaseAsset ??
    (entry.executable.endsWith('.exe')
      ? `remote-codex-${entry.key}.exe`
      : `remote-codex-${entry.key}`);
  const staged = path.join(npmRoot, entry.dir, 'bin', entry.executable);
  if (!fs.existsSync(staged)) continue;
  const contents = fs.readFileSync(staged);
  nativeAssets[entry.key] = {
    name: executable,
    sha256: crypto.createHash('sha256').update(contents).digest('hex'),
    size: contents.length,
  };
}
fs.writeFileSync(
  path.join(launcherRoot, 'native-manifest.json'),
  `${JSON.stringify(
    {
      version: cargoVersion,
      releaseBaseUrl: `https://github.com/dufangshi/remoteCodex/releases/download/v${cargoVersion}`,
      assets: nativeAssets,
    },
    null,
    2,
  )}\n`,
);

console.log(`Prepared remote-codex npm packages at version ${cargoVersion}.`);

function currentPlatformKey() {
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

function option(name) {
  const index = args.indexOf(name);
  if (index < 0) return null;
  const value = args[index + 1];
  if (!value || value.startsWith('--'))
    throw new Error(`${name} requires a value`);
  return value;
}

function replaceDirectory(source, destination) {
  fs.rmSync(destination, { recursive: true, force: true });
  fs.cpSync(source, destination, { recursive: true });
}

function removeFile(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readCargoVersion(filePath) {
  const match = /^version\s*=\s*"([^"]+)"/m.exec(
    fs.readFileSync(filePath, 'utf8'),
  );
  if (!match) throw new Error('Cargo workspace version was not found');
  return match[1];
}

function assertEqual(actual, expected, label) {
  if (actual !== expected)
    throw new Error(`${label} differ: ${actual} != ${expected}`);
}
