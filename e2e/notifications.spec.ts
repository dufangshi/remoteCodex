import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createECDH, randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { DatabaseSync } from 'node:sqlite';

// Use full Chromium's headless mode: headless-shell cannot display notifications.
test.use({ channel: 'chromium' });

test('account push registration, durable completion and background tab read state', async ({
  browser,
}) => {
  const root = await mkdtemp(resolve('.local/push-e2e-'));
  const procs: ChildProcess[] = [];
  const freePort = () =>
    new Promise<number>((done) => {
      const server = createServer();
      server.listen(0, '127.0.0.1', () => {
        const port = (server.address() as { port: number }).port;
        server.close(() => done(port));
      });
    });
  const relayPort = await freePort(),
    devicePort = await freePort();
  const base = `http://127.0.0.1:${relayPort}`;
  const password = randomBytes(24).toString('hex');
  const cleanEnv = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !key.startsWith('REMOTE_CODEX_'),
    ),
  );
  function start(command: string, extra: Record<string, string>) {
    const proc = spawn(resolve('target/debug/remote-codex'), [command], {
      env: {
        ...cleanEnv,
        HOST: '127.0.0.1',
        REMOTE_CODEX_ADMIN_USERNAME: 'admin',
        REMOTE_CODEX_ADMIN_PASSWORD: password,
        REMOTE_CODEX_E2E_FAKE_RUNTIME: '1',
        REMOTE_CODEX_SESSION_SECRET: randomBytes(32).toString('hex'),
        REMOTE_CODEX_RELAY_SESSION_SECRET: randomBytes(32).toString('hex'),
        ...extra,
      },
      stdio: 'ignore',
    });
    procs.push(proc);
  }
  let token = '';
  async function api(path: string, method = 'GET', body?: unknown) {
    const res = await fetch(base + path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10000),
    });
    expect(res.ok, `${method} ${path}: ${res.status}`).toBe(true);
    return res.json();
  }
  const context = await browser.newContext({ permissions: ['notifications'] });
  try {
    start('relay', {
      PORT: String(relayPort),
      REMOTE_CODEX_RELAY_DATA_DIR: join(root, 'relay'),
      REMOTE_CODEX_RELAY_REGISTRATION_ENABLED: 'true',
      REMOTE_CODEX_RELAY_WEB_DIST_DIR: resolve('apps/supervisor-web/dist'),
    });
    await expect
      .poll(() =>
        fetch(base + '/healthz')
          .then((r) => r.status)
          .catch(() => 0),
      )
      .toBe(200);
    await api('/relay/auth/register', 'POST', {
      username: 'owner',
      email: 'owner@example.test',
      password,
    });
    token = (
      await api('/relay/auth/login', 'POST', { username: 'owner', password })
    ).token;
    const device = await api('/relay/devices', 'POST', {
      name: 'Notification fixture',
    });
    start('relay-supervisor', {
      PORT: String(devicePort),
      REMOTE_CODEX_RELAY_SUPERVISOR_PORT: String(devicePort),
      REMOTE_CODEX_RELAY_SERVER_URL: base,
      REMOTE_CODEX_RELAY_AGENT_TOKEN: device.token,
      REMOTE_CODEX_DATABASE_PATH: join(root, 'supervisor.sqlite'),
      REMOTE_CODEX_WORKSPACE_ROOT: join(root, 'workspaces'),
    });
    await expect
      .poll(async () => (await api('/healthz')).connectedSupervisors)
      .toBe(1);
    await context.grantPermissions(['notifications'], { origin: base });
    await context.addCookies([
      { name: 'remote_codex_relay_session', value: token, url: base },
    ]);
    // Chromium automation has no vendor push credentials. Mock only PushManager;
    // permission, worker registration, account UI and HTTP storage are real.
    const key = createECDH('prime256v1');
    key.generateKeys();
    await context.addInitScript(
      (subscription) => {
        let subscribed = false;
        const sub = {
          endpoint: subscription.endpoint,
          toJSON: () => subscription,
          unsubscribe: async () => {
            subscribed = false;
            return true;
          },
        };
        PushManager.prototype.getSubscription = async () =>
          subscribed ? (sub as PushSubscription) : null;
        PushManager.prototype.subscribe = async () => {
          subscribed = true;
          return sub as PushSubscription;
        };
      },
      {
        endpoint: 'https://fcm.googleapis.com/fcm/send/synthetic-e2e',
        keys: {
          p256dh: key.getPublicKey().toString('base64url'),
          auth: randomBytes(16).toString('base64url'),
        },
      },
    );
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    // Playwright enables focus emulation on every page; use real tab visibility.
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: false });
    await page.goto(base + '/relay-account');
    await expect(
      page.getByRole('heading', { name: 'Thread notifications' }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Enable notifications', exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await api('/relay/account/notifications')).subscriptionIds.length,
      )
      .toBe(1);
    await expect(
      page.getByText('Enabled in this browser', { exact: true }),
    ).toBeVisible();
    expect(
      (await api('/relay/account/notifications')).subscriptionIds,
    ).toHaveLength(1);
    await page
      .getByRole('button', { name: 'Disable notifications', exact: true })
      .click();
    await expect(
      page.getByText('Disabled in this browser', { exact: true }),
    ).toBeVisible();
    expect(
      (await api('/relay/account/notifications')).subscriptionIds,
    ).toHaveLength(0);

    const prefix = `/relay/devices/${device.device.id}/api`;
    const work = join(root, 'workspace');
    await mkdir(work);
    const workspace = await api(prefix + '/workspaces', 'POST', {
      absPath: work,
      label: 'Push fixture',
    });
    const created = await api(prefix + '/threads/start', 'POST', {
      workspaceId: workspace.id,
      title: 'Notification fixture',
      model: 'fake',
    });
    const id = created.id ?? created.thread.id;
    const url = `${base}/devices/${device.device.id}/threads/${id}`;
    const expectTab = async (shape: string) => {
      await expect(page).toHaveTitle('Notification fixture');
      await expect
        .poll(
          () =>
            page.evaluate(() =>
              decodeURIComponent(
                document.querySelector<HTMLLinkElement>(
                  'link[type="image/svg+xml"]',
                )?.href ?? '',
              ),
            ),
          { timeout: 40000 },
        )
        .toContain(shape);
    };
    await page.goto(url);
    await expect(page.getByRole('textbox', { name: 'Prompt' })).toBeVisible();
    await expectTab('m8 16 5 5 11-11');
    await page
      .getByRole('textbox', { name: 'Prompt' })
      .fill('Inspect this repository in depth');
    await page
      .getByRole('button', { name: 'Send Prompt', exact: true })
      .click();
    await expectTab('M25 16a9');
    const foreground = await context.newPage();
    await foreground.goto(base + '/relay-account');
    await foreground.bringToFront();
    await expect
      .poll(() => page.evaluate(() => document.hasFocus()))
      .toBe(false);
    await expectTab('fill="#f85149"');
    const detail = await api(`${prefix}/threads/${id}`);
    const turn = detail.turns.at(-1).id;
    // No browser subscription exists now, so no synthetic endpoint is contacted.
    // The authenticated device tunnel must still durably persist and ACK its event.
    const relayDb = new DatabaseSync(
      join(root, 'relay', 'relay-store.sqlite'),
      { readOnly: true },
    );
    const supervisorDb = new DatabaseSync(join(root, 'supervisor.sqlite'), {
      readOnly: true,
    });
    try {
      await expect
        .poll(
          () =>
            relayDb
              .prepare('SELECT count(*) AS n FROM relay_push_events WHERE id=?')
              .get(`${device.device.id}:${turn}`)?.n,
        )
        .toBe(1);
      await expect
        .poll(
          () =>
            supervisorDb
              .prepare(
                "SELECT count(*) AS n FROM kv WHERE key GLOB 'relay:notice:*'",
              )
              .get()?.n,
        )
        .toBe(0);
    } finally {
      relayDb.close();
      supervisorDb.close();
    }
    await page.bringToFront();
    await expectTab('m8 16 5 5 11-11');
    await page.reload();
    await expectTab('m8 16 5 5 11-11');

    // Deliver through Chromium's actual Service Worker push dispatcher. This
    // verifies display/data with our built worker, not an external push vendor.
    let registrationId = '';
    cdp.on('ServiceWorker.workerRegistrationUpdated', ({ registrations }) => {
      registrationId =
        registrations.find(
          (r: { scopeURL: string }) => r.scopeURL === base + '/',
        )?.registrationId ?? registrationId;
    });
    await cdp.send('ServiceWorker.enable');
    await expect.poll(() => registrationId).not.toBe('');
    await cdp.send('ServiceWorker.deliverPushMessage', {
      origin: base,
      registrationId,
      data: JSON.stringify({
        url,
        body: 'A thread turn completed. Click to view.',
        tag: 'fixture-turn',
      }),
    });
    await expect
      .poll(() =>
        page.evaluate(async () =>
          (await (await navigator.serviceWorker.ready).getNotifications()).map(
            (n) => n.data.url,
          ),
        ),
      )
      .toContain(url);
  } finally {
    await context.close();
    await Promise.all(
      procs.map(
        (proc) =>
          new Promise<void>((done) => {
            if (proc.exitCode !== null || proc.signalCode !== null)
              return done();
            proc.once('exit', () => done());
            proc.kill('SIGTERM');
            setTimeout(() => proc.kill('SIGKILL'), 2000).unref();
          }),
      ),
    );
    await rm(root, { recursive: true, force: true });
  }
});
