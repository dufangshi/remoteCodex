// Run inside an isolated container. Only synthetic threads are created; source auth is read-only.
// Required mounts: /source-codex (read-only auth/config), /repo (read-only), /probe (scratch).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';

const root = `/probe/run-${randomUUID()}`;
fs.mkdirSync(`${root}/codex`, { recursive: true, mode: 0o700 });
fs.mkdirSync(`${root}/workspace`);
fs.symlinkSync('/source-codex/auth.json', `${root}/codex/auth.json`);
// Retain the configured provider, but keep all stores and integrations isolated.
const original = fs.readFileSync('/source-codex/config.toml', 'utf8');
const sections = original.split(/(?=^\[)/m);
const config = sections.filter((section, index) => index === 0 || /^\[model_providers(?:\.|\])/.test(section)).join('')
  .replace(/^(?:sqlite_home|model|model_reasoning_effort|developer_instructions|model_instructions_file|instructions_file|cli_auth_credentials_store)\s*=.*\n/gm, '');
fs.writeFileSync(`${root}/codex/config.toml`, `model = "gpt-5.6-luna"\nmodel_reasoning_effort = "low"\nsqlite_home = "${root}/sqlite"\ncli_auth_credentials_store = "file"\n${config}`, { mode: 0o600 });
const env = { ...process.env, CODEX_HOME: `${root}/codex` };
const children = [];
const evidence = { root, model: 'gpt-5.6-luna', steps: [] };
const record = (stage, data) => { evidence.steps.push({ stage, ...data }); console.log(JSON.stringify({ stage, ...data })); };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function start(command, args, name, extraEnv = {}) {
  const log = fs.openSync(`${root}/${name}.stderr`, 'a');
  const child = spawn(command, args, { cwd: `${root}/workspace`, env: { ...env, ...extraEnv }, detached: true, stdio: ['pipe', 'pipe', log] });
  fs.closeSync(log);
  children.push(child);
  return child;
}
async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  process.kill(-child.pid, 'SIGTERM');
  await exited;
}
async function cli(prompt, threadId, expectSuccess = true) {
  const args = ['exec', ...(threadId ? ['resume', threadId] : []), '--skip-git-repo-check', '--json', '-m', evidence.model, prompt];
  const child = start('codex', args, `cli-${evidence.steps.length}`);
  child.stdin.end();
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; fs.appendFileSync(`${root}/cli-${evidence.steps.length}.live.jsonl`, chunk); });
  const timer = setTimeout(() => child.kill('SIGTERM'), 150000);
  const exit = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
  clearTimeout(timer);
  fs.writeFileSync(`${root}/cli-${evidence.steps.length}.jsonl`, output);
  if (expectSuccess) assert.equal(exit, 0, `CLI failed; inspect ${root}`);
  const events = output.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  if (!expectSuccess) record('cli-attempt', { exit, writerConflict: fs.readFileSync(`${root}/cli-${evidence.steps.length}.stderr`, 'utf8').includes('active writer') });
  return events;
}
function native(name, extraEnv = {}, extraArgs = []) {
  const child = start('codex', [...extraArgs, 'app-server'], name, extraEnv);
  let nextId = 0;
  const pending = new Map(), events = [];
  createInterface({ input: child.stdout }).on('line', line => {
    const message = JSON.parse(line);
    if (pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id); pending.delete(message.id);
      if (message.error) reject(Error(JSON.stringify(message.error))); else resolve(message.result);
    } else events.push(message);
  });
  const send = message => child.stdin.write(`${JSON.stringify(message)}\n`);
  const request = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timeout = setTimeout(() => { pending.delete(id); reject(Error(`${method} timed out`)); }, 120000);
    pending.set(id, { resolve: value => { clearTimeout(timeout); resolve(value); }, reject: error => { clearTimeout(timeout); reject(error); } });
    send({ id, method, params });
  });
  return {
    request,
    stop: () => stop(child),
    async init() { await request('initialize', { clientInfo: { name: 'isolated_sync_probe', version: '1.0' }, capabilities: { experimentalApi: true } }); send({ method: 'initialized' }); },
    async prompt(threadId, text) {
      const begin = events.length;
      const { turn } = await request('turn/start', { threadId, input: [{ type: 'text', text }], model: evidence.model });
      const end = Date.now() + 120000;
      while (Date.now() < end) {
        const completed = events.slice(begin).find(e => e.method === 'turn/completed' && e.params?.turn?.id === turn.id);
        if (completed) { assert.equal(completed.params.turn.status, 'completed'); return events.slice(begin).filter(e => e.method === 'item/completed' && e.params?.item?.type === 'agentMessage').map(e => e.params.item.text).join('\n'); }
        await pause(100);
      }
      throw Error('native turn timed out');
    },
  };
}
const base = 'http://127.0.0.1:19878';
async function api(path, body) {
  const response = await fetch(base + path, { ...(body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(150000) });
  const value = await response.json();
  assert.ok(response.ok, `${path}: ${response.status} ${JSON.stringify(value)}`);
  return value;
}
const texts = detail => detail.turns.flatMap(turn => turn.items.filter(item => ['userMessage', 'agentMessage'].includes(item.kind)).map(item => item.text));
async function remotePrompt(id, prompt) {
  const previous = new Set((await api(`/api/threads/${id}`)).turns.map(t => t.id));
  await api(`/api/threads/${id}/prompt`, { prompt });
  const end = Date.now() + 150000;
  while (Date.now() < end) {
    const detail = await api(`/api/threads/${id}`);
    const turn = detail.turns.find(t => !previous.has(t.id));
    if (turn && turn.status !== 'inProgress') { assert.equal(turn.status, 'completed', JSON.stringify(turn)); return detail; }
    await pause(300);
  }
  throw Error('Remote turn timed out');
}
try {
  const initial = await cli('Remember marker CLI_FIRST_47. Do not use tools. Reply only READY.');
  const threadId = initial.find(e => e.type === 'thread.started').thread_id;
  record('cli-created', { threadId });
  const app = native('desktop-equivalent'); await app.init();
  await app.request('thread/resume', { threadId });
  const supervisor = start('/repo/target/debug/remote-codex', ['supervisor'], 'supervisor', { PORT: '19878', HOST: '127.0.0.1', REMOTE_CODEX_MODE: 'local', DATABASE_URL: `${root}/supervisor.sqlite`, WORKSPACE_ROOT: `${root}/workspace`, REMOTE_CODEX_ENABLED_AGENT_PROVIDERS: 'codex', REMOTE_CODEX_E2E_FAKE_RUNTIME: '0' });
  supervisor.stdout.resume();
  for (let i = 0; ; i++) { try { await api('/healthz'); break; } catch (error) { if (i > 100) throw error; await pause(100); } }
  const imported = await api('/api/threads/import', { sessionId: threadId, provider: 'codex', agentId: 'codex' });
  const id = imported.thread.id;
  record('imported', { id, providerSessionId: imported.thread.providerSessionId, texts: texts(imported) });
  try {
    await api(`/api/threads/${id}/resume`, {});
    record('remote-resume-while-native-loaded', { accepted: true });
  } catch (error) {
    record('remote-resume-while-native-loaded', { accepted: false, error: error.message });
  }
  await app.stop();
  await cli('Remember marker CLI_AFTER_IMPORT_82. Do not use tools. Reply only READY.', threadId);
  const afterCli = await api(`/api/threads/${id}`);
  record('remote-after-cli-write', { seesCliAddition: texts(afterCli).some(t => t.includes('CLI_AFTER_IMPORT_82')), texts: texts(afterCli) });
  await api(`/api/threads/${id}/resume`, {});
  const remote = await remotePrompt(id, 'Remember marker WEB_NEW_93. Without tools, what was the CLI_AFTER_IMPORT marker? If absent reply ABSENT.');
  record('remote-model-context', { texts: texts(remote) });
  const reader = native('native-reader'); await reader.init();
  const existingRead = await reader.request('thread/read', { threadId, includeTurns: true });
  fs.writeFileSync(`${root}/native-existing-read.json`, JSON.stringify(existingRead, null, 2));
  record('existing-native-read-after-web', { seesWebAddition: JSON.stringify(existingRead).includes('WEB_NEW_93') });
  const concurrent = await cli('Without tools, what was the WEB_NEW marker? If absent reply ABSENT.', threadId, false);
  record('cli-resume-while-remote-loaded', { events: concurrent });
  await stop(supervisor);
  const resumed = await cli('Without tools, list the CLI_FIRST, CLI_AFTER_IMPORT, and WEB_NEW markers you remember. Use ABSENT for any missing marker.', threadId);
  record('fresh-cli-resume-context', { items: resumed.filter(e => e.type === 'item.completed' && e.item?.type === 'agent_message') });
  const fresh = native('fresh-reader'); await fresh.init();
  const freshRead = await fresh.request('thread/read', { threadId, includeTurns: true });
  fs.writeFileSync(`${root}/native-fresh-read.json`, JSON.stringify(freshRead, null, 2));
  record('fresh-native-read', { seesCliAddition: JSON.stringify(freshRead).includes('CLI_AFTER_IMPORT_82'), seesWebAddition: JSON.stringify(freshRead).includes('WEB_NEW_93') });
  // Model two hosts with shared rollouts but per-host SQLite, without ever sharing
  // the host's real databases or weakening its locks.
  await fresh.request('thread/resume', { threadId });
  fs.mkdirSync(`${root}/second-codex`, { mode: 0o700 });
  fs.symlinkSync('/source-codex/auth.json', `${root}/second-codex/auth.json`);
  fs.symlinkSync(`${root}/codex/sessions`, `${root}/second-codex/sessions`);
  fs.writeFileSync(`${root}/second-codex/config.toml`, fs.readFileSync(`${root}/codex/config.toml`, 'utf8').replace(`${root}/sqlite`, `${root}/second-sqlite`), { mode: 0o600 });
  const second = native('second-store', { CODEX_HOME: `${root}/second-codex` }); await second.init();
  try {
    await second.request('thread/resume', { threadId });
    record('separate-store-resume-while-first-loaded', { accepted: true });
    await fresh.prompt(threadId, 'Remember marker FIRST_STORE_19. Do not use tools. Reply only READY.');
    const secondReply = await second.prompt(threadId, 'Remember marker SECOND_STORE_26. Without tools, what is the FIRST_STORE marker? If absent reply ABSENT.');
    const firstReply = await fresh.prompt(threadId, 'Without tools, what is the SECOND_STORE marker? If absent reply ABSENT.');
    record('separate-store-context', { secondReply, firstReply });
    const firstHistory = await fresh.request('thread/read', { threadId, includeTurns: true });
    const secondHistory = await second.request('thread/read', { threadId, includeTurns: true });
    fs.writeFileSync(`${root}/separate-store-history.json`, JSON.stringify({ firstHistory, secondHistory }, null, 2));
    record('separate-store-history', { firstSeesSecond: JSON.stringify(firstHistory).includes('SECOND_STORE_26'), secondSeesFirst: JSON.stringify(secondHistory).includes('FIRST_STORE_19') });
  } catch (error) {
    record('separate-store-error', { error: error.message });
  }
  await second.stop();
  // Change only sqlite_home, keeping CODEX_HOME and every shared file identical.
  const sharedHome = native('same-home-separate-sqlite', {}, ['-c', `sqlite_home="${root}/third-sqlite"`]);
  await sharedHome.init();
  try {
    await sharedHome.request('thread/resume', { threadId });
    record('same-home-separate-sqlite-resume', { accepted: true });
    await fresh.prompt(threadId, 'Remember marker SHARED_HOME_FIRST_38. Do not use tools. Reply only READY.');
    const secondReply = await sharedHome.prompt(threadId, 'Remember marker SHARED_HOME_SECOND_54. Without tools, what is the SHARED_HOME_FIRST marker? If absent reply ABSENT.');
    const firstReply = await fresh.prompt(threadId, 'Without tools, what is the SHARED_HOME_SECOND marker? If absent reply ABSENT.');
    record('same-home-separate-sqlite-context', { secondReply, firstReply });
    const firstHistory = await fresh.request('thread/read', { threadId, includeTurns: true });
    const secondHistory = await sharedHome.request('thread/read', { threadId, includeTurns: true });
    fs.writeFileSync(`${root}/same-home-separate-sqlite-history.json`, JSON.stringify({ firstHistory, secondHistory }, null, 2));
    record('same-home-separate-sqlite-history', { firstSeesSecond: JSON.stringify(firstHistory).includes('SHARED_HOME_SECOND_54'), secondSeesFirst: JSON.stringify(secondHistory).includes('SHARED_HOME_FIRST_38') });
  } catch (error) {
    record('same-home-separate-sqlite-error', { error: error.message });
  }
} finally {
  fs.writeFileSync(`${root}/evidence.json`, JSON.stringify(evidence, null, 2));
  for (const child of children) await stop(child);
}
