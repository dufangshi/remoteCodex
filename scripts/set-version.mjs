#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const version = process.argv[2];
if (
  !version ||
  !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)
) {
  throw new Error('Usage: pnpm version:set <semver>');
}
const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
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

updateJson(path.join(repoRoot, 'package.json'), (manifest) => {
  manifest.version = version;
});
updateJson(
  path.join(repoRoot, 'npm', 'remote-codex', 'package.json'),
  (manifest) => {
    manifest.version = version;
    for (const dependency of Object.keys(manifest.optionalDependencies ?? {})) {
      manifest.optionalDependencies[dependency] = version;
    }
  },
);
for (const directory of platformDirs) {
  updateJson(
    path.join(repoRoot, 'npm', directory, 'package.json'),
    (manifest) => {
      manifest.version = version;
    },
  );
}

const cargoPath = path.join(repoRoot, 'Cargo.toml');
const cargo = fs.readFileSync(cargoPath, 'utf8');
const cargoVersionPattern =
  /(\[workspace\.package\][\s\S]*?\nversion\s*=\s*)"[^"]+"/;
if (!cargoVersionPattern.test(cargo))
  throw new Error('Cargo workspace version was not found');
const updatedCargo = cargo.replace(cargoVersionPattern, `$1"${version}"`);
fs.writeFileSync(cargoPath, updatedCargo);
console.log(
  `Set Remote Codex workspace and npm package versions to ${version}.`,
);

function updateJson(filePath, update) {
  const manifest = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  update(manifest);
  fs.writeFileSync(filePath, `${JSON.stringify(manifest, null, 2)}\n`);
}
