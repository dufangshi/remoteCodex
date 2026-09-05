import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { expect, test as base, type Locator, type Page } from '@playwright/test';
import type { ModelOptionDto } from '../packages/shared/src/index';

import { api, ensureWorkspaceDir } from './helpers';

const apiBaseUrl = `http://127.0.0.1:${Number(process.env.E2E_API_PORT ?? 8787)}`;
const workspaceRoot = path.resolve(
  process.env.E2E_WORKSPACE_ROOT ?? '.local/e2e-playwright',
);

const test = base.extend<{ threadId: string }>({
  threadId: async ({}, use) => {
    const label = `composer-menus-${randomUUID().slice(0, 8)}`;
    const absPath = await ensureWorkspaceDir(workspaceRoot, label);
    let workspaceId: string | undefined;
    let threadId: string | undefined;

    try {
      const workspace = await api<{ id: string }>(apiBaseUrl, '/api/workspaces', {
        method: 'POST',
        body: JSON.stringify({ absPath, label }),
      });
      workspaceId = workspace.id;
      const thread = await api<{ id: string }>(apiBaseUrl, '/api/threads/start', {
        method: 'POST',
        body: JSON.stringify({
          workspaceId,
          provider: 'codex',
          model: 'ios-e2e-stream',
          approvalMode: 'guarded',
          title: label,
        }),
      });
      threadId = thread.id;
      await use(threadId);
    } finally {
      if (threadId) {
        await api(apiBaseUrl, `/api/threads/${threadId}/interrupt`, {
          method: 'POST',
        }).catch(() => undefined);
        await api(apiBaseUrl, `/api/threads/${threadId}`, { method: 'DELETE' });
      }
      if (workspaceId) {
        await api(apiBaseUrl, `/api/workspaces/${workspaceId}`, {
          method: 'DELETE',
          body: JSON.stringify({ confirmWorkspaceId: workspaceId, confirmLabel: label }),
        });
      }
      await fs.rm(absPath, { recursive: true, force: true });
    }
  },
});

function openMenu(page: Page) {
  return page.locator('[data-composer-menu-surface="true"]:visible');
}

async function expectMenuInsideViewport(menu: Locator) {
  await expect(menu).toBeVisible();
  await expect.poll(async () => menu.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft ?? 0;
    const top = viewport?.offsetTop ?? 0;
    const right = left + (viewport?.width ?? window.innerWidth);
    const bottom = top + (viewport?.height ?? window.innerHeight);
    return Math.max(left - rect.left, top - rect.top, rect.right - right, rect.bottom - bottom);
  }), { message: 'The entire composer menu should fit inside the visible viewport' })
    .toBeLessThanOrEqual(1);
}

async function startRunningReply(page: Page, threadId: string) {
  await page.goto(`/threads/${threadId}`);
  const prompt = page.getByRole('textbox', { name: 'Prompt' });
  await expect(prompt).toBeVisible();
  await expect(page.getByText('Ask the backend to inspect, modify, or explain code...', {
    exact: true,
  })).toHaveCount(0);

  // The fake runtime holds this request for 25 seconds, keeping the stop control visible.
  await prompt.fill('Inspect this repository while I adjust the composer controls.');
  await page.getByRole('button', { name: 'Send Prompt' }).click();
  await expect(page.getByRole('button', { name: 'Stop Current Turn' })).toBeVisible();
  await expect(prompt).toBeEmpty();
}

