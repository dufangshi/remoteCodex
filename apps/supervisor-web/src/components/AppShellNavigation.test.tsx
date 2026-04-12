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

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

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

    fireEvent.click(
      screen.getByRole('button', { name: /config\.toml.*codex runtime configuration/i }),
    );

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
});
