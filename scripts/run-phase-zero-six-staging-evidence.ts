import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

interface CommandResult {
  name: string;
  command: string[];
  exitCode: number | null;
  stdout: string;
  stderr: string;
  outputPath?: string;
}

function argValue(name: string) {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return null;
  }
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

function hasFlag(name: string) {
  return process.argv.includes(name);
}

function timestampForPath() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function runCommand(input: {
  name: string;
  command: string[];
  outputPath?: string;
}) {
  const [binary, ...args] = input.command;
  if (!binary) {
    throw new Error(`${input.name} command is empty.`);
  }

  const child = spawn(binary, args, {
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  const exitCode = await new Promise<number | null>((resolve) => {
    child.on('close', resolve);
  });

  if (input.outputPath) {
    await writeFile(input.outputPath, stdout);
  }

  return {
    name: input.name,
    command: input.command,
    exitCode,
    stdout,
    stderr,
    outputPath: input.outputPath,
  } satisfies CommandResult;
}

function parseJsonOutput(result: CommandResult) {
  try {
    return JSON.parse(result.stdout) as unknown;
  } catch {
    return null;
  }
}

function commandOk(result: CommandResult) {
  const parsed = parseJsonOutput(result) as { ok?: unknown } | null;
  return result.exitCode === 0 && parsed?.ok !== false;
}

function phaseVerificationAllowsApply(result: CommandResult) {
  const parsed = parseJsonOutput(result) as {
    readyToCheck?: unknown[];
    checkedButContradicted?: unknown[];
  } | null;
  return Boolean(
    parsed &&
    Array.isArray(parsed.readyToCheck) &&
    parsed.readyToCheck.length > 0 &&
    Array.isArray(parsed.checkedButContradicted) &&
    parsed.checkedButContradicted.length === 0,
  );
}

async function main() {
  const outputDir =
    argValue('--output-dir') ??
    path.join('artifacts', 'phase-zero-six-evidence', timestampForPath());
  const applyReady = hasFlag('--apply-ready');
  const force = hasFlag('--force');
  const checklistPath = argValue('--checklist');
  await mkdir(outputDir, { recursive: true });

  const envReadinessPath = path.join(outputDir, 'env-readiness.json');
  const awsPath = path.join(outputDir, 'aws-staging-preflight.json');
  const stagingPath = path.join(outputDir, 'staging-phase-one-smoke.json');
  const awsVerificationPath = path.join(outputDir, 'aws-staging-preflight-verification.json');
  const stagingVerificationPath = path.join(outputDir, 'staging-phase-one-verification.json');
  const phaseVerificationPath = path.join(outputDir, 'phase-zero-six-verification.json');
  const phaseApplyPath = path.join(outputDir, 'phase-zero-six-apply.json');
  const artifactSafetyPath = path.join(outputDir, 'artifact-secret-scan.json');
  const summaryPath = path.join(outputDir, 'summary.json');

  const commands: CommandResult[] = [];

  commands.push(await runCommand({
    name: 'verify_phase_zero_six_env_ready',
    command: ['pnpm', 'exec', 'tsx', 'scripts/verify-phase-zero-six-env-ready.ts'],
    outputPath: envReadinessPath,
  }));

  if (!commandOk(commands[0]) && !force) {
    const summary = {
      ok: false,
      generatedAt: new Date().toISOString(),
      outputDir,
      applyReady,
      force,
      checklistPath,
      skippedStagingSmoke: hasFlag('--skip-staging-smoke'),
      stoppedAfterEnvReadiness: true,
      reason: 'Environment readiness failed. Fill missing env names or rerun with --force for diagnostic collection.',
      artifacts: {
        envReadiness: envReadinessPath,
        awsPreflight: null,
        stagingSmoke: null,
        awsVerification: null,
        stagingVerification: null,
        phaseZeroSixVerification: null,
        phaseZeroSixApply: null,
        artifactSecretScan: null,
        summary: summaryPath,
      },
      results: commands.map((result) => ({
        name: result.name,
        exitCode: result.exitCode,
        ok: commandOk(result),
        outputPath: result.outputPath,
        parsedOk: (parseJsonOutput(result) as { ok?: unknown } | null)?.ok ?? null,
        stderr: result.stderr.slice(0, 4000),
      })),
    };
    await writeFile(summaryPath, JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary, null, 2));
    process.exitCode = 1;
    return;
  }

  commands.push(await runCommand({
    name: 'collect_aws_staging_preflight_evidence',
    command: ['pnpm', 'exec', 'tsx', 'scripts/collect-aws-staging-preflight-evidence.ts'],
    outputPath: awsPath,
  }));
  commands.push(await runCommand({
    name: 'verify_aws_staging_preflight_evidence',
    command: ['pnpm', 'exec', 'tsx', 'scripts/verify-aws-staging-preflight-evidence.ts', awsPath],
    outputPath: awsVerificationPath,
  }));

  if (!hasFlag('--skip-staging-smoke')) {
    commands.push(await runCommand({
      name: 'run_staging_phase_one_smoke',
      command: ['pnpm', 'exec', 'tsx', 'scripts/staging-phase-one-smoke.ts'],
      outputPath: stagingPath,
    }));
    commands.push(await runCommand({
      name: 'verify_staging_phase_one_evidence',
      command: ['pnpm', 'exec', 'tsx', 'scripts/verify-staging-phase-one-evidence.ts', stagingPath],
      outputPath: stagingVerificationPath,
    }));
  }

  const phaseCommand = [
    'pnpm',
    'exec',
    'tsx',
    'scripts/verify-phase-zero-six-evidence.ts',
    ...(checklistPath ? ['--checklist', checklistPath] : []),
    '--aws-preflight',
    awsPath,
    ...(hasFlag('--skip-staging-smoke') ? [] : ['--staging-smoke', stagingPath]),
  ];
  commands.push(await runCommand({
    name: 'verify_phase_zero_six_evidence',
    command: phaseCommand,
    outputPath: phaseVerificationPath,
  }));
  commands.push(await runCommand({
    name: 'verify_phase_zero_six_artifacts_safe',
    command: ['pnpm', 'exec', 'tsx', 'scripts/verify-phase-zero-six-artifacts-safe.ts', '--dir', outputDir],
    outputPath: artifactSafetyPath,
  }));

  let phaseApplyResult: CommandResult | null = null;
  let applySkippedReason: string | null = null;
  const artifactScanPassed = commandOk(commands[commands.length - 1] as CommandResult);
  const phaseVerification = commands.find((result) => result.name === 'verify_phase_zero_six_evidence');
  if (applyReady) {
    if (!artifactScanPassed) {
      applySkippedReason = 'Artifact secret scan failed; checklist apply was not run.';
    } else if (!phaseVerification || !phaseVerificationAllowsApply(phaseVerification)) {
      applySkippedReason = 'Read-only Phase 0-6 verification found no ready checklist boxes or found contradicted checked boxes.';
    } else {
      phaseApplyResult = await runCommand({
        name: 'verify_phase_zero_six_evidence_apply',
        command: [
          ...phaseCommand,
          '--apply-ready',
        ],
        outputPath: phaseApplyPath,
      });
      commands.push(phaseApplyResult);
    }
  }

  const applyCompletedOrNotRequested = !applyReady || Boolean(phaseApplyResult);
  const summary = {
    ok: commands.every(commandOk) && applyCompletedOrNotRequested,
    generatedAt: new Date().toISOString(),
    outputDir,
    applyReady,
    force,
    checklistPath,
    skippedStagingSmoke: hasFlag('--skip-staging-smoke'),
    stoppedAfterEnvReadiness: false,
    applySkippedReason,
    artifacts: {
      envReadiness: envReadinessPath,
      awsPreflight: awsPath,
      stagingSmoke: hasFlag('--skip-staging-smoke') ? null : stagingPath,
      awsVerification: awsVerificationPath,
      stagingVerification: hasFlag('--skip-staging-smoke') ? null : stagingVerificationPath,
      phaseZeroSixVerification: phaseVerificationPath,
      phaseZeroSixApply: phaseApplyResult ? phaseApplyPath : null,
      artifactSecretScan: artifactSafetyPath,
      summary: summaryPath,
    },
    results: commands.map((result) => ({
      name: result.name,
      exitCode: result.exitCode,
      ok: commandOk(result),
      outputPath: result.outputPath,
      parsedOk: (parseJsonOutput(result) as { ok?: unknown } | null)?.ok ?? null,
      stderr: result.stderr.slice(0, 4000),
    })),
  };

  await writeFile(summaryPath, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));

  if (!summary.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exit(1);
});
