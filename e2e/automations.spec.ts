import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

test('device automations define, pause, resume, cancel and expose script history in English and Chinese', async ({
  page,
  request,
}) => {
  const base = `http://127.0.0.1:${process.env.E2E_API_PORT ?? 8787}`;
  const absPath = path.resolve(
    process.env.E2E_WORKSPACE_ROOT!,
    `hooks-${randomUUID()}`,
  );
  await mkdir(absPath, { recursive: true });
  const wsResponse = await request.post(`${base}/api/workspaces`, {
    data: { absPath },
  });
  expect(wsResponse.ok()).toBeTruthy();
  const ws = await wsResponse.json();
  const threadResponse = await request.post(`${base}/api/threads/start`, {
    data: {
      workspaceId: ws.id,
      provider: 'codex',
      model: 'ios-e2e-stream',
      approvalMode: 'yolo',
    },
  });
  expect(threadResponse.ok()).toBeTruthy();
  const created = await threadResponse.json();
  const id = created.id ?? created.thread.id;
  await page.addInitScript(() =>
    localStorage.setItem('remote-codex.locale', 'en'),
  );
  await page.goto(`/threads/${id}`);
  await page.getByRole('button', { name: 'Automations', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Automations', exact: true });
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole('button', { name: 'Create automation', exact: true })
    .click();
  await dialog.getByLabel('Name', { exact: true }).fill('Hourly inbox check');
  await dialog
    .getByRole('combobox', { name: 'Action', exact: true })
    .selectOption('notifyInbox');
  await dialog.getByLabel('Subject', { exact: true }).fill('Hourly result');
  await dialog
    .getByLabel('Text', { exact: true })
    .fill('This reminder stays passive.');
  await dialog.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(dialog.locator('pre')).toContainText('nextRuns');
  await dialog
    .getByRole('button', { name: 'Register automation', exact: true })
    .click();
  const hourly = dialog
    .locator('article')
    .filter({ hasText: 'Hourly inbox check' });
  await expect(hourly.getByText('Enabled', { exact: true })).toBeVisible();
  await expect(hourly).toContainText('Every 3600 seconds');
  await expect(hourly).toContainText('Next scheduled:');
  await hourly.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(hourly.getByText('Paused', { exact: true })).toBeVisible();
  await hourly.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(hourly.getByText('Enabled', { exact: true })).toBeVisible();
  await hourly
    .getByRole('button', { name: 'Execution history', exact: true })
    .click();
  await expect(
    hourly.getByText('No executions yet.', { exact: true }),
  ).toBeVisible();

  // A real script runs in an isolated fixture, with genuine failure / output persisted.
  const script = await request.post(`${base}/api/threads/${id}/automations`, {
    data: {
      definition: {
        name: 'Script exit history',
        trigger: { kind: 'at', at: new Date(Date.now() - 1000).toISOString() },
        action: {
          kind: 'runScript',
          shell: 'printf fixture-output; exit 7',
          cwd: absPath,
          timeoutSeconds: 3,
        },
      },
      clientRequestId: randomUUID(),
    },
  });
  expect(script.ok()).toBeTruthy();
  const automation = await script.json();
  await expect
    .poll(
      async () =>
        (
          await (
            await request.get(
              `${base}/api/threads/${id}/automations/${automation.id}/runs`,
            )
          ).json()
        ).runs[0]?.state,
    )
    .toBe('failed');
  await dialog.getByRole('button', { name: 'Refresh', exact: true }).click();
  const failed = dialog
    .locator('article')
    .filter({ hasText: 'Script exit history' });
  await failed
    .getByRole('button', { name: 'Execution history', exact: true })
    .click();
  await expect(failed.getByText('Failed', { exact: true })).toBeVisible();
  await expect(failed).toContainText('command exited with code 7');
  await failed
    .getByRole('button', { name: 'Command output', exact: true })
    .click();
  await expect(failed.locator('pre').last()).toContainText('fixture-output');
  const detail = await (await request.get(`${base}/api/threads/${id}`)).json();
  expect(detail.thread.status).toBe('idle');
  expect(detail.pendingSteers).toHaveLength(0);
  await page.screenshot({
    path: '/home/ubuntu/dev/remoteCodex/.temp/research/unified-hooks/automations-en.png',
  });

  await hourly
    .getByRole('button', { name: 'Cancel automation', exact: true })
    .click();
  await expect(hourly.getByText('Cancelled', { exact: true })).toBeVisible();
  await expect(
    hourly.getByRole('button', { name: 'Resume', exact: true }),
  ).toHaveCount(0);
  await page.addInitScript(() =>
    localStorage.setItem('remote-codex.locale', 'zh-CN'),
  );
  await page.reload();
  await page.getByRole('button', { name: '自动化', exact: true }).click();
  const zh = page.getByRole('dialog', { name: '自动化', exact: true });
  await expect(
    zh.getByRole('button', { name: '创建自动化', exact: true }),
  ).toBeVisible();
  const zhFailed = zh
    .locator('article')
    .filter({ hasText: 'Script exit history' });
  await zhFailed.getByRole('button', { name: '执行历史', exact: true }).click();
  await expect(zhFailed.getByText('失败', { exact: true })).toBeVisible();
  await expect(zh).toContainText('设备调度跨 Supervisor 重启保留');
  expect(
    await zh.evaluate((el) => el.scrollWidth - el.clientWidth),
  ).toBeLessThanOrEqual(1);
  await page.screenshot({
    path: '/home/ubuntu/dev/remoteCodex/.temp/research/unified-hooks/automations-zh.png',
  });
});
