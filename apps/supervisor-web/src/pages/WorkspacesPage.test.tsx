import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppShellNavContext } from '../components/AppShellNavContext';
import { WorkspacesPage } from './WorkspacesPage';

describe('WorkspacesPage', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (
          url.endsWith('/api/workspaces') &&
          (!init?.method || init.method === 'GET')
        ) {
          return Promise.resolve({
            ok: true,
            json: async () => [
              {
                id: 'workspace-1',
                hostId: 'host-1',
                label: 'Demo Workspace',
                absPath: '/Users/test/projects/demo-workspace',
                isFavorite: false,
                createdAt: new Date('2026-04-10T12:00:00.000Z').toISOString(),
                lastOpenedAt: null,
              },
              {
                id: 'workspace-2',
                hostId: 'host-1',
                label: 'Recent Workspace',
                absPath: '/Users/test/projects/recent-workspace',
                isFavorite: false,
                createdAt: new Date('2026-04-09T12:00:00.000Z').toISOString(),
                lastOpenedAt: new Date('2026-04-11T08:00:00.000Z').toISOString(),
              },
            ],
          });
        }

        if (
          url.endsWith('/api/workspaces/workspace-1') &&
          init?.method === 'PATCH'
        ) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              id: 'workspace-1',
              hostId: 'host-1',
              label: 'Renamed Workspace',
              absPath: '/Users/test/projects/demo-workspace',
              isFavorite: false,
              createdAt: new Date('2026-04-10T12:00:00.000Z').toISOString(),
              lastOpenedAt: null,
            }),
          });
        }

        if (
          url.endsWith('/api/workspaces/workspace-1') &&
          init?.method === 'DELETE'
        ) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              id: 'workspace-1',
            }),
          });
        }

        if (
          url.endsWith('/api/workspaces/workspace-1/favorite') &&
          init?.method === 'POST'
        ) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              id: 'workspace-1',
              hostId: 'host-1',
              label: 'Demo Workspace',
              absPath: '/Users/test/projects/demo-workspace',
              isFavorite: true,
              createdAt: new Date('2026-04-10T12:00:00.000Z').toISOString(),
              lastOpenedAt: null,
            }),
          });
        }

        return Promise.reject(new Error(`Unexpected request: ${url}`));
      }),
    );
  });

  function renderPage({ navOpen = false }: { navOpen?: boolean } = {}) {
    const toggleNav = vi.fn();

    render(
      <AppShellNavContext.Provider
        value={{
          navOpen,
          openNav: vi.fn(),
          toggleNav,
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
        <MemoryRouter initialEntries={['/workspaces']}>
          <Routes>
            <Route path="/workspaces" element={<WorkspacesPage />} />
            <Route path="/threads" element={<div>Workspace Threads</div>} />
          </Routes>
        </MemoryRouter>
      </AppShellNavContext.Provider>,
    );

    return { toggleNav };
  }

  it('shows the compact topbar actions and opens workspace threads from the row body', async () => {
    const { toggleNav } = renderPage();

    await waitFor(() => {
      expect(screen.getByText('Demo Workspace')).toBeInTheDocument();
      expect(screen.getByText('Recent Workspace')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /open navigation/i }));
    expect(toggleNav).toHaveBeenCalled();

    expect(screen.getByRole('link', { name: /^Import$/i })).toHaveAttribute(
      'href',
      '/threads/import',
    );
    expect(screen.getByRole('link', { name: /^Create$/i })).toHaveAttribute(
      'href',
      '/workspaces/new',
    );
    expect(screen.queryByRole('link', { name: /Open tree/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Demo Workspace'));

    await waitFor(() => {
      expect(screen.getByText('Workspace Threads')).toBeInTheDocument();
    });
  });

  it('renders the unified menu with workspaces disabled on the workspaces page', async () => {
    renderPage({ navOpen: true });

    await waitFor(() => {
      expect(screen.getByText('Demo Workspace')).toBeInTheDocument();
    });

    expect(
      screen.getByRole('button', { name: /^Workspaces$/i }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: /^Settings$/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /^Threads$/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /^New Thread$/i }),
    ).not.toBeInTheDocument();
  });

  it('renames a workspace only after save is clicked', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Demo Workspace')).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole('button', { name: 'Rename workspace Demo Workspace' }),
    );
    expect(
      screen.getByRole('dialog', { name: 'Rename Workspace' }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Workspace Label/i), {
      target: { value: 'Renamed Workspace' },
    });

    expect(vi.mocked(fetch).mock.calls).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: /Save/i }));

    await waitFor(() => {
      expect(screen.getByText('Renamed Workspace')).toBeInTheDocument();
    });

    const patchCall = vi.mocked(fetch).mock.calls.find(
      ([input, init]) =>
        String(input).endsWith('/api/workspaces/workspace-1') &&
        init?.method === 'PATCH',
    );
    expect(patchCall?.[1]?.body).toBe(
      JSON.stringify({ label: 'Renamed Workspace' }),
    );
  });

  it('pins a workspace to the top immediately and shows the full path dialog', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Recent Workspace')).toBeInTheDocument();
      expect(screen.getByText('Demo Workspace')).toBeInTheDocument();
    });

    const rowsBefore = screen
      .getAllByRole('link')
      .filter((node) => node.getAttribute('href') === null);
    expect(rowsBefore[0]).toHaveTextContent('Recent Workspace');
    expect(rowsBefore[1]).toHaveTextContent('Demo Workspace');

    fireEvent.click(
      screen.getByRole('button', { name: 'Pin workspace Demo Workspace' }),
    );

    await waitFor(() => {
      const rowsAfter = screen
        .getAllByRole('link')
        .filter((node) => node.getAttribute('href') === null);
      expect(rowsAfter[0]).toHaveTextContent('Demo Workspace');
      expect(
        screen.getByRole('button', { name: 'Unpin workspace Demo Workspace' }),
      ).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole('button', {
        name: '/Users/test/projects/demo-workspace',
      }),
    );

    await waitFor(() => {
      const dialog = screen.getByRole('dialog', { name: 'Workspace Path' });
      expect(dialog).toBeInTheDocument();
      expect(
        within(dialog).getByText('/Users/test/projects/demo-workspace'),
      ).toBeInTheDocument();
    });
  });

  it('deletes a workspace only after confirmation', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Demo Workspace')).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole('button', { name: 'Delete workspace Demo Workspace' }),
    );

    await waitFor(() => {
      expect(
        screen.getByRole('dialog', { name: 'Delete Workspace' }),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Delete Workspace' }));

    await waitFor(() => {
      expect(screen.queryByText('Demo Workspace')).not.toBeInTheDocument();
    });

    const deleteCall = vi.mocked(fetch).mock.calls.find(
      ([input, init]) =>
        String(input).endsWith('/api/workspaces/workspace-1') &&
        init?.method === 'DELETE',
    );
    expect(deleteCall).toBeTruthy();
  });
});
