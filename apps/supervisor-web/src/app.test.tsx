import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@remote-codex/thread-ui', async () => {
  const React = await import('react');
  const AppShellNavContext = React.createContext<unknown>(null);

  return {
    AppShellNavContext,
    ConfirmDialog: ({
      children,
      confirmLabel = 'Confirm',
      onConfirm,
      open,
      title,
    }: {
      children?: React.ReactNode;
      confirmLabel?: string;
      onConfirm?: () => void;
      open?: boolean;
      title?: string;
    }) =>
      open ? (
        <div role="dialog" aria-label={title}>
          {children}
          <button type="button" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      ) : null,
    LongTextDialog: ({
      title,
      value,
    }: {
      title?: string;
      value?: string | null;
    }) =>
      value ? (
        <div role="dialog" aria-label={title}>
          {value}
        </div>
      ) : null,
    AppShellMenuButton: () => <button type="button">Open Navigation</button>,
    AppShellNavigationMenu: ({ children }: { children?: React.ReactNode }) => (
      <nav>{children}</nav>
    ),
    PluginProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    ThreadDetailSurface: () => (
      <div data-testid="thread-detail-surface">Thread detail</div>
    ),
    formatLongTimestamp: (value: string) => value,
    threadStatusLabel: (value: string) => value,
    useAppShellNav: () => React.useContext(AppShellNavContext),
    usePlugins: () => ({
      plugins: [],
      renderArtifact: () => null,
    }),
  };
});

import { App } from './app';

describe('App', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_CONTROL_PLANE_BASE_URL', '');
    window.history.pushState({}, '', '/');
    window.localStorage.clear();
    vi.unstubAllGlobals();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('redirects the root page to workspaces in local mode', async () => {
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
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [],
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
            environment: 'development',
          }),
        }),
    );
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('No workspaces yet')).toBeInTheDocument();
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
