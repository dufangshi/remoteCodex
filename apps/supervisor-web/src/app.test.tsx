import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
      <div data-testid="thread-detail-surface">Sandbox is not running</div>
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

  it('redirects the root route to control-plane when a control-plane base URL is configured', async () => {
    vi.stubEnv('VITE_CONTROL_PLANE_BASE_URL', 'https://control.example.test');
    window.localStorage.clear();
    window.history.pushState({}, '', '/');
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Control plane sign in' })).toBeInTheDocument();
    });
  });

  it('redirects protected control-plane routes to login until local auth exists', async () => {
    window.localStorage.clear();
    window.history.pushState({}, '', '/control-plane');
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Control plane sign in' })).toBeInTheDocument();
    });
  });

  it('shows a loading state while resolving protected control-plane auth', () => {
    window.localStorage.clear();
    window.history.pushState({}, '', '/control-plane');
    render(<App />);

    expect(screen.getByText('Loading account session...')).toBeInTheDocument();
  });

  it('does not load app-local plugins on control-plane routes', async () => {
    vi.stubEnv('VITE_CONTROL_PLANE_BASE_URL', 'http://127.0.0.1:8790');
    window.localStorage.clear();
    window.localStorage.setItem(
      'remote-codex-control-plane-auth',
      JSON.stringify({
        baseUrl: 'http://127.0.0.1:8790',
        token: 'dev:dev-user',
        email: 'dev@example.com',
        displayName: 'Developer',
      }),
    );
    window.history.pushState({}, '', '/control-plane/sessions/session-1');
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://127.0.0.1:8790');
      if (url.pathname === '/api/me') {
        return Response.json({
          user: {
            id: 'user-1',
            authProvider: 'dev',
            authSubject: 'dev-user',
            email: 'dev@example.com',
            displayName: 'Developer',
            status: 'active',
            plan: 'developer',
            billingCustomerId: null,
            quotaProfile: 'default',
            createdAt: '2026-05-25T00:00:00.000Z',
            updatedAt: '2026-05-25T00:00:00.000Z',
            lastSeenAt: '2026-05-25T00:00:00.000Z',
          },
          sandbox: {
            id: 'sandbox-1',
            userId: 'user-1',
            state: 'stopped',
            image: 'remote-codex-worker:dev',
            region: 'local',
            resourceProfile: 'standard',
            k8sNamespace: null,
            k8sPodName: null,
            routerBaseUrl: null,
            workerServiceName: null,
            s3Prefix: 's3://bucket/users/user-1',
            gatewayKeyId: null,
            lastStartedAt: null,
            lastSeenAt: null,
            idleTimeoutAt: null,
            statusReason: null,
            startupProgress: 0,
            lastFailureCode: null,
            lastFailureMessage: null,
            createdAt: '2026-05-25T00:00:00.000Z',
            updatedAt: '2026-05-25T00:00:00.000Z',
          },
          usage: {},
        });
      }
      return Response.json({ code: 'not_found', message: `Unhandled request: ${url.pathname}` }, { status: 404 });
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/Sandbox is not running/i)).toBeInTheDocument();
    });
    expect(
      vi.mocked(fetch).mock.calls.some(([input]) => String(input).includes('/api/plugins')),
    ).toBe(false);
  });

  it('stores local control-plane auth from the login route and enters the panel', async () => {
    window.localStorage.clear();
    window.history.pushState({}, '', '/control-plane/login');
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://127.0.0.1:8790');
      const path = `${url.pathname}${url.search}`;
      if (path === '/api/auth/password/login' && init?.method === 'POST') {
        return Response.json({
          user: {
            id: 'user-1',
            authProvider: 'dev',
            authSubject: 'dev-user',
            email: 'dev@example.com',
            displayName: 'Developer',
            status: 'active',
            plan: 'developer',
            billingCustomerId: null,
            quotaProfile: 'default',
            createdAt: '2026-05-25T00:00:00.000Z',
            updatedAt: '2026-05-25T00:00:00.000Z',
            lastSeenAt: '2026-05-25T00:00:00.000Z',
          },
          sandbox: {
            id: 'sandbox-1',
            userId: 'user-1',
            state: 'stopped',
            image: 'remote-codex-worker:dev',
            region: 'local',
            resourceProfile: 'standard',
            k8sNamespace: null,
            k8sPodName: null,
            routerBaseUrl: null,
            workerServiceName: null,
            s3Prefix: 's3://bucket/users/user-1',
            gatewayKeyId: null,
            lastStartedAt: null,
            lastSeenAt: null,
            idleTimeoutAt: null,
            statusReason: null,
            startupProgress: 0,
            lastFailureCode: null,
            lastFailureMessage: null,
            createdAt: '2026-05-25T00:00:00.000Z',
            updatedAt: '2026-05-25T00:00:00.000Z',
          },
          session: {
            token: 'session-token',
            expiresAt: '2099-06-01T00:00:00.000Z',
          },
        });
      }
      if (path === '/api/me') {
        return Response.json({
          user: {
            id: 'user-1',
            authProvider: 'dev',
            authSubject: 'dev-user',
            email: 'dev@example.com',
            displayName: 'Developer',
            status: 'active',
            plan: 'developer',
            billingCustomerId: null,
            quotaProfile: 'default',
            createdAt: '2026-05-25T00:00:00.000Z',
            updatedAt: '2026-05-25T00:00:00.000Z',
            lastSeenAt: '2026-05-25T00:00:00.000Z',
          },
          sandbox: {
            id: 'sandbox-1',
            userId: 'user-1',
            state: 'stopped',
            image: 'remote-codex-worker:dev',
            region: 'local',
            resourceProfile: 'standard',
            k8sNamespace: null,
            k8sPodName: null,
            routerBaseUrl: null,
            workerServiceName: null,
            s3Prefix: 's3://bucket/users/user-1',
            gatewayKeyId: null,
            lastStartedAt: null,
            lastSeenAt: null,
            idleTimeoutAt: null,
            statusReason: null,
            startupProgress: 0,
            lastFailureCode: null,
            lastFailureMessage: null,
            createdAt: '2026-05-25T00:00:00.000Z',
            updatedAt: '2026-05-25T00:00:00.000Z',
          },
          usage: {
            requestCount: 0,
            inputTokens: 0,
            outputTokens: 0,
            cachedTokens: 0,
            costUsd: 0,
          },
        });
      }
      if (path === '/api/projects') {
        return Response.json({ projects: [] });
      }
      if (path === '/api/usage/events?limit=10') {
        return Response.json({ events: [] });
      }
      if (path === '/api/workspaces') {
        return Response.json({ workspaces: [] });
      }
      return Response.json({ code: 'not_found', message: `Unhandled request: ${path}` }, { status: 404 });
    });

    render(<App />);

    const passwordInput = screen.getByLabelText('Password');
    fireEvent.change(passwordInput, { target: { value: 'password123' } });
    expect(passwordInput).toHaveValue('password123');
    fireEvent.submit(passwordInput.closest('form')!);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Open account menu' })).toBeInTheDocument();
    });
  });
});
