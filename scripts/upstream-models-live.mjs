// Opt-in: real Grok ACP with a synthetic upstream, in Treer and a fresh HOME.
// node scripts/upstream-models-live.mjs /path/to/remote-codex /path/to/grok
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
assert.equal(process.platform, 'linux');
const [binary, grok] = process.argv.slice(2);
assert(path.isAbsolute(binary) && path.isAbsolute(grok));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upstream-models-live-'));
console.log(`Isolated evidence: ${root}`);
const home = path.join(root, 'home');
const workspace = path.join(root, 'workspace');
fs.mkdirSync(path.join(home, '.grok'), { recursive: true });
fs.mkdirSync(workspace);
const original = '# isolated original\n[ui]\nscreen_mode = "minimal"\n';
fs.writeFileSync(path.join(home, '.grok/config.toml'), original);
const calls = [];
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
        data: [{ id: 'model-a' }, { id: 'model-b' }, { id: 'route-*' }],
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
      !/^(REMOTE_CODEX_|CODEX_|CLAUDE_|GROK_|GEMINI_|ANTHROPIC_|OPENAI_|GOOGLE_|XDG_)/.test(
        key,
      ),
  ),
);
Object.assign(env, {
  HOME: home,
  GROK_HOME: path.join(home, '.grok'),
  PATH: `${path.dirname(grok)}:${path.dirname(process.execPath)}:/usr/bin:/bin`,
  HOST: '127.0.0.1',
  PORT: String(port),
  REMOTE_CODEX_MODE: 'local',
  REMOTE_CODEX_ENABLED_AGENT_PROVIDERS: 'acp',
  REMOTE_CODEX_DATABASE_PATH: path.join(root, 'test.sqlite'),
  REMOTE_CODEX_WORKSPACE_ROOT: workspace,
  REMOTE_CODEX_ACP_STARTUP_TIMEOUT_MS: '30000',
  REMOTE_CODEX_RELAY_SUPERVISOR_CONFIG: path.join(root, 'unused.json'),
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
    model: 'model-a',
  });
  await request(`/api/management/upstreams/${profile.id}`, 'POST', {
    action: 'activate',
  });
  const models = await request(
    `/api/agent-runtimes/acp/models?agentId=grok&cwd=${encodeURIComponent(workspace)}`,
  );
  assert.deepEqual(
    models.map((m) => m.model),
    ['model-a', 'model-b'],
  );
  assert(!models.some((m) => m.displayName === 'Provider label'));
  const ws = await request('/api/workspaces', 'POST', {
    absPath: workspace,
    label: 'Isolated model test',
  });
  const thread = await request('/api/threads/start', 'POST', {
    workspaceId: ws.id,
    provider: 'acp',
    agentId: 'grok',
    model: 'model-b',
    approvalMode: 'yolo',
  });
  assert.equal(thread.model, 'model-b');
  await request(`/api/threads/${thread.id}/prompt`, 'POST', {
    prompt: 'Reply OK',
  });
  // Grok also generates a title with its own model; inspect the actual agent turn.
  const inference = await waitFor(() =>
    calls.find(
      (c) =>
        c.url.endsWith('/responses') &&
        c.body.tool_choice?.name !== 'session_title',
    ),
  );
  assert.equal(inference.body.model, 'model-b');
  assert.equal(inference.auth, 'Bearer synthetic-a');
  await waitFor(async () => {
    const detail = await request(`/api/threads/${thread.id}`);
    return (detail.thread ?? detail).status !== 'running';
  });
  const second = await request('/api/management/upstreams', 'POST', {
    name: 'Second provider',
    harness: 'grok',
    baseUrl,
    apiKey: 'synthetic-b',
    model: 'model-a',
  });
  await request(`/api/management/upstreams/${second.id}`, 'POST', {
    action: 'activate',
  });
  await request(
    `/api/agent-runtimes/acp/models?agentId=grok&cwd=${encodeURIComponent(workspace)}`,
  );
  assert.equal(calls.at(-1).auth, 'Bearer synthetic-b');
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
      realGrokModel: 'model-b',
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
