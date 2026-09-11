import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { api, ensureWorkspaceDir } from './helpers';

const apiPort = Number(process.env.E2E_API_PORT ?? 8787);
const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
const workspaceRoot = path.resolve(
  process.env.E2E_WORKSPACE_ROOT ?? '.local/e2e-playwright',
);

test('explorer loads nested directories without renaming or losing siblings', async ({page}) => {
  const name = `explorer-${randomUUID().slice(0,8)}`;
  const absPath = await ensureWorkspaceDir(workspaceRoot,name);
  await fs.mkdir(path.join(absPath,'.cargo'),{recursive:true});
  await fs.mkdir(path.join(absPath,'src','nested'),{recursive:true});
  await fs.writeFile(path.join(absPath,'.cargo','config.toml'),'[build]\n');
  await fs.writeFile(path.join(absPath,'src','nested','child.txt'),'nested leaf');
  const workspace = await api<any>(apiBaseUrl,'/api/workspaces',{method:'POST',body:JSON.stringify({absPath,label:name})});
  const thread = await api<any>(apiBaseUrl,'/api/threads/start',{method:'POST',body:JSON.stringify({workspaceId:workspace.id,title:name,provider:'codex',model:'ios-e2e-stream',approvalMode:'yolo'})});
  await page.goto(`/threads/${thread.id}`);
  await page.getByRole('button',{name:/^(Expand|Show) workspace$/}).click();
  const root = page.getByRole('treeitem',{name,exact:true});
  await expect(root).toBeVisible();
  if (await root.getAttribute('aria-expanded') === 'false') await root.getByRole('button',{name:`Expand ${name}`,exact:true}).click();
  let releaseCargo!: () => void;
  const cargoGate = new Promise<void>(resolve => {releaseCargo=resolve;});
  await page.route('**/files/tree?*',async route=>{
    if (new URL(route.request().url()).searchParams.get('path')?.replace(/^\.\//, '') === '.cargo') await cargoGate;
    await route.continue();
  });
  const cargoRequested = page.waitForRequest(request=>new URL(request.url()).searchParams.get('path')?.replace(/^\.\//, '') === '.cargo');
  await page.getByRole('button',{name:'Expand .cargo',exact:true}).click();
  await cargoRequested;
  await page.getByRole('button',{name:'Expand src',exact:true}).click();
  await page.getByRole('button',{name:'Expand nested',exact:true}).click();
  await expect(page.getByRole('treeitem',{name:'child.txt',exact:true})).toBeVisible();
  releaseCargo();
  await expect(page.getByRole('treeitem',{name:'config.toml',exact:true})).toBeVisible();
  await expect(page.getByRole('treeitem',{name:'.cargo',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Collapse src',exact:true}).click();
  await expect(page.getByRole('treeitem',{name:'child.txt',exact:true})).toHaveCount(0);
  await expect(page.getByRole('treeitem',{name:'config.toml',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Expand src',exact:true}).click();
  await expect(page.getByRole('treeitem',{name:'child.txt',exact:true})).toBeVisible();
  await page.reload();
  await page.getByRole('button',{name:/^(Expand|Show) workspace$/}).click();
  await expect(page.getByRole('treeitem',{name:'child.txt',exact:true})).toBeVisible();
  await expect(page.getByRole('treeitem',{name,exact:true})).toHaveCount(1);
});
