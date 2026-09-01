import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { api, collectTexts, ensureWorkspaceDir } from './helpers';

const apiPort = Number(process.env.E2E_API_PORT ?? 8787);
const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
const workspaceRoot = path.resolve(
  process.env.E2E_WORKSPACE_ROOT ?? '.local/e2e-playwright',
);

test.describe('workspace file browser and long turn', () => {
  test('lists, previews, writes, and moves files', async ({ page }) => {
    const name = `files-${randomUUID().slice(0, 8)}`;
    const absPath = await ensureWorkspaceDir(workspaceRoot, name);
    const workspace = await api<any>(apiBaseUrl, '/api/workspaces', {
      method: 'POST',
      body: JSON.stringify({ absPath, label: name }),
    });
    const tree = await api<any>(
      apiBaseUrl,
      `/api/workspaces/${workspace.id}/files/tree?path=.`,
    );
    expect(tree.kind).toBe('directory');
    const names = (tree.children ?? []).map((node: any) => node.name);
    expect(names).toContain('README.md');
    expect(names).toContain('src');

    const preview = await api<any>(
      apiBaseUrl,
      `/api/workspaces/${workspace.id}/files/preview?path=README.md`,
    );
    expect(preview.content).toContain(`# ${name}`);

    await api(apiBaseUrl, `/api/workspaces/${workspace.id}/files`, {
      method: 'PUT',
      body: JSON.stringify({ path: 'notes.txt', content: 'browser-ok' }),
    });
    await api(apiBaseUrl, `/api/workspaces/${workspace.id}/files/move`, {
      method: 'PATCH',
      body: JSON.stringify({ fromPath: 'notes.txt', toPath: 'docs/notes.txt' }),
    });
    const moved = await api<any>(
      apiBaseUrl,
      `/api/workspaces/${workspace.id}/files/preview?path=docs/notes.txt`,
    );
    expect(moved.content).toBe('browser-ok');

    const thread = await api<any>(apiBaseUrl, '/api/threads/start', {
      method: 'POST',
      body: JSON.stringify({
        workspaceId: workspace.id,
        title: `${name} thread`,
        provider: 'codex',
        model: 'ios-e2e-stream',
        approvalMode: 'yolo',
      }),
    });
    await page.goto(`/threads/${thread.id}`);
    await expect(page.getByRole('textbox', { name: 'Prompt' })).toBeVisible();
    const filesTab = page.getByRole('button', { name: /^Files$/i });
    if (await filesTab.count()) {
      await filesTab.click();
      await expect(page.getByText('README.md').first()).toBeVisible();
    }
  });

  test('interrupts a long fake turn via API', async () => {
    const name = `long-${randomUUID().slice(0, 8)}`;
    const absPath = await ensureWorkspaceDir(workspaceRoot, name);
    const workspace = await api<any>(apiBaseUrl, '/api/workspaces', {
      method: 'POST',
      body: JSON.stringify({ absPath, label: name }),
    });
    const thread = await api<any>(apiBaseUrl, '/api/threads/start', {
      method: 'POST',
      body: JSON.stringify({
        workspaceId: workspace.id,
        title: `${name} long`,
        provider: 'codex',
        model: 'ios-e2e-stream',
        approvalMode: 'yolo',
      }),
    });
    await api(apiBaseUrl, `/api/threads/${thread.id}/prompt`, {
      method: 'POST',
      body: JSON.stringify({
        prompt:
          'Inspect this repository in depth, enumerate every top-level source file group, and write a detailed multi-section report before giving a final summary.',
      }),
    });
    await api(apiBaseUrl, `/api/threads/${thread.id}/interrupt`, {
      method: 'POST',
    });
    const detail = await api<any>(apiBaseUrl, `/api/threads/${thread.id}`);
    expect(detail.thread.status).not.toBe('running');
    expect(collectTexts(detail).join(' ')).toBeTruthy();
  });
});
