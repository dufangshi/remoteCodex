import { execFile, spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
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

type DirectWorkerMode = 'public' | 'private';

interface ParsedEnv {
  values: Map<string, string>;
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

function directWorkerMode(): DirectWorkerMode {
  const value = argValue('--direct-worker-mode') ?? 'private';
  if (value !== 'public' && value !== 'private') {
    throw new Error('--direct-worker-mode must be public or private.');
  }
  return value;
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function parseEnvValue(raw: string) {
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseEnvFile(contents: string): ParsedEnv {
  const values = new Map<string, string>();
  for (const [index, rawLine] of contents.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const normalized = line.startsWith('export ') ? line.slice('export '.length).trim() : line;
    const equalsIndex = normalized.indexOf('=');
    if (equalsIndex === -1) {
      throw new Error(`Invalid env line ${index + 1}: expected NAME=value.`);
    }
    const name = normalized.slice(0, equalsIndex).trim();
    const value = normalized.slice(equalsIndex + 1);
    if (!/^[A-Z0-9_]+$/.test(name)) {
      throw new Error(`Invalid env name on line ${index + 1}: ${name}`);
    }
    values.set(name, parseEnvValue(value));
  }
  return { values };
}

function requiredDirectWorkerVariables(mode: DirectWorkerMode) {
  return mode === 'public'
    ? [...directWorkerPublicVariables]
    : [...directWorkerPrivateVariables];
}

function requiredKubeconfigSecrets(values: Map<string, string>) {
  const configured = kubeconfigSecretAlternatives.filter((name) => values.has(name));
  return configured.length > 0
    ? [configured[0]]
    : [...kubeconfigSecretAlternatives];
}

function allVariableNames(mode: DirectWorkerMode) {
  return [
    ...requiredVariables,
    ...requiredDirectWorkerVariables(mode),
  ];
}

function allRequiredSecretNames(values: Map<string, string>) {
  return [
    ...requiredSecrets,
    ...requiredKubeconfigSecrets(values),
  ];
}

function presentOptionalSecretNames(values: Map<string, string>) {
  return optionalSecrets.filter((name) => hasFilledValue(values, name));
}

function isPlaceholderValue(value: string) {
  const trimmed = value.trim();
  return trimmed.startsWith('<') && trimmed.endsWith('>');
}

function hasFilledValue(values: Map<string, string>, name: string) {
  const value = values.get(name);
  return value !== undefined && value !== '' && !isPlaceholderValue(value);
}

function missingNames(names: readonly string[], values: Map<string, string>) {
  return names.filter((name) => !hasFilledValue(values, name));
}

function templateValue(name: string) {
  if (name.endsWith('_JSON')) {
    return '{}';
  }
  if (name.endsWith('_TIMEOUT_MS')) {
    return '120000';
  }
  if (name.startsWith('AWS_STAGING_CONFIG_REVIEWED')) {
    return 'true';
  }
  if (name.startsWith('AWS_STAGING_CREDENTIAL_REVIEW_PASSED')) {
    return 'true';
  }
  if (name === 'STAGING_IDEMPOTENT_LIFECYCLE_SMOKE') {
    return 'true';
  }
  if (name === 'STAGING_STOP_SANDBOX_AFTER_SMOKE') {
    return 'true';
  }
  if (name === 'STAGING_DIRECT_WORKER_NETWORK_MODE') {
    return 'private';
  }
  if (name === 'STAGING_DIRECT_WORKER_INGRESS_POLICY') {
    return 'router-only';
  }
  return `<${name.toLowerCase().replaceAll('_', '-')}>`;
}

async function writeTemplate(filePath: string, mode: DirectWorkerMode) {
  const lines = [
    '# Phase 0-6 GitHub staging Environment configuration template.',
    '# Fill this file in a private operator shell. Do not commit filled values.',
    '# The configure script prints names only and sends secret values through stdin.',
    '',
    '# Required GitHub Environment variables.',
  ];
  for (const name of allVariableNames(mode)) {
    lines.push(`export ${name}=${shellQuote(templateValue(name))}`);
  }
  lines.push('');
  lines.push('# Required GitHub Environment secrets.');
  for (const name of requiredSecrets) {
    lines.push(`export ${name}=${shellQuote(templateValue(name))}`);
  }
  lines.push('');
  lines.push('# Provide exactly one kubeconfig secret alternative.');
  lines.push(`# export ${kubeconfigSecretAlternatives[0]}=${shellQuote(templateValue(kubeconfigSecretAlternatives[0]))}`);
  lines.push(`export ${kubeconfigSecretAlternatives[1]}=${shellQuote(templateValue(kubeconfigSecretAlternatives[1]))}`);
  lines.push('');
  lines.push('# Optional provider smoke command env secrets.');
  for (const name of optionalSecrets) {
    lines.push(`# export ${name}=${shellQuote(templateValue(name))}`);
  }
  lines.push('');

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${lines.join('\n')}\n`, { mode: 0o600 });
}

async function gh(args: string[], input?: string) {
  if (input !== undefined) {
    return new Promise<string>((resolve, reject) => {
      const child = spawn('gh', args, {
        env: process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`gh command timed out: ${args.join(' ')}`));
      }, 30_000);
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
      child.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`gh command failed with exit code ${code}: ${stderr}`));
        }
      });
      child.stdin.end(input);
    });
  }
  const result = await execFileAsync('gh', args, {
    timeout: 30_000,
    env: process.env,
  });
  return result.stdout;
}

async function setVariable(owner: string, repo: string, environment: string, name: string, value: string) {
  await gh([
    'variable',
    'set',
    name,
    '--repo',
    `${owner}/${repo}`,
    '--env',
    environment,
    '--body',
    value,
  ]);
}

async function setSecret(owner: string, repo: string, environment: string, name: string, value: string) {
  await gh([
    'secret',
    'set',
    name,
    '--repo',
    `${owner}/${repo}`,
    '--env',
    environment,
  ], value);
}

async function configure() {
  const owner = argValue('--owner') ?? 'dufangshi';
  const repo = argValue('--repo') ?? 'remoteCodex';
  const environment = argValue('--environment') ?? 'staging';
  const mode = directWorkerMode();
  const dryRun = hasFlag('--dry-run');
  const writeTemplatePath = argValue('--write-template');

  if (writeTemplatePath) {
    await writeTemplate(writeTemplatePath, mode);
    console.log(JSON.stringify({
      ok: true,
      action: 'write-template',
      path: writeTemplatePath,
      directWorkerMode: mode,
      secretSafety: 'template contains placeholders only; fill privately and do not commit',
    }, null, 2));
    return;
  }

  const envFile = argValue('--values-file') ?? argValue('--env-file');
  if (!envFile) {
    throw new Error('Pass --values-file <path>, or use --write-template <path> to create a template.');
  }

  const parsed = parseEnvFile(await readFile(envFile, 'utf8'));
  const variableNames = allVariableNames(mode);
  const requiredSecretNames = allRequiredSecretNames(parsed.values);
  const optionalSecretNames = presentOptionalSecretNames(parsed.values);
  const missingVariables = missingNames(variableNames, parsed.values);
  const missingSecrets = missingNames(requiredSecretNames, parsed.values);

  if (missingVariables.length > 0 || missingSecrets.length > 0) {
    console.log(JSON.stringify({
      ok: false,
      dryRun,
      owner,
      repo,
      environment,
      directWorkerMode: mode,
      missingVariables,
      missingSecrets,
      secretSafety: 'values omitted',
    }, null, 2));
    process.exitCode = 1;
    return;
  }

  if (!dryRun) {
    for (const name of variableNames) {
      await setVariable(owner, repo, environment, name, parsed.values.get(name) ?? '');
    }
    for (const name of [...requiredSecretNames, ...optionalSecretNames]) {
      await setSecret(owner, repo, environment, name, parsed.values.get(name) ?? '');
    }
  }

  console.log(JSON.stringify({
    ok: true,
    dryRun,
    owner,
    repo,
    environment,
    directWorkerMode: mode,
    variables: {
      count: variableNames.length,
      names: variableNames,
    },
    secrets: {
      count: requiredSecretNames.length + optionalSecretNames.length,
      requiredNames: requiredSecretNames,
      optionalNames: optionalSecretNames,
    },
    nextCommands: {
      verify: `pnpm phase-zero-six:github-env:report -- --owner ${owner} --repo ${repo} --environment ${environment}`,
      runAwsOnly: `gh workflow run "Phase 0-6 Evidence Tooling" --repo ${owner}/${repo} --ref sandbox-worker-control-plane -f evidence_mode=aws-only -f force_diagnostics=false`,
      runFull: `gh workflow run "Phase 0-6 Evidence Tooling" --repo ${owner}/${repo} --ref sandbox-worker-control-plane -f evidence_mode=full -f force_diagnostics=false`,
    },
    secretSafety: 'secret values were not printed',
  }, null, 2));
}

configure().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exit(1);
});
