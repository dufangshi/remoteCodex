import { ArrowRight, BookOpen, CheckCircle2, MonitorSmartphone, ShieldCheck, Workflow } from 'lucide-react';
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
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
        <header className="flex items-center justify-between gap-4 border-b border-[var(--theme-border)] pb-5">
          <Link to="/" className="flex min-w-0 items-center gap-3">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--theme-border)] bg-[var(--theme-panel)] text-sm font-semibold text-[var(--theme-fg)]">
              RC
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-[var(--theme-fg)]">Remote Codex Relay</span>
              <span className="block text-xs text-[var(--theme-fg-muted)]">Private workspaces, public reach</span>
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

        <section className="grid gap-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(20rem,0.95fr)] lg:items-center">
          <div className="space-y-5">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--theme-fg-muted)]">
              Relay mode
            </p>
            <div className="space-y-3">
              <h1 className="max-w-3xl text-4xl font-semibold tracking-normal text-[var(--theme-fg)] sm:text-5xl">
                Run Codex on your private machine from anywhere.
              </h1>
              <p className="max-w-2xl text-base leading-7 text-[var(--theme-fg-soft)]">
                Keep the supervisor and workspace on your own device. The relay only coordinates authenticated browser
                and mobile access, so your backend connects out instead of opening inbound ports.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link className="relay-button-primary inline-flex h-11 items-center gap-2 px-4" to={authenticated ? '/relay-devices' : '/relay-portal'}>
                {authenticated ? 'Open relay devices' : 'Sign in to relay'}
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link className="relay-button-secondary inline-flex h-11 items-center gap-2 px-4" to="/relay-guide">
                Read setup guide
              </Link>
            </div>
          </div>

          <div className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-panel)] p-4">
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
      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--theme-border)] bg-[var(--theme-panel)] text-[var(--theme-accent-strong)]">
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
    <article className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-panel)] p-4">
      <CheckCircle2 className="h-4 w-4 text-[var(--theme-accent-strong)]" />
      <h2 className="mt-3 text-base font-semibold text-[var(--theme-fg)]">{title}</h2>
      <p className="mt-1 text-sm leading-6 text-[var(--theme-fg-muted)]">{detail}</p>
    </article>
  );
}
