import { test, expect, type Locator } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

test.use({ actionTimeout: 15_000 });
async function geometry(dialog: Locator) {
  return dialog.evaluate(node => {
    const r = node.getBoundingClientRect(), s = getComputedStyle(node);
    const panel = node.querySelector('.settings-panel')!.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height, panelX: panel.x, panelY: panel.y, font: s.fontFamily, padding: s.padding, transform: s.transform, translate: s.translate };
  });
}

test('settings retain centered geometry through theme switches and share their shell inside and outside conversations', async ({ page, request }, testInfo) => {
  const mobile = testInfo.project.name === 'mobile-chromium';
  await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
  const base = `http://127.0.0.1:${process.env.E2E_API_PORT ?? 8787}`;
  const absPath = path.resolve(process.env.E2E_WORKSPACE_ROOT!, randomUUID());
  await mkdir(absPath, { recursive: true });
  const workspace = await (await request.post(base + '/api/workspaces', { data: { absPath, label: 'Appearance' } })).json();
  const thread = await (await request.post(base + '/api/threads/start', { data: { workspaceId: workspace.id, provider: 'acp', agentId: 'codex', model: 'ios-e2e-stream', approvalMode: 'yolo' } })).json();
  await page.goto('/workspaces');
  await page.getByRole('button', { name: 'Open Navigation' }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
  await expect(dialog).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await expect(dialog).toHaveCSS('opacity', '1');
  const outside = await geometry(dialog);
  for (const mode of ['Light', 'Dark', 'Light']) {
    await dialog.getByRole('radio', { name: mode, exact: true }).locator('..').click();
    await expect(dialog).toHaveAttribute('data-theme-effective', mode.toLowerCase());
    await expect.poll(async () => Math.abs((await geometry(dialog)).x - outside.x)).toBeLessThan(1);
    await expect.poll(async () => Math.abs((await geometry(dialog)).y - outside.y)).toBeLessThan(1);
  }
  await page.keyboard.press('Escape');
  await page.goto(`/threads/${thread.id}`);
  await page.getByRole('button', { name: 'Open settings', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveCSS('opacity', '1');
  const inside = await geometry(dialog);
  expect(inside, JSON.stringify({ outside, inside })).toEqual(outside);
  for (const mode of ['Dark', 'Light']) {
    await dialog.getByRole('radio', { name: mode, exact: true }).locator('..').click();
    await expect(dialog).toHaveAttribute('data-theme-effective', mode.toLowerCase());
    await expect.poll(async () => Math.abs((await geometry(dialog)).x - inside.x)).toBeLessThan(1);
    await expect.poll(async () => Math.abs((await geometry(dialog)).y - inside.y)).toBeLessThan(1);
  }
  await page.screenshot({ path: testInfo.outputPath('shared-settings.png') });
});
