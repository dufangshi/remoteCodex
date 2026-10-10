import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { waitForThread } from './helpers';

test.use({ actionTimeout: 15_000 });
const base = `http://127.0.0.1:${process.env.E2E_API_PORT ?? 8787}`;
const screenshots = process.env.TOUR_SCREENSHOT_DIR;

async function seed(request: APIRequestContext, name: string) {
  // Screenshot runs use a fresh database, so readable fixed folders are safe there.
  const root = path.resolve(process.env.E2E_WORKSPACE_ROOT!, screenshots ? name : `tour-${randomUUID().slice(0, 8)}`);
  const app = path.join(root, 'pockymoe-demo');
  const docs = path.join(root, 'docs-site');
  const files: Record<string, string> = {
    'README.md': '# Pockymoe demo\n\nA small sample project used by the guided tour.\n',
    'package.json': '{\n  "name": "pockymoe-demo",\n  "private": true\n}\n',
    'src/app.ts': 'export function greet(name: string) {\n  return `Hello, ${name}`;\n}\n',
    'src/utils/format.ts': 'export const formatDate = (date: Date) => date.toISOString();\n',
    'docs/guide.md': '# Guide\n',
  };
  for (const [name, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(app, name)), { recursive: true });
    await writeFile(path.join(app, name), content);
  }
  await mkdir(docs, { recursive: true });
  await writeFile(path.join(docs, 'index.md'), '# Docs\n');
  const workspace = async (absPath: string, label: string) =>
    (await (await request.post(`${base}/api/workspaces`, { data: { absPath, label } })).json()) as { id: string };
  const thread = async (workspaceId: string, title: string) => {
    const response = await request.post(`${base}/api/threads/start`, {
      data: { workspaceId, title, provider: 'codex', model: 'ios-e2e-stream', approvalMode: 'yolo' },
    });
    expect(response.ok()).toBeTruthy();
    const value = await response.json();
    return (value.id ?? value.thread.id) as string;
  };
  const demo = await workspace(app, 'pockymoe-demo');
  const site = await workspace(docs, 'docs-site');
  await thread(site.id, '更新文档首页');
  const peer = await thread(demo.id, '补充单元测试');
  const primary = await thread(demo.id, '重构登录流程');
  expect((await request.post(`${base}/api/threads/${primary}/prompt`, { data: { prompt: '总结一下 README 和 src 目录结构' } })).ok()).toBeTruthy();
  await waitForThread(base, primary, 30_000);
  return { app, demo, primary, peer };
}

async function snapshot(page: Page, name: string) {
  if (!screenshots) return;
  await mkdir(screenshots, { recursive: true });
  await page.screenshot({ path: path.join(screenshots, name), scale: 'css', animations: 'disabled' });
}

const tourCard = (page: Page) => page.locator('#pockymoe-tour-root .pm-tour-card');

