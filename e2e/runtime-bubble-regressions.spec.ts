import { expect, test, type Page } from '@playwright/test';

import type { AgentBackendIdDto } from '../packages/shared/src/index';

type DetailFactory = (requestIndex: number) => unknown;

const now = '2026-04-09T06:01:00.000Z';

const codexBackend = {
  provider: 'codex',
  displayName: 'Codex',
  description: 'Local Codex app-server runtime.',
  enabled: true,
  isDefault: true,
  status: {
    state: 'ready',
    transport: 'stdio',
    lastStartedAt: now,
    lastError: null,
    restartCount: 0,
  },
  capabilities: {
    sessions: { list: true, read: true, resume: true, importLocal: true },
    turns: { start: true, streamInput: false, steer: true, interrupt: true, compact: true },
    branching: { fork: true, hardRollback: true, resumeAt: false, rewindFiles: false },
    controls: {
      planMode: true,
      permissionRequests: true,
      sandboxMode: true,
      performanceMode: true,
      goals: true,
    },
    management: {
      models: true,
      mcpStatus: true,
      skills: true,
      hooks: true,
      hookTrust: true,
      hostConfigFiles: true,
      providerSettings: false,
    },
    usage: { contextWindow: true, tokenUsage: true, costUsd: false },
  },
  managementSchema: {
    hostConfigFiles: [],
    toolboxItems: [
      { action: 'fast', command: '/fast', label: 'Fast mode' },
      { action: 'compact', command: '/compact', label: 'Compact context' },
      { action: 'goal', command: '/goal', label: 'Goal' },
      { action: 'fork', command: '/fork', label: 'Fork', panel: 'fork' },
      { action: 'skills', command: '/skills', label: 'Skills', panel: 'skills' },
      { action: 'mcp', command: '/mcp', label: 'MCP', panel: 'mcp' },
      { action: 'hooks', command: '/hooks', label: 'Hooks', panel: 'hooks' },
    ],
    hookCommandTemplates: [],
    providerConfigFormat: 'toml',
    mcpConfigFormat: 'codex-toml',
    configArchives: true,
    buildRestart: true,
  },
};

const claudeBackend = {
  ...codexBackend,
  provider: 'claude',
  displayName: 'Claude',
  description: 'Local Claude Code Agent SDK runtime.',
  isDefault: false,
  status: {
    ...codexBackend.status,
    transport: 'sdk',
  },
  capabilities: {
    ...codexBackend.capabilities,
    sessions: { list: true, read: true, resume: true, importLocal: false },
    turns: { start: true, streamInput: false, steer: false, interrupt: true, compact: false },
    branching: { fork: false, hardRollback: false, resumeAt: false, rewindFiles: false },
    controls: {
      planMode: true,
      permissionRequests: false,
      sandboxMode: true,
      performanceMode: false,
      goals: false,
    },
    management: {
      models: true,
      mcpStatus: true,
      skills: false,
      hooks: false,
      hookTrust: false,
      hostConfigFiles: false,
      providerSettings: false,
    },
    usage: { contextWindow: false, tokenUsage: false, costUsd: false },
  },
  managementSchema: {
    hostConfigFiles: [],
    toolboxItems: [{ action: 'mcp', command: '/mcp', label: 'MCP', panel: 'mcp' }],
    hookCommandTemplates: [],
    providerConfigFormat: 'none',
    mcpConfigFormat: 'none',
    configArchives: false,
    buildRestart: false,
  },
};

const opencodeBackend = {
  ...codexBackend,
  provider: 'opencode',
  displayName: 'OpenCode',
  description: 'Local OpenCode runtime.',
  isDefault: false,
  status: {
    ...codexBackend.status,
    transport: 'sdk',
  },
  capabilities: {
    ...codexBackend.capabilities,
    sessions: { list: true, read: true, resume: true, importLocal: false },
    turns: { start: true, streamInput: false, steer: false, interrupt: true, compact: false },
    branching: { fork: false, hardRollback: false, resumeAt: false, rewindFiles: false },
    controls: {
      planMode: true,
      permissionRequests: false,
      sandboxMode: true,
      performanceMode: false,
      goals: false,
    },
    management: {
      models: true,
      mcpStatus: true,
      skills: false,
      hooks: false,
      hookTrust: false,
      hostConfigFiles: true,
      providerSettings: false,
    },
    usage: { contextWindow: true, tokenUsage: true, costUsd: true },
  },
  managementSchema: {
    hostConfigFiles: [],
    toolboxItems: [{ action: 'mcp', command: '/mcp', label: 'MCP', panel: 'mcp' }],
    hookCommandTemplates: [],
    providerConfigFormat: 'jsonc',
    mcpConfigFormat: 'opencode-jsonc',
    configArchives: true,
    buildRestart: true,
  },
};

