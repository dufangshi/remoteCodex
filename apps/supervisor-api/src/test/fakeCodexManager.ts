import { EventEmitter } from 'node:events';

import { CodexThreadRecord, JsonRpcClientError, ReasoningEffort } from '../../../../packages/codex/src/index';

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

  async start() {}

  async stop() {}

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

  async startThread(input: { cwd: string; model: string; sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access' | null }) {
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

  async readThread(threadId: string) {
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

    return thread;
  }

  async resumeThread(input: { threadId: string; model?: string | null; sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access' | null }) {
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
    sandboxPolicy?: 'read-only' | 'workspace-write' | 'danger-full-access' | null;
  }) {
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

  async interruptTurn(_threadId: string, turnId: string) {
    return {
      id: turnId,
      status: 'interrupted' as const,
      error: null,
      items: []
    };
  }

  respondToServerRequest(id: number, result: unknown) {
    void id;
    void result;
  }
}
