import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ControlPlaneSessionPage } from './ControlPlaneSessionPage';

const baseUrl = 'http://127.0.0.1:8790';
const routerBaseUrl = 'https://router.example.test';

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const user = {
  id: 'user-1',
  authProvider: 'dev',
  authSubject: 'dev-user',
  email: 'dev@example.com',
  displayName: 'Developer',
  status: 'active',
  plan: 'developer',
  createdAt: '2026-05-25T00:00:00.000Z',
  updatedAt: '2026-05-25T00:00:00.000Z',
  lastSeenAt: '2026-05-25T00:00:00.000Z',
};

const sandbox = {
  id: 'sandbox-1',
  userId: 'user-1',
  state: 'running',
  image: 'remote-codex-worker:dev',
  region: 'local',
  resourceProfile: 'standard',
  routerBaseUrl,
  workerServiceName: 'worker-user-1',
  s3Prefix: 's3://bucket/users/user-1',
  gatewayKeyId: null,
  lastStartedAt: '2026-05-25T00:01:00.000Z',
  lastSeenAt: '2026-05-25T00:01:30.000Z',
  idleTimeoutAt: null,
  createdAt: '2026-05-25T00:00:00.000Z',
  updatedAt: '2026-05-25T00:00:00.000Z',
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
  workerSessionId: 'worker-session-1',
  title: 'Plan calculation',
  status: 'active',
  lastActivityAt: null,
  createdAt: '2026-05-25T00:00:00.000Z',
  updatedAt: '2026-05-25T00:00:00.000Z',
};

const threadDetail = {
  thread: {
    id: 'worker-session-1',
    workspaceId: 'worker-workspace-1',
    provider: 'codex',
    providerSessionId: null,
    source: 'supervisor',
    title: 'Plan calculation',
    model: 'gpt-5.1-codex',
    reasoningEffort: null,
    collaborationMode: 'default',
    approvalMode: 'yolo',
    status: 'idle',
    summaryText: null,
    lastError: null,
    activeTurnId: null,
    isLoaded: true,
    isPinned: false,
    createdAt: '2026-05-25T00:00:00.000Z',
    updatedAt: '2026-05-25T00:02:00.000Z',
    lastTurnStartedAt: '2026-05-25T00:02:00.000Z',
    lastTurnCompletedAt: '2026-05-25T00:02:20.000Z',
  },
  workspace: {
    id: 'worker-workspace-1',
    hostId: 'local',
    label: 'Molecule study',
    absPath: '/workspace/molecule-study',
    isFavorite: false,
    createdAt: '2026-05-25T00:00:00.000Z',
    lastOpenedAt: null,
  },
  workspacePathStatus: 'present',
  turns: [
    {
      id: 'turn-1',
      startedAt: '2026-05-25T00:02:00.000Z',
      status: 'completed',
      error: null,
      items: [
        {
          id: 'item-1',
          kind: 'userMessage',
          text: 'Hello remote worker',
        },
        {
          id: 'item-2',
          kind: 'agentMessage',
          text: 'Ready from sandbox',
        },
      ],
    },
  ],
  totalTurnCount: 1,
  pendingRequests: [],
  pendingSteers: [],
};

describe('ControlPlaneSessionPage', () => {
  beforeEach(() => {
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
          return jsonResponse({ user, sandbox, usage: {} });
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
        if (path === '/api/sessions/session-1/resume' && init?.method === 'POST') {
          return jsonResponse({ session });
        }
        if (path === '/api/sandboxes/sandbox-1/route-token' && init?.method === 'POST') {
          return jsonResponse({
            sandboxId: 'sandbox-1',
            routerBaseUrl,
            wsBaseUrl: 'wss://router.example.test',
            token: 'route-token',
            expiresAt: '2026-05-25T00:05:00.000Z',
          });
        }
        if (url === `${routerBaseUrl}/api/sandboxes/sandbox-1/api/threads/worker-session-1`) {
          return jsonResponse(threadDetail);
        }
        if (
          url === `${routerBaseUrl}/api/sandboxes/sandbox-1/api/threads/worker-session-1/prompt` &&
          init?.method === 'POST'
        ) {
          return jsonResponse({ ...threadDetail.thread, status: 'running' });
        }

        return jsonResponse({ code: 'not_found', message: `Unhandled request: ${url}` }, 404);
      }),
    );
  });

  it('opens a control-plane session through the router and sends prompts to the worker thread', async () => {
    render(
      <MemoryRouter initialEntries={['/control-plane/sessions/session-1']}>
        <Routes>
          <Route path="/control-plane/sessions/:sessionId" element={<ControlPlaneSessionPage />} />
          <Route path="/control-plane/login" element={<div>Login</div>} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Plan calculation' })).toBeInTheDocument();
    });
    expect(screen.getByText('Hello remote worker')).toBeInTheDocument();
    expect(screen.getByText('Ready from sandbox')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/send a prompt/i), {
      target: { value: 'Continue from here' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(screen.getByText('Prompt sent.')).toBeInTheDocument();
    });

    const promptCall = vi.mocked(fetch).mock.calls.find(
      ([input]) =>
        String(input) ===
        `${routerBaseUrl}/api/sandboxes/sandbox-1/api/threads/worker-session-1/prompt`,
    );
    expect(promptCall?.[1]?.method).toBe('POST');
    expect(promptCall?.[1]?.body).toBe(JSON.stringify({ prompt: 'Continue from here' }));
    expect(new Headers(promptCall?.[1]?.headers).get('Authorization')).toBe('Bearer route-token');

    expect(
      vi.mocked(fetch).mock.calls.some(([input]) =>
        String(input).startsWith(`${routerBaseUrl}/api/sandboxes/`),
      ),
    ).toBe(true);
    expect(
      vi.mocked(fetch).mock.calls.some(
        ([input]) => String(input) === `${baseUrl}/api/sandboxes/sandbox-1/route-token`,
      ),
    ).toBe(true);

    const routeTokenCall = vi.mocked(fetch).mock.calls.find(
      ([input]) => String(input) === `${baseUrl}/api/sandboxes/sandbox-1/route-token`,
    );
    expect(JSON.parse(String(routeTokenCall?.[1]?.body))).toEqual({
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      scopes: ['worker:read', 'worker:write', 'session:prompt', 'provider:turn:create'],
    });

    expect(
      vi.mocked(fetch).mock.calls.some(
        ([input]) => String(input) === `${baseUrl}/api/sessions/session-1/thread`,
      ),
    ).toBe(false);
  });
});
