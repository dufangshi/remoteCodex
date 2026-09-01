import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';

const enabled = process.env.REMOTE_CODEX_ACP_CORE_E2E === '1';
const apiPort = Number(process.env.E2E_API_PORT ?? 8787);
const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
const workspaceRoot = path.resolve(
  process.env.E2E_WORKSPACE_ROOT ?? '.local/e2e-playwright',
);

async function api<T>(pathname: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${pathname}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${init?.method ?? 'GET'} ${pathname}: ${response.status} ${text}`);
  }
  return text ? JSON.parse(text) as T : {} as T;
}

test.describe('ACP core negotiated capability', () => {
  test.skip(!enabled, 'Set REMOTE_CODEX_ACP_CORE_E2E=1 to run ACP browser E2E.');

  test('preserves model, reasoning, usage, and transcript across browser reload', async ({ page }) => {
    const suffix = randomUUID().slice(0, 8);
    const workspacePath = path.join(workspaceRoot, `acp-core-${suffix}`);
    await fs.mkdir(workspacePath, { recursive: true });
    await fs.writeFile(path.join(workspacePath, 'README.md'), '# ACP core E2E\n');
    let threadId: string | null = null;
    try {
      const workspace = await api<{ id: string }>('/api/workspaces', {
        method: 'POST',
        body: JSON.stringify({
          absPath: workspacePath,
          label: `ACP core ${suffix}`,
        }),
      });
      const capability = await api<any>(
        '/api/agent-runtimes/acp/capabilities?agentId=custom',
      );
      expect(capability.effectiveCapabilities.sessions).toMatchObject({
        load: true,
        resume: true,
        close: true,
        delete: true,
      });
      expect(capability.effectiveCapabilities.turns.compact).toBe(false);
      expect(capability.effectiveCapabilities.controls.goals).toBe(false);

      const thread = await api<any>('/api/threads/start', {
        method: 'POST',
        body: JSON.stringify({
          workspaceId: workspace.id,
          provider: 'acp',
          agentId: 'custom',
          model: 'fixture-fast',
          reasoningEffort: 'high',
          approvalMode: 'yolo',
          title: `ACP core ${suffix}`,
        }),
      });
      threadId = thread.id;
      await page.goto(`/threads/${thread.id}`);
      await expect(page.getByRole('textbox', { name: 'Prompt' })).toBeVisible();
      await page.getByRole('textbox', { name: 'Prompt' }).fill('Run the ACP browser fixture.');
      await page.getByRole('button', { name: 'Send Prompt' }).click();
      await expect(page.getByText('FAKE_ACP_PARTIAL_1', { exact: true })).toBeVisible({
        timeout: 20_000,
      });

      const beforeReload = await api<any>(`/api/threads/${thread.id}`);
      expect(beforeReload.thread).toMatchObject({
        model: 'fixture-fast',
        reasoningEffort: 'high',
      });
      expect(beforeReload.thread.contextUsage).toMatchObject({
        availability: 'available',
        tokensInContextWindow: 100,
        modelContextWindow: 4096,
      });

      await page.reload();
      await expect(page.getByText('FAKE_ACP_PARTIAL_1', { exact: true })).toBeVisible();
      const afterReload = await api<any>(`/api/threads/${thread.id}`);
      expect(afterReload.thread.model).toBe(beforeReload.thread.model);
      expect(afterReload.thread.reasoningEffort).toBe(beforeReload.thread.reasoningEffort);
      expect(afterReload.thread.contextUsage).toMatchObject(
        beforeReload.thread.contextUsage,
      );
      expect(afterReload.turns).toHaveLength(1);
    } finally {
      if (threadId) {
        await api(`/api/threads/${threadId}`, { method: 'DELETE' }).catch(() => undefined);
      }
      await fs.rm(workspacePath, { recursive: true, force: true });
    }
  });
});
