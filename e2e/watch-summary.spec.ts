import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

test('watch summaries show creation, recorded triggers and summed turn cost with compact mobile details', async ({
  page,
  request,
}) => {
  if (!process.env.E2E_DATABASE_URL || !process.env.E2E_WORKSPACE_ROOT)
    throw new Error('Use explicit isolated E2E database and workspace');
  const base = `http://127.0.0.1:${process.env.E2E_API_PORT ?? 8787}`;
  const absPath = path.resolve(
    process.env.E2E_WORKSPACE_ROOT,
    `watches-${randomUUID()}`,
  );
  await mkdir(absPath, { recursive: true });
  const wsResponse = await request.post(`${base}/api/workspaces`, {
    data: { absPath, label: 'Watch summaries' },
  });
  expect(wsResponse.ok()).toBeTruthy();
  const workspace = await wsResponse.json();
  const created = await request.post(`${base}/api/threads/start`, {
    data: {
      workspaceId: workspace.id,
      title: 'Watch summaries',
      provider: 'claude',
      model: 'default',
      approvalMode: 'yolo',
    },
  });
  expect(created.ok()).toBeTruthy();
  const result = await created.json();
  const id = result.id ?? result.thread.id;
  const now = Date.now();
  const createdAt = new Date(now - 3600000).toISOString();
  const prompt = `Watch-only details ${'Long_schedule_context_without_spaces_'.repeat(60)}`;
  const watches = [
    {
      id: 'job-active',
      createdAt,
      prompt,
      cron: '*/20 * * * *',
      recurring: true,
    },
    {
      id: 'job-past',
      createdAt,
      prompt: 'Old watch details',
      cron: '* * * * *',
      recurring: true,
    },
  ];
  const usage = {
    total: {
      totalTokens: 110000,
      inputTokens: 100000,
      outputTokens: 10000,
      cachedInputTokens: 40000,
      cacheWriteInputTokens: 10000,
      reasoningOutputTokens: 1000,
    },
  };
  execFileSync(
    'python3',
    [
      '-c',
      `
import json, sqlite3, sys
v=json.load(sys.stdin)
with sqlite3.connect(sys.argv[1]) as conn:
  for watch in v['watches']:
    item=dict(id=watch['id'],createdAt=watch['createdAt'],kind='toolCall',text='CronCreate',status='completed',detailText='Input:\\n'+json.dumps(dict(cron=watch['cron'],prompt=watch['prompt'],recurring=True))+'\\n\\nResult:\\nScheduled recurring job '+watch['id']+' (* * * * *). Auto-expires after 7 days.')
    conn.execute('INSERT INTO thread_history_items(id,thread_id,turn_id,item_id,item_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',(v['id']+watch['id'],v['id'],'owner',watch['id'],json.dumps(item),watch['createdAt'],watch['createdAt']))
  cancelled=dict(id='delete',createdAt=v['cancelledAt'],kind='toolCall',text='CronDelete',status='completed',detailText='Input:\\n{"id":"job-past"}\\n\\nResult:\\nDeleted job')
  conn.execute('INSERT INTO thread_history_items(id,thread_id,turn_id,item_id,item_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',(v['id']+'delete',v['id'],'owner','delete',json.dumps(cancelled),v['cancelledAt'],v['cancelledAt']))
  for n, at in enumerate(v['turnTimes']):
    tid=v['id']+(':scheduled:'+str(n) if n<2 else ':manual')
    conn.execute('INSERT INTO thread_turns(id,thread_id,status,model,display_prompt,token_usage_json,started_at,completed_at,ordinal) VALUES(?,?,?,?,?,?,?,?,?)',(tid,v['id'],'completed','claude-opus-4-6',v['prompt'],json.dumps(v['usage']),at,at,n))
`,
      path.resolve(process.env.E2E_DATABASE_URL),
    ],
    {
      input: JSON.stringify({
        id,
        watches,
        prompt,
        usage,
        cancelledAt: new Date(now - 3000000).toISOString(),
        turnTimes: [2700000, 1800000, 900000].map((age) =>
          new Date(now - age).toISOString(),
        ),
      }),
    },
  );
  const response = await request.get(`${base}/api/threads/${id}/watches`);
  expect(response.ok()).toBeTruthy();
  const snapshot = await response.json();
  const active = snapshot.watches.find((w: any) => w.id === 'job-active');
  expect(active.triggerCount).toBe(2);
  expect(active.tokenUsage.totalTokens).toBe(220000);
  const detailResponse = await request.get(`${base}/api/threads/${id}`);
  expect(detailResponse.ok()).toBeTruthy();
  const detail = await detailResponse.json();
  const sum = detail.turns
    .filter((turn: any) => turn.id.includes(':scheduled:'))
    .reduce(
      (total: number, turn: any) => total + turn.priceEstimate.totalUsd,
      0,
    );
  expect(active.priceEstimate.totalUsd).toBeCloseTo(sum, 10);
  const usd = `$${sum.toFixed(2)}`;
  await page.goto(`/threads/${id}`);
  const toggle = page.getByRole('button', { name: 'Watches (1)', exact: true });
  await expect(toggle).toBeVisible();
  await toggle.click();
  const dialog = page.getByRole('dialog', { name: 'Watches', exact: true });
  const card = dialog.locator('article').first();
  await expect(dialog).toBeVisible();
  await expect(card.getByText('Created', { exact: true })).toBeVisible();
  await expect(card.locator(`time[datetime="${createdAt}"]`)).toBeVisible();
  await expect(card.getByText('Triggers', { exact: true })).toBeVisible();
  await expect(card.locator('dd').filter({ hasText: /^2$/ })).toBeVisible();
  const cost = dialog.getByRole('button', {
    name: `Watch total cost ${usd}. Show token details`,
    exact: true,
  });
  await expect(cost).toBeVisible();
  await expect(page.locator('[data-slot="tooltip-content"]')).not.toBeVisible();
  await expect(dialog.getByText(prompt, { exact: true })).toHaveCount(0);
  await expect(
    dialog.getByText('Old watch details', { exact: true }),
  ).not.toBeVisible();
  await page.screenshot({
    path: path.resolve('.local/watch-summary-mobile.png'),
  });
  await cost.tap();
  const popover = page.locator('[data-slot="tooltip-content"]');
  await expect(
    popover.getByLabel('Cached input: 80,000 tokens', { exact: true }).first(),
  ).toBeVisible();
  await expect(
    popover.getByLabel('Cache write: 20,000 tokens', { exact: true }).first(),
  ).toBeVisible();
  await expect(
    popover
      .getByText('Sum of costs reported by the recorded watch turns.', {
        exact: true,
      })
      .first(),
  ).toBeVisible();
  await cost.tap();
  await expect(popover).not.toBeVisible();
  await cost.tap();
  await expect(popover).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole('button', { name: 'Show details', exact: true })
    .first()
    .click();
  await expect(dialog.getByText(prompt, { exact: true })).toBeVisible();
  expect(
    await dialog.evaluate((el) => el.scrollWidth - el.clientWidth),
  ).toBeLessThanOrEqual(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    ),
  ).toBeLessThanOrEqual(1);
  await page.screenshot({
    path: path.resolve('.local/watch-summary-expanded-mobile.png'),
  });
  await dialog
    .getByRole('button', { name: 'Hide details', exact: true })
    .click();
  await dialog.getByText('Past watches (1)', { exact: true }).click();
  await expect(dialog.getByText('Cancelled', { exact: true })).toBeVisible();
  await expect(
    dialog.getByText('Old watch details', { exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(toggle).toBeFocused();

  // Older devices keep compact watches without misrepresenting missing counters as zero.
  await page.route(`**/api/threads/${id}/watches`, async (route) => {
    const legacy = { ...active };
    for (const field of [
      'triggerCount',
      'tokenUsage',
      'priceEstimate',
      'pricedTriggerCount',
      'usageTriggerCount',
      'ambiguousTriggerCount',
    ])
      delete legacy[field];
    await route.fulfill({ json: { watches: [legacy] } });
  });
  await toggle.click();
  await expect(
    dialog.getByText('Cost unavailable', { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.locator('dd').filter({ hasText: /^Unavailable$/ }),
  ).toBeVisible();
  await expect(dialog.getByText(prompt, { exact: true })).toHaveCount(0);
});
