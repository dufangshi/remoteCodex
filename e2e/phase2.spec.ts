import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';

const workspaceRoot = '/Users/fonsh/remoteCodex/.local/e2e';

async function ensureWorkspaceDir(name: string) {
  const dir = path.join(workspaceRoot, name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'README.md'), `# ${name}\n`);
  return dir;
}

function makeWorkspaceName(prefix: string) {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

async function selectWorkspaceByLabelText(page: Page, labelText: string) {
  const value = await page
    .getByLabel('Workspace')
    .evaluate((element, expected) => {
      const select = element as HTMLSelectElement;
      const option = [...select.options].find((entry) =>
        entry.text.includes(expected as string),
      );
      return option?.value ?? '';
    }, labelText);

  if (!value) {
    throw new Error(
      `Unable to find workspace option containing "${labelText}".`,
    );
  }

  await page.getByLabel('Workspace').selectOption(value);
}

test.describe('Phase 2 acceptance', () => {
  test('can create a workspace, create a thread, and receive a hello response', async ({
    page,
  }) => {
    const workspaceName = makeWorkspaceName('phase2-e2e');
    const workspacePath = await ensureWorkspaceDir(workspaceName);

    await page.goto('/workspaces/new');
    await page.getByLabel('Absolute path').fill(workspacePath);
    await page.getByLabel('Display label').fill(workspaceName);
    await page.getByRole('button', { name: 'Create Workspace' }).click();

    await expect(page).toHaveURL(/\/workspaces\/.+/);
    await expect(
      page.getByRole('heading', { level: 2, name: workspaceName }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /README\.md/ }).first(),
    ).toBeVisible();

    await page.goto('/threads/new');
    await selectWorkspaceByLabelText(page, workspaceName);
    await page.getByLabel('Title').fill(`${workspaceName} thread`);
    await page.getByRole('button', { name: 'Create Thread' }).click();

    await expect(page).toHaveURL(/\/threads\/.+/);
    await expect(
      page.getByRole('heading', { level: 2, name: `${workspaceName} thread` }),
    ).toBeVisible();

    await page
      .getByPlaceholder('Ask Codex to inspect, modify, or explain code...')
      .fill('hello, reply me with hello');
    await page.getByRole('button', { name: 'Send Prompt' }).click();

    await expect(page.getByText('hello', { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText(/completed/i)).toBeVisible({ timeout: 30_000 });
  });

  test('can interrupt a running turn and return to an interactive state', async ({
    page,
  }) => {
    const workspaceName = makeWorkspaceName('phase2-interrupt');
    const workspacePath = await ensureWorkspaceDir(workspaceName);

    await page.goto('/workspaces/new');
    await page.getByLabel('Absolute path').fill(workspacePath);
    await page.getByLabel('Display label').fill(workspaceName);
    await page.getByRole('button', { name: 'Create Workspace' }).click();

    await expect(page).toHaveURL(/\/workspaces\/.+/);

    await page.goto('/threads/new');
    await selectWorkspaceByLabelText(page, workspaceName);
    await page.getByLabel('Title').fill(`${workspaceName} thread`);
    await page.getByRole('button', { name: 'Create Thread' }).click();

    await expect(page).toHaveURL(/\/threads\/.+/);

    await page
      .getByPlaceholder('Ask Codex to inspect, modify, or explain code...')
      .fill(
        'Inspect this repository in depth, enumerate every top-level source file group, and write a detailed multi-section report before giving a final summary.',
      );
    await page.getByRole('button', { name: 'Send Prompt' }).click();
    await expect(
      page.getByRole('button', { name: 'Stop Current Turn' }),
    ).toBeEnabled({
      timeout: 10_000,
    });

    await page.getByRole('button', { name: 'Stop Current Turn' }).click();

    await expect(page.getByText(/interrupted/i).first()).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole('button', { name: 'Send Prompt' })).toBeEnabled(
      {
        timeout: 20_000,
      },
    );
  });

  test('uses a collapsible top sidebar on mobile thread detail', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'mobile-chromium',
      'This layout check only applies to the mobile project.',
    );

    const workspaceName = makeWorkspaceName('phase2-mobile');
    const workspacePath = await ensureWorkspaceDir(workspaceName);

    await page.goto('/workspaces/new');
    await page.getByLabel('Absolute path').fill(workspacePath);
    await page.getByLabel('Display label').fill(workspaceName);
    await page.getByRole('button', { name: 'Create Workspace' }).click();

    await expect(page).toHaveURL(/\/workspaces\/.+/);

    await page.goto('/threads/new');
    await selectWorkspaceByLabelText(page, workspaceName);
    await page.getByLabel('Title').fill(`${workspaceName} thread`);
    await page.getByRole('button', { name: 'Create Thread' }).click();

    await expect(page).toHaveURL(/\/threads\/.+/);
    const threadNavButton = page.locator('button[aria-expanded]').nth(1);
    await expect(threadNavButton).toHaveAttribute('aria-expanded', 'false');

    await threadNavButton.click();

    await expect(threadNavButton).toHaveAttribute('aria-expanded', 'true');
    const mobileSidebar = page.locator('aside').first();
    await expect(mobileSidebar.getByText('Thread List')).toBeVisible();
    await expect(
      mobileSidebar.getByRole('button', { name: /Thread Meta/i }),
    ).toBeVisible();
  });
});