const codexModels = [
  {
    id: 'gpt-5',
    model: 'gpt-5',
    displayName: 'GPT-5',
    description: 'Default test model',
    hidden: false,
    isDefault: true,
    supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'Balanced' }],
    defaultReasoningEffort: 'medium',
  },
];

const claudeModels = [
  {
    id: 'sonnet',
    model: 'sonnet',
    displayName: 'Claude Sonnet',
    description: 'Claude Code default Sonnet model alias.',
    hidden: false,
    isDefault: true,
    supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'Balanced' }],
    defaultReasoningEffort: 'medium',
  },
];

const opencodeModels = [
  {
    id: 'openai/gpt-5',
    model: 'openai/gpt-5',
    displayName: 'GPT-5',
    description: 'OpenCode OpenAI GPT-5',
    hidden: false,
    isDefault: true,
    supportedReasoningEfforts: [{ reasoningEffort: 'low', description: 'Low reasoning' }],
    defaultReasoningEffort: 'low',
  },
];

function workspace() {
  return {
    id: 'workspace-1',
    hostId: 'host-1',
    label: 'Demo Workspace',
    absPath: '/tmp/demo',
    isFavorite: false,
    createdAt: now,
    lastOpenedAt: null,
  };
}

function defaultModelForProvider(provider: AgentBackendIdDto) {
  if (provider === 'claude') {
    return 'sonnet';
  }
  if (provider === 'opencode') {
    return 'openai/gpt-5';
  }
  return 'gpt-5';
}

function defaultCollaborationModeForProvider(provider: AgentBackendIdDto) {
  return provider === 'claude' ? 'plan' : 'default';
}

function thread(provider: AgentBackendIdDto, overrides: Record<string, unknown> = {}) {
  return {
    id: 'thread-1',
    workspaceId: 'workspace-1',
    provider,
    providerSessionId: `${provider}-session-1`,
    source: 'supervisor',
    title: `${provider} runtime bubble thread`,
    model: defaultModelForProvider(provider),
    reasoningEffort: 'medium',
    collaborationMode: defaultCollaborationModeForProvider(provider),
    approvalMode: 'yolo',
    sandboxMode: 'danger-full-access',
    status: 'idle',
    summaryText: 'Runtime bubble regression',
    lastError: null,
    activeTurnId: null,
    isLoaded: true,
    isPinned: false,
    createdAt: now,
    updatedAt: now,
    lastTurnStartedAt: now,
    lastTurnCompletedAt: now,
    ...overrides,
  };
}

function detail(
  provider: AgentBackendIdDto,
  overrides: Record<string, unknown> = {},
) {
  const baseThread = thread(provider, overrides.thread as Record<string, unknown> | undefined);
  return {
    thread: baseThread,
    workspace: workspace(),
    workspacePathStatus: 'present',
    pendingRequests: [],
    pendingSteers: [],
    answeredRequestNotes: [],
    activityNotes: [],
    livePlan: null,
    liveItems: null,
    turns: [],
    ...overrides,
    thread: baseThread,
  };
}

