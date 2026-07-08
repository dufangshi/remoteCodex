import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  RelayAccessGrantDto,
  RelayPortalSummaryDto,
  RelaySessionShareDto,
} from '@remote-codex/shared';
import {
  RelayDevicesPage,
  mergeRelayPortalSummary,
} from './RelayDevicesPage';

const baseUser = {
  id: 'user-1',
  email: 'user@example.test',
  username: 'user',
  role: 'user' as const,
  enabled: true,
  createdAt: '2026-06-18T00:00:00.000Z',
};

function device(input: { id: string; name: string; connected?: boolean; token?: string | null }) {
  return {
    id: input.id,
    ownerUserId: 'user-1',
    name: input.name,
    token: input.token ?? null,
    tokenPreview: 'rcd_see...last',
    connected: input.connected ?? false,
    connectedAt: input.connected ? '2026-06-18T00:00:00.000Z' : null,
    lastHeartbeatAt: input.connected ? '2026-06-18T00:00:00.000Z' : null,
    createdAt: '2026-06-18T00:00:00.000Z',
  };
}

const sharedSession: RelaySessionShareDto = {
  id: 'share-1',
  ownerUserId: 'owner-1',
  ownerUsername: 'owner',
  targetUsername: 'user',
  targetUserId: 'user-1',
  deviceId: 'device-shared',
  deviceName: 'Owner Mac',
  threadId: 'thread-shared',
  threadTitle: 'Investigate relay setup',
  workspaceId: null,
  workspaceLabel: null,
  label: 'Review session',
  threadAccess: 'read' as const,
  workspaceAccess: 'none' as const,
  createdAt: '2026-06-18T00:00:00.000Z',
  revokedAt: null,
  expiresAt: null,
  lastAccessedAt: null,
  lastAccessedByUsername: null,
  accessEvents: [],
};

const sharedDeviceGrant: RelayAccessGrantDto = {
  id: 'grant-device-1',
  ownerUserId: 'owner-1',
  ownerUsername: 'owner',
  targetUserId: 'user-1',
  targetUsername: 'user',
  deviceId: 'device-shared',
  deviceName: 'Owner Mac',
  scope: 'device',
  threadId: null,
  threadTitle: null,
  workspaceId: null,
  workspaceLabel: null,
  workspaceScope: 'all',
  workspaceIds: [],
  label: null,
  threadAccess: 'control',
  workspaceAccess: 'write',
  canCreateThreads: true,
  createdAt: '2026-06-18T00:00:00.000Z',
  revokedAt: null,
  expiresAt: null,
  lastAccessedAt: null,
  lastAccessedByUsername: null,
  accessEvents: [],
};

