import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ClaudeRuntimeAdapter } from './runtimeAdapter';
import { assistantMessageToHistoryItems, hiddenInitPrompt } from './historyItems';
import type { AgentRuntimeEvent } from '../../agent-runtime/src/index';

type SDKMessage = Record<string, any>;
type SDKSessionInfo = Record<string, any>;
type SessionMessage = Record<string, any>;
interface Query extends AsyncIterable<SDKMessage> {
  close(): void;
  interrupt(): Promise<void>;
  supportedModels(): Promise<any[]>;
  mcpServerStatus(): Promise<any[]>;
}

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
    permissionMode: 'default',
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

function makeAdapter(
  messagesForPrompt: (
    prompt: string,
    options: Record<string, unknown>,
  ) => SDKMessage[] | FakeQuery,
) {
  return new ClaudeRuntimeAdapter({
    home: '/tmp/claude-home',
    command: 'claude',
    clientInfo: {
      name: 'test',
      version: '0.1.0',
    },
    query: ((params: { prompt: string; options: Record<string, unknown> }) => {
      const messages = messagesForPrompt(params.prompt, params.options);
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
  it('captures Claude subscription rate-limit windows from SDK events', async () => {
    const adapter = makeAdapter(() => [
      systemInit(),
      {
        type: 'rate_limit_event',
        rate_limit_info: {
          status: 'allowed',
          rateLimitType: 'five_hour',
          utilization: 0.23,
          resetsAt: 1_800_000_000,
        },
        uuid: '00000000-0000-4000-8000-000000000003',
        session_id: 'claude-session-1',
      },
      {
        type: 'rate_limit_event',
        rate_limit_info: {
          status: 'allowed_warning',
          rateLimitType: 'seven_day',
          utilization: 0.84,
          resetsAt: 1_800_086_400,
        },
        uuid: '00000000-0000-4000-8000-000000000004',
        session_id: 'claude-session-1',
      },
      result(),
    ]);

    await adapter.start();
    await expect(adapter.getSubscriptionUsage()).resolves.toMatchObject({
      provider: 'claude',
      authKind: 'unknown',
      windows: [],
    });
    await adapter.startSession({
      cwd: '/tmp/workspace',
      model: 'sonnet',
      approvalMode: 'guarded',
      sandboxMode: 'workspace-write',
    });

    await expect(adapter.getSubscriptionUsage()).resolves.toMatchObject({
      provider: 'claude',
      authKind: 'subscription',
      stale: false,
      windows: [
        {
          id: 'five_hour',
          durationMinutes: 300,
          label: '5h',
          usedPercent: 23,
          resetsAt: new Date(1_800_000_000 * 1000).toISOString(),
        },
        {
          id: 'seven_day',
          durationMinutes: 10_080,
          label: '7d',
          usedPercent: 84,
          resetsAt: new Date(1_800_086_400 * 1000).toISOString(),
        },
      ],
    });
  });

  it('passes the configured Claude executable to the SDK', async () => {
    const sdkOptions: Record<string, unknown>[] = [];
    const adapter = new ClaudeRuntimeAdapter({
      home: '/tmp/claude-home',
      command: 'claude',
      query: ((params: { prompt: string; options: Record<string, unknown> }) => {
        sdkOptions.push(params.options);
        return new FakeQuery([systemInit(), result()]);
      }) as any,
      listSessions: (async () => [] satisfies SDKSessionInfo[]) as any,
      getSessionInfo: (async () => null) as any,
      getSessionMessages: (async () => [] satisfies SessionMessage[]) as any,
    });

    await adapter.start();
    await adapter.startSession({
      cwd: '/tmp/workspace',
      model: 'sonnet',
      approvalMode: 'guarded',
      sandboxMode: 'workspace-write',
    });

    expect(sdkOptions[0]?.pathToClaudeCodeExecutable).toBe('claude');
  });

  it('does not pass an empty tool list to Claude session initialization', async () => {
    const sdkOptions: Record<string, unknown>[] = [];
    const adapter = makeAdapter((_prompt, options) => {
      sdkOptions.push(options);
      return [systemInit(), result()];
    });

    await adapter.startSession({
      cwd: '/tmp/workspace',
      model: 'sonnet',
      approvalMode: 'guarded',
      sandboxMode: 'workspace-write',
    });

    expect(sdkOptions[0]).not.toHaveProperty('tools');
  });

  it('updates slash toolbox items from Claude SDK system init commands', async () => {
    const adapter = makeAdapter(() => [
      {
        ...systemInit(),
        slash_commands: ['compact', 'usage', 'code-review'],
      },
      result(),
    ]);

    await adapter.startSession({
      cwd: '/tmp/workspace',
      model: 'sonnet',
      approvalMode: 'guarded',
      sandboxMode: 'workspace-write',
    });

    expect(adapter.managementSchema.toolboxItems).toEqual([
      expect.objectContaining({ action: 'mcp', command: '/mcp', panel: 'mcp' }),
      expect.objectContaining({ action: 'prompt', command: '/code-review' }),
      expect.objectContaining({ action: 'prompt', command: '/compact' }),
      expect.objectContaining({ action: 'prompt', command: '/usage' }),
      expect.objectContaining({ action: 'unsupported', command: '/btw' }),
    ]);
  });

  it('maps thread sandbox modes to Claude permission and sandbox settings', async () => {
    const turnOptions: Record<string, unknown>[] = [];
    const adapter = makeAdapter((_prompt, options) => {
      turnOptions.push(options);
      return [systemInit(), result()];
    });

    await adapter.startTurn({
      providerSessionId: 'claude-session-1',
      prompt: 'Read only',
      model: 'sonnet',
      sandboxMode: 'read-only',
      workspacePath: '/tmp/workspace',
    });
    await wait();
    await adapter.startTurn({
      providerSessionId: 'claude-session-1',
      prompt: 'Workspace write',
      model: 'sonnet',
      sandboxMode: 'workspace-write',
      workspacePath: '/tmp/workspace',
    });
    await wait();
    await adapter.startTurn({
      providerSessionId: 'claude-session-1',
      prompt: 'Full access',
      model: 'sonnet',
      sandboxMode: 'danger-full-access',
      workspacePath: '/tmp/workspace',
    });
    await wait();

    expect(turnOptions.at(-3)).toMatchObject({
      permissionMode: 'default',
      sandbox: {
        enabled: true,
        autoAllowBashIfSandboxed: true,
        allowUnsandboxedCommands: false,
        filesystem: {
          denyWrite: ['/tmp/workspace'],
        },
      },
    });
    expect(turnOptions.at(-2)).toMatchObject({
      permissionMode: 'acceptEdits',
      sandbox: {
        enabled: true,
        autoAllowBashIfSandboxed: true,
        allowUnsandboxedCommands: false,
        filesystem: {
          allowWrite: ['/tmp/workspace'],
        },
      },
    });
    expect(turnOptions.at(-1)).toMatchObject({
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
    });
    expect(turnOptions.at(-1)?.sandbox).toBeUndefined();
  });

  it('sends prompt photo tokens as Claude image content blocks', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-photo-prompt-'));
    const workspacePath = path.join(tempDir, 'workspace');
    const imagePath = path.join(workspacePath, '.temp', 'threads', 'thread-1', 'camera.png');
    await fs.mkdir(path.dirname(imagePath), { recursive: true });
    await fs.writeFile(imagePath, Buffer.from('fake-png'));

    const prompts: unknown[] = [];
    const adapter = new ClaudeRuntimeAdapter({
      home: '/tmp/claude-home',
      command: 'claude',
      query: ((params: { prompt: unknown; options: Record<string, unknown> }) => {
        prompts.push(params.prompt);
        return new FakeQuery([systemInit(), result()]);
      }) as any,
      listSessions: (async () => [] satisfies SDKSessionInfo[]) as any,
      getSessionInfo: (async () => null) as any,
      getSessionMessages: (async () => [] satisfies SessionMessage[]) as any,
    });

    await adapter.startTurn({
      providerSessionId: 'claude-session-1',
      prompt: 'Please inspect [PHOTO ./.temp/threads/thread-1/camera.png] now.',
      model: 'sonnet',
      collaborationMode: 'default',
      sandboxMode: 'danger-full-access',
      workspacePath,
    });

    expect(typeof (prompts[0] as AsyncIterable<unknown>)[Symbol.asyncIterator]).toBe('function');
    const messages: any[] = [];
    for await (const message of prompts[0] as AsyncIterable<unknown>) {
      messages.push(message);
    }

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      type: 'user',
      parent_tool_use_id: null,
      message: {
        role: 'user',
        content: [
          { type: 'text', text: 'Please inspect ' },
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/png',
              data: Buffer.from('fake-png').toString('base64'),
            },
          },
          { type: 'text', text: ' now.' },
        ],
      },
    });
  });

  it('keeps unsupported or unreadable photo tokens as plain prompt text', async () => {
    const prompts: unknown[] = [];
    const adapter = new ClaudeRuntimeAdapter({
      home: '/tmp/claude-home',
      command: 'claude',
      query: ((params: { prompt: unknown; options: Record<string, unknown> }) => {
        prompts.push(params.prompt);
        return new FakeQuery([systemInit(), result()]);
      }) as any,
      listSessions: (async () => [] satisfies SDKSessionInfo[]) as any,
      getSessionInfo: (async () => null) as any,
      getSessionMessages: (async () => [] satisfies SessionMessage[]) as any,
    });

    await adapter.startTurn({
      providerSessionId: 'claude-session-1',
      prompt: 'Please inspect [PHOTO ./.temp/threads/thread-1/camera.heic].',
      model: 'sonnet',
      collaborationMode: 'default',
      sandboxMode: 'danger-full-access',
      workspacePath: '/tmp/workspace',
    });

    expect(prompts[0]).toBe('Please inspect [PHOTO ./.temp/threads/thread-1/camera.heic].');
  });

  it('reconciles active multimodal transcript turns back to the live runtime turn id', async () => {
    let queryMessages: SDKMessage[] = [systemInit()];
    const adapter = new ClaudeRuntimeAdapter({
      home: '/tmp/claude-home',
      command: 'claude',
      query: (() => new FakeQuery(queryMessages, { holdOpen: true })) as any,
      listSessions: (async () => [] satisfies SDKSessionInfo[]) as any,
      getSessionInfo: (async () => ({
        sessionId: 'claude-session-1',
        summary: 'Existing session',
        lastModified: 1_772_000_000_000,
        createdAt: 1_771_000_000_000,
        cwd: '/tmp/workspace',
      })) as any,
      getSessionMessages: (async () => [
        {
          type: 'user',
          uuid: '019e4657-bd3c-72d1-b59d-324ed8a4b1ec',
          session_id: 'claude-session-1',
          message: {
            role: 'user',
            content: [
              { type: 'text', text: 'What number is in the screenshot? ' },
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/png',
                  data: 'ZmFrZS1wbmc=',
                },
              },
            ],
          },
          parent_tool_use_id: null,
        },
      ] satisfies SessionMessage[]) as any,
    });

    const started = await adapter.startTurn({
      providerSessionId: 'claude-session-1',
      prompt: 'What number is in the screenshot? [PHOTO ./.temp/threads/thread-1/image.png]',
      model: 'sonnet',
      collaborationMode: 'default',
      sandboxMode: 'danger-full-access',
      workspacePath: '/tmp/workspace',
    });
    queryMessages = [];
    const session = await adapter.readSession('claude-session-1');

    expect(session.turns).toHaveLength(1);
    expect(session.turns[0]).toMatchObject({
      providerTurnId: started.providerTurnId,
      status: 'inProgress',
      items: [
        expect.objectContaining({
          id: `${started.providerTurnId}:user`,
          kind: 'userMessage',
          text: 'What number is in the screenshot? [PHOTO ./.temp/threads/thread-1/image.png]',
        }),
      ],
    });
  });

  it('keeps image blocks visible when reading Claude session history', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-history-image-'));
    const adapter = new ClaudeRuntimeAdapter({
      home: '/tmp/claude-home',
      command: 'claude',
      query: (() => new FakeQuery([systemInit(), result()])) as any,
      listSessions: (async () => [] satisfies SDKSessionInfo[]) as any,
      getSessionInfo: (async () => ({
        sessionId: 'claude-session-1',
        summary: 'Existing session',
        lastModified: 1_772_000_000_000,
        createdAt: 1_771_000_000_000,
        cwd: workspace,
      })) as any,
      getSessionMessages: (async () => [
        {
          type: 'user',
          uuid: '019e4657-bd3c-72d1-b59d-324ed8a4b1ec',
          session_id: 'claude-session-1',
          message: {
            role: 'user',
            content: [
              { type: 'text', text: 'What number is in the screenshot? ' },
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/png',
                  data: 'ZmFrZS1wbmc=',
                },
              },
            ],
          },
          parent_tool_use_id: null,
        },
        {
          type: 'assistant',
          uuid: '019e4657-bd3c-72d1-b59d-324ed8a4b1ed',
          session_id: 'claude-session-1',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'The number is 9.' }],
          },
          parent_tool_use_id: null,
        },
      ] satisfies SessionMessage[]) as any,
    });

    const session = await adapter.readSession('claude-session-1', {
      localThreadId: 'thread-1',
      workspacePath: workspace,
    });

    expect(session.turns[0]?.items[0]).toMatchObject({
      kind: 'userMessage',
      text: 'What number is in the screenshot? \n[PHOTO ./.temp/threads/thread-1/claude-history-019e4657-bd3c-72d1-b59d-324ed8a4b1ec-1.png]',
    });
    await expect(
      fs.readFile(
        path.join(
          workspace,
          '.temp/threads/thread-1/claude-history-019e4657-bd3c-72d1-b59d-324ed8a4b1ec-1.png',
        ),
        'utf8',
      ),
    ).resolves.toBe('fake-png');
  });

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
    await expect(adapter.listLoadedSessions()).resolves.toEqual(['claude-session-1']);
  });

  it('exposes Claude Code model aliases and enables the 1M context beta', async () => {
    const sdkOptions: Record<string, unknown>[] = [];
    const adapter = new ClaudeRuntimeAdapter({
      home: '/tmp/claude-home',
      command: 'claude',
      query: ((params: { prompt: string; options: Record<string, unknown> }) => {
        sdkOptions.push(params.options);
        return new FakeQuery([systemInit(), result()]);
      }) as any,
      listSessions: (async () => [] satisfies SDKSessionInfo[]) as any,
      getSessionInfo: (async () => null) as any,
      getSessionMessages: (async () => [] satisfies SessionMessage[]) as any,
    });

    await expect(adapter.listModels()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          model: 'sonnet',
          displayName: 'Claude Sonnet',
          isDefault: true,
        }),
        expect.objectContaining({
          model: 'sonnet[1m]',
          displayName: 'Claude Sonnet 1M',
        }),
        expect.objectContaining({
          model: 'fable',
          displayName: 'Claude Fable',
          defaultReasoningEffort: 'medium',
          supportedReasoningEfforts: expect.arrayContaining([
            expect.objectContaining({ reasoningEffort: 'max' }),
          ]),
        }),
      ]),
    );

    await adapter.startSession({
      cwd: '/tmp/workspace',
      model: 'sonnet[1m]',
      approvalMode: 'guarded',
      sandboxMode: 'workspace-write',
    });

    expect(sdkOptions[0]).toMatchObject({
      model: 'sonnet',
      betas: ['context-1m-2025-08-07'],
    });
  });

  it('does not expose the synthetic init prompt as a session summary', async () => {
    const adapter = new ClaudeRuntimeAdapter({
      home: '/tmp/claude-home',
      query: (() => new FakeQuery([])) as any,
      listSessions: (async () => [
        {
          sessionId: 'claude-session-1',
          summary: hiddenInitPrompt(),
          firstPrompt: hiddenInitPrompt(),
          lastModified: 1_772_000_000_000,
          createdAt: 1_771_000_000_000,
          cwd: '/tmp/workspace',
        } satisfies SDKSessionInfo,
      ]) as any,
      getSessionInfo: (async () => ({
        sessionId: 'claude-session-1',
        summary: hiddenInitPrompt(),
        firstPrompt: hiddenInitPrompt(),
        lastModified: 1_772_000_000_000,
        createdAt: 1_771_000_000_000,
        cwd: '/tmp/workspace',
      })) as any,
      getSessionMessages: (async () => [] satisfies SessionMessage[]) as any,
    });

    await expect(adapter.listSessions()).resolves.toEqual([
      expect.objectContaining({
        providerSessionId: 'claude-session-1',
        title: null,
        preview: null,
      }),
    ]);

    await expect(adapter.readSession('claude-session-1')).resolves.toMatchObject({
      providerSessionId: 'claude-session-1',
      title: null,
      preview: null,
    });
    await expect(adapter.listLoadedSessions()).resolves.toEqual(['claude-session-1']);
  });

  it('keeps active Claude sessions running in list summaries', async () => {
    const heldQuery = new FakeQuery([systemInit()], { holdOpen: true });
    const adapter = makeAdapter((prompt) => {
      if (prompt === hiddenInitPrompt()) {
        return [systemInit(), result()];
      }
      return heldQuery;
    });

    await adapter.startSession({
      cwd: '/tmp/workspace',
      model: 'sonnet',
      approvalMode: 'guarded',
      sandboxMode: 'workspace-write',
    });
    await adapter.startTurn({
      providerSessionId: 'claude-session-1',
      providerTurnId: 'turn-1',
      prompt: 'Keep running',
    } as any);
    await wait();

    await expect(adapter.listSessions()).resolves.toEqual([
      expect.objectContaining({
        providerSessionId: 'claude-session-1',
        status: 'running',
      }),
    ]);

    heldQuery.close();
  });

  it('merges adjacent Claude thinking blocks into one reasoning item', () => {
    const items = assistantMessageToHistoryItems({
      messageId: 'msg_1',
      message: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'First thought.' },
          { type: 'thinking', thinking: 'Second thought.' },
          { type: 'text', text: 'Final answer.' },
        ],
      },
    });

    expect(items).toEqual([
      expect.objectContaining({
        kind: 'reasoning',
        text: 'First thought.\n\nSecond thought.',
      }),
      expect.objectContaining({
        kind: 'agentMessage',
        text: 'Final answer.',
      }),
    ]);
  });

  it('merges adjacent Claude reasoning messages while reading history', async () => {
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
          uuid: 'reasoning-user',
          session_id: 'claude-session-1',
          message: { role: 'user', content: 'Inspect the dev branch.' },
          parent_tool_use_id: null,
        },
        {
          type: 'assistant',
          uuid: 'reasoning-1',
          session_id: 'claude-session-1',
          message: {
            role: 'assistant',
            content: [{ type: 'thinking', thinking: 'I should inspect dev.' }],
          },
          parent_tool_use_id: null,
        },
        {
          type: 'assistant',
          uuid: 'reasoning-2',
          session_id: 'claude-session-1',
          message: {
            role: 'assistant',
            content: [{ type: 'thinking', thinking: 'I should inspect dev.' }],
          },
          parent_tool_use_id: null,
        },
        {
          type: 'assistant',
          uuid: 'reasoning-3',
          session_id: 'claude-session-1',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'thinking',
                thinking: 'I should inspect dev. Then compare the merge.',
              },
            ],
          },
          parent_tool_use_id: null,
        },
      ] satisfies SessionMessage[]) as any,
    });

    const session = await adapter.readSession('claude-session-1');
    expect(session.turns[0]?.items).toEqual([
      expect.objectContaining({ kind: 'userMessage' }),
      expect.objectContaining({
        kind: 'reasoning',
        text: 'I should inspect dev. Then compare the merge.',
      }),
    ]);
  });

  it('keeps late Claude subagent tool results in order before completing the turn', async () => {
    const adapter = makeAdapter((prompt) => {
      if (prompt === hiddenInitPrompt()) {
        return [systemInit(), result()];
      }
      return [
        systemInit(),
        {
          type: 'assistant',
          message: {
            id: 'msg_agent',
            type: 'message',
            role: 'assistant',
            model: 'sonnet',
            content: [
              {
                type: 'tool_use',
                id: 'toolu_agent',
                name: 'Task',
                input: {
                  description: 'Inspect dependency graph',
                  prompt: 'Look for stale imports.',
                },
              },
            ],
            stop_reason: null,
            stop_sequence: null,
            stop_details: null,
            usage: {} as any,
            container: null,
            context_management: null,
            diagnostics: null,
          },
          parent_tool_use_id: null,
          uuid: '00000000-0000-4000-8000-000000000031' as any,
          session_id: 'claude-session-1',
        },
        result(),
        {
          type: 'user',
          message: {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'toolu_agent',
                content: 'The subagent found one stale import.',
              },
            ],
          },
          parent_tool_use_id: null,
          tool_use_result: 'The subagent found one stale import.',
          uuid: '00000000-0000-4000-8000-000000000032' as any,
          session_id: 'claude-session-1',
        },
      ];
    });
    const events: AgentRuntimeEvent[] = [];
    adapter.on('event', (event) => events.push(event));

    await adapter.startTurn({
      providerSessionId: 'claude-session-1',
      displayTurnId: 'turn-subagent',
      prompt: 'Use a subagent',
    } as any);
    await wait();

    const completed = events.at(-1);
    expect(completed).toMatchObject({
      type: 'turn.completed',
      turn: {
        providerTurnId: 'turn-subagent',
        status: 'completed',
      },
    });
    expect(completed?.type === 'turn.completed' ? completed.turn.items : []).toEqual([
      expect.objectContaining({ id: 'turn-subagent:user', kind: 'userMessage' }),
      expect.objectContaining({
        id: 'toolu_agent',
        kind: 'agentToolCall',
        status: 'completed',
        detailText: expect.stringContaining('The subagent found one stale import.'),
      }),
    ]);
    expect(
      events.findIndex(
        (event) =>
          event.type === 'item.completed' &&
          event.item.id === 'toolu_agent' &&
          event.item.status === 'completed',
      ),
    ).toBeLessThan(events.length - 1);
  });

  it('maps Claude task-notification text to the active subagent tool result', async () => {
    const adapter = makeAdapter((prompt) => {
      if (prompt === hiddenInitPrompt()) {
        return [systemInit(), result()];
      }
      return [
        systemInit(),
        {
          type: 'assistant',
          message: {
            id: 'msg_agent',
            type: 'message',
            role: 'assistant',
            model: 'sonnet',
            content: [
              {
                type: 'tool_use',
                id: 'toolu_agent_xml',
                name: 'Task',
                input: {
                  description: 'Audit docs',
                  prompt: 'Audit docs.',
                },
              },
            ],
            usage: {} as any,
          },
          parent_tool_use_id: null,
          uuid: '00000000-0000-4000-8000-000000000041' as any,
          session_id: 'claude-session-1',
        },
        {
          type: 'user',
          message: {
            role: 'user',
            content:
              '<task-notification>\\n<task-id>task-1</task-id>\\n<tool-use-id>toolu_agent_xml</tool-use-id>\\n<status>completed</status>\\n<summary>Agent \"Audit docs\" finished</summary>\\n<result>Found one stale runbook.</result>\\n</task-notification>',
          },
          parent_tool_use_id: null,
          uuid: '00000000-0000-4000-8000-000000000042' as any,
          session_id: 'claude-session-1',
        },
        result(),
      ];
    });
    const events: AgentRuntimeEvent[] = [];
    adapter.on('event', (event) => events.push(event));

    await adapter.startTurn({
      providerSessionId: 'claude-session-1',
      displayTurnId: 'turn-subagent-xml',
      prompt: 'Use a subagent',
    } as any);
    await wait();

    const completed = events.at(-1);
    expect(completed).toMatchObject({
      type: 'turn.completed',
      turn: {
        providerTurnId: 'turn-subagent-xml',
        status: 'completed',
      },
    });
    expect(completed?.type === 'turn.completed' ? completed.turn.items : []).toEqual([
      expect.objectContaining({ id: 'turn-subagent-xml:user', kind: 'userMessage' }),
      expect.objectContaining({
        id: 'toolu_agent_xml',
        kind: 'agentToolCall',
        status: 'completed',
        detailText: expect.stringContaining('Found one stale runbook.'),
      }),
    ]);
  });

  it('marks Claude session limit assistant messages as failed even when the SDK result succeeds', async () => {
    const adapter = makeAdapter((prompt) => {
      if (prompt === hiddenInitPrompt()) {
        return [systemInit(), result()];
      }
      return [
        systemInit(),
        {
          type: 'assistant',
          message: {
            id: 'msg_limit',
            type: 'message',
            role: 'assistant',
            model: 'sonnet',
            content: [
              {
                type: 'text',
                text: "You've hit your session limit · resets 10pm (America/Toronto)",
              },
            ],
            usage: {} as any,
          },
          parent_tool_use_id: null,
          uuid: '00000000-0000-4000-8000-000000000043' as any,
          session_id: 'claude-session-1',
        },
        result(),
      ];
    });
    const events: AgentRuntimeEvent[] = [];
    adapter.on('event', (event) => events.push(event));

    await adapter.startTurn({
      providerSessionId: 'claude-session-1',
      displayTurnId: 'turn-limit',
      prompt: 'Continue',
    } as any);
    await wait();

    expect(events.at(-1)).toMatchObject({
      type: 'turn.completed',
      turn: {
        providerTurnId: 'turn-limit',
        status: 'failed',
        error: {
          message: expect.stringContaining("You've hit your session limit"),
        },
      },
    });
  });

  it('filters Claude generated titles derived from the synthetic init prompt', async () => {
    const adapter = new ClaudeRuntimeAdapter({
      home: '/tmp/claude-home',
      query: (() => new FakeQuery([])) as any,
      listSessions: (async () => [
        {
          sessionId: 'claude-session-1',
          summary: 'Initialize Remote Codex session',
          firstPrompt: hiddenInitPrompt(),
          lastModified: 1_772_000_000_000,
          createdAt: 1_771_000_000_000,
          cwd: '/tmp/workspace',
        } satisfies SDKSessionInfo,
      ]) as any,
      getSessionInfo: (async () => ({
        sessionId: 'claude-session-1',
        summary: 'Initialize Remote Codex session',
        firstPrompt: hiddenInitPrompt(),
        lastModified: 1_772_000_000_000,
        createdAt: 1_771_000_000_000,
        cwd: '/tmp/workspace',
      })) as any,
      getSessionMessages: (async () => [] satisfies SessionMessage[]) as any,
    });

    await expect(adapter.listSessions()).resolves.toEqual([
      expect.objectContaining({
        providerSessionId: 'claude-session-1',
        title: null,
        preview: null,
      }),
    ]);
  });

  it('emits streamed assistant output and tool events for a turn', async () => {
    const turnOptions: Record<string, unknown>[] = [];
    const adapter = makeAdapter((prompt, options) => {
      if (prompt === hiddenInitPrompt()) {
        return [systemInit(), result()];
      }
      turnOptions.push(options);
      return [
        systemInit(),
        {
          type: 'stream_event',
          event: {
            type: 'message_start',
            message: {
              id: 'msg_1',
              type: 'message',
              role: 'assistant',
              model: 'sonnet',
              content: [],
              stop_reason: null,
              stop_sequence: null,
              stop_details: null,
              usage: {} as any,
              container: null,
              context_management: null,
              diagnostics: null,
            },
          },
          parent_tool_use_id: null,
          uuid: '00000000-0000-4000-8000-000000000009' as any,
          session_id: 'claude-session-1',
        },
        {
          type: 'stream_event',
          event: {
            type: 'content_block_start',
            index: 0,
            content_block: {
              type: 'thinking',
              thinking: 'Plan',
              signature: 'sig',
            },
          },
          parent_tool_use_id: null,
          uuid: '00000000-0000-4000-8000-000000000008' as any,
          session_id: 'claude-session-1',
        },
        {
          type: 'stream_event',
          event: {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'thinking_delta', thinking: ' carefully' },
          },
          parent_tool_use_id: null,
          uuid: '00000000-0000-4000-8000-000000000018' as any,
          session_id: 'claude-session-1',
        },
        {
          type: 'stream_event',
          event: {
            type: 'content_block_delta',
            index: 1,
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
            index: 1,
            delta: { type: 'text_delta', text: 'lo' },
          },
          parent_tool_use_id: null,
          uuid: '00000000-0000-4000-8000-000000000011' as any,
          session_id: 'claude-session-1',
        },
        {
          type: 'stream_event',
          event: {
            type: 'message_start',
            message: {
              id: 'msg_2',
              type: 'message',
              role: 'assistant',
              model: 'sonnet',
              content: [],
              stop_reason: null,
              stop_sequence: null,
              stop_details: null,
              usage: {} as any,
              container: null,
              context_management: null,
              diagnostics: null,
            },
          },
          parent_tool_use_id: null,
          uuid: '00000000-0000-4000-8000-000000000012' as any,
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
              input: {},
            },
          },
          parent_tool_use_id: null,
          uuid: '00000000-0000-4000-8000-000000000013' as any,
          session_id: 'claude-session-1',
        },
        {
          type: 'assistant',
          message: {
            id: 'msg_2',
            type: 'message',
            role: 'assistant',
            model: 'sonnet',
            content: [
              {
                type: 'tool_use',
                id: 'toolu_1',
                name: 'Bash',
                input: { command: 'pwd' },
                caller: { type: 'direct' },
              },
            ],
            stop_reason: null,
            stop_sequence: null,
            stop_details: null,
            usage: {} as any,
            container: null,
            context_management: null,
            diagnostics: null,
          },
          parent_tool_use_id: null,
          uuid: '00000000-0000-4000-8000-000000000014' as any,
          session_id: 'claude-session-1',
        },
        {
          type: 'user',
          message: {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'toolu_1',
                content: '/tmp/workspace\n',
              },
            ],
          },
          parent_tool_use_id: null,
          tool_use_result: { stdout: '/tmp/workspace\n' },
          uuid: '00000000-0000-4000-8000-000000000015' as any,
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
      reasoningEffort: 'max',
      workspacePath: '/tmp/workspace',
    });
    expect(started.status).toBe('inProgress');
    expect(started.startedAt).toEqual(expect.any(String));
    await wait();

    expect(events.map((event) => event.type)).toContain('turn.started');
    expect(
      events
        .filter((event) => event.type === 'output.delta')
        .map((event) => event.itemId),
    ).toEqual(['msg_1:content:1', 'msg_1:content:1']);
    expect(
      events
        .filter((event) => event.type === 'output.delta')
        .map((event) => event.delta)
        .join(''),
    ).toBe('Hello');
    expect(turnOptions.at(-1)?.effort).toBe('max');
    expect(turnOptions.at(-1)?.thinking).toEqual({
      type: 'adaptive',
      display: 'summarized',
    });
    const firstReasoningEventIndex = events.findIndex(
      (event) =>
        event.type === 'item.started' &&
        event.item.kind === 'reasoning' &&
        event.item.text === 'Plan',
    );
    const firstOutputDeltaEventIndex = events.findIndex(
      (event) => event.type === 'output.delta',
    );
    expect(firstReasoningEventIndex).toBeGreaterThanOrEqual(0);
    expect(firstOutputDeltaEventIndex).toBeGreaterThan(firstReasoningEventIndex);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'item.completed',
        item: expect.objectContaining({
          kind: 'reasoning',
          text: 'Plan carefully',
        }),
      }),
    );
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
        startedAt: started.startedAt,
        status: 'completed',
        items: expect.arrayContaining([
          expect.objectContaining({ kind: 'userMessage' }),
          expect.objectContaining({ kind: 'reasoning', text: 'Plan carefully' }),
          expect.objectContaining({ kind: 'agentMessage', text: 'Hello' }),
          expect.objectContaining({ kind: 'commandExecution', status: 'completed' }),
        ]),
      },
    });
  });

  it('emits Claude token usage before completing a turn', async () => {
    const adapter = makeAdapter((prompt) => {
      if (prompt === hiddenInitPrompt()) {
        return [systemInit(), result()];
      }
      return [
        systemInit(),
        {
          type: 'assistant',
          message: {
            id: 'msg_usage',
            type: 'message',
            role: 'assistant',
            model: 'sonnet',
            content: [{ type: 'text', text: 'Done', citations: null }],
            stop_reason: null,
            stop_sequence: null,
            stop_details: null,
            usage: {
              input_tokens: 3,
              cache_creation_input_tokens: 10,
              cache_read_input_tokens: 100,
              output_tokens: 20,
            } as any,
            container: null,
            context_management: null,
            diagnostics: null,
          },
          parent_tool_use_id: null,
          uuid: '00000000-0000-4000-8000-000000000040' as any,
          session_id: 'claude-session-1',
        },
        {
          ...result(),
          usage: {
            input_tokens: 4,
            cache_creation_input_tokens: 11,
            cache_read_input_tokens: 101,
            output_tokens: 21,
          } as any,
          modelUsage: {
            sonnet: {
              inputTokens: 4,
              outputTokens: 21,
              cacheReadInputTokens: 101,
              cacheCreationInputTokens: 11,
              webSearchRequests: 0,
              costUSD: 0.001,
              contextWindow: 200000,
              maxOutputTokens: 32000,
            },
          },
        } as SDKMessage,
      ];
    });
    const events: AgentRuntimeEvent[] = [];
    adapter.on('event', (event) => events.push(event));

    await adapter.startTurn({
      providerSessionId: 'claude-session-1',
      prompt: 'Measure usage',
      model: 'sonnet',
      workspacePath: '/tmp/workspace',
    });
    await wait();

    const usageEvent = events.find((event) => event.type === 'usage.updated');
    expect(usageEvent).toMatchObject({
      type: 'usage.updated',
      provider: 'claude',
      providerSessionId: 'claude-session-1',
      usage: {
        total: {
          totalTokens: 137,
          inputTokens: 116,
          cachedInputTokens: 101,
          outputTokens: 21,
          reasoningOutputTokens: 0,
        },
        last: {
          totalTokens: 137,
          inputTokens: 116,
          cachedInputTokens: 101,
          outputTokens: 21,
          reasoningOutputTokens: 0,
        },
        modelContextWindow: 200000,
        cumulative: false,
      },
    });
    expect(events.map((event) => event.type).slice(-2)).toEqual([
      'usage.updated',
      'turn.completed',
    ]);
  });

  it('uses Claude plan permission mode and maps ExitPlanMode to a plan item', async () => {
    const turnOptions: Record<string, unknown>[] = [];
    const adapter = makeAdapter((_prompt, options) => {
      turnOptions.push(options);
      return [
        systemInit(),
        {
          type: 'assistant',
          message: {
            id: 'msg_plan',
            type: 'message',
            role: 'assistant',
            model: 'sonnet',
            content: [
              {
                type: 'tool_use',
                id: 'toolu_plan',
                name: 'ExitPlanMode',
                input: { plan: '# Plan\n\n- Inspect.\n- Patch.\n- Verify.' },
                caller: { type: 'direct' },
              },
            ],
            stop_reason: null,
            stop_sequence: null,
            stop_details: null,
            usage: {} as any,
            container: null,
            context_management: null,
            diagnostics: null,
          },
          parent_tool_use_id: null,
          uuid: '00000000-0000-4000-8000-000000000021' as any,
          session_id: 'claude-session-1',
        },
        {
          type: 'user',
          message: {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'toolu_plan',
                content: '# Plan\n\n- Inspect.\n- Patch.\n- Verify.',
              },
            ],
          },
          parent_tool_use_id: null,
          tool_use_result: {
            plan: '# Plan\n\n- Inspect.\n- Patch.\n- Verify.',
            isAgent: false,
          },
          uuid: '00000000-0000-4000-8000-000000000022' as any,
          session_id: 'claude-session-1',
        } satisfies SDKMessage,
        result(),
      ];
    });
    const events: AgentRuntimeEvent[] = [];
    adapter.on('event', (event) => events.push(event));

    const started = await adapter.startTurn({
      providerSessionId: 'claude-session-1',
      prompt: 'Plan the next change',
      model: 'sonnet',
      collaborationMode: 'plan',
      workspacePath: '/tmp/workspace',
    });
    await wait();

    expect(started.startedAt).toEqual(expect.any(String));
    expect(turnOptions.at(-1)?.permissionMode).toBe('plan');
    expect(events.at(-1)).toMatchObject({
      type: 'turn.completed',
      turn: {
        startedAt: started.startedAt,
        status: 'completed',
        items: expect.arrayContaining([
          expect.objectContaining({
            id: 'toolu_plan',
            kind: 'plan',
            text: '# Plan\n\n- Inspect.\n- Patch.\n- Verify.',
            status: 'completed',
          }),
        ]),
      },
    });
  });

  it('suppresses Claude Code plan control tool plumbing from timeline items', async () => {
    const adapter = makeAdapter(() => [
      systemInit(),
      {
        type: 'assistant',
        message: {
          id: 'msg_plan_tools',
          type: 'message',
          role: 'assistant',
          model: 'sonnet',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_search',
              name: 'ToolSearch',
              input: { query: 'select:EnterPlanMode', max_results: 1 },
              caller: { type: 'direct' },
            },
          ],
          stop_reason: null,
          stop_sequence: null,
          stop_details: null,
          usage: {} as any,
          container: null,
          context_management: null,
          diagnostics: null,
        },
        parent_tool_use_id: null,
        uuid: '00000000-0000-4000-8000-000000000041' as any,
        session_id: 'claude-session-1',
      },
      {
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_search',
              content: [{ type: 'tool_reference', tool_name: 'EnterPlanMode' }],
            },
          ],
        },
        parent_tool_use_id: null,
        tool_use_result: {
          matches: ['EnterPlanMode'],
          query: 'select:EnterPlanMode',
        },
        uuid: '00000000-0000-4000-8000-000000000042' as any,
        session_id: 'claude-session-1',
      } satisfies SDKMessage,
      {
        type: 'assistant',
        message: {
          id: 'msg_enter_plan',
          type: 'message',
          role: 'assistant',
          model: 'sonnet',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_enter',
              name: 'EnterPlanMode',
              input: {},
              caller: { type: 'direct' },
            },
          ],
          stop_reason: null,
          stop_sequence: null,
          stop_details: null,
          usage: {} as any,
          container: null,
          context_management: null,
          diagnostics: null,
        },
        parent_tool_use_id: null,
        uuid: '00000000-0000-4000-8000-000000000043' as any,
        session_id: 'claude-session-1',
      },
      {
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_enter',
              content: 'Entered plan mode.',
            },
          ],
        },
        parent_tool_use_id: null,
        tool_use_result: { message: 'Entered plan mode.' },
        uuid: '00000000-0000-4000-8000-000000000044' as any,
        session_id: 'claude-session-1',
      } satisfies SDKMessage,
      {
        type: 'assistant',
        message: {
          id: 'msg_plan',
          type: 'message',
          role: 'assistant',
          model: 'sonnet',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_plan',
              name: 'ExitPlanMode',
              input: { plan: 'Build a calculator.' },
              caller: { type: 'direct' },
            },
          ],
          stop_reason: null,
          stop_sequence: null,
          stop_details: null,
          usage: {} as any,
          container: null,
          context_management: null,
          diagnostics: null,
        },
        parent_tool_use_id: null,
        uuid: '00000000-0000-4000-8000-000000000045' as any,
        session_id: 'claude-session-1',
      },
      result(),
    ]);
    const events: AgentRuntimeEvent[] = [];
    adapter.on('event', (event) => events.push(event));

    await adapter.startTurn({
      providerSessionId: 'claude-session-1',
      prompt: 'Plan a calculator',
      model: 'sonnet',
      collaborationMode: 'plan',
      workspacePath: '/tmp/workspace',
    });
    await wait();

    const completed = events.at(-1);
    expect(completed).toMatchObject({ type: 'turn.completed' });
    expect(completed && 'turn' in completed ? completed.turn.items : []).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'toolu_plan',
          kind: 'plan',
          text: 'Build a calculator.',
        }),
      ]),
    );
    expect(completed && 'turn' in completed ? completed.turn.items : []).toEqual(
      expect.not.arrayContaining([
        expect.objectContaining({ id: 'toolu_search' }),
        expect.objectContaining({ id: 'toolu_enter' }),
        expect.objectContaining({ text: expect.stringContaining('ToolSearch') }),
        expect.objectContaining({ text: expect.stringContaining('EnterPlanMode') }),
      ]),
    );
  });

  it('maps Claude AskUserQuestion tool use to a provider request', async () => {
    const adapter = makeAdapter(() => [
      systemInit(),
      {
        type: 'assistant',
        message: {
          id: 'msg_question',
          type: 'message',
          role: 'assistant',
          model: 'sonnet',
          content: [
            {
              type: 'text',
              text: 'I need one choice before continuing.',
              citations: null,
            },
            {
              type: 'tool_use',
              id: 'toolu_question',
              name: 'AskUserQuestion',
              input: {
                questions: [
                  {
                    header: 'Mode',
                    question: 'Which plan style should I use?',
                    multiSelect: false,
                    options: [
                      {
                        label: 'Short',
                        description: 'Keep the plan concise.',
                      },
                      {
                        label: 'Detailed',
                        description: 'Include more context.',
                      },
                    ],
                  },
                ],
              },
              caller: { type: 'direct' },
            },
          ],
          stop_reason: null,
          stop_sequence: null,
          stop_details: null,
          usage: {} as any,
          container: null,
          context_management: null,
          diagnostics: null,
        },
        parent_tool_use_id: null,
        uuid: '00000000-0000-4000-8000-000000000031' as any,
        session_id: 'claude-session-1',
      },
      result(),
    ]);
    const events: AgentRuntimeEvent[] = [];
    const providerRequests: unknown[] = [];
    adapter.on('event', (event) => events.push(event));
    adapter.on('provider-request', (request) => providerRequests.push(request));

    await adapter.startTurn({
      providerSessionId: 'claude-session-1',
      prompt: 'Ask me a plan question',
      model: 'sonnet',
      collaborationMode: 'plan',
      workspacePath: '/tmp/workspace',
    });
    await wait();

    expect(providerRequests).toEqual([
      expect.objectContaining({
        provider: 'claude',
        id: 'toolu_question',
        method: 'tool/AskUserQuestion',
        params: expect.objectContaining({
          providerSessionId: 'claude-session-1',
          toolUseId: 'toolu_question',
          input: expect.objectContaining({
            questions: expect.any(Array),
          }),
        }),
      }),
    ]);
    const mapping = adapter.mapProviderRequest?.(providerRequests[0] as any, {
      approvalMode: 'guarded',
    });
    expect(mapping).toMatchObject({
      providerSessionId: 'claude-session-1',
      pendingRequest: {
        responseKind: 'askUserQuestion',
        request: {
          kind: 'requestUserInput',
          title: 'Mode',
          description: 'Which plan style should I use?',
          itemId: 'toolu_question',
          questions: [
            {
              id: 'question-1',
              header: 'Mode',
              question: 'Which plan style should I use?',
              isOther: true,
              options: [
                {
                  label: 'Short',
                  description: 'Keep the plan concise.',
                },
                {
                  label: 'Detailed',
                  description: 'Include more context.',
                },
              ],
            },
          ],
        },
      },
    });
    expect(
      adapter.buildProviderRequestResponse?.(mapping!.pendingRequest!, {
        answers: {
          'question-1': {
            answers: ['Short'],
          },
        },
      }),
    ).toMatchObject({
      answers: {
        'Which plan style should I use?': 'Short',
      },
      toolResult: {
        answers: {
          'Which plan style should I use?': 'Short',
        },
      },
    });
    expect(events.at(-1)).toMatchObject({
      type: 'turn.completed',
      turn: {
        items: expect.not.arrayContaining([
          expect.objectContaining({
            kind: 'toolCall',
            text: expect.stringContaining('AskUserQuestion'),
          }),
        ]),
      },
    });
  });

  it('emits hidden continuation events on the requested display turn id', async () => {
    const adapter = makeAdapter(() => [
      systemInit(),
      {
        type: 'assistant',
        message: {
          id: 'msg_continuation',
          type: 'message',
          role: 'assistant',
          model: 'sonnet',
          content: [{ type: 'text', text: 'Continuing the same plan.', citations: null }],
          stop_reason: null,
          stop_sequence: null,
          stop_details: null,
          usage: {} as any,
          container: null,
          context_management: null,
          diagnostics: null,
        },
        parent_tool_use_id: null,
        uuid: '00000000-0000-4000-8000-000000000034' as any,
        session_id: 'claude-session-1',
      },
      result(),
    ]);
    const events: AgentRuntimeEvent[] = [];
    adapter.on('event', (event) => events.push(event));

    const started = await adapter.startTurn({
      providerSessionId: 'claude-session-1',
      prompt: 'Hidden continuation',
      model: 'sonnet',
      collaborationMode: 'plan',
      workspacePath: '/tmp/workspace',
      hidden: true,
      displayTurnId: 'claude-turn-visible',
    });
    await wait();

    expect(started).toMatchObject({
      providerTurnId: 'claude-turn-visible',
      items: [],
    });
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'turn.started',
          turn: expect.objectContaining({
            providerTurnId: 'claude-turn-visible',
            items: [],
          }),
        }),
        expect.objectContaining({
          type: 'turn.completed',
          turn: expect.objectContaining({
            providerTurnId: 'claude-turn-visible',
            items: expect.arrayContaining([
              expect.objectContaining({
                kind: 'agentMessage',
                text: 'Continuing the same plan.',
              }),
            ]),
          }),
        }),
      ]),
    );
    expect(
      events
        .map((event) =>
          event.type === 'turn.started' || event.type === 'turn.completed'
            ? event.turn.providerTurnId
            : 'providerTurnId' in event
              ? event.providerTurnId
              : null,
        )
        .filter(Boolean),
    ).toEqual(['claude-turn-visible', 'claude-turn-visible']);
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
          uuid: '019e4657-bd3c-72d1-b59d-324ed8a4b1ec',
          session_id: 'claude-session-1',
          message: { role: 'user', content: 'Real prompt' },
          parent_tool_use_id: null,
        },
        {
          type: 'assistant',
          uuid: 'assistant-1',
          session_id: 'claude-session-1',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: 'toolu_1',
                name: 'Bash',
                input: { command: 'pwd' },
              },
            ],
          },
          parent_tool_use_id: null,
        },
        {
          type: 'user',
          uuid: 'tool-result-1',
          session_id: 'claude-session-1',
          message: {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'toolu_1',
                content: '/tmp/workspace',
                is_error: false,
              },
            ],
          },
          parent_tool_use_id: null,
        },
        {
          type: 'assistant',
          uuid: 'assistant-2',
          session_id: 'claude-session-1',
          message: { role: 'assistant', content: [{ type: 'text', text: 'Real answer' }] },
          parent_tool_use_id: null,
        },
      ] satisfies SessionMessage[]) as any,
    });

    const session = await adapter.readSession('claude-session-1');
    expect(session.turns).toHaveLength(1);
    expect(session.turns[0]?.providerTurnId).toBe(
      'claude-turn-019e4657-bd3c-72d1-b59d-324ed8a4b1ec',
    );
    expect(session.turns[0]?.startedAt).toBe('2026-05-20T17:03:35.740Z');
    expect(session.turns[0]?.items).toEqual([
      expect.objectContaining({ kind: 'userMessage', text: 'Real prompt' }),
      expect.objectContaining({ kind: 'commandExecution', text: 'pwd', status: 'completed' }),
      expect.objectContaining({ kind: 'agentMessage', text: 'Real answer' }),
    ]);
  });

  it('keeps historical task notifications inside the originating subagent tool call', async () => {
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
          uuid: '019e4657-bd3c-72d1-b59d-324ed8a4b1ec',
          session_id: 'claude-session-1',
          message: { role: 'user', content: 'Audit both docs.' },
          parent_tool_use_id: null,
        },
        {
          type: 'assistant',
          uuid: 'assistant-task',
          session_id: 'claude-session-1',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: 'toolu_task_a',
                name: 'Task',
                input: {
                  description: 'Audit infra docs',
                  prompt: 'Audit infra docs.',
                },
              },
            ],
          },
          parent_tool_use_id: null,
        },
        {
          type: 'user',
          uuid: 'task-notification-a',
          session_id: 'claude-session-1',
          message: {
            role: 'user',
            content:
              '<task-notification>\\n<task-id>task-a</task-id>\\n<tool-use-id>toolu_task_a</tool-use-id>\\n<status>completed</status>\\n<summary>Agent \"Audit infra docs\" finished</summary>\\n<result>Infra docs need one migration checklist.</result>\\n</task-notification>',
          },
          parent_tool_use_id: null,
        },
        {
          type: 'assistant',
          uuid: 'assistant-final',
          session_id: 'claude-session-1',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'Infra audit complete.' }],
          },
          parent_tool_use_id: null,
        },
      ] satisfies SessionMessage[]) as any,
    });

    const session = await adapter.readSession('claude-session-1');
    expect(session.turns).toHaveLength(1);
    expect(session.turns[0]?.items).toEqual([
      expect.objectContaining({ kind: 'userMessage', text: 'Audit both docs.' }),
      expect.objectContaining({
        id: 'toolu_task_a',
        kind: 'agentToolCall',
        status: 'completed',
        detailText: expect.stringContaining('Infra docs need one migration checklist.'),
      }),
      expect.objectContaining({ kind: 'agentMessage', text: 'Infra audit complete.' }),
    ]);
    expect(session.turns[0]?.items).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'userMessage',
          text: expect.stringContaining('<task-notification>'),
        }),
      ]),
    );
  });

  it('restores historical Claude session limit turns as failed', async () => {
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
          uuid: '019e4657-bd3c-72d1-b59d-324ed8a4b1ec',
          session_id: 'claude-session-1',
          message: { role: 'user', content: 'Continue anyway.' },
          parent_tool_use_id: null,
        },
        {
          type: 'assistant',
          uuid: 'assistant-limit',
          session_id: 'claude-session-1',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'text',
                text: "You've hit your session limit · resets 10pm (America/Toronto)",
              },
            ],
          },
          parent_tool_use_id: null,
        },
      ] satisfies SessionMessage[]) as any,
    });

    const session = await adapter.readSession('claude-session-1');
    expect(session.turns).toHaveLength(1);
    expect(session.turns[0]).toMatchObject({
      status: 'failed',
      error: {
        message: expect.stringContaining("You've hit your session limit"),
      },
    });
  });

  it('omits Claude AskUserQuestion tool results from historical turns', async () => {
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
          uuid: '019e4657-bd3c-72d1-b59d-324ed8a4b1ec',
          session_id: 'claude-session-1',
          message: { role: 'user', content: 'Ask me something.' },
          parent_tool_use_id: null,
        },
        {
          type: 'assistant',
          uuid: 'assistant-question',
          session_id: 'claude-session-1',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: 'toolu_question',
                name: 'AskUserQuestion',
                input: {
                  questions: [
                    {
                      header: 'Mode',
                      question: 'Which plan style should I use?',
                      multiSelect: false,
                      options: [
                        { label: 'Short', description: 'Keep the plan concise.' },
                        { label: 'Detailed', description: 'Include more context.' },
                      ],
                    },
                  ],
                },
              },
            ],
          },
          parent_tool_use_id: null,
        },
        {
          type: 'user',
          uuid: 'question-result',
          session_id: 'claude-session-1',
          message: {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'toolu_question',
                content: {
                  answers: {
                    'Which plan style should I use?': 'Short',
                  },
                },
                is_error: false,
              },
            ],
          },
          parent_tool_use_id: null,
        },
        {
          type: 'assistant',
          uuid: 'assistant-answer',
          session_id: 'claude-session-1',
          message: { role: 'assistant', content: [{ type: 'text', text: 'Continuing.' }] },
          parent_tool_use_id: null,
        },
      ] satisfies SessionMessage[]) as any,
    });

    const session = await adapter.readSession('claude-session-1');
    expect(session.turns[0]?.items).toEqual([
      expect.objectContaining({ kind: 'userMessage', text: 'Ask me something.' }),
      expect.objectContaining({ kind: 'agentMessage', text: 'Continuing.' }),
    ]);
  });

  it('omits Claude Code plan control tool plumbing from historical turns', async () => {
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
          uuid: '019e4657-bd3c-72d1-b59d-324ed8a4b1ec',
          session_id: 'claude-session-1',
          message: { role: 'user', content: 'Plan a calculator.' },
          parent_tool_use_id: null,
        },
        {
          type: 'assistant',
          uuid: 'assistant-search',
          session_id: 'claude-session-1',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: 'toolu_search',
                name: 'ToolSearch',
                input: { query: 'select:EnterPlanMode', max_results: 1 },
              },
            ],
          },
          parent_tool_use_id: null,
        },
        {
          type: 'user',
          uuid: 'search-result',
          session_id: 'claude-session-1',
          message: {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'toolu_search',
                content: [{ type: 'tool_reference', tool_name: 'EnterPlanMode' }],
              },
            ],
          },
          parent_tool_use_id: null,
        },
        {
          type: 'assistant',
          uuid: 'assistant-enter-plan',
          session_id: 'claude-session-1',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: 'toolu_enter',
                name: 'EnterPlanMode',
                input: {},
              },
            ],
          },
          parent_tool_use_id: null,
        },
        {
          type: 'user',
          uuid: 'enter-result',
          session_id: 'claude-session-1',
          message: {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'toolu_enter',
                content: 'Entered plan mode.',
              },
            ],
          },
          parent_tool_use_id: null,
        },
        {
          type: 'assistant',
          uuid: 'assistant-exit-plan',
          session_id: 'claude-session-1',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: 'toolu_plan',
                name: 'ExitPlanMode',
                input: { plan: 'Build a calculator.' },
              },
            ],
          },
          parent_tool_use_id: null,
        },
      ] satisfies SessionMessage[]) as any,
    });

    const session = await adapter.readSession('claude-session-1');
    expect(session.turns[0]?.items).toEqual([
      expect.objectContaining({ kind: 'userMessage', text: 'Plan a calculator.' }),
      expect.objectContaining({
        id: 'toolu_plan',
        kind: 'plan',
        text: 'Build a calculator.',
      }),
    ]);
  });

  it('hides supervisor question continuation prompts from historical turns', async () => {
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
          uuid: '019e4657-bd3c-72d1-b59d-324ed8a4b1ec',
          session_id: 'claude-session-1',
          message: { role: 'user', content: 'Plan a calculator.' },
          parent_tool_use_id: null,
        },
        {
          type: 'assistant',
          uuid: 'assistant-question',
          session_id: 'claude-session-1',
          message: { role: 'assistant', content: [{ type: 'text', text: 'Which features?' }] },
          parent_tool_use_id: null,
        },
        {
          type: 'user',
          uuid: 'continuation-user',
          session_id: 'claude-session-1',
          message: {
            role: 'user',
            content:
              'The user answered the clarification questions below. Continue from the same plan-mode task using these answers. If you have enough information, produce the concrete plan for approval.\n\n- Which features?: History, Keyboard support',
          },
          parent_tool_use_id: null,
        },
        {
          type: 'assistant',
          uuid: 'assistant-plan',
          session_id: 'claude-session-1',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: 'toolu_plan',
                name: 'ExitPlanMode',
                input: { plan: 'Build a basic calculator with history.' },
              },
            ],
          },
          parent_tool_use_id: null,
        },
      ] satisfies SessionMessage[]) as any,
    });

    const session = await adapter.readSession('claude-session-1');
    expect(session.turns).toHaveLength(1);
    expect(session.turns[0]?.items).toEqual([
      expect.objectContaining({ kind: 'userMessage', text: 'Plan a calculator.' }),
      expect.objectContaining({ kind: 'agentMessage', text: 'Which features?' }),
      expect.objectContaining({
        kind: 'plan',
        text: 'Build a basic calculator with history.',
      }),
    ]);
  });

  it('keeps later Claude plan questions in the same historical turn after hidden continuations', async () => {
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
          uuid: '019e4657-bd3c-72d1-b59d-324ed8a4b1ec',
          session_id: 'claude-session-1',
          message: { role: 'user', content: 'Plan a calculator.' },
          parent_tool_use_id: null,
        },
        {
          type: 'assistant',
          uuid: 'assistant-question-1',
          session_id: 'claude-session-1',
          message: { role: 'assistant', content: [{ type: 'text', text: 'Which features?' }] },
          parent_tool_use_id: null,
        },
        {
          type: 'user',
          uuid: 'continuation-user-1',
          session_id: 'claude-session-1',
          message: {
            role: 'user',
            content:
              'The user answered the clarification questions below. Continue from the same plan-mode task using these answers. If you have enough information, produce the concrete plan for approval.\n\n- Which features?: History',
          },
          parent_tool_use_id: null,
        },
        {
          type: 'assistant',
          uuid: 'assistant-question-2',
          session_id: 'claude-session-1',
          message: { role: 'assistant', content: [{ type: 'text', text: 'Keyboard support?' }] },
          parent_tool_use_id: null,
        },
        {
          type: 'user',
          uuid: 'continuation-user-2',
          session_id: 'claude-session-1',
          message: {
            role: 'user',
            content:
              'The user answered the clarification questions below. Continue from the same plan-mode task using these answers. If you have enough information, produce the concrete plan for approval.\n\n- Keyboard support?: Yes',
          },
          parent_tool_use_id: null,
        },
        {
          type: 'assistant',
          uuid: 'assistant-plan',
          session_id: 'claude-session-1',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: 'toolu_plan',
                name: 'ExitPlanMode',
                input: { plan: 'Build a calculator with history and keyboard support.' },
              },
            ],
          },
          parent_tool_use_id: null,
        },
      ] satisfies SessionMessage[]) as any,
    });

    const session = await adapter.readSession('claude-session-1');
    expect(session.turns).toHaveLength(1);
    expect(session.turns[0]?.items).toEqual([
      expect.objectContaining({ kind: 'userMessage', text: 'Plan a calculator.' }),
      expect.objectContaining({ kind: 'agentMessage', text: 'Which features?' }),
      expect.objectContaining({ kind: 'agentMessage', text: 'Keyboard support?' }),
      expect.objectContaining({
        kind: 'plan',
        text: 'Build a calculator with history and keyboard support.',
      }),
    ]);
  });

  it('maps Claude file inspection and agent tools to readable timeline items', async () => {
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
          uuid: '019e4657-bd3c-72d1-b59d-324ed8a4b1ec',
          session_id: 'claude-session-1',
          message: { role: 'user', content: 'Plan backend alignment.' },
          parent_tool_use_id: null,
        },
        {
          type: 'assistant',
          uuid: 'assistant-tools',
          session_id: 'claude-session-1',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: 'toolu_agent',
                name: 'Agent',
                input: {
                  description: 'Inspect backend runtime boundaries',
                  prompt: 'Read the backend services and summarize risks.',
                },
              },
              {
                type: 'tool_use',
                id: 'toolu_grep',
                name: 'Grep',
                input: {
                  pattern: 'AgentRuntime',
                  path: 'apps/supervisor-api/src',
                },
              },
              {
                type: 'tool_use',
                id: 'toolu_read',
                name: 'Read',
                input: {
                  file_path: 'packages/claude/src/runtimeAdapter.ts',
                },
              },
              {
                type: 'tool_use',
                id: 'toolu_edit',
                name: 'Edit',
                input: {
                  file_path: '/home/u/dev/remoteCodex/apps/supervisor-api/src/thread-service.ts',
                  old_string: 'before',
                  new_string: 'after',
                },
              },
              {
                type: 'tool_use',
                id: 'toolu_skill',
                name: 'Skill',
                input: {
                  skill: 'update-config',
                  args: 'Allow Bash and Edit for this workspace.',
                },
              },
              {
                type: 'tool_use',
                id: 'toolu_tool_search',
                name: 'ToolSearch',
                input: { query: 'select:EnterPlanMode' },
              },
              {
                type: 'tool_use',
                id: 'toolu_plan',
                name: 'ExitPlanMode',
                input: { plan: '## Plan\n\n- Keep one visible turn.' },
              },
            ],
          },
          parent_tool_use_id: null,
        },
        {
          type: 'user',
          uuid: 'tool-results',
          session_id: 'claude-session-1',
          message: {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'toolu_agent',
                content: 'Runtime boundaries summarized.',
              },
              {
                type: 'tool_result',
                tool_use_id: 'toolu_grep',
                content: 'apps/supervisor-api/src/thread-service.ts:AgentRuntime',
              },
              {
                type: 'tool_result',
                tool_use_id: 'toolu_read',
                content: 'export class ClaudeRuntimeAdapter {}',
              },
              {
                type: 'tool_result',
                tool_use_id: 'toolu_edit',
                content: 'File updated.',
              },
              {
                type: 'tool_result',
                tool_use_id: 'toolu_skill',
                content: 'Skill completed.',
              },
              {
                type: 'tool_result',
                tool_use_id: 'toolu_tool_search',
                content: [{ type: 'tool_reference', tool_name: 'EnterPlanMode' }],
              },
              {
                type: 'tool_result',
                tool_use_id: 'toolu_plan',
                content: 'Exit plan mode?',
              },
            ],
          },
          parent_tool_use_id: null,
        },
      ] satisfies SessionMessage[]) as any,
    });

    const session = await adapter.readSession('claude-session-1');
    const items = session.turns[0]?.items ?? [];

    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'toolu_agent',
          kind: 'agentToolCall',
          text: 'Agent: Inspect backend runtime boundaries',
          status: 'completed',
        }),
        expect.objectContaining({
          id: 'toolu_grep',
          kind: 'fileRead',
          text: 'Search files: AgentRuntime in apps/supervisor-api/src',
          status: 'completed',
        }),
        expect.objectContaining({
          id: 'toolu_read',
          kind: 'fileRead',
          text: 'Read file: packages/claude/src/runtimeAdapter.ts',
          status: 'completed',
        }),
        expect.objectContaining({
          id: 'toolu_edit',
          kind: 'fileChange',
          text: 'apps/supervisor-api/src/thread-service.ts',
          previewText: 'Edit file: apps/supervisor-api/src/thread-service.ts',
          status: 'completed',
        }),
        expect.objectContaining({
          id: 'toolu_skill',
          kind: 'skillToolCall',
          text: 'Skill: update-config',
          status: 'completed',
        }),
        expect.objectContaining({
          id: 'toolu_plan',
          kind: 'plan',
          text: '## Plan\n\n- Keep one visible turn.',
          status: 'completed',
        }),
      ]),
    );
    expect(items).toEqual(
      expect.not.arrayContaining([
        expect.objectContaining({ id: 'toolu_tool_search' }),
        expect.objectContaining({ text: expect.stringContaining('Exit plan mode?') }),
      ]),
    );
  });
});
