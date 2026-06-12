import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AgentRuntimeRegistry } from '../../../packages/agent-runtime/src/index';
import {
  CodexManagementService,
  CodexRuntimeAdapter,
  LocalCodexSessionStore,
} from '../../../packages/codex/src/index';
import { getHarnessJobWatchByJobId } from '../../../packages/db/src/repositories';
import { buildApp } from './app';
import { FakeCodexManager } from './test/fakeCodexManager';
import { parseTomlBlocks, parseTomlLines } from './worker-harness-client';

// Local end-to-end check against a real ElAgenteHarness process. Opt-in:
//   RUN_HARNESS_WAKEUP_E2E=1 pnpm vitest run harness-wakeup-local-e2e
// Requires the sibling ElAgenteHarness checkout with a synced uv environment.
const RUN_E2E = process.env.RUN_HARNESS_WAKEUP_E2E === '1';
const HARNESS_REPO =
  process.env.HARNESS_REPO_PATH ??
  path.resolve(process.cwd(), '../../../ElAgenteHarness');
const HARNESS_PORT = 5077;
const HARNESS_BASE_URL = `http://127.0.0.1:${HARNESS_PORT}`;
const SUPERVISOR_PORT = 18799;
const ADMIN_KEY = '123456';
const COMPUTE_WORKER_TOKEN = 'wakeup-e2e-worker-token';

async function waitFor<T>(
  label: string,
  timeoutMs: number,
  probe: () => Promise<T | null>,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      const value = await probe();
      if (value !== null) {
        return value;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `Timed out waiting for ${label}.` +
      (lastError instanceof Error ? ` Last error: ${lastError.message}` : ''),
  );
}