async function installFakeWebSocket(page: Page) {
  await page.addInitScript(() => {
    type Listener = (event: Event | MessageEvent) => void;
    class BrowserFakeWebSocket {
      static instances: BrowserFakeWebSocket[] = [];
      listeners = new Map<string, Listener[]>();
      readyState = 0;
      sentMessages: string[] = [];

      constructor(readonly url: string) {
        BrowserFakeWebSocket.instances.push(this);
        window.setTimeout(() => this.emitOpen(), 0);
      }

      addEventListener(type: string, listener: Listener) {
        this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
      }

      removeEventListener(type: string, listener: Listener) {
        this.listeners.set(
          type,
          (this.listeners.get(type) ?? []).filter((entry) => entry !== listener),
        );
      }

      send(message: string) {
        this.sentMessages.push(message);
      }

      close() {
        this.readyState = 3;
        this.emit('close', new Event('close'));
      }

      emitOpen() {
        this.readyState = 1;
        this.emit('open', new Event('open'));
        this.emitMessage({
          type: 'supervisor.connected',
          timestamp: new Date().toISOString(),
        });
      }

      emit(type: string, event: Event | MessageEvent) {
        for (const listener of this.listeners.get(type) ?? []) {
          listener(event);
        }
      }

      emitMessage(payload: unknown) {
        this.emit(
          'message',
          new MessageEvent('message', { data: JSON.stringify(payload) }),
        );
      }
    }

    Object.defineProperty(window, 'WebSocket', {
      value: BrowserFakeWebSocket,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(window, '__runtimeBubbleSockets', {
      value: BrowserFakeWebSocket.instances,
      configurable: true,
    });
  });
}

async function emitSocketMessage(page: Page, payload: unknown) {
  await page.evaluate((message) => {
    const sockets = (window as unknown as {
      __runtimeBubbleSockets: Array<{ emitMessage: (payload: unknown) => void }>;
    }).__runtimeBubbleSockets;
    const socket = sockets.at(-1);
    if (!socket) {
      throw new Error('No fake websocket instance was created.');
    }
    socket.emitMessage(message);
  }, payload);
}

async function waitForSocketReady(page: Page) {
  await page.waitForFunction(() => {
    const sockets = (window as unknown as {
      __runtimeBubbleSockets?: Array<{ readyState: number }>;
    }).__runtimeBubbleSockets;
    return Boolean(sockets?.some((socket) => socket.readyState === 1));
  });
}

async function installApiRoutes(page: Page, detailFactory: DetailFactory) {
  let detailRequestCount = 0;

  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;

    if (path === '/api/agent-runtimes/codex/status') {
      await route.fulfill({ json: codexBackend });
      return;
    }
    if (path === '/api/agent-runtimes/claude/status') {
      await route.fulfill({ json: claudeBackend });
      return;
    }
    if (path === '/api/agent-runtimes/opencode/status') {
      await route.fulfill({ json: opencodeBackend });
      return;
    }
    if (path === '/api/agent-runtimes/codex/models') {
      await route.fulfill({ json: codexModels });
      return;
    }
    if (path === '/api/agent-runtimes/claude/models') {
      await route.fulfill({ json: claudeModels });
      return;
    }
    if (path === '/api/agent-runtimes/opencode/models') {
      await route.fulfill({ json: opencodeModels });
      return;
    }
    if (path === '/api/threads') {
      await route.fulfill({ json: [] });
      return;
    }
    if (path === '/api/auth/session') {
      await route.fulfill({
        json: {
          authenticated: false,
          username: null,
          expiresAt: null,
          mode: 'local',
          authRequired: false,
        },
      });
      return;
    }
    if (path === '/api/plugins') {
      await route.fulfill({ json: [] });
      return;
    }
    if (path === '/api/threads/thread-1') {
      detailRequestCount += 1;
      await route.fulfill({ json: detailFactory(detailRequestCount) });
      return;
    }
    if (path === '/api/threads/thread-1/items/agent-sub/detail') {
      await route.fulfill({
        json: {
          id: 'agent-sub',
          kind: 'agentToolCall',
          title: 'Agent Details',
          text: 'Agent: Review worker\nStatus: completed\n\nsubagent checked the repository',
        },
      });
      return;
    }

    await route.fulfill({
      status: 404,
      json: { code: 'not_found', message: `Unhandled mocked API route: ${path}` },
    });
  });
}