function renderPage(
  devices: ReturnType<typeof device>[],
  sharedWithMe: Array<typeof sharedSession> = [],
  sharedByMe: Array<typeof sharedSession> = [],
  grants: {
    sharedDevicesWithMe?: RelayAccessGrantDto[];
    sharedThreadsWithMe?: RelayAccessGrantDto[];
    grantsByMe?: RelayAccessGrantDto[];
  } = {},
) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/relay/portal') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            user: baseUser,
            devices,
            sharedWithMe,
            sharedByMe,
            sharedDevicesWithMe: grants.sharedDevicesWithMe ?? [],
            sharedThreadsWithMe: grants.sharedThreadsWithMe ?? [],
            grantsByMe: grants.grantsByMe,
          }),
        });
      }
      if (url === '/relay/grants' && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            ...sharedDeviceGrant,
            id: 'grant-created',
            ownerUserId: 'user-1',
            ownerUsername: 'user',
            targetUserId: 'friend-1',
            targetUsername: 'friend',
            deviceId: 'device-1',
            deviceName: 'MacBook Pro',
            label: 'Office server',
          }),
        });
      }
      if (url === '/relay/grants/grant-device-1' && init?.method === 'PATCH') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            ...sharedDeviceGrant,
            label: 'Updated device access',
            threadAccess: 'read',
            workspaceAccess: 'read',
          }),
        });
      }
      if (url === '/relay/grants/grant-device-1' && init?.method === 'DELETE') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ ...sharedDeviceGrant, revokedAt: '2026-06-18T00:05:00.000Z' }),
        });
      }
      if (url === '/relay/shares/share-1' && init?.method === 'PATCH') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            ...sharedSession,
            label: 'Review session updated',
            threadAccess: 'control',
            workspaceAccess: 'read',
          }),
        });
      }
      if (url === '/relay/shares/share-1' && init?.method === 'DELETE') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ ...sharedSession, revokedAt: '2026-06-18T00:05:00.000Z' }),
        });
      }

      return Promise.resolve({
        ok: false,
        status: 404,
        json: async () => ({
          code: 'not_found',
          message: `Unhandled test URL: ${url}`,
        }),
      });
    }),
  );

  render(
    <MemoryRouter initialEntries={['/relay-devices']}>
      <Routes>
        <Route path="/relay-devices" element={<RelayDevicesPage />} />
        <Route path="/workspaces" element={<div>Workspaces</div>} />
        <Route
          path="/devices/:relayDeviceId/threads/:threadId"
          element={<div>Shared thread</div>}
        />
        <Route
          path="/devices/:relayDeviceId/workspaces"
          element={<div>Shared device workspaces</div>}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('RelayDevicesPage', () => {
  beforeEach(() => {
    window.localStorage.clear();
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: vi.fn(() => Promise.resolve()),
      },
      configurable: true,
    });
  });

  it('copies a real supervisor command when the relay returns the device token', async () => {
    renderPage([device({ id: 'device-1', name: 'MacBook Pro', token: 'rcd_real_device_token' })]);

    await screen.findByText('MacBook Pro');

    fireEvent.click(screen.getByRole('button', { name: 'Copy setup' }));

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        expect.stringContaining('REMOTE_CODEX_RELAY_AGENT_TOKEN=rcd_real_device_token'),
      );
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining('REMOTE_CODEX_RELAY_SUPERVISOR_PORT=45679'),
    );
    expect(navigator.clipboard.writeText).not.toHaveBeenCalledWith(
      expect.stringContaining('<device-token>'),
    );
  });

  it('uses the newly created relay-stored device token for later setup copies', async () => {
    const devices: ReturnType<typeof device>[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/relay/portal') {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              user: baseUser,
              devices,
              sharedWithMe: [],
              sharedByMe: [],
            }),
          });
        }
        if (url === '/relay/devices' && init?.method === 'POST') {
          const created = device({
            id: 'device-created',
            name: 'Studio Mac',
            token: 'rcd_created_device_token',
          });
          devices.push(created);
          return Promise.resolve({
            ok: true,
            json: async () => ({
              device: created,
              token: 'rcd_created_device_token',
            }),
          });
        }

        return Promise.resolve({
          ok: false,
          status: 404,
          json: async () => ({
            code: 'not_found',
            message: `Unhandled test URL: ${url}`,
          }),
        });
      }),
    );

    render(
      <MemoryRouter initialEntries={['/relay-devices']}>
        <Routes>
          <Route path="/relay-devices" element={<RelayDevicesPage />} />
          <Route path="/workspaces" element={<div>Workspaces</div>} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Add' }));
    fireEvent.change(screen.getByLabelText('Device name'), {
      target: { value: 'Studio Mac' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create device token' }));

    await screen.findByText('Token created for Studio Mac');
    fireEvent.click(screen.getByRole('button', { name: 'Copy setup' }));

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        expect.stringContaining('REMOTE_CODEX_RELAY_AGENT_TOKEN=rcd_created_device_token'),
      );
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining('REMOTE_CODEX_RELAY_SUPERVISOR_PORT=45679'),
    );
  });

  it('does not copy a placeholder command when a legacy device has no stored token', async () => {
    renderPage([device({ id: 'device-1', name: 'MacBook Pro' })]);

    await screen.findByText('MacBook Pro');

    expect(screen.getByRole('button', { name: 'Copy setup' })).toBeDisabled();
    expect(
      screen.getByText('Token not available for this device. Create a new device token to copy a ready-to-run setup command.'),
    ).toBeInTheDocument();
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
  });

  it('opens a session shared with the current relay account', async () => {
    renderPage([], [sharedSession]);

    expect(await screen.findAllByText('Investigate relay setup')).not.toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Open' }));

    await waitFor(() => {
      expect(screen.getByText('Shared thread')).toBeInTheDocument();
    });
    expect(window.localStorage.getItem('remote-codex-relay-device-id')).toBe('device-shared');
    expect(window.localStorage.getItem('remote-codex-relay-thread-id')).toBe('thread-shared');
  });

  it('opens a device shared with the current relay account', async () => {
    renderPage([], [], [], { sharedDevicesWithMe: [sharedDeviceGrant] });

    const deviceTitle = await screen.findByText('Owner Mac');
    const deviceCard = deviceTitle.closest('article');
    expect(deviceCard).not.toBeNull();

    fireEvent.click(within(deviceCard as HTMLElement).getByRole('button', { name: 'Open' }));

    await screen.findByText('Shared device workspaces');
    expect(window.localStorage.getItem('remote-codex-relay-device-id')).toBe('device-shared');
    expect(window.localStorage.getItem('remote-codex-relay-thread-id')).toBeNull();
  });

  it('creates device-level grants from an owned relay device', async () => {
    renderPage([device({ id: 'device-1', name: 'MacBook Pro', connected: true, token: 'rcd_real_device_token' })]);

    await screen.findByText('MacBook Pro');
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    fireEvent.change(screen.getByLabelText('Relay account'), {
      target: { value: 'friend@example.test' },
    });
    fireEvent.change(screen.getByLabelText('Label'), {
      target: { value: 'Office server' },
    });
    fireEvent.change(screen.getByLabelText('Thread access'), {
      target: { value: 'control' },
    });
    fireEvent.change(screen.getByLabelText('Workspace access'), {
      target: { value: 'write' },
    });
    fireEvent.click(screen.getByLabelText('Can create new threads'));
    fireEvent.click(screen.getByRole('button', { name: 'Share device' }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/relay/grants',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            targetIdentifier: 'friend@example.test',
            label: 'Office server',
            threadAccess: 'control',
            workspaceAccess: 'write',
            canCreateThreads: true,
            deviceId: 'device-1',
            scope: 'device',
            workspaceScope: 'all',
            workspaceIds: [],
          }),
        }),
      );
    });
  });

  it('manages sessions shared by the current relay account', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage([], [], [
      {
        ...sharedSession,
        ownerUserId: 'user-1',
        ownerUsername: 'user',
        targetUserId: 'friend-1',
        targetUsername: 'friend',
        workspaceId: 'workspace-1',
        workspaceLabel: 'remoteCodex',
        workspaceAccess: 'read',
      },
    ]);

    expect(await screen.findAllByText('Investigate relay setup')).not.toHaveLength(0);
    expect(screen.getByText('Workspace:')).toBeInTheDocument();
    expect(screen.getByText('remoteCodex')).toBeInTheDocument();
    expect(screen.getByText('Thread:')).toBeInTheDocument();
    expect(screen.getByText('To friend')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Permissions' }));
    fireEvent.change(screen.getByLabelText('Thread access'), {
      target: { value: 'control' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save permissions' }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/relay/shares/share-1',
        expect.objectContaining({
          method: 'PATCH',
        }),
      );
    });

    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/relay/shares/share-1',
        expect.objectContaining({
          method: 'DELETE',
        }),
      );
    });
  });

  it('does not expose raw thread ids when shared thread metadata is unavailable', async () => {
    renderPage([], [], [
      {
        ...sharedSession,
        ownerUserId: 'user-1',
        ownerUsername: 'user',
        targetUserId: 'friend-1',
        targetUsername: 'friend',
        threadId: 'thread-raw-id-only',
        threadTitle: null,
        workspaceId: 'workspace-1',
        workspaceLabel: null,
        label: null,
      },
    ]);

    expect(await screen.findAllByText('Thread unavailable')).not.toHaveLength(0);
    expect(screen.getByText('Workspace unavailable')).toBeInTheDocument();
    expect(screen.queryByText('thread-raw-id-only')).not.toBeInTheDocument();
  });

  it('does not use the custom share label as the thread title', async () => {
    renderPage([], [], [
      {
        ...sharedSession,
        ownerUserId: 'user-1',
        ownerUsername: 'user',
        targetUserId: 'friend-1',
        targetUsername: 'friend',
        threadTitle: null,
        label: 'Pairing note',
      },
    ]);

    expect(await screen.findAllByText('Thread unavailable')).not.toHaveLength(0);
    expect(screen.getByText('Label:')).toBeInTheDocument();
    expect(screen.getByText('Pairing note')).toBeInTheDocument();
  });

  it('does not use a stale custom share label stored as the thread title', async () => {
    renderPage([], [], [
      {
        ...sharedSession,
        ownerUserId: 'user-1',
        ownerUsername: 'user',
        targetUserId: 'friend-1',
        targetUsername: 'friend',
        threadTitle: 'feiji',
        label: 'feiji',
      },
    ]);

    expect(await screen.findAllByText('Thread unavailable')).not.toHaveLength(0);
    expect(screen.getByText('Label:')).toBeInTheDocument();
    expect(screen.getByText('feiji')).toBeInTheDocument();
  });

  it('keeps resolved shared thread metadata when a refresh omits it', () => {
    const previousShare: RelaySessionShareDto = {
      ...sharedSession,
      threadTitle: 'solido',
      workspaceLabel: 'el-agente-cloud-infrastructure',
      label: 'feiji',
    };
    const previous: RelayPortalSummaryDto = {
      user: baseUser,
      devices: [],
      sharedWithMe: [],
      sharedByMe: [previousShare],
    };
    const next: RelayPortalSummaryDto = {
      ...previous,
      sharedByMe: [
        {
          ...previousShare,
          threadTitle: 'feiji',
          workspaceLabel: null,
          label: 'feiji',
          lastAccessedAt: '2026-07-06T16:00:00.000Z',
        },
      ],
    };

    expect(mergeRelayPortalSummary(previous, next).sharedByMe[0]).toMatchObject({
      threadTitle: 'solido',
      workspaceLabel: 'el-agente-cloud-infrastructure',
      label: 'feiji',
      lastAccessedAt: '2026-07-06T16:00:00.000Z',
    });
  });

  it('opens a session shared by the current relay account', async () => {
    renderPage([], [], [
      {
        ...sharedSession,
        ownerUserId: 'user-1',
        ownerUsername: 'user',
        targetUserId: 'friend-1',
        targetUsername: 'friend',
        workspaceId: 'workspace-1',
        workspaceLabel: 'remoteCodex',
        workspaceAccess: 'read',
      },
    ]);

    expect(await screen.findAllByText('Investigate relay setup')).not.toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));

    await screen.findByText('Shared thread');
    expect(window.localStorage.getItem('remote-codex-relay-device-id')).toBe('device-shared');
    expect(window.localStorage.getItem('remote-codex-relay-thread-id')).toBe('thread-shared');
  });
});
