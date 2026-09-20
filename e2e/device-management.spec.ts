import { test, expect } from '@playwright/test';

test('upstream editor and template preview stay usable inside device settings', async ({
  page,
}, testInfo) => {
  page.setDefaultTimeout(15000);
  let profiles: any[] = [];
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
      } else result = { profiles, active: {}, backups: [] };
    } else if (p.endsWith('/templates'))
      result = { harnesses: ['codex'], profiles: [] };
    await route.fulfill({ json: result });
  });
  await page.goto('/workspaces');
  await page.getByRole('button', { name: 'Open Navigation' }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
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
    .getByRole('button', { name: 'Close Settings', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Open Navigation' }),
  ).toBeEnabled();
});
