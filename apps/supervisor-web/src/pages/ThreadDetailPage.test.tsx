import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const shellPanelMock = vi.hoisted(() => ({
  toggleConnection: vi.fn(async () => undefined),
  sendInput: vi.fn(() => true),
  sendCommand: vi.fn(() => true),
  sendControl: vi.fn(() => true),
  copyLastCommandOutput: vi.fn(async () => true),
  terminate: vi.fn(async () => undefined),
  focus: vi.fn(() => undefined),
  refreshLayout: vi.fn(() => undefined),
  status: 'detached' as const,
  shellInputEnabled: true,
  isConnecting: false,
  mounts: 0,
  unmounts: 0,
}));
const timelineRenderMock = vi.hoisted(() => ({
  render: vi.fn(),
}));

vi.mock('@remote-codex/thread-ui', async () => {
  const React = await import('react');
  const actual = await vi.importActual<typeof import('@remote-codex/thread-ui')>(
    '@remote-codex/thread-ui',
  );

  const ThreadShellPanel = React.forwardRef(function MockThreadShellPanel(
    props: {
      onStateChange?: (state: {
        status: 'detached' | 'attached';
        connectionButtonDisabled: boolean;
        connectionButtonLabel: string;
        shellInputEnabled: boolean;
        isConnecting: boolean;
        isCommandRunning: boolean;
        promptLabel: string | null;
        isMobileShell: boolean;
        hasShell: boolean;
        busy: boolean;
        loading: boolean;
        error: string | null;
      }) => void;
    },
    ref: React.ForwardedRef<unknown>,
  ) {
    const { onStateChange } = props;

    React.useImperativeHandle(ref, () => ({
      toggleConnection: shellPanelMock.toggleConnection,
      sendInput: shellPanelMock.sendInput,
      sendCommand: shellPanelMock.sendCommand,
        sendControl: shellPanelMock.sendControl,
        copyLastCommandOutput: shellPanelMock.copyLastCommandOutput,
        terminate: shellPanelMock.terminate,
        focus: shellPanelMock.focus,
        refreshLayout: shellPanelMock.refreshLayout,
      }));

      React.useEffect(() => {
      onStateChange?.({
        status: shellPanelMock.status,
        connectionButtonDisabled: false,
        connectionButtonLabel: 'Connect shell',
        shellInputEnabled: shellPanelMock.shellInputEnabled,
        isConnecting: shellPanelMock.isConnecting,
        isCommandRunning: false,
        promptLabel: '(base) trading-lab',
        isMobileShell: false,
        hasShell: true,
        busy: false,
        loading: false,
        error: null,
        });
      }, [onStateChange]);

      React.useEffect(() => {
        shellPanelMock.mounts += 1;
        return () => {
          shellPanelMock.unmounts += 1;
        };
      }, []);

      return <div data-testid="mock-thread-shell-panel" />;
  });

  type ThreadTimelineProps = React.ComponentProps<typeof actual.ThreadTimeline>;

  const ThreadTimeline = React.memo(function MockThreadTimeline(
    props: ThreadTimelineProps,
  ) {
    timelineRenderMock.render();
    return <actual.ThreadTimeline {...props} />;
  });

  return {
    ...actual,
    ThreadShellPanel,
    ThreadTimeline,
    usePlugins: () => ({
      plugins: [
        {
          id: 'remote-codex.terminal',
          enabled: true,
          capabilities: {
            artifactTypes: [],
            timelineRenderers: [],
            threadPanels: [
              {
                id: 'terminal',
                label: 'Terminal',
                kind: 'terminal',
                artifactTypes: [],
              },
            ],
          },
        },
      ],
      getThreadPanels: () => [
        {
          id: 'terminal',
          label: 'Terminal',
          kind: 'terminal',
        },
      ],
    }),
  };
});

import { ThreadDetailPage } from './ThreadDetailPage';

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];

  private readonly observed = new Set<Element>();

  constructor(
    private readonly callback: IntersectionObserverCallback,
    public readonly options?: IntersectionObserverInit,
  ) {
    FakeIntersectionObserver.instances.push(this);
  }

  observe(target: Element) {
    this.observed.add(target);
  }

  unobserve(target: Element) {
    this.observed.delete(target);
  }

  disconnect() {
    this.observed.clear();
  }

  takeRecords() {
    return [];
  }

  triggerAll(isIntersecting = true) {
    const entries = Array.from(this.observed).map((target) => ({
      isIntersecting,
      target,
      boundingClientRect: {} as DOMRectReadOnly,
      intersectionRatio: isIntersecting ? 1 : 0,
      intersectionRect: {} as DOMRectReadOnly,
      rootBounds: null,
      time: 0,
    })) as IntersectionObserverEntry[];

    if (entries.length > 0) {
      this.callback(entries, this as unknown as IntersectionObserver);
    }
  }

  static triggerAll(isIntersecting = true) {
    FakeIntersectionObserver.instances.forEach((instance) =>
      instance.triggerAll(isIntersecting),
    );
  }

  static reset() {
    FakeIntersectionObserver.instances = [];
  }
}

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  listeners = new Map<string, ((event: Event | MessageEvent) => void)[]>();
  sentMessages: string[] = [];
  readyState = 0;

  constructor(url: string) {
    void url;
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (event: Event | MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  send(message: string) {
    this.sentMessages.push(message);
  }

  close() {
    this.readyState = 3;
  }
}

function emitSocketMessage(socket: FakeWebSocket, payload: unknown) {
  const message = { data: JSON.stringify(payload) } as MessageEvent;
  for (const listener of socket.listeners.get('message') ?? []) {
    listener(message);
  }
}

function emitSocketEvent(socket: FakeWebSocket, type: string) {
  if (type === 'open') {
    socket.readyState = 1;
  } else if (type === 'close') {
    socket.readyState = 3;
  }
  const event = { type } as Event;
  for (const listener of socket.listeners.get(type) ?? []) {
    listener(event);
  }
}

function okJsonResponse(payload: unknown) {
  return Promise.resolve({
    ok: true,
    headers: new Headers(),
    json: async () => payload,
  });
}

function okBlobResponse(payload: Blob, headers: Record<string, string> = {}) {
  return Promise.resolve({
    ok: true,
    headers: new Headers(headers),
    blob: async () => payload,
  });
}

function healthzPayload() {
  return {
    status: 'ok' as const,
    timestamp: new Date().toISOString(),
  };
}

function withHealthz(
  handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<unknown> | unknown,
) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/healthz')) {
      return okJsonResponse(healthzPayload());
    }

    return handler(input, init);
  });
}

function setPromptValue(element: HTMLElement, value: string) {
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    fireEvent.change(element, {
      target: { value },
    });
    return;
  }

  element.textContent = value;
  fireEvent.input(element);
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

const modelOptionsResponse = [
  {
    id: 'model-option-1',
    model: 'gpt-5',
    displayName: 'GPT-5',
    description: 'Default test model',
    hidden: false,
    isDefault: true,
    supportedReasoningEfforts: [
      {
        reasoningEffort: 'medium',
        description: 'Balanced'
      }
    ],
    defaultReasoningEffort: 'medium'
  },
  {
    id: 'model-option-2',
    model: 'gpt-5.4',
    displayName: 'GPT-5.4',
    description: 'Imported session model',
    hidden: false,
    isDefault: false,
    supportedReasoningEfforts: [
      {
        reasoningEffort: 'medium',
        description: 'Balanced'
      },
      {
        reasoningEffort: 'high',
        description: 'Deeper reasoning'
      }
    ],
    defaultReasoningEffort: 'medium'
  }
];

