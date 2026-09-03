import { ArrowRight, BookOpen, MonitorSmartphone, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import type { RelaySessionDto } from '@remote-codex/shared';
import { ApiError, enableRelayMode, fetchRelaySession } from '../lib/api';

function errorMessage(caught: unknown) {
  return caught instanceof ApiError
    ? caught.payload.message
    : caught instanceof Error
      ? caught.message
      : 'The relay service could not be reached.';
}

export function RelayHomePage() {
  const [session, setSession] = useState<RelaySessionDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadSession() {
    setLoading(true);
    setError(null);
    try {
      enableRelayMode();
      setSession(await fetchRelaySession());
    } catch (caught) {
      setSession(null);
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadSession();
  }, []);

  const authenticated =
    session?.authenticated === true && session.user?.role !== 'admin';

  const title = loading
    ? 'Checking relay access'
    : error
      ? 'Relay service unavailable'
      : authenticated
        ? 'Choose a device to continue'
        : 'Sign in to your relay workspace';

  return (
    <main className="min-h-screen bg-[var(--app-bg)] px-4 py-5 text-[var(--app-fg)] sm:px-6 sm:py-6">
      <div className="mx-auto w-full max-w-5xl">
        <header className="flex items-center justify-between gap-3 border-b border-[var(--theme-border)] pb-4">
          <Link className="flex min-h-11 min-w-0 items-center gap-3" to="/">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--theme-accent-soft)] text-sm font-semibold text-[var(--theme-accent-strong)]">
              RC
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-[var(--theme-fg)]">
                Remote Codex Relay
              </span>
              <span className="block truncate text-xs text-[var(--theme-fg-muted)]">
                Private supervisor access
              </span>
            </span>
          </Link>
          <Link
            className="relay-button-secondary inline-flex h-11 shrink-0 items-center gap-2"
            to="/relay-guide"
          >
            <BookOpen aria-hidden="true" className="h-4 w-4" />
            Guide
          </Link>
        </header>

        <section className="py-10 sm:py-14" aria-busy={loading}>
          <div className="flex items-center gap-2 text-sm text-[var(--theme-fg-muted)]">
            <span
              aria-hidden="true"
              className={`h-2 w-2 rounded-full ${
                loading
                  ? 'bg-[var(--theme-fg-muted)]'
                  : error
                    ? 'bg-[var(--status-danger-fg)]'
                    : authenticated
                      ? 'bg-[var(--status-success-fg)]'
                      : 'bg-[var(--theme-fg-muted)]'
              }`}
            />
            {loading
              ? 'Checking session'
              : error
                ? 'Connection failed'
                : authenticated
                  ? `Signed in as ${session.user?.username}`
                  : 'Signed out'}
          </div>

          <h1 className="mt-4 max-w-2xl text-2xl font-semibold tracking-normal text-[var(--theme-fg)] sm:text-3xl">
            {title}
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--theme-fg-soft)]">
            {error
              ? 'Your session could not be checked. Verify the relay address and try again.'
              : authenticated
                ? 'Open device management to connect to a supervisor, then continue into its workspaces and threads.'
                : 'Use your relay account to reach the devices, workspaces, and threads shared with you.'}
          </p>

          {error ? (
            <div
              className="mt-6 max-w-2xl rounded-lg bg-[var(--status-danger-bg)] px-4 py-3 text-sm text-[var(--status-danger-fg)]"
              role="alert"
            >
              <p>{error}</p>
              <button
                className="relay-button-secondary mt-3 inline-flex h-11 items-center gap-2"
                disabled={loading}
                onClick={() => void loadSession()}
                type="button"
              >
                <RefreshCw aria-hidden="true" className="h-4 w-4" />
                Retry
              </button>
            </div>
          ) : loading ? (
            <div className="mt-6 h-11 w-36 animate-pulse rounded-lg bg-[var(--theme-muted)]" aria-hidden="true" />
          ) : (
            <Link
              className="relay-button-primary mt-6 inline-flex h-11 items-center gap-2 px-4"
              to={authenticated ? '/relay-devices' : '/relay-portal'}
            >
              <MonitorSmartphone aria-hidden="true" className="h-4 w-4" />
              {authenticated ? 'Open devices' : 'Sign in'}
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </Link>
          )}
        </section>

        <section className="border-t border-[var(--theme-border)] py-6">
          <div className="grid gap-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
            <div>
              <h2 className="text-sm font-semibold text-[var(--theme-fg)]">Connection path</h2>
              <p className="mt-1 text-xs leading-5 text-[var(--theme-fg-muted)]">
                Three steps, one outbound tunnel.
              </p>
            </div>
            <ol className="divide-y divide-[var(--theme-border)] border-y border-[var(--theme-border)]">
              <ConnectionStep number="01" title="Register a device">
                Create a one-time token for the private supervisor machine.
              </ConnectionStep>
              <ConnectionStep number="02" title="Start the supervisor">
                Keep an outbound relay connection open from that machine.
              </ConnectionStep>
              <ConnectionStep number="03" title="Open your workspace">
                Select the online device and continue to its workspaces and threads.
              </ConnectionStep>
            </ol>
          </div>
        </section>
      </div>
    </main>
  );
}

function ConnectionStep({
  children,
  number,
  title,
}: {
  children: React.ReactNode;
  number: string;
  title: string;
}) {
  return (
    <li className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3 py-3 first:pt-0 last:pb-0">
      <span className="font-mono text-xs leading-6 text-[var(--theme-fg-muted)]">{number}</span>
      <div className="min-w-0">
        <p className="text-sm font-medium text-[var(--theme-fg)]">{title}</p>
        <p className="mt-0.5 text-sm leading-6 text-[var(--theme-fg-muted)]">{children}</p>
      </div>
    </li>
  );
}
