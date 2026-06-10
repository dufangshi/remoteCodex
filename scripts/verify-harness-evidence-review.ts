import { readFile } from 'node:fs/promises';

interface ReviewObject {
  [key: string]: any;
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

async function readJson(path: string) {
  const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${path} must contain a JSON object.`);
  }
  return parsed as ReviewObject;
}

function nonEmptyString(value: unknown) {
  return typeof value === 'string' && value.trim() && !/<[^>]+>/.test(value);
}

function check(input: {
  name: string;
  ok: boolean;
  details?: Record<string, unknown>;
}) {
  return input;
}

const requiredHarnessIntegrationGates = [
  'harness-admin-contract',
  'harness-worker-runtime',
  'harness-secret-safety',
  'harness-usage-attribution',
];

function requiredGatesPresent(value: unknown) {
  return Array.isArray(value) &&
    requiredHarnessIntegrationGates.every((gate) => value.includes(gate));
}

async function main() {
  const path = argValue('--review') ?? process.argv[2];
  if (!path) {
    throw new Error('Usage: pnpm verify:harness-evidence-review -- --review <evidence-review.json>');
  }
  const review = await readJson(path);
  const checks = [
    check({
      name: 'review_metadata_present',
      ok:
        nonEmptyString(review.generatedAt) &&
        nonEmptyString(review.reviewedBy) &&
        nonEmptyString(review.reviewSource),
      details: {
        generatedAtPresent: nonEmptyString(review.generatedAt),
        reviewedByPresent: nonEmptyString(review.reviewedBy),
        reviewSourcePresent: nonEmptyString(review.reviewSource),
      },
    }),
    check({
      name: 'admin_smoke_reviewed',
      ok:
        nonEmptyString(review.harness?.adminSmokePath) &&
        review.harness?.adminSmokeOk === true,
      details: {
        pathPresent: nonEmptyString(review.harness?.adminSmokePath),
        ok: review.harness?.adminSmokeOk === true,
      },
    }),
    check({
      name: 'staging_smoke_reviewed',
      ok:
        nonEmptyString(review.remoteCodex?.stagingSmokePath) &&
        review.remoteCodex?.stagingSmokeOk === true,
      details: {
        pathPresent: nonEmptyString(review.remoteCodex?.stagingSmokePath),
        ok: review.remoteCodex?.stagingSmokeOk === true,
      },
    }),
    check({
      name: 'k8s_secret_smoke_reviewed',
      ok:
        nonEmptyString(review.kubernetes?.k8sSecretSmokePath) &&
        review.kubernetes?.k8sSecretSmokeOk === true &&
        review.kubernetes?.secretDataValuesPrinted === false,
      details: {
        pathPresent: nonEmptyString(review.kubernetes?.k8sSecretSmokePath),
        ok: review.kubernetes?.k8sSecretSmokeOk === true,
        secretDataValuesPrinted: review.kubernetes?.secretDataValuesPrinted,
      },
    }),
    check({
      name: 'combined_verifier_reviewed',
      ok:
        nonEmptyString(review.combinedVerifier?.path) &&
        review.combinedVerifier?.ok === true &&
        requiredGatesPresent(review.combinedVerifier?.requiredGates),
      details: {
        pathPresent: nonEmptyString(review.combinedVerifier?.path),
        ok: review.combinedVerifier?.ok === true,
        requiredGatesPresent: requiredGatesPresent(review.combinedVerifier?.requiredGates),
        requiredGates: requiredHarnessIntegrationGates,
      },
    }),
    check({
      name: 'secret_safety_reviewed',
      ok:
        review.secretSafety?.valuesPrinted === false &&
        review.secretSafety?.frontendBundleContainsHarnessKey === false &&
        review.secretSafety?.apiResponseContainsHarnessKey === false &&
        review.secretSafety?.threadMessageContainsHarnessKey === false &&
        review.secretSafety?.logsContainHarnessKey === false,
      details: {
        valuesPrinted: review.secretSafety?.valuesPrinted,
        frontendBundleContainsHarnessKey: review.secretSafety?.frontendBundleContainsHarnessKey,
        apiResponseContainsHarnessKey: review.secretSafety?.apiResponseContainsHarnessKey,
        threadMessageContainsHarnessKey: review.secretSafety?.threadMessageContainsHarnessKey,
        logsContainHarnessKey: review.secretSafety?.logsContainHarnessKey,
      },
    }),
  ];
  const ok = checks.every((entry) => entry.ok);
  console.log(JSON.stringify({
    ok,
    reviewPath: path,
    checks,
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