test('composer menus stay in bounds and accept clicks during a running reply', async ({
  page,
  threadId,
}, testInfo) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await startRunningReply(page, threadId);
  const menu = openMenu(page);
  const stop = page.getByRole('button', { name: 'Stop Current Turn' });

  await page.getByRole('button', { name: 'Open slash toolbox' }).click();
  await expectMenuInsideViewport(menu);
  const plan = menu.getByRole('button', { name: /^\/plan/ });
  await expect(plan).toHaveAttribute('aria-pressed', 'false');
  await plan.click();
  await expect(menu).toHaveCount(0);
  await page.getByRole('button', { name: 'Open slash toolbox' }).click();
  await expect(plan).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: /^Sandbox:/ }).click();
  await expectMenuInsideViewport(menu);
  await menu.getByRole('button', { name: 'Read only', exact: true }).click();
  await expect(menu).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Sandbox: Read only' })).toBeVisible();
  await page.getByRole('button', { name: /^Sandbox:/ }).click();
  await expectMenuInsideViewport(menu);
  await menu.getByRole('button', { name: 'Danger', exact: true }).click();
  await expect(menu).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Sandbox: Danger' })).toBeVisible();

  await page.getByRole('button', { name: /^Model and effort:/ }).click();
  await expectMenuInsideViewport(menu);
  await menu.getByRole('button', { name: /^Model\s/ }).click();
  await expectMenuInsideViewport(menu);
  await menu.getByRole('button', { name: 'GPT-5.4', exact: true }).click();
  const model = page.getByRole('button', { name: /^Model and effort: GPT-5\.4,/ });
  await expect(model).toBeVisible();
  await model.click();
  await menu.getByRole('button', { name: /^Effort\s/ }).click();
  await expectMenuInsideViewport(menu);
  await menu.getByRole('button', { name: 'high', exact: true }).click();
  await expect(model).toHaveAccessibleName('Model and effort: GPT-5.4, high');

  await page.getByRole('button', { name: 'Add attachment' }).click();
  await expectMenuInsideViewport(menu);
  const fileChooser = page.waitForEvent('filechooser');
  await menu.getByRole('button', { name: 'File', exact: true }).click();
  await (await fileChooser).setFiles([]);

  // Ordinary clicks above must reach the menu without accidentally stopping the turn.
  await expect(stop).toBeVisible();
  await page.getByRole('button', { name: /^Sandbox:/ }).click();
  await expectMenuInsideViewport(menu);
  await page.screenshot({ path: testInfo.outputPath('running-sandbox-menu.png') });
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await stop.click();
  await expect(stop).toHaveCount(0);
});

test('an expanded model list stays usable when the viewport becomes narrow and short', async ({
  page,
  threadId,
}, testInfo) => {
  await page.route((url) => url.pathname === '/api/agent-runtimes/codex/models', async (route) => {
    const response = await route.fetch();
    const models = await response.json() as ModelOptionDto[];
    const extraModels = Array.from({ length: 24 }, (_, index): ModelOptionDto => ({
      ...models[0],
      id: `composer-model-${index}`,
      model: `composer-model-${index}`,
      displayName: `Composer model ${index + 1}`,
      isDefault: false,
    }));
    await route.fulfill({ response, json: [...models, ...extraModels] });
  });

  await startRunningReply(page, threadId);
  const menu = openMenu(page);
  await page.getByRole('button', { name: /^Model and effort:/ }).click();
  await menu.getByRole('button', { name: /^Model\s/ }).click();
  await expectMenuInsideViewport(menu);

  await page.setViewportSize({ width: 320, height: 360 });
  await expectMenuInsideViewport(menu);
  const lastModel = menu.getByRole('button', { name: 'Composer model 24', exact: true });
  await lastModel.scrollIntoViewIfNeeded();
  await expectMenuInsideViewport(menu);
  await page.screenshot({ path: testInfo.outputPath('compact-model-menu.png') });
  await lastModel.click();
  await expect(page.getByRole('button', {
    name: /^Model and effort: Composer model 24,/,
  })).toBeVisible();

  await page.getByRole('button', { name: /^Sandbox:/ }).click();
  await expectMenuInsideViewport(menu);
  await menu.getByRole('button', { name: 'Read only', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sandbox: Read only' })).toBeVisible();
  await page.getByRole('button', { name: 'Open slash toolbox' }).click();
  await expectMenuInsideViewport(menu);
  await menu.getByRole('button', { name: /^\/plan/ }).click();
  await expect(page.getByRole('button', { name: 'Stop Current Turn' })).toBeVisible();
});
