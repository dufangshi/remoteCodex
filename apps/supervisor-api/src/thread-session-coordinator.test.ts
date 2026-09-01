import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import {
  AgentRuntimeRegistry,
  type AgentProviderCapabilities,
  type AgentRuntime,
} from '../../../packages/agent-runtime/src/index';
import { ThreadProviderRuntimeCoordinator } from './thread-provider-runtime-coordinator';
import { ThreadSessionCoordinator } from './thread-session-coordinator';

function capabilities(input: { steer: boolean; fast: boolean }) {
  return {
    sessions: { list: true, read: true, resume: true, importLocal: false },
    turns: {
      start: true,
      streamInput: false,
      steer: input.steer,
      interrupt: true,
      compact: false,
    },
    branching: {
      fork: false,
      hardRollback: false,
      resumeAt: false,
      rewindFiles: false,
    },
    controls: {
      planMode: true,
      permissionRequests: true,
      sandboxMode: true,
      performanceMode: input.fast,
      goals: false,
    },
    management: {
      models: true,
      mcpStatus: false,
      skills: false,
      hooks: false,
      hookTrust: false,
      hostConfigFiles: false,
      providerSettings: false,
    },
    usage: { contextWindow: true, tokenUsage: true, costUsd: false },
  } satisfies AgentProviderCapabilities;
}

function model(agentId: string) {
  const supportsPerformanceMode = agentId === 'codex';
  return [{
    id: `${agentId}-model`,
    model: `${agentId}-model`,
    displayName: `${agentId} model`,
    description: '',
    isDefault: true,
    hidden: false,
    supportsPerformanceMode,
    supportedReasoningEfforts: [],
    defaultReasoningEffort: null,
  }];
}

function scopedAcpRuntime() {
  const runtime = Object.assign(new EventEmitter(), {
    provider: 'acp' as const,
    displayName: 'Scoped ACP',
    description: 'Scoped ACP fixture',
    capabilities: capabilities({ steer: true, fast: true }),
    managementSchema: {
      hostConfigFiles: [],
      toolboxItems: [],
      hookCommandTemplates: [],
      providerConfigFormat: 'none' as const,
      mcpConfigFormat: 'none' as const,
      configArchives: false,
      buildRestart: false,
    },
    installation: {
      packageName: null,
      installed: true,
      installedVersion: 'fixture',
      latestVersion: null,
      installCommand: null,
      updateCommand: null,
      busy: false,
      lastError: null,
    },
    getStatus: () => ({
      state: 'ready' as const,
      transport: 'stdio' as const,
      lastStartedAt: null,
      lastError: null,
      restartCount: 0,
    }),
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    listModels: vi.fn(async () => model('codex')),
    listModelsForAgent: vi.fn(async (agentId: string) => model(agentId)),
    getScopedCapabilities: ({ agentId }: { agentId?: string | null }) =>
      capabilities({
        steer: agentId === 'codex',
        fast: agentId === 'codex',
      }),
    listSessions: vi.fn(async () => []),
    listLoadedSessions: vi.fn(async () => []),
    readSession: vi.fn(),
    startSession: vi.fn(async (input) => ({
      provider: 'acp' as const,
      agentId: input.agentId ?? null,
      providerSessionId: `${input.agentId}::session`,
      model: input.model,
      reasoningEffort: null,
      session: {
        provider: 'acp' as const,
        agentId: input.agentId ?? null,
        providerSessionId: `${input.agentId}::session`,
        cwd: input.cwd,
        title: null,
        preview: null,
        createdAt: null,
        updatedAt: null,
        status: 'idle' as const,
        turns: [],
      },
    })),
    resumeSession: vi.fn(),
    startTurn: vi.fn(),
    sendInput: vi.fn(),
    interruptTurn: vi.fn(),
  }) as unknown as AgentRuntime;
  return runtime;
}

describe('ThreadSessionCoordinator scoped capabilities', () => {
  it('does not leak steer or fast mode from one ACP child to another', async () => {
    const runtime = scopedAcpRuntime();
    const providerRuntime = new ThreadProviderRuntimeCoordinator(
      new AgentRuntimeRegistry([runtime]),
    );
    const coordinator = new ThreadSessionCoordinator(
      providerRuntime,
      {
        readFastMode: () => true,
        writeFastMode: vi.fn(async () => undefined),
      },
      {
        findSession: vi.fn(async () => null),
        findImportSession: vi.fn(async () => null),
      },
    );

    const basic = await coordinator.resolvePromptTurnConfig({
      provider: 'acp',
      agentId: 'basic',
      workspacePath: '/tmp/basic',
      currentModel: 'basic-model',
      currentReasoningEffort: null,
      currentFastMode: true,
      currentCollaborationMode: 'default',
      currentSandboxMode: 'workspace-write',
      approvalMode: 'yolo',
    });
    expect(basic).toMatchObject({
      performanceMode: null,
      supportsRunningTurnInput: false,
    });

    const codex = await coordinator.resolvePromptTurnConfig({
      provider: 'acp',
      agentId: 'codex',
      workspacePath: '/tmp/codex',
      currentModel: 'codex-model',
      currentReasoningEffort: null,
      currentFastMode: true,
      currentCollaborationMode: 'default',
      currentSandboxMode: 'workspace-write',
      approvalMode: 'yolo',
    });
    expect(codex).toMatchObject({
      performanceMode: 'fast',
      supportsRunningTurnInput: true,
    });

    const started = await coordinator.startThreadSession({
      workspacePath: '/tmp/basic',
      defaultTitle: 'Basic ACP',
      threadInput: {
        workspaceId: 'workspace-basic',
        provider: 'acp',
        agentId: 'basic',
        model: 'basic-model',
        approvalMode: 'yolo',
      },
    });
    expect(started.fastMode).toBe(false);
    expect(runtime.startSession).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ performanceMode: expect.anything() }),
    );

    await expect(coordinator.resolveThreadSettings({
      provider: 'acp',
      agentId: 'basic',
      workspacePath: '/tmp/basic',
      currentModel: 'basic-model',
      currentReasoningEffort: null,
      currentFastMode: false,
      currentCollaborationMode: 'default',
      currentSandboxMode: 'workspace-write',
      settings: { fastMode: true },
    })).rejects.toThrow('Current model does not support fast mode.');
  });
});
