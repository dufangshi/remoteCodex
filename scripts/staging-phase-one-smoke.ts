import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { redactedSlice, redactSecretText } from './secret-redaction.js';

const execFileAsync = promisify(execFile);

interface SmokeStep {
  name: string;
  ok: boolean;
  details?: Record<string, unknown>;
}

type JsonObject = Record<string, any>;

const requiredEnv = [
  'STAGING_CONTROL_PLANE_BASE_URL',
  'STAGING_PRODUCT_JWT',
] as const;

let partialSteps: SmokeStep[] = [];

function envValue(name: string) {
  const value = process.env[name]?.trim();
  return value && !/<[^>]+>/.test(value) ? value : null;
}

function requireEnv(name: (typeof requiredEnv)[number]) {
  const value = envValue(name);
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function numericEnv(name: string, fallback: number) {
  const value = envValue(name);
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number.`);
  }
  return parsed;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestJson(input: {
  baseUrl?: string;
  path: string;
  method?: string;
  token?: string;
  body?: unknown;
  expectedStatus?: number;
}) {
  const baseUrl = input.baseUrl ?? requireEnv('STAGING_CONTROL_PLANE_BASE_URL');
  const url = new URL(input.path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  const response = await fetch(url, {
    method: input.method ?? 'GET',
    headers: {
      ...(input.token ? { authorization: `Bearer ${input.token}` } : {}),
      ...(input.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
  });
  const text = await response.text();
  let json: JsonObject | null = null;
  if (text) {
    try {
      const parsed = JSON.parse(text) as unknown;
      json = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as JsonObject
        : null;
    } catch {
      json = null;
    }
  }
  if (input.expectedStatus !== undefined && response.status !== input.expectedStatus) {
    throw new Error(`${input.method ?? 'GET'} ${url} expected ${input.expectedStatus}, got ${response.status}: ${text}`);
  }
  return {
    status: response.status,
    json,
    text,
    url: url.toString(),
  };
}

async function runOptionalCommand(name: string, commandEnvName: string): Promise<SmokeStep | null> {
  const commandJsonEnvName = `${commandEnvName}_JSON`;
  const envJsonEnvName = `${commandEnvName}_ENV_JSON`;
  const command = parseOptionalStringArrayEnv(commandJsonEnvName) ?? legacyCommand(commandEnvName);
  if (!command) {
    return null;
  }
  const [binary, ...args] = command;
  if (!binary) {
    throw new Error(`${commandEnvName} is empty.`);
  }
  const envOverrides = parseOptionalStringRecordEnv(envJsonEnvName);
  let stdout = '';
  let stderr = '';
  let commandError: string | null = null;
  try {
    const result = await execFileAsync(binary, args, {
      timeout: Number(process.env.STAGING_PROVIDER_SMOKE_TIMEOUT_MS ?? 120_000),
      env: {
        ...process.env,
        ...envOverrides,
      },
    });
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (error) {
    const commandFailure = error as {
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    stdout = commandFailure.stdout ?? '';
    stderr = commandFailure.stderr ?? '';
    commandError = redactSecretText(commandFailure.message ?? String(error));
  }
  const parsedStdout = parseOptionalJson(stdout);
  return {
    name,
    ok: commandError ? false : parsedStdout?.ok === undefined ? true : parsedStdout.ok === true,
    details: {
      commandEnv: commandEnvName,
      stdout: redactedSlice(stdout),
      stderr: redactedSlice(stderr),
      commandError,
      parsedStdout,
      commandJsonEnv: process.env[commandJsonEnvName] ? commandJsonEnvName : null,
      envJsonEnv: process.env[envJsonEnvName] ? envJsonEnvName : null,
      envOverrideKeys: Object.keys(envOverrides),
    },
  };
}

function legacyCommand(commandEnvName: string) {
  const command = envValue(commandEnvName);
  if (!command) {
    return null;
  }
  return command.split(' ').filter(Boolean);
}

function parseOptionalStringArrayEnv(name: string) {
  const value = envValue(name);
  if (!value) {
    return null;
  }
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every((entry) => typeof entry === 'string')) {
    throw new Error(`${name} must be a JSON string array.`);
  }
  return parsed;
}

function parseOptionalStringRecordEnv(name: string) {
  const value = envValue(name);
  if (!value) {
    return {};
  }
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${name} must be a JSON object with string values.`);
  }
  const entries = Object.entries(parsed);
  if (!entries.every(([, entryValue]) => typeof entryValue === 'string')) {
    throw new Error(`${name} must be a JSON object with string values.`);
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

function parseOptionalJson(value: string): JsonObject | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith('{')) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as JsonObject
      : null;
  } catch {
    return null;
  }
}

