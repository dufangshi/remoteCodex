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
    await expect(footer).not.toContainText('3.5k tok');
    hasUsage = true;
    await emitSocketMessage(page, {
      type: 'thread.turn.token.updated', threadId: 'thread-1', timestamp: now,
      payload: { turnId: 'turn-1', tokenUsage: usage, priceEstimate, model: 'gpt-6-astra', reasoningEffort: 'high' },
    });
    for (const text of ['3.5k tok', '1.5k in', '2k out', '500 cached', '$0.11']) {
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
    await expect(summary).toContainText('$0.11');
    await page.reload();
    await expect(summary).toContainText('3.5k tok');
    await expect(summary).toContainText('1.5k in');
    await expect(summary).toContainText('2k out');
    await expect(summary).toContainText('500 cached');
    await expect(summary).toContainText('$0.11');
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

test('keeps delivered steer bubbles in collapsed and expanded history with tappable usage', async ({ page }, testInfo) => {
  await installFakeWebSocket(page);
  await page.addInitScript(() => localStorage.setItem('remote-codex-auto-collapse-completed-turns', 'true'));
  const total = { totalTokens: 3500, inputTokens: 1500, outputTokens: 2000, cachedInputTokens: 500, reasoningOutputTokens: 800 };
  await installApiRoutes(page, () => detail('codex', {
    thread: { status: 'idle', activeTurnId: null },
    turns: [{
      id: 'turn-1', status: 'completed', startedAt: now, completedAt: '2026-04-09T06:02:12.000Z',
      error: null, model: 'gpt-6-astra', reasoningEffort: 'high',
      tokenUsage: { total, last: total, modelContextWindow: 1050000 },
      priceEstimate: { pricingModelKey: 'gpt-6-astra', pricingTierKey: 'standard', currency: 'USD', inputUsd: .01, cachedInputUsd: .0005, outputUsd: .1, totalUsd: .1105 },
      items: [
        { id: 'user-1', kind: 'userMessage', text: 'INITIAL_REQUEST' },
        { id: 'command-before', kind: 'commandExecution', text: 'sleep 10', status: 'completed' },
        { id: 'agent-before', kind: 'agentMessage', text: 'BEFORE_STEER' },
        { id: 'steer:queued-1', kind: 'userMessage', text: 'STEER_REPLY_ONE' },
        { id: 'command-after', kind: 'commandExecution', text: 'sleep 10', status: 'completed' },
        { id: 'agent-after', kind: 'agentMessage', text: 'AFTER_STEER' },
      ],
    }],
  }));
  await page.goto('/threads/thread-1');
  const initial = page.getByText('INITIAL_REQUEST', { exact: true });
  const steer = page.getByText('STEER_REPLY_ONE', { exact: true });
  const summary = page.locator('.thread-graph-worked-summary:visible');
  await expect(steer).toBeVisible();
  expect((await initial.boundingBox())!.y).toBeLessThan((await steer.boundingBox())!.y);
  expect((await steer.boundingBox())!.y).toBeLessThan((await summary.boundingBox())!.y);
  const price = summary.getByRole('button', { name: 'API cost $0.11. Show token details', exact: true });
  await price.click();
  const tooltip = page.getByRole('tooltip');
  await expect(tooltip.getByLabel('Input: 1,000 tokens')).toBeVisible();
  await expect(tooltip.getByLabel('Input cost', {exact:true})).toHaveText('$0.010');
  await expect(tooltip.getByLabel('Output cost')).toHaveText('$0.060');
  await expect(tooltip.getByLabel('Reasoning cost')).toHaveText('$0.040');
  await expect(tooltip.getByLabel('Cached input: 500 tokens')).toBeVisible();
  await expect(tooltip.getByLabel('Reasoning: 800 tokens')).toBeVisible();
  await expect(page.locator('.thread-usage-details')).toHaveCSS('background-color', 'rgb(37, 38, 34)');
  await expect(page.getByRole('button', {name: /Expand turn 1/})).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(tooltip).toHaveCount(0);
  if (testInfo.project.name === 'mobile-chromium') {
    await expect(summary.locator('.thread-turn-usage-effort')).toBeHidden();
    await expect(summary.locator('.thread-turn-usage-tokens > span').nth(1)).toBeHidden();
    const label = await summary.locator('.thread-graph-worked-label').boundingBox();
    const amount = await price.boundingBox();
    expect(Math.abs(label!.y - amount!.y)).toBeLessThan(12);
    expect(amount!.x + amount!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  }
  const summaryBefore = (await summary.boundingBox())!;
  await page.getByRole('button', { name: /Expand turn 1/ }).click();
  await expect(page.getByText('BEFORE_STEER', {exact:true})).toBeVisible();
  expect((await steer.boundingBox())!.y).toBeLessThan((await summary.boundingBox())!.y);
  expect(Math.abs((await summary.boundingBox())!.y - summaryBefore.y)).toBeLessThan(3);
  await page.getByRole('button', { name: /Collapse turn 1/ }).click();
  expect(Math.abs((await summary.boundingBox())!.y - summaryBefore.y)).toBeLessThan(3);
  expect((await steer.boundingBox())!.y).toBeLessThan((await page.getByText('AFTER_STEER', {exact:true}).boundingBox())!.y);
  await page.reload();
  await expect(steer).toHaveCount(1);
  await expect(steer).toBeVisible();
});

test('renders Codex multi-question cards after refresh and submits every answer', async ({ page }) => {
  await installFakeWebSocket(page);
  const request = { id: 'ask-codex', kind: 'requestUserInput', title: 'Question', turnId: 'turn-1', createdAt: now, questions: [
    {id:'choice', header:'Choice', question:'Which option?', isOther:true, options:[{label:'A',description:'First'},{label:'B',description:'Second'}]},
    {id:'detail', header:'Detail', question:'Why this choice?', isOther:true, options:null},
  ]};
  let pending = true;
  let submitted: unknown;
  await installApiRoutes(page, () => detail('codex', {pendingRequests: pending ? [request] : []}));
  await page.route('**/api/threads/thread-1/requests/ask-codex/respond', async route => {
    submitted = route.request().postDataJSON();
    pending = false;
    await route.fulfill({json:detail('codex', {pendingRequests:[]})});
  });
  await page.goto('/threads/thread-1');
  await expect(page.getByText('Which option?', {exact:true})).toBeVisible();
  await page.reload();
  await page.getByRole('button', {name:'Not from above',exact:true}).click();
  await page.getByLabel('Choice custom answer').fill('C');
  await page.getByLabel('Detail', {exact:true}).fill('because');
  await page.getByRole('button', {name:'Submit',exact:true}).click();
  await expect.poll(() => submitted).toEqual({answers:{choice:{answers:['C']},detail:{answers:['because']}}});
  await expect(page.getByText('Which option?', {exact:true})).toHaveCount(0);
});

test('keeps subtle timestamps above messages and reveals touch copy controls', async ({page}, testInfo) => {
  await page.context().grantPermissions(['clipboard-read','clipboard-write']);
  await installFakeWebSocket(page);
  await installApiRoutes(page, () => detail('codex', {
    thread:{status:'idle',activeTurnId:null},
    turns:[{id:'turn-1',status:'completed',startedAt:now,completedAt:now,error:null,items:[
      {id:'user-1',kind:'userMessage',text:'POLISH_PROMPT',createdAt:now},
      {id:'agent-1',kind:'agentMessage',createdAt:now,text:'对，**原生 Mac 使用 `proxy-env`。**如果继续。\n\n```txt\n**literal code**\n```'},
    ]}],
  }));
  await page.goto('/threads/thread-1');
  const bubble = page.locator('.thread-graph-message-bubble.is-assistant').last();
  await expect(bubble.locator('strong')).toHaveText('原生 Mac 使用 proxy-env。');
  const time = page.locator('.thread-graph-message-time-row').last();
  await expect(time).toBeVisible();
  expect((await time.boundingBox())!.height).toBeLessThanOrEqual(13);
  expect((await time.boundingBox())!.y).toBeLessThan((await bubble.boundingBox())!.y);
  const timeBox = (await time.boundingBox())!;
  expect((await bubble.locator('p').first().boundingBox())!.y - timeBox.y - timeBox.height).toBeLessThanOrEqual(4);
  const copy = bubble.locator('.thread-graph-message-copy-desktop');
  const code = bubble.locator('.thread-graph-code-block');
  const codeCopy = code.locator('.thread-graph-code-copy');
  if (testInfo.project.name === 'mobile-chromium') {
    await expect(copy).toHaveCSS('opacity','0');
    await bubble.locator('p').first().tap();
    await expect(copy).toHaveCSS('opacity','0.6');
    await expect(codeCopy).toHaveCSS('opacity','0');
    await code.locator('pre').tap();
    await expect(codeCopy).toHaveCSS('opacity','0.6');
  } else {
    await bubble.hover();
    await expect(copy).toHaveCSS('opacity','0.6');
    await code.hover();
    await expect(codeCopy).toHaveCSS('opacity','0.6');
  }
  const copyBounds = (await copy.boundingBox())!;
  const bubbleBounds = (await bubble.boundingBox())!;
  expect(Math.abs(copyBounds.x + copyBounds.width - bubbleBounds.x - bubbleBounds.width)).toBeLessThan(5);
  const block = (await code.boundingBox())!;
  const button = (await codeCopy.boundingBox())!;
  expect(button.y - block.y).toBeLessThan(16);
  expect(block.x+block.width-button.x-button.width).toBeLessThan(16);
  await bubble.getByRole('button',{name:'Copy agent reply',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>navigator.clipboard.readText())).toContain('**literal code**');
  const userBubble = page.locator('.thread-graph-message-bubble.is-user').first();
  if (testInfo.project.name === 'mobile-chromium') await userBubble.tap(); else await userBubble.hover();
  const userCopy = userBubble.getByRole('button',{name:'Copy prompt',exact:true});
  await expect(userBubble.locator('.thread-graph-message-copy-desktop')).toHaveCSS('opacity','0.6');
  const ub = (await userBubble.boundingBox())!;
  const cb = (await userCopy.boundingBox())!;
  expect(Math.abs(cb.x+cb.width-ub.x-ub.width)).toBeLessThan(5);
  await userCopy.click();
  await expect.poll(()=>page.evaluate(()=>navigator.clipboard.readText())).toBe('POLISH_PROMPT');

});

test('edits global model prices and custom display aliases', async ({page}) => {
  await installFakeWebSocket(page);
  await installApiRoutes(page, () => detail('codex'));
  const models: Record<string, any> = {'gpt-6-astra':{inputUsdPerMillion:10,cachedInputUsdPerMillion:1,outputUsdPerMillion:50}};
  let saved: any;
  await page.route('**/api/config/model-pricing',async route=>{
    if(route.request().method()==='PATCH') {saved=route.request().postDataJSON();models[saved.id]={...saved.rates,custom:true};}
    await route.fulfill({json:{models}});
  });
  await page.goto('/threads/thread-1');
  if (await page.getByRole('button', {name:'Open rooms', exact:true}).isVisible()) await page.getByRole('button', {name:'Open rooms', exact:true}).click();
  await page.getByRole('button',{name:'Open settings',exact:true}).click();
  await page.getByRole('button',{name:'Global',exact:true}).click();
  const section=page.getByRole('region',{name:'Model pricing'});
  await expect(section.getByText('gpt-6-astra',{exact:true})).toBeVisible();
  await section.getByRole('button',{name:'Add model',exact:true}).click();
  await section.getByLabel('Pricing model ID').fill('my-model');
  await section.getByLabel('Model aliases').fill('MY Model, GPT-Custom');
  await section.getByLabel('In price per million',{exact:true}).fill('2');
  await section.getByLabel('Cached price per million',{exact:true}).fill('0.2');
  await section.getByLabel('Out price per million',{exact:true}).fill('10');
  await section.getByRole('button',{name:'Save prices',exact:true}).click();
  await expect(section.getByRole('status')).toHaveText('Model prices saved.');
  expect(saved.rates.aliases).toEqual(['MY Model','GPT-Custom']);
  expect(saved.rates.inputUsdPerMillion).toBe(2);
  await section.getByLabel('Search model prices').fill('gpt-custom');
  await expect(section.getByText('my-model',{exact:true})).toBeVisible();
  await section.getByRole('button',{name:'Edit my-model',exact:true}).click();
  await section.getByLabel('In price per million',{exact:true}).fill('4');
  await section.getByRole('button',{name:'Save prices',exact:true}).click();
  await expect.poll(()=>saved.rates.inputUsdPerMillion).toBe(4);
  await page.reload();
  if (await page.getByRole('button', {name:'Open rooms', exact:true}).isVisible()) await page.getByRole('button', {name:'Open rooms', exact:true}).click();
  await page.getByRole('button',{name:'Open settings',exact:true}).click();
  await page.getByRole('button',{name:'Global',exact:true}).click();
  await expect(page.getByRole('region',{name:'Model pricing'}).getByText('my-model',{exact:true})).toBeVisible();
});

test('shows real OAuth windows above composer for ACP and hides unavailable usage', async ({page}) => {
  await installFakeWebSocket(page);
  await installApiRoutes(page, () => detail('codex',{thread:{provider:'acp',agentId:'grok'}}));
  let usage: any={provider:'grok',authKind:'subscription',observedAt:now,stale:false,windows:[{id:'weekly',label:'7d',durationMinutes:10080,usedPercent:21,resetsAt:'2030-01-01T00:00:00Z'}]};
  let requestAgent: string|null=null;
  await page.route('**/api/agent-runtimes/acp/subscription-usage*',async route=>{requestAgent=new URL(route.request().url()).searchParams.get('agentId');await route.fulfill({json:{usage}});});
  await page.goto('/threads/thread-1');
  const badge=page.getByRole('button',{name:/grok subscription usage/});
  await expect(badge).toBeVisible();expect(requestAgent).toBe('grok');
  await expect(badge).toContainText('7d');await expect(badge).not.toContainText('5h');
  await badge.click();await expect(badge.getByRole('tooltip')).toContainText('79% remaining');await expect(badge.getByRole('tooltip')).toContainText('resets');
  await page.keyboard.press('Escape');await expect(badge).toHaveAttribute('aria-expanded','false');
  usage={...usage,authKind:'apiKey'};await page.reload();await expect(page.locator('.thread-subscription-usage')).toHaveCount(0);
  usage=null;await page.reload();await expect(page.locator('.thread-subscription-usage')).toHaveCount(0);
});

for (const provider of ['claude', 'acp'] as const) {
  test(`shows Claude zero-use OAuth windows through ${provider}`, async ({page}) => {
    await installFakeWebSocket(page);
    await installApiRoutes(page, () => detail('claude', {thread:{provider,agentId:'claude'}}));
    const windows = [{id:'five_hour',label:'5h',durationMinutes:300}, {id:'seven_day',label:'7d',durationMinutes:10080}].map(window=>({...window,usedPercent:0,resetsAt:'2030-01-01T00:00:00Z'}));
    await page.route(`**/api/agent-runtimes/${provider}/subscription-usage*`, async route => {
      expect(new URL(route.request().url()).searchParams.get('agentId')).toBe('claude');
      await route.fulfill({json:{usage:{provider:'claude',authKind:'subscription',observedAt:now,stale:false,windows}}});
    });
    await page.goto('/threads/thread-1');
    const badge = page.getByRole('button',{name:/claude subscription usage/});
    await expect(badge).toBeVisible();
    await expect(badge).toContainText('5h');
    await expect(badge).toContainText('7d');
    await badge.click();
    await expect(badge.getByRole('tooltip')).toContainText('100% remaining');
    await expect(badge.getByRole('tooltip')).toContainText('resets');
  });
}

test('keeps running indicators on active commands and the turn footer only', async ({page}) => {
  await installFakeWebSocket(page);
  await installApiRoutes(page, () => detail('codex', {
    thread:{status:'running',activeTurnId:'turn-1'},
    turns:[{id:'turn-1',status:'inProgress',startedAt:now,error:null,items:[
      {id:'user-1',kind:'userMessage',text:'RUNNING_INDICATORS'},
      {id:'agent-1',kind:'agentMessage',text:'Earlier checkpoint',status:'running'},
      {id:'old-command',kind:'commandExecution',text:'printf done',status:'completed'},
      {id:'agent-2',kind:'agentMessage',text:'Next checkpoint',status:'running'},
      {id:'new-command',kind:'commandExecution',text:'sleep 30',status:'running'},
    ]}],
  }));
  await page.goto('/threads/thread-1');
  await expect(page.getByText('Earlier checkpoint',{exact:true})).toBeVisible();
  await expect(page.locator('.thread-graph-message-bubble.is-assistant .animate-pulse')).toHaveCount(0);
  await expect(page.locator('.thread-graph-turn-footer .animate-pulse').first()).toBeVisible();
});

test('restores context from last request on older Codex supervisors', async ({page}) => {
  await installFakeWebSocket(page);
  const last={totalTokens:120000,inputTokens:119000,outputTokens:1000,cachedInputTokens:100000,reasoningOutputTokens:0};
  await installApiRoutes(page, () => detail('codex', {
    thread:{status:'idle',activeTurnId:null,contextUsage:null},
    turns:[{id:'turn-1',status:'completed',startedAt:now,error:null,items:[{id:'reply',kind:'agentMessage',text:'Context restored'}],tokenUsage:{last,total:{...last,totalTokens:16000000},modelContextWindow:1000000}}],
  }));
  await page.goto('/threads/thread-1');
  await expect(page.getByTitle(/120k used.*88% context left/)).toBeVisible();
  await page.reload();
  await expect(page.getByTitle(/120k used.*88% context left/)).toBeVisible();
});

test('loads three summaries and fetches running operations only on expansion', async ({page}) => {
  await installFakeWebSocket(page);
  const turns = [1,2,3].map(n => ({id:`turn-${n}`,startedAt:now,status:n===3?'inProgress':'completed',hasDeferredItems:true,deferredItemCount:1,items:[{id:`user-${n}`,kind:'userMessage',text:`Lazy prompt ${n}`},{id:`agent-${n}`,kind:'agentMessage',text:`Visible answer ${n}`}]}));
  await installApiRoutes(page,()=>detail('codex',{thread:{status:'running',activeTurnId:'turn-3'},totalTurnCount:3,turns}));
  let fullRequests=0;
  const summaryQueries:string[]=[];
  page.on('request',request=>{const url=new URL(request.url());if(url.pathname==='/api/threads/thread-1')summaryQueries.push(url.search);});
  await page.route('**/api/threads/thread-1/turns/turn-3/detail',async route=>{
    fullRequests++;
    await route.fulfill({json:{...turns[2],hasDeferredItems:false,items:[turns[2]!.items[0],{id:'checkpoint',kind:'agentMessage',text:'Previously deferred checkpoint'},{id:'op',kind:'commandExecution',text:'echo LAZY_OPERATION',status:'completed'},turns[2]!.items[1]]}});
  });
  await page.goto('/threads/thread-1');
  await expect(page.getByText('Visible answer 3',{exact:true})).toBeVisible();
  expect(summaryQueries[0]).toBe('?view=summary&limit=3');
  expect(fullRequests).toBe(0);
  await expect(page.locator('[data-timeline-turn]')).toHaveCount(3);
  await page.getByRole('button',{name:/Expand turn 3/}).click();
  await expect(page.getByText('Previously deferred checkpoint',{exact:true})).toBeVisible();
  expect(fullRequests).toBe(1);
  await page.getByRole('button',{name:/Collapse turn 3/}).click();
  await expect(page.getByText('Previously deferred checkpoint',{exact:true})).toHaveCount(0);
});

test('long message disclosure stays compact and preserves the complete text', async ({page}) => {
  await installFakeWebSocket(page);
  await installApiRoutes(page,()=>detail('codex',{turns:[{id:'turn-1',startedAt:now,status:'completed',items:[{id:'agent-long',kind:'agentMessage',text:'A readable long answer. '.repeat(200)+' END_OF_LONG_ANSWER'}]}]}));
  await page.goto('/threads/thread-1');
  const more=page.getByRole('button',{name:'Show more',exact:true});
  await expect(more).toBeVisible();
  expect((await more.boundingBox())!.width).toBeLessThan(140);
  await more.click();
  await expect(page.getByText(/END_OF_LONG_ANSWER/)).toBeVisible();
  const less=page.getByRole('button',{name:'Show less',exact:true});
  await expect(less).toBeVisible();
  await less.click();
  await expect(more).toBeVisible();
});

test('a gateway timeout confirms delivered steer without showing an HTML error', async ({page}) => {
  await installFakeWebSocket(page);
  let delivered=false;
  let submits=0;
  const pending={id:'queue-1',turnId:'turn-1',clientRequestId:'client-1',prompt:'Reply with a single one',delivery:'continuation',createdAt:now};
  const current=()=>detail('codex',{thread:{status:'running',activeTurnId:'turn-1'},pendingSteers:[{...pending,delivery:delivered?'steer':'continuation'}],turns:[{id:'turn-1',startedAt:now,status:'inProgress',items:[{id:'user-1',kind:'userMessage',text:'Original task'}]}]});
  await installApiRoutes(page,current);
  await page.route('**/api/threads/thread-1/pending-steers/queue-1/steer',async route=>{
    submits++;delivered=true;
    await route.fulfill({status:504,contentType:'text/html',body:'<!doctype html><html>Gateway timeout cloudflare diagnostic</html>'});
  });
  await page.route('**/api/threads/thread-1?view=delivery',async route=>route.fulfill({json:{...current(),turns:[],acceptedSteerIds:['queue-1']}}));
  await page.goto('/threads/thread-1');
  const queue=page.getByRole('region',{name:'Queued prompts'});
  await queue.getByRole('button',{name:'Steer',exact:true}).click();
  await expect(queue).toHaveCount(0);
  await expect(page.getByText('Reply with a single one',{exact:true})).toBeVisible();
  await expect(page.getByText('Accepted',{exact:true})).toBeVisible();
  await expect(page.getByText(/Gateway timeout cloudflare diagnostic|not yet confirmed|Request failed/)).toHaveCount(0);
  expect(submits).toBe(1);
});

test('an expanded long reply stays expanded when the running turn becomes final history', async ({page}) => {
  await installFakeWebSocket(page);
  let complete=false;
  const answer='A detailed explanation while the agent runs. '.repeat(160);
  await installApiRoutes(page,()=>detail('codex',{
    thread:{status:complete?'idle':'running',activeTurnId:complete?null:'turn-1'},
    turns:[{id:'turn-1',startedAt:now,status:complete?'completed':'inProgress',hasDeferredItems:complete,deferredItemCount:complete?1:0,items:[
      {id:'user-1',kind:'userMessage',text:'Explain in detail'},
      {id:'same-answer',kind:'agentMessage',text:answer+(complete?' FINAL_SENTENCE':'')},
    ]}],
  }));
  await page.goto('/threads/thread-1');
  await page.getByRole('button',{name:'Show more',exact:true}).click();
  await expect(page.getByRole('button',{name:'Show less',exact:true})).toBeVisible();
  await waitForSocketReady(page);
  complete=true;
  await emitSocketMessage(page,{type:'thread.turn.completed',threadId:'thread-1',timestamp:now,payload:{turnId:'turn-1',status:'completed'}});
  await expect(page.getByText(/FINAL_SENTENCE/)).toBeVisible();
  await expect(page.getByRole('button',{name:'Show less',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Show more',exact:true})).toHaveCount(0);
});

test('exports the live thread styling and complete Markdown to offline HTML', async ({page, context}, testInfo) => {
  const fs = await import('node:fs/promises');
  const {pathToFileURL} = await import('node:url');
  await page.emulateMedia({colorScheme:testInfo.project.name==='mobile-chromium'?'dark':'light'});
  await installFakeWebSocket(page);
  await context.addInitScript(() => { window.print = () => { document.documentElement.dataset.printRequested = 'true'; }; });
  const answer = '# 导出样式验证\n\n**中文加粗** and *emphasis* with `inline code`.\n\n| 模型 | Tokens |\n| --- | --- |\n| Codex | 8k |\n\n- 第一项\n- Second item\n\n```typescript\nconst greeting = "你好";\nconsole.log(greeting);\n```\n\nMath: $E=mc^2$.\n\n![Markdown attachment](https://example.test/image.png)\n\n' + ('完整段落，长回复不能截断。\n\n'.repeat(1000)) + 'END_OF_COMPLETE_REPLY';
  const total = {totalTokens:3500,inputTokens:1500,outputTokens:2000,cachedInputTokens:500,reasoningOutputTokens:800};
  const fixture = detail('codex', {thread:{status:'idle',activeTurnId:null,title:'Styled transcript 中文'},totalTurnCount:1,turns:[{
    id:'turn-1',status:'completed',startedAt:now,completedAt:'2026-04-09T06:02:12.000Z',error:null,model:'gpt-6-astra',reasoningEffort:'high',tokenUsage:{total,last:total},
    priceEstimate:{pricingModelKey:'gpt-6-astra',pricingTierKey:'standard',currency:'USD',inputUsd:.01,cachedInputUsd:.0005,outputUsd:.1,totalUsd:.1105},
    items:[{id:'u',kind:'userMessage',text:'Please export this conversation. [PHOTO screenshot.png]',createdAt:now},{id:'op',kind:'commandExecution',text:'PRIVATE_OPERATION'},{id:'a',kind:'agentMessage',text:answer,previewText:'TRUNCATED_PREVIEW',phase:'final',createdAt:'2026-04-09T06:02:12.000Z'}],
  }]});
  await installApiRoutes(page,()=>fixture);
  await page.route('**/assets/image?*',route=>route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX9sAAAAASUVORK5CYII=','base64')}));
  await page.route('https://example.test/image.png',route=>route.fulfill({headers:{'Access-Control-Allow-Origin':'*'},contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX9sAAAAASUVORK5CYII=','base64')}));
  await page.goto('/threads/thread-1');
  const userBubble = page.locator('[data-role="user"] .thread-graph-message-bubble');
  await expect(userBubble).toBeVisible();
  const appearance = await userBubble.evaluate(el=>{const s=getComputedStyle(el);return {background:s.backgroundColor,radius:s.borderRadius,font:s.fontSize};});
  await page.getByRole('button',{name:'Thread actions',exact:true}).click();
  let dialog = page.getByRole('dialog',{name:'Thread actions',exact:true});
  await dialog.getByRole('button',{name:'HTML',exact:true}).click();
  const downloadPromise = page.waitForEvent('download');
  await dialog.getByRole('button',{name:'Export HTML',exact:true}).click();
  const download = await downloadPromise;
  const htmlPath = testInfo.outputPath('transcript.html');
  await download.saveAs(htmlPath);
  const html = await fs.readFile(htmlPath,'utf8');
  expect(html).toContain('<strong>中文加粗</strong>');
  expect(html).toContain('END_OF_COMPLETE_REPLY');
  expect(html).not.toContain('TRUNCATED_PREVIEW');
  expect(html).not.toContain('PRIVATE_OPERATION');
  expect(html).not.toContain('<script');
  expect(html).not.toContain('token=');
  const offline = await context.newPage();
  await offline.route('http**/*',route=>route.abort());
  await offline.goto(pathToFileURL(htmlPath).href);
  await expect(offline.locator('table')).toBeVisible();
  await expect(offline.locator('.katex').first()).toBeVisible();
  await expect(offline.locator('pre code')).toContainText('const greeting');
  await expect(offline.locator('pre code span[style]').first()).toBeAttached();
  await expect(offline.locator('img')).toHaveCount(2);
  expect(await offline.locator('img').evaluateAll(images=>images.every(image=>(image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth>0))).toBe(true);
  const exportedAppearance = await offline.locator('[data-role="user"] .thread-graph-message-bubble').evaluate(el=>{const s=getComputedStyle(el);return {background:s.backgroundColor,radius:s.borderRadius,font:s.fontSize};});
  expect(exportedAppearance).toEqual(appearance);
  await expect(offline.locator('button')).toHaveCount(0);
  await expect(offline.locator('.thread-graph-worked-summary')).toContainText('Worked for 1m 12s');
  expect(await offline.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await offline.screenshot({path:testInfo.outputPath('offline-transcript.png')});
  await page.getByRole('button',{name:'Thread actions',exact:true}).click();
  await expect(page.getByRole('dialog').getByRole('button',{name:'PDF',exact:true})).toHaveCount(0);
});

test('file links reveal only the requested nested file and copy workspace-relative paths', async ({page},testInfo) => {
  await installFakeWebSocket(page);
  await page.addInitScript(()=>{
    localStorage.setItem('remote-codex:graphchat:workspace:expanded:workspace-1:thread-1',JSON.stringify({version:2,expandedPaths:['docs'],selectedPath:'docs/WRONG.md'}));
    Object.defineProperty(navigator,'clipboard',{value:{writeText:async (text:string)=>{(window as any).__copiedPath=text;}},configurable:true});
  });
  const target='el-agente-cloud-infrastructure/docs/work-plan/compute-run-runtime-protocol-design.md';
  await installApiRoutes(page,()=>detail('codex',{thread:{status:'idle',activeTurnId:null},turns:[{id:'turn-1',status:'completed',startedAt:now,items:[{id:'user',kind:'userMessage',text:'Review the design'},{id:'answer',kind:'agentMessage',text:`[Protocol design](/tmp/demo/${target})`}]}]}));
  const dir=(path:string,children:any[]=[],loaded=false)=>({path,name:path.split('/').at(-1)||'Demo Workspace',kind:'directory',children,childrenLoaded:loaded,hasChildren:true});
  const file=(path:string)=>({path,name:path.split('/').at(-1),kind:'file',children:[],size:50});
  const reads:string[]=[];
  await page.route('**/api/workspaces/workspace-1/files/**',async route=>{
    const url=new URL(route.request().url());const path=url.searchParams.get('path')??'';
    if(url.pathname.endsWith('/tree')) {
      const children=path===''?[dir('docs'),dir('el-agente-cloud-infrastructure'),...Array.from({length:70},(_,i)=>file(`other-${i}.md`))]:path==='docs'?[file('docs/WRONG.md')]:path==='el-agente-cloud-infrastructure'?[dir('el-agente-cloud-infrastructure/docs')]:path.endsWith('/docs')?[dir('el-agente-cloud-infrastructure/docs/work-plan')]:[file(target)];
      await route.fulfill({json:dir(path,children,true)});
    } else if(url.pathname.endsWith('/preview')) {
      reads.push(path);
      await route.fulfill({json:{path,name:path.split('/').at(-1),content:path===target?'# CORRECT PROTOCOL DOCUMENT':'# WRONG DOCUMENT',language:'markdown',size:50,truncated:false,nextOffset:50}});
    } else await route.fulfill({status:404});
  });
  await page.goto('/threads/thread-1');
  const link=page.getByRole('link',{name:'Protocol design',exact:true});
  await expect(link).toHaveAttribute('href',`./${target}`);
  await expect(link).toHaveAttribute('title',`./${target}`);
  await link.dispatchEvent('contextmenu',{clientX:100,clientY:100});
  await page.getByRole('menuitem',{name:'Copy link address',exact:true}).click();
  expect(await page.evaluate(()=>(window as any).__copiedPath)).toBe(`./${target}`);
  await link.click();
  await expect(page.getByRole('heading',{name:'CORRECT PROTOCOL DOCUMENT'})).toBeVisible();
  expect(reads).toEqual([target]);
  const row=page.getByRole('treeitem').filter({hasText:'compute-run-runtime-protocol-design.md'});
  await expect(row).toHaveAttribute('aria-selected','true');
  await expect(row).toBeVisible();
  await row.hover();
  await row.getByRole('button',{name:'Copy path for compute-run-runtime-protocol-design.md',exact:true}).click();
  expect(await page.evaluate(()=>(window as any).__copiedPath)).toBe(`./${target}`);
  await expect(page.getByRole('heading',{name:'WRONG DOCUMENT'})).toHaveCount(0);
  await page.screenshot({path:testInfo.outputPath('correct-workspace-link.png')});
});

test('running operation batches stay after earlier replies and show a live timestamp range', async ({page},testInfo) => {
  await installFakeWebSocket(page);
  const at=(seconds:number)=>new Date(Date.parse(now)+seconds*1000).toISOString();
  let finished=false;
  const items=[
    {id:'u',kind:'userMessage',text:'Build the protocol',createdAt:now},
    {id:'r1',kind:'reasoning',text:'Before checkpoint',createdAt:at(1)},
    {id:'c1',kind:'commandExecution',text:'echo first',status:'completed',createdAt:at(5)},
    {id:'checkpoint',kind:'agentMessage',phase:'commentary',text:'Start implementing Slice 1',createdAt:at(10)},
    {id:'r2',kind:'reasoning',text:'After checkpoint',createdAt:at(11)},
    {id:'c2',kind:'commandExecution',text:'echo latest',status:'completed',createdAt:at(25)},
  ];
  await installApiRoutes(page,()=>detail('codex',{thread:{status:finished?'idle':'running',activeTurnId:finished?null:'turn-1'},turns:[{id:'turn-1',status:finished?'completed':'inProgress',startedAt:now,items:finished?[...items,{id:'final',kind:'agentMessage',text:'All done',createdAt:at(30)}]:items}]}));
  await page.goto('/threads/thread-1');
  const expand=page.getByRole('button',{name:/Expand turn 1/});
  await expand.click();
  const checkpoint=page.getByText('Start implementing Slice 1',{exact:true});
  const batch=page.locator('.thread-graph-history-group-activity').last();
  await expect(checkpoint).toBeVisible();
  await expect(batch).toHaveClass(/is-running-batch/);
  expect((await checkpoint.boundingBox())!.y).toBeLessThan((await batch.boundingBox())!.y);
  await expect(batch.locator('.thread-graph-relative-time').first()).toHaveText('11s – 25s');
  expect(await batch.locator('.thread-graph-history-group-verb').evaluate(el=>getComputedStyle(el).animationName)).toBe('thread-operation-sheen');
  await page.screenshot({path:testInfo.outputPath('ordered-live-batches.png')});
  finished=true;
  await page.reload();
  await expect(page.getByText('All done',{exact:true})).toBeVisible();
  await expect(page.locator('.is-running-batch')).toHaveCount(0);
});

test('completed commands stop running immediately and survive stale snapshots', async ({page}) => {
  await installFakeWebSocket(page);
  const command={id:'cmd',kind:'commandExecution',text:'grep source',detailText:'Long incremental output from the command',status:'running',createdAt:now};
  await installApiRoutes(page,()=>detail('codex',{thread:{status:'running',activeTurnId:'turn-1'},turns:[{id:'turn-1',status:'inProgress',startedAt:now,items:[{id:'user',kind:'userMessage',text:'Check command completion'},command]}]}));
  await page.goto('/threads/thread-1');
  await waitForSocketReady(page);
  await page.getByRole('button',{name:/Expand turn 1/}).click();
  // Started payload contains more text than the terminal status update.
  const emit=async (item:typeof command,type:string)=>emitSocketMessage(page,{type,threadId:'thread-1',timestamp:now,payload:{turnId:'turn-1',item}});
  await emit(command,'thread.item.started');
  await expect(page.getByText('running',{exact:true}).first()).toBeVisible();
  await emit({...command,detailText:'',status:'completed'},'thread.item.completed');
  await expect(page.getByText('running',{exact:true})).toHaveCount(0);
  await emit(command,'thread.item.started');
  await expect(page.getByText('running',{exact:true})).toHaveCount(0);
  await emitSocketMessage(page,{type:'thread.updated',threadId:'thread-1',timestamp:now,payload:{status:'running'}});
  await expect(page.getByText('running',{exact:true})).toHaveCount(0);
  await expect(page.locator('.thread-graph-turn-footer .animate-pulse').first()).toBeVisible();
});


test('external generated image and document links open read-only Explorer previews without navigation', async ({page}, testInfo) => {
  await installFakeWebSocket(page);
  const imagePath='/Users/mac/.codex/generated_images/upstream test.png';
  const docPath='/Users/mac/.codex/generated_images/result.md';
  await installApiRoutes(page,()=>detail('codex',{thread:{status:'idle',activeTurnId:null},turns:[{id:'turn-1',status:'completed',startedAt:now,items:[{id:'user',kind:'userMessage',text:'Generate a picture'},{id:'answer',kind:'agentMessage',text:`[Generated image](<${imagePath}>) [Generated document](${new URL(docPath, 'http://localhost:'+ (process.env.E2E_WEB_PORT ?? '5173')).href})`}]}]}));
  const reads:string[]=[];
  await page.route('**/api/workspaces/workspace-1/files/**', async route=>{
    const url=new URL(route.request().url());
    if (url.pathname.endsWith('/tree')) await route.fulfill({json:{path:'',name:'Demo Workspace',kind:'directory',childrenLoaded:true,children:[{path:'WRONG.md',name:'WRONG.md',kind:'file'}]}});
    else {reads.push('WRONG');await route.fulfill({status:404});}
  });
  await page.route('**/api/threads/thread-1/linked-files/**',async route=>{
    const url=new URL(route.request().url());const path=url.searchParams.get('path');
    expect([imagePath,docPath]).toContain(path);
    if(url.pathname.endsWith('/stat')) await route.fulfill({json:{path,name:path!.split('/').at(-1),kind:'file',size:80}});
    else if(url.pathname.endsWith('/raw')) {reads.push(path!);await route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/a0AAAAASUVORK5CYII=','base64')});}
    else {reads.push(path!);await route.fulfill({json:{path,name:'result.md',content:'# Linked result',language:'markdown',size:15,truncated:false,nextOffset:15}});}
  });
  await page.goto('/threads/thread-1');
  const before=page.url();
  await page.getByRole('link',{name:'Generated image',exact:true}).click();
  const image=page.locator('img[src*="linked-files/raw"]').first();
  await expect(image).toBeVisible();
  await expect.poll(()=>image.evaluate(el=>(el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  expect(page.url()).toBe(before);
  expect(reads).toEqual([imagePath]);
  await page.screenshot({path:testInfo.outputPath('linked-image.png')});
  await page.getByRole('button',{name:testInfo.project.name === 'mobile-chromium' ? 'Show chat' : 'Collapse workspace',exact:true}).first().click();
  await page.getByRole('link',{name:'Generated document',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Linked result',exact:true})).toBeVisible();
  expect(page.url()).toBe(before);
  expect(reads).toEqual([imagePath,docPath]);
});

test('archive links show a download panel and preserve original bytes for local and linked files', async ({page}, testInfo) => {
  await installFakeWebSocket(page);
  const externalPath = '/Users/mac/Downloads/upstream-imagegen.zip';
  const bytes = Buffer.from([0x50, 0x4b, 3, 4, 0, 255, 128, 10, 13, 0]);
  const reads: string[] = [];
  await installApiRoutes(page, () => detail('codex', {
    thread: {status: 'idle', activeTurnId: null},
    turns: [{id: 'turn-1', status: 'completed', startedAt: now, items: [
      {id: 'answer', kind: 'agentMessage', text: `[Download linked archive](${externalPath}) [Download workspace archive](./bundle.zip)`},
    ]}],
  }));
  await page.route('**/api/workspaces/workspace-1/files/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/tree')) {
      await route.fulfill({json: {path: '', name: 'Demo Workspace', kind: 'directory', childrenLoaded: true, children: [
        {path: 'bundle.zip', name: 'bundle.zip', kind: 'file', size: bytes.length},
      ]}});
    } else if (url.pathname.endsWith('/download')) {
      expect(url.searchParams.get('path')).toBe('bundle.zip');
      reads.push('workspace-download');
      await route.fulfill({contentType: 'application/zip', headers: {'content-disposition': 'attachment; filename="bundle.zip"'}, body: bytes});
    } else { reads.push('unexpected-preview'); await route.fulfill({status: 500}); }
  });
  await page.route('**/api/threads/thread-1/linked-files/**', async route => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get('path')).toBe(externalPath);
    if (url.pathname.endsWith('/stat')) {
      await route.fulfill({json: {path: externalPath, name: 'upstream-imagegen.zip', kind: 'file', size: bytes.length}});
    } else if (url.pathname.endsWith('/raw')) {
      reads.push('linked-download');
      await route.fulfill({contentType: 'application/zip', body: bytes});
    } else { reads.push('unexpected-preview'); await route.fulfill({status: 500}); }
  });
  await page.goto('/threads/thread-1');
  const before = page.url();
  for (const [index, label, filename] of [
    [0, 'Download linked archive', 'upstream-imagegen.zip'],
    [1, 'Download workspace archive', 'bundle.zip'],
  ] as const) {
    await page.getByRole('link', {name: label, exact: true}).click();
    const panel = page.locator('.thread-graph-download-preview');
    await expect(panel).toBeVisible();
    await expect(panel.getByText(filename, {exact: true})).toBeVisible();
    await expect(page.getByRole('textbox', {name: 'Workspace file editor'})).toHaveCount(0);
    expect(reads).toHaveLength(index);
    const downloadPromise = page.waitForEvent('download');
    await panel.getByRole('button', {name: `Download ${filename}`, exact: true}).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(filename);
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks)).toEqual(bytes);
    expect(page.url()).toBe(before);
    if (index === 0) {
      await page.screenshot({path: testInfo.outputPath('archive-download.png')});
      await page.getByRole('button', {name: testInfo.project.name === 'mobile-chromium' ? 'Show chat' : 'Collapse workspace', exact: true}).first().click();
    }
  }
  expect(reads).toEqual(['linked-download', 'workspace-download']);
});
