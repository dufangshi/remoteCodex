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

let partialSteps: SmokeStep[] = [];
const DEFAULT_STAGING_CONTROL_PLANE_BASE_URL =
  'https://remote-codex-control-plane-production.up.railway.app';
const DEFAULT_STAGING_LOGIN_EMAIL = 'dev@example.com';
const DEFAULT_STAGING_LOGIN_PASSWORD = '123123123';
const DEFAULT_CODEX_E2E_PROMPT =
  'Reply with exactly: remote-codex-codex-e2e-ok';

function envValue(name: string) {
  const value = process.env[name]?.trim();
  return value && !/<[^>]+>/.test(value) ? value : null;
}

function controlPlaneBaseUrl() {
  if (process.env.STAGING_CONTROL_PLANE_BASE_URL?.trim().match(/<[^>]+>/)) {
    throw new Error('STAGING_CONTROL_PLANE_BASE_URL contains a placeholder.');
  }
  return envValue('STAGING_CONTROL_PLANE_BASE_URL') ?? DEFAULT_STAGING_CONTROL_PLANE_BASE_URL;
}

function safeControlPlaneBaseUrl() {
  try {
    return controlPlaneBaseUrl();
  } catch {
    return null;
  }
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
  const baseUrl = input.baseUrl ?? controlPlaneBaseUrl();
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

async function resolveProductJwt() {
  const existing = envValue('STAGING_PRODUCT_JWT');
  if (existing) {
    return {
      token: existing,
      source: 'env',
      email: null,
    };
  }

  const email = envValue('STAGING_LOGIN_EMAIL') ?? DEFAULT_STAGING_LOGIN_EMAIL;
  const password = envValue('STAGING_LOGIN_PASSWORD') ?? DEFAULT_STAGING_LOGIN_PASSWORD;
  const login = await requestJson({
    path: '/api/auth/password/login',
    method: 'POST',
    body: {
      email,
      password,
    },
    expectedStatus: 200,
  });
  const token = login.json?.session?.token;
  if (typeof token !== 'string' || !token.trim()) {
    throw new Error('Password login response did not include session.token.');
  }
  return {
    token,
    source: 'password-login',
    email,
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

function booleanEnv(name: string) {
  const value = envValue(name);
  return value ? ['1', 'true', 'yes', 'on'].includes(value.toLowerCase()) : false;
}

function parseOptionalObjectEnv(name: string) {
  const value = envValue(name);
  if (!value) {
    return null;
  }
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${name} must be a JSON object.`);
  }
  return parsed as JsonObject;
}

function numberFromPath(value: JsonObject | null, paths: string[][]) {
  for (const pathParts of paths) {
    let current: unknown = value;
    for (const part of pathParts) {
      current = current && typeof current === 'object' && !Array.isArray(current)
        ? (current as JsonObject)[part]
        : undefined;
    }
    if (typeof current === 'number' && Number.isFinite(current)) {
      return current;
    }
    if (typeof current === 'string' && current.trim() && Number.isFinite(Number(current))) {
      return Number(current);
    }
  }
  return null;
}

function harnessUsageEventCount(value: JsonObject | null) {
  return numberFromPath(value, [
    ['usage', 'eventCount'],
    ['usage', 'totalEvents'],
    ['summary', 'eventCount'],
    ['summary', 'totalEvents'],
    ['eventCount'],
    ['totalEvents'],
  ]);
}

function harnessUsageCostUsd(value: JsonObject | null) {
  return numberFromPath(value, [
    ['usage', 'costUsd'],
    ['usage', 'totalCostUsd'],
    ['summary', 'costUsd'],
    ['summary', 'totalCostUsd'],
    ['costUsd'],
    ['totalCostUsd'],
  ]);
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

async function runOptionalHarnessSmoke(input: {
  productJwt: string;
  sandboxId: string;
  routerBaseUrl: string;
  routeToken: string;
  sessionId: string;
  workspaceId: string;
  steps: SmokeStep[];
}) {
  if (!booleanEnv('STAGING_HARNESS_SMOKE')) {
    return;
  }
  const module = envValue('STAGING_HARNESS_MODULE') ?? 'farmaco';
  const helpOrTools = envValue('STAGING_HARNESS_DISCOVERY_MODE') ?? 'tools';
  const usageBefore = await requestJson({
    path: '/api/usage/harness/summary',
    token: input.productJwt,
    expectedStatus: 200,
  });
  input.steps.push({
    name: 'harness_usage_summary_before',
    ok: true,
    details: {
      eventCount: harnessUsageEventCount(usageBefore.json),
      costUsd: harnessUsageCostUsd(usageBefore.json),
    },
  });

  const status = await requestJson({
    baseUrl: input.routerBaseUrl,
    path: `/api/sandboxes/${input.sandboxId}/api/harness/status?token=${encodeURIComponent(input.routeToken)}`,
    token: input.productJwt,
    expectedStatus: 200,
  });
  const harness = status.json.harness ?? status.json;
  input.steps.push({
    name: 'harness_worker_status',
    ok:
      (harness.enabled === true || status.json.enabled === true) &&
      (harness.keyPresent === true || status.json.keyPresent === true) &&
      (harness.chemistryToolsEnabled === true || status.json.chemistryToolsEnabled === true),
    details: {
      enabled: harness.enabled ?? status.json.enabled,
      baseUrl: harness.baseUrl ?? status.json.baseUrl,
      keyPresent: harness.keyPresent ?? status.json.keyPresent,
      chemistryToolsEnabled: harness.chemistryToolsEnabled ?? status.json.chemistryToolsEnabled,
      modules: harness.modules ?? status.json.modules,
      health: status.json.health,
    },
  });

  const home = await requestJson({
    baseUrl: input.routerBaseUrl,
    path: `/api/sandboxes/${input.sandboxId}/api/harness/home?token=${encodeURIComponent(input.routeToken)}`,
    token: input.productJwt,
    expectedStatus: 200,
  });
  input.steps.push({
    name: 'harness_worker_home',
    ok: home.status === 200,
    details: {
      responseKeys: home.json ? Object.keys(home.json) : [],
      textLength: home.text.length,
    },
  });

  const discoveryPath = helpOrTools === 'help'
    ? `/api/harness/modules/${encodeURIComponent(module)}/help`
    : `/api/harness/modules/${encodeURIComponent(module)}/tools`;
  const discovery = await requestJson({
    baseUrl: input.routerBaseUrl,
    path: `/api/sandboxes/${input.sandboxId}${discoveryPath}?token=${encodeURIComponent(input.routeToken)}`,
    token: input.productJwt,
    expectedStatus: 200,
  });
  input.steps.push({
    name: 'harness_worker_discovery',
    ok: discovery.status === 200,
    details: {
      module,
      mode: helpOrTools,
      responseKeys: discovery.json ? Object.keys(discovery.json) : [],
      textLength: discovery.text.length,
    },
  });

  const invokeTool = envValue('STAGING_HARNESS_INVOKE_TOOL');
  const invokeInput = parseOptionalObjectEnv('STAGING_HARNESS_INVOKE_INPUT_JSON');
  if (invokeTool && invokeInput) {
    const invoke = await requestJson({
      path: `/api/sandbox/harness/modules/${encodeURIComponent(module)}/tools/${encodeURIComponent(invokeTool)}/invoke`,
      method: 'POST',
      token: input.productJwt,
      body: {
        workspaceId: input.workspaceId,
        sessionId: input.sessionId,
        input: invokeInput,
        ...(envValue('STAGING_HARNESS_ESTIMATED_COMPUTE_UNITS')
          ? { estimatedComputeUnits: Number(envValue('STAGING_HARNESS_ESTIMATED_COMPUTE_UNITS')) }
          : {}),
        ...(envValue('STAGING_HARNESS_ESTIMATED_COST_USD')
          ? { estimatedCostUsd: Number(envValue('STAGING_HARNESS_ESTIMATED_COST_USD')) }
          : {}),
      },
      expectedStatus: 200,
    });
    const usageEvent = invoke.json?.harnessUsageEvent ?? null;
    input.steps.push({
      name: 'harness_control_plane_invoke',
      ok:
        Boolean(usageEvent?.id) &&
        usageEvent?.workspaceId === input.workspaceId &&
        usageEvent?.sessionId === input.sessionId &&
        usageEvent?.module === module &&
        usageEvent?.tool === invokeTool,
      details: {
        module,
        tool: invokeTool,
        expectedWorkspaceId: input.workspaceId,
        expectedSessionId: input.sessionId,
        usageEventId: usageEvent?.id,
        workspaceId: usageEvent?.workspaceId,
        sessionId: usageEvent?.sessionId,
        runId: usageEvent?.runId,
        jobId: usageEvent?.jobId,
        externalEventId: usageEvent?.externalEventId,
        status: usageEvent?.status,
      },
    });
    const usageAfter = await requestJson({
      path: '/api/usage/harness/summary',
      token: input.productJwt,
      expectedStatus: 200,
    });
    const beforeEventCount = harnessUsageEventCount(usageBefore.json);
    const afterEventCount = harnessUsageEventCount(usageAfter.json);
    input.steps.push({
      name: 'harness_usage_summary_after_invoke',
      ok:
        beforeEventCount !== null &&
        afterEventCount !== null &&
        afterEventCount > beforeEventCount,
      details: {
        beforeEventCount,
        afterEventCount,
        afterCostUsd: harnessUsageCostUsd(usageAfter.json),
      },
    });
  }

  const mcpCommand = await runOptionalCommand('harness_mcp_worker_api_smoke', 'STAGING_HARNESS_MCP_SMOKE_COMMAND');
  if (mcpCommand) {
    const parsed = mcpCommand.details?.parsedStdout as JsonObject | null | undefined;
    input.steps.push({
      ...mcpCommand,
      ok: mcpCommand.ok && parsed?.source === 'worker-api',
      details: {
        ...mcpCommand.details,
        expectedSource: 'worker-api',
        observedSource: parsed?.source ?? null,
      },
    });
  }

  const artifactUiCommand = await runOptionalCommand(
    'harness_thread_artifact_ui_smoke',
    'STAGING_HARNESS_THREAD_ARTIFACT_UI_SMOKE_COMMAND',
  );
  if (artifactUiCommand) {
    const parsed = artifactUiCommand.details?.parsedStdout as JsonObject | null | undefined;
    const artifactTypes = Array.isArray(parsed?.artifactTypes)
      ? parsed.artifactTypes
      : [];
    input.steps.push({
      ...artifactUiCommand,
      ok:
        artifactUiCommand.ok &&
        artifactTypes.some((entry) =>
          entry === 'elagente.harness.run' ||
          entry === 'elagente.harness.artifact' ||
          entry === 'chemistry.molecule3d'
        ),
      details: {
        ...artifactUiCommand.details,
        expectedArtifactTypes: [
          'elagente.harness.run',
          'elagente.harness.artifact',
          'chemistry.molecule3d',
        ],
        observedArtifactTypes: artifactTypes,
      },
    });
  }
}

async function main() {
  const suffix = `${Date.now()}`;
  const steps: SmokeStep[] = [];
  partialSteps = steps;
  const productJwt = await resolveProductJwt();
  steps.push({
    name: 'resolve_product_jwt',
    ok: true,
    details: {
      source: productJwt.source,
      email: productJwt.email,
      controlPlaneBaseUrl: controlPlaneBaseUrl(),
    },
  });

  const bootstrap = await requestJson({
    path: '/api/me/bootstrap',
    method: 'POST',
    token: productJwt.token,
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
    token: productJwt.token,
    expectedStatus: 200,
  });
  const activeSandbox = start.json.sandbox;
  steps.push({
    name: 'start_sandbox',
    ok: ['starting', 'running'].includes(activeSandbox.state),
    details: {
      sandboxId: activeSandbox.id,
      state: activeSandbox.state,
      image: activeSandbox.image,
      resourceProfile: activeSandbox.resourceProfile,
      routerBaseUrl: activeSandbox.routerBaseUrl,
      workerServiceName: activeSandbox.workerServiceName,
      k8sNamespace: activeSandbox.k8sNamespace,
      k8sPodName: activeSandbox.k8sPodName,
      startupProgress: activeSandbox.startupProgress,
    },
  });

  const health = await requestJson({
    path: '/api/sandbox/health',
    token: productJwt.token,
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
  await waitForSandboxRunning({ productJwt: productJwt.token, sandboxId: activeSandbox.id, steps });
  await optionalAdminSandboxDetail({ sandboxId: activeSandbox.id, steps });
  await runOptionalIdempotentLifecycleSmoke({ productJwt: productJwt.token, sandboxId: activeSandbox.id, steps });

  const project = await requestJson({
    path: '/api/projects',
    method: 'POST',
    token: productJwt.token,
    body: {
      name: `Phase One Smoke ${suffix}`,
      slug: `phase-one-smoke-${suffix}`,
    },
    expectedStatus: 200,
  });
  const workspace = await requestJson({
    path: `/api/projects/${project.json.project.id}/workspaces`,
    method: 'POST',
    token: productJwt.token,
    body: {
      name: `Smoke Workspace ${suffix}`,
      slug: `smoke-workspace-${suffix}`,
    },
    expectedStatus: 200,
  });
  const session = await requestJson({
    path: `/api/workspaces/${workspace.json.workspace.id}/sessions`,
    method: 'POST',
    token: productJwt.token,
    body: {
      provider: 'codex',
      title: `Smoke Session ${suffix}`,
      ...(envValue('STAGING_CODEX_E2E_MODEL')
        ? { model: envValue('STAGING_CODEX_E2E_MODEL') }
        : {}),
    },
    expectedStatus: 200,
  });
  const workerSessionId = session.json.session.workerSessionId ?? null;
  steps.push({
    name: 'create_project_workspace_session',
    ok: Boolean(workerSessionId),
    details: {
      projectId: project.json.project.id,
      workspaceId: workspace.json.workspace.id,
      sessionId: session.json.session.id,
      workerSessionId,
      sessionStatus: session.json.session.status,
    },
  });

  const routeToken = await requestJson({
    path: `/api/sandboxes/${activeSandbox.id}/route-token`,
    method: 'POST',
    token: productJwt.token,
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
    path: `/api/sandboxes/${activeSandbox.id}/api/worker/metadata?token=${encodeURIComponent(routeToken.json.token)}`,
    token: productJwt.token,
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

  const workerReady = await requestJson({
    baseUrl: routerBaseUrl,
    path: `/api/sandboxes/${activeSandbox.id}/readyz?token=${encodeURIComponent(routeToken.json.token)}`,
    token: productJwt.token,
    expectedStatus: 200,
  });
  const runtimeProviders = Array.isArray(workerReady.json.runtimes)
    ? workerReady.json.runtimes.map((runtime: JsonObject) => runtime.provider)
    : [];
  steps.push({
    name: 'worker_codex_runtime_enabled',
    ok:
      workerReady.json.status === 'ready' &&
      runtimeProviders.includes('codex') &&
      !runtimeProviders.includes('claude') &&
      !runtimeProviders.includes('opencode'),
    details: {
      sandboxId: activeSandbox.id,
      providers: runtimeProviders,
      runtimes: workerReady.json.runtimes,
    },
  });

  await runOptionalHarnessSmoke({
    productJwt: productJwt.token,
    sandboxId: activeSandbox.id,
    routerBaseUrl,
    routeToken: routeToken.json.token as string,
    sessionId: session.json.session.id as string,
    workspaceId: workspace.json.workspace.id as string,
    steps,
  });

  const codexPrompt = envValue('STAGING_CODEX_E2E_PROMPT') ?? DEFAULT_CODEX_E2E_PROMPT;
  const codexTurn = await requestJson({
    path: `/api/sessions/${session.json.session.id}/prompt`,
    method: 'POST',
    token: productJwt.token,
    body: {
      prompt: codexPrompt,
      ...(envValue('STAGING_CODEX_E2E_MODEL')
        ? { model: envValue('STAGING_CODEX_E2E_MODEL') }
        : {}),
    },
    expectedStatus: 200,
  });
  steps.push({
    name: 'codex_worker_prompt_e2e',
    ok: Boolean(codexTurn.json.turn),
    details: {
      sessionId: session.json.session.id,
      workerSessionId,
      turnKeys: codexTurn.json.turn && typeof codexTurn.json.turn === 'object'
        ? Object.keys(codexTurn.json.turn)
        : [],
      sessionStatus: codexTurn.json.session?.status,
      promptLength: codexPrompt.length,
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
      token: productJwt.token,
      expectedStatus: 200,
    });
    const final = await waitForSandboxStopped({ productJwt: productJwt.token, sandboxId: activeSandbox.id });
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
    controlPlaneBaseUrl: controlPlaneBaseUrl(),
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
    controlPlaneBaseUrl: safeControlPlaneBaseUrl(),
    steps: partialSteps,
  }, null, 2));
  process.exit(1);
});