function privateWorkerDenialEvidence() {
  const reviewedBy = envValue('STAGING_DIRECT_WORKER_PRIVATE_REVIEWED_BY');
  const networkMode = envValue('STAGING_DIRECT_WORKER_NETWORK_MODE');
  const ingressPolicy = envValue('STAGING_DIRECT_WORKER_INGRESS_POLICY');
  const proof = envValue('STAGING_DIRECT_WORKER_PRIVATE_PROOF');
  if (!reviewedBy && !networkMode && !ingressPolicy && !proof) {
    return null;
  }
  return {
    reviewedBy,
    networkMode,
    ingressPolicy,
    proof,
  };
}

async function waitForSandboxRunning(input: {
  productJwt: string;
  sandboxId: string;
  steps: SmokeStep[];
}) {
  const timeoutMs = numericEnv('STAGING_SANDBOX_READY_TIMEOUT_MS', 10 * 60_000);
  const intervalMs = numericEnv('STAGING_SANDBOX_READY_POLL_MS', 10_000);
  const deadline = Date.now() + timeoutMs;
  let lastHealth: Awaited<ReturnType<typeof requestJson>> | null = null;
  while (Date.now() <= deadline) {
    lastHealth = await requestJson({
      path: '/api/sandbox/health',
      token: input.productJwt,
      expectedStatus: 200,
    });
    const sandbox = lastHealth.json.sandbox;
    if (sandbox.state === 'running') {
      input.steps.push({
        name: 'sandbox_ready',
        ok: true,
        details: {
          sandboxId: input.sandboxId,
          state: sandbox.state,
          routerBaseUrl: sandbox.routerBaseUrl,
          workerServiceName: sandbox.workerServiceName,
          k8sNamespace: sandbox.k8sNamespace,
          k8sPodName: sandbox.k8sPodName,
          startupProgress: sandbox.startupProgress,
        },
      });
      return lastHealth;
    }
    if (sandbox.state === 'failed') {
      input.steps.push({
        name: 'sandbox_ready',
        ok: false,
        details: {
          sandboxId: input.sandboxId,
          state: sandbox.state,
          statusReason: sandbox.statusReason,
          lastFailureCode: sandbox.lastFailureCode,
          lastFailureMessage: sandbox.lastFailureMessage,
        },
      });
      return lastHealth;
    }
    await sleep(intervalMs);
  }
  input.steps.push({
    name: 'sandbox_ready',
    ok: false,
    details: {
      sandboxId: input.sandboxId,
      timeoutMs,
      lastState: lastHealth?.json?.sandbox?.state,
      lastStatusReason: lastHealth?.json?.sandbox?.statusReason,
    },
  });
  return lastHealth;
}

