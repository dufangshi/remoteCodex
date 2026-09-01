import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  AgentProviderRequest,
  AgentRuntimeEvent,
} from '../../agent-runtime/src/index';
import { AcpRuntimeAdapter } from './runtimeAdapter';

const adapters: AcpRuntimeAdapter[] = [];
const fixture = path.resolve('src/test/fixtures/fake-acp-agent.mjs');

afterEach(async () => {
  await Promise.all(adapters.splice(0).map((adapter) => adapter.stop()));
});

describe('AcpRuntimeAdapter', () => {
  it('runs a stdio ACP turn and resolves protocol permissions', async () => {
    const adapter = new AcpRuntimeAdapter({
      command: `"${process.execPath}" "${fixture}"`,
      startupTimeoutMs: 5_000,
      clientInfo: {
        name: 'remote-codex-acp-test',
        version: '1.0.0',
      },
    });
    adapters.push(adapter);
    const events: AgentRuntimeEvent[] = [];
    adapter.on('event', (event) => events.push(event as AgentRuntimeEvent));
    adapter.on('provider-request', (request) => {
      const mapping = adapter.mapProviderRequest(
        request as AgentProviderRequest,
        { approvalMode: 'yolo' },
      );
      if (mapping?.autoApprovedResult) {
        adapter.respondToProviderRequest(mapping.providerRequestId, mapping.autoApprovedResult);
      }
    });

    await adapter.start();
    expect(adapter.getStatus().state).toBe('ready');
    const started = await adapter.startSession({
      cwd: process.cwd(),
      model: 'default',
      approvalMode: 'yolo',
      sandboxMode: 'workspace-write',
    });
    const completed = new Promise<Extract<AgentRuntimeEvent, { type: 'turn.completed' }>>(
      (resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('ACP turn did not complete.')), 10_000);
        adapter.on('event', (event: AgentRuntimeEvent) => {
          if (event.type === 'turn.completed') {
            clearTimeout(timer);
            resolve(event);
          }
        });
      },
    );
    await adapter.startTurn({
      providerSessionId: started.providerSessionId,
      prompt: 'Inspect this project.',
      workspacePath: process.cwd(),
    });
    const event = await completed;

    expect(event.turn.status).toBe('completed');
    expect(event.turn.items.map((item) => item.kind)).toEqual(expect.arrayContaining([
      'userMessage',
      'agentMessage',
      'reasoning',
      'fileChange',
      'commandExecution',
      'plan',
    ]));
    expect(events.some((candidate) => candidate.type === 'output.delta')).toBe(true);
    expect(events.some((candidate) => candidate.type === 'usage.updated')).toBe(true);
    expect(await adapter.listLoadedSessions()).toContain(started.providerSessionId);
  }, 15_000);

  it('lists and resumes fixture sessions across ACP process restarts', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'remote-codex-fake-acp-'));
    const statePath = path.join(directory, 'state.json');
    const command = `"${process.execPath}" "${fixture}"`;
    const first = new AcpRuntimeAdapter({
      command,
      env: { REMOTE_CODEX_FAKE_ACP_STATE: statePath },
      startupTimeoutMs: 5_000,
    });
    adapters.push(first);
    first.on('provider-request', (request) => {
      const mapping = first.mapProviderRequest(request as AgentProviderRequest, {
        approvalMode: 'yolo',
      });
      if (mapping?.autoApprovedResult) {
        first.respondToProviderRequest(mapping.providerRequestId, mapping.autoApprovedResult);
      }
    });
    await first.start();
    const started = await first.startSession({
      cwd: process.cwd(),
      model: 'fixture-fast',
      reasoningEffort: 'high',
      approvalMode: 'yolo',
      sandboxMode: 'workspace-write',
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Fixture turn timed out.')), 10_000);
      first.on('event', (event: AgentRuntimeEvent) => {
        if (event.type === 'turn.completed') {
          clearTimeout(timer);
          resolve();
        }
      });
      void first.startTurn({
        providerSessionId: started.providerSessionId,
        prompt: 'Persist this fixture turn.',
      }).catch(reject);
    });
    await first.stop();
    adapters.splice(adapters.indexOf(first), 1);

    const second = new AcpRuntimeAdapter({
      command,
      env: { REMOTE_CODEX_FAKE_ACP_STATE: statePath },
      startupTimeoutMs: 5_000,
    });
    adapters.push(second);
    const replayEvents: AgentRuntimeEvent[] = [];
    second.on('event', (event) => replayEvents.push(event as AgentRuntimeEvent));
    await second.start();
    expect(second.getProtocolSnapshot()).toMatchObject({
      protocolVersion: 1,
      harnessExtensions: [{
        id: 'fixture.session',
        version: 1,
        methods: ['compact'],
      }],
      legacyExtensions: {
        steering: { supported: true },
        goal: { controlMethod: 'fixture/goal/control' },
      },
    });
    expect(await second.listSessions()).toMatchObject([{
      providerSessionId: started.providerSessionId,
      cwd: process.cwd(),
      title: 'Fixture session',
    }]);
    const imported = await second.readSession(started.providerSessionId);
    expect(imported.turns).toHaveLength(1);
    expect(imported.turns[0]?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'userMessage', text: 'Persist this fixture turn.' }),
      expect.objectContaining({ kind: 'agentMessage' }),
    ]));
    const resumed = await second.resumeSession({
      providerSessionId: started.providerSessionId,
      model: 'fixture-fast',
    });
    await expect(second.resumeSession({
      providerSessionId: started.providerSessionId,
      model: 'missing-fixture-model',
    })).rejects.toThrow(/unknown model option/);
    expect((await second.resumeSession({
      providerSessionId: started.providerSessionId,
    })).model).toBe('fixture-fast');
    expect(resumed.session).toMatchObject({
      providerSessionId: started.providerSessionId,
      status: 'idle',
      turns: [{
        status: 'completed',
        items: [
          { kind: 'userMessage', text: 'Persist this fixture turn.' },
          { kind: 'reasoning' },
          { kind: 'commandExecution', status: 'failed' },
          { kind: 'plan' },
          { kind: 'agentMessage', text: 'FAKE_ACP_PARTIAL_1' },
        ],
      }],
      historyCoverage: {
        source: 'providerReplay',
        completeness: 'unknown',
        replayedTurnCount: 1,
      },
    });
    const hydratedTurnCount = resumed.session.turns.length;
    expect(replayEvents).toEqual([]);
    const nextCompleted = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Second fixture turn timed out.')), 10_000);
      second.on('event', (event: AgentRuntimeEvent) => {
        if (event.type === 'turn.completed') {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    second.on('provider-request', (request) => {
      const mapping = second.mapProviderRequest(request as AgentProviderRequest, {
        approvalMode: 'yolo',
      });
      if (mapping?.autoApprovedResult) {
        second.respondToProviderRequest(mapping.providerRequestId, mapping.autoApprovedResult);
      }
    });
    await second.startTurn({
      providerSessionId: started.providerSessionId,
      prompt: 'Run another fixture turn.',
    });
    await nextCompleted;
    expect(resumed.session.turns).toHaveLength(hydratedTurnCount);
    expect(await second.listLoadedSessions()).toContain(started.providerSessionId);
    await second.deleteSession(started.providerSessionId);
    expect(await second.listSessions()).toEqual([]);
  }, 20_000);

  it('settles active turns and pending permissions when the runtime stops', async () => {
    const adapter = new AcpRuntimeAdapter({
      command: `"${process.execPath}" "${fixture}"`,
      startupTimeoutMs: 5_000,
    });
    adapters.push(adapter);
    const events: AgentRuntimeEvent[] = [];
    const permissionRequested = new Promise<void>((resolve) => {
      adapter.once('provider-request', () => resolve());
    });
    adapter.on('event', (event) => events.push(event as AgentRuntimeEvent));
    await adapter.start();
    const session = await adapter.startSession({
      cwd: process.cwd(),
      model: 'fixture-model',
      approvalMode: 'guarded',
    });
    await adapter.startTurn({
      providerSessionId: session.providerSessionId,
      prompt: 'Wait for guarded permission.',
    });
    await permissionRequested;
    await adapter.stop();

    expect(events.find((event) => event.type === 'turn.completed')).toMatchObject({
      type: 'turn.completed',
      turn: {
        status: 'interrupted',
        error: { message: 'ACP runtime stopped.' },
      },
    });
  }, 15_000);

  it('shares negotiated steering, goal, and session fork across non-Codex ACP agents', async () => {
    const adapter = new AcpRuntimeAdapter({
      command: `"${process.execPath}" "${fixture}"`,
      env: {
        REMOTE_CODEX_FAKE_ACP_FORK: '1',
        REMOTE_CODEX_FAKE_ACP_SKIP_PERMISSION: '1',
      },
      startupTimeoutMs: 5_000,
    });
    adapters.push(adapter);
    await adapter.start();
    expect(adapter.capabilities).toMatchObject({
      turns: { steer: true, compact: false },
      branching: { fork: true, hardRollback: false },
      controls: { goals: true },
    });
    const session = await adapter.startSession({
      cwd: process.cwd(),
      model: 'fixture-model',
      approvalMode: 'yolo',
    });
    const completed = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Portable ACP turn timed out.')), 10_000);
      adapter.on('event', (event: AgentRuntimeEvent) => {
        if (event.type === 'turn.completed') {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    await adapter.startTurn({
      providerSessionId: session.providerSessionId,
      prompt: 'Preserve this portable context.',
    });
    await completed;

    const forked = await adapter.forkSession({
      providerSessionId: session.providerSessionId,
    });
    expect(forked.providerSessionId).not.toBe(session.providerSessionId);
    expect(forked.turns).toHaveLength(1);
    await expect(adapter.setGoal({
      providerSessionId: forked.providerSessionId,
      objective: 'Portable goal',
    })).resolves.toMatchObject({ objective: 'Portable goal' });
    await expect(adapter.clearGoal(forked.providerSessionId)).resolves.toBe(true);
  }, 15_000);

  it('derives lifecycle capabilities from the negotiated child agent', async () => {
    const adapter = new AcpRuntimeAdapter({
      command: `"${process.execPath}" "${fixture}"`,
      env: { REMOTE_CODEX_FAKE_ACP_CAPABILITY_PROFILE: 'minimal' },
      startupTimeoutMs: 5_000,
    });
    adapters.push(adapter);
    await adapter.start();

    expect(adapter.capabilities.sessions).toMatchObject({
      list: false,
      load: false,
      resume: false,
      close: false,
      delete: false,
    });
    expect(adapter.getProtocolSnapshot()).toMatchObject({
      agentCapabilities: {
        loadSession: false,
        promptCapabilities: {},
      },
    });
  });

  it('does not create model-probe sessions when the agent cannot clean them up', async () => {
    const adapter = new AcpRuntimeAdapter({
      command: `"${process.execPath}" "${fixture}"`,
      env: { REMOTE_CODEX_FAKE_ACP_NO_SESSION_CLEANUP: '1' },
      startupTimeoutMs: 5_000,
    });
    adapters.push(adapter);
    await adapter.start();

    await expect(adapter.inspectModelOptions(process.cwd())).resolves.toEqual([
      expect.objectContaining({ model: 'default', isDefault: true }),
    ]);
    await expect(adapter.listSessions()).resolves.toEqual([]);
  });

  it('does not treat session close as deletion for model probes', async () => {
    const adapter = new AcpRuntimeAdapter({
      command: `"${process.execPath}" "${fixture}"`,
      env: { REMOTE_CODEX_FAKE_ACP_NO_SESSION_DELETE: '1' },
      startupTimeoutMs: 5_000,
    });
    adapters.push(adapter);
    await adapter.start();

    expect(adapter.capabilities.sessions).toMatchObject({ close: true, delete: false });
    await expect(adapter.inspectModelOptions(process.cwd())).resolves.toEqual([
      expect.objectContaining({ model: 'default', isDefault: true }),
    ]);
    await expect(adapter.listSessions()).resolves.toEqual([]);
  });

  it('deletes temporary model-probe sessions', async () => {
    const adapter = new AcpRuntimeAdapter({
      command: `"${process.execPath}" "${fixture}"`,
      startupTimeoutMs: 5_000,
    });
    adapters.push(adapter);
    await adapter.start();

    await expect(adapter.listSessions()).resolves.toEqual([]);
    await expect(adapter.inspectModelOptions(process.cwd())).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ model: 'fixture-model', isDefault: true }),
        expect.objectContaining({ model: 'fixture-fast', isDefault: false }),
      ]),
    );
    await expect(adapter.listSessions()).resolves.toEqual([]);
  });

  it.each([
    { version: '2', actions: 'set,clear' },
    { version: 'unknown', actions: 'set,clear' },
    { version: '1', actions: 'set' },
  ])('fails closed for incompatible goal metadata: $version/$actions', async ({
    version,
    actions,
  }) => {
    const adapter = new AcpRuntimeAdapter({
      command: `"${process.execPath}" "${fixture}"`,
      env: {
        REMOTE_CODEX_FAKE_ACP_GOAL_VERSION: version,
        REMOTE_CODEX_FAKE_ACP_GOAL_ACTIONS: actions,
      },
      startupTimeoutMs: 5_000,
    });
    adapters.push(adapter);
    await adapter.start();

    expect(adapter.capabilities.controls.goals).toBe(false);
    expect(adapter.listHarnessExtensions()).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        descriptor: expect.objectContaining({ id: 'acp.goal' }),
      }),
    ]));
  });

  it('cleans compact control listeners when the hidden turn cannot start', async () => {
    const adapter = new AcpRuntimeAdapter({
      command: `"${process.execPath}" "${fixture}"`,
      env: {
        REMOTE_CODEX_FAKE_ACP_AGENT_KIND: 'codex',
        REMOTE_CODEX_FAKE_ACP_SKIP_PERMISSION: '1',
      },
      startupTimeoutMs: 5_000,
    });
    adapters.push(adapter);
    await adapter.start();
    const session = await adapter.startSession({
      cwd: process.cwd(),
      model: 'fixture-model',
      approvalMode: 'yolo',
    });
    const baselineListeners = adapter.listenerCount('event');
    vi.spyOn(adapter, 'startTurn').mockRejectedValueOnce(
      new Error('fixture compact start failure'),
    );

    await expect(adapter.compactSession(session.providerSessionId)).rejects.toThrow(
      /fixture compact start failure/,
    );
    expect(adapter.listenerCount('event')).toBe(baselineListeners);
  });

  it('invokes negotiated extensions and emits their events on the runtime event path', async () => {
    const adapter = new AcpRuntimeAdapter({
      command: `"${process.execPath}" "${fixture}"`,
      startupTimeoutMs: 5_000,
    });
    adapters.push(adapter);
    const events: AgentRuntimeEvent[] = [];
    adapter.on('event', (event) => events.push(event as AgentRuntimeEvent));
    await adapter.start();
    const session = await adapter.startSession({
      cwd: process.cwd(),
      model: 'fixture-model',
      approvalMode: 'yolo',
    });
    expect(adapter.listHarnessExtensions()).toEqual(expect.arrayContaining([
      expect.objectContaining({
      ownerId: 'acp-agent',
      descriptor: expect.objectContaining({ id: 'fixture.session', methods: ['compact'] }),
      }),
    ]));
    await expect(adapter.invokeHarnessExtension({
      extensionId: 'fixture.session',
      extensionVersion: 1,
      method: 'compact',
      operationId: 'operation-compact',
      idempotencyKey: 'session-compact-1',
      params: {
        providerSessionId: session.providerSessionId,
        providerTurnId: 'turn-compact',
      },
    })).resolves.toEqual({
      compacted: true,
      operationId: 'operation-compact',
    });
    expect(events).toContainEqual(expect.objectContaining({
      type: 'harness.extension',
      providerSessionId: session.providerSessionId,
      providerTurnId: 'turn-compact',
      extensionId: 'fixture.session',
      event: 'checkpoint',
    }));
  });

  it('adapts Codex legacy steering, goal, and compact controls on one ACP owner', async () => {
    const adapter = new AcpRuntimeAdapter({
      command: `"${process.execPath}" "${fixture}"`,
      env: {
        REMOTE_CODEX_FAKE_ACP_AGENT_KIND: 'codex',
        REMOTE_CODEX_FAKE_ACP_SKIP_PERMISSION: '1',
        REMOTE_CODEX_FAKE_ACP_STREAM_DELAY_MS: '100',
      },
      startupTimeoutMs: 5_000,
    });
    adapters.push(adapter);
    await adapter.start();
    expect(adapter.capabilities).toMatchObject({
      turns: { steer: true, compact: true },
      controls: { goals: true, performanceMode: false },
      branching: { fork: false, hardRollback: false },
    });
    const session = await adapter.startSession({
      cwd: process.cwd(),
      model: 'fixture-model',
      approvalMode: 'yolo',
      performanceMode: 'fast',
    });
    expect(adapter.capabilities.controls.performanceMode).toBe(true);
    const steeredTurn = new Promise<Extract<AgentRuntimeEvent, { type: 'turn.completed' }>>(
      (resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Steered fixture turn timed out.')), 10_000);
        adapter.on('event', (event: AgentRuntimeEvent) => {
          if (event.type === 'turn.completed') {
            clearTimeout(timer);
            resolve(event);
          }
        });
      },
    );
    const running = await adapter.startTurn({
      providerSessionId: session.providerSessionId,
      prompt: 'Start a steerable fixture turn.',
    });
    await expect(adapter.sendInput({
      providerSessionId: session.providerSessionId,
      providerTurnId: running.providerTurnId,
      prompt: 'Apply the steer.',
    })).resolves.not.toBeNull();
    expect((await steeredTurn).turn.items
      .filter((item) => item.kind === 'agentMessage')
      .map((item) => item.text)
      .join(''))
      .toContain('STEERED');
    const goal = await adapter.setGoal({
      providerSessionId: session.providerSessionId,
      objective: 'Finish the fixture goal',
    });
    expect(goal).toMatchObject({
      objective: 'Finish the fixture goal',
      status: 'active',
    });
    expect(await adapter.getGoal(session.providerSessionId)).toMatchObject({
      objective: 'Finish the fixture goal',
    });
    expect(await adapter.clearGoal(session.providerSessionId)).toBe(true);
    expect(await adapter.getGoal(session.providerSessionId)).toBeNull();
    await expect(adapter.compactSession(session.providerSessionId)).resolves.toBeUndefined();
  }, 15_000);
});
