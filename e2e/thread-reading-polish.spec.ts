import { test, expect, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const base = `http://127.0.0.1:${process.env.E2E_API_PORT ?? 8787}`;
async function createThread(request: APIRequestContext) {
  const absPath = path.resolve(process.env.E2E_WORKSPACE_ROOT!, randomUUID());
  await mkdir(absPath, { recursive: true });
  const workspace = await (await request.post(`${base}/api/workspaces`, { data: { absPath, label: 'Reading regression' } })).json();
  const response = await request.post(`${base}/api/threads/start`, { data: { workspaceId: workspace.id, title: 'Reading regression', provider: 'acp', agentId: 'codex', model: 'ios-e2e-stream', approvalMode: 'yolo' } });
  expect(response.ok()).toBeTruthy();
  const value = await response.json();
  return value.id ?? value.thread.id as string;
}

test('opening a detached thread automatically connects once and hides the healthy indicator', async ({ page, request }) => {
  const id = await createThread(request);
  const detail = await (await request.get(`${base}/api/threads/${id}`)).json();
  let loaded = false;
  await page.route(`**/api/threads/${id}?**`, route => route.fulfill({ json: { ...detail, thread: { ...detail.thread, isLoaded: loaded } } }));
  await page.route(`**/api/threads/${id}/resume`, async route => {
    loaded = true;
    await route.fulfill({ json: { ...detail, thread: { ...detail.thread, isLoaded: true } } });
  });
  const connections: string[] = [];
  page.on('request', req => { if (req.url().endsWith(`/api/threads/${id}/resume`)) connections.push(req.url()); });
  await page.goto(`/threads/${id}`);
  await expect.poll(() => loaded).toBe(true);
  await expect(page.getByRole('textbox', { name: 'Prompt' })).toBeEnabled();
  await expect(page.locator('.device-connection-button')).toHaveCount(0);
  expect(connections).toHaveLength(1);
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Prompt' })).toBeEnabled();
  await expect(page.locator('.device-connection-button')).toHaveCount(0);
  expect(connections).toHaveLength(1);
});

test('reading layout stays still with bounded images, visible effort and ten recent notifications', async ({ page, request }, testInfo) => {
  const id = await createThread(request);
  const detail = await (await request.get(`${base}/api/threads/${id}`)).json();
  const turns = [{
    id: 'reading-turn', status: 'completed', startedAt: '2026-09-20T10:00:00Z', completedAt: '2026-09-20T10:01:12Z',
    model: 'a-deliberately-long-model-name-for-mobile-layout', reasoningEffort: 'xhigh',
    tokenUsage: { total: { totalTokens: 3500, inputTokens: 1000, outputTokens: 2500, cachedInputTokens: 0, reasoningOutputTokens: 1000 } },
    items: [
      { id: 'reading-prompt', kind: 'userMessage', text: 'Review this image' },
      { id: 'reading-reply', kind: 'agentMessage', text: '![Large test image](https://image.test/reading-test-image.png)\n\n' + 'A paragraph that keeps the conversation scrollable.\n\n'.repeat(30) },
    ],
  }];
  await page.route(`**/api/threads/${id}?**`, route => route.fulfill({ json: { ...detail, turns, totalTurnCount: 1 } }));
  await page.route('**/reading-test-image.png', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="3000"><rect width="2400" height="3000" fill="#3458dc"/></svg>' }));
  await page.route('**/api/threads', route => route.fulfill({ json: [detail.thread, ...Array.from({ length: 15 }, (_, i) => ({ ...detail.thread, id: `notice-${i}`, title: `Notice ${i}`, lastTurnCompletedAt: new Date(Date.UTC(2026, 8, 19, i)).toISOString() }))] }));
  await page.goto(`/threads/${id}`);
  const scroll = page.getByTestId('thread-scroll-container');
  await expect(page.getByRole('textbox', { name: 'Prompt' })).toBeVisible();
  const effort = page.locator('.thread-turn-usage-effort');
  await expect(effort).toBeVisible();
  await expect(effort).toHaveText(' · xhigh');
  const img = page.locator('.thread-graph-zoomable-image-trigger > img');
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate(e => (e as HTMLImageElement).naturalHeight)).toBe(3000);
  await page.getByRole('button', { name: 'Jump to previous turn' }).click();
  await expect.poll(() => page.locator('[data-timeline-turn]').evaluate(e => Math.abs(e.getBoundingClientRect().top - document.querySelector('[data-testid="thread-scroll-container"]')!.getBoundingClientRect().top - 8))).toBeLessThan(3);
  const size = await img.boundingBox();
  expect(size!.width).toBeLessThanOrEqual(448);
  expect(size!.height).toBeLessThanOrEqual(Math.min(384, page.viewportSize()!.height / 2));
  await scroll.dispatchEvent('wheel', { deltaY: -500 });
  await scroll.evaluate(e => { e.scrollTo({ top: 350, behavior: 'instant' }); });
  const position = () => scroll.evaluate(e => ({ top: e.getBoundingClientRect().top, height: e.clientHeight, scroll: e.scrollTop }));
  await expect.poll(() => scroll.evaluate(e => e.scrollTop)).toBe(350);
  const before = await position();
  await page.getByRole('button', { name: 'Thread tools', exact: true }).click();
  await expect(page.locator('.matter-breadcrumb')).toBeVisible();
  expect(await position()).toEqual(before);
  await page.getByRole('button', { name: 'Thread tools', exact: true }).click();
  expect(await position()).toEqual(before);
  if (testInfo.project.name === 'mobile-chromium') {
    expect(await effort.evaluate(e => {
      const box = e.getBoundingClientRect();
      const parent = e.closest('.thread-turn-usage')!.getBoundingClientRect();
      return box.left >= parent.left && box.right <= parent.right;
    })).toBe(true);
    expect(await page.locator('.matter-thread-tabs').evaluate(e => ({ y: getComputedStyle(e).overflowY, bar: getComputedStyle(e).scrollbarWidth }))).toEqual({ y: 'hidden', bar: 'none' });
  }
  await page.getByRole('button', { name: 'Notifications', exact: true }).click();
  const notifications = page.locator('.matter-notifications > a');
  await expect(notifications).toHaveCount(10);
  await expect(notifications.first()).toContainText('Notice 14');
  await expect(notifications.last()).toContainText('Notice 5');
  await page.getByRole('button', { name: 'Close notification panel' }).click();
  await img.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('reading-layout.png') });
});
