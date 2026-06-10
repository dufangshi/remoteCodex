import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@remote-codex/thread-ui', () => ({
  PluginProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { App } from './app';

describe('App', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/');
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('renders the landing page without login in local mode', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            authenticated: true,
            username: null,
            expiresAt: null,
            mode: 'local',
            authRequired: false,
          }),
        })
        .mockResolvedValue({
          ok: true,
          json: async () => ({
            appName: 'Remote Codex Supervisor',
            appVersion: '0.1.0',
            mode: 'local',
            host: '127.0.0.1',
            port: 8787,
            workspaceRoot: '/Users/test',
            environment: 'development'
          })
        })
    );
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/Bring your local workspaces/i)).toBeInTheDocument();
      expect(screen.getByText('/Users/test')).toBeInTheDocument();
    });
  });

  it('shows login only when the supervisor reports auth is required', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          authenticated: false,
          username: null,
          expiresAt: null,
          mode: 'server',
          authRequired: true,
        }),
      }),
    );

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    });
    expect(screen.queryByText(/Bring your local workspaces/i)).not.toBeInTheDocument();
  });
});
