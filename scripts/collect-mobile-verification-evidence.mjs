#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const packageJson = readJson(path.join(repoRoot, 'package.json'));
const mobileBuild = readJson(path.join(repoRoot, 'config/mobile-build.json'));
const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printHelp();
  process.exit(0);
}

const defaults = {
  androidConnected: '.local/mobile-parity/evidence/android-connected-final.xml',
  androidUnitDir: 'apps/android/app/build/test-results/testDebugUnitTest',
  iosUnit: '.local/mobile-parity/evidence/RemoteCodexUnitFinal.xcresult',
  iosFixture: '.local/mobile-parity/evidence/RemoteCodexFixtureFinal.xcresult',
  iosLocalA: '.local/mobile-parity/evidence/RemoteCodexLocalFinalA.xcresult',
  iosLocalB: '.local/mobile-parity/evidence/RemoteCodexLocalFinalB.xcresult',
  iosServer: '.local/mobile-parity/evidence/RemoteCodexServerFinal.xcresult',
  iosRelay: '.local/mobile-parity/evidence/RemoteCodexRelayFinal.xcresult',
  ios27: '.local/mobile-parity/evidence/RemoteCodexIOS27Smoke.xcresult',
  iosRealProviders:
    '.local/mobile-parity/evidence/RemoteCodexRealProvidersFinal.xcresult',
  iosSimulatorApp:
    '.local/ios-release-derived/Build/Products/Release-iphonesimulator/RemoteCodex.app',
  apk: 'apps/android/app/build/outputs/apk/release/app-release.apk',
  ipa: 'apps/ios/build/RemoteCodex.ipa',
  output: '.local/mobile-release/verification.json',
};
const paths = Object.fromEntries(
  Object.entries(defaults).map(([key, value]) => [
    key,
    resolve(args[key] ?? value),
  ]),
);
const failures = [];
const suites = {};

const androidConnected = inspectAndroidSuite(
  paths.androidConnected,
  'androidConnected',
  15,
);
if (androidConnected) {
  requireText(
    androidConnected.xml,
    'ClaudeComposerE2ETest',
    'Android real Claude composer E2E',
  );
  requireText(
    androidConnected.xml,
    'MobileProviderSettingsE2ETest',
    'Android Local provider settings E2E',
  );
  requireText(
    androidConnected.xml,
    'SupervisorConnectionSetupScreenServerE2ETest',
    'Android Server connection E2E',
  );
  requireText(
    androidConnected.xml,
    'RelayStreamingProjectionE2ETest',
    'Android Relay streaming E2E',
  );
  requireText(
    androidConnected.xml,
    'RelayWebSocketE2ETest',
    'Android Relay WebSocket E2E',
  );
}
inspectAndroidUnitSuites(paths.androidUnitDir, 342);

const iosSpecs = [
  ['iosUnit', paths.iosUnit, 72],
  ['iosFixture', paths.iosFixture, 13],
  ['iosLocalA', paths.iosLocalA, 19],
  ['iosLocalB', paths.iosLocalB, 10],
  ['iosServer', paths.iosServer, 3],
  ['iosRelay', paths.iosRelay, 5],
  ['ios27', paths.ios27, 1],
  ['iosRealProviders', paths.iosRealProviders, 10],
];
for (const [key, resultPath, minimumTests] of iosSpecs) {
  inspectXcresult(resultPath, key, minimumTests);
}

const apk = inspectApk(paths.apk);
const ipa = args.simulatorOnly ? null : inspectIpa(paths.ipa);
const iosSimulatorApp = args.simulatorOnly
  ? inspectSimulatorApp(paths.iosSimulatorApp)
  : null;
const commit = git(['rev-parse', 'HEAD']).trim();
const trackedStatus = git([
  'status',
  '--porcelain',
  '--untracked-files=no',
]).trim();
if (trackedStatus) {
  failures.push(
    `tracked worktree must be clean: ${trackedStatus.split('\n')[0]}`,
  );
}

