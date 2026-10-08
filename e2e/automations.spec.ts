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
    dialog.getByRole('group', { name: 'Triggers' }).locator('strong'),
  ).toHaveText('1');
  await dialog
    .getByText('History and inactive automations (1)', { exact: true })
    .click();
  const failed = dialog
    .locator('article')
    .filter({ hasText: 'Script exit history' });
  await failed.getByText('Details', { exact: true }).click();
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
  await expect(zh).toContainText('计划与执行概览');
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

test('automation overview is compact, responsive and distinguishes an unsupported device from empty data', async ({
  page,
  request,
}, testInfo) => {
  const base = `http://127.0.0.1:${process.env.E2E_API_PORT ?? 8787}`;
  const absPath = path.resolve(
    process.env.E2E_WORKSPACE_ROOT!,
    `overview-${randomUUID()}`,
  );
  await mkdir(absPath, { recursive: true });
  const workspace = await (
    await request.post(`${base}/api/workspaces`, { data: { absPath } })
  ).json();
  const started = await (
    await request.post(`${base}/api/threads/start`, {
      data: {
        workspaceId: workspace.id,
        provider: 'codex',
        model: 'ios-e2e-stream',
        approvalMode: 'yolo',
      },
    })
  ).json();
  const id = started.id ?? started.thread.id;
  // Controlled presentation fixture: usage figures here are not real account billing.
  const rule = {
    id: 'overview',
    threadId: id,
    sourceKind: 'supervisor',
    definition: {
      name: '每小时检查项目进展',
      trigger: { kind: 'interval', everySeconds: 3600 },
      action: { kind: 'prompt', text: '检查项目进展并记录结果' },
    },
    state: 'enabled',
    nextRunAt: '2030-01-01T01:00:00Z',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    pendingCount: 0,
    missedCount: 0,
    error: null,
    statistics: {
      triggerCount: 24,
      runCount: 24,
      executedActionCount: 24,
      runningActionCount: 0,
      promptTurnCount: 24,
      ambiguousTurnCount: 0,
      missingTurnCount: 0,
      unattributedRunCount: 0,
      usageTurnCount: 24,
      pricedTurnCount: 24,
      tokenUsage: {
        totalTokens: 24700,
        inputTokens: 22000,
        cachedInputTokens: 0,
        cacheWriteInputTokens: 0,
        outputTokens: 2700,
        reasoningOutputTokens: 0,
      },
      priceEstimate: {
        totalUsd: 0.42,
        inputUsd: 0.3,
        cachedInputUsd: 0,
        cacheWriteInputUsd: 0,
        outputUsd: 0.12,
      },
    },
  };
  let unsupported = false;
  await page.route(`**/api/threads/${id}/automations`, (route) =>
    route.fulfill(
      unsupported
        ? {
            status: 404,
            json: {
              error: { code: 'notFound', message: 'Route not found' },
              message: 'Route not found',
            },
          }
        : { json: { automations: [rule] } },
    ),
  );
  await page.addInitScript(() => {
    localStorage.setItem('remote-codex.locale', 'zh-CN');
    localStorage.setItem('remote-codex-theme-mode', 'dark');
  });
  await page.goto(`/threads/${id}`);
  await page.getByRole('button', { name: '自动化', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '自动化', exact: true });
  await expect(
    dialog.getByText(rule.definition.name, { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole('group', { name: '累计触发' }).locator('strong'),
  ).toHaveText('24');
  await expect(
    dialog.locator('.automation-stat-notes > div'),
  ).not.toBeVisible();
  await expect(dialog.getByRole('textbox')).toHaveCount(0);
  const refreshBounds = await dialog
    .getByRole('button', { name: '刷新', exact: true })
    .boundingBox();
  expect(refreshBounds!.width).toBeLessThanOrEqual(40);
  expect(refreshBounds!.width).toBeGreaterThanOrEqual(28);
  expect(
    await dialog.evaluate((el) => el.scrollWidth - el.clientWidth),
  ).toBeLessThanOrEqual(1);
  const screenshots = process.env.AUTOMATION_SCREENSHOT_DIR;
  if (screenshots) {
    await mkdir(screenshots, { recursive: true });
    await page.screenshot({
      path: path.join(
        screenshots,
        `${testInfo.project.name.startsWith('mobile') ? 'mobile' : 'desktop'}-automation-overview.png`,
      ),
    });
  }
  await page.keyboard.press('Escape');
  unsupported = true;
  await page.reload();
  await page.getByRole('button', { name: '自动化', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText(
    '更新设备后查看自动化',
  );
  await expect(
    dialog.getByRole('group', { name: '累计触发' }).locator('strong'),
  ).toHaveText('—');
  await expect(
    dialog.getByText('Route not found', { exact: true }),
  ).not.toBeVisible();
  await expect(dialog.getByText('还没有自动化', { exact: true })).toHaveCount(
    0,
  );
  if (screenshots)
    await page.screenshot({
      path: path.join(
        screenshots,
        `${testInfo.project.name.startsWith('mobile') ? 'mobile' : 'desktop'}-automation-unavailable.png`,
      ),
    });
  await dialog.getByLabel('连接详情').click();
  await expect(
    dialog.getByText('Route not found', { exact: true }),
  ).toBeVisible();
});
