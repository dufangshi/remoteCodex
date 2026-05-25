import { FormEvent, type ReactElement, useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';

import { CONTROL_PLANE_AUTH_STORAGE_KEY } from './ControlPlanePage';

interface StoredControlPlaneAuth {
  baseUrl: string;
  subject: string;
  email: string;
  displayName: string;
}

function readStoredAuth(): StoredControlPlaneAuth | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const raw = window.localStorage.getItem(CONTROL_PLANE_AUTH_STORAGE_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<StoredControlPlaneAuth>;
    if (!parsed.baseUrl || !parsed.subject || !parsed.email) {
      return null;
    }
    return {
      baseUrl: parsed.baseUrl,
      subject: parsed.subject,
      email: parsed.email,
      displayName: parsed.displayName || 'Developer',
    };
  } catch {
    return null;
  }
}

export function hasStoredControlPlaneAuth() {
  return Boolean(readStoredAuth());
}

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

export function ControlPlaneLoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const existing = readStoredAuth();
  const [baseUrl, setBaseUrl] = useState(existing?.baseUrl ?? 'http://127.0.0.1:8790');
  const [subject, setSubject] = useState(existing?.subject ?? 'dev-user');
  const [email, setEmail] = useState(existing?.email ?? 'dev@example.com');
  const [displayName, setDisplayName] = useState(existing?.displayName ?? 'Developer');

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    window.localStorage.setItem(
      CONTROL_PLANE_AUTH_STORAGE_KEY,
      JSON.stringify({
        baseUrl,
        subject,
        email,
        displayName,
      }),
    );
    const state = location.state as { from?: { pathname?: string } } | null;
    navigate(state?.from?.pathname ?? '/control-plane', { replace: true });
  }

  return (
    <div className="mx-auto grid max-w-xl gap-5 py-8 text-[var(--theme-fg)]">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--theme-fg-muted)]">
          Control plane
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-[var(--theme-fg)]">
          Login
        </h1>
      </div>
      <form
        onSubmit={handleSubmit}
        className="grid gap-4 border-t border-[var(--theme-border)] pt-5"
      >
        <label className="grid gap-1.5 text-xs font-medium text-[var(--theme-fg-muted)]">
          <span>Control plane URL</span>
          <input
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.currentTarget.value)}
            className="h-10 rounded-[0.7rem] border border-[var(--theme-border)] bg-[var(--theme-surface)] px-3 text-sm text-[var(--theme-fg)] outline-none"
          />
        </label>
        <label className="grid gap-1.5 text-xs font-medium text-[var(--theme-fg-muted)]">
          <span>Dev subject</span>
          <input
            value={subject}
            onChange={(event) => setSubject(event.currentTarget.value)}
            className="h-10 rounded-[0.7rem] border border-[var(--theme-border)] bg-[var(--theme-surface)] px-3 text-sm text-[var(--theme-fg)] outline-none"
          />
        </label>
        <label className="grid gap-1.5 text-xs font-medium text-[var(--theme-fg-muted)]">
          <span>Email</span>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.currentTarget.value)}
            className="h-10 rounded-[0.7rem] border border-[var(--theme-border)] bg-[var(--theme-surface)] px-3 text-sm text-[var(--theme-fg)] outline-none"
          />
        </label>
        <label className="grid gap-1.5 text-xs font-medium text-[var(--theme-fg-muted)]">
          <span>Display name</span>
          <input
            value={displayName}
            onChange={(event) => setDisplayName(event.currentTarget.value)}
            className="h-10 rounded-[0.7rem] border border-[var(--theme-border)] bg-[var(--theme-surface)] px-3 text-sm text-[var(--theme-fg)] outline-none"
          />
        </label>
        <button
          type="submit"
          className="h-10 rounded-[0.75rem] border border-[var(--theme-border)] bg-[var(--theme-surface-strong)] px-3 text-sm font-medium text-[var(--theme-fg)] transition hover:bg-[var(--theme-hover)]"
        >
          Continue
        </button>
      </form>
    </div>
  );
}
