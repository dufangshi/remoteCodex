import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  RelayEffectiveAccessDto,
  RelayPortalSummaryDto,
  ThreadDetailDto,
  ThreadDto,
} from '@remote-codex/shared';

import type { IOSBootstrap } from './IOSBootstrap';

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
    writeWorkspaceFile: vi.fn(),
    fetchHistoryItemDetail: vi.fn(),
    buildThreadImageAssetUrl: vi.fn(),
  },
  subscribeToThreadEvents: vi.fn(),
}));

vi.mock('./IOSApiClient', () => ({
  IOSApiClient: vi.fn(() => mocks.client),
}));

vi.mock('./IOSWebSocket', () => ({
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
    }) =>
      React.createElement(
        'div',
        null,
        React.createElement('h1', null, detail?.thread.title ?? 'Loading'),
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

const relayBootstrap: IOSBootstrap = {
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
  title: 'iOS relay thread',
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
      items: [],
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

describe('IOSThreadDetailPage relay sharing UI', () => {
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
    mocks.subscribeToThreadEvents.mockReturnValue({ close: vi.fn() });
  });

  it('loads subscription windows and refreshes them when the thread connects', async () => {
    const { IOSThreadDetailPage } = await import('./IOSThreadDetailPage');
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
      root.render(<IOSThreadDetailPage bootstrap={relayBootstrap} />);
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

  it('does not allow shared relay sessions to re-share from thread actions', async () => {
    const { IOSThreadDetailPage } = await import('./IOSThreadDetailPage');
    mocks.client.fetchRelayAccess.mockResolvedValue({
      kind: 'shared',
      shareId: 'share-1',
      workspaceId: 'workspace-1',
      threadAccess: 'read',
      workspaceAccess: 'read',
    } satisfies RelayEffectiveAccessDto);

    await act(async () => {
      root.render(<IOSThreadDetailPage bootstrap={relayBootstrap} />);
    });

    await waitFor(() => {
      expect(document.body.textContent).toContain('iOS relay thread');
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
});
