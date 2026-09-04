#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), '..');

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  const channel = process.argv[2] ?? 'next';
  const inputDir = path.resolve(
    process.argv[3] ?? path.join(repoRoot, 'dist', 'npm'),
  );
  const manifest = JSON.parse(
    fs.readFileSync(path.join(inputDir, 'manifest.json'), 'utf8'),
  );

  publishRelease({
    channel,
    inputDir,
    manifest,
    dryRun: process.argv.includes('--dry-run'),
    allowLatest: process.env.REMOTE_CODEX_ALLOW_LATEST === '1',
    runNpm(args, options = {}) {
      return spawnSync('npm', args, {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: options.inherit ? 'inherit' : 'pipe',
      });
    },
  });
}

export function publishRelease({
  channel,
  inputDir,
  manifest,
  dryRun = false,
  allowLatest = false,
  runNpm,
  log = console.log,
  registryRetryDelayMs = 2_000,
}) {
  if (!['next', 'latest'].includes(channel)) {
    throw new Error('Release channel must be next or latest');
  }
  if (channel === 'latest' && !allowLatest) {
    throw new Error(
      'Set REMOTE_CODEX_ALLOW_LATEST=1 to publish the latest channel',
    );
  }
  if (typeof runNpm !== 'function') {
    throw new Error('An npm command runner is required');
  }

  const versions = new Set(manifest.packages.map((entry) => entry.version));
  if (versions.size !== 1) {
    throw new Error('Release manifest contains mixed package versions');
  }
  const [releaseVersion] = versions;
  if (channel === 'latest' && releaseVersion.includes('-')) {
    throw new Error(
      `Refusing to publish prerelease ${releaseVersion} to latest`,
    );
  }

  const packages = [
    ...manifest.packages.filter((entry) => entry.kind === 'native'),
    ...manifest.packages.filter((entry) => entry.kind === 'launcher'),
  ];

  // Check every immutable version before making any registry changes. This keeps
  // an integrity conflict in a later package from causing a partial promotion.
  const releaseEntries = packages.map((entry) => {
    const spec = `${entry.name}@${entry.version}`;
    const existing = registryIntegrity(spec, runNpm);
    if (existing && existing !== entry.integrity) {
      throw new Error(`${spec} already exists with different integrity`);
    }
    return { entry, existing, spec };
  });

  // npm versions are immutable but dist-tags are independent mutable pointers.
  // Always set the requested tag, including when every version already existed
  // from an earlier `next` release. The launcher is deliberately tagged last.
  const groups = [
    releaseEntries.filter(({ entry }) => entry.kind === 'native'),
    releaseEntries.filter(({ entry }) => entry.kind === 'launcher'),
  ];
  for (const entries of groups) {
    for (const { entry, existing, spec } of entries) {
      if (existing) {
        log(`Already published with matching integrity: ${spec}`);
        continue;
      }

      const archive = path.join(inputDir, entry.filename);
      const args = ['publish', archive, '--tag', channel, '--access', 'public'];
      if (dryRun) args.push('--dry-run');
      const result = runNpm(args, { inherit: true });
      assertCommandSucceeded(result, `npm publish failed for ${spec}`);

      if (!dryRun) {
        let published = null;
        for (let attempt = 0; attempt < 6 && !published; attempt += 1) {
          if (attempt > 0) sleepSync(registryRetryDelayMs);
          published = registryIntegrity(spec, runNpm);
        }
        if (published !== entry.integrity) {
          throw new Error(`Published integrity mismatch for ${spec}`);
        }
      }
    }

    for (const { spec } of entries) {
      if (dryRun) {
        log(`Would set npm dist-tag ${channel}: ${spec}`);
        continue;
      }
      const result = runNpm(['dist-tag', 'add', spec, channel], {
        inherit: true,
      });
      assertCommandSucceeded(
        result,
        `npm dist-tag add failed for ${spec} (${channel})`,
      );
      log(`Set npm dist-tag ${channel}: ${spec}`);
    }
  }
}

function sleepSync(milliseconds) {
  if (milliseconds <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function registryIntegrity(spec, runNpm) {
  const result = runNpm(['view', spec, 'dist.integrity', '--json']);
  if (result.error) {
    throw new Error(`npm view failed for ${spec}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    if (isRegistryNotFound(result)) return null;
    throw new Error(`npm view failed for ${spec}${commandOutput(result)}`);
  }

  try {
    const value = JSON.parse(result.stdout);
    if (typeof value === 'string' && value) return value;
  } catch {
    // Report the malformed response below without treating it as an unpublished
    // package. Publishing after a registry or authentication error is unsafe.
  }
  throw new Error(`npm view returned no integrity for ${spec}`);
}

function isRegistryNotFound(result) {
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  return /\bE404\b|404 Not Found/i.test(output);
}

function assertCommandSucceeded(result, message) {
  if (result.error) throw new Error(`${message}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(message);
}

function commandOutput(result) {
  const output = `${result.stderr ?? ''}${result.stdout ?? ''}`.trim();
  return output ? `: ${output}` : '';
}
