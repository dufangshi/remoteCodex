import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  directWorkerPrivateVariables,
  directWorkerPublicVariables,
  kubeconfigSecretAlternatives,
  optionalSecrets,
  requiredSecrets,
  requiredVariables,
} from './phase-zero-six-github-env-contract.js';

const execFileAsync = promisify(execFile);

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

function missingFrom(required: readonly string[], present: readonly string[]) {
  const presentSet = new Set(present);
  return required.filter((name) => !presentSet.has(name));
}

function intersection(names: readonly string[], present: readonly string[]) {
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
      `gh workflow view "Phase 0-6 Evidence Tooling" --repo ${owner}/${repo} --web`,
    runAwsOnly:
      `gh workflow run "Phase 0-6 Evidence Tooling" --repo ${owner}/${repo} --ref sandbox-worker-control-plane -f evidence_mode=aws-only -f force_diagnostics=false`,
    runFull:
      `gh workflow run "Phase 0-6 Evidence Tooling" --repo ${owner}/${repo} --ref sandbox-worker-control-plane -f evidence_mode=full -f force_diagnostics=false`,
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
    : [...kubeconfigSecretAlternatives];

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