const codexBackendResponse = {
  provider: 'codex',
  displayName: 'Codex',
  description: 'Local Codex app-server runtime.',
  enabled: true,
  isDefault: true,
  status: {
    state: 'ready',
    transport: 'stdio',
    lastStartedAt: new Date().toISOString(),
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
};

const claudeBackendResponse = {
  provider: 'claude',
  displayName: 'Claude',
  description: 'Local Claude Code Agent SDK runtime.',
  enabled: true,
  isDefault: false,
  status: {
    state: 'ready',
    transport: 'sdk',
    lastStartedAt: new Date().toISOString(),
    lastError: null,
    restartCount: 0,
  },
  capabilities: {
    sessions: { list: true, read: true, resume: true, importLocal: false },
    turns: { start: true, streamInput: false, steer: false, interrupt: true, compact: false },
    branching: { fork: false, hardRollback: false, resumeAt: false, rewindFiles: false },
    controls: {
      planMode: false,
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
    toolboxItems: [
      { action: 'mcp', command: '/mcp', label: 'MCP', panel: 'mcp' },
    ],
    hookCommandTemplates: [],
    providerConfigFormat: 'none',
    mcpConfigFormat: 'none',
    configArchives: false,
    buildRestart: false,
  },
};

const claudeModelOptionsResponse = [
  {
    id: 'sonnet',
    model: 'sonnet',
    displayName: 'Claude Sonnet',
    description: 'Claude Code default Sonnet model alias.',
    hidden: false,
    isDefault: true,
    supportedReasoningEfforts: [
      {
        reasoningEffort: 'medium',
        description: 'Balanced',
      },
    ],
    defaultReasoningEffort: 'medium',
  },
];

describe('ThreadDetailPage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    FakeWebSocket.instances = [];
    FakeIntersectionObserver.reset();
    shellPanelMock.toggleConnection.mockClear();
    shellPanelMock.sendInput.mockClear();
    shellPanelMock.sendCommand.mockClear();
    shellPanelMock.sendControl.mockClear();
    shellPanelMock.copyLastCommandOutput.mockClear();
    shellPanelMock.terminate.mockClear();
    shellPanelMock.focus.mockClear();
    shellPanelMock.refreshLayout.mockClear();
    shellPanelMock.status = 'detached';
    shellPanelMock.shellInputEnabled = true;
    shellPanelMock.isConnecting = false;
    shellPanelMock.mounts = 0;
    shellPanelMock.unmounts = 0;
    timelineRenderMock.render.mockClear();
    vi.stubGlobal('WebSocket', FakeWebSocket as any);
    vi.stubGlobal(
      'IntersectionObserver',
      FakeIntersectionObserver as unknown as typeof IntersectionObserver,
    );
    vi.stubGlobal(
      'fetch',
      withHealthz((input: RequestInfo | URL, init?: RequestInit) => {
        void init;
        const url = String(input);

        if (url.includes('/api/agent-runtimes/codex/status')) {
          return okJsonResponse(codexBackendResponse);
        }

        if (url.includes('/api/agent-runtimes/codex/models')) {
          return okJsonResponse(modelOptionsResponse);
        }

        if (url.includes('/api/agent-runtimes/codex/status')) {
          return okJsonResponse({
            state: 'ready',
            transport: 'stdio',
            lastStartedAt: new Date().toISOString(),
            lastError: null,
            restartCount: 0,
          });
        }

        if (url.includes('/api/agent-runtimes/codex/models')) {
          return okJsonResponse(modelOptionsResponse);
        }

        if (url.endsWith('/api/threads/thread-1/prompt') && init?.method === 'POST') {
          return okJsonResponse({
            id: 'thread-1',
            workspaceId: 'workspace-1',
            providerSessionId: 'codex-1',
            source: 'supervisor',
            title: 'Demo Thread',
            model: 'gpt-5',
            reasoningEffort: 'medium',
            collaborationMode: 'default',
            approvalMode: 'yolo',
            status: 'running',
            summaryText: 'Please inspect [FILE ./.temp/threads/thread-1/notes.txt]',
            lastError: null,
            activeTurnId: 'turn-2',
            isLoaded: true,
            isPinned: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            lastTurnStartedAt: new Date().toISOString(),
            lastTurnCompletedAt: null,
          });
        }

        if (url.endsWith('/api/threads/thread-1/export-turns')) {
          return okJsonResponse({
            totalTurnCount: 2,
            turns: [
              {
                turnId: 'turn-2',
                turnNumber: 2,
                startedAt: new Date().toISOString(),
                status: 'completed',
                userPromptPreview: 'Second prompt preview'
              },
              {
                turnId: 'turn-1',
                turnNumber: 1,
                startedAt: new Date().toISOString(),
                status: 'completed',
                userPromptPreview: 'hello'
              }
            ]
          });
        }

        if (url.endsWith('/api/threads/thread-2') && init?.method === 'DELETE') {
          return okJsonResponse({ id: 'thread-2' });
        }

        if (url.startsWith('/api/threads/thread-1?') || url.endsWith('/api/threads/thread-1')) {
          return okJsonResponse({
            thread: {
              id: 'thread-1',
              workspaceId: 'workspace-1',
              providerSessionId: 'codex-1',
              source: 'supervisor',
              title: 'Demo Thread',
              model: 'gpt-5',
              reasoningEffort: 'medium',
              collaborationMode: 'default',
              approvalMode: 'yolo',
              status: 'idle',
              summaryText: 'Preview',
              lastError: null,
              activeTurnId: null,
              isLoaded: true,
              isPinned: false,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              lastTurnStartedAt: null,
              lastTurnCompletedAt: null,
            },
            workspace: {
              id: 'workspace-1',
              hostId: 'host-1',
              label: 'Demo Workspace',
              absPath: '/tmp/demo',
              isFavorite: false,
              createdAt: new Date().toISOString(),
              lastOpenedAt: null,
            },
            workspacePathStatus: 'present',
            pendingRequests: [],
            turns: [
              {
                id: 'turn-1',
                startedAt: new Date().toISOString(),
                status: 'completed',
                error: null,
                items: [
                  {
                    id: 'item-1',
                    kind: 'userMessage',
                    text: 'hello',
                  },
                ],
              },
            ],
          });
        }

        if (url.endsWith('/api/threads')) {
          return Promise.resolve({
            ok: true,
            json: async () => [
              {
                id: 'thread-1',
                workspaceId: 'workspace-1',
                providerSessionId: 'codex-1',
                source: 'supervisor',
                title: 'Demo Thread',
                model: 'gpt-5',
                reasoningEffort: 'medium',
                collaborationMode: 'default',
                approvalMode: 'yolo',
                status: 'idle',
                summaryText: 'Preview',
                lastError: null,
                activeTurnId: null,
                isLoaded: true,
                isPinned: false,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                lastTurnStartedAt: null,
                lastTurnCompletedAt: null,
              },
              {
                id: 'thread-2',
                workspaceId: 'workspace-1',
                providerSessionId: 'codex-2',
                source: 'supervisor',
                title: 'Sibling Thread',
                model: 'gpt-5-mini',
                reasoningEffort: 'medium',
                collaborationMode: 'default',
                approvalMode: 'guarded',
                status: 'running',
                summaryText: null,
                lastError: null,
                activeTurnId: 'turn-2',
                isLoaded: true,
                isPinned: false,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                lastTurnStartedAt: new Date().toISOString(),
                lastTurnCompletedAt: null,
              },
              {
                id: 'thread-3',
                workspaceId: 'workspace-2',
                providerSessionId: 'codex-3',
                source: 'supervisor',
                title: 'Other Workspace Thread',
                model: 'gpt-5-nano',
                reasoningEffort: 'medium',
                collaborationMode: 'default',
                approvalMode: 'yolo',
                status: 'idle',
                summaryText: null,
                lastError: null,
                activeTurnId: null,
                isLoaded: true,
                isPinned: false,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                lastTurnStartedAt: null,
                lastTurnCompletedAt: null,
              },
            ],
          });
        }

        return Promise.reject(new Error(`Unexpected request: ${url}`));
      }),
    );
  });

  it('keeps meta open by default and only lists threads from the current workspace', async () => {
    render(
      <MemoryRouter initialEntries={['/threads/thread-1']}>
        <Routes>
          <Route path="/threads/:id" element={<ThreadDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(
        screen.getAllByText('Demo Workspace / Demo Thread').length,
      ).toBeGreaterThan(0);
    });

    expect(screen.getByText('Sibling Thread')).toBeInTheDocument();
    expect(
      screen.queryByText('Other Workspace Thread'),
    ).not.toBeInTheDocument();
    expect(screen.getByText('/tmp/demo')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Copy session ID' }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Thread Meta/i }));

    expect(screen.queryByText('/tmp/demo')).not.toBeInTheDocument();
  });

  it('prioritizes thread detail before loading page context', async () => {
    const detailResponse = {
      thread: {
        id: 'thread-1',
        workspaceId: 'workspace-1',
        provider: 'codex',
        providerSessionId: 'codex-1',
        source: 'supervisor',
        title: 'Demo Thread',
        model: 'gpt-5',
        reasoningEffort: 'medium',
        collaborationMode: 'default',
        approvalMode: 'yolo',
        status: 'idle',
        summaryText: 'Preview',
        lastError: null,
        activeTurnId: null,
        isLoaded: true,
        isPinned: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastTurnStartedAt: null,
        lastTurnCompletedAt: null,
      },
      workspace: {
        id: 'workspace-1',
        hostId: 'host-1',
        label: 'Demo Workspace',
        absPath: '/tmp/demo',
        isFavorite: false,
        createdAt: new Date().toISOString(),
        lastOpenedAt: null,
      },
      workspacePathStatus: 'present',
      pendingRequests: [],
      totalTurnCount: 1,
      turns: [
        {
          id: 'turn-1',
          startedAt: new Date().toISOString(),
          status: 'completed',
          error: null,
          items: [
            {
              id: 'item-1',
              kind: 'userMessage',
              text: 'hello',
            },
          ],
        },
      ],
    };
    const detailDeferred =
      createDeferred<ReturnType<typeof okJsonResponse>>();
    const requestedUrls: string[] = [];
    vi.stubGlobal(
      'fetch',
      withHealthz((input: RequestInfo | URL) => {
        const url = String(input);
        requestedUrls.push(url);

        if (url.startsWith('/api/threads/thread-1?') || url.endsWith('/api/threads/thread-1')) {
          return detailDeferred.promise;
        }

        if (url.endsWith('/api/threads')) {
          return okJsonResponse([detailResponse.thread]);
        }

        if (url.includes('/api/agent-runtimes/codex/status')) {
          return okJsonResponse(codexBackendResponse);
        }

        if (url.includes('/api/agent-runtimes/codex/models')) {
          return okJsonResponse(modelOptionsResponse);
        }

        return Promise.reject(new Error(`Unexpected request: ${url}`));
      }),
    );

    render(
      <MemoryRouter initialEntries={['/threads/thread-1']}>
        <Routes>
          <Route path="/threads/:id" element={<ThreadDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(requestedUrls).toContain('/api/threads/thread-1?limit=3');
    });

    expect(requestedUrls).not.toContain('/api/threads');
    expect(
      requestedUrls.some((url) => url.includes('/api/agent-runtimes/codex/status')),
    ).toBe(false);
    expect(
      requestedUrls.some((url) => url.includes('/api/agent-runtimes/codex/models')),
    ).toBe(false);

    detailDeferred.resolve(okJsonResponse(detailResponse));

    await screen.findByText('hello');
    await waitFor(() => {
      expect(requestedUrls).toContain('/api/threads');
      expect(
        requestedUrls.some((url) => url.includes('/api/agent-runtimes/codex/status')),
      ).toBe(true);
      expect(
        requestedUrls.some((url) => url.includes('/api/agent-runtimes/codex/models')),
      ).toBe(true);
    });
  });

  it('does not re-render the timeline when typing in the chat composer', async () => {
    render(
      <MemoryRouter initialEntries={['/threads/thread-1']}>
        <Routes>
          <Route path="/threads/:id" element={<ThreadDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText('hello');
    const initialTimelineRenderCount = timelineRenderMock.render.mock.calls.length;
    expect(initialTimelineRenderCount).toBeGreaterThan(0);

    setPromptValue(screen.getByRole('textbox', { name: 'Prompt' }), 'draft input');

    expect(timelineRenderMock.render.mock.calls.length).toBe(
      initialTimelineRenderCount,
    );
  });

  it('deletes a sibling thread from the detail sidebar after confirmation', async () => {
    render(
      <MemoryRouter initialEntries={['/threads/thread-1']}>
        <Routes>
          <Route path="/threads/:id" element={<ThreadDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText('Sibling Thread');
    fireEvent.click(screen.getByRole('button', { name: 'Delete thread Sibling Thread' }));

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: 'Delete Thread' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Delete Thread' }));

    await waitFor(() => {
      const deleteCall = vi.mocked(fetch).mock.calls.find(
        ([input, init]) =>
          String(input).endsWith('/api/threads/thread-2') &&
          init?.method === 'DELETE',
      );
      expect(deleteCall).toBeDefined();
    });

    await waitFor(() => {
      expect(screen.queryByText('Sibling Thread')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Demo Thread')).toBeInTheDocument();
  });

  it('reloads backend controls for a directly opened Claude thread', async () => {
    const backendRequests: string[] = [];
    vi.stubGlobal(
      'fetch',
      withHealthz((input: RequestInfo | URL) => {
        const url = String(input);

        if (url.includes('/api/agent-runtimes/')) {
          backendRequests.push(url);
        }

        if (url.includes('/api/agent-runtimes/codex/status')) {
          return okJsonResponse(codexBackendResponse);
        }

        if (url.includes('/api/agent-runtimes/codex/models')) {
          return okJsonResponse(modelOptionsResponse);
        }

        if (url.includes('/api/agent-runtimes/claude/status')) {
          return okJsonResponse(claudeBackendResponse);
        }

        if (url.includes('/api/agent-runtimes/claude/models')) {
          return okJsonResponse(claudeModelOptionsResponse);
        }

        if (url.endsWith('/api/threads')) {
          return okJsonResponse([
            {
              id: 'claude-thread-1',
              workspaceId: 'workspace-1',
              provider: 'claude',
              providerSessionId: 'claude-session-1',
              source: 'supervisor',
              title: 'Claude Thread',
              model: 'sonnet',
              reasoningEffort: 'medium',
              collaborationMode: 'default',
              approvalMode: 'yolo',
              status: 'idle',
              summaryText: 'Claude preview',
              lastError: null,
              activeTurnId: null,
              isLoaded: true,
              isPinned: false,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              lastTurnStartedAt: null,
              lastTurnCompletedAt: null,
            },
          ]);
        }

        if (
          url.startsWith('/api/threads/claude-thread-1?') ||
          url.endsWith('/api/threads/claude-thread-1')
        ) {
          return okJsonResponse({
            thread: {
              id: 'claude-thread-1',
              workspaceId: 'workspace-1',
              provider: 'claude',
              providerSessionId: 'claude-session-1',
              source: 'supervisor',
              title: 'Claude Thread',
              model: 'sonnet',
              reasoningEffort: 'medium',
              collaborationMode: 'default',
              approvalMode: 'yolo',
              status: 'idle',
              summaryText: 'Claude preview',
              lastError: null,
              activeTurnId: null,
              isLoaded: true,
              isPinned: false,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              lastTurnStartedAt: null,
              lastTurnCompletedAt: null,
            },
            workspace: {
              id: 'workspace-1',
              hostId: 'host-1',
              label: 'Demo Workspace',
              absPath: '/tmp/demo',
              isFavorite: false,
              createdAt: new Date().toISOString(),
              lastOpenedAt: null,
            },
            workspacePathStatus: 'present',
            pendingRequests: [],
            turns: [
              {
                id: 'turn-1',
                startedAt: new Date().toISOString(),
                status: 'completed',
                error: null,
                items: [
                  {
                    id: 'item-1',
                    kind: 'agentMessage',
                    text: 'Hello from Claude',
                  },
                ],
              },
            ],
          });
        }

        return Promise.reject(new Error(`Unexpected request: ${url}`));
      }),
    );

    render(
      <MemoryRouter initialEntries={['/threads/claude-thread-1']}>
        <Routes>
          <Route path="/threads/:id" element={<ThreadDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText('Hello from Claude');

    await waitFor(() => {
      expect(
        backendRequests.some((url) => url.includes('/api/agent-runtimes/claude/status')),
      ).toBe(true);
      expect(
        backendRequests.some((url) => url.includes('/api/agent-runtimes/claude/models')),
      ).toBe(true);
    });

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Plan' })).not.toBeInTheDocument();
      expect(screen.getByText('Settings')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /\/fast/i })).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Settings').closest('button')!);
    expect(screen.getByText('Sandbox Mode')).toBeInTheDocument();
  });

  it('opens transcript export selection and starts a native PDF download', async () => {
    const downloads: Array<{ href: string; filename: string }> = [];
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      const element = originalCreateElement(tagName);
      if (tagName.toLowerCase() === 'a') {
        vi.spyOn(element, 'click').mockImplementation(() => {
          downloads.push({
            href: (element as HTMLAnchorElement).href,
            filename: (element as HTMLAnchorElement).download,
          });
        });
      }
      return element;
    });
    const exportRequests: string[] = [];

    vi.stubGlobal(
      'fetch',
      withHealthz((input: RequestInfo | URL, init?: RequestInit) => {
        void init;
        const url = String(input);

        if (url.includes('/api/agent-runtimes/codex/status')) {
          return okJsonResponse(codexBackendResponse);
        }

        if (url.includes('/api/agent-runtimes/codex/models')) {
          return okJsonResponse(modelOptionsResponse);
        }

        if (url.includes('/api/agent-runtimes/codex/status')) {
          return okJsonResponse({
            state: 'ready',
            transport: 'stdio',
            lastStartedAt: new Date().toISOString(),
            lastError: null,
            restartCount: 0,
          });
        }
        if (url.includes('/api/agent-runtimes/codex/models')) {
          return okJsonResponse(modelOptionsResponse);
        }
        if (url.endsWith('/api/threads')) {
          return okJsonResponse([]);
        }
        if (url.endsWith('/api/threads/thread-1/export-turns')) {
          return okJsonResponse({
            totalTurnCount: 2,
            turns: [
              {
                turnId: 'turn-2',
                turnNumber: 2,
                startedAt: '2026-05-17T12:00:00.000Z',
                status: 'completed',
                userPromptPreview: 'Second prompt preview',
              },
              {
                turnId: 'turn-1',
                turnNumber: 1,
                startedAt: '2026-05-17T11:00:00.000Z',
                status: 'completed',
                userPromptPreview: 'hello',
              },
            ],
          });
        }
        if (url.includes('/api/threads/thread-1/exports/pdf?')) {
          exportRequests.push(url);
          return okBlobResponse(new Blob(['%PDF-1.4'], { type: 'application/pdf' }), {
            'content-disposition': 'attachment; filename="remote-codex-demo.pdf"',
          });
        }
        if (url.startsWith('/api/threads/thread-1?') || url.endsWith('/api/threads/thread-1')) {
          return okJsonResponse({
            thread: {
              id: 'thread-1',
              workspaceId: 'workspace-1',
              providerSessionId: 'codex-1',
              source: 'supervisor',
              title: 'Demo Thread',
              model: 'gpt-5',
              reasoningEffort: 'medium',
              collaborationMode: 'default',
              approvalMode: 'yolo',
              status: 'idle',
              summaryText: 'Preview',
              lastError: null,
              activeTurnId: null,
              isLoaded: true,
              isPinned: false,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              lastTurnStartedAt: null,
              lastTurnCompletedAt: null,
            },
            workspace: {
              id: 'workspace-1',
              hostId: 'host-1',
              label: 'Demo Workspace',
              absPath: '/tmp/demo',
              isFavorite: false,
              createdAt: new Date().toISOString(),
              lastOpenedAt: null,
            },
            workspacePathStatus: 'present',
            pendingRequests: [],
            pendingSteers: [],
            turns: [
              {
                id: 'turn-1',
                startedAt: new Date().toISOString(),
                status: 'completed',
                error: null,
                items: [
                  {
                    id: 'item-1',
                    kind: 'userMessage',
                    text: 'hello',
                  },
                ],
              },
            ],
          });
        }

        return Promise.reject(new Error(`Unexpected request: ${url}`));
      }),
    );

    render(
      <MemoryRouter initialEntries={['/threads/thread-1']}>
        <Routes>
          <Route path="/threads/:id" element={<ThreadDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Export transcript' }).length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getAllByRole('button', { name: 'Export transcript' })[0]!);
    await screen.findByRole('dialog', { name: 'Export transcript' });
    fireEvent.click(screen.getByRole('button', { name: 'Custom selection' }));
    await screen.findByText('Second prompt preview');
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    fireEvent.click(screen.getByText('Second prompt preview'));
    fireEvent.click(screen.getByRole('button', { name: 'Export PDF' }));

    await waitFor(() => {
      expect(downloads).toHaveLength(1);
    });
    expect(downloads[0]!.href).toContain('blob:');
    expect(downloads[0]!.filename).toBe('remote-codex-demo.pdf');
    expect(exportRequests).toHaveLength(1);
    expect(exportRequests[0]).toContain('/api/threads/thread-1/exports/pdf?');
    expect(exportRequests[0]).toContain('mode=selected');
    expect(exportRequests[0]).toContain('turnIds=turn-2');
    expect(exportRequests[0]).toContain('includeTokenAndPrice=true');
    expect(exportRequests[0]).not.toContain('includeCommandOutput');
    expect(exportRequests[0]).not.toContain('includeAbsolutePaths');
  });

  it('exports selected turns as standalone HTML when requested', async () => {
    const downloads: Array<{ href: string; filename: string }> = [];
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      const element = originalCreateElement(tagName);
      if (tagName.toLowerCase() === 'a') {
        vi.spyOn(element, 'click').mockImplementation(() => {
          downloads.push({
            href: (element as HTMLAnchorElement).href,
            filename: (element as HTMLAnchorElement).download,
          });
        });
      }
      return element;
    });
    const exportRequests: string[] = [];

    vi.stubGlobal(
      'fetch',
      withHealthz((input: RequestInfo | URL) => {
        const url = String(input);

        if (url.includes('/api/agent-runtimes/codex/status')) {
          return okJsonResponse(codexBackendResponse);
        }

        if (url.includes('/api/agent-runtimes/codex/models')) {
          return okJsonResponse(modelOptionsResponse);
        }

        if (url.includes('/api/agent-runtimes/codex/status')) {
          return okJsonResponse({
            state: 'ready',
            transport: 'stdio',
            lastStartedAt: new Date().toISOString(),
            lastError: null,
            restartCount: 0,
          });
        }
        if (url.includes('/api/agent-runtimes/codex/models')) {
          return okJsonResponse(modelOptionsResponse);
        }
        if (url.endsWith('/api/threads')) {
          return okJsonResponse([]);
        }
        if (url.endsWith('/api/threads/thread-1/export-turns')) {
          return okJsonResponse({
            totalTurnCount: 1,
            turns: [
              {
                turnId: 'turn-1',
                turnNumber: 1,
                startedAt: '2026-05-17T11:00:00.000Z',
                status: 'completed',
                userPromptPreview: 'hello',
              },
            ],
          });
        }
        if (url.includes('/api/threads/thread-1/exports/pdf?')) {
          exportRequests.push(url);
          return okBlobResponse(new Blob(['<!doctype html>'], { type: 'text/html' }), {
            'content-disposition': 'attachment; filename="remote-codex-demo.html"',
          });
        }
        if (url.startsWith('/api/threads/thread-1?') || url.endsWith('/api/threads/thread-1')) {
          return okJsonResponse({
            thread: {
              id: 'thread-1',
              workspaceId: 'workspace-1',
              providerSessionId: 'codex-1',
              source: 'supervisor',
              title: 'Demo Thread',
              model: 'gpt-5',
              reasoningEffort: 'medium',
              collaborationMode: 'default',
              approvalMode: 'yolo',
              status: 'idle',
              summaryText: 'Preview',
              lastError: null,
              activeTurnId: null,
              isLoaded: true,
              isPinned: false,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              lastTurnStartedAt: null,
              lastTurnCompletedAt: null,
            },
            workspace: {
              id: 'workspace-1',
              hostId: 'host-1',
              label: 'Demo Workspace',
              absPath: '/tmp/demo',
              isFavorite: false,
              createdAt: new Date().toISOString(),
              lastOpenedAt: null,
            },
            workspacePathStatus: 'present',
            pendingRequests: [],
            pendingSteers: [],
            turns: [],
          });
        }

        return Promise.reject(new Error(`Unexpected request: ${url}`));
      }),
    );

    render(
      <MemoryRouter initialEntries={['/threads/thread-1']}>
        <Routes>
          <Route path="/threads/:id" element={<ThreadDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Export transcript' }).length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getAllByRole('button', { name: 'Export transcript' })[0]!);
    await screen.findByRole('dialog', { name: 'Export transcript' });
    fireEvent.click(screen.getByRole('button', { name: 'HTML' }));
    fireEvent.click(screen.getByRole('button', { name: 'Export HTML' }));

    await waitFor(() => {
      expect(downloads).toHaveLength(1);
    });
    expect(downloads[0]!.filename).toBe('remote-codex-demo.html');
    expect(exportRequests).toHaveLength(1);
    expect(exportRequests[0]).toContain('format=html');
    expect(exportRequests[0]).toContain('mode=latest');
    expect(exportRequests[0]).toContain('limit=10');
  });

  it('keeps the shell panel mounted across chat and shell view switches', async () => {
    render(
      <MemoryRouter initialEntries={['/threads/thread-1']}>
        <Routes>
          <Route path="/threads/:id" element={<ThreadDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(
        screen.getAllByText('Demo Workspace / Demo Thread').length,
      ).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Switch to shell' }));
    await waitFor(() => {
      expect(screen.getByTestId('mock-thread-shell-panel')).toBeInTheDocument();
    });

    expect(shellPanelMock.mounts).toBe(1);
    expect(shellPanelMock.unmounts).toBe(0);

    fireEvent.click(screen.getAllByRole('button', { name: 'Switch to chat' })[0]!);
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Switch to shell' }),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getAllByRole('button', { name: 'Switch to shell' })[0]!);
    await waitFor(() => {
      expect(screen.getByTestId('mock-thread-shell-panel')).toBeInTheDocument();
    });

    expect(shellPanelMock.mounts).toBe(1);
    expect(shellPanelMock.unmounts).toBe(0);
  });

  it('renders thread detail without waiting for background thread list and model context', async () => {
    vi.stubGlobal(
      'fetch',
      withHealthz((input: RequestInfo | URL) => {
        const url = String(input);

        if (
          url.endsWith('/api/threads') ||
          url.includes('/api/agent-runtimes/codex/status') ||
          url.includes('/api/agent-runtimes/codex/models')
        ) {
          return new Promise(() => undefined);
        }

        if (url.startsWith('/api/threads/thread-1?') || url.endsWith('/api/threads/thread-1')) {
          return okJsonResponse({
            thread: {
              id: 'thread-1',
              workspaceId: 'workspace-1',
              providerSessionId: 'codex-1',
              source: 'supervisor',
              title: 'Demo Thread',
              model: 'gpt-5',
              reasoningEffort: 'medium',
              collaborationMode: 'default',
              approvalMode: 'yolo',
              status: 'idle',
              summaryText: 'Preview',
              lastError: null,
              activeTurnId: null,
              isLoaded: true,
              isPinned: false,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              lastTurnStartedAt: null,
              lastTurnCompletedAt: null,
            },
            workspace: {
              id: 'workspace-1',
              hostId: 'host-1',
              label: 'Demo Workspace',
              absPath: '/tmp/demo',
              isFavorite: false,
              createdAt: new Date().toISOString(),
              lastOpenedAt: null,
            },
            workspacePathStatus: 'present',
            pendingRequests: [],
            turns: [
              {
                id: 'turn-1',
                startedAt: new Date().toISOString(),
                status: 'completed',
                error: null,
                items: [
                  {
                    id: 'item-1',
                    kind: 'userMessage',
                    text: 'hello',
                  },
                ],
              },
            ],
          });
        }

        return Promise.reject(new Error(`Unexpected request: ${url}`));
      }),
    );

    render(
      <MemoryRouter initialEntries={['/threads/thread-1']}>
        <Routes>
          <Route path="/threads/:id" element={<ThreadDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('hello')).toBeInTheDocument();
    });

    expect(screen.queryByText('Loading thread detail...')).not.toBeInTheDocument();
    expect(screen.getByTitle('Demo Thread')).toBeInTheDocument();
    expect(screen.queryByText('No threads available in this view.')).not.toBeInTheDocument();
  });

  it('loads three latest turns first, auto-loads one earlier page on upward scroll, then requires manual loading', async () => {
    const allTurns = Array.from({ length: 15 }, (_, index) => ({
      id: `turn-${index + 1}`,
      startedAt: new Date(Date.UTC(2026, 3, 10, 0, index, 0)).toISOString(),
      status: 'completed' as const,
      error: null,
      items: [
        {
          id: `item-${index + 1}`,
          kind: 'userMessage' as const,
          text: `Prompt ${index + 1}`,
        },
      ],
    }));

    const detailUrls: string[] = [];
    vi.stubGlobal(
      'fetch',
      withHealthz((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url.includes('/api/agent-runtimes/codex/status')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              state: 'ready',
              transport: 'stdio',
              lastStartedAt: new Date().toISOString(),
              lastError: null,
              restartCount: 0,
            }),
          });
        }

        if (url.includes('/api/agent-runtimes/codex/models')) {
          return Promise.resolve({
            ok: true,
            json: async () => modelOptionsResponse,
          });
        }

        if (url.startsWith('/api/threads/thread-1?') || url.endsWith('/api/threads/thread-1')) {
          detailUrls.push(url);
          const requestUrl = new URL(url, 'http://localhost');
          const beforeTurnId = requestUrl.searchParams.get('beforeTurnId');
          const limit = Number(requestUrl.searchParams.get('limit') ?? '10');
          const endExclusive = beforeTurnId
            ? allTurns.findIndex((turn) => turn.id === beforeTurnId)
            : allTurns.length;
          const start = Math.max(0, endExclusive - limit);

          return Promise.resolve({
            ok: true,
            json: async () => ({
              thread: {
                id: 'thread-1',
                workspaceId: 'workspace-1',
                providerSessionId: 'codex-1',
                source: 'supervisor',
                title: 'Demo Thread',
                model: 'gpt-5',
                reasoningEffort: 'medium',
                collaborationMode: 'default',
                approvalMode: 'yolo',
                status: 'idle',
                summaryText: 'Preview',
                lastError: null,
                activeTurnId: null,
                isLoaded: true,
                isPinned: false,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                lastTurnStartedAt: null,
                lastTurnCompletedAt: null,
              },
              workspace: {
                id: 'workspace-1',
                hostId: 'host-1',
                label: 'Demo Workspace',
                absPath: '/tmp/demo',
                isFavorite: false,
                createdAt: new Date().toISOString(),
                lastOpenedAt: null,
              },
              workspacePathStatus: 'present',
              pendingRequests: [],
              totalTurnCount: allTurns.length,
              turns: allTurns.slice(start, endExclusive),
            }),
          });
        }

        if (url.endsWith('/api/threads')) {
          return Promise.resolve({
            ok: true,
            json: async () => [
              {
                id: 'thread-1',
                workspaceId: 'workspace-1',
                providerSessionId: 'codex-1',
                source: 'supervisor',
                title: 'Demo Thread',
                model: 'gpt-5',
                reasoningEffort: 'medium',
                collaborationMode: 'default',
                approvalMode: 'yolo',
                status: 'idle',
                summaryText: 'Preview',
                lastError: null,
                activeTurnId: null,
                isLoaded: true,
                isPinned: false,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                lastTurnStartedAt: null,
                lastTurnCompletedAt: null,
              },
            ],
          });
        }

        if (init?.method === 'POST' || init?.method === 'PATCH' || init?.method === 'DELETE') {
          return Promise.reject(new Error(`Unexpected request: ${url}`));
        }

        return Promise.reject(new Error(`Unexpected request: ${url}`));
      }),
    );

    render(
      <MemoryRouter initialEntries={['/threads/thread-1']}>
        <Routes>
          <Route path="/threads/:id" element={<ThreadDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText(/Showing 3 of 15 turns/)).toBeInTheDocument();
    });

    expect(detailUrls[0]).toContain('/api/threads/thread-1?limit=3');
    expect(screen.queryByText('Prompt 12')).not.toBeInTheDocument();
    expect(screen.getByText('Prompt 15')).toBeInTheDocument();
    expect(detailUrls).toHaveLength(1);

    FakeIntersectionObserver.triggerAll();
    expect(detailUrls).toHaveLength(1);

    fireEvent.scroll(screen.getByTestId('thread-scroll-container'));
    FakeIntersectionObserver.triggerAll();
    expect(detailUrls.some((url) => url.includes('beforeTurnId=turn-13'))).toBe(true);
    await waitFor(() => {
      expect(screen.getByText('Prompt 3')).toBeInTheDocument();
    });
    expect(screen.queryByText('Prompt 2')).not.toBeInTheDocument();
    expect(detailUrls.some((url) => url.includes('beforeTurnId=turn-3'))).toBe(false);

    FakeIntersectionObserver.triggerAll();
    expect(detailUrls.some((url) => url.includes('beforeTurnId=turn-3'))).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Load 10 earlier' }));
    await waitFor(() => {
      expect(screen.getByText('Prompt 1')).toBeInTheDocument();
    });
    expect(detailUrls.some((url) => url.includes('beforeTurnId=turn-3'))).toBe(true);
  });

  it('surfaces imported thread warnings before resume', async () => {
    vi.stubGlobal(
      'fetch',
      withHealthz((input: RequestInfo | URL) => {
        const url = String(input);

        if (url.includes('/api/agent-runtimes/codex/status')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              state: 'ready',
              transport: 'stdio',
              lastStartedAt: new Date().toISOString(),
              lastError: null,
              restartCount: 0,
            }),
          });
        }

        if (url.includes('/api/agent-runtimes/codex/models')) {
          return Promise.resolve({
            ok: true,
            json: async () => modelOptionsResponse,
          });
        }

        if (url.startsWith('/api/threads/imported-thread?') || url.endsWith('/api/threads/imported-thread')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              thread: {
                id: 'imported-thread',
                workspaceId: 'workspace-1',
                providerSessionId: '019d6fb7-7033-7a30-a2c7-74d0919e87d4',
                source: 'local_codex_import',
                title: 'Imported Thread',
                model: 'gpt-5.4',
                reasoningEffort: 'medium',
                collaborationMode: 'default',
                approvalMode: 'yolo',
                status: 'idle',
                summaryText: 'Imported preview',
                lastError: null,
                activeTurnId: null,
                isLoaded: false,
                isPinned: false,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                lastTurnStartedAt: null,
                lastTurnCompletedAt: null,
              },
              workspace: {
                id: 'workspace-1',
                hostId: 'host-1',
                label: 'Imported Workspace',
                absPath: '/tmp/imported-project',
                isFavorite: false,
                createdAt: new Date().toISOString(),
                lastOpenedAt: null,
              },
              workspacePathStatus: 'missing',
              pendingRequests: [],
              turns: [],
            }),
          });
        }

        if (url.endsWith('/api/threads')) {
          return Promise.resolve({
            ok: true,
            json: async () => [
              {
                id: 'imported-thread',
                workspaceId: 'workspace-1',
                providerSessionId: '019d6fb7-7033-7a30-a2c7-74d0919e87d4',
                source: 'local_codex_import',
                title: 'Imported Thread',
                model: 'gpt-5.4',
                reasoningEffort: 'medium',
                collaborationMode: 'default',
                approvalMode: 'yolo',
                status: 'idle',
                summaryText: 'Imported preview',
                lastError: null,
                activeTurnId: null,
                isLoaded: false,
                isPinned: false,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                lastTurnStartedAt: null,
                lastTurnCompletedAt: null,
              },
            ],
          });
        }

        return Promise.reject(new Error(`Unexpected request: ${url}`));
      }),
    );

    render(
      <MemoryRouter initialEntries={['/threads/imported-thread']}>
        <Routes>
          <Route path="/threads/:id" element={<ThreadDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(
        screen.getByText('Imported Thread'),
      ).toBeInTheDocument();
    });

    expect(screen.getByText(/Workspace path missing/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Send Prompt/i })).toBeDisabled();
  });

  it('sends attachments as multipart form data from the chat composer', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/threads/thread-1']}>
        <Routes>
          <Route path="/threads/:id" element={<ThreadDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(
        screen.getAllByText('Demo Workspace / Demo Thread').length,
      ).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Add attachment' }));
    const fileInput = container.querySelector('input[type="file"]:not([accept])') as HTMLInputElement | null;
    expect(fileInput).toBeTruthy();
    fireEvent.change(fileInput!, {
      target: {
        files: [new File(['hello'], 'notes.txt', { type: 'text/plain' })],
      },
    });

    const editor = screen.getByLabelText('Prompt');
    setPromptValue(editor, 'Please inspect [FILE notes.txt]');
    fireEvent.click(screen.getByRole('button', { name: 'Send Prompt' }));

    await waitFor(() => {
      const postCall = vi.mocked(fetch).mock.calls.find(
        ([requestUrl, requestInit]) =>
          String(requestUrl).endsWith('/api/threads/thread-1/prompt') &&
          requestInit?.method === 'POST',
      );
      expect(postCall?.[1]?.body).toBeInstanceOf(FormData);
    });
  });

  it('keeps a pending high reasoning selection when a stale detail refresh arrives before send', async () => {
    const intervalCallbacks = new Map<number, () => void>();
    let nextIntervalId = 1;
    const promptBodies: Array<Record<string, unknown>> = [];
    let resolveSettingsUpdate: (
      value:
        | { ok: true; json: () => Promise<unknown> }
        | PromiseLike<{ ok: true; json: () => Promise<unknown> }>
    ) => void = () => undefined;

    vi.spyOn(window, 'setInterval').mockImplementation(
      ((callback: TimerHandler) => {
        const id = nextIntervalId;
        nextIntervalId += 1;
        intervalCallbacks.set(id, callback as () => void);
        return id as unknown as number;
      }) as typeof window.setInterval,
    );
    vi.spyOn(window, 'clearInterval').mockImplementation(
      ((id: number) => {
        intervalCallbacks.delete(Number(id));
      }) as typeof window.clearInterval,
    );

    vi.stubGlobal(
      'fetch',
      withHealthz((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url.includes('/api/agent-runtimes/codex/status')) {
          return okJsonResponse(codexBackendResponse);
        }

        if (url.includes('/api/agent-runtimes/codex/models')) {
          return okJsonResponse(modelOptionsResponse);
        }

        if (url.includes('/api/agent-runtimes/codex/status')) {
          return okJsonResponse({
            state: 'ready',
            transport: 'stdio',
            lastStartedAt: new Date().toISOString(),
            lastError: null,
            restartCount: 0,
          });
        }

        if (url.includes('/api/agent-runtimes/codex/models')) {
          return okJsonResponse(modelOptionsResponse);
        }

        if (url.endsWith('/api/threads')) {
          return okJsonResponse([
            {
              id: 'thread-1',
              workspaceId: 'workspace-1',
              providerSessionId: 'codex-1',
              source: 'supervisor',
              title: 'Demo Thread',
              model: 'gpt-5.4',
              reasoningEffort: 'medium',
              collaborationMode: 'default',
              approvalMode: 'yolo',
              status: 'running',
              summaryText: 'Preview',
              lastError: null,
              activeTurnId: 'turn-1',
              isLoaded: true,
              isPinned: false,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              lastTurnStartedAt: new Date().toISOString(),
              lastTurnCompletedAt: null,
            },
          ]);
        }

        if (url.endsWith('/api/threads/thread-1/settings') && init?.method === 'PATCH') {
          return new Promise((resolve) => {
            resolveSettingsUpdate = resolve as typeof resolveSettingsUpdate;
          });
        }

        if (url.endsWith('/api/threads/thread-1/prompt') && init?.method === 'POST') {
          promptBodies.push(JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>);
          return okJsonResponse({
            id: 'thread-1',
            workspaceId: 'workspace-1',
            providerSessionId: 'codex-1',
            source: 'supervisor',
            title: 'Demo Thread',
            model: 'gpt-5.4',
            reasoningEffort: 'medium',
            collaborationMode: 'default',
            approvalMode: 'yolo',
            status: 'running',
            summaryText: 'Keep high reasoning.',
            lastError: null,
            activeTurnId: 'turn-2',
            isLoaded: true,
            isPinned: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            lastTurnStartedAt: new Date().toISOString(),
            lastTurnCompletedAt: null,
          });
        }

        if (url.startsWith('/api/threads/thread-1?') || url.endsWith('/api/threads/thread-1')) {
          return okJsonResponse({
            thread: {
              id: 'thread-1',
              workspaceId: 'workspace-1',
              providerSessionId: 'codex-1',
              source: 'supervisor',
              title: 'Demo Thread',
              model: 'gpt-5.4',
              reasoningEffort: 'medium',
              collaborationMode: 'default',
              approvalMode: 'yolo',
              status: 'running',
              summaryText: 'Preview',
              lastError: null,
              activeTurnId: 'turn-1',
              isLoaded: true,
              isPinned: false,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              lastTurnStartedAt: new Date().toISOString(),
              lastTurnCompletedAt: null,
            },
            workspace: {
              id: 'workspace-1',
              hostId: 'host-1',
              label: 'Demo Workspace',
              absPath: '/tmp/demo',
              isFavorite: false,
              createdAt: new Date().toISOString(),
              lastOpenedAt: null,
            },
            workspacePathStatus: 'present',
            pendingRequests: [],
            turns: [],
          });
        }

        throw new Error(`Unhandled fetch request: ${url}`);
      }),
    );

    render(
      <MemoryRouter initialEntries={['/threads/thread-1']}>
        <Routes>
          <Route path="/threads/:id" element={<ThreadDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByLabelText('Prompt')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'medium' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'medium' }));
    fireEvent.click(screen.getByRole('button', { name: 'high' }));

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'high' }).length).toBeGreaterThan(0);
    });

    const pollCallback = Array.from(intervalCallbacks.values())[0];
    expect(pollCallback).toBeTypeOf('function');
    act(() => {
      void pollCallback?.();
    });

    const editor = screen.getByLabelText('Prompt');
    setPromptValue(editor, 'Keep high reasoning.');
    fireEvent.click(screen.getByRole('button', { name: 'Send Prompt' }));

    await waitFor(() => {
      expect(promptBodies).toHaveLength(1);
    });

    expect(promptBodies[0]?.reasoningEffort).toBe('high');
    expect(screen.getAllByRole('button', { name: 'high' }).length).toBeGreaterThan(0);

    resolveSettingsUpdate({
      ok: true,
      json: async () => ({
        id: 'thread-1',
        workspaceId: 'workspace-1',
        providerSessionId: 'codex-1',
        source: 'supervisor',
        title: 'Demo Thread',
        model: 'gpt-5.4',
        reasoningEffort: 'high',
        collaborationMode: 'default',
        approvalMode: 'yolo',
        status: 'running',
        summaryText: 'Preview',
        lastError: null,
        activeTurnId: 'turn-1',
        isLoaded: true,
        isPinned: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastTurnStartedAt: new Date().toISOString(),
        lastTurnCompletedAt: null,
      }),
    });
  });

  it('preserves the selected reasoning effort across resume before sending from an unloaded thread', async () => {
    const promptBodies: Array<Record<string, unknown>> = [];

    vi.stubGlobal(
      'fetch',
      withHealthz((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url.includes('/api/agent-runtimes/codex/status')) {
          return okJsonResponse(codexBackendResponse);
        }

        if (url.includes('/api/agent-runtimes/codex/models')) {
          return okJsonResponse(modelOptionsResponse);
        }

        if (url.includes('/api/agent-runtimes/codex/status')) {
          return okJsonResponse({
            state: 'ready',
            transport: 'stdio',
            lastStartedAt: new Date().toISOString(),
            lastError: null,
            restartCount: 0,
          });
        }

        if (url.includes('/api/agent-runtimes/codex/models')) {
          return okJsonResponse(modelOptionsResponse);
        }

        if (url.endsWith('/api/threads')) {
          return okJsonResponse([
            {
              id: 'thread-1',
              workspaceId: 'workspace-1',
              providerSessionId: 'codex-1',
              source: 'supervisor',
              title: 'Demo Thread',
              model: 'gpt-5.4',
              reasoningEffort: 'medium',
              collaborationMode: 'default',
              approvalMode: 'yolo',
              status: 'not_loaded',
              summaryText: 'Preview',
              lastError: null,
              activeTurnId: null,
              isLoaded: false,
              isPinned: false,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              lastTurnStartedAt: null,
              lastTurnCompletedAt: null,
            },
          ]);
        }

        if (url.endsWith('/api/threads/thread-1/settings') && init?.method === 'PATCH') {
          return okJsonResponse({
            id: 'thread-1',
            workspaceId: 'workspace-1',
            providerSessionId: 'codex-1',
            source: 'supervisor',
            title: 'Demo Thread',
            model: 'gpt-5.4',
            reasoningEffort: 'high',
            collaborationMode: 'default',
            approvalMode: 'yolo',
            status: 'not_loaded',
            summaryText: 'Preview',
            lastError: null,
            activeTurnId: null,
            isLoaded: false,
            isPinned: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            lastTurnStartedAt: null,
            lastTurnCompletedAt: null,
          });
        }

        if (url.endsWith('/api/threads/thread-1/resume') && init?.method === 'POST') {
          return okJsonResponse({
            thread: {
              id: 'thread-1',
              workspaceId: 'workspace-1',
              providerSessionId: 'codex-1',
              source: 'supervisor',
              title: 'Demo Thread',
              model: 'gpt-5.4',
              reasoningEffort: 'medium',
              collaborationMode: 'default',
              approvalMode: 'yolo',
              status: 'idle',
              summaryText: 'Preview',
              lastError: null,
              activeTurnId: null,
              isLoaded: true,
              isPinned: false,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              lastTurnStartedAt: null,
              lastTurnCompletedAt: null,
            },
            workspace: {
              id: 'workspace-1',
              hostId: 'host-1',
              label: 'Demo Workspace',
              absPath: '/tmp/demo',
              isFavorite: false,
              createdAt: new Date().toISOString(),
              lastOpenedAt: null,
            },
            workspacePathStatus: 'present',
            pendingRequests: [],
            turns: [],
          });
        }

        if (url.endsWith('/api/threads/thread-1/prompt') && init?.method === 'POST') {
          promptBodies.push(JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>);
          return okJsonResponse({
            id: 'thread-1',
            workspaceId: 'workspace-1',
            providerSessionId: 'codex-1',
            source: 'supervisor',
            title: 'Demo Thread',
            model: 'gpt-5.4',
            reasoningEffort: 'high',
            collaborationMode: 'default',
            approvalMode: 'yolo',
            status: 'running',
            summaryText: 'Send after resume.',
            lastError: null,
            activeTurnId: 'turn-2',
            isLoaded: true,
            isPinned: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            lastTurnStartedAt: new Date().toISOString(),
            lastTurnCompletedAt: null,
          });
        }

        if (url.startsWith('/api/threads/thread-1?') || url.endsWith('/api/threads/thread-1')) {
          return okJsonResponse({
            thread: {
              id: 'thread-1',
              workspaceId: 'workspace-1',
              providerSessionId: 'codex-1',
              source: 'supervisor',
              title: 'Demo Thread',
              model: 'gpt-5.4',
              reasoningEffort: 'medium',
              collaborationMode: 'default',
              approvalMode: 'yolo',
              status: 'not_loaded',
              summaryText: 'Preview',
              lastError: null,
              activeTurnId: null,
              isLoaded: false,
              isPinned: false,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              lastTurnStartedAt: null,
              lastTurnCompletedAt: null,
            },
            workspace: {
              id: 'workspace-1',
              hostId: 'host-1',
              label: 'Demo Workspace',
              absPath: '/tmp/demo',
              isFavorite: false,
              createdAt: new Date().toISOString(),
              lastOpenedAt: null,
            },
            workspacePathStatus: 'present',
            pendingRequests: [],
            turns: [],
          });
        }

        throw new Error(`Unhandled fetch request: ${url}`);
      }),
    );

    render(
      <MemoryRouter initialEntries={['/threads/thread-1']}>
        <Routes>
          <Route path="/threads/:id" element={<ThreadDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByLabelText('Prompt')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'medium' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'medium' }));
    fireEvent.click(screen.getByRole('button', { name: 'high' }));

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'high' }).length).toBeGreaterThan(0);
    });

    const editor = screen.getByLabelText('Prompt');
    setPromptValue(editor, 'Send after resume.');
    fireEvent.click(screen.getByRole('button', { name: 'Send Prompt' }));

    await waitFor(() => {
      expect(promptBodies).toHaveLength(1);
    });

    expect(promptBodies[0]?.reasoningEffort).toBe('high');
  });

  it('auto-connects an unloaded thread before sending the first prompt', async () => {
    vi.stubGlobal(
      'fetch',
      withHealthz((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url.includes('/api/agent-runtimes/codex/status')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              state: 'ready',
              transport: 'stdio',
              lastStartedAt: new Date().toISOString(),
              lastError: null,
              restartCount: 0,
            }),
          });
        }

        if (url.includes('/api/agent-runtimes/codex/models')) {
          return Promise.resolve({
            ok: true,
            json: async () => modelOptionsResponse,
          });
        }

        if (url.endsWith('/api/threads/thread-1/resume') && init?.method === 'POST') {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              thread: {
                id: 'thread-1',
                workspaceId: 'workspace-1',
                providerSessionId: 'codex-1',
                source: 'supervisor',
                title: 'Demo Thread',
                model: 'gpt-5',
                reasoningEffort: 'medium',
                collaborationMode: 'default',
                approvalMode: 'yolo',
                status: 'idle',
                summaryText: 'Preview',
                lastError: null,
                activeTurnId: null,
                isLoaded: true,
                isPinned: false,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                lastTurnStartedAt: null,
                lastTurnCompletedAt: null,
              },
              workspace: {
                id: 'workspace-1',
                hostId: 'host-1',
                label: 'Demo Workspace',
                absPath: '/tmp/demo',
                isFavorite: false,
                createdAt: new Date().toISOString(),
                lastOpenedAt: null,
              },
              workspacePathStatus: 'present',
              pendingRequests: [],
              answeredRequestNotes: [
                {
                  id: 'plan-decision-1',
                  turnId: 'turn-1',
                  title: 'Plan ready',
                  summaryLines: ['Next step: Stay in plan mode'],
                  createdAt: new Date().toISOString(),
                },
              ],
              turns: [],
            }),
          });
        }

        if (url.endsWith('/api/threads/thread-1/prompt') && init?.method === 'POST') {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              id: 'thread-1',
              workspaceId: 'workspace-1',
              providerSessionId: 'codex-1',
              source: 'supervisor',
              title: 'Demo Thread',
              model: 'gpt-5',
              reasoningEffort: 'medium',
              collaborationMode: 'default',
              approvalMode: 'yolo',
              status: 'running',
              summaryText: 'hello after auto connect',
              lastError: null,
              activeTurnId: 'turn-2',
              isLoaded: true,
              isPinned: false,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              lastTurnStartedAt: new Date().toISOString(),
              lastTurnCompletedAt: null,
            }),
          });
        }

        if (url.startsWith('/api/threads/thread-1?') || url.endsWith('/api/threads/thread-1')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              thread: {
                id: 'thread-1',
                workspaceId: 'workspace-1',
                providerSessionId: 'codex-1',
                source: 'supervisor',
                title: 'Demo Thread',
                model: 'gpt-5',
                reasoningEffort: 'medium',
                collaborationMode: 'default',
                approvalMode: 'yolo',
                status: 'idle',
                summaryText: 'Preview',
                lastError: null,
                activeTurnId: null,
                isLoaded: false,
                isPinned: false,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                lastTurnStartedAt: null,
                lastTurnCompletedAt: null,
              },
              workspace: {
                id: 'workspace-1',
                hostId: 'host-1',
                label: 'Demo Workspace',
                absPath: '/tmp/demo',
                isFavorite: false,
                createdAt: new Date().toISOString(),
                lastOpenedAt: null,
              },
              workspacePathStatus: 'present',
              pendingRequests: [],
              answeredRequestNotes: [
                {
                  id: 'plan-decision-1',
                  turnId: 'turn-1',
                  title: 'Plan ready',
                  summaryLines: ['Next step: Stay in plan mode'],
                  createdAt: new Date().toISOString(),
                },
              ],
              turns: [],
            }),
          });
        }

        if (url.endsWith('/api/threads')) {
          return Promise.resolve({
            ok: true,
            json: async () => [
              {
                id: 'thread-1',
                workspaceId: 'workspace-1',
                providerSessionId: 'codex-1',
                source: 'supervisor',
                title: 'Demo Thread',
                model: 'gpt-5',
                reasoningEffort: 'medium',
                collaborationMode: 'default',
                approvalMode: 'yolo',
                status: 'idle',
                summaryText: 'Preview',
                lastError: null,
                activeTurnId: null,
                isLoaded: false,
                isPinned: false,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                lastTurnStartedAt: null,
                lastTurnCompletedAt: null,
              },
            ],
          });
        }

        throw new Error(`Unhandled fetch request: ${url}`);
      }),
    );

    render(
      <MemoryRouter initialEntries={['/threads/thread-1']}>
        <Routes>
          <Route path="/threads/:id" element={<ThreadDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(
        screen.getAllByText('Demo Workspace / Demo Thread').length,
      ).toBeGreaterThan(0);
    });

    setPromptValue(screen.getByLabelText('Prompt'), 'hello after auto connect');
    fireEvent.click(screen.getByRole('button', { name: 'Send Prompt' }));

    await waitFor(() => {
      const calls = vi.mocked(fetch).mock.calls.map(([requestUrl]) => String(requestUrl));
      expect(calls).toContain('/api/threads/thread-1/resume');
      expect(calls).toContain('/api/threads/thread-1/prompt');
    });

    const calls = vi.mocked(fetch).mock.calls.map(([requestUrl]) => String(requestUrl));
    expect(calls.indexOf('/api/threads/thread-1/resume')).toBeLessThan(
      calls.indexOf('/api/threads/thread-1/prompt'),
    );
  });

  it('shows the specific server error message when attachment upload is rejected', async () => {
    vi.stubGlobal(
      'fetch',
      withHealthz((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url.includes('/api/agent-runtimes/codex/status')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              state: 'ready',
              transport: 'stdio',
              lastStartedAt: new Date().toISOString(),
              lastError: null,
              restartCount: 0,
            }),
          });
        }

        if (url.includes('/api/agent-runtimes/codex/models')) {
          return Promise.resolve({
            ok: true,
            json: async () => modelOptionsResponse,
          });
        }

        if (url.endsWith('/api/threads/thread-1/prompt') && init?.method === 'POST') {
          return Promise.resolve({
            ok: false,
            status: 413,
            json: async () => ({
              code: 'bad_request',
              message: 'Each attachment must be 25 MB or smaller.',
            }),
          });
        }

        if (url.startsWith('/api/threads/thread-1?') || url.endsWith('/api/threads/thread-1')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              thread: {
                id: 'thread-1',
                workspaceId: 'workspace-1',
                providerSessionId: 'codex-1',
                source: 'supervisor',
                title: 'Demo Thread',
                model: 'gpt-5',
                reasoningEffort: 'medium',
                collaborationMode: 'default',
                approvalMode: 'yolo',
                status: 'idle',
                summaryText: 'Preview',
                lastError: null,
                activeTurnId: null,
                isLoaded: true,
                isPinned: false,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                lastTurnStartedAt: null,
                lastTurnCompletedAt: null,
              },
              workspace: {
                id: 'workspace-1',
                hostId: 'host-1',
                label: 'Demo Workspace',
                absPath: '/tmp/demo',
                isFavorite: false,
                createdAt: new Date().toISOString(),
                lastOpenedAt: null,
              },
              workspacePathStatus: 'present',
              pendingRequests: [],
              turns: [],
            }),
          });
        }

        if (url.endsWith('/api/threads')) {
          return Promise.resolve({
            ok: true,
            json: async () => [],
          });
        }

        throw new Error(`Unhandled fetch request: ${url}`);
      }),
    );

    const { container } = render(
      <MemoryRouter initialEntries={['/threads/thread-1']}>
        <Routes>
          <Route path="/threads/:id" element={<ThreadDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(
        screen.getAllByText('Demo Workspace / Demo Thread').length,
      ).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Add attachment' }));
    const photoInput = container.querySelector(
      'input[type="file"][accept="image/*"]',
    ) as HTMLInputElement | null;
    expect(photoInput).toBeTruthy();
    fireEvent.change(photoInput!, {
      target: {
        files: [new File(['hello'], 'camera.jpg', { type: 'image/jpeg' })],
      },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Send Prompt' }));

    await waitFor(() => {
      expect(
        screen.getAllByText('Each attachment must be 25 MB or smaller.').length,
      ).toBeGreaterThan(0);
    });
  });

  it('shows an optimistic sending turn immediately and marks it failed when prompt submission fails', async () => {
    vi.stubGlobal(
      'fetch',
      withHealthz((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url.includes('/api/agent-runtimes/codex/status')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              state: 'ready',
              transport: 'stdio',
              lastStartedAt: new Date().toISOString(),
              lastError: null,
              restartCount: 0,
            }),
          });
        }

        if (url.includes('/api/agent-runtimes/codex/models')) {
          return Promise.resolve({
            ok: true,
            json: async () => modelOptionsResponse,
          });
        }

        if (url.endsWith('/api/threads/thread-1/prompt') && init?.method === 'POST') {
          return Promise.resolve({
            ok: false,
            status: 500,
            json: async () => ({
              code: 'internal_error',
              message: 'Prompt delivery failed.',
            }),
          });
        }

        if (url.startsWith('/api/threads/thread-1?') || url.endsWith('/api/threads/thread-1')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              thread: {
                id: 'thread-1',
                workspaceId: 'workspace-1',
                providerSessionId: 'codex-1',
                source: 'supervisor',
                title: 'Demo Thread',
                model: 'gpt-5',
                reasoningEffort: 'medium',
                collaborationMode: 'default',
                approvalMode: 'yolo',
                status: 'idle',
                summaryText: 'Preview',
                lastError: null,
                activeTurnId: null,
                isLoaded: true,
                isPinned: false,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                lastTurnStartedAt: null,
                lastTurnCompletedAt: null,
              },
              workspace: {
                id: 'workspace-1',
                hostId: 'host-1',
                label: 'Demo Workspace',
                absPath: '/tmp/demo',
                isFavorite: false,
                createdAt: new Date().toISOString(),
                lastOpenedAt: null,
              },
              workspacePathStatus: 'present',
              pendingRequests: [],
              turns: [],
            }),
          });
        }

        if (url.endsWith('/api/threads')) {
          return Promise.resolve({
            ok: true,
            json: async () => [],
          });
        }

        throw new Error(`Unhandled fetch request: ${url}`);
      }),
    );

    render(
      <MemoryRouter initialEntries={['/threads/thread-1']}>
        <Routes>
          <Route path="/threads/:id" element={<ThreadDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(
        screen.getAllByText('Demo Workspace / Demo Thread').length,
      ).toBeGreaterThan(0);
    });

    const editor = screen.getByLabelText('Prompt');
    setPromptValue(editor, 'Ship this optimistic prompt.');
    fireEvent.click(screen.getByRole('button', { name: 'Send Prompt' }));

    expect(screen.getAllByText('Ship this optimistic prompt.').length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText('Sending').length).toBeGreaterThan(0);

    await waitFor(() => {
      expect(screen.getByLabelText('Failed')).toBeInTheDocument();
      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent('Agent response failed');
      expect(alert).toHaveTextContent('Prompt delivery failed.');
    });
  });

  it('shows non-JSON upstream prompt errors as an agent error bubble', async () => {
    vi.stubGlobal(
      'fetch',
      withHealthz((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url.includes('/api/agent-runtimes/codex/status')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              state: 'ready',
              transport: 'stdio',
              lastStartedAt: new Date().toISOString(),
              lastError: null,
              restartCount: 0,
            }),
          });
        }

        if (url.includes('/api/agent-runtimes/codex/models')) {
          return Promise.resolve({
            ok: true,
            json: async () => modelOptionsResponse,
          });
        }

        if (url.endsWith('/api/threads/thread-1/prompt') && init?.method === 'POST') {
          return Promise.resolve({
            ok: false,
            status: 503,
            statusText: 'Service Unavailable',
            headers: new Headers({ 'content-type': 'text/plain' }),
            text: async () => 'OpenAI upstream unavailable.',
            json: async () => {
              throw new Error('not json');
            },
          });
        }

        if (url.startsWith('/api/threads/thread-1?') || url.endsWith('/api/threads/thread-1')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              thread: {
                id: 'thread-1',
                workspaceId: 'workspace-1',
                providerSessionId: 'codex-1',
                source: 'supervisor',
                title: 'Demo Thread',
                model: 'gpt-5',
                reasoningEffort: 'medium',
                collaborationMode: 'default',
                approvalMode: 'yolo',
                status: 'idle',
                summaryText: 'Preview',
                lastError: null,
                activeTurnId: null,
                isLoaded: true,
                isPinned: false,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                lastTurnStartedAt: null,
                lastTurnCompletedAt: null,
              },
              workspace: {
                id: 'workspace-1',
                hostId: 'host-1',
                label: 'Demo Workspace',
                absPath: '/tmp/demo',
                isFavorite: false,
                createdAt: new Date().toISOString(),
                lastOpenedAt: null,
              },
              workspacePathStatus: 'present',
              pendingRequests: [],
              turns: [],
            }),
          });
        }

        if (url.endsWith('/api/threads')) {
          return Promise.resolve({
            ok: true,
            json: async () => [],
          });
        }

        throw new Error(`Unhandled fetch request: ${url}`);
      }),
    );

    render(
      <MemoryRouter initialEntries={['/threads/thread-1']}>
        <Routes>
          <Route path="/threads/:id" element={<ThreadDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(
        screen.getAllByText('Demo Workspace / Demo Thread').length,
      ).toBeGreaterThan(0);
    });

    const editor = screen.getByLabelText('Prompt');
    setPromptValue(editor, 'Trigger an upstream outage.');
    fireEvent.click(screen.getByRole('button', { name: 'Send Prompt' }));

    expect(screen.getAllByText('Trigger an upstream outage.').length).toBeGreaterThan(0);

    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent('Agent response failed');
      expect(alert).toHaveTextContent('Upstream service unavailable (503 Service Unavailable).');
      expect(alert).toHaveTextContent('OpenAI upstream unavailable.');
    });
  });

  it('clears optimistic turns when completed provider history uses a different turn id', async () => {
    const prompt = 'Reply with exactly: HISTORY_TURN_OK';
    let detailRequestCount = 0;

    vi.stubGlobal(
      'fetch',
      withHealthz((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url.includes('/api/agent-runtimes/claude/status')) {
          return okJsonResponse(claudeBackendResponse);
        }

        if (url.includes('/api/agent-runtimes/claude/models')) {
          return okJsonResponse(claudeModelOptionsResponse);
        }

        if (url.endsWith('/api/threads/thread-1/prompt') && init?.method === 'POST') {
          return okJsonResponse({
            id: 'thread-1',
            workspaceId: 'workspace-1',
            provider: 'claude',
            providerSessionId: 'claude-session-1',
            source: 'supervisor',
            title: 'Claude Thread',
            model: 'sonnet',
            reasoningEffort: 'medium',
            collaborationMode: 'default',
            approvalMode: 'yolo',
            status: 'running',
            summaryText: prompt,
            lastError: null,
            activeTurnId: 'live-turn-1',
            isLoaded: true,
            isPinned: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            lastTurnStartedAt: new Date().toISOString(),
            lastTurnCompletedAt: null,
          });
        }

        if (url.startsWith('/api/threads/thread-1?') || url.endsWith('/api/threads/thread-1')) {
          detailRequestCount += 1;
          const hasCompletedTurn = detailRequestCount > 1;
          return okJsonResponse({
            thread: {
              id: 'thread-1',
              workspaceId: 'workspace-1',
              provider: 'claude',
              providerSessionId: 'claude-session-1',
              source: 'supervisor',
              title: 'Claude Thread',
              model: 'sonnet',
              reasoningEffort: 'medium',
              collaborationMode: 'default',
              approvalMode: 'yolo',
              status: hasCompletedTurn ? 'idle' : 'running',
              summaryText: hasCompletedTurn ? prompt : 'Preview',
              lastError: null,
              activeTurnId: hasCompletedTurn ? null : 'live-turn-1',
              isLoaded: true,
              isPinned: false,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              lastTurnStartedAt: new Date().toISOString(),
              lastTurnCompletedAt: hasCompletedTurn ? new Date().toISOString() : null,
            },
            workspace: {
              id: 'workspace-1',
              hostId: 'host-1',
              label: 'Demo Workspace',
              absPath: '/tmp/demo',
              isFavorite: false,
              createdAt: new Date().toISOString(),
              lastOpenedAt: null,
            },
            workspacePathStatus: 'present',
            pendingRequests: [],
            turns: hasCompletedTurn
              ? [
                  {
                    id: 'history-turn-1',
                    startedAt: new Date().toISOString(),
                    status: 'completed',
                    error: null,
                    items: [
                      {
                        id: 'history-user-1',
                        kind: 'userMessage',
                        text: prompt,
                      },
                      {
                        id: 'history-agent-1',
                        kind: 'agentMessage',
                        text: 'HISTORY_TURN_OK',
                      },
                    ],
                  },
                ]
              : [],
          });
        }

        if (url.endsWith('/api/threads')) {
          return okJsonResponse([]);
        }

        return Promise.reject(new Error(`Unexpected request: ${url}`));
      }),
    );

    render(
      <MemoryRouter initialEntries={['/threads/thread-1']}>
        <Routes>
          <Route path="/threads/:id" element={<ThreadDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getAllByText('Claude Thread').length).toBeGreaterThan(0);
    });

    const editor = screen.getByLabelText('Prompt');
    setPromptValue(editor, prompt);
    fireEvent.click(screen.getByRole('button', { name: 'Send Prompt' }));
    emitSocketMessage(FakeWebSocket.instances[0]!, {
      type: 'thread.turn.completed',
      threadId: 'thread-1',
      timestamp: new Date().toISOString(),
      payload: {
        turnId: 'live-turn-1',
      },
    });

    await waitFor(() => {
      expect(screen.getByText('HISTORY_TURN_OK')).toBeInTheDocument();
    });

    expect(screen.getAllByText(prompt)).toHaveLength(1);
    expect(screen.queryByLabelText('Running')).not.toBeInTheDocument();
  });

  it('clears unstructured streaming fallback when the turn reaches a terminal state', async () => {
    const prompt = 'Stream a short fallback response.';
    let detailRequestCount = 0;

    vi.stubGlobal(
      'fetch',
      withHealthz((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url.includes('/api/agent-runtimes/claude/status')) {
          return okJsonResponse(claudeBackendResponse);
        }

        if (url.includes('/api/agent-runtimes/claude/models')) {
          return okJsonResponse(claudeModelOptionsResponse);
        }

        if (url.endsWith('/api/threads/thread-1/prompt') && init?.method === 'POST') {
          return okJsonResponse({
            id: 'thread-1',
            workspaceId: 'workspace-1',
            provider: 'claude',
            providerSessionId: 'claude-session-1',
            source: 'supervisor',
            title: 'Claude Thread',
            model: 'sonnet',
            reasoningEffort: 'medium',
            collaborationMode: 'default',
            approvalMode: 'yolo',
            sandboxMode: 'danger-full-access',
            status: 'running',
            summaryText: prompt,
            lastError: null,
            activeTurnId: 'live-turn-1',
            isLoaded: true,
            isPinned: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            lastTurnStartedAt: new Date().toISOString(),
            lastTurnCompletedAt: null,
          });
        }

        if (url.startsWith('/api/threads/thread-1?') || url.endsWith('/api/threads/thread-1')) {
          detailRequestCount += 1;
          const hasCompletedTurn = detailRequestCount > 1;
          return okJsonResponse({
            thread: {
              id: 'thread-1',
              workspaceId: 'workspace-1',
              provider: 'claude',
              providerSessionId: 'claude-session-1',
              source: 'supervisor',
              title: 'Claude Thread',
              model: 'sonnet',
              reasoningEffort: 'medium',
              collaborationMode: 'default',
              approvalMode: 'yolo',
              sandboxMode: 'danger-full-access',
              status: hasCompletedTurn ? 'idle' : 'running',
              summaryText: hasCompletedTurn ? prompt : 'Preview',
              lastError: null,
              activeTurnId: hasCompletedTurn ? null : 'live-turn-1',
              isLoaded: true,
              isPinned: false,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              lastTurnStartedAt: new Date().toISOString(),
              lastTurnCompletedAt: hasCompletedTurn ? new Date().toISOString() : null,
            },
            workspace: {
              id: 'workspace-1',
              hostId: 'host-1',
              label: 'Demo Workspace',
              absPath: '/tmp/demo',
              isFavorite: false,
              createdAt: new Date().toISOString(),
              lastOpenedAt: null,
            },
            workspacePathStatus: 'present',
            pendingRequests: [],
            turns: hasCompletedTurn
              ? [
                  {
                    id: 'live-turn-1',
                    startedAt: new Date().toISOString(),
                    status: 'completed',
                    error: null,
                    items: [
                      {
                        id: 'live-turn-1:user',
                        kind: 'userMessage',
                        text: prompt,
                      },
                      {
                        id: 'final-agent-1',
                        kind: 'agentMessage',
                        text: 'FINAL_RESPONSE_OK',
                      },
                    ],
                  },
                ]
              : [],
          });
        }

        if (url.endsWith('/api/threads')) {
          return okJsonResponse([]);
        }

        return Promise.reject(new Error(`Unexpected request: ${url}`));
      }),
    );

    render(
      <MemoryRouter initialEntries={['/threads/thread-1']}>
        <Routes>
          <Route path="/threads/:id" element={<ThreadDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getAllByText('Claude Thread').length).toBeGreaterThan(0);
    });

    setPromptValue(screen.getByLabelText('Prompt'), prompt);
    fireEvent.click(screen.getByRole('button', { name: 'Send Prompt' }));

    emitSocketMessage(FakeWebSocket.instances[0]!, {
      type: 'thread.output.delta',
      threadId: 'thread-1',
      timestamp: new Date().toISOString(),
      payload: {
        turnId: 'live-turn-1',
        delta: 'STREAMING_FALLBACK_DRAFT',
      },
    });

    await waitFor(() => {
      expect(screen.getByText('STREAMING_FALLBACK_DRAFT')).toBeInTheDocument();
    });

    emitSocketMessage(FakeWebSocket.instances[0]!, {
      type: 'thread.turn.completed',
      threadId: 'thread-1',
      timestamp: new Date().toISOString(),
      payload: {
        turnId: 'live-turn-1',
      },
    });

    await waitFor(() => {
      expect(screen.getByText('FINAL_RESPONSE_OK')).toBeInTheDocument();
    });
    expect(screen.queryByText('STREAMING_FALLBACK_DRAFT')).not.toBeInTheDocument();
  });

  it('keeps structured live agent text through stale detail refreshes until final text arrives', async () => {
    let detailRequestCount = 0;

    vi.stubGlobal(
      'fetch',
      withHealthz((input: RequestInfo | URL) => {
        const url = String(input);

        if (url.includes('/api/agent-runtimes/codex/status')) {
          return okJsonResponse(codexBackendResponse);
        }

        if (url.includes('/api/agent-runtimes/codex/models')) {
          return okJsonResponse(modelOptionsResponse);
        }

        if (url.startsWith('/api/threads/thread-1?') || url.endsWith('/api/threads/thread-1')) {
          detailRequestCount += 1;
          const hasFinalTurn = detailRequestCount > 3;
          return okJsonResponse({
            thread: {
              id: 'thread-1',
              workspaceId: 'workspace-1',
              providerSessionId: 'codex-1',
              source: 'supervisor',
              title: 'Demo Thread',
              model: 'gpt-5',
              reasoningEffort: 'medium',
              collaborationMode: 'default',
              approvalMode: 'yolo',
              status: hasFinalTurn ? 'idle' : 'running',
              summaryText: 'Preview',
              lastError: null,
              activeTurnId: hasFinalTurn ? null : 'turn-1',
              isLoaded: true,
              isPinned: false,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              lastTurnStartedAt: new Date().toISOString(),
              lastTurnCompletedAt: hasFinalTurn ? new Date().toISOString() : null,
            },
            workspace: {
              id: 'workspace-1',
              hostId: 'host-1',
              label: 'Demo Workspace',
              absPath: '/tmp/demo',
              isFavorite: false,
              createdAt: new Date().toISOString(),
              lastOpenedAt: null,
            },
            workspacePathStatus: 'present',
            pendingRequests: [],
            liveItems: hasFinalTurn
              ? null
              : {
                  turnId: 'turn-1',
                  updatedAt:
                    detailRequestCount <= 2
                      ? '2026-04-09T06:01:05.000Z'
                      : '2026-04-09T06:01:00.000Z',
                  items: [
                    {
                      id: 'agent-live-1',
                      kind: 'agentMessage',
                      text:
                        detailRequestCount <= 2
                          ? 'FINAL_TEXT_BEFORE_REFRESH'
                          : 'STALE',
                      sequence: 1,
                    },
                  ],
                },
            turns: [
              {
                id: 'turn-1',
                startedAt: new Date().toISOString(),
                status: hasFinalTurn ? 'completed' : 'inProgress',
                error: null,
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
        }

        if (url.endsWith('/api/threads')) {
          return okJsonResponse([]);
        }

        return Promise.reject(new Error(`Unexpected request: ${url}`));
      }),
    );

    render(
      <MemoryRouter initialEntries={['/threads/thread-1']}>
        <Routes>
          <Route path="/threads/:id" element={<ThreadDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getAllByText('Demo Thread').length).toBeGreaterThan(0);
    });
    await act(async () => {
      emitSocketEvent(FakeWebSocket.instances[0]!, 'open');
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(FakeWebSocket.instances[0]?.readyState).toBe(1);
    });

    await waitFor(() => {
      expect(screen.getByText('FINAL_TEXT_BEFORE_REFRESH')).toBeInTheDocument();
    });

    await act(async () => {
      emitSocketMessage(FakeWebSocket.instances[0]!, {
        type: 'thread.updated',
        threadId: 'thread-1',
        timestamp: new Date().toISOString(),
        payload: {
          status: 'running',
        },
      });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByText('FINAL_TEXT_BEFORE_REFRESH')).toBeInTheDocument();
    });
    expect(screen.queryByText('STALE')).not.toBeInTheDocument();

    await act(async () => {
      emitSocketMessage(FakeWebSocket.instances[0]!, {
        type: 'thread.turn.completed',
        threadId: 'thread-1',
        timestamp: new Date().toISOString(),
        payload: {
          turnId: 'turn-1',
          status: 'completed',
          error: null,
        },
      });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByText('FINAL_STRUCTURED_RESPONSE')).toBeInTheDocument();
    });
    expect(screen.queryByText('FINAL_TEXT_BEFORE_REFRESH')).not.toBeInTheDocument();
  });

  it('keeps sequenced live command snapshots through materialized detail refreshes', async () => {
    let detailRequestCount = 0;

    vi.stubGlobal(
      'fetch',
      withHealthz((input: RequestInfo | URL) => {
        const url = String(input);

        if (url.includes('/api/agent-runtimes/codex/status')) {
          return okJsonResponse(codexBackendResponse);
        }

        if (url.includes('/api/agent-runtimes/codex/models')) {
          return okJsonResponse(modelOptionsResponse);
        }

        if (url.startsWith('/api/threads/thread-1?') || url.endsWith('/api/threads/thread-1')) {
          detailRequestCount += 1;
          const hasMaterializedCommands = detailRequestCount > 1;
          return okJsonResponse({
            thread: {
              id: 'thread-1',
              workspaceId: 'workspace-1',
              providerSessionId: 'codex-1',
              source: 'supervisor',
              title: 'Demo Thread',
              model: 'gpt-5',
              reasoningEffort: 'medium',
              collaborationMode: 'default',
              approvalMode: 'yolo',
              status: 'running',
              summaryText: 'Preview',
              lastError: null,
              activeTurnId: 'turn-1',
              isLoaded: true,
              isPinned: false,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              lastTurnStartedAt: new Date().toISOString(),
              lastTurnCompletedAt: null,
            },
            workspace: {
              id: 'workspace-1',
              hostId: 'host-1',
              label: 'Demo Workspace',
              absPath: '/tmp/demo',
              isFavorite: false,
              createdAt: new Date().toISOString(),
              lastOpenedAt: null,
            },
            workspacePathStatus: 'present',
            pendingRequests: [],
            liveItems: null,
            turns: [
              {
                id: 'turn-1',
                startedAt: new Date().toISOString(),
                status: 'inProgress',
                error: null,
                items: hasMaterializedCommands
                  ? [
                      {
                        id: 'command-1',
                        kind: 'commandExecution',
                        text: 'pnpm lint',
                        status: 'completed',
                      },
                      {
                        id: 'command-2',
                        kind: 'commandExecution',
                        text: 'pnpm typecheck',
                        status: 'completed',
                      },
                      {
                        id: 'command-3',
                        kind: 'commandExecution',
                        text: 'pnpm test',
                        status: 'completed',
                      },
                      {
                        id: 'command-4',
                        kind: 'commandExecution',
                        text: 'pnpm build',
                        status: 'completed',
                      },
                      {
                        id: 'command-5',
                        kind: 'commandExecution',
                        text: 'pnpm package',
                        status: 'completed',
                      },
                    ]
                  : [],
              },
            ],
          });
        }

        if (url.endsWith('/api/threads')) {
          return okJsonResponse([]);
        }

        return Promise.reject(new Error(`Unexpected request: ${url}`));
      }),
    );

    render(
      <MemoryRouter initialEntries={['/threads/thread-1']}>
        <Routes>
          <Route path="/threads/:id" element={<ThreadDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getAllByText('Demo Thread').length).toBeGreaterThan(0);
    });
    await act(async () => {
      emitSocketEvent(FakeWebSocket.instances[0]!, 'open');
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(FakeWebSocket.instances[0]?.readyState).toBe(1);
    });

    for (const item of [
      { id: 'command-1', text: 'pnpm lint', sequence: 1 },
      { id: 'command-2', text: 'pnpm typecheck', sequence: 2 },
      { id: 'command-3', text: 'pnpm test', sequence: 4 },
      { id: 'command-4', text: 'pnpm build', sequence: 5 },
      { id: 'command-5', text: 'pnpm package', sequence: 6 },
    ]) {
      emitSocketMessage(FakeWebSocket.instances[0]!, {
        type: 'thread.item.completed',
        threadId: 'thread-1',
        timestamp: new Date().toISOString(),
        payload: {
          turnId: 'turn-1',
          item: {
            id: item.id,
            kind: 'commandExecution',
            text: item.text,
            status: 'completed',
            sequence: item.sequence,
          },
        },
      });
      if (item.id === 'command-2') {
        emitSocketMessage(FakeWebSocket.instances[0]!, {
          type: 'thread.output.delta',
          threadId: 'thread-1',
          timestamp: new Date().toISOString(),
          payload: {
            turnId: 'turn-1',
            itemId: 'agent-between',
            sequence: 3,
            delta: 'The first batch passed. I will run the next checks.',
          },
        });
      }
    }

    await waitFor(() => {
      expect(screen.getByText('2 commands')).toBeInTheDocument();
    });
    expect(screen.getByText('3 commands')).toBeInTheDocument();
    expect(screen.queryByText('5 commands')).not.toBeInTheDocument();

    await act(async () => {
      emitSocketMessage(FakeWebSocket.instances[0]!, {
        type: 'thread.updated',
        threadId: 'thread-1',
        timestamp: new Date().toISOString(),
        payload: {
          status: 'running',
        },
      });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByText('2 commands')).toBeInTheDocument();
    });
    expect(screen.getByText('3 commands')).toBeInTheDocument();
    expect(screen.queryByText('5 commands')).not.toBeInTheDocument();
    expect(
      screen.getByText('The first batch passed. I will run the next checks.'),
    ).toBeInTheDocument();
  });

  it('does not render a duplicate optimistic turn once the live provider turn is materialized', async () => {
    const prompt = 'What number is in the screenshot? [PHOTO ./.temp/threads/thread-1/image.png]';
    let detailRequestCount = 0;

    vi.stubGlobal(
      'fetch',
      withHealthz((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url.includes('/api/agent-runtimes/claude/status')) {
          return okJsonResponse(claudeBackendResponse);
        }

        if (url.includes('/api/agent-runtimes/claude/models')) {
          return okJsonResponse(claudeModelOptionsResponse);
        }

        if (url.endsWith('/api/threads/thread-1/prompt') && init?.method === 'POST') {
          return okJsonResponse({
            id: 'thread-1',
            workspaceId: 'workspace-1',
            provider: 'claude',
            providerSessionId: 'claude-session-1',
            source: 'supervisor',
            title: 'Claude Thread',
            model: 'sonnet',
            reasoningEffort: 'medium',
            collaborationMode: 'default',
            approvalMode: 'yolo',
            sandboxMode: 'danger-full-access',
            status: 'running',
            summaryText: prompt,
            lastError: null,
            activeTurnId: 'claude-turn-1',
            isLoaded: true,
            isPinned: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            lastTurnStartedAt: new Date().toISOString(),
            lastTurnCompletedAt: null,
          });
        }

        if (url.startsWith('/api/threads/thread-1?') || url.endsWith('/api/threads/thread-1')) {
          detailRequestCount += 1;
          const hasLiveTurn = detailRequestCount > 1;
          return okJsonResponse({
            thread: {
              id: 'thread-1',
              workspaceId: 'workspace-1',
              provider: 'claude',
              providerSessionId: 'claude-session-1',
              source: 'supervisor',
              title: 'Claude Thread',
              model: 'sonnet',
              reasoningEffort: 'medium',
              collaborationMode: 'default',
              approvalMode: 'yolo',
              sandboxMode: 'danger-full-access',
              status: hasLiveTurn ? 'running' : 'idle',
              summaryText: hasLiveTurn ? prompt : 'Preview',
              lastError: null,
              activeTurnId: hasLiveTurn ? 'claude-turn-1' : null,
              isLoaded: true,
              isPinned: false,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              lastTurnStartedAt: hasLiveTurn ? new Date().toISOString() : null,
              lastTurnCompletedAt: null,
            },
            workspace: {
              id: 'workspace-1',
              hostId: 'host-1',
              label: 'Demo Workspace',
              absPath: '/tmp/demo',
              isFavorite: false,
              createdAt: new Date().toISOString(),
              lastOpenedAt: null,
            },
            workspacePathStatus: 'present',
            pendingRequests: [],
            turns: hasLiveTurn
              ? [
                  {
                    id: 'claude-turn-1',
                    startedAt: new Date().toISOString(),
                    status: 'inProgress',
                    error: null,
                    items: [
                      {
                        id: 'claude-turn-1:user',
                        kind: 'userMessage',
                        text: prompt,
                      },
                      {
                        id: 'assistant-live-1',
                        kind: 'agentMessage',
                        text: 'It looks like 9.',
                      },
                    ],
                  },
                ]
              : [
                  {
                    id: 'turn-0',
                    startedAt: new Date().toISOString(),
                    status: 'completed',
                    error: null,
                    items: [
                      {
                        id: 'previous-user',
                        kind: 'userMessage',
                        text: 'hello',
                      },
                    ],
                  },
                ],
          });
        }

        if (url.endsWith('/api/threads')) {
          return okJsonResponse([]);
        }

        return Promise.reject(new Error(`Unexpected request: ${url}`));
      }),
    );

    render(
      <MemoryRouter initialEntries={['/threads/thread-1']}>
        <Routes>
          <Route path="/threads/:id" element={<ThreadDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getAllByText('Claude Thread').length).toBeGreaterThan(0);
    });

    const editor = screen.getByLabelText('Prompt');
    setPromptValue(editor, prompt);
    fireEvent.click(screen.getByRole('button', { name: 'Send Prompt' }));
    emitSocketMessage(FakeWebSocket.instances[0]!, {
      type: 'thread.turn.started',
      threadId: 'thread-1',
      timestamp: new Date().toISOString(),
      payload: {
        turnId: 'claude-turn-1',
      },
    });

    await waitFor(() => {
      expect(screen.getByText('It looks like 9.')).toBeInTheDocument();
    });

    expect(screen.getAllByText(/What number is in the screenshot/)).toHaveLength(1);
    expect(screen.getByText('Turn 2')).toBeInTheDocument();
    expect(screen.queryByText('Turn 3')).not.toBeInTheDocument();
  });

  it('clears the optimistic photo turn when the persisted prompt uses rewritten attachment paths', async () => {
    const optimisticPrompt = 'What number is in the screenshot? [PHOTO camera.png]';
    const persistedPrompt =
      'What number is in the screenshot? [PHOTO ./.temp/threads/thread-1/image.png]';
    let detailRequestCount = 0;

    vi.stubGlobal(
      'fetch',
      withHealthz((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url.includes('/api/agent-runtimes/claude/status')) {
          return okJsonResponse(claudeBackendResponse);
        }

        if (url.includes('/api/agent-runtimes/claude/models')) {
          return okJsonResponse(claudeModelOptionsResponse);
        }

        if (url.endsWith('/api/threads/thread-1/prompt') && init?.method === 'POST') {
          return okJsonResponse({
            id: 'thread-1',
            workspaceId: 'workspace-1',
            provider: 'claude',
            providerSessionId: 'claude-session-1',
            source: 'supervisor',
            title: 'Claude Thread',
            model: 'sonnet',
            reasoningEffort: 'medium',
            collaborationMode: 'default',
            approvalMode: 'yolo',
            sandboxMode: 'danger-full-access',
            status: 'running',
            summaryText: persistedPrompt,
            lastError: null,
            activeTurnId: 'claude-turn-1',
            isLoaded: true,
            isPinned: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            lastTurnStartedAt: new Date().toISOString(),
            lastTurnCompletedAt: null,
          });
        }

        if (url.startsWith('/api/threads/thread-1?') || url.endsWith('/api/threads/thread-1')) {
          detailRequestCount += 1;
          const hasCompletedTurn = detailRequestCount > 1;
          return okJsonResponse({
            thread: {
              id: 'thread-1',
              workspaceId: 'workspace-1',
              provider: 'claude',
              providerSessionId: 'claude-session-1',
              source: 'supervisor',
              title: 'Claude Thread',
              model: 'sonnet',
              reasoningEffort: 'medium',
              collaborationMode: 'default',
              approvalMode: 'yolo',
              sandboxMode: 'danger-full-access',
              status: hasCompletedTurn ? 'idle' : 'idle',
              summaryText: hasCompletedTurn ? persistedPrompt : 'Preview',
              lastError: null,
              activeTurnId: null,
              isLoaded: true,
              isPinned: false,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              lastTurnStartedAt: hasCompletedTurn ? new Date().toISOString() : null,
              lastTurnCompletedAt: hasCompletedTurn ? new Date().toISOString() : null,
            },
            workspace: {
              id: 'workspace-1',
              hostId: 'host-1',
              label: 'Demo Workspace',
              absPath: '/tmp/demo',
              isFavorite: false,
              createdAt: new Date().toISOString(),
              lastOpenedAt: null,
            },
            workspacePathStatus: 'present',
            pendingRequests: [],
            turns: hasCompletedTurn
              ? [
                  {
                    id: 'claude-turn-1',
                    startedAt: new Date().toISOString(),
                    status: 'completed',
                    error: null,
                    items: [
                      {
                        id: 'claude-turn-1:user',
                        kind: 'userMessage',
                        text: persistedPrompt,
                      },
                      {
                        id: 'assistant-final-1',
                        kind: 'agentMessage',
                        text: 'The number is 9.',
                      },
                    ],
                  },
                ]
              : [],
          });
        }

        if (url.endsWith('/api/threads')) {
          return okJsonResponse([]);
        }

        return Promise.reject(new Error(`Unexpected request: ${url}`));
      }),
    );

    render(
      <MemoryRouter initialEntries={['/threads/thread-1']}>
        <Routes>
          <Route path="/threads/:id" element={<ThreadDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getAllByText('Claude Thread').length).toBeGreaterThan(0);
    });

    setPromptValue(screen.getByLabelText('Prompt'), optimisticPrompt);
    fireEvent.click(screen.getByRole('button', { name: 'Send Prompt' }));

    emitSocketMessage(FakeWebSocket.instances[0]!, {
      type: 'thread.turn.completed',
      threadId: 'thread-1',
      timestamp: new Date().toISOString(),
      payload: {
        turnId: 'claude-turn-1',
      },
    });

    await waitFor(() => {
      expect(screen.getByText('The number is 9.')).toBeInTheDocument();
    });

    expect(screen.queryByLabelText('Running')).not.toBeInTheDocument();
    expect(screen.getAllByText(/What number is in the screenshot/)).toHaveLength(1);
    expect(screen.getByAltText('image.png')).toBeInTheDocument();
  });

  it('clears the optimistic photo turn when Claude history returns only the prompt text', async () => {
    const optimisticPrompt = '图中文字是什么 [PHOTO camera.png]';
    let detailRequestCount = 0;

    vi.stubGlobal(
      'fetch',
      withHealthz((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url.includes('/api/agent-runtimes/claude/status')) {
          return okJsonResponse(claudeBackendResponse);
        }

        if (url.includes('/api/agent-runtimes/claude/models')) {
          return okJsonResponse(claudeModelOptionsResponse);
        }

        if (url.endsWith('/api/threads/thread-1/prompt') && init?.method === 'POST') {
          return okJsonResponse({
            id: 'thread-1',
            workspaceId: 'workspace-1',
            provider: 'claude',
            providerSessionId: 'claude-session-1',
            source: 'supervisor',
            title: 'Claude Thread',
            model: 'sonnet',
            reasoningEffort: 'medium',
            collaborationMode: 'default',
            approvalMode: 'yolo',
            sandboxMode: 'danger-full-access',
            status: 'running',
            summaryText: '图中文字是什么 [PHOTO ./.temp/threads/thread-1/image.png]',
            lastError: null,
            activeTurnId: 'claude-turn-1',
            isLoaded: true,
            isPinned: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            lastTurnStartedAt: new Date().toISOString(),
            lastTurnCompletedAt: null,
          });
        }

        if (url.startsWith('/api/threads/thread-1?') || url.endsWith('/api/threads/thread-1')) {
          detailRequestCount += 1;
          const hasCompletedTurn = detailRequestCount > 1;
          return okJsonResponse({
            thread: {
              id: 'thread-1',
              workspaceId: 'workspace-1',
              provider: 'claude',
              providerSessionId: 'claude-session-1',
              source: 'supervisor',
              title: 'Claude Thread',
              model: 'sonnet',
              reasoningEffort: 'medium',
              collaborationMode: 'default',
              approvalMode: 'yolo',
              sandboxMode: 'danger-full-access',
              status: hasCompletedTurn ? 'idle' : 'running',
              summaryText: '图中文字是什么',
              lastError: null,
              activeTurnId: hasCompletedTurn ? null : 'claude-turn-1',
              isLoaded: true,
              isPinned: false,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              lastTurnStartedAt: new Date().toISOString(),
              lastTurnCompletedAt: hasCompletedTurn ? new Date().toISOString() : null,
            },
            workspace: {
              id: 'workspace-1',
              hostId: 'host-1',
              label: 'Demo Workspace',
              absPath: '/tmp/demo',
              isFavorite: false,
              createdAt: new Date().toISOString(),
              lastOpenedAt: null,
            },
            workspacePathStatus: 'present',
            pendingRequests: [],
            turns: hasCompletedTurn
              ? [
                  {
                    id: 'claude-turn-1',
                    startedAt: new Date().toISOString(),
                    status: 'completed',
                    error: null,
                    items: [
                      {
                        id: 'claude-turn-1:user',
                        kind: 'userMessage',
                        text: '图中文字是什么',
                      },
                      {
                        id: 'assistant-final-1',
                        kind: 'agentMessage',
                        text: '图中文字是：完成。',
                      },
                    ],
                  },
                ]
              : [],
          });
        }

        if (url.endsWith('/api/threads')) {
          return okJsonResponse([]);
        }

        return Promise.reject(new Error(`Unexpected request: ${url}`));
      }),
    );

    render(
      <MemoryRouter initialEntries={['/threads/thread-1']}>
        <Routes>
          <Route path="/threads/:id" element={<ThreadDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getAllByText('Claude Thread').length).toBeGreaterThan(0);
    });

    setPromptValue(screen.getByLabelText('Prompt'), optimisticPrompt);
    fireEvent.click(screen.getByRole('button', { name: 'Send Prompt' }));

    emitSocketMessage(FakeWebSocket.instances[0]!, {
      type: 'thread.turn.completed',
      threadId: 'thread-1',
      timestamp: new Date().toISOString(),
      payload: {
        turnId: 'claude-turn-1',
      },
    });

    await waitFor(() => {
      expect(screen.getByText('图中文字是：完成。')).toBeInTheDocument();
    });

    expect(screen.queryByLabelText('Running')).not.toBeInTheDocument();
    expect(screen.getAllByText('图中文字是什么')).toHaveLength(1);
  });

  it('shows a steering bubble for prompts sent while the current turn is running', async () => {
    const startedAt = new Date(Date.UTC(2026, 3, 10, 0, 0, 0)).toISOString();
    const promptBodies: Array<Record<string, unknown>> = [];
    let resolvePromptRequest: (
      value:
        | { ok: true; json: () => Promise<Record<string, unknown>> }
        | PromiseLike<{ ok: true; json: () => Promise<Record<string, unknown>> }>
    ) => void = () => undefined;

    vi.stubGlobal(
      'fetch',
      withHealthz((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url.includes('/api/agent-runtimes/codex/status')) {
          return okJsonResponse(codexBackendResponse);
        }

        if (url.includes('/api/agent-runtimes/codex/models')) {
          return okJsonResponse(modelOptionsResponse);
        }

        if (url.endsWith('/api/threads')) {
          return okJsonResponse([
            {
              id: 'thread-1',
              workspaceId: 'workspace-1',
              providerSessionId: 'codex-1',
              source: 'supervisor',
              title: 'Demo Thread',
              model: 'gpt-5',
              reasoningEffort: 'medium',
              collaborationMode: 'default',
              approvalMode: 'yolo',
              status: 'running',
              summaryText: 'Original running prompt',
              lastError: null,
              activeTurnId: 'turn-1',
              isLoaded: true,
              isPinned: false,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              lastTurnStartedAt: startedAt,
              lastTurnCompletedAt: null,
            },
          ]);
        }

        if (url.endsWith('/api/threads/thread-1/prompt') && init?.method === 'POST') {
          promptBodies.push(JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>);
          return new Promise((resolve) => {
            resolvePromptRequest = resolve as typeof resolvePromptRequest;
          });
        }

        if (url.startsWith('/api/threads/thread-1?') || url.endsWith('/api/threads/thread-1')) {
          return okJsonResponse({
            thread: {
              id: 'thread-1',
              workspaceId: 'workspace-1',
              providerSessionId: 'codex-1',
              source: 'supervisor',
              title: 'Demo Thread',
              model: 'gpt-5',
              reasoningEffort: 'medium',
              collaborationMode: 'default',
              approvalMode: 'yolo',
              status: 'running',
              summaryText: 'Original running prompt',
              lastError: null,
              activeTurnId: 'turn-1',
              isLoaded: true,
              isPinned: false,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              lastTurnStartedAt: startedAt,
              lastTurnCompletedAt: null,
            },
            workspace: {
              id: 'workspace-1',
              hostId: 'host-1',
              label: 'Demo Workspace',
              absPath: '/tmp/demo',
              isFavorite: false,
              createdAt: new Date().toISOString(),
              lastOpenedAt: null,
            },
            workspacePathStatus: 'present',
            pendingRequests: [],
            pendingSteers: [],
            turns: [
              {
                id: 'turn-1',
                startedAt,
                status: 'inProgress',
                error: null,
                items: [
                  {
                    id: 'user-1',
                    kind: 'userMessage',
                    text: 'Original running prompt',
                  },
                ],
              },
            ],
          });
        }

        throw new Error(`Unhandled fetch request: ${url}`);
      }),
    );

    render(
      <MemoryRouter initialEntries={['/threads/thread-1']}>
        <Routes>
          <Route path="/threads/:id" element={<ThreadDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(
        screen.getAllByText('Demo Workspace / Demo Thread').length,
      ).toBeGreaterThan(0);
    });

    const editor = screen.getByLabelText('Prompt');
    setPromptValue(editor, 'Steer this running turn.');
    fireEvent.click(screen.getByRole('button', { name: 'Send Prompt' }));

    expect(screen.getAllByText('Steer this running turn.').length).toBeGreaterThan(0);
    expect(screen.getByText('Steering')).toBeInTheDocument();
    expect(screen.queryByLabelText('Sending')).not.toBeInTheDocument();

    resolvePromptRequest({
      ok: true,
      json: async () => ({
        id: 'thread-1',
        workspaceId: 'workspace-1',
        providerSessionId: 'codex-1',
        source: 'supervisor',
        title: 'Demo Thread',
        model: 'gpt-5',
        reasoningEffort: 'medium',
        collaborationMode: 'default',
        approvalMode: 'yolo',
        status: 'running',
        summaryText: 'Original running prompt',
        lastError: null,
        activeTurnId: 'turn-1',
        isLoaded: true,
        isPinned: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastTurnStartedAt: startedAt,
        lastTurnCompletedAt: null,
      }),
    });

    await waitFor(() => {
      expect(screen.queryByText('Steering')).not.toBeInTheDocument();
    });

    expect(promptBodies).toHaveLength(1);
    expect(promptBodies[0]?.prompt).toBe('Steer this running turn.');
    expect(typeof promptBodies[0]?.clientRequestId).toBe('string');
  });

  it('keeps the optimistic user bubble when a goal turn first materializes with only agent output', async () => {
    const startedAt = new Date(Date.UTC(2026, 3, 10, 0, 0, 0)).toISOString();
    const goalPrompt = 'Continue the active goal.';
    let detailRequestCount = 0;

    vi.stubGlobal(
      'fetch',
      withHealthz((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url.includes('/api/agent-runtimes/codex/status')) {
          return okJsonResponse(codexBackendResponse);
        }

        if (url.includes('/api/agent-runtimes/codex/models')) {
          return okJsonResponse(modelOptionsResponse);
        }

        if (url.endsWith('/api/threads')) {
          return okJsonResponse([
            {
              id: 'thread-1',
              workspaceId: 'workspace-1',
              providerSessionId: 'codex-1',
              source: 'supervisor',
              title: 'Demo Thread',
              model: 'gpt-5',
              reasoningEffort: 'medium',
              collaborationMode: 'default',
              approvalMode: 'yolo',
              status: 'idle',
              summaryText: 'Ready for goal work',
              lastError: null,
              activeTurnId: null,
              isLoaded: true,
              isPinned: false,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              lastTurnStartedAt: null,
              lastTurnCompletedAt: null,
            },
          ]);
        }

        if (url.endsWith('/api/threads/thread-1/prompt') && init?.method === 'POST') {
          return okJsonResponse({
            id: 'thread-1',
            workspaceId: 'workspace-1',
            providerSessionId: 'codex-1',
            source: 'supervisor',
            title: 'Demo Thread',
            model: 'gpt-5',
            reasoningEffort: 'medium',
            collaborationMode: 'default',
            approvalMode: 'yolo',
            status: 'running',
            summaryText: goalPrompt,
            lastError: null,
            activeTurnId: 'goal-turn-1',
            isLoaded: true,
            isPinned: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            lastTurnStartedAt: startedAt,
            lastTurnCompletedAt: null,
          });
        }

        if (url.startsWith('/api/threads/thread-1?') || url.endsWith('/api/threads/thread-1')) {
          detailRequestCount += 1;
          const hasAgentOnlyTurn = detailRequestCount > 1;

          return okJsonResponse({
            thread: {
              id: 'thread-1',
              workspaceId: 'workspace-1',
              providerSessionId: 'codex-1',
              source: 'supervisor',
              title: 'Demo Thread',
              model: 'gpt-5',
              reasoningEffort: 'medium',
              collaborationMode: 'default',
              approvalMode: 'yolo',
              status: hasAgentOnlyTurn ? 'running' : 'idle',
              summaryText: hasAgentOnlyTurn ? goalPrompt : 'Ready for goal work',
              lastError: null,
              activeTurnId: hasAgentOnlyTurn ? 'goal-turn-1' : null,
              isLoaded: true,
              isPinned: false,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              lastTurnStartedAt: hasAgentOnlyTurn ? startedAt : null,
              lastTurnCompletedAt: null,
            },
            workspace: {
              id: 'workspace-1',
              hostId: 'host-1',
              label: 'Demo Workspace',
              absPath: '/tmp/demo',
              isFavorite: false,
              createdAt: new Date().toISOString(),
              lastOpenedAt: null,
            },
            workspacePathStatus: 'present',
            pendingRequests: [],
            pendingSteers: [],
            goal: {
              threadId: 'thread-1',
              providerSessionId: 'codex-1',
              localGoalId: 'goal-1',
              objective: 'Keep working until done.',
              status: 'active',
              tokenBudget: null,
              tokensUsed: 100,
              timeUsedSeconds: 12,
              createdAt: startedAt,
              updatedAt: startedAt,
              completedAt: null,
            },
            goalHistory: [],
            turns: hasAgentOnlyTurn
              ? [
                  {
                    id: 'goal-turn-1',
                    startedAt,
                    status: 'inProgress',
                    error: null,
                    items: [
                      {
                        id: 'agent-goal-1',
                        kind: 'agentMessage',
                        text: 'I am continuing the goal now.',
                      },
                    ],
                  },
                ]
              : [],
          });
        }

        throw new Error(`Unhandled fetch request: ${url}`);
      }),
    );

    render(
      <MemoryRouter initialEntries={['/threads/thread-1']}>
        <Routes>
          <Route path="/threads/:id" element={<ThreadDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(
        screen.getAllByText('Demo Workspace / Demo Thread').length,
      ).toBeGreaterThan(0);
    });

    const editor = screen.getByLabelText('Prompt');
    setPromptValue(editor, goalPrompt);
    fireEvent.click(screen.getByRole('button', { name: 'Send Prompt' }));

    await waitFor(() => {
      expect(FakeWebSocket.instances.length).toBeGreaterThan(0);
    });
    emitSocketMessage(FakeWebSocket.instances[0]!, {
      type: 'thread.turn.started',
      threadId: 'thread-1',
      payload: {
        turnId: 'goal-turn-1',
      },
    });

    await screen.findByText('I am continuing the goal now.');

    const agentMessage = screen.getByText('I am continuing the goal now.');
    const userMessage = screen
      .getAllByText(goalPrompt)
      .find((element) => element.closest('article') === agentMessage.closest('article'));

    expect(userMessage).toBeDefined();
    expect(
      userMessage!.compareDocumentPosition(agentMessage) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('automatically connects the shell after switching from chat to shell', async () => {
    render(
      <MemoryRouter initialEntries={['/threads/thread-1']}>
        <Routes>
          <Route path="/threads/:id" element={<ThreadDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(
        screen.getByText('Demo Thread'),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Switch to shell' }));

    await waitFor(() => {
      expect(screen.getByTestId('mock-thread-shell-panel')).toBeInTheDocument();
      expect(shellPanelMock.toggleConnection).toHaveBeenCalledTimes(1);
    });
  });

  it('waits for shell attach before sending the first shell command', async () => {
    shellPanelMock.shellInputEnabled = false;
    shellPanelMock.toggleConnection.mockImplementation(async () => {
      shellPanelMock.shellInputEnabled = true;
    });

    render(
      <MemoryRouter initialEntries={['/threads/thread-1']}>
        <Routes>
          <Route path="/threads/:id" element={<ThreadDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('Demo Thread')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Switch to shell' }));
    await screen.findByTestId('mock-thread-shell-panel');

    const editor = screen.getAllByLabelText('Prompt').at(-1);
    expect(editor).toBeDefined();
    setPromptValue(editor!, 'pwd');
    const sendButton = screen.getAllByRole('button', { name: 'Send Shell Input' }).at(-1);
    expect(sendButton).toBeDefined();
    fireEvent.click(sendButton!);

    await waitFor(() => {
      expect(shellPanelMock.toggleConnection).toHaveBeenCalled();
      expect(shellPanelMock.sendCommand).toHaveBeenCalledWith('pwd');
    });
  });

  it('does not auto-connect the shell after switching views while the thread is disconnected', async () => {
    vi.stubGlobal(
      'fetch',
      withHealthz((input: RequestInfo | URL) => {
        const url = String(input);

        if (url.includes('/api/agent-runtimes/codex/status')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              state: 'ready',
              transport: 'stdio',
              lastStartedAt: new Date().toISOString(),
              lastError: null,
              restartCount: 0,
            }),
          });
        }

        if (url.includes('/api/agent-runtimes/codex/models')) {
          return Promise.resolve({
            ok: true,
            json: async () => modelOptionsResponse,
          });
        }

        if (url.startsWith('/api/threads/thread-1?') || url.endsWith('/api/threads/thread-1')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              thread: {
                id: 'thread-1',
                workspaceId: 'workspace-1',
                providerSessionId: 'codex-1',
                source: 'supervisor',
                title: 'Demo Thread',
                model: 'gpt-5',
                reasoningEffort: 'medium',
                collaborationMode: 'default',
                approvalMode: 'yolo',
                status: 'idle',
                summaryText: 'Preview',
                lastError: null,
                activeTurnId: null,
                isLoaded: false,
                isPinned: false,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                lastTurnStartedAt: null,
                lastTurnCompletedAt: null,
              },
              workspace: {
                id: 'workspace-1',
                hostId: 'host-1',
                label: 'Demo Workspace',
                absPath: '/tmp/demo',
                isFavorite: false,
                createdAt: new Date().toISOString(),
                lastOpenedAt: null,
              },
              workspacePathStatus: 'present',
              pendingRequests: [],
              turns: [],
            }),
          });
        }

        if (url.endsWith('/api/threads')) {
          return Promise.resolve({
            ok: true,
            json: async () => [
              {
                id: 'thread-1',
                workspaceId: 'workspace-1',
                providerSessionId: 'codex-1',
                source: 'supervisor',
                title: 'Demo Thread',
                model: 'gpt-5',
                reasoningEffort: 'medium',
                collaborationMode: 'default',
                approvalMode: 'yolo',
                status: 'idle',
                summaryText: 'Preview',
                lastError: null,
                activeTurnId: null,
                isLoaded: false,
                isPinned: false,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                lastTurnStartedAt: null,
                lastTurnCompletedAt: null,
              },
            ],
          });
        }

        throw new Error(`Unhandled fetch request: ${url}`);
      }),
    );

    render(
      <MemoryRouter initialEntries={['/threads/thread-1']}>
        <Routes>
          <Route path="/threads/:id" element={<ThreadDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(
        screen.getByText('Demo Thread'),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Switch to shell' }));

    await waitFor(() => {
      expect(
        screen.getByText('Reconnect this thread before creating or attaching a shell.'),
      ).toBeInTheDocument();
    });

    expect(shellPanelMock.toggleConnection).not.toHaveBeenCalled();
  });

  it('does not render the imported-session warning card after connection', async () => {
    vi.stubGlobal(
      'fetch',
      withHealthz((input: RequestInfo | URL) => {
        const url = String(input);

        if (url.includes('/api/agent-runtimes/codex/status')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              state: 'ready',
              transport: 'stdio',
              lastStartedAt: new Date().toISOString(),
              lastError: null,
              restartCount: 0,
            }),
          });
        }

        if (url.includes('/api/agent-runtimes/codex/models')) {
          return Promise.resolve({
            ok: true,
            json: async () => modelOptionsResponse,
          });
        }

        if (
          url.startsWith('/api/threads/connected-imported-thread?') ||
          url.endsWith('/api/threads/connected-imported-thread')
        ) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              thread: {
                id: 'connected-imported-thread',
                workspaceId: 'workspace-1',
                providerSessionId: '019d6fb7-7033-7a30-a2c7-74d0919e87d4',
                source: 'local_codex_import',
                title: 'Connected Imported Thread',
                model: 'gpt-5.4',
                reasoningEffort: 'medium',
                collaborationMode: 'default',
                approvalMode: 'yolo',
                status: 'idle',
                summaryText: 'Imported preview',
                lastError: null,
                activeTurnId: null,
                isLoaded: true,
                isPinned: false,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                lastTurnStartedAt: null,
                lastTurnCompletedAt: null,
              },
              workspace: {
                id: 'workspace-1',
                hostId: 'host-1',
                label: 'Imported Workspace',
                absPath: '/tmp/imported-project',
                isFavorite: false,
                createdAt: new Date().toISOString(),
                lastOpenedAt: null,
              },
              workspacePathStatus: 'present',
              pendingRequests: [],
              turns: [],
            }),
          });
        }

        if (url.endsWith('/api/threads')) {
          return Promise.resolve({
            ok: true,
            json: async () => [
              {
                id: 'connected-imported-thread',
                workspaceId: 'workspace-1',
                providerSessionId: '019d6fb7-7033-7a30-a2c7-74d0919e87d4',
                source: 'local_codex_import',
                title: 'Connected Imported Thread',
                model: 'gpt-5.4',
                reasoningEffort: 'medium',
                collaborationMode: 'default',
                approvalMode: 'yolo',
                status: 'idle',
                summaryText: 'Imported preview',
                lastError: null,
                activeTurnId: null,
                isLoaded: true,
                isPinned: false,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                lastTurnStartedAt: null,
                lastTurnCompletedAt: null,
              },
            ],
          });
        }

        return Promise.reject(new Error(`Unexpected request: ${url}`));
      }),
    );

    render(
      <MemoryRouter initialEntries={['/threads/connected-imported-thread']}>
        <Routes>
          <Route path="/threads/:id" element={<ThreadDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(
        screen.getByText('Connected Imported Thread'),
      ).toBeInTheDocument();
    });

    expect(
      screen.queryByText(/History is available immediately\. Click Resume \/ Connect before sending a new prompt\./i),
    ).not.toBeInTheDocument();
  });

  it('replaces a dismissed plan decision with a compact user note when staying in plan mode', async () => {
    vi.stubGlobal(
      'fetch',
      withHealthz((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url.includes('/api/agent-runtimes/codex/status')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              state: 'ready',
              transport: 'stdio',
              lastStartedAt: new Date().toISOString(),
              lastError: null,
              restartCount: 0,
            }),
          });
        }

        if (url.includes('/api/agent-runtimes/codex/models')) {
          return Promise.resolve({
            ok: true,
            json: async () => modelOptionsResponse,
          });
        }

        if (
          url.endsWith('/api/threads/thread-1/requests/plan-decision-1/respond') &&
          init?.method === 'POST'
        ) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              thread: {
                id: 'thread-1',
                workspaceId: 'workspace-1',
                providerSessionId: 'codex-1',
                source: 'supervisor',
                title: 'Demo Thread',
                model: 'gpt-5',
                reasoningEffort: 'medium',
                collaborationMode: 'plan',
                approvalMode: 'yolo',
                status: 'idle',
                summaryText: 'Preview',
                lastError: null,
                activeTurnId: null,
                isLoaded: true,
                isPinned: false,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                lastTurnStartedAt: new Date().toISOString(),
                lastTurnCompletedAt: new Date().toISOString(),
              },
              workspace: {
                id: 'workspace-1',
                hostId: 'host-1',
                label: 'Demo Workspace',
                absPath: '/tmp/demo',
                isFavorite: false,
                createdAt: new Date().toISOString(),
                lastOpenedAt: null,
              },
              workspacePathStatus: 'present',
              pendingRequests: [],
              turns: [],
            }),
          });
        }

        if (url.startsWith('/api/threads/thread-1?') || url.endsWith('/api/threads/thread-1')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              thread: {
                id: 'thread-1',
                workspaceId: 'workspace-1',
                providerSessionId: 'codex-1',
                source: 'supervisor',
                title: 'Demo Thread',
                model: 'gpt-5',
                reasoningEffort: 'medium',
                collaborationMode: 'plan',
                approvalMode: 'yolo',
                status: 'idle',
                summaryText: 'Preview',
                lastError: null,
                activeTurnId: null,
                isLoaded: true,
                isPinned: false,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                lastTurnStartedAt: new Date().toISOString(),
                lastTurnCompletedAt: new Date().toISOString(),
              },
              workspace: {
                id: 'workspace-1',
                hostId: 'host-1',
                label: 'Demo Workspace',
                absPath: '/tmp/demo',
                isFavorite: false,
                createdAt: new Date().toISOString(),
                lastOpenedAt: null,
              },
              workspacePathStatus: 'present',
              pendingRequests: [
                {
                  id: 'plan-decision-1',
                  kind: 'planDecision',
                  title: 'Plan ready',
                  description: 'Review the plan and choose the next step.',
                  turnId: 'turn-1',
                  itemId: null,
                  createdAt: new Date().toISOString(),
                  questions: [
                    {
                      id: 'plan-decision',
                      header: 'Next step',
                      question: 'Choose whether to implement the plan now.',
                      isOther: false,
                      isSecret: false,
                      options: [
                        {
                          label: 'Implement',
                          description: 'Exit plan mode and continue immediately.',
                        },
                        {
                          label: 'Stay in plan mode',
                          description: 'Keep refining the plan.',
                        },
                      ],
                    },
                  ],
                },
              ],
              answeredRequestNotes: [],
              turns: [],
            }),
          });
        }

        if (url.endsWith('/api/threads')) {
          return Promise.resolve({
            ok: true,
            json: async () => [],
          });
        }

        throw new Error(`Unhandled fetch request: ${url}`);
      }),
    );

    render(
      <MemoryRouter initialEntries={['/threads/thread-1']}>
        <Routes>
          <Route path="/threads/:id" element={<ThreadDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('Plan', { selector: 'p' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Stay in plan mode' }));

    await waitFor(() => {
      expect(screen.queryByText('Plan', { selector: 'p' })).not.toBeInTheDocument();
    });
  });

  it('keeps a compact local note after answering requestUserInput questions', async () => {
    vi.spyOn(global, 'fetch').mockImplementation((input, init) => {
      const url = String(input);

      if (url.endsWith('/api/agent-runtimes/codex/models')) {
        return Promise.resolve({
          ok: true,
          json: async () => modelOptionsResponse,
        } as Response);
      }

      if (url.endsWith('/api/agent-runtimes/codex/status')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            connected: true,
            version: 'test',
            cwd: '/tmp/demo',
          }),
        } as Response);
      }

      if (
        url.includes('/api/threads/thread-1') &&
        (!init?.method || init.method === 'GET')
      ) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            totalTurnCount: 0,
            thread: {
              id: 'thread-1',
              workspaceId: 'workspace-1',
              providerSessionId: 'codex-1',
              source: 'supervisor',
              title: 'Demo Thread',
              model: 'gpt-5',
              reasoningEffort: 'medium',
              collaborationMode: 'plan',
              approvalMode: 'yolo',
              status: 'idle',
              summaryText: 'Preview',
              lastError: null,
              activeTurnId: null,
              isLoaded: true,
              isPinned: false,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              lastTurnStartedAt: new Date().toISOString(),
              lastTurnCompletedAt: new Date().toISOString(),
            },
            workspace: {
              id: 'workspace-1',
              hostId: 'host-1',
              label: 'Demo Workspace',
              absPath: '/tmp/demo',
              isFavorite: false,
              createdAt: new Date().toISOString(),
              lastOpenedAt: null,
            },
            workspacePathStatus: 'present',
            pendingRequests: [
              {
                id: 'user-input-1',
                kind: 'requestUserInput',
                title: 'Planning Preferences',
                description: 'Pick how the plan should be structured.',
                turnId: 'turn-1',
                itemId: 'item-1',
                createdAt: new Date().toISOString(),
                questions: [
                  {
                    id: 'plan-object',
                    header: 'Plan object',
                    question: 'What should this plan focus on?',
                    isOther: false,
                    isSecret: false,
                    options: [
                      {
                        label: 'foundation',
                        description: 'Focus on setup work.',
                      },
                      {
                        label: 'delivery',
                        description: 'Focus on feature delivery.',
                      },
                    ],
                  },
                ],
              },
            ],
            turns: [],
          }),
        } as Response);
      }

      if (url.endsWith('/api/threads/thread-1/requests/user-input-1/respond')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            totalTurnCount: 0,
            thread: {
              id: 'thread-1',
              workspaceId: 'workspace-1',
              providerSessionId: 'codex-1',
              source: 'supervisor',
              title: 'Demo Thread',
              model: 'gpt-5',
              reasoningEffort: 'medium',
              collaborationMode: 'plan',
              approvalMode: 'yolo',
              status: 'idle',
              summaryText: 'Preview',
              lastError: null,
              activeTurnId: null,
              isLoaded: true,
              isPinned: false,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              lastTurnStartedAt: new Date().toISOString(),
              lastTurnCompletedAt: new Date().toISOString(),
            },
            workspace: {
              id: 'workspace-1',
              hostId: 'host-1',
              label: 'Demo Workspace',
              absPath: '/tmp/demo',
              isFavorite: false,
              createdAt: new Date().toISOString(),
              lastOpenedAt: null,
            },
            workspacePathStatus: 'present',
            pendingRequests: [],
            answeredRequestNotes: [
              {
                id: 'user-input-1',
                turnId: 'turn-1',
                title: 'Answer Required',
                summaryLines: ['Plan object: foundation'],
                createdAt: new Date().toISOString(),
              },
            ],
            turns: [],
          }),
        } as Response);
      }

      if (url.endsWith('/api/threads')) {
        return Promise.resolve({
          ok: true,
          json: async () => [],
        } as Response);
      }

      throw new Error(`Unhandled fetch request: ${url}`);
    });

    render(
      <MemoryRouter initialEntries={['/threads/thread-1']}>
        <Routes>
          <Route path="/threads/:id" element={<ThreadDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('Answer Required', { selector: 'p' })).toBeInTheDocument();
      expect(screen.getByText('What should this plan focus on?')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'foundation' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => {
      expect(
        screen.getByText('You selected Plan object: foundation'),
      ).toBeInTheDocument();
    });

    expect(screen.queryByText('What should this plan focus on?')).not.toBeInTheDocument();
  });

  it('keeps the latest pending request card when older detail fetches resolve later', async () => {
    let detailCallCount = 0;
    type DeferredResponse = {
      ok: true;
      json: () => Promise<unknown>;
    };
    let resolveFirstDetail: ((value: DeferredResponse) => void) | null = null;

    vi.stubGlobal(
      'fetch',
      withHealthz((input: RequestInfo | URL) => {
        const url = String(input);

        if (url.includes('/api/agent-runtimes/codex/status')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              state: 'ready',
              transport: 'stdio',
              lastStartedAt: new Date().toISOString(),
              lastError: null,
              restartCount: 0,
            }),
          });
        }

        if (url.includes('/api/agent-runtimes/codex/models')) {
          return Promise.resolve({
            ok: true,
            json: async () => modelOptionsResponse,
          });
        }

        if (url.endsWith('/api/threads')) {
          return Promise.resolve({
            ok: true,
            json: async () => [
              {
                id: 'thread-1',
                workspaceId: 'workspace-1',
                providerSessionId: 'codex-1',
                source: 'supervisor',
                title: 'Demo Thread',
                model: 'gpt-5',
                reasoningEffort: 'medium',
                collaborationMode: 'plan',
                approvalMode: 'yolo',
                status: 'running',
                summaryText: null,
                lastError: null,
                activeTurnId: 'turn-1',
                isLoaded: true,
                isPinned: false,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                lastTurnStartedAt: new Date().toISOString(),
                lastTurnCompletedAt: null,
              },
            ],
          });
        }

        if (url.startsWith('/api/threads/thread-1?') || url.endsWith('/api/threads/thread-1')) {
          detailCallCount += 1;

          if (detailCallCount === 1) {
            return new Promise((resolve) => {
              resolveFirstDetail = resolve;
            });
          }

          return Promise.resolve({
            ok: true,
            json: async () => ({
              thread: {
                id: 'thread-1',
                workspaceId: 'workspace-1',
                providerSessionId: 'codex-1',
                source: 'supervisor',
                title: 'Demo Thread',
                model: 'gpt-5',
                reasoningEffort: 'medium',
                collaborationMode: 'plan',
                approvalMode: 'yolo',
                status: 'running',
                summaryText: 'Preview',
                lastError: null,
                activeTurnId: 'turn-1',
                isLoaded: true,
                isPinned: false,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                lastTurnStartedAt: new Date().toISOString(),
                lastTurnCompletedAt: null,
              },
              workspace: {
                id: 'workspace-1',
                hostId: 'host-1',
                label: 'Demo Workspace',
                absPath: '/tmp/demo',
                isFavorite: false,
                createdAt: new Date().toISOString(),
                lastOpenedAt: null,
              },
              workspacePathStatus: 'present',
              pendingRequests: [
                {
                  id: 'request-2',
                  kind: 'requestUserInput',
                  title: 'Need another choice',
                  description: 'Second round question',
                  turnId: 'turn-1',
                  itemId: 'item-2',
                  createdAt: new Date().toISOString(),
                  questions: [
                    {
                      id: 'question-2',
                      header: 'Follow-up',
                      question: 'Choose the next step',
                      isOther: true,
                      isSecret: false,
                      options: [
                        { label: 'Option A', description: 'A' },
                        { label: 'Option B', description: 'B' },
                      ],
                    },
                  ],
                },
              ],
              turns: [],
            }),
          });
        }

        return Promise.reject(new Error(`Unexpected request: ${url}`));
      }),
    );

    render(
      <MemoryRouter initialEntries={['/threads/thread-1']}>
        <Routes>
          <Route path="/threads/:id" element={<ThreadDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(FakeWebSocket.instances[0]).toBeDefined();
    emitSocketMessage(FakeWebSocket.instances[0]!, {
      type: 'thread.request.created',
      threadId: 'thread-1',
      timestamp: new Date().toISOString(),
      payload: {
        request: {
          id: 'request-2',
        },
      },
    });

    await waitFor(() => {
      expect(screen.getByText('Answer Required', { selector: 'p' })).toBeInTheDocument();
      expect(screen.getByText('Choose the next step')).toBeInTheDocument();
    });

    const firstDetailResolver = resolveFirstDetail as
      | ((value: DeferredResponse) => void)
      | null;
    if (firstDetailResolver) {
      firstDetailResolver({
        ok: true,
        json: async () => ({
          thread: {
            id: 'thread-1',
            workspaceId: 'workspace-1',
            providerSessionId: 'codex-1',
            source: 'supervisor',
            title: 'Demo Thread',
            model: 'gpt-5',
            reasoningEffort: 'medium',
            collaborationMode: 'plan',
            approvalMode: 'yolo',
            status: 'running',
            summaryText: 'Preview',
            lastError: null,
            activeTurnId: 'turn-1',
            isLoaded: true,
            isPinned: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            lastTurnStartedAt: new Date().toISOString(),
            lastTurnCompletedAt: null,
          },
          workspace: {
            id: 'workspace-1',
            hostId: 'host-1',
            label: 'Demo Workspace',
            absPath: '/tmp/demo',
            isFavorite: false,
            createdAt: new Date().toISOString(),
            lastOpenedAt: null,
          },
          workspacePathStatus: 'present',
          pendingRequests: [],
          turns: [],
        }),
      });
    }

    await waitFor(() => {
      expect(screen.getByText('Answer Required', { selector: 'p' })).toBeInTheDocument();
      expect(screen.getByText('Choose the next step')).toBeInTheDocument();
    });
  });

  it('polls active thread detail so completed replies appear even without websocket events', async () => {
    let detailCallCount = 0;
    const intervalCallbacks = new Map<number, () => void>();
    let nextIntervalId = 1;

    vi.spyOn(window, 'setInterval').mockImplementation(
      ((callback: TimerHandler) => {
        const id = nextIntervalId;
        nextIntervalId += 1;
        intervalCallbacks.set(id, callback as () => void);
        return id as unknown as number;
      }) as typeof window.setInterval,
    );
    vi.spyOn(window, 'clearInterval').mockImplementation(
      ((id: number) => {
        intervalCallbacks.delete(Number(id));
      }) as typeof window.clearInterval,
    );

    vi.stubGlobal(
      'fetch',
      withHealthz(async (input: RequestInfo | URL) => {
        const url = String(input);

        if (url.endsWith('/api/threads')) {
          return {
            ok: true,
            json: async () => [
              {
                id: 'thread-1',
                workspaceId: 'workspace-1',
                providerSessionId: 'codex-1',
                source: 'supervisor',
                title: 'Demo Thread',
                model: 'gpt-5',
                reasoningEffort: 'medium',
                collaborationMode: 'default',
                approvalMode: 'yolo',
                status: 'running',
                summaryText: 'Explain the failure',
                lastError: null,
                activeTurnId: 'turn-1',
                isLoaded: true,
                isPinned: false,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                lastTurnStartedAt: new Date().toISOString(),
                lastTurnCompletedAt: null,
              },
            ],
          };
        }

        if (url.endsWith('/api/agent-runtimes/codex/status')) {
          return {
            ok: true,
            json: async () => ({
              command: 'codex',
              args: [],
              cwd: '/tmp/project',
              transport: 'stdio',
            }),
          };
        }

        if (url.endsWith('/api/agent-runtimes/codex/models')) {
          return {
            ok: true,
            json: async () => modelOptionsResponse,
          };
        }

        if (url.startsWith('/api/threads/thread-1?') || url.endsWith('/api/threads/thread-1')) {
          detailCallCount += 1;
          const completed = detailCallCount >= 2;

          return {
            ok: true,
            json: async () => ({
              thread: {
                id: 'thread-1',
                workspaceId: 'workspace-1',
                providerSessionId: 'codex-1',
                source: 'supervisor',
                title: 'Demo Thread',
                model: 'gpt-5',
                reasoningEffort: 'medium',
                collaborationMode: 'default',
                approvalMode: 'yolo',
                status: completed ? 'idle' : 'running',
                summaryText: 'Explain the failure',
                lastError: null,
                activeTurnId: completed ? null : 'turn-1',
                isLoaded: true,
                isPinned: false,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                lastTurnStartedAt: new Date().toISOString(),
                lastTurnCompletedAt: completed ? new Date().toISOString() : null,
              },
              workspace: {
                id: 'workspace-1',
                hostId: 'host-1',
                label: 'Demo Workspace',
                absPath: '/tmp/project',
                isFavorite: false,
                createdAt: new Date().toISOString(),
                lastOpenedAt: new Date().toISOString(),
              },
              workspacePathStatus: 'present',
              pendingRequests: [],
              totalTurnCount: 1,
              turns: [
                {
                  id: 'turn-1',
                  startedAt: new Date().toISOString(),
                  status: completed ? 'completed' : 'inProgress',
                  error: null,
                  items: completed
                    ? [
                        {
                          id: 'user-1',
                          kind: 'userMessage',
                          text: 'Explain the failure',
                        },
                        {
                          id: 'agent-1',
                          kind: 'agentMessage',
                          text: 'The build failed because the API never restarted after the socket dropped.',
                        },
                      ]
                    : [
                        {
                          id: 'user-1',
                          kind: 'userMessage',
                          text: 'Explain the failure',
                        },
                      ],
                },
              ],
            }),
          };
        }

        return Promise.reject(new Error(`Unexpected request: ${url}`));
      }),
    );

    render(
      <MemoryRouter initialEntries={['/threads/thread-1']}>
        <Routes>
          <Route path="/threads/:id" element={<ThreadDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('Explain the failure')).toBeInTheDocument();
    });

    expect(
      screen.queryByText(
        'The build failed because the API never restarted after the socket dropped.',
      ),
    ).not.toBeInTheDocument();
    expect(intervalCallbacks.size).toBeGreaterThan(0);

    await act(async () => {
      const callback = Array.from(intervalCallbacks.values()).at(-1);
      expect(callback).toBeTypeOf('function');
      if (typeof callback === 'function') {
        callback();
      }
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(
        screen.getByText(
          'The build failed because the API never restarted after the socket dropped.',
        ),
      ).toBeInTheDocument();
    });
  });

  it('surfaces realtime connection status transitions in the mobile header', async () => {
    render(
      <MemoryRouter initialEntries={['/threads/thread-1']}>
        <Routes>
          <Route path="/threads/:id" element={<ThreadDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByLabelText('Realtime updates reconnecting')).toBeInTheDocument();
    });

    expect(FakeWebSocket.instances).toHaveLength(1);

    await act(async () => {
      emitSocketEvent(FakeWebSocket.instances[0]!, 'open');
      emitSocketMessage(FakeWebSocket.instances[0]!, {
        type: 'supervisor.pong',
        timestamp: new Date().toISOString(),
        payload: {
          requestTimestamp: new Date().toISOString(),
        },
      });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByLabelText('Realtime updates connected')).toBeInTheDocument();
    });

    await act(async () => {
      emitSocketEvent(FakeWebSocket.instances[0]!, 'close');
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByLabelText('Realtime updates reconnecting')).toBeInTheDocument();
    });

    await act(async () => {
      window.dispatchEvent(new Event('offline'));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByLabelText('Browser offline')).toBeInTheDocument();
    });
  });

  it('deduplicates the current goal against persisted goal history in the monitor', async () => {
    const createdAt = '2026-05-08T20:00:00.000Z';
    vi.stubGlobal(
      'fetch',
      withHealthz((input: RequestInfo | URL) => {
        const url = String(input);

        if (url.includes('/api/agent-runtimes/codex/status')) {
          return okJsonResponse(codexBackendResponse);
        }

        if (url.includes('/api/agent-runtimes/codex/models')) {
          return okJsonResponse(modelOptionsResponse);
        }

        if (url.endsWith('/api/threads/thread-1/goal')) {
          return okJsonResponse({
            threadId: 'codex-1',
            localGoalId: null,
            objective: '现在审查/home/u/dev/EIAgente/references/EI...',
            status: 'active',
            tokenBudget: null,
            tokensUsed: 6100,
            timeUsedSeconds: 0,
            createdAt,
            updatedAt: '2026-05-08T20:12:01.000Z',
            completedAt: null,
          });
        }

        if (url.startsWith('/api/threads/thread-1?') || url.endsWith('/api/threads/thread-1')) {
          return okJsonResponse({
            thread: {
              id: 'thread-1',
              workspaceId: 'workspace-1',
              providerSessionId: 'codex-1',
              source: 'supervisor',
              title: 'Demo Thread',
              model: 'gpt-5',
              reasoningEffort: 'medium',
              collaborationMode: 'default',
              approvalMode: 'yolo',
              status: 'idle',
              summaryText: 'Preview',
              lastError: null,
              activeTurnId: null,
              isLoaded: true,
              isPinned: false,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              lastTurnStartedAt: null,
              lastTurnCompletedAt: null,
            },
            workspace: {
              id: 'workspace-1',
              hostId: 'host-1',
              label: 'Demo Workspace',
              absPath: '/tmp/demo',
              isFavorite: false,
              createdAt: new Date().toISOString(),
              lastOpenedAt: null,
            },
            workspacePathStatus: 'present',
            pendingRequests: [],
            turns: [],
            goal: {
              threadId: 'codex-1',
              localGoalId: null,
              objective: '现在审查/home/u/dev/EIAgente/references/EI...',
              status: 'complete',
              tokenBudget: null,
              tokensUsed: 6100,
              timeUsedSeconds: 0,
              createdAt,
              updatedAt: '2026-05-08T20:12:00.000Z',
              completedAt: '2026-05-08T20:12:00.000Z',
            },
            goalHistory: [
              {
                threadId: 'codex-1',
                localGoalId: 'local-goal-1',
                objective: '现在审查/home/u/dev/EIAgente/references/EI...',
                status: 'active',
                tokenBudget: null,
                tokensUsed: 6100,
                timeUsedSeconds: 0,
                createdAt,
                updatedAt: '2026-05-08T20:12:01.000Z',
                completedAt: null,
              },
            ],
          });
        }

        if (url.endsWith('/api/threads')) {
          return okJsonResponse([]);
        }

        return Promise.reject(new Error(`Unexpected request: ${url}`));
      }),
    );

    render(
      <MemoryRouter initialEntries={['/threads/thread-1']}>
        <Routes>
          <Route path="/threads/:id" element={<ThreadDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getAllByLabelText('Open goal monitor').length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getAllByLabelText('Open goal monitor')[0]!);

    await waitFor(() => {
      expect(screen.getByText('Goal monitor')).toBeInTheDocument();
    });
    expect(
      screen.getAllByText('现在审查/home/u/dev/EIAgente/references/EI...'),
    ).toHaveLength(1);
  });

  it('merges realtime per-turn token usage updates into the visible timeline', async () => {
    vi.stubGlobal(
      'fetch',
      withHealthz((input: RequestInfo | URL) => {
        const url = String(input);

        if (url.includes('/api/agent-runtimes/codex/status')) {
          return okJsonResponse({
            state: 'ready',
            transport: 'stdio',
            lastStartedAt: new Date().toISOString(),
            lastError: null,
            restartCount: 0,
          });
        }

        if (url.includes('/api/agent-runtimes/codex/models')) {
          return okJsonResponse(modelOptionsResponse);
        }

        if (url.startsWith('/api/threads/thread-1?') || url.endsWith('/api/threads/thread-1')) {
          return okJsonResponse({
            thread: {
              id: 'thread-1',
              workspaceId: 'workspace-1',
              providerSessionId: 'codex-1',
              source: 'supervisor',
              title: 'Demo Thread',
              model: 'gpt-5.4',
              reasoningEffort: 'high',
              collaborationMode: 'default',
              approvalMode: 'yolo',
              status: 'running',
              summaryText: 'Explain the failure',
              lastError: null,
              activeTurnId: 'turn-1',
              isLoaded: true,
              isPinned: false,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              lastTurnStartedAt: new Date().toISOString(),
              lastTurnCompletedAt: null,
            },
            workspace: {
              id: 'workspace-1',
              hostId: 'host-1',
              label: 'Demo Workspace',
              absPath: '/tmp/demo',
              isFavorite: false,
              createdAt: new Date().toISOString(),
              lastOpenedAt: null,
            },
            workspacePathStatus: 'present',
            pendingRequests: [],
            turns: [
              {
                id: 'turn-1',
                startedAt: new Date().toISOString(),
                status: 'inProgress',
                error: null,
                model: 'gpt-5.4',
                reasoningEffort: 'high',
                reasoningEffortAvailable: true,
                items: [
                  {
                    id: 'user-1',
                    kind: 'userMessage',
                    text: 'Explain the failure',
                  },
                ],
              },
            ],
          });
        }

        if (url.endsWith('/api/threads')) {
          return okJsonResponse([
            {
              id: 'thread-1',
              workspaceId: 'workspace-1',
              providerSessionId: 'codex-1',
              source: 'supervisor',
              title: 'Demo Thread',
              model: 'gpt-5.4',
              reasoningEffort: 'high',
              collaborationMode: 'default',
              approvalMode: 'yolo',
              status: 'running',
              summaryText: 'Explain the failure',
              lastError: null,
              activeTurnId: 'turn-1',
              isLoaded: true,
              isPinned: false,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              lastTurnStartedAt: new Date().toISOString(),
              lastTurnCompletedAt: null,
            },
          ]);
        }

        return Promise.reject(new Error(`Unexpected request: ${url}`));
      }),
    );

    render(
      <MemoryRouter initialEntries={['/threads/thread-1']}>
        <Routes>
          <Route path="/threads/:id" element={<ThreadDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('Explain the failure')).toBeInTheDocument();
    });

    await act(async () => {
      emitSocketMessage(FakeWebSocket.instances[0]!, {
        type: 'thread.turn.token.updated',
        threadId: 'thread-1',
        timestamp: new Date().toISOString(),
        payload: {
          turnId: 'turn-1',
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
            pricingModelKey: 'gpt-5.4',
            pricingTierKey: 'standard',
            currency: 'USD',
            inputUsd: 0.025,
            cachedInputUsd: 0.0005,
            outputUsd: 0.0636,
            totalUsd: 0.0891,
          },
        },
      });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getAllByText('gpt-5.4 · high').length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText('$0.089').length).toBeGreaterThan(0);
  });

  it('shows a gray connect button in the mobile header for detached threads and reconnects on click', async () => {
    vi.stubGlobal(
      'fetch',
      withHealthz((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url.includes('/api/agent-runtimes/codex/status')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              state: 'ready',
              transport: 'stdio',
              lastStartedAt: new Date().toISOString(),
              lastError: null,
              restartCount: 0,
            }),
          });
        }

        if (url.includes('/api/agent-runtimes/codex/models')) {
          return Promise.resolve({
            ok: true,
            json: async () => modelOptionsResponse,
          });
        }

        if (url.endsWith('/api/threads/thread-1/resume') && init?.method === 'POST') {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              thread: {
                id: 'thread-1',
                workspaceId: 'workspace-1',
                providerSessionId: 'codex-1',
                source: 'supervisor',
                title: 'Demo Thread',
                model: 'gpt-5',
                reasoningEffort: 'medium',
                collaborationMode: 'default',
                approvalMode: 'yolo',
                status: 'idle',
                summaryText: 'Preview',
                lastError: null,
                activeTurnId: null,
                isLoaded: true,
                isPinned: false,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                lastTurnStartedAt: null,
                lastTurnCompletedAt: null,
              },
              workspace: {
                id: 'workspace-1',
                hostId: 'host-1',
                label: 'Demo Workspace',
                absPath: '/tmp/demo',
                isFavorite: false,
                createdAt: new Date().toISOString(),
                lastOpenedAt: null,
              },
              workspacePathStatus: 'present',
              pendingRequests: [],
              turns: [],
            }),
          });
        }

        if (url.startsWith('/api/threads/thread-1?') || url.endsWith('/api/threads/thread-1')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              thread: {
                id: 'thread-1',
                workspaceId: 'workspace-1',
                providerSessionId: 'codex-1',
                source: 'supervisor',
                title: 'Demo Thread',
                model: 'gpt-5',
                reasoningEffort: 'medium',
                collaborationMode: 'default',
                approvalMode: 'yolo',
                status: 'idle',
                summaryText: 'Preview',
                lastError: null,
                activeTurnId: null,
                isLoaded: false,
                isPinned: false,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                lastTurnStartedAt: null,
                lastTurnCompletedAt: null,
              },
              workspace: {
                id: 'workspace-1',
                hostId: 'host-1',
                label: 'Demo Workspace',
                absPath: '/tmp/demo',
                isFavorite: false,
                createdAt: new Date().toISOString(),
                lastOpenedAt: null,
              },
              workspacePathStatus: 'present',
              pendingRequests: [],
              turns: [],
            }),
          });
        }

        if (url.endsWith('/api/threads')) {
          return Promise.resolve({
            ok: true,
            json: async () => [
              {
                id: 'thread-1',
                workspaceId: 'workspace-1',
                providerSessionId: 'codex-1',
                source: 'supervisor',
                title: 'Demo Thread',
                model: 'gpt-5',
                reasoningEffort: 'medium',
                collaborationMode: 'default',
                approvalMode: 'yolo',
                status: 'idle',
                summaryText: 'Preview',
                lastError: null,
                activeTurnId: null,
                isLoaded: false,
                isPinned: false,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                lastTurnStartedAt: null,
                lastTurnCompletedAt: null,
              },
            ],
          });
        }

        throw new Error(`Unhandled fetch request: ${url}`);
      }),
    );

    render(
      <MemoryRouter initialEntries={['/threads/thread-1']}>
        <Routes>
          <Route path="/threads/:id" element={<ThreadDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Connect thread' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Connect thread' }));

    await waitFor(() => {
      const calls = vi.mocked(fetch).mock.calls.map(([requestUrl]) => String(requestUrl));
      expect(calls).toContain('/api/threads/thread-1/resume');
    });

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Connect thread' })).not.toBeInTheDocument();
    });
  });

  it('reloads thread detail after the supervisor socket reconnects', async () => {
    let detailCallCount = 0;
    const timeoutCallbacks = new Map<number, TimerHandler>();
    let nextTimeoutId = 1;

    vi.stubGlobal(
      'fetch',
      withHealthz(async (input: RequestInfo | URL) => {
        const url = String(input);

        if (url.endsWith('/api/threads')) {
          return {
            ok: true,
            json: async () => [
              {
                id: 'thread-1',
                workspaceId: 'workspace-1',
                providerSessionId: 'codex-1',
                source: 'supervisor',
                title: 'Demo Thread',
                model: 'gpt-5',
                reasoningEffort: 'medium',
                collaborationMode: 'default',
                approvalMode: 'yolo',
                status: 'running',
                summaryText: 'Explain the failure',
                lastError: null,
                activeTurnId: 'turn-1',
                isLoaded: true,
                isPinned: false,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                lastTurnStartedAt: new Date().toISOString(),
                lastTurnCompletedAt: null,
              },
            ],
          };
        }

        if (url.endsWith('/api/agent-runtimes/codex/status')) {
          return {
            ok: true,
            json: async () => ({
              command: 'codex',
              args: [],
              cwd: '/tmp/project',
              transport: 'stdio',
            }),
          };
        }

        if (url.endsWith('/api/agent-runtimes/codex/models')) {
          return {
            ok: true,
            json: async () => modelOptionsResponse,
          };
        }

        if (url.startsWith('/api/threads/thread-1?') || url.endsWith('/api/threads/thread-1')) {
          detailCallCount += 1;
          const completed = detailCallCount >= 2;

          return {
            ok: true,
            json: async () => ({
              thread: {
                id: 'thread-1',
                workspaceId: 'workspace-1',
                providerSessionId: 'codex-1',
                source: 'supervisor',
                title: 'Demo Thread',
                model: 'gpt-5',
                reasoningEffort: 'medium',
                collaborationMode: 'default',
                approvalMode: 'yolo',
                status: completed ? 'idle' : 'running',
                summaryText: 'Explain the failure',
                lastError: null,
                activeTurnId: completed ? null : 'turn-1',
                isLoaded: true,
                isPinned: false,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                lastTurnStartedAt: new Date().toISOString(),
                lastTurnCompletedAt: completed ? new Date().toISOString() : null,
              },
              workspace: {
                id: 'workspace-1',
                hostId: 'host-1',
                label: 'Demo Workspace',
                absPath: '/tmp/project',
                isFavorite: false,
                createdAt: new Date().toISOString(),
                lastOpenedAt: new Date().toISOString(),
              },
              workspacePathStatus: 'present',
              pendingRequests: [],
              totalTurnCount: 1,
              turns: [
                {
                  id: 'turn-1',
                  startedAt: new Date().toISOString(),
                  status: completed ? 'completed' : 'inProgress',
                  error: null,
                  items: completed
                    ? [
                        {
                          id: 'user-1',
                          kind: 'userMessage',
                          text: 'Explain the failure',
                        },
                        {
                          id: 'agent-1',
                          kind: 'agentMessage',
                          text: 'Recovered after reconnect.',
                        },
                      ]
                    : [
                        {
                          id: 'user-1',
                          kind: 'userMessage',
                          text: 'Explain the failure',
                        },
                      ],
                },
              ],
            }),
          };
        }

        return Promise.reject(new Error(`Unexpected request: ${url}`));
      }),
    );

    render(
      <MemoryRouter initialEntries={['/threads/thread-1']}>
        <Routes>
          <Route path="/threads/:id" element={<ThreadDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('Explain the failure')).toBeInTheDocument();
    });
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(screen.queryByText('Recovered after reconnect.')).not.toBeInTheDocument();

    vi.spyOn(window, 'setTimeout').mockImplementation(
      ((callback: TimerHandler) => {
        const id = nextTimeoutId;
        nextTimeoutId += 1;
        timeoutCallbacks.set(id, callback);
        return id as unknown as number;
      }) as typeof window.setTimeout,
    );
    vi.spyOn(window, 'clearTimeout').mockImplementation(
      ((id: number) => {
        timeoutCallbacks.delete(Number(id));
      }) as typeof window.clearTimeout,
    );

    emitSocketEvent(FakeWebSocket.instances[0]!, 'close');
    expect(timeoutCallbacks.size).toBeGreaterThan(0);

    await act(async () => {
      const reconnectCallback = Array.from(timeoutCallbacks.values()).at(-1);
      expect(reconnectCallback).toBeTypeOf('function');
      if (typeof reconnectCallback === 'function') {
        reconnectCallback();
      }
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(FakeWebSocket.instances).toHaveLength(2);

    await act(async () => {
      emitSocketEvent(FakeWebSocket.instances[1]!, 'open');
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(detailCallCount).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Recovered after reconnect.')).toBeInTheDocument();
  });

  it('keeps the mobile chat composer menu above the timeline without clipping', async () => {
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: true,
      media: '(max-width: 639px)',
      addEventListener,
      removeEventListener,
    })));

    render(
      <MemoryRouter initialEntries={['/threads/thread-1']}>
        <Routes>
          <Route path="/threads/:id" element={<ThreadDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('Demo Thread')).toBeInTheDocument();
    });

    const trigger = screen.getByRole('button', { name: 'Open slash toolbox' });
    const composerHost = trigger.closest('div.fixed');
    expect(composerHost).toHaveClass('z-50', 'overflow-visible');

    fireEvent.click(trigger);

    const slashMenu = document.querySelector('[data-composer-menu-surface="true"]');
    expect(slashMenu).toBeInTheDocument();
    expect(slashMenu).toHaveClass('bottom-full');
    let composerLayer = slashMenu?.parentElement;
    while (composerLayer && !composerLayer.classList.contains('z-[80]')) {
      composerLayer = composerLayer.parentElement;
    }
    expect(composerLayer).toHaveClass('z-[80]');
  });

});
