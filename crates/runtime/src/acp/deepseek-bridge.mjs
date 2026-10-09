// Remote Codex bridge inside the ACP-owned DSH process (inserted with --patch).
// ACP keeps prompts, tools, permissions and cancellation. This reverse channel
// carries startup metadata, an allowlisted subset of DSH's own Remote API,
// session projection views, live assistant text and human questions. It never
// writes stdout and never exports plugin configuration, environment or secrets.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { connect } from 'node:net';
import { dirname, join } from 'node:path';

export const name = 'remote-codex-bridge';
export const inject = ['llm', 'appReady'];

const PROTOCOL = 1;
const MAX_LINE = 1 << 20;
const STREAM_FLUSH_MS = 40;
const PROJECTIONS = ['plan', 'goal', 'todos', 'permissions'];
const COMMANDS = new Set(['plan', 'permission', 'goal', 'compact']);
const REMOTES = new Set([
  'commands/list', 'goals/get', 'goals/pause', 'goals/resume', 'goals/clear',
  'permissionPresets/catalog', 'pluginManager/listPlugins', 'pluginManager/listBundles',
  'pluginManager/setPluginEnabled', 'pluginManager/setBundleEnabled', 'llm/listConfigurableProviders',
]);
const MUTATIONS = new Set(['pluginManager/setPluginEnabled', 'pluginManager/setBundleEnabled']);
// Another application bundle in the ACP profile would stop every session from starting.
const APP_BUNDLE = /^@deepseek-ai\/dsh-(base|acp-app|web-app|headless|sdk-app|sdk-minimal)$/;
const BACKUPS_KEPT = 10;
// Profile settings the panel may change. Values must be JSON scalars: `!!js`
// strings and `__jsExpr` objects would execute inside DSH.
const SETTINGS = {
  permission: ['defaultPreset'],
  'agent-loop': ['maxParallelToolCalls'],
  subagent: ['maxDepth', 'maxActiveSubagents'],
  'bash-sandbox': ['timeoutMs', 'maxOutputBytes'],
  'llm-deepseek': ['reasoningEffort', 'maxTokens'],
  'session-log-deepseek': ['enabled'],
};

