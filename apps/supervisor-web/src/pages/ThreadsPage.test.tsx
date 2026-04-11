import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ThreadsPage } from './ThreadsPage';

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

describe('ThreadsPage', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket as any);
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: vi.fn(() => Promise.resolve()),
      },
      configurable: true,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
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

        if (url.includes('/api/workspaces')) {
          return Promise.resolve({
            ok: true,
            json: async () => [
              {
                id: 'workspace-1',
                hostId: 'host-1',
                label: 'Demo Workspace',
                absPath: '/tmp/demo',
                isFavorite: false,
                createdAt: new Date().toISOString(),
                lastOpenedAt: null,
              },
              {
                id: 'workspace-2',
                hostId: 'host-1',
                label: 'Other Workspace',
                absPath: '/tmp/other',
                isFavorite: false,
                createdAt: new Date().toISOString(),
                lastOpenedAt: null,
              },
            ],
          });
        }

        if (url.endsWith('/api/threads/thread-1') && init?.method === 'PATCH') {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              id: 'thread-1',
              workspaceId: 'workspace-1',
              codexThreadId: 'codex-1',
              source: 'supervisor',
              title: 'Renamed Thread',
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
            }),
          });
        }

        if (url.endsWith('/api/threads/thread-1') && init?.method === 'DELETE') {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              id: 'thread-1',
            }),
          });
        }

        if (url.includes('/api/threads')) {
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
                workspaceId: 'workspace-2',
                codexThreadId: 'codex-2',
                source: 'supervisor',
                title: 'Other Thread',
                model: 'gpt-5-mini',
                approvalMode: 'yolo',
                status: 'idle',
                summaryText: 'Other Preview',
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

  it('renders the threads registry', async () => {
    render(
      <MemoryRouter>
        <ThreadsPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getAllByText('Demo Thread')).toHaveLength(2);
    });
    expect(
      screen.getByRole('heading', { name: /^All Threads$/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/^Recent Threads$/i)).toBeInTheDocument();
    expect(screen.queryByText(/Codex control plane/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Open a thread from the sidebar/i)).not.toBeInTheDocument();
  });

  it('scopes by workspace query param and renames a thread only after save', async () => {
    render(
      <MemoryRouter initialEntries={['/threads?workspaceId=workspace-1']}>
        <ThreadsPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: 'Demo Workspace' }),
      ).toBeInTheDocument();
    });

    expect(screen.queryByText('Other Thread')).not.toBeInTheDocument();
    const newThreadLinks = screen.getAllByRole('link', { name: /New Thread/i });
    expect(newThreadLinks.length).toBeGreaterThan(0);
    newThreadLinks.forEach((link) => {
      expect(link).toHaveAttribute('href', '/threads/new?workspaceId=workspace-1');
    });
    expect(screen.queryByText(/This view is scoped to a single workspace/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Thread Count$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Next Step$/i)).not.toBeInTheDocument();
    expect(screen.getByText(/^Recent Threads$/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Menu' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Expand thread navigation' }),
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getAllByRole('button', { name: 'Rename thread Demo Thread' })[0]!,
    );
    expect(
      screen.getByRole('dialog', { name: 'Rename Thread' }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Thread Title/i), {
      target: { value: 'Renamed Thread' },
    });

    expect(
      vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'PATCH'),
    ).toBeUndefined();

    fireEvent.click(screen.getByRole('button', { name: /Save/i }));

    await waitFor(() => {
      expect(screen.getAllByText('Renamed Thread').length).toBeGreaterThan(0);
    });

    const patchCall = vi.mocked(fetch).mock.calls.find(
      ([input, init]) => String(input).endsWith('/api/threads/thread-1') && init?.method === 'PATCH',
    );
    expect(patchCall?.[1]?.body).toBe(JSON.stringify({ title: 'Renamed Thread' }));
  });

  it('copies the codex session id and deletes a recent thread after confirmation', async () => {
    render(
      <MemoryRouter initialEntries={['/threads?workspaceId=workspace-1']}>
        <ThreadsPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Demo Workspace' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Copy Codex session ID' }));

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('codex-1');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Delete thread Demo Thread' }));

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: 'Delete Thread' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Delete Thread' }));

    await waitFor(() => {
      expect(screen.queryByText('Demo Thread')).not.toBeInTheDocument();
    });

    const deleteCall = vi.mocked(fetch).mock.calls.find(
      ([input, init]) => String(input).endsWith('/api/threads/thread-1') && init?.method === 'DELETE',
    );
    expect(deleteCall).toBeTruthy();
  });
});
