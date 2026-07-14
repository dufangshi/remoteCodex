import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  RelayEffectiveAccessDto,
  RelayPortalSummaryDto,
  ThreadDetailDto,
  ThreadDto,
} from '@remote-codex/shared';

import type { AndroidThreadBootstrap } from './AndroidBootstrap';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  client: {
    listThreads: vi.fn(),
    fetchThreadDetail: vi.fn(),
    fetchRelayAccess: vi.fn(),
    fetchRelayPortal: vi.fn(),
    createRelayShare: vi.fn(),
    revokeRelayShare: vi.fn(),
    listModels: vi.fn(),
    listAgentRuntimes: vi.fn(),
    fetchAgentSubscriptionUsage: vi.fn(),
    fetchThreadExportTurns: vi.fn(),
    downloadThreadTranscriptExport: vi.fn(),
    fetchWorkspaceTree: vi.fn(),
    fetchWorkspaceFilePreview: vi.fn(),
    buildWorkspaceRawFileUrl: vi.fn(),
    downloadWorkspaceNode: vi.fn(),
    uploadWorkspaceFile: vi.fn(),
    fetchHistoryItemDetail: vi.fn(),
    buildThreadImageAssetUrl: vi.fn(),
  },
  subscribeToThreadEvents: vi.fn(),
}));

vi.mock('./AndroidApiClient', () => ({
  AndroidApiClient: vi.fn(() => mocks.client),
}));

vi.mock('./AndroidWebSocket', () => ({
  subscribeToThreadEvents: mocks.subscribeToThreadEvents,
}));

vi.mock('@remote-codex/thread-ui', async () => {
  const React = await import('react');
  const dialog = await import(
    '../../../../../remote-codex-thread-ui/packages/thread-ui/src/components/ExportTranscriptDialog'
  );
  return {
    ConfirmDialog: () => null,
    formatLongTimestamp: (value: string) => value,
    PluginProvider: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    ThreadActionsDialog: dialog.ThreadActionsDialog,
    ThreadDetailSurface: ({
      detail,
      timelineProps,
      threadActionsButton,
      surfaceActions,
      mobileHeaderAction,
      dialogs,
      composerProps,
    }: {
      detail: ThreadDetailDto | null;
      threadActionsButton?: React.ReactNode;
      surfaceActions?: React.ReactNode;
      mobileHeaderAction?: React.ReactNode;
      dialogs?: React.ReactNode;
      composerProps?: { subscriptionUsage?: unknown };
      timelineProps?: { autoCollapseCompletedTurns?: boolean };
    }) =>
      React.createElement(
        'div',
        null,
        React.createElement('h1', null, detail?.thread.title ?? 'Loading'),
        React.createElement(
          'p',
          { 'data-testid': 'latest-agent-text' },
          detail?.turns.at(-1)?.items.at(-1)?.text ?? '',
        ),
        React.createElement(
          'span',
          { 'data-testid': 'auto-collapse' },
          String(timelineProps?.autoCollapseCompletedTurns ?? false),
        ),
        threadActionsButton,
        surfaceActions,
        mobileHeaderAction,
        dialogs,
        React.createElement(
          'output',
          { 'data-testid': 'subscription-usage' },
          JSON.stringify(composerProps?.subscriptionUsage ?? null),
        ),
      ),
    threadStatusLabel: (status: string) => status,
  };
});

const relayBootstrap: AndroidThreadBootstrap = {
  baseUrl: 'https://relay.example.test',
  mode: 'relay',
  authToken: 'relay-token',
  relayDeviceId: 'device-1',
  threadId: 'thread-1',
  theme: 'dark',
  fixture: false,
};

const thread: ThreadDto = {
  id: 'thread-1',
  workspaceId: 'workspace-1',
  provider: 'claude',
  providerSessionId: 'session-1',
  source: 'supervisor',
  title: 'Relay thread',
  model: 'gpt-5.5',
  reasoningEffort: 'high',
  fastMode: false,
  collaborationMode: 'default',
  approvalMode: 'guarded',
  sandboxMode: 'workspace-write',
  status: 'idle',
  summaryText: null,
  lastError: null,
  activeTurnId: null,
  isLoaded: true,
  isPinned: false,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:01:00.000Z',
  lastTurnStartedAt: null,
  lastTurnCompletedAt: null,
};

