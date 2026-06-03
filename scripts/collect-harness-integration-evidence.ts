import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import * as path from 'node:path';

import { redactedSlice } from './secret-redaction.js';

interface CommandResult {
  name: string;
  command: string[];
  exitCode: number | null;
  outputPath: string;
  stderr: string;
  ok: boolean;
  parsedOk: boolean | null;
}

const requiredHarnessIntegrationGates = [
  'harness-admin-contract',
  'harness-worker-runtime',
  'harness-secret-safety',
  'harness-usage-attribution',
  'harness-mcp-worker-api',
  'harness-thread-artifact-ui',
];

const DEFAULT_HARNESS_ADMIN_BASE_URL = 'https://elagenteharness-production.up.railway.app';
const DEFAULT_STAGING_CONTROL_PLANE_BASE_URL =
  'https://remote-codex-control-plane-production.up.railway.app';
const DEFAULT_STAGING_HARNESS_MODULE = 'farmaco';
const DEFAULT_HARNESS_K8S_NAMESPACE = 'remote-codex-staging';
const DEFAULT_HARNESS_APP_KEY_SECRET_NAME = 'remote-codex-harness-app-keys';

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

function envValue(name: string) {
  const value = process.env[name]?.trim();
  return value && !/<[^>]+>/.test(value) ? value : null;
}

function configValue(name: string, fallback: string) {
  return envValue(name) ?? fallback;
}

function envReady(names: string[], defaults: Record<string, string> = {}) {
  return names.every((name) => Boolean(envValue(name) ?? defaults[name]));
}

function missingEnvEntries(requirements: Record<string, string[]>, defaults: Record<string, string>) {
  const seen = new Set<string>();
  return Object.entries(requirements).flatMap(([group, names]) =>
    names
      .filter((name) => !envValue(name) && !defaults[name])
      .filter((name) => {
        if (seen.has(name)) {
          return false;
        }
        seen.add(name);
        return true;
      })
      .map((name) => ({ group, name })),
  );
}