if (failures.length > 0) {
  console.error('Mobile release verification is incomplete:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

const evidence = {
  status: 'passed',
  verificationKind: args.simulatorOnly
    ? 'simulator-parity'
    : 'publishable-release',
  version: packageJson.version,
  commit,
  threadUiCommit: mobileBuild.threadUiCommit,
  completedAt: new Date().toISOString(),
  requiredTestsSkipped: 0,
  matrix: {
    androidAosp: { local: 'passed', server: 'passed', relay: 'passed' },
    iosSimulator: { local: 'passed', server: 'passed', relay: 'passed' },
  },
  testSuites: suites,
  artifacts: args.simulatorOnly
    ? {
        apk: { path: relative(paths.apk), sha256: apk.sha256 },
        iosSimulatorApp: {
          path: relative(paths.iosSimulatorApp),
          sha256: iosSimulatorApp.sha256,
        },
      }
    : {
        apk: { path: relative(paths.apk), sha256: apk.sha256 },
        ipa: { path: relative(paths.ipa), sha256: ipa.sha256 },
      },
};
fs.mkdirSync(path.dirname(paths.output), { recursive: true });
fs.writeFileSync(paths.output, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify(evidence, null, 2));
console.log(`Wrote ${relative(paths.output)}`);

function inspectAndroidSuite(filePath, key, minimumTests) {
  if (!fs.existsSync(filePath)) {
    failures.push(`${key} result is missing: ${relative(filePath)}`);
    return null;
  }
  const summary = junitSummary(filePath);
  suites[key] = { ...summary, path: relative(filePath) };
  validateSummary(key, summary, minimumTests);
  return { summary, xml: fs.readFileSync(filePath, 'utf8') };
}

function inspectAndroidUnitSuites(directory, minimumTests) {
  if (!fs.existsSync(directory)) {
    failures.push(
      `androidUnit result directory is missing: ${relative(directory)}`,
    );
    return;
  }
  const files = fs
    .readdirSync(directory)
    .filter((name) => name.endsWith('.xml'))
    .map((name) => path.join(directory, name));
  if (files.length === 0) {
    failures.push(`androidUnit has no JUnit XML files: ${relative(directory)}`);
    return;
  }
  const summary = files.map(junitSummary).reduce(
    (total, item) => ({
      tests: total.tests + item.tests,
      failures: total.failures + item.failures,
      errors: total.errors + item.errors,
      skipped: total.skipped + item.skipped,
    }),
    { tests: 0, failures: 0, errors: 0, skipped: 0 },
  );
  suites.androidUnit = { ...summary, path: relative(directory) };
  validateSummary('androidUnit', summary, minimumTests);
}

function junitSummary(filePath) {
  const attribute = (name) => {
    const output = run('xmllint', [
      '--xpath',
      `string(/testsuite/@${name})`,
      filePath,
    ]).trim();
    return Number.parseInt(output || '0', 10);
  };
  return {
    tests: attribute('tests'),
    failures: attribute('failures'),
    errors: attribute('errors'),
    skipped: attribute('skipped'),
  };
}

function inspectXcresult(resultPath, key, minimumTests) {
  if (!fs.existsSync(resultPath)) {
    failures.push(`${key} xcresult is missing: ${relative(resultPath)}`);
    return;
  }
  let summary;
  try {
    summary = JSON.parse(
      run(
        'xcrun',
        [
          'xcresulttool',
          'get',
          'test-results',
          'summary',
          '--path',
          resultPath,
          '--compact',
        ],
        { DEVELOPER_DIR: resolveXcodeDeveloperDir() },
      ),
    );
  } catch (error) {
    failures.push(`${key} xcresult is unreadable: ${error.message}`);
    return;
  }
  const normalized = {
    tests: summary.totalTestCount ?? 0,
    passed: summary.passedTests ?? 0,
    failures: summary.failedTests ?? 0,
    skipped: summary.skippedTests ?? 0,
    path: relative(resultPath),
  };
  suites[key] = normalized;
  validateSummary(
    key,
    {
      tests: normalized.tests,
      failures: normalized.failures,
      errors: summary.result === 'Passed' ? 0 : 1,
      skipped: normalized.skipped,
    },
    minimumTests,
  );
}

function inspectApk(apkPath) {
  if (!fs.existsSync(apkPath)) {
    failures.push(`release APK is missing: ${relative(apkPath)}`);
    return { sha256: '' };
  }
  const tools = androidBuildTools();
  const badging = run(tools.aapt, ['dump', 'badging', apkPath]);
  const packageLine =
    badging.split('\n').find((line) => line.startsWith('package:')) ?? '';
  assertMatch(
    packageLine,
    `name='${mobileBuild.androidApplicationId}'`,
    'APK application id',
  );
  assertMatch(
    packageLine,
    `versionName='${packageJson.version}'`,
    'APK versionName',
  );
  assertMatch(
    packageLine,
    `versionCode='${versionCode(packageJson.version)}'`,
    'APK versionCode',
  );
  const signing = run(
    tools.apksigner,
    ['verify', '--verbose', '--print-certs', apkPath],
    { JAVA_HOME: resolveJavaHome() },
  );
  assertMatch(signing, 'Verifies', 'APK signature verification');
  const actualCertificate =
    /certificate SHA-256 digest:\s*([0-9a-f:]+)/i
      .exec(signing)?.[1]
      ?.replaceAll(':', '')
      .toLowerCase();
  const expectedCertificate = (mobileBuild.androidReleaseCertificateSha256 ?? '')
    .replaceAll(':', '')
    .toLowerCase();
  if (!expectedCertificate) {
    failures.push('config/mobile-build.json must pin androidReleaseCertificateSha256');
  } else if (actualCertificate !== expectedCertificate) {
    failures.push(
      `APK signer must be ${expectedCertificate}, received ${actualCertificate ?? 'unknown'}`,
    );
  }
  return { sha256: sha256(apkPath) };
}

function inspectIpa(ipaPath) {
  if (!fs.existsSync(ipaPath)) {
    failures.push(`release IPA is missing: ${relative(ipaPath)}`);
    return { sha256: '' };
  }
  const temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'remote-codex-ipa-'),
  );
  try {
    run('unzip', ['-q', ipaPath, '-d', temporaryDirectory]);
    const payload = path.join(temporaryDirectory, 'Payload');
    const appName = fs
      .readdirSync(payload)
      .find((name) => name.endsWith('.app'));
    if (!appName) throw new Error('IPA does not contain Payload/*.app');
    const appPath = path.join(payload, appName);
    const infoPath = path.join(appPath, 'Info.plist');
    assertEqual(
      plist(infoPath, 'CFBundleIdentifier'),
      mobileBuild.iosBundleId,
      'IPA bundle id',
    );
    assertEqual(
      plist(infoPath, 'CFBundleShortVersionString'),
      packageJson.version,
      'IPA version',
    );
    assertEqual(
      plist(infoPath, 'CFBundleVersion'),
      String(versionCode(packageJson.version)),
      'IPA build',
    );
    run('codesign', ['--verify', '--deep', '--strict', appPath]);
    const signing = runCombined('codesign', ['-dvv', appPath]);
    const team = /^TeamIdentifier=(.+)$/m.exec(signing)?.[1]?.trim();
    assertEqual(team, mobileBuild.iosDevelopmentTeam, 'IPA signing team');
  } catch (error) {
    failures.push(`IPA validation failed: ${error.message}`);
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
  return { sha256: sha256(ipaPath) };
}

function inspectSimulatorApp(appPath) {
  if (!fs.existsSync(appPath)) {
    failures.push(`iOS Release Simulator app is missing: ${relative(appPath)}`);
    return { sha256: '' };
  }
  const infoPath = path.join(appPath, 'Info.plist');
  try {
    assertEqual(
      plist(infoPath, 'CFBundleIdentifier'),
      mobileBuild.iosBundleId,
      'Simulator app bundle id',
    );
    assertEqual(
      plist(infoPath, 'CFBundleShortVersionString'),
      packageJson.version,
      'Simulator app version',
    );
    assertEqual(
      plist(infoPath, 'CFBundleVersion'),
      String(versionCode(packageJson.version)),
      'Simulator app build',
    );
    const executable = plist(infoPath, 'CFBundleExecutable');
    if (!fs.existsSync(path.join(appPath, executable))) {
      failures.push(`Simulator app executable is missing: ${executable}`);
    }
  } catch (error) {
    failures.push(`iOS Release Simulator app validation failed: ${error.message}`);
  }
  return { sha256: sha256Directory(appPath) };
}

function validateSummary(key, summary, minimumTests) {
  if (summary.tests < minimumTests) {
    failures.push(
      `${key} must contain at least ${minimumTests} tests, received ${summary.tests}`,
    );
  }
  if (summary.failures !== 0 || summary.errors !== 0 || summary.skipped !== 0) {
    failures.push(
      `${key} must be green with 0 skip, received failures=${summary.failures}, errors=${summary.errors}, skipped=${summary.skipped}`,
    );
  }
}

function requireText(value, expected, label) {
  if (!value.includes(expected))
    failures.push(`${label} is missing from Android connected evidence`);
}

function androidBuildTools() {
  const androidHome =
    process.env.ANDROID_HOME ?? path.join(os.homedir(), 'Library/Android/sdk');
  const root = path.join(androidHome, 'build-tools');
  if (!fs.existsSync(root))
    throw new Error(`Android build-tools not found at ${root}`);
  const version = fs
    .readdirSync(root)
    .sort(compareVersions)
    .reverse()
    .find(
      (candidate) =>
        fs.existsSync(path.join(root, candidate, 'aapt')) &&
        fs.existsSync(path.join(root, candidate, 'apksigner')),
    );
  if (!version) throw new Error('aapt and apksigner were not found');
  return {
    aapt: path.join(root, version, 'aapt'),
    apksigner: path.join(root, version, 'apksigner'),
  };
}

function compareVersions(left, right) {
  return left.localeCompare(right, undefined, { numeric: true });
}

function plist(filePath, key) {
  return run('plutil', ['-extract', key, 'raw', '-o', '-', filePath]).trim();
}

function versionCode(version) {
  return version
    .split('.')
    .slice(0, 3)
    .reduce((code, part) => code * 100 + Number.parseInt(part, 10), 0);
}

function sha256(filePath) {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(filePath))
    .digest('hex');
}

