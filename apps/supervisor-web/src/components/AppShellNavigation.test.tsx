import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppShellNavContext } from './AppShellNavContext';
import {
  AppShellNavigationMenu,
  AppShellSettingsDialog,
} from './AppShellNavigation';

function NavigationHarness() {
  const [navOpen, setNavOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [themeMode, setThemeMode] = useState<'system' | 'light' | 'dark'>('system');

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
      }}
    >
      <AppShellNavigationMenu />
      <AppShellSettingsDialog />
    </AppShellNavContext.Provider>
  );
}

describe('AppShellNavigation', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo, init?: RequestInit) => {
        const url = String(input);

        if (url === '/api/config/workspace-settings' && !init?.method) {
          return {
            ok: true,
            json: async () => ({
              workspaceRoot: '/tmp',
              devHome: '/tmp/dev',
            }),
          } satisfies Partial<Response>;
        }

        if (url === '/api/config/workspace-settings' && init?.method === 'PATCH') {
          return {
            ok: true,
            json: async () => ({
              workspaceRoot: '/tmp',
              devHome: JSON.parse(String(init.body)).devHome.replace(/\/+$/, ''),
            }),
          } satisfies Partial<Response>;
        }

        if (url === '/api/config/codex-files/config.toml' && !init?.method) {
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

        if (url === '/api/config/codex-files/auth.json' && !init?.method) {
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

        if (url === '/api/config/codex-files/config.toml' && init?.method === 'PATCH') {
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

        if (url === '/api/config/codex-files/auth.json' && init?.method === 'PATCH') {
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

        if (url === '/api/config/codex-archives' && !init?.method) {
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

        if (url === '/api/config/codex-archives' && init?.method === 'POST') {
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

        if (url === '/api/config/codex-archives/archive-1' && init?.method === 'PATCH') {
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

        if (url === '/api/config/codex-archives/archive-1/apply' && init?.method === 'POST') {
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

        if (url === '/api/codex/restart' && init?.method === 'POST') {
          return {
            ok: true,
            json: async () => ({
              state: 'ready',
              transport: 'stdio',
              lastStartedAt: '2026-04-11T00:00:00.000Z',
              lastError: null,
              restartCount: 1,
            }),
          } satisfies Partial<Response>;
        }

        if (url === '/api/codex/build-restart' && init?.method === 'POST') {
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

  it('shows only workspaces and settings, with workspaces disabled on the workspaces route', () => {
    render(
      <MemoryRouter initialEntries={['/workspaces']}>
        <NavigationHarness />
      </MemoryRouter>,
    );

    expect(screen.getByRole('button', { name: 'Workspaces' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Threads' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New Thread' })).not.toBeInTheDocument();
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

  it('loads codex host files into the settings editor and saves changes', async () => {
    render(
      <MemoryRouter initialEntries={['/threads?workspaceId=workspace-1']}>
        <NavigationHarness />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /config\.toml.*codex runtime configuration/i }),
      ).toBeInTheDocument();
    });

    expect(screen.queryByLabelText('Edit config.toml')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /auth\.json.*codex authentication state/i }),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: /config\.toml.*codex runtime configuration/i }),
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
        String(url) === '/api/config/codex-files/config.toml' && init?.method === 'PATCH',
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
        screen.getByRole('button', { name: /config\.toml.*codex runtime configuration/i }),
      ).toBeInTheDocument();
    });

    expect(
      screen.queryByText(/Select `config\.toml` or `auth\.json` to open the editor\./i),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Edit config.toml')).not.toBeInTheDocument();
  });

  it('restarts the codex app-server from settings', async () => {
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
      expect(screen.getByText('App server restarted.')).toBeInTheDocument();
    });

    const restartCall = vi.mocked(fetch).mock.calls.find(
      ([url, init]) => String(url) === '/api/codex/restart' && init?.method === 'POST',
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
      ([url, init]) => String(url) === '/api/codex/build-restart' && init?.method === 'POST',
    );
    expect(restartCall).toBeTruthy();
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
        screen.getByText('Applied "Known good" and restarted app-server.'),
      ).toBeInTheDocument();
    });

    expect(
      vi.mocked(fetch).mock.calls.some(
        ([url, init]) =>
          String(url) === '/api/config/codex-archives/archive-1/apply' &&
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
