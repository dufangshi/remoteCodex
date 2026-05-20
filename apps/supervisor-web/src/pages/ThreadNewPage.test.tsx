import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppShellNavContext } from '../components/AppShellNavContext';
import { ThreadNewPage } from './ThreadNewPage';

const capabilities = {
  sessions: { list: true, read: true, resume: true, importLocal: true },
  turns: { start: true, streamInput: false, steer: true, interrupt: true, compact: true },
  branching: { fork: true, hardRollback: true, resumeAt: false, rewindFiles: false },
  controls: {
    planMode: true,
    permissionRequests: true,
    sandboxMode: true,
    fastServiceTier: true,
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
};

const codexBackend = {
  provider: 'codex',
  displayName: 'Codex',
  description: 'Local Codex app-server runtime.',
  enabled: true,
  isDefault: true,
  status: {
    state: 'ready',
    transport: 'stdio',
    lastStartedAt: '2026-04-11T00:00:00.000Z',
    lastError: null,
    restartCount: 0,
  },
  capabilities,
};

const claudeBackend = {
  provider: 'claude',
  displayName: 'Claude',
  description: 'Claude adapter is not configured yet.',
  enabled: false,
  isDefault: false,
  status: {
    state: 'stopped',
    transport: 'none',
    lastStartedAt: null,
    lastError: 'Claude adapter is not configured yet.',
    restartCount: 0,
  },
  capabilities: {
    ...capabilities,
    sessions: { list: false, read: false, resume: false, importLocal: false },
    turns: { start: false, streamInput: false, steer: false, interrupt: false, compact: false },
  },
};

function Harness() {
  const [defaultBackend, setDefaultBackend] = useState<'codex' | 'claude'>('claude');

  return (
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
        defaultBackend,
        setDefaultBackend,
      }}
    >
      <Routes>
        <Route path="/threads/new" element={<ThreadNewPage />} />
        <Route path="/threads/:threadId" element={<div>thread detail</div>} />
      </Routes>
    </AppShellNavContext.Provider>
  );
}

describe('ThreadNewPage', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url === '/api/workspaces' && !init?.method) {
          return Promise.resolve({
            ok: true,
            json: async () => [
              {
                id: 'workspace-1',
                hostId: 'host-1',
                label: 'Demo Workspace',
                absPath: '/tmp/demo',
                isFavorite: false,
                createdAt: '2026-04-11T00:00:00.000Z',
                lastOpenedAt: null,
              },
            ],
          } satisfies Partial<Response>);
        }

        if (url === '/api/config/workspace-settings' && !init?.method) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              workspaceRoot: '/tmp',
              devHome: '/tmp/dev',
              defaultBackend: 'claude',
            }),
          } satisfies Partial<Response>);
        }

        if (url === '/api/agent-runtimes' && !init?.method) {
          return Promise.resolve({
            ok: true,
            json: async () => [codexBackend, claudeBackend],
          } satisfies Partial<Response>);
        }

        if (url === '/api/agent-runtimes/codex/models' && !init?.method) {
          return Promise.resolve({
            ok: true,
            json: async () => [
              {
                id: 'gpt-5',
                model: 'gpt-5',
                displayName: 'GPT-5',
                description: 'Default model',
                isDefault: true,
                hidden: false,
                supportedReasoningEfforts: [],
                defaultReasoningEffort: null,
              },
            ],
          } satisfies Partial<Response>);
        }

        if (url === '/api/threads/start' && init?.method === 'POST') {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              id: 'thread-1',
              workspaceId: 'workspace-1',
              provider: 'codex',
              providerSessionId: 'codex-1',
              source: 'supervisor',
              title: 'Demo Thread',
              model: 'gpt-5',
              approvalMode: 'yolo',
              status: 'idle',
              summaryText: null,
              lastError: null,
              activeTurnId: null,
              isLoaded: true,
              isPinned: false,
              createdAt: '2026-04-11T00:00:00.000Z',
              updatedAt: '2026-04-11T00:00:00.000Z',
              lastTurnStartedAt: null,
              lastTurnCompletedAt: null,
            }),
          } satisfies Partial<Response>);
        }

        return Promise.reject(new Error(`Unexpected request: ${url}`));
      }),
    );
  });

  it('drives backend selection from runtime descriptors and creates Codex threads only', async () => {
    const fetchMock = vi.mocked(fetch);

    render(
      <MemoryRouter initialEntries={['/threads/new']}>
        <Harness />
      </MemoryRouter>,
    );

    const backendSelect = await screen.findByLabelText('Backend');
    expect(backendSelect).toHaveValue('codex');

    const claudeOption = screen.getByRole('option', {
      name: 'Claude (not available)',
    }) as HTMLOptionElement;
    expect(claudeOption.disabled).toBe(true);

    await waitFor(() => {
      expect(screen.getByLabelText('Model')).toHaveValue('gpt-5');
    });

    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Demo Thread' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Thread' }));

    await waitFor(() => {
      expect(screen.getByText('thread detail')).toBeInTheDocument();
    });

    const createCall = fetchMock.mock.calls.find(
      ([url, init]) => String(url) === '/api/threads/start' && init?.method === 'POST',
    );
    expect(createCall).toBeDefined();
    expect(JSON.parse(String(createCall?.[1]?.body))).toMatchObject({
      workspaceId: 'workspace-1',
      provider: 'codex',
      model: 'gpt-5',
      approvalMode: 'yolo',
      title: 'Demo Thread',
    });
  });
});
