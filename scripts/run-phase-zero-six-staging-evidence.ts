import { spawn } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
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

function commandOkForBundle(result: CommandResult) {
  if (result.name === 'verify_phase_zero_six_evidence') {
    return result.exitCode === 0 && Boolean(parseJsonOutput(result));
  }
  if (result.name === 'verify_phase_zero_six_evidence_apply') {
    const parsed = parseJsonOutput(result) as {
      apply?: { applied?: unknown };
      checkedButContradicted?: unknown[];
    } | null;
    return (
      result.exitCode === 0 &&
      parsed?.apply?.applied === true &&
      Array.isArray(parsed.checkedButContradicted) &&
      parsed.checkedButContradicted.length === 0
    );
  }
  return commandOk(result);
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

function phaseVerificationComplete(result: CommandResult | undefined) {
  const parsed = result ? parseJsonOutput(result) as { ok?: unknown } | null : null;
  return result?.exitCode === 0 && parsed?.ok === true;
}

function checklistReadinessSummary(result: CommandResult | undefined) {
  const parsed = result ? parseJsonOutput(result) as {
    checkedCount?: unknown;
    uncheckedCount?: unknown;
    readyToCheck?: unknown;
    stillMissing?: unknown;
    checkedButContradicted?: unknown;
  } | null : null;
  return {
    checkedCount: typeof parsed?.checkedCount === 'number' ? parsed.checkedCount : null,
    uncheckedCount: typeof parsed?.uncheckedCount === 'number' ? parsed.uncheckedCount : null,
    readyToCheck: Array.isArray(parsed?.readyToCheck) ? parsed.readyToCheck : [],
    stillMissing: Array.isArray(parsed?.stillMissing) ? parsed.stillMissing : [],
    checkedButContradicted: Array.isArray(parsed?.checkedButContradicted)
      ? parsed.checkedButContradicted
      : [],
  };
}

function successfulCommandNamesForPartialEvidence() {
  return new Set([
    'verify_phase_zero_six_evidence',
  ]);
}

function commandRequiredForBundleSuccess(result: CommandResult) {
  return !successfulCommandNamesForPartialEvidence().has(result.name);
}

function commandSummary(result: CommandResult) {
  const parsed = parseJsonOutput(result) as { ok?: unknown } | null;
  return {
    name: result.name,
    exitCode: result.exitCode,
    ok: commandOkForBundle(result),
    rawOk: commandOk(result),
    outputPath: result.outputPath,
    parsedOk: parsed?.ok ?? null,
    stderr: result.stderr.slice(0, 4000),
  };
}

function envReadinessSummary(result: CommandResult | undefined) {
  const parsed = result ? parseJsonOutput(result) as {
    readyGroups?: unknown;
    notReadyGroups?: unknown;
    groups?: unknown;
  } | null : null;
  return envReadinessSummaryFromParsed(parsed);
}

function envReadinessSummaryFromParsed(parsed: {
  readyGroups?: unknown;
  notReadyGroups?: unknown;
  groups?: unknown;
  itemReadiness?: unknown;
  nextCommands?: unknown;
} | null) {
  const groups = Array.isArray(parsed?.groups) ? parsed.groups : [];
  return {
    readyGroups: Array.isArray(parsed?.readyGroups) ? parsed.readyGroups : [],
    notReadyGroups: Array.isArray(parsed?.notReadyGroups) ? parsed.notReadyGroups : [],
    groups: groups.map((group) => {
      const entry = group as {
        id?: unknown;
        items?: unknown;
        ready?: unknown;
        missingEnv?: unknown;
        missingRecommendedEnv?: unknown;
      };
      return {
        id: typeof entry.id === 'string' ? entry.id : null,
        items: Array.isArray(entry.items) ? entry.items : [],
        ready: entry.ready === true,
        missingEnv: Array.isArray(entry.missingEnv) ? entry.missingEnv : [],
        missingRecommendedEnv: Array.isArray(entry.missingRecommendedEnv)
          ? entry.missingRecommendedEnv
          : [],
      };
    }),
    itemReadiness: Array.isArray(parsed?.itemReadiness) ? parsed.itemReadiness : [],
    nextCommands: parsed?.nextCommands && typeof parsed.nextCommands === 'object'
      ? parsed.nextCommands
      : null,
  };
}

async function readEnvReadinessSummary(filePath: string) {
  try {
    const raw = await readFile(filePath, 'utf8');
    return envReadinessSummaryFromParsed(JSON.parse(raw) as {
      readyGroups?: unknown;
      notReadyGroups?: unknown;
      groups?: unknown;
      itemReadiness?: unknown;
      nextCommands?: unknown;
    });
  } catch {
    return envReadinessSummaryFromParsed(null);
  }
}

function nextSteps(input: {
  outputDir: string;
  fromOutputDir: string | null;
  envTemplatePath: string;
  skippedStagingSmoke: boolean;
  applyReady: boolean;
}) {
  const reuseArgs = input.fromOutputDir ? [`--from-output-dir ${input.fromOutputDir}`] : [];
  return {
    fillEnvTemplate: `Fill ${input.envTemplatePath} in a private operator shell; do not commit filled values.`,
    sourceEnvTemplate: `source ${input.envTemplatePath}`,
    verifyEnvReadiness: input.skippedStagingSmoke
      ? 'pnpm verify:phase-zero-six-env-ready -- --skip-staging-smoke'
      : 'pnpm verify:phase-zero-six-env-ready',
    rerunBundle: [
      'pnpm collect:phase-zero-six-evidence --',
      ...reuseArgs,
      `--output-dir ${input.outputDir}`,
      ...(input.skippedStagingSmoke ? ['--skip-staging-smoke'] : []),
      ...(input.applyReady ? ['--apply-ready'] : []),
    ].join(' '),
    applyChecklistAfterReview: [
      'pnpm collect:phase-zero-six-evidence --',
      ...reuseArgs,
      `--output-dir ${input.outputDir}-apply`,
      ...(input.skippedStagingSmoke ? ['--skip-staging-smoke'] : []),
      '--apply-ready',
    ].join(' '),
  };
}

async function missingRequiredEvidenceFiles(input: {
  awsPath: string;
  stagingPath: string;
  skipStagingSmoke: boolean;
}) {
  const required = [
    input.awsPath,
    ...(input.skipStagingSmoke ? [] : [input.stagingPath]),
  ];
  const missing: string[] = [];
  for (const filePath of required) {
    try {
      await access(filePath);
    } catch {
      missing.push(filePath);
    }
  }
  return missing;
}

async function main() {
  const outputDir =
    argValue('--output-dir') ??
    path.join('artifacts', 'phase-zero-six-evidence', timestampForPath());
  const fromOutputDir = argValue('--from-output-dir');
  const applyReady = hasFlag('--apply-ready');
  const force = hasFlag('--force');
  const checklistPath = argValue('--checklist');
  const reuseExistingArtifacts = Boolean(fromOutputDir);
  await mkdir(outputDir, { recursive: true });

  const evidenceDir = fromOutputDir ?? outputDir;
  const envReadinessPath = path.join(evidenceDir, 'env-readiness.json');
  const envTemplatePath = path.join(
    evidenceDir,
    hasFlag('--skip-staging-smoke') ? 'aws-preflight.env.sh' : 'phase-zero-six.env.sh',
  );
  const awsPath = path.join(evidenceDir, 'aws-staging-preflight.json');
  const stagingPath = path.join(evidenceDir, 'staging-phase-one-smoke.json');
  const awsVerificationPath = path.join(outputDir, 'aws-staging-preflight-verification.json');
  const stagingVerificationPath = path.join(outputDir, 'staging-phase-one-verification.json');
  const phaseVerificationPath = path.join(outputDir, 'phase-zero-six-verification.json');
  const phaseApplyPath = path.join(outputDir, 'phase-zero-six-apply.json');
  const artifactSafetyPath = path.join(outputDir, 'artifact-secret-scan.json');
  const inputArtifactSafetyPath = path.join(outputDir, 'artifact-secret-scan-input.json');
  const outputArtifactSafetyPath = path.join(outputDir, 'artifact-secret-scan-output.json');
  const postApplyArtifactSafetyPath = path.join(outputDir, 'artifact-secret-scan-post-apply.json');
  const summaryPath = path.join(outputDir, 'summary.json');

  const commands: CommandResult[] = [];

  if (reuseExistingArtifacts) {
    const missingEvidenceFiles = await missingRequiredEvidenceFiles({
      awsPath,
      stagingPath,
      skipStagingSmoke: hasFlag('--skip-staging-smoke'),
    });
    if (missingEvidenceFiles.length > 0) {
      const summary = {
        ok: false,
        generatedAt: new Date().toISOString(),
        outputDir,
        fromOutputDir,
        reuseExistingArtifacts,
        applyReady,
        force,
        checklistPath,
        skippedStagingSmoke: hasFlag('--skip-staging-smoke'),
        stoppedAfterEnvReadiness: false,
        phaseZeroSixComplete: false,
        reason: 'Reviewed artifact reuse requested, but required evidence files are missing.',
        missingEvidenceFiles,
        envReadiness: await readEnvReadinessSummary(envReadinessPath),
        nextSteps: nextSteps({
          outputDir,
          fromOutputDir,
          envTemplatePath,
          skippedStagingSmoke: hasFlag('--skip-staging-smoke'),
          applyReady,
        }),
        artifacts: {
          envReadiness: envReadinessPath,
          envTemplate: envTemplatePath,
          awsPreflight: awsPath,
          stagingSmoke: hasFlag('--skip-staging-smoke') ? null : stagingPath,
          awsVerification: null,
          stagingVerification: null,
          phaseZeroSixVerification: null,
          phaseZeroSixApply: null,
          artifactSecretScan: null,
          summary: summaryPath,
        },
        results: [],
      };
      await writeFile(summaryPath, JSON.stringify(summary, null, 2));
      console.log(JSON.stringify(summary, null, 2));
      process.exitCode = 1;
      return;
    }
  }

  if (!reuseExistingArtifacts) {
    commands.push(await runCommand({
      name: 'verify_phase_zero_six_env_ready',
      command: [
        'pnpm',
        'exec',
        'tsx',
        'scripts/verify-phase-zero-six-env-ready.ts',
        ...(hasFlag('--skip-staging-smoke') ? ['--skip-staging-smoke'] : []),
        '--write-env-template',
        envTemplatePath,
      ],
      outputPath: envReadinessPath,
    }));
  }

  if (!reuseExistingArtifacts && !commandOk(commands[0] as CommandResult) && !force) {
    const preScanSummaryPath = summaryPath;
    const summary = {
      ok: false,
      generatedAt: new Date().toISOString(),
      outputDir,
      fromOutputDir,
      reuseExistingArtifacts,
      applyReady,
      force,
      checklistPath,
      skippedStagingSmoke: hasFlag('--skip-staging-smoke'),
      stoppedAfterEnvReadiness: true,
      reason: 'Environment readiness failed. Fill missing env names or rerun with --force for diagnostic collection.',
      envReadiness: envReadinessSummary(commands[0]),
      nextSteps: nextSteps({
        outputDir,
        fromOutputDir,
        envTemplatePath,
        skippedStagingSmoke: hasFlag('--skip-staging-smoke'),
        applyReady,
      }),
      artifacts: {
        envReadiness: envReadinessPath,
        envTemplate: envTemplatePath,
        awsPreflight: null,
        stagingSmoke: null,
        awsVerification: null,
        stagingVerification: null,
        phaseZeroSixVerification: null,
        phaseZeroSixApply: null,
        artifactSecretScan: artifactSafetyPath,
        summary: preScanSummaryPath,
      },
      results: commands.map(commandSummary),
    };
    await writeFile(preScanSummaryPath, JSON.stringify(summary, null, 2));
    commands.push(await runCommand({
      name: 'verify_phase_zero_six_artifacts_safe',
      command: ['pnpm', 'exec', 'tsx', 'scripts/verify-phase-zero-six-artifacts-safe.ts', '--dir', outputDir],
      outputPath: artifactSafetyPath,
    }));
    const artifactScanPassed = commandOk(commands[commands.length - 1] as CommandResult);
    const finalSummary = {
      ...summary,
      ok: false,
      artifactScanPassed,
      reason: artifactScanPassed
        ? summary.reason
        : 'Environment readiness failed and artifact secret scan found unsafe evidence files.',
      results: commands.map(commandSummary),
    };
    await writeFile(summaryPath, JSON.stringify(finalSummary, null, 2));
    console.log(JSON.stringify(finalSummary, null, 2));
    process.exitCode = 1;
    return;
  }

  if (!reuseExistingArtifacts) {
    commands.push(await runCommand({
      name: 'collect_aws_staging_preflight_evidence',
      command: ['pnpm', 'exec', 'tsx', 'scripts/collect-aws-staging-preflight-evidence.ts'],
      outputPath: awsPath,
    }));
  }
  commands.push(await runCommand({
    name: 'verify_aws_staging_preflight_evidence',
    command: ['pnpm', 'exec', 'tsx', 'scripts/verify-aws-staging-preflight-evidence.ts', awsPath],
    outputPath: awsVerificationPath,
  }));

  if (!hasFlag('--skip-staging-smoke')) {
    if (!reuseExistingArtifacts) {
      commands.push(await runCommand({
        name: 'run_staging_phase_one_smoke',
        command: ['pnpm', 'exec', 'tsx', 'scripts/staging-phase-one-smoke.ts'],
        outputPath: stagingPath,
      }));
    }
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
  if (reuseExistingArtifacts) {
    commands.push(await runCommand({
      name: 'verify_phase_zero_six_input_artifacts_safe',
      command: ['pnpm', 'exec', 'tsx', 'scripts/verify-phase-zero-six-artifacts-safe.ts', '--dir', evidenceDir],
      outputPath: inputArtifactSafetyPath,
    }));
    commands.push(await runCommand({
      name: 'verify_phase_zero_six_output_artifacts_safe',
      command: ['pnpm', 'exec', 'tsx', 'scripts/verify-phase-zero-six-artifacts-safe.ts', '--dir', outputDir],
      outputPath: outputArtifactSafetyPath,
    }));
  } else {
    commands.push(await runCommand({
      name: 'verify_phase_zero_six_artifacts_safe',
      command: ['pnpm', 'exec', 'tsx', 'scripts/verify-phase-zero-six-artifacts-safe.ts', '--dir', outputDir],
      outputPath: artifactSafetyPath,
    }));
  }

  let phaseApplyResult: CommandResult | null = null;
  let applySkippedReason: string | null = null;
  const artifactScanResults = reuseExistingArtifacts
    ? commands.filter((result) =>
      result.name === 'verify_phase_zero_six_input_artifacts_safe' ||
      result.name === 'verify_phase_zero_six_output_artifacts_safe')
    : commands.filter((result) => result.name === 'verify_phase_zero_six_artifacts_safe');
  const artifactScanPassed = artifactScanResults.length > 0 && artifactScanResults.every(commandOk);
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
      commands.push(await runCommand({
        name: 'verify_phase_zero_six_post_apply_artifacts_safe',
        command: ['pnpm', 'exec', 'tsx', 'scripts/verify-phase-zero-six-artifacts-safe.ts', '--dir', outputDir],
        outputPath: postApplyArtifactSafetyPath,
      }));
    }
  }

  const applyCompletedOrNotRequested = !applyReady || Boolean(phaseApplyResult);
  const postApplyScanResult = commands.find((result) =>
    result.name === 'verify_phase_zero_six_post_apply_artifacts_safe');
  const postApplyScanPassed = postApplyScanResult ? commandOk(postApplyScanResult) : null;
  const requiredCommandsOk = commands
    .filter(commandRequiredForBundleSuccess)
    .every(commandOkForBundle);
  const phaseZeroSixComplete = phaseVerificationComplete(phaseApplyResult ?? phaseVerification);
  const readinessSummary = reuseExistingArtifacts
    ? await readEnvReadinessSummary(envReadinessPath)
    : envReadinessSummary(commands[0]);
  const summary = {
    ok: requiredCommandsOk && applyCompletedOrNotRequested,
    generatedAt: new Date().toISOString(),
    outputDir,
    fromOutputDir,
    reuseExistingArtifacts,
    applyReady,
    force,
    checklistPath,
    skippedStagingSmoke: hasFlag('--skip-staging-smoke'),
    stoppedAfterEnvReadiness: false,
    phaseZeroSixComplete,
    checklistReadiness: checklistReadinessSummary(phaseVerification),
    applySkippedReason,
    postApplyScanPassed,
    envReadiness: readinessSummary,
    nextSteps: nextSteps({
      outputDir,
      fromOutputDir,
      envTemplatePath,
      skippedStagingSmoke: hasFlag('--skip-staging-smoke'),
      applyReady,
    }),
    artifacts: {
      envReadiness: envReadinessPath,
      envTemplate: envTemplatePath,
      awsPreflight: awsPath,
      stagingSmoke: hasFlag('--skip-staging-smoke') ? null : stagingPath,
      awsVerification: awsVerificationPath,
      stagingVerification: hasFlag('--skip-staging-smoke') ? null : stagingVerificationPath,
      phaseZeroSixVerification: phaseVerificationPath,
      phaseZeroSixApply: phaseApplyResult ? phaseApplyPath : null,
      artifactSecretScan: reuseExistingArtifacts ? null : artifactSafetyPath,
      inputArtifactSecretScan: reuseExistingArtifacts ? inputArtifactSafetyPath : null,
      outputArtifactSecretScan: reuseExistingArtifacts ? outputArtifactSafetyPath : null,
      postApplyArtifactSecretScan: postApplyScanResult ? postApplyArtifactSafetyPath : null,
      summary: summaryPath,
    },
    results: commands.map(commandSummary),
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
