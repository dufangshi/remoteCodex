import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './app';

describe('App', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          appName: 'Remote Codex Supervisor',
          appVersion: '0.1.0',
          host: '127.0.0.1',
          port: 8787,
          workspaceRoot: '/Users/test',
          environment: 'development'
        })
      })
    );
  });

  it('renders the landing page', async () => {
    window.history.pushState({}, '', '/');
    render(<App />);

    expect(screen.getByText(/Bring your local workspaces/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('/Users/test')).toBeInTheDocument();
    });
  });
});