const detail: ThreadDetailDto = {
  thread,
  workspace: {
    id: 'workspace-1',
    hostId: 'device-1',
    label: 'Workspace',
    absPath: '/tmp/workspace',
    isFavorite: false,
    createdAt: '2026-07-01T00:00:00.000Z',
    lastOpenedAt: '2026-07-01T00:00:00.000Z',
  },
  workspacePathStatus: 'present',
  turns: [
    {
      id: 'turn-1',
      startedAt: '2026-07-01T00:00:10.000Z',
      status: 'completed',
      error: null,
      model: 'gpt-5.5',
      reasoningEffort: 'high',
      reasoningEffortAvailable: true,
      tokenUsage: null,
      priceEstimate: null,
      items: [
        {
          id: 'item-1',
          kind: 'userMessage',
          createdAt: '2026-07-01T00:00:10.000Z',
          text: 'Hello',
        },
        {
          id: 'item-2',
          kind: 'agentMessage',
          createdAt: '2026-07-01T00:00:11.000Z',
          text: 'Hi',
          status: 'completed',
        },
      ],
    },
  ],
  totalTurnCount: 1,
  pendingRequests: [],
  pendingSteers: [],
};

const ownerAccess: RelayEffectiveAccessDto = {
  kind: 'owner',
  shareId: null,
  workspaceId: 'workspace-1',
  threadAccess: 'control',
  workspaceAccess: 'write',
};

const emptyPortal: RelayPortalSummaryDto = {
  user: {
    id: 'owner-1',
    email: 'owner@example.com',
    username: 'owner',
    role: 'user',
    enabled: true,
    createdAt: '2026-07-01T00:00:00.000Z',
  },
  devices: [],
  sharedByMe: [],
  sharedWithMe: [],
};

function installBrowserStubs() {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(HTMLTextAreaElement.prototype, 'setSelectionRange', {
    configurable: true,
    value: vi.fn(),
  });
}

async function waitFor(assertion: () => void) {
  const deadline = Date.now() + 2000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      assertion();
      return;
    } catch (caught) {
      lastError = caught;
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
    }
  }
  throw lastError;
}

function buttonByText(text: string) {
  return Array.from(document.querySelectorAll('button')).find(
    (button) => button.textContent?.trim() === text,
  ) as HTMLButtonElement | undefined;
}

