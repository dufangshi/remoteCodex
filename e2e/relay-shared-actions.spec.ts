import { expect, test, type Page, type Route } from '@playwright/test';

const now = '2026-07-01T12:00:00.000Z';

const relayUser = {
  id: 'friend-user',
  email: 'friend@example.test',
  username: 'friend',
  role: 'user',
  enabled: true,
  createdAt: now,
};

const ownerUser = {
  id: 'owner-user',
  email: 'owner@example.test',
  username: 'owner',
  role: 'user',
  enabled: true,
  createdAt: now,
};

const sharedThread = {
  id: 'thread-shared',
  workspaceId: 'workspace-shared',
  provider: 'codex',
  providerSessionId: 'session-shared',
  source: 'supervisor',
  title: 'Shared planning thread',
  model: 'gpt-5',
  reasoningEffort: 'medium',
  fastMode: false,
  collaborationMode: 'default',
  approvalMode: 'guarded',
  sandboxMode: 'workspace-write',
  status: 'idle',
  summaryText: 'Shared thread preview',
  lastError: null,
  activeTurnId: null,
  isLoaded: true,
  isPinned: false,
  createdAt: now,
  updatedAt: now,
  lastTurnStartedAt: null,
  lastTurnCompletedAt: now,
};

const sharedWorkspace = {
  id: 'workspace-shared',
  hostId: 'device-shared',
  label: 'Shared workspace',
  absPath: '/tmp/shared-workspace',
  isFavorite: false,
  createdAt: now,
  lastOpenedAt: now,
};

const sharedSession = {
  id: 'share-1',
  ownerUserId: 'owner-user',
  ownerUsername: 'owner',
  targetUserId: relayUser.id,
  targetUsername: relayUser.username,
  deviceId: 'device-shared',
  deviceName: 'Owner workstation',
  threadId: sharedThread.id,
  workspaceId: sharedWorkspace.id,
  label: 'Pair review',
  threadAccess: 'read',
  workspaceAccess: 'read',
  createdAt: now,
  revokedAt: null,
  expiresAt: null,
};

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

async function installRelayMocks(
  page: Page,
  options: { access?: 'owner' | 'shared' } = {},
) {
  const access = options.access ?? 'shared';
  const currentUser = access === 'owner' ? ownerUser : relayUser;
  const createdShares: Record<string, unknown>[] = [];
  const createShareRequests: Record<string, unknown>[] = [];

  await page.addInitScript(() => {
    window.localStorage.setItem('remote-codex-relay-mode', 'true');
    window.localStorage.setItem('remote-codex-relay-token', 'relay-test-token');
  });

  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    if (path === '/relay/auth/session') {
      return json(route, {
        authenticated: true,
        user: currentUser,
        registrationEnabled: true,
      });
    }

    if (path === '/relay/portal') {
      return json(route, {
        user: currentUser,
        devices: [],
        sharedWithMe: access === 'shared' ? [sharedSession] : [],
        sharedByMe: createdShares,
      });
    }

    if (path === '/relay/access') {
      return json(route, access === 'owner'
        ? { kind: 'owner', threadAccess: 'control', workspaceAccess: 'write' }
        : {
            kind: 'shared',
            shareId: sharedSession.id,
            threadAccess: 'read',
            workspaceAccess: 'read',
            workspaceId: sharedWorkspace.id,
          });
    }

    if (path === '/relay/shares' && request.method() === 'POST') {
      const payload = request.postDataJSON() as Record<string, unknown>;
      createShareRequests.push(payload);
      const created = {
        ...sharedSession,
        id: 'share-created',
        targetUsername: String(payload.targetIdentifier ?? 'reviewer'),
        threadAccess: payload.threadAccess,
        workspaceAccess: payload.workspaceAccess,
        label: payload.label ?? null,
      };
      createdShares.push(created);
      return json(route, created);
    }

    if (path.endsWith(`/api/threads/${sharedThread.id}`)) {
      return json(route, {
        thread: sharedThread,
        workspace: sharedWorkspace,
        workspacePathStatus: 'present',
        pendingRequests: [],
        pendingSteers: [],
        turns: [
          {
            id: 'turn-1',
            startedAt: now,
            status: 'completed',
            error: null,
            model: 'gpt-5',
            reasoningEffort: 'medium',
            reasoningEffortAvailable: true,
            tokenUsage: null,
            priceEstimate: null,
            items: [
              {
                id: 'item-user',
                kind: 'userMessage',
                createdAt: now,
                text: 'Please review this shared thread.',
              },
              {
                id: 'item-agent',
                kind: 'agentMessage',
                createdAt: now,
                text: 'Shared session is visible.',
                status: 'completed',
              },
            ],
          },
        ],
        totalTurnCount: 1,
      });
    }

    if (path.endsWith('/api/threads')) {
      return json(route, [sharedThread]);
    }

    if (path.endsWith(`/api/threads/${sharedThread.id}/export-turns`)) {
      return json(route, {
        totalTurnCount: 1,
        turns: [
          {
            turnId: 'turn-1',
            turnNumber: 1,
            startedAt: now,
            status: 'completed',
            userPromptPreview: 'Please review this shared thread.',
          },
        ],
      });
    }

    if (path.endsWith('/api/agent-runtimes/codex/status')) {
      return json(route, {
        provider: 'codex',
        displayName: 'Codex',
        description: 'Relay mock runtime',
        enabled: true,
        isDefault: true,
        status: {
          state: 'ready',
          transport: 'stdio',
          lastStartedAt: now,
          lastError: null,
          restartCount: 0,
        },
        capabilities: {
          sessions: { list: true, read: true, resume: true, importLocal: true },
          turns: { start: true, streamInput: false, steer: true, interrupt: true, compact: true },
          branching: { fork: true, hardRollback: true, resumeAt: false, rewindFiles: false },
          controls: {
            planMode: true,
            permissionRequests: true,
            sandboxMode: false,
            performanceMode: true,
            goals: true,
          },
          management: {
            models: true,
            mcpStatus: true,
            skills: true,
            hooks: true,
            hookTrust: true,
            hostConfigFiles: true,
            providerSettings: false,
          },
          usage: { contextWindow: true, tokenUsage: true, costUsd: false },
        },
        managementSchema: {
          hostConfigFiles: [],
          toolboxItems: [],
          hookCommandTemplates: [],
          providerConfigFormat: 'none',
          mcpConfigFormat: 'none',
          configArchives: false,
          buildRestart: false,
        },
      });
    }

    if (path.endsWith('/api/agent-runtimes/codex/models')) {
      return json(route, [
        {
          id: 'gpt-5',
          model: 'gpt-5',
          displayName: 'GPT-5',
          description: 'Default model',
          hidden: false,
          isDefault: true,
          supportedReasoningEfforts: [
            { reasoningEffort: 'medium', description: 'Balanced' },
          ],
          defaultReasoningEffort: 'medium',
        },
      ]);
    }

    if (path.endsWith('/api/plugins')) {
      return json(route, []);
    }

    if (path.endsWith('/healthz')) {
      return json(route, { status: 'ok' });
    }

    return route.continue();
  });

  return {
    createShareRequests,
    createdShares,
  };
}

