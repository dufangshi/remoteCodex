import { expect, test, type APIRequestContext } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

// Real DSH through the bridge without model credentials: a scripted provider
// is inserted into the isolated E2E_DSH_HOME acp profile.
test.skip(
  process.env.E2E_REAL_DSH !== '1' || process.env.E2E_DSH_SCRIPTED !== '1',
  'Use E2E_REAL_DSH=1 E2E_DSH_SCRIPTED=1 with an isolated E2E_DSH_HOME and dsh on PATH',
);
test.describe.configure({ mode: 'serial' });

const base = `http://127.0.0.1:${process.env.E2E_API_PORT ?? 8787}`;
const model = '["e2e-scripted","scripted"]';
const dshHome = path.resolve(process.env.E2E_DSH_HOME ?? '.local/missing-dsh-home');
const profile = path.join(dshHome, 'profiles', 'acp');
const workspaceDir = path.resolve(process.env.E2E_WORKSPACE_ROOT ?? '.local/e2e-playwright', `dsh-bridge-${Date.now()}`);
let threadId = '';

test.beforeAll(async ({ request }) => {
  if (dshHome === path.join(homedir(), '.dsh')) throw new Error('E2E_DSH_HOME must not be the working DSH home');
  if (!existsSync(path.join(profile, 'package.json'))) {
    execFileSync('dsh', ['--profile', 'acp', '--dump-config'], { env: { ...process.env, DSH_HOME: dshHome }, stdio: 'ignore' });
  }
  const patch = path.join(profile, 'cordis.patch.yml');
  const current = readFileSync(patch, 'utf8');
  if (!current.includes('remote-codex-e2e-scripted-llm')) {
    const row = `- insert:\n    - id: remote-codex-e2e-scripted-llm\n      name: ${JSON.stringify(path.resolve('e2e/fixtures/dsh-scripted-llm.mjs'))}\n`;
    const rows = current.split('\n').filter(line => line.trim() && !line.trim().startsWith('#'));
    writeFileSync(patch, rows.join('').trim() === '[]' ? row : `${current.trimEnd()}\n${row}`);
  }
  mkdirSync(workspaceDir, { recursive: true });
  const workspace = await (await request.post(`${base}/api/workspaces`, { data: { absPath: workspaceDir, label: 'DSH bridge' } })).json();
  const thread = await (await request.post(`${base}/api/threads/start`, {
    data: { workspaceId: workspace.id, provider: 'acp', agentId: 'deepseek', model, title: 'DSH bridge', approvalMode: 'guarded' },
  })).json();
  expect(thread.model).toBe(model);
  threadId = thread.id;
});

const detail = async (request: APIRequestContext) => (await request.get(`${base}/api/threads/${threadId}`)).json();
const harness = async (request: APIRequestContext) =>
  (await (await request.get(`${base}/api/threads/${threadId}/capabilities`)).json()).negotiated.harness;
async function runTurn(request: APIRequestContext, prompt: string, data: Record<string, unknown> = {}) {
  const before = (await detail(request)).turns.length;
  const accepted = await request.post(`${base}/api/threads/${threadId}/prompt`, { data: { prompt, ...data } });
  expect(accepted.ok(), await accepted.text()).toBeTruthy();
  await expect.poll(async () => {
    const current = await detail(request);
    return current.turns.length > before && current.thread.status !== 'running' ? current.turns.at(-1).status : 'pending';
  }, { timeout: 60_000 }).toBe('completed');
  return (await detail(request)).turns.at(-1);
}

test('product read-only reaches the DSH sandbox', async ({ request }) => {
  expect((await request.patch(`${base}/api/threads/${threadId}/settings`, { data: { sandboxMode: 'read-only' } })).ok()).toBeTruthy();
  expect((await harness(request)).session.projections.permissions.currentValue).toBe('read-only');
  await runTurn(request, 'CALL bash {"description":"probe","command":"echo x > denied.txt"}');
  expect(existsSync(path.join(workspaceDir, 'denied.txt'))).toBe(false);
});

test('streams live text and keeps one committed answer', async ({ request }) => {
  const socket = new WebSocket(`${base.replace('http', 'ws')}/ws`);
  const deltas: string[] = [];
  socket.on('message', raw => {
    const event = JSON.parse(String(raw));
    if (event.threadId === threadId && event.type === 'thread.output.delta') deltas.push(event.payload.delta);
  });
  await new Promise(resolve => socket.once('open', resolve));
  const turn = await runTurn(request, 'stream please');
  socket.close();
  expect(deltas.length).toBeGreaterThan(1);
  expect(deltas.join('')).toBe('Plain answer SCRIPTED_OK for: stream please');
  expect(turn.items.filter((item: { kind: string }) => item.kind === 'agentMessage').map((item: { text: string }) => item.text))
    .toEqual(['Plain answer SCRIPTED_OK for: stream please']);
});

