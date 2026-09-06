import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { api, ensureWorkspaceDir } from './helpers';
const base = `http://127.0.0.1:${process.env.E2E_API_PORT ?? 8787}`;
test('workspace, recent threads and import share one compact navigation header', async ({
  page,
}, testInfo) => {
  if (testInfo.project.name === 'mobile-chromium')
    await page.addInitScript(() =>
      localStorage.setItem('remote-codex-theme-mode', 'dark'),
    );
  const label = `Navigation ${randomUUID().slice(0, 8)}`;
  const absPath = await ensureWorkspaceDir(
    path.resolve(process.env.E2E_WORKSPACE_ROOT ?? '.local/e2e'),
    `navigation-${randomUUID()}`,
  );
  const workspace = await api<any>(base, '/api/workspaces', {
    method: 'POST',
    body: JSON.stringify({ absPath, label }),
  });
  await api(base, '/api/threads/start', {
    method: 'POST',
    body: JSON.stringify({
      workspaceId: workspace.id,
      title: 'A readable recent thread',
      provider: 'codex',
      model: 'default',
      approvalMode: 'yolo',
    }),
  });
  await page.goto('/workspaces');
  const header = page.locator('.product-navigation');
  const initial = (await header.boundingBox())!;
  await page.getByRole('button', { name: `Pin ${label}`, exact: true }).click();
  await expect(
    page.getByRole('button', { name: `Unpin ${label}`, exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Pinned', { exact: true })).toHaveCount(0);
  await page.goto(`/threads?workspaceId=${workspace.id}`);
  await expect(
    header.getByRole('heading', { name: label, exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Supervisor', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Shared Workspace', { exact: true })).toHaveCount(
    0,
  );
  await expect(
    header.getByRole('link', { name: 'New thread', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'A readable recent thread', exact: false }),
  ).toBeVisible();
  expect((await header.boundingBox())!.height).toBe(initial.height);
  await page.screenshot({ path: testInfo.outputPath('recent-threads.png') });
  await header
    .getByRole('link', { name: 'Back to workspaces', exact: true })
    .click();
  await page.getByRole('link', { name: 'Import session', exact: true }).click();
  await expect(
    header.getByRole('heading', { name: 'Import threads', exact: true }),
  ).toBeVisible();
  expect((await header.boundingBox())!.height).toBe(initial.height);
  await header
    .getByRole('link', { name: 'Back to workspaces', exact: true })
    .click();
  await expect(
    header.getByRole('heading', { name: 'Workspaces', exact: true }),
  ).toBeVisible();
});
