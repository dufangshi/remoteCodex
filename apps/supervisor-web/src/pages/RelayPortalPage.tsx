import { ArrowLeft, BookOpen, Eye, EyeOff } from 'lucide-react';
import {
  FormEvent,
  useEffect,
  useId,
  useMemo,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import type { RelaySessionDto } from '@remote-codex/shared';
import {
  ApiError,
  enableRelayMode,
  fetchRelaySession,
  relayLogin,
  relayLogout,
  relayRegister,
} from '../lib/api';

type AuthMode = 'login' | 'register';

const DEFAULT_RETURN_TO = '/relay-devices';
const RETURN_TO_STORAGE_KEY = 'remote-codex-relay-return-to';

function errorMessage(caught: unknown, fallback: string) {
  return caught instanceof ApiError
    ? caught.payload.message
    : caught instanceof Error
      ? caught.message
      : fallback;
}

function safeReturnTo(value: unknown) {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.startsWith('//')
  ) {
    return null;
  }

  try {
    const base = 'https://remote-codex.invalid';
    const parsed = new URL(value, base);
    const path = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    if (
      parsed.origin !== base ||
      parsed.pathname === '/relay-portal' ||
      parsed.pathname.startsWith('/relay-admin')
    ) {
      return null;
    }
    return path;
  } catch {
    return null;
  }
}

function storedReturnTo() {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return safeReturnTo(window.sessionStorage.getItem(RETURN_TO_STORAGE_KEY));
  } catch {
    return null;
  }
}

function resolveReturnTo(search: string, state: unknown) {
  const queryValue = safeReturnTo(new URLSearchParams(search).get('returnTo'));
  const stateValue =
    state && typeof state === 'object' && 'returnTo' in state
      ? safeReturnTo((state as { returnTo?: unknown }).returnTo)
      : null;
  return queryValue ?? stateValue ?? storedReturnTo() ?? DEFAULT_RETURN_TO;
}

function rememberReturnTo(returnTo: string) {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.sessionStorage.setItem(RETURN_TO_STORAGE_KEY, returnTo);
  } catch {
    // Authentication still works when storage is unavailable.
  }
}

function forgetReturnTo() {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.sessionStorage.removeItem(RETURN_TO_STORAGE_KEY);
  } catch {
    // There may be nothing to clear in restricted browser contexts.
  }
}

export function RelayPortalPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = useMemo(
    () => resolveReturnTo(location.search, location.state),
    [location.search, location.state],
  );
  const [session, setSession] = useState<RelaySessionDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function continueToRequestedPage() {
    forgetReturnTo();
    navigate(returnTo, { replace: true });
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      enableRelayMode();
      const nextSession = await fetchRelaySession();
      if (nextSession.authenticated && nextSession.user?.role === 'admin') {
        const signedOutSession = await relayLogout();
        setSession(signedOutSession);
        return;
      }
      setSession(nextSession);
      if (nextSession.authenticated) {
        continueToRequestedPage();
      }
    } catch (caught) {
      setSession(null);
      setError(errorMessage(caught, 'Unable to load the relay portal.'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    rememberReturnTo(returnTo);
    void load();
  }, []);

  async function handleAuthenticated() {
    enableRelayMode();
    const nextSession = await fetchRelaySession();
    if (nextSession.user?.role === 'admin') {
      const signedOutSession = await relayLogout();
      setSession(signedOutSession);
      throw new Error('This portal accepts relay user accounts only.');
    }
    continueToRequestedPage();
  }

  if (loading) {
    return (
      <RelayFrame>
        <div
          aria-live="polite"
          className="w-full max-w-md py-12 text-sm text-[var(--theme-fg-muted)]"
          role="status"
        >
          Checking relay session...
        </div>
      </RelayFrame>
    );
  }

  if (!session?.authenticated) {
    const searchParams = new URLSearchParams(location.search);
    return (
      <RelayFrame>
        <RelayAuthPanel
          initialError={error}
          oauthError={searchParams.get('oauthError')}
          oauthNotice={
            searchParams.has('oauthPending')
              ? 'OAuth registration received. An admin must approve it before you can sign in.'
              : null
          }
          onAuthenticated={handleAuthenticated}
          onRetry={error ? load : undefined}
          registrationEnabled={session?.registrationEnabled ?? false}
          settings={session?.registrationSettings}
        />
      </RelayFrame>
    );
  }

  return (
    <RelayFrame>
      <div
        aria-live="polite"
        className="w-full max-w-md py-12 text-sm text-[var(--theme-fg-muted)]"
        role="status"
      >
        Opening your relay workspace...
      </div>
    </RelayFrame>
  );
}

