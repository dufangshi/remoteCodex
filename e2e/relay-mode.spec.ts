import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { expect, test } from '@playwright/test';

import {
  api,
  collectTexts,
  ensureWorkspaceDir,
  spawnBin,
  stopProc,
  waitForHealth,
  waitForThread,
} from './helpers';

const bin = path.resolve('target/debug/remote-codex');
const workspaceRoot = path.resolve('.local/e2e-relay-playwright');
const relayPort = Number(process.env.E2E_RELAY_PORT ?? 18788);
const supervisorPort = Number(process.env.E2E_RELAY_SUPERVISOR_PORT ?? 18789);
const relayBase = `http://127.0.0.1:${relayPort}`;

test.describe('relay mode fake runtime', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(120_000);

  let relayProc: ReturnType<typeof spawnBin> | undefined;
  let supervisorProc: ReturnType<typeof spawnBin> | undefined;
  let deviceId = '';
  let deviceApi = '';

  test.beforeAll(async () => {
    const dataDir = path.resolve(`.local/e2e-relay-${relayPort}`);
    relayProc = spawnBin(bin, ['relay'], {
      PORT: String(relayPort),
      HOST: '127.0.0.1',
      REMOTE_CODEX_RELAY_DATA_DIR: dataDir,
      REMOTE_CODEX_ADMIN_USERNAME: 'admin',
      REMOTE_CODEX_ADMIN_PASSWORD: 'admin',
    });
    await waitForHealth(relayBase);
    const login = await api<any>(relayBase, '/relay/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: 'admin', password: 'admin' }),
    });
    const created = await api<any>(relayBase, '/relay/devices', {
      method: 'POST',
      headers: { Authorization: `Bearer ${login.token}` },
      body: JSON.stringify({ name: `e2e-${randomUUID().slice(0, 6)}` }),
    });
    deviceId = created.device.id;
    const token = created.token as string;
    deviceApi = `${relayBase}/relay/devices/${deviceId}/api`;

    supervisorProc = spawnBin(bin, ['relay-supervisor'], {
      PORT: String(supervisorPort),
      HOST: '127.0.0.1',
      REMOTE_CODEX_MODE: 'relay',
      REMOTE_CODEX_E2E_FAKE_RUNTIME: '1',
      REMOTE_CODEX_RELAY_SERVER_URL: relayBase,
      REMOTE_CODEX_RELAY_AGENT_TOKEN: token,
      DATABASE_URL: path.join(dataDir, 'supervisor.sqlite'),
      WORKSPACE_ROOT: path.join(dataDir, 'workspaces'),
    });
    const start = Date.now();
    while (Date.now() - start < 20_000) {
      const health = await api<any>(relayBase, '/healthz');
      if (Number(health.connectedSupervisors ?? 0) >= 1) {
        return;
      }
      await delay(250);
    }
    throw new Error('relay supervisor did not connect');
  });

  test.afterAll(async () => {
    await stopProc(supervisorProc);
    await stopProc(relayProc);
  });

  test('forwards workspace, files, prompt, and interrupt through the relay', async () => {
    const name = `relay-${randomUUID().slice(0, 8)}`;
    const absPath = await ensureWorkspaceDir(workspaceRoot, name);
    const workspace = await api<any>(deviceApi, '/workspaces', {
      method: 'POST',
      body: JSON.stringify({ absPath, label: name }),
    });
    expect(workspace.id).toBeTruthy();

    const tree = await api<any>(
      deviceApi,
      `/workspaces/${workspace.id}/files/tree?path=.`,
    );
    expect((tree.children ?? []).some((node: any) => node.name === 'README.md')).toBe(
      true,
    );

    const thread = await api<any>(deviceApi, '/threads/start', {
      method: 'POST',
      body: JSON.stringify({
        workspaceId: workspace.id,
        title: `${name} thread`,
        provider: 'codex',
        model: 'ios-e2e-stream',
        approvalMode: 'yolo',
      }),
    });
    await api(deviceApi, `/threads/${thread.id}/prompt`, {
      method: 'POST',
      body: JSON.stringify({ prompt: 'hello, reply me with hello' }),
    });
    const detail = await waitForThread(deviceApi, thread.id, 30_000);
    expect(collectTexts(detail).some((text) => text === 'hello')).toBe(true);

    const long = await api<any>(deviceApi, '/threads/start', {
      method: 'POST',
      body: JSON.stringify({
        workspaceId: workspace.id,
        title: `${name} long`,
        provider: 'claude',
        model: 'ios-e2e-stream',
        approvalMode: 'yolo',
      }),
    });
    await api(deviceApi, `/threads/${long.id}/prompt`, {
      method: 'POST',
      body: JSON.stringify({
        prompt:
          'Inspect this repository in depth and write a detailed multi-section report.',
      }),
    });
    await api(deviceApi, `/threads/${long.id}/interrupt`, { method: 'POST' });
    const interrupted = await api<any>(deviceApi, `/threads/${long.id}`);
    expect(interrupted.thread.status).not.toBe('running');
  });
});
