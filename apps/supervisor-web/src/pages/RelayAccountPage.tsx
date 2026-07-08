import { CheckCircle2, MailCheck, Save } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import type { RelaySessionDto } from '@remote-codex/shared';
import {
  ApiError,
  enableRelayMode,
  fetchRelaySession,
  updateRelayAccount,
  updateRelayPassword,
} from '../lib/api';

function errorMessage(caught: unknown, fallback: string) {
  return caught instanceof ApiError
    ? caught.payload.message
    : caught instanceof Error
      ? caught.message
      : fallback;
}

export function RelayAccountSettingsPanel({ className = '' }: { className?: string }) {
  const [session, setSession] = useState<RelaySessionDto | null>(null);
  const [username, setUsername] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verifyClicked, setVerifyClicked] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      enableRelayMode();
      const nextSession = await fetchRelaySession();
      setSession(nextSession);
      setUsername(nextSession.user?.username ?? '');
    } catch (caught) {
      setError(errorMessage(caught, 'Unable to load account.'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingProfile(true);
    setError(null);
    setMessage(null);
    try {
      const user = await updateRelayAccount({ username });
      setSession((current) =>
        current?.authenticated ? { ...current, user } : current,
      );
      setUsername(user.username);
      setMessage('Account updated.');
    } catch (caught) {
      setError(errorMessage(caught, 'Unable to update account.'));
    } finally {
      setSavingProfile(false);
    }
  }

  async function savePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingPassword(true);
    setError(null);
    setMessage(null);
    try {
      if (newPassword !== confirmPassword) {
        setError('New passwords do not match.');
        return;
      }
      await updateRelayPassword({ currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setMessage('Password changed.');
    } catch (caught) {
      setError(errorMessage(caught, 'Unable to change password.'));
    } finally {
      setSavingPassword(false);
    }
  }

  return (
    <div className={`space-y-5 ${className}`.trim()}>
      {loading ? (
        <section className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-panel)] p-4 text-sm text-[var(--theme-fg-muted)]">
          Loading account...
        </section>
      ) : !session?.authenticated ? (
        <section className="rounded-lg border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] p-4 text-sm text-[var(--status-danger-fg)]">
          Relay login is required.
        </section>
      ) : (
        <>
          {error ? <Notice tone="danger">{error}</Notice> : null}
          {message ? <Notice tone="success">{message}</Notice> : null}

          <section className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-panel)] p-4">
            <div className="mb-4">
              <h2 className="text-base font-semibold text-[var(--theme-fg)]">Profile</h2>
              <p className="mt-1 text-sm text-[var(--theme-fg-muted)]">
                Username changes apply to future shares and login.
              </p>
            </div>
            <form className="space-y-4" onSubmit={saveProfile}>
              <label className="block text-sm text-[var(--theme-fg-soft)]">
                Email
                <input
                  className="relay-input mt-2 w-full"
                  disabled
                  readOnly
                  value={session.user?.email ?? ''}
                />
              </label>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <label className="block flex-1 text-sm text-[var(--theme-fg-soft)]">
                  Username
                  <input
                    className="relay-input mt-2 w-full"
                    onChange={(event) => setUsername(event.target.value)}
                    value={username}
                  />
                </label>
                <button
                  className="relay-button-primary inline-flex h-10 items-center justify-center gap-2"
                  disabled={savingProfile || !username.trim()}
                  type="submit"
                >
                  <Save className="h-4 w-4" />
                  Save
                </button>
              </div>
              <button
                className="relay-button-secondary inline-flex items-center gap-2"
                onClick={() => setVerifyClicked(true)}
                type="button"
              >
                {verifyClicked ? <CheckCircle2 className="h-4 w-4" /> : <MailCheck className="h-4 w-4" />}
                {verifyClicked ? 'Verification queued' : 'Verify email'}
              </button>
            </form>
          </section>

          <section className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-panel)] p-4">
            <div className="mb-4">
              <h2 className="text-base font-semibold text-[var(--theme-fg)]">Password</h2>
              <p className="mt-1 text-sm text-[var(--theme-fg-muted)]">
                Use at least 8 characters.
              </p>
            </div>
            <form className="grid gap-4 sm:grid-cols-3" onSubmit={savePassword}>
              <PasswordInput label="Current password" value={currentPassword} onChange={setCurrentPassword} />
              <PasswordInput label="New password" value={newPassword} onChange={setNewPassword} />
              <PasswordInput label="Confirm password" value={confirmPassword} onChange={setConfirmPassword} />
              <button
                className="relay-button-primary inline-flex h-10 items-center justify-center gap-2 sm:col-span-3 sm:w-fit"
                disabled={
                  savingPassword ||
                  !currentPassword ||
                  newPassword.length < 8 ||
                  !confirmPassword
                }
                type="submit"
              >
                <Save className="h-4 w-4" />
                Change password
              </button>
            </form>
          </section>
        </>
      )}
    </div>
  );
}

export function RelayAccountPage() {
  return (
    <main className="min-h-screen bg-[var(--app-bg)] px-4 py-6 text-[var(--app-fg)] sm:px-6">
      <div className="mx-auto w-full max-w-4xl space-y-5 pr-12 sm:pr-0">
        <header className="border-b border-[var(--theme-border)] pb-5">
          <Link className="text-sm text-[var(--theme-accent-strong)]" to="/relay-devices">
            Back to relay portal
          </Link>
          <p className="mt-4 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--theme-fg-muted)]">
            Relay Account
          </p>
          <h1 className="mt-2 text-2xl font-semibold text-[var(--theme-fg)]">
            Account settings
          </h1>
        </header>
        <RelayAccountSettingsPanel />
      </div>
    </main>
  );
}

function PasswordInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block text-sm text-[var(--theme-fg-soft)]">
      {label}
      <input
        autoComplete="new-password"
        className="relay-input mt-2 w-full"
        onChange={(event) => onChange(event.target.value)}
        type="password"
        value={value}
      />
    </label>
  );
}

function Notice({
  tone,
  children,
}: {
  tone: 'danger' | 'success';
  children: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-lg border px-3 py-2 text-sm ${
        tone === 'danger'
          ? 'border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] text-[var(--status-danger-fg)]'
          : 'border-[var(--status-success-border)] bg-[var(--status-success-bg)] text-[var(--status-success-fg)]'
      }`}
    >
      {children}
    </div>
  );
}