async function expectInViewport(page: Page, locator: Locator) {
  const box = (await locator.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
}

/** Asserts the card for `id` is on screen, rings `target` (when given) and saves a screenshot. */
async function showStep(page: Page, id: string, name: string, target?: Locator, options: { prerequisite?: boolean } = {}) {
  const card = page.locator(`#pockymoe-tour-root .pm-tour-card[data-step="${id}"]`);
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute('data-placement', /.+/);
  await expectInViewport(page, card);
  const spotlight = page.locator('#pockymoe-tour-root .pm-tour-spotlight');
  if (options.prerequisite) await expect(card.locator('.pm-tour-prerequisite')).toBeVisible();
  else await expect(card.locator('.pm-tour-prerequisite')).toHaveCount(0);
  if (target) {
    await expect(spotlight).toBeVisible();
    await expect
      .poll(async () => {
        const ring = (await spotlight.boundingBox())!;
        const box = (await target.boundingBox())!;
        return Math.abs(ring.x + 6 - box.x) < 2 && Math.abs(ring.y + 6 - box.y) < 2 && Math.abs(ring.width - 12 - box.width) < 2;
      })
      .toBe(true);
  }
  await page.waitForTimeout(200); // let the 160 ms card/spotlight transition settle for the picture
  await snapshot(page, name);
  return card;
}

async function next(page: Page) {
  await tourCard(page).getByRole('button', { name: /^(下一步|完成)$/ }).click();
}

async function openChapter(page: Page, title: string) {
  const hub = page.locator('#pockymoe-tour-root .pm-tour-hub');
  await expect(hub).toBeVisible();
  await hub.getByRole('button', { name: new RegExp(title) }).click();
}

function prepare(page: Page) {
  return page.addInitScript(() => {
    localStorage.setItem('remote-codex.locale', 'zh-CN');
    localStorage.setItem('remote-codex-theme-mode', 'dark');
  });
}

test('desktop guided tour walks every chapter on the real controls', async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Desktop chapters');
  test.setTimeout(240_000);
  await prepare(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  const { app, primary } = await seed(request, 'desktop');
  const shot = (() => {
    let index = 0;
    return (name: string) => `desktop/${String(++index).padStart(2, '0')}-${name}.png`;
  })();

  // First run: a light prompt, never a forced tour.
  await page.goto('/workspaces');
  const welcome = page.locator('#pockymoe-tour-root .pm-tour-welcome');
  await expect(welcome).toBeVisible();
  await expectInViewport(page, welcome);
  await snapshot(page, shot('welcome'));
  await welcome.getByRole('button', { name: '开始教程' }).click();
  await expect(page.locator('#pockymoe-tour-root .pm-tour-hub')).toBeVisible();
  await snapshot(page, shot('hub'));

  // 1. Devices and workspaces (local mode).
  await openChapter(page, '设备与工作区');
  await showStep(page, 'local-device', shot('devices-local'), page.locator('header.product-topbar'));
  await next(page);
  const addWorkspace = page.getByRole('link', { name: '添加工作区' });
  await showStep(page, 'add-workspace', shot('devices-add-workspace'), addWorkspace);
  await addWorkspace.click(); // the real link; the tour follows
  await expect(page).toHaveURL(/\/workspaces\/new$/);
  await showStep(page, 'workspace-source', shot('devices-source'), page.locator('[aria-label="工作区来源"]'));
  await next(page);
  await showStep(page, 'workspace-form', shot('devices-submit'), page.locator('form:has(#workspace-target) button[type="submit"]'));
  await next(page);
  await expect(page).toHaveURL(/\/workspaces$/);
  await showStep(page, 'workspace-list', shot('devices-open-workspace'), page.locator('article.product-row').first());
  await next(page);

  // 2. Threads: import, then the thread controls once a thread is open.
  await openChapter(page, '对话');
  const importLink = page.getByRole('link', { name: '导入会话' });
  await showStep(page, 'import', shot('threads-import'), importLink);
  await importLink.click();
  await expect(page).toHaveURL(/\/threads\/import$/);
  await showStep(page, 'import-form', shot('threads-import-form'), page.locator('form:has(#backend-provider)'));
  await next(page);
  // No thread opened yet: the card explains it instead of pointing at something unrelated.
  const waiting = await showStep(page, 'history', shot('threads-open-a-thread-first'), undefined, { prerequisite: true });
  await expect(page.locator('#pockymoe-tour-root .pm-tour-spotlight')).toHaveCount(0);
  await waiting.getByRole('button', { name: '前往工作区' }).click();
  await page.getByRole('link', { name: /pockymoe-demo/ }).first().click();
  await expect(page).toHaveURL(new RegExp(`/threads/${primary}$`));
  await showStep(page, 'history', shot('threads-history'), page.locator('aside.matter-sidebar'));
  await next(page);
  await showStep(page, 'new-thread', shot('threads-new'), page.locator('button.matter-new-thread'));
  await next(page);
  const pane = page.getByTestId('primary-pane');
  await showStep(page, 'model', shot('threads-model'), pane.getByTestId('composer-model-label'));
  await next(page);
  await showStep(page, 'prompt', shot('threads-prompt'), pane.getByRole('textbox', { name: '提示词' }));
  await next(page);
  const send = pane.getByRole('button', { name: '发送提示词' });
  await showStep(page, 'send', shot('threads-send'), send);
  await next(page);
  // Idle: Stop is absent, so its place next to Send is marked as a prerequisite.
  await showStep(page, 'stop', shot('threads-stop-idle'), send, { prerequisite: true });
  expect((await request.post(`${base}/api/threads/${primary}/prompt`, { data: { prompt: 'inspect this repository' } })).ok()).toBeTruthy();
  const stop = pane.locator('button.thread-graph-composer-stop-button');
  await expect(stop).toBeVisible();
  await showStep(page, 'stop', shot('threads-stop-running'), stop);
  await stop.click();
  await expect(stop).toHaveCount(0);
  await next(page);
  await showStep(page, 'search', shot('threads-search'), page.locator('button.matter-search-trigger'));
  await next(page);

  // 3. Terminal.
  await openChapter(page, '终端');
  const rail = page.getByRole('navigation', { name: '工作区工具' });
  const terminalButton = rail.getByRole('button', { name: '终端', exact: true });
  await showStep(page, 'open', shot('terminal-open'), terminalButton);
  await terminalButton.click();
  const panel = page.getByTestId('workbench-bottom-panel');
  await expect(panel).toBeVisible();
  await showStep(page, 'resize', shot('terminal-resize'), page.getByTestId('workbench-panel-sash'));
  await next(page);
  await showStep(page, 'new', shot('terminal-new'), panel.getByTestId('terminal-new'));
  await panel.getByTestId('terminal-new').click();
  await next(page);
  await showStep(page, 'tabs', shot('terminal-tabs'), panel.getByTestId('terminal-tabs'));
  await next(page);
  await showStep(page, 'split', shot('terminal-split'), panel.getByTestId('terminal-split'));
  await panel.getByTestId('terminal-split').click();
  await expect(panel.locator('[data-testid="terminal-pane"]:visible')).toHaveCount(2);
  await snapshot(page, shot('terminal-split-done'));
  await next(page);
  await showStep(page, 'target', shot('terminal-target'), panel.getByTestId('terminal-target'));
  await next(page);
  await showStep(page, 'hide', shot('terminal-hide'), panel.getByTestId('workbench-close-tools'));
  await panel.getByTestId('workbench-close-tools').click();
  await expect(panel).toBeHidden();
  // A missing panel turns the step into a prerequisite pointing at the real toggle.
  await showStep(page, 'hide', shot('terminal-panel-hidden'), terminalButton, { prerequisite: true });
  await next(page);

  // 4. Split view.
  await openChapter(page, '双会话分屏');
  const splitTrigger = page.getByTestId('workbench-split-trigger');
  await showStep(page, 'trigger', shot('split-trigger'), splitTrigger);
  await splitTrigger.click();
  const picker = page.getByTestId('workbench-thread-picker');
  await expect(picker).toBeVisible();
  await showStep(page, 'picker', shot('split-picker'), picker);
  await picker.locator('button.workbench-thread-picker-row', { hasText: '补充单元测试' }).click();
  await next(page);
  const reference = page.getByTestId('reference-pane');
  await showStep(page, 'panes', shot('split-panes'), reference);
  await reference.getByRole('textbox', { name: '提示词' }).click();
  await expect(reference).toHaveAttribute('data-focused', 'true');
  await next(page);
  await showStep(page, 'focus', shot('split-focus'), page.getByTestId('make-primary'));
  await next(page);

  // 5. File browser with a real conflict in the isolated workspace.
  await openChapter(page, '文件浏览器');
  const explorerButton = rail.getByRole('button', { name: '切换文件浏览器' });
  await showStep(page, 'open', shot('files-open'), explorerButton);
  await explorerButton.click();
  const drawer = page.locator('aside.workbench-tool-drawer');
  const tree = drawer.getByRole('tree');
  await showStep(page, 'tree', shot('files-tree'), tree);
  await tree.getByRole('button', { name: '展开 src' }).click();
  await expect(tree.getByRole('treeitem', { name: 'app.ts' })).toBeVisible();
  await next(page);
  await showStep(page, 'filter', shot('files-filter'), drawer.getByRole('button', { name: '筛选工作区' }));
  await next(page);
  await showStep(page, 'new-file', shot('files-new'), drawer.getByRole('button', { name: '新建文件' }));
  await next(page);
  await tree.getByRole('button', { name: 'README.md', exact: true }).click();
  await expect(drawer.getByRole('tab', { name: 'README.md' })).toHaveAttribute('aria-selected', 'true');
  const edit = drawer.getByRole('button', { name: '编辑文件' });
  await showStep(page, 'edit', shot('files-edit'), edit);
  await edit.click();
  const editor = drawer.getByRole('textbox', { name: '工作区编辑器：README.md', exact: true });
  await editor.focus();
  await editor.press('ControlOrMeta+End');
  await page.keyboard.insertText('\nDraft line from the tutorial review.');
  await showStep(page, 'edit', shot('files-editing'), drawer.getByRole('button', { name: '保存文件' }));
  // An agent changes the file on disk meanwhile; saving must not overwrite it silently.
  await writeFile(path.join(app, 'README.md'), '# Pockymoe demo\n\nChanged on disk by an agent.\n');
  await drawer.getByRole('button', { name: '保存文件' }).click();
  const conflict = drawer.getByTestId('workspace-document-conflict');
  await expect(conflict).toBeVisible();
  await next(page);
  await showStep(page, 'save', shot('files-save-conflict'), conflict);
  await conflict.getByRole('button', { name: '保留草稿继续编辑' }).click();
  await next(page);
  await showStep(page, 'close', shot('files-close'), page.getByTestId('workbench-close-files'));
  await next(page);

  // 6. Automation (read only) and subagents.
  await openChapter(page, '自动化与子智能体');
  const automation = page.locator('button.matter-watches-toggle[aria-label="自动化"]');
  await showStep(page, 'automation', shot('more-automation'), automation);
  await next(page);
  await showStep(page, 'subagents', shot('more-subagents-absent'), automation, { prerequisite: true });
  await next(page);
  const hub = page.locator('#pockymoe-tour-root .pm-tour-hub');
  await expect(hub.locator('.pm-tour-chapter-index.is-done')).toHaveCount(6);
  await snapshot(page, shot('hub-all-seen'));

  // Escape closes; the rail and Settings entries reopen it at any time.
  await page.keyboard.press('Escape');
  await expect(hub).toHaveCount(0);
  await rail.getByRole('button', { name: '引导教程' }).click();
  await expect(hub).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '打开设置' }).first().click();
  const settings = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: '打开使用教程' }) });
  await expect(settings).toBeVisible();
  await snapshot(page, shot('settings-entry'));
  await settings.getByRole('button', { name: '打开使用教程' }).click();
  await expect(settings).toHaveCount(0);
  await expect(hub).toBeVisible();

  // Progress persists per account and survives reload; the welcome prompt stays dismissed.
  await page.reload();
  await expect(page.getByTestId('primary-pane')).toBeVisible();
  await expect(page.locator('#pockymoe-tour-root .pm-tour-welcome')).toHaveCount(0);
  const stored = await page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith('pockymoe.onboarding.v1:')));
  expect(stored).toHaveLength(1);
  expect(stored[0]![0]).toContain('local:');
  expect(JSON.parse(stored[0]![1]).completed).toHaveLength(6);
});