export function apply(ctx, config) {
  let socket = null;
  let questionId = 0;
  const questions = new Map();
  const streams = new Map();
  const changed = new Map();
  const send = message => {
    if (socket && !socket.destroyed) socket.write(JSON.stringify(message) + '\n');
  };
  const root = agent => ctx.get('agents')?.roots().includes(agent) ?? false;

  const flush = attemptId => {
    const stream = streams.get(attemptId);
    if (!stream?.text) return;
    send({ event: 'stream', sessionId: stream.sessionId, attemptId, kind: stream.kind, text: stream.text });
    stream.text = '';
  };
  ctx.on('agent/assistant-stream', ({ agent, frame }) => {
    if (!root(agent)) return;
    const sessionId = String(agent.id);
    if (frame.type === 'start') {
      streams.set(frame.attemptId, { sessionId, kind: null, text: '', timer: null });
      send({ event: 'stream', sessionId, attemptId: frame.attemptId, kind: 'start', step: frame.step });
    } else if (frame.type === 'chunk') {
      const kind = { 'text-delta': 'text', 'reasoning-delta': 'reasoning' }[frame.chunk.type];
      const stream = streams.get(frame.attemptId);
      if (!kind || !stream) return;
      if (stream.kind !== kind) flush(frame.attemptId);
      stream.kind = kind;
      stream.text += frame.chunk.text;
      stream.timer ??= setTimeout(() => { stream.timer = null; flush(frame.attemptId); }, STREAM_FLUSH_MS);
    } else if (frame.type === 'end') {
      const stream = streams.get(frame.attemptId);
      if (stream?.timer) clearTimeout(stream.timer);
      flush(frame.attemptId);
      streams.delete(frame.attemptId);
      const outcome = frame.outcome.kind === 'committed' && frame.outcome.eventType === 'assistant/message'
        ? 'committed' : 'discarded';
      send({ event: 'stream', sessionId, attemptId: frame.attemptId, kind: 'end', outcome });
    }
  });
  ctx.on('agent/status', ({ agent, status }) => {
    if (root(agent)) send({ event: 'status', sessionId: String(agent.id), status });
  });
  ctx.inject(['sessionProjections'], projectionCtx => {
    projectionCtx.sessionProjections.onChanged((session, key) => {
      if (!PROJECTIONS.includes(key)) return;
      // Coalesce one committed event's units; send validated client views.
      if (!changed.has(session)) queueMicrotask(() => {
        const keys = [...(changed.get(session) ?? [])];
        changed.delete(session);
        const agent = ctx.get('agents')?.roots().find(candidate => candidate.session === session);
        if (!agent) return;
        const { values } = projectionCtx.sessionProjections.snapshot(session, keys);
        for (const [key, value] of Object.entries(values)) {
          send({ event: 'projection', sessionId: String(agent.id), key, value: value ?? null });
        }
      });
      changed.set(session, (changed.get(session) ?? new Set()).add(key));
    });
  });
  // Without an answerer, DSH rejects plan reviews and questions as NO_PROVIDER.
  ctx.on('user-questions/request', (request, next) => {
    const agent = request.agent;
    if (!socket || socket.destroyed || !agent || !root(agent)) return next();
    const id = ++questionId;
    return new Promise((resolve, reject) => {
      const abort = () => {
        questions.delete(id);
        send({ event: 'question-cancelled', questionId: id });
        reject(request.signal.reason ?? new Error('question aborted'));
      };
      if (request.signal?.aborted) return abort();
      request.signal?.addEventListener('abort', abort, { once: true });
      questions.set(id, {
        resolve: value => { request.signal?.removeEventListener('abort', abort); resolve(value); },
        reject: error => { request.signal?.removeEventListener('abort', abort); reject(error); },
      });
      send({ event: 'question', questionId: id, sessionId: String(agent.id), questions: request.questions });
    });
  });

  const dispose = ctx.appReady.onReady(() => {
    void snapshot(ctx).then(data => {
      socket = connect({ host: '127.0.0.1', port: config.port });
      socket.on('error', () => {});
      socket.on('close', () => {
        for (const question of questions.values()) question.reject(new Error('Remote Codex disconnected'));
        questions.clear();
      });
      socket.on('connect', () => send({ token: config.token, hello: data }));
      let buffer = '';
      socket.on('data', chunk => {
        buffer += chunk;
        if (buffer.length > MAX_LINE && !buffer.includes('\n')) return socket.destroy();
        let index;
        while ((index = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, index);
          buffer = buffer.slice(index + 1);
          let message;
          try { message = JSON.parse(line); } catch { continue; }
          receive(message);
        }
      });
    }, error => {
      // Connect only to report the failure; the supervisor rejects the session.
      socket = connect({ host: '127.0.0.1', port: config.port });
      socket.on('error', () => {});
      socket.on('connect', () => socket.end(JSON.stringify({ token: config.token, error: String(error?.message ?? error) }) + '\n'));
    });
  });
  ctx.on('dispose', () => { dispose(); socket?.destroy(); });

  function receive(message) {
    if (message.answer !== undefined) {
      const question = questions.get(message.answer);
      questions.delete(message.answer);
      if (!question) return;
      if (message.error) question.reject(new Error(String(message.error)));
      else question.resolve(message.result);
      return;
    }
    if (message.id === undefined) return;
    void call(message.method, message.params ?? {}).then(
      result => send({ id: message.id, result: result ?? null }),
      error => send({ id: message.id, error: { message: String(error?.message ?? error), code: error?.code ?? null } }),
    );
  }

  async function call(method, params) {
    switch (method) {
      case 'snapshot': return snapshot(ctx);
      case 'session': return session(params.sessionId);
      case 'invoke': {
        const endpoint = `${params.namespace}/${params.method}`;
        if (!REMOTES.has(endpoint)) throw new Error(`Remote ${endpoint} is not available through Remote Codex`);
        if (endpoint === 'pluginManager/setBundleEnabled' && APP_BUNDLE.test(String(params.args?.name))) {
          throw new Error(`${params.args.name} is an application bundle; the ACP profile cannot switch it`);
        }
        if (MUTATIONS.has(endpoint)) backupProfile(ctx);
        return remote(ctx, params.namespace, params.method, params.args ?? {});
      }
      case 'command': {
        const line = String(params.line ?? '').trim();
        if (!COMMANDS.has(/^\/([\w-]+)/.exec(line)?.[1])) throw new Error(`Command ${line} is not available through Remote Codex`);
        return remote(ctx, 'commands', 'execute', { agentId: params.sessionId, line, submittedAttachments: [] });
      }
      case 'settings': return settings(ctx);
      case 'updateSetting': return updateSetting(ctx, params);
      default: throw new Error(`Unknown bridge method ${method}`);
    }
  }

  async function session(sessionId) {
    const agent = ctx.get('agents')?.get(sessionId);
    if (!agent || !root(agent)) throw new Error(`DSH session ${sessionId} is not live`);
    const projections = ctx.get('sessionProjections')?.snapshot(agent.session, PROJECTIONS).values ?? {};
    const commands = await remote(ctx, 'commands', 'list', { agentId: sessionId }).catch(() => []);
    return {
      projections,
      running: agent.status === 'running',
      commands: commands.filter(command => COMMANDS.has(command.name))
        .map(({ name, description, input }) => ({ name, description: description ?? '', hint: input?.hint ?? null })),
    };
  }
}

