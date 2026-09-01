import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  AgentProviderRequest,
  AgentRuntimeEvent,
} from '../../agent-runtime/src/index';
import { AcpAgentCatalog } from './agent-catalog';
import {
  AcpCatalogRuntimeAdapter,
  acpSessionId,
} from './catalog-runtime';

const runtimes: AcpCatalogRuntimeAdapter[] = [];

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.stop()));
  vi.unstubAllEnvs();
});

describe('AcpCatalogRuntimeAdapter', () => {
  it('keeps the built-in ACP runtime selectable when every base agent is missing', async () => {
    const runtime = new AcpCatalogRuntimeAdapter({
      catalog: new AcpAgentCatalog({
        definitions: [{
          id: 'missing-agent',
          displayName: 'Missing Agent',
          description: 'Missing ACP fixture',
          transport: 'native',
          baseCommand: 'remote-codex-missing-acp-agent',
          baseProbeCommand: 'remote-codex-missing-acp-agent --version',
          serverCommand: 'remote-codex-missing-acp-agent acp',
          serverProbeCommand: 'remote-codex-missing-acp-agent acp --help',
          installCommand: null,
        }],
      }),
    });
    runtimes.push(runtime);

    const agents = await runtime.listModels();

    expect(agents).toMatchObject([{
      id: 'missing-agent',
      acpAgent: { availability: 'base_missing' },
    }]);
    expect(runtime.installation).toMatchObject({
      installed: true,
      installedVersion: 'Built in · 0 ACP agents ready',
      lastError: 'No supported base agent was detected.',
    });
    expect(runtime.getStatus()).toMatchObject({
      state: 'degraded',
      lastError: 'No supported base agent was detected.',
    });
    expect(await runtime.getAgentCapabilitySnapshot('missing-agent')).toEqual({
      provider: 'acp',
      agentId: 'missing-agent',
      availability: 'base_missing',
      negotiated: null,
      effectiveCapabilities: null,
    });
    await expect(
      runtime.listModelsForAgent('missing-agent', process.cwd()),
    ).rejects.toThrow(/Install the base agent first/);
    expect(runtime.getStatus().operationalMetrics).toEqual({
      sessionStartFailures: 0,
      resumeFailures: 0,
      capabilityProbeFailures: 1,
    });
  });

  it('selects a concrete agent and scopes its provider session id', async () => {
    const fixture = path.resolve('src/test/fixtures/fake-acp-agent.mjs');
    vi.stubEnv('REMOTE_CODEX_FAKE_ACP_FORK', '1');
    const runtime = new AcpCatalogRuntimeAdapter({
      catalog: new AcpAgentCatalog({
        definitions: [{
          id: 'fixture-agent',
          displayName: 'Fixture Agent',
          description: 'ACP fixture',
          transport: 'native',
          baseCommand: process.execPath,
          baseProbeCommand: `"${process.execPath}" --version`,
          serverCommand: `"${process.execPath}" "${fixture}"`,
          serverProbeCommand: `"${process.execPath}" --version`,
          installCommand: null,
        }],
      }),
      startupTimeoutMs: 5_000,
    });
    runtimes.push(runtime);
    runtime.on('provider-request', (request) => {
      const mapping = runtime.mapProviderRequest(
        request as AgentProviderRequest,
        { approvalMode: 'yolo' },
      );
      if (mapping?.autoApprovedResult) {
        runtime.respondToProviderRequest(mapping.providerRequestId, mapping.autoApprovedResult);
      }
    });

    await runtime.start();
    expect(await runtime.listModels()).toMatchObject([{
      id: 'fixture-agent',
      model: 'fixture-agent',
      selectionKind: 'agent',
      acpAgent: { availability: 'ready' },
    }]);
    const session = await runtime.startSession({
      cwd: process.cwd(),
      agentId: 'fixture-agent',
      model: 'default',
      approvalMode: 'yolo',
      sandboxMode: 'workspace-write',
    });
    expect(acpSessionId.decode(session.providerSessionId)).toMatchObject({
      agentId: 'fixture-agent',
    });
    expect(session.agentId).toBe('fixture-agent');
    expect(session.model).toBe('fixture-model');
    expect(await runtime.getAgentCapabilitySnapshot('fixture-agent')).toMatchObject({
      provider: 'acp',
      agentId: 'fixture-agent',
      availability: 'ready',
      effectiveCapabilities: {
        sessions: {
          list: true,
          load: true,
          resume: true,
          close: true,
          delete: true,
        },
      },
    });

    const completed = new Promise<Extract<AgentRuntimeEvent, { type: 'turn.completed' }>>(
      (resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Catalog turn timed out.')), 10_000);
        runtime.on('event', (event: AgentRuntimeEvent) => {
          if (event.type === 'turn.completed') {
            clearTimeout(timer);
            resolve(event);
          }
        });
      },
    );
    await runtime.startTurn({
      providerSessionId: session.providerSessionId,
      prompt: 'Run the fixture turn.',
      model: 'default',
      workspacePath: process.cwd(),
    });
    const event = await completed;
    expect(event.providerSessionId).toBe(session.providerSessionId);
    expect(event.turn.items.map((item) => item.kind)).toEqual(expect.arrayContaining([
      'userMessage',
      'agentMessage',
      'fileChange',
      'commandExecution',
    ]));
    const forked = await runtime.forkSession({
      providerSessionId: session.providerSessionId,
    });
    expect(acpSessionId.decode(forked.providerSessionId)).toMatchObject({
      agentId: 'fixture-agent',
    });
    expect(forked.agentId).toBe('fixture-agent');
  }, 15_000);

  it('delegates Codex child controls while preserving scoped goal identity', async () => {
    const fixture = path.resolve('src/test/fixtures/fake-acp-agent.mjs');
    vi.stubEnv('REMOTE_CODEX_FAKE_ACP_AGENT_KIND', 'codex');
    vi.stubEnv('REMOTE_CODEX_FAKE_ACP_SKIP_PERMISSION', '1');
    const runtime = new AcpCatalogRuntimeAdapter({
      catalog: new AcpAgentCatalog({
        definitions: [{
          id: 'codex',
          displayName: 'Codex fixture',
          description: 'Codex ACP fixture',
          transport: 'adapter',
          baseCommand: process.execPath,
          baseProbeCommand: `"${process.execPath}" --version`,
          serverCommand: `"${process.execPath}" "${fixture}"`,
          serverProbeCommand: `"${process.execPath}" --version`,
          installCommand: null,
        }],
      }),
      startupTimeoutMs: 5_000,
    });
    runtimes.push(runtime);
    await runtime.start();
    await expect(runtime.listImportSessions('codex')).resolves.toEqual([]);
    expect(runtime.managementSchema.toolboxItems.map((item) => item.command)).toEqual([
      '/fast',
      '/compact',
      '/goal',
      '/fork',
    ]);
    expect(await runtime.listModelsForAgent('codex', process.cwd())).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ supportsPerformanceMode: true }),
      ]),
    );
    expect(runtime.capabilities).toMatchObject({
      turns: { steer: true, compact: true },
      controls: { goals: true },
    });
    expect(runtime.getScopedCapabilities({ agentId: 'codex' })).toMatchObject({
      turns: { steer: true, compact: true },
      controls: { goals: true },
    });
    expect(runtime.getScopedCapabilities({ agentId: 'unstarted-agent' })).toMatchObject({
      turns: { steer: false, compact: false },
      controls: { goals: false, performanceMode: false },
    });
    const session = await runtime.startSession({
      cwd: process.cwd(),
      agentId: 'codex',
      model: 'fixture-model',
      approvalMode: 'yolo',
    });
    expect(runtime.capabilities).toMatchObject({
      turns: { steer: true, compact: true },
      controls: { goals: true },
    });
    const goal = await runtime.setGoal({
      providerSessionId: session.providerSessionId,
      objective: 'Scoped catalog goal',
    });
    expect(goal).toMatchObject({
      providerSessionId: session.providerSessionId,
      objective: 'Scoped catalog goal',
    });
    await expect(runtime.compactSession(session.providerSessionId)).resolves.toBeUndefined();
    expect(await runtime.clearGoal(session.providerSessionId)).toBe(true);

    await runtime.stop();
    expect(runtime.capabilities).toMatchObject({
      turns: { steer: false, compact: false },
      controls: { goals: false, performanceMode: false },
    });
  }, 15_000);

  it('keeps request and session scopes distinct for guarded permissions', async () => {
    const fixture = path.resolve('src/test/fixtures/fake-acp-agent.mjs');
    const runtime = new AcpCatalogRuntimeAdapter({
      catalog: new AcpAgentCatalog({
        definitions: [{
          id: 'guarded-agent',
          displayName: 'Guarded fixture',
          description: 'Guarded ACP fixture',
          transport: 'native',
          baseCommand: process.execPath,
          baseProbeCommand: `"${process.execPath}" --version`,
          serverCommand: `"${process.execPath}" "${fixture}"`,
          serverProbeCommand: `"${process.execPath}" --version`,
          installCommand: null,
        }],
      }),
      startupTimeoutMs: 5_000,
    });
    runtimes.push(runtime);
    const permission = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Guarded permission timed out.')), 10_000);
      runtime.on('provider-request', (request: AgentProviderRequest) => {
        const mapping = runtime.mapProviderRequest(request, { approvalMode: 'guarded' });
        if (!mapping?.pendingRequest) return;
        clearTimeout(timer);
        expect(acpSessionId.decode(mapping.providerSessionId)).toMatchObject({
          agentId: 'guarded-agent',
        });
        const result = runtime.buildProviderRequestResponse(
          mapping.pendingRequest,
          { answers: { permission: { answers: ['Allow once'] } } },
        );
        runtime.respondToProviderRequest(mapping.providerRequestId, result);
        resolve();
      });
    });
    const session = await runtime.startSession({
      cwd: process.cwd(),
      agentId: 'guarded-agent',
      model: 'fixture-model',
      approvalMode: 'guarded',
    });
    await runtime.startTurn({
      providerSessionId: session.providerSessionId,
      prompt: 'Request guarded fixture permission.',
    });
    await permission;
  }, 15_000);
});
