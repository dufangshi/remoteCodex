import { KeyboardEvent, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Pencil, Pin, Trash2 } from 'lucide-react';

import type { RuntimeConfigDto, WorkspaceDto } from '@remote-codex/shared';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { LongTextDialog } from '../components/LongTextDialog';
import { RenameDialog } from '../components/RenameDialog';
import { RelayUserMenu } from '../components/RelayUserMenu';
import {
  ApiError,
  deleteWorkspace,
  fetchRuntimeConfig,
  fetchWorkspaces,
  updateWorkspace,
  updateWorkspaceFavorite,
} from '../lib/api';
import { currentRelayScopedPath, currentThreadsHref } from '../lib/relayRoutes';

function sortWorkspaces(left: WorkspaceDto, right: WorkspaceDto) {
  if (left.isFavorite !== right.isFavorite) {
    return left.isFavorite ? -1 : 1;
  }
  return Date.parse(right.lastOpenedAt ?? right.createdAt) - Date.parse(left.lastOpenedAt ?? left.createdAt);
}

function truncatePath(absPath: string, maxLength = 28) {
  return absPath.length <= maxLength ? absPath : `...${absPath.slice(-(maxLength - 3))}`;
}

function errorText(caught: unknown, fallback: string) {
  return caught instanceof Error ? caught.message : fallback;
}

