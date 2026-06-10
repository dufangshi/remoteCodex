import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import type { RuntimeConfigDto } from '@remote-codex/shared';
import { StatusCard } from '../components/StatusCard';
import { fetchRuntimeConfig } from '../lib/api';

export function LandingPage() {
  const [config, setConfig] = useState<RuntimeConfigDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchRuntimeConfig().then(setConfig).catch((caught) => {
      setError(caught instanceof Error ? caught.message : 'Unable to load runtime config.');
    });
  }, []);

  return (
    <div className="min-h-screen bg-[var(--app-bg)] px-4 py-8 text-[var(--app-fg)] sm:px-6">
      <div className="mx-auto max-w-7xl">
        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <section className="host-card rounded-[2rem] border p-8 sm:p-10">
            <p className="text-xs uppercase tracking-[0.35em] text-[var(--theme-accent-strong)]">Local Supervisor</p>
            <h1 className="host-page-title mt-4 max-w-3xl text-4xl font-semibold tracking-tight sm:text-6xl">
              Bring your local workspaces into a mobile-ready control surface.
            </h1>
            <p className="host-page-description mt-6 max-w-2xl text-base leading-7 sm:text-lg">
              Phase 1 focuses on a stable supervisor shell: runtime config, workspace onboarding,
              database bootstrap, and a read-only file tree that already respects workspace root
              boundaries.
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <Link
                to="/workspaces"
                className="ui-action-primary rounded-full px-5 py-3 font-medium transition"
              >
                Enter Workspace Console
              </Link>
              <Link
                to="/workspaces/new"
                className="host-secondary-button rounded-full border px-5 py-3 font-medium transition"
              >
                Add First Workspace
              </Link>
            </div>
          </section>

          <section className="grid gap-4">
            <StatusCard
              eyebrow="Health"
              title={error ? 'API unavailable' : 'Supervisor reachable'}
              description={
                error ??
                `Connected to ${config?.appName ?? 'Remote Codex Supervisor'} ${config?.appVersion ?? ''}`.trim()
              }
            />
            <StatusCard
              eyebrow="Workspace Root"
              title={config?.workspaceRoot ?? 'Loading root path'}
              description="The file tree and workspace creation flow stay inside this boundary in Phase 1."
            />
            <StatusCard
              eyebrow="Environment"
              title={config?.environment ?? 'Loading environment'}
              description={
                config ? `${config.host}:${config.port}` : 'Runtime metadata appears here after bootstrap.'
              }
            />
          </section>
        </div>
      </div>
    </div>
  );
}
