import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, test, type APIRequestContext } from '@playwright/test';

const base = `http://127.0.0.1:${process.env.E2E_API_PORT ?? 8787}`;
const screenshotRoot = process.env.WORKBENCH_SCREENSHOT_DIR;

// Only the isolated fake Supervisor database is edited. All UI data is then read
// through the normal API. Native-agent metadata is an explicitly labelled fixture.
async function fixture(request: APIRequestContext) {
  const absPath = path.resolve(
    process.env.E2E_WORKSPACE_ROOT!,
    `workbench-${randomUUID()}`,
  );
  await mkdir(absPath, { recursive: true });
  await writeFile(
    path.join(absPath, '验收记录.md'),
    '# 工作台验收\n\n双会话保持独立；参考区不发送消息。\n',
  );
  const wsResponse = await request.post(`${base}/api/workspaces`, {
    data: { absPath, label: '远程工作台 · 布局评审' },
  });
  expect(wsResponse.ok()).toBeTruthy();
  const ws = await wsResponse.json();
  const create = async (title: string, parentThreadId?: string) => {
    const response = await request.post(`${base}/api/threads/start`, {
      data: {
        workspaceId: ws.id,
        title,
        provider: 'codex',
        model: 'default',
        approvalMode: 'yolo',
        parentThreadId,
      },
    });
    expect(response.ok()).toBeTruthy();
    const value = await response.json();
    return value.thread ?? value;
  };
  const a = await create('实现：双会话工作台');
  const b = await create('评审：发送目标与手机布局', a.id);
  const c = await create('验证：恢复与异常状态', a.id);
  for (const thread of [a, b, c]) {
    expect(
      (
        await request.post(`${base}/api/threads/${thread.id}/prompt`, {
          data: { prompt: 'hello' },
        })
      ).ok(),
    ).toBeTruthy();
    await expect
      .poll(
        async () =>
          (await (await request.get(`${base}/api/threads/${thread.id}`)).json())
            .thread.status,
      )
      .toBe('idle');
  }
  const filename = path.resolve(process.env.E2E_DATABASE_URL!);
  expect(filename).toContain('.temp/workbench/');
  const db = new DatabaseSync(filename);
  db.function('search_fold', { deterministic: true }, (value) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  );
  db.function('search_body', { deterministic: true }, (text, kind, _source) =>
    ['userMessage', 'agentMessage'].includes(String(kind)) ? text : null,
  );
  const text = [
    [
      '请实现双会话工作台，设备、工作区和发送目标要始终清楚。',
      '## 工作台实现已准备\n\n主会话负责实现，参考区用于核对评审意见。\n\n### 核心约束\n\n- **唯一发送目标**：当前输入只属于主会话。\n- **独立阅读**：两边历史与滚动互不干扰。\n- **安全切换**：设为主会话后才允许向参考目标输入。\n\n### 待评审\n\n请检查手机的主 / 参考切换，以及刷新后的布局恢复。\n\n> 本页为 fake harness 验收示例；不连接真实模型。',
    ],
    [
      '请独立评审双会话布局，并给出可操作的验收意见。',
      '## 独立评审结论\n\n布局能同时呈现实现内容与评审证据。\n\n### 已检查\n\n1. 参考会话没有第二个输入框。\n2. 关闭参考视图不停止后台线程。\n3. 主 / 参考会话的草稿不会串线。\n\n### 建议\n\n在手机上保留明确的「设为主会话」按钮，让回复评审意见只需一次切换。\n\n**结果：可以进入视觉评审。**\n\n> API / native 状态均为隔离验收 fixture。',
    ],
    ['验证损坏布局的恢复路径。', '验证发现一处异常配置；请检查恢复策略。'],
  ];
  try {
    for (const [index, thread] of [a, b, c].entries()) {
      db.prepare(
        'UPDATE thread_turns SET display_prompt=? WHERE thread_id=?',
      ).run(text[index]![0], thread.id);
      const rows = db
        .prepare(
          'SELECT id,item_json FROM thread_history_items WHERE thread_id=?',
        )
        .all(thread.id) as { id: string; item_json: string }[];
      for (const row of rows) {
        const item = JSON.parse(row.item_json);
        if (item.kind !== 'userMessage' && item.kind !== 'agentMessage')
          continue;
        item.text = text[index]![item.kind === 'userMessage' ? 0 : 1];
        db.prepare(
          'UPDATE thread_history_items SET item_json=? WHERE id=?',
        ).run(JSON.stringify(item), row.id);
      }
    }
    const nativeTurn = db
      .prepare('SELECT id FROM thread_turns WHERE thread_id=?')
      .get(a.id) as { id: string };
    for (const [id, name, status] of [
      ['native-check-layout', '原生代理 · 检查布局', 'completed'],
      ['native-check-width', '原生代理 · 宽度回归', 'failed'],
    ]) {
      const timestamp = new Date().toISOString();
      const item = {
        id,
        kind: 'agentToolCall',
        text: name,
        status,
        createdAt: timestamp,
        detailText: '隔离 fake harness fixture：已记录的原生工具结果。',
      };
      db.prepare(
        'INSERT INTO thread_history_items(id,thread_id,turn_id,item_id,item_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',
      ).run(
        randomUUID(),
        a.id,
        nativeTurn.id,
        id,
        JSON.stringify(item),
        timestamp,
        timestamp,
      );
    }
    db.prepare(
      "UPDATE threads SET status='failed',last_error=? WHERE id=?",
    ).run('Fixture：布局配置损坏，已回退默认比例。', c.id);
  } finally {
    db.close();
  }
  return { a, b, c };
}

