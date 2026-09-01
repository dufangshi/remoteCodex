#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { randomUUID } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import { clearTimeout, setTimeout } from 'node:timers';

import * as acp from '@agentclientprotocol/sdk';

if (process.argv.includes('--help')) {
  process.stdout.write('Remote Codex fake ACP agent\n');
  process.exit(0);
}

const statePath = process.env.REMOTE_CODEX_FAKE_ACP_STATE?.trim() || null;
const streamDelayMs = Number(
  process.env.REMOTE_CODEX_FAKE_ACP_STREAM_DELAY_MS ?? 0,
);
const capabilityProfile =
  process.env.REMOTE_CODEX_FAKE_ACP_CAPABILITY_PROFILE ?? 'full';
const skipPermission = process.env.REMOTE_CODEX_FAKE_ACP_SKIP_PERMISSION === '1';
const agentKind = process.env.REMOTE_CODEX_FAKE_ACP_AGENT_KIND ?? 'fixture';
const supportsFork = process.env.REMOTE_CODEX_FAKE_ACP_FORK === '1';
const noSessionCleanup = process.env.REMOTE_CODEX_FAKE_ACP_NO_SESSION_CLEANUP === '1';
const noSessionDelete = process.env.REMOTE_CODEX_FAKE_ACP_NO_SESSION_DELETE === '1';
const legacyModels = process.env.REMOTE_CODEX_FAKE_ACP_LEGACY_MODELS === '1';
const goalVersion = process.env.REMOTE_CODEX_FAKE_ACP_GOAL_VERSION ?? '1';
const goalActions = (process.env.REMOTE_CODEX_FAKE_ACP_GOAL_ACTIONS ?? 'get,set,clear')
  .split(',')
  .map((action) => action.trim())
  .filter(Boolean);
const sessions = new Map();

function defaultConfig() {
  return {
    model: 'fixture-model',
    thought: 'medium',
    mode: 'agent',
    fast: false,
  };
}

function configOptions(session) {
  return [
    {
      id: 'model',
      name: 'Model',
      category: 'model',
      type: 'select',
      currentValue: session.config.model,
      options: [
        { value: 'fixture-model', name: 'Fixture model' },
        { value: 'fixture-fast', name: 'Fixture fast model' },
      ],
    },
    {
      id: 'thought-level',
      name: 'Reasoning',
      category: 'thought_level',
      type: 'select',
      currentValue: session.config.thought,
      options: [
        { value: 'low', name: 'Low' },
        { value: 'medium', name: 'Medium' },
        { value: 'high', name: 'High' },
      ],
    },
    ...(agentKind === 'codex'
      ? [{
          id: 'fast-mode',
          name: 'Fast mode',
          category: 'model_config',
          type: 'boolean',
          currentValue: session.config.fast,
        }]
      : []),
  ];
}

function modes(session) {
  return {
    currentModeId: session.config.mode,
    availableModes: [
      { id: 'agent', name: 'Agent' },
      { id: 'plan', name: 'Plan' },
      { id: 'read-only', name: 'Read only' },
    ],
  };
}

function responseState(session) {
  if (legacyModels) {
    return {
      models: {
        currentModelId: session.config.model,
        availableModels: [
          {
            modelId: 'fixture-model',
            name: 'Fixture model',
            _meta: {
              reasoningEffort: session.config.thought,
              reasoningEfforts: [
                { id: 'high', value: 'high', label: 'High', default: true },
                { id: 'medium', value: 'medium', label: 'Medium' },
                { id: 'low', value: 'low', label: 'Low' },
              ],
            },
          },
          {
            modelId: 'fixture-fast',
            name: 'Fixture fast model',
            _meta: {
              reasoningEffort: session.config.thought,
              reasoningEfforts: [
                { id: 'high', value: 'high', label: 'High', default: true },
                { id: 'low', value: 'low', label: 'Low' },
              ],
            },
          },
        ],
      },
    };
  }
  return {
    modes: modes(session),
    configOptions: configOptions(session),
  };
}

