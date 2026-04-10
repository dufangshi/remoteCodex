import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ThreadImportPage } from './ThreadImportPage';

describe('ThreadImportPage', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          thread: {
            id: 'thread-imported-1',
          },
        }),
      }),
    );
  });

  it('imports a local session and navigates to the imported thread', async () => {
    render(
      <MemoryRouter initialEntries={['/threads/import']}>
        <Routes>
          <Route path="/threads/import" element={<ThreadImportPage />} />
          <Route path="/threads/:id" element={<div>Imported Thread Ready</div>} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText(/local session id/i), {
      target: { value: ' 019d6fb7-7033-7a30-a2c7-74d0919e87d4 ' },
    });
    fireEvent.click(screen.getByRole('button', { name: /import session/i }));

    await waitFor(() => {
      expect(screen.getByText('Imported Thread Ready')).toBeInTheDocument();
    });

    const [input, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(input)).toContain('/api/threads/import');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(
      JSON.stringify({
        sessionId: '019d6fb7-7033-7a30-a2c7-74d0919e87d4',
      }),
    );
  });
});