async function waitForSandboxStopped(input: {
  productJwt: string;
  sandboxId: string;
}) {
  const timeoutMs = numericEnv('STAGING_SANDBOX_STOP_TIMEOUT_MS', 10 * 60_000);
  const intervalMs = numericEnv('STAGING_SANDBOX_STOP_POLL_MS', 10_000);
  const deadline = Date.now() + timeoutMs;
  let lastHealth: Awaited<ReturnType<typeof requestJson>> | null = null;
  while (Date.now() <= deadline) {
    lastHealth = await requestJson({
      path: '/api/sandbox/health',
      token: input.productJwt,
      expectedStatus: 200,
    });
    const sandbox = lastHealth.json.sandbox;
    if (sandbox.state === 'stopped') {
      return {
        health: lastHealth,
        stopped: true,
        timeoutMs,
      };
    }
    await sleep(intervalMs);
  }
  return {
    health: lastHealth,
    stopped: false,
    timeoutMs,
  };
}

async function optionalAdminSandboxDetail(input: {
  sandboxId: string;
  steps: SmokeStep[];
}) {
  const adminJwt = envValue('STAGING_ADMIN_JWT');
  if (!adminJwt) {
    return null;
  }
  const detail = await requestJson({
    path: `/api/admin/sandboxes/${input.sandboxId}`,
    token: adminJwt,
    expectedStatus: 200,
  });
  input.steps.push({
    name: 'admin_sandbox_runtime_detail',
    ok: true,
    details: {
      sandboxId: input.sandboxId,
      runtimeState: detail.json.runtimeStatus?.state,
      workerBaseUrl: detail.json.workerBaseUrl,
      k8sNamespace: detail.json.sandbox?.k8sNamespace ?? detail.json.runtimeStatus?.k8sNamespace,
      k8sPodName: detail.json.sandbox?.k8sPodName ?? detail.json.runtimeStatus?.k8sPodName,
      workerServiceName:
        detail.json.sandbox?.workerServiceName ?? detail.json.runtimeStatus?.workerServiceName,
      recentLifecycleAuditCount: detail.json.recentLifecycleErrors?.length ?? 0,
      failure:
        detail.json.runtimeStatus?.lastFailureCode ??
        detail.json.sandbox?.lastFailureCode ??
        null,
    },
  });
  return detail;
}

async function runOptionalIdempotentLifecycleSmoke(input: {
  productJwt: string;
  sandboxId: string;
  steps: SmokeStep[];
}) {
  if (process.env.STAGING_IDEMPOTENT_LIFECYCLE_SMOKE !== '1') {
    return;
  }
  const firstStart = await requestJson({
    path: '/api/sandbox/start',
    method: 'POST',
    token: input.productJwt,
    expectedStatus: 200,
  });
  const secondStart = await requestJson({
    path: '/api/sandbox/start',
    method: 'POST',
    token: input.productJwt,
    expectedStatus: 200,
  });
  const restart = await requestJson({
    path: '/api/sandbox/restart',
    method: 'POST',
    token: input.productJwt,
    expectedStatus: 200,
  });
  await waitForSandboxRunning(input);
  input.steps.push({
    name: 'idempotent_lifecycle',
    ok:
      firstStart.json.sandbox.id === input.sandboxId &&
      secondStart.json.sandbox.id === input.sandboxId &&
      restart.json.sandbox.id === input.sandboxId,
    details: {
      sandboxId: input.sandboxId,
      firstStartState: firstStart.json.sandbox.state,
      secondStartState: secondStart.json.sandbox.state,
      restartState: restart.json.sandbox.state,
    },
  });
}

