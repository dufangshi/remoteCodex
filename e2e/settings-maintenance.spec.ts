import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { test, expect, type Locator } from '@playwright/test';
import { api, ensureWorkspaceDir } from './helpers';

const base = `http://127.0.0.1:${process.env.E2E_API_PORT ?? 8787}`;
async function inside(locator: Locator, width: number, height: number) {
  const box = (await locator.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(height + 1);
}

test('thread settings scroll, nested pricing modal, context and session details stay usable', async ({
  page,
}, info) => {
  await page.addInitScript(() =>
    localStorage.setItem('remote-codex-theme-mode', 'dark'),
  );
  const absPath = await ensureWorkspaceDir(
    path.resolve('.local/settings-e2e'),
    randomUUID(),
  );
  const ws = await api<any>(base, '/api/workspaces', {
    method: 'POST',
    body: JSON.stringify({ absPath, label: 'Settings regression' }),
  });
  const thread = await api<any>(base, '/api/threads/start', {
    method: 'POST',
    body: JSON.stringify({
      workspaceId: ws.id,
      provider: 'codex',
      model: 'default',
      approvalMode: 'yolo',
      title: 'A deliberately long thread title with a long session ID',
    }),
  });
  const installation = {
    version: '1.2.3',
    path: '/opt/node-v24/bin/codex',
    resolvedPath: '/opt/node-v24/lib/node_modules/@openai/codex/bin/codex.js',
    manager: 'npm',
    canUpdate: true,
    updateCommand:
      '/opt/node-v24/bin/npm install --global --prefix /opt/node-v24 @openai/codex@latest',
  };
  const harnesses = ['codex', 'claude', 'opencode', 'grok', 'gemini'].map(
    (id) => ({ id, name: id, base: installation, adapter: installation }),
  );
  const actions: unknown[] = [];
  await page.route('**/api/management/**', async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'POST')
      actions.push(route.request().postDataJSON());
    const data = url.pathname.endsWith('/harnesses')
      ? harnesses
      : url.pathname.endsWith('/supervisor')
        ? {
            runningVersion: '0.12.16',
            installedVersion: '0.12.16',
            canUpdate: true,
          }
        : { state: 'running' };
    await route.fulfill({ json: data });
  });
  try {
    await page.goto(`/threads/${thread.id}`);
    const size = page.viewportSize()!;
    await page.getByTitle('Session and usage', { exact: true }).click();
    const session = page.getByRole('dialog', { name: 'Session and usage' });
    await inside(session, size.width, size.height);
    expect(
      await session.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await page.getByTitle('Session and usage', { exact: true }).click();
    await page.getByRole('button', { name: /^Model and effort:/ }).click();
    await expect(
      page.getByLabel('Context usage', { exact: true }),
    ).toContainText(/context|used/);
    const menuStyle = await page
      .getByLabel('Context usage', { exact: true })
      .evaluate((el) => {
        const surface = el.closest('[data-composer-menu-surface]')!;
        const style = getComputedStyle(surface);
        return {
          background: style.backgroundColor,
          blur: style.backdropFilter,
        };
      });
    expect(menuStyle.blur).toContain('blur');
    expect(menuStyle.background).toMatch(/0\.88/);
    await page.screenshot({ path: info.outputPath('composer-context.png') });
    await page.keyboard.press('Escape');
    if (info.project.name === 'mobile-chromium')
      await page
        .getByRole('button', { name: 'Open rooms', exact: true })
        .click();
    await expect(page.locator('.thread-rooms-rail-header')).not.toContainText(
      ws.id,
    );
    await page
      .getByRole('button', { name: 'Open settings', exact: true })
      .click();
    const settings = page.getByTestId('settings-dialog');
    await settings.getByRole('button', { name: 'Global', exact: true }).click();
    await inside(settings, size.width, size.height);
    await settings
      .getByRole('heading', { name: 'Model pricing', exact: true })
      .scrollIntoViewIfNeeded();
    await settings
      .getByRole('button', { name: 'Add model', exact: true })
      .click();
    const modal = page.getByRole('dialog', { name: 'Add model', exact: true });
    await inside(modal, size.width, size.height);
    await modal.getByLabel('Pricing model ID').fill('settings-regression');
    await modal.getByLabel('Model aliases').fill('Settings Regression');
    await modal.getByRole('button', { name: 'Save prices' }).click();
    await expect(modal).toHaveCount(0);
    await expect(settings).toBeVisible();
    await settings
      .getByRole('heading', { name: 'Supervisor', exact: true })
      .scrollIntoViewIfNeeded();
    await expect(
      settings.getByText('Running 0.12.16', { exact: true }),
    ).toBeVisible();
    await expect(
      settings.getByRole('button', { name: 'Build and restart', exact: true }),
    ).toHaveCount(0);
    await settings.getByText('ACP agents', { exact: true }).click();
    await settings
      .getByRole('button', { name: 'Restart grok', exact: true })
      .scrollIntoViewIfNeeded();
    await settings
      .getByRole('button', { name: 'Restart grok', exact: true })
      .click();
    expect(actions).toContainEqual({ action: 'restart', component: 'base' });
    await page.screenshot({
      path: info.outputPath('settings-maintenance.png'),
    });
    expect(
      await settings.evaluate((el) => el.scrollHeight > el.clientHeight),
    ).toBe(true);
    await page.route('**/relay/auth/session', (route) =>
      route.fulfill({
        json: {
          authenticated: true,
          user: {
            id: 'fixture-owner',
            username: 'dufangshi',
            role: 'user',
            email: 'fixture@example.test',
          },
        },
      }),
    );
    await page.route('**/relay/api/**', (route) =>
      route.continue({
        url: route.request().url().replace('/relay/api/', '/api/'),
      }),
    );
    await page.evaluate(() =>
      localStorage.setItem('remote-codex-relay-mode', 'true'),
    );
    await page.goto(`/threads?workspaceId=${ws.id}`);
    const avatar = page.getByRole('button', {
      name: 'Relay account menu for dufangshi',
    });
    await expect(
      page.getByRole('heading', { name: 'Settings regression', exact: true }),
    ).toBeVisible();
    await expect(avatar).toBeVisible();
    await inside(avatar, size.width, size.height);
    await inside(page.locator('.recent-thread-card'), size.width, size.height);
    await expect(
      page.getByRole('button', { name: `Rename thread ${thread.title}` }),
    ).toBeVisible();
    const avatarBox = (await avatar.boundingBox())!;
    expect(avatarBox.x + avatarBox.width).toBeLessThanOrEqual(size.width - 8);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath('recent-thread-header.png'),
    });
  } finally {
    await api(base, `/api/threads/${thread.id}`, { method: 'DELETE' });
    await api(base, `/api/workspaces/${ws.id}`, { method: 'DELETE' });
  }
});