async function remote(ctx, namespace, method, args = {}) {
  const gateway = ctx.get('typertGateway');
  if (!gateway) throw new Error('DSH Remote gateway is unavailable');
  return gateway.invoke({ namespace, method, args });
}

async function snapshot(ctx) {
  const optional = promise => promise.catch(() => null);
  const [models, presets, plugins, bundles, providers] = await Promise.all([
    discoverModels(ctx),
    optional(remote(ctx, 'permissionPresets', 'catalog')),
    optional(remote(ctx, 'pluginManager', 'listPlugins')),
    optional(remote(ctx, 'pluginManager', 'listBundles')),
    optional(remote(ctx, 'llm', 'listConfigurableProviders')),
  ]);
  return {
    protocol: PROTOCOL,
    version: dshVersion(),
    profile: ctx.get('profileContext')?.name ?? 'acp',
    models,
    permissionPresets: presets?.options?.map(option => option.value) ?? [],
    defaultPermissionPreset: presets?.defaultPreset ?? null,
    plugins: plugins ? plugins.filter(plugin => plugin.moduleName !== 'cordis:include').map(plugin => ({
      id: plugin.entryId, name: plugin.meta?.title ?? plugin.moduleName, module: plugin.moduleName,
      description: plugin.meta?.description ?? '', enabled: plugin.enabled,
      active: plugin.fiberPhase === 'active', readOnly: plugin.readOnlyReason ?? null,
    })) : loaderPlugins(ctx),
    bundles: (bundles ?? []).map(bundle => ({
      name: bundle.name, version: bundle.version ?? null, description: bundle.description ?? '',
      enabled: bundle.enabled, removable: Boolean(bundle.removable),
      readOnly: bundle.readOnlyReason ?? (APP_BUNDLE.test(bundle.name) ? 'application-bundle' : null),
    })),
    providers: (providers ?? []).map(provider => ({
      id: provider.provider, name: provider.displayName, declared: provider.declared !== false,
    })),
    features: {
      stream: true,
      questions: true,
      projections: Boolean(ctx.get('sessionProjections')),
      commands: Boolean(ctx.get('commands') && ctx.get('typertGateway')),
      goals: Boolean(ctx.get('goals')),
      permissions: Boolean(presets),
      pluginManager: Boolean(plugins),
      settings: Boolean(ctx.get('settings')),
    },
  };
}