test.describe('runtime bubble regressions', () => {
  test.skip(
    true,
    'Timeline snapshot tests belong with @remote-codex/thread-ui; supervisor rewrite coverage is phase2.',
  );
  test.beforeEach(async ({ page }) => {
    await installFakeWebSocket(page);
  });

  test('renders per-message timestamps instead of reusing the turn start time', async ({ page }) => {
    const userCreatedAt = '2026-04-09T06:01:00.000Z';
    const firstAgentCreatedAt = '2026-04-09T06:02:21.000Z';
    const finalAgentCreatedAt = '2026-04-09T06:03:05.000Z';

    await page.addInitScript(() => {
      window.localStorage.setItem('remote-codex-auto-collapse-completed-turns', 'false');
    });
    await installApiRoutes(page, () =>
      detail('codex', {
        turns: [
          {
            id: 'turn-1',
            startedAt: userCreatedAt,
            status: 'completed',
            error: null,
            model: 'gpt-5',
            reasoningEffort: 'medium',
            items: [
              {
                id: 'user-1',
                kind: 'userMessage',
                text: 'Timestamp prompt.',
                createdAt: userCreatedAt,
              },
              {
                id: 'agent-1',
                kind: 'agentMessage',
                text: 'First assistant update.',
                createdAt: firstAgentCreatedAt,
              },
              {
                id: 'agent-2',
                kind: 'agentMessage',
                text: 'Final assistant answer.',
                createdAt: finalAgentCreatedAt,
              },
            ],
          },
        ],
      }),
    );

    await page.goto('/threads/thread-1');

    const expectedLabels = await page.evaluate((timestamps) => {
      return timestamps.map((timestamp) =>
        new Date(timestamp).toLocaleString([], {
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          second: '2-digit',
        }),
      );
    }, [userCreatedAt, firstAgentCreatedAt, finalAgentCreatedAt]);

    const messageTimes = page.locator('.thread-graph-message-time');
    await expect(messageTimes.filter({ hasText: expectedLabels[0] })).toHaveCount(1);
    await expect(messageTimes.filter({ hasText: expectedLabels[1] })).toHaveCount(1);
    await expect(messageTimes.filter({ hasText: expectedLabels[2] })).toHaveCount(1);
    await expect(messageTimes).not.toHaveText([
      expectedLabels[0],
      expectedLabels[0],
      expectedLabels[0],
    ]);
  });

  test('keeps live assistant timestamps after detail refresh materializes fallback timestamps', async ({ page }) => {
    const userCreatedAt = '2026-04-09T06:01:00.000Z';
    const agentCreatedAt = '2026-04-09T06:02:21.000Z';
    let phase: 'live' | 'materializedFallback' = 'live';

    await page.addInitScript(() => {
      window.localStorage.setItem('remote-codex-auto-collapse-completed-turns', 'false');
    });
    await installApiRoutes(page, () =>
      detail('codex', {
        thread: {
          status: 'running',
          activeTurnId: 'turn-1',
          lastTurnCompletedAt: null,
        },
        turns: [
          {
            id: 'turn-1',
            startedAt: userCreatedAt,
            status: 'inProgress',
            error: null,
            model: 'gpt-5',
            reasoningEffort: 'medium',
            items:
              phase === 'materializedFallback'
                ? [
                    {
                      id: 'user-1',
                      kind: 'userMessage',
                      text: 'Timestamp prompt.',
                      createdAt: userCreatedAt,
                    },
                    {
                      id: 'agent-live-1',
                      kind: 'agentMessage',
                      text: 'Streaming response after refresh.',
                      createdAt: userCreatedAt,
                    },
                  ]
                : [
                    {
                      id: 'user-1',
                      kind: 'userMessage',
                      text: 'Timestamp prompt.',
                      createdAt: userCreatedAt,
                    },
                  ],
          },
        ],
      }),
    );

    await page.goto('/threads/thread-1');
    await waitForSocketReady(page);
    await emitSocketMessage(page, {
      type: 'thread.output.delta',
      threadId: 'thread-1',
      timestamp: agentCreatedAt,
      payload: {
        turnId: 'turn-1',
        itemId: 'agent-live-1',
        sequence: 1,
        delta: 'Streaming response after refresh.',
        createdAt: agentCreatedAt,
      },
    });

    const [turnStartLabel, agentLabel] = await page.evaluate((timestamps) => {
      return timestamps.map((timestamp) =>
        new Date(timestamp).toLocaleString([], {
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          second: '2-digit',
        }),
      );
    }, [userCreatedAt, agentCreatedAt]);

    const messageTimes = page.locator('.thread-graph-message-time');
    await expect(page.getByText('Streaming response after refresh.')).toBeVisible();
    await expect(messageTimes.filter({ hasText: agentLabel })).toHaveCount(1);

    phase = 'materializedFallback';
    await emitSocketMessage(page, {
      type: 'thread.updated',
      threadId: 'thread-1',
      timestamp: agentCreatedAt,
      payload: { status: 'running' },
    });

    await expect(page.getByText('Streaming response after refresh.')).toBeVisible();
    await expect(messageTimes.filter({ hasText: agentLabel })).toHaveCount(1);
    await expect(messageTimes.filter({ hasText: turnStartLabel })).toHaveCount(1);
  });

  test('renders Codex subagent tool calls as agent bubbles with deferred details', async ({ page }) => {
    await installApiRoutes(page, () =>
      detail('codex', {
        turns: [
          {
            id: 'turn-1',
            startedAt: now,
            status: 'completed',
            error: null,
            model: 'gpt-5',
            reasoningEffort: 'medium',
            items: [
              { id: 'user-1', kind: 'userMessage', text: 'Check the project.' },
              {
                id: 'agent-sub',
                kind: 'agentToolCall',
                text: 'Agent: Review worker',
                previewText: 'Agent',
                detailText: null,
                hasDeferredDetail: true,
                status: 'completed',
              },
            ],
          },
        ],
      }),
    );

    await page.goto('/threads/thread-1');

    await expect(page.getByText('Agent: Review worker')).toBeVisible();
    await page.getByRole('button', { name: 'Open agent details' }).click();
    await expect(page.getByRole('dialog', { name: 'Agent Details' })).toBeVisible();
    await expect(page.getByText('subagent checked the repository')).toBeVisible();
  });

  test('keeps newer Codex live final text through stale detail refreshes until final history lands', async ({ page }) => {
    let phase: 'fresh' | 'stale' | 'final' = 'fresh';
    await installApiRoutes(page, () => {
      const hasFinalTurn = phase === 'final';
      return detail('codex', {
        thread: {
          status: hasFinalTurn ? 'idle' : 'running',
          activeTurnId: hasFinalTurn ? null : 'turn-1',
          lastTurnCompletedAt: hasFinalTurn ? now : null,
        },
        liveItems: hasFinalTurn
          ? null
          : {
              turnId: 'turn-1',
              updatedAt:
                phase === 'fresh' ? '2026-04-09T06:01:05.000Z' : '2026-04-09T06:01:00.000Z',
              items: [
                {
                  id: 'agent-live-1',
                  kind: 'agentMessage',
                  text: phase === 'fresh' ? 'FINAL_TEXT_BEFORE_REFRESH' : 'STALE',
                  sequence: 1,
                },
              ],
            },
        turns: [
          {
            id: 'turn-1',
            startedAt: now,
            status: hasFinalTurn ? 'completed' : 'inProgress',
            error: null,
            model: 'gpt-5',
            reasoningEffort: 'medium',
            items: hasFinalTurn
              ? [
                  {
                    id: 'agent-final-1',
                    kind: 'agentMessage',
                    text: 'FINAL_STRUCTURED_RESPONSE',
                  },
                ]
              : [],
          },
        ],
      });
    });

    await page.goto('/threads/thread-1');

    await expect(page.getByText('FINAL_TEXT_BEFORE_REFRESH')).toBeVisible();
    await waitForSocketReady(page);
    phase = 'stale';
    await emitSocketMessage(page, {
      type: 'thread.updated',
      threadId: 'thread-1',
      timestamp: now,
      payload: { status: 'running' },
    });

    await expect(page.getByText('FINAL_TEXT_BEFORE_REFRESH')).toBeVisible();
    await expect(page.getByText('STALE')).toHaveCount(0);

    phase = 'final';
    await emitSocketMessage(page, {
      type: 'thread.turn.completed',
      threadId: 'thread-1',
      timestamp: now,
      payload: { turnId: 'turn-1', status: 'completed', error: null },
    });

    await expect(page.getByText('FINAL_STRUCTURED_RESPONSE')).toBeVisible();
    await expect(page.getByText('FINAL_TEXT_BEFORE_REFRESH')).toHaveCount(0);
  });

  test('shows Claude plan-mode requestUserInput cards from realtime request events', async ({ page }) => {
    await installApiRoutes(page, () =>
      detail('claude', {
        thread: {
          status: 'running',
          activeTurnId: 'turn-1',
          collaborationMode: 'plan',
          lastTurnCompletedAt: null,
        },
        turns: [
          {
            id: 'turn-1',
            startedAt: now,
            status: 'inProgress',
            error: null,
            model: 'sonnet',
            reasoningEffort: 'medium',
            items: [
              { id: 'user-1', kind: 'userMessage', text: 'Plan the implementation.' },
              { id: 'plan-1', kind: 'plan', text: '1. Confirm target UI.' },
            ],
          },
        ],
      }),
    );

    await page.goto('/threads/thread-1');
    await waitForSocketReady(page);
    await emitSocketMessage(page, {
      type: 'thread.request.created',
      threadId: 'thread-1',
      timestamp: now,
      payload: {
        request: {
          id: 'ask-plan-mode',
          kind: 'requestUserInput',
          title: 'Mode',
          description: 'Choose a preview target.',
          turnId: 'turn-1',
          itemId: 'toolu_question',
          createdAt: '2026-04-09T06:01:03.000Z',
          questions: [
            {
              id: 'target',
              header: 'Target',
              question: 'Which preview should be used?',
              multiSelect: false,
              isOther: false,
              isSecret: false,
              options: [
                {
                  label: 'PC preview',
                  description: 'Use desktop preview.',
                },
              ],
            },
          ],
        },
      },
    });

    await expect(page.getByText('Which preview should be used?')).toBeVisible();
    await expect(page.getByRole('button', { name: /PC preview/ })).toBeVisible();
  });

  test('keeps OpenCode running footer and batches loose live file events', async ({ page }) => {
    await installApiRoutes(page, () =>
      detail('opencode', {
        thread: {
          status: 'running',
          activeTurnId: 'opencode-runtime-turn-raw',
          lastTurnCompletedAt: null,
        },
        liveItems: {
          turnId: 'opencode-runtime-turn-raw',
          updatedAt: '2026-04-09T06:01:05.000Z',
          items: [
            {
              id: 'read-live-1',
              kind: 'fileRead',
              text: 'packages/frontend/src/tokenUsage.ts',
              previewText: 'packages/frontend/src/tokenUsage.ts',
              detailText: 'Tool: read\npackages/frontend/src/tokenUsage.ts',
              status: 'completed',
              sequence: 1,
            },
            {
              id: 'read-live-2',
              kind: 'fileRead',
              text: 'packages/frontend/src/tokenUsage.test.ts',
              previewText: 'packages/frontend/src/tokenUsage.test.ts',
              detailText: 'Tool: read\npackages/frontend/src/tokenUsage.test.ts',
              status: 'completed',
              sequence: 2,
            },
            {
              id: 'change-live-1',
              kind: 'fileChange',
              text: 'packages/frontend/src/tokenUsage.ts',
              previewText: '1 file changed · +12 · -1',
              detailText: '- packages/frontend/src/tokenUsage.ts (+12 -1)',
              changedFiles: 1,
              addedLines: 12,
              removedLines: 1,
              status: 'completed',
              sequence: 3,
            },
            {
              id: 'change-live-2',
              kind: 'fileChange',
              text: 'packages/frontend/src/tokenUsage.test.ts',
              previewText: '1 file changed · +4 · -3',
              detailText: '- packages/frontend/src/tokenUsage.test.ts (+4 -3)',
              changedFiles: 1,
              addedLines: 4,
              removedLines: 3,
              status: 'completed',
              sequence: 4,
            },
          ],
        },
        turns: [
          {
            id: 'opencode-display-turn',
            startedAt: now,
            status: 'completed',
            error: null,
            model: 'openai/gpt-5',
            reasoningEffort: 'low',
            tokenUsage: {
              total: {
                totalTokens: 18240,
                inputTokens: 12000,
                cachedInputTokens: 2000,
                outputTokens: 4240,
                reasoningOutputTokens: 1240,
              },
              last: {
                totalTokens: 2400,
                inputTokens: 1600,
                cachedInputTokens: 200,
                outputTokens: 800,
                reasoningOutputTokens: 320,
              },
              modelContextWindow: 272000,
            },
            priceEstimate: {
              pricingModelKey: 'openai/gpt-5',
              pricingTierKey: 'standard',
              currency: 'USD',
              inputUsd: 0.025,
              cachedInputUsd: 0.0005,
              outputUsd: 0.0636,
              totalUsd: 0.0891,
            },
            items: [
              { id: 'user-1', kind: 'userMessage', text: 'Check OpenCode live UI.' },
            ],
          },
        ],
      }),
    );

    await page.goto('/threads/thread-1');

    await expect(page.getByLabel('Running')).toBeVisible();
    await expect(page.getByText('2 file reads')).toBeVisible();
    await expect(page.getByText('2 file changes')).toBeVisible();
    await expect(page.getByText('+16')).toBeVisible();
    await expect(page.getByText('-4')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open full file read' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Open full file change' })).toHaveCount(0);
  });
});