function sha256Directory(directory) {
  const hash = crypto.createHash('sha256');
  const visit = (current) => {
    for (const entry of fs.readdirSync(current).sort()) {
      const absolute = path.join(current, entry);
      const relativePath = path.relative(directory, absolute);
      const stat = fs.lstatSync(absolute);
      hash.update(relativePath);
      if (stat.isDirectory()) {
        visit(absolute);
      } else if (stat.isSymbolicLink()) {
        hash.update(fs.readlinkSync(absolute));
      } else {
        hash.update(fs.readFileSync(absolute));
      }
    }
  };
  visit(directory);
  return hash.digest('hex');
}

function resolveJavaHome() {
  return (
    process.env.JAVA_HOME ??
    '/Applications/Android Studio.app/Contents/jbr/Contents/Home'
  );
}

function resolveXcodeDeveloperDir() {
  if (process.env.DEVELOPER_DIR) return process.env.DEVELOPER_DIR;
  for (const candidate of [
    '/Applications/Xcode.app/Contents/Developer',
    '/Applications/Xcode-beta.app/Contents/Developer',
  ]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error('Xcode developer directory was not found');
}

function assertMatch(actual, expected, label) {
  if (!actual.includes(expected))
    failures.push(`${label} must contain ${expected}`);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected)
    failures.push(
      `${label} must be ${expected}, received ${actual ?? 'unknown'}`,
    );
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function git(commandArgs) {
  return run('git', commandArgs);
}

function run(command, commandArgs, extraEnv = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: repoRoot,
    env: { ...process.env, ...extraEnv },
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(
      (result.stderr || result.stdout || `${command} failed`).trim(),
    );
  }
  return result.stdout;
}

