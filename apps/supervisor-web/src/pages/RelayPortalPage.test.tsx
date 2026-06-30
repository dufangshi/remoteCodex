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
              sharedByMe: [],
            }),
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
});