describe('AndroidThreadDetailPage', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    installBrowserStubs();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    mocks.client.listThreads.mockResolvedValue([thread]);
    mocks.client.fetchThreadDetail.mockResolvedValue(detail);
    mocks.client.fetchRelayAccess.mockResolvedValue(ownerAccess);
    mocks.client.fetchRelayPortal.mockResolvedValue(emptyPortal);
    mocks.client.listModels.mockResolvedValue([]);
    mocks.client.listAgentRuntimes.mockResolvedValue([]);
    mocks.client.fetchAgentSubscriptionUsage.mockResolvedValue({ usage: null });
    mocks.client.buildWorkspaceRawFileUrl.mockReturnValue('');
    mocks.client.buildThreadImageAssetUrl.mockReturnValue('');
    mocks.client.createRelayShare.mockResolvedValue({
      id: 'share-1',
      ownerUserId: 'owner-1',
      targetUserId: 'target-1',
      targetUsername: 'friend@example.com',
      deviceId: 'device-1',
      threadId: 'thread-1',
      workspaceId: null,
      label: null,
      threadAccess: 'read',
      workspaceAccess: 'none',
      createdAt: '2026-07-01T00:02:00.000Z',
      revokedAt: null,
    });
    mocks.subscribeToThreadEvents.mockReturnValue({ close: vi.fn() });
  });

  it('loads subscription windows and refreshes them when the thread connects', async () => {
    const { AndroidThreadDetailPage } = await import('./AndroidThreadDetailPage');
    mocks.client.fetchAgentSubscriptionUsage.mockResolvedValue({
      usage: {
        provider: 'claude',
        authKind: 'subscription',
        observedAt: '2026-07-13T20:00:00.000Z',
        stale: false,
        windows: [
          {
            id: 'weekly',
            durationMinutes: 10_080,
            label: '7d',
            usedPercent: 35,
            resetsAt: '2026-07-20T20:00:00.000Z',
          },
        ],
      },
    });

    await act(async () => {
      root.render(<AndroidThreadDetailPage bootstrap={relayBootstrap} />);
    });

    await waitFor(() => {
      expect(document.querySelector('[data-testid="subscription-usage"]')?.textContent)
        .toContain('"label":"7d"');
    });
    const handlers = mocks.subscribeToThreadEvents.mock.calls.at(-1)?.[2] as
      | { onOpen?: () => void }
      | undefined;
    await act(async () => {
      handlers?.onOpen?.();
    });
    await waitFor(() => {
      expect(mocks.client.fetchAgentSubscriptionUsage).toHaveBeenCalledTimes(2);
    });
    expect(mocks.client.fetchAgentSubscriptionUsage).toHaveBeenLastCalledWith('claude');
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('opens thread actions and creates a relay share from the Share tab', async () => {
    const { AndroidThreadDetailPage } = await import('./AndroidThreadDetailPage');

    await act(async () => {
      root.render(<AndroidThreadDetailPage bootstrap={relayBootstrap} />);
    });

    await waitFor(() => {
      expect(document.body.textContent).toContain('Relay thread');
    });

    const actionsButton = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Export or share thread"]',
    );
    expect(actionsButton).toBeTruthy();

    await act(async () => {
      actionsButton?.click();
    });

    await waitFor(() => {
      expect(document.querySelector('.thread-export-dialog-root')).toBeTruthy();
    });

    await act(async () => {
      buttonByText('Share')?.click();
    });

    await waitFor(() => {
      expect(document.body.textContent).toContain('Relay identifier');
    });

    const identifierInput = document.querySelector<HTMLInputElement>(
      'input[placeholder="username or email"]',
    );
    expect(identifierInput).toBeTruthy();
    await act(async () => {
      if (identifierInput) {
        identifierInput.focus();
        const valueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          'value',
        )?.set;
        valueSetter?.call(identifierInput, 'friend@example.com');
        identifierInput.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            inputType: 'insertText',
            data: 'friend@example.com',
          }),
        );
        identifierInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    await waitFor(() => {
      const submit = buttonByText('Share this thread');
      expect(submit?.disabled).toBe(false);
    });

    await act(async () => {
      buttonByText('Share this thread')?.click();
    });

    await waitFor(() => {
      expect(mocks.client.createRelayShare).toHaveBeenCalledTimes(1);
    });
    expect(mocks.client.createRelayShare).toHaveBeenCalledWith({
      targetIdentifier: 'friend@example.com',
      deviceId: 'device-1',
      threadId: 'thread-1',
      workspaceId: null,
      label: null,
      threadAccess: 'read',
      workspaceAccess: 'none',
    });
  });

  it('shows the shared access badge for shared relay sessions', async () => {
    const { AndroidThreadDetailPage } = await import('./AndroidThreadDetailPage');
    mocks.client.fetchRelayAccess.mockResolvedValue({
      kind: 'shared',
      shareId: 'share-1',
      workspaceId: 'workspace-1',
      threadAccess: 'read',
      workspaceAccess: 'read',
    } satisfies RelayEffectiveAccessDto);

    await act(async () => {
      root.render(<AndroidThreadDetailPage bootstrap={relayBootstrap} />);
    });

    await waitFor(() => {
      expect(document.body.textContent).toContain('Relay thread');
      expect(document.body.textContent).toContain('View only');
      expect(document.body.textContent).toContain('Workspace read');
    });
  });

  it('does not allow shared relay sessions to re-share from thread actions', async () => {
    const { AndroidThreadDetailPage } = await import('./AndroidThreadDetailPage');
    mocks.client.fetchRelayAccess.mockResolvedValue({
      kind: 'shared',
      shareId: 'share-1',
      workspaceId: 'workspace-1',
      threadAccess: 'read',
      workspaceAccess: 'read',
    } satisfies RelayEffectiveAccessDto);

    await act(async () => {
      root.render(<AndroidThreadDetailPage bootstrap={relayBootstrap} />);
    });

    await waitFor(() => {
      expect(document.body.textContent).toContain('Relay thread');
    });

    const actionsButton = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Export or share thread"]',
    );
    expect(actionsButton).toBeTruthy();

    await act(async () => {
      actionsButton?.click();
    });

    await waitFor(() => {
      expect(document.querySelector('.thread-export-dialog-root')).toBeTruthy();
    });

    await act(async () => {
      buttonByText('Share')?.click();
    });

    await waitFor(() => {
      expect(document.body.textContent).toContain(
        'Only the owner can share this session.',
      );
    });
    expect(buttonByText('Share this thread')?.disabled).toBe(true);
    expect(mocks.client.createRelayShare).not.toHaveBeenCalled();
  });

  it('projects streamed output immediately and enables completed-turn auto collapse', async () => {
    const { AndroidThreadDetailPage } = await import('./AndroidThreadDetailPage');

    await act(async () => {
      root.render(<AndroidThreadDetailPage bootstrap={relayBootstrap} />);
    });
    await waitFor(() => {
      expect(document.querySelector('[data-testid="auto-collapse"]')?.textContent).toBe('true');
      expect(mocks.subscribeToThreadEvents).toHaveBeenCalled();
    });

    const handlers = mocks.subscribeToThreadEvents.mock.calls.at(-1)?.[2] as {
      onEvent(event: unknown): void;
    };
    await act(async () => {
      handlers.onEvent({
        type: 'thread.output.delta',
        threadId: 'thread-1',
        timestamp: '2026-07-01T00:00:12.000Z',
        payload: {
          turnId: 'turn-1',
          itemId: 'item-2',
          sequence: 1,
          delta: ' streamed',
        },
      });
    });

    expect(document.querySelector('[data-testid="latest-agent-text"]')?.textContent).toBe(
      'Hi streamed',
    );
    expect(mocks.client.fetchThreadDetail).toHaveBeenCalledTimes(1);
  });

  it('refreshes after foreground resume and does not let an older snapshot replace a live delta', async () => {
    const { AndroidThreadDetailPage } = await import('./AndroidThreadDetailPage');
    let resolveRefresh: ((value: ThreadDetailDto) => void) | null = null;
    const pendingRefresh = new Promise<ThreadDetailDto>((resolve) => {
      resolveRefresh = resolve;
    });
    mocks.client.fetchThreadDetail
      .mockResolvedValueOnce(detail)
      .mockReturnValueOnce(pendingRefresh);

    await act(async () => {
      root.render(<AndroidThreadDetailPage bootstrap={relayBootstrap} />);
    });
    await waitFor(() => {
      expect(mocks.subscribeToThreadEvents).toHaveBeenCalled();
    });

    const handlers = mocks.subscribeToThreadEvents.mock.calls.at(-1)?.[2] as {
      onOpen(): void;
      onEvent(event: unknown): void;
    };
    await act(async () => {
      handlers.onOpen();
      handlers.onEvent({
        type: 'thread.output.delta',
        threadId: 'thread-1',
        timestamp: '2026-07-01T00:00:12.000Z',
        payload: {
          turnId: 'turn-1',
          itemId: 'item-2',
          sequence: 1,
          delta: ' live',
        },
      });
    });
    expect(document.querySelector('[data-testid="latest-agent-text"]')?.textContent).toBe(
      'Hi live',
    );

    await act(async () => {
      resolveRefresh?.(detail);
      await pendingRefresh;
    });
    expect(document.querySelector('[data-testid="latest-agent-text"]')?.textContent).toBe(
      'Hi live',
    );

    const callsBeforeResume = mocks.client.fetchThreadDetail.mock.calls.length;
    await act(async () => {
      window.remoteCodexAndroidHost?.resumeSceneActive?.();
      await new Promise((resolve) => window.setTimeout(resolve, 10));
    });
    await waitFor(() => {
      expect(mocks.client.fetchThreadDetail.mock.calls.length).toBeGreaterThan(
        callsBeforeResume,
      );
    });
  });
});
