import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RelayPortalPage } from './RelayPortalPage';

const relayUser = {
  id: 'user-1',
  email: 'user@example.test',
  username: 'user',
  role: 'user' as const,
  enabled: true,
  createdAt: '2026-06-18T00:00:00.000Z',
};

describe('RelayPortalPage', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);

        if (url === '/relay/auth/session') {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              authenticated: true,
              user: relayUser,
              registrationEnabled: true,
            }),
          } satisfies Partial<Response>);
        }

        if (url === '/relay/portal') {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              user: relayUser,
              devices: [
                {
                  id: 'device-1',
                  ownerUserId: relayUser.id,
                  name: 'Studio Mac',
                  token: 'rcd_test_device_token',
                  tokenPreview: 'rcd_test...oken',
                  connected: true,
                  connectedAt: '2026-06-18T00:00:00.000Z',
                  lastHeartbeatAt: '2026-06-18T00:01:00.000Z',
                  createdAt: '2026-06-18T00:00:00.000Z',
              },
            ],
              sharedWithMe: [],
              sharedByMe: [
                {
                  id: 'share-1',
                  ownerUserId: relayUser.id,
                  ownerUsername: relayUser.username,
                  targetUsername: 'friend',
                  targetUserId: 'user-2',
                  deviceId: 'device-1',
                  deviceName: 'Studio Mac',
                  threadId: 'thread-1',
                  threadTitle: 'Fix embeddings',
                  workspaceId: 'workspace-1',
                  workspaceLabel: 'TaskMark',
                  label: null,
                  threadAccess: 'control',
                  workspaceAccess: 'write',
                  createdAt: '2026-06-18T00:00:00.000Z',
                  revokedAt: null,
                  expiresAt: null,
                  lastAccessedAt: '2026-06-18T00:05:00.000Z',
                  lastAccessedByUsername: 'friend',
                  accessEvents: [
                    {
                      id: 'access-1',
                      shareId: 'share-1',
                      userId: 'user-2',
                      username: 'friend',
                      accessedAt: '2026-06-18T00:05:00.000Z',
                    },
                  ],
                },
              ],
            }),
          } satisfies Partial<Response>);
        }

        if (url === '/relay/shares/share-1') {
          return Promise.resolve({
            ok: true,
            json: async () => ({ id: 'share-1' }),
          } satisfies Partial<Response>);
        }

        return Promise.resolve({
          ok: false,
          status: 404,
          json: async () => ({
            code: 'not_found',
            message: `Unhandled test URL: ${url}`,
          }),
        } satisfies Partial<Response>);
      }),
    );
  });

  it('connects an online device through a device-scoped workspace route', async () => {
    render(
      <MemoryRouter initialEntries={['/relay-portal']}>
        <Routes>
          <Route path="/relay-portal" element={<RelayPortalPage />} />
          <Route
            path="/devices/:relayDeviceId/workspaces"
            element={<div>Device scoped workspaces</div>}
          />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Connect' }));

    await waitFor(() => {
      expect(screen.getByText('Device scoped workspaces')).toBeInTheDocument();
    });
    expect(window.localStorage.getItem('remote-codex-relay-device-id')).toBe('device-1');
  });

  it('removes portal invite creation and shows detailed outgoing shares', async () => {
    render(
      <MemoryRouter initialEntries={['/relay-portal']}>
        <Routes>
          <Route path="/relay-portal" element={<RelayPortalPage />} />
          <Route path="/devices/:relayDeviceId/threads/:threadId" element={<div>Shared thread</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Shared By Me')).toBeInTheDocument();
    expect(screen.queryByText('Invite')).not.toBeInTheDocument();
    expect(screen.getAllByText('Fix embeddings').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Workspace:/).textContent).toContain('TaskMark');
    expect(screen.getByText(/Last access:/).textContent).toContain('friend');
    expect(screen.getByText('Collaborator')).toBeInTheDocument();
    expect(screen.getByText('Workspace write')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Access' }));
    expect(screen.getByText('2026-06-18T00:05:00.000Z')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    await waitFor(() => {
      expect(screen.getByText('Shared thread')).toBeInTheDocument();
    });
  });
});
