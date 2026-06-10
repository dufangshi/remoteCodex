import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

interface Step {
  name: string;
  ok: boolean;
  details: Record<string, unknown>;
}

function envValue(name: string) {
  const value = process.env[name]?.trim();
  return value && !/<[^>]+>/.test(value) ? value : null;
}

function requireEnv(name: string) {
  const value = envValue(name);
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

async function kubectlJson(args: string[]) {
  const { stdout } = await execFileAsync('kubectl', args, {
    timeout: Number(process.env.HARNESS_K8S_SECRET_SMOKE_TIMEOUT_MS ?? 30_000),
    env: process.env,
  });
  return JSON.parse(stdout) as unknown;
}

async function kubectlText(args: string[]) {
  const { stdout } = await execFileAsync('kubectl', args, {
    timeout: Number(process.env.HARNESS_K8S_SECRET_SMOKE_TIMEOUT_MS ?? 30_000),
    env: process.env,
  });
  return stdout.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function main() {
  const namespace = requireEnv('HARNESS_K8S_NAMESPACE');
  const secretName = requireEnv('ELAGENTE_HARNESS_APP_KEY_SECRET_NAME');
  const secretKey = requireEnv('HARNESS_K8S_SECRET_KEY');
  const steps: Step[] = [];

  const canGet = await kubectlText(['auth', 'can-i', 'get', 'secrets', '-n', namespace]);
  steps.push({
    name: 'harness_k8s_secret_rbac_get',
    ok: canGet === 'yes',
    details: {
      namespace,
      verb: 'get',
      resource: 'secrets',
      allowed: canGet === 'yes',
    },
  });

  const canPatch = await kubectlText(['auth', 'can-i', 'patch', 'secrets', '-n', namespace]);
  steps.push({
    name: 'harness_k8s_secret_rbac_patch',
    ok: canPatch === 'yes',
    details: {
      namespace,
      verb: 'patch',
      resource: 'secrets',
      allowed: canPatch === 'yes',
    },
  });

  const secret = await kubectlJson([
    'get',
    'secret',
    secretName,
    '-n',
    namespace,
    '-o',
    'json',
  ]);
  const data = isRecord(secret) && isRecord(secret.data) ? secret.data : {};
  steps.push({
    name: 'harness_k8s_secret_key_present',
    ok: Object.prototype.hasOwnProperty.call(data, secretKey),
    details: {
      namespace,
      secretName,
      secretKey,
      keyPresent: Object.prototype.hasOwnProperty.call(data, secretKey),
      dataKeyCount: Object.keys(data).length,
    },
  });

  const ok = steps.every((step) => step.ok);
  console.log(JSON.stringify({
    ok,
    generatedAt: new Date().toISOString(),
    namespace,
    secretName,
    secretKey,
    steps,
    secretSafety: {
      valuePrinted: false,
      note: 'This smoke prints Secret metadata and key presence only; it never prints Secret data values.',
    },
  }, null, 2));
  if (!ok) {
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
