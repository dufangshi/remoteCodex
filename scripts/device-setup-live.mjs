// Opt-in, isolated Linux acceptance test. Run inside Treer, never the host HOME.
// node scripts/device-setup-live.mjs /absolute/path/to/candidate-binary
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const binary = process.argv[2];
assert(process.platform === 'linux' && path.isAbsolute(binary));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-codex-setup-live-'));
console.log(`Isolated evidence: ${root}`);
const home = path.join(root, 'home');
fs.mkdirSync(home);
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([k]) =>
      !/^(REMOTE_CODEX_|CODEX_|CLAUDE_|GROK_|GEMINI_|ANTHROPIC_|OPENAI_|GOOGLE_|npm_|NPM_|XDG_)/.test(
        k,
      ),
  ),
);
Object.assign(env, {
  HOME: home,
  PATH: '/usr/bin:/bin',
  REMOTE_CODEX_NATIVE_BINARY: binary,
  REMOTE_CODEX_DATABASE_PATH: path.join(root, 'device.sqlite'),
  REMOTE_CODEX_WORKSPACE_ROOT: path.join(root, 'workspaces'),
  REMOTE_CODEX_RELAY_SUPERVISOR_CONFIG: path.join(
    home,
    '.remote-codex/relay-supervisor.json',
  ),
});
const children = [],
  servers = [],
  devicePids = [];