function RelayAuthPanel({
  registrationEnabled,
  settings,
  oauthNotice,
  oauthError,
  initialError,
  onAuthenticated,
  onRetry,
}: {
  registrationEnabled: boolean;
  settings: RelaySessionDto['registrationSettings'];
  oauthNotice: string | null;
  oauthError: string | null;
  initialError: string | null;
  onAuthenticated: () => Promise<void>;
  onRetry: (() => Promise<void>) | undefined;
}) {
  const loginTabId = useId();
  const registerTabId = useId();
  const panelId = useId();
  const [mode, setMode] = useState<AuthMode>('login');
  const [identifier, setIdentifier] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [registrationPassword, setRegistrationPassword] = useState('');
  const [error, setError] = useState(initialError ?? oauthError);
  const [notice, setNotice] = useState<string | null>(oauthNotice);
  const [submitting, setSubmitting] = useState(false);
  const registrationPasswordRequired =
    settings?.registrationPasswordConfigured ??
    Boolean(settings?.registrationPassword);

  useEffect(() => {
    setError(initialError ?? oauthError);
  }, [initialError, oauthError]);

  function selectMode(nextMode: AuthMode) {
    if (nextMode === 'register' && !registrationEnabled) {
      return;
    }
    setMode(nextMode);
    setError(null);
  }

  function handleModeKeyDown(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    currentMode: AuthMode,
  ) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      return;
    }
    event.preventDefault();
    const nextMode: AuthMode =
      event.key === 'Home'
        ? 'login'
        : event.key === 'End'
          ? registrationEnabled
            ? 'register'
            : 'login'
          : currentMode === 'login' && registrationEnabled
            ? 'register'
            : 'login';
    selectMode(nextMode);
    window.requestAnimationFrame(() => {
      document
        .getElementById(nextMode === 'login' ? loginTabId : registerTabId)
        ?.focus();
    });
  }

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
        const code = registrationPassword.trim();
        const result = await relayRegister({
          email,
          username,
          password,
          ...(code ? { registrationPassword: code } : {}),
        });
        if (result.pendingApproval) {
          setNotice(
            'Registration request sent. An admin must approve it before you can sign in.',
          );
          setMode('login');
          return;
        }
      }
      await onAuthenticated();
    } catch (caught) {
      setError(errorMessage(caught, 'Unable to authenticate with the relay.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="w-full max-w-md rounded-lg border border-[var(--theme-border)] bg-[var(--theme-panel)] p-5 shadow-[var(--theme-shadow)] sm:p-6">
      <p className="text-sm font-medium text-[var(--theme-accent-strong)]">
        Relay access
      </p>
      <h1 className="mt-2 text-2xl font-semibold text-[var(--theme-fg)]">
        {mode === 'login' ? 'Welcome back' : 'Create your account'}
      </h1>
      <p className="mt-2 text-sm leading-6 text-[var(--theme-fg-muted)]">
        {mode === 'login'
          ? 'Sign in to open your devices and shared work.'
          : 'Create a relay user account for private supervisor access.'}
      </p>

      <div
        aria-label="Account access"
        className="mt-5 grid grid-cols-2 rounded-lg bg-[var(--theme-muted)] p-1"
        role="tablist"
      >
        <button
          aria-controls={panelId}
          aria-selected={mode === 'login'}
          className={`min-h-11 rounded-md px-3 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent-ring)] ${
            mode === 'login'
              ? 'bg-[var(--theme-panel)] text-[var(--theme-fg)] shadow-sm'
              : 'text-[var(--theme-fg-muted)] hover:text-[var(--theme-fg)]'
          }`}
          id={loginTabId}
          disabled={submitting}
          onKeyDown={(event) => handleModeKeyDown(event, 'login')}
          onClick={() => selectMode('login')}
          role="tab"
          tabIndex={mode === 'login' ? 0 : -1}
          type="button"
        >
          Sign in
        </button>
        <button
          aria-controls={panelId}
          aria-selected={mode === 'register'}
          className={`min-h-11 rounded-md px-3 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent-ring)] ${
            mode === 'register'
              ? 'bg-[var(--theme-panel)] text-[var(--theme-fg)] shadow-sm'
              : 'text-[var(--theme-fg-muted)] hover:text-[var(--theme-fg)]'
          }`}
          disabled={!registrationEnabled || submitting}
          id={registerTabId}
          onKeyDown={(event) => handleModeKeyDown(event, 'register')}
          onClick={() => selectMode('register')}
          role="tab"
          tabIndex={mode === 'register' ? 0 : -1}
          title={registrationEnabled ? undefined : 'Registration is disabled'}
          type="button"
        >
          {registrationEnabled ? 'Create account' : 'Registration closed'}
        </button>
      </div>

      {settings?.googleAuthEnabled || settings?.githubAuthEnabled ? (
        <div className="mt-5 grid gap-2">
          {settings.googleAuthEnabled ? (
            <a
              className="relay-button-secondary flex h-11 items-center justify-center"
              href="/relay/auth/oauth/google/start"
            >
              Continue with Google
            </a>
          ) : null}
          {settings.githubAuthEnabled ? (
            <a
              className="relay-button-secondary flex h-11 items-center justify-center"
              href="/relay/auth/oauth/github/start"
            >
              Continue with GitHub
            </a>
          ) : null}
          <div className="flex items-center gap-3 py-1 text-xs text-[var(--theme-fg-muted)]">
            <span className="h-px flex-1 bg-[var(--theme-border)]" />
            <span>or use a password</span>
            <span className="h-px flex-1 bg-[var(--theme-border)]" />
          </div>
        </div>
      ) : null}

      <form
        aria-labelledby={mode === 'login' ? loginTabId : registerTabId}
        className="mt-5 space-y-4"
        id={panelId}
        onSubmit={submit}
        role="tabpanel"
      >
        {mode === 'login' ? (
          <RelayInput
            autoComplete="username"
            disabled={submitting}
            label="Email or username"
            name="identifier"
            onChange={setIdentifier}
            required
            value={identifier}
          />
        ) : (
          <>
            <RelayInput
              autoComplete="email"
              disabled={submitting}
              label="Email"
              name="email"
              onChange={setEmail}
              required
              type="email"
              value={email}
            />
            <RelayInput
              autoComplete="username"
              disabled={submitting}
              label="Username"
              minLength={3}
              name="username"
              onChange={setUsername}
              required
              value={username}
            />
            <RelayInput
              autoComplete="one-time-code"
              disabled={submitting}
              description={
                registrationPasswordRequired
                  ? 'Required by this relay.'
                  : 'Enter the invite code if this relay requires one.'
              }
              label={
                registrationPasswordRequired
                  ? 'Registration code'
                  : 'Registration code (if required)'
              }
              name="registrationCode"
              onChange={setRegistrationPassword}
              required={registrationPasswordRequired}
              type="password"
              value={registrationPassword}
            />
          </>
        )}
        <RelayInput
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          disabled={submitting}
          label="Password"
          name="password"
          onChange={setPassword}
          required
          type="password"
          value={password}
          {...(mode === 'register'
            ? { description: 'Use at least 8 characters.', minLength: 8 }
            : {})}
        />

        {error ? (
          <RelayNotice tone="danger">
            <p>{error}</p>
            {initialError && onRetry ? (
              <button
                className="relay-button-secondary mt-3 h-11"
                onClick={() => void onRetry()}
                type="button"
              >
                Retry connection
              </button>
            ) : null}
          </RelayNotice>
        ) : null}
        {notice ? <RelayNotice tone="accent">{notice}</RelayNotice> : null}

        <button
          className="relay-button-primary h-11 w-full"
          disabled={submitting}
          type="submit"
        >
          {submitting
            ? 'Working...'
            : mode === 'login'
              ? 'Sign in'
              : 'Create account'}
        </button>
      </form>
    </section>
  );
}

function RelayFrame({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-[var(--app-bg)] px-4 py-5 text-[var(--app-fg)] sm:px-6 sm:py-6">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 border-b border-[var(--theme-border)] pb-4">
        <Link
          className="flex min-h-11 min-w-0 items-center gap-2 text-sm font-semibold text-[var(--theme-fg)]"
          to="/"
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4 shrink-0" />
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--theme-accent-soft)] text-xs text-[var(--theme-accent-strong)]">
            RC
          </span>
          <span className="truncate">Relay home</span>
        </Link>
        <Link
          className="relay-button-secondary inline-flex h-11 shrink-0 items-center gap-2"
          to="/relay-guide"
        >
          <BookOpen aria-hidden="true" className="h-4 w-4" />
          Guide
        </Link>
      </header>
      <div className="mx-auto flex w-full max-w-5xl justify-center py-8 sm:py-12">
        {children}
      </div>
    </main>
  );
}