async function main() {
  for (const name of requiredEnv) {
    requireEnv(name);
  }
  const productJwt = requireEnv('STAGING_PRODUCT_JWT');
  const suffix = `${Date.now()}`;
  const steps: SmokeStep[] = [];
  partialSteps = steps;

  const bootstrap = await requestJson({
    path: '/api/me/bootstrap',
    method: 'POST',
    token: productJwt,
    body: {
      email: process.env.STAGING_SMOKE_EMAIL ?? 'phase-one-smoke@example.test',
      displayName: 'Phase One Smoke',
    },
    expectedStatus: 200,
  });
  const sandbox = bootstrap.json.sandbox;
  steps.push({
    name: 'bootstrap_user_and_sandbox',
    ok: true,
    details: {
      userId: bootstrap.json.user.id,
      sandboxId: sandbox.id,
      sandboxState: sandbox.state,
    },
  });

  const start = await requestJson({
    path: '/api/sandbox/start',
    method: 'POST',
    token: productJwt,
    expectedStatus: 200,
  });
  steps.push({
    name: 'start_sandbox',
    ok: ['starting', 'running'].includes(start.json.sandbox.state),
    details: {
      sandboxId: start.json.sandbox.id,
      state: start.json.sandbox.state,
      image: start.json.sandbox.image,
      resourceProfile: start.json.sandbox.resourceProfile,
      routerBaseUrl: start.json.sandbox.routerBaseUrl,
      workerServiceName: start.json.sandbox.workerServiceName,
      k8sNamespace: start.json.sandbox.k8sNamespace,
      k8sPodName: start.json.sandbox.k8sPodName,
      startupProgress: start.json.sandbox.startupProgress,
    },
  });

  const health = await requestJson({
    path: '/api/sandbox/health',
    token: productJwt,
    expectedStatus: 200,
  });
  steps.push({
    name: 'sandbox_health',
    ok: true,
    details: {
      sandboxId: health.json.sandbox.id,
      state: health.json.sandbox.state,
      lastSeenAt: health.json.sandbox.lastSeenAt,
      statusReason: health.json.sandbox.statusReason,
    },
  });
  await waitForSandboxRunning({ productJwt, sandboxId: sandbox.id, steps });
  await optionalAdminSandboxDetail({ sandboxId: sandbox.id, steps });
  await runOptionalIdempotentLifecycleSmoke({ productJwt, sandboxId: sandbox.id, steps });

  const project = await requestJson({
    path: '/api/projects',
    method: 'POST',
    token: productJwt,
    body: {
      name: `Phase One Smoke ${suffix}`,
      slug: `phase-one-smoke-${suffix}`,
    },
    expectedStatus: 200,
  });
  const workspace = await requestJson({
    path: `/api/projects/${project.json.project.id}/workspaces`,
    method: 'POST',
    token: productJwt,
    body: {
      name: `Smoke Workspace ${suffix}`,
      slug: `smoke-workspace-${suffix}`,
    },
    expectedStatus: 200,
  });
  const session = await requestJson({
    path: `/api/workspaces/${workspace.json.workspace.id}/sessions`,
    method: 'POST',
    token: productJwt,
    body: {
      provider: 'codex',
      title: `Smoke Session ${suffix}`,
    },
    expectedStatus: 200,
  });
  steps.push({
    name: 'create_project_workspace_session',
    ok: true,
    details: {
      projectId: project.json.project.id,
      workspaceId: workspace.json.workspace.id,
      sessionId: session.json.session.id,
    },
  });

  const routeToken = await requestJson({
    path: `/api/sandboxes/${sandbox.id}/route-token`,
    method: 'POST',
    token: productJwt,
    body: {
      projectId: project.json.project.id,
      workspaceId: workspace.json.workspace.id,
      sessionId: session.json.session.id,
      scopes: ['worker:read'],
    },
    expectedStatus: 200,
  });
  steps.push({
    name: 'issue_route_token',
    ok: Boolean(routeToken.json.token && routeToken.json.routerBaseUrl),
    details: {
      sandboxId: routeToken.json.sandboxId,
      routerBaseUrl: routeToken.json.routerBaseUrl,
      expiresAt: routeToken.json.expiresAt,
    },
  });

  const routerBaseUrl = routeToken.json.routerBaseUrl as string;
  const routerHealth = await requestJson({
    baseUrl: routerBaseUrl,
    path: '/healthz',
    expectedStatus: 200,
  });
  steps.push({
    name: 'router_health',
    ok: routerHealth.json.ok === true && routerHealth.json.role === 'sandbox-router',
    details: {
      routerBaseUrl,
      role: routerHealth.json.role,
      status: routerHealth.status,
    },
  });

  const proxiedMetadata = await requestJson({
    baseUrl: routerBaseUrl,
    path: `/api/sandboxes/${sandbox.id}/api/worker/metadata?token=${encodeURIComponent(routeToken.json.token)}`,
    token: productJwt,
    expectedStatus: 200,
  });
  const proxiedBody = proxiedMetadata.json;
  steps.push({
    name: 'browser_to_router_to_worker',
    ok:
      proxiedBody.role === 'worker' &&
      proxiedBody.requestDiagnostics?.authorizationHeaderPresent === false &&
      proxiedBody.requestDiagnostics?.workerTokenHeaderPresent === true,
    details: {
      role: proxiedBody.role,
      sandboxId: proxiedBody.sandboxId,
      userId: proxiedBody.userId,
      managementRoutesEnabled: proxiedBody.managementRoutesEnabled,
      requestDiagnostics: proxiedBody.requestDiagnostics,
    },
  });

  const directWorkerBaseUrl = envValue('STAGING_DIRECT_WORKER_BASE_URL');
  if (directWorkerBaseUrl) {
    const direct = await requestJson({
      baseUrl: directWorkerBaseUrl,
      path: '/api/worker/metadata',
    });
    const denied = direct.status === 401 || direct.status === 403;
    steps.push({
      name: 'direct_worker_denial',
      ok: denied,
      details: {
        status: direct.status,
        acceptedStatuses: [401, 403],
      },
    });
  } else {
    const privateProof = privateWorkerDenialEvidence();
    if (privateProof) {
      steps.push({
        name: 'direct_worker_private_denial',
        ok:
          Boolean(privateProof.reviewedBy) &&
          privateProof.networkMode === 'private' &&
          privateProof.ingressPolicy === 'router-only' &&
          Boolean(privateProof.proof),
        details: privateProof,
      });
    }
  }

  for (const optional of [
    ['codex_gateway_smoke', 'STAGING_CODEX_GATEWAY_SMOKE_COMMAND'],
    ['claude_gateway_smoke', 'STAGING_CLAUDE_GATEWAY_SMOKE_COMMAND'],
    ['opencode_gateway_smoke', 'STAGING_OPENCODE_GATEWAY_SMOKE_COMMAND'],
  ] as const) {
    const result = await runOptionalCommand(optional[0], optional[1]);
    if (result) {
      steps.push(result);
    }
  }

  if (process.env.STAGING_STOP_SANDBOX_AFTER_SMOKE === '1') {
    const stop = await requestJson({
      path: '/api/sandbox/stop',
      method: 'POST',
      token: productJwt,
      expectedStatus: 200,
    });
    const final = await waitForSandboxStopped({ productJwt, sandboxId: sandbox.id });
    const finalSandbox = final.health?.json?.sandbox;
    steps.push({
      name: 'stop_sandbox',
      ok: ['stopping', 'stopped'].includes(stop.json.sandbox.state) && final.stopped,
      details: {
        sandboxId: stop.json.sandbox.id,
        state: stop.json.sandbox.state,
        finalHealthState: finalSandbox?.state,
        stopConverged: final.stopped,
        stopTimeoutMs: final.timeoutMs,
        k8sPodName: stop.json.sandbox.k8sPodName,
        workerServiceName: stop.json.sandbox.workerServiceName,
      },
    });
  }

  const failed = steps.filter((step) => !step.ok);
  console.log(JSON.stringify({
    ok: failed.length === 0,
    generatedAt: new Date().toISOString(),
    controlPlaneBaseUrl: requireEnv('STAGING_CONTROL_PLANE_BASE_URL'),
    steps,
  }, null, 2));

  if (failed.length > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
    generatedAt: new Date().toISOString(),
    controlPlaneBaseUrl: envValue('STAGING_CONTROL_PLANE_BASE_URL'),
    steps: partialSteps,
  }, null, 2));
  process.exit(1);
});