test('reviews a DSH plan in Remote Codex and follows its exit', async ({ request }) => {
  expect((await request.patch(`${base}/api/threads/${threadId}/settings`, { data: { collaborationMode: 'plan' } })).ok()).toBeTruthy();
  expect((await harness(request)).session.projections.plan.active).toBe(true);
  const accepted = await request.post(`${base}/api/threads/${threadId}/prompt`, {
    data: { prompt: 'CALL exit_plan_mode {"plan":"# Plan\\n- ship"}', collaborationMode: 'plan' },
  });
  expect(accepted.ok()).toBeTruthy();
  await expect.poll(async () => (await detail(request)).pendingRequests?.length ?? 0).toBe(1);
  const [review] = (await detail(request)).pendingRequests;
  expect(review.questions[0].options.map((option: { label: string }) => option.label)).toEqual(['Approve', 'Keep planning']);
  expect(review.questions[0].question).toContain('# Plan');
  const answer = { [review.questions[0].id]: { answers: ['Approve'] } };
  expect((await request.post(`${base}/api/threads/${threadId}/requests/${review.id}/respond`, { data: { allow: true, answers: answer } })).ok()).toBeTruthy();
  await expect.poll(async () => (await detail(request)).thread.status).toBe('idle');
  expect((await harness(request)).session.projections.plan.active).toBe(false);
  expect((await detail(request)).thread.collaborationMode).toBe('default');
});

test('keeps goal rounds inside one stoppable turn', async ({ request }) => {
  const accepted = await request.post(`${base}/api/threads/${threadId}/prompt`, { data: { prompt: 'CALL create_goal {"objective":"e2e goal"}' } });
  expect(accepted.ok()).toBeTruthy();
  await expect.poll(async () => {
    const turn = (await detail(request)).turns.at(-1);
    return turn.items.filter((item: { text: string }) => /Round: \d+/.test(item.text)).length;
  }, { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
  const running = await detail(request);
  expect(running.thread.status).toBe('running');
  expect(running.goal.objective).toBe('e2e goal');
  expect((await request.post(`${base}/api/threads/${threadId}/interrupt`, { data: {} })).ok()).toBeTruthy();
  await expect.poll(async () => (await detail(request)).turns.at(-1).status).toBe('interrupted');
  await expect.poll(async () => (await harness(request)).session.projections.goal.goal.phase).toBe('paused');
  expect((await harness(request)).session.running).toBe(false);
});

test('panel toggles a plugin after backing up the profile', async ({ page, request }) => {
  const backups = path.join(profile, '.remote-codex', 'backups');
  const before = existsSync(backups) ? readdirSync(backups).length : 0;
  await page.goto(`/threads/${threadId}`);
  await page.getByRole('button', { name: 'Open slash toolbox' }).click();
  await page.getByRole('button', { name: /\/harness/ }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Harness settings' });
  await expect(dialog.getByText(/DeepSeek Harness .* acp profile/)).toBeVisible();
  await expect(dialog.getByText('e2e goal · paused', { exact: false })).toBeVisible();
  await dialog.getByLabel('Filter plugins').fill('repeat-tool-reminder');
  const plugin = dialog.getByRole('checkbox', { name: 'Enable @deepseek-ai/dsh-repeat-tool-reminder' });
  await plugin.uncheck();
  await expect(dialog.getByRole('button', { name: 'Reconnect to apply' })).toBeVisible();
  expect(readdirSync(backups).length).toBe(before + 1);
  expect(readFileSync(path.join(profile, 'cordis.patch.yml'), 'utf8')).toContain('id: repeat-tool-reminder');
  const restored = await (await request.post(`${base}/api/threads/${threadId}/harness`, {
    data: { kind: 'setPluginEnabled', id: 'include:repeat-tool-reminder', enabled: true },
  })).json();
  expect(restored.result.application).toBe('restart-required');
  const blocked = await request.post(`${base}/api/threads/${threadId}/harness`, {
    data: { kind: 'setBundleEnabled', name: '@deepseek-ai/dsh-headless', enabled: true },
  });
  expect(blocked.ok()).toBeFalsy();
});
