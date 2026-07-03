import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentBackendDto, AgentBackendIdDto } from '@remote-codex/shared';
import { AppShellNavContext } from '../components/AppShellNavContext';
import { ThreadNewPage } from './ThreadNewPage';

const capabilities = {
  sessions: { list: true, read: true, resume: true, importLocal: true },
  turns: { start: true, streamInput: false, steer: true, interrupt: true, compact: true },
  branching: { fork: true, hardRollback: true, resumeAt: false, rewindFiles: false },
  controls: {
    planMode: true,
    permissionRequests: true,
    sandboxMode: false,
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
};

const managementSchema = {
  hostConfigFiles: [],
  toolboxItems: [],
  hookCommandTemplates: [],
  providerConfigFormat: 'none',
  mcpConfigFormat: 'none',
  configArchives: false,
  buildRestart: false,
} satisfies AgentBackendDto['managementSchema'];

const codexBackend: AgentBackendDto = {
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
  managementSchema,
  installation: {
    packageName: '@openai/codex',
    installed: true,
    installedVersion: 'codex-cli 0.131.0',
    latestVersion: '0.133.0',
    installCommand: null,
    updateCommand: 'npm install -g @openai/codex@latest',
    busy: false,
    lastError: null,
  },
};

const claudeBackend: AgentBackendDto = {
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
  managementSchema,
  installation: {
    packageName: '@anthropic-ai/claude-agent-sdk',
    installed: false,
    installedVersion: null,
    latestVersion: '2.1.148',
    installCommand: 'npm install -g @anthropic-ai/claude-code @anthropic-ai/claude-agent-sdk',
    updateCommand: 'npm install -g @anthropic-ai/claude-code@latest @anthropic-ai/claude-agent-sdk@latest',
    busy: false,
    lastError: 'Claude Code command is not available: claude Claude Code Agent SDK is not installed.',
  },
};

const opencodeBackend: AgentBackendDto = {
  ...codexBackend,
  provider: 'opencode',
  displayName: 'OpenCode',
  description: 'Local OpenCode runtime.',
  enabled: true,
  isDefault: false,
  status: {
    ...codexBackend.status,
    transport: 'sdk',
  },
  capabilities: {
    ...capabilities,
    sessions: { list: true, read: true, resume: true, importLocal: false },
    turns: { start: true, streamInput: false, steer: false, interrupt: true, compact: true },
  },
  installation: {
    packageName: 'opencode-ai',
    installed: true,
    installedVersion: 'opencode 1.15.7 (SDK 1.15.7)',
    latestVersion: '1.15.7',
    installCommand: 'npm install -g opencode-ai @opencode-ai/sdk',
    updateCommand: 'npm install -g opencode-ai@latest @opencode-ai/sdk@latest',
    busy: false,
    lastError: null,
  },
};

function Harness({
  defaultBackend: initialDefaultBackend = 'claude',
}: {
  defaultBackend?: AgentBackendIdDto;
}) {
  const [defaultBackend, setDefaultBackend] = useState<AgentBackendIdDto>(initialDefaultBackend);

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

  it('loads OpenCode provider-qualified models and submits the selected model key', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
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
        } satisfies Partial<Response> as Response);
      }

      if (url === '/api/config/workspace-settings' && !init?.method) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            workspaceRoot: '/tmp',
            devHome: '/tmp/dev',
            defaultBackend: 'opencode',
          }),
        } satisfies Partial<Response> as Response);
      }

      if (url === '/api/agent-runtimes' && !init?.method) {
        return Promise.resolve({
          ok: true,
          json: async () => [codexBackend, claudeBackend, opencodeBackend],
        } satisfies Partial<Response> as Response);
      }

      if (url === '/api/agent-runtimes/opencode/models' && !init?.method) {
        return Promise.resolve({
          ok: true,
          json: async () => [
            {
              id: 'openai/gpt-5@fast',
              model: 'openai/gpt-5@fast',
              displayName: 'GPT-5 (openai)',
              description: 'OpenCode OpenAI GPT-5 fast',
              isDefault: true,
              hidden: false,
              supportedReasoningEfforts: [],
              defaultReasoningEffort: null,
            },
            {
              id: 'anthropic/claude-sonnet@default',
              model: 'anthropic/claude-sonnet@default',
              displayName: 'Claude Sonnet (anthropic)',
              description: 'OpenCode Anthropic Sonnet',
              isDefault: false,
              hidden: false,
              supportedReasoningEfforts: [],
              defaultReasoningEffort: null,
            },
          ],
        } satisfies Partial<Response> as Response);
      }

      if (url === '/api/threads/start' && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: 'thread-1',
            workspaceId: 'workspace-1',
            provider: 'opencode',
            providerSessionId: 'opencode-1',
            source: 'supervisor',
            title: 'OpenCode Thread',
            model: 'anthropic/claude-sonnet@default',
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
        } satisfies Partial<Response> as Response);
      }

      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });

    render(
      <MemoryRouter initialEntries={['/threads/new']}>
        <Harness defaultBackend="opencode" />
      </MemoryRouter>,
    );

    const backendSelect = await screen.findByLabelText('Backend');
    expect(backendSelect).toHaveValue('opencode');
    await waitFor(() => {
      expect(screen.getByLabelText('Model')).toHaveValue('openai/gpt-5@fast');
    });

    fireEvent.change(screen.getByLabelText('Model'), {
      target: { value: 'anthropic/claude-sonnet@default' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Thread' }));

    await waitFor(() => {
      expect(screen.getByText('thread detail')).toBeInTheDocument();
    });

    const createCall = fetchMock.mock.calls.find(
      ([url, init]) => String(url) === '/api/threads/start' && init?.method === 'POST',
    );
    expect(JSON.parse(String(createCall?.[1]?.body))).toMatchObject({
      provider: 'opencode',
      model: 'anthropic/claude-sonnet@default',
    });
  });

  it('clears stale model options when switching to a backend whose models fail to load', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
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
        } satisfies Partial<Response> as Response);
      }

      if (url === '/api/config/workspace-settings' && !init?.method) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            workspaceRoot: '/tmp',
            devHome: '/tmp/dev',
            defaultBackend: 'codex',
          }),
        } satisfies Partial<Response> as Response);
      }

      if (url === '/api/agent-runtimes' && !init?.method) {
        return Promise.resolve({
          ok: true,
          json: async () => [codexBackend, claudeBackend, opencodeBackend],
        } satisfies Partial<Response> as Response);
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
        } satisfies Partial<Response> as Response);
      }

      if (url === '/api/agent-runtimes/opencode/models' && !init?.method) {
        return Promise.resolve({
          ok: false,
          status: 503,
          json: async () => ({
            code: 'service_unavailable',
            message: 'OpenCode is not installed or could not start.',
          }),
        } satisfies Partial<Response> as Response);
      }

      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });

    render(
      <MemoryRouter initialEntries={['/threads/new']}>
        <Harness defaultBackend="codex" />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByLabelText('Model')).toHaveValue('gpt-5');
    });

    fireEvent.change(screen.getByLabelText('Backend'), {
      target: { value: 'opencode' },
    });

    await waitFor(() => {
      expect(screen.getByText('OpenCode is not installed or could not start.')).toBeInTheDocument();
    });

    const modelSelect = screen.getByLabelText('Model') as HTMLSelectElement;
    expect(modelSelect).toHaveValue('');
    expect(modelSelect).toBeDisabled();
    expect(screen.getByRole('option', { name: 'No models available' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /GPT-5/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create Thread' })).toBeDisabled();
  });
});
