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
    <div className="min-h-screen bg-stone-950 px-4 py-8 text-stone-100 sm:px-6">
      <div className="mx-auto max-w-7xl">
        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <section className="rounded-[2rem] border border-stone-800 bg-stone-900 p-8 shadow-2xl shadow-stone-950/20 sm:p-10">
            <p className="text-xs uppercase tracking-[0.35em] text-amber-300">Local Supervisor</p>
            <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight text-stone-100 sm:text-6xl">
              Bring your local workspaces into a mobile-ready control surface.
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-7 text-stone-400 sm:text-lg">
              Phase 1 focuses on a stable supervisor shell: runtime config, workspace onboarding,
              database bootstrap, and a read-only file tree that already respects workspace root
              boundaries.
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <Link
                to="/workspaces"
                className="rounded-full bg-amber-300 px-5 py-3 font-medium text-stone-950 transition hover:bg-amber-200"
              >
                Enter Workspace Console
              </Link>
              <Link
                to="/workspaces/new"
                className="rounded-full border border-stone-700 px-5 py-3 font-medium text-stone-200 transition hover:border-stone-500 hover:bg-stone-800"
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
