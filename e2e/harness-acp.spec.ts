import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import {
  api,
  collectTexts,
  ensureWorkspaceDir,
  spawnBin,
  stopProc,
  waitForHealth,
  waitForRunning,
  waitForThread,
} from './helpers';

const bin = path.resolve('target/debug/remote-codex');
const runId = randomUUID().slice(0, 8);
const supervisorPort = Number(
  process.env.E2E_HARNESS_PORT ?? 19000 + (Number.parseInt(runId.slice(0, 4), 16) % 800),
);
const apiBase = `http://127.0.0.1:${supervisorPort}`;
const workspaceRoot = path.resolve(`.local/e2e-harness-acp-${runId}`);

const harnesses = [
  {
    id: 'codex',
    provider: 'codex',
    agentId: null as string | null,
    probe: 'codex-acp',
  },
  {
    id: 'claude',
    provider: 'claude',
    agentId: null,
    probe: 'claude-agent-acp',
  },
  {
    id: 'grok',
    provider: 'acp',
    agentId: 'grok',
    probe: 'grok',
  },
  {
    id: 'deepseek',
    provider: 'acp',
    agentId: 'deepseek',
    probe: 'dsh',
  },
];

function commandExists(command: string) {
  const result = spawnSync('which', [command], { encoding: 'utf8' });
  return result.status === 0;
}

test.describe('real ACP harnesses', () => {
  test.setTimeout(10 * 60_000);

  let supervisorProc: ReturnType<typeof spawnBin> | undefined;
  let workspaceId = '';

  test.beforeAll(async () => {
    const dataDir = path.resolve(`.local/e2e-harness-supervisor-${runId}`);
    await fs.promises.mkdir(dataDir, { recursive: true });
    const logFd = fs.openSync(path.join(dataDir, 'supervisor.log'), 'a');
    supervisorProc = spawn(bin, ['supervisor'], {
      env: {
        ...process.env,
        PORT: String(supervisorPort),
        HOST: '127.0.0.1',
        REMOTE_CODEX_MODE: 'local',
        REMOTE_CODEX_E2E_FAKE_RUNTIME: '0',
        ACP_STARTUP_TIMEOUT_MS: '60000',
        RUST_LOG: 'info,remote_codex_runtime=debug',
        DATABASE_URL: path.join(dataDir, 'supervisor.sqlite'),
        WORKSPACE_ROOT: path.join(dataDir, 'workspaces'),
      },
      stdio: ['ignore', logFd, logFd],
    });
    await waitForHealth(apiBase, 60_000);
    const absPath = await ensureWorkspaceDir(workspaceRoot, `harness-shared-${runId}`);
    const workspace = await api<any>(apiBase, '/api/workspaces', {
      method: 'POST',
      body: JSON.stringify({ absPath, label: 'harness-shared' }),
    });
    workspaceId = workspace.id;
  });

  test.afterAll(async () => {
    await stopProc(supervisorProc);
  });

  test('file browser works on the real supervisor', async () => {
    const tree = await api<any>(
      apiBase,
      `/api/workspaces/${workspaceId}/files/tree?path=.`,
    );
    expect((tree.children ?? []).some((node: any) => node.name === 'README.md')).toBe(
      true,
    );
    const preview = await api<any>(
      apiBase,
      `/api/workspaces/${workspaceId}/files/preview?path=src/main.rs`,
    );
    expect(preview.content).toContain('fn main');
  });

  for (const harness of harnesses) {
    test(`${harness.id} starts a session and completes a short turn`, async () => {
      test.skip(
        !commandExists(harness.probe),
        `${harness.probe} is not installed`,
      );
      const marker = `HARNESS_E2E_OK_${harness.id.toUpperCase()}_${randomUUID().slice(0, 6)}`;
      const thread = await api<any>(apiBase, '/api/threads/start', {
        method: 'POST',
        body: JSON.stringify({
          workspaceId,
          title: `${harness.id} e2e`,
          provider: harness.provider,
          agentId: harness.agentId,
          model: 'default',
          approvalMode: 'yolo',
        }),
      });
      await api(apiBase, `/api/threads/${thread.id}/prompt`, {
        method: 'POST',
        body: JSON.stringify({
          prompt: `Reply with exactly ${marker} and nothing else.`,
        }),
      });
      const detail = await waitForThread(apiBase, thread.id, 180_000);
      expect(detail.thread.status).not.toBe('failed');
      const blob = collectTexts(detail).join('\n');
      expect(blob).toContain(marker);
    });
  }

  for (const harness of harnesses) {
    test(`${harness.id} interrupts a long running turn`, async () => {
      test.skip(
        !commandExists(harness.probe),
        `${harness.probe} is not installed`,
      );
      const thread = await api<any>(apiBase, '/api/threads/start', {
        method: 'POST',
        body: JSON.stringify({
          workspaceId,
          title: `${harness.id} long interrupt`,
          provider: harness.provider,
          agentId: harness.agentId,
          model: 'default',
          approvalMode: 'yolo',
        }),
      });
      await api(apiBase, `/api/threads/${thread.id}/prompt`, {
        method: 'POST',
        body: JSON.stringify({
          prompt:
            'Use a shell/terminal tool to run exactly `sleep 40`. Do not skip it, do not background it, and do not reply until it finishes. After it finishes, reply exactly LONG_TASK_DONE.',
        }),
      });
      await waitForRunning(apiBase, thread.id, 30_000);
      await api(apiBase, `/api/threads/${thread.id}/interrupt`, {
        method: 'POST',
      });
      const detail = await waitForThread(apiBase, thread.id, 60_000);
      expect(detail.thread.status).not.toBe('running');
      expect(['interrupted', 'idle', 'failed']).toContain(detail.thread.status);
    });
  }
});
