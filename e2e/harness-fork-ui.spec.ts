import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { api, ensureWorkspaceDir } from './helpers';

// Run with an isolated, real supervisor already listening on E2E_API_PORT.
// Playwright reuses it; the default fake server cannot verify native context.
test('real Codex forks through both composer buttons and inherits the selected context', async ({page, isMobile}) => {
  test.skip(process.env.RUN_REAL_FORK_UI !== '1', 'Requires a real authenticated Codex supervisor.');
  test.setTimeout(180_000);
  const base = `http://127.0.0.1:${process.env.E2E_API_PORT ?? 8787}`;
  const absPath = await ensureWorkspaceDir(path.resolve(process.env.E2E_WORKSPACE_ROOT ?? '.local/e2e-playwright'), `native-fork-${randomUUID()}`);
  const workspace = await api<any>(base, '/api/workspaces', {method:'POST',body:JSON.stringify({absPath})});
  const source = await api<any>(base, '/api/threads/start', {method:'POST',body:JSON.stringify({workspaceId:workspace.id,provider:'codex',model:'default',approvalMode:'yolo'})});
  const activate = async (name: string | RegExp) => {
    const button = page.getByRole('button', {name});
    if (isMobile) await button.tap(); else await button.click();
  };
  const prompt = async (id: string, text: string) => {
    const previous = (await api<any>(base, `/api/threads/${id}`)).turns.at(-1)?.id;
    await api(base, `/api/threads/${id}/prompt`, {method:'POST',body:JSON.stringify({prompt:text})});
    let detail: any;
    await expect.poll(async () => {
      detail = await api<any>(base, `/api/threads/${id}`);
      const last = detail.turns.at(-1);
      return last?.id !== previous ? last?.status : 'waiting';
    }, {timeout:90_000}).toBe('completed');
    return detail.turns.at(-1).items.filter((i:any)=>i.kind==='agentMessage').map((i:any)=>i.text).join('\n');
  };
  const memory = `MEMORY_${randomUUID().replaceAll('-','')}`;
  const later = `LATER_${randomUUID().replaceAll('-','')}`;
  await prompt(source.id, `Remember private marker ${memory}. Do not use tools or files. Reply only READY.`);
  await prompt(source.id, `Remember later marker ${later}. Do not use tools or files. Reply only READY.`);
  await page.goto(`/threads/${source.id}`);
  await expect(page.getByRole('textbox',{name:'Prompt'})).toBeVisible();
  await activate('Open slash toolbox');
  await expect(page.getByRole('button',{name:/^\/\$/})).toHaveCount(0);
  await activate(/^\/fork(?: |$)/);
  await activate('Fork from latest');
  await expect(page).not.toHaveURL(new RegExp(`/threads/${source.id}$`), {timeout:60_000});
  const latest = new URL(page.url()).pathname.split('/').at(-1)!;
  expect(await prompt(latest, 'Without tools, reply with only the later marker from this conversation.')).toContain(later);
  await page.goto(`/threads/${source.id}`);
  await expect(page.getByRole('textbox',{name:'Prompt'})).toBeVisible();
  await activate('Open slash toolbox');
  await activate(/^\/fork(?: |$)/);
  await activate('Fork from selected turn');
  await activate(/Turn 1 completed/);
  await expect(page).not.toHaveURL(new RegExp(`/threads/${source.id}$`), {timeout:60_000});
  const historical = new URL(page.url()).pathname.split('/').at(-1)!;
  const reply = await prompt(historical, 'Without tools, reply with the private marker and the later marker. Use ABSENT if no later marker was given.');
  expect(reply).toContain(memory);
  expect(reply).toContain('ABSENT');
  expect(reply).not.toContain(later);
});
