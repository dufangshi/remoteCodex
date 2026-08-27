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

const acpBackend: AgentBackendDto = {
  ...codexBackend,
  provider: 'acp',
  displayName: 'ACP Agent',
  description: 'Choose an ACP agent.',
  isDefault: false,
  capabilities: {
    ...capabilities,
    management: {
      ...capabilities.management,
      models: false,
    },
  },
  installation: {
    packageName: null,
    installed: true,
    installedVersion: '2 ACP agents ready',
    latestVersion: null,
    installCommand: null,
    updateCommand: null,
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

  it('installs an unavailable backend, refreshes runtime state, and creates with it', async () => {
    const fetchMock = vi.mocked(fetch);
    let claudeInstalled = false;
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
            defaultBackend: 'claude',
          }),
        } satisfies Partial<Response> as Response);
      }

      if (url === '/api/agent-runtimes' && !init?.method) {
        return Promise.resolve({
          ok: true,
          json: async () => [
            codexBackend,
            claudeInstalled
              ? {
                  ...claudeBackend,
                  enabled: true,
                  status: {
                    ...claudeBackend.status,
                    state: 'ready',
                    transport: 'sdk',
                    lastError: null,
                  },
                  capabilities,
                  installation: {
                    ...claudeBackend.installation,
                    installed: true,
                    installedVersion: '2.1.197',
                    lastError: null,
                  },
                }
              : claudeBackend,
          ],
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

      if (url === '/api/agent-runtimes/claude/install' && init?.method === 'POST') {
        expect(JSON.parse(String(init.body))).toEqual({ action: 'install' });
        claudeInstalled = true;
        return Promise.resolve({
          ok: true,
          json: async () => ({
            ...claudeBackend,
            enabled: true,
            capabilities,
            installation: {
              ...claudeBackend.installation,
              installed: true,
              installedVersion: '2.1.197',
              lastError: null,
            },
          }),
        } satisfies Partial<Response> as Response);
      }

      if (url === '/api/agent-runtimes/claude/models' && !init?.method) {
        return Promise.resolve({
          ok: true,
          json: async () => [
            {
              id: 'haiku',
              model: 'haiku',
              displayName: 'Haiku · 4.5',
              description: 'Claude Haiku',
              isDefault: true,
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
            provider: 'claude',
            providerSessionId: 'claude-1',
            source: 'supervisor',
            title: 'Claude Thread',
            model: 'haiku',
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
        <Harness defaultBackend="claude" />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('option', {
      name: 'Claude (not available)',
    })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Install Claude' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Backend')).toHaveValue('claude');
    });
    await waitFor(() => {
      expect(screen.getByLabelText('Model')).toHaveValue('haiku');
    });
    expect(screen.getByRole('option', { name: 'Haiku · 4.5' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Claude Thread' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Thread' }));

    await waitFor(() => {
      expect(screen.getByText('thread detail')).toBeInTheDocument();
    });

    const createCall = fetchMock.mock.calls.find(
      ([url, init]) => String(url) === '/api/threads/start' && init?.method === 'POST',
    );
    expect(JSON.parse(String(createCall?.[1]?.body))).toMatchObject({
      workspaceId: 'workspace-1',
      provider: 'claude',
      model: 'haiku',
      approvalMode: 'yolo',
      title: 'Claude Thread',
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

  it('shows concrete ACP agents and installs an adapter only when the base agent exists', async () => {
    const fetchMock = vi.mocked(fetch);
    let codexAdapterInstalled = false;
    const acpAgents = () => [
      {
        id: 'grok',
        model: 'grok',
        displayName: 'Grok Build',
        description: 'Native ACP',
        isDefault: true,
        hidden: false,
        supportedReasoningEfforts: [],
        defaultReasoningEffort: null,
        selectionKind: 'agent',
        acpAgent: {
          transport: 'native',
          availability: 'ready',
          baseCommand: 'grok',
          baseProbeCommand: 'grok --version',
          serverCommand: 'grok agent stdio',
          serverProbeCommand: 'grok agent stdio --help',
          baseVersion: 'grok 1.0.5',
          serverVersion: 'grok 1.0.5',
          installCommand: null,
          busy: false,
          statusMessage: 'Ready. ACP command: grok agent stdio',
        },
      },
      {
        id: 'codex',
        model: 'codex',
        displayName: 'OpenAI Codex',
        description: 'ACP adapter',
        isDefault: false,
        hidden: false,
        supportedReasoningEfforts: [],
        defaultReasoningEffort: null,
        selectionKind: 'agent',
        acpAgent: {
          transport: 'adapter',
          availability: codexAdapterInstalled ? 'ready' : 'adapter_missing',
          baseCommand: 'codex',
          baseProbeCommand: 'codex --version',
          serverCommand: 'codex-acp',
          serverProbeCommand: 'codex-acp --version',
          baseVersion: 'codex-cli 0.149.1',
          serverVersion: codexAdapterInstalled ? 'codex-acp 1.6.2' : null,
          installCommand: 'npm install -g @agentclientprotocol/codex-acp@latest',
          busy: false,
          statusMessage: codexAdapterInstalled
            ? 'Ready. ACP command: codex-acp'
            : 'Base agent detected. Install its ACP adapter.',
        },
      },
      {
        id: 'gemini',
        model: 'gemini',
        displayName: 'Gemini CLI',
        description: 'Native ACP',
        isDefault: false,
        hidden: false,
        supportedReasoningEfforts: [],
        defaultReasoningEffort: null,
        selectionKind: 'agent',
        acpAgent: {
          transport: 'native',
          availability: 'base_missing',
          baseCommand: 'gemini',
          baseProbeCommand: 'gemini --version',
          serverCommand: 'gemini --acp',
          serverProbeCommand: 'gemini --acp --help',
          baseVersion: null,
          serverVersion: null,
          installCommand: null,
          busy: false,
          statusMessage: 'Install the base agent first. Probe: gemini --version',
        },
      },
    ];
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/workspaces' && !init?.method) {
        return Promise.resolve({
          ok: true,
          json: async () => [{
            id: 'workspace-1',
            hostId: 'host-1',
            label: 'Demo Workspace',
            absPath: '/tmp/demo',
            isFavorite: false,
            createdAt: '2026-04-11T00:00:00.000Z',
            lastOpenedAt: null,
          }],
        } satisfies Partial<Response> as Response);
      }
      if (url === '/api/agent-runtimes' && !init?.method) {
        return Promise.resolve({
          ok: true,
          json: async () => [acpBackend],
        } satisfies Partial<Response> as Response);
      }
      if (url === '/api/agent-runtimes/acp/agents' && !init?.method) {
        return Promise.resolve({
          ok: true,
          json: async () => acpAgents(),
        } satisfies Partial<Response> as Response);
      }
      if (url.startsWith('/api/agent-runtimes/acp/models?') && !init?.method) {
        const agentId = new URL(url, 'http://local').searchParams.get('agentId');
        const model = agentId === 'codex'
          ? {
              id: 'gpt-5.6-sol',
              model: 'gpt-5.6-sol',
              displayName: 'GPT-5.6 Sol',
              description: 'Codex ACP model',
              isDefault: true,
              hidden: false,
              supportedReasoningEfforts: [
                { reasoningEffort: 'high', description: '' },
                { reasoningEffort: 'xhigh', description: '' },
              ],
              defaultReasoningEffort: 'xhigh',
            }
          : {
              id: 'grok-code-fast-1',
              model: 'grok-code-fast-1',
              displayName: 'grok-code-fast-1',
              description: 'Grok model',
              isDefault: true,
              hidden: false,
              supportedReasoningEfforts: [],
              defaultReasoningEffort: null,
            };
        return Promise.resolve({
          ok: true,
          json: async () => [model],
        } satisfies Partial<Response> as Response);
      }
      if (url === '/api/agent-runtimes/acp/install' && init?.method === 'POST') {
        codexAdapterInstalled = true;
        return Promise.resolve({
          ok: true,
          json: async () => acpBackend,
        } satisfies Partial<Response> as Response);
      }
      if (url === '/api/threads/start' && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: 'thread-acp',
            workspaceId: 'workspace-1',
            provider: 'acp',
            agentId: 'codex',
            providerSessionId: 'codex::session-1',
            source: 'supervisor',
            title: 'ACP Thread',
            model: 'gpt-5.6-sol',
            reasoningEffort: 'xhigh',
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
        <Harness defaultBackend="acp" />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('radio', { name: /Grok Build/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Gemini CLI/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(
      screen.queryByRole('button', { name: /Install ACP adapter for Gemini CLI/ }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {
      name: 'Install ACP adapter for OpenAI Codex',
    }));
    await waitFor(() => {
      expect(screen.getByRole('radio', { name: /OpenAI Codex/ })).toBeChecked();
      expect(screen.getByLabelText('Model')).toHaveValue('gpt-5.6-sol');
      expect(screen.getByLabelText('Reasoning effort')).toHaveValue('xhigh');
    });
    const installCall = fetchMock.mock.calls.find(
      ([url, init]) => String(url) === '/api/agent-runtimes/acp/install' && init?.method === 'POST',
    );
    expect(JSON.parse(String(installCall?.[1]?.body))).toEqual({
      action: 'install',
      modelId: 'codex',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Create Thread' }));
    await waitFor(() => {
      expect(screen.getByText('thread detail')).toBeInTheDocument();
    });
    const createCall = fetchMock.mock.calls.find(
      ([url, init]) => String(url) === '/api/threads/start' && init?.method === 'POST',
    );
    expect(JSON.parse(String(createCall?.[1]?.body))).toMatchObject({
      provider: 'acp',
      agentId: 'codex',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'xhigh',
    });
  });
});
