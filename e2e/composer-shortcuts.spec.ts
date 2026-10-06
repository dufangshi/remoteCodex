import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';

test('account shortcuts sync across devices and browsers and steer without an extra click', async ({
  browser,
}) => {
  const root = await mkdtemp(resolve('.local/composer-shortcuts-'));
  const processes: ChildProcess[] = [];
  const contexts: BrowserContext[] = [];
  const logs: string[] = [];
  const freePort = () =>
    new Promise<number>((done) => {
      const server = createServer();
      server.listen(0, '127.0.0.1', () => {
        const port = (server.address() as { port: number }).port;
        server.close(() => done(port));
      });
    });
  const base = `http://127.0.0.1:${await freePort()}`;
  const password = randomBytes(24).toString('hex');
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !key.startsWith('REMOTE_CODEX_'),
    ),
  );
  function start(command: string, extra: Record<string, string>) {
    const process = spawn(resolve('target/debug/remote-codex'), [command], {
      env: {
        ...env,
        HOST: '127.0.0.1',
        REMOTE_CODEX_E2E_FAKE_RUNTIME: '1',
        REMOTE_CODEX_ADMIN_USERNAME: 'testadmin',
        REMOTE_CODEX_ADMIN_PASSWORD: password,
        REMOTE_CODEX_SESSION_SECRET: randomBytes(32).toString('hex'),
        ...extra,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    process.stdout?.on('data', (data) => logs.push(String(data)));
    process.stderr?.on('data', (data) => logs.push(String(data)));
    processes.push(process);
  }
  async function api(path: string, token?: string, body?: unknown) {
    const response = await fetch(`${base}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10000),
    });
    expect(response.ok, `${path}: ${response.status}`).toBeTruthy();
    return response.json();
  }
  const settings = async (page: Page) => {
    await page
      .getByRole('button', { name: 'Open settings', exact: true })
      .click();
    await page.getByRole('tab', { name: 'Preferences', exact: true }).click();
  };
  try {
    start('relay', {
      PORT: new URL(base).port,
      REMOTE_CODEX_RELAY_DATA_DIR: join(root, 'relay'),
      REMOTE_CODEX_RELAY_REGISTRATION_ENABLED: 'true',
      REMOTE_CODEX_RELAY_WEB_DIST_DIR: resolve('apps/supervisor-web/dist'),
      REMOTE_CODEX_PUBLIC_BASE_URL: base,
    });
    await expect
      .poll(() =>
        fetch(`${base}/healthz`)
          .then((response) => response.status)
          .catch(() => 0),
      )
      .toBe(200);
    await api('/relay/auth/register', undefined, {
      username: 'shortcutowner',
      email: 'owner@example.test',
      password,
    });
    const { token } = await api('/relay/auth/login', undefined, {
      username: 'shortcutowner',
      password,
    });
    const threads: Array<{ deviceId: string; id: string; api: string }> = [];
    for (const name of ['First device', 'Second device']) {
      const created = await api('/relay/devices', token, { name });
      const port = String(await freePort());
      start('relay-supervisor', {
        PORT: port,
        REMOTE_CODEX_RELAY_SUPERVISOR_PORT: port,
        REMOTE_CODEX_RELAY_SERVER_URL: base,
        REMOTE_CODEX_RELAY_AGENT_TOKEN: created.token,
        REMOTE_CODEX_DATABASE_PATH: join(root, `${created.device.id}.sqlite`),
        REMOTE_CODEX_WORKSPACE_ROOT: join(root, created.device.id),
      });
      await expect
        .poll(async () => (await api('/healthz')).connectedSupervisors)
        .toBe(threads.length + 1);
      const path = `/relay/devices/${created.device.id}/api`;
      const absPath = join(root, 'workspace', created.device.id);
      await mkdir(absPath, { recursive: true });
      const workspace = await api(`${path}/workspaces`, token, {
        absPath,
        label: name,
      });
      const thread = await api(`${path}/threads/start`, token, {
        workspaceId: workspace.id,
        title: name,
        provider: 'acp',
        agentId: 'codex',
        model: 'ios-e2e-stream',
        approvalMode: 'yolo',
      });
      threads.push({
        deviceId: created.device.id,
        id: thread.id ?? thread.thread.id,
        api: path,
      });
    }
    const context = await browser.newContext();
    contexts.push(context);
    expect(
      (
        await context.request.post(`${base}/relay/auth/login`, {
          data: { username: 'shortcutowner', password },
        })
      ).ok(),
    ).toBeTruthy();
    const first = await context.newPage();
    await first.goto(
      `${base}/devices/${threads[0]!.deviceId}/threads/${threads[0]!.id}`,
    );
    const editor = first.getByRole('textbox', { name: 'Prompt', exact: true });
    await expect(editor).toBeVisible();
    await settings(first);
    await expect(
      first.getByRole('radio', { name: /^Ctrl\+Enter to send/ }),
    ).toBeChecked();
    await first.getByRole('radio', { name: /^Enter to send/ }).click();
    await expect(
      first.getByRole('radio', { name: /^Enter to send/ }),
    ).toBeChecked();
    await first.keyboard.press('Escape');
    await editor.fill('Chinese composition');
    await editor.evaluate((element) =>
      element.dispatchEvent(
        new CompositionEvent('compositionstart', { bubbles: true }),
      ),
    );
    await editor.press('Enter');
    await expect(editor).not.toHaveText('');
    expect(
      (await api(`${threads[0]!.api}/threads/${threads[0]!.id}`, token)).turns,
    ).toHaveLength(0);
    await editor.evaluate((element) =>
      element.dispatchEvent(
        new CompositionEvent('compositionend', { bubbles: true }),
      ),
    );
    await editor.fill('hello first line');
    await editor.press('Shift+Enter');
    await editor.press('b');
    await editor.press('Enter');
    await expect(editor).toHaveText('');
    await expect
      .poll(
        async () =>
          (await api(`${threads[0]!.api}/threads/${threads[0]!.id}`, token))
            .thread.status,
      )
      .toBe('idle');
    const firstDetail = await api(
      `${threads[0]!.api}/threads/${threads[0]!.id}`,
      token,
    );
    expect(
      firstDetail.turns[0].items.find(
        (item: any) => item.kind === 'userMessage',
      ).text,
    ).toBe('hello first line\nb');

    // A fresh browser uses the account choice on a different device.
    const otherContext = await browser.newContext();
    contexts.push(otherContext);
    expect(
      (
        await otherContext.request.post(`${base}/relay/auth/login`, {
          data: { username: 'shortcutowner', password },
        })
      ).ok(),
    ).toBeTruthy();
    const second = await otherContext.newPage();
    await second.goto(
      `${base}/devices/${threads[1]!.deviceId}/threads/${threads[1]!.id}`,
    );
    await settings(second);
    await expect(
      second.getByRole('radio', { name: /^Enter to send/ }),
    ).toBeChecked();
    await second.keyboard.press('Escape');
    const secondEditor = second.getByRole('textbox', {
      name: 'Prompt',
      exact: true,
    });
    const delivery = () =>
      api(`${threads[1]!.api}/threads/${threads[1]!.id}?view=delivery`, token);
    for (const [send, steer, correction] of [
      ['Enter', 'Control+Enter', 'Immediate enter-mode correction'],
      [
        'Control+Enter',
        'Control+Shift+Enter',
        'Immediate ctrl-mode correction',
      ],
    ]) {
      if (send === 'Control+Enter') {
        // Save in the other browser, then refresh the recipient's account preference.
        await settings(first);
        await first
          .getByRole('radio', { name: /^Ctrl\+Enter to send/ })
          .click();
        await expect(
          first.getByRole('radio', { name: /^Ctrl\+Enter to send/ }),
        ).toBeChecked();
        await first.keyboard.press('Escape');
        await second.reload();
        await settings(second);
        await expect(
          second.getByRole('radio', { name: /^Ctrl\+Enter to send/ }),
        ).toBeChecked();
        await second.keyboard.press('Escape');
        await secondEditor.fill('Inspect this repository in depth');
        await secondEditor.press('Enter');
        await expect(secondEditor).not.toHaveText('');
        expect((await delivery()).pendingSteers).toHaveLength(0);
      }
      await secondEditor.fill('Inspect this repository in depth');
      await secondEditor.press(send!);
      await expect
        .poll(async () => (await delivery()).thread.status)
        .toBe('running');
      const turnId = (await delivery()).thread.activeTurnId;
      await secondEditor.fill(correction!);
      await secondEditor.press(steer!);
      await expect(secondEditor).toHaveText('');
      await expect
        .poll(
          async () =>
            (
              await api(`${threads[1]!.api}/threads/${threads[1]!.id}`, token)
            ).turns
              .find((turn: any) => turn.id === turnId)
              ?.items.some(
                (item: any) =>
                  item.kind === 'userMessage' && item.text === correction,
              ) ?? false,
        )
        .toBe(true);
      const updated = await api(
        `${threads[1]!.api}/threads/${threads[1]!.id}`,
        token,
      );
      expect(updated.thread.activeTurnId).toBe(turnId);
      expect(
        updated.turns
          .find((turn: any) => turn.id === turnId)
          .items.filter(
            (item: any) =>
              item.kind === 'userMessage' && item.text === correction,
          ),
      ).toHaveLength(1);
      expect(
        updated.pendingSteers.filter(
          (item: any) => item.delivery === 'continuation',
        ),
      ).toHaveLength(0);
      await api(
        `${threads[1]!.api}/threads/${threads[1]!.id}/interrupt`,
        token,
        {},
      );
      await expect
        .poll(async () => (await delivery()).thread.status)
        .toBe('interrupted');
    }
  } catch (error) {
    console.error(logs.join(''));
    throw error;
  } finally {
    for (const context of contexts) await context.close();
    for (const process of processes) process.kill('SIGTERM');
    await Promise.all(
      processes.map((process) =>
        process.exitCode !== null
          ? Promise.resolve()
          : new Promise<void>((done) => process.once('exit', () => done())),
      ),
    );
    await rm(root, { recursive: true, force: true });
  }
});
