import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

test('command batches have one icon and thread dialogs follow light and dark themes', async ({ page, request }, testInfo) => {
  const base = `http://127.0.0.1:${process.env.E2E_API_PORT ?? 8787}`;
  const absPath = path.resolve(process.env.E2E_WORKSPACE_ROOT!, randomUUID());
  await mkdir(absPath, { recursive: true });
  const workspace = await (await request.post(`${base}/api/workspaces`, { data: { absPath, label: 'Theme regression' } })).json();
  const response = await request.post(`${base}/api/threads/start`, { data: { workspaceId: workspace.id, title: 'Theme regression', provider: 'acp', agentId: 'codex', model: 'ios-e2e-stream', approvalMode: 'yolo' } });
  expect(response.ok()).toBeTruthy();
  const thread = await response.json();
  const id = thread.id ?? thread.thread.id;
  const detail = await (await request.get(`${base}/api/threads/${id}`)).json();
  const startedAt = new Date().toISOString();
  await page.route(`**/api/threads/${id}?**`, route => route.fulfill({ json: {
    ...detail,
    thread: { ...detail.thread, status: 'running', activeTurnId: 'theme-turn' },
    totalTurnCount: 1,
    turns: [{ id: 'theme-turn', status: 'inProgress', startedAt, completedAt: null, items: [
      { id: 'prompt', kind: 'userMessage', text: 'Check the commands' },
      { id: 'cmd-a', kind: 'commandExecution', text: 'git status', status: 'completed', createdAt: startedAt },
      { id: 'cmd-b', kind: 'commandExecution', text: 'pnpm test', status: 'in_progress', createdAt: startedAt },
    ] }],
  } }));
  for (const theme of ['light', 'dark']) {
    await page.goto(`/threads/${id}`);
    await page.evaluate(value => localStorage.setItem('remote-codex-theme-mode', value), theme);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme-effective', theme);
    await page.getByRole('button', { name: /Expand turn 1/ }).click();
    const group = page.locator('.thread-graph-history-group-command');
    await expect(group).toBeVisible();
    // Running dots must not inherit the icon's box or count-badge hiding rule.
    await expect(group.locator('.thread-graph-history-group-icon > span')).toHaveCount(1);
    const dots = group.locator('.thread-graph-history-group-summary .animate-pulse');
    await expect(dots).toHaveCount(3);
    for (const dot of await dots.all()) await expect(dot).toBeVisible();
    await group.getByRole('button', { name: 'Expand 2 command entries' }).click();
    await expect(group.getByRole('button', { name: 'Open grouped command 1' })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`batch-${theme}.png`) });
    await page.getByRole('button', { name: 'Thread tools', exact: true }).click();
    for (const action of ['Rename', 'Delete']) {
      await page.locator('.matter-thread-menu > summary').click();
      await page.locator('.matter-thread-menu').getByRole('button', { name: `${action} thread`, exact: true }).click();
      const dialog = page.getByRole('dialog', { name: `${action} Thread`, exact: true });
      await expect(dialog).toBeVisible();
      const colors = await dialog.evaluate(element => {
        const probe = document.createElement('div');
        probe.style.backgroundColor = 'var(--theme-panel)';
        probe.style.color = 'var(--theme-fg)';
        document.body.append(probe);
        const expected = getComputedStyle(probe), actual = getComputedStyle(element);
        const result = { background: actual.backgroundColor, foreground: actual.color, expectedBackground: expected.backgroundColor, expectedForeground: expected.color };
        probe.remove();
        return result;
      });
      expect(colors.background).toBe(colors.expectedBackground);
      expect(colors.foreground).toBe(colors.expectedForeground);
      await page.screenshot({ path: testInfo.outputPath(`${action.toLowerCase()}-${theme}.png`) });
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(dialog).toBeHidden();
    }
  }
});
