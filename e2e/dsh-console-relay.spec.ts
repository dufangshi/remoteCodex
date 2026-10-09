import { expect, test } from '@playwright/test';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import path from 'node:path';

// The native DSH console opened from a Relay page through an owner-only port
// preview: a separate Relay, a Relay-connected Supervisor running real DSH and
// the keyless scripted provider. The app and preview hosts are cross-site.
test.skip(
  process.env.E2E_REAL_DSH !== '1' || process.env.E2E_DSH_SCRIPTED !== '1',
  'Use E2E_REAL_DSH=1 E2E_DSH_SCRIPTED=1 with an isolated E2E_DSH_HOME and dsh on PATH',
);

const dshHome = path.resolve(process.env.E2E_DSH_HOME ?? '.local/missing-dsh-home');
const model = '["e2e-scripted","scripted"]';

function prepareProfile() {
  if (dshHome === path.join(homedir(), '.dsh')) throw new Error('E2E_DSH_HOME must not be the working DSH home');
  const profile = path.join(dshHome, 'profiles', 'acp');
  if (!existsSync(path.join(profile, 'package.json'))) {
    execFileSync('dsh', ['--profile', 'acp', '--dump-config'], { env: { ...process.env, DSH_HOME: dshHome }, stdio: 'ignore' });
  }
  const patch = path.join(profile, 'cordis.patch.yml');
  const current = readFileSync(patch, 'utf8');
  if (current.includes('remote-codex-e2e-scripted-llm')) return;
  const row = `- insert:\n    - id: remote-codex-e2e-scripted-llm\n      name: ${JSON.stringify(path.resolve('e2e/fixtures/dsh-scripted-llm.mjs'))}\n`;
  const rows = current.split('\n').filter(line => line.trim() && !line.trim().startsWith('#'));
  writeFileSync(patch, rows.join('').trim() === '[]' ? row : `${current.trimEnd()}\n${row}`);
}

