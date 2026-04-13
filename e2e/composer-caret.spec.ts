import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';

const workspaceRoot = '/home/u/dev/remoteCodex/.local/e2e-playwright';

async function ensureWorkspaceDir(name: string) {
  const dir = path.join(workspaceRoot, name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'README.md'), `# ${name}\n`);
  return dir;
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
    throw new Error(`Unable to find workspace option containing "${labelText}".`);
  }

  await page.getByLabel('Workspace').selectOption(value);
}

test.describe('Composer caret behavior', () => {
  test('keeps typed text after a pasted desktop image token', async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'desktop-chromium',
      'Caret regression only needs desktop coverage.',
    );

    const workspaceName = `caret-${randomUUID().slice(0, 8)}`;
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

    const editor = page.getByRole('textbox', { name: 'Prompt' });
    await editor.click();

    await editor.evaluate((node) => {
      const editorElement = node as HTMLDivElement;
      const imageBytes = Uint8Array.from([
        137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
        0, 0, 0, 1, 0, 0, 0, 1, 8, 4, 0, 0, 0, 181, 28, 12,
        2, 0, 0, 0, 11, 73, 68, 65, 84, 120, 218, 99, 252, 255, 31, 0,
        3, 3, 2, 0, 239, 239, 95, 178, 0, 0, 0, 0, 73, 69, 78, 68,
        174, 66, 96, 130,
      ]);
      const file = new File([imageBytes], 'paste.png', { type: 'image/png' });
      const pasteEvent = new Event('paste', {
        bubbles: true,
        cancelable: true,
      }) as Event & {
        clipboardData?: {
          items: Array<{ kind: string; getAsFile: () => File }>;
          files: File[];
        };
      };
      Object.defineProperty(pasteEvent, 'clipboardData', {
        value: {
          items: [
            {
              kind: 'file',
              getAsFile: () => file,
            },
          ],
          files: [file],
        },
      });
      editorElement.dispatchEvent(pasteEvent);
    });

    await expect(page.getByAltText('paste.png')).toBeVisible();
    await page.keyboard.type('A');

    const serializedPrompt = await editor.evaluate((node) =>
      Array.from(node.childNodes)
        .map((child) =>
          child instanceof HTMLElement && child.dataset.placeholder
            ? child.dataset.placeholder
            : child.textContent ?? '',
        )
        .join(''),
    );

    expect(serializedPrompt.startsWith('[PHOTO paste.png]A')).toBe(true);
  });
});