test.describe('turn usage summary regressions', () => {
  test('shows live usage updates and keeps completed usage after reload', async ({ page }, testInfo) => {
    await installFakeWebSocket(page);
    await page.addInitScript(() => {
      window.localStorage.setItem('remote-codex-auto-collapse-completed-turns', 'true');
    });
    const total = {
      totalTokens: 3500, inputTokens: 1500, outputTokens: 2000,
      cachedInputTokens: 500, reasoningOutputTokens: 800,
    };
    const usage = { total, last: total, modelContextWindow: 1050000 };
    const priceEstimate = {
      pricingModelKey: 'gpt-6-astra', pricingTierKey: 'standard', currency: 'USD',
      inputUsd: 0.01, cachedInputUsd: 0.0005, outputUsd: 0.1, totalUsd: 0.1105,
    };
    let completed = false;
    let hasUsage = false;
    await installApiRoutes(page, () => detail('codex', {
      thread: { status: completed ? 'idle' : 'running', activeTurnId: completed ? null : 'turn-1' },
      turns: [{
        id: 'turn-1', status: completed ? 'completed' : 'inProgress',
        startedAt: now, completedAt: completed ? '2026-04-09T06:02:12.000Z' : null,
        error: null, model: 'gpt-6-astra', reasoningEffort: 'high',
        tokenUsage: hasUsage ? usage : null, priceEstimate: hasUsage ? priceEstimate : null,
        items: [
          { id: 'user-1', kind: 'userMessage', text: 'Check the streaming usage.' },
          { id: 'thinking-1', kind: 'reasoning', text: 'Checking the activity.', status: 'completed' },
          { id: 'command-1', kind: 'commandExecution', text: 'cargo test', status: 'completed' },
          ...(completed ? [{ id: 'agent-1', kind: 'agentMessage', text: 'Usage is restored.' }] : []),
        ],
      }],
    }));
    await page.goto('/threads/thread-1');
    await waitForSocketReady(page);
    const footer = page.locator('.thread-graph-turn-footer');
    await expect(footer).toContainText('gpt-6-astra · high');
    await expect(footer).not.toContainText('3.5k tokens');
    hasUsage = true;
    await emitSocketMessage(page, {
      type: 'thread.turn.token.updated', threadId: 'thread-1', timestamp: now,
      payload: { turnId: 'turn-1', tokenUsage: usage, priceEstimate, model: 'gpt-6-astra', reasoningEffort: 'high' },
    });
    for (const text of ['3.5k tokens', '1.5k in', '2k out', '500 cached', '≈$0.11']) {
      await expect(footer).toContainText(text);
    }
    await page.screenshot({ path: testInfo.outputPath('live-turn-usage.png'), fullPage: true });
    completed = true;
    await emitSocketMessage(page, {
      type: 'thread.turn.completed', threadId: 'thread-1', timestamp: now,
      payload: { turnId: 'turn-1' },
    });
    const summary = page.locator('.thread-graph-worked-summary:visible');
    await expect(summary).toContainText('Worked for 1m 12s');
    await expect(summary).toContainText('gpt-6-astra · high');
    await expect(summary).toContainText('≈$0.11');
    await page.reload();
    await expect(summary).toContainText('3.5k tokens');
    await expect(summary).toContainText('1.5k in');
    await expect(summary).toContainText('2k out');
    await expect(summary).toContainText('500 cached');
    await expect(summary).toContainText('≈$0.11');
    const overflow = await summary.evaluate((node) => {
      const viewportWidth = document.documentElement.clientWidth;
      return Math.max(...[node, ...node.querySelectorAll('[data-testid="turn-usage"] span')].map((element) => element.getBoundingClientRect().right - viewportWidth));
    });
    expect(overflow).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath('completed-turn-usage.png'), fullPage: true });
  });
});