test('phone guided tour keeps cards on screen and teaches touch controls', async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium', 'Touch chapters');
  test.setTimeout(240_000);
  await prepare(page);
  const { primary } = await seed(request, 'phone');
  const shot = (() => {
    let index = 0;
    return (name: string) => `mobile/${String(++index).padStart(2, '0')}-${name}.png`;
  })();
  const topbar = page.locator('header.matter-topbar');

  await page.goto(`/threads/${primary}`);
  await expect(page.getByTestId('primary-pane')).toBeVisible();
  const welcome = page.locator('#pockymoe-tour-root .pm-tour-welcome');
  await expect(welcome).toBeVisible();
  await expectInViewport(page, welcome);
  await snapshot(page, shot('welcome'));
  // "Later" dismisses it; the navigation menu brings the tutorial back.
  await welcome.getByRole('button', { name: '稍后' }).tap();
  await expect(welcome).toHaveCount(0);
  await page.goto('/workspaces');
  await page.getByRole('button', { name: '打开导航' }).tap();
  await snapshot(page, shot('menu-entry'));
  await page.getByRole('navigation', { name: 'Supervisor 导航' }).getByRole('button', { name: '引导教程' }).tap();
  await expect(page.locator('#pockymoe-tour-root .pm-tour-hub')).toBeVisible();
  await snapshot(page, shot('hub'));

  await openChapter(page, '设备与工作区');
  await showStep(page, 'local-device', shot('devices-local'), page.locator('header.product-topbar'));
  await next(page);
  await showStep(page, 'add-workspace', shot('devices-add-workspace'), page.getByRole('link', { name: '添加工作区' }));
  await tourCard(page).getByRole('button', { name: '目录' }).tap();

  await openChapter(page, '对话');
  await next(page);
  await expect(page).toHaveURL(/\/threads\/import$/);
  await showStep(page, 'import-form', shot('threads-import-form'), page.locator('form:has(#backend-provider)'));
  await next(page);
  // The tour returns to the thread opened earlier.
  await expect(page).toHaveURL(new RegExp(`/threads/${primary}$`));
  const sidebarToggle = topbar.getByRole('button', { name: '切换快捷方式侧栏' });
  await showStep(page, 'history', shot('threads-history-toggle'), sidebarToggle);
  await sidebarToggle.tap();
  await showStep(page, 'history', shot('threads-history-open'), page.locator('aside.matter-sidebar.is-open'));
  await page.getByRole('button', { name: '关闭侧栏' }).tap();
  await next(page);
  await showStep(page, 'new-thread', shot('threads-new'), page.locator('button.matter-new-thread'));
  await next(page);
  const pane = page.getByTestId('primary-pane');
  await showStep(page, 'model', shot('threads-model'), pane.getByTestId('composer-model-label'));
  await next(page);
  await showStep(page, 'prompt', shot('threads-prompt'), pane.getByRole('textbox', { name: '提示词' }));
  await next(page);
  await showStep(page, 'send', shot('threads-send'), pane.getByRole('button', { name: '发送提示词' }));
  await tourCard(page).getByRole('button', { name: '目录' }).tap();

  await openChapter(page, '终端');
  const terminalButton = topbar.getByRole('button', { name: '终端', exact: true });
  await showStep(page, 'open', shot('terminal-open'), terminalButton);
  await terminalButton.tap();
  const panel = page.getByTestId('workbench-bottom-panel');
  await expect(panel).toBeVisible();
  await showStep(page, 'resize', shot('terminal-resize'), page.getByTestId('workbench-panel-sash'));
  await next(page);
  await showStep(page, 'new', shot('terminal-new'), panel.getByTestId('terminal-new'));
  await next(page);
  await showStep(page, 'tabs', shot('terminal-switcher'), panel.locator('button.terminal-switcher'));
  await next(page);
  await showStep(page, 'split', shot('terminal-more'), panel.getByTestId('terminal-more'));
  await next(page);
  const touch = panel.getByRole('toolbar', { name: '终端控件' });
  await showStep(page, 'touch', shot('terminal-touch-keys'), touch);
  // Direct input: tapping the terminal focuses xterm's own textarea (soft keyboard).
  await panel.locator('.shell-pane-host:visible').tap({ position: { x: 50, y: 30 } });
  await expect(panel.locator('.xterm-helper-textarea:visible')).toBeFocused();
  await page.keyboard.type('echo tour-touch');
  await page.keyboard.press('Enter');
  await expect(panel.locator('[data-testid="terminal-pane"]:visible .xterm-rows')).toContainText('tour-touch');
  await snapshot(page, shot('terminal-direct-input'));
  // Escape typed into the terminal belongs to the shell, not the tour.
  await page.keyboard.press('Escape');
  await expect(tourCard(page)).toBeVisible();
  await next(page);
  await showStep(page, 'hide', shot('terminal-hide'), panel.getByTestId('workbench-close-tools'));
  await panel.getByTestId('workbench-close-tools').tap();
  await next(page);

  await openChapter(page, '双会话分屏');
  const splitTrigger = page.getByTestId('workbench-split-trigger');
  await showStep(page, 'trigger', shot('split-trigger'), splitTrigger);
  await splitTrigger.tap();
  const picker = page.getByTestId('workbench-thread-picker');
  await showStep(page, 'picker', shot('split-picker'), picker);
  await picker.locator('button.workbench-thread-picker-row', { hasText: '补充单元测试' }).tap();
  await next(page);
  await showStep(page, 'panes', shot('split-mobile-views'), page.locator('nav.workbench-mobile-views'));
  await tourCard(page).getByRole('button', { name: '目录' }).tap();

  await openChapter(page, '文件浏览器');
  const explorerButton = topbar.getByRole('button', { name: '切换文件浏览器' });
  await showStep(page, 'open', shot('files-open'), explorerButton);
  await explorerButton.tap();
  const drawer = page.locator('aside.workbench-tool-drawer');
  await showStep(page, 'tree', shot('files-tree'), drawer.getByRole('tree'));
  await drawer.getByRole('tree').getByRole('treeitem', { name: 'README.md' }).tap();
  await next(page);
  await next(page);
  await next(page);
  await showStep(page, 'edit', shot('files-edit'), drawer.getByRole('button', { name: '编辑文件' }));
  await tourCard(page).getByRole('button', { name: '关闭教程' }).tap();
  await expect(tourCard(page)).toHaveCount(0);
});

