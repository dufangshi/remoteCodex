import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WorkspaceNewPage } from './WorkspaceNewPage';

describe('WorkspaceNewPage', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url.endsWith('/api/workspaces') && init?.method === 'POST') {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              id: 'workspace-1',
              hostId: 'host-1',
              label: 'Demo Workspace',
              absPath: '/Users/test/projects/demo-workspace',
              isFavorite: false,
              createdAt: new Date('2026-04-10T12:00:00.000Z').toISOString(),
              lastOpenedAt: null,
            }),
          });
        }

        return Promise.reject(new Error(`Unexpected request: ${url}`));
      }),
    );
  });

  it('navigates directly to the workspace thread list after creation', async () => {
    render(
      <MemoryRouter initialEntries={['/workspaces/new']}>
        <Routes>
          <Route path="/workspaces/new" element={<WorkspaceNewPage />} />
          <Route path="/threads" element={<div>Workspace Threads Target</div>} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText(/path or git url/i), {
      target: { value: '/Users/test/projects/demo-workspace' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Workspace' }));

    await waitFor(() => {
      expect(screen.getByText('Workspace Threads Target')).toBeInTheDocument();
    });
  });

  it('submits git urls through the workspace creation endpoint', async () => {
    render(
      <MemoryRouter initialEntries={['/workspaces/new']}>
        <Routes>
          <Route path="/workspaces/new" element={<WorkspaceNewPage />} />
          <Route path="/threads" element={<div>Workspace Threads Target</div>} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText(/path or git url/i), {
      target: { value: 'https://github.com/example/demo-workspace.git' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Workspace' }));

    await waitFor(() => {
      expect(screen.getByText('Workspace Threads Target')).toBeInTheDocument();
    });

    const postCall = vi.mocked(fetch).mock.calls.find(
      ([url, init]) => String(url).endsWith('/api/workspaces') && init?.method === 'POST',
    );
    expect(JSON.parse(String(postCall?.[1]?.body))).toEqual({
      gitUrl: 'https://github.com/example/demo-workspace.git',
      label: 'demo-workspace',
    });
  });
});
