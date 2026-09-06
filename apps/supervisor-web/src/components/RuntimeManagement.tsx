import { useEffect, useState } from 'react';
import { Download, RefreshCw, ChevronDown, RotateCw } from 'lucide-react';
import { ApiError, request } from '../lib/api';
import { FormDialog } from './FormDialog';

type Installation = {
  path: string;
  resolvedPath: string;
  version?: string;
  manager: string;
  canUpdate: boolean;
  updateCommand?: string;
  reason?: string;
};
type Job = {
  state?: string;
  phase?: string;
  action?: string;
  error?: string;
  targetVersion?: string;
};
type Harness = {
  id: string;
  name: string;
  base: Installation | null;
  adapter: Installation | null;
  job?: Job;
};
type Supervisor = {
  runningVersion?: string;
  installedVersion?: string;
  latestVersion?: string;
  canUpdate: boolean;
  reason?: string;
  job?: Job;
};
const active = (job?: Job) =>
  ['running', 'scheduled', 'preparing', 'installing', 'restarting'].includes(
    job?.state ?? job?.phase ?? '',
  );
const button =
  'host-secondary-button inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md border px-2.5 text-xs disabled:opacity-50';
const api = <T,>(path: string, action?: unknown) =>
  request<T>(
    `/api/management/${path}`,
    action
      ? { method: 'POST', body: JSON.stringify(action) }
      : { cache: 'no-store' },
  );

