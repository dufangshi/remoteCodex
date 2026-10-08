import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import path from 'node:path';

const base = `http://127.0.0.1:${process.env.E2E_API_PORT ?? 8787}`;
test.use({ actionTimeout: 15_000 });
const model = (label: string) => `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="${label}" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1"><mxGeometry x="40" y="40" width="180" height="80" as="geometry"/></mxCell></root></mxGraphModel>`;

test('Explorer renders complete draw.io files, compressed pages and source on desktop and mobile', async ({ page, request }, testInfo) => {
  const absPath = path.resolve(process.env.E2E_WORKSPACE_ROOT!, `drawio-${randomUUID()}`);
  await mkdir(absPath, { recursive: true });
  const compressed = deflateRawSync(Buffer.from(encodeURIComponent(model('Compressed second page')))).toString('base64');
  // The second page is beyond the old text-preview endpoint's 64 KiB limit.
  const xml = `<mxfile><diagram id="first" name="First">${model('Architecture root')}</diagram><!--${'padding'.repeat(11000)}--><diagram id="second" name="Second">${compressed}</diagram></mxfile>`;
  await writeFile(path.join(absPath, 'architecture.drawio'), xml);
  await writeFile(path.join(absPath, 'invalid.dio'), '<mxfile><broken>');
  const ws = await (await request.post(base + '/api/workspaces', { data: { absPath, label: 'Draw.io preview' } })).json();
  const t = await (await request.post(base + '/api/threads/start', { data: { workspaceId: ws.id, title: 'Draw.io preview', provider: 'codex', model: 'ios-e2e-stream', approvalMode: 'yolo' } })).json();
  const externalRequests: string[] = [];
  page.on('request', (request) => {
    if (/diagrams\.net|draw\.io/.test(new URL(request.url()).hostname)) externalRequests.push(request.url());
  });
  await page.goto(`/threads/${t.id ?? t.thread.id}`);
  if (testInfo.project.name === 'mobile-chromium') {
    await page.getByRole('button', { name: 'Toggle shortcuts sidebar', exact: true }).click();
    await page.getByRole('button', { name: 'Open Explorer', exact: true }).click();
  } else {
    await page.getByRole('navigation', { name: 'Workspace tools' }).getByRole('button', { name: 'Toggle Explorer' }).click();
  }
  // Use the tree's keyboard activation: hover actions can cover the label in a
  // narrow desktop Explorer, independently of the diagram renderer.
  await page.getByRole('treeitem', { name: 'architecture.drawio', exact: true }).press('Enter');
  const frame = page.frameLocator('iframe[title="Draw.io preview: architecture.drawio"]');
  await expect(frame.locator('svg')).toBeVisible();
  await expect(frame.getByText('Architecture root', { exact: true })).toBeVisible();
  await frame.getByTitle('Next Page', { exact: true }).click();
  await expect(frame.getByText('Compressed second page', { exact: true })).toBeVisible();
  const shape = frame.locator('svg rect').first();
  const widthBeforeZoom = (await shape.boundingBox())!.width;
  await frame.getByTitle('Zoom In', { exact: true }).click();
  await expect.poll(async () => (await shape.boundingBox())!.width).toBeGreaterThan(widthBeforeZoom);
  await page.getByRole('button', { name: 'Diagram source', exact: true }).click();
  await expect(page.locator('iframe[title="Draw.io preview: architecture.drawio"]')).toHaveCount(0);
  await expect(page.locator('.monaco-editor, [aria-label="Source code"]')).toBeVisible();
  await expect(page.locator('.monaco-editor, [aria-label="Source code"]')).toContainText('mxfile');
  await page.getByRole('button', { name: 'Diagram preview', exact: true }).click();
  await expect(frame.getByText('Architecture root', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('drawio-preview.png') });
  if (testInfo.project.name === 'mobile-chromium') {
    await page.getByRole('button', { name: 'Show Explorer', exact: true }).click();
  }
  await page.getByRole('treeitem', { name: 'invalid.dio', exact: true }).press('Enter');
  await expect(page.frameLocator('iframe[title="Draw.io preview: invalid.dio"]').getByRole('alert')).toContainText('Invalid draw.io XML');
  expect(externalRequests).toEqual([]);
});
