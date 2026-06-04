import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ControlPlaneSandbox, ControlPlaneSession } from '../lib/api';
import { ControlPlanePage } from './ControlPlanePage';

const navigateMock = vi.hoisted(() => vi.fn());

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

const baseUrl = 'http://127.0.0.1:8790';

class MockWorkerWebSocket extends EventTarget {
  static instances: MockWorkerWebSocket[] = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readonly url: string;
  readyState = MockWorkerWebSocket.CONNECTING;

  constructor(url: string) {
    super();
    this.url = url;
    MockWorkerWebSocket.instances.push(this);
  }

  open() {
    this.readyState = MockWorkerWebSocket.OPEN;
    this.dispatchEvent(new Event('open'));
  }

  fail() {
    this.dispatchEvent(new Event('error'));
  }

  close(_code?: number, reason = '') {
    this.readyState = MockWorkerWebSocket.CLOSED;
    this.dispatchEvent(new CloseEvent('close', { reason }));
  }
}

function storageSnapshot(storage: Storage) {
  return Array.from({ length: storage.length }, (_, index) => {
    const key = storage.key(index);
    return key ? [key, storage.getItem(key)] : null;
  }).filter(Boolean);
}

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
};

const runningSandbox: ControlPlaneSandbox = {
  ...stoppedSandbox,
  state: 'running',
  routerBaseUrl: 'https://router.example.test',
  workerServiceName: 'worker-user-1',
  lastStartedAt: '2026-05-25T00:01:00.000Z',
  lastSeenAt: '2026-05-25T00:01:30.000Z',
};

const idleWarningSandbox: ControlPlaneSandbox = {
  ...runningSandbox,
  idleTimeoutAt: '2026-05-25T01:00:00.000Z',
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

const session: ControlPlaneSession = {
  id: 'session-1',
  userId: 'user-1',
  sandboxId: 'sandbox-1',
  workspaceId: 'workspace-1',
  provider: 'codex',
  workerSessionId: 'worker-session-1',
  title: 'Plan calculation',
  status: 'active',
  lastActivityAt: null,
  createdAt: '2026-05-25T00:00:00.000Z',
  updatedAt: '2026-05-25T00:00:00.000Z',
};

const createdSession: typeof session = {
  ...session,
  workerSessionId: null,
  status: 'created',
};

const usage = {
  requestCount: 0,
  inputTokens: 0,
  outputTokens: 0,
  cachedTokens: 0,
  costUsd: 0,
};

const usageWithSpend = {
  requestCount: 3,
  inputTokens: 1200,
  outputTokens: 300,
  cachedTokens: 100,
  costUsd: 1.25,
};

const usageEvent = {
  id: 'usage-1',
  userId: 'user-1',
  sandboxId: 'sandbox-1',
  workspaceId: 'workspace-1',
  sessionId: 'session-1',
  gatewayKeyId: 'gateway-key-1',
  provider: 'sub2api',
  model: 'gpt-5.1-codex',
  inputTokens: 1200,
  outputTokens: 300,
  cachedTokens: 100,
  costUsd: 1.25,
  externalRequestId: 'req_1',
  occurredAt: '2026-05-25T00:02:00.000Z',
  importedAt: '2026-05-25T00:03:00.000Z',
};

const harnessUsage = {
  eventCount: 1,
  computeUnits: 12.5,
  costUsd: 0.0312,
};

const harnessUsageEvent = {
  id: 'harness-usage-1',
  userId: 'user-1',
  sandboxId: 'sandbox-1',
  workspaceId: 'workspace-1',
  sessionId: 'session-1',
  provider: 'elagente-harness',
  module: 'farmaco',
  tool: 'generate_ligand_xyz',
  runId: 'farmaco-run-1',
  jobId: '42',
  externalEventId: 'harness-event-1',
  computeUnits: 12.5,
  costUsd: 0.0312,
  status: 'ok',
  metadataJson: '{}',
  occurredAt: '2026-05-25T00:04:00.000Z',
  importedAt: '2026-05-25T00:05:00.000Z',
};

const adminUser = {
  ...user,
  id: 'user-admin-target',
  authSubject: 'admin-target',
  email: 'admin-target@example.com',
  displayName: 'Admin Target',
  status: 'active',
  plan: 'developer',
  quotaProfile: 'default',
};

const adminSandboxDetail = {
  sandbox: {
    ...runningSandbox,
    k8sNamespace: 'remote-codex-sandboxes',
    k8sPodName: 'remote-codex-worker-sandbox-1',
  },
  runtimeStatus: {
    state: 'running',
    routerBaseUrl: 'https://router.example.test',
    workerServiceName: 'worker-user-1',
    k8sNamespace: 'remote-codex-sandboxes',
    k8sPodName: 'remote-codex-worker-sandbox-1',
    statusReason: 'Worker Pod is running and ready.',
    startupProgress: 100,
    lastFailureCode: null,
    lastFailureMessage: null,
  },
  endpoint: {
    routerBaseUrl: 'https://router.example.test',
  },
  workerBaseUrl: 'http://worker-user-1.remote-codex-sandboxes.svc.cluster.local:8787',
  recentLifecycleErrors: [
    {
      id: 'audit-1',
      userId: 'user-1',
      action: 'sandbox.running',
      resourceType: 'sandbox',
      resourceId: 'sandbox-1',
      metadataJson: '{}',
      createdAt: '2026-05-25T00:01:00.000Z',
    },
  ],
};

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function usageEventsResponse(
  path: string,
  events: unknown[] = [],
  harnessInput: { usage?: unknown; events?: unknown[] } = {},
) {
  if (path === '/api/usage/events?limit=10') {
    return jsonResponse({ events });
  }
  if (path === '/api/usage/harness/summary') {
    return jsonResponse({ usage: harnessInput.usage ?? { eventCount: 0, computeUnits: 0, costUsd: 0 } });
  }
  if (path === '/api/usage/harness/events?limit=10') {
    return jsonResponse({ events: harnessInput.events ?? [] });
  }
  return null;
}

async function selectExistingHierarchy() {
  await waitFor(() => {
    expect(screen.getByRole('button', { name: /Computational chemistry/i })).toBeInTheDocument();
  });
  fireEvent.click(screen.getByRole('button', { name: /Computational chemistry/i }));
  await waitFor(() => {
    expect(screen.getByRole('button', { name: /Molecule study/i })).toBeInTheDocument();
  });
  fireEvent.click(screen.getByRole('button', { name: /Molecule study/i }));
  await waitFor(() => {
    expect(screen.getByRole('button', { name: /Plan calculation/i })).toBeInTheDocument();
  });
  fireEvent.click(screen.getByRole('button', { name: /Plan calculation/i }));
}

async function openAccountMenu() {
  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Open account menu' })).toBeInTheDocument();
  });
  fireEvent.click(screen.getByRole('button', { name: 'Open account menu' }));
}

