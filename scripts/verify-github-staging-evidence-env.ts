import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const requiredVariables = [
  'AWS_STAGING_REVIEWED_BY',
  'AWS_STAGING_REGION',
  'AWS_STAGING_ACCOUNT_ID',
  'AWS_STAGING_EKS_CLUSTER_NAME',
  'AWS_STAGING_K8S_NAMESPACE',
  'AWS_STAGING_FARGATE_PROFILE_NAME',
  'AWS_STAGING_K8S_SERVICE_ACCOUNT',
  'AWS_STAGING_K8S_ROLE_ARN',
  'AWS_STAGING_WORKER_IMAGE_REPOSITORY',
  'AWS_STAGING_WORKER_IMAGE_TAG',
  'AWS_STAGING_LOG_GROUP_NAMES',
  'AWS_STAGING_VPC_ID',
  'AWS_STAGING_SUBNET_IDS',
  'AWS_STAGING_SECURITY_GROUP_IDS',
  'AWS_STAGING_CONFIG_REVIEWED',
  'AWS_STAGING_CREDENTIAL_REVIEW_PASSED',
  'STAGING_CONTROL_PLANE_BASE_URL',
  'STAGING_SMOKE_EMAIL',
  'STAGING_SANDBOX_READY_TIMEOUT_MS',
  'STAGING_SANDBOX_STOP_TIMEOUT_MS',
  'STAGING_IDEMPOTENT_LIFECYCLE_SMOKE',
  'STAGING_STOP_SANDBOX_AFTER_SMOKE',
  'STAGING_CODEX_GATEWAY_SMOKE_COMMAND_JSON',
  'STAGING_CLAUDE_GATEWAY_SMOKE_COMMAND_JSON',
  'STAGING_OPENCODE_GATEWAY_SMOKE_COMMAND_JSON',
];

const directWorkerPublicVariables = [
  'STAGING_DIRECT_WORKER_BASE_URL',
];

const directWorkerPrivateVariables = [
  'STAGING_DIRECT_WORKER_PRIVATE_REVIEWED_BY',
  'STAGING_DIRECT_WORKER_NETWORK_MODE',
  'STAGING_DIRECT_WORKER_INGRESS_POLICY',
  'STAGING_DIRECT_WORKER_PRIVATE_PROOF',
];

const requiredSecrets = [
  'STAGING_PRODUCT_JWT',
  'STAGING_ADMIN_JWT',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
];

const optionalSecrets = [
  'AWS_SESSION_TOKEN',
  'STAGING_CODEX_GATEWAY_SMOKE_COMMAND_ENV_JSON',
  'STAGING_CLAUDE_GATEWAY_SMOKE_COMMAND_ENV_JSON',
  'STAGING_OPENCODE_GATEWAY_SMOKE_COMMAND_ENV_JSON',
];

const kubeconfigSecretAlternatives = [
  'STAGING_KUBECONFIG',
  'STAGING_KUBECONFIG_B64',
];