test('opens the native DSH console from a Relay page', async ({ page, context }, testInfo) => {
  test.setTimeout(180_000);
  prepareProfile();
  await mkdir(path.resolve('.local'), { recursive: true });
  const root = await mkdtemp(path.resolve('.local/dsh-console-relay-'));
  const processes: ChildProcess[] = [];
  const logs: string[] = [];
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('REMOTE_CODEX_')));
  const password = randomBytes(24).toString('hex');
  const freePort = async () => {
    const server = createServer();
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
    const port = (server.address() as { port: number }).port;
    await new Promise<void>(done => server.close(() => done()));
    return port;
  };
  const rp = await freePort(), sp = await freePort();
  const base = `http://127.0.0.1:${rp}`;
  const binary = path.resolve(process.env.E2E_SECURITY_BINARY ?? 'target/debug/remote-codex');
  const start = (command: string, extra: Record<string, string>) => {
    const proc = spawn(binary, [command], {
      env: { ...env, HOST: '127.0.0.1', RUST_LOG: 'info',
        REMOTE_CODEX_ADMIN_USERNAME: 'admin', REMOTE_CODEX_ADMIN_PASSWORD: password,
        REMOTE_CODEX_SESSION_SECRET: randomBytes(32).toString('hex'),
        REMOTE_CODEX_RELAY_SESSION_SECRET: randomBytes(32).toString('hex'), ...extra },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    for (const output of [proc.stdout, proc.stderr]) output!.on('data', data => logs.push(String(data)));
    processes.push(proc);
  };
  const api = async (route: string, method = 'GET', data?: unknown, token?: string) => {
    const response = await fetch(base + route, { method,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(data ? { 'content-type': 'application/json' } : {}) },
      ...(data ? { body: JSON.stringify(data) } : {}), signal: AbortSignal.timeout(60_000) });
    const text = await response.text();
    return { status: response.status, data: text ? JSON.parse(text) : null };
  };
  try {
    start('relay', { PORT: String(rp), REMOTE_CODEX_RELAY_DATA_DIR: path.join(root, 'relay'),
      REMOTE_CODEX_RELAY_REGISTRATION_ENABLED: 'true', REMOTE_CODEX_RELAY_WEB_DIST_DIR: path.resolve('apps/supervisor-web/dist'),
      REMOTE_CODEX_PUBLIC_BASE_URL: base, REMOTE_CODEX_PORT_PREVIEW_BASE_URL: `http://preview.localhost:${rp}` });
    await expect.poll(() => api('/healthz').then(r => r.status).catch(() => 0)).toBe(200);
    expect((await api('/relay/auth/register', 'POST', { username: 'owner', email: 'owner@example.test', password })).status).toBe(200);
    const owner = (await api('/relay/auth/login', 'POST', { username: 'owner', password })).data.token as string;
    const created = await api('/relay/devices', 'POST', { name: 'DSH device' }, owner);
    const deviceId = created.data.device.id as string;
    start('relay-supervisor', { PORT: String(sp), REMOTE_CODEX_RELAY_SUPERVISOR_PORT: String(sp),
      REMOTE_CODEX_RELAY_SERVER_URL: base, REMOTE_CODEX_RELAY_AGENT_TOKEN: created.data.token,
      REMOTE_CODEX_DATABASE_PATH: path.join(root, 'device.sqlite'), REMOTE_CODEX_WORKSPACE_ROOT: path.join(root, 'workspaces'),
      REMOTE_CODEX_ENABLED_AGENT_PROVIDERS: 'acp', DSH_HOME: dshHome, DSH_TELEMETRY_DISABLED: '1' });
    await expect.poll(() => api('/healthz').then(r => r.data.connectedSupervisors)).toBe(1);
    const deviceApi = `/relay/devices/${deviceId}/api`;
    const work = path.join(root, 'workspace');
    await mkdir(work);
    const workspace = await api(`${deviceApi}/workspaces`, 'POST', { absPath: work, label: 'DSH relay' }, owner);
    const thread = await api(`${deviceApi}/threads/start`, 'POST',
      { workspaceId: workspace.data.id, provider: 'acp', agentId: 'deepseek', model, title: 'DSH over Relay', approvalMode: 'guarded' }, owner);
    expect(thread.status, JSON.stringify(thread.data)).toBe(200);
    const threadId = (thread.data.thread?.id ?? thread.data.id) as string;

    await context.addCookies([{ name: 'remote_codex_relay_session', value: owner, url: base }]);
    await page.goto(`${base}/devices/${deviceId}/threads/${threadId}`);
    await page.getByRole('button', { name: 'DeepSeek Harness', exact: true }).click();
    const panel = page.getByTestId('dsh-plugin-panel');
    await expect(panel.getByRole('combobox', { name: 'Run mode' })).toBeEnabled({ timeout: 60_000 });
    const [consolePage] = await Promise.all([
      context.waitForEvent('page'),
      panel.getByRole('button', { name: 'Open console' }).click(),
    ]);
    // Owner-only preview origin, launch ticket consumed, DSH's own login done.
    await consolePage.waitForURL(/^http:\/\/p-[0-9a-f]{32}\.preview\.localhost:\d+\/$/, { timeout: 30_000 });
    await consolePage.waitForTimeout(3000);
    await consolePage.screenshot({ path: testInfo.outputPath('dsh-console-over-relay.png') });
    await expect(consolePage.locator('body')).not.toContainText('authentication required');
    await expect(consolePage.getByRole('button', { name: /new session|新会话/i }).first()).toBeVisible();
    // Run modes come from the DSH server over the previewed WebSocket.
    await expect(consolePage.getByRole('button', { name: /standard mode|标准模式/i })).toBeVisible();
    const mappings = (await api(`${deviceApi}/port-mappings`, 'GET', undefined, owner)).data.mappings;
    expect(mappings.map((mapping: { label: string }) => mapping.label)).toEqual([`DSH console ${threadId.slice(0, 8)}`]);
    await consolePage.close();
  } finally {
    await testInfo.attach('isolated-services.log', { body: logs.join(''), contentType: 'text/plain' });
    await Promise.all(processes.map(proc => new Promise<void>(done => {
      if (proc.exitCode !== null || proc.signalCode !== null) return done();
      proc.once('exit', () => done()); proc.kill('SIGTERM');
      setTimeout(() => proc.kill('SIGKILL'), 2000).unref();
    })));
    await rm(root, { recursive: true, force: true });
  }
});
