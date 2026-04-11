import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ThreadDetailPage } from './ThreadDetailPage';

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  listeners = new Map<string, ((event: MessageEvent) => void)[]>();

  constructor(url: string) {
    void url;
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  close() {}
}

function emitSocketMessage(socket: FakeWebSocket, payload: unknown) {
  const message = { data: JSON.stringify(payload) } as MessageEvent;
  for (const listener of socket.listeners.get('message') ?? []) {
    listener(message);
  }
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
    vi.stubGlobal('WebSocket', FakeWebSocket as any);
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
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

        if (url.endsWith('/api/threads/thread-1')) {
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

  it('keeps meta collapsed by default and only lists threads from the current workspace', async () => {
    render(
      <MemoryRouter initialEntries={['/threads/thread-1']}>
        <Routes>
          <Route path="/threads/:id" element={<ThreadDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { level: 2, name: 'Demo Thread' }),
      ).toBeInTheDocument();
    });

    expect(screen.getByText('Sibling Thread')).toBeInTheDocument();
    expect(
      screen.queryByText('Other Workspace Thread'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('/tmp/demo')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Thread Meta/i }));

    expect(screen.getByText('/tmp/demo')).toBeInTheDocument();
  });

  it('surfaces imported thread warnings before resume', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
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

        if (url.endsWith('/api/threads/imported-thread')) {
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
        screen.getByRole('heading', { level: 2, name: 'Imported Thread' }),
      ).toBeInTheDocument();
    });

    expect(screen.getByText(/Imported local Codex session/i)).toBeInTheDocument();
    expect(screen.getByText(/Workspace path missing/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Send Prompt/i })).toBeDisabled();
  });

  it('hides the imported-session resume warning after the thread is connected', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
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

        if (url.endsWith('/api/threads/connected-imported-thread')) {
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
        screen.getByRole('heading', { level: 2, name: 'Connected Imported Thread' }),
      ).toBeInTheDocument();
    });

    expect(
      screen.queryByText(/History is available immediately\. Click Resume \/ Connect before sending a new prompt\./i),
    ).not.toBeInTheDocument();
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
      vi.fn((input: RequestInfo | URL) => {
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

        if (url.endsWith('/api/threads/thread-1')) {
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
      expect(screen.getByText('Need another choice')).toBeInTheDocument();
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
      expect(screen.getByText('Need another choice')).toBeInTheDocument();
    });
  });
});
