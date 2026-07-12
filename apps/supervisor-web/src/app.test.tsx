import { act, render, screen, waitFor } from '@testing-library/react';
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
import { HOSTED_VM_WAKE_EVENT } from './lib/api';

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

  it('shows global hosted VM startup progress on every app route', async () => {
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
        .mockResolvedValueOnce({ ok: true, json: async () => [] })
        .mockResolvedValue({
          ok: true,
          json: async () => ({
            workspaceRoot: '/Users/test',
            environment: 'test',
          }),
        }),
    );
    render(<App />);
    await waitFor(() =>
      expect(screen.getByText('No workspaces yet')).toBeInTheDocument(),
    );

    act(() => {
      window.dispatchEvent(
        new CustomEvent(HOSTED_VM_WAKE_EVENT, {
          detail: { state: 'starting', attempt: 3 },
        }),
      );
    });
    expect(screen.getByText('Starting hosted VM')).toBeInTheDocument();
    expect(screen.getByText('Check 3')).toBeInTheDocument();

    act(() => {
      window.dispatchEvent(
        new CustomEvent(HOSTED_VM_WAKE_EVENT, {
          detail: { state: 'connected', attempt: 3 },
        }),
      );
    });
    expect(screen.queryByText('Starting hosted VM')).not.toBeInTheDocument();
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

  it('shows the relay home page at root when relay mode is active', async () => {
    window.localStorage.setItem('remote-codex-relay-mode', 'true');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          authenticated: false,
          user: null,
          registrationEnabled: true,
        }),
      }),
    );

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('heading', {
        name: /Connect a private Codex supervisor/i,
      })).toBeInTheDocument();
    });
    expect(
      screen.getAllByRole('link', { name: /Sign in/i }).some((link) =>
        link.getAttribute('href') === '/relay-portal',
      ),
    ).toBe(true);
  });

  it('renders the relay guide outside supervisor auth', async () => {
    window.history.pushState({}, '', '/relay-guide');
    vi.stubGlobal('fetch', vi.fn());

    render(<App />);

    expect(screen.getByRole('heading', {
      name: /Remote Codex connection modes and relay setup/i,
    })).toBeInTheDocument();
    expect(screen.getByText('Local mode')).toBeInTheDocument();
    expect(screen.getByText('Server mode')).toBeInTheDocument();
    expect(screen.getByText('Relay mode')).toBeInTheDocument();
  });

});
