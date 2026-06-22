import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentBackendDto, AgentBackendIdDto } from '@remote-codex/shared';
import { AppShellNavContext } from './AppShellNavContext';
import {
  AppShellNavigationMenu,
  AppShellSettingsDialog,
} from './AppShellNavigation';

const codexBackendResponse: AgentBackendDto = {
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
    hostConfigFiles: [
      {
        name: 'config.toml',
        label: 'config.toml',
        description: 'Runtime configuration',
        roles: ['runtime', 'mcp'],
      },
      {
        name: 'auth.json',
        label: 'auth.json',
        description: 'Authentication state',
        roles: ['auth'],
      },
    ],
    toolboxItems: [
      { action: 'fast', command: '/fast', label: 'Fast mode' },
      { action: 'compact', command: '/compact', label: 'Compact context' },
      { action: 'goal', command: '/goal', label: 'Goal' },
      { action: 'fork', command: '/fork', label: 'Fork', panel: 'fork' },
      { action: 'skills', command: '/skills', label: 'Skills', panel: 'skills' },
      { action: 'mcp', command: '/mcp', label: 'MCP', panel: 'mcp' },
      { action: 'hooks', command: '/hooks', label: 'Hooks', panel: 'hooks' },
    ],
    hookCommandTemplates: [
      {
        eventName: 'preToolUse',
        command:
          'node -e "process.stdin.resume(); process.stdin.on(\'end\', () => console.error(\'remote-codex hook ran\'))"',
      },
      {
        eventName: 'stop',
        command:
          'node -e \'process.stdin.resume(); process.stdin.on("end", () => console.log(JSON.stringify({ systemMessage: "remote-codex hook ran" })))\'',
      },
    ],
    providerConfigFormat: 'toml',
    mcpConfigFormat: 'codex-toml',
    configArchives: true,
    buildRestart: true,
  },
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

