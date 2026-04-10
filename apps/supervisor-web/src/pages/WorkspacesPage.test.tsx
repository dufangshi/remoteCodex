import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WorkspacesPage } from './WorkspacesPage';

describe('WorkspacesPage', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [],
      }),
    );
  });

  it('shows import and add-workspace entry points together', async () => {
    render(
      <MemoryRouter>
        <WorkspacesPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText(/No workspaces yet/i)).toBeInTheDocument();
    });

    expect(screen.getByRole('link', { name: /Import Session/i })).toHaveAttribute(
      'href',
      '/threads/import',
    );
    expect(screen.getByRole('link', { name: /Add Workspace/i })).toHaveAttribute(
      'href',
      '/workspaces/new',
    );
  });
});
