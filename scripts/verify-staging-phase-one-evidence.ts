import { readFile } from 'node:fs/promises';

export interface SmokeStep {
  name: string;
  ok: boolean;
  details?: Record<string, unknown>;
}

export interface SmokeReport {
  ok?: boolean;
  generatedAt?: string;
  controlPlaneBaseUrl?: string;
  steps?: SmokeStep[];
}

export interface ChecklistResult {
  item: string;
  title: string;
  readyToCheck: boolean;
  reason: string;
  matchedSteps: string[];
  requiredEvidence: string[];
}

const providerSteps = {
  'G6.11': {
    title: 'Run staging Codex gateway smoke.',
    stepName: 'codex_gateway_smoke',
    provider: 'codex',
  },
  'G6.12': {
    title: 'Run staging Claude Code gateway smoke.',
    stepName: 'claude_gateway_smoke',
    provider: 'claude',
  },
  'G6.13': {
    title: 'Run staging OpenCode gateway smoke.',
    stepName: 'opencode_gateway_smoke',
    provider: 'opencode',
  },
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function readInput() {
  const path = process.argv.slice(2).find((argument) => argument !== '--');
  if (path && path !== '-') {
    return readFile(path, 'utf8');
  }

  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function parseStagingPhaseOneReport(input: string): SmokeReport {
  const parsed = JSON.parse(input) as unknown;
  if (!isRecord(parsed)) {
    throw new Error('Evidence input must be a JSON object.');
  }
  if (!Array.isArray(parsed.steps)) {
    throw new Error('Evidence input must include a steps array.');
  }
  return parsed as SmokeReport;
}

function stepMap(report: SmokeReport) {
  const map = new Map<string, SmokeStep>();
  for (const step of report.steps ?? []) {
    if (isRecord(step) && typeof step.name === 'string' && typeof step.ok === 'boolean') {
      map.set(step.name, step);
    }
  }
  return map;
}

function stringDetail(step: SmokeStep | undefined, name: string) {
  const value = step?.details?.[name];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function booleanEvidence(value: unknown) {
  return value === true;
}

function requestDiagnostics(step: SmokeStep | undefined) {
  const value = step?.details?.requestDiagnostics;
  return isRecord(value) ? value : {};
}

function ready(input: {
  item: string;
  title: string;
  reason: string;
  matchedSteps: string[];
  requiredEvidence: string[];
}): ChecklistResult {
  return {
    ...input,
    readyToCheck: true,
  };
}

function notReady(input: {
  item: string;
  title: string;
  reason: string;
  matchedSteps?: string[];
  requiredEvidence: string[];
}): ChecklistResult {
  return {
    ...input,
    matchedSteps: input.matchedSteps ?? [],
    readyToCheck: false,
  };
}

function verifyProvider(
  item: keyof typeof providerSteps,
  steps: Map<string, SmokeStep>,
): ChecklistResult {
  const config = providerSteps[item];
  const step = steps.get(config.stepName);
  const requiredEvidence = [
    `${config.stepName}.ok is true`,
    `parsedStdout.provider is ${config.provider}`,
    'parsedStdout.gatewayUsageRecorded is true',
    'parsedStdout.rootKeysAbsent is true',
    'parsedStdout.workerConfigUsesGateway is true',
  ];
  if (!step) {
    return notReady({
      item,
      title: config.title,
      reason: `${config.stepName} is missing from the staging evidence.`,
      requiredEvidence,
    });
  }
  if (!step.ok) {
    return notReady({
      item,
      title: config.title,
      reason: `${config.stepName} did not pass.`,
      matchedSteps: [config.stepName],
      requiredEvidence,
    });
  }

  const parsedStdout = step.details?.parsedStdout;
  if (!isRecord(parsedStdout)) {
    return notReady({
      item,
      title: config.title,
      reason: `${config.stepName} must emit JSON parsedStdout with gateway usage and secret-absence proof.`,
      matchedSteps: [config.stepName],
      requiredEvidence,
    });
  }

  const hasRequiredFields =
    parsedStdout.provider === config.provider &&
    booleanEvidence(parsedStdout.gatewayUsageRecorded) &&
    booleanEvidence(parsedStdout.rootKeysAbsent) &&
    booleanEvidence(parsedStdout.workerConfigUsesGateway);

  if (!hasRequiredFields) {
    return notReady({
      item,
      title: config.title,
      reason: `${config.stepName} parsedStdout is missing one or more required proof fields.`,
      matchedSteps: [config.stepName],
      requiredEvidence,
    });
  }

  return ready({
    item,
    title: config.title,
    reason: `${config.stepName} includes gateway usage, gateway config, and root-key absence proof.`,
    matchedSteps: [config.stepName],
    requiredEvidence,
  });
}

export function evaluateStagingPhaseOneEvidence(report: SmokeReport): ChecklistResult[] {
  const steps = stepMap(report);
  const start = steps.get('start_sandbox');
  const readyStep = steps.get('sandbox_ready');
  const adminDetail = steps.get('admin_sandbox_runtime_detail');
  const stop = steps.get('stop_sandbox');
  const idempotent = steps.get('idempotent_lifecycle');
  const issueRouteToken = steps.get('issue_route_token');
  const routerHealth = steps.get('router_health');
  const browserProxy = steps.get('browser_to_router_to_worker');
  const directDenial = steps.get('direct_worker_denial');

  const results: ChecklistResult[] = [];

  results.push(notReady({
    item: 'S3.04',
    title: 'Finalize AWS staging configuration.',
    reason: 'AWS account, cluster, namespace, Fargate profile, VPC, IAM, registry, and log-group review is not fully provable from smoke JSON alone.',
    requiredEvidence: [
      'Reviewed staging AWS account and region',
      'Reviewed EKS cluster, namespace, Fargate profile, VPC, subnets, and security groups',
      'Reviewed worker image registry/tag and log groups',
      'Attached AWS access smoke or staging config review artifact',
    ],
  }));

  results.push(notReady({
    item: 'S3.05',
    title: 'Add least-privilege Kubernetes credentials.',
    reason: 'Kubernetes RBAC and IAM least-privilege review is not fully provable from smoke JSON alone.',
    requiredEvidence: [
      'Reviewed service account, IAM role, and Kubernetes RBAC',
      'Confirmed control plane can create, inspect, and delete only owned worker resources',
      'Attached config validation or staging lifecycle smoke plus credential review artifact',
    ],
  }));

  const podCreationMatched = ['start_sandbox', 'sandbox_ready'];
  if (adminDetail) {
    podCreationMatched.push('admin_sandbox_runtime_detail');
  }
  const podCreationReady =
    start?.ok === true &&
    readyStep?.ok === true &&
    adminDetail?.ok === true &&
    stringDetail(start, 'image') &&
    stringDetail(readyStep, 'k8sPodName') &&
    stringDetail(readyStep, 'workerServiceName') &&
    stringDetail(readyStep, 'k8sNamespace');
  results.push(podCreationReady
    ? ready({
      item: 'S3.06',
      title: 'Create a real worker Pod from the control plane.',
      reason: 'Staging evidence shows sandbox start, readiness, Pod identity, namespace, worker service, and image.',
      matchedSteps: podCreationMatched,
      requiredEvidence: [
        'start_sandbox.ok is true with image',
        'sandbox_ready.ok is true with k8sPodName, workerServiceName, and k8sNamespace',
        'admin_sandbox_runtime_detail.ok is true',
      ],
    })
    : notReady({
      item: 'S3.06',
      title: 'Create a real worker Pod from the control plane.',
      reason: 'Missing sandbox start/readiness/admin runtime detail or Pod identity fields.',
      matchedSteps: podCreationMatched.filter((name) => steps.has(name)),
      requiredEvidence: [
        'start_sandbox.ok is true with image',
        'sandbox_ready.ok is true with k8sPodName, workerServiceName, and k8sNamespace',
        'admin_sandbox_runtime_detail.ok is true',
      ],
    }));

  const stopReady =
    stop?.ok === true &&
    ['stopping', 'stopped'].includes(String(stop.details?.state ?? '')) &&
    stop.details?.finalHealthState === 'stopped' &&
    stop.details?.stopConverged === true;
  results.push(stopReady
    ? ready({
      item: 'S3.07',
      title: 'Stop a real worker Pod from the control plane.',
      reason: 'Staging evidence shows stop accepted and final health state converged to stopped.',
      matchedSteps: ['stop_sandbox'],
      requiredEvidence: [
        'stop_sandbox.ok is true',
        'stop_sandbox.details.state is stopping or stopped',
        'stop_sandbox.details.finalHealthState is stopped',
        'stop_sandbox.details.stopConverged is true',
      ],
    })
    : notReady({
      item: 'S3.07',
      title: 'Stop a real worker Pod from the control plane.',
      reason: 'stop_sandbox is missing or did not converge to stopped.',
      matchedSteps: stop ? ['stop_sandbox'] : [],
      requiredEvidence: [
        'stop_sandbox.ok is true',
        'stop_sandbox.details.state is stopping or stopped',
        'stop_sandbox.details.finalHealthState is stopped',
        'stop_sandbox.details.stopConverged is true',
      ],
    }));

  results.push(idempotent?.ok === true
    ? ready({
      item: 'S3.08',
      title: 'Add idempotent lifecycle smoke.',
      reason: 'Staging evidence includes a passing idempotent lifecycle smoke.',
      matchedSteps: ['idempotent_lifecycle'],
      requiredEvidence: [
        'idempotent_lifecycle.ok is true',
        'Repeated start/restart calls keep one sandbox id',
      ],
    })
    : notReady({
      item: 'S3.08',
      title: 'Add idempotent lifecycle smoke.',
      reason: 'idempotent_lifecycle is missing or failed.',
      matchedSteps: idempotent ? ['idempotent_lifecycle'] : [],
      requiredEvidence: [
        'idempotent_lifecycle.ok is true',
        'Repeated start/restart calls keep one sandbox id',
      ],
    }));

  const routerReady =
    requestDiagnostics(browserProxy).authorizationHeaderPresent === false &&
    requestDiagnostics(browserProxy).workerTokenHeaderPresent === true &&
    issueRouteToken?.ok === true &&
    routerHealth?.ok === true &&
    browserProxy?.ok === true &&
    Boolean(stringDetail(issueRouteToken, 'routerBaseUrl')) &&
    Boolean(stringDetail(routerHealth, 'routerBaseUrl')) &&
    routerHealth.details?.role === 'sandbox-router' &&
    browserProxy.details?.role === 'worker' &&
    typeof browserProxy.details?.sandboxId === 'string' &&
    typeof browserProxy.details?.userId === 'string';
  results.push(routerReady
    ? ready({
      item: 'R5.10',
      title: 'Deploy sandbox-router in staging.',
      reason: 'Staging evidence shows router health, route-token issuance, and successful router-to-worker resolution.',
      matchedSteps: ['issue_route_token', 'router_health', 'browser_to_router_to_worker'],
      requiredEvidence: [
        'issue_route_token.ok is true with routerBaseUrl',
        'router_health.ok is true with role sandbox-router',
        'browser_to_router_to_worker.ok is true',
        'Worker metadata reports role, sandboxId, and userId',
        'Worker metadata requestDiagnostics shows browser authorization stripped',
        'Worker metadata requestDiagnostics shows worker token header present',
      ],
    })
    : notReady({
      item: 'R5.10',
      title: 'Deploy sandbox-router in staging.',
      reason: 'Missing router health, route-token routerBaseUrl, or successful browser-to-router-to-worker evidence.',
      matchedSteps: ['issue_route_token', 'router_health', 'browser_to_router_to_worker'].filter((name) => steps.has(name)),
      requiredEvidence: [
        'issue_route_token.ok is true with routerBaseUrl',
        'router_health.ok is true with role sandbox-router',
        'browser_to_router_to_worker.ok is true',
        'Worker metadata reports role, sandboxId, and userId',
        'Worker metadata requestDiagnostics shows browser authorization stripped',
        'Worker metadata requestDiagnostics shows worker token header present',
      ],
    }));

  const directStatus = directDenial?.details?.status;
  const directReady = directDenial?.ok === true && (directStatus === 401 || directStatus === 403);
  results.push(directReady
    ? ready({
      item: 'R5.11',
      title: 'Add direct-worker-denial proof.',
      reason: 'Staging evidence shows direct worker access denied without router-injected token.',
      matchedSteps: ['direct_worker_denial'],
      requiredEvidence: [
        'direct_worker_denial.ok is true',
        'direct_worker_denial.details.status is 401 or 403',
      ],
    })
    : notReady({
      item: 'R5.11',
      title: 'Add direct-worker-denial proof.',
      reason: 'direct_worker_denial is missing or did not record a 401/403 denial.',
      matchedSteps: directDenial ? ['direct_worker_denial'] : [],
      requiredEvidence: [
        'direct_worker_denial.ok is true',
        'direct_worker_denial.details.status is 401 or 403',
      ],
    }));

  const browserProxyReady =
    browserProxy?.ok === true &&
    browserProxy.details?.role === 'worker' &&
    requestDiagnostics(browserProxy).authorizationHeaderPresent === false &&
    requestDiagnostics(browserProxy).workerTokenHeaderPresent === true;
  results.push(browserProxyReady
    ? ready({
      item: 'R5.12',
      title: 'Add browser-to-router-to-worker smoke.',
      reason: 'Staging evidence shows browser-style router traffic reached worker metadata without forwarding browser authorization.',
      matchedSteps: ['browser_to_router_to_worker'],
      requiredEvidence: [
        'browser_to_router_to_worker.ok is true',
        'Worker metadata role is worker',
        'Worker metadata includes sandboxId and userId',
        'Worker metadata requestDiagnostics.authorizationHeaderPresent is false',
        'Worker metadata requestDiagnostics.workerTokenHeaderPresent is true',
      ],
    })
    : notReady({
      item: 'R5.12',
      title: 'Add browser-to-router-to-worker smoke.',
      reason: 'browser_to_router_to_worker is missing, did not reach worker metadata, or did not prove header stripping.',
      matchedSteps: browserProxy ? ['browser_to_router_to_worker'] : [],
      requiredEvidence: [
        'browser_to_router_to_worker.ok is true',
        'Worker metadata role is worker',
        'Worker metadata includes sandboxId and userId',
        'Worker metadata requestDiagnostics.authorizationHeaderPresent is false',
        'Worker metadata requestDiagnostics.workerTokenHeaderPresent is true',
      ],
    }));

  results.push(verifyProvider('G6.11', steps));
  results.push(verifyProvider('G6.12', steps));
  results.push(verifyProvider('G6.13', steps));

  return results;
}

async function main() {
  const input = await readInput();
  const report = parseStagingPhaseOneReport(input);
  const results = evaluateStagingPhaseOneEvidence(report);
  const readyItems = results.filter((result) => result.readyToCheck).map((result) => result.item);
  const notReadyItems = results.filter((result) => !result.readyToCheck).map((result) => result.item);

  console.log(JSON.stringify({
    ok: notReadyItems.length === 0,
    generatedAt: new Date().toISOString(),
    evidenceGeneratedAt: report.generatedAt ?? null,
    controlPlaneBaseUrl: report.controlPlaneBaseUrl ?? null,
    readyItems,
    notReadyItems,
    results,
  }, null, 2));

  // Missing checklist evidence is reported in JSON instead of as a process
  // failure so operators can use this as an audit step before boxes are ready.
}

if (process.argv[1]?.match(/verify-staging-phase-one-evidence\.(ts|js)$/)) {
  main().catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }, null, 2));
    process.exit(1);
  });
}
