import { KeyboardEvent, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import type { WorkspaceDto } from '../../../../packages/shared/src/index';
import { useAppShellNav } from '../components/AppShellNavContext';
import { LongTextDialog } from '../components/LongTextDialog';
import { RenameDialog } from '../components/RenameDialog';
import { fetchWorkspaces, updateWorkspace, updateWorkspaceFavorite } from '../lib/api';

function workspaceSortTimestamp(workspace: WorkspaceDto) {
  return Date.parse(workspace.lastOpenedAt ?? workspace.createdAt);
}

function compareWorkspaces(left: WorkspaceDto, right: WorkspaceDto) {
  if (left.isFavorite !== right.isFavorite) {
    return left.isFavorite ? -1 : 1;
  }

  return workspaceSortTimestamp(right) - workspaceSortTimestamp(left);
}

function formatRecentLabel(timestamp: string | null) {
  if (!timestamp) {
    return 'Never opened';
  }

  return new Date(timestamp).toLocaleString();
}

function truncatePathFromFront(absPath: string, maxLength = 42) {
  if (absPath.length <= maxLength) {
    return absPath;
  }

  return `...${absPath.slice(-(maxLength - 3))}`;
}

function PinIcon({ active }: { active: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className={`h-3.5 w-3.5 fill-current ${active ? 'rotate-[18deg]' : 'rotate-[8deg]'}`}
    >
      <path d="M10.7 1.75c.34 0 .62.28.62.63v1.24l1.43 1.42c.24.24.24.62 0 .86l-1.1 1.1v2.02c0 .17-.07.33-.19.45l-1.5 1.5v2.28c0 .28-.18.53-.44.6a.62.62 0 0 1-.69-.24L7.2 12.4l-2.83 2.83a.625.625 0 1 1-.88-.88l2.83-2.83-2.2-1.62a.62.62 0 0 1-.24-.69c.08-.26.32-.44.6-.44h2.28l1.5-1.5a.64.64 0 0 1 .45-.18h2.02l1.1-1.11-1.42-1.42H9.07a.63.63 0 0 1-.62-.63c0-.34.28-.62.62-.62h1.63Z" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-4 w-4 fill-current"
    >
      <path d="M2 3.25h12v1.5H2Zm0 4h12v1.5H2Zm0 4h12v1.5H2Z" />
    </svg>
  );
}

export function WorkspacesPage() {
  const navigate = useNavigate();
  const shellNav = useAppShellNav();
  const [workspaces, setWorkspaces] = useState<WorkspaceDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingWorkspaceId, setEditingWorkspaceId] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState('');
  const [savingWorkspaceId, setSavingWorkspaceId] = useState<string | null>(null);
  const [expandedPath, setExpandedPath] = useState<string | null>(null);

  async function loadWorkspaces() {
    setLoading(true);
    setError(null);

    try {
      setWorkspaces(await fetchWorkspaces());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load workspaces.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadWorkspaces();
  }, []);

  async function handleFavorite(workspace: WorkspaceDto) {
    const optimisticWorkspace = {
      ...workspace,
      isFavorite: !workspace.isFavorite,
    };

    setWorkspaces((current) =>
      current.map((item) =>
        item.id === workspace.id ? optimisticWorkspace : item,
      ),
    );

    try {
      const updated = await updateWorkspaceFavorite(workspace.id, {
        isFavorite: !workspace.isFavorite
      });
      setWorkspaces((current) =>
        current.map((item) => (item.id === updated.id ? updated : item))
      );
    } catch (caught) {
      setWorkspaces((current) =>
        current.map((item) => (item.id === workspace.id ? workspace : item)),
      );
      setError(caught instanceof Error ? caught.message : 'Unable to update workspace.');
    }
  }

  async function handleRenameWorkspace(workspaceId: string) {
    const normalizedLabel = draftLabel.trim();
    if (!normalizedLabel) {
      return;
    }

    setSavingWorkspaceId(workspaceId);
    try {
      const updated = await updateWorkspace(workspaceId, {
        label: normalizedLabel
      });
      setWorkspaces((current) =>
        current.map((item) => (item.id === updated.id ? updated : item))
      );
      setEditingWorkspaceId(null);
      setDraftLabel('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to rename workspace.');
    } finally {
      setSavingWorkspaceId(null);
    }
  }

  function beginRenameWorkspace(workspace: WorkspaceDto) {
    setEditingWorkspaceId(workspace.id);
    setDraftLabel(workspace.label);
  }

  function cancelRenameWorkspace() {
    setEditingWorkspaceId(null);
    setDraftLabel('');
  }

  function openWorkspaceThreads(workspaceId: string) {
    navigate(`/threads?workspaceId=${encodeURIComponent(workspaceId)}`);
  }

  function handleWorkspaceKeyDown(event: KeyboardEvent<HTMLElement>, workspaceId: string) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openWorkspaceThreads(workspaceId);
    }
  }

  const sortedWorkspaces = useMemo(
    () => [...workspaces].sort(compareWorkspaces),
    [workspaces],
  );

  return (
    <div className="space-y-4">
      <div className="sticky top-[env(safe-area-inset-top)] z-20 -mx-4 border-b border-stone-800/90 bg-stone-950/96 px-2.5 py-2 backdrop-blur sm:mx-0 sm:rounded-[1.4rem] sm:border sm:px-4">
        <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
          <button
            type="button"
            aria-label="Open Navigation"
            onClick={() => shellNav?.toggleNav()}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-stone-700 bg-stone-900/92 text-stone-200 transition hover:bg-stone-800"
          >
            <MenuIcon />
          </button>
          <Link
            to="/threads/import"
            className="inline-flex h-8 shrink-0 items-center rounded-full border border-sky-400/30 bg-sky-400/10 px-2.5 text-[11px] font-medium uppercase tracking-[0.14em] text-sky-100 transition hover:border-sky-300/45 hover:bg-sky-400/16 sm:px-3 sm:text-xs sm:tracking-[0.18em]"
          >
            Import
          </Link>
          <Link
            to="/workspaces/new"
            className="inline-flex h-8 shrink-0 items-center rounded-full bg-amber-300 px-2.5 text-[11px] font-medium uppercase tracking-[0.14em] text-stone-950 transition hover:bg-amber-200 sm:px-3 sm:text-xs sm:tracking-[0.18em]"
          >
            Create
          </Link>
          <div className="min-w-0 flex-1 text-right">
            <p className="truncate text-[11px] uppercase tracking-[0.24em] text-stone-500">
              Workspaces
            </p>
          </div>
        </div>
      </div>

      {loading && (
        <div className="rounded-[1.6rem] border border-stone-800 bg-stone-900/85 px-6 py-12 text-center text-stone-400">
          Loading workspace registry...
        </div>
      )}

      {error && (
        <div className="rounded-[1.4rem] border border-rose-500/30 bg-rose-500/10 px-4 py-4 text-rose-100">
          {error}
        </div>
      )}

      {!loading && !error && workspaces.length === 0 && (
        <div className="rounded-[1.6rem] border border-dashed border-stone-700 bg-stone-900/80 px-6 py-12 text-center">
          <p className="text-lg font-medium text-stone-100">No workspaces yet</p>
          <p className="mt-2 text-sm text-stone-500">
            Add a local directory inside the configured workspace root to start building the
            registry.
          </p>
        </div>
      )}

      {!loading && sortedWorkspaces.length > 0 && (
        <div className="space-y-2 overflow-x-hidden">
          {sortedWorkspaces.map((workspace) => (
            <article
              key={workspace.id}
              role="link"
              tabIndex={0}
              onClick={() => openWorkspaceThreads(workspace.id)}
              onKeyDown={(event) => handleWorkspaceKeyDown(event, workspace.id)}
              className="relative overflow-hidden rounded-[1.35rem] border border-stone-800 bg-stone-900/88 px-4 py-3 shadow-lg shadow-stone-950/10 transition hover:border-stone-700 hover:bg-stone-900"
            >
              <button
                type="button"
                aria-label={
                  workspace.isFavorite
                    ? `Unpin workspace ${workspace.label}`
                    : `Pin workspace ${workspace.label}`
                }
                title={workspace.isFavorite ? 'Unpin workspace' : 'Pin workspace'}
                onClick={(event) => {
                  event.stopPropagation();
                  void handleFavorite(workspace);
                }}
                className={`absolute right-2.5 top-2.5 inline-flex h-7 w-7 items-center justify-center rounded-full border transition ${
                  workspace.isFavorite
                    ? 'border-amber-300/40 bg-amber-300/15 text-amber-200'
                    : 'border-stone-700 bg-stone-900/72 text-stone-500 hover:text-stone-200'
                }`}
              >
                <PinIcon active={workspace.isFavorite} />
              </button>
              <div className="flex min-w-0 items-start gap-3 pr-10">
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-1">
                    <p
                      className="min-w-0 max-w-full truncate text-sm font-semibold text-stone-100 sm:text-base"
                      title={workspace.label}
                    >
                      {workspace.label}
                    </p>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        beginRenameWorkspace(workspace);
                      }}
                      aria-label={`Rename workspace ${workspace.label}`}
                      className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-stone-500 transition hover:text-stone-100"
                    >
                      <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3 w-3 fill-current">
                        <path d="m11.9 1.6 2.5 2.5-8.2 8.2-3.3.7.7-3.3 8.3-8.1Zm-7.3 8.7-.3 1.3 1.3-.3 6.9-6.9-1-1-6.9 6.9Zm8.8-7.8-1-1-1 1 1 1 1-1Z" />
                      </svg>
                    </button>
                  </div>
                  <button
                    type="button"
                    title={workspace.absPath}
                    onClick={(event) => {
                      event.stopPropagation();
                      setExpandedPath(workspace.absPath);
                    }}
                    className="mt-1.5 block max-w-full truncate text-left text-sm text-stone-500 transition hover:text-stone-300"
                  >
                    {truncatePathFromFront(workspace.absPath)}
                  </button>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-stone-500">
                    <span className="min-w-0 truncate">
                      Last opened: {formatRecentLabel(workspace.lastOpenedAt)}
                    </span>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      <RenameDialog
        open={editingWorkspaceId !== null}
        title="Rename Workspace"
        label="Workspace Label"
        value={draftLabel}
        busy={savingWorkspaceId !== null}
        onChange={setDraftLabel}
        onCancel={cancelRenameWorkspace}
        onSubmit={() => editingWorkspaceId ? handleRenameWorkspace(editingWorkspaceId) : undefined}
      />
      <LongTextDialog
        open={expandedPath !== null}
        title="Workspace Path"
        text={expandedPath ?? ''}
        onClose={() => setExpandedPath(null)}
      />
    </div>
  );
}
