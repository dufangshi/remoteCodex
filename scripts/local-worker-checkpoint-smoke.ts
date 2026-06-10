import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { buildControlPlaneApp } from '../apps/control-plane-api/src/app';
import { WorkerControlPlaneSyncClient } from '../apps/supervisor-api/src/worker-control-plane-sync';
import { loadRuntimeConfig } from '../packages/config/src/index';

const internalServiceToken = 'local-checkpoint-service-token';

async function listen(app: {
  listen: (options: { host: string; port: number }) => Promise<string>;
  server: { address: () => unknown };
}) {
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected a TCP server address.');
  }
  return `http://127.0.0.1:${address.port}`;
}

async function main() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'remote-codex-local-checkpoint-smoke-'));
  const controlPlaneApp = buildControlPlaneApp({
    env: {
      NODE_ENV: 'test',
      CONTROL_PLANE_DATABASE_URL: path.join(tempDir, 'control-plane.sqlite'),
      CONTROL_PLANE_JWT_SECRET: 'local-checkpoint-route-token-secret',
      SANDBOX_ROUTER_BASE_URL: 'http://127.0.0.1:8791',
      CONTROL_PLANE_INTERNAL_SERVICE_TOKEN: internalServiceToken,
    },
  });

  try {
    const controlPlaneBaseUrl = await listen(controlPlaneApp);
    const auth = { authorization: 'Bearer dev:local-checkpoint-user' };

    const bootstrap = await controlPlaneApp.inject({
      method: 'POST',
      url: '/api/me/bootstrap',
      headers: auth,
      payload: {
        email: 'local-checkpoint@example.com',
        displayName: 'Local Checkpoint',
      },
    });
    if (bootstrap.statusCode !== 200) {
      throw new Error(`Bootstrap failed: ${bootstrap.statusCode} ${bootstrap.body}`);
    }
    const { user, sandbox } = bootstrap.json();

    const workspaceResponse = await controlPlaneApp.inject({
      method: 'POST',
      url: '/api/workspaces',
      headers: auth,
      payload: {
        name: 'Local Checkpoint Workspace',
        slug: 'local-checkpoint-workspace',
      },
    });
    if (workspaceResponse.statusCode !== 200) {
      throw new Error(`Workspace creation failed: ${workspaceResponse.statusCode} ${workspaceResponse.body}`);
    }
    const workspace = workspaceResponse.json().workspace;

    const sessionResponse = await controlPlaneApp.inject({
      method: 'POST',
      url: `/api/workspaces/${workspace.id}/sessions`,
      headers: auth,
      payload: {
        provider: 'codex',
        title: 'Local Checkpoint Session',
      },
    });
    if (sessionResponse.statusCode !== 200) {
      throw new Error(`Session creation failed: ${sessionResponse.statusCode} ${sessionResponse.body}`);
    }
    const session = sessionResponse.json().session;

    const workerConfig = loadRuntimeConfig({
      NODE_ENV: 'test',
      REMOTE_CODEX_RUNTIME_ROLE: 'worker',
      REMOTE_CODEX_SANDBOX_ID: sandbox.id,
      REMOTE_CODEX_USER_ID: user.id,
      REMOTE_CODEX_CONTROL_PLANE_BASE_URL: controlPlaneBaseUrl,
      REMOTE_CODEX_CONTROL_PLANE_SERVICE_TOKEN: internalServiceToken,
      WORKSPACE_ROOT: path.join(tempDir, 'workspace'),
      DATABASE_URL: path.join(tempDir, 'worker.sqlite'),
      REMOTE_CODEX_ENABLED_AGENT_PROVIDERS: '',
    });
    const syncClient = new WorkerControlPlaneSyncClient(workerConfig, {
      maxAttempts: 1,
      initialBackoffMs: 0,
    });
    const checkpoint = await syncClient.checkpointSession({
      sessionId: session.id,
      workerSessionId: 'worker-session-local-smoke',
      status: 'active',
    });

    const refreshed = await controlPlaneApp.inject({
      method: 'GET',
      url: `/api/workspaces/${workspace.id}/sessions`,
      headers: auth,
    });
    if (refreshed.statusCode !== 200) {
      throw new Error(`Session refresh failed: ${refreshed.statusCode} ${refreshed.body}`);
    }
    const refreshedSessions = refreshed.json().sessions as Array<{
      id: string;
      workerSessionId: string | null;
      status: string;
      lastActivityAt: string | null;
    }>;
    const refreshedSession = refreshedSessions.find((entry) => entry.id === session.id);
    if (!refreshedSession) {
      throw new Error(`Checkpoint session ${session.id} was not returned by the session list.`);
    }
    if (
      refreshedSession.workerSessionId !== 'worker-session-local-smoke' ||
      refreshedSession.status !== 'active' ||
      !refreshedSession.lastActivityAt
    ) {
      throw new Error(`Durable session was not updated by checkpoint: ${JSON.stringify(refreshedSession)}`);
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          userId: user.id,
          sandboxId: sandbox.id,
          workspaceId: workspace.id,
          sessionId: session.id,
          checkpointWorkerSessionId: checkpoint.session.workerSessionId,
          refreshedWorkerSessionId: refreshedSession.workerSessionId,
          refreshedStatus: refreshedSession.status,
          refreshedLastActivityAt: refreshedSession.lastActivityAt,
        },
        null,
        2,
      ),
    );
  } finally {
    await controlPlaneApp.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
