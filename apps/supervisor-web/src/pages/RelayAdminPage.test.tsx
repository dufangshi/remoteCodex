import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RelayAdminPage } from './RelayAdminPage';

const adminSummary = {
  users: [
    {
      id: 'admin-user',
      email: 'admin@example.test',
      username: 'admin',
      role: 'admin' as const,
      enabled: true,
      createdAt: '2026-06-17T00:00:00.000Z',
      lastSeenAt: '2026-06-18T00:20:00.000Z',
      deviceCount: 0,
      conversationCount: 0,
    },
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
    {
      id: 'user-2',
      email: 'quiet@example.test',
      username: 'quiet',
      role: 'user' as const,
      enabled: false,
      createdAt: '2026-06-16T00:00:00.000Z',
      lastSeenAt: null,
      deviceCount: 0,
      conversationCount: 1,
    },
    {
      id: 'user-3',
      email: 'member@example.test',
      username: 'member',
      role: 'user' as const,
      enabled: true,
      createdAt: '2026-06-16T00:00:00.000Z',
      lastSeenAt: null,
      deviceCount: 0,
      conversationCount: 0,
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
        if (
          url === '/relay/admin/settings/registration' &&
          init?.method === 'PATCH'
        ) {
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
        if (
          url === '/relay/admin/users/user-1/reset-password' &&
          init?.method === 'POST'
        ) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              id: 'user-1',
              email: 'owner@example.test',
              username: 'owner',
              role: 'user',
              enabled: true,
              createdAt: '2026-06-18T00:00:00.000Z',
            }),
          });
        }
        if (url === '/relay/admin/users/user-1' && init?.method === 'DELETE') {
          return Promise.resolve({
            ok: true,
            json: async () => ({ id: 'user-1' }),
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

  it('shows hosted capability, lifecycle state, and creates without echoing the API key', async () => {
    const hostedSandbox = {
      id: '11111111-1111-4111-8111-111111111111',
      deviceId: '22222222-2222-4222-8222-222222222222',
      deviceName: 'Hosted Codex',
      assignedUserId: 'user-1',
      assignedUsername: 'owner',
      assignedUsers: [
        {
          userId: 'user-1',
          username: 'owner',
          email: 'owner@example.test',
        },
      ],
      createdByAdminUserId: 'admin-user',
      provider: 'incus' as const,
      providerInstanceId: 'rcd-11111111-1111-4111-8111-111111111111',
      imageVersion: 'ubuntu-24.04-v2',
      resources: { cpuCount: 1, memoryMiB: 1536, diskGiB: 10 },
      status: 'online' as const,
      lastErrorCode: null,
      lastErrorMessage: null,
      activeTurnCount: 1,
      lastUserActivityAt: '2026-06-18T00:15:00.000Z',
      idleDeadlineAt: null,
      createdAt: '2026-06-18T00:00:00.000Z',
      updatedAt: '2026-06-18T00:15:00.000Z',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/relay/admin' || url.startsWith('/relay/admin?')) {
          return Promise.resolve({ ok: true, json: async () => adminSummary });
        }
        if (url === '/relay/admin/hosted-sandboxes/capability') {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              provider: 'incus',
              configured: true,
              reachable: true,
              available: true,
              reasonCode: null,
              reason: null,
              checkedAt: '2026-06-18T00:15:00.000Z',
              limits: { maxInstances: 4, maxRunningInstances: 1 },
              capacity: { totalInstances: 2, runningInstances: 1 },
              metrics: {
                cpuCount: 8,
                load1: 1.2,
                loadPerCpu: 0.15,
                memoryTotalMiB: 16384,
                memoryAvailableMiB: 8192,
                diskTotalGiB: 100,
                diskAvailableGiB: 50,
                monitorPath: '/var/lib/incus',
              },
              alerts: [
                {
                  code: 'host_disk_low',
                  severity: 'warning',
                  message: 'Host available disk is below 60 GiB.',
                },
              ],
            }),
          });
        }
        if (
          url === '/relay/admin/hosted-sandboxes/reconciliation/run' ||
          url ===
            '/relay/admin/hosted-sandboxes/reconciliation/orphan-instances/33333333-3333-4333-8333-333333333333'
        ) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              status: 'healthy',
              checkedAt: '2026-06-18T00:16:00.000Z',
              errorCode: null,
              missingInstanceSandboxIds: [],
              missingCredentialSandboxIds: [],
              orphanInstances: [],
              orphanCredentials: [],
              orphanSnapshotCount: 0,
            }),
          });
        }
        if (url === '/relay/admin/hosted-sandboxes/reconciliation') {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              status: 'issues',
              checkedAt: '2026-06-18T00:15:00.000Z',
              errorCode: null,
              missingInstanceSandboxIds: [],
              missingCredentialSandboxIds: [],
              orphanInstances: [
                {
                  id: '33333333-3333-4333-8333-333333333333',
                  status: 'Stopped',
                  snapshots: ['idle-stop'],
                },
              ],
              orphanCredentials: [],
              orphanSnapshotCount: 1,
            }),
          });
        }
        if (
          url === '/relay/admin/hosted-sandboxes' &&
          init?.method === 'POST'
        ) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              sandbox: hostedSandbox,
              operation: { id: 'operation-1' },
            }),
          });
        }
        if (
          url ===
            '/relay/admin/hosted-sandboxes/11111111-1111-4111-8111-111111111111/members' &&
          init?.method === 'PUT'
        ) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              ...hostedSandbox,
              assignedUsers: [
                ...hostedSandbox.assignedUsers,
                {
                  userId: 'user-3',
                  username: 'member',
                  email: 'member@example.test',
                },
              ],
            }),
          });
        }
        if (url === '/relay/admin/hosted-sandboxes') {
          return Promise.resolve({
            ok: true,
            json: async () => ({ sandboxes: [hostedSandbox] }),
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

    renderPage();
    await screen.findByText('Operations panel');
    fireEvent.click(screen.getByRole('button', { name: 'Hosted VMs' }));
    expect(await screen.findByText('Available')).toBeInTheDocument();
    expect(screen.getByText(/1\/1 running.*2\/4 total/)).toBeInTheDocument();
    expect(
      screen.getByText(
        '8 CPU · load 1.20 · 8 GiB RAM free · 50.0 GiB disk free',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Host available disk is below 60 GiB.'),
    ).toBeInTheDocument();
    expect(screen.getByText('1 active turn')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeDisabled();
    expect(screen.getByText('1 inventory issue')).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Run inventory audit' }),
    );
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/relay/admin/hosted-sandboxes/reconciliation/run',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete orphan VM' }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/relay/admin/hosted-sandboxes/reconciliation/orphan-instances/33333333-3333-4333-8333-333333333333',
        expect.objectContaining({ method: 'DELETE' }),
      ),
    );

    fireEvent.change(screen.getByLabelText('OpenAI Platform API key'), {
      target: { value: 'sk-test-not-a-real-secret-123456789' },
    });
    fireEvent.click(screen.getByLabelText('Assign owner (owner@example.test)'));
    fireEvent.click(
      screen.getByLabelText('Assign member (member@example.test)'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Create hosted VM' }));
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/relay/admin/hosted-sandboxes',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('sk-test-not-a-real-secret-123456789'),
        }),
      );
    });
    expect(fetch).toHaveBeenCalledWith(
      '/relay/admin/hosted-sandboxes',
      expect.objectContaining({
        body: expect.stringContaining('https://sub.lnz-study.com'),
      }),
    );
    expect(fetch).toHaveBeenCalledWith(
      '/relay/admin/hosted-sandboxes',
      expect.objectContaining({
        body: expect.stringContaining('"assignedUserIds":["user-1","user-3"]'),
      }),
    );
    expect(
      screen.queryByDisplayValue('sk-test-not-a-real-secret-123456789'),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Access · 1 user'));
    fireEvent.click(
      screen.getByLabelText('Grant member (member@example.test) access'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save access' }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/relay/admin/hosted-sandboxes/11111111-1111-4111-8111-111111111111/members',
        expect.objectContaining({
          method: 'PUT',
          body: '{"assignedUserIds":["user-1","user-3"]}',
        }),
      ),
    );
  });

  it('degrades only the hosted creation surface when Incus is disabled', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/relay/admin' || url.startsWith('/relay/admin?')) {
          return Promise.resolve({ ok: true, json: async () => adminSummary });
        }
        if (url === '/relay/admin/hosted-sandboxes/capability') {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              provider: 'disabled',
              configured: false,
              reachable: false,
              available: false,
              reasonCode: 'hosted_sandbox_disabled',
              reason: 'Hosted supervisor VMs are not configured on this relay.',
              checkedAt: '2026-06-18T00:15:00.000Z',
            }),
          });
        }
        if (url === '/relay/admin/hosted-sandboxes') {
          return Promise.resolve({
            ok: true,
            json: async () => ({ sandboxes: [] }),
          });
        }
        if (url === '/relay/admin/hosted-sandboxes/reconciliation') {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              status: 'never_run',
              checkedAt: null,
              errorCode: null,
              missingInstanceSandboxIds: [],
              missingCredentialSandboxIds: [],
              orphanInstances: [],
              orphanCredentials: [],
              orphanSnapshotCount: 0,
            }),
          });
        }
        return Promise.resolve({
          ok: false,
          status: 404,
          json: async () => ({}),
        });
      }),
    );
    renderPage();
    await screen.findByText('Operations panel');
    fireEvent.click(screen.getByRole('button', { name: 'Hosted VMs' }));
    expect(await screen.findByText('Disabled')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Create hosted VM' }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Users' }));
    expect(screen.getByText('owner@example.test')).toBeInTheDocument();
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

  it('filters users and performs reset/delete actions for ordinary users', async () => {
    renderPage();
    await screen.findByText('Operations panel');

    fireEvent.click(screen.getByRole('button', { name: 'Users' }));
    fireEvent.change(screen.getByPlaceholderText('Search username or email'), {
      target: { value: 'owner' },
    });

    expect(screen.getByText('owner@example.test')).toBeInTheDocument();
    expect(screen.queryByText('quiet@example.test')).not.toBeInTheDocument();

    const ownerRow = screen.getByText('owner@example.test').closest('tr');
    expect(ownerRow).not.toBeNull();
    fireEvent.click(within(ownerRow!).getByRole('button', { name: /Reset/ }));
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'new-password-123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save password' }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/relay/admin/users/user-1/reset-password',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ password: 'new-password-123' }),
        }),
      );
    });

    fireEvent.click(within(ownerRow!).getByRole('button', { name: /Delete/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete user' }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/relay/admin/users/user-1',
        expect.objectContaining({
          method: 'DELETE',
        }),
      );
    });
  });

  it('filters devices by owner, status, and activity window', async () => {
    renderPage();
    await screen.findByText('Operations panel');

    fireEvent.click(screen.getByRole('button', { name: 'Devices' }));
    expect(screen.getByText('Owner Mac')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Owner'), {
      target: { value: 'user-2' },
    });
    expect(screen.queryByText('Owner Mac')).not.toBeInTheDocument();
    expect(
      screen.getByText('No devices match the selected filters.'),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Owner'), {
      target: { value: 'all' },
    });
    fireEvent.change(screen.getByLabelText('Status'), {
      target: { value: 'online' },
    });
    expect(screen.getByText('Owner Mac')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Last activity'), {
      target: { value: '24h' },
    });
    expect(screen.queryByText('Owner Mac')).not.toBeInTheDocument();
  });

  it('allows admin login without replacing the normal relay account token', async () => {
    window.localStorage.setItem('remote-codex-relay-token', 'normal-token');
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const headers = new Headers(init?.headers);
        if (
          url.startsWith('/relay/admin') &&
          headers.get('Authorization') !== 'Bearer admin-token'
        ) {
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
          json: async () => ({
            code: 'not_found',
            message: `Unhandled test URL: ${url}`,
          }),
        });
      }),
    );

    renderPage();

    expect(
      await screen.findByText(
        'Use the relay admin credentials for this server. This does not replace your normal relay account.',
      ),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Username'), {
      target: { value: 'admin' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'secret' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Operations panel')).toBeInTheDocument();
    expect(window.localStorage.getItem('remote-codex-relay-token')).toBe(
      'normal-token',
    );
    expect(window.localStorage.getItem('remote-codex-relay-admin-token')).toBe(
      'admin-token',
    );
  });
});
