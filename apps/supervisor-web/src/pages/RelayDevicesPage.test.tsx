import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { storeRelayDeviceToken } from '../lib/api';
import { RelayDevicesPage } from './RelayDevicesPage';

const baseUser = {
  id: 'user-1',
  email: 'user@example.test',
  username: 'user',
  role: 'user' as const,
  enabled: true,
  createdAt: '2026-06-18T00:00:00.000Z',
};

function device(input: { id: string; name: string; connected?: boolean }) {
  return {
    id: input.id,
    ownerUserId: 'user-1',
    name: input.name,
    tokenPreview: 'rcd_see...last',
    connected: input.connected ?? false,
    connectedAt: input.connected ? '2026-06-18T00:00:00.000Z' : null,
    lastHeartbeatAt: input.connected ? '2026-06-18T00:00:00.000Z' : null,
    createdAt: '2026-06-18T00:00:00.000Z',
  };
}

function renderPage(devices: ReturnType<typeof device>[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
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

  it('copies a real supervisor command when the device token is cached locally', async () => {
    storeRelayDeviceToken('device-1', 'rcd_real_device_token');
    renderPage([device({ id: 'device-1', name: 'MacBook Pro' })]);

    await screen.findByText('MacBook Pro');

    fireEvent.click(screen.getByRole('button', { name: 'Copy setup' }));

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        expect.stringContaining('REMOTE_CODEX_RELAY_AGENT_TOKEN=rcd_real_device_token'),
      );
    });
    expect(navigator.clipboard.writeText).not.toHaveBeenCalledWith(
      expect.stringContaining('<device-token>'),
    );
  });

  it('caches the newly created device token for later setup copies', async () => {
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
          const created = device({ id: 'device-created', name: 'Studio Mac' });
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
  });

  it('does not copy a placeholder command when the token was not saved locally', async () => {
    renderPage([device({ id: 'device-1', name: 'MacBook Pro' })]);

    await screen.findByText('MacBook Pro');

    expect(screen.getByRole('button', { name: 'Copy setup' })).toBeDisabled();
    expect(
      screen.getByText('Token not available in this browser. Existing device tokens are not shown by the relay again.'),
    ).toBeInTheDocument();
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
  });
});