export function RuntimeManagement() {
  const [supervisor, setSupervisor] = useState<Supervisor | null>(null);
  const [harnesses, setHarnesses] = useState<Harness[]>([]);
  const [jobs, setJobs] = useState<Record<string, Job>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{
    id?: string;
    component?: string;
    name: string;
    command?: string | undefined;
  } | null>(null);
  async function load() {
    try {
      const [s, h] = await Promise.all([
        api<Supervisor>('supervisor'),
        api<Harness[]>('harnesses'),
      ]);
      setSupervisor((previous) => ({ ...previous, ...s }));
      setHarnesses(h);
      setJobs(
        Object.fromEntries(
          h.filter((row) => row.job).map((row) => [row.id, row.job!]),
        ),
      );
    } catch (error) {
      // Older devices may serve their SPA fallback for an unknown management route.
      if (
        !(error instanceof SyntaxError) &&
        !(error instanceof ApiError && error.statusCode === 404)
      )
        throw error;
      const current = await request<{ version: string }>('/api/version');
      setSupervisor({
        runningVersion: current.version,
        canUpdate: false,
        reason:
          'Upgrade this device to 0.12.17 or later with its existing installer to enable runtime management.',
      });
      setHarnesses([]);
    }
  }
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);
  const pending = Object.values(jobs).some(active) || active(supervisor?.job);
  useEffect(() => {
    if (!pending) return;
    let stopped = false;
    const timer = window.setInterval(async () => {
      try {
        const [j, s] = await Promise.all([
          api<Record<string, Job>>('jobs'),
          api<Supervisor>('supervisor'),
        ]);
        if (stopped) return;
        setJobs(j);
        setSupervisor((previous) => ({ ...previous, ...s }));
        if (!Object.values(j).some(active) && !active(s.job)) await load();
      } catch {
        /* Temporary disconnect during supervisor replacement; keep polling. */
      }
    }, 2500);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [pending]);
  async function act(id: string, action: string, component = 'base') {
    setBusy(true);
    setError('');
    try {
      await api(`harnesses/${encodeURIComponent(id)}`, { action, component });
      setJobs((prev) => ({ ...prev, [id]: { state: 'running', action } }));
      setConfirm(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to manage harness');
    } finally {
      setBusy(false);
    }
  }
  async function supervisorAction(action: 'check' | 'update') {
    setBusy(true);
    setError('');
    try {
      const next = await api<Supervisor>(`supervisor/${action}`, {});
      setSupervisor((previous) => ({ ...previous, ...next }));
      if (action === 'update' && next.canUpdate) setConfirm(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to update Supervisor');
    } finally {
      setBusy(false);
    }
  }
  function installation(row: Harness, data: Installation, component: string) {
    return (
      <div className="mt-2 min-w-0 text-xs text-[var(--theme-fg-muted)]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>
            {component === 'adapter' ? 'ACP adapter · ' : ''}
            {data.version ?? 'Version unavailable'} · {data.manager}
          </span>
          {data.canUpdate && (
            <button
              className={button}
              disabled={busy || active(jobs[row.id])}
              aria-label={`Update ${row.name}${component === 'adapter' ? ' adapter' : ''}`}
              onClick={() =>
                setConfirm({
                  id: row.id,
                  name: row.name,
                  component,
                  command: data.updateCommand,
                })
              }
            >
              <Download size={13} />
              Update
            </button>
          )}
        </div>
        <p
          className="mt-1 break-all font-mono text-[11px]"
          title={data.resolvedPath}
        >
          {data.path}
        </p>
        {data.reason && <p className="mt-1 leading-5">{data.reason}</p>}
      </div>
    );
  }
  function row(h: Harness) {
    const job = jobs[h.id];
    return (
      <div
        key={h.id}
        className="min-w-0 border-t border-[var(--theme-border)] py-3"
      >
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-sm font-medium">{h.name}</h4>
          <button
            className={button}
            disabled={busy || !h.base || active(job)}
            title="Reload this harness's configuration. Other harnesses stay connected."
            aria-label={`Restart ${h.name}`}
            onClick={() => void act(h.id, 'restart')}
          >
            <RotateCw size={13} />
            Restart
          </button>
        </div>
        {h.base ? (
          installation(h, h.base, 'base')
        ) : (
          <p className="mt-1 text-xs text-[var(--theme-fg-muted)]">
            Not installed
          </p>
        )}
        {h.adapter && (
          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-[var(--theme-fg-muted)]">
              ACP adapter
            </summary>
            {installation(h, h.adapter, 'adapter')}
          </details>
        )}
        {job && (
          <p
            role={job.error ? 'alert' : 'status'}
            className={`mt-2 text-xs ${job.error ? 'text-[var(--status-danger-fg)]' : 'text-[var(--theme-fg-muted)]'}`}
          >
            {job.error ??
              (active(job)
                ? `${job.action === 'update' ? 'Updating' : 'Restarting'}…`
                : 'Ready · configuration reloads on the next turn')}
          </p>
        )}
      </div>
    );
  }
  return (
    <section className="py-5" aria-label="Runtime management">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Supervisor</h3>
          <p className="mt-1 text-xs text-[var(--theme-fg-muted)]">
            {supervisor?.runningVersion
              ? `Running ${supervisor.runningVersion}`
              : 'Loading version…'}
            {supervisor?.latestVersion &&
              ` · Latest ${supervisor.latestVersion}`}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            className={button}
            disabled={busy || !supervisor?.canUpdate || active(supervisor?.job)}
            onClick={() => void supervisorAction('check')}
          >
            <RefreshCw size={13} />
            Check updates
          </button>
          {supervisor?.latestVersion &&
            supervisor.latestVersion !== supervisor.runningVersion &&
            supervisor.canUpdate && (
              <button
                className={button}
                disabled={busy || active(supervisor.job)}
                onClick={() => setConfirm({ name: 'Supervisor' })}
              >
                <Download size={13} />
                Update
              </button>
            )}
        </div>
      </div>
      {supervisor?.installedVersion &&
        supervisor.installedVersion !== supervisor.runningVersion && (
          <p className="mt-2 text-xs">
            Installed {supervisor.installedVersion}; the running process has not
            switched yet.
          </p>
        )}
      {supervisor?.reason && (
        <p role="status" className="mt-2 text-xs text-[var(--theme-fg-muted)]">
          {supervisor.reason}
        </p>
      )}
      {supervisor?.job && (
        <p role="status" className="mt-2 text-xs">
          {supervisor.job.error ??
            `${supervisor.job.phase} · ${supervisor.job.targetVersion ?? ''}`}
        </p>
      )}
      <h3 className="mb-2 mt-6 text-sm font-semibold">Harnesses</h3>
      {harnesses
        .filter((h) => ['codex', 'claude', 'opencode'].includes(h.id))
        .map(row)}
      <details className="border-t border-[var(--theme-border)] pt-3">
        <summary className="flex cursor-pointer items-center justify-between text-sm font-medium">
          ACP agents
          <ChevronDown size={16} />
        </summary>
        {harnesses
          .filter((h) => !['codex', 'claude', 'opencode'].includes(h.id))
          .map(row)}
      </details>
      {error && (
        <p role="alert" className="mt-3 text-xs text-[var(--status-danger-fg)]">
          {error}
        </p>
      )}
      {confirm && (
        <FormDialog
          title={`Update ${confirm.name}`}
          busy={busy}
          onClose={() => setConfirm(null)}
          description={
            confirm.id
              ? 'Update the selected installation, then reload its configuration. Running turns must finish first.'
              : 'The Supervisor will briefly disconnect. An independent system job will install, verify and restart it, and roll back if startup fails. Running turns must finish first.'
          }
        >
          {confirm.command && (
            <code className="break-all text-xs">{confirm.command}</code>
          )}
          {error && (
            <p role="alert" className="text-sm text-[var(--status-danger-fg)]">
              {error}
            </p>
          )}
          <button
            className="relay-button-primary min-h-11"
            disabled={busy}
            onClick={() =>
              void (confirm.id
                ? act(confirm.id, 'update', confirm.component)
                : supervisorAction('update'))
            }
          >
            {busy ? 'Starting…' : 'Update'}
          </button>
        </FormDialog>
      )}
    </section>
  );
}
