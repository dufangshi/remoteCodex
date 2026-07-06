import { ArrowRight, BookOpen, CheckCircle2, MonitorSmartphone, RadioTower, ShieldCheck, Workflow } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

import type { RelaySessionDto } from '@remote-codex/shared';
import { enableRelayMode, fetchRelaySession } from '../lib/api';

export function RelayHomePage() {
  const [session, setSession] = useState<RelaySessionDto | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    enableRelayMode();
    fetchRelaySession()
      .then((nextSession) => {
        if (!cancelled) {
          setSession(nextSession);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSession(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const authenticated = session?.authenticated === true;

  return (
    <main className="min-h-screen bg-[var(--app-bg)] px-4 py-6 text-[var(--app-fg)] sm:px-6">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
        <header className="flex items-center justify-between gap-4 border-b border-[var(--theme-border)] pb-5">
          <Link to="/" className="flex min-w-0 items-center gap-3">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--theme-border)] bg-[var(--theme-surface-strong)] text-sm font-semibold text-[var(--theme-fg)]">
              RC
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-[var(--theme-fg)]">Remote Codex Relay</span>
              <span className="block text-xs text-[var(--theme-fg-muted)]">Private supervisor access</span>
            </span>
          </Link>
          <nav className="flex shrink-0 items-center gap-2">
            <Link className="relay-button-secondary inline-flex items-center gap-2" to="/relay-guide">
              <BookOpen className="h-4 w-4" />
              Guide
            </Link>
            <Link className="relay-button-primary inline-flex items-center gap-2" to={authenticated ? '/relay-devices' : '/relay-portal'}>
              {loading ? 'Checking...' : authenticated ? 'Open devices' : 'Sign in'}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </nav>
        </header>

        <section className="grid gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(20rem,0.95fr)]">
          <div className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-panel)] p-4 shadow-[var(--theme-shadow)] sm:p-5">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--theme-fg-muted)]">
                  Relay console
                </p>
                <h1 className="mt-2 max-w-2xl text-2xl font-semibold tracking-normal text-[var(--theme-fg)] sm:text-3xl">
                  Connect a private Codex supervisor.
                </h1>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--theme-fg-soft)]">
                  Register a device, keep the supervisor connected over an outbound tunnel, then open workspaces through
                  web or mobile clients.
                </p>
              </div>
              <span
                className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium ${
                  authenticated
                    ? 'border-[var(--status-success-border)] bg-[var(--status-success-bg)] text-[var(--status-success-fg)]'
                    : 'border-[var(--theme-border-strong)] bg-[var(--theme-muted)] text-[var(--theme-fg-soft)]'
                }`}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
                {loading ? 'Checking session' : authenticated ? 'Signed in' : 'Signed out'}
              </span>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              <Link className="relay-button-primary inline-flex h-11 items-center gap-2 px-4" to={authenticated ? '/relay-devices' : '/relay-portal'}>
                {authenticated ? 'Open devices' : 'Sign in'}
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link className="relay-button-secondary inline-flex h-11 items-center gap-2 px-4" to="/relay-guide">
                Setup guide
              </Link>
            </div>

            <div className="mt-5 grid gap-2 sm:grid-cols-3">
              <RelayFact label="Mode" value="Relay" />
              <RelayFact label="Client" value="Web, Android, iOS" />
              <RelayFact label="Tunnel" value="Supervisor outbound" />
            </div>
          </div>

          <div className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-panel)] p-4 shadow-[var(--theme-shadow)]">
            <div className="mb-4 flex items-center gap-3">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--theme-border)] bg-[var(--theme-surface-strong)] text-[var(--theme-fg)]">
                <RadioTower className="h-4 w-4" />
              </span>
              <div>
                <h2 className="text-sm font-semibold text-[var(--theme-fg)]">Connection path</h2>
                <p className="text-xs text-[var(--theme-fg-muted)]">Everything starts from a selected device.</p>
              </div>
            </div>
            <div className="grid gap-3">
              <RelayIllustrationStep icon={<MonitorSmartphone className="h-4 w-4" />} title="Create a device token" detail="Register each workstation once from the relay portal." />
              <RelayIllustrationStep icon={<Workflow className="h-4 w-4" />} title="Start relay-supervisor" detail="The private machine keeps an outbound WebSocket open." />
              <RelayIllustrationStep icon={<ShieldCheck className="h-4 w-4" />} title="Open workspaces" detail="Web, Android, and iOS connect through the selected device." />
            </div>
          </div>
        </section>

        <section className="grid gap-3 md:grid-cols-3">
          <FeatureCard title="Local stays local" detail="Workspace files and agent execution remain on the supervisor device." />
          <FeatureCard title="Shared sessions" detail="Share a thread as view-only or collaborator access, with workspace permissions." />
          <FeatureCard title="Mobile first" detail="Resume threads, monitor long turns, and open shared sessions from Android or iOS." />
        </section>
      </div>
    </main>
  );
}

function RelayIllustrationStep({
  detail,
  icon,
  title,
}: {
  detail: string;
  icon: ReactNode;
  title: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-surface)] p-3">
      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--theme-border-strong)] bg-[var(--theme-surface-strong)] text-[var(--theme-fg-soft)]">
        {icon}
      </span>
      <div>
        <p className="text-sm font-semibold text-[var(--theme-fg)]">{title}</p>
        <p className="mt-1 text-xs leading-5 text-[var(--theme-fg-muted)]">{detail}</p>
      </div>
    </div>
  );
}

function FeatureCard({ detail, title }: { detail: string; title: string }) {
  return (
    <article className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-surface)] p-4">
      <CheckCircle2 className="h-4 w-4 text-[var(--status-success-fg)]" />
      <h2 className="mt-3 text-base font-semibold text-[var(--theme-fg)]">{title}</h2>
      <p className="mt-1 text-sm leading-6 text-[var(--theme-fg-muted)]">{detail}</p>
    </article>
  );
}

function RelayFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-surface)] px-3 py-2">
      <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--theme-fg-muted)]">{label}</p>
      <p className="mt-1 truncate text-sm font-medium text-[var(--theme-fg-soft)]">{value}</p>
    </div>
  );
}
