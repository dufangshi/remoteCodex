import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const base = `http://127.0.0.1:${process.env.E2E_API_PORT ?? 8787}`;

test('workbench keeps tab positions, fills the viewport and separates session identifiers in themed settings', async ({ page, request, context }, testInfo) => {
  const absPath = path.resolve(process.env.E2E_WORKSPACE_ROOT ?? '.local/e2e-playwright', `workbench-tabs-${randomUUID()}`);
  await mkdir(absPath, { recursive: true });
  const workspace = await (await request.post(`${base}/api/workspaces`, { data: { absPath, label: 'Workbench review' } })).json();
  const ids: string[] = [];
  for (const title of ['First review', 'Second review']) {
    const response = await request.post(`${base}/api/threads/start`, { data: { workspaceId: workspace.id, title, provider: 'acp', agentId: 'codex', model: 'ios-e2e-stream', approvalMode: 'yolo' } });
    expect(response.ok()).toBeTruthy();
    const thread = await response.json();
    ids.push(thread.id ?? thread.thread.id);
  }
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(`/threads/${ids[0]}`);
  await expect(page.locator('.matter-thread-tabs a')).toHaveCount(1);
  await page.goto(`/threads/${ids[1]}`);
  await expect(page.locator('.matter-thread-tabs a')).toHaveCount(2);
  const expected = ids.map(id => `/threads/${id}`);
  const tabOrder = () => page.locator('.matter-thread-tabs a').evaluateAll(links => links.map(link => link.getAttribute('href')));
  expect(await tabOrder()).toEqual(expected);
  await page.locator(`.matter-thread-tabs a[href="${expected[0]}"]`).click();
  await expect(page.locator('.matter-current-title')).toHaveText('First review');
  expect(await tabOrder()).toEqual(expected);
  await page.evaluate(() => localStorage.setItem('remote-codex-theme-mode', 'dark'));
  await page.reload();
  await expect(page.locator('.matter-thread-tabs a')).toHaveCount(2);
  expect(await tabOrder()).toEqual(expected);
  // A parent's old bottom padding clipped the workbench even when its own bounds were correct.
  expect(await page.evaluate(() => document.elementsFromPoint(innerWidth / 2, innerHeight - 1).some(e => e.classList.contains('matter-workbench')))).toBe(true);
  await page.locator('.matter-thread-menu > summary').click();
  await page.getByRole('button', { name: 'Copy Remote Codex session ID', exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(ids[0]);
  const detail = await (await request.get(`${base}/api/threads/${ids[0]}`)).json();
  expect(detail.thread.providerSessionId).toBeTruthy();
  await page.getByRole('button', { name: 'Copy harness session ID', exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(detail.thread.providerSessionId);
  await page.getByRole('button', { name: 'Copy Codex deeplink', exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(`codex://threads/${detail.thread.providerSessionId}`);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Open settings', exact: true }).click();
  const settings = page.getByTestId('settings-dialog');
  await expect(settings).toHaveClass(/matter-settings-dialog/);
  await expect(settings).toHaveAttribute('data-theme-effective', 'dark');
  await expect(settings.getByText('Remote Codex session ID', { exact: true })).toBeVisible();
  await expect(settings.getByText('Harness session ID', { exact: true })).toBeVisible();
  await page.screenshot({ path: `output/playwright/matter-settings-dark-${testInfo.project.name}.png` });
  await settings.getByRole('button', { name: 'Global', exact: true }).click();
  await expect(settings.locator('.thread-graph-settings-global-content')).toBeVisible();
  await settings.getByTestId('theme-mode-light').click();
  await expect(settings).toHaveAttribute('data-theme-effective', 'light');
  await expect(settings.getByTestId('theme-mode-light')).toHaveAttribute('aria-pressed', 'true');
  await expect(settings).toHaveCSS('background-color', 'rgb(253, 253, 253)');
  await page.screenshot({ path: `output/playwright/matter-settings-global-${testInfo.project.name}.png` });
  await page.keyboard.press('Escape');
  await page.evaluate(() => localStorage.setItem('remote-codex-theme-mode', 'dark'));
  await page.reload();
  await expect(page.locator('.matter-thread-tabs a')).toHaveCount(2);
  await page.screenshot({ path: `output/playwright/matter-workbench-final-${testInfo.project.name}.png` });
});

test('Matter workbench floats the composer, persists shortcuts, searches history and gates Terminal', async ({
  page,
  request,
}, testInfo) => {
  const absPath = path.resolve(
    process.env.E2E_WORKSPACE_ROOT ?? '.local/e2e-playwright',
    `matter-${randomUUID()}`,
  );
  await mkdir(absPath, { recursive: true });
  const wsResponse = await request.post(`${base}/api/workspaces`, {
    data: { absPath, label: 'Design workspace' },
  });
  expect(wsResponse.ok()).toBeTruthy();
  const ws = await wsResponse.json();
  const createdResponse = await request.post(`${base}/api/threads/start`, {
    data: {
      workspaceId: ws.id,
      title: 'Refine the conversation experience',
      provider: 'acp',
      agentId: 'grok',
      model: 'ios-e2e-stream',
      approvalMode: 'yolo',
    },
  });
  expect(createdResponse.ok()).toBeTruthy();
  const created = await createdResponse.json();
  const id = created.id ?? created.thread.id;
  await page.goto(`/threads/${id}`);
  await expect(page.getByRole('textbox', { name: 'Prompt' })).toBeVisible();
  await page
    .getByRole('textbox', { name: 'Prompt' })
    .fill('hello, bring some clarity to this workspace');
  await page.getByRole('button', { name: 'Send Prompt', exact: true }).click();
  await expect(page.getByText('hello', { exact: true })).toBeVisible();
  const metrics = await page.evaluate(() => {
    const composer = document
      .querySelector('[data-testid="chat-composer"]')!
      .getBoundingClientRect();
    const transcript = document
      .querySelector('.thread-graph-scroll-container')!
      .getBoundingClientRect();
    return {
      composer: {
        x: composer.x,
        y: composer.y,
        right: composer.right,
        bottom: composer.bottom,
      },
      transcript: { bottom: transcript.bottom },
      mainRight: document.querySelector('.matter-main')!.getBoundingClientRect()
        .right,
      width: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    };
  });
  expect(metrics.transcript.bottom).toBeGreaterThan(metrics.composer.y + 20);
  expect(metrics.composer.x).toBeGreaterThanOrEqual(0);
  expect(metrics.composer.right).toBeLessThanOrEqual(metrics.width);
  expect(metrics.documentWidth).toBe(metrics.width);
  expect(metrics.mainRight).toBe(metrics.width);
  await page.getByRole('button', { name: 'Add shortcut', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Remove shortcut' }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Remove shortcut' }),
  ).toBeVisible();
  if (testInfo.project.name === 'mobile-chromium')
    await page
      .getByRole('button', { name: 'Toggle shortcuts sidebar' })
      .click();
  await expect(
    page
      .getByTestId('shortcuts')
      .getByRole('link', { name: /Refine the conversation/ }),
  ).toBeVisible();
  if (testInfo.project.name === 'mobile-chromium')
    await page
      .getByRole('button', { name: 'Close sidebar', exact: true })
      .click();
  await page
    .getByRole('button', { name: 'Search conversation', exact: true })
    .click();
  await page.getByRole('textbox', { name: 'Search messages' }).fill('clarity');
  await expect(page.getByText('1 matching messages')).toBeVisible();
  await expect(page.locator('.workbench-search-results mark')).toHaveText(
    'clarity',
  );
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('dialog', { name: 'Search conversation' }),
  ).not.toBeVisible();
  await page
    .getByRole('button', { name: 'Notifications', exact: true })
    .click();
  await expect(
    page.locator(`.matter-notifications a[href="/threads/${id}"]`),
  ).toContainText('Refine the conversation experience completed');
  await page.getByRole('button', { name: 'Close notification panel' }).click();
  await page.getByRole('button', { name: 'Toggle Explorer' }).click();
  await expect(
    page.getByRole('complementary', { name: 'Explorer', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Close Explorer', exact: true })
    .click();
  await page.getByRole('button', { name: 'Download transcript' }).click();
  await expect(
    page.getByRole('dialog', { name: 'Thread actions', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.thread-export-dialog-title')).toHaveText('Download HTML');
  await expect(page.locator('.matter-actions-dialog')).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export HTML', exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/\.html$/);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Share as link', exact: true }).click();
  await expect(page.locator('.thread-export-dialog-title')).toHaveText('Share read-only link');
  await expect(page.getByRole('status').filter({ hasText: 'Open this device through your Relay account' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Sharing permissions', exact: true }).click();
  await expect(page.locator('.thread-export-dialog-title')).toHaveText('Sharing permissions');
  await expect(page.getByRole('status').filter({ hasText: 'invite other users' })).toBeVisible();
  await page.keyboard.press('Escape');
  // Preserve the user's plugin settings: this API belongs only to the isolated test server.
  const plugins = await (await request.get(`${base}/api/plugins`)).json();
  const terminal = plugins.find(
    (p: { id: string }) => p.id === 'remote-codex.terminal',
  );
  expect(terminal).toBeTruthy();
  try {
    expect(
      (
        await request.patch(`${base}/api/plugins/${terminal.id}`, {
          data: { enabled: false },
        })
      ).ok(),
    ).toBeTruthy();
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Prompt' })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Terminal', exact: true }),
    ).toHaveCount(0);
    expect(
      (
        await request.patch(`${base}/api/plugins/${terminal.id}`, {
          data: { enabled: true },
        })
      ).ok(),
    ).toBeTruthy();
    await page.reload();
    await expect(
      page.getByRole('button', { name: 'Terminal', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Terminal', exact: true }).click();
    await expect(page.locator('.xterm-screen')).toBeVisible();
    await page.getByRole('button', { name: 'Chat', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Prompt' })).toBeVisible();
  } finally {
    await request.patch(`${base}/api/plugins/${terminal.id}`, {
      data: { enabled: terminal.enabled },
    });
  }
  await page.screenshot({
    path: `output/playwright/matter-workbench-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page.locator('summary[aria-label="Thread actions"]').click();
  await page
    .getByRole('button', { name: 'Rename thread', exact: true })
    .click();
  await page
    .getByRole('textbox', { name: 'Thread Title', exact: true })
    .fill('Renamed workspace review');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.matter-current-title')).toHaveText(
    'Renamed workspace review',
  );
  await page
    .getByRole('link', { name: 'Back to workspaces', exact: true })
    .click();
  await expect(page).toHaveURL(/\/workspaces$/);
});

test('execution timeline expands deferred work and keeps the last reply above the floating composer', async ({
  page,
  request,
}, testInfo) => {
  const absPath = path.resolve(
    process.env.E2E_WORKSPACE_ROOT ?? '.local/e2e-playwright',
    `matter-preview-${randomUUID()}`,
  );
  await mkdir(absPath, { recursive: true });
  const ws = await (
    await request.post(`${base}/api/workspaces`, {
      data: { absPath, label: 'Remote Codex' },
    })
  ).json();
  const created = await (
    await request.post(`${base}/api/threads/start`, {
      data: {
        workspaceId: ws.id,
        title: 'A calmer coding workspace',
        provider: 'acp',
        agentId: 'grok',
        model: 'ios-e2e-stream',
        approvalMode: 'yolo',
      },
    })
  ).json();
  const id = created.id ?? created.thread.id;
  expect(
    (
      await request.post(`${base}/api/threads/${id}/prompt`, {
        data: { prompt: 'hello' },
      })
    ).ok(),
  ).toBeTruthy();
  await expect
    .poll(
      async () =>
        (await (await request.get(`${base}/api/threads/${id}`)).json()).thread
          .status,
    )
    .toBe('idle');
  const database = path.resolve(
    process.env.E2E_DATABASE_URL ??
      `.local/e2e-${process.env.E2E_API_PORT ?? 8787}.sqlite`,
  );
  const db = new DatabaseSync(database);
  const now = Date.now() - 30000;
  const timestamp = (offset: number) => new Date(now + offset).toISOString();
  const prompt =
    'Give our workspace a calmer, more focused interface. Keep the tools close and let the conversation breathe.';
  const reply =
    '## A calmer place to work\n\nThe conversation now sits at the center, with the tools you need just one click away.\n\n### What changed\n\n- **A floating composer.** Messages scroll behind the prompt, with room to read the final reply.\n- **Your threads, together.** Shortcuts and recent chats keep useful conversations close across projects and devices.\n- **Less noise.** Thin icons, quiet surfaces and a restrained green accent make each state easier to read.\n\n### Built around your workflow\n\nThe left rail switches between chat and Terminal. Search finds earlier decisions, the bell brings completed work back to your attention, and the Explorer opens without leaving the conversation.\n\n```tsx\n<Workspace>\n  <Conversation />\n  <FloatingComposer />\n</Workspace>\n```\n\nThe design also adapts to smaller screens: navigation becomes a drawer, while the conversation keeps its full width.\n\nReady for your review.';
  try {
    const turn = db
      .prepare('SELECT id FROM thread_turns WHERE thread_id=?')
      .get(id) as { id: string };
    expect(turn).toBeTruthy();
    db.prepare(
      'UPDATE thread_turns SET display_prompt=?,started_at=?,completed_at=? WHERE id=?',
    ).run(prompt, timestamp(0), timestamp(23000), turn.id);
    const rows = db
      .prepare(
        'SELECT id,item_json FROM thread_history_items WHERE thread_id=? AND turn_id=?',
      )
      .all(id, turn.id) as { id: string; item_json: string }[];
    for (const row of rows) {
      const item = JSON.parse(row.item_json);
      const isUser = item.kind === 'userMessage';
      item.text = isUser ? prompt : reply;
      item.createdAt = timestamp(isUser ? 0 : 23000);
      db.prepare(
        'UPDATE thread_history_items SET item_json=?,created_at=? WHERE id=?',
      ).run(JSON.stringify(item), item.createdAt, row.id);
    }
    const steps = [
      {
        kind: 'reasoning',
        text: 'I’ll inspect the current layout and trace how the composer, navigation and execution history fit together.',
      },
      {
        kind: 'commandExecution',
        text: 'Read workspace structure',
        command: 'ls apps/supervisor-web/src',
        detailText: 'components/  pages/  lib/  index.css',
        exitCode: 0,
      },
      {
        kind: 'commandExecution',
        text: 'Inspect the composer and navigation',
        command:
          'rg -n "ThreadComposer|ThreadWorkspaceLayout" packages/thread-ui/src',
        detailText:
          'Located the composer, thread navigation and timeline surfaces.',
        exitCode: 0,
      },
      {
        kind: 'commandExecution',
        text: 'Verify responsive layout',
        command:
          'pnpm exec playwright test matter-workbench --project=desktop-chromium',
        detailText:
          'Passed: floating composer, shortcut persistence, search and plugin gating.',
        exitCode: 0,
      },
    ];
    for (const [index, step] of steps.entries()) {
      const itemId = randomUUID();
      const item = {
        id: itemId,
        ...step,
        status: 'completed',
        createdAt: timestamp(1000 + index * 3000),
      };
      db.prepare(
        'INSERT INTO thread_history_items(id,thread_id,turn_id,item_id,item_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',
      ).run(
        randomUUID(),
        id,
        turn.id,
        itemId,
        JSON.stringify(item),
        item.createdAt,
        item.createdAt,
      );
    }
  } finally {
    db.close();
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto(`/threads/${id}`);
  const expand = page.getByRole('button', { name: /Worked.*Expand turn 1/ });
  await expand.scrollIntoViewIfNeeded();
  await expand.click();
  await expect(page.locator('.thread-execution-timeline')).toBeVisible();
  await expect(page.getByText('4 steps', { exact: true })).toBeVisible();
  await page
    .getByRole('button', { name: 'Expand 3 command entries', exact: true })
    .click();
  await expect(
    page.getByText('Verify responsive layout', { exact: true }),
  ).toBeVisible();
  await expect(page.locator('.matter-command-step')).toHaveCount(3);
  await expect(page.locator('.matter-step-status[aria-label="Completed"]')).toHaveCount(3);
  await expect(page.locator('.matter-step-time')).toHaveCount(3);
  await expect(page.locator('.matter-command-step').first()).not.toContainText('completed');
  expect((await page.locator('.matter-command-step').first().boundingBox())!.height).toBeLessThanOrEqual(36);
  expect((await page.locator('.matter-thread-tabs').boundingBox())!.height).toBeLessThanOrEqual(36);
  await expect(page.locator('.matter-workspace-path')).toHaveText(/^~\/.*….*$/);
  await page.locator('.thread-graph-scroll-container').evaluate((e) => {
    e.scrollTop = e.scrollHeight;
  });
  await expect(
    page.getByText('Ready for your review.', { exact: true }),
  ).toBeVisible();
  const final = await page
    .getByText('Ready for your review.', { exact: true })
    .boundingBox();
  const composer = await page.getByTestId('chat-composer').boundingBox();
  expect(final!.y + final!.height).toBeLessThanOrEqual(composer!.y);
  await page.getByRole('button', { name: 'Add shortcut', exact: true }).click();
  await page.locator('.thread-graph-scroll-container').evaluate((e) => {
    e.scrollTop = 0;
  });
  await page.screenshot({
    path: 'output/playwright/matter-preview-light.png',
    fullPage: true,
  });
  await page.evaluate(() =>
    localStorage.setItem('remote-codex-theme-mode', 'dark'),
  );
  await page.reload();
  await expect(page.locator('.thread-ui-shell').first()).toHaveAttribute(
    'data-theme-effective',
    'dark',
  );
  await page.getByRole('button', { name: /Worked.*Expand turn 1/ }).click();
  await page
    .getByRole('button', { name: 'Expand 3 command entries', exact: true })
    .click();
  await page.locator('.thread-graph-scroll-container').evaluate((e) => {
    e.scrollTop = 0;
  });
  await page.screenshot({
    path: 'output/playwright/matter-preview-dark.png',
    fullPage: true,
  });
  await testInfo.attach('preview-url', {
    body: `/threads/${id}`,
    contentType: 'text/plain',
  });
});
