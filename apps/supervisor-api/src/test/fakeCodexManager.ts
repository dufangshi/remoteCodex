import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';

import {
  CodexMcpServerRecord,
  CodexHooksListEntry,
  CodexSkillsListEntry,
  CodexThreadGoalRecord,
  CodexThreadRecord,
  JsonRpcClientError,
  ReasoningEffort,
  ThreadGoalSetInput,
} from '../../../../packages/codex/src/index';

function makeThread(overrides: Partial<CodexThreadRecord> = {}): CodexThreadRecord {
  return {
    id: overrides.id ?? 'codex-thread-1',
    preview: overrides.preview ?? 'Preview',
    createdAt: overrides.createdAt ?? Math.floor(Date.now() / 1000),
    updatedAt: overrides.updatedAt ?? Math.floor(Date.now() / 1000),
    status: overrides.status ?? { type: 'idle' },
    cwd: overrides.cwd ?? '/tmp/workspace',
    name: overrides.name ?? 'Thread',
    turns: overrides.turns ?? []
  };
}

export class FakeCodexManager extends EventEmitter {
  status = {
    state: 'ready' as const,
    transport: 'stdio' as const,
    lastStartedAt: new Date().toISOString(),
    lastError: null,
    restartCount: 0
  };

  models = [
    {
      id: 'model-1',
      model: 'gpt-5',
      displayName: 'GPT-5',
      description: 'Default test model',
      hidden: false,
      isDefault: true,
      supportsPerformanceMode: true,
      supportedReasoningEfforts: [
        { reasoningEffort: 'low' as ReasoningEffort, description: 'Fast responses' },
        { reasoningEffort: 'medium' as ReasoningEffort, description: 'Balanced' },
        { reasoningEffort: 'high' as ReasoningEffort, description: 'Deeper reasoning' }
      ],
      defaultReasoningEffort: 'medium' as ReasoningEffort
    }
  ];
  resumeModel = 'gpt-5';
  resumeReasoningEffort: ReasoningEffort | null = 'medium';

  threads = new Map<string, CodexThreadRecord>();
  loadedThreadIds = new Set<string>();
  readThreadErrors = new Map<string, JsonRpcClientError>();
  readThreadCallCount = new Map<string, number>();
  ignoreReadThreadPaging = false;
  skillsEntries: CodexSkillsListEntry[] = [];
  mcpServers: CodexMcpServerRecord[] = [];
  hooksEntries: CodexHooksListEntry[] = [];
  hooksListError: JsonRpcClientError | null = null;
  hookTrustCalls: Array<{ key: string; trustedHash: string | null }> = [];
  goals = new Map<string, CodexThreadGoalRecord>();
  goalSetCalls: ThreadGoalSetInput[] = [];
  goalClearCalls: string[] = [];
  experimentalFeatureEnablementCalls: Record<string, boolean>[] = [];
  steerError: JsonRpcClientError | null = null;
  materializeSteersImmediately = true;
  steerTurnCalls: Array<{ threadId: string; turnId: string; prompt: string }> = [];
  compactThreadCalls: string[] = [];
  forkThreadCalls: string[] = [];
  rollbackThreadCalls: Array<{ threadId: string; count: number }> = [];
  serverRequestResponses: Array<{ id: number; result: unknown }> = [];
  stopCalls = 0;
  startCalls = 0;
  startTurnCalls: Array<{
    threadId: string;
    prompt: string;
    developerInstructions?: string | null;
    serviceTier?: 'fast' | 'flex' | null;
  }> = [];

  async start() {
    this.startCalls += 1;
  }

  async stop() {
    this.stopCalls += 1;
  }

  getStatus() {
    return this.status;
  }

  async listModels() {
    return this.models;
  }

  async listThreads() {
    return [...this.threads.values()];
  }

  async listLoadedThreads() {
    return [...this.loadedThreadIds];
  }

  async listSkills(input: { cwds?: string[]; forceReload?: boolean } = {}) {
    void input;
    return this.skillsEntries;
  }

  async listMcpServers() {
    return this.mcpServers;
  }

  async listHooks(input: { cwds?: string[] } = {}) {
    void input;
    if (this.hooksListError) {
      throw this.hooksListError;
    }

    return this.hooksEntries;
  }

