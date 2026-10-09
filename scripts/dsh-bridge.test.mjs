import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply } from '../crates/runtime/src/acp/deepseek-bridge.mjs';

// A minimal DSH context: event listeners, injected services and appReady.
function fakeDsh(overrides = {}) {
  const listeners = new Map();
  let ready;
  const agent = { id: 'session-1', session: { id: 'session-1' } };
  const calls = [];
  const services = {
    agents: { roots: () => [agent], get: id => (id === agent.id ? agent : undefined) },
    sessionProjections: {
      onChanged: () => () => {},
      snapshot: () => ({ values: { plan: { active: false, pending: false }, permissions: { currentValue: 'workspace-write' } } }),
    },
    typertGateway: {
      invoke: async ({ namespace, method, args }) => {
        calls.push(`${namespace}/${method}`);
        if (namespace === 'pluginManager' && method === 'listPlugins') {
          return [
            { entryId: 'include', moduleName: 'cordis:include', enabled: true, readOnlyReason: 'unaddressable' },
            { entryId: 'include:llm', moduleName: '@deepseek-ai/dsh-llm', enabled: true, fiberPhase: 'active',
              meta: { title: 'LLM', description: 'Provider-neutral' }, patchId: 'llm', config: { apiKey: 'never-export-this' } },
          ];
        }
        if (namespace === 'permissionPresets') return { options: [{ value: 'read-only' }, { value: 'workspace-write' }], defaultPreset: 'workspace-write' };
        if (namespace === 'commands' && method === 'list') return [{ name: 'plan', description: 'Plan' }, { name: 'feedback' }];
        if (namespace === 'commands' && method === 'execute') return { commandId: 'c1', result: { kind: 'success', text: args.line } };
        return [];
      },
    },
    commands: {},
    goals: {},
    ...overrides,
  };
  const ctx = {
    appReady: { onReady: fn => { ready = fn; return () => {}; } },
    on: (event, fn) => { listeners.set(event, fn); },
    inject: (deps, fn) => fn(ctx),
    get: name => services[name],
    loader: { entries: () => [] },
    llm: {
      listProviders: () => [{ id: 'custom', name: 'Custom' }],
      listModels: async () => [{ id: 'with-reasoning', name: 'Reasoning' }, { id: 'plain', name: 'Plain' }],
      resolveModelInfo: async (_, model) => (model === 'plain' ? {} : { reasoning: { efforts: [{ id: 'xhigh', name: 'Xhigh' }] } }),
    },
    ...services,
  };
  return { ctx, listeners, agent, calls, ready: () => ready() };
}

async function supervisor() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const connection = new Promise(resolve => server.once('connection', resolve));
  return { server, port: server.address().port, connection };
}

// The plugin's dispose effect closes its socket; then the server can close.
async function stop(server, dsh) {
  dsh?.listeners.get('dispose')?.();
  await new Promise(resolve => server.close(resolve));
}

function lines(socket) {
  const queue = [];
  const waiters = [];
  let buffer = '';
  socket.on('data', data => {
    buffer += data;
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const message = JSON.parse(buffer.slice(0, index));
      buffer = buffer.slice(index + 1);
      const waiter = waiters.shift();
      if (waiter) waiter(message); else queue.push(message);
    }
  });
  return () => (queue.length ? Promise.resolve(queue.shift()) : new Promise(resolve => waiters.push(resolve)));
}

test('hello carries per-model reasoning and allowlisted inventory, never plugin config', async () => {
  const { server, port, connection } = await supervisor();
  const dsh = fakeDsh();
  try {
    apply(dsh.ctx, { port, token: 'test-token' });
    dsh.ready();
    const next = lines(await connection);
    const hello = await next();
    assert.equal(hello.token, 'test-token');
    assert.equal(hello.hello.protocol, 1);
    assert.equal(hello.hello.models[0].model, '["custom","with-reasoning"]');
    assert.deepEqual(hello.hello.models[0].supportedReasoningEfforts.map(e => e.reasoningEffort), ['', 'xhigh']);
    assert.deepEqual(hello.hello.models[1].supportedReasoningEfforts, []);
    assert.deepEqual(hello.hello.plugins.map(plugin => plugin.id), ['include:llm']);
    assert.deepEqual(hello.hello.permissionPresets, ['read-only', 'workspace-write']);
    assert.equal(hello.hello.features.commands, true);
    assert.equal(JSON.stringify(hello).includes('never-export-this'), false);
  } finally { await stop(server, dsh); }
});

