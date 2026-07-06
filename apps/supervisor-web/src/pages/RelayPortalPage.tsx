import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import type {
  RelaySessionDto,
} from '../../../../packages/shared/src/index';
import {
  ApiError,
  enableRelayMode,
  fetchRelaySession,
  relayLogin,
  relayRegister,
} from '../lib/api';
import { RelayUserMenu } from '../components/RelayUserMenu';

type AuthMode = 'login' | 'register';

function errorMessage(caught: unknown, fallback: string) {
  return caught instanceof ApiError
    ? caught.payload.message
    : caught instanceof Error
      ? caught.message
      : fallback;
}

export function RelayPortalPage() {
  const navigate = useNavigate();
  const [session, setSession] = useState<RelaySessionDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      enableRelayMode();
      const nextSession = await fetchRelaySession();
      setSession(nextSession);
      if (nextSession.authenticated) {
        if (nextSession.user?.role === 'admin') {
          navigate('/relay-admin', { replace: true });
          return;
        }
        navigate('/relay-devices', { replace: true });
        return;
      }
    } catch (caught) {
      setError(errorMessage(caught, 'Unable to load relay portal.'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleAuthenticated() {
    enableRelayMode();
    const nextSession = await fetchRelaySession();
    if (nextSession.user?.role === 'admin') {
      navigate('/relay-admin', { replace: true });
      return;
    }
    navigate('/relay-devices', { replace: true });
  }

  if (loading) {
    return <RelayFrame>Checking relay session...</RelayFrame>;
  }

  if (!session?.authenticated) {
    return (
      <RelayFrame>
        <RelayAuthPanel
          registrationEnabled={session?.registrationEnabled ?? true}
          initialError={error}
          onAuthenticated={handleAuthenticated}
        />
      </RelayFrame>
    );
  }

  return <RelayFrame>Opening relay devices...</RelayFrame>;
}

function RelayAuthPanel({
  registrationEnabled,
  initialError,
  onAuthenticated,
}: {
  registrationEnabled: boolean;
  initialError: string | null;
  onAuthenticated: () => Promise<void>;
}) {
  const [mode, setMode] = useState<AuthMode>('login');
  const [identifier, setIdentifier] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [registrationPassword, setRegistrationPassword] = useState('');
  const [error, setError] = useState(initialError);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === 'login') {
        await relayLogin({ identifier, password });
      } else {
        const result = await relayRegister({ email, username, password, registrationPassword });
        if (result.pendingApproval) {
          setNotice('Registration request sent. An admin must approve it before you can sign in.');
          setMode('login');
          return;
        }
      }
      await onAuthenticated();
    } catch (caught) {
      setError(errorMessage(caught, 'Unable to authenticate with relay.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="w-full max-w-sm rounded-lg border border-[var(--theme-border)] bg-[var(--theme-panel)] p-5 shadow-xl shadow-[var(--theme-shadow)]">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--theme-fg-muted)]">
        Relay Access
      </p>
      <h1 className="mt-2 text-2xl font-semibold text-[var(--theme-fg)]">
        {mode === 'login' ? 'Sign in' : 'Create account'}
      </h1>
      <form className="mt-5 space-y-4" onSubmit={submit}>
        {mode === 'login' ? (
          <RelayInput
            autoComplete="username"
            label="Email or username"
            onChange={setIdentifier}
            value={identifier}
          />
        ) : (
          <>
            <RelayInput autoComplete="email" label="Email" onChange={setEmail} value={email} />
            <RelayInput autoComplete="username" label="Username" onChange={setUsername} value={username} />
            <RelayInput
              autoComplete="one-time-code"
              label="Registration password"
              onChange={setRegistrationPassword}
              type="password"
              value={registrationPassword}
            />
          </>
        )}
        <RelayInput
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          label="Password"
          onChange={setPassword}
          type="password"
          value={password}
        />
        {error ? <RelayNotice tone="danger">{error}</RelayNotice> : null}
        {notice ? <RelayNotice tone="accent">{notice}</RelayNotice> : null}
        <button className="relay-button-primary h-11 w-full" disabled={submitting} type="submit">
          {submitting ? 'Working...' : mode === 'login' ? 'Sign in' : 'Register'}
        </button>
      </form>
      <button
        className="mt-4 text-sm text-[var(--theme-accent-strong)] disabled:text-[var(--theme-fg-muted)]"
        disabled={mode === 'login' ? !registrationEnabled : false}
        onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
        type="button"
      >
        {mode === 'login'
          ? registrationEnabled
            ? 'Create relay account'
            : 'Registration is disabled'
          : 'Use an existing account'}
      </button>
    </section>
  );
}

function RelayFrame({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-[var(--app-bg)] px-4 py-6 text-[var(--app-fg)] sm:px-6">
      <RelayUserMenu />
      <div className="flex min-h-[calc(100vh-3rem)] items-center justify-center">
        {children}
      </div>
    </main>
  );
}

function RelayInput({
  label,
  value,
  onChange,
  type = 'text',
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  autoComplete?: string;
}) {
  return (
    <label className="block text-sm text-[var(--theme-fg-soft)]">
      {label}
      <input
        autoComplete={autoComplete}
        className="relay-input mt-2 w-full"
        onChange={(event) => onChange(event.target.value)}
        type={type}
        value={value}
      />
    </label>
  );
}

function RelayNotice({
  tone,
  children,
}: {
  tone: 'accent' | 'danger';
  children: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-lg border px-3 py-2 text-sm ${
        tone === 'danger'
          ? 'border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] text-[var(--status-danger-fg)]'
          : 'border-[var(--theme-accent-border)] bg-[var(--theme-accent-soft)] text-[var(--theme-fg)]'
      }`}
    >
      {children}
    </div>
  );
}
