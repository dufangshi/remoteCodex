import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ControlPlaneSandbox } from '../lib/api';
import { ControlPlanePage } from './ControlPlanePage';

const baseUrl = 'http://127.0.0.1:8790';

const user = {
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
};

const stoppedSandbox: ControlPlaneSandbox = {
  id: 'sandbox-1',
  userId: 'user-1',
  state: 'stopped',
  image: 'remote-codex-worker:dev',
  region: 'local',
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
};

const runningSandbox: ControlPlaneSandbox = {
  ...stoppedSandbox,
  state: 'running',
  routerBaseUrl: 'https://router.example.test',
  workerServiceName: 'worker-user-1',
  lastStartedAt: '2026-05-25T00:01:00.000Z',
  lastSeenAt: '2026-05-25T00:01:30.000Z',
};

const startingSandbox: ControlPlaneSandbox = {
  ...stoppedSandbox,
  state: 'starting',
  statusReason: 'Worker Pod has been applied and is waiting for readiness.',
  startupProgress: 25,
};

const degradedSandbox: ControlPlaneSandbox = {
  ...runningSandbox,
  state: 'degraded',
  statusReason: 'Worker Pod is running but not ready.',
  startupProgress: 75,
};

const failedSandbox: ControlPlaneSandbox = {
  ...stoppedSandbox,
  state: 'failed',
  statusReason: 'Cannot pull worker image.',
  startupProgress: 25,
  lastFailureCode: 'image_pull',
  lastFailureMessage: 'Cannot pull worker image.',
};

const project = {
  id: 'project-1',
  userId: 'user-1',
  name: 'Computational chemistry',
  slug: 'computational-chemistry',
  status: 'active',
  createdAt: '2026-05-25T00:00:00.000Z',
  updatedAt: '2026-05-25T00:00:00.000Z',
};

const workspace = {
  id: 'workspace-1',
  userId: 'user-1',
  projectId: 'project-1',
  sandboxId: 'sandbox-1',
  name: 'Molecule study',
  slug: 'molecule-study',
  path: '/workspace/molecule-study',
  sourceType: 'empty',
  gitUrl: null,
  defaultBranch: null,
  createdAt: '2026-05-25T00:00:00.000Z',
  updatedAt: '2026-05-25T00:00:00.000Z',
};

const session = {
  id: 'session-1',
  userId: 'user-1',
  sandboxId: 'sandbox-1',
  workspaceId: 'workspace-1',
  provider: 'codex',
  workerSessionId: null,
  title: 'Plan calculation',
  status: 'active',
  lastActivityAt: null,
  createdAt: '2026-05-25T00:00:00.000Z',
  updatedAt: '2026-05-25T00:00:00.000Z',
};

