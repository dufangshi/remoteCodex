// Opt-in Linux/container test. Uses real Codex tokens; never targets an existing Supervisor.
// Only release distribution is local: the production API, updater, npm, native launcher,
// independent worker, SQLite journal and ACP session all run unmodified.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
const { values: options } = parseArgs({ options: {
  'seed-binary': { type: 'string' }, 'candidate-binary': { type: 'string' },
  directory: { type: 'string' }, prefix: { type: 'string' },
  model: { type: 'string', default: 'gpt-5.6-luna' },
  'allow-token-use': { type: 'boolean', default: false },
} });
if (process.platform !== 'linux' || !options['allow-token-use'] || !options.directory || !options.prefix || !options['seed-binary'] || !options['candidate-binary'])
  throw Error('Run in the isolated Linux test machine with --allow-token-use, --directory, --prefix, --seed-binary and --candidate-binary.');
const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../npm/remote-codex');
const directory = fs.mkdtempSync(path.join(path.resolve(options.directory), 'live-'));
const workspace = path.join(directory, 'workspace');
fs.mkdirSync(workspace);
const prefix = path.resolve(options.prefix);
const npm = path.join(prefix, 'lib/node_modules/npm/bin/npm-cli.js');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function run(program, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { env, cwd: directory, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', error = '';
    child.stdout.on('data', data => out += data);
    child.stderr.on('data', data => error += data);
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve(out.trim()) : reject(Error(`${program}: ${code}: ${error.slice(-3000)}`)));
  });
}
async function until(check, timeout = 180000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { const value = await check(); if (value) return value; await pause(500); }
  throw Error('Timed out waiting for live update verification');
}
const artifacts = new Map();
let metadata;
const registry = http.createServer((req, res) => {
  if (req.url === '/remote-codex/latest' || req.url === '/remote-codex') {
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify(req.url.endsWith('latest') ? metadata : { name: 'remote-codex', 'dist-tags': { latest: metadata.version }, versions: { [metadata.version]: metadata } }));
  }
  const file = artifacts.get(req.url);
  if (!file) { res.statusCode = 404; return res.end(); }
  fs.createReadStream(file).pipe(res);
});
await new Promise(resolve => registry.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${registry.address().port}`;
const probe = http.createServer();
await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
const apiBase = `http://127.0.0.1:${port}`;
let ownedPid;
let env;
async function api(route, body) {
  const response = await fetch(apiBase + route, { method: body ? 'POST' : 'GET', headers: body ? {'Content-Type':'application/json', Origin:apiBase} : {}, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
  const raw = await response.text();
  let result;
  try { result = JSON.parse(raw); } catch { throw Error(`${route}: ${response.status}: ${raw.slice(0,1000)}`); }
  if (!response.ok) throw Error(`${route}: ${response.status}: ${JSON.stringify(result)}`);
  return result;
}
try {
  const versions = [];
  for (const kind of ['seed', 'candidate']) {
    const binary = path.resolve(options[`${kind}-binary`]);
    const version = await run(binary, ['version']);
    versions.push(version);
    const pkg = path.join(directory, kind);
    fs.mkdirSync(pkg);
    fs.cpSync(path.join(source, 'bin'), path.join(pkg, 'bin'), {recursive:true});
    fs.mkdirSync(path.join(pkg, 'web'));
    fs.writeFileSync(path.join(pkg, 'web/index.html'), '<!doctype html><title>Isolated update test</title>');
    fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({name:'remote-codex',version,type:'module',bin:{'remote-codex':'bin/remote-codex.mjs'}}));
    const name = `remote-codex-${kind}`;
    const hash = crypto.createHash('sha256').update(fs.readFileSync(binary)).digest('hex');
    artifacts.set(`/${version}/${name}`, binary);
    fs.writeFileSync(path.join(pkg, 'native-manifest.json'), JSON.stringify({version,releaseBaseUrl:`${base}/${version}`,assets:{[`linux-${process.arch}-gnu`]:{name,sha256:hash}}}));
    const packed = JSON.parse(await run(process.execPath, [npm, 'pack', pkg, '--json', '--pack-destination', directory]));
    const tarball = path.join(directory, packed[0].filename);
    if (kind === 'seed') await run(process.execPath, [npm, 'install', '--global', '--prefix', prefix, tarball, '--no-audit', '--no-fund']);
    else {
      const route = `/remote-codex/-/${packed[0].filename}`;
      artifacts.set(route, tarball);
      metadata = {name:'remote-codex',version,dist:{tarball:base+route,shasum:packed[0].shasum,integrity:packed[0].integrity}};
    }
  }
  if (versions[0] === versions[1]) throw Error('Use two distinct, isolated test binary versions');
  // Redirect only npm's latest lookup; no restart/recovery implementation is mocked.
  const hook = path.join(directory, 'registry-hook.mjs');
  fs.writeFileSync(hook, `const fetchOriginal=globalThis.fetch;globalThis.fetch=(url,opts)=>fetchOriginal(url==='https://registry.npmjs.org/remote-codex/latest'?'${base}/remote-codex/latest':url,opts);`);
  env = { ...process.env, NODE_OPTIONS:`--import=${hook}`, npm_config_registry:base,
    REMOTE_CODEX_MODE:'local', SERVICE_HOST:'127.0.0.1', SERVICE_PORT:String(port),
    REMOTE_CODEX_SERVICE_DIR:path.join(directory,'service'), DATABASE_URL:path.join(directory,'test.sqlite'),
    WORKSPACE_ROOT:workspace, REMOTE_CODEX_NATIVE_CACHE_DIR:path.join(directory,'native'),
    REMOTE_CODEX_ENABLED_AGENT_PROVIDERS:'codex',
  };
  delete env.REMOTE_CODEX_NATIVE_BINARY;
  delete env.REMOTE_CODEX_E2E_FAKE_RUNTIME;
  const launcher = path.join(prefix, 'lib/node_modules/remote-codex/bin/remote-codex.mjs');
  await run(process.execPath, [launcher,'start'], env);
  const before = await api('/healthz');
  ownedPid = before.processId;
  const ws = await api('/api/workspaces',{absPath:workspace,label:'Supervisor update live test'});
  const thread = await api('/api/threads/start',{workspaceId:ws.id,title:'Restart recovery verification',provider:'codex',model:options.model,reasoningEffort:'low',approvalMode:'yolo'});
  const id = thread.id ?? thread.thread?.id;
  if (!id) throw Error(`Missing thread ID: ${JSON.stringify(thread)}`);
  console.log(JSON.stringify({phase:'started',directory,thread:id,pid:ownedPid,versions}));
  const prompt = 'This is an authorized Supervisor restart recovery test. In the current directory, create checkpoint.txt with exactly five numbered lines 1 through 5, each once and in order. Work in separate tool calls: inspect checkpoint.txt, append the next missing number, then sleep 15 seconds before the next append. A Supervisor update may interrupt you. When resumed, inspect the existing file and continue from the next missing number without duplicating lines. After all five lines exist, write recovery-complete.txt containing RECOVERY_OK and reply RECOVERY_OK. Use terminal tools, not a background job.';
  await api(`/api/threads/${id}/prompt`, {prompt});
  await until(() => fs.existsSync(path.join(workspace,'checkpoint.txt')));
  const prior = await api(`/api/threads/${id}`);
  if (prior.thread.status !== 'running') throw Error(`Thread was not running: ${prior.thread.status}`);
  const check = await api('/api/management/supervisor/check',{});
  if (check.latestVersion !== versions[1]) throw Error('Candidate not detected');
  const accepted = await api('/api/management/supervisor/update',{});
  console.log(JSON.stringify({phase:'accepted',job:accepted.job,session:prior.thread.providerSessionId}));
  const after = await until(async () => {
    try { const value = await api('/healthz'); return value.runningVersion === versions[1] && value.processId !== before.processId ? value : false; } catch { return false; }
  });
  ownedPid = after.processId;
  const completed = await until(async () => {
    const detail = await api(`/api/threads/${id}`);
    if (detail.thread.lastError) throw Error(detail.thread.lastError);
    return fs.existsSync(path.join(workspace,'recovery-complete.txt')) && detail.thread.status === 'idle' ? detail : false;
  },240000);
  if (completed.thread.providerSessionId !== prior.thread.providerSessionId) throw Error('Provider session changed');
  if (completed.thread.sandboxMode !== 'danger-full-access') throw Error('Full access was lost');
  if (!completed.turns.some(turn => turn.status === 'interrupted') || !completed.turns.some(turn => turn.status === 'completed')) throw Error('Missing interrupted and recovered turn history');
  const lines = fs.readFileSync(path.join(workspace,'checkpoint.txt'),'utf8').trim().split(/\r?\n/);
  if (JSON.stringify(lines) !== JSON.stringify(['1','2','3','4','5'])) throw Error(`Repeated or lost work: ${JSON.stringify(lines)}`);
  const status = await until(async () => { const value = await api('/api/management/supervisor'); return value.job?.phase === 'completed' ? value : false; });
  const result = {ok:true,directory,thread:id,session:completed.thread.providerSessionId,before,after,job:status.job,turns:completed.turns.map(t=>({id:t.id,status:t.status})),checkpoint:lines};
  fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
} finally {
  // Only the dedicated Supervisor started by this test is stopped.
  if (ownedPid) { try { process.kill(ownedPid,'SIGTERM'); } catch {} }
  registry.closeAllConnections();
  registry.close();
}
