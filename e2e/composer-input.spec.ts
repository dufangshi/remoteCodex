import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

test('plain-text composition and dictation replacements preserve inline attachment order and native text nodes', async ({ page, request }) => {
  const base = `http://127.0.0.1:${process.env.E2E_API_PORT ?? 8787}`;
  const absPath = path.resolve(process.env.E2E_WORKSPACE_ROOT!, randomUUID());
  await mkdir(absPath, { recursive: true });
  const workspace = await (await request.post(`${base}/api/workspaces`, { data: { absPath, label: 'Dictation regression' } })).json();
  const response = await request.post(`${base}/api/threads/start`, { data: { workspaceId: workspace.id, title: 'Dictation regression', provider: 'acp', agentId: 'codex', model: 'ios-e2e-stream', approvalMode: 'yolo' } });
  expect(response.ok()).toBeTruthy();
  const value = await response.json();
  const id = value.id ?? value.thread.id;
  await page.goto(`/threads/${id}`);
  const editor = page.getByRole('textbox', { name: 'Prompt', exact: true });
  await expect(editor).toHaveAttribute('contenteditable', 'plaintext-only');
  await page.clock.install();
  await editor.fill('前文');
  await editor.press('End');
  await page.locator('input[type=file][accept]').setInputFiles({ name: 'order.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQ1sAAAAASUVORK5CYII=', 'base64') });
  await expect(editor.locator('[data-segment-type="attachment"] img')).toBeVisible();
  await editor.evaluate(element => {
    element.focus();
    const span = document.createElement('span');
    // Some dictation engines wrap their provisional replacement in a span.
    span.style.color = 'inherit';
    const text = document.createTextNode('初稿 后文');
    span.append(text); element.append(span);
    (window as Window & { dictationText?: Text }).dictationText = text;
    const selection = window.getSelection()!;
    selection.setPosition(text, 2);
    element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', data: '初稿', isComposing: true }));
  });
  await editor.evaluate(element => element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, isComposing: true })));
  await expect(editor).toContainText('初稿 后文');
  expect((await (await request.get(`${base}/api/threads/${id}`)).json()).turns).toHaveLength(0);
  await editor.evaluate(element => element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
  await expect(editor).toContainText('初稿 后文');
  for (const phrase of ['听写第一版', '听写修正完成']) {
    await editor.evaluate((element, phrase) => {
      const text = (window as Window & { dictationText?: Text }).dictationText!;
      expectLiveNode(text, element);
      text.data = `${phrase} 后文`;
      window.getSelection()!.setPosition(text, phrase.length);
      element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText', data: phrase }));
      function expectLiveNode(text: Text, editor: Element) { if (!editor.contains(text)) throw new Error('Native dictation node was replaced'); }
    }, phrase);
    await expect(editor).toContainText(`${phrase} 后文`);
    // Wait for the parent draft persistence echo, the old race boundary.
    await page.clock.runFor(250);
    await expect.poll(() => editor.evaluate(element => element.contains((window as Window & { dictationText?: Text }).dictationText!))).toBe(true);
  }
  await page.keyboard.insertText('追加');
  await expect(editor).toContainText('听写修正完成追加 后文');
  await editor.press('Control+b');
  expect(await editor.locator('b,strong').count()).toBe(0);
  // Insert a file at the caret inside the dictation wrapper, before the suffix.
  await page.locator('input[type=file]:not([accept])').setInputFiles({ name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('file-order-test') });
  await expect(editor.locator('[data-segment-type="attachment"]')).toHaveCount(2);
  await editor.press('End');
  await editor.press('Shift+Enter');
  await page.keyboard.insertText('第二行');
  await page.getByRole('button', { name: 'Send Prompt', exact: true }).click();
  await expect(editor).toHaveText('');
  await expect.poll(async () => (await (await request.get(`${base}/api/threads/${id}`)).json()).turns.length).toBe(1);
  const detail = await (await request.get(`${base}/api/threads/${id}`)).json();
  const prompt = detail.turns[0].items.find((item: { kind: string }) => item.kind === 'userMessage').text as string;
  // Multipart FormData normalizes line endings to CRLF on the wire.
  expect(prompt).toMatch(/^前文\s*\[PHOTO [^\]]+\]\s*听写修正完成追加\s*\[FILE [^\]]+\] 后文\r?\n第二行$/);
  expect(prompt).not.toContain('初稿');
  expect(prompt).not.toContain('第一版');
});
