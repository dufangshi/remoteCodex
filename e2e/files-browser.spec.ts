import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { api, collectTexts, ensureWorkspaceDir } from './helpers';

const apiPort = Number(process.env.E2E_API_PORT ?? 8787);
const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
const workspaceRoot = path.resolve(
  process.env.E2E_WORKSPACE_ROOT ?? '.local/e2e-playwright',
);

test.describe('workspace file browser and long turn', () => {
  test('lists, previews, writes, and moves files', async ({ page }) => {
    const name = `files-${randomUUID().slice(0, 8)}`;
    const absPath = await ensureWorkspaceDir(workspaceRoot, name);
    const tooManyPath = path.join(absPath, 'too-many');
    await fs.mkdir(tooManyPath);
    await Promise.all(
      Array.from({ length: 1_000 }, (_, index) =>
        fs.writeFile(path.join(tooManyPath, `${index}.txt`), ''),
      ),
    );
    const workspace = await api<any>(apiBaseUrl, '/api/workspaces', {
      method: 'POST',
      body: JSON.stringify({ absPath, label: name }),
    });
    const tree = await api<any>(
      apiBaseUrl,
      `/api/workspaces/${workspace.id}/files/tree?path=.`,
    );
    expect(tree.kind).toBe('directory');
    const names = (tree.children ?? []).map((node: any) => node.name);
    expect(names).toContain('README.md');
    expect(names).toContain('src');

    const preview = await api<any>(
      apiBaseUrl,
      `/api/workspaces/${workspace.id}/files/preview?path=README.md`,
    );
    expect(preview.content).toContain(`# ${name}`);

    await api(apiBaseUrl, `/api/workspaces/${workspace.id}/files`, {
      method: 'PUT',
      body: JSON.stringify({ path: 'notes.txt', content: 'browser-ok' }),
    });
    await api(apiBaseUrl, `/api/workspaces/${workspace.id}/files/move`, {
      method: 'PATCH',
      body: JSON.stringify({ fromPath: 'notes.txt', toPath: 'docs/notes.txt' }),
    });
    const moved = await api<any>(
      apiBaseUrl,
      `/api/workspaces/${workspace.id}/files/preview?path=docs/notes.txt`,
    );
    expect(moved.content).toBe('browser-ok');

    const thread = await api<any>(apiBaseUrl, '/api/threads/start', {
      method: 'POST',
      body: JSON.stringify({
        workspaceId: workspace.id,
        title: `${name} thread`,
        provider: 'codex',
        model: 'ios-e2e-stream',
        approvalMode: 'yolo',
      }),
    });
    await page.goto(`/threads/${thread.id}`);
    await expect(page.getByRole('textbox', { name: 'Prompt' })).toBeVisible();
    const filesTab = page.getByRole('button', { name: /^Files$/i });
    if (await filesTab.count()) {
      await filesTab.click();
      await expect(page.getByText('README.md').first()).toBeVisible();

      const downloadPromise = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download src' }).click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toBe('src.zip');
      const archivePath = await download.path();
      expect(archivePath).toBeTruthy();
      const signature = await fs.readFile(archivePath as string);
      expect(signature.subarray(0, 2).toString('ascii')).toBe('PK');

      await page.getByRole('button', { name: 'Download too-many' }).click();
      await expect(
        page.getByText(/Directory download is limited to fewer than 1,000 files/),
      ).toBeVisible();
    }
  });

  test('interrupts a long fake turn via API', async () => {
    const name = `long-${randomUUID().slice(0, 8)}`;
    const absPath = await ensureWorkspaceDir(workspaceRoot, name);
    const workspace = await api<any>(apiBaseUrl, '/api/workspaces', {
      method: 'POST',
      body: JSON.stringify({ absPath, label: name }),
    });
    const thread = await api<any>(apiBaseUrl, '/api/threads/start', {
      method: 'POST',
      body: JSON.stringify({
        workspaceId: workspace.id,
        title: `${name} long`,
        provider: 'codex',
        model: 'ios-e2e-stream',
        approvalMode: 'yolo',
      }),
    });
    await api(apiBaseUrl, `/api/threads/${thread.id}/prompt`, {
      method: 'POST',
      body: JSON.stringify({
        prompt:
          'Inspect this repository in depth, enumerate every top-level source file group, and write a detailed multi-section report before giving a final summary.',
      }),
    });
    await api(apiBaseUrl, `/api/threads/${thread.id}/interrupt`, {
      method: 'POST',
    });
    const detail = await api<any>(apiBaseUrl, `/api/threads/${thread.id}`);
    expect(detail.thread.status).not.toBe('running');
    expect(collectTexts(detail).join(' ')).toBeTruthy();
  });
});

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
    if (new URL(route.request().url()).searchParams.get('path') === './.cargo') await cargoGate;
    await route.continue();
  });
  const cargoRequested = page.waitForRequest(request=>new URL(request.url()).searchParams.get('path') === './.cargo');
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