function runCombined(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0)
    throw new Error((result.stderr || result.stdout).trim());
  return `${result.stdout}\n${result.stderr}`;
}

function resolve(value) {
  return path.resolve(repoRoot, value);
}

function relative(value) {
  return path.relative(repoRoot, value) || '.';
}

function parseArgs(values) {
  const parsed = {};
  const keys = new Map([
    ['--android-connected', 'androidConnected'],
    ['--android-unit-dir', 'androidUnitDir'],
    ['--ios-unit', 'iosUnit'],
    ['--ios-fixture', 'iosFixture'],
    ['--ios-local-a', 'iosLocalA'],
    ['--ios-local-b', 'iosLocalB'],
    ['--ios-server', 'iosServer'],
    ['--ios-relay', 'iosRelay'],
    ['--ios-27', 'ios27'],
    ['--ios-real-providers', 'iosRealProviders'],
    ['--ios-simulator-app', 'iosSimulatorApp'],
    ['--apk', 'apk'],
    ['--ipa', 'ipa'],
    ['--output', 'output'],
  ]);
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === '--') continue;
    if (value === '--simulator-only') {
      parsed.simulatorOnly = true;
      continue;
    }
    if (value === '-h' || value === '--help') {
      parsed.help = true;
      continue;
    }
    const key = keys.get(value);
    if (!key) throw new Error(`Unknown argument: ${value}`);
    const argument = values[++index];
    if (!argument) throw new Error(`Missing value for ${value}`);
    parsed[key] = argument;
  }
  return parsed;
}

function printHelp() {
  console.log(`Collect and validate publishable mobile verification evidence.

Usage:
  pnpm verify:mobile:release-gate -- [options]

The default paths point at .local/mobile-parity/evidence plus the release APK/IPA.
The command fails closed and does not write verification.json unless every required
suite is green with zero skips, the real-provider suite passes, and both artifacts
match the configured version, ids, signing team, and pinned Android certificate.

Use --simulator-only for the app-parity gate. It validates the signed Android
release APK and the iOS Release Simulator .app without requiring a device IPA.
`);
}
