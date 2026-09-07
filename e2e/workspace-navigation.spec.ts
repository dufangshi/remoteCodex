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
  const thread = await api<any>(base, '/api/threads/start', {
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
  const initialMenu = (await header
    .getByRole('button', { name: 'Open Navigation', exact: true })
    .boundingBox())!;
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
  await page.goto(`/threads/${thread.id}`);
  const threadHeader = page.locator('.thread-topbar-surface');
  await expect(
    threadHeader.getByRole('button', { name: 'Open settings', exact: true }),
  ).toBeVisible();
  const finalHeader = (await threadHeader.boundingBox())!;
  const finalMenu = (await threadHeader
    .getByRole('button', { name: 'Open settings', exact: true })
    .boundingBox())!;
  for (const property of ['x', 'y', 'height', 'width'] as const)
    expect(finalHeader[property]).toBeCloseTo(initial[property], 0);
  for (const property of ['x', 'y', 'height', 'width'] as const)
    expect(finalMenu[property]).toBeCloseTo(initialMenu[property], 0);
  const back = threadHeader.getByRole('link', { name: 'Back to workspace', exact: true });
  await expect(back).toBeVisible();
  expect((await back.boundingBox())!.x).toBeCloseTo(initialMenu.x + 52, 0);
  await expect(threadHeader.getByRole('button', { name: 'Open rooms', exact: true })).toHaveCount(testInfo.project.name === 'mobile-chromium' ? 1 : 0);
  if (testInfo.project.name === 'mobile-chromium') {
    await threadHeader.getByRole('button', {name:'Open rooms',exact:true}).click();
    await expect(page.locator('.thread-rooms-rail')).toBeVisible();
    await page.getByRole('button', {name:'Close rooms',exact:true}).click();
    await expect(page.locator('.thread-rooms-rail')).not.toBeInViewport();
  } else {
    await page.getByRole('button', {name:'Collapse rooms',exact:true}).click();
    const room = page.locator('.thread-rooms-rail .thread-graph-room-card').filter({hasText:'A readable recent thread'});
    await room.hover();
    await expect(page.getByRole('tooltip')).toContainText('A readable recent thread');
    expect(await page.locator('.thread-room-tooltip').evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
    await page.screenshot({ path: testInfo.outputPath('room-tooltip.png') });
    await api(base, `/api/threads/${thread.id}/prompt`, {method:'POST',body:JSON.stringify({prompt:'Inspect this repository for the running icon regression.'})});
    await expect(room.locator('[data-thread-status="running"]')).toBeVisible();
    await api(base, `/api/threads/${thread.id}/interrupt`, {method:'POST',body:'{}'});
    await expect(room.locator('[data-thread-status="running"]')).toHaveCount(0);
  }
  await page.mouse.move(900, 500);
  await page.screenshot({ path: testInfo.outputPath('thread-header.png') });
});
