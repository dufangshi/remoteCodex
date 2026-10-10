// Opt-in: real Grok ACP with a synthetic upstream, in Treer and a fresh HOME.
// node scripts/upstream-models-live.mjs /path/to/pockymoe /path/to/grok
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
assert.equal(process.platform, 'linux');
const [binary, grok] = process.argv.slice(2);
const apiType = process.env.TEST_GROK_API_TYPE ?? 'responses';
const inferencePath = apiType === 'chat_completions' ? '/chat/completions' : '/responses';
const effortOf = body => body.reasoning?.effort ?? body.reasoning_effort;
const isInference = call => call.url.endsWith(inferencePath)
  && (call.body.tool_choice?.name ?? call.body.tool_choice?.function?.name) !== 'session_title';
assert(path.isAbsolute(binary) && path.isAbsolute(grok));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upstream-models-live-'));
console.log(`Isolated evidence: ${root}`);
const home = path.join(root, 'home');
const workspace = path.join(root, 'workspace');
fs.mkdirSync(path.join(home, '.grok'), { recursive: true });
fs.mkdirSync(workspace);
const original = '# isolated original\n[ui]\nscreen_mode = "minimal"\n[model."grok-4.6"]\napi_key="original-key"\nenv_key="XAI_API_KEY"\n[model.personal]\nmodel="keep"\n';
fs.writeFileSync(path.join(home, '.grok/config.toml'), original);
const calls = [];
let buildEfforts = ['low', 'medium', 'high'];
let buildDefault = 'high';
const upstream = http.createServer(async (req, res) => {
  let body = '';
  for await (const b of req) body += b;
  calls.push({
    url: req.url,
    auth: req.headers.authorization,
    body: body ? JSON.parse(body) : null,
  });
  res.setHeader('Content-Type', 'application/json');
  if (req.url.endsWith('/models'))
    res.end(
      JSON.stringify({
        data: [{ id: 'grok-4.5' }, { id: 'grok-4.6' }, { id: 'route-*' }, {
          id: 'grok-build-0.1', display_name: 'Grok Build 0.1', supportsReasoningEffort: true,
          reasoningEffort: buildDefault,
          reasoningEfforts: buildEfforts.map(value => ({ value, label: value, default: value === buildDefault })),
        }],
      }),
    );
  else {
    // Prove routing without a paid inference. The expected turn ends in this synthetic error.
    res.statusCode = 400;
    res.end(
      JSON.stringify({
        error: {
          message: 'Synthetic upstream: routing verified',
          type: 'invalid_request_error',
        },
      }),
    );
  }
});
await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
const baseUrl = `http://127.0.0.1:${upstream.address().port}/v1`;
const portProbe = http.createServer();
await new Promise((r) => portProbe.listen(0, '127.0.0.1', r));
const port = portProbe.address().port;
await new Promise((r) => portProbe.close(r));
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) =>
      !/^(POCKYMOE_|CODEX_|CLAUDE_|GROK_|GEMINI_|ANTHROPIC_|OPENAI_|XAI_|GOOGLE_|XDG_)/.test(
        key,
      ),
  ),
);
Object.assign(env, {
  HOME: home,
  GROK_HOME: path.join(home, '.grok'),
  XAI_API_KEY: 'inherited-wrong-key',
  PATH: `${path.dirname(grok)}:${path.dirname(process.execPath)}:/usr/bin:/bin`,
  HOST: '127.0.0.1',
  PORT: String(port),
  POCKYMOE_MODE: 'local',
  POCKYMOE_ENABLED_AGENT_PROVIDERS: 'acp',
  POCKYMOE_DATABASE_PATH: path.join(root, 'test.sqlite'),
  POCKYMOE_WORKSPACE_ROOT: workspace,
  POCKYMOE_ACP_STARTUP_TIMEOUT_MS: '30000',
  POCKYMOE_RELAY_SUPERVISOR_CONFIG: path.join(root, 'unused.json'),
});
const log = fs.openSync(path.join(root, 'supervisor.log'), 'a');
const child = spawn(binary, ['supervisor'], {
  cwd: workspace,
  env,
  stdio: ['ignore', log, log],
});
fs.closeSync(log);
const base = `http://127.0.0.1:${port}`;
async function request(route, method = 'GET', body) {
  const r = await fetch(base + route, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(40000),
  });
  const value = await r.json();
  assert(r.ok, `${route}: ${r.status} ${JSON.stringify(value)}`);
  return value;
}
async function waitFor(fn) {
  const end = Date.now() + 45000;
  let last;
  while (Date.now() < end) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (e) {
      last = e;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw last ?? Error('Timed out');
}
try {
  await waitFor(() => request('/healthz'));
  const profile = await request('/api/management/upstreams', 'POST', {
    name: 'Provider label',
    harness: 'grok',
    baseUrl,
    apiKey: 'synthetic-a',
    model: 'grok-4.5',
    apiType,
  });
  await request(`/api/management/upstreams/${profile.id}`, 'POST', {
    action: 'activate',
  });
  const models = await request(
    `/api/agent-runtimes/acp/models?agentId=grok&cwd=${encodeURIComponent(workspace)}`,
  );
  assert.deepEqual(
    models.map((m) => m.model),
    ['grok-4.5', 'grok-4.6', 'grok-build-0.1'],
  );
  assert(!models.some((m) => m.displayName === 'Provider label'));
  assert.deepEqual(
    models
      .find((m) => m.model === 'grok-4.6')
      .supportedReasoningEfforts.map((e) => e.reasoningEffort),
    ['xhigh', 'high', 'medium', 'low'],
  );
  const ws = await request('/api/workspaces', 'POST', {
    absPath: workspace,
    label: 'Isolated model test',
  });
  const buildModel = models.find(m => m.model === 'grok-build-0.1');
  assert.deepEqual(buildModel.supportedReasoningEfforts.map(e => e.reasoningEffort), buildEfforts);
  assert.equal(buildModel.defaultReasoningEffort, 'high');
  const buildThread = await request('/api/threads/start', 'POST', {
    workspaceId: ws.id, provider: 'acp', agentId: 'grok', model: 'grok-build-0.1',
    reasoningEffort: 'low', approvalMode: 'yolo',
  });
  const checkBuild = async (effort, expected) => {
    await request(`/api/threads/${buildThread.id}/settings`, 'PATCH', { reasoningEffort: effort });
    const previous = calls.length;
    await request(`/api/threads/${buildThread.id}/prompt`, 'POST', { prompt: 'Reply OK' });
    const inference = await waitFor(() => calls.slice(previous).find(isInference));
    assert.equal(inference.body.model, 'grok-build-0.1');
    assert.equal(effortOf(inference.body), expected);
    await waitFor(async () => (await request(`/api/threads/${buildThread.id}`)).thread.status !== 'running');
  };
  await checkBuild('low', 'low');
  await request('/api/agent-runtimes/acp/restart?agentId=grok', 'POST');
  await checkBuild('auto', 'high');
  await checkBuild('high', 'high');
  await checkBuild('low', 'low');
  await checkBuild('auto', 'high');
  // Refresh the directory while a session still has the old capability snapshot.
  buildEfforts = ['low', 'medium']; buildDefault = 'medium';
  await request('/api/management/upstreams/models', 'POST', {
    id: profile.id, harness: 'grok', baseUrl, apiKey: 'synthetic-a',
  });
  const refreshed = await request(`/api/agent-runtimes/acp/models?agentId=grok&cwd=${encodeURIComponent(workspace)}`);
  assert.deepEqual(refreshed.find(m => m.model === 'grok-build-0.1').supportedReasoningEfforts.map(e => e.reasoningEffort), buildEfforts);
  await checkBuild('medium', 'medium');
  await request('/api/agent-runtimes/acp/restart?agentId=grok', 'POST');
  await checkBuild('low', 'low');
  await checkBuild('auto', 'medium');
  const thread = await request('/api/threads/start', 'POST', {
    workspaceId: ws.id,
    provider: 'acp',
    agentId: 'grok',
    model: 'grok-4.6',
    reasoningEffort: 'xhigh',
    approvalMode: 'yolo',
  });
  assert.equal(thread.model, 'grok-4.6');
  assert.equal(thread.reasoningEffort, 'xhigh');
  await request(`/api/threads/${thread.id}/prompt`, 'POST', {
    prompt: 'Reply OK',
  });
  // Grok also generates a title with its own model; inspect the actual agent turn.
  const inference = await waitFor(() =>
    calls.find(
      (c) =>
        isInference(c) && c.body.model === 'grok-4.6',
    ),
  );
  assert.equal(inference.body.model, 'grok-4.6');
  assert.equal(inference.auth, 'Bearer synthetic-a');
  assert.equal(effortOf(inference.body), 'xhigh');
  await waitFor(async () => {
    const detail = await request(`/api/threads/${thread.id}`);
    return (detail.thread ?? detail).status !== 'running';
  });
  const second = await request('/api/management/upstreams', 'POST', {
    name: 'Second provider',
    harness: 'grok',
    baseUrl,
    apiKey: 'synthetic-b',
    model: 'grok-4.5',
    apiType,
  });
  await request(`/api/management/upstreams/${second.id}`, 'POST', {
    action: 'activate',
  });
  await request(
    `/api/agent-runtimes/acp/models?agentId=grok&cwd=${encodeURIComponent(workspace)}`,
  );
  assert.equal(
    calls.findLast((c) => c.url.endsWith('/models')).auth,
    'Bearer synthetic-b',
  );
  await request(`/api/threads/${thread.id}/settings`, 'PATCH', {
    reasoningEffort: 'low',
  });
  const previous = calls.length;
  await request(`/api/threads/${thread.id}/prompt`, 'POST', {
    prompt: 'Reply OK again',
  });
  const resumed = await waitFor(() =>
    calls.slice(previous).find(
      isInference,
    ),
  );
  assert.equal(resumed.auth, 'Bearer synthetic-b');
  assert.equal(resumed.body.model, 'grok-4.6');
  assert.equal(effortOf(resumed.body), 'low');
  await waitFor(
    async () => (await request(`/api/threads/${thread.id}`)).thread.status !== 'running',
  );
  await request(`/api/management/upstreams/${second.id}`, 'DELETE');
  const state = await request('/api/management/upstreams');
  assert(!state.active.grok);
  assert(state.profiles.some((p) => p.id === profile.id));
  assert.equal(
    fs.readFileSync(path.join(home, '.grok/config.toml'), 'utf8'),
    original,
  );
  console.log(
    JSON.stringify({
      result: 'passed',
      realGrokModel: 'grok-4.6',
      discoveredModel: 'grok-build-0.1',
      autoReset: true, liveCatalogRefresh: true,
      harnessRestart: true, apiType,
      upstreamSwitch: true,
      originalConfigRestored: true,
      evidence: root,
    }),
  );
} finally {
  fs.writeFileSync(
    path.join(root, 'requests.json'),
    JSON.stringify(calls, null, 2),
  );
  child.kill('SIGTERM');
  upstream.closeAllConnections();
  await new Promise((r) => upstream.close(r));
}
