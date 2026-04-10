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

describe('ThreadDetailPage', () => {
  beforeEach(() => {
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
});
