#!/usr/bin/env node

import fs from 'node:fs';
import crypto from 'node:crypto';
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
const apkOnly = args.apkOnly === true;
if (tag !== `v${packageJson.version}`) {
  throw new Error(`Mobile release tag must be v${packageJson.version}; received ${tag}.`);
}
run('node', ['scripts/verify-mobile-build-inputs.mjs']);
const apkPath = resolveFirstExisting(
  args.apk,
  [
    'apps/android/app/build/outputs/apk/release/app-release.apk',
  ],
  'APK',
);
const ipaPath = apkOnly
  ? null
  : resolveFirstExisting(
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
const uploadIpaPath = apkOnly
  ? null
  : prepareStableAsset(ipaPath, uploadDir, 'RemoteCodex.ipa');
const commit = currentCommit();
const checksums = {
  apk: sha256(uploadApkPath),
  ...(apkOnly ? {} : { ipa: sha256(uploadIpaPath) }),
};
const evidencePath = path.resolve(
  repoRoot,
  args.evidence ?? '.local/mobile-release/verification.json',
);
const collectArgs = [
  'scripts/collect-mobile-verification-evidence.mjs',
  '--apk',
  uploadApkPath,
  '--output',
  evidencePath,
];
if (apkOnly) {
  collectArgs.push('--simulator-only');
} else {
  collectArgs.push('--ipa', uploadIpaPath);
}
run('node', collectArgs);
const evidence = readAndValidateEvidence(evidencePath, {
  version: packageJson.version,
  commit,
  checksums,
  apkOnly,
});
const manifestName = apkOnly
  ? 'remote-codex-android-manifest.json'
  : 'remote-codex-mobile-manifest.json';
const manifestPath = path.join(uploadDir, manifestName);
fs.writeFileSync(
  manifestPath,
  `${JSON.stringify(
    {
      version: packageJson.version,
      tag,
      commit,
      threadUiCommit: evidence.threadUiCommit,
      verifiedAt: evidence.completedAt,
      publishedAt: new Date().toISOString(),
      requiredTestsSkipped: evidence.requiredTestsSkipped,
      matrix: evidence.matrix,
      artifacts: {
        apk: { name: 'remote-codex-android.apk', sha256: checksums.apk },
        ...(apkOnly
          ? {
              iosSimulatorApp: {
                sha256: evidence.artifacts.iosSimulatorApp.sha256,
                published: false,
              },
            }
          : { ipa: { name: 'RemoteCodex.ipa', sha256: checksums.ipa } }),
      },
    },
    null,
    2,
  )}\n`,
);

ensureGh();
ensureCleanWorktree();
ensureRelease(tag, apkOnly);

const uploadArgs = [
  'release',
  'upload',
  tag,
  uploadApkPath,
  manifestPath,
  '--clobber',
];
if (!apkOnly) uploadArgs.splice(4, 0, uploadIpaPath);
run('gh', uploadArgs);

console.log(`Uploaded ${apkOnly ? 'Android' : 'mobile app'} assets to GitHub Release ${tag}.`);
console.log(`- remote-codex-android.apk <- ${path.relative(repoRoot, apkPath)}`);
if (!apkOnly) console.log(`- RemoteCodex.ipa <- ${path.relative(repoRoot, ipaPath)}`);
console.log(`- ${manifestName} <- ${path.relative(repoRoot, manifestPath)}`);

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
      case '--evidence':
        parsed.evidence = values[++index];
        break;
      case '--apk-only':
        parsed.apkOnly = true;
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

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function readAndValidateEvidence(filePath, expected) {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Missing full mobile verification evidence at ${path.relative(repoRoot, filePath)}. Run the complete Android AOSP and iOS Simulator Local/Server/Relay gate first.`,
    );
  }
  const evidence = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const failures = [];
  if (evidence.status !== 'passed') failures.push('status must be passed');
  if (evidence.version !== expected.version) failures.push(`version must be ${expected.version}`);
  if (evidence.commit !== expected.commit) failures.push(`commit must be ${expected.commit}`);
  if (!evidence.threadUiCommit) failures.push('threadUiCommit is required');
  if (!evidence.completedAt) failures.push('completedAt is required');
  if (evidence.requiredTestsSkipped !== 0) failures.push('requiredTestsSkipped must be 0');
  for (const platform of ['androidAosp', 'iosSimulator']) {
    for (const mode of ['local', 'server', 'relay']) {
      if (evidence.matrix?.[platform]?.[mode] !== 'passed') {
        failures.push(`${platform}.${mode} must be passed`);
      }
    }
  }
  if (evidence.artifacts?.apk?.sha256 !== expected.checksums.apk) {
    failures.push('APK checksum does not match verification evidence');
  }
  if (expected.apkOnly) {
    if (evidence.verificationKind !== 'simulator-parity') {
      failures.push('verificationKind must be simulator-parity for APK-only release');
    }
    if (!evidence.artifacts?.iosSimulatorApp?.sha256) {
      failures.push('iOS Simulator app checksum is required for APK-only release');
    }
  } else if (evidence.artifacts?.ipa?.sha256 !== expected.checksums.ipa) {
    failures.push('IPA checksum does not match verification evidence');
  }
  if (failures.length > 0) {
    throw new Error(`Mobile verification evidence is not publishable:\n- ${failures.join('\n- ')}`);
  }
  return evidence;
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

function ensureCleanWorktree() {
  const result = spawnSync('git', ['status', '--porcelain'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || 'Unable to inspect git worktree status.');
  }
  if (result.stdout.trim()) {
    throw new Error('Refusing to publish mobile assets from a dirty git worktree.');
  }
}

function ensureRelease(tagName, androidOnly) {
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
    androidOnly
      ? `Remote Codex ${tagName}\n\nSigned Android APK. iOS IPA is intentionally not included in this release.`
      : `Remote Codex ${tagName}`,
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
  pnpm release:mobile -- --tag v${packageJson.version} --apk path/to/app-release.apk --ipa path/to/RemoteCodex.ipa --evidence path/to/verification.json
  pnpm release:mobile -- --apk-only --tag v${packageJson.version}

Defaults:
  --tag v<package.json version>
  --apk apps/android/app/build/outputs/apk/release/app-release.apk
  --ipa apps/ios/build/RemoteCodex.ipa, then apps/ios/RemoteCodex.ipa
  --evidence .local/mobile-release/verification.json
  --apk-only publish the signed APK without requiring or uploading an IPA

The uploaded asset names are stable:
  remote-codex-android.apk
  RemoteCodex.ipa
  remote-codex-mobile-manifest.json

APK-only releases upload remote-codex-android-manifest.json instead. They still
require the complete Android AOSP and iOS Simulator parity evidence.

Before upload, the command regenerates verification evidence from the persisted
JUnit/xcresult suites. Full mobile releases validate both signed artifacts;
APK-only releases validate the signed APK plus the iOS Simulator parity artifact.
`);
}
