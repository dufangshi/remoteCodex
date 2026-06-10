import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { buildControlPlaneApp } from '../apps/control-plane-api/src/app';
import { buildSandboxRouterApp } from '../apps/sandbox-router/src/app';
import { buildApp as buildWorkerApp } from '../apps/supervisor-api/src/app';

const routeTokenSecret = 'local-route-token-smoke-secret';
const workerAuthToken = 'local-worker-smoke-token';
const workerIdentitySecret = 'local-worker-identity-smoke-secret';

async function listen(app: { listen: (options: { host: string; port: number }) => Promise<string>; server: { address: () => unknown } }) {
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected a TCP server address.');
  }
  return `http://127.0.0.1:${address.port}`;
}

async function main() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'remote-codex-local-route-smoke-'));
  const workerHome = path.join(tempDir, 'home');
  const workspaceRoot = path.join(tempDir, 'workspace');
  await fs.mkdir(workerHome, { recursive: true });
  await fs.mkdir(workspaceRoot, { recursive: true });

  const workerApp = buildWorkerApp({
    env: {
      NODE_ENV: 'test',
      REMOTE_CODEX_RUNTIME_ROLE: 'worker',
      REMOTE_CODEX_SANDBOX_ID: 'local-smoke-sandbox',
      REMOTE_CODEX_USER_ID: 'local-smoke-user',
      REMOTE_CODEX_WORKER_AUTH_TOKEN: workerAuthToken,
      REMOTE_CODEX_WORKER_IDENTITY_SECRET: workerIdentitySecret,
      DATABASE_URL: path.join(tempDir, 'worker.sqlite'),
      WORKSPACE_ROOT: workspaceRoot,
      CODEX_HOME: path.join(workerHome, '.codex'),
      CLAUDE_HOME: path.join(workerHome, '.claude'),
      OPENCODE_HOME: path.join(workerHome, '.opencode'),
      REMOTE_CODEX_ENABLED_AGENT_PROVIDERS: 'codex,claude,opencode',
    },
  });
  const apps = [workerApp];
  try {
    const workerBaseUrl = await listen(workerApp);
    const routerApp = buildSandboxRouterApp({
      env: {
        NODE_ENV: 'test',
        CONTROL_PLANE_JWT_SECRET: routeTokenSecret,
        CONTROL_PLANE_JWT_SECRET_ID: 'local-smoke',
        SANDBOX_ROUTER_WORKER_AUTH_TOKEN: workerAuthToken,
        SANDBOX_ROUTER_WORKER_IDENTITY_SECRET: workerIdentitySecret,
        SANDBOX_ROUTER_DEFAULT_WORKER_BASE_URL: workerBaseUrl,
      },
    });
    apps.push(routerApp);
    const routerBaseUrl = await listen(routerApp);
    const controlPlaneApp = buildControlPlaneApp({
      env: {
        NODE_ENV: 'test',
        CONTROL_PLANE_DATABASE_URL: path.join(tempDir, 'control-plane.sqlite'),
        CONTROL_PLANE_JWT_SECRET: routeTokenSecret,
        CONTROL_PLANE_JWT_SECRET_ID: 'local-smoke',
        SANDBOX_ROUTER_BASE_URL: routerBaseUrl,
        SANDBOX_ROUTER_DEFAULT_WORKER_BASE_URL: workerBaseUrl,
        CONTROL_PLANE_ADMIN_IDENTITIES: 'dev:admin',
      },
    });
    apps.push(controlPlaneApp);

    const auth = { authorization: 'Bearer dev:local-smoke-user' };
    const bootstrap = await controlPlaneApp.inject({
      method: 'POST',
      url: '/api/me/bootstrap',
      headers: auth,
      payload: {
        email: 'local-smoke@example.com',
        displayName: 'Local Smoke',
      },
    });
    if (bootstrap.statusCode !== 200) {
      throw new Error(`Bootstrap failed: ${bootstrap.statusCode} ${bootstrap.body}`);
    }

    const start = await controlPlaneApp.inject({
      method: 'POST',
      url: '/api/sandbox/start',
      headers: auth,
    });
    if (start.statusCode !== 200 || start.json().sandbox.state !== 'running') {
      throw new Error(`Sandbox start failed: ${start.statusCode} ${start.body}`);
    }

    const sandboxId = bootstrap.json().sandbox.id as string;
    const routeToken = await controlPlaneApp.inject({
      method: 'POST',
      url: `/api/sandboxes/${sandboxId}/route-token`,
      headers: auth,
      payload: {
        scopes: ['worker:read'],
      },
    });
    if (routeToken.statusCode !== 200) {
      throw new Error(`Route-token issuance failed: ${routeToken.statusCode} ${routeToken.body}`);
    }

    const token = routeToken.json().token as string;
    const proxiedMetadata = await fetch(
      `${routerBaseUrl}/api/sandboxes/${sandboxId}/api/worker/metadata?token=${encodeURIComponent(token)}`,
      {
        headers: {
          authorization: 'Bearer browser-product-jwt-that-must-not-reach-worker',
        },
      },
    );
    const metadata = await proxiedMetadata.json();
    if (!proxiedMetadata.ok) {
      throw new Error(`Router-to-worker metadata failed: ${proxiedMetadata.status} ${JSON.stringify(metadata)}`);
    }
    if (metadata.role !== 'worker' || metadata.sandboxId !== 'local-smoke-sandbox') {
      throw new Error(`Unexpected worker metadata: ${JSON.stringify(metadata)}`);
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          sandboxId,
          workerRole: metadata.role,
          workerSandboxId: metadata.sandboxId,
          routerBaseUrl,
        },
        null,
        2,
      ),
    );
  } finally {
    await Promise.all(apps.map((app) => app.close()));
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
