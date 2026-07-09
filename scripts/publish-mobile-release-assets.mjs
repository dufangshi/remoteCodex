#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  printHelp();
  process.exit(0);
}

const tag = args.tag ?? `v${packageJson.version}`;
const apkPath = resolveFirstExisting(
  args.apk,
  [
    'apps/android/app/build/outputs/apk/release/app-release.apk',
    'apps/android/app/build/outputs/apk/debug/app-debug.apk',
  ],
  'APK',
);
const ipaPath = resolveFirstExisting(
  args.ipa,
  [
    'apps/ios/build/RemoteCodex.ipa',
    'apps/ios/RemoteCodex.ipa',
    'RemoteCodex.ipa',
  ],
  'IPA',
);
const uploadDir = path.join(repoRoot, '.local', 'mobile-release', 'release-assets');
const uploadApkPath = prepareStableAsset(apkPath, uploadDir, 'remote-codex-android.apk');
const uploadIpaPath = prepareStableAsset(ipaPath, uploadDir, 'RemoteCodex.ipa');

ensureGh();
ensureRelease(tag);

run('gh', [
  'release',
  'upload',
  tag,
  uploadApkPath,
  uploadIpaPath,
  '--clobber',
]);

console.log(`Uploaded mobile app assets to GitHub Release ${tag}.`);
console.log(`- remote-codex-android.apk <- ${path.relative(repoRoot, apkPath)}`);
console.log(`- RemoteCodex.ipa <- ${path.relative(repoRoot, ipaPath)}`);

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    switch (value) {
      case '--':
        break;
      case '--apk':
        parsed.apk = values[++index];
        break;
      case '--ipa':
        parsed.ipa = values[++index];
        break;
      case '--tag':
        parsed.tag = values[++index];
        break;
      case '-h':
      case '--help':
        parsed.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${value}`);
    }
  }
  return parsed;
}

function prepareStableAsset(sourcePath, outputDir, stableName) {
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, stableName);
  if (path.resolve(sourcePath) !== path.resolve(outputPath)) {
    fs.copyFileSync(sourcePath, outputPath);
  }
  return outputPath;
}

function resolveFirstExisting(explicitPath, candidates, label) {
  const paths = explicitPath ? [explicitPath] : candidates;
  for (const candidate of paths) {
    const resolved = path.resolve(repoRoot, candidate);
    if (fs.existsSync(resolved)) {
      return resolved;
    }
  }

  const hint = paths.map((candidate) => `  - ${candidate}`).join('\n');
  throw new Error(`Missing ${label} artifact. Checked:\n${hint}`);
}

function ensureGh() {
  const result = spawnSync('gh', ['auth', 'status'], {
    cwd: repoRoot,
    stdio: 'ignore',
  });
  if (result.status !== 0) {
    throw new Error('GitHub CLI is not authenticated. Run `gh auth login` first.');
  }
}

function ensureRelease(tagName) {
  const view = spawnSync('gh', ['release', 'view', tagName], {
    cwd: repoRoot,
    stdio: 'ignore',
  });
  if (view.status === 0) {
    return;
  }

  run('gh', [
    'release',
    'create',
    tagName,
    '--title',
    tagName,
    '--notes',
    `Remote Codex ${tagName}`,
    '--target',
    currentCommit(),
  ]);
}

function currentCommit() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || 'Unable to resolve HEAD.');
  }
  return result.stdout.trim();
}

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    cwd: repoRoot,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${commandArgs.join(' ')} failed with exit code ${result.status}.`);
  }
}

function printHelp() {
  console.log(`Publish Remote Codex mobile app assets to GitHub Releases.

Usage:
  pnpm release:mobile -- --tag v0.11.23 --apk path/to/app.apk --ipa path/to/RemoteCodex.ipa

Defaults:
  --tag v<package.json version>
  --apk apps/android/app/build/outputs/apk/release/app-release.apk, then debug APK
  --ipa apps/ios/build/RemoteCodex.ipa, then apps/ios/RemoteCodex.ipa

The uploaded asset names are stable:
  remote-codex-android.apk
  RemoteCodex.ipa
`);
}