function RelayInput({
  label,
  value,
  onChange,
  name,
  type = 'text',
  autoComplete,
  description,
  disabled = false,
  minLength,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  name: string;
  type?: string;
  autoComplete?: string;
  description?: string;
  disabled?: boolean;
  minLength?: number;
  required?: boolean;
}) {
  const descriptionId = useId();
  const inputId = useId();
  const [passwordVisible, setPasswordVisible] = useState(false);
  const passwordField = type === 'password';
  return (
    <div className="text-sm text-[var(--theme-fg-soft)]">
      <label htmlFor={inputId}>{label}</label>
      <div className="relative mt-2">
        <input
          aria-describedby={description ? descriptionId : undefined}
          autoComplete={autoComplete}
          className={`relay-input min-h-11 w-full ${passwordField ? 'pr-12' : ''}`}
          disabled={disabled}
          id={inputId}
          minLength={minLength}
          name={name}
          onChange={(event) => onChange(event.target.value)}
          required={required}
          type={passwordField && passwordVisible ? 'text' : type}
          value={value}
        />
        {passwordField ? (
          <button
            aria-label={
              passwordVisible
                ? `Hide ${label.toLowerCase()}`
                : `Show ${label.toLowerCase()}`
            }
            className="absolute inset-y-0 right-0 inline-flex w-11 items-center justify-center text-[var(--theme-fg-muted)] hover:text-[var(--theme-fg)]"
            disabled={disabled}
            onClick={() => setPasswordVisible((visible) => !visible)}
            type="button"
          >
            {passwordVisible ? (
              <EyeOff aria-hidden="true" className="h-4 w-4" />
            ) : (
              <Eye aria-hidden="true" className="h-4 w-4" />
            )}
          </button>
        ) : null}
      </div>
      {description ? (
        <span
          className="mt-1.5 block text-xs text-[var(--theme-fg-muted)]"
          id={descriptionId}
        >
          {description}
        </span>
      ) : null}
    </div>
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
      aria-live={tone === 'danger' ? 'assertive' : 'polite'}
      className={`rounded-lg px-3 py-2 text-sm ${
        tone === 'danger'
          ? 'bg-[var(--status-danger-bg)] text-[var(--status-danger-fg)]'
          : 'bg-[var(--theme-accent-soft)] text-[var(--theme-fg)]'
      }`}
      role={tone === 'danger' ? 'alert' : 'status'}
    >
      {children}
    </div>
  );
}