test.describe('live activity persistence regressions', () => {
  test.beforeEach(async ({ page }) => {
    await installFakeWebSocket(page);
    await page.addInitScript(() => {
      window.localStorage.setItem('remote-codex-auto-collapse-completed-turns', 'false');
    });
  });

  test('keeps expanded activity and command groups open as new socket items arrive', async ({ page }) => {
    await installApiRoutes(page, () => detail('codex', {
      thread: { status: 'running', activeTurnId: 'turn-1' },
      turns: [{
        id: 'turn-1', status: 'inProgress', startedAt: now, error: null,
        items: [
          { id: 'user-1', kind: 'userMessage', text: 'Inspect the current activity.', sequence: 0 },
          { id: 'reason-1', kind: 'reasoning', text: 'Inspecting the first issue.', sequence: 1 },
          { id: 'command-1', kind: 'commandExecution', text: 'pwd', status: 'completed', sequence: 2 },
          { id: 'command-2', kind: 'commandExecution', text: 'git status', status: 'completed', sequence: 3 },
        ],
      }],
    }));
    await page.goto('/threads/thread-1');
    await waitForSocketReady(page);
    await page.getByRole('button', { name: 'Expand 3 operations', exact: true }).click();
    await page.getByRole('button', { name: 'Expand 2 command entries', exact: true }).click();

    await emitSocketMessage(page, {
      type: 'thread.item.started', threadId: 'thread-1', timestamp: now,
      payload: { turnId: 'turn-1', item: {
        id: 'command-3', kind: 'commandExecution', text: 'pnpm test', status: 'running', sequence: 4,
      } },
    });
    await expect(page.getByRole('button', { name: 'Collapse 4 operations', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Collapse 3 command entries', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open grouped command 3', exact: true })).toContainText('pnpm test');
    await emitSocketMessage(page, {
      type: 'thread.item.started', threadId: 'thread-1', timestamp: now,
      payload: { turnId: 'turn-1', item: {
        id: 'reason-2', kind: 'reasoning', text: 'Reviewing the streamed results.', sequence: 5,
      } },
    });
    await expect(page.getByText('Reviewing the streamed results.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Collapse 5 operations', exact: true }).click();
    await emitSocketMessage(page, {
      type: 'thread.item.started', threadId: 'thread-1', timestamp: now,
      payload: { turnId: 'turn-1', item: {
        id: 'reason-3', kind: 'reasoning', text: 'Preparing the next step.', sequence: 6,
      } },
    });
    await expect(page.getByRole('button', { name: 'Expand 6 operations', exact: true })).toBeVisible();
    await expect(page.getByText('Preparing the next step.', { exact: true })).toHaveCount(0);
  });

  test('preserves refreshed assistant text through later deltas, stale snapshots and replayed events', async ({ page }) => {
    let snapshotText = 'The persisted prefix.';
    let snapshotTitle = 'Streaming text regression';
    await installApiRoutes(page, () => detail('codex', {
      thread: { title: snapshotTitle, status: 'running', activeTurnId: 'turn-1' },
      turns: [{
        id: 'turn-1', status: 'inProgress', startedAt: now, error: null,
        items: [
          { id: 'user-1', kind: 'userMessage', text: 'Keep streaming after reload.', sequence: 0 },
          { id: 'agent-1', kind: 'agentMessage', text: snapshotText, status: 'running', createdAt: now, sequence: 1 },
        ],
      }],
    }));
    await page.goto('/threads/thread-1');
    await expect(page.getByText(snapshotText, { exact: true })).toBeVisible();
    await page.reload();
    await waitForSocketReady(page);
    await expect(page.getByText(snapshotText, { exact: true })).toBeVisible();
    const fullText = 'The persisted prefix. The next streamed suffix.';
    const deltaEvent = {
      type: 'thread.output.delta', threadId: 'thread-1', timestamp: now,
      payload: { turnId: 'turn-1', itemId: 'agent-1', delta: ' The next streamed suffix.', sequence: 1 },
    };
    await emitSocketMessage(page, deltaEvent);
    await expect(page.getByText(fullText, { exact: true })).toBeVisible();

    snapshotTitle = 'Stale snapshot returned';
    await emitSocketMessage(page, {
      type: 'thread.updated', threadId: 'thread-1', timestamp: now, payload: {},
    });
    await expect(page.getByRole('heading', { name: snapshotTitle, exact: true })).toBeVisible();
    await expect(page.getByText(fullText, { exact: true })).toBeVisible();

    snapshotText = fullText;
    await page.reload();
    await waitForSocketReady(page);
    await expect(page.getByText(fullText, { exact: true })).toBeVisible();
    await emitSocketMessage(page, {
      ...deltaEvent, payload: { ...deltaEvent.payload, text: fullText },
    });
    await expect(page.getByText(fullText, { exact: true })).toBeVisible();
    await emitSocketMessage(page, {
      ...deltaEvent,
      payload: { ...deltaEvent.payload, delta: ' Still streaming.', text: `${fullText} Still streaming.` },
    });
    await expect(page.getByText(`${fullText} Still streaming.`, { exact: true })).toBeVisible();
  });
});

test('opens attachment images and closes the preview outside the image', async ({ page }) => {
  await installApiRoutes(page, () => detail('codex', {
    turns: [{ id: 'turn-image', status: 'completed', error: null, model: 'gpt-6-astra', reasoningEffort: 'high',
      items: [{ id: 'photo-prompt', kind: 'userMessage', text: 'Inspect [PHOTO screenshot.png]' }] }],
  }));
  await page.route('**/api/threads/thread-1/assets/image**', route => route.fulfill({
    contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="640" height="400" fill="steelblue"/></svg>',
  }));
  await page.goto('/threads/thread-1');
  const trigger = page.getByRole('button', { name: 'Open image preview: screenshot.png' });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Image preview: screenshot.png' });
  await expect(dialog).toBeVisible();
  const full = dialog.getByRole('img');
  await expect(full).toBeVisible();
  const smallBox = await trigger.boundingBox();
  const largeBox = await full.boundingBox();
  expect(largeBox!.width).toBeGreaterThan(smallBox!.width);
  await full.click();
  await expect(dialog).toBeVisible();
  await dialog.locator('.thread-graph-image-lightbox-viewport').click({ position: { x: 4, y: 4 } });
  await expect(dialog).toHaveCount(0);
  await trigger.click();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});
