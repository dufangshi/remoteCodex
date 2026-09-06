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
    ...Array.from({length: 80}, (_, i) => ({action:'prompt',command:`/$skill-${i}`,label:`Skill ${i}`})),
  ]}}));
  await page.goto(`/threads/${source.id}`);
  await expect(page.getByRole('textbox',{name:'Prompt'})).toBeVisible();
  await page.getByRole('button',{name:'Open slash toolbox'}).click();
  await expect(page.getByRole('button',{name:/^\/status(?: |$)/})).toBeVisible();
  await expect(page.getByRole('button',{name:/^\/\$/})).toHaveCount(0);
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

test('shows fork failures and allows latest and selected-turn retries with touch', async ({page, isMobile}) => {
  const activate = async (name: string | RegExp) => {
    const button = page.getByRole('button', {name});
    if (isMobile) await button.tap(); else await button.click();
  };
  const absPath = await ensureWorkspaceDir(path.resolve(process.env.E2E_WORKSPACE_ROOT ?? '.local/e2e-playwright'), `fork-errors-${randomUUID()}`);
  const workspace = await api<any>(base, '/api/workspaces', {method:'POST',body:JSON.stringify({absPath})});
  const source = await api<any>(base, '/api/threads/start', {method:'POST',body:JSON.stringify({workspaceId:workspace.id,provider:'claude',model:'ios-e2e-stream',approvalMode:'yolo'})});
  await api(base, `/api/threads/${source.id}/prompt`, {method:'POST',body:JSON.stringify({prompt:'Reply with exactly FORK_RETRY_READY.'})});
  await waitForThread(base, source.id);
  const snapshot = await api<any>(base, `/api/threads/${source.id}/capabilities`);
  await page.route(`**/api/threads/${source.id}/capabilities`, route => route.fulfill({json:{
    ...snapshot,
    effectiveCapabilities:{...snapshot.effectiveCapabilities,branching:{...snapshot.effectiveCapabilities.branching,fork:true,forkAt:true}},
  }}));
  let rejectFork = true;
  const modes: string[] = [];
  await page.route(`**/api/threads/${source.id}/fork`, route => {
    modes.push(route.request().postDataJSON().mode);
    return rejectFork
      ? route.fulfill({status:409,json:{error:'conflict',message:'Cannot fork an active turn. Wait until the turn finishes.'}})
      : route.continue();
  });
  await page.goto(`/threads/${source.id}`);
  await expect(page.getByRole('textbox',{name:'Prompt'})).toBeVisible();
  await activate('Open slash toolbox');
  await activate(/^\/fork(?: |$)/);
  await activate('Fork from latest');
  await expect(page.getByRole('alert')).toContainText('Cannot fork an active turn');
  expect(modes).toEqual(['latest']);
  await activate('Fork from selected turn');
  await activate(/Turn 1/);
  await expect(page.getByRole('alert')).toContainText('Cannot fork an active turn');
  expect(modes).toEqual(['latest','turn']);
  rejectFork = false;
  await activate(/Turn 1/);
  await expect(page).not.toHaveURL(new RegExp(`/threads/${source.id}$`));
  expect(modes).toEqual(['latest','turn','turn']);
  const childId = new URL(page.url()).pathname.split('/').at(-1)!;
  const child = await api<any>(base, `/api/threads/${childId}`);
  expect(child.thread.providerSessionId).not.toBe(source.providerSessionId);
  expect(child.turns[0].items.some((item:any)=>item.text.includes('FORK_RETRY_READY'))).toBe(true);
});
