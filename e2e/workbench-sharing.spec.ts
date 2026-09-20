import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

test('workbench shares images publicly and grants device access without leaving the thread', async ({ browser }, testInfo) => {
  const root = await mkdtemp(resolve('.local/workbench-sharing-'));
  const processes: ChildProcess[] = [];
  const freePort = () => new Promise<number>(done => { const server = createServer(); server.listen(0, '127.0.0.1', () => { const port = (server.address() as { port: number }).port; server.close(() => done(port)); }); });
  const rp = await freePort(), sp = await freePort();
  const base = `http://127.0.0.1:${rp}`;
  const password = randomBytes(24).toString('hex');
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('REMOTE_CODEX_')));
  const start = (command: string, extra: Record<string, string>) => {
    const proc = spawn(resolve('target/debug/remote-codex'), [command], { env: { ...environment, HOST: '127.0.0.1', REMOTE_CODEX_ADMIN_USERNAME: 'testadmin', REMOTE_CODEX_ADMIN_PASSWORD: password, REMOTE_CODEX_SESSION_SECRET: randomBytes(32).toString('hex'), REMOTE_CODEX_RELAY_SESSION_SECRET: randomBytes(32).toString('hex'), REMOTE_CODEX_E2E_FAKE_RUNTIME: '1', ...extra }, stdio: 'ignore' });
    processes.push(proc);
  };
  const api = async (path: string, token?: string, body?: unknown) => {
    const response = await fetch(`${base}${path}`, { method: body ? 'POST' : 'GET', headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10000) });
    expect(response.ok, `${path}: ${response.status}`).toBeTruthy();
    return response.json();
  };
  const context = await browser.newContext();
  try {
    start('relay', { PORT: String(rp), REMOTE_CODEX_RELAY_DATA_DIR: join(root, 'relay'), REMOTE_CODEX_RELAY_REGISTRATION_ENABLED: 'true', REMOTE_CODEX_RELAY_SESSION_SECRET: randomBytes(32).toString('hex'), REMOTE_CODEX_RELAY_WEB_DIST_DIR: resolve('apps/supervisor-web/dist'), REMOTE_CODEX_PUBLIC_BASE_URL: base });
    await expect.poll(() => fetch(`${base}/healthz`).then(r => r.status).catch(() => 0)).toBe(200);
    for (const username of ['owner', 'reviewer']) await api('/relay/auth/register', undefined, { username, email: `${username}@example.test`, password });
    const owner = (await api('/relay/auth/login', undefined, { username: 'owner', password })).token;
    const device = await api('/relay/devices', owner, { name: 'Isolated UI device' });
    start('relay-supervisor', { PORT: String(sp), REMOTE_CODEX_RELAY_SUPERVISOR_PORT: String(sp), REMOTE_CODEX_RELAY_SERVER_URL: base, REMOTE_CODEX_RELAY_AGENT_TOKEN: device.token, REMOTE_CODEX_DATABASE_PATH: join(root, 'supervisor.sqlite'), REMOTE_CODEX_WORKSPACE_ROOT: join(root, 'workspaces') });
    await expect.poll(async () => (await api('/healthz')).connectedSupervisors).toBe(1);
    const deviceApi = `/relay/devices/${device.device.id}/api`;
    const absPath = join(root, 'workspace');
    await mkdir(absPath);
    const workspace = await api(`${deviceApi}/workspaces`, owner, { absPath, label: 'Sharing review' });
    const started = await api(`${deviceApi}/threads/start`, owner, { workspaceId: workspace.id, model: 'fake', title: 'Image sharing review' });
    const id = started.id ?? started.thread.id;
    await mkdir(join(absPath, '.temp/threads', id), { recursive: true });
    await writeFile(join(absPath, '.temp/threads', id, 'image.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64'));
    await api(`${deviceApi}/threads/${id}/prompt`, owner, { prompt: `Review this attachment [PHOTO ./.temp/threads/${id}/image.png]` });
    await expect.poll(async () => (await api(`${deviceApi}/threads/${id}`, owner)).thread.status).toBe('idle');
    // The reported conversation contains these examples in an assistant reply.
    // They are text, not uploaded images, and must not be fetched as attachments.
    const example = 'Syntax examples: `[PHOTO …]` and `[PHOTO ./.temp/threads/…/image.png]`.';
    const db = new DatabaseSync(join(root, 'supervisor.sqlite'));
    try {
      const rows = db.prepare('SELECT id,item_json FROM thread_history_items WHERE thread_id=?').all(id) as { id: string; item_json: string }[];
      for (const row of rows) {
        const item = JSON.parse(row.item_json);
        if (item.kind === 'agentMessage') {
          item.text += `\n\n${example}`;
          db.prepare('UPDATE thread_history_items SET item_json=? WHERE id=?').run(JSON.stringify(item), row.id);
        }
      }
    } finally { db.close(); }
    await context.addCookies([{ name: 'remote_codex_relay_session', value: owner, url: base }]);
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const page = await context.newPage();
    const contrast = async (selector: string) => page.locator(selector).evaluate(element => {
      const style = getComputedStyle(element);
      const luminance = (color: string) => {
        const channels = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(c => { const s = c / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4; });
        return channels[0]! * .2126 + channels[1]! * .7152 + channels[2]! * .0722;
      };
      const a = luminance(style.color), b = luminance(style.backgroundColor);
      return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
    });
    let releaseCreate!: () => void;
    const createGate = new Promise<void>(resolve => { releaseCreate = resolve; });
    await page.route('**/relay/thread-links', async route => { if (route.request().method() === 'POST') await createGate; await route.continue(); });
    await page.addInitScript(() => localStorage.setItem('remote-codex-theme-mode', 'dark'));
    await page.goto(`${base}/devices/${device.device.id}/threads/${id}`);
    await page.getByRole('button', { name: 'Share as link', exact: true }).click();
    try {
      await expect(page.getByRole('button', { name: 'Creating link…' })).toBeVisible();
      expect(await contrast('.thread-public-link-create')).toBeGreaterThanOrEqual(4.5);
    } finally { releaseCreate(); }
    const link = page.getByRole('textbox', { name: 'Public share URL' });
    await expect(link).toBeVisible();
    const url = await link.inputValue();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);
    const createButton = page.getByRole('button', { name: 'Create & copy link', exact: true });
    await expect(createButton).toBeEnabled();
    expect(await contrast('.thread-public-link-create')).toBeGreaterThanOrEqual(4.5);
    await createButton.hover();
    expect(await contrast('.thread-public-link-create')).toBeGreaterThanOrEqual(4.5);
    await createButton.focus();
    expect(await contrast('.thread-public-link-create')).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({ path: `output/playwright/share-link-contrast-${testInfo.project.name}.png` });
    const anonymous = await browser.newContext();
    try {
      const publicPage = await anonymous.newPage();
      await publicPage.goto(url);
      await expect(publicPage.getByText('Review this attachment', { exact: true })).toBeVisible();
      await expect(publicPage.getByText('[PHOTO …]', { exact: true })).toBeVisible();
      await expect(publicPage.getByText('[PHOTO ./.temp/threads/…/image.png]', { exact: true })).toBeVisible();
      await expect(publicPage.locator('img')).toHaveAttribute('src', /^data:image\/png;base64,/);
      await expect.poll(() => publicPage.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1);
    } finally { await anonymous.close(); }
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await page.getByRole('button', { name: 'Sharing permissions', exact: true }).click();
    const scope = page.getByRole('checkbox', { name: /Share whole device/ });
    await expect(scope).not.toBeChecked();
    await scope.check();
    await page.getByPlaceholder('username or email').fill('reviewer');
    await expect(page.locator('.matter-actions-dialog')).toHaveAttribute('data-theme-effective', 'dark');
    await expect(page.locator('.thread-export-dialog-panel')).toHaveCSS('background-color', 'rgb(15, 19, 23)');
    await page.screenshot({ path: `output/playwright/sharing-dark-${testInfo.project.name}.png` });
    const grant = page.waitForRequest(request => request.url().endsWith('/relay/grants') && request.method() === 'POST');
    await page.getByRole('button', { name: 'Share device', exact: true }).click();
    expect((await grant).postDataJSON()).toMatchObject({ scope: 'device', targetIdentifier: 'reviewer', threadAccess: 'read', workspaceAccess: 'none', canCreateThreads: false });
    await expect(page.getByText('reviewer', { exact: true })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/threads/${id}$`));
    const reviewer = (await api('/relay/auth/login', undefined, { username: 'reviewer', password })).token;
    expect((await api(`${deviceApi}/threads/${id}`, reviewer)).thread.id).toBe(id);
    await page.getByRole('button', { name: 'Revoke', exact: true }).click();
    await expect(page.getByText('reviewer', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await page.getByRole('button', { name: 'Notifications', exact: true }).click();
    await expect(page.locator('.matter-notification-summary').first()).toContainText('ok: Review this attachment');
    await expect(page.locator('.matter-notifications')).toContainText('Image sharing review');
  } finally {
    await context.close();
    await Promise.all(processes.map(proc => new Promise<void>(done => { if (proc.exitCode !== null || proc.signalCode !== null) return done(); proc.once('exit', () => done()); proc.kill('SIGTERM'); })));
  }
});
