#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const packageJson = readJson(path.join(repoRoot, 'package.json'));
const mobileBuild = readJson(path.join(repoRoot, 'config/mobile-build.json'));
const threadUiDir = path.resolve(
  process.env.REMOTE_CODEX_THREAD_UI_DIR ?? path.join(repoRoot, '..', 'remote-codex-thread-ui'),
);
const iosProject = YAML.parse(
  fs.readFileSync(path.join(repoRoot, 'apps/ios/project.yml'), 'utf8'),
);
const expectedBuildNumber = versionCode(packageJson.version);
const failures = [];

if (!/^[0-9a-f]{64}$/.test(mobileBuild.androidReleaseCertificateSha256 ?? '')) {
  failures.push('androidReleaseCertificateSha256 must be a lowercase SHA-256 digest');
}

assertEqual(
  iosProject?.settings?.base?.MARKETING_VERSION,
  packageJson.version,
  'project.yml MARKETING_VERSION',
);
assertEqual(
  String(iosProject?.settings?.base?.CURRENT_PROJECT_VERSION ?? ''),
  String(expectedBuildNumber),
  'project.yml CURRENT_PROJECT_VERSION',
);
assertEqual(
  iosProject?.targets?.RemoteCodex?.settings?.base?.PRODUCT_BUNDLE_IDENTIFIER,
  mobileBuild.iosBundleId,
  'project.yml PRODUCT_BUNDLE_IDENTIFIER',
);
assertEqual(
  iosProject?.settings?.base?.DEVELOPMENT_TEAM,
  mobileBuild.iosDevelopmentTeam,
  'project.yml DEVELOPMENT_TEAM',
);

const threadUiCommit = git(threadUiDir, ['rev-parse', 'HEAD']);
assertEqual(threadUiCommit, mobileBuild.threadUiCommit, 'thread-ui commit');
const threadUiOrigin = git(threadUiDir, ['remote', 'get-url', 'origin']);
assertEqual(threadUiOrigin, mobileBuild.threadUiRepository, 'thread-ui origin');
const threadUiStatus = git(threadUiDir, ['status', '--porcelain']);
if (threadUiStatus) {
  failures.push(`thread-ui worktree must be clean: ${threadUiStatus.split('\n')[0]}`);
}

const xcodeDeveloperDir = resolveXcodeDeveloperDir();
const xcodeSettings = run(
  'xcodebuild',
  [
    '-project',
    path.join(repoRoot, 'apps/ios/RemoteCodex.xcodeproj'),
    '-scheme',
    'RemoteCodex',
    '-showBuildSettings',
  ],
  { DEVELOPER_DIR: xcodeDeveloperDir },
);
const buildSettings = parseXcodeBuildSettings(xcodeSettings);
assertEqual(buildSettings.MARKETING_VERSION, packageJson.version, 'Xcode MARKETING_VERSION');
assertEqual(
  buildSettings.CURRENT_PROJECT_VERSION,
  String(expectedBuildNumber),
  'Xcode CURRENT_PROJECT_VERSION',
);
assertEqual(
  buildSettings.PRODUCT_BUNDLE_IDENTIFIER,
  mobileBuild.iosBundleId,
  'Xcode PRODUCT_BUNDLE_IDENTIFIER',
);
assertEqual(
  buildSettings.DEVELOPMENT_TEAM,
  mobileBuild.iosDevelopmentTeam,
  'Xcode DEVELOPMENT_TEAM',
);

if (failures.length > 0) {
  throw new Error(`Mobile build inputs are inconsistent:\n- ${failures.join('\n- ')}`);
}

console.log(
  JSON.stringify(
    {
      version: packageJson.version,
      buildNumber: expectedBuildNumber,
      androidApplicationId: mobileBuild.androidApplicationId,
      androidReleaseCertificateSha256:
        mobileBuild.androidReleaseCertificateSha256,
      iosBundleId: mobileBuild.iosBundleId,
      iosDevelopmentTeam: mobileBuild.iosDevelopmentTeam,
      threadUiCommit,
      threadUiDir,
      xcodeDeveloperDir,
    },
    null,
    2,
  ),
);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function versionCode(version) {
  return version
    .split('.')
    .slice(0, 3)
    .reduce((code, part) => code * 100 + Number.parseInt(part, 10), 0);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    failures.push(`${label} must be ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

function git(cwd, args) {
  return run('git', args, {}, cwd).trim();
}

function run(command, args, extraEnv = {}, cwd = repoRoot) {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...extraEnv },
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || `${command} ${args.join(' ')} failed`);
  }
  return result.stdout;
}

function resolveXcodeDeveloperDir() {
  if (process.env.DEVELOPER_DIR) {
    return process.env.DEVELOPER_DIR;
  }
  for (const candidate of [
    '/Applications/Xcode.app/Contents/Developer',
    '/Applications/Xcode-beta.app/Contents/Developer',
  ]) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error('Xcode developer directory was not found. Set DEVELOPER_DIR explicitly.');
}

function parseXcodeBuildSettings(output) {
  const settings = {};
  for (const line of output.split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match) {
      settings[match[1]] = match[2];
    }
  }
  return settings;
}