test('comparison keeps a single send target, isolated drafts and recoverable views', async ({
  page,
  request,
}, testInfo) => {
  const mobile = testInfo.project.name === 'mobile-chromium';
  await page.setViewportSize(
    mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
  );
  await page.addInitScript(() => {
    localStorage.setItem('remote-codex.locale', 'zh-CN');
    localStorage.setItem('remote-codex-theme-mode', 'light');
  });
  const { a, b, c } = await fixture(request);
  await page.goto(`/threads/${a.id}`);
  const primary = page.getByTestId('primary-pane');
  const reference = page.getByTestId('reference-pane');
  const prompt = page.getByRole('textbox', { name: '提示词', exact: true });
  await expect(primary).toContainText('发送目标 · 主会话');
  await expect(primary).toContainText(a.title);
  await expect(prompt).toBeVisible();
  await prompt.fill('只属于实现会话的未发送草稿');
  await page.getByTestId('reference-picker').click();
  await page
    .getByRole('combobox', { name: '对照此设备的会话' })
    .selectOption(b.id);
  await expect(reference).toContainText('独立评审结论');
  await expect(reference.getByRole('textbox')).toHaveCount(0);
  if (mobile) {
    await expect(prompt).not.toBeVisible();
    await page.getByRole('button', { name: '主会话', exact: true }).click();
  }
  await expect(prompt).toHaveText('只属于实现会话的未发送草稿');
  await expect(page.getByTestId('chat-composer')).toHaveCount(1);
  const snap = async (name: string) => {
    if (!screenshotRoot) return;
    await mkdir(screenshotRoot, { recursive: true });
    await page.screenshot({
      path: path.join(screenshotRoot, name),
      scale: 'css',
    });
  };
  if (mobile) {
    await snap('mobile-main.png');
    await page
      .getByRole('navigation', { name: '工作台视图' })
      .getByRole('button', { name: '参考区', exact: true })
      .click();
    await expect(prompt).not.toBeVisible();
    await snap('mobile-reference.png');
    await page.goBack();
    await expect(prompt).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/threads/${a.id}$`));
    await page
      .getByRole('navigation', { name: '工作台视图' })
      .getByRole('button', { name: '参考区', exact: true })
      .click();
  } else {
    await snap('desktop-compare.png');
    const separator = page.getByRole('separator', { name: '调整对照比例' });
    await separator.focus();
    await separator.press('ArrowLeft');
    await expect(separator).toHaveAttribute('aria-valuenow', '50');
  }
  await page.getByTestId('make-primary').click();
  await expect(page).toHaveURL(new RegExp(`/threads/${b.id}$`));
  await expect(primary).toContainText(b.title);
  await expect(prompt).toBeVisible();
  await expect(prompt).toHaveText('');
  await prompt.fill('仅发送给评审会话');
  await page.getByRole('button', { name: '发送提示词', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await (await request.get(`${base}/api/threads/${b.id}`)).json()).turns
          .length,
    )
    .toBe(2);
  expect(
    (await (await request.get(`${base}/api/threads/${a.id}`)).json()).turns,
  ).toHaveLength(1);
  if (mobile)
    await page
      .getByRole('navigation', { name: '工作台视图' })
      .getByRole('button', { name: '参考区', exact: true })
      .click();
  await page.getByTestId('make-primary').click();
  await expect(primary).toContainText(a.title);
  await expect(prompt).toHaveText('只属于实现会话的未发送草稿');
  // Close only the view. The reference thread still exists and its history is intact.
  if (mobile)
    await page
      .getByRole('navigation', { name: '工作台视图' })
      .getByRole('button', { name: '参考区', exact: true })
      .click();
  await page.getByRole('button', { name: '关闭参考视图', exact: true }).click();
  await expect(reference).not.toBeVisible();
  expect(
    (await (await request.get(`${base}/api/threads/${b.id}`)).json()).thread.id,
  ).toBe(b.id);
  await page.getByTestId('reference-picker').click();
  await page.getByRole('button', { name: '协作进度', exact: true }).click();
  await expect(page.getByTestId('managed-summary')).toHaveCount(2);
  await expect(page.getByTestId('native-summary')).toHaveCount(2);
  await expect(reference).toContainText('已完成');
  await expect(reference).toContainText('失败');
  await expect(reference).toContainText('暂未接入任务板和 inbox 摘要');
  if (!mobile) await snap('desktop-collaboration.png');
  await page
    .getByTestId('native-summary')
    .filter({ hasText: '原生代理 · 检查布局' })
    .getByRole('button', { name: '查看结果' })
    .click();
  await expect(page.getByRole('dialog', { name: '原生代理 · 检查布局', exact: true })).toContainText('隔离 fake harness fixture：已记录的原生工具结果。');
  await page.keyboard.press('Escape');
  await page.getByTestId('reference-picker').click();
  await page.getByRole('button', { name: '协作进度', exact: true }).click();
  await page.getByTestId('reference-picker').click();
  await page.getByRole('button', { name: '工作区文件', exact: true }).click();
  await expect(page.getByRole('complementary', { name: '文件浏览器', exact: true })).toBeVisible();
  await expect(page.getByRole('treeitem', { name: '验收记录.md', exact: true })).toBeVisible();
  await page.getByTestId('reference-picker').click();
  await page.getByRole('button', { name: '协作进度', exact: true }).click();
  await page
    .getByTestId('managed-summary')
    .filter({ hasText: b.title })
    .getByRole('button', { name: '旁边对照' })
    .click();
  await expect(reference).toContainText(b.title);
  // Real browser persistence, including damaged arrangement with a valid member.
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage))
      if (key.includes('presentation.v1:') && key.endsWith('.arrangement'))
        localStorage.setItem(key, '{broken');
  });
  await page.reload();
  await expect(page.getByTestId('workbench-panels')).toHaveAttribute(
    'data-mode',
    'thread',
  );
  if (mobile)
    await page
      .getByRole('navigation', { name: '工作台视图' })
      .getByRole('button', { name: '参考区', exact: true })
      .click();
  await expect(reference).toContainText(b.title);
  if (!mobile)
    await expect(
      page.getByRole('separator', { name: '调整对照比例' }),
    ).toHaveAttribute('aria-valuenow', '55');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    mobile ? 390 : 1440,
  );
  const keyButton = page.getByTestId('make-primary');
  await expect(keyButton).toBeInViewport();
  expect((await keyButton.boundingBox())!.x).toBeGreaterThanOrEqual(0);
  await page.unrouteAll({ behavior: 'wait' });
});

test('opening and closing references preserves a running primary and ignores late reference responses', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { a, b, c } = await fixture(request);
  let releaseB!: () => void;
  const delayed = new Promise<void>((resolve) => {
    releaseB = resolve;
  });
  let bRequested!: () => void;
  const requested = new Promise<void>((resolve) => {
    bRequested = resolve;
  });
  await page.route(`**/api/threads/${b.id}?*`, async (route) => {
    const response = await route.fetch();
    bRequested();
    await delayed;
    await route.fulfill({ response });
  });
  await page.route(`**/api/threads/${c.id}?*`, async (route) => {
    const response = await route.fetch();
    const detail = await response.json();
    for (const turn of detail.turns)
      for (const item of turn.items)
        if (item.kind === 'agentMessage')
          item.text =
            '参考区长历史\n\n' +
            Array.from(
              { length: 60 },
              (_, index) => `第 ${index + 1} 项：独立滚动和请求来源隔离。`,
            ).join('\n\n');
    await route.fulfill({ response, json: detail });
  });
  let socketCount = 0;
  page.on('websocket', () => {
    socketCount += 1;
  });
  await page.goto(`/threads/${a.id}`);
  const primary = page.getByTestId('primary-pane');
  const reference = page.getByTestId('reference-pane');
  await expect(primary).toContainText(a.title);
  expect(
    (
      await request.post(`${base}/api/threads/${a.id}/prompt`, {
        data: { prompt: 'inspect this repository' },
      })
    ).ok(),
  ).toBeTruthy();
  await expect(primary).toContainText('Running');
  const baselineSocketCount = socketCount;
  await page.getByTestId('reference-picker').click();
  await page
    .getByRole('combobox', { name: 'Compare a session on this device' })
    .selectOption(b.id);
  await requested;
  await expect(primary).toContainText(a.title);
  await page.getByTestId('reference-picker').click();
  await page
    .getByRole('combobox', { name: 'Compare a session on this device' })
    .selectOption(c.id);
  await expect(reference).toContainText(c.title);
  releaseB();
  await expect(reference).toContainText('参考区长历史');
  await expect(reference.locator('.workbench-pane-heading')).not.toContainText(
    b.title,
  );
  const primaryScroll = primary.locator('.thread-graph-scroll-container');
  const referenceScroll = reference.locator('.thread-graph-scroll-container');
  const primaryOffset = await primaryScroll.evaluate((node) => node.scrollTop);
  await referenceScroll.evaluate((node) => {
    node.scrollTop = 200;
    node.dispatchEvent(new Event('scroll'));
  });
  await expect
    .poll(() => referenceScroll.evaluate((node) => node.scrollTop))
    .toBeGreaterThan(100);
  expect(await primaryScroll.evaluate((node) => node.scrollTop)).toBe(
    primaryOffset,
  );
  expect(socketCount).toBe(baselineSocketCount);
  await page
    .getByRole('button', { name: 'Close reference view', exact: true })
    .click();
  await expect(reference).not.toBeVisible();
  expect(
    (await (await request.get(`${base}/api/threads/${a.id}`)).json()).thread
      .status,
  ).toBe('running');
  await expect(
    primary.getByText('ok: inspect this repository', { exact: true }),
  ).toBeVisible({ timeout: 35000 });
  await expect
    .poll(
      async () =>
        (await (await request.get(`${base}/api/threads/${a.id}`)).json()).thread
          .status,
    )
    .toBe('idle');
  await page.unrouteAll({ behavior: 'wait' });
});
