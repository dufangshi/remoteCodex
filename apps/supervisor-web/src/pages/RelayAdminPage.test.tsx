import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RelayAdminPage } from './RelayAdminPage';

const adminSummary = {
  users: [
    {
      id: 'user-1',
      email: 'owner@example.test',
      username: 'owner',
      role: 'user' as const,
      enabled: true,
      createdAt: '2026-06-18T00:00:00.000Z',
      lastSeenAt: '2026-06-18T00:10:00.000Z',
      deviceCount: 1,
      conversationCount: 4,
    },
  ],
  devices: [
    {
      id: 'device-1',
      ownerUserId: 'user-1',
      ownerUsername: 'owner',
      ownerEmail: 'owner@example.test',
      name: 'Owner Mac',
      token: null,
      tokenPreview: 'rcd_see...last',
      connected: true,
      connectedAt: '2026-06-18T00:00:00.000Z',
      lastHeartbeatAt: '2026-06-18T00:11:00.000Z',
      createdAt: '2026-06-18T00:00:00.000Z',
      ipAddress: '203.0.113.10',
      workspaces: [
        {
          id: 'workspace-1',
          label: 'remoteCodex',
          absPath: '/Users/mac/dev/remoteCodex',
        },
      ],
      threads: [
        {
          id: 'thread-1',
          title: 'Fix relay admin',
          workspaceId: 'workspace-1',
          workspaceLabel: 'remoteCodex',
          status: 'idle',
          updatedAt: '2026-06-18T00:09:00.000Z',
        },
      ],
    },
  ],
  shares: [
    {
      id: 'share-1',
      ownerUserId: 'user-1',
      ownerUsername: 'owner',
      targetUsername: 'friend',
      targetUserId: 'user-2',
      deviceId: 'device-1',
      deviceName: 'Owner Mac',
      threadId: 'thread-1',
      threadTitle: 'Fix relay admin',
      workspaceId: 'workspace-1',
      workspaceLabel: 'remoteCodex',
      label: null,
      threadAccess: 'read' as const,
      workspaceAccess: 'read' as const,
      createdAt: '2026-06-18T00:00:00.000Z',
      revokedAt: null,
      expiresAt: null,
      lastAccessedAt: '2026-06-18T00:12:00.000Z',
      lastAccessedByUsername: 'friend',
      accessEvents: [],
    },
  ],
  pendingRegistrations: [
    {
      id: 'pending-1',
      email: 'pending@example.test',
      username: 'pending',
      createdAt: '2026-06-18T00:13:00.000Z',
    },
  ],
  settings: {
    enabled: true,
    registrationPassword: 'invite-password-123',
    approvalRequired: true,
  },
  conversationWindowDays: 7,
  registrationEnabled: true,
};

function renderPage() {
  render(
    <MemoryRouter initialEntries={['/relay-admin']}>
      <Routes>
        <Route path="/relay-admin" element={<RelayAdminPage />} />
        <Route path="/relay-portal" element={<div>Portal</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('RelayAdminPage', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.startsWith('/relay/admin') && init?.method !== 'PATCH') {
          return Promise.resolve({
            ok: true,
            json: async () => adminSummary,
          });
        }
        if (url === '/relay/admin/settings/registration' && init?.method === 'PATCH') {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              registrationEnabled: false,
              settings: {
                enabled: false,
                registrationPassword: 'new-password-123',
                approvalRequired: false,
              },
            }),
          });
        }
        if (url === '/relay/admin/registrations/pending-1/approve') {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              id: 'user-3',
              email: 'pending@example.test',
              username: 'pending',
              role: 'user',
              enabled: true,
              createdAt: '2026-06-18T00:14:00.000Z',
            }),
          });
        }
        return Promise.resolve({
          ok: false,
          status: 404,
          json: async () => ({ code: 'not_found', message: `Unhandled test URL: ${url}` }),
        });
      }),
    );
  });

  it('shows relay admin users, devices, shares, and registration settings', async () => {
    renderPage();

    expect(await screen.findByText('Operations panel')).toBeInTheDocument();
    expect(screen.getAllByText('owner@example.test').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Devices' }));
    expect(screen.getByText('Owner Mac')).toBeInTheDocument();
    expect(screen.getByText('203.0.113.10')).toBeInTheDocument();
    expect(screen.getByText('remoteCodex')).toBeInTheDocument();
    expect(screen.getByText('Fix relay admin')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Shares' }));
    expect(screen.getByText('friend')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByDisplayValue('invite-password-123')).toBeInTheDocument();
    expect(screen.getByText(/pending@example.test/)).toBeInTheDocument();
  });

  it('saves registration settings', async () => {
    renderPage();
    await screen.findByText('Operations panel');

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.click(screen.getByLabelText('Open registration'));
    fireEvent.change(screen.getByLabelText('Registration password'), {
      target: { value: 'new-password-123' },
    });
    fireEvent.click(screen.getByLabelText('Require admin approval'));
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/relay/admin/settings/registration',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({
            enabled: false,
            registrationPassword: 'new-password-123',
            approvalRequired: false,
          }),
        }),
      );
    });
  });

  it('allows admin login without replacing the normal relay account token', async () => {
    window.localStorage.setItem('remote-codex-relay-token', 'normal-token');
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const headers = new Headers(init?.headers);
        if (url.startsWith('/relay/admin') && headers.get('Authorization') !== 'Bearer admin-token') {
          return Promise.resolve({
            ok: false,
            status: 403,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({
              code: 'forbidden',
              message: 'Admin access is required.',
            }),
          });
        }
        if (url === '/relay/auth/login') {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              token: 'admin-token',
              session: {
                authenticated: true,
                user: {
                  id: 'admin-user',
                  username: 'admin',
                  email: 'admin@example.test',
                  role: 'admin',
                  enabled: true,
                  createdAt: '2026-07-04T00:00:00.000Z',
                },
                registrationEnabled: true,
              },
            }),
          });
        }
        if (url.startsWith('/relay/admin')) {
          return Promise.resolve({
            ok: true,
            json: async () => adminSummary,
          });
        }
        return Promise.resolve({
          ok: false,
          status: 404,
          json: async () => ({ code: 'not_found', message: `Unhandled test URL: ${url}` }),
        });
      }),
    );

    renderPage();

    expect(await screen.findByText('Use the relay admin credentials for this server. This does not replace your normal relay account.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Username'), {
      target: { value: 'admin' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'secret' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Operations panel')).toBeInTheDocument();
    expect(window.localStorage.getItem('remote-codex-relay-token')).toBe('normal-token');
    expect(window.localStorage.getItem('remote-codex-relay-admin-token')).toBe('admin-token');
  });
});
