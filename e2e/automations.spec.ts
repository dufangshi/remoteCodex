import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

test('automation panel is read-only while agent API retains registration, control and script history', async ({
  page,
  request,
}) => {
  const base = `http://127.0.0.1:${process.env.E2E_API_PORT ?? 8787}`;
  const absPath = path.resolve(
    process.env.E2E_WORKSPACE_ROOT!,
    `hooks-${randomUUID()}`,
  );
  await mkdir(absPath, { recursive: true });
  const workspaceResponse = await request.post(`${base}/api/workspaces`, {
    data: { absPath },
  });
  expect(workspaceResponse.ok()).toBeTruthy();
  const workspace = await workspaceResponse.json();
  const threadResponse = await request.post(`${base}/api/threads/start`, {
    data: {
      workspaceId: workspace.id,
      provider: 'codex',
      model: 'ios-e2e-stream',
      approvalMode: 'yolo',
    },
  });
  expect(threadResponse.ok()).toBeTruthy();
  const thread = await threadResponse.json();
  const id = thread.id ?? thread.thread.id;
  const endpoint = `${base}/api/threads/${id}/automations`;
  const definition = {
    name: 'Hourly inbox check',
    trigger: { kind: 'interval', everySeconds: 3600 },
    action: {
      kind: 'notifyInbox',
      subject: 'Result',
      text: 'This stays passive.',
    },
  };
  // CLI/API remains the agent's management surface; idempotent acceptance survives retries.
  const registration = { definition, clientRequestId: randomUUID() };
  const first = await request.post(endpoint, { data: registration });
  expect(first.ok()).toBeTruthy();
  const hourly = await first.json();
  expect(
    (await (await request.post(endpoint, { data: registration })).json()).id,
  ).toBe(hourly.id);
  expect(
    (await (await request.post(`${endpoint}/${hourly.id}/pause`)).json()).state,
  ).toBe('paused');
  expect(
    (await (await request.post(`${endpoint}/${hourly.id}/resume`)).json())
      .state,
  ).toBe('enabled');
  const scriptResponse = await request.post(endpoint, {
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
  expect(scriptResponse.ok()).toBeTruthy();
  const script = await scriptResponse.json();
  await expect
    .poll(
      async () =>
        (await (await request.get(`${endpoint}/${script.id}/runs`)).json())
          .runs[0]?.state,
    )
    .toBe('failed');
  const shown = await (await request.get(`${endpoint}/${script.id}`)).json();
  expect(shown.statistics.triggerCount).toBe(1);
  expect(shown.statistics.tokenUsage.totalTokens).toBe(0);
  expect(shown.statistics.priceEstimate.totalUsd).toBe(0);
  const browserWrites: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/automations') && r.method() !== 'GET')
      browserWrites.push(r.url());
  });
  await page.addInitScript(() =>
    localStorage.setItem('remote-codex.locale', 'en'),
  );
  await page.goto(`/threads/${id}`);
  await page.getByRole('button', { name: 'Automation', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Automation', exact: true });
  await expect(
    dialog.getByText('Hourly inbox check', { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByRole('textbox')).toHaveCount(0);
  await expect(dialog.getByRole('combobox')).toHaveCount(0);
  await expect(
    dialog.getByRole('button', {
      name: /create|preview|register|pause|resume|cancel|edit/i,
    }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole('region', { name: 'Lifetime totals' }),
  ).toContainText('Triggers: 1');
  await dialog
    .getByText('History and inactive automations (1)', { exact: true })
    .click();
  const failed = dialog
    .locator('article')
    .filter({ hasText: 'Script exit history' });
  await expect(failed).toContainText(
    'Models invoked independently by a script are not measured here.',
  );
  await failed
    .getByRole('button', { name: 'Execution history', exact: true })
    .click();
  await expect(failed.getByText('Failed', { exact: true })).toBeVisible();
  await expect(failed).toContainText('command exited with code 7');
  await failed
    .getByRole('button', { name: 'Command output', exact: true })
    .click();
  await expect(failed.locator('pre').last()).toContainText('fixture-output');
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('button', { name: 'Automation', exact: true }),
  ).toBeFocused();
  expect(
    (await (await request.post(`${endpoint}/${hourly.id}/cancel`)).json())
      .state,
  ).toBe('cancelled');
  await page.addInitScript(() =>
    localStorage.setItem('remote-codex.locale', 'zh-CN'),
  );
  await page.reload();
  await page.getByRole('button', { name: '自动化', exact: true }).click();
  const zh = page.getByRole('dialog', { name: '自动化', exact: true });
  await expect(zh).toContainText('只读查看计划、触发与消耗');
  await zh.getByText('历史与非活跃自动化 (2)', { exact: true }).click();
  await expect(
    zh.getByText('Hourly inbox check', { exact: true }),
  ).toBeVisible();
  await expect(
    zh.getByRole('button', { name: /创建|预览|注册|暂停|恢复|取消|编辑/ }),
  ).toHaveCount(0);
  expect(browserWrites).toEqual([]);
  expect(
    await zh.evaluate((el) => el.scrollWidth - el.clientWidth),
  ).toBeLessThanOrEqual(1);
  const detail = await (await request.get(`${base}/api/threads/${id}`)).json();
  expect(detail.thread.status).toBe('idle');
  expect(detail.pendingSteers).toHaveLength(0);
});