async function loadState() {
  if (!statePath) return;
  try {
    const parsed = JSON.parse(await fs.readFile(statePath, 'utf8'));
    for (const session of parsed.sessions ?? []) {
      sessions.set(session.sessionId, {
        ...session,
        config: { ...defaultConfig(), ...session.config },
        turns: Array.isArray(session.turns) ? session.turns : [],
        pendingPrompt: null,
      });
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

async function saveState() {
  if (!statePath) return;
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  const payload = {
    sessions: [...sessions.values()].map((session) => {
      const serializable = { ...session };
      delete serializable.pendingPrompt;
      return serializable;
    }),
  };
  await fs.writeFile(statePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function requireSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) throw new Error(`Unknown fixture session: ${sessionId}`);
  return session;
}

function promptText(blocks) {
  return blocks.map((block) => {
    if (block.type === 'text') return block.text;
    if (block.type === 'resource_link') return block.uri;
    if (block.type === 'image') return `[image:${block.mimeType}]`;
    if (block.type === 'audio') return `[audio:${block.mimeType}]`;
    if (block.type === 'resource' && 'text' in block.resource) return block.resource.text;
    return '';
  }).join('\n');
}

function completedPromptResponse(turnNumber) {
  return {
    stopReason: 'end_turn',
    usage: {
      totalTokens: turnNumber * 100,
      inputTokens: turnNumber * 60,
      outputTokens: turnNumber * 40,
      thoughtTokens: turnNumber * 10,
      cachedReadTokens: 0,
      cachedWriteTokens: 0,
    },
  };
}

async function notify(client, sessionId, update) {
  await client.notify(acp.methods.client.session.update, { sessionId, update });
}

async function delay(ms, signal) {
  if (ms <= 0) return;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new Error('Fixture prompt cancelled.'));
    }, { once: true });
  });
}

async function replayTurn(client, session, turn, index) {
  await notify(client, session.sessionId, {
    sessionUpdate: 'user_message_chunk',
    content: { type: 'text', text: turn.prompt },
  });
  await notify(client, session.sessionId, {
    sessionUpdate: 'agent_thought_chunk',
    content: { type: 'text', text: turn.reasoning },
  });
  await notify(client, session.sessionId, {
    sessionUpdate: 'tool_call',
    toolCallId: `${session.sessionId}:replay-tool:${index}`,
    title: 'Optional fixture check',
    kind: 'execute',
    status: 'failed',
    rawInput: { command: 'fixture-check' },
    rawOutput: { exitCode: 1 },
  });
  await notify(client, session.sessionId, {
    sessionUpdate: 'plan',
    entries: [
      { content: 'Inspect fixture', priority: 'high', status: 'completed' },
      { content: 'Return marker', priority: 'high', status: 'completed' },
    ],
  });
  await notify(client, session.sessionId, {
    sessionUpdate: 'agent_message_chunk',
    content: { type: 'text', text: turn.response },
  });
  await notify(client, session.sessionId, {
    sessionUpdate: 'usage_update',
    used: turn.usage.used,
    size: turn.usage.size,
  });
}

async function replaySession(client, session) {
  for (const [index, turn] of session.turns.entries()) {
    await replayTurn(client, session, turn, index);
  }
}

async function handleGoalControl(context) {
  const session = requireSession(context.params.sessionId);
  if (context.params.action === 'clear') {
    session.goal = null;
  } else if (context.params.action === 'set') {
    const now = Date.now();
    session.goal = {
      objective: context.params.objective,
      status: 'active',
      tokenBudget: null,
      tokensUsed: 0,
      timeUsedSeconds: 0,
      createdAt: now,
      updatedAt: now,
    };
  } else if (session.goal) {
    session.goal.status = context.params.action === 'pause' ? 'paused' : 'active';
    session.goal.updatedAt = Date.now();
  }
  await saveState();
  await notify(context.client, session.sessionId, {
    sessionUpdate: 'session_info_update',
    _meta: { goal: session.goal ?? null },
  });
  return {};
}

await loadState();

const input = Writable.toWeb(process.stdout);
const output = Readable.toWeb(process.stdin);
const stream = acp.ndJsonStream(input, output);

