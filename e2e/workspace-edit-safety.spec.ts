import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from '@playwright/test';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

test.use({ actionTimeout: 15_000 });
const base = `http://127.0.0.1:${process.env.E2E_API_PORT ?? 8787}`;
const artifactRoot = process.env.FILE_EDITOR_SCREENSHOTS;
const noteName = '发布说明.md';
const original =
  '# 安全文件编辑 · 发布说明\n\n## 本次目标\n- 在桌面和手机上继续修改工作区文件\n- 切换文件时保留每份未保存草稿\n- 保存前检查磁盘版本，避免覆盖已发生的修改\n\n## 验收清单\n1. 阅读并编辑这份说明\n2. 查看 config.ts 后返回，草稿应仍在\n3. 检查磁盘变化并处理冲突\n\n状态：待评审，尚未发布。\n';
const draft = original.replace(
  '状态：待评审，尚未发布。',
  '状态：草稿已补充，等待团队评审。\n备注：手机端也可下载草稿并继续编辑。',
);
const agentVersion = original.replace(
  '## 验收清单',
  '## Agent 补充（磁盘版本）\n- 保留测试日志和真实浏览器截图\n- 发布前由负责人确认\n\n## 验收清单',
);
async function setup(page: Page, request: APIRequestContext, mobile = false) {
  await page.addInitScript(() => {
    localStorage.setItem('remote-codex.locale', 'zh-CN');
    localStorage.setItem('remote-codex-theme-mode', 'dark');
    localStorage.setItem('remote-codex.explorer-width', '800');
  });
  await page.setViewportSize(
    mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
  );
  const absPath = path.resolve(
    process.env.E2E_WORKSPACE_ROOT!,
    `safe-files-${randomUUID()}`,
  );
  await mkdir(absPath, { recursive: true });
  await writeFile(path.join(absPath, noteName), original);
  await writeFile(
    path.join(absPath, 'config.ts'),
    '// 产品演示 fixture，非生产配置\nexport const fileEditor = {\n  maxEditableBytes: 50 * 1024,\n  preserveDrafts: true,\n  conditionalSave: true,\n};\n',
  );
  const wsResponse = await request.post(`${base}/api/workspaces`, {
    data: { absPath, label: '产品文档 · 隔离演示工作区' },
  });
  expect(wsResponse.ok()).toBeTruthy();
  const ws = await wsResponse.json();
  const threadResponse = await request.post(`${base}/api/threads/start`, {
    data: {
      workspaceId: ws.id,
      title: '发布说明 · 文件编辑验收',
      provider: 'codex',
      model: 'ios-e2e-stream',
      approvalMode: 'yolo',
    },
  });
  expect(threadResponse.ok()).toBeTruthy();
  const thread = await threadResponse.json();
  const id = thread.id ?? thread.thread.id;
  const otherResponse = await request.post(`${base}/api/threads/start`, {
    data: {
      workspaceId: ws.id,
      title: '测试回归 · 参考会话',
      provider: 'codex',
      model: 'ios-e2e-stream',
      approvalMode: 'yolo',
    },
  });
  expect(otherResponse.ok()).toBeTruthy();
  const otherThread = await otherResponse.json();
  const otherId = otherThread.id ?? otherThread.thread.id;
  const promptResponse = await request.post(
    `${base}/api/threads/${id}/prompt`,
    {
      data: {
        prompt:
          'Reply with exactly 这是一组隔离演示数据。请先审阅文件草稿和冲突对照，再决定是否保存或合并。',
      },
    },
  );
  expect(promptResponse.ok()).toBeTruthy();
  await page.goto(`/threads/${id}`);
  if (mobile) {
    await page
      .getByRole('button', { name: '切换快捷方式侧栏', exact: true })
      .click();
    await page
      .getByRole('button', { name: '打开文件浏览器', exact: true })
      .click();
  } else
    await page
      .getByRole('navigation', { name: '工作区工具' })
      .getByRole('button', { name: '切换文件浏览器', exact: true })
      .click();
  const row = page.getByRole('treeitem', { name: noteName, exact: true });
  await expect(row).toBeVisible();
  await row.focus();
  await row.press('Enter');
  await page.getByRole('button', { name: '编辑文件', exact: true }).click();
  return { absPath, id, ws, otherId };
}
function editor(page: Page, mobile = false) {
  return page.getByRole('textbox', {
    name: mobile ? '工作区文件编辑器' : `工作区编辑器：${noteName}`,
    exact: true,
  });
}
async function replace(page: Page, content: string, mobile = false) {
  const input = editor(page, mobile);
  await input.focus();
  await input.press('ControlOrMeta+A');
  await page.keyboard.insertText(content);
}
async function screenshot(page: Page, name: string) {
  if (!artifactRoot) return;
  await mkdir(artifactRoot, { recursive: true });
  const status = page.getByTestId('workspace-document-status');
  await expect(status).toBeVisible();
  await expect(
    page.getByRole('button', { name: '保存文件', exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: path.join(artifactRoot, name),
    fullPage: false,
    scale: 'css',
  });
}

test('dirty file survives tab switch, undo, navigation cancel and guarded save-and-close', async ({
  page,
  request,
}) => {
  const { absPath, id, otherId } = await setup(page, request);
  await replace(page, draft);
  await expect(page.getByTestId('workspace-document-status')).toContainText(
    '未保存草稿',
  );
  await editor(page).press('ControlOrMeta+End');
  await page.keyboard.insertText('\n临时一行');
  const other = page.getByRole('treeitem', { name: 'config.ts', exact: true });
  await other.focus();
  await other.press('Enter');
  await page.getByRole('tab', { name: noteName, exact: true }).click();
  await expect(page.getByTestId('workspace-monaco-editor')).toContainText(
    '临时一行',
  );
  await editor(page).focus();
  await editor(page).press('ControlOrMeta+Z');
  await expect(page.getByTestId('workspace-monaco-editor')).not.toContainText(
    '临时一行',
  );
  await expect(page.getByTestId('workspace-monaco-editor')).toContainText(
    '手机端也可',
  );
  // Combined workbench: cancelling a primary swap preserves the reference and
  // the hidden file draft; membership must not change before the leave guard.
  await page.getByTestId('reference-picker').click();
  const compare = page.getByRole('combobox', { name: '对照此设备的会话', exact: true });
  await compare.selectOption(otherId);
  await expect(page.getByTestId('reference-pane')).toContainText('测试回归 · 参考会话');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByTestId('make-primary').click();
  await expect(page).toHaveURL(new RegExp(`/threads/${id}$`));
  await expect(page.getByTestId('reference-pane')).toBeVisible();
  await expect(page.getByTestId('reference-pane')).toContainText('测试回归 · 参考会话');
  await page.getByTestId('reference-picker').click();
  await page.getByRole('button', { name: '工作区文件', exact: true }).click();
  await expect(page.getByTestId('workspace-monaco-editor')).toContainText('手机端也可');
  // Actual SPA navigation through the workbench link must be cancellable.
  page.once('dialog', (dialog) => dialog.dismiss());
  await page
    .locator('.matter-group-tab')
    .filter({ hasText: '测试回归 · 参考会话' })
    .click();
  await expect(page).toHaveURL(new RegExp(`/threads/${id}$`));
  // Hiding the panel may unmount its view; retained drafts still guard reload.
  await page
    .getByRole('button', { name: '关闭参考视图', exact: true })
    .click();
  let unloadPrompt = false;
  page.once('dialog', async (dialog) => {
    unloadPrompt = dialog.type() === 'beforeunload';
    await dialog.dismiss();
  });
  await page.getByRole('link', { name: '返回工作区', exact: true }).click();
  await expect.poll(() => unloadPrompt).toBe(true);
  await expect(page).toHaveURL(new RegExp(`/threads/${id}$`));
  await page
    .getByRole('navigation', { name: '工作区工具' })
    .getByRole('button', { name: '切换文件浏览器', exact: true })
    .click();
  await expect(page.getByTestId('workspace-document-status')).toContainText(
    '未保存草稿',
  );
  await screenshot(page, 'desktop-editor.png');
  await page
    .getByRole('button', { name: `关闭 ${noteName}`, exact: true })
    .click();
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(page.getByTestId('workspace-document-status')).toContainText(
    '未保存草稿',
  );
  await page
    .getByRole('button', { name: `关闭 ${noteName}`, exact: true })
    .click();
  await page.getByRole('button', { name: '保存并关闭', exact: true }).click();
  await expect(
    page.getByRole('tab', { name: noteName, exact: true }),
  ).toHaveCount(0);
  await expect
    .poll(() => readFile(path.join(absPath, noteName), 'utf8'))
    .toBe(draft);
});

test('external write conflicts with fixed snapshot and overwrite checks the displayed version again', async ({
  page,
  request,
}) => {
  const { absPath } = await setup(page, request);
  await replace(page, draft);
  await writeFile(path.join(absPath, noteName), agentVersion);
  const rejected = page.waitForResponse(
    (response) =>
      response.url().endsWith('/files/save') && response.status() === 409,
  );
  await page.getByRole('button', { name: '保存文件', exact: true }).click();
  await rejected;
  await expect(page.getByTestId('workspace-document-conflict')).toContainText(
    '文件已在磁盘上变化',
  );
  await expect(page.getByTestId('workspace-conflict-diff')).toBeVisible();
  await expect(page.getByTestId('workspace-conflict-diff')).toContainText(
    'Agent 补充',
  );
  await expect(
    page.getByTestId('workspace-conflict-diff').locator('.line-insert').first(),
  ).toBeVisible();
  expect(await readFile(path.join(absPath, noteName), 'utf8')).toBe(
    agentVersion,
  );
  await screenshot(page, 'desktop-conflict.png');
  const newer = agentVersion.replace('负责人确认', '负责人再次确认并补充风险');
  await writeFile(path.join(absPath, noteName), newer);
  await expect(page.getByTestId('workspace-conflict-diff')).not.toContainText(
    '再次确认',
  );
  page.once('dialog', (dialog) => dialog.accept());
  const secondRejected = page.waitForResponse(
    (response) =>
      response.url().endsWith('/files/save') && response.status() === 409,
  );
  await page
    .getByRole('button', { name: '将草稿覆盖所示版本', exact: true })
    .click();
  await secondRejected;
  await expect(page.getByTestId('workspace-conflict-diff')).toContainText(
    '再次确认',
  );
  expect(await readFile(path.join(absPath, noteName), 'utf8')).toBe(newer);
  page.once('dialog', (dialog) => dialog.accept());
  await page
    .getByRole('button', { name: '将草稿覆盖所示版本', exact: true })
    .click();
  await expect(page.getByTestId('workspace-document-status')).toContainText(
    '已保存',
  );
  expect(await readFile(path.join(absPath, noteName), 'utf8')).toBe(draft);
});

test('lost save receipt reconciles actual commit without overwriting later typing', async ({
  page,
  request,
}) => {
  const { absPath } = await setup(page, request);
  await replace(page, draft);
  let writes = 0;
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => (release = resolve));
  let committed = false;
  await page.route('**/files/save', async (route) => {
    writes++;
    const response = await route.fetch();
    expect(response.ok()).toBeTruthy();
    committed = true;
    await pending;
    await route.abort('failed');
  });
  await page.getByRole('button', { name: '保存文件', exact: true }).click();
  await expect.poll(() => committed).toBe(true);
  await expect(page.getByTestId('workspace-document-status')).toContainText(
    '正在保存',
  );
  const later = draft + '\n保存期间新增：请检查未知结果回执。';
  await replace(page, later);
  release();
  await expect(page.getByTestId('workspace-document-status')).toContainText(
    '未保存草稿',
  );
  await expect(page.getByTestId('workspace-monaco-editor')).toContainText(
    '保存期间新增',
  );
  expect(writes).toBe(1);
  expect(await readFile(path.join(absPath, noteName), 'utf8')).toBe(draft);
  await page.unroute('**/files/save');
  await page.getByRole('button', { name: '保存文件', exact: true }).click();
  await expect(page.getByTestId('workspace-document-status')).toContainText(
    '已保存',
  );
  expect(await readFile(path.join(absPath, noteName), 'utf8')).toBe(later);
});

test('mobile editor preserves draft and exposes save and close actions without overflow', async ({
  page,
  request,
}) => {
  const { absPath } = await setup(page, request, true);
  await replace(page, draft, true);
  await expect(editor(page, true)).toHaveValue(draft);
  await expect(page.getByTestId('workspace-document-status')).toContainText(
    '未保存草稿',
  );
  await screenshot(page, 'mobile-editor.png');
  await page
    .getByRole('button', { name: `关闭 ${noteName}`, exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: '保存并关闭', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: '继续编辑', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  await page.getByRole('button', { name: '保存文件', exact: true }).click();
  await expect(page.getByTestId('workspace-document-status')).toContainText(
    '已保存',
  );
  expect(await readFile(path.join(absPath, noteName), 'utf8')).toBe(draft);
});
