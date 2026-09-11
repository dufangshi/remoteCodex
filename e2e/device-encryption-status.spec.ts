import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';

// Two real Supervisor handshakes and two isolated browser identity stores.
// An externally provisioned Docker relay can exercise the same assertions.
test('device locks are verified independently of browser visit history', async ({ browser }) => {
  const procs: ChildProcess[] = [];
  const processLogs: string[] = [];
  const root = await mkdtemp(resolve('.local/device-locks-'));
  const freePort = () => new Promise<number>(done => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      server.close(() => done(port));
    });
  });
  const external = process.env.E2E_DEVICE_LOCK_RELAY;
  const base = external ?? `http://127.0.0.1:${await freePort()}`;
  const password = process.env.E2E_DEVICE_LOCK_PASSWORD ?? randomBytes(24).toString('hex');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('REMOTE_CODEX_')));
  function start(command: string, extra: Record<string, string>) {
    const proc = spawn(resolve('target/debug/remote-codex'), [command], {
      env: { ...env, HOST: '127.0.0.1', REMOTE_CODEX_E2E_FAKE_RUNTIME: '1', REMOTE_CODEX_ADMIN_USERNAME: 'lockadmin', REMOTE_CODEX_ADMIN_PASSWORD: password, REMOTE_CODEX_SESSION_SECRET: randomBytes(32).toString('hex'), ...extra },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    proc.stdout?.on('data', chunk => processLogs.push(String(chunk)));
    proc.stderr?.on('data', chunk => processLogs.push(String(chunk)));
    procs.push(proc);
  }
  async function api(path: string, method = 'GET', body?: unknown, token?: string) {
    const response = await fetch(`${base}${path}`, {
      method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10000),
    });
    expect(response.ok, `${method} ${path}: ${response.status} ${response.ok ? '' : await response.text()}`).toBeTruthy();
    return response.json();
  }
  const contexts = [];
  try {
    if (!external) {
      start('relay', {
        PORT: new URL(base).port, REMOTE_CODEX_RELAY_DATA_DIR: join(root, 'relay'),
        REMOTE_CODEX_RELAY_REGISTRATION_ENABLED: 'true', REMOTE_CODEX_ADMIN_USERNAME: 'lockadmin', REMOTE_CODEX_ADMIN_PASSWORD: password,
        REMOTE_CODEX_RELAY_SESSION_SECRET: randomBytes(32).toString('hex'),
        REMOTE_CODEX_RELAY_WEB_DIST_DIR: resolve('apps/supervisor-web/dist'), REMOTE_CODEX_PUBLIC_BASE_URL: base,
      });
    }
    await expect.poll(() => fetch(`${base}/healthz`).then(r => r.status).catch(() => 0)).toBe(200);
    if (!external) await api('/relay/auth/register', 'POST', { username: 'lockowner', email: 'lockowner@example.test', password });
    const { token } = await api('/relay/auth/login', 'POST', { username: 'lockowner', password });
    let devices: Array<{ id: string; name: string }>;
    if (external) {
      devices = (await api('/relay/portal', 'GET', undefined, token)).devices;
    } else {
      devices = [];
      for (const name of ['Mac encryption fixture', 'WSL encryption fixture']) {
        const created = await api('/relay/devices', 'POST', { name }, token);
        devices.push(created.device);
        const port = String(await freePort());
        start('relay-supervisor', {
          PORT: port, REMOTE_CODEX_RELAY_SUPERVISOR_PORT: port,
          REMOTE_CODEX_RELAY_SERVER_URL: base, REMOTE_CODEX_RELAY_AGENT_TOKEN: created.token,
          REMOTE_CODEX_DATABASE_PATH: join(root, `${created.device.id}.sqlite`),
          REMOTE_CODEX_WORKSPACE_ROOT: join(root, 'workspaces'),
        });
      }
    }
    expect(devices).toHaveLength(2);
    await expect.poll(async () => (await api('/healthz')).connectedSupervisors).toBe(2);
    for (let index = 0; index < 2; index++) {
      const context = await browser.newContext();
      contexts.push(context);
      // Prime just one identity in each browser, the opposite device each time.
      // The portal is held empty until the prior encrypted request completes.
      const page = await context.newPage();
      await page.addInitScript(token => {
        localStorage.setItem('remote-codex-relay-mode', 'true');
        localStorage.setItem('remote-codex-relay-token', token);
      }, token);
      const portal = await api('/relay/portal', 'GET', undefined, token);
      await page.route('**/relay/portal', route => route.fulfill({
        contentType: 'application/json', body: JSON.stringify({ ...portal, devices: [] }),
      }));
      await page.goto(`${base}/relay-devices`);
      // The public build uses cookie auth for encrypted fetches.
      await page.evaluate(async ({ password, id }) => {
        const login = await fetch('/relay/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'lockowner', password }) });
        if (!login.ok) throw new Error('Browser login failed');
        // Visiting the device route establishes the same browser-local identity
        // as an earlier thread visit, without invoking a model.
        location.href = `/devices/${id}/workspaces`;
      }, { password, id: devices[index]!.id });
      await page.waitForURL(`**/devices/${devices[index]!.id}/workspaces`);
      await expect(page.getByRole('heading', { name: 'Workspaces', exact: true })).toBeVisible();
      await expect.poll(() => page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((done, fail) => {
          const req = indexedDB.open('remote-codex-transport-v1', 1);
          req.onsuccess = () => done(req.result);
          req.onerror = () => fail(req.error);
        });
        try {
          return await new Promise<IDBValidKey[]>((done, fail) => {
            const req = db.transaction('identities').objectStore('identities').getAllKeys();
            req.onsuccess = () => done(req.result);
            req.onerror = () => fail(req.error);
          });
        } finally { db.close(); }
      })).toEqual([devices[index]!.id]);
      await page.unroute('**/relay/portal');
      await page.goto(`${base}/relay-devices`);
      for (const device of devices) {
        const row = page.locator('article').filter({ hasText: device.name });
        await expect(row.getByRole('button', { name: 'Device connection encrypted', exact: true })).toBeVisible();
        await row.getByRole('button', { name: 'Device connection encrypted', exact: true }).click();
        await expect(page.getByLabel('Device fingerprint')).toHaveText(/^SHA-256 .+/);
        await page.getByRole('button', { name: 'Close connection information' }).click();
      }
      await page.reload();
      await expect(page.getByRole('button', { name: 'Device connection encrypted', exact: true })).toHaveCount(2);
    }
  } catch (error) {
    console.error(processLogs.join(''));
    throw error;
  } finally {
    for (const context of contexts) await context.close();
    for (const proc of procs) proc.kill('SIGTERM');
    await Promise.all(procs.map(proc => proc.exitCode !== null ? Promise.resolve() : new Promise<void>(done => proc.once('exit', () => done()))));
    await rm(root, { recursive: true, force: true });
  }
});