const listen = async (handler) => {
  const s = http.createServer(handler);
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  servers.push(s);
  return `http://127.0.0.1:${s.address().port}`;
};
const freePort = async () => {
  const s = http.createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function poll(fn, timeout = 30000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) {
      last = e;
    }
    await pause(300);
  }
  throw last ?? Error('Timed out');
}
async function run(cmd, args, extra = {}) {
  return await new Promise((resolve, reject) => {
    const p = spawn(cmd, args, {
      cwd: home,
      env: { ...env, ...extra },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    p.stdout.on('data', (b) => (out += b));
    p.stderr.on('data', (b) => (out += b));
    p.on('error', reject);
    p.on('exit', (code) =>
      code === 0
        ? resolve(out)
        : reject(
            Error(
              `${path.basename(cmd)} failed (${code}): ${out.slice(-2500)}`,
            ),
          ),
    );
  });
}
let token;
async function req(url, method = 'GET', body, auth = token) {
  const r = await fetch(url, {
    method,
    headers: {
      ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const text = await r.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {}
  return { status: r.status, data, text };
}
function ok(r) {
  assert(
    r.status >= 200 && r.status < 300,
    `HTTP ${r.status}: ${r.text.slice(0, 300)}`,
  );
  return r.data;
}
async function acceptance() {
try {
  // Only the unpublished package is served locally; Node/npm/harness packages
  // are official downloads. Native override selects this source build.
  const pack = path.join(root, 'pack');
  fs.mkdirSync(pack);
  fs.cpSync(path.join(repo, 'npm/remote-codex'), path.join(pack, 'package'), {
    recursive: true,
  });
  const pkg = JSON.parse(
    fs.readFileSync(path.join(pack, 'package/package.json')),
  );
  const archive = path.join(root, 'candidate.tgz');
  assert.equal(
    spawnSync('tar', ['-czf', archive, '-C', pack, 'package']).status,
    0,
  );
  const bytes = fs.readFileSync(archive);
  let registry;
  registry = await listen(async (q, s) => {
    try {
      if (q.url === '/candidate.tgz') {
        s.end(bytes);
        return;
      }
      if (q.url === '/remote-codex') {
        s.setHeader('Content-Type', 'application/json');
        s.end(
          JSON.stringify({
            name: pkg.name,
            'dist-tags': { latest: pkg.version },
            versions: {
              [pkg.version]: {
                ...pkg,
                dist: {
                  tarball: `${registry}/candidate.tgz`,
                  integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
                },
              },
            },
          }),
        );
        return;
      }
      const upstream = await fetch(`https://registry.npmjs.org${q.url}`);
      s.statusCode = upstream.status;
      s.setHeader(
        'Content-Type',
        upstream.headers.get('content-type') ?? 'application/json',
      );
      s.end(Buffer.from(await upstream.arrayBuffer()));
    } catch {
      s.writeHead(502);
      s.end();
    }
  });
  env.npm_config_registry = registry;
  const rp = await freePort(),
    sp = await freePort(),
    base = `http://127.0.0.1:${rp}`,
    local = `http://127.0.0.1:${sp}`;
  const log = fs.openSync(path.join(root, 'relay.log'), 'a');
  const relay = spawn(binary, ['relay'], {
    cwd: home,
    env: {
      ...env,
      HOST: '127.0.0.1',
      PORT: String(rp),
      REMOTE_CODEX_ADMIN_USERNAME: 'fixtureadmin',
      REMOTE_CODEX_ADMIN_PASSWORD: randomBytes(24).toString('hex'),
      REMOTE_CODEX_RELAY_DATA_DIR: path.join(root, 'relay'),
      REMOTE_CODEX_RELAY_REGISTRATION_ENABLED: 'true',
      REMOTE_CODEX_RELAY_SESSION_SECRET: randomBytes(32).toString('hex'),
    },
    stdio: ['ignore', log, log],
  });
  children.push(relay);
  fs.closeSync(log);
  await poll(async () => (await req(`${base}/healthz`)).status === 200);
  const password = randomBytes(24).toString('hex');
  async function account(username) {
    ok(
      await req(
        `${base}/relay/auth/register`,
        'POST',
        { username, email: `${username}@example.test`, password },
        null,
      ),
    );
    return ok(
      await req(
        `${base}/relay/auth/login`,
        'POST',
        { username, password },
        null,
      ),
    ).token;
  }
  token = await account('setupowner');
  const guest = await account('setupguest');
  const device = ok(
    await req(`${base}/relay/devices`, 'POST', { name: 'Setup acceptance' }),
  );
  const deviceUrl = `${base}/relay/devices/${device.device.id}`;
  assert.equal(
    (await req(`${deviceUrl}/bootstrap`, 'POST', {}, guest)).status,
    404,
  );
  const { code, expiresAt } = ok(
    await req(`${deviceUrl}/bootstrap`, 'POST', {}),
  );
  assert(expiresAt > Date.now() + 3500000 && expiresAt <= Date.now() + 3600000);
  const shell = await req(`${base}/setup.sh`);
  assert.equal(shell.status, 200);
  assert(!shell.text.includes('__REMOTE_CODEX_VERSION__'));
  const script = path.join(root, 'setup.sh');
  // Test the unpublished candidate through a local registry fixture. Production
  // always resolves from registry.npmjs.org, regardless of inherited npm config.
  fs.writeFileSync(script, shell.text.replaceAll('https://registry.npmjs.org', registry));
  console.log('Testing setup with no Node on PATH…');
  const args = [script, '--relay', base, '--code', code, '--port', String(sp)];
  console.log((await run('/bin/sh', args)).trim());
  const health = ok(await req(`${local}/healthz`));
  assert(health.relayConnected);
  devicePids.push(health.processId);
  assert.equal(
    (await req(`${base}/relay/setup/redeem`, 'POST', { code }, null)).status,
    401,
  );
  const nodeBin = path.join(
    home,
    '.local/share/remote-codex/node-v22.22.0-linux-arm64/bin',
  );
  const repeated = await run('/bin/sh', args, {
    PATH: `${nodeBin}:/usr/bin:/bin`,
  });
  assert(repeated.includes(`Device is online and running Remote Codex ${pkg.version}`));
  assert(repeated.includes('already installed'));
  assert(!repeated.includes('Installing a private Node'));
  const savedPath = env.REMOTE_CODEX_RELAY_SUPERVISOR_CONFIG;
  const saved = JSON.parse(fs.readFileSync(savedPath));
  fs.unlinkSync(savedPath + '.setup.json');
  const tokenArgs = [script, '--relay', base, '--token', device.token, '--port', String(sp)];
  const adopted = await run('/bin/sh', tokenArgs, { PATH: `${nodeBin}:/usr/bin:/bin` });
  assert(adopted.includes(`Device is online and running Remote Codex ${pkg.version}`));
  assert.equal(ok(await req(`${local}/healthz`)).processId, health.processId);
  // Restart a stopped legacy setup without a receipt and keep its identity/database.
  process.kill(health.processId, 'SIGTERM');
  await poll(async () => { try { await fetch(`${local}/healthz`); return false; } catch { return true; } });
  const recovered = await run('/bin/sh', tokenArgs, { PATH: `${nodeBin}:/usr/bin:/bin` });
  assert(recovered.includes(`Device is online and running Remote Codex ${pkg.version}`));
  devicePids.push(ok(await req(`${local}/healthz`)).processId);
  assert.deepEqual(JSON.parse(fs.readFileSync(savedPath)), saved);
  if (process.argv.includes('--setup-only')) {
    console.log('PASS: no-Node bootstrap, latest lookup, no reinstall on retry, online legacy adoption, offline legacy recovery and unchanged configuration');
    return;
  }
  const nextCode = ok(await req(`${deviceUrl}/bootstrap`, 'POST', {})).code;
  await assert.rejects(
    run('/bin/sh', [
      script,
      '--relay',
      base,
      '--code',
      nextCode,
      '--port',
      String(sp),
    ]),
    /already in use/,
  );
  const api = `${deviceUrl}/api/management`;
  assert(
    [401, 403].includes(
      (await req(`${api}/upstreams`, 'GET', undefined, guest)).status,
    ),
  );
  const calls = [];
  const mock = await listen(async (q, s) => {
    let text = '';
    for await (const b of q) text += b;
    calls.push({
      url: q.url,
      body: JSON.parse(text),
      authorization: q.headers.authorization,
      key: q.headers['x-api-key'] ?? q.headers['x-goog-api-key'],
    });
    s.setHeader('Content-Type', 'application/json');
    s.end(
      JSON.stringify({
        output: [
          { type: 'message', content: [{ type: 'output_text', text: 'OK' }] },
        ],
        content: [{ type: 'text', text: 'OK' }],
        candidates: [{ content: { parts: [{ text: 'OK' }] } }],
        choices: [{ message: { content: 'OK' } }],
      }),
    );
  });
  for (const harness of ['codex', 'claude', 'gemini', 'grok']) {
    const key = `synthetic-${harness}`;
    const profile = ok(
      await req(`${api}/upstreams`, 'POST', {
        name: `Test ${harness}`,
        harness,
        baseUrl: mock,
        model: 'test-model',
        apiKey: key,
      }),
    );
    assert(!JSON.stringify(profile).includes(key));
    ok(await req(`${api}/upstreams/${profile.id}`, 'POST', { action: 'test' }));
    assert.equal(
      calls.at(-1).authorization ?? calls.at(-1).key,
      ['gemini', 'claude'].includes(harness) ? key : `Bearer ${key}`,
    );
    const switchResult = ok(
      await req(`${api}/upstreams/${profile.id}`, 'POST', {
        action: 'activate',
      }),
    );
    const inventory = ok(await req(`${api}/upstreams`));
    assert.equal(inventory.active[harness], profile.id);
    assert(!JSON.stringify(inventory).includes(key));
    ok(
      await req(`${api}/upstreams/${switchResult.backupId}`, 'POST', {
        action: 'restore',
      }),
    );
    console.log(
      `Verified ${harness}: authenticated request, activation, redaction and restore`,
    );
  }
  // All requested base tools are installed through exactly the Web API path.
  for (const harness of ['codex', 'claude', 'gemini', 'grok']) {
    console.log(`Installing real ${harness} through device management…`);
    ok(await req(`${api}/harnesses/${harness}`, 'POST', { action: 'install' }));
    const job = await poll(async () => {
      const jobs = ok(await req(`${api}/jobs`));
      return jobs[harness]?.state !== 'running' && jobs[harness];
    }, 650000);
    assert.equal(job.state, 'completed', JSON.stringify(job));
    ok(await req(`${api}/harnesses/${harness}`, 'POST', { action: 'update' }));
    const updated = await poll(async () => {
      const jobs = ok(await req(`${api}/jobs`));
      return jobs[harness]?.state !== 'running' && jobs[harness];
    }, 350000);
    assert.equal(updated.state, 'completed', JSON.stringify(updated));
    ok(await req(`${api}/harnesses/${harness}`, 'POST', { action: 'restart' }));
    const restart = await poll(async () => {
      const jobs = ok(await req(`${api}/jobs`));
      return jobs[harness]?.state !== 'running' && jobs[harness];
    });
    assert.equal(restart.state, 'completed');
  }
  const template = {
    schemaVersion: 1,
    harnesses: ['codex'],
    profiles: [
      {
        name: 'Template upstream',
        harness: 'codex',
        baseUrl: mock,
        model: 'fixture',
        apiKey: 'synthetic-template',
      },
    ],
  };
  const before = ok(await req(`${api}/upstreams`)).profiles.length;
  ok(await req(`${api}/templates`, 'POST', { template, apply: false }));
  assert.equal(ok(await req(`${api}/upstreams`)).profiles.length, before);
  ok(await req(`${api}/templates`, 'POST', { template, apply: true }));
  const job = await poll(async () => {
    const jobs = ok(await req(`${api}/jobs`));
    return jobs.template?.state !== 'running' && jobs.template;
  });
  assert.equal(job.state, 'completed', JSON.stringify(job));
  assert.equal(ok(await req(`${api}/supervisor`)).canRestart, true);
  ok(await req(`${api}/supervisor/restart`, 'POST', {}));
  const restarted = await poll(async () => {
    const h = ok(await req(`${local}/healthz`));
    return h.processId !== health.processId && h.relayConnected && h;
  }, 90000);
  devicePids.push(restarted.processId);
  await poll(
    async () => ok(await req(`${api}/supervisor`)).job?.phase === 'completed',
    30000,
  );
  console.log('Verified independent Supervisor restart and relay reconnect');
  console.log(
    'PASS: no-Node bootstrap, one-use codes, duplicate protection, owner scope, four real harness installs/restarts, upstreams and template apply',
  );
} finally {
  for (const pid of devicePids) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {}
  }
  for (const child of children) child.kill('SIGTERM');
  for (const server of servers) {
    server.closeAllConnections();
    server.close();
  }
}
}
await acceptance();
