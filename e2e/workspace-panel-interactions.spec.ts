import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const base = `http://127.0.0.1:${process.env.E2E_API_PORT ?? 8787}`;

test('workspace drawer resizes persistently and compact actions preserve folder navigation', async ({ page, request }, testInfo) => {
  const mobile = testInfo.project.name === 'mobile-chromium';
  await page.addInitScript(() => {
    localStorage.setItem('remote-codex.locale', 'en');
    localStorage.setItem('remote-codex-theme-mode', 'dark');
    // Set a baseline only on first navigation; reload must restore the new width.
    if (!localStorage.getItem('remote-codex.explorer-width')) localStorage.setItem('remote-codex.explorer-width', '560');
  });
  if (!mobile) await page.setViewportSize({ width: 1440, height: 1000 });
  const absPath = path.resolve(process.env.E2E_WORKSPACE_ROOT!, `panel-interactions-${randomUUID()}`);
  await mkdir(path.join(absPath, 'docs'), { recursive: true });
  await writeFile(path.join(absPath, 'docs', 'readme.md'), '# Workspace actions\n');
  const wsResponse = await request.post(`${base}/api/workspaces`, { data: { absPath, label: 'Workspace review' } });
  expect(wsResponse.ok()).toBeTruthy();
  const workspace = await wsResponse.json();
  const response = await request.post(`${base}/api/threads/start`, { data: { workspaceId: workspace.id, title: 'Workspace interaction review', provider: 'codex', model: 'ios-e2e-stream', approvalMode: 'yolo' } });
  expect(response.ok()).toBeTruthy();
  const thread = await response.json();
  const id = thread.id ?? thread.thread.id;
  const detail = await (await request.get(`${base}/api/threads/${id}`)).json();
  const content = 'Files are in `docs/`.\n\nOpen docs/readme.md or `' + absPath + '/docs/readme.md:1`.\n\nMissing: `docs/missing.txt`.\n\n```sh\ncat docs/readme.md\n```';
  await page.route(`**/api/threads/${id}?**`, route => route.fulfill({ json: {
    ...detail, totalTurnCount: 1, turns: [{ id: 'paths-turn', status: 'completed', startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), items: [
      { id: 'paths-prompt', kind: 'userMessage', text: 'Show workspace paths' },
      { id: 'paths-reply', kind: 'agentMessage', text: content },
    ] }],
  } }));
  const openFiles = async () => {
    if (mobile) {
      await page.getByRole('button', { name: 'Toggle shortcuts sidebar', exact: true }).click();
      await page.getByRole('button', { name: 'Open Explorer', exact: true }).click();
    } else {
      await page.getByRole('navigation', { name: 'Workspace tools', exact: true }).getByRole('button', { name: 'Toggle Explorer', exact: true }).click();
    }
  };
  await page.goto(`/threads/${id}`);
  const directoryLink = page.getByRole('link', { name: 'docs/', exact: true });
  await expect(directoryLink).toBeVisible();
  await expect(page.getByRole('link', { name: 'docs/missing.txt', exact: true })).toHaveCount(0);
  await expect(page.locator('pre a')).toHaveCount(0);
  await openFiles();
  const drawer = page.locator('.workbench-tool-drawer').filter({ has: page.getByTestId('workbench-close-files') });
  await expect(drawer).toBeVisible();
  const chat = page.getByTestId('primary-pane');
  const assertNoOverlay = async () => {
    const chatBox = (await chat.boundingBox())!, drawerBox = (await drawer.boundingBox())!;
    expect(chatBox.x + chatBox.width).toBeLessThanOrEqual(drawerBox.x + 1);
    const composer = chat.getByRole('textbox', { name: 'Prompt', exact: true });
    await expect(composer).toBeVisible();
    const composerBox = (await composer.boundingBox())!;
    expect(composerBox.x + composerBox.width).toBeLessThanOrEqual(drawerBox.x + 1);
    const sendBox = (await chat.getByRole('button', { name: 'Send Prompt', exact: true }).boundingBox())!;
    expect(sendBox.x + sendBox.width).toBeLessThanOrEqual(drawerBox.x + 1);
  };
  const separator = drawer.getByRole('separator', { name: 'Resize Explorer', exact: true });
  if (!mobile) {
    await assertNoOverlay();
    const chatBefore = (await chat.boundingBox())!.width;
    const before = (await drawer.boundingBox())!.width;
    const handle = (await separator.boundingBox())!;
    await page.mouse.move(handle.x + handle.width / 2, handle.y + 80);
    await page.mouse.down();
    await page.mouse.move(handle.x - 160, handle.y + 80, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => (await drawer.boundingBox())!.width).toBeGreaterThan(before + 145);
    expect((await chat.boundingBox())!.width).toBeLessThan(chatBefore - 145);
    await assertNoOverlay();
    const dragged = (await drawer.boundingBox())!.width;
    await separator.focus();
    await page.keyboard.press('ArrowLeft');
    await expect.poll(async () => (await drawer.boundingBox())!.width).toBeCloseTo(dragged + 24, 0);
    const saved = (await drawer.boundingBox())!.width;
    await page.getByTestId('workbench-close-files').click();
    await expect(page.getByTestId('workbench-panels')).toHaveAttribute('data-mode', 'focus');
    await page.reload();
    await openFiles();
    await expect(drawer).toBeVisible();
    await expect.poll(async () => (await drawer.boundingBox())!.width).toBeCloseTo(saved, 0);
    await assertNoOverlay();
  } else {
    await expect(separator).toHaveCount(0);
    expect((await drawer.boundingBox())!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  }
  const docs = page.getByRole('treeitem', { name: 'docs', exact: true });
  await expect(docs).toBeVisible();
  if (!mobile) await docs.hover();
  const actions = docs.locator('.thread-graph-tree-actions');
  const label = docs.getByRole('button', { name: 'docs', exact: true });
  const labelBox = (await label.boundingBox())!, actionsBox = (await actions.boundingBox())!;
  expect(labelBox.x + labelBox.width).toBeLessThanOrEqual(actionsBox.x + 1);
  await expect(docs.getByRole('button', { name: 'Download docs', exact: true })).toHaveCount(0);
  await docs.getByRole('button', { name: 'More actions for docs', exact: true }).click();
  const menu = page.getByRole('menu', { name: 'Actions for docs', exact: true });
  await expect(menu.getByRole('menuitem', { name: 'Download file', exact: true })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Copy relative path for docs', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  if (mobile) await label.click();
  else await label.dblclick();
  await expect(docs).toHaveAttribute('aria-expanded', 'true');
  const file = page.getByRole('treeitem', { name: 'readme.md', exact: true });
  await expect(file).toBeVisible();
  if (!mobile) await file.hover();
  await file.getByRole('button', { name: 'More actions for readme.md', exact: true }).click();
  const fileMenu = page.getByRole('menu', { name: 'Actions for readme.md', exact: true });
  const downloaded = page.waitForEvent('download');
  await fileMenu.getByRole('menuitem', { name: 'Download file', exact: true }).click();
  expect((await downloaded).suggestedFilename()).toBe('readme.md');
  await expect(fileMenu).not.toBeVisible();
  await page.getByTestId('workbench-close-files').click();
  await directoryLink.click();
  await expect(drawer).toBeVisible();
  await expect(docs).toHaveAttribute('aria-selected', 'true');
  await expect(docs).toHaveAttribute('aria-expanded', 'true');
  await expect(file).toBeVisible();
  await page.getByTestId('workbench-close-files').click();
  await page.getByRole('link', { name: `${absPath}/docs/readme.md:1`, exact: true }).click();
  await expect(drawer).toBeVisible();
  await expect(page.getByRole('tab', { name: 'readme.md', exact: true })).toBeVisible();
  if (mobile) await page.getByRole('button', { name: 'Back to files', exact: true }).click();
  const artifactRoot = process.env.E2E_WORKSPACE_PANEL_SCREENSHOTS;
  if (artifactRoot) {
    await mkdir(artifactRoot, { recursive: true });
    if (!mobile) await docs.hover();
    await page.screenshot({ path: path.join(artifactRoot, `${testInfo.project.name}-workspace.png`), scale: 'css' });
  }
});

test('virtualized file tree keeps every row after the Files drawer is hidden and shown again', async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Drawer visibility regression');
  await page.addInitScript(() => localStorage.setItem('remote-codex.locale', 'en'));
  await page.setViewportSize({ width: 1440, height: 900 });
  const absPath = path.resolve(process.env.E2E_WORKSPACE_ROOT!, `tree-visibility-${randomUUID()}`);
  for (const folder of ['alpha', 'beta', 'gamma']) {
    await mkdir(path.join(absPath, folder), { recursive: true });
    for (let index = 0; index < 30; index++) await writeFile(path.join(absPath, folder, `${folder}-${String(index).padStart(2, '0')}.md`), `# ${folder} ${index}\n`);
  }
  const workspace = await (await request.post(`${base}/api/workspaces`, { data: { absPath, label: 'Tree visibility' } })).json();
  const started = await (await request.post(`${base}/api/threads/start`, { data: { workspaceId: workspace.id, title: 'Tree visibility', provider: 'codex', model: 'ios-e2e-stream', approvalMode: 'yolo' } })).json();
  await page.goto(`/threads/${started.id ?? started.thread.id}`);
  const toggleFiles = page.getByRole('navigation', { name: 'Workspace tools', exact: true }).getByRole('button', { name: 'Toggle Explorer', exact: true });
  await toggleFiles.click();
  const tree = page.getByRole('tree', { name: 'Workspace files' });
  for (const folder of ['gamma', 'beta', 'alpha']) {
    const row = tree.getByRole('treeitem', { name: folder, exact: true });
    await row.getByRole('button', { name: folder, exact: true }).dblclick();
    await expect(row).toHaveAttribute('aria-expanded', 'true');
  }
  const layout = () => tree.evaluate(element => {
    const box = element.getBoundingClientRect();
    const rows = [...element.querySelectorAll<HTMLElement>('[data-index]')].map(row => ({ index: Number(row.dataset.index), top: row.getBoundingClientRect().top - box.top, height: row.getBoundingClientRect().height }));
    const visible = rows.filter(row => row.top + row.height > 0 && row.top < element.clientHeight).sort((a, b) => a.top - b.top);
    return {
      scrollTop: Math.round(element.scrollTop),
      scrollHeight: element.scrollHeight,
      zeroHeightRows: rows.filter(row => row.height === 0).length,
      firstVisibleTop: Math.round(visible[0]?.top ?? 999),
      gaps: visible.slice(1).filter((row, index) => row.top - (visible[index]!.top + visible[index]!.height) > 1).length,
      contiguous: visible.every((row, index) => index === 0 || row.index === visible[index - 1]!.index + 1),
    };
  });
  await tree.hover();
  await page.mouse.wheel(0, 1200);
  await expect.poll(async () => (await layout()).scrollTop).toBeGreaterThan(1000);
  const scrolled = await layout();
  // Hidden drawers measure 0px rows; they must not collapse the tree afterwards.
  await page.getByTestId('workbench-close-files').click();
  await expect(tree).toBeHidden();
  await toggleFiles.click();
  await expect(tree).toBeVisible();
  await expect.poll(layout).toMatchObject({ scrollTop: scrolled.scrollTop, scrollHeight: scrolled.scrollHeight, zeroHeightRows: 0, gaps: 0, contiguous: true });
  expect((await layout()).firstVisibleTop).toBeLessThanOrEqual(0);
  await tree.hover();
  await page.mouse.wheel(0, -5000);
  await expect.poll(async () => (await layout()).scrollTop).toBe(0);
  await expect(tree.getByRole('treeitem', { name: 'alpha', exact: true })).toBeInViewport();
  await expect.poll(layout).toMatchObject({ zeroHeightRows: 0, gaps: 0, contiguous: true });
});
