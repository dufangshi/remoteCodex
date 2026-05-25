import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

  it('redirects protected control-plane routes to login until local auth exists', async () => {
    window.localStorage.clear();
    window.history.pushState({}, '', '/control-plane');
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Login' })).toBeInTheDocument();
    });
  });

  it('shows a loading state while resolving protected control-plane auth', () => {
    window.localStorage.clear();
    window.history.pushState({}, '', '/control-plane');
    render(<App />);

    expect(screen.getByText('Loading account session...')).toBeInTheDocument();
  });

  it('stores local control-plane auth from the login route and enters the panel', async () => {
    window.localStorage.clear();
    window.history.pushState({}, '', '/control-plane/login');
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input).replace('http://127.0.0.1:8790', '');
      if (path === '/api/me/bootstrap' && init?.method === 'POST') {
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
          gatewayKey: null,
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

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => {
      expect(screen.getByText('Product account and sandbox registry')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Login / register' }));
    await waitFor(() => {
      expect(screen.getByText('dev@example.com')).toBeInTheDocument();
    });
  });
});