test('remote calls and commands are allowlisted; settings accept scalars only', async () => {
  const { server, port, connection } = await supervisor();
  const dsh = fakeDsh({ settings: { describe: () => [], mutate: async () => {} } });
  try {
    apply(dsh.ctx, { port, token: 't' });
    dsh.ready();
    const socket = await connection;
    const next = lines(socket);
    await next();
    const send = message => socket.write(JSON.stringify(message) + '\n');
    send({ id: 1, method: 'invoke', params: { namespace: 'credentials', method: 'set', args: {} } });
    assert.match((await next()).error.message, /not available/);
    send({ id: 2, method: 'command', params: { sessionId: 'session-1', line: '/feedback leak' } });
    assert.match((await next()).error.message, /not available/);
    send({ id: 3, method: 'command', params: { sessionId: 'session-1', line: '/plan off' } });
    assert.equal((await next()).result.result.text, '/plan off');
    send({ id: 4, method: 'updateSetting', params: { ns: 'llm-pi-ai', key: 'providers', value: 'x' } });
    assert.match((await next()).error.message, /not editable/);
    send({ id: 5, method: 'updateSetting', params: { ns: 'agent-loop', key: 'maxParallelToolCalls', value: '!!js 1' } });
    assert.match((await next()).error.message, /YAML tags/);
    send({ id: 6, method: 'session', params: { sessionId: 'session-1' } });
    const session = (await next()).result;
    assert.deepEqual(session.commands.map(command => command.name), ['plan']);
    assert.equal(session.projections.permissions.currentValue, 'workspace-write');
  } finally { await stop(server, dsh); }
});

test('questions wait for the supervisor and coalesced stream text reaches it', async () => {
  const { server, port, connection } = await supervisor();
  const dsh = fakeDsh();
  try {
    apply(dsh.ctx, { port, token: 't' });
    dsh.ready();
    const socket = await connection;
    const next = lines(socket);
    await next();
    const asked = dsh.listeners.get('user-questions/request')(
      { agent: dsh.agent, questions: [{ id: 'q', question: 'Approve?', options: [{ label: 'Yes' }] }] },
      () => Promise.reject(new Error('fell through')),
    );
    const question = await next();
    assert.equal(question.event, 'question');
    assert.equal(question.sessionId, 'session-1');
    socket.write(JSON.stringify({ answer: question.questionId, result: { answers: [{ id: 'q', selected: ['Yes'] }] } }) + '\n');
    assert.deepEqual(await asked, { answers: [{ id: 'q', selected: ['Yes'] }] });

    const stream = dsh.listeners.get('agent/assistant-stream');
    stream({ agent: dsh.agent, frame: { type: 'start', attemptId: 'a1', step: 1 } });
    for (const text of ['Hel', 'lo']) {
      stream({ agent: dsh.agent, frame: { type: 'chunk', attemptId: 'a1', chunk: { type: 'text-delta', text } } });
    }
    stream({ agent: dsh.agent, frame: { type: 'end', attemptId: 'a1', outcome: { kind: 'committed', eventType: 'assistant/message' } } });
    assert.equal((await next()).kind, 'start');
    assert.deepEqual(await next(), { event: 'stream', sessionId: 'session-1', attemptId: 'a1', kind: 'text', text: 'Hello' });
    assert.equal((await next()).outcome, 'committed');
  } finally { await stop(server, dsh); }
});

test('profile edits are backed up first and application bundles stay locked', async () => {
  const { server, port, connection } = await supervisor();
  const dir = mkdtempSync(join(tmpdir(), 'dsh-profile-'));
  writeFileSync(join(dir, 'cordis.patch.yml'), '[ { id: web, disabled: true } ]\n');
  writeFileSync(join(dir, 'package.json'), '{}');
  const dsh = fakeDsh({ profileContext: { name: 'acp', dir, patchPath: join(dir, 'cordis.patch.yml'), installAnchor: join(dir, 'package.json') } });
  try {
    apply(dsh.ctx, { port, token: 't' });
    dsh.ready();
    const socket = await connection;
    const next = lines(socket);
    await next();
    const send = message => socket.write(JSON.stringify(message) + '\n');
    send({ id: 1, method: 'invoke', params: { namespace: 'pluginManager', method: 'setBundleEnabled', args: { name: '@deepseek-ai/dsh-headless', enabled: true } } });
    assert.match((await next()).error.message, /application bundle/);
    assert.throws(() => readdirSync(join(dir, '.remote-codex', 'backups')));
    send({ id: 2, method: 'invoke', params: { namespace: 'pluginManager', method: 'setPluginEnabled', args: { id: 'include:web', enabled: true } } });
    await next();
    const [backup] = readdirSync(join(dir, '.remote-codex', 'backups'));
    assert.equal(readFileSync(join(dir, '.remote-codex', 'backups', backup, 'cordis.patch.yml'), 'utf8'), '[ { id: web, disabled: true } ]\n');
  } finally { await stop(server, dsh); }
});