  async setHookTrust(input: { key: string; trustedHash: string | null }) {
    this.hookTrustCalls.push(input);
    for (const entry of this.hooksEntries) {
      for (const hook of entry.hooks) {
        if (hook.key !== input.key) {
          continue;
        }
        hook.trustStatus =
          input.trustedHash && input.trustedHash === hook.currentHash
            ? 'trusted'
            : 'untrusted';
      }
    }
  }

  async startThread(input: { cwd: string; model: string; sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access' | null; serviceTier?: 'fast' | 'flex' | null }) {
    const thread = makeThread({
      id: `codex-${this.threads.size + 1}`,
      cwd: input.cwd,
      name: null,
      preview: ''
    });
    this.threads.set(thread.id, thread);
    this.loadedThreadIds.add(thread.id);
    return {
      thread,
      model: input.model,
      reasoningEffort: 'medium' as ReasoningEffort,
      sandbox: input.sandbox ?? 'danger-full-access',
    };
  }

  async readThread(threadId: string, input: { limit?: number; beforeTurnId?: string | null } = {}) {
    this.readThreadCallCount.set(
      threadId,
      (this.readThreadCallCount.get(threadId) ?? 0) + 1,
    );
    const configuredError = this.readThreadErrors.get(threadId);
    if (configuredError) {
      throw configuredError;
    }

    const thread = this.threads.get(threadId) ?? makeThread({ id: threadId });
    if (thread.turns.length === 0) {
      throw new JsonRpcClientError(
        `thread ${threadId} is not materialized yet; includeTurns is unavailable before first user message`,
        'remote_error',
        { code: -32600 }
      );
    }

    if (this.ignoreReadThreadPaging || (input.limit === undefined && !input.beforeTurnId)) {
      return thread;
    }

    const beforeIndex = input.beforeTurnId
      ? thread.turns.findIndex((turn: { id: string }) => turn.id === input.beforeTurnId)
      : thread.turns.length;
    const exclusiveEnd = beforeIndex >= 0 ? beforeIndex : thread.turns.length;
    const limit = input.limit ?? thread.turns.length;
    return {
      ...thread,
      totalTurnCount: thread.turns.length,
      turns: thread.turns.slice(Math.max(0, exclusiveEnd - limit), exclusiveEnd),
    };
  }

  async resumeThread(input: { threadId: string; model?: string | null; sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access' | null; serviceTier?: 'fast' | 'flex' | null }) {
    const thread = this.threads.get(input.threadId) ?? makeThread({ id: input.threadId });
    if (thread.turns.length === 0) {
      throw new JsonRpcClientError(`no rollout found for thread id ${input.threadId}`, 'remote_error', {
        code: -32600
      });
    }

    this.loadedThreadIds.add(input.threadId);
    this.threads.set(thread.id, thread);
    return {
      thread,
      model: input.model ?? this.resumeModel,
      reasoningEffort: this.resumeReasoningEffort,
      sandbox: input.sandbox ?? 'danger-full-access',
    };
  }

  async startTurn(input: {
    threadId: string;
    prompt: string;
    model?: string | null;
    effort?: ReasoningEffort | null;
    collaborationMode?: 'default' | 'plan' | null;
    developerInstructions?: string | null;
    sandboxPolicy?: 'read-only' | 'workspace-write' | 'danger-full-access' | null;
    serviceTier?: 'fast' | 'flex' | null;
  }) {
    this.startTurnCalls.push({
      threadId: input.threadId,
      prompt: input.prompt,
      ...(input.developerInstructions !== undefined
        ? { developerInstructions: input.developerInstructions }
        : {}),
      ...(input.serviceTier !== undefined
        ? { serviceTier: input.serviceTier }
        : {}),
    });
    const existing = this.threads.get(input.threadId) ?? makeThread({ id: input.threadId });
    const turn = {
      id: `turn-${Date.now()}`,
      status: 'inProgress' as const,
      error: null,
      items: [
        {
          id: 'user-item',
          type: 'userMessage',
          content: [{ type: 'text', text: input.prompt }]
        }
      ]
    };
    this.threads.set(input.threadId, {
      ...existing,
      preview: input.prompt,
      updatedAt: Math.floor(Date.now() / 1000),
      status: { type: 'active', activeFlags: [] },
      turns: [...existing.turns, turn]
    });
    return turn;
  }

  async steerTurn(input: {
    threadId: string;
    turnId: string;
    prompt: string;
  }) {
    this.steerTurnCalls.push(input);

    if (this.steerError) {
      throw this.steerError;
    }

    const existing = this.threads.get(input.threadId) ?? makeThread({ id: input.threadId });
    if (!this.materializeSteersImmediately) {
      return existing.turns.find((turn) => turn.id === input.turnId) ?? null;
    }

    const turns = existing.turns.map((turn) =>
      turn.id === input.turnId
        ? {
            ...turn,
            items: [
              ...turn.items,
              {
                id: randomUUID(),
                type: 'userMessage',
                content: [{ type: 'text', text: input.prompt }],
              },
            ],
          }
        : turn,
    );
    this.threads.set(input.threadId, {
      ...existing,
      updatedAt: Math.floor(Date.now() / 1000),
      turns,
    });

    return turns.find((turn) => turn.id === input.turnId) ?? null;
  }

  async interruptTurn(_threadId: string, turnId: string) {
    return {
      id: turnId,
      status: 'interrupted' as const,
      error: null,
      items: []
    };
  }

  async compactThread(threadId: string) {
    this.compactThreadCalls.push(threadId);
  }

  async getThreadGoal(threadId: string) {
    return this.goals.get(threadId) ?? null;
  }

  async setThreadGoal(input: ThreadGoalSetInput) {
    this.goalSetCalls.push(input);
    const existing = this.goals.get(input.threadId);
    const now = Date.now();
    const goal: CodexThreadGoalRecord = {
      threadId: input.threadId,
      objective: input.objective ?? existing?.objective ?? 'Test goal',
      status: input.status ?? existing?.status ?? 'active',
      tokenBudget:
        input.tokenBudget !== undefined
          ? input.tokenBudget
          : existing?.tokenBudget ?? null,
      tokensUsed: existing?.tokensUsed ?? 0,
      timeUsedSeconds: existing?.timeUsedSeconds ?? 0,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.goals.set(input.threadId, goal);
    return goal;
  }

  async clearThreadGoal(threadId: string) {
    this.goalClearCalls.push(threadId);
    const existed = this.goals.delete(threadId);
    return existed;
  }

  async setExperimentalFeatureEnablement(enablement: Record<string, boolean>) {
    this.experimentalFeatureEnablementCalls.push(enablement);
  }

  emitServerEvent(event: unknown) {
    this.emit('notification', event);
  }

  completeTurn(
    threadId: string,
    turnId: string,
    status: 'completed' | 'interrupted' | 'failed' = 'completed',
  ) {
    const existing = this.threads.get(threadId) ?? makeThread({ id: threadId });
    const turns = existing.turns.map((turn) =>
      turn.id === turnId
        ? {
            ...turn,
            status,
          }
        : turn,
    );
    const completedTurn =
      turns.find((turn) => turn.id === turnId) ?? {
        id: turnId,
        status,
        error: null,
        items: [],
      };
    this.threads.set(threadId, {
      ...existing,
      updatedAt: Math.floor(Date.now() / 1000),
      status: { type: 'idle' },
      turns,
    });
    this.emitServerEvent({
      method: 'turn/completed',
      params: {
        threadId,
        turn: completedTurn,
      },
    });
  }

  async forkThread(input: { threadId: string }) {
    this.forkThreadCalls.push(input.threadId);
    const source = this.threads.get(input.threadId) ?? makeThread({ id: input.threadId });
    const forked = makeThread({
      ...source,
      id: `fork-${this.threads.size + 1}`,
      updatedAt: Math.floor(Date.now() / 1000),
    });
    this.threads.set(forked.id, forked);
    this.loadedThreadIds.add(forked.id);
    return forked;
  }

  async rollbackThread(input: { threadId: string; count: number }) {
    this.rollbackThreadCalls.push(input);
    const source = this.threads.get(input.threadId) ?? makeThread({ id: input.threadId });
    const retainedTurnCount = Math.max(0, source.turns.length - Math.max(0, input.count));
    const nextThread = {
      ...source,
      updatedAt: Math.floor(Date.now() / 1000),
      turns: source.turns.slice(0, retainedTurnCount),
    };
    this.threads.set(input.threadId, nextThread);
    return nextThread;
  }

  respondToServerRequest(id: number, result: unknown) {
    this.serverRequestResponses.push({ id, result });
  }
}