async function openCreatePanel(label: 'project' | 'workspace' | 'session') {
  fireEvent.click(screen.getByRole('button', { name: `Open create panel for ${label}` }));
  await waitFor(() => {
    expect(screen.getByRole('heading', { name: new RegExp(`Create ${label}`, 'i') })).toBeInTheDocument();
  });
}

function submitCreatePanel(label: 'project' | 'workspace' | 'session') {
  const fieldLabel =
    label === 'project' ? 'Project name' : label === 'workspace' ? 'Workspace name' : 'Session title';
  fireEvent.submit(screen.getByLabelText(fieldLabel).closest('form')!);
}

describe('ControlPlanePage', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    let projectCreated = false;
    let workspaceCreated = false;
    let sessionCreated = false;
    let currentSession = session;
    let sandboxRunning = false;
    navigateMock.mockReset();
    MockWorkerWebSocket.instances = [];
    vi.stubGlobal('WebSocket', MockWorkerWebSocket);
    window.localStorage.clear();
    window.localStorage.setItem(
      'remote-codex-control-plane-auth',
      JSON.stringify({
        baseUrl,
        token: 'dev:dev-user',
        email: 'dev@example.com',
        displayName: 'Developer',
      }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const path = url.startsWith(baseUrl) ? url.slice(baseUrl.length) : url;

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

        if (path === '/api/usage/events?limit=10' && !init?.method) {
          return jsonResponse({ events: [] });
        }

        if (path === '/api/usage/harness/summary' && !init?.method) {
          return jsonResponse({ usage: { eventCount: 0, computeUnits: 0, costUsd: 0 } });
        }

        if (path === '/api/usage/harness/events?limit=10' && !init?.method) {
          return jsonResponse({ events: [] });
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

        if (path === '/api/sandbox/harness/status' && !init?.method) {
          return jsonResponse({
            enabled: true,
            baseUrl: 'https://elagenteharness.example.test',
            keyPresent: true,
            chemistryToolsEnabled: true,
            modules: ['farmaco', 'quntur', 'estructural'],
            health: { status: 'ok' },
          });
        }

        if (path === '/api/sandbox/harness/modules/farmaco/tools' && !init?.method) {
          return jsonResponse({
            payload: [
              { name: 'generate_ligand_xyz', execution_mode: 'inprocess' },
              { name: 'pocket_detect', execution_mode: 'async_required' },
            ],
          });
        }

        if (path === '/api/sandbox/harness/modules/farmaco/runs' && !init?.method) {
          return jsonResponse({
            payload: [
              { run_id: 'farmaco-run-1', status: 'ok', module: 'farmaco' },
            ],
          });
        }

        if (path === '/api/sandbox/stop' && init?.method === 'POST') {
          sandboxRunning = false;
          return jsonResponse({ sandbox: stoppedSandbox });
        }

        if (path === '/api/sandbox/restart' && init?.method === 'POST') {
          sandboxRunning = true;
          return jsonResponse({ sandbox: runningSandbox });
        }

        if (path === '/api/admin/sandboxes/sandbox-1' && !init?.method) {
          return jsonResponse(adminSandboxDetail);
        }

        if (path === '/api/workspaces/workspace-1/sessions' && !init?.method) {
          return jsonResponse({ sessions: sessionCreated ? [currentSession] : [] });
        }

        if (path === '/api/workspaces/workspace-1/sessions' && init?.method === 'POST') {
          sessionCreated = true;
          currentSession = { ...session, status: 'active' };
          return jsonResponse({ session: currentSession });
        }

        if (path === '/api/sessions/session-1/close' && init?.method === 'POST') {
          currentSession = { ...currentSession, status: 'idle' };
          return jsonResponse({ session: currentSession });
        }

        if (path === '/api/sessions/session-1/resume' && init?.method === 'POST') {
          currentSession = { ...currentSession, status: 'active' };
          return jsonResponse({ session: currentSession });
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

        const usageEvents = usageEventsResponse(path);
        if (usageEvents) {
          return usageEvents;
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

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Open account menu' })).toBeInTheDocument();
    });
    expect(screen.getByText('remote-codex-worker:dev')).toBeInTheDocument();
    expect(screen.getByText('No projects yet.')).toBeInTheDocument();

    await openCreatePanel('project');
    submitCreatePanel('project');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Computational chemistry/i })).toBeInTheDocument();
    });
    expect(screen.getAllByText('computational-chemistry').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Project "Computational chemistry" created. Select it before creating a workspace.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open create panel for workspace' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Computational chemistry/i }));

    await waitFor(() => {
      expect(screen.getByText('Selected project')).toBeInTheDocument();
    });

    await openCreatePanel('workspace');
    submitCreatePanel('workspace');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Molecule study/i })).toBeInTheDocument();
    });
    expect(screen.getByText('Workspace "Molecule study" created. Select it before creating a session.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open create panel for session' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Molecule study/i }));

    fireEvent.click(screen.getByRole('button', { name: 'Start' }));

    await waitFor(() => {
      expect(screen.getByText('https://router.example.test')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText('https://elagenteharness.example.test')).toBeInTheDocument();
    });
    expect(screen.getByText('generate_ligand_xyz')).toBeInTheDocument();
    expect(screen.getByText('farmaco-run-1')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('harness-key-secret');

    await openCreatePanel('session');
    submitCreatePanel('session');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Plan calculation/i })).toBeInTheDocument();
    });
    expect(screen.getByText('Session "Plan calculation" created. Select it before connecting.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Plan calculation/i }));

    fireEvent.click(screen.getByRole('button', { name: 'Inspect' }));

    await waitFor(() => {
      expect(screen.getByText('Admin inspection')).toBeInTheDocument();
    });
    expect(screen.getByText('remote-codex-sandboxes')).toBeInTheDocument();
    expect(screen.getByText('remote-codex-worker-sandbox-1')).toBeInTheDocument();
    expect(screen.getByText('http://worker-user-1.remote-codex-sandboxes.svc.cluster.local:8787')).toBeInTheDocument();
    expect(screen.getByText('Worker Pod is running and ready.')).toBeInTheDocument();
    expect(screen.getByText('sandbox.running')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Create route token' }));

    await waitFor(() => {
      expect(screen.getByText('wss://router.example.test')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(MockWorkerWebSocket.instances).toHaveLength(1);
    });
    expect(MockWorkerWebSocket.instances[0]?.url).toBe(
      'wss://router.example.test/api/sandboxes/sandbox-1/ws?token=route-token',
    );
    expect(screen.getByText('Connecting worker route.')).toBeInTheDocument();
    MockWorkerWebSocket.instances[0]?.open();
    await waitFor(() => {
      expect(screen.getByText('ready')).toBeInTheDocument();
    });

    expect(JSON.stringify(storageSnapshot(window.localStorage))).not.toContain('route-token');
    expect(JSON.stringify(storageSnapshot(window.sessionStorage))).not.toContain('route-token');

    const routeTokenCall = vi.mocked(fetch).mock.calls.find(
      ([input]) => String(input) === `${baseUrl}/api/sandboxes/sandbox-1/route-token`,
    );
    expect(routeTokenCall).toBeDefined();
    expect(JSON.parse(String(routeTokenCall?.[1]?.body))).toEqual({
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      scopes: ['worker:read', 'worker:write', 'session:prompt', 'provider:turn:create'],
    });
    expect(new Headers(routeTokenCall?.[1]?.headers).get('Authorization')).toBe(
      'Bearer dev:dev-user',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    await waitFor(() => {
      expect(screen.getByText('Session finalized and disconnected.')).toBeInTheDocument();
    });
    expect(MockWorkerWebSocket.instances[0]?.readyState).toBe(MockWorkerWebSocket.CLOSED);
    expect(screen.getByText(/codex \/ idle/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));

    await waitFor(() => {
      expect(screen.getByText('Session resumed.')).toBeInTheDocument();
    });
    expect(screen.getByText(/codex \/ active/i)).toBeInTheDocument();
    expect(navigateMock).toHaveBeenCalledWith('/control-plane/sessions/session-1');

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));

    await waitFor(() => {
      expect(screen.getAllByText('stopped').length).toBeGreaterThan(0);
    });
    expect(MockWorkerWebSocket.instances[0]?.readyState).toBe(MockWorkerWebSocket.CLOSED);

    const closeCall = vi.mocked(fetch).mock.calls.find(
      ([input]) => String(input) === `${baseUrl}/api/sessions/session-1/close`,
    );
    const resumeCall = vi.mocked(fetch).mock.calls.find(
      ([input]) => String(input) === `${baseUrl}/api/sessions/session-1/resume`,
    );
    expect(closeCall?.[1]?.method).toBe('POST');
    expect(resumeCall?.[1]?.method).toBe('POST');
    expect(new Headers(closeCall?.[1]?.headers).get('Authorization')).toBe(
      'Bearer dev:dev-user',
    );
    expect(new Headers(closeCall?.[1]?.headers).has('x-remote-codex-worker-token')).toBe(false);
    expect(new Headers(resumeCall?.[1]?.headers).get('Authorization')).toBe(
      'Bearer dev:dev-user',
    );
    expect(new Headers(resumeCall?.[1]?.headers).has('x-remote-codex-worker-token')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Restart' }));

    await waitFor(() => {
      expect(screen.getByText('running')).toBeInTheDocument();
    });
  });

  it('shows a route authorization failure when session opening cannot acquire a route token', async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const path = url.startsWith(baseUrl) ? url.slice(baseUrl.length) : url;

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

      const usageEvents = usageEventsResponse(path);
      if (usageEvents) {
        return usageEvents;
      }

      return jsonResponse({
        code: 'not_found',
        message: `Unhandled request: ${path}`,
      }, 404);
    });

    render(<ControlPlanePage />);

    await selectExistingHierarchy();

    fireEvent.click(screen.getByRole('button', { name: /Plan calculation/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Create route token' }));

    await waitFor(() => {
      expect(
        screen.getByText('Sandbox must be running before issuing a route token.'),
      ).toBeInTheDocument();
    });
  });

  it('requires hierarchy selection and a running sandbox before creating child resources', async () => {
    render(<ControlPlanePage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Open account menu' })).toBeInTheDocument();
    });

    expect(screen.queryByRole('button', { name: 'Open create panel for workspace' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open create panel for session' })).not.toBeInTheDocument();

    await openCreatePanel('project');
    submitCreatePanel('project');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Computational chemistry/i })).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'Open create panel for workspace' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open create panel for session' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Computational chemistry/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Open create panel for workspace' })).not.toBeDisabled();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Open create panel for workspace' }));
    submitCreatePanel('workspace');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Molecule study/i })).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'Open create panel for session' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Molecule study/i }));
    await waitFor(() => {
      expect(screen.getByText('Start the sandbox before creating a session.')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Open create panel for session' })).not.toBeDisabled();
    });
  });

  it('does not crash when creating a route token from the connection panel', async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const path = url.startsWith(baseUrl) ? url.slice(baseUrl.length) : url;

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
          sandboxId: 'sandbox-1',
          routerBaseUrl: 'https://router.example.test',
          wsBaseUrl: 'wss://router.example.test',
          token: 'route-token-direct',
          expiresAt: '2026-05-25T00:05:00.000Z',
        });
      }

      const usageEvents = usageEventsResponse(path);
      if (usageEvents) {
        return usageEvents;
      }

      return jsonResponse({
        code: 'not_found',
        message: `Unhandled request: ${path}`,
      }, 404);
    });

    render(<ControlPlanePage />);

    await selectExistingHierarchy();

    fireEvent.click(screen.getByRole('button', { name: 'Create route token' }));

    await waitFor(() => {
      expect(screen.getByText('wss://router.example.test')).toBeInTheDocument();
    });
    expect(screen.getByText('connecting')).toBeInTheDocument();
    expect(MockWorkerWebSocket.instances).toHaveLength(1);
  });

  it('starts a created session in the worker when resumed after sandbox startup', async () => {
    let currentSession = createdSession;
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const path = url.startsWith(baseUrl) ? url.slice(baseUrl.length) : url;

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
        return jsonResponse({ sessions: [currentSession] });
      }

      if (path === '/api/sessions/session-1/resume' && init?.method === 'POST') {
        currentSession = { ...session, status: 'active', workerSessionId: 'worker-session-1' };
        return jsonResponse({ session: currentSession });
      }

      if (path === '/api/sandboxes/sandbox-1/route-token' && init?.method === 'POST') {
        return jsonResponse({
          sandboxId: 'sandbox-1',
          routerBaseUrl: 'https://router.example.test',
          wsBaseUrl: 'wss://router.example.test',
          token: 'route-token-materialized',
          expiresAt: '2026-05-25T00:05:00.000Z',
        });
      }

      const usageEvents = usageEventsResponse(path);
      if (usageEvents) {
        return usageEvents;
      }

      return jsonResponse({
        code: 'not_found',
        message: `Unhandled request: ${path}`,
      }, 404);
    });

    render(<ControlPlanePage />);

    await selectExistingHierarchy();

    fireEvent.click(screen.getByRole('button', { name: 'Start in sandbox' }));

    await waitFor(() => {
      expect(screen.getByText('Session resumed.')).toBeInTheDocument();
    });
    expect(screen.getByText(/codex \/ active/i)).toBeInTheDocument();
    expect(MockWorkerWebSocket.instances).toHaveLength(1);
    expect(navigateMock).toHaveBeenCalledWith('/control-plane/sessions/session-1');
    const resumeCall = vi.mocked(fetch).mock.calls.find(
      ([input]) => String(input) === `${baseUrl}/api/sessions/session-1/resume`,
    );
    expect(resumeCall?.[1]?.method).toBe('POST');
  });

  it('shows sandbox offline state when the router websocket fails', async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const path = url.startsWith(baseUrl) ? url.slice(baseUrl.length) : url;

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
          sandboxId: 'sandbox-1',
          routerBaseUrl: 'https://router.example.test',
          wsBaseUrl: 'wss://router.example.test',
          token: 'route-token-offline',
          expiresAt: '2026-05-25T00:05:00.000Z',
        });
      }

      const usageEvents = usageEventsResponse(path);
      if (usageEvents) {
        return usageEvents;
      }

      return jsonResponse({
        code: 'not_found',
        message: `Unhandled request: ${path}`,
      }, 404);
    });

    render(<ControlPlanePage />);

    await selectExistingHierarchy();

    fireEvent.click(screen.getByRole('button', { name: /Plan calculation/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Create route token' }));
    await waitFor(() => {
      expect(MockWorkerWebSocket.instances).toHaveLength(1);
    });

    MockWorkerWebSocket.instances[0]?.fail();
    await waitFor(() => {
      expect(screen.getByText('Sandbox offline: Worker route connection failed.')).toBeInTheDocument();
    });
  });

  it('refreshes in-memory route tokens before expiry and shows reconnecting state', async () => {
    let routeTokenCount = 0;
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const path = url.startsWith(baseUrl) ? url.slice(baseUrl.length) : url;

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
        const response = jsonResponse({
          sandboxId: 'sandbox-1',
          routerBaseUrl: 'https://router.example.test',
          wsBaseUrl: 'wss://router.example.test',
          token: `route-token-${routeTokenCount}`,
          expiresAt: new Date(Date.now() + 65_000).toISOString(),
        });
        if (routeTokenCount === 2) {
          return new Promise<Response>((resolve) => {
            setTimeout(() => resolve(response), 1000);
          });
        }
        return response;
      }

      const usageEvents = usageEventsResponse(path);
      if (usageEvents) {
        return usageEvents;
      }

      return jsonResponse({
        code: 'not_found',
        message: `Unhandled request: ${path}`,
      }, 404);
    });

    render(<ControlPlanePage />);

    await selectExistingHierarchy();

    fireEvent.click(screen.getByRole('button', { name: /Plan calculation/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Create route token' }));

    await waitFor(() => {
      expect(routeTokenCount).toBe(1);
    });
    expect(MockWorkerWebSocket.instances[0]?.url).toContain('token=route-token-1');
    MockWorkerWebSocket.instances[0]?.open();
    await waitFor(() => {
      expect(screen.getByText('ready')).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(routeTokenCount).toBe(2);
    }, { timeout: 6500 });
    expect(screen.getByText('Reconnecting worker route.')).toBeInTheDocument();
    await waitFor(() => {
      expect(MockWorkerWebSocket.instances).toHaveLength(2);
    });
    expect(MockWorkerWebSocket.instances[0]?.readyState).toBe(MockWorkerWebSocket.CLOSED);
    expect(MockWorkerWebSocket.instances[1]?.url).toContain('token=route-token-2');
    MockWorkerWebSocket.instances[1]?.open();

    await waitFor(() => {
      expect(screen.getByText('Route token is available in memory.')).toBeInTheDocument();
    });
    expect(screen.getByText('ready')).toBeInTheDocument();
    expect(JSON.stringify(storageSnapshot(window.localStorage))).not.toContain('route-token-2');
    expect(JSON.stringify(storageSnapshot(window.sessionStorage))).not.toContain('route-token-2');
  }, 9000);

  it('stores only local dev auth settings and keeps route tokens in memory', async () => {
    render(<ControlPlanePage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Open account menu' })).toBeInTheDocument();
    });

    const storedAuth = JSON.parse(
      window.localStorage.getItem('remote-codex-control-plane-auth') ?? '{}',
    );
    expect(storedAuth).toEqual({
      baseUrl,
      token: 'dev:dev-user',
      email: 'dev@example.com',
      displayName: 'Developer',
    });
  });

  it('shows LLM and Harness usage summary after account bootstrap', async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const path = url.startsWith(baseUrl) ? url.slice(baseUrl.length) : url;

      if (path === '/api/me' && !init?.method) {
        return jsonResponse({ user, sandbox: stoppedSandbox, usage: usageWithSpend });
      }

      if (path === '/api/projects' && !init?.method) {
        return jsonResponse({ projects: [] });
      }

      if (path === '/api/workspaces' && !init?.method) {
        return jsonResponse({ workspaces: [] });
      }

      const usageEvents = usageEventsResponse(path, [usageEvent], {
        usage: harnessUsage,
        events: [harnessUsageEvent],
      });
      if (usageEvents) {
        return usageEvents;
      }

      return jsonResponse({
        code: 'not_found',
        message: `Unhandled request: ${path}`,
      }, 404);
    });

    render(<ControlPlanePage />);

    await openAccountMenu();
    expect(screen.getByText('Quota')).toBeInTheDocument();
    expect(screen.getByText('default')).toBeInTheDocument();
    expect(screen.getByText('Requests')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('Tokens')).toBeInTheDocument();
    expect(screen.getAllByText('1500').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Total cost')).toBeInTheDocument();
    expect(screen.getByText('LLM cost')).toBeInTheDocument();
    expect(screen.getAllByText('$1.25').length).toBeGreaterThanOrEqual(1);
    const accountMenu = screen.getByRole('menu');
    expect(within(accountMenu).getByText('Harness')).toBeInTheDocument();
    expect(within(accountMenu).getByText('Compute')).toBeInTheDocument();
    expect(within(accountMenu).getByText('12.5')).toBeInTheDocument();
    expect(within(accountMenu).getByText('Harness cost')).toBeInTheDocument();
    expect(screen.getByText('gpt-5.1-codex')).toBeInTheDocument();
    expect(screen.getByText(/sub2api/)).toBeInTheDocument();
    expect(screen.getByText('2026-05-25T00:02:00.000Z')).toBeInTheDocument();
    expect(screen.getByText('generate_ligand_xyz')).toBeInTheDocument();
    expect(screen.getByText(/farmaco, ok/)).toBeInTheDocument();
    expect(screen.getByText('2026-05-25T00:04:00.000Z')).toBeInTheDocument();
  });

  it('keeps Harness overview read-only and disabled until the sandbox is running', async () => {
    render(<ControlPlanePage />);

    await waitFor(() => {
      expect(screen.getByText('Start the sandbox to inspect Harness tools.')).toBeInTheDocument();
    });

    const requestedPaths = vi.mocked(fetch).mock.calls.map(([input]) => {
      const url = String(input);
      return url.startsWith(baseUrl) ? url.slice(baseUrl.length) : url;
    });
    expect(requestedPaths.some((path) => path.startsWith('/api/sandbox/harness'))).toBe(false);
    expect(screen.queryByText('https://elagenteharness.example.test')).not.toBeInTheDocument();
    expect(screen.queryByText('generate_ligand_xyz')).not.toBeInTheDocument();
    expect(screen.queryByText('farmaco-run-1')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /invoke|execute|run tool/i })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('harness-key-secret');
    expect(document.body.textContent).not.toContain('INACT_X_APP_KEY');
  });

  it('shows an empty LLM usage detail state', async () => {
    render(<ControlPlanePage />);

    await openAccountMenu();
    await waitFor(() => {
      expect(screen.getByText('No LLM usage events yet.')).toBeInTheDocument();
    });
  });

  it('shows API errors from failed actions', async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const path = url.startsWith(baseUrl) ? url.slice(baseUrl.length) : url;

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

      const usageEvents = usageEventsResponse(path);
      if (usageEvents) {
        return usageEvents;
      }

      return jsonResponse({
        code: 'not_found',
        message: `Unhandled request: ${path}`,
      }, 404);
    });

    render(<ControlPlanePage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Open account menu' })).toBeInTheDocument();
    });

    await openCreatePanel('project');
    submitCreatePanel('project');

    await waitFor(() => {
      expect(screen.getByText('Project slug is already in use.')).toBeInTheDocument();
    });
  });

  it('shows a gateway degraded state when bootstrap cannot provision gateway credentials', async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const path = url.startsWith(baseUrl) ? url.slice(baseUrl.length) : url;

      if (path === '/api/me' && !init?.method) {
        return jsonResponse({
          code: 'gateway_unavailable',
          message: 'gateway unavailable',
        }, 503);
      }

      const usageEvents = usageEventsResponse(path);
      if (usageEvents) {
        return usageEvents;
      }

      return jsonResponse({
        code: 'not_found',
        message: `Unhandled request: ${path}`,
      }, 404);
    });

    render(<ControlPlanePage />);

    await waitFor(() => {
      expect(screen.getByText('LLM gateway unavailable: gateway unavailable')).toBeInTheDocument();
    });
  });

  it('shows expired-session state when control-plane auth is rejected', async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const path = url.startsWith(baseUrl) ? url.slice(baseUrl.length) : url;

      if (path === '/api/me' && !init?.method) {
        return jsonResponse({
          code: 'unauthorized',
          message: 'Token expired.',
        }, 401);
      }

      const usageEvents = usageEventsResponse(path);
      if (usageEvents) {
        return usageEvents;
      }

      return jsonResponse({
        code: 'not_found',
        message: `Unhandled request: ${path}`,
      }, 404);
    });

    render(<ControlPlanePage />);

    await waitFor(() => {
      expect(screen.getByText('Session expired: Token expired.')).toBeInTheDocument();
    });
  });

  it('shows disabled-account state when the account is inactive', async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const path = url.startsWith(baseUrl) ? url.slice(baseUrl.length) : url;

      if (path === '/api/me' && !init?.method) {
        return jsonResponse({
          code: 'account_inactive',
          message: 'Account is not active.',
        }, 403);
      }

      const usageEvents = usageEventsResponse(path);
      if (usageEvents) {
        return usageEvents;
      }

      return jsonResponse({
        code: 'not_found',
        message: `Unhandled request: ${path}`,
      }, 404);
    });

    render(<ControlPlanePage />);

    await waitFor(() => {
      expect(screen.getByText('Account disabled: Account is not active.')).toBeInTheDocument();
    });
  });

  it('shows a quota exceeded state when session opening is blocked by LLM quota', async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const path = url.startsWith(baseUrl) ? url.slice(baseUrl.length) : url;

      if (path === '/api/me' && !init?.method) {
        return jsonResponse({
          user: {
            ...user,
            quotaProfile: 'developer',
          },
          sandbox: runningSandbox,
          usage,
        });
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
          code: 'quota_exceeded',
          message: 'Quota exceeded.',
          details: {
            reason: 'llm_spend_quota_exceeded',
            quotaProfile: 'developer',
            limit: 25,
            used: 25,
          },
        }, 402);
      }

      const usageEvents = usageEventsResponse(path);
      if (usageEvents) {
        return usageEvents;
      }

      return jsonResponse({
        code: 'not_found',
        message: `Unhandled request: ${path}`,
      }, 404);
    });

    render(<ControlPlanePage />);

    await selectExistingHierarchy();

    fireEvent.click(screen.getByRole('button', { name: /Plan calculation/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Create route token' }));

    await waitFor(() => {
      expect(
        screen.getByText('LLM quota exceeded: developer quota exhausted (25/25).'),
      ).toBeInTheDocument();
    });
    expect(screen.getByText('Quota exceeded.')).toBeInTheDocument();
  });

  it('shows sandbox startup, degraded, and failure states', async () => {
    let currentSandbox: ControlPlaneSandbox = startingSandbox;
    let healthRequests = 0;
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const path = url.startsWith(baseUrl) ? url.slice(baseUrl.length) : url;

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
        healthRequests += 1;
        currentSandbox = healthRequests === 1 ? runningSandbox : degradedSandbox;
        return jsonResponse({
          sandbox: currentSandbox,
          status: {
            state: currentSandbox.state,
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

      const usageEvents = usageEventsResponse(path);
      if (usageEvents) {
        return usageEvents;
      }

      return jsonResponse({
        code: 'not_found',
        message: `Unhandled request: ${path}`,
      }, 404);
    });

    render(<ControlPlanePage />);

    await waitFor(() => {
      expect(screen.getByText('Startup progress')).toBeInTheDocument();
    });
    expect(screen.getByText('25%')).toBeInTheDocument();
    expect(screen.getByText('Worker Pod has been applied and is waiting for readiness.')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getAllByText('running').length).toBeGreaterThan(0);
    }, { timeout: 4000 });
    expect(healthRequests).toBe(1);

    currentSandbox = startingSandbox;
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

  it('shows an idle-stop warning before the sandbox timeout', async () => {
    vi.setSystemTime(new Date('2026-05-25T00:30:00.000Z'));
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const path = url.startsWith(baseUrl) ? url.slice(baseUrl.length) : url;

      if (path === '/api/me' && !init?.method) {
        return jsonResponse({ user, sandbox: idleWarningSandbox, usage });
      }

      if (path === '/api/projects' && !init?.method) {
        return jsonResponse({ projects: [] });
      }

      const usageEvents = usageEventsResponse(path);
      if (usageEvents) {
        return usageEvents;
      }

      return jsonResponse({
        code: 'not_found',
        message: `Unhandled request: ${path}`,
      }, 404);
    });

    render(<ControlPlanePage />);

    await waitFor(() => {
      expect(
        screen.getByText('Sandbox will stop after idle timeout at 2026-05-25T01:00:00.000Z.'),
      ).toBeInTheDocument();
    });
  });

  it('shows loading states for product metadata lists', async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const path = url.startsWith(baseUrl) ? url.slice(baseUrl.length) : url;

      if (path === '/api/me' && !init?.method) {
        return jsonResponse({ user, sandbox: runningSandbox, usage });
      }

      if (path === '/api/projects' && !init?.method) {
        return new Promise<Response>((resolve) => {
          setTimeout(() => resolve(jsonResponse({ projects: [project] })), 25);
        });
      }

      if (path === '/api/workspaces?projectId=project-1' && !init?.method) {
        return new Promise<Response>((resolve) => {
          setTimeout(() => resolve(jsonResponse({ workspaces: [workspace] })), 25);
        });
      }

      if (path === '/api/workspaces/workspace-1/sessions' && !init?.method) {
        return new Promise<Response>((resolve) => {
          setTimeout(() => resolve(jsonResponse({ sessions: [session] })), 25);
        });
      }

      if (path === '/api/usage/events?limit=10' && !init?.method) {
        return new Promise<Response>((resolve) => {
          setTimeout(() => resolve(jsonResponse({ events: [usageEvent] })), 25);
        });
      }

      if (path === '/api/usage/harness/summary' && !init?.method) {
        return new Promise<Response>((resolve) => {
          setTimeout(() => resolve(jsonResponse({ usage: harnessUsage })), 25);
        });
      }

      if (path === '/api/usage/harness/events?limit=10' && !init?.method) {
        return new Promise<Response>((resolve) => {
          setTimeout(() => resolve(jsonResponse({ events: [harnessUsageEvent] })), 25);
        });
      }

      return jsonResponse({
        code: 'not_found',
        message: `Unhandled request: ${path}`,
      }, 404);
    });

    render(<ControlPlanePage />);
    expect(await screen.findByText('Loading projects...')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Computational chemistry/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /Computational chemistry/i }));
    await waitFor(() => {
      expect(screen.getByText('Loading workspaces...')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Molecule study/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /Molecule study/i }));
    await waitFor(() => {
      expect(screen.getByText('Loading sessions...')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Plan calculation/i })).toBeInTheDocument();
    });
  });
});
