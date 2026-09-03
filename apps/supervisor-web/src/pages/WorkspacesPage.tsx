import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  ArrowLeft,
  ChevronDown,
  Eye,
  FileInput,
  MoreHorizontal,
  Pencil,
  Pin,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';

import type { RuntimeConfigDto, WorkspaceDto } from '@remote-codex/shared';
import {
  AppShellMenuButton,
  AppShellNavigationMenu,
} from '../components/AppShellNavigation';
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
import {
  currentRelayScopedPath,
  currentThreadsHref,
  relayDeviceIdFromPath,
} from '../lib/relayRoutes';

function sortWorkspaces(left: WorkspaceDto, right: WorkspaceDto) {
  if (left.isFavorite !== right.isFavorite) {
    return left.isFavorite ? -1 : 1;
  }
  return Date.parse(right.lastOpenedAt ?? right.createdAt) - Date.parse(left.lastOpenedAt ?? left.createdAt);
}

function errorText(caught: unknown, fallback: string) {
  return caught instanceof Error ? caught.message : fallback;
}

function lastOpenedLabel(value: string | null) {
  if (!value) {
    return 'Not opened yet';
  }

  return `Opened ${new Date(value).toLocaleString()}`;
}

export function WorkspacesPage() {
  const location = useLocation();
  const relayDeviceId = relayDeviceIdFromPath(location.pathname);
  const [workspaces, setWorkspaces] = useState<WorkspaceDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfigDto | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingWorkspaceId, setEditingWorkspaceId] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState('');
  const [savingWorkspaceId, setSavingWorkspaceId] = useState<string | null>(null);
  const [favoriteWorkspaceId, setFavoriteWorkspaceId] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [expandedPath, setExpandedPath] = useState<string | null>(null);
  const [deletingWorkspace, setDeletingWorkspace] = useState<WorkspaceDto | null>(null);
  const [deletingWorkspaceBusy, setDeletingWorkspaceBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
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
  }, [loadAttempt]);

  const sortedWorkspaces = useMemo(() => [...workspaces].sort(sortWorkspaces), [workspaces]);

  async function handleFavorite(workspace: WorkspaceDto) {
    if (favoriteWorkspaceId) {
      return;
    }

    const nextFavorite = !workspace.isFavorite;
    setFavoriteWorkspaceId(workspace.id);
    setError(null);
    setWorkspaces((current) =>
      current.map((item) => (item.id === workspace.id ? { ...item, isFavorite: nextFavorite } : item)),
    );
    try {
      const updated = await updateWorkspaceFavorite(workspace.id, { isFavorite: nextFavorite });
      setWorkspaces((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    } catch (caught) {
      setWorkspaces((current) => current.map((item) => (item.id === workspace.id ? workspace : item)));
      setError(errorText(caught, 'Unable to update workspace.'));
    } finally {
      setFavoriteWorkspaceId(null);
    }
  }

  async function handleRenameWorkspace(workspaceId: string) {
    const label = draftLabel.trim();
    if (!label) {
      return;
    }
    setSavingWorkspaceId(workspaceId);
    setError(null);
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
    setDeleteError(null);
    try {
      await deleteWorkspace(deletingWorkspace.id, {
        confirmWorkspaceId: deletingWorkspace.id,
        confirmLabel: deletingWorkspace.label,
      });
      setWorkspaces((current) => current.filter((item) => item.id !== deletingWorkspace.id));
      setDeletingWorkspace(null);
    } catch (caught) {
      setDeleteError(errorText(caught, 'Unable to delete workspace.'));
    } finally {
      setDeletingWorkspaceBusy(false);
    }
  }

  function beginRename(workspace: WorkspaceDto) {
    setOpenMenuId(null);
    setError(null);
    setEditingWorkspaceId(workspace.id);
    setDraftLabel(workspace.label);
  }

  function beginDelete(workspace: WorkspaceDto) {
    setOpenMenuId(null);
    setDeleteError(null);
    setDeletingWorkspace(workspace);
  }

  const runtimeSummary = runtimeConfig
    ? runtimeConfig.workspaceRoot
    : vmStarting
      ? 'Connecting to hosted supervisor...'
      : runtimeError ?? 'Checking runtime...';

  return (
    <div className="product-page space-y-4">
      <header className="product-topbar -mx-4 px-2 sm:mx-0 sm:rounded-lg sm:border sm:px-3">
        <div className="relative shrink-0">
          <AppShellMenuButton className="!h-11 !w-11 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent-ring)]" />
          <AppShellNavigationMenu className="absolute left-0 top-[calc(100%+0.5rem)] z-50 w-64" />
        </div>

        {relayDeviceId ? (
          <Link
            to="/relay-devices"
            aria-label="Back to devices"
            title="Back to devices"
            className="host-secondary-button inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent-ring)] md:w-auto md:gap-2 md:px-3"
          >
            <ArrowLeft aria-hidden="true" className="h-4 w-4" />
            <span className="hidden md:inline">Devices</span>
          </Link>
        ) : null}

        <div className="min-w-0 flex-1 px-1">
          <h1 className="product-title truncate !text-sm sm:!text-base">Workspaces</h1>
          <p className="host-muted hidden truncate text-xs lg:block">
            {loading ? 'Loading registry' : `${workspaces.length} registered`}
          </p>
        </div>

        <Link
          to={currentRelayScopedPath('/threads/import')}
          aria-label="Import session"
          title="Import session"
          className="host-secondary-button inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent-ring)] sm:w-auto sm:gap-2 sm:px-3"
        >
          <FileInput aria-hidden="true" className="h-4 w-4" />
          <span className="hidden sm:inline">Import</span>
        </Link>
        {!loading && workspaces.length > 0 ? (
          <Link
            to={currentRelayScopedPath('/workspaces/new')}
            aria-label="Add workspace"
            title="Add workspace"
            className="ui-action-primary inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-sm font-medium transition sm:w-auto sm:gap-2 sm:px-3.5"
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
            <span className="hidden sm:inline">Add workspace</span>
          </Link>
        ) : null}
        <RelayUserMenu
          className="[&>button]:!h-11 [&>button]:!w-11"
          menuAlign="right"
        />
      </header>

      <details className="group border-y border-[var(--theme-border)]">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 py-2.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--theme-accent-ring)] [&::-webkit-details-marker]:hidden">
          <span
            aria-hidden="true"
            className={`h-2 w-2 shrink-0 rounded-full ${
              runtimeError && !vmStarting
                ? 'bg-[var(--status-warning-fg)]'
                : runtimeConfig
                  ? 'bg-[var(--status-success-fg)]'
                  : 'animate-pulse bg-[var(--theme-fg-muted)]'
            }`}
          />
          <span className="shrink-0 font-medium text-[var(--theme-fg)]">Supervisor</span>
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-[var(--theme-fg-muted)]" title={runtimeSummary}>
            {runtimeSummary}
          </span>
          <span className="hidden shrink-0 text-xs tabular-nums text-[var(--theme-fg-muted)] sm:inline">
            {workspaces.length} {workspaces.length === 1 ? 'workspace' : 'workspaces'}
          </span>
          <ChevronDown
            aria-hidden="true"
            className="h-4 w-4 shrink-0 text-[var(--theme-fg-muted)] transition-transform duration-200 group-open:rotate-180"
          />
        </summary>
        <dl className="grid gap-x-8 gap-y-3 border-t border-[var(--theme-border)] py-3 sm:grid-cols-2 lg:grid-cols-3">
          <RuntimeFact label="Workspace root" value={runtimeSummary} />
          <RuntimeFact
            label="Environment"
            value={
              runtimeConfig
                ? `${runtimeConfig.environment} | ${runtimeConfig.host}:${runtimeConfig.port}`
                : runtimeError ?? 'Not available'
            }
          />
          <RuntimeFact
            label="Version"
            value={runtimeConfig ? `${runtimeConfig.appName} ${runtimeConfig.appVersion}` : 'Not available'}
          />
        </dl>
      </details>

      {vmStarting ? (
        <div
          aria-live="polite"
          className="overflow-hidden border-y border-[var(--status-warning-border)] bg-[var(--status-warning-bg)]"
          role="status"
        >
          <div className="flex items-center justify-between gap-4 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[var(--status-warning-fg)]">Starting hosted VM</p>
              <p className="mt-0.5 text-sm text-[var(--theme-fg-muted)]">
                Waiting for the supervisor. This page will resume automatically.
              </p>
            </div>
            <span className="shrink-0 text-xs tabular-nums text-[var(--theme-fg-muted)]">
              Check {wakeAttempt}
            </span>
          </div>
          <div className="h-1 overflow-hidden bg-[var(--theme-muted)]">
            <div className="h-full w-1/3 animate-pulse bg-[var(--theme-accent-solid)]" />
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="host-error flex min-h-11 flex-col gap-3 rounded-md border px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between" role="alert">
          <span>{error}</span>
          {!editingWorkspaceId ? (
            <button
              className="host-secondary-button inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-md border px-3 text-xs font-semibold"
              onClick={() => setLoadAttempt((attempt) => attempt + 1)}
              type="button"
            >
              <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />
              Retry
            </button>
          ) : null}
        </div>
      ) : null}

      {loading && !vmStarting ? (
        <div className="product-list" aria-label="Loading workspaces" aria-busy="true">
          {[0, 1, 2].map((item) => (
            <div key={item} className="product-row min-h-[5.5rem]">
              <div className="min-w-0 flex-1 space-y-2.5">
                <div className="product-skeleton h-4 w-40 max-w-[65%]" />
                <div className="product-skeleton h-3 w-72 max-w-[85%]" />
              </div>
              <div className="product-skeleton h-9 w-20" />
            </div>
          ))}
        </div>
      ) : null}

      {!loading && !error && workspaces.length === 0 ? (
        <section className="product-panel">
          <div className="product-empty">
            <div>
              <h2 className="text-lg font-semibold text-[var(--theme-fg)]">No workspaces yet</h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6">
                Add a folder on this device, connect an existing path, or clone a Git repository.
              </p>
              <Link
                to={currentRelayScopedPath('/workspaces/new')}
                className="ui-action-primary mt-5 inline-flex h-11 items-center gap-2 rounded-md px-4 text-sm font-medium transition"
              >
                <Plus aria-hidden="true" className="h-4 w-4" />
                Add workspace
              </Link>
            </div>
          </div>
        </section>
      ) : null}

      {!loading && sortedWorkspaces.length > 0 ? (
        <section aria-label="Workspace registry">
          <div className="product-list !overflow-visible">
            {sortedWorkspaces.map((workspace) => {
              const menuOpen = openMenuId === workspace.id;
              const favoriteBusy = favoriteWorkspaceId === workspace.id;

              return (
                <article
                  key={workspace.id}
                  className={`product-row relative !grid min-w-0 grid-cols-[minmax(0,1fr)_auto] !gap-0 !p-0 ${
                    menuOpen ? 'z-20' : ''
                  }`}
                >
                  <Link
                    to={currentThreadsHref(workspace.id)}
                    className="group min-w-0 px-4 py-3.5 focus:outline-none focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--theme-accent-ring)] sm:px-5"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-sm font-semibold text-[var(--theme-fg)] sm:text-base">
                        {workspace.label}
                      </span>
                      {workspace.isFavorite ? (
                        <span className="host-warning-pill shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase">
                          Pinned
                        </span>
                      ) : null}
                    </span>
                    <span
                      className="mt-1 block truncate font-mono text-xs leading-5 text-[var(--theme-fg-muted)]"
                      title={workspace.absPath}
                    >
                      {workspace.absPath}
                    </span>
                    <time
                      dateTime={workspace.lastOpenedAt ?? undefined}
                      className="mt-1 block text-xs text-[var(--theme-fg-muted)]"
                    >
                      {lastOpenedLabel(workspace.lastOpenedAt)}
                    </time>
                  </Link>

                  <div className="flex items-center gap-1 pr-2 sm:pr-3">
                    <button
                      type="button"
                      disabled={favoriteBusy}
                      onClick={() => void handleFavorite(workspace)}
                      aria-label={workspace.isFavorite ? `Unpin ${workspace.label}` : `Pin ${workspace.label}`}
                      title={workspace.isFavorite ? 'Unpin workspace' : 'Pin workspace'}
                      className={`product-icon-button disabled:cursor-wait disabled:opacity-60 ${
                        workspace.isFavorite
                          ? 'text-[var(--status-warning-fg)] hover:bg-[var(--status-warning-bg)]'
                          : ''
                      }`}
                    >
                      <Pin
                        aria-hidden="true"
                        className={`h-4 w-4 ${workspace.isFavorite ? 'rotate-[18deg] fill-current' : 'rotate-[8deg]'}`}
                      />
                    </button>
                    <WorkspaceActionsMenu
                      workspace={workspace}
                      open={menuOpen}
                      onOpenChange={(nextOpen) => setOpenMenuId(nextOpen ? workspace.id : null)}
                      onViewPath={() => setExpandedPath(workspace.absPath)}
                      onRename={() => beginRename(workspace)}
                      onDelete={() => beginDelete(workspace)}
                    />
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      <RenameDialog
        open={editingWorkspaceId !== null}
        title="Rename workspace"
        label="Workspace label"
        value={draftLabel}
        busy={savingWorkspaceId !== null}
        error={editingWorkspaceId ? error : null}
        onChange={setDraftLabel}
        onCancel={() => {
          setEditingWorkspaceId(null);
          setDraftLabel('');
          setError(null);
        }}
        onSubmit={() => (editingWorkspaceId ? handleRenameWorkspace(editingWorkspaceId) : undefined)}
      />
      <LongTextDialog
        open={expandedPath !== null}
        title="Workspace path"
        text={expandedPath ?? ''}
        onClose={() => setExpandedPath(null)}
      />
      <ConfirmDialog
        open={deletingWorkspace !== null}
        title="Delete workspace?"
        description={
          deletingWorkspace
            ? `Remove ${deletingWorkspace.label} and its threads from this supervisor. Files on disk are not deleted.${
                deleteError ? ` The last attempt failed: ${deleteError}` : ''
              }`
            : ''
        }
        confirmLabel="Delete workspace"
        busy={deletingWorkspaceBusy}
        error={deleteError}
        onCancel={() => {
          if (!deletingWorkspaceBusy) {
            setDeletingWorkspace(null);
            setDeleteError(null);
          }
        }}
        onConfirm={() => void handleDeleteWorkspace()}
      />
    </div>
  );
}

function WorkspaceActionsMenu({
  workspace,
  open,
  onOpenChange,
  onViewPath,
  onRename,
  onDelete,
}: {
  workspace: WorkspaceDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onViewPath: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuId = `workspace-actions-${workspace.id}`;

  useEffect(() => {
    if (!open) {
      return;
    }

    const focusFirstItem = window.requestAnimationFrame(() => {
      menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    });

    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        onOpenChange(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onOpenChange(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFirstItem);
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onOpenChange, open]);

  function handleMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [],
    );
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);

    if (event.key === 'Tab') {
      onOpenChange(false);
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || items.length === 0) {
      return;
    }

    event.preventDefault();
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : event.key === 'ArrowDown'
            ? (currentIndex + 1) % items.length
            : (currentIndex - 1 + items.length) % items.length;
    items[nextIndex]?.focus();
  }

  function runAction(action: () => void) {
    triggerRef.current?.focus();
    onOpenChange(false);
    action();
  }

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        aria-label={`More actions for ${workspace.label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title="Workspace actions"
        onClick={() => onOpenChange(!open)}
        className="product-icon-button"
      >
        <MoreHorizontal aria-hidden="true" className="h-5 w-5" />
      </button>
      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={`Actions for ${workspace.label}`}
          onKeyDown={handleMenuKeyDown}
          className="absolute right-0 top-[calc(100%+0.375rem)] z-30 w-52 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-panel)] p-1.5 shadow-[var(--theme-shadow)]"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => runAction(onViewPath)}
            className="flex min-h-11 w-full items-center gap-3 rounded-md px-3 text-left text-sm text-[var(--theme-fg)] transition hover:bg-[var(--theme-hover)] focus:outline-none focus-visible:bg-[var(--theme-hover)]"
          >
            <Eye aria-hidden="true" className="h-4 w-4 text-[var(--theme-fg-muted)]" />
            View full path
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => runAction(onRename)}
            className="flex min-h-11 w-full items-center gap-3 rounded-md px-3 text-left text-sm text-[var(--theme-fg)] transition hover:bg-[var(--theme-hover)] focus:outline-none focus-visible:bg-[var(--theme-hover)]"
          >
            <Pencil aria-hidden="true" className="h-4 w-4 text-[var(--theme-fg-muted)]" />
            Rename
          </button>
          <div className="my-1 border-t border-[var(--theme-border)]" />
          <button
            type="button"
            role="menuitem"
            onClick={() => runAction(onDelete)}
            className="flex min-h-11 w-full items-center gap-3 rounded-md px-3 text-left text-sm text-[var(--status-danger-fg)] transition hover:bg-[var(--status-danger-bg)] focus:outline-none focus-visible:bg-[var(--status-danger-bg)]"
          >
            <Trash2 aria-hidden="true" className="h-4 w-4" />
            Delete workspace
          </button>
        </div>
      ) : null}
    </div>
  );
}

function RuntimeFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-[var(--theme-fg-muted)]">{label}</dt>
      <dd className="mt-0.5 break-words font-mono text-xs leading-5 text-[var(--theme-fg)]">{value}</dd>
    </div>
  );
}