async function discoverModels(ctx) {
  const models = [];
  for (const provider of ctx.llm.listProviders()) {
    for (const model of await ctx.llm.listModels(provider.id)) {
      const info = await ctx.llm.resolveModelInfo(provider.id, model.id);
      const reasoning = info?.reasoning;
      const efforts = (reasoning?.efforts ?? []).map(effort => ({
        reasoningEffort: String(effort.id), description: effort.description ?? effort.name ?? String(effort.id),
      }));
      if (reasoning && reasoning.defaultEffort === undefined) {
        efforts.unshift({ reasoningEffort: '', description: 'Provider default' });
      }
      const value = JSON.stringify([provider.id, model.id]);
      models.push({ id: value, model: value, displayName: `${provider.name} · ${model.name}`,
        description: model.description ?? '', isDefault: false, hidden: false,
        supportedReasoningEfforts: efforts,
        defaultReasoningEffort: reasoning ? String(reasoning.defaultEffort ?? '') : null,
        selectionKind: 'model', acpAgent: null });
    }
  }
  return models;
}

function loaderPlugins(ctx) {
  // Pre-plugin-manager DSH: an explicit allowlist of loader entry fields.
  return [...(ctx.loader?.entries() ?? [])].filter(entry => !entry.options.group).map(entry => ({
    id: entry.id, name: entry.options.name, module: entry.options.name, description: '',
    enabled: !entry.disabled, active: !entry.disabled, readOnly: 'unmanaged',
  }));
}

function settings(ctx) {
  const views = ctx.get('settings')?.describe({ redactSecrets: true }) ?? [];
  return views.filter(view => SETTINGS[view.ns]).map(view => ({
    ns: view.ns,
    revision: view.revision,
    fields: SETTINGS[view.ns].map(key => ({
      key,
      value: scalar(view.value?.[key]),
      overridden: Boolean(view.user && Object.hasOwn(view.user, key)),
    })),
  }));
}

async function updateSetting(ctx, { ns, key, value, revision }) {
  if (!SETTINGS[ns]?.includes(key)) throw new Error(`Setting ${ns}.${key} is not editable through Remote Codex`);
  if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) throw new Error('Settings accept JSON scalars only');
  if (typeof value === 'string' && value.trimStart().startsWith('!!')) throw new Error('YAML tags are not accepted');
  const forms = ctx.get('settings');
  if (!forms) throw new Error('DSH settings are unavailable in this profile');
  backupProfile(ctx);
  const op = value === null ? { op: 'unset', path: [key] } : { op: 'set', path: [key], value };
  await forms.mutate(ns, [op], revision);
  return settings(ctx).find(view => view.ns === ns) ?? null;
}

// A profile edit that breaks startup must stay recoverable outside DSH.
function backupProfile(ctx) {
  const profile = ctx.get('profileContext');
  if (!profile?.dir) throw new Error('DSH profile location is unknown; refusing to change it');
  const root = join(profile.dir, '.remote-codex', 'backups');
  const target = join(root, new Date().toISOString().replace(/[:.]/g, '-'));
  mkdirSync(target, { recursive: true, mode: 0o700 });
  for (const file of [profile.patchPath, profile.installAnchor]) {
    if (file && existsSync(file)) copyFileSync(file, join(target, file.split(/[\\/]/).pop()));
  }
  for (const stale of readdirSync(root).sort().slice(0, -BACKUPS_KEPT)) {
    rmSync(join(root, stale), { recursive: true, force: true });
  }
}

function scalar(value) {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value) ? value : null;
}

function dshVersion() {
  try {
    let directory = dirname(realpathSync(process.argv[1]));
    for (let depth = 0; depth < 4; depth += 1, directory = dirname(directory)) {
      try {
        const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
        if (manifest.name === '@deepseek-ai/dsh') return manifest.version;
      } catch { /* no manifest at this level; keep walking toward the package root */ }
    }
  } catch { /* argv[1] is not a resolvable launcher path */ }
  return null;
}
