import { test, expect } from '@playwright/test';
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const base = `http://127.0.0.1:${process.env.E2E_API_PORT ?? 8787}`;
test('Explorer shortcut downloads, copies both paths, renames and confirms deletion', async ({
  page,
  context,
  request,
}, testInfo) => {
  const absPath = path.resolve(
    process.env.E2E_WORKSPACE_ROOT!,
    `files-${randomUUID()}`,
  );
  await mkdir(absPath, { recursive: true });
  await writeFile(path.join(absPath, 'notes.txt'), 'explorer file payload');
  const ws = await (
    await request.post(base + '/api/workspaces', {
      data: { absPath, label: 'Explorer actions' },
    })
  ).json();
  const t = await (
    await request.post(base + '/api/threads/start', {
      data: {
        workspaceId: ws.id,
        title: 'Explorer actions',
        provider: 'codex',
        model: 'ios-e2e-stream',
        approvalMode: 'yolo',
      },
    })
  ).json();
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(`/threads/${t.id ?? t.thread.id}`);
  if (testInfo.project.name === 'mobile-chromium') {
    await page
      .getByRole('button', { name: 'Toggle shortcuts sidebar', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Open Explorer', exact: true })
      .click();
  } else
    await page
      .getByRole('navigation', { name: 'Workspace tools' })
      .getByRole('button', { name: 'Toggle Explorer' })
      .click();
  await expect(
    page.getByRole('complementary', { name: 'Explorer', exact: true }),
  ).toBeVisible();
  if (testInfo.project.name === 'desktop-chromium') {
    const resize = page.getByRole('separator', { name: 'Resize Explorer' });
    await resize.focus();
    for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowLeft');
  }
  const row = page.getByRole('treeitem', { name: 'notes.txt', exact: true });
  await expect(row).toBeVisible();
  await row.hover();
  await row
    .getByRole('button', { name: 'Copy relative path for notes.txt' })
    .click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'notes.txt',
  );
  await row
    .getByRole('button', { name: 'Copy absolute path for notes.txt' })
    .click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    path.join(absPath, 'notes.txt'),
  );
  const download = page.waitForEvent('download');
  await row.getByRole('button', { name: 'Download notes.txt' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('notes.txt');
  await file.saveAs(testInfo.outputPath('notes.txt'));
  expect(await readFile(testInfo.outputPath('notes.txt'), 'utf8')).toBe(
    'explorer file payload',
  );
  await row.getByRole('button', { name: 'More actions for notes.txt' }).click();
  await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
  const rename = page.getByRole('dialog', { name: 'Rename file', exact: true });
  await rename.getByRole('textbox', { name: 'Name' }).fill('renamed.txt');
  await rename.getByRole('button', { name: 'Save', exact: true }).click();
  const renamed = page.getByRole('treeitem', {
    name: 'renamed.txt',
    exact: true,
  });
  await expect(renamed).toBeVisible();
  expect(await readFile(path.join(absPath, 'renamed.txt'), 'utf8')).toBe(
    'explorer file payload',
  );
  await renamed.hover();
  await renamed
    .getByRole('button', { name: 'More actions for renamed.txt' })
    .click();
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  const confirm = page.getByRole('dialog', {
    name: 'Delete file?',
    exact: true,
  });
  await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(renamed).toBeVisible();
  await renamed.hover();
  await renamed
    .getByRole('button', { name: 'More actions for renamed.txt' })
    .click();
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  await confirm.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(renamed).toHaveCount(0);
  await expect
    .poll(async () => {
      try {
        await access(path.join(absPath, 'renamed.txt'));
        return true;
      } catch {
        return false;
      }
    })
    .toBe(false);
  await page.screenshot({ path: testInfo.outputPath('explorer-actions.png') });
});
