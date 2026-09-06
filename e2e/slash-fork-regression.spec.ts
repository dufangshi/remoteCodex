import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { api, ensureWorkspaceDir, waitForThread } from './helpers';
const base = `http://127.0.0.1:${process.env.E2E_API_PORT ?? 8787}`;

test('refreshes session slash commands and forks from the toolbox', async ({page}) => {
  const absPath = await ensureWorkspaceDir(path.resolve(process.env.E2E_WORKSPACE_ROOT ?? '.local/e2e-playwright'), `slash-fork-${randomUUID()}`);
  const workspace = await api<any>(base, '/api/workspaces', {method:'POST', body:JSON.stringify({absPath})});
  const source = await api<any>(base, '/api/threads/start', {method:'POST',body:JSON.stringify({workspaceId:workspace.id,provider:'claude',model:'ios-e2e-stream',approvalMode:'yolo'})});
  await api(base, `/api/threads/${source.id}/prompt`, {method:'POST',body:JSON.stringify({prompt:'Reply with exactly FORK_SOURCE_READY.'})});
  await waitForThread(base, source.id);
  const snapshot = await api<any>(base, `/api/threads/${source.id}/capabilities`);
  let commandsReady = false;
  await page.route(`**/api/threads/${source.id}/capabilities`, route => route.fulfill({json:{...snapshot, toolboxItems:[
    ...snapshot.toolboxItems,
    {action:'prompt',command:commandsReady?'/review':'/status',label:commandsReady?'Review':'Status'},
  ]}}));
  await page.goto(`/threads/${source.id}`);
  await expect(page.getByRole('textbox',{name:'Prompt'})).toBeVisible();
  await page.getByRole('button',{name:'Open slash toolbox'}).click();
  await expect(page.getByRole('button',{name:/^\/status(?: |$)/})).toBeVisible();
  commandsReady = true;
  await expect(page.getByRole('button',{name:/^\/review(?: |$)/})).toBeVisible({timeout:10000});
  await expect(page.getByRole('button',{name:/^\/status(?: |$)/})).toHaveCount(0);
  await page.getByRole('button',{name:/^\/review(?: |$)/}).click();
  await expect(page.getByRole('textbox',{name:'Prompt'})).toHaveText('/review');
  await page.getByRole('textbox',{name:'Prompt'}).fill('');
  await page.getByRole('button',{name:'Open slash toolbox'}).click();
  await page.getByRole('button',{name:/^\/fork(?: |$)/}).click();
  await expect(page.getByRole('button',{name:'Fork from selected turn'})).toHaveCount(0);
  await page.getByRole('button',{name:'Fork from latest'}).click();
  await expect(page).not.toHaveURL(new RegExp(`/threads/${source.id}$`));
  const childId = new URL(page.url()).pathname.split('/').at(-1)!;
  const child = await api<any>(base, `/api/threads/${childId}`);
  expect(child.thread.providerSessionId).not.toBe(source.providerSessionId);
  expect(child.turns[0].items.some((item:any)=>item.text.includes('FORK_SOURCE_READY'))).toBe(true);
  await page.reload();
  await expect(page.getByRole('textbox',{name:'Prompt'})).toBeVisible();
  await page.getByRole('button',{name:'Open slash toolbox'}).click();
  await expect(page.getByRole('button',{name:/^\/fork(?: |$)/})).toBeVisible();
});
