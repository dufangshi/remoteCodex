import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppShellNavContext } from '../components/AppShellNavContext';
import { ThreadsPage } from './ThreadsPage';

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
        if (url.includes('/api/agent-runtimes/codex/status')) {
          return Promise.resolve({
            ok: true,
            json: async () => codexBackendResponse,
          });
        }

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
              provider: 'codex',
              providerSessionId: 'codex-1',
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
                provider: 'codex',
                providerSessionId: 'codex-1',
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
                provider: 'codex',
                providerSessionId: 'codex-2',
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

  function renderPage(initialEntry: string) {
    render(
      <AppShellNavContext.Provider
        value={{
          navOpen: false,
          openNav: vi.fn(),
          toggleNav: vi.fn(),
          closeNav: vi.fn(),
          settingsOpen: false,
          openSettings: vi.fn(),
          closeSettings: vi.fn(),
          themeMode: 'dark',
          setThemeMode: vi.fn(),
          effectiveTheme: 'dark',
          defaultBackend: 'codex',
          setDefaultBackend: vi.fn(),
        }}
      >
        <MemoryRouter initialEntries={[initialEntry]}>
          <Routes>
            <Route path="/threads" element={<ThreadsPage />} />
            <Route path="/threads/:id" element={<div>Thread Detail Route</div>} />
            <Route path="/workspaces" element={<div>Workspaces Landing</div>} />
          </Routes>
        </MemoryRouter>
      </AppShellNavContext.Provider>,
    );
  }

  it('redirects the standalone threads route back to workspaces', async () => {
    renderPage('/threads');

    await waitFor(() => {
      expect(screen.getByText('Workspaces Landing')).toBeInTheDocument();
    });
  });

  it('scopes by workspace query param and renames a thread only after save', async () => {
    renderPage('/threads?workspaceId=workspace-1');

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
    expect(screen.getByRole('button', { name: 'Open Navigation' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to workspace' })).toHaveAttribute(
      'href',
      '/workspaces',
    );
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

  it('copies the backend session id and deletes a recent thread after confirmation', async () => {
    renderPage('/threads?workspaceId=workspace-1');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Demo Workspace' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Copy session ID' }));

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('codex-1');
    });

    fireEvent.click(screen.getAllByRole('button', { name: 'Delete thread Demo Thread' })[0]!);

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

  it('collapses and expands the desktop thread list', async () => {
    renderPage('/threads?workspaceId=workspace-1');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Demo Workspace' })).toBeInTheDocument();
    });

    const collapseButton = screen.getByRole('button', {
      name: 'Collapse thread list',
    });
    fireEvent.click(collapseButton);

    expect(
      screen.getByRole('button', { name: 'Expand thread list' }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Expand thread list' }));

    expect(
      screen.getByRole('button', { name: 'Collapse thread list' }),
    ).toBeInTheDocument();
  });

  it('opens a workspace thread directly into the thread detail route', async () => {
    renderPage('/threads?workspaceId=workspace-1');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Demo Workspace' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getAllByText('Demo Thread')[0]!);

    await waitFor(() => {
      expect(screen.getByText('Thread Detail Route')).toBeInTheDocument();
    });
  });
});
