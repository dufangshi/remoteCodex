#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const outputDir = path.resolve(
  process.argv[2] ?? path.join(repoRoot, 'dist', 'npm'),
);
const platformDirs = [
  'darwin-arm64',
  'darwin-x64',
  'linux-arm64-gnu',
  'linux-arm64-musl',
  'linux-x64-gnu',
  'linux-x64-musl',
  'win32-x64-msvc',
];

fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });
const packages = [];
for (const directory of [...platformDirs, 'remote-codex']) {
  const packageDir = path.join(repoRoot, 'npm', directory);
  assertPrepared(packageDir, directory);
  const result = spawnSync(
    'npm',
    ['pack', '--json', '--ignore-scripts', '--pack-destination', outputDir],
    { cwd: packageDir, encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error(
      `npm pack failed for ${directory}\n${result.stdout}${result.stderr}`,
    );
  }
  const metadata = JSON.parse(result.stdout)[0];
  packages.push({
    kind: directory === 'remote-codex' ? 'launcher' : 'native',
    name: metadata.name,
    version: metadata.version,
    filename: metadata.filename,
    integrity: metadata.integrity,
    shasum: metadata.shasum,
  });
}
const manifest = {
  generatedAt: new Date().toISOString(),
  packages,
};
fs.writeFileSync(
  path.join(outputDir, 'manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
console.log(`Packed ${packages.length} npm packages into ${outputDir}.`);

function assertPrepared(packageDir, directory) {
  if (directory === 'remote-codex') {
    for (const file of ['bin/remote-codex.mjs', 'web/index.html', 'LICENSE']) {
      if (!fs.existsSync(path.join(packageDir, file))) {
        throw new Error(
          `Package ${directory} is not prepared: missing ${file}`,
        );
      }
    }
    return;
  }
  const executable = directory.startsWith('win32')
    ? 'remote-codex.exe'
    : 'remote-codex';
  if (!fs.existsSync(path.join(packageDir, 'bin', executable))) {
    throw new Error(
      `Package ${directory} is not prepared: missing bin/${executable}`,
    );
  }
}