const claudeBackendResponse = {
  ...codexBackendResponse,
  provider: 'claude',
  displayName: 'Claude',
  description: 'Claude Code SDK runtime.',
  isDefault: false,
  status: {
    ...codexBackendResponse.status,
    transport: 'sdk',
  },
  capabilities: {
    ...codexBackendResponse.capabilities,
    sessions: { list: true, read: true, resume: true, importLocal: false },
    turns: { start: true, streamInput: false, steer: false, interrupt: true, compact: false },
    branching: { fork: false, hardRollback: false, resumeAt: false, rewindFiles: false },
    controls: {
      planMode: true,
      permissionRequests: true,
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
    usage: { contextWindow: true, tokenUsage: true, costUsd: true },
  },
  managementSchema: {
    hostConfigFiles: [],
    toolboxItems: [],
    hookCommandTemplates: [],
    providerConfigFormat: 'none',
    mcpConfigFormat: 'none',
    configArchives: false,
    buildRestart: false,
  },
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

function NavigationHarness() {
  const [navOpen, setNavOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [themeMode, setThemeMode] = useState<'system' | 'light' | 'dark'>('system');
  const [defaultBackend, setDefaultBackend] = useState<AgentBackendIdDto>('codex');

  return (
    <AppShellNavContext.Provider
      value={{
        navOpen,
        openNav: () => setNavOpen(true),
        toggleNav: () => setNavOpen((current) => !current),
        closeNav: () => setNavOpen(false),
        settingsOpen,
        openSettings: () => {
          setNavOpen(false);
          setSettingsOpen(true);
        },
        closeSettings: () => setSettingsOpen(false),
        themeMode,
        setThemeMode,
        effectiveTheme: themeMode === 'system' ? 'dark' : themeMode,
        defaultBackend,
        setDefaultBackend,
      }}
    >
      <AppShellNavigationMenu />
      <AppShellSettingsDialog />
    </AppShellNavContext.Provider>
  );
}

describe('AppShellNavigation', () => {
  let installClaudeShouldFail = false;
  beforeEach(() => {
    installClaudeShouldFail = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo, init?: RequestInit) => {
        const url = String(input);

        if (url === '/api/agent-runtimes' && !init?.method) {
          return {
            ok: true,
            json: async () => [codexBackendResponse, claudeBackendResponse],
          } satisfies Partial<Response>;
        }

        if (url === '/api/agent-runtimes/codex/restart' && init?.method === 'POST') {
          return {
            ok: true,
            json: async () => ({
              ...codexBackendResponse,
              status: {
                ...codexBackendResponse.status,
                restartCount: 1,
              },
            }),
          } satisfies Partial<Response>;
        }

        if (url === '/api/agent-runtimes/claude/install' && init?.method === 'POST') {
          if (installClaudeShouldFail) {
            return {
              ok: false,
              status: 500,
              json: async () => ({
                code: 'bad_request',
                message: 'npm install failed: install failed',
                details: {
                  stderr: 'install failed\npermission denied',
                },
              }),
            } satisfies Partial<Response>;
          }
          return {
            ok: true,
            json: async () => ({
              ...claudeBackendResponse,
              enabled: true,
              installation: {
                ...claudeBackendResponse.installation,
                installed: true,
                installedVersion: '2.1.148 (SDK 0.3.148)',
                lastError: null,
              },
            }),
          } satisfies Partial<Response>;
        }

        if (url === '/api/config/workspace-settings' && !init?.method) {
          return {
            ok: true,
            json: async () => ({
              workspaceRoot: '/tmp',
              devHome: '/tmp/dev',
              defaultBackend: 'codex',
            }),
          } satisfies Partial<Response>;
        }

        if (url === '/api/config/workspace-settings' && init?.method === 'PATCH') {
          return {
            ok: true,
            json: async () => ({
              workspaceRoot: '/tmp',
              devHome: JSON.parse(String(init.body)).devHome.replace(/\/+$/, ''),
              defaultBackend: JSON.parse(String(init.body)).defaultBackend ?? 'codex',
            }),
          } satisfies Partial<Response>;
        }

        if (url === '/api/config/providers/codex/files/config.toml' && !init?.method) {
          return {
            ok: true,
            json: async () => ({
              name: 'config.toml',
              path: '/tmp/test-codex-home/config.toml',
              exists: true,
              content: 'model = "gpt-5.4"\n',
            }),
          } satisfies Partial<Response>;
        }

        if (url === '/api/config/providers/codex/files/auth.json' && !init?.method) {
          return {
            ok: true,
            json: async () => ({
              name: 'auth.json',
              path: '/tmp/test-codex-home/auth.json',
              exists: true,
              content: '{\n  "token": "abc"\n}\n',
            }),
          } satisfies Partial<Response>;
        }

        if (url === '/api/config/providers/codex/files/config.toml' && init?.method === 'PATCH') {
          return {
            ok: true,
            json: async () => ({
              name: 'config.toml',
              path: '/tmp/test-codex-home/config.toml',
              exists: true,
              content: JSON.parse(String(init.body)).content,
            }),
          } satisfies Partial<Response>;
        }

        if (url === '/api/config/providers/codex/files/auth.json' && init?.method === 'PATCH') {
          return {
            ok: true,
            json: async () => ({
              name: 'auth.json',
              path: '/tmp/test-codex-home/auth.json',
              exists: true,
              content: JSON.parse(String(init.body)).content,
            }),
          } satisfies Partial<Response>;
        }

        if (url === '/api/config/providers/codex/archives' && !init?.method) {
          return {
            ok: true,
            json: async () => [
              {
                id: 'archive-1',
                label: 'Known good',
                createdAt: '2026-04-11T00:00:00.000Z',
                updatedAt: '2026-04-11T00:00:00.000Z',
                files: {
                  'config.toml': { name: 'config.toml', exists: true },
                  'auth.json': { name: 'auth.json', exists: false },
                },
              },
            ],
          } satisfies Partial<Response>;
        }

        if (url === '/api/config/providers/codex/archives' && init?.method === 'POST') {
          return {
            ok: true,
            json: async () => ({
              id: 'archive-2',
              label: 'Backup 2026-04-11 00:00 UTC',
              createdAt: '2026-04-11T00:00:00.000Z',
              updatedAt: '2026-04-11T00:00:00.000Z',
              files: {
                'config.toml': { name: 'config.toml', exists: true },
                'auth.json': { name: 'auth.json', exists: true },
              },
            }),
          } satisfies Partial<Response>;
        }

        if (url === '/api/config/providers/codex/archives/archive-1' && init?.method === 'PATCH') {
          return {
            ok: true,
            json: async () => ({
              id: 'archive-1',
              label: JSON.parse(String(init.body)).label,
              createdAt: '2026-04-11T00:00:00.000Z',
              updatedAt: '2026-04-11T00:01:00.000Z',
              files: {
                'config.toml': { name: 'config.toml', exists: true },
                'auth.json': { name: 'auth.json', exists: false },
              },
            }),
          } satisfies Partial<Response>;
        }

        if (url === '/api/config/providers/codex/archives/archive-1/apply' && init?.method === 'POST') {
          return {
            ok: true,
            json: async () => ({
              archive: {
                id: 'archive-1',
                label: 'Known good',
                createdAt: '2026-04-11T00:00:00.000Z',
                updatedAt: '2026-04-11T00:00:00.000Z',
                files: {
                  'config.toml': { name: 'config.toml', exists: true },
                  'auth.json': { name: 'auth.json', exists: false },
                },
              },
              status: {
                state: 'ready',
                transport: 'stdio',
                lastStartedAt: '2026-04-11T00:00:00.000Z',
                lastError: null,
                restartCount: 2,
              },
            }),
          } satisfies Partial<Response>;
        }

        if (url === '/api/service/build-restart' && init?.method === 'POST') {
          return {
            ok: true,
            json: async () => ({
              status: 'launched',
              pid: 12345,
              message: 'Build and restart launched.',
            }),
          } satisfies Partial<Response>;
        }

        return {
          ok: false,
          json: async () => ({
            code: 'not_found',
            message: `Unhandled request for ${url}`,
          }),
        } satisfies Partial<Response>;
      }),
    );
  });

  it('shows product routes and settings, with workspaces disabled on the workspaces route', () => {
    render(
      <MemoryRouter initialEntries={['/workspaces']}>
        <NavigationHarness />
      </MemoryRouter>,
    );

    expect(screen.getByRole('button', { name: 'Workspaces' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Control Plane' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Threads' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New Thread' })).not.toBeInTheDocument();
  });

  it('omits the control-plane menu item when the control-plane base URL is not configured', () => {
    render(
      <MemoryRouter initialEntries={['/control-plane']}>
        <NavigationHarness />
      </MemoryRouter>,
    );

    expect(screen.getByRole('button', { name: 'Workspaces' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Control Plane' })).not.toBeInTheDocument();
  });

  it('closes the navigation menu when clicking outside it', () => {
    render(
      <MemoryRouter initialEntries={['/threads?workspaceId=workspace-1']}>
        <NavigationHarness />
      </MemoryRouter>,
    );

    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('button', { name: 'Settings' })).not.toBeInTheDocument();
  });

  it('opens and closes the settings dialog from the shared navigation menu', () => {
    render(
      <MemoryRouter initialEntries={['/threads?workspaceId=workspace-1']}>
        <NavigationHarness />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));

    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Close Settings' })[0]!);

    expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeInTheDocument();
  });

  it('does not expose backend tools from frontend fallbacks when runtime descriptors fail', async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url === '/api/agent-runtimes' && !init?.method) {
        return {
          ok: false,
          json: async () => ({
            code: 'unavailable',
            message: 'Runtime descriptors unavailable.',
          }),
        } as Response;
      }

      if (url === '/api/config/workspace-settings' && !init?.method) {
        return {
          ok: true,
          json: async () => ({
            workspaceRoot: '/tmp',
            devHome: '/tmp/dev',
            defaultBackend: 'codex',
          }),
        } as Response;
      }

      throw new Error(`Unexpected request in fallback test: ${url}`);
    });

    render(
      <MemoryRouter initialEntries={['/threads?workspaceId=workspace-1']}>
        <NavigationHarness />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));

    await waitFor(() => {
      expect(screen.getByText('Runtime descriptors unavailable.')).toBeInTheDocument();
    });

    expect(screen.getByText('This backend does not expose editable host files.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /config\.toml/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /auth\.json/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Config archives')).not.toBeInTheDocument();
  });

  it('loads codex host files into the settings editor and saves changes', async () => {
    render(
      <MemoryRouter initialEntries={['/threads?workspaceId=workspace-1']}>
        <NavigationHarness />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /config\.toml.*runtime configuration/i }),
      ).toBeInTheDocument();
    });

    expect(screen.queryByLabelText('Edit config.toml')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /auth\.json.*authentication state/i }),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: /config\.toml.*runtime configuration/i }),
    );

    await waitFor(() => {
      expect(screen.getByLabelText('Edit config.toml')).toHaveValue('model = "gpt-5.4"\n');
    });

    expect(screen.getByText('/tmp/test-codex-home/config.toml')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Edit config.toml'), {
      target: { value: 'model = "gpt-5.4"\napproval_policy = "never"\n' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save config.toml' }));

    await waitFor(() => {
      expect(screen.getByText('Saved')).toBeInTheDocument();
    });

    const patchCall = vi.mocked(fetch).mock.calls.find(
      ([url, init]) =>
        String(url) === '/api/config/providers/codex/files/config.toml' && init?.method === 'PATCH',
    );
    expect(patchCall).toBeTruthy();
    expect(JSON.parse(String(patchCall?.[1]?.body))).toEqual({
      content: 'model = "gpt-5.4"\napproval_policy = "never"\n',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Close File Editor' }));

    expect(screen.queryByLabelText('Edit config.toml')).not.toBeInTheDocument();
  });

  it('loads and saves workspace defaults in settings', async () => {
    render(
      <MemoryRouter initialEntries={['/threads?workspaceId=workspace-1']}>
        <NavigationHarness />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));

    await waitFor(() => {
      expect(screen.getByText('/tmp')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/dev home/i), {
      target: { value: '/tmp/dev/projects/' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save workspace defaults' }));

    await waitFor(() => {
      expect(screen.getByText('Workspace defaults saved.')).toBeInTheDocument();
    });

    const patchCall = vi.mocked(fetch).mock.calls.find(
      ([url, init]) =>
        String(url) === '/api/config/workspace-settings' && init?.method === 'PATCH',
    );
    expect(patchCall).toBeTruthy();
    expect(JSON.parse(String(patchCall?.[1]?.body))).toEqual({
      devHome: '/tmp/dev/projects/',
    });
  });

  it('does not render the idle editor area before a file is selected', async () => {
    render(
      <MemoryRouter initialEntries={['/threads?workspaceId=workspace-1']}>
        <NavigationHarness />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /config\.toml.*runtime configuration/i }),
      ).toBeInTheDocument();
    });

    expect(
      screen.queryByText(/Select `config\.toml` or `auth\.json` to open the editor\./i),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Edit config.toml')).not.toBeInTheDocument();
  });

  it('restarts the selected backend from settings', async () => {
    render(
      <MemoryRouter initialEntries={['/threads?workspaceId=workspace-1']}>
        <NavigationHarness />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Restart' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Restart' }));

    await waitFor(() => {
      expect(screen.getByText('Codex backend restarted.')).toBeInTheDocument();
    });

    const restartCall = vi.mocked(fetch).mock.calls.find(
      ([url, init]) =>
        String(url) === '/api/agent-runtimes/codex/restart' && init?.method === 'POST',
    );
    expect(restartCall).toBeTruthy();
  });

  it('launches service build and restart from settings', async () => {
    render(
      <MemoryRouter initialEntries={['/threads?workspaceId=workspace-1']}>
        <NavigationHarness />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Build and restart' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Build and restart' }));

    await waitFor(() => {
      expect(
        screen.getByText('Build and restart launched. The page may disconnect briefly.'),
      ).toBeInTheDocument();
    });

    const restartCall = vi.mocked(fetch).mock.calls.find(
      ([url, init]) =>
        String(url) === '/api/service/build-restart' && init?.method === 'POST',
    );
    expect(restartCall).toBeTruthy();
  });

  it('does not expose backend selection in settings', async () => {
    render(
      <MemoryRouter initialEntries={['/threads?workspaceId=workspace-1']}>
        <NavigationHarness />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Build and restart' })).toBeInTheDocument();
    });

    expect(screen.queryByText('Backend')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Build and restart' })).toBeInTheDocument();
  });

  it('shows backend versions with update or install actions in settings', async () => {
    render(
      <MemoryRouter initialEntries={['/threads?workspaceId=workspace-1']}>
        <NavigationHarness />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));

    await waitFor(() => {
      expect(screen.getByText(/Version:\s*codex-cli 0\.131\.0/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/Latest:\s*0\.133\.0/i)).toBeInTheDocument();
    expect(screen.getByText(/Claude Code command is not available/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Update Codex' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Install Claude' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Install Claude' }));
    expect(screen.getByRole('button', { name: 'Install Claude' })).toHaveTextContent('Installing...');

    await waitFor(() => {
      expect(
        vi.mocked(fetch).mock.calls.some(
          ([url, init]) =>
            String(url) === '/api/agent-runtimes/claude/install' &&
            init?.method === 'POST' &&
            String(init.body).includes('"install"'),
        ),
      ).toBe(true);
    });
    expect(await screen.findByText('Claude installed.')).toBeInTheDocument();
  });

  it('shows install failure details from backend command output', async () => {
    installClaudeShouldFail = true;
    render(
      <MemoryRouter initialEntries={['/threads?workspaceId=workspace-1']}>
        <NavigationHarness />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Install Claude' })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Install Claude' }));

    await waitFor(() => {
      expect(screen.getByText(/npm install failed: install failed/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/permission denied/i)).toBeInTheDocument();
  });

  it('manages codex config archives from settings', async () => {
    render(
      <MemoryRouter initialEntries={['/threads?workspaceId=workspace-1']}>
        <NavigationHarness />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));

    await waitFor(() => {
      expect(screen.getByText('Known good')).toBeInTheDocument();
    });

    expect(screen.getByText(/config\.toml: saved/i)).toBeInTheDocument();
    expect(screen.getByText(/auth\.json: missing/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Create backup' }));

    await waitFor(() => {
      expect(screen.getByText('Backup created.')).toBeInTheDocument();
    });

    fireEvent.click(screen.getAllByRole('button', { name: 'Rename' })[1]!);
    fireEvent.change(screen.getByLabelText('Rename Known good'), {
      target: { value: 'Laptop config' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save archive name Known good' }));

    await waitFor(() => {
      expect(screen.getByText('Backup renamed.')).toBeInTheDocument();
    });

    fireEvent.click(screen.getAllByRole('button', { name: 'Apply' })[1]!);

    await waitFor(() => {
      expect(
        screen.getByText('Applied "Known good" and restarted Codex.'),
      ).toBeInTheDocument();
    });

    expect(
      vi.mocked(fetch).mock.calls.some(
        ([url, init]) =>
          String(url) === '/api/config/providers/codex/archives/archive-1/apply' &&
          init?.method === 'POST',
      ),
    ).toBe(true);
  });

  it('lets the user switch the appearance mode from settings', async () => {
    render(
      <MemoryRouter initialEntries={['/threads?workspaceId=workspace-1']}>
        <NavigationHarness />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Light/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Light/i }));
    expect(screen.getByText(/Active:\s*light\./i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Dark/i }));
    expect(screen.getByText(/Active:\s*dark\./i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /System/i }));
    expect(screen.getByText(/Active:\s*dark\./i)).toBeInTheDocument();
  });
});
