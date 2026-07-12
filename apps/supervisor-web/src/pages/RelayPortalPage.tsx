import { FormEvent, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

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
  const location = useLocation();
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
          settings={session?.registrationSettings}
          oauthNotice={new URLSearchParams(location.search).has('oauthPending') ? 'OAuth registration received. An admin must approve it before you can sign in.' : null}
          oauthError={new URLSearchParams(location.search).get('oauthError')}
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
  settings,
  oauthNotice,
  oauthError,
  initialError,
  onAuthenticated,
}: {
  registrationEnabled: boolean;
  settings: RelaySessionDto['registrationSettings'];
  oauthNotice: string | null;
  oauthError: string | null;
  initialError: string | null;
  onAuthenticated: () => Promise<void>;
}) {
  const [mode, setMode] = useState<AuthMode>('login');
  const [identifier, setIdentifier] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [registrationPassword, setRegistrationPassword] = useState('');
  const [error, setError] = useState(initialError ?? oauthError);
  const [notice, setNotice] = useState<string | null>(oauthNotice);
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
        if (password.length < 8) {
          setError('Password must be at least 8 characters.');
          return;
        }
        if (username.trim().length < 3) {
          setError('Username must be at least 3 characters.');
          return;
        }
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
      {(settings?.googleAuthEnabled || settings?.githubAuthEnabled) ? (
        <div className="mt-5 grid gap-2">
          {settings.googleAuthEnabled ? <a className="relay-button-secondary flex h-11 items-center justify-center" href="/relay/auth/oauth/google/start">Continue with Google</a> : null}
          {settings.githubAuthEnabled ? <a className="relay-button-secondary flex h-11 items-center justify-center" href="/relay/auth/oauth/github/start">Continue with GitHub</a> : null}
          <div className="flex items-center gap-3 py-1 text-xs text-[var(--theme-fg-muted)]"><span className="h-px flex-1 bg-[var(--theme-border)]" /><span>or use password</span><span className="h-px flex-1 bg-[var(--theme-border)]" /></div>
        </div>
      ) : null}
      <form className="mt-4 space-y-4" onSubmit={submit}>
        {mode === 'login' ? (
          <RelayInput
            autoComplete="username"
            label="Email or username"
            onChange={setIdentifier}
            value={identifier}
          />
        ) : (
          <>
            <RelayInput autoComplete="email" label="Email" onChange={setEmail} required type="email" value={email} />
            <RelayInput autoComplete="username" label="Username" minLength={3} onChange={setUsername} required value={username} />
            <RelayInput
              autoComplete="one-time-code"
              label="Registration password"
              onChange={setRegistrationPassword}
              required
              type="password"
              value={registrationPassword}
            />
          </>
        )}
        <RelayInput
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          label="Password"
          onChange={setPassword}
          required
          type="password"
          value={password}
          {...(mode === 'register'
            ? { description: 'Use at least 8 characters.', minLength: 8 }
            : {})}
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
  description,
  minLength,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  autoComplete?: string;
  description?: string;
  minLength?: number;
  required?: boolean;
}) {
  return (
    <label className="block text-sm text-[var(--theme-fg-soft)]">
      {label}
      <input
        autoComplete={autoComplete}
        className="relay-input mt-2 w-full"
        minLength={minLength}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        type={type}
        value={value}
      />
      {description ? (
        <span className="mt-1.5 block text-xs text-[var(--theme-fg-muted)]">{description}</span>
      ) : null}
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