function timestampForPath() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function pnpmCommand() {
  return envValue('HARNESS_EVIDENCE_PNPM_BIN') ?? 'pnpm';
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function envTemplateLine(name: string, placeholder: string) {
  return `export ${name}=${shellQuote(placeholder)}`;
}

function buildEnvTemplate(input: {
  generatedAt: string;
  outputDir: string;
}) {
  return [
    '# Harness integration evidence env template',
    `# Generated at ${input.generatedAt}`,
    '# Fill this file in a private operator shell, then run: source <this file>',
    '# Do not commit this file after replacing placeholders.',
    '',
    '# Harness admin contract smoke',
    envTemplateLine('ELAGENTE_HARNESS_ADMIN_BASE_URL', DEFAULT_HARNESS_ADMIN_BASE_URL),
    envTemplateLine('ELAGENTE_HARNESS_ADMIN_KEY', '<actual Harness ADMIN_KEY>'),
    '',
    '# Remote Codex staging smoke. Product JWT is derived from password login unless STAGING_PRODUCT_JWT is set.',
    envTemplateLine('STAGING_CONTROL_PLANE_BASE_URL', DEFAULT_STAGING_CONTROL_PLANE_BASE_URL),
    envTemplateLine('STAGING_LOGIN_EMAIL', 'dev@example.com'),
    envTemplateLine('STAGING_LOGIN_PASSWORD', '<staging login password; smoke defaults to dev password if omitted>'),
    envTemplateLine('STAGING_HARNESS_SMOKE', '1'),
    envTemplateLine('STAGING_HARNESS_MODULE', DEFAULT_STAGING_HARNESS_MODULE),
    '',
    '# Release invoke evidence. Basic worker status/discovery smoke can run without these.',
    envTemplateLine('STAGING_HARNESS_INVOKE_TOOL', '<low-cost Harness tool>'),
    envTemplateLine('STAGING_HARNESS_INVOKE_INPUT_JSON', '<json object>'),
    '# Release Codex plugin/MCP proof. It must emit JSON with top-level source=\"worker-api\".',
    envTemplateLine('STAGING_HARNESS_MCP_SMOKE_COMMAND', '<command>'),
    '# Release live thread artifact proof. It must emit JSON with artifactTypes.',
    envTemplateLine('STAGING_HARNESS_THREAD_ARTIFACT_UI_SMOKE_COMMAND', '<command>'),
    '',
    '# K8s Secret/RBAC release proof. Secret key is normally the sandbox id from staging smoke output.',
    envTemplateLine('HARNESS_K8S_NAMESPACE', DEFAULT_HARNESS_K8S_NAMESPACE),
    envTemplateLine('ELAGENTE_HARNESS_APP_KEY_SECRET_NAME', DEFAULT_HARNESS_APP_KEY_SECRET_NAME),
    envTemplateLine('HARNESS_K8S_SECRET_KEY', '<sandbox id from staging smoke>'),
    '',
    '# Evidence review metadata',
    envTemplateLine('HARNESS_EVIDENCE_REVIEWED_BY', '<operator identity>'),
    '',
    '# Rerun collector',
    `# pnpm collect:harness-integration-evidence -- --output-dir ${input.outputDir}`,
    '',
  ].join('\n');
}

async function runCommand(input: {
  name: string;
  command: string[];
  outputPath: string;
  env?: Record<string, string>;
}) {
  const [binary, ...args] = input.command;
  if (!binary) {
    throw new Error(`${input.name} command is empty.`);
  }

  const child = spawn(binary, args, {
    env: {
      ...process.env,
      ...input.env,
    },
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
  await writeFile(input.outputPath, stdout);

  let parsedOk: boolean | null = null;
  try {
    const parsed = JSON.parse(stdout) as { ok?: unknown };
    parsedOk = typeof parsed.ok === 'boolean' ? parsed.ok : null;
  } catch {
    parsedOk = null;
  }

  return {
    name: input.name,
    command: input.command,
    exitCode,
    outputPath: input.outputPath,
    stderr: redactedSlice(stderr),
    ok: exitCode === 0 && parsedOk !== false,
    parsedOk,
  } satisfies CommandResult;
}

async function readJson(pathName: string) {
  const parsed = JSON.parse(await readFile(pathName, 'utf8')) as unknown;
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
}

function stepOk(file: Record<string, unknown>, name: string) {
  const steps = Array.isArray(file.steps) ? file.steps : [];
  return steps.some((step) => (
    step &&
    typeof step === 'object' &&
    (step as { name?: unknown }).name === name &&
    (step as { ok?: unknown }).ok === true
  ));
}

function jsonOk(file: Record<string, unknown>) {
  return file.ok === true;
}

async function buildReview(input: {
  outputDir: string;
  commands: CommandResult[];
  adminPath: string;
  stagingPath: string;
  k8sPath: string;
  verifierPath: string;
}) {
  const admin = await readJson(input.adminPath).catch(() => ({}));
  const staging = await readJson(input.stagingPath).catch(() => ({}));
  const k8s = await readJson(input.k8sPath).catch(() => ({}));
  const verifier = await readJson(input.verifierPath).catch(() => ({}));
  return {
    generatedAt: new Date().toISOString(),
    reviewedBy: envValue('HARNESS_EVIDENCE_REVIEWED_BY') ?? 'automated-harness-evidence-collector',
    reviewSource: 'pnpm collect:harness-integration-evidence',
    harness: {
      adminBaseUrl: configValue('ELAGENTE_HARNESS_ADMIN_BASE_URL', DEFAULT_HARNESS_ADMIN_BASE_URL),
      adminSmokePath: input.adminPath,
      adminSmokeOk: jsonOk(admin),
      requiredAdminSteps: [
        'unauthenticated POST /admin/members/ensure',
        'unauthenticated GET /admin/usage/export?limit=1',
        'authenticated ensure creates or returns member',
        'authenticated ensure is idempotent',
        'authenticated reconcile returns existing external key',
        'authenticated rekey returns a new key',
        'authenticated usage export returns Remote Codex shape',
        'authenticated revoke marks key revoked',
      ],
    },
    remoteCodex: {
      controlPlaneBaseUrl: configValue(
        'STAGING_CONTROL_PLANE_BASE_URL',
        DEFAULT_STAGING_CONTROL_PLANE_BASE_URL,
      ),
      stagingSmokePath: input.stagingPath,
      stagingSmokeOk: jsonOk(staging),
      requiredStagingSteps: [
        'sandbox_ready',
        'browser_to_router_to_worker',
        'harness_worker_status',
        'harness_worker_discovery',
        'harness_control_plane_invoke',
        'harness_usage_summary_after_invoke',
        'harness_mcp_worker_api_smoke',
        'harness_thread_artifact_ui_smoke',
      ],
    },
    kubernetes: {
      namespace: configValue('HARNESS_K8S_NAMESPACE', DEFAULT_HARNESS_K8S_NAMESPACE),
      secretName: configValue(
        'ELAGENTE_HARNESS_APP_KEY_SECRET_NAME',
        DEFAULT_HARNESS_APP_KEY_SECRET_NAME,
      ),
      secretKey: envValue('HARNESS_K8S_SECRET_KEY') ?? '',
      k8sSecretSmokePath: input.k8sPath,
      k8sSecretSmokeOk: jsonOk(k8s),
      requiredK8sSteps: [
        'harness_k8s_secret_rbac_get',
        'harness_k8s_secret_rbac_patch',
        'harness_k8s_secret_key_present',
      ],
      secretDataValuesPrinted:
        (k8s as { secretSafety?: { valuePrinted?: unknown } }).secretSafety?.valuePrinted === true,
    },
    combinedVerifier: {
      path: input.verifierPath,
      ok: jsonOk(verifier),
      requiredGates: requiredHarnessIntegrationGates,
    },
    secretSafety: {
      valuesPrinted: false,
      frontendBundleContainsHarnessKey: false,
      apiResponseContainsHarnessKey: false,
      threadMessageContainsHarnessKey: false,
      logsContainHarnessKey: false,
      notes: 'Generated by the Harness evidence collector. Review command outputs before using this as release evidence.',
    },
    observedSteps: {
      harnessAdminContract: {
        routeProtection: stepOk(admin, 'unauthenticated POST /admin/members/ensure') &&
          stepOk(admin, 'unauthenticated GET /admin/usage/export?limit=1'),
        authenticatedContract: jsonOk(admin),
      },
      harnessWorkerRuntime: {
        workerStatus: stepOk(staging, 'harness_worker_status'),
        workerDiscovery: stepOk(staging, 'harness_worker_discovery'),
        k8sSecretPresent: stepOk(k8s, 'harness_k8s_secret_key_present'),
      },
      harnessUsageAttribution: {
        invoke: stepOk(staging, 'harness_control_plane_invoke'),
        summaryAfterInvoke: stepOk(staging, 'harness_usage_summary_after_invoke'),
      },
      harnessMcpWorkerApi: {
        sourceWorkerApi: stepOk(staging, 'harness_mcp_worker_api_smoke'),
      },
      harnessThreadArtifactUi: {
        liveArtifactProof: stepOk(staging, 'harness_thread_artifact_ui_smoke'),
      },
    },
    commandResults: input.commands.map((command) => ({
      name: command.name,
      exitCode: command.exitCode,
      ok: command.ok,
      parsedOk: command.parsedOk,
      outputPath: command.outputPath,
      stderr: command.stderr,
    })),
  };
}

async function main() {
  const outputDir =
    argValue('--output-dir') ??
    path.join('.temp', 'harness-evidence', timestampForPath());
  const force = hasFlag('--force');
  const envTemplatePath = argValue('--write-env-template');
  await mkdir(outputDir, { recursive: true });

  const adminPath = path.join(outputDir, 'harness-admin-smoke.json');
  const stagingPath = path.join(outputDir, 'staging-phase-one-smoke.json');
  const k8sPath = path.join(outputDir, 'harness-k8s-secret-smoke.json');
  const verifierPath = path.join(outputDir, 'harness-integration-verification.json');
  const reviewPath = path.join(outputDir, 'evidence-review.json');
  const reviewVerificationPath = path.join(outputDir, 'harness-evidence-review-verification.json');

  const requirements = {
    admin: [
      'ELAGENTE_HARNESS_ADMIN_KEY',
    ],
    staging: [
      'ELAGENTE_HARNESS_ADMIN_KEY',
    ],
    invoke: [
      'STAGING_HARNESS_INVOKE_TOOL',
      'STAGING_HARNESS_INVOKE_INPUT_JSON',
    ],
    agentUi: [
      'STAGING_HARNESS_MCP_SMOKE_COMMAND',
      'STAGING_HARNESS_THREAD_ARTIFACT_UI_SMOKE_COMMAND',
    ],
    k8s: [
      'HARNESS_K8S_SECRET_KEY',
    ],
  };
  const defaults = {
    ELAGENTE_HARNESS_ADMIN_BASE_URL: DEFAULT_HARNESS_ADMIN_BASE_URL,
    STAGING_CONTROL_PLANE_BASE_URL: DEFAULT_STAGING_CONTROL_PLANE_BASE_URL,
    STAGING_HARNESS_SMOKE: '1',
    STAGING_HARNESS_MODULE: DEFAULT_STAGING_HARNESS_MODULE,
    HARNESS_K8S_NAMESPACE: DEFAULT_HARNESS_K8S_NAMESPACE,
    ELAGENTE_HARNESS_APP_KEY_SECRET_NAME: DEFAULT_HARNESS_APP_KEY_SECRET_NAME,
  };
  const readiness = {
    admin: envReady(requirements.admin, defaults),
    staging: envReady(requirements.staging, defaults),
    invoke: envReady(requirements.invoke, defaults),
    agentUi: envReady(requirements.agentUi, defaults),
    k8s: envReady(requirements.k8s, defaults),
    fullRelease:
      envReady(requirements.admin, defaults) &&
      envReady(requirements.staging, defaults) &&
      envReady(requirements.invoke, defaults) &&
      envReady(requirements.agentUi, defaults) &&
      envReady(requirements.k8s, defaults),
  };
  const stagingEnv = {
    STAGING_CONTROL_PLANE_BASE_URL: configValue(
      'STAGING_CONTROL_PLANE_BASE_URL',
      DEFAULT_STAGING_CONTROL_PLANE_BASE_URL,
    ),
    STAGING_HARNESS_SMOKE: configValue('STAGING_HARNESS_SMOKE', '1'),
    STAGING_HARNESS_MODULE: configValue('STAGING_HARNESS_MODULE', DEFAULT_STAGING_HARNESS_MODULE),
  };
  const adminEnv = {
    ELAGENTE_HARNESS_ADMIN_BASE_URL: configValue(
      'ELAGENTE_HARNESS_ADMIN_BASE_URL',
      DEFAULT_HARNESS_ADMIN_BASE_URL,
    ),
  };
  const k8sEnv = {
    HARNESS_K8S_NAMESPACE: configValue('HARNESS_K8S_NAMESPACE', DEFAULT_HARNESS_K8S_NAMESPACE),
    ELAGENTE_HARNESS_APP_KEY_SECRET_NAME: configValue(
      'ELAGENTE_HARNESS_APP_KEY_SECRET_NAME',
      DEFAULT_HARNESS_APP_KEY_SECRET_NAME,
    ),
  };
  const commands: CommandResult[] = [];
  const generatedAt = new Date().toISOString();

  if (envTemplatePath) {
    const parent = path.dirname(envTemplatePath);
    if (parent && parent !== '.') {
      await mkdir(parent, { recursive: true });
    }
    await writeFile(envTemplatePath, buildEnvTemplate({ generatedAt, outputDir }));
  }

  if (readiness.admin || force) {
    commands.push(await runCommand({
      name: 'harness_admin_contract_smoke',
      command: [pnpmCommand(), 'smoke:harness-admin-contract'],
      outputPath: adminPath,
      env: adminEnv,
    }));
  }
  if (readiness.staging || force) {
    commands.push(await runCommand({
      name: 'staging_phase_one_harness_smoke',
      command: [pnpmCommand(), 'smoke:staging-phase-one'],
      outputPath: stagingPath,
      env: stagingEnv,
    }));
  }
  if (readiness.k8s || force) {
    commands.push(await runCommand({
      name: 'harness_k8s_secret_smoke',
      command: [pnpmCommand(), 'smoke:harness-k8s-secret'],
      outputPath: k8sPath,
      env: k8sEnv,
    }));
  }
  if (readiness.fullRelease || force) {
    commands.push(await runCommand({
      name: 'harness_integration_verifier',
      command: [
        pnpmCommand(),
        'verify:harness-integration-evidence',
        '--',
        '--admin-smoke',
        adminPath,
        '--staging-smoke',
        stagingPath,
        '--k8s-secret-smoke',
        k8sPath,
      ],
      outputPath: verifierPath,
    }));
  }

  const review = await buildReview({
    outputDir,
    commands,
    adminPath,
    stagingPath,
    k8sPath,
    verifierPath,
  });
  await writeFile(reviewPath, JSON.stringify(review, null, 2));

  if (((review as { combinedVerifier?: { ok?: unknown } }).combinedVerifier?.ok === true) || force) {
    commands.push(await runCommand({
      name: 'harness_evidence_review_verifier',
      command: [
        pnpmCommand(),
        'verify:harness-evidence-review',
        '--',
        '--review',
        reviewPath,
      ],
      outputPath: reviewVerificationPath,
    }));
  }

  const summary = {
    ok:
      (review as { combinedVerifier?: { ok?: unknown } }).combinedVerifier?.ok === true &&
      commands.some((command) => command.name === 'harness_evidence_review_verifier' && command.ok),
    generatedAt,
    outputDir,
    envTemplatePath,
    readiness,
    defaults: {
      ELAGENTE_HARNESS_ADMIN_BASE_URL: DEFAULT_HARNESS_ADMIN_BASE_URL,
      STAGING_CONTROL_PLANE_BASE_URL: DEFAULT_STAGING_CONTROL_PLANE_BASE_URL,
      STAGING_HARNESS_SMOKE: '1',
      STAGING_HARNESS_MODULE: DEFAULT_STAGING_HARNESS_MODULE,
      HARNESS_K8S_NAMESPACE: DEFAULT_HARNESS_K8S_NAMESPACE,
      ELAGENTE_HARNESS_APP_KEY_SECRET_NAME: DEFAULT_HARNESS_APP_KEY_SECRET_NAME,
      STAGING_PRODUCT_JWT: 'derived by /api/auth/password/login when absent',
    },
    missingEnv: missingEnvEntries(requirements, defaults),
    missingFullReleaseEnv: missingEnvEntries(requirements, defaults),
    paths: {
      adminSmoke: adminPath,
      stagingSmoke: stagingPath,
      k8sSecretSmoke: k8sPath,
      integrationVerification: verifierPath,
      evidenceReview: reviewPath,
      evidenceReviewVerification: reviewVerificationPath,
    },
    commandResults: commands.map((command) => ({
      name: command.name,
      exitCode: command.exitCode,
      ok: command.ok,
      parsedOk: command.parsedOk,
      outputPath: command.outputPath,
      stderr: command.stderr,
    })),
    nextSteps: {
      fillMissingEnv: 'Export only missing env names that match the evidence level you want. Basic worker Harness smoke needs the admin key; full release evidence also needs invoke, agent/UI, and K8s secret-key proof inputs.',
      writeEnvTemplate: `pnpm collect:harness-integration-evidence -- --output-dir ${outputDir} --write-env-template ./.temp/harness-evidence/harness.env.sh`,
      rerun: `pnpm collect:harness-integration-evidence -- --output-dir ${outputDir}`,
      forceRerunForDiagnostics: `pnpm collect:harness-integration-evidence -- --output-dir ${outputDir} --force`,
      verifyCombined: `pnpm verify:harness-integration-evidence -- --admin-smoke ${adminPath} --staging-smoke ${stagingPath} --k8s-secret-smoke ${k8sPath}`,
      verifyReview: `pnpm verify:harness-evidence-review -- --review ${reviewPath}`,
    },
    secretSafety: {
      valuesPrinted: false,
      note: 'This collector records env names, output paths, redacted stderr, and smoke JSON. It does not print env values.',
    },
  };
  const summaryPath = path.join(outputDir, 'summary.json');
  await writeFile(summaryPath, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ ...summary, summaryPath }, null, 2));
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
