import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ThreadDetailDto } from '../../../../packages/shared/src/index';
import {
  AppShellNavContext,
  AppShellSettingsDialog,
  type AppShellNavContextValue,
  type ThemeMode,
} from '@remote-codex/thread-ui';
import {
  ControlPlaneSessionPage,
  mergeControlPlaneThreadDetail,
} from './ControlPlaneSessionPage';

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

const threadDetail: ThreadDetailDto = {
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
        {
          id: 'item-command-1',
          kind: 'commandExecution',
          text: 'pnpm test',
          detailText: null,
          hasDeferredDetail: true,
          status: 'completed',
        },
        {
          id: 'item-3',
          kind: 'image',
          text: 'Worker screenshot',
          assetPath: './.temp/threads/worker-session-1/screenshot.png',
        },
        {
          id: 'item-4',
          kind: 'artifact',
          text: 'Created methane molecule artifact',
          artifact: {
            id: 'artifact-1',
            pluginId: 'remote-codex.xyz-viewer',
            type: 'chemistry.molecule3d',
            title: 'Methane',
            summaryText: 'XYZ molecule preview',
            payload: {
              format: 'xyz',
              content: ['5\nmethane\nC 0 0 0\nH 0 0 1\nH 0 1 0\nH 1 0 0\nH 0 -1 0'],
              name: 'methane.xyz',
            },
            assets: null,
            sourceTurnId: 'turn-1',
            sourceItemId: 'item-4',
            createdAt: '2026-05-25T00:02:10.000Z',
          },
        },
      ],
    },
  ],
  totalTurnCount: 1,
  pendingRequests: [],
  pendingSteers: [],
};

function setPromptValue(element: HTMLElement, value: string) {
  element.textContent = value;
  fireEvent.input(element);
}

