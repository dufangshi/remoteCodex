import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RelaySessionShareDto } from '@remote-codex/shared';
import { RelayDevicesPage } from './RelayDevicesPage';

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
  workspaceId: null,
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

function renderPage(
  devices: ReturnType<typeof device>[],
  sharedWithMe: Array<typeof sharedSession> = [],
  sharedByMe: Array<typeof sharedSession> = [],
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
          }),
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

    fireEvent.change(await screen.findByLabelText('Device name'), {
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

    await screen.findByText('Review session');

    fireEvent.click(screen.getByRole('button', { name: 'Open' }));

    await waitFor(() => {
      expect(screen.getByText('Shared thread')).toBeInTheDocument();
    });
    expect(window.localStorage.getItem('remote-codex-relay-device-id')).toBe('device-shared');
    expect(window.localStorage.getItem('remote-codex-relay-thread-id')).toBe('thread-shared');
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
        workspaceAccess: 'read',
      },
    ]);

    await screen.findByText('Review session');
    expect(screen.getByText('Thread:')).toBeInTheDocument();
    expect(screen.getByText('thread-shared')).toBeInTheDocument();
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
});
