import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import {
  api,
  ensureWorkspaceDir,
  spawnBin,
  stopProc,
  waitForHealth,
} from './helpers';

test('owner manages member permissions and immutable public links survive device disconnect', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const relayBase = 'http://127.0.0.1:18921';
  const dataDir = path.resolve(`.local/public-links-${randomUUID()}`);
  const password = 'Public-links-fixture-47!';
  const bin = path.resolve('target/debug/remote-codex');
  const relay = spawnBin(bin, ['relay'], {
    PORT: '18921',
    HOST: '127.0.0.1',
    REMOTE_CODEX_RELAY_DATA_DIR: dataDir,
    REMOTE_CODEX_RELAY_WEB_DIST_DIR: path.resolve('apps/supervisor-web/dist'),
    REMOTE_CODEX_PUBLIC_BASE_URL: relayBase,
    REMOTE_CODEX_ADMIN_USERNAME: 'admin',
    REMOTE_CODEX_ADMIN_PASSWORD: password,
    REMOTE_CODEX_RELAY_REGISTRATION_ENABLED: 'true',
  });
  let supervisor: ReturnType<typeof spawnBin> | undefined;
  try {
    await waitForHealth(relayBase);
    const login = await api<any>(relayBase, '/relay/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        username: 'owner',
        email: 'owner@example.test',
        password,
      }),
    });
    const headers = { Authorization: `Bearer ${login.token}` };
    const member = await api<any>(relayBase, '/relay/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        username: 'reviewer',
        email: 'reviewer@example.test',
        password,
      }),
    });
    const created = await api<any>(relayBase, '/relay/devices', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Snapshot fixture' }),
    });
    const deviceId = created.device.id;
    supervisor = spawnBin(bin, ['relay-supervisor'], {
      REMOTE_CODEX_RELAY_SUPERVISOR_PORT: '18922',
      PORT: '18922',
      HOST: '127.0.0.1',
      REMOTE_CODEX_MODE: 'relay',
      REMOTE_CODEX_E2E_FAKE_RUNTIME: '1',
      REMOTE_CODEX_RELAY_SERVER_URL: relayBase,
      REMOTE_CODEX_RELAY_AGENT_TOKEN: created.token,
      REMOTE_CODEX_DATABASE_PATH: path.join(dataDir, 'supervisor.sqlite'),
      REMOTE_CODEX_WORKSPACE_ROOT: path.join(dataDir, 'workspaces'),
    });
    let startupError = '';
    supervisor.stderr?.on('data', (chunk) => {
      startupError += String(chunk).replaceAll(created.token, '[token]');
    });
    await expect
      .poll(async () => {
        if (supervisor?.exitCode != null) throw new Error(startupError);
        return (await api<any>(relayBase, '/healthz')).connectedSupervisors;
      })
      .toBeGreaterThan(0);
    const deviceApi = `${relayBase}/relay/devices/${deviceId}/api`;
    const call = <T = any>(url: string, init: RequestInit = {}) =>
      api<T>(deviceApi, url, {
        ...init,
        headers: { ...headers, ...init.headers },
      });
    const absPath = await ensureWorkspaceDir(dataDir, 'workspace');
    const workspace = await call('/workspaces', {
      method: 'POST',
      body: JSON.stringify({ absPath, label: 'Link review' }),
    });
    const thread = await call('/threads/start', {
      method: 'POST',
      body: JSON.stringify({
        workspaceId: workspace.id,
        title: 'Public snapshot regression',
        provider: 'codex',
        model: 'ios-e2e-stream',
        approvalMode: 'yolo',
      }),
    });
    const attachmentDir=path.join(absPath,'.temp/threads',thread.id);await mkdir(attachmentDir,{recursive:true});
    const imagePath = `./.temp/threads/${thread.id}/snapshot.png`;
    await writeFile(path.join(absPath,imagePath), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX9sAAAAASUVORK5CYII=', 'base64'));
    const prompt = `hello, reply me with hello [PHOTO ${imagePath}]`;
    await call(`/threads/${thread.id}/prompt`, {
      method: 'POST',
      body: JSON.stringify({ prompt }),
    });
    await expect
      .poll(async () => (await call(`/threads/${thread.id}`)).thread.status)
      .toBe('idle');
    await api(relayBase, '/relay/shares', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        deviceId,
        threadId: thread.id,
        threadTitle: thread.title,
        targetIdentifier: 'reviewer',
        threadAccess: 'read',
        workspaceAccess: 'none',
      }),
    });
    await page.context().addCookies([{name:'remote_codex_relay_session',value:login.token,url:relayBase}]);
    await page.goto(`${relayBase}/devices/${deviceId}/threads/${thread.id}`);
    await expect(page.getByLabel('1 people shared')).toBeVisible();
    await page
      .getByRole('button', { name: 'Thread actions', exact: true })
      .click();
    const dialog = page.getByRole('dialog', {
      name: 'Thread actions',
      exact: true,
    });
    await expect(dialog.getByText('reviewer', { exact: true })).toBeVisible();
    await dialog
      .getByRole('button', { name: 'Edit permissions for reviewer' })
      .click();
    await dialog.getByLabel('Collaborator', { exact: true }).check();
    await dialog.getByLabel('Read and edit', { exact: true }).check();
    await dialog
      .getByRole('button', { name: 'Save permissions', exact: true })
      .click();
    await expect(
      dialog.getByText('Collaborator / Workspace write', { exact: false }),
    ).toBeVisible();
    const portal = await api<any>(relayBase, '/relay/portal', { headers });
    expect(portal.sharedByMe[0].workspaceAccess).toBe('write');
    await expect(dialog.getByRole('button', {name:'PDF',exact:true})).toHaveCount(0);
    await dialog.getByRole('button', { name: 'HTML', exact: true }).click();
    await expect(
      dialog.getByRole('button', { name: 'Export HTML', exact: true }),
    ).toBeVisible();
    await dialog
      .getByRole('button', { name: 'Share as link', exact: true })
      .click();
    await dialog
      .getByRole('button', { name: 'Create share link', exact: true })
      .click();
    const linkInput = dialog.getByRole('textbox', { name: 'Public share URL' });
    await expect(linkInput).toBeVisible();
    const linkId = (await linkInput.inputValue()).split('/').at(-1)!;
    const original = await api<any>(relayBase, `/relay/public-links/${linkId}`);
    expect(original.turnCount).toBe(1);
    expect(original.images[imagePath]).toMatch(/^data:image\/png;base64,/);
    expect(['dark', 'light']).toContain(original.theme);
    expect(original.turns[0].startedAt).toBeTruthy();
    expect(original.turns[0].completedAt).toBeTruthy();
    expect(original.turns[0].model).toBeTruthy();
    expect(original.turns[0].messages.map((m: any) => m.text)).toEqual([
      prompt,
      'hello',
    ]);
    expect(JSON.stringify(original)).not.toContain('workspaceId');
    const forbidden = await fetch(relayBase + '/relay/thread-links', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${member.token}`,
      },
      body: JSON.stringify({ deviceId, threadId: thread.id }),
    });
    expect(forbidden.status).toBe(404);
    const forbiddenDelete = await fetch(
      `${relayBase}/relay/public-links/${linkId}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${member.token}` },
      },
    );
    expect(forbiddenDelete.status).toBe(404);
    await call(`/threads/${thread.id}/prompt`, {
      method: 'POST',
      body: JSON.stringify({ prompt: 'Later private prompt' }),
    });
    await expect
      .poll(async () => (await call(`/threads/${thread.id}`)).thread.status)
      .toBe('idle');
    expect(await api(relayBase, `/relay/public-links/${linkId}`)).toEqual(
      original,
    );
    await page.screenshot({ path: testInfo.outputPath('share-links.png') });
    await stopProc(supervisor);
    supervisor = undefined;
    await page.goto(`${relayBase}/s/${linkId}`);
    await expect(
      page.getByRole('heading', { name: 'Public snapshot regression' }),
    ).toBeVisible();
    await expect(
      page.locator('[data-role="assistant"] .thread-graph-message-content'),
    ).toHaveText('hello');
    await expect(page.locator('img')).toHaveCount(1);
    expect(await page.locator('img').evaluate((image: HTMLImageElement)=>image.complete && image.naturalWidth>0)).toBe(true);
    await expect(page.locator('.thread-graph-worked-summary')).toContainText(
      'Worked for',
    );
    await expect(page.getByRole('button', { name: /Expand turn/ })).toHaveCount(
      0,
    );
    await expect(
      page.getByRole('textbox', { name: 'Prompt', exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText('Later private prompt', { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Workspace', exact: true }),
    ).toHaveCount(0);
    await api(relayBase, `/relay/public-links/${linkId}`, {
      method: 'DELETE',
      headers,
    });
    await page.reload();
    await expect(
      page.getByText('This share link is unavailable or has been revoked.'),
    ).toBeVisible();
  } finally {
    await stopProc(supervisor);
    await stopProc(relay);
  }
});
