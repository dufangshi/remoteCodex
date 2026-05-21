import { EventEmitter } from 'node:events';

import { describe, expect, it } from 'vitest';
import type {
  Query,
  SDKMessage,
  SDKSessionInfo,
  SessionMessage,
} from '@anthropic-ai/claude-agent-sdk';

import { ClaudeRuntimeAdapter } from './runtimeAdapter';
import { hiddenInitPrompt } from './historyItems';
import type { AgentRuntimeEvent } from '../../agent-runtime/src/index';

function wait(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class FakeQuery implements Query {
  interrupted = false;
  closed = false;
  private resolveRelease: (() => void) | null = null;
  private releasePromise: Promise<void> | null = null;

  constructor(
    private readonly messages: SDKMessage[],
    private readonly options: { holdOpen?: boolean } = {},
  ) {}

  [Symbol.asyncIterator]() {
    return this;
  }

  async next(): Promise<IteratorResult<SDKMessage, void>> {
    if (this.messages.length === 0) {
      if (this.options.holdOpen && !this.closed && !this.interrupted) {
        this.releasePromise ??= new Promise((resolve) => {
          this.resolveRelease = resolve;
        });
        await this.releasePromise;
      }
      return { done: true, value: undefined };
    }
    return { done: false, value: this.messages.shift()! };
  }

  async return(): Promise<IteratorResult<SDKMessage, void>> {
    this.close();
    return { done: true, value: undefined };
  }

  async throw(error?: unknown): Promise<IteratorResult<SDKMessage, void>> {
    throw error;
  }

  async interrupt() {
    this.interrupted = true;
    this.resolveRelease?.();
  }

  close() {
    this.closed = true;
    this.resolveRelease?.();
  }

  async setPermissionMode() {}
  async setModel() {}
  async setMaxThinkingTokens() {}
  async applyFlagSettings() {}
  async initializationResult(): Promise<any> {
    return {};
  }
  async supportedCommands(): Promise<any[]> {
    return [];
  }
  async supportedModels(): Promise<any[]> {
    return [
      {
        value: 'claude-sonnet-4-5',
        displayName: 'Claude Sonnet 4.5',
        description: 'Test model',
        supportsEffort: true,
        supportedEffortLevels: ['low', 'medium', 'high'],
      },
    ];
  }
  async supportedAgents(): Promise<any[]> {
    return [];
  }
  async mcpServerStatus(): Promise<any[]> {
    return [
      {
        name: 'docs',
        status: 'connected',
        tools: [{ name: 'search', description: 'Search docs' }],
      },
    ];
  }
  async getContextUsage(): Promise<any> {
    return {};
  }
  async readFile(): Promise<any> {
    return {};
  }
  async reloadPlugins(): Promise<any> {
    return {};
  }
  async accountInfo(): Promise<any> {
    return {};
  }
  async rewindFiles(): Promise<any> {
    return { canRewind: false };
  }
  async seedReadState() {}
  async reconnectMcpServer() {}
  async toggleMcpServer() {}
  async setMcpServers(): Promise<any> {
    return {};
  }
  async streamInput() {}
  async stopTask() {}
  async backgroundTasks(): Promise<boolean> {
    return false;
  }
}

function systemInit(sessionId = 'claude-session-1'): SDKMessage {
  return {
    type: 'system',
    subtype: 'init',
    apiKeySource: 'user',
    claude_code_version: '2.1.146',
    cwd: '/tmp/workspace',
    tools: [],
    mcp_servers: [],
    model: 'sonnet',
    permissionMode: 'dontAsk',
    slash_commands: [],
    output_style: 'default',
    skills: [],
    plugins: [],
    uuid: '00000000-0000-4000-8000-000000000001' as any,
    session_id: sessionId,
  };
}

function result(sessionId = 'claude-session-1'): SDKMessage {
  return {
    type: 'result',
    subtype: 'success',
    duration_ms: 1,
    duration_api_ms: 1,
    is_error: false,
    num_turns: 1,
    result: 'ok',
    stop_reason: 'end_turn',
    total_cost_usd: 0,
    usage: {} as any,
    modelUsage: {},
    permission_denials: [],
    uuid: '00000000-0000-4000-8000-000000000002' as any,
    session_id: sessionId,
  };
}

function makeAdapter(messagesForPrompt: (prompt: string) => SDKMessage[] | FakeQuery) {
  return new ClaudeRuntimeAdapter({
    home: '/tmp/claude-home',
    command: 'claude',
    clientInfo: {
      name: 'test',
      version: '0.1.0',
    },
    query: ((params: { prompt: string }) => {
      const messages = messagesForPrompt(params.prompt);
      return Array.isArray(messages) ? new FakeQuery(messages) : messages;
    }) as any,
    listSessions: (async () => [
      {
        sessionId: 'claude-session-1',
        summary: 'Existing session',
        lastModified: 1_772_000_000_000,
        createdAt: 1_771_000_000_000,
        cwd: '/tmp/workspace',
        firstPrompt: 'Hello',
      } satisfies SDKSessionInfo,
    ]) as any,
    getSessionInfo: (async () => ({
      sessionId: 'claude-session-1',
      summary: 'Existing session',
      lastModified: 1_772_000_000_000,
      createdAt: 1_771_000_000_000,
      cwd: '/tmp/workspace',
      firstPrompt: 'Hello',
    })) as any,
    getSessionMessages: (async () => [] satisfies SessionMessage[]) as any,
  });
}

describe('ClaudeRuntimeAdapter', () => {
  it('starts a session from the Claude init message and hides the synthetic prompt', async () => {
    const adapter = makeAdapter((prompt) => {
      expect(prompt).toBe(hiddenInitPrompt());
      return [systemInit(), result()];
    });

    await adapter.start();
    const response = await adapter.startSession({
      cwd: '/tmp/workspace',
      model: 'sonnet',
      approvalMode: 'guarded',
      sandboxMode: 'workspace-write',
    });

    expect(response).toMatchObject({
      provider: 'claude',
      providerSessionId: 'claude-session-1',
      model: 'sonnet',
      session: {
        turns: [],
      },
    });
  });

  it('emits streamed assistant output and tool events for a turn', async () => {
    const adapter = makeAdapter((prompt) => {
      if (prompt === hiddenInitPrompt()) {
        return [systemInit(), result()];
      }
      return [
        systemInit(),
        {
          type: 'stream_event',
          event: {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: 'Hel' },
          },
          parent_tool_use_id: null,
          uuid: '00000000-0000-4000-8000-000000000010' as any,
          session_id: 'claude-session-1',
        },
        {
          type: 'stream_event',
          event: {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: 'lo' },
          },
          parent_tool_use_id: null,
          uuid: '00000000-0000-4000-8000-000000000010' as any,
          session_id: 'claude-session-1',
        },
        {
          type: 'stream_event',
          event: {
            type: 'content_block_start',
            index: 1,
            content_block: {
              type: 'tool_use',
              id: 'toolu_1',
              name: 'Bash',
              input: { command: 'pwd' },
            },
          },
          parent_tool_use_id: null,
          uuid: '00000000-0000-4000-8000-000000000010' as any,
          session_id: 'claude-session-1',
        },
        {
          type: 'user',
          message: { role: 'user', content: [] },
          parent_tool_use_id: 'toolu_1',
          tool_use_result: { stdout: '/tmp/workspace\n' },
          uuid: '00000000-0000-4000-8000-000000000011' as any,
          session_id: 'claude-session-1',
        },
        result(),
      ];
    });
    const events: AgentRuntimeEvent[] = [];
    adapter.on('event', (event) => events.push(event));

    const started = await adapter.startTurn({
      providerSessionId: 'claude-session-1',
      prompt: 'Say hello and run pwd',
      model: 'sonnet',
      workspacePath: '/tmp/workspace',
    });
    expect(started.status).toBe('inProgress');
    await wait();

    expect(events.map((event) => event.type)).toContain('turn.started');
    expect(
      events
        .filter((event) => event.type === 'output.delta')
        .map((event) => event.delta)
        .join(''),
    ).toBe('Hello');
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'item.started',
        item: expect.objectContaining({
          kind: 'commandExecution',
          text: 'pwd',
        }),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'item.completed',
        item: expect.objectContaining({
          id: 'toolu_1',
          status: 'completed',
        }),
      }),
    );
    expect(events.at(-1)).toMatchObject({
      type: 'turn.completed',
      turn: {
        status: 'completed',
        items: expect.arrayContaining([
          expect.objectContaining({ kind: 'userMessage' }),
          expect.objectContaining({ kind: 'agentMessage', text: 'Hello' }),
          expect.objectContaining({ kind: 'commandExecution', status: 'completed' }),
        ]),
      },
    });
  });

  it('interrupts an active query', async () => {
    let activeQuery: FakeQuery | null = null;
    const adapter = makeAdapter(() => {
      activeQuery = new FakeQuery([systemInit()], { holdOpen: true });
      return activeQuery;
    });

    const started = await adapter.startTurn({
      providerSessionId: 'claude-session-1',
      prompt: 'Keep running',
      model: 'sonnet',
      workspacePath: '/tmp/workspace',
    });
    const interrupted = await adapter.interruptTurn({
      providerSessionId: 'claude-session-1',
      providerTurnId: started.providerTurnId,
    });

    expect(interrupted).toMatchObject({
      providerTurnId: started.providerTurnId,
      status: 'interrupted',
    });
    const capturedQuery = activeQuery as unknown as FakeQuery | null;
    expect(capturedQuery).not.toBeNull();
    expect(capturedQuery!.interrupted).toBe(true);
    expect(capturedQuery!.closed).toBe(true);
  });

  it('maps historical session messages into turns without the hidden init prompt', async () => {
    const adapter = new ClaudeRuntimeAdapter({
      home: '/tmp/claude-home',
      query: (() => new FakeQuery([])) as any,
      getSessionInfo: (async () => ({
        sessionId: 'claude-session-1',
        summary: 'Existing session',
        lastModified: 1_772_000_000_000,
        createdAt: 1_771_000_000_000,
        cwd: '/tmp/workspace',
      })) as any,
      listSessions: (async () => []) as any,
      getSessionMessages: (async () => [
        {
          type: 'user',
          uuid: 'hidden-user',
          session_id: 'claude-session-1',
          message: { role: 'user', content: hiddenInitPrompt() },
          parent_tool_use_id: null,
        },
        {
          type: 'assistant',
          uuid: 'hidden-assistant',
          session_id: 'claude-session-1',
          message: { role: 'assistant', content: [{ type: 'text', text: 'Ready.' }] },
          parent_tool_use_id: null,
        },
        {
          type: 'user',
          uuid: 'user-1',
          session_id: 'claude-session-1',
          message: { role: 'user', content: 'Real prompt' },
          parent_tool_use_id: null,
        },
        {
          type: 'assistant',
          uuid: 'assistant-1',
          session_id: 'claude-session-1',
          message: { role: 'assistant', content: [{ type: 'text', text: 'Real answer' }] },
          parent_tool_use_id: null,
        },
      ] satisfies SessionMessage[]) as any,
    });

    const session = await adapter.readSession('claude-session-1');
    expect(session.turns).toHaveLength(1);
    expect(session.turns[0]?.items).toEqual([
      expect.objectContaining({ kind: 'userMessage', text: 'Real prompt' }),
      expect.objectContaining({ kind: 'agentMessage', text: 'Real answer' }),
    ]);
  });
});
