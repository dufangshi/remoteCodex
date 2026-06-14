import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import type { RelayAdminSummaryDto } from '../../../../packages/shared/src/index';
import { RelayUserMenu } from '../components/RelayUserMenu';
import {
  ApiError,
  enableRelayMode,
  fetchRelayAdmin,
  setRelayRegistrationEnabled,
  setRelayUserEnabled,
} from '../lib/api';

function errorMessage(caught: unknown) {
  return caught instanceof ApiError
    ? caught.payload.message
    : caught instanceof Error
      ? caught.message
      : 'Unable to update relay admin state.';
}

export function RelayAdminPage() {
  const [summary, setSummary] = useState<RelayAdminSummaryDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      enableRelayMode();
      setSummary(await fetchRelayAdmin());
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function updateRegistration(enabled: boolean) {
    setBusyKey('registration');
    setError(null);
    try {
      const result = await setRelayRegistrationEnabled(enabled);
      setSummary((current) =>
        current ? { ...current, registrationEnabled: result.registrationEnabled } : current,
      );
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusyKey(null);
    }
  }

  async function updateUser(userId: string, enabled: boolean) {
    setBusyKey(userId);
    setError(null);
    try {
      const updated = await setRelayUserEnabled(userId, enabled);
      setSummary((current) =>
        current
          ? {
              ...current,
              users: current.users.map((user) =>
                user.id === updated.id ? updated : user,
              ),
            }
          : current,
      );
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <main className="min-h-screen bg-[var(--app-bg)] px-4 py-6 text-[var(--app-fg)] sm:px-6">
      <RelayUserMenu />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
        <header className="flex flex-col gap-3 border-b border-[var(--theme-border)] pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--theme-fg-muted)]">
              Relay Admin
            </p>
            <h1 className="mt-2 text-2xl font-semibold text-[var(--theme-fg)]">
              Users and devices
            </h1>
            <p className="mt-1 text-sm text-[var(--theme-fg-muted)]">
              Manage relay accounts, registration, and connected devices.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link className="relay-button-secondary" to="/relay-portal">
              Portal
            </Link>
            <button className="relay-button-secondary" onClick={() => void load()} type="button">
              Refresh
            </button>
          </div>
        </header>

        {loading ? (
          <section className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-panel)] p-4 text-sm text-[var(--theme-fg-muted)]">
            Loading relay admin...
          </section>
        ) : error ? (
          <section className="rounded-lg border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] p-4 text-sm text-[var(--status-danger-fg)]">
            {error}
          </section>
        ) : summary ? (
          <>
            <section className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-panel)] p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-base font-semibold text-[var(--theme-fg)]">
                    Registration
                  </h2>
                  <p className="mt-1 text-sm text-[var(--theme-fg-muted)]">
                    New users can create relay accounts without email verification.
                  </p>
                </div>
                <button
                  className="relay-button-primary"
                  disabled={busyKey === 'registration'}
                  onClick={() => void updateRegistration(!summary.registrationEnabled)}
                  type="button"
                >
                  {summary.registrationEnabled ? 'Disable' : 'Enable'}
                </button>
              </div>
            </section>

            <section className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-panel)] p-4">
              <h2 className="text-base font-semibold text-[var(--theme-fg)]">Users</h2>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[44rem] border-collapse text-left text-sm">
                  <thead className="text-xs uppercase tracking-[0.16em] text-[var(--theme-fg-muted)]">
                    <tr>
                      <th className="border-b border-[var(--theme-border)] py-2 pr-3">User</th>
                      <th className="border-b border-[var(--theme-border)] py-2 pr-3">Email</th>
                      <th className="border-b border-[var(--theme-border)] py-2 pr-3">Role</th>
                      <th className="border-b border-[var(--theme-border)] py-2 pr-3">Status</th>
                      <th className="border-b border-[var(--theme-border)] py-2 pr-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.users.map((user) => (
                      <tr key={user.id}>
                        <td className="border-b border-[var(--theme-border)] py-3 pr-3 font-medium text-[var(--theme-fg)]">
                          {user.username}
                        </td>
                        <td className="border-b border-[var(--theme-border)] py-3 pr-3 text-[var(--theme-fg-muted)]">
                          {user.email}
                        </td>
                        <td className="border-b border-[var(--theme-border)] py-3 pr-3 text-[var(--theme-fg-muted)]">
                          {user.role}
                        </td>
                        <td className="border-b border-[var(--theme-border)] py-3 pr-3 text-[var(--theme-fg-muted)]">
                          {user.enabled ? 'Enabled' : 'Disabled'}
                        </td>
                        <td className="border-b border-[var(--theme-border)] py-3 pr-3">
                          <button
                            className="relay-button-secondary"
                            disabled={busyKey === user.id || user.role === 'admin'}
                            onClick={() => void updateUser(user.id, !user.enabled)}
                            type="button"
                          >
                            {user.enabled ? 'Disable' : 'Enable'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-panel)] p-4">
              <h2 className="text-base font-semibold text-[var(--theme-fg)]">Devices</h2>
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                {summary.devices.map((device) => (
                  <article key={device.id} className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-surface)] p-3">
                    <div className="flex items-center gap-2">
                      <span
                        className={`h-2.5 w-2.5 rounded-full ${device.connected ? 'bg-emerald-500' : 'bg-[var(--theme-fg-muted)]'}`}
                      />
                      <p className="truncate text-sm font-medium text-[var(--theme-fg)]">
                        {device.name}
                      </p>
                    </div>
                    <p className="mt-2 font-mono text-xs text-[var(--theme-fg-muted)]">
                      {device.id}
                    </p>
                    <p className="mt-1 text-xs text-[var(--theme-fg-muted)]">
                      Owner: {device.ownerUserId}
                    </p>
                  </article>
                ))}
              </div>
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}
