import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';

test('left avatar menu opens shared settings and persists uploaded profile images with account isolation', async ({ page, request }, testInfo) => {
  const directory = await mkdtemp(resolve('.local/account-profile-'));
  const reservation = createServer();
  await new Promise<void>(done => reservation.listen(0, '127.0.0.1', done));
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>(done => reservation.close(() => done()));
  const base = `http://127.0.0.1:${port}`;
  const password = randomBytes(20).toString('hex');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(POCKYMOE|REMOTE_CODEX)_/.test(key)));
  const logs: string[] = [];
  const relay = spawn(resolve('target/debug/pockymoe'), ['relay'], {
    env: { ...env, HOST: '127.0.0.1', PORT: String(port), POCKYMOE_PUBLIC_BASE_URL: `http://localhost:${process.env.E2E_WEB_PORT ?? 5173}`, POCKYMOE_ADMIN_USERNAME: 'test-admin', POCKYMOE_ADMIN_PASSWORD: password, POCKYMOE_RELAY_DATA_DIR: directory,
      POCKYMOE_RELAY_DATABASE_PATH: join(directory, 'relay.sqlite'), POCKYMOE_RELAY_SESSION_SECRET: randomBytes(32).toString('hex') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  relay.stdout.on('data', data => logs.push(String(data))); relay.stderr.on('data', data => logs.push(String(data)));
  try {
    await expect.poll(async () => { try { return (await request.get(base + '/healthz')).status(); } catch { return 0; } }).toBe(200);
    async function register(username: string) {
      const registered = await request.post(base + '/relay/auth/register', { data: { username, email: `${username}@example.test`, password } });
      expect(registered.ok(), await registered.text()).toBeTruthy();
      const login = await request.post(base + '/relay/auth/login', { data: { username, password } });
      expect(login.ok(), await login.text()).toBeTruthy();
      return (await login.json()).token as string;
    }
    const token = await register('profile-owner');
    const other = await register('other-person');
    const headers = { authorization: `Bearer ${token}` };
    await page.route('**/relay/**', async route => {
      const original = new URL(route.request().url());
      const response = await route.fetch({ url: base + original.pathname + original.search });
      await route.fulfill({ response });
    });
    await page.context().addCookies([{ name: 'remote_codex_relay_session', value: token, domain: 'localhost', path: '/', httpOnly: true, secure: true, sameSite: 'Lax' }]);
    await page.addInitScript(() => {
      localStorage.setItem('remote-codex-relay-mode', 'true');
      localStorage.setItem('remote-codex.locale', 'en');
    });
    await page.goto('/relay-account');
    const avatarMenu = page.getByRole('button', { name: 'Relay account menu for profile-owner' });
    await expect(avatarMenu).toBeVisible();
    const box = await avatarMenu.boundingBox(); expect(box!.x).toBeLessThan(100);
    await expect(page.getByRole('button', { name: 'Open Navigation' })).toHaveCount(0);
    await avatarMenu.click();
    await expect(page.getByRole('menuitem', { name: 'Device Management' })).toBeVisible();
    await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
    const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
    await expect(settings).toBeVisible();
    await expect(settings).toHaveClass(/matter-settings-dialog/);
    await page.keyboard.press('Escape');
    // An actual PNG is decoded, cropped and re-encoded before the real Relay API stores it.
    const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jpe8AAAAASUVORK5CYII=', 'base64');
    await page.getByLabel('Upload avatar', { exact: true }).setInputFiles({ name: 'avatar.png', mimeType: 'image/png', buffer: image });
    await expect(page.getByRole('button', { name: 'Save profile' })).toBeEnabled();
    await page.getByRole('button', { name: 'Save profile' }).click();
    await expect(page.getByText('Profile saved.', { exact: true })).toBeVisible();
    await expect(avatarMenu.locator('img')).toBeVisible();
    const stored = (await (await request.get(base + '/relay/auth/session', { headers })).json()).user.avatarUrl;
    expect(stored).toMatch(/^data:image\/(webp|png);base64,/);
    const invalid = await request.patch(base + '/relay/account', { headers, data: { username: 'wrong-rename', avatarUrl: 'data:image/svg+xml;base64,PHN2Zy8+' } });
    expect(invalid.status()).toBe(400);
    const user = (await (await request.get(base + '/relay/auth/session', { headers })).json()).user;
    expect(user.username).toBe('profile-owner'); expect(user.avatarUrl).toBe(stored);
    expect((await request.patch(base + '/relay/account', { data: { avatarUrl: null } })).status()).toBe(401);
    expect((await (await request.get(base + '/relay/auth/session', { headers: { authorization: `Bearer ${other}` } })).json()).user.avatarUrl).toBeNull();
    const rename = await request.patch(base + '/relay/account', { headers, data: { username: 'profile-renamed' } });
    expect(rename.ok()).toBeTruthy(); expect((await rename.json()).avatarUrl).toBe(stored);
    await page.reload();
    await expect(page.getByRole('img', { name: 'Profile avatar' })).toBeVisible();
    await page.getByRole('button', { name: 'Remove avatar' }).click();
    await page.getByRole('button', { name: 'Save profile' }).click();
    await expect(page.getByText('Profile saved.', { exact: true })).toBeVisible();
    expect((await (await request.get(base + '/relay/auth/session', { headers })).json()).user.avatarUrl).toBeNull();
    await page.screenshot({ path: testInfo.outputPath('account-profile.png') });
  } catch (error) {
    await testInfo.attach('relay-log', { body: logs.join(''), contentType: 'text/plain' }); throw error;
  } finally {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    relay.kill(); await new Promise<void>(done => { if (relay.exitCode !== null) done(); else relay.once('exit', () => done()); });
    await rm(directory, { recursive: true, force: true });
  }
});