export function WorkspacesPage() {
  const navigate = useNavigate();
  const [workspaces, setWorkspaces] = useState<WorkspaceDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfigDto | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingWorkspaceId, setEditingWorkspaceId] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState('');
  const [savingWorkspaceId, setSavingWorkspaceId] = useState<string | null>(null);
  const [expandedPath, setExpandedPath] = useState<string | null>(null);
  const [deletingWorkspace, setDeletingWorkspace] = useState<WorkspaceDto | null>(null);
  const [deletingWorkspaceBusy, setDeletingWorkspaceBusy] = useState(false);
  const [vmStarting, setVmStarting] = useState(false);
  const [wakeAttempt, setWakeAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const isVmStarting = (result: PromiseRejectedResult) =>
      result.reason instanceof ApiError &&
      result.reason.payload.details?.reason === 'hosted_sandbox_starting';

    const load = async () => {
      const [workspaceResult, runtimeResult] = await Promise.allSettled([
        fetchWorkspaces(),
        fetchRuntimeConfig(),
      ]);
      if (cancelled) {
        return;
      }
      if (
        (workspaceResult.status === 'rejected' && isVmStarting(workspaceResult)) ||
        (runtimeResult.status === 'rejected' && isVmStarting(runtimeResult))
      ) {
        setVmStarting(true);
        setLoading(true);
        setError(null);
        setRuntimeError(null);
        setWakeAttempt((current) => current + 1);
        retryTimer = setTimeout(() => void load(), 1_500);
        return;
      }
      setVmStarting(false);
      setLoading(false);
      if (workspaceResult.status === 'fulfilled') {
        setWorkspaces(workspaceResult.value);
        setError(null);
      } else {
        setError(errorText(workspaceResult.reason, 'Unable to load workspaces.'));
      }
      if (runtimeResult.status === 'fulfilled') {
        setRuntimeConfig(runtimeResult.value);
        setRuntimeError(null);
      } else {
        setRuntimeError(errorText(runtimeResult.reason, 'Unable to load supervisor config.'));
      }
    };

    void load();
    return () => {
      cancelled = true;
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
    };
  }, []);

  const sortedWorkspaces = useMemo(() => [...workspaces].sort(sortWorkspaces), [workspaces]);

  async function handleFavorite(workspace: WorkspaceDto) {
    const nextFavorite = !workspace.isFavorite;
    setWorkspaces((current) =>
      current.map((item) => (item.id === workspace.id ? { ...item, isFavorite: nextFavorite } : item)),
    );
    try {
      const updated = await updateWorkspaceFavorite(workspace.id, { isFavorite: nextFavorite });
      setWorkspaces((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    } catch (caught) {
      setWorkspaces((current) => current.map((item) => (item.id === workspace.id ? workspace : item)));
      setError(errorText(caught, 'Unable to update workspace.'));
    }
  }

  async function handleRenameWorkspace(workspaceId: string) {
    const label = draftLabel.trim();
    if (!label) {
      return;
    }
    setSavingWorkspaceId(workspaceId);
    try {
      const updated = await updateWorkspace(workspaceId, { label });
      setWorkspaces((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setEditingWorkspaceId(null);
      setDraftLabel('');
    } catch (caught) {
      setError(errorText(caught, 'Unable to rename workspace.'));
    } finally {
      setSavingWorkspaceId(null);
    }
  }

  async function handleDeleteWorkspace() {
    if (!deletingWorkspace) {
      return;
    }
    setDeletingWorkspaceBusy(true);
    try {
      await deleteWorkspace(deletingWorkspace.id, {
        confirmWorkspaceId: deletingWorkspace.id,
        confirmLabel: deletingWorkspace.label,
      });
      setWorkspaces((current) => current.filter((item) => item.id !== deletingWorkspace.id));
      setDeletingWorkspace(null);
    } catch (caught) {
      setError(errorText(caught, 'Unable to delete workspace.'));
    } finally {
      setDeletingWorkspaceBusy(false);
    }
  }

  function openWorkspace(workspaceId: string) {
    navigate(currentThreadsHref(workspaceId));
  }

  function handleWorkspaceKeyDown(event: KeyboardEvent<HTMLElement>, workspaceId: string) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openWorkspace(workspaceId);
    }
  }

  return (
    <div className="space-y-4">
      <div className="host-topbar sticky top-[env(safe-area-inset-top)] z-20 -mx-4 border-b px-2.5 py-2 backdrop-blur sm:mx-0 sm:rounded-lg sm:border sm:px-4">
        <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
          <RelayUserMenu />
          <Link
            to={currentRelayScopedPath('/threads/import')}
            className="host-info-pill inline-flex h-8 shrink-0 items-center rounded-md border px-2.5 text-[11px] font-medium uppercase tracking-[0.14em] transition sm:px-3 sm:text-xs sm:tracking-[0.18em]"
          >
            Import
          </Link>
          <Link
            to={currentRelayScopedPath('/workspaces/new')}
            className="ui-action-primary inline-flex h-8 shrink-0 items-center rounded-md px-2.5 text-[11px] font-medium uppercase tracking-[0.14em] transition sm:px-3 sm:text-xs sm:tracking-[0.18em]"
          >
            Create
          </Link>
          <div className="min-w-0 flex-1 text-right">
            <p className="host-page-eyebrow truncate text-[11px] uppercase tracking-[0.24em]">Workspaces</p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="min-w-0 space-y-4">
          {vmStarting ? (
            <div
              aria-live="polite"
              className="overflow-hidden rounded-lg border border-[var(--status-warning-border)] bg-[var(--theme-panel)]"
              role="status"
            >
              <div className="px-5 py-5">
                <p className="text-sm font-semibold text-[var(--theme-fg)]">Starting hosted VM</p>
                <p className="mt-1 text-sm text-[var(--theme-fg-muted)]">
                  Waiting for the supervisor to connect. This page will resume automatically.
                </p>
              </div>
              <div className="h-1 overflow-hidden bg-[var(--theme-muted)]">
                <div className="h-full w-1/3 animate-pulse bg-[var(--theme-accent-solid)]" />
              </div>
              <p className="px-5 py-3 text-xs text-[var(--theme-fg-muted)]">Connection check {wakeAttempt}</p>
            </div>
          ) : loading ? (
            <div className="host-empty-state rounded-lg border px-6 py-12 text-center">Loading workspace registry...</div>
          ) : null}

          {error ? <div className="host-error rounded-lg border px-4 py-4">{error}</div> : null}

          {!loading && !error && workspaces.length === 0 ? (
            <div className="host-empty-state rounded-lg border border-dashed px-6 py-12 text-center">
              <p className="host-page-title text-lg font-medium">No workspaces yet</p>
              <p className="host-muted mt-2 text-sm">
                Add a local directory inside the configured workspace root to start building the registry.
              </p>
            </div>
          ) : null}

          {!loading && sortedWorkspaces.length > 0 ? (
            <div className="space-y-2 overflow-x-hidden">
              {sortedWorkspaces.map((workspace) => (
                <article
                  key={workspace.id}
                  role="link"
                  tabIndex={0}
                  onClick={() => openWorkspace(workspace.id)}
                  onKeyDown={(event) => handleWorkspaceKeyDown(event, workspace.id)}
                  className="host-card relative overflow-hidden rounded-lg border px-4 py-3 transition"
                >
                  <div className="absolute right-2.5 top-2.5 flex items-center gap-1.5">
                    <IconButton
                      label={`Delete workspace ${workspace.label}`}
                      className="border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] text-[var(--status-danger-fg)] hover:bg-[var(--status-danger-border)]"
                      onClick={() => setDeletingWorkspace(workspace)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </IconButton>
                    <IconButton
                      label={workspace.isFavorite ? `Unpin workspace ${workspace.label}` : `Pin workspace ${workspace.label}`}
                      className={workspace.isFavorite ? 'host-warning-pill' : 'host-icon-button'}
                      onClick={() => void handleFavorite(workspace)}
                    >
                      <Pin className={`h-3.5 w-3.5 ${workspace.isFavorite ? 'rotate-[18deg]' : 'rotate-[8deg]'}`} />
                    </IconButton>
                  </div>
                  <div className="min-w-0 pr-[4.6rem]">
                    <div className="flex min-w-0 items-center gap-1">
                      <p className="host-page-title min-w-0 max-w-full truncate text-base font-semibold sm:text-lg" title={workspace.label}>
                        {workspace.label}
                      </p>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setEditingWorkspaceId(workspace.id);
                          setDraftLabel(workspace.label);
                        }}
                        aria-label={`Rename workspace ${workspace.label}`}
                        className="host-muted inline-flex h-4 w-4 shrink-0 items-center justify-center transition hover:text-[var(--theme-fg)]"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                    </div>
                    <button
                      type="button"
                      aria-label={workspace.absPath}
                      title={workspace.absPath}
                      onClick={(event) => {
                        event.stopPropagation();
                        setExpandedPath(workspace.absPath);
                      }}
                      className="host-muted mt-1 inline-block max-w-full overflow-hidden whitespace-nowrap text-left text-[9px] leading-4 transition hover:text-[var(--theme-fg-soft)]"
                    >
                      {truncatePath(workspace.absPath)}
                    </button>
                    <p className="host-muted mt-2 text-xs">
                      Last opened: {workspace.lastOpenedAt ? new Date(workspace.lastOpenedAt).toLocaleString() : 'Never opened'}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          ) : null}
        </section>

        <aside className="space-y-3 xl:sticky xl:top-[calc(env(safe-area-inset-top)+4.25rem)] xl:self-start">
          <section className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-panel)] p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--theme-fg-muted)]">Supervisor</p>
            <dl className="mt-4 space-y-3">
              <RuntimeFact label="Workspace root" value={runtimeConfig?.workspaceRoot ?? (vmStarting ? 'VM is starting…' : 'Loading...')} />
              <RuntimeFact
                label="Environment"
                value={
                  runtimeConfig
                    ? `${runtimeConfig.environment} · ${runtimeConfig.host}:${runtimeConfig.port}`
                    : vmStarting
                      ? 'Connecting automatically…'
                      : runtimeError ?? 'Loading...'
                }
              />
              <RuntimeFact label="Version" value={runtimeConfig ? `${runtimeConfig.appName} ${runtimeConfig.appVersion}` : 'Loading...'} />
              <RuntimeFact label="Workspaces" value={String(workspaces.length)} />
            </dl>
          </section>
          {runtimeError && !vmStarting ? (
            <section className="rounded-lg border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] p-4 text-sm text-[var(--status-warning-fg)]">
              Runtime metadata is unavailable. Workspace actions may still work if a relay device is connected.
            </section>
          ) : null}
        </aside>
      </div>

      <RenameDialog
        open={editingWorkspaceId !== null}
        title="Rename Workspace"
        label="Workspace Label"
        value={draftLabel}
        busy={savingWorkspaceId !== null}
        onChange={setDraftLabel}
        onCancel={() => {
          setEditingWorkspaceId(null);
          setDraftLabel('');
        }}
        onSubmit={() => (editingWorkspaceId ? handleRenameWorkspace(editingWorkspaceId) : undefined)}
      />
      <LongTextDialog
        open={expandedPath !== null}
        title="Workspace Path"
        text={expandedPath ?? ''}
        onClose={() => setExpandedPath(null)}
      />
      <ConfirmDialog
        open={deletingWorkspace !== null}
        title="Delete Workspace"
        description={
          deletingWorkspace
            ? `Delete ${deletingWorkspace.label} from supervisor. This also removes its threads and local supervisor metadata.`
            : ''
        }
        confirmLabel="Delete Workspace"
        busy={deletingWorkspaceBusy}
        onCancel={() => {
          if (!deletingWorkspaceBusy) {
            setDeletingWorkspace(null);
          }
        }}
        onConfirm={() => void handleDeleteWorkspace()}
      />
    </div>
  );
}

function IconButton({
  label,
  className,
  onClick,
  children,
}: {
  label: string;
  className: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-full border transition ${className}`}
    >
      {children}
    </button>
  );
}

function RuntimeFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--theme-fg-muted)]">{label}</dt>
      <dd className="mt-1 break-words font-mono text-xs leading-5 text-[var(--theme-fg)]">{value}</dd>
    </div>
  );
}
