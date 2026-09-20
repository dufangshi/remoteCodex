import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

test('upstream editor and template preview stay usable inside device settings', async ({
  page,
}, testInfo) => {
  page.setDefaultTimeout(15000);
  let profiles: any[] = [];
  const active: Record<string, string> = {};
  await page.route('**/api/management/**', async (route) => {
    const p = new URL(route.request().url()).pathname;
    let result: unknown = {};
    if (p.endsWith('/supervisor'))
      result = { runningVersion: 'test', canUpdate: false };
    else if (p.endsWith('/harnesses')) result = [];
    else if (p.endsWith('/upstreams/models'))
      result = {
        models: [{ id: 'test-model', name: 'Test model' }],
        truncated: false,
      };
    else if (p.endsWith('/upstreams')) {
      if (route.request().method() === 'POST') {
        const { apiKey, ...saved } = route.request().postDataJSON();
        profiles = [{ ...saved, id: 'profile', hasApiKey: true }];
        result = profiles[0];
      } else result = { profiles, active, backups: [] };
    } else if (p.endsWith('/upstreams/profile')) {
      if (route.request().method() === 'DELETE') {
        profiles = [];
        delete active.codex;
      } else active.codex = 'profile';
    } else if (p.endsWith('/templates'))
      result = { harnesses: ['codex'], profiles: [] };
    await route.fulfill({ json: result });
  });
  await page.goto('/workspaces');
  await page.getByRole('button', { name: 'Open Navigation' }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Harnesses', exact: true }).click();
  await expect(
    page.getByRole('tab', { name: 'Harnesses', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: 'Add upstream', exact: true }).click();
  const editor = page.getByRole('dialog', {
    name: 'Add upstream',
    exact: true,
  });
  await expect(editor).toBeVisible();
  await editor.getByLabel('Name', { exact: true }).fill('Personal API');
  await editor.getByLabel('Base URL').fill('https://api.example.test/v1');
  await editor.getByLabel('API key').fill('synthetic-key');
  const model = editor.getByRole('combobox', { name: 'Model', exact: true });
  await expect(model).toBeEnabled();
  await model.selectOption('test-model');
  await editor.getByRole('button', { name: 'Save upstream' }).click();
  await expect(editor).toBeHidden();
  await expect(page.getByText('Personal API', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Use upstream', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Use upstream', exact: true }),
  ).toBeDisabled();
  await page.screenshot({
    path: testInfo.outputPath('settings-harnesses.png'),
  });
  await page
    .getByRole('button', { name: 'Delete Personal API', exact: true })
    .click();
  const deletion = page.getByRole('dialog', {
    name: 'Deactivate and delete upstream',
  });
  await expect(deletion).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(deletion).toBeHidden();
  await expect(page.getByTestId('settingsDialog')).toBeVisible();
  await page
    .getByRole('button', { name: 'Delete Personal API', exact: true })
    .click();
  await deletion
    .getByRole('button', { name: 'Delete upstream', exact: true })
    .click();
  await expect(page.getByText('Personal API', { exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'Grok Build', exact: true }).click();
  await expect(page.getByText('Personal API', { exact: true })).toBeHidden();
  await page.getByRole('tab', { name: 'Device', exact: true }).click();
  await page
    .getByRole('button', { name: 'Import template', exact: true })
    .click();
  const preview = page.getByRole('dialog', { name: 'Import device template' });
  await preview.getByRole('button', { name: 'Preview template' }).click();
  await expect(preview.getByText('Install if missing: codex')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('template-preview.png') });
  const box = await preview.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(
    page.viewportSize()!.width + 1,
  );
  await preview.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(preview).toBeHidden();
  await page
    .getByTestId('settingsDialog')
    .getByRole('button', { name: 'Close', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Open Navigation' }),
  ).toBeEnabled();
});

test('thread settings categories and nested dialogs stay usable on narrow screens', async ({
  page,
  request,
}, testInfo) => {
  const base = `http://127.0.0.1:${process.env.E2E_API_PORT ?? 8787}`;
  const absPath = path.resolve(process.env.E2E_WORKSPACE_ROOT!, randomUUID());
  await mkdir(absPath, { recursive: true });
  const workspace = await (
    await request.post(`${base}/api/workspaces`, {
      data: { absPath, label: 'Settings regression' },
    })
  ).json();
  const response = await request.post(`${base}/api/threads/start`, {
    data: {
      workspaceId: workspace.id,
      provider: 'acp',
      agentId: 'codex',
      model: 'ios-e2e-stream',
      approvalMode: 'yolo',
    },
  });
  expect(response.ok()).toBeTruthy();
  const thread = await response.json();
  await page.route('**/api/management/**', (route) =>
    route.fulfill({
      json: route.request().url().endsWith('harnesses')
        ? []
        : { profiles: [], active: {}, backups: [] },
    }),
  );
  await page.goto(`/threads/${thread.id}`);
  await page
    .getByRole('button', { name: 'Open settings', exact: true })
    .click();
  const settings = page.getByTestId('settings-dialog');
  await expect(
    settings.getByRole('tab', { name: 'Session', exact: true }),
  ).toBeVisible();
  await settings.getByRole('tab', { name: 'Harnesses', exact: true }).click();
  await settings
    .getByRole('button', { name: 'Add upstream', exact: true })
    .click();
  const editor = page.getByRole('dialog', {
    name: 'Add upstream',
    exact: true,
  });
  await expect(editor.getByLabel('Base URL')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(editor).toBeHidden();
  await expect(settings).toBeVisible();
  await settings.getByRole('tab', { name: 'Session', exact: true }).click();
  await expect(
    settings.getByText('Session details', { exact: true }),
  ).toBeVisible();
  await settings.getByRole('tab', { name: 'Harnesses', exact: true }).click();
  const box = await settings.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(
    page.viewportSize()!.width + 1,
  );
  expect(
    await settings
      .locator('.settings-panel')
      .evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
  ).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('thread-settings.png') });
  await page.route('**/api/agent-runtimes', async (route) => {
    const response = await route.fetch();
    const backends = await response.json();
    await route.fulfill({
      json: backends.map((b: any) =>
        b.provider !== 'codex'
          ? b
          : {
              ...b,
              capabilities: {
                ...b.capabilities,
                management: {
                  ...b.capabilities.management,
                  hostConfigFiles: true,
                },
              },
              managementSchema: {
                ...b.managementSchema,
                hostConfigFiles: [
                  {
                    name: 'config.toml',
                    label: 'Native configuration',
                    description: 'Codex settings',
                  },
                ],
                configArchives: false,
              },
            },
      ),
    });
  });
  let saved = '';
  await page.route(
    '**/api/config/providers/codex/files/config.toml',
    (route) => {
      if (route.request().method() === 'PATCH')
        saved = route.request().postDataJSON().content;
      return route.fulfill({
        json: {
          path: '/isolated/config.toml',
          exists: true,
          content: saved || '# original',
        },
      });
    },
  );
  await settings.getByRole('tab', { name: 'Advanced', exact: true }).click();
  await settings.getByRole('button', { name: /Native configuration/ }).click();
  const nativeEditor = page.getByRole('dialog', {
    name: 'config.toml',
    exact: true,
  });
  await nativeEditor.getByLabel('Edit config.toml').fill('# updated');
  await nativeEditor
    .getByRole('button', { name: 'Save file', exact: true })
    .click();
  await expect(nativeEditor.getByRole('status')).toHaveText('Saved');
  expect(saved).toBe('# updated');
  await page.keyboard.press('Escape');
  await expect(nativeEditor).toBeHidden();
  await expect(settings).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(settings).toBeHidden();
  await expect(page.getByRole('textbox', { name: 'Prompt' })).toBeEnabled();
});