test.describe('relay shared session actions', () => {
  test('opens a shared session from Relay Devices and blocks re-sharing from Thread actions', async ({
    page,
  }) => {
    await installRelayMocks(page);

    await page.goto('/relay-devices');
    await expect(page.getByRole('heading', { name: 'Shared with me' })).toBeVisible();
    await expect(page.getByText('Pair review')).toBeVisible();
    await expect(page.getByText('View only')).toBeVisible();
    await expect(page.getByText('Workspace read')).toBeVisible();

    await page.getByRole('button', { name: 'Open', exact: true }).click();
    await expect(page).toHaveURL(/\/devices\/device-shared\/threads\/thread-shared/);
    await expect(page.getByText('Shared planning thread').first()).toBeVisible();
    await expect(page.locator('[title="View only / Workspace read"]:visible')).toBeVisible();
    await expect(page.getByText('This shared session is view only.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send Prompt' })).toBeDisabled();

    await page.getByRole('button', { name: 'Thread actions' }).click();
    await expect(page.getByRole('dialog', { name: 'Thread actions' })).toBeVisible();
    await page.getByRole('button', { name: 'Share', exact: true }).click();
    await expect(page.getByText('Only the owner can share this session.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Share session' })).toBeDisabled();
  });

  test('creates an owner share from Thread actions and refreshes Shared by me', async ({
    page,
  }) => {
    const relayMocks = await installRelayMocks(page, { access: 'owner' });
    const accessResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === '/relay/access';
    });

    await page.goto('/devices/device-shared/threads/thread-shared');
    await accessResponse;
    await expect(page.getByText('Shared planning thread').first()).toBeVisible();

    await page.getByRole('button', { name: 'Thread actions' }).click();
    await expect(page.getByRole('dialog', { name: 'Thread actions' })).toBeVisible();
    await page.getByRole('button', { name: 'Share', exact: true }).click();
    await page.getByPlaceholder('username or email').fill('reviewer@example.test');
    await page.getByLabel('Collaborator').check();
    await page.getByLabel('Read and edit').check();
    await page.getByPlaceholder('optional').fill('Pairing');
    await page.getByRole('button', { name: 'Share session' }).click();

    await expect(page.getByText('reviewer@example.test')).toBeVisible();
    await expect(page.getByText('Pairing · Collaborator / Workspace write')).toBeVisible();
    expect(relayMocks.createShareRequests).toEqual([
      {
        targetIdentifier: 'reviewer@example.test',
        deviceId: 'device-shared',
        threadId: 'thread-shared',
        workspaceId: 'workspace-shared',
        label: 'Pairing',
        threadAccess: 'control',
        workspaceAccess: 'write',
      },
    ]);
  });
});
