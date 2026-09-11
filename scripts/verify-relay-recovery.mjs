// Run in Docker with /repo mounted read-only. No host credentials are needed.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer, connect } from 'node:net';
import { once } from 'node:events';

assert(existsSync('/.dockerenv'), 'Pause/recovery probes must run in an isolated container');
const root = mkdtempSync('/tmp/relay-recovery-');
const binary = '/repo/target/debug/remote-codex';
const password = randomBytes(24).toString('hex');
const relay = 'http://127.0.0.1:19877';
const children = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function start(mode, extra) {
  const child = spawn(binary, [mode], { stdio: 'ignore', env: {
    PATH: process.env.PATH, HOST: '127.0.0.1',
    REMOTE_CODEX_E2E_FAKE_RUNTIME: '1',
    REMOTE_CODEX_ADMIN_USERNAME: 'testadmin', REMOTE_CODEX_ADMIN_PASSWORD: password,
    REMOTE_CODEX_SESSION_SECRET: randomBytes(32).toString('hex'),
    REMOTE_CODEX_RELAY_SESSION_SECRET: randomBytes(32).toString('hex'), ...extra,
  } });
  children.push(child);
  return child;
}
let token;
async function api(path, body) {
  const response = await fetch(`${relay}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(7000),
  });
  assert(response.ok, `HTTP ${response.status} at ${path}`);
  return response.json();
}
async function until(fn, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { const value = await fn(); if (value) return value; } catch { /* startup */ }
    await sleep(100);
  }
  assert.fail('Recovery condition timed out');
}
let network = true;
const streams = new Set();
const proxy = createServer(client => {
  if (!network) { client.destroy(); return; }
  const upstream = connect(19877, '127.0.0.1');
  for (const socket of [client, upstream]) {
    streams.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => streams.delete(socket));
  }
  client.pipe(upstream).pipe(client);
});
let supervisor;
try {
  start('relay', { PORT: '19877', REMOTE_CODEX_RELAY_DATA_DIR: `${root}/relay`, REMOTE_CODEX_RELAY_REGISTRATION_ENABLED: 'true' });
  await until(() => api('/healthz'));
  await api('/relay/auth/register', { username: 'owner', email: 'owner@example.test', password });
  token = (await api('/relay/auth/login', { username: 'owner', password })).token;
  const device = await api('/relay/devices', { name: 'Recovery fixture' });
  await new Promise(resolve => proxy.listen(19878, '127.0.0.1', resolve));
  supervisor = start('relay-supervisor', {
    PORT: '19879', REMOTE_CODEX_RELAY_SUPERVISOR_PORT: '19879',
    REMOTE_CODEX_RELAY_SERVER_URL: 'http://127.0.0.1:19878',
    REMOTE_CODEX_RELAY_AGENT_TOKEN: device.token,
    REMOTE_CODEX_DATABASE_PATH: `${root}/supervisor.sqlite`, REMOTE_CODEX_WORKSPACE_ROOT: `${root}/workspaces`,
  });
  const prefix = `/relay/devices/${device.device.id}`;
  await until(async () => (await api(`${prefix}/presence`)).connected);
  const health = () => api(`${prefix}/healthz`);
  const originalPid = (await health()).processId;
  const workspace = await api(`${prefix}/api/workspaces`, { label: 'Recovery', absPath: `${root}/workspace` });
  const created = await api(`${prefix}/api/threads/start`, { workspaceId: workspace.id, model: 'fake' });
  const threadId = created.thread?.id ?? created.id;
  await api(`${prefix}/api/threads/${threadId}/prompt`, { prompt: 'Inspect this repository while testing transport recovery.' });
  await until(async () => (await health()).activeTurnCount === 1);
  const before = (await api('/relay/portal')).devices[0].connectedAt;
  supervisor.kill('SIGSTOP');
  const pausedAt = Date.now();
  assert.equal((await api(`${prefix}/presence`)).connected, false);
  assert(Date.now() - pausedAt < 6000, 'Unreachable within five seconds plus HTTP overhead');
  await sleep(Math.max(0, 9000 - (Date.now() - pausedAt)));
  supervisor.kill('SIGCONT');
  const resumedAt = Date.now();
  await until(async () => (await api('/relay/portal')).devices[0].connectedAt !== before, 6000);
  const awake = await health();
  assert.equal(awake.processId, originalPid);
  assert.equal(awake.activeTurnCount, 1, 'Wake/reconnect must not interrupt the running turn');
  console.log(JSON.stringify({ stage: 'pause-resume', recoveredMs: Date.now() - resumedAt, sameProcess: true, turnStillRunning: true }));
  await until(async () => (await api(`${prefix}/api/threads/${threadId}`)).turns.some(t => t.status === 'completed'), 25000);
  // Blackhole both directions while leaving TCP open. Restore the network while
  // the same supervisor is retrying; no command is re-entered.
  network = false;
  for (const stream of streams) stream.pause();
  assert.equal((await api(`${prefix}/presence`)).connected, false);
  await sleep(1000);
  for (const stream of streams) stream.destroy();
  network = true;
  const restoredAt = Date.now();
  await until(async () => (await api(`${prefix}/presence`)).connected, 9000);
  assert.equal((await health()).processId, originalPid);
  console.log(JSON.stringify({ stage: 'network-restored', recoveredMs: Date.now() - restoredAt, sameProcess: true, turnCompleted: true }));
} finally {
  supervisor?.kill('SIGCONT');
  for (const socket of streams) socket.destroy();
  proxy.close();
  for (const child of children.reverse()) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    const exit = once(child, 'exit');
    child.kill('SIGTERM');
    await exit;
  }
}