test('relay guided tour adds devices through the real device page (mocked Relay data)', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Relay device chapter');
  await prepare(page);
  await page.addInitScript(() => localStorage.setItem('remote-codex-relay-mode', 'true'));
  await page.setViewportSize({ width: 1440, height: 900 });
  // Fake Relay account and devices only; no real Relay is contacted.
  const user = { id: 'tour-user', username: 'demo', email: 'demo@example.test', role: 'user', enabled: true, createdAt: '2026-10-01T00:00:00Z' };
  const now = new Date().toISOString();
  const device = (id: string, name: string, connected: boolean) => ({
    id, ownerUserId: user.id, name, token: null, tokenPreview: `rcd_${id.slice(0, 4)}…`, connected,
    connectedAt: connected ? now : null, lastHeartbeatAt: connected ? now : '2026-10-09T08:00:00Z', createdAt: '2026-10-01T00:00:00Z',
  });
  await page.route('**/relay/**', async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === '/relay/auth/session') return route.fulfill({ json: { authenticated: true, user, registrationEnabled: false } });
    if (pathname.endsWith('/presence')) return route.fulfill({ json: { connected: pathname.includes('mac-studio') } });
    if (pathname === '/relay/portal') {
      return route.fulfill({ json: { user, devices: [device('mac-studio', 'Mac Studio', true), device('win-laptop', 'Windows Laptop', false)], sharedWithMe: [], sharedByMe: [] } });
    }
    return route.fulfill({ status: 404, json: { error: 'not mocked' } });
  });
  const shot = (() => {
    let index = 0;
    return (name: string) => `relay/${String(++index).padStart(2, '0')}-${name}.png`;
  })();

  await page.goto('/relay-devices');
  const welcome = page.locator('#pockymoe-tour-root .pm-tour-welcome');
  await expect(welcome).toBeVisible();
  await welcome.getByRole('button', { name: '稍后' }).click();
  const launcher = page.locator('header.product-topbar').getByRole('button', {name:'引导教程',exact:true});
  await expect(launcher).toBeVisible();
  await expect(launcher.locator('svg')).toBeVisible();
  await expect(launcher).toHaveText('引导教程');
  await snapshot(page, shot('topbar-tutorial-entry'));
  await launcher.click();
  await openChapter(page, '设备与工作区');
  const add = page.locator('button[aria-controls="add-device-form"]');
  await showStep(page, 'relay-add-device', shot('devices-add-device'), add);
  await add.click();
  const form = page.locator('#add-device-form');
  await showStep(page, 'relay-device-form', shot('devices-token-form'), form);
  await next(page);
  await showStep(page, 'relay-device-list', shot('devices-connect'), page.locator('section[aria-labelledby="devices-heading"] article').first());
  await next(page);
  // Workspaces belong to a device: without one the card points at an online device's Connect button.
  const connect = page.locator('section[aria-labelledby="devices-heading"] article').filter({ hasText: 'Mac Studio' }).getByRole('button', { name: '连接' });
  await expect(connect).toBeEnabled();
  await showStep(page, 'add-workspace', shot('devices-connect-first'), connect, { prerequisite: true });
});
