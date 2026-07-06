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
  });

  it('redirects an authenticated relay user to the devices portal', async () => {
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

    render(
      <MemoryRouter initialEntries={['/relay-portal']}>
        <Routes>
          <Route path="/relay-portal" element={<RelayPortalPage />} />
          <Route path="/relay-devices" element={<div>Relay devices</div>} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('Relay devices')).toBeInTheDocument();
    });
    expect(fetch).not.toHaveBeenCalledWith('/relay/portal', expect.anything());
  });

  it('redirects an authenticated admin to the relay admin panel', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/relay/auth/session') {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              authenticated: true,
              user: { ...relayUser, role: 'admin' },
              registrationEnabled: true,
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

    render(
      <MemoryRouter initialEntries={['/relay-portal']}>
        <Routes>
          <Route path="/relay-portal" element={<RelayPortalPage />} />
          <Route path="/relay-admin" element={<div>Relay admin</div>} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('Relay admin')).toBeInTheDocument();
    });
  });

  it('signs in from the portal and opens relay devices', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/relay/auth/session') {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              authenticated: false,
              user: null,
              registrationEnabled: true,
            }),
          } satisfies Partial<Response>);
        }
        if (url === '/relay/auth/login' && init?.method === 'POST') {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              token: 'relay-token',
              user: relayUser,
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

    render(
      <MemoryRouter initialEntries={['/relay-portal']}>
        <Routes>
          <Route path="/relay-portal" element={<RelayPortalPage />} />
          <Route path="/relay-devices" element={<div>Relay devices</div>} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.change(await screen.findByLabelText('Email or username'), {
      target: { value: 'user@example.test' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'secret-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      expect(screen.getByText('Relay devices')).toBeInTheDocument();
    });
    expect(window.localStorage.getItem('remote-codex-relay-token')).toBe('relay-token');
  });
});
