import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const shellPanelMock = vi.hoisted(() => ({
  toggleConnection: vi.fn(async () => undefined),
  sendInput: vi.fn(() => true),
  sendCommand: vi.fn(() => true),
  sendControl: vi.fn(() => true),
  copyLastCommandOutput: vi.fn(async () => true),
  terminate: vi.fn(async () => undefined),
  focus: vi.fn(() => undefined),
  status: 'detached' as const,
}));

vi.mock('../components/ThreadShellPanel', async () => {
  const React = await import('react');

  const ThreadShellPanel = React.forwardRef(function MockThreadShellPanel(
    props: {
      onStateChange?: (state: {
        status: 'detached' | 'attached';
        connectionButtonDisabled: boolean;
        connectionButtonLabel: string;
        shellInputEnabled: boolean;
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
    React.useImperativeHandle(ref, () => ({
      toggleConnection: shellPanelMock.toggleConnection,
      sendInput: shellPanelMock.sendInput,
      sendCommand: shellPanelMock.sendCommand,
      sendControl: shellPanelMock.sendControl,
      copyLastCommandOutput: shellPanelMock.copyLastCommandOutput,
      terminate: shellPanelMock.terminate,
      focus: shellPanelMock.focus,
    }));

    React.useEffect(() => {
      props.onStateChange?.({
        status: shellPanelMock.status,
        connectionButtonDisabled: false,
        connectionButtonLabel: 'Connect shell',
        shellInputEnabled: true,
        isCommandRunning: false,
        promptLabel: '(base) trading-lab',
        isMobileShell: false,
        hasShell: true,
        busy: false,
        loading: false,
        error: null,
      });
    }, [props.onStateChange]);

    return <div data-testid="mock-thread-shell-panel" />;
  });

  return {
    ThreadShellPanel,
  };
});

import { ThreadDetailPage } from './ThreadDetailPage';

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
    json: async () => payload,
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

describe('ThreadDetailPage', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    shellPanelMock.toggleConnection.mockClear();
    shellPanelMock.sendInput.mockClear();
    shellPanelMock.sendCommand.mockClear();
    shellPanelMock.sendControl.mockClear();
    shellPanelMock.copyLastCommandOutput.mockClear();
    shellPanelMock.terminate.mockClear();
    shellPanelMock.focus.mockClear();
    shellPanelMock.status = 'detached';
    vi.stubGlobal('WebSocket', FakeWebSocket as any);
    vi.stubGlobal(
      'fetch',
      withHealthz((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url.includes('/api/codex/status')) {
          return okJsonResponse({
            state: 'ready',
            transport: 'stdio',
            lastStartedAt: new Date().toISOString(),
            lastError: null,
            restartCount: 0,
          });
        }

        if (url.includes('/api/codex/models')) {
          return okJsonResponse(modelOptionsResponse);
        }

        if (url.endsWith('/api/threads/thread-1/prompt') && init?.method === 'POST') {
          return okJsonResponse({
            id: 'thread-1',
            workspaceId: 'workspace-1',
            codexThreadId: 'codex-1',
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

        if (url.startsWith('/api/threads/thread-1?') || url.endsWith('/api/threads/thread-1')) {
          return okJsonResponse({
            thread: {
              id: 'thread-1',
              workspaceId: 'workspace-1',
              codexThreadId: 'codex-1',
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
                codexThreadId: 'codex-1',
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
                codexThreadId: 'codex-2',
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
                codexThreadId: 'codex-3',
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
      screen.getByRole('button', { name: 'Copy Codex session ID' }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Thread Meta/i }));

    expect(screen.queryByText('/tmp/demo')).not.toBeInTheDocument();
  });

  it('renders thread detail without waiting for background thread list and model context', async () => {
    vi.stubGlobal(
      'fetch',
      withHealthz((input: RequestInfo | URL) => {
        const url = String(input);

        if (
          url.endsWith('/api/threads') ||
          url.includes('/api/codex/status') ||
          url.includes('/api/codex/models')
        ) {
          return new Promise(() => undefined);
        }

        if (url.startsWith('/api/threads/thread-1?') || url.endsWith('/api/threads/thread-1')) {
          return okJsonResponse({
            thread: {
              id: 'thread-1',
              workspaceId: 'workspace-1',
              codexThreadId: 'codex-1',
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

  it('loads only the latest turn page first and fetches earlier turns on demand', async () => {
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

        if (url.includes('/api/codex/status')) {
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

        if (url.includes('/api/codex/models')) {
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
                codexThreadId: 'codex-1',
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
                codexThreadId: 'codex-1',
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
      expect(screen.getByText(/Showing 10 of 15 turns/)).toBeInTheDocument();
    });

    expect(detailUrls[0]).toContain('/api/threads/thread-1?limit=10');
    expect(screen.queryByText('Prompt 5')).not.toBeInTheDocument();
    expect(screen.getByText('Prompt 15')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Load 10 earlier' }));

    await waitFor(() => {
      expect(screen.getByText('Prompt 5')).toBeInTheDocument();
    });

    expect(detailUrls.at(-1)).toContain('beforeTurnId=turn-6');
  });

  it('surfaces imported thread warnings before resume', async () => {
    vi.stubGlobal(
      'fetch',
      withHealthz((input: RequestInfo | URL) => {
        const url = String(input);

        if (url.includes('/api/codex/status')) {
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

        if (url.includes('/api/codex/models')) {
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
                codexThreadId: '019d6fb7-7033-7a30-a2c7-74d0919e87d4',
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
                codexThreadId: '019d6fb7-7033-7a30-a2c7-74d0919e87d4',
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
    setPromptValue(editor, `Please inspect ${editor.textContent ?? ''}`);
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

  it('auto-connects an unloaded thread before sending the first prompt', async () => {
    vi.stubGlobal(
      'fetch',
      withHealthz((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url.includes('/api/codex/status')) {
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

        if (url.includes('/api/codex/models')) {
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
                codexThreadId: 'codex-1',
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

        if (url.endsWith('/api/threads/thread-1/prompt') && init?.method === 'POST') {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              id: 'thread-1',
              workspaceId: 'workspace-1',
              codexThreadId: 'codex-1',
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
                codexThreadId: 'codex-1',
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
                codexThreadId: 'codex-1',
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

        if (url.includes('/api/codex/status')) {
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

        if (url.includes('/api/codex/models')) {
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
                codexThreadId: 'codex-1',
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

        if (url.includes('/api/codex/status')) {
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

        if (url.includes('/api/codex/models')) {
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
                codexThreadId: 'codex-1',
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
      expect(screen.getAllByText('Prompt delivery failed.').length).toBeGreaterThan(0);
    });
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

  it('does not auto-connect the shell after switching views while the thread is disconnected', async () => {
    vi.stubGlobal(
      'fetch',
      withHealthz((input: RequestInfo | URL) => {
        const url = String(input);

        if (url.includes('/api/codex/status')) {
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

        if (url.includes('/api/codex/models')) {
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
                codexThreadId: 'codex-1',
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
                codexThreadId: 'codex-1',
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

        if (url.includes('/api/codex/status')) {
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

        if (url.includes('/api/codex/models')) {
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
                codexThreadId: '019d6fb7-7033-7a30-a2c7-74d0919e87d4',
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
                codexThreadId: '019d6fb7-7033-7a30-a2c7-74d0919e87d4',
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

        if (url.includes('/api/codex/status')) {
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

        if (url.includes('/api/codex/models')) {
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
                codexThreadId: 'codex-1',
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
                codexThreadId: 'codex-1',
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
      expect(
        screen.getByText('User kept plan mode active and will provide further details.'),
      ).toBeInTheDocument();
    });

    expect(screen.queryByText('Plan', { selector: 'p' })).not.toBeInTheDocument();
  });

  it('keeps a compact local note after answering requestUserInput questions', async () => {
    vi.spyOn(global, 'fetch').mockImplementation((input, init) => {
      const url = String(input);

      if (url.endsWith('/api/codex/models')) {
        return Promise.resolve({
          ok: true,
          json: async () => modelOptionsResponse,
        } as Response);
      }

      if (url.endsWith('/api/codex/status')) {
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
              codexThreadId: 'codex-1',
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
              codexThreadId: 'codex-1',
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

        if (url.includes('/api/codex/status')) {
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

        if (url.includes('/api/codex/models')) {
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
                codexThreadId: 'codex-1',
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
                codexThreadId: 'codex-1',
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
            codexThreadId: 'codex-1',
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
    const intervalCallbacks = new Map<number, TimerHandler>();
    let nextIntervalId = 1;

    vi.spyOn(window, 'setInterval').mockImplementation(
      ((callback: TimerHandler) => {
        const id = nextIntervalId;
        nextIntervalId += 1;
        intervalCallbacks.set(id, callback);
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
                codexThreadId: 'codex-1',
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

        if (url.endsWith('/api/codex/status')) {
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

        if (url.endsWith('/api/codex/models')) {
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
                codexThreadId: 'codex-1',
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

  it('shows a gray connect button in the mobile header for detached threads and reconnects on click', async () => {
    vi.stubGlobal(
      'fetch',
      withHealthz((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url.includes('/api/codex/status')) {
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

        if (url.includes('/api/codex/models')) {
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
                codexThreadId: 'codex-1',
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
                codexThreadId: 'codex-1',
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
                codexThreadId: 'codex-1',
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
                codexThreadId: 'codex-1',
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

        if (url.endsWith('/api/codex/status')) {
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

        if (url.endsWith('/api/codex/models')) {
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
                codexThreadId: 'codex-1',
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
});