function renderControlPlaneSessionPage() {
  function TestShell() {
    const [navOpen, setNavOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [themeMode, setThemeMode] = useState<ThemeMode>('system');
    const value: AppShellNavContextValue = {
      navOpen,
      openNav: () => setNavOpen(true),
      toggleNav: () => setNavOpen((current) => !current),
      closeNav: () => setNavOpen(false),
      settingsOpen,
      openSettings: () => {
        setNavOpen(false);
        setSettingsOpen(true);
      },
      closeSettings: () => setSettingsOpen(false),
      themeMode,
      setThemeMode,
      effectiveTheme: themeMode === 'system' ? 'dark' : themeMode,
      defaultBackend: 'codex',
      setDefaultBackend: () => {},
    };

    return (
      <AppShellNavContext.Provider value={value}>
        <Routes>
          <Route path="/control-plane/sessions/:sessionId" element={<ControlPlaneSessionPage />} />
          <Route path="/control-plane/login" element={<div>Login</div>} />
        </Routes>
        <AppShellSettingsDialog />
      </AppShellNavContext.Provider>
    );
  }

  return render(
    <MemoryRouter initialEntries={['/control-plane/sessions/session-1']}>
      <TestShell />
    </MemoryRouter>,
  );
}

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
          url ===
          `${routerBaseUrl}/api/sandboxes/sandbox-1/api/threads/worker-session-1/items/item-command-1/detail`
        ) {
          return jsonResponse({
            id: 'item-command-1',
            kind: 'commandExecution',
            title: 'Command Output',
            text: 'pnpm test\nmiddle output line\nfinal status: success',
          });
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

  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens a control-plane session through the router and sends prompts to the worker thread', async () => {
    renderControlPlaneSessionPage();

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Expand thread navigation' }),
      ).toHaveTextContent('Molecule study / Plan calculation');
    });
    expect(screen.getByRole('link', { name: /Plan calculation/ })).toBeInTheDocument();
    expect(screen.getByText('Hello remote worker')).toBeInTheDocument();
    expect(screen.getByText('Ready from sandbox')).toBeInTheDocument();
    expect(screen.getAllByText('Molecule study').length).toBeGreaterThan(0);
    expect(screen.getByText('Computational chemistry')).toBeInTheDocument();
    expect(screen.getAllByText('gpt-5.1-codex').length).toBeGreaterThan(0);
    expect(screen.queryByText('session-1')).not.toBeInTheDocument();
    expect(screen.queryByText('worker-session-1')).not.toBeInTheDocument();
    expect(screen.queryByText(routerBaseUrl)).not.toBeInTheDocument();
    expect(screen.queryByText('/workspace/molecule-study')).not.toBeInTheDocument();
    expect(await screen.findByRole('img', { name: 'Worker screenshot' })).toHaveAttribute(
      'src',
      `${routerBaseUrl}/api/sandboxes/sandbox-1/api/threads/worker-session-1/assets/image?path=.%2F.temp%2Fthreads%2Fworker-session-1%2Fscreenshot.png`,
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Open artifact inspector for Methane' }),
    );
    expect(screen.getByRole('complementary', { name: 'Thread inspector' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Preview' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('tab', { name: 'Source' }));
    expect(screen.getByText('methane.xyz')).toBeInTheDocument();
    expect(screen.getByText(/C 0 0 0/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Metadata' }));
    expect(screen.getByText('artifact-1')).toBeInTheDocument();
    expect(screen.getByText('remote-codex.xyz-viewer')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close thread inspector' }));
    expect(
      screen.queryByRole('complementary', { name: 'Thread inspector' }),
    ).not.toBeInTheDocument();

    expect(screen.queryByText(/middle output line/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open full command' }));
    await waitFor(() => {
      expect(screen.getByRole('complementary', { name: 'Thread inspector' })).toBeInTheDocument();
    });
    expect(screen.getByRole('tab', { name: 'Logs' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText(/middle output line/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Metadata' }));
    expect(screen.getAllByText('item-command-1').length).toBeGreaterThan(0);
    const commandDetailCall = vi.mocked(fetch).mock.calls.find(
      ([input]) =>
        String(input) ===
        `${routerBaseUrl}/api/sandboxes/sandbox-1/api/threads/worker-session-1/items/item-command-1/detail`,
    );
    expect(new Headers(commandDetailCall?.[1]?.headers).get('Authorization')).toBe(
      'Bearer route-token',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close thread inspector' }));

    fireEvent.click(screen.getByRole('button', { name: /Diagnostics/ }));
    expect(screen.getByText('Control session id')).toBeInTheDocument();
    expect(screen.getByText('session-1')).toBeInTheDocument();
    expect(screen.getByText('Worker thread id')).toBeInTheDocument();
    expect(screen.getByText('worker-session-1')).toBeInTheDocument();
    expect(screen.getByText(routerBaseUrl)).toBeInTheDocument();
    expect(screen.getByText('/workspace/molecule-study')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open Navigation' }));
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByText('Terminal')).toBeInTheDocument();
    expect(screen.getByText('XYZ Molecule Viewer')).toBeInTheDocument();
    expect(screen.queryByText(/Unexpected token/)).not.toBeInTheDocument();
    expect(
      vi.mocked(fetch).mock.calls.some(([input]) => String(input).includes('/api/plugins')),
    ).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Switch to shell' }));
    expect(screen.getByText('Remote shell transport unavailable')).toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText('Remote shell transport unavailable.'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Send Shell Input' }),
    ).not.toBeInTheDocument();
    expect(
      vi.mocked(fetch).mock.calls.some(([input]) => String(input).includes('/ws')),
    ).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Switch to chat' }));

    setPromptValue(screen.getByRole('textbox', { name: 'Prompt' }), 'Continue from here');
    fireEvent.click(screen.getByRole('button', { name: 'Send Prompt' }));

    const findPromptCall = () => vi.mocked(fetch).mock.calls.find(
      ([input]) =>
        String(input) ===
        `${routerBaseUrl}/api/sandboxes/sandbox-1/api/threads/worker-session-1/prompt`,
    );
    await waitFor(() => {
      expect(findPromptCall()).toBeDefined();
    });
    expect(screen.queryByText('Prompt sent. Waiting for worker updates...')).not.toBeInTheDocument();

    const promptCall = findPromptCall();
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
      scopes: [
        'worker:read',
        'worker:write',
        'session:prompt',
        'provider:turn:create',
        'provider:turn:interrupt',
      ],
    });

    expect(
      vi.mocked(fetch).mock.calls.some(
        ([input]) => String(input) === `${baseUrl}/api/sessions/session-1/thread`,
      ),
    ).toBe(false);
  });

  it('polls the router while a prompt turn is running', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const runningThreadDetail = {
      ...threadDetail,
      thread: {
        ...threadDetail.thread,
        status: 'running',
        activeTurnId: 'turn-2',
      },
      turns: [
        ...threadDetail.turns,
        {
          id: 'turn-2',
          startedAt: '2026-05-25T00:03:00.000Z',
          status: 'running',
          error: null,
          items: [
            {
              id: 'item-3',
              kind: 'userMessage',
              text: 'Keep going',
            },
          ],
        },
      ],
      totalTurnCount: 2,
    };
    let threadReads = 0;
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
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
        threadReads += 1;
        return jsonResponse(threadReads === 1 ? runningThreadDetail : threadDetail);
      }

      return jsonResponse({ code: 'not_found', message: `Unhandled request: ${url}` }, 404);
    });

    renderControlPlaneSessionPage();

    await waitFor(() => {
      expect(screen.getByText('Keep going')).toBeInTheDocument();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    await waitFor(() => {
      expect(screen.getByText('Ready from sandbox')).toBeInTheDocument();
    });
    expect(threadReads).toBeGreaterThanOrEqual(2);
  });

  it('preserves unchanged timeline references across polling refreshes', () => {
    const equivalentDetail = JSON.parse(JSON.stringify(threadDetail));
    const merged = mergeControlPlaneThreadDetail(threadDetail, equivalentDetail);

    expect(merged.turns).toBe(threadDetail.turns);
    expect(merged.turns[0]).toBe(threadDetail.turns[0]);
    expect(merged.pendingRequests).toBe(threadDetail.pendingRequests);
  });

  it('interrupts the active worker turn through the router', async () => {
    const runningThreadDetail = {
      ...threadDetail,
      thread: {
        ...threadDetail.thread,
        status: 'running',
        activeTurnId: 'turn-2',
      },
      turns: [
        ...threadDetail.turns,
        {
          id: 'turn-2',
          startedAt: '2026-05-25T00:03:00.000Z',
          status: 'inProgress',
          error: null,
          items: [
            {
              id: 'item-4',
              kind: 'userMessage',
              text: 'Run a longer task',
            },
          ],
        },
      ],
      totalTurnCount: 2,
    };
    let interrupted = false;
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
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
        return jsonResponse(interrupted ? threadDetail : runningThreadDetail);
      }
      if (
        url === `${routerBaseUrl}/api/sandboxes/sandbox-1/api/threads/worker-session-1/interrupt` &&
        init?.method === 'POST'
      ) {
        interrupted = true;
        return jsonResponse({ ...threadDetail.thread, status: 'interrupted' });
      }

      return jsonResponse({ code: 'not_found', message: `Unhandled request: ${url}` }, 404);
    });

    renderControlPlaneSessionPage();

    const stopButton = await screen.findByRole('button', { name: 'Stop Current Turn' });
    expect(stopButton).toBeEnabled();
    fireEvent.click(stopButton);

    const findInterruptCall = () => vi.mocked(fetch).mock.calls.find(
      ([input]) =>
        String(input) ===
        `${routerBaseUrl}/api/sandboxes/sandbox-1/api/threads/worker-session-1/interrupt`,
    );
    await waitFor(() => {
      expect(findInterruptCall()).toBeDefined();
    });

    const interruptCall = findInterruptCall();
    expect(interruptCall?.[1]?.method).toBe('POST');
    expect(interruptCall?.[1]?.body).toBe(JSON.stringify({ turnId: 'turn-2' }));
    expect(new Headers(interruptCall?.[1]?.headers).get('Authorization')).toBe(
      'Bearer route-token',
    );
  });

  it('refreshes the router token before it expires', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-05-25T00:00:00.000Z'));
    let routeTokenReads = 0;

    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
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
        routeTokenReads += 1;
        return jsonResponse({
          sandboxId: 'sandbox-1',
          routerBaseUrl,
          wsBaseUrl: 'wss://router.example.test',
          token: `route-token-${routeTokenReads}`,
          expiresAt:
            routeTokenReads === 1
              ? '2026-05-25T00:02:00.000Z'
              : '2026-05-25T01:00:00.000Z',
        });
      }
      if (url === `${routerBaseUrl}/api/sandboxes/sandbox-1/api/threads/worker-session-1`) {
        return jsonResponse(threadDetail);
      }

      return jsonResponse({ code: 'not_found', message: `Unhandled request: ${url}` }, 404);
    });

    renderControlPlaneSessionPage();

    await waitFor(() => {
      expect(screen.getByText('Ready from sandbox')).toBeInTheDocument();
    });
    expect(routeTokenReads).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    await waitFor(() => {
      expect(routeTokenReads).toBe(2);
    });
  });

  it('refreshes an expired router token and retries a prompt once', async () => {
    let routeTokenReads = 0;
    let promptReads = 0;

    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
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
        routeTokenReads += 1;
        return jsonResponse({
          sandboxId: 'sandbox-1',
          routerBaseUrl,
          wsBaseUrl: 'wss://router.example.test',
          token: `route-token-${routeTokenReads}`,
          expiresAt: '2099-05-25T00:05:00.000Z',
        });
      }
      if (url === `${routerBaseUrl}/api/sandboxes/sandbox-1/api/threads/worker-session-1`) {
        return jsonResponse(threadDetail);
      }
      if (
        url === `${routerBaseUrl}/api/sandboxes/sandbox-1/api/threads/worker-session-1/prompt` &&
        init?.method === 'POST'
      ) {
        promptReads += 1;
        if (promptReads === 1) {
          return jsonResponse(
            { code: 'invalid_route_token', message: 'Route token is invalid or expired.' },
            401,
          );
        }
        return jsonResponse({ ...threadDetail.thread, status: 'running' });
      }

      return jsonResponse({ code: 'not_found', message: `Unhandled request: ${url}` }, 404);
    });

    renderControlPlaneSessionPage();

    await waitFor(() => {
      expect(screen.getByText('Ready from sandbox')).toBeInTheDocument();
    });

    setPromptValue(screen.getByRole('textbox', { name: 'Prompt' }), 'Continue after expiry');
    fireEvent.click(screen.getByRole('button', { name: 'Send Prompt' }));

    await waitFor(() => {
      expect(promptReads).toBe(2);
    });
    expect(routeTokenReads).toBe(2);

    const promptCalls = vi.mocked(fetch).mock.calls.filter(
      ([input]) =>
        String(input) ===
        `${routerBaseUrl}/api/sandboxes/sandbox-1/api/threads/worker-session-1/prompt`,
    );
    expect(new Headers(promptCalls[0]?.[1]?.headers).get('Authorization')).toBe(
      'Bearer route-token-1',
    );
    expect(new Headers(promptCalls[1]?.[1]?.headers).get('Authorization')).toBe(
      'Bearer route-token-2',
    );
  });

  it('reconnects and retries a prompt when the worker thread disappeared after page load', async () => {
    const rematerializedSession = {
      ...session,
      workerSessionId: 'worker-session-2',
    };
    const rematerializedThreadDetail = {
      ...threadDetail,
      thread: {
        ...threadDetail.thread,
        id: 'worker-session-2',
        status: 'running',
        activeTurnId: 'turn-2',
      },
      turns: [
        ...threadDetail.turns,
        {
          id: 'turn-2',
          startedAt: '2026-05-25T00:03:00.000Z',
          status: 'running',
          error: null,
          items: [
            {
              id: 'item-3',
              kind: 'userMessage',
              text: 'Retry after worker restart',
            },
          ],
        },
      ],
      totalTurnCount: 2,
    };
    let resumeCount = 0;

    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
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
        resumeCount += 1;
        return jsonResponse({ session: resumeCount === 1 ? session : rematerializedSession });
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
        return jsonResponse({ code: 'not_found', message: 'Thread not found.' }, 404);
      }
      if (url === `${routerBaseUrl}/api/sandboxes/sandbox-1/api/threads/worker-session-2`) {
        return jsonResponse(rematerializedThreadDetail);
      }
      if (
        url === `${routerBaseUrl}/api/sandboxes/sandbox-1/api/threads/worker-session-2/prompt` &&
        init?.method === 'POST'
      ) {
        return jsonResponse({ ...rematerializedThreadDetail.thread, status: 'running' });
      }

      return jsonResponse({ code: 'not_found', message: `Unhandled request: ${url}` }, 404);
    });

    renderControlPlaneSessionPage();

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Expand thread navigation' }),
      ).toHaveTextContent('Molecule study / Plan calculation');
    });

    setPromptValue(
      screen.getByRole('textbox', { name: 'Prompt' }),
      'Retry after worker restart',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send Prompt' }));

    await waitFor(() => {
      expect(screen.getByText('Retry after worker restart')).toBeInTheDocument();
    });
    expect(
      screen.queryByText('Prompt sent after reconnect. Waiting for worker updates...'),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Retry after worker restart')).toBeInTheDocument();

    const oldPromptCall = vi.mocked(fetch).mock.calls.find(
      ([input]) =>
        String(input) ===
        `${routerBaseUrl}/api/sandboxes/sandbox-1/api/threads/worker-session-1/prompt`,
    );
    const newPromptCall = vi.mocked(fetch).mock.calls.find(
      ([input]) =>
        String(input) ===
        `${routerBaseUrl}/api/sandboxes/sandbox-1/api/threads/worker-session-2/prompt`,
    );
    expect(oldPromptCall?.[1]?.method).toBe('POST');
    expect(newPromptCall?.[1]?.method).toBe('POST');
    expect(new Headers(newPromptCall?.[1]?.headers).get('Authorization')).toBe('Bearer route-token');
  });
});