acp.agent({ name: 'remote-codex-fake-acp-agent' })
  .onRequest(acp.methods.agent.initialize, async () => ({
    protocolVersion: acp.PROTOCOL_VERSION,
    agentInfo: {
      name: agentKind === 'codex'
        ? '@agentclientprotocol/codex-acp'
        : 'remote-codex-fake-acp-agent',
      title: agentKind === 'codex' ? 'Codex' : 'Remote Codex Fake ACP Agent',
      version: '1.0.0',
    },
    agentCapabilities: capabilityProfile === 'minimal'
      ? { loadSession: false, promptCapabilities: {} }
      : {
          loadSession: true,
          promptCapabilities: { image: true, audio: true, embeddedContext: true },
          sessionCapabilities: {
            list: {},
            resume: {},
            ...(!noSessionCleanup ? { close: {} } : {}),
            ...(!noSessionCleanup && !noSessionDelete ? { delete: {} } : {}),
            ...(supportsFork ? { fork: {} } : {}),
          },
        },
    _meta: {
      'remoteCodex.harnessExtensions': [{
        id: 'fixture.session',
        version: 1,
        stability: 'experimental',
        methods: ['compact'],
        events: ['checkpoint'],
      }],
      steering: { supported: true },
      goal: {
        version: /^\d+$/.test(goalVersion) ? Number(goalVersion) : goalVersion,
        controlMethod: agentKind === 'codex'
          ? '_session/goal'
          : 'fixture/goal/control',
        actions: goalActions,
      },
    },
  }))
  .onRequest(acp.methods.agent.session.new, async (context) => {
    const now = new Date().toISOString();
    const config = defaultConfig();
    if (
      legacyModels &&
      typeof context.params._meta?.reasoningEffort === 'string'
    ) {
      config.thought = context.params._meta.reasoningEffort;
    }
    const session = {
      sessionId: randomUUID(),
      cwd: path.resolve(context.params.cwd),
      title: 'Fixture session',
      createdAt: now,
      updatedAt: now,
      config,
      turns: [],
      pendingPrompt: null,
    };
    sessions.set(session.sessionId, session);
    await saveState();
    return { sessionId: session.sessionId, ...responseState(session) };
  })
  .onRequest(acp.methods.agent.session.list, async () => ({
    sessions: [...sessions.values()].map((session) => ({
      sessionId: session.sessionId,
      cwd: session.cwd,
      title: session.title,
      updatedAt: session.updatedAt,
    })),
    nextCursor: null,
  }))
  .onRequest(acp.methods.agent.session.load, async (context) => {
    const session = requireSession(context.params.sessionId);
    if (
      legacyModels &&
      typeof context.params._meta?.reasoningEffort === 'string'
    ) {
      session.config.thought = context.params._meta.reasoningEffort;
    }
    await replaySession(context.client, session);
    return responseState(session);
  })
  .onRequest(acp.methods.agent.session.resume, async (context) =>
    responseState(requireSession(context.params.sessionId)))
  .onRequest(acp.methods.agent.session.close, async (context) => {
    requireSession(context.params.sessionId).pendingPrompt?.abort();
    return {};
  })
  .onRequest(acp.methods.agent.session.delete, async (context) => {
    sessions.delete(context.params.sessionId);
    await saveState();
    return {};
  })
  .onRequest(acp.methods.agent.session.fork, async (context) => {
    if (!supportsFork) throw new Error('Fixture session fork is disabled.');
    const source = requireSession(context.params.sessionId);
    const now = new Date().toISOString();
    const forked = {
      ...globalThis.structuredClone(source),
      sessionId: randomUUID(),
      cwd: path.resolve(context.params.cwd),
      title: `${source.title} fork`,
      createdAt: now,
      updatedAt: now,
      pendingPrompt: null,
    };
    sessions.set(forked.sessionId, forked);
    await saveState();
    return { sessionId: forked.sessionId, ...responseState(forked) };
  })
  .onRequest(acp.methods.agent.session.setMode, async (context) => {
    const session = requireSession(context.params.sessionId);
    if (legacyModels) session.config.thought = context.params.modeId;
    else session.config.mode = context.params.modeId;
    session.updatedAt = new Date().toISOString();
    await saveState();
    return {};
  })
  .onRequest('session/set_model', (params) => params, async (context) => {
    const session = requireSession(context.params.sessionId);
    session.config.model = context.params.modelId;
    session.updatedAt = new Date().toISOString();
    await saveState();
    return {};
  })
  .onRequest(acp.methods.agent.session.setConfigOption, async (context) => {
    const session = requireSession(context.params.sessionId);
    if (context.params.configId === 'model') session.config.model = context.params.value;
    if (context.params.configId === 'thought-level') session.config.thought = context.params.value;
    if (context.params.configId === 'fast-mode') session.config.fast = context.params.value === true;
    session.updatedAt = new Date().toISOString();
    await saveState();
    return { configOptions: configOptions(session) };
  })
  .onRequest(
    'remoteCodex/fixture.session/v1/compact',
    (params) => params,
    async (context) => {
      const providerSessionId = context.params.params?.providerSessionId;
      requireSession(providerSessionId);
      await context.client.notify('remoteCodex/harness-extension/event', {
        protocol: 'remote-codex.harness-extension/v1',
        extensionId: 'fixture.session',
        extensionVersion: 1,
        event: 'checkpoint',
        operationId: context.params.operationId,
        providerSessionId,
        providerTurnId: context.params.params?.providerTurnId ?? null,
        providerItemId: 'fixture-checkpoint',
        sequence: 1,
        payload: { status: 'completed' },
      });
      return {
        compacted: true,
        operationId: context.params.operationId,
      };
    },
  )
  .onRequest('_session/steering', (params) => params, async (context) => {
    const session = requireSession(context.params.sessionId);
    if (session.pendingPrompt) {
      await notify(context.client, session.sessionId, {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: ' STEERED' },
      });
    }
    return { accepted: true };
  })
  .onRequest('_session/goal', (params) => params, handleGoalControl)
  .onRequest('fixture/goal/control', (params) => params, handleGoalControl)
  .onRequest(acp.methods.agent.session.prompt, async (context) => {
    const session = requireSession(context.params.sessionId);
    const pendingPrompt = new globalThis.AbortController();
    session.pendingPrompt?.abort();
    session.pendingPrompt = pendingPrompt;
    const prompt = promptText(context.params.prompt);
    const turnNumber = session.turns.length + 1;

    await notify(context.client, session.sessionId, {
      sessionUpdate: 'agent_thought_chunk',
      content: { type: 'text', text: `Reasoning for fixture turn ${turnNumber}.` },
    });
    await notify(context.client, session.sessionId, {
      sessionUpdate: 'tool_call',
      toolCallId: `${session.sessionId}:failed-check:${turnNumber}`,
      title: 'Optional fixture check',
      kind: 'execute',
      status: 'failed',
      rawInput: { command: 'fixture-check' },
      rawOutput: { exitCode: 1 },
    });
    await notify(context.client, session.sessionId, {
      sessionUpdate: 'plan',
      entries: [
        { content: 'Inspect fixture', priority: 'high', status: 'completed' },
        { content: 'Return marker', priority: 'high', status: 'in_progress' },
      ],
    });
    const partialResponse = `FAKE_ACP_PARTIAL_${turnNumber}`;
    const finalResponse = `${partialResponse}_COMPLETE`;
    const persistedTurn = {
      prompt,
      reasoning: `Reasoning for fixture turn ${turnNumber}.`,
      response: partialResponse,
      usage: { used: turnNumber * 100, size: 4096 },
    };
    if (streamDelayMs > 0) {
      session.turns.push(persistedTurn);
      session.updatedAt = new Date().toISOString();
      await saveState();
      await notify(context.client, session.sessionId, {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: partialResponse },
      });
      await delay(streamDelayMs, pendingPrompt.signal);
      persistedTurn.response = finalResponse;
      await notify(context.client, session.sessionId, {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: '_COMPLETE' },
      });
      await notify(context.client, session.sessionId, {
        sessionUpdate: 'usage_update',
        used: turnNumber * 100,
        size: 4096,
      });
      session.updatedAt = new Date().toISOString();
      session.pendingPrompt = null;
      await saveState();
      return completedPromptResponse(turnNumber);
    }
    const permission = skipPermission
      ? { outcome: { outcome: 'selected', optionId: 'allow-once' } }
      : await context.client.request(
          acp.methods.client.session.requestPermission,
          {
            sessionId: session.sessionId,
            toolCall: {
              toolCallId: `${session.sessionId}:write:${turnNumber}`,
              title: 'Write fixture result',
              kind: 'edit',
              status: 'pending',
              rawInput: { path: 'fixture-output.txt' },
            },
            options: [
              { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
              { optionId: 'allow-always', name: 'Allow always', kind: 'allow_always' },
              { optionId: 'reject-once', name: 'Reject once', kind: 'reject_once' },
            ],
          },
        );
    if (pendingPrompt.signal.aborted || permission.outcome.outcome === 'cancelled') {
      session.pendingPrompt = null;
      return { stopReason: 'cancelled' };
    }

    await notify(context.client, session.sessionId, {
      sessionUpdate: 'tool_call_update',
      toolCallId: `${session.sessionId}:write:${turnNumber}`,
      title: 'Write fixture result',
      kind: 'edit',
      status: 'completed',
      rawOutput: { permission: permission.outcome.optionId },
    });
    session.turns.push(persistedTurn);
    session.updatedAt = new Date().toISOString();
    await saveState();
    await notify(context.client, session.sessionId, {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: partialResponse },
    });
    await notify(context.client, session.sessionId, {
      sessionUpdate: 'usage_update',
      used: turnNumber * 100,
      size: 4096,
    });
    session.updatedAt = new Date().toISOString();
    session.pendingPrompt = null;
    await saveState();
    return completedPromptResponse(turnNumber);
  })
  .onNotification(acp.methods.agent.session.cancel, async (context) => {
    requireSession(context.params.sessionId).pendingPrompt?.abort();
  })
  .connect(stream);