interface GithubReadinessReport {
  ok: boolean;
  generatedAt: string;
  owner: string;
  repo: string;
  environment: string;
  environmentExists: boolean;
  variables: {
    present: string[];
    missingRequired: string[];
    directWorkerProof: {
      ok: boolean;
      mode: 'public' | 'private' | 'missing';
      missingPublicAlternative: string[];
      missingPrivateAlternative: string[];
    };
  };
  secrets: {
    present: string[];
    missingRequired: string[];
    missingKubeconfigAlternative: string[];
    optionalPresent: string[];
    optionalMissing: string[];
  };
  nextCommands: {
    openActionsWorkflow: string;
    runAwsOnly: string;
    runFull: string;
  };
  secretSafety: {
    valuesPrinted: false;
    note: string;
  };
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

function outputFormat() {
  const format = argValue('--format') ?? 'json';
  if (format !== 'json' && format !== 'text') {
    throw new Error('--format must be json or text.');
  }
  return format;
}

async function ghJson(args: string[]) {
  const { stdout } = await execFileAsync('gh', args, {
    timeout: 30_000,
    env: process.env,
  });
  return JSON.parse(stdout) as unknown;
}

async function listEnvironments(owner: string, repo: string) {
  const parsed = await ghJson([
    'api',
    `repos/${owner}/${repo}/environments`,
  ]) as { environments?: Array<{ name?: unknown }> };
  return (parsed.environments ?? [])
    .map((environment) => environment.name)
    .filter((name): name is string => typeof name === 'string');
}

async function listEnvironmentVariables(owner: string, repo: string, environment: string) {
  const parsed = await ghJson([
    'api',
    `repos/${owner}/${repo}/environments/${environment}/variables`,
  ]) as { variables?: Array<{ name?: unknown }> };
  return (parsed.variables ?? [])
    .map((variable) => variable.name)
    .filter((name): name is string => typeof name === 'string')
    .sort();
}

async function listEnvironmentSecrets(owner: string, repo: string, environment: string) {
  const parsed = await ghJson([
    'api',
    `repos/${owner}/${repo}/environments/${environment}/secrets`,
  ]) as { secrets?: Array<{ name?: unknown }> };
  return (parsed.secrets ?? [])
    .map((secret) => secret.name)
    .filter((name): name is string => typeof name === 'string')
    .sort();
}

function missingFrom(required: string[], present: string[]) {
  const presentSet = new Set(present);
  return required.filter((name) => !presentSet.has(name));
}

function intersection(names: string[], present: string[]) {
  const presentSet = new Set(present);
  return names.filter((name) => presentSet.has(name));
}

function directWorkerProofReadiness(presentVariables: string[]) {
  const missingPublic = missingFrom(directWorkerPublicVariables, presentVariables);
  const missingPrivate = missingFrom(directWorkerPrivateVariables, presentVariables);
  const publicOk = missingPublic.length === 0;
  const privateOk = missingPrivate.length === 0;
  return {
    ok: publicOk || privateOk,
    mode: publicOk ? 'public' as const : privateOk ? 'private' as const : 'missing' as const,
    missingPublicAlternative: missingPublic,
    missingPrivateAlternative: missingPrivate,
  };
}

function buildNextCommands(owner: string, repo: string) {
  return {
    openActionsWorkflow:
      `gh workflow view "Phase 0-6 Staging Evidence" --repo ${owner}/${repo} --web`,
    runAwsOnly:
      `gh workflow run "Phase 0-6 Staging Evidence" --repo ${owner}/${repo} --ref sandbox-worker-control-plane -f evidence_mode=aws-only -f force_diagnostics=false`,
    runFull:
      `gh workflow run "Phase 0-6 Staging Evidence" --repo ${owner}/${repo} --ref sandbox-worker-control-plane -f evidence_mode=full -f force_diagnostics=false`,
  };
}

async function buildReport(): Promise<GithubReadinessReport> {
  const owner = argValue('--owner') ?? 'dufangshi';
  const repo = argValue('--repo') ?? 'remoteCodex';
  const environment = argValue('--environment') ?? 'staging';
  const environments = await listEnvironments(owner, repo);
  const environmentExists = environments.includes(environment);
  const variables = environmentExists
    ? await listEnvironmentVariables(owner, repo, environment)
    : [];
  const secrets = environmentExists
    ? await listEnvironmentSecrets(owner, repo, environment)
    : [];
  const directWorkerProof = directWorkerProofReadiness(variables);
  const missingRequiredVariables = missingFrom(requiredVariables, variables);
  const missingRequiredSecrets = missingFrom(requiredSecrets, secrets);
  const missingKubeconfigAlternative = intersection(kubeconfigSecretAlternatives, secrets).length > 0
    ? []
    : kubeconfigSecretAlternatives;

  return {
    ok:
      environmentExists &&
      missingRequiredVariables.length === 0 &&
      directWorkerProof.ok &&
      missingRequiredSecrets.length === 0 &&
      missingKubeconfigAlternative.length === 0,
    generatedAt: new Date().toISOString(),
    owner,
    repo,
    environment,
    environmentExists,
    variables: {
      present: variables,
      missingRequired: missingRequiredVariables,
      directWorkerProof,
    },
    secrets: {
      present: secrets,
      missingRequired: missingRequiredSecrets,
      missingKubeconfigAlternative,
      optionalPresent: intersection(optionalSecrets, secrets),
      optionalMissing: missingFrom(optionalSecrets, secrets),
    },
    nextCommands: buildNextCommands(owner, repo),
    secretSafety: {
      valuesPrinted: false,
      note: 'This report uses GitHub metadata APIs and prints variable/secret names only; it never prints values.',
    },
  };
}

function renderText(report: GithubReadinessReport) {
  const lines = [
    '# GitHub Phase 0-6 Staging Evidence Environment Readiness',
    '',
    `Generated at: ${report.generatedAt}`,
    `Repository: ${report.owner}/${report.repo}`,
    `Environment: ${report.environment}`,
    `Ready: ${String(report.ok)}`,
    `Environment exists: ${String(report.environmentExists)}`,
    '',
    '## Variables',
    `Present: ${report.variables.present.length}`,
    `Missing required: ${report.variables.missingRequired.length > 0 ? report.variables.missingRequired.join(', ') : '(none)'}`,
    `Direct worker proof: ${report.variables.directWorkerProof.ok ? report.variables.directWorkerProof.mode : 'missing'}`,
  ];

  if (!report.variables.directWorkerProof.ok) {
    lines.push(`Missing public alternative: ${report.variables.directWorkerProof.missingPublicAlternative.join(', ')}`);
    lines.push(`Missing private alternative: ${report.variables.directWorkerProof.missingPrivateAlternative.join(', ')}`);
  }

  lines.push('');
  lines.push('## Secrets');
  lines.push(`Present: ${report.secrets.present.length}`);
  lines.push(`Missing required: ${report.secrets.missingRequired.length > 0 ? report.secrets.missingRequired.join(', ') : '(none)'}`);
  lines.push(`Missing kubeconfig alternative: ${report.secrets.missingKubeconfigAlternative.length > 0 ? report.secrets.missingKubeconfigAlternative.join(' | ') : '(none)'}`);
  lines.push(`Optional missing: ${report.secrets.optionalMissing.length > 0 ? report.secrets.optionalMissing.join(', ') : '(none)'}`);
  lines.push('');
  lines.push('## Next Commands');
  for (const [key, command] of Object.entries(report.nextCommands)) {
    lines.push(`- ${key}: ${command}`);
  }
  lines.push('');
  lines.push(report.secretSafety.note);
  return `${lines.join('\n')}\n`;
}

async function main() {
  const format = outputFormat();
  const report = await buildReport();
  console.log(format === 'text' ? renderText(report) : JSON.stringify(report, null, 2));
  if (!report.ok && !hasFlag('--no-fail')) {
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