describe.runIf(RUN_E2E)('harness wakeup local e2e', () => {
  let tempDir = '';
  let harnessProcess: ChildProcess | null = null;
  let app: ReturnType<typeof buildApp> | null = null;
  let apiKey = '';

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'remote-codex-wakeup-e2e-'));
    const harnessData = path.join(tempDir, 'harness-data');
    const harnessWorkspace = path.join(tempDir, 'harness-workspace');
    await fs.mkdir(harnessData, { recursive: true });
    await fs.mkdir(harnessWorkspace, { recursive: true });

    harnessProcess = spawn(
      'uv',
      [
        'run',
        'gunicorn',
        'elagente_harness.server:wsgi',
        '-k',
        'uvicorn.workers.UvicornWorker',
        '--bind',
        `127.0.0.1:${HARNESS_PORT}`,
        '--workers',
        '1',
        '--timeout',
        '120',
      ],
      {
        cwd: HARNESS_REPO,
        env: {
          ...process.env,
          DATA_DIR: harnessData,
          WORKSPACE_ROOT: harnessWorkspace,
          ADMIN_KEY,
          COMPUTE_WORKER_TOKEN,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      },
    );
    harnessProcess.stderr?.on('data', (chunk: Buffer) => {
      if (process.env.HARNESS_E2E_VERBOSE) {
        process.stderr.write(`[harness] ${chunk.toString()}`);
      }
    });

    await waitFor('harness health', 90_000, async () => {
      const response = await fetch(`${HARNESS_BASE_URL}/health`);
      return response.ok ? true : null;
    });

    const ensureResponse = await fetch(`${HARNESS_BASE_URL}/admin/members/ensure`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-admin-key': ADMIN_KEY,
      },
      body: JSON.stringify({
        externalId: 'remote-codex:sandbox:wakeup-e2e',
        sandboxId: 'wakeup-e2e',
        name: 'remote-codex-wakeup-e2e',
        kind: 'agent',
      }),
    });
    expect(ensureResponse.ok).toBe(true);
    const ensured = (await ensureResponse.json()) as { apiKey: string };
    apiKey = ensured.apiKey;
    expect(apiKey).toBeTruthy();

    const codexHome = path.join(tempDir, 'codex-home');
    await fs.mkdir(codexHome, { recursive: true });
    await fs.mkdir(path.join(tempDir, 'workspace'), { recursive: true });
    app = buildApp({
      env: {
        NODE_ENV: 'test',
        DATABASE_URL: path.join(tempDir, 'supervisor.sqlite'),
        WORKSPACE_ROOT: tempDir,
        CODEX_HOME: codexHome,
        ELAGENTE_HARNESS_BASE_URL: HARNESS_BASE_URL,
        INACT_X_APP_KEY: apiKey,
        REMOTE_CODEX_HARNESS_WAKEUP_CALLBACK_BASE_URL: `http://127.0.0.1:${SUPERVISOR_PORT}/api/hooks`,
      },
      runtimeBootstrap: {
        agentRuntimes: new AgentRuntimeRegistry([
          new CodexRuntimeAdapter(new FakeCodexManager() as never),
        ]),
        localCodexSessionStore: new LocalCodexSessionStore(codexHome),
        codexManagement: new CodexManagementService(codexHome),
        providerHostHomes: { codex: codexHome },
      },
    });
    await app.listen({ host: '127.0.0.1', port: SUPERVISOR_PORT });
  }, 150_000);

  afterAll(async () => {
    await app?.close();
    if (harnessProcess?.pid) {
      try {
        process.kill(-harnessProcess.pid, 'SIGTERM');
      } catch {
        harnessProcess.kill('SIGTERM');
      }
    }
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('wakes a thread when a real harness job completes', async () => {
    const supervisor = app!;

    const workspaceResponse = await supervisor.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: { absPath: path.join(tempDir, 'workspace') },
    });
    expect(workspaceResponse.statusCode).toBe(200);
    const workspace = workspaceResponse.json();

    const threadResponse = await supervisor.inject({
      method: 'POST',
      url: '/api/threads/start',
      payload: {
        workspaceId: workspace.id,
        provider: 'codex',
        model: 'gpt-5',
        approvalMode: 'yolo',
        title: 'Wakeup E2E Thread',
      },
    });
    expect(threadResponse.statusCode).toBe(200);
    const threadId = threadResponse.json().id as string;

    const wakeupInfoResponse = await supervisor.inject({
      method: 'GET',
      url: '/api/harness/wakeup',
    });
    expect(wakeupInfoResponse.statusCode).toBe(200);
    const wakeupInfo = wakeupInfoResponse.json();
    expect(wakeupInfo.enabled).toBe(true);
    const notifyTo = wakeupInfo.notifyTo as string;

    const submitResponse = await fetch(`${HARNESS_BASE_URL}/compute/jobs`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        script: 'echo wakeup-e2e',
        backend: 'local',
        engine: 'raw',
        notify_to: notifyTo,
        title: 'wakeup e2e job',
      }),
    });
    const submitText = await submitResponse.text();
    expect(submitResponse.ok).toBe(true);
    const jobId = parseTomlLines(submitText).id;
    expect(jobId).toBeTruthy();

    const watchResponse = await supervisor.inject({
      method: 'POST',
      url: '/api/harness/job-watches',
      payload: { jobId, threadId },
    });
    expect(watchResponse.statusCode).toBe(201);

    const claimResponse = await fetch(
      `${HARNESS_BASE_URL}/compute/worker/jobs/next?backend=local&worker_id=e2e-worker`,
      {
        headers: {
          'x-api-key': apiKey,
          authorization: `Bearer ${COMPUTE_WORKER_TOKEN}`,
        },
      },
    );
    const claimText = await claimResponse.text();
    expect(claimResponse.ok).toBe(true);
    expect(claimText).toContain(`id              = ${jobId}`);

    const statusResponse = await fetch(
      `${HARNESS_BASE_URL}/compute/worker/jobs/${jobId}/status`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          authorization: `Bearer ${COMPUTE_WORKER_TOKEN}`,
        },
        body: JSON.stringify({ state: 'done', exit_code: 0 }),
      },
    );
    expect(statusResponse.ok).toBe(true);

    const watch = await waitFor('wakeup delivery', 30_000, async () => {
      const record = getHarnessJobWatchByJobId(supervisor.services.database.db, jobId!);
      return record?.status === 'delivered' ? record : null;
    });
    expect(watch.threadId).toBe(threadId);
    expect(watch.lastJobStatus).toBe('done');

    const detailResponse = await supervisor.inject({
      method: 'GET',
      url: `/api/threads/${threadId}`,
    });
    expect(detailResponse.statusCode).toBe(200);
    expect(JSON.stringify(detailResponse.json())).toContain('[Harness job wakeup]');

    await waitFor('notification acknowledgement', 15_000, async () => {
      const inboxResponse = await fetch(`${HARNESS_BASE_URL}/notify/inbox`, {
        headers: { 'x-api-key': apiKey },
      });
      const unread = parseTomlBlocks(await inboxResponse.text(), 'notifications').filter(
        (entry) => entry.from === 'jobs',
      );
      return unread.length === 0 ? true : null;
    });
  }, 120_000);
});