const usage = {
  requestCount: 0,
  inputTokens: 0,
  outputTokens: 0,
  cachedTokens: 0,
  costUsd: 0,
};

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe('ControlPlanePage', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    let projectCreated = false;
    let workspaceCreated = false;
    let sessionCreated = false;
    let sandboxRunning = false;
    window.localStorage.clear();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const path = url.startsWith(baseUrl) ? url.slice(baseUrl.length) : url;

        if (path === '/api/me/bootstrap' && init?.method === 'POST') {
          return jsonResponse({ user, sandbox: stoppedSandbox, gatewayKey: null });
        }

        if (path === '/api/me' && !init?.method) {
          return jsonResponse({
            user,
            sandbox: sandboxRunning ? runningSandbox : stoppedSandbox,
            usage,
          });
        }

        if (path === '/api/projects' && !init?.method) {
          return jsonResponse({ projects: projectCreated ? [project] : [] });
        }

        if (path === '/api/projects' && init?.method === 'POST') {
          projectCreated = true;
          return jsonResponse({ project });
        }

        if (
          (path === '/api/workspaces' || path === '/api/workspaces?projectId=project-1') &&
          !init?.method
        ) {
          return jsonResponse({ workspaces: workspaceCreated ? [workspace] : [] });
        }

        if (path === '/api/projects/project-1/workspaces' && init?.method === 'POST') {
          workspaceCreated = true;
          return jsonResponse({ workspace });
        }

        if (path === '/api/sandbox/start' && init?.method === 'POST') {
          sandboxRunning = true;
          return jsonResponse({ sandbox: runningSandbox });
        }

        if (path === '/api/sandbox/stop' && init?.method === 'POST') {
          sandboxRunning = false;
          return jsonResponse({ sandbox: stoppedSandbox });
        }

        if (path === '/api/sandbox/restart' && init?.method === 'POST') {
          sandboxRunning = true;
          return jsonResponse({ sandbox: runningSandbox });
        }

        if (path === '/api/workspaces/workspace-1/sessions' && !init?.method) {
          return jsonResponse({ sessions: sessionCreated ? [session] : [] });
        }

        if (path === '/api/workspaces/workspace-1/sessions' && init?.method === 'POST') {
          sessionCreated = true;
          return jsonResponse({ session });
        }

        if (path === '/api/sandboxes/sandbox-1/route-token' && init?.method === 'POST') {
          return jsonResponse({
            sandboxId: 'sandbox-1',
            routerBaseUrl: 'https://router.example.test',
            wsBaseUrl: 'wss://router.example.test',
            token: 'route-token',
            expiresAt: '2026-05-25T00:05:00.000Z',
          });
        }

        return jsonResponse({
          code: 'not_found',
          message: `Unhandled request: ${path}`,
        }, 404);
      }),
    );
  });

  it('bootstraps a user and exercises project, workspace, session, sandbox, and route-token flows', async () => {
    render(<ControlPlanePage />);

    fireEvent.click(screen.getByRole('button', { name: 'Login / register' }));

    await waitFor(() => {
      expect(screen.getByText('dev@example.com')).toBeInTheDocument();
    });
    expect(screen.getByText('remote-codex-worker:dev')).toBeInTheDocument();
    expect(screen.getByText('No projects yet.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Create project' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Computational chemistry/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Molecule study/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Create session' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Plan calculation/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Start' }));

    await waitFor(() => {
      expect(screen.getByText('https://router.example.test')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Plan calculation/i }));

    await waitFor(() => {
      expect(screen.getByText('wss://router.example.test')).toBeInTheDocument();
    });

    expect(window.localStorage.getItem('remote-codex-control-plane-auth')).not.toContain(
      'route-token',
    );

    const routeTokenCall = vi.mocked(fetch).mock.calls.find(
      ([input]) => String(input) === `${baseUrl}/api/sandboxes/sandbox-1/route-token`,
    );
    expect(routeTokenCall).toBeDefined();
    expect(JSON.parse(String(routeTokenCall?.[1]?.body))).toEqual({
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      scopes: ['worker:read', 'worker:write', 'session:prompt'],
    });
    expect(new Headers(routeTokenCall?.[1]?.headers).get('Authorization')).toBe(
      'Bearer dev:dev-user',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));

    await waitFor(() => {
      expect(screen.getByText('stopped')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Restart' }));

    await waitFor(() => {
      expect(screen.getByText('running')).toBeInTheDocument();
    });
  });

  it('shows a route authorization failure when session opening cannot acquire a route token', async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const path = url.startsWith(baseUrl) ? url.slice(baseUrl.length) : url;

      if (path === '/api/me/bootstrap' && init?.method === 'POST') {
        return jsonResponse({ user, sandbox: runningSandbox, gatewayKey: null });
      }

      if (path === '/api/me' && !init?.method) {
        return jsonResponse({ user, sandbox: runningSandbox, usage });
      }

      if (path === '/api/projects' && !init?.method) {
        return jsonResponse({ projects: [project] });
      }

      if (path === '/api/workspaces?projectId=project-1' && !init?.method) {
        return jsonResponse({ workspaces: [workspace] });
      }

      if (path === '/api/workspaces/workspace-1/sessions' && !init?.method) {
        return jsonResponse({ sessions: [session] });
      }

      if (path === '/api/sandboxes/sandbox-1/route-token' && init?.method === 'POST') {
        return jsonResponse({
          code: 'sandbox_not_running',
          message: 'Sandbox must be running before issuing a route token.',
        }, 409);
      }

      return jsonResponse({
        code: 'not_found',
        message: `Unhandled request: ${path}`,
      }, 404);
    });

    render(<ControlPlanePage />);

    fireEvent.click(screen.getByRole('button', { name: 'Login / register' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Plan calculation/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Plan calculation/i }));

    await waitFor(() => {
      expect(
        screen.getByText('Sandbox must be running before issuing a route token.'),
      ).toBeInTheDocument();
    });
  });

  it('refreshes in-memory route tokens before expiry', async () => {
    let routeTokenCount = 0;
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const path = url.startsWith(baseUrl) ? url.slice(baseUrl.length) : url;

      if (path === '/api/me/bootstrap' && init?.method === 'POST') {
        return jsonResponse({ user, sandbox: runningSandbox, gatewayKey: null });
      }

      if (path === '/api/me' && !init?.method) {
        return jsonResponse({ user, sandbox: runningSandbox, usage });
      }

      if (path === '/api/projects' && !init?.method) {
        return jsonResponse({ projects: [project] });
      }

      if (path === '/api/workspaces?projectId=project-1' && !init?.method) {
        return jsonResponse({ workspaces: [workspace] });
      }

      if (path === '/api/workspaces/workspace-1/sessions' && !init?.method) {
        return jsonResponse({ sessions: [session] });
      }

      if (path === '/api/sandboxes/sandbox-1/route-token' && init?.method === 'POST') {
        routeTokenCount += 1;
        return jsonResponse({
          sandboxId: 'sandbox-1',
          routerBaseUrl: 'https://router.example.test',
          wsBaseUrl: 'wss://router.example.test',
          token: `route-token-${routeTokenCount}`,
          expiresAt: new Date(Date.now() + 65_000).toISOString(),
        });
      }

      return jsonResponse({
        code: 'not_found',
        message: `Unhandled request: ${path}`,
      }, 404);
    });

    render(<ControlPlanePage />);

    fireEvent.click(screen.getByRole('button', { name: 'Login / register' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Plan calculation/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Plan calculation/i }));

    await waitFor(() => {
      expect(routeTokenCount).toBe(1);
    });

    await waitFor(() => {
      expect(routeTokenCount).toBe(2);
    }, { timeout: 6500 });
    expect(screen.getByText('Route token is available in memory.')).toBeInTheDocument();
    expect(window.localStorage.getItem('remote-codex-control-plane-auth')).not.toContain(
      'route-token-2',
    );
  }, 8000);

  it('stores only local dev auth settings and keeps route tokens in memory', async () => {
    render(<ControlPlanePage />);

    fireEvent.click(screen.getByRole('button', { name: 'Login / register' }));

    await waitFor(() => {
      expect(screen.getByText('dev@example.com')).toBeInTheDocument();
    });

    const storedAuth = JSON.parse(
      window.localStorage.getItem('remote-codex-control-plane-auth') ?? '{}',
    );
    expect(storedAuth).toEqual({
      baseUrl,
      subject: 'dev-user',
      email: 'dev@example.com',
      displayName: 'Developer',
    });
  });

  it('shows API errors from failed actions', async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const path = url.startsWith(baseUrl) ? url.slice(baseUrl.length) : url;

      if (path === '/api/me/bootstrap' && init?.method === 'POST') {
        return jsonResponse({ user, sandbox: stoppedSandbox, gatewayKey: null });
      }

      if (path === '/api/me' && !init?.method) {
        return jsonResponse({ user, sandbox: stoppedSandbox, usage });
      }

      if (path === '/api/projects' && !init?.method) {
        return jsonResponse({ projects: [] });
      }

      if (path === '/api/workspaces' && !init?.method) {
        return jsonResponse({ workspaces: [] });
      }

      if (path === '/api/projects' && init?.method === 'POST') {
        return jsonResponse({
          code: 'bad_request',
          message: 'Project slug is already in use.',
        }, 400);
      }

      return jsonResponse({
        code: 'not_found',
        message: `Unhandled request: ${path}`,
      }, 404);
    });

    render(<ControlPlanePage />);

    fireEvent.click(screen.getByRole('button', { name: 'Login / register' }));

    await waitFor(() => {
      expect(screen.getByText('dev@example.com')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Create project' }));

    await waitFor(() => {
      expect(screen.getByText('Project slug is already in use.')).toBeInTheDocument();
    });
  });

  it('shows sandbox startup, degraded, and failure states', async () => {
    let currentSandbox: ControlPlaneSandbox = startingSandbox;
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const path = url.startsWith(baseUrl) ? url.slice(baseUrl.length) : url;

      if (path === '/api/me/bootstrap' && init?.method === 'POST') {
        return jsonResponse({ user, sandbox: currentSandbox, gatewayKey: null });
      }

      if (path === '/api/me' && !init?.method) {
        return jsonResponse({ user, sandbox: currentSandbox, usage });
      }

      if (path === '/api/projects' && !init?.method) {
        return jsonResponse({ projects: [] });
      }

      if (path === '/api/workspaces' && !init?.method) {
        return jsonResponse({ workspaces: [] });
      }

      if (path === '/api/sandbox/health' && !init?.method) {
        currentSandbox = degradedSandbox;
        return jsonResponse({
          sandbox: currentSandbox,
          status: {
            state: 'degraded',
          },
          endpoint: {
            routerBaseUrl: 'https://router.example.test',
          },
        });
      }

      if (path === '/api/sandbox/restart' && init?.method === 'POST') {
        currentSandbox = failedSandbox;
        return jsonResponse({ sandbox: currentSandbox });
      }

      return jsonResponse({
        code: 'not_found',
        message: `Unhandled request: ${path}`,
      }, 404);
    });

    render(<ControlPlanePage />);

    fireEvent.click(screen.getByRole('button', { name: 'Login / register' }));

    await waitFor(() => {
      expect(screen.getByText('Startup progress')).toBeInTheDocument();
    });
    expect(screen.getByText('25%')).toBeInTheDocument();
    expect(screen.getByText('Worker Pod has been applied and is waiting for readiness.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Health' }));

    await waitFor(() => {
      expect(screen.getAllByText('Worker Pod is running but not ready.').length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Restart' }));

    await waitFor(() => {
      expect(screen.getAllByText('Cannot pull worker image.').length).toBeGreaterThan(0);
    });
    expect(screen.getByText('image_pull')).toBeInTheDocument();
  });
});
