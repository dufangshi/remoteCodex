import { FormEvent, type ReactElement, useEffect, useMemo, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';

import {
  ApiError,
  controlPlaneOAuthStartUrl,
  fetchControlPlaneMe,
  loginControlPlanePasswordAccount,
  registerControlPlanePasswordAccount,
  type ControlPlaneAuth,
} from '../lib/api';
import {
  clearStoredControlPlaneAuth,
  hasStoredControlPlaneAuth,
  readStoredControlPlaneAuth,
  type StoredControlPlaneAuth,
  writeStoredControlPlaneAuth,
} from './controlPlaneAuthStorage';

const DEFAULT_CONTROL_PLANE_BASE_URL =
  import.meta.env.VITE_CONTROL_PLANE_BASE_URL || 'http://127.0.0.1:8790';

export function ControlPlaneAuthGuard({ children }: { children: ReactElement }) {
  const location = useLocation();
  const [hasAuth, setHasAuth] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) {
        setHasAuth(hasStoredControlPlaneAuth());
      }
    });
    return () => {
      cancelled = true;
    };
  }, [location.pathname]);

  if (hasAuth === null) {
    return (
      <div className="grid min-h-[60vh] place-items-center text-sm text-[var(--theme-fg-muted)]">
        Loading account session...
      </div>
    );
  }
  if (!hasAuth) {
    return <Navigate to="/control-plane/login" replace state={{ from: location }} />;
  }
  return children;
}

function authFromStored(stored: StoredControlPlaneAuth): ControlPlaneAuth {
  return {
    baseUrl: stored.baseUrl,
    token: stored.token,
  };
}

function oauthParamsFromLocation() {
  if (typeof window === 'undefined') {
    return null;
  }
  const params = new URLSearchParams(window.location.search);
  const token = params.get('control_plane_token');
  const expiresAt = params.get('control_plane_expires_at');
  const baseUrl = params.get('control_plane_base_url');
  const error = params.get('auth_error');
  return { token, expiresAt, baseUrl, error };
}

export function ControlPlaneLoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const existing = readStoredControlPlaneAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [baseUrl, setBaseUrl] = useState(existing?.baseUrl ?? DEFAULT_CONTROL_PLANE_BASE_URL);
  const [email, setEmail] = useState(existing?.email ?? 'dev@example.com');
  const [displayName, setDisplayName] = useState(existing?.displayName ?? 'Developer');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const state = location.state as { from?: { pathname?: string } } | null;
  const nextPath = state?.from?.pathname ?? '/control-plane';
  const oauthReturnTo = useMemo(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }
    const url = new URL(window.location.href);
    url.search = '';
    return url.toString();
  }, []);

  useEffect(() => {
    const oauth = oauthParamsFromLocation();
    if (!oauth) {
      return;
    }
    if (oauth.error) {
      setError(`OAuth sign in failed: ${oauth.error}`);
      return;
    }
    if (!oauth.token || !oauth.baseUrl) {
      return;
    }
    const stored: StoredControlPlaneAuth = {
      baseUrl: oauth.baseUrl,
      token: oauth.token,
    };
    if (oauth.expiresAt) {
      stored.expiresAt = oauth.expiresAt;
    }
    writeStoredControlPlaneAuth(stored);
    void fetchControlPlaneMe(authFromStored(stored))
      .then((result) => {
        writeStoredControlPlaneAuth({
          ...stored,
          email: result.user.email,
          displayName: result.user.displayName,
        });
        navigate('/control-plane', { replace: true });
      })
      .catch((caught) => {
        clearStoredControlPlaneAuth();
        setError(caught instanceof Error ? caught.message : 'Unable to finish OAuth sign in.');
      });
  }, [navigate]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result =
        mode === 'register'
          ? await registerControlPlanePasswordAccount(baseUrl, {
              email,
              password,
              displayName: displayName || null,
            })
          : await loginControlPlanePasswordAccount(baseUrl, { email, password });
      writeStoredControlPlaneAuth({
        baseUrl,
        token: result.session.token,
        expiresAt: result.session.expiresAt,
        email: result.user.email,
        displayName: result.user.displayName,
      });
      setMessage('Account session is ready.');
      navigate(nextPath, { replace: true });
    } catch (caught) {
      if (caught instanceof ApiError && caught.payload.code === 'conflict') {
        setError('An account already exists for this email. Use sign in instead.');
      } else {
        setError(caught instanceof Error ? caught.message : 'Unable to authenticate.');
      }
    } finally {
      setBusy(false);
    }
  }

  function handleOAuth(provider: 'google' | 'github') {
    window.location.assign(controlPlaneOAuthStartUrl(baseUrl, provider, oauthReturnTo));
  }

  return (
    <div className="control-auth-shell">
      <section className="control-auth-panel" aria-label="Control plane account login">
        <div className="control-auth-aside">
          <p className="control-kicker">Remote Codex</p>
          <h1>Control plane sign in</h1>
          <p>
            Use a product account to manage sandboxes, workspaces, route tokens, and usage from
            the cloud control plane.
          </p>
          <div className="control-auth-checks" aria-label="Login capabilities">
            <span>Google</span>
            <span>GitHub</span>
            <span>Email password</span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="control-auth-form">
          <div className="control-auth-tabs" role="tablist" aria-label="Authentication mode">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'login'}
              onClick={() => setMode('login')}
            >
              Sign in
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'register'}
              onClick={() => setMode('register')}
            >
              Create account
            </button>
          </div>

          <label className="control-field">
            <span>Control plane URL</span>
            <input value={baseUrl} onChange={(event) => setBaseUrl(event.currentTarget.value)} />
          </label>

          <div className="control-oauth-row">
            <button type="button" onClick={() => handleOAuth('google')}>
              Continue with Google
            </button>
            <button type="button" onClick={() => handleOAuth('github')}>
              Continue with GitHub
            </button>
          </div>

          <div className="control-auth-divider"><span>Email</span></div>

          {mode === 'register' ? (
            <label className="control-field">
              <span>Display name</span>
              <input value={displayName} onChange={(event) => setDisplayName(event.currentTarget.value)} />
            </label>
          ) : null}
          <label className="control-field">
            <span>Email address</span>
            <input
              type="email"
              value={email}
              autoComplete="email"
              onChange={(event) => setEmail(event.currentTarget.value)}
            />
          </label>
          <label className="control-field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              minLength={8}
              onChange={(event) => setPassword(event.currentTarget.value)}
            />
          </label>

          {error ? <p className="control-auth-error">{error}</p> : null}
          {message ? <p className="control-auth-message">{message}</p> : null}

          <button type="submit" className="control-primary-button" disabled={busy}>
            {busy ? 'Working...' : mode === 'register' ? 'Create account' : 'Sign in'}
          </button>
        </form>
      </section>
    </div>
  );
}
