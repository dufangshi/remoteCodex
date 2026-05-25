import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

interface SmokeStep {
  name: string;
  ok: boolean;
  details?: Record<string, unknown>;
}

const requiredEnv = [
  'STAGING_CONTROL_PLANE_BASE_URL',
  'STAGING_PRODUCT_JWT',
] as const;

function envValue(name: string) {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function requireEnv(name: (typeof requiredEnv)[number]) {
  const value = envValue(name);
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
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
  const json = text ? JSON.parse(text) : null;
  if (input.expectedStatus !== undefined && response.status !== input.expectedStatus) {
    throw new Error(`${input.method ?? 'GET'} ${url} expected ${input.expectedStatus}, got ${response.status}: ${text}`);
  }
  return {
    status: response.status,
    json,
    url: url.toString(),
  };
}

async function runOptionalCommand(name: string, commandEnvName: string): Promise<SmokeStep | null> {
  const command = envValue(commandEnvName);
  if (!command) {
    return null;
  }
  const [binary, ...args] = command.split(' ').filter(Boolean);
  if (!binary) {
    throw new Error(`${commandEnvName} is empty.`);
  }
  const { stdout, stderr } = await execFileAsync(binary, args, {
    timeout: Number(process.env.STAGING_PROVIDER_SMOKE_TIMEOUT_MS ?? 120_000),
    env: process.env,
  });
  return {
    name,
    ok: true,
    details: {
      commandEnv: commandEnvName,
      stdout: stdout.slice(0, 4000),
      stderr: stderr.slice(0, 4000),
    },
  };
}

async function main() {
  for (const name of requiredEnv) {
    requireEnv(name);
  }
  const productJwt = requireEnv('STAGING_PRODUCT_JWT');
  const suffix = `${Date.now()}`;
  const steps: SmokeStep[] = [];

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
    ok: start.json.sandbox.state === 'running',
    details: {
      sandboxId: start.json.sandbox.id,
      state: start.json.sandbox.state,
      imageVersion: start.json.sandbox.imageVersion,
      endpoint: start.json.sandbox.endpoint,
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
      lastHeartbeatAt: health.json.sandbox.lastHeartbeatAt,
    },
  });

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
  const proxiedMetadata = await requestJson({
    baseUrl: routerBaseUrl,
    path: `/api/sandboxes/${sandbox.id}/api/worker/metadata?token=${encodeURIComponent(routeToken.json.token)}`,
    token: productJwt,
    expectedStatus: 200,
  });
  const proxiedBody = proxiedMetadata.json;
  steps.push({
    name: 'browser_to_router_to_worker',
    ok: proxiedBody.role === 'worker',
    details: {
      role: proxiedBody.role,
      sandboxId: proxiedBody.sandboxId,
      userId: proxiedBody.userId,
      managementRoutesEnabled: proxiedBody.managementRoutesEnabled,
    },
  });

  const directWorkerBaseUrl = envValue('STAGING_DIRECT_WORKER_BASE_URL');
  if (directWorkerBaseUrl) {
    const direct = await requestJson({
      baseUrl: directWorkerBaseUrl,
      path: '/api/worker/metadata',
      expectedStatus: 401,
    });
    steps.push({
      name: 'direct_worker_denial',
      ok: direct.status === 401,
      details: {
        status: direct.status,
      },
    });
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
    steps.push({
      name: 'stop_sandbox',
      ok: stop.json.sandbox.state === 'stopped',
      details: {
        sandboxId: stop.json.sandbox.id,
        state: stop.json.sandbox.state,
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
  }, null, 2));
  process.exit(1);
});
