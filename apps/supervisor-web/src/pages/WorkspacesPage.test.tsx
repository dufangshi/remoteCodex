import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WorkspacesPage } from './WorkspacesPage';

describe('WorkspacesPage', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url.endsWith('/api/workspaces') && (!init?.method || init.method === 'GET')) {
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
            ],
          });
        }

        if (url.endsWith('/api/workspaces/workspace-1') && init?.method === 'PATCH') {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              id: 'workspace-1',
              hostId: 'host-1',
              label: 'Renamed Workspace',
              absPath: '/tmp/demo',
              isFavorite: false,
              createdAt: new Date().toISOString(),
              lastOpenedAt: null,
            }),
          });
        }

        return Promise.reject(new Error(`Unexpected request: ${url}`));
      }),
    );
  });

  it('shows import and add-workspace entry points together', async () => {
    render(
      <MemoryRouter initialEntries={['/workspaces']}>
        <Routes>
          <Route path="/workspaces" element={<WorkspacesPage />} />
          <Route path="/threads" element={<div>Workspace Threads</div>} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('Demo Workspace')).toBeInTheDocument();
    });

    expect(screen.getByRole('link', { name: /Import Session/i })).toHaveAttribute(
      'href',
      '/threads/import',
    );
    expect(screen.getByRole('link', { name: /Add Workspace/i })).toHaveAttribute(
      'href',
      '/workspaces/new',
    );

    fireEvent.click(screen.getByText('Demo Workspace'));

    await waitFor(() => {
      expect(screen.getByText('Workspace Threads')).toBeInTheDocument();
    });
  });

  it('renames a workspace only after save is clicked', async () => {
    render(
      <MemoryRouter>
        <WorkspacesPage />
      </MemoryRouter>,
    );

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
      ([input, init]) => String(input).endsWith('/api/workspaces/workspace-1') && init?.method === 'PATCH',
    );
    expect(patchCall?.[1]?.body).toBe(JSON.stringify({ label: 'Renamed Workspace' }));
  });
});
