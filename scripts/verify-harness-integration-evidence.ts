import { readFile } from 'node:fs/promises';

interface Verification {
  id: string;
  ok: boolean;
  evidence: string[];
  reason: string;
}

interface JsonObject {
  [key: string]: any;
}

function argValue(name: string) {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return null;
  }
  const value = process.argv[index + 1];
  return value && !value.startsWith('--') ? value : null;
}

async function readJsonFile(path: string | null) {
  if (!path) {
    return null;
  }
  const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${path} must contain a JSON object.`);
  }
  return parsed as JsonObject;
}

function stepsByName(evidence: JsonObject | null) {
  const steps = new Map<string, JsonObject>();
  if (!evidence || !Array.isArray(evidence.steps)) {
    return steps;
  }
  for (const step of evidence.steps) {
    if (step && typeof step === 'object' && typeof step.name === 'string') {
      steps.set(step.name, step as JsonObject);
    }
  }
  return steps;
}

function okStep(steps: Map<string, JsonObject>, name: string) {
  return steps.get(name)?.ok === true;
}

function step(steps: Map<string, JsonObject>, name: string) {
  return steps.get(name) ?? null;
}

function nonEmptyString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0;
}

function numberValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function detailsObject(steps: Map<string, JsonObject>, name: string) {
  const details = step(steps, name)?.details;
  return details && typeof details === 'object' && !Array.isArray(details)
    ? details as JsonObject
    : null;
}

const adminSecretFieldNames = new Set(['apiKey', 'api_key', 'key', 'token', 'secret']);

function adminEvidenceRedacted(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.every(adminEvidenceRedacted);
  }
  if (!value || typeof value !== 'object') {
    return true;
  }
  for (const [key, entry] of Object.entries(value as JsonObject)) {
    if (adminSecretFieldNames.has(key)) {
      if (entry === null || entry === undefined || entry === '') {
        continue;
      }
      if (entry !== '[redacted]') {
        return false;
      }
      continue;
    }
    if (!adminEvidenceRedacted(entry)) {
      return false;
    }
  }
  return true;
}

function adminStepDetailsRedacted(steps: Map<string, JsonObject>, name: string) {
  const details = detailsObject(steps, name);
  return details !== null && adminEvidenceRedacted(details);
}

function adminContractProven(steps: Map<string, JsonObject>) {
  const ensure = detailsObject(steps, 'authenticated ensure creates or returns member');
  const idempotent = detailsObject(steps, 'authenticated ensure is idempotent');
  const reconcile = detailsObject(steps, 'authenticated reconcile returns existing external key');
  const rekey = detailsObject(steps, 'authenticated rekey returns a new key');
  const usage = detailsObject(steps, 'authenticated usage export returns Remote Codex shape');
  const revoke = detailsObject(steps, 'authenticated revoke marks key revoked');
  return (
    okStep(steps, 'unauthenticated POST /admin/members/ensure') &&
    okStep(steps, 'unauthenticated GET /admin/usage/export?limit=1') &&
    okStep(steps, 'authenticated ensure creates or returns member') &&
    ensure?.apiKeyPresent === true &&
    nonEmptyString(ensure.externalKeyId) &&
    adminStepDetailsRedacted(steps, 'authenticated ensure creates or returns member') &&
    okStep(steps, 'authenticated ensure is idempotent') &&
    idempotent?.apiKeyPresent === true &&
    idempotent?.created === false &&
    nonEmptyString(idempotent.externalKeyId) &&
    adminStepDetailsRedacted(steps, 'authenticated ensure is idempotent') &&
    okStep(steps, 'authenticated reconcile returns existing external key') &&
    nonEmptyString(reconcile?.externalKeyId) &&
    adminStepDetailsRedacted(steps, 'authenticated reconcile returns existing external key') &&
    okStep(steps, 'authenticated rekey returns a new key') &&
    rekey?.apiKeyPresent === true &&
    rekey?.keyChanged === true &&
    nonEmptyString(rekey.externalKeyId) &&
    adminStepDetailsRedacted(steps, 'authenticated rekey returns a new key') &&
    okStep(steps, 'authenticated usage export returns Remote Codex shape') &&
    numberValue(usage?.eventCount) !== null &&
    usage?.nextCursorPresent === true &&
    adminStepDetailsRedacted(steps, 'authenticated usage export returns Remote Codex shape') &&
    okStep(steps, 'authenticated revoke marks key revoked') &&
    revoke?.status === 'revoked' &&
    adminStepDetailsRedacted(steps, 'authenticated revoke marks key revoked')
  );
}

function stringArrayIncludes(value: unknown, expected: string) {
  return Array.isArray(value) && value.some((entry) => entry === expected);
}

function positiveNumber(value: unknown) {
  const parsed = numberValue(value);
  return parsed !== null && parsed > 0;
}

function harnessWorkerRuntimeProven(
  stagingSteps: Map<string, JsonObject>,
  k8sSecretSteps: Map<string, JsonObject>,
) {
  const status = detailsObject(stagingSteps, 'harness_worker_status');
  const home = detailsObject(stagingSteps, 'harness_worker_home');
  const discovery = detailsObject(stagingSteps, 'harness_worker_discovery');
  const homeResponseKeys = home?.responseKeys;
  const discoveryResponseKeys = discovery?.responseKeys;
  return (
    okStep(k8sSecretSteps, 'harness_k8s_secret_rbac_get') &&
    okStep(k8sSecretSteps, 'harness_k8s_secret_rbac_patch') &&
    okStep(k8sSecretSteps, 'harness_k8s_secret_key_present') &&
    okStep(stagingSteps, 'sandbox_ready') &&
    okStep(stagingSteps, 'browser_to_router_to_worker') &&
    okStep(stagingSteps, 'harness_worker_status') &&
    status?.enabled === true &&
    status?.keyPresent === true &&
    status?.chemistryToolsEnabled === true &&
    nonEmptyString(status.baseUrl) &&
    stringArrayIncludes(status.modules, 'farmaco') &&
    okStep(stagingSteps, 'harness_worker_home') &&
    (positiveNumber(home?.textLength) ||
      (Array.isArray(homeResponseKeys) && homeResponseKeys.length > 0)) &&
    okStep(stagingSteps, 'harness_worker_discovery') &&
    nonEmptyString(discovery?.module) &&
    ['help', 'tools'].includes(String(discovery?.mode ?? '')) &&
    (positiveNumber(discovery?.textLength) ||
      (Array.isArray(discoveryResponseKeys) && discoveryResponseKeys.length > 0))
  );
}

function harnessInvokeAttributed(steps: Map<string, JsonObject>) {
  const details = detailsObject(steps, 'harness_control_plane_invoke');
  if (!details) {
    return false;
  }
  const record = details;
  const workspaceId = record.workspaceId;
  const sessionId = record.sessionId;
  const hasProviderEventIdentity =
    nonEmptyString(record.externalEventId) ||
    nonEmptyString(record.runId) ||
    nonEmptyString(record.jobId);
  return (
    okStep(steps, 'harness_control_plane_invoke') &&
    nonEmptyString(record.usageEventId) &&
    nonEmptyString(record.module) &&
    nonEmptyString(record.tool) &&
    nonEmptyString(record.status) &&
    hasProviderEventIdentity &&
    nonEmptyString(workspaceId) &&
    nonEmptyString(sessionId) &&
    (record.expectedWorkspaceId === undefined || record.expectedWorkspaceId === workspaceId) &&
    (record.expectedSessionId === undefined || record.expectedSessionId === sessionId)
  );
}

function harnessUsageSummaryIncreased(steps: Map<string, JsonObject>) {
  const details = detailsObject(steps, 'harness_usage_summary_after_invoke');
  if (!details) {
    return false;
  }
  const record = details;
  const before = numberValue(record.beforeEventCount ?? record.beforeTotalEvents);
  const after = numberValue(record.afterEventCount ?? record.afterTotalEvents);
  return okStep(steps, 'harness_usage_summary_after_invoke') &&
    before !== null &&
    after !== null &&
    after > before;
}

function secretValueNotPrinted(evidence: JsonObject | null) {
  return evidence?.secretSafety?.valuePrinted === false ||
    evidence?.secretSafety?.valuesPrinted === false;
}

const obviousSecretPatterns = [
  /Bearer\s+[A-Za-z0-9._~+/=-]{20,}/,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  /sk-ant-[A-Za-z0-9_-]{20,}/,
  /sk-[A-Za-z0-9_-]{20,}/,
  /AKIA[0-9A-Z]{16}/,
  /gh[pousr]_[A-Za-z0-9_]{20,}/,
  /INACT_X_APP_KEY\s*=\s*[^\s"']{8,}/,
];

function obviousSecretFree(value: unknown): boolean {
  if (typeof value === 'string') {
    if (value === '[redacted]' || value.includes('[REDACTED')) {
      return true;
    }
    return !obviousSecretPatterns.some((pattern) => pattern.test(value));
  }
  if (Array.isArray(value)) {
    return value.every(obviousSecretFree);
  }
  if (!value || typeof value !== 'object') {
    return true;
  }
  return Object.values(value as JsonObject).every(obviousSecretFree);
}

function allHarnessEvidenceSecretSafe(evidence: Array<JsonObject | null>) {
  return evidence.every(obviousSecretFree);
}

function verification(input: Verification) {
  return input;
}

async function main() {
  const adminEvidence = await readJsonFile(argValue('--admin-smoke'));
  const stagingEvidence = await readJsonFile(argValue('--staging-smoke'));
  const k8sSecretEvidence = await readJsonFile(argValue('--k8s-secret-smoke'));
  const adminSteps = stepsByName(adminEvidence);
  const stagingSteps = stepsByName(stagingEvidence);
  const k8sSecretSteps = stepsByName(k8sSecretEvidence);
  const verifications: Verification[] = [
    verification({
      id: 'harness-admin-contract',
      ok: adminContractProven(adminSteps),
      evidence: [
        'admin smoke route protection',
        'admin smoke ensure/idempotency/reconcile/rekey/revoke details',
        'admin smoke usage export shape',
        'admin smoke redacted key fields',
      ],
      reason: 'Harness production admin contract must be authenticated and shape-compatible.',
    }),
    verification({
      id: 'harness-worker-runtime',
      ok: harnessWorkerRuntimeProven(stagingSteps, k8sSecretSteps),
      evidence: [
        'harness_k8s_secret_rbac_get',
        'harness_k8s_secret_rbac_patch',
        'harness_k8s_secret_key_present',
        'staging sandbox_ready',
        'router-to-worker metadata',
        'harness_worker_status enabled/keyPresent/chemistryToolsEnabled',
        'harness_worker_home non-empty response',
        'harness_worker_discovery module/mode non-empty response',
      ],
      reason: 'Running sandbox worker must receive Harness config/key and expose worker-local Harness API.',
    }),
    verification({
      id: 'harness-secret-safety',
      ok:
        secretValueNotPrinted(k8sSecretEvidence) &&
        allHarnessEvidenceSecretSafe([adminEvidence, stagingEvidence, k8sSecretEvidence]),
      evidence: [
        'k8s secret smoke secretSafety.valuePrinted=false',
        'admin/staging/k8s evidence contains no obvious raw secret patterns',
      ],
      reason: 'Harness evidence must prove K8s Secret values were not printed and must not contain obvious raw secret values.',
    }),
    verification({
      id: 'harness-usage-attribution',
      ok:
        harnessInvokeAttributed(stagingSteps) &&
        harnessUsageSummaryIncreased(stagingSteps),
      evidence: [
        'harness_control_plane_invoke workspace/session attribution',
        'harness_usage_summary_after_invoke event count increased',
      ],
      reason: 'Harness invocation must create usage/audit attribution in control-plane.',
    }),
  ];

  const ok = verifications.every((entry) => entry.ok);
  console.log(JSON.stringify({
    ok,
    adminSmokePath: argValue('--admin-smoke'),
    stagingSmokePath: argValue('--staging-smoke'),
    k8sSecretSmokePath: argValue('--k8s-secret-smoke'),
    verifications,
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
