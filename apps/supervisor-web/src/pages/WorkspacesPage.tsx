import { KeyboardEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import type { WorkspaceDto } from '../../../../packages/shared/src/index';
import { RenameDialog } from '../components/RenameDialog';
import { fetchWorkspaces, updateWorkspace, updateWorkspaceFavorite } from '../lib/api';

export function WorkspacesPage() {
  const navigate = useNavigate();
  const [workspaces, setWorkspaces] = useState<WorkspaceDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingWorkspaceId, setEditingWorkspaceId] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState('');
  const [savingWorkspaceId, setSavingWorkspaceId] = useState<string | null>(null);

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
    try {
      const updated = await updateWorkspaceFavorite(workspace.id, {
        isFavorite: !workspace.isFavorite
      });
      setWorkspaces((current) =>
        current.map((item) => (item.id === updated.id ? updated : item))
      );
    } catch (caught) {
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-stone-500">Workspace Registry</p>
          <h2 className="mt-2 text-3xl font-semibold text-stone-100">Your local projects</h2>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            to="/threads/import"
            className="rounded-full border border-stone-700 px-5 py-3 font-medium text-stone-100 transition hover:border-stone-500 hover:bg-stone-900"
          >
            Import Session
          </Link>
          <Link
            to="/workspaces/new"
            className="rounded-full bg-amber-300 px-5 py-3 font-medium text-stone-950 transition hover:bg-amber-200"
          >
            Add Workspace
          </Link>
        </div>
      </div>

      {loading && (
        <div className="rounded-3xl border border-stone-800 bg-stone-900 px-6 py-12 text-center text-stone-400">
          Loading workspace registry...
        </div>
      )}

      {error && (
        <div className="rounded-3xl border border-rose-500/30 bg-rose-500/10 px-6 py-5 text-rose-100">
          {error}
        </div>
      )}

      {!loading && !error && workspaces.length === 0 && (
        <div className="rounded-3xl border border-dashed border-stone-700 bg-stone-900 px-6 py-12 text-center">
          <p className="text-lg font-medium text-stone-100">No workspaces yet</p>
          <p className="mt-2 text-sm text-stone-500">
            Add a local directory inside the configured workspace root to start building the
            registry.
          </p>
        </div>
      )}

      {!loading && workspaces.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {workspaces.map((workspace) => (
            <article
              key={workspace.id}
              role="link"
              tabIndex={0}
              onClick={() => openWorkspaceThreads(workspace.id)}
              onKeyDown={(event) => handleWorkspaceKeyDown(event, workspace.id)}
              className="rounded-3xl border border-stone-800 bg-stone-900 p-6 shadow-2xl shadow-stone-950/10 transition hover:border-stone-700 hover:bg-stone-900/90"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1">
                    <p
                      className="min-w-0 w-fit max-w-[calc(100%-1.25rem)] truncate text-xl font-semibold text-stone-100"
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
                  <p className="mt-2 break-all text-sm text-stone-500">{workspace.absPath}</p>
                </div>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    void handleFavorite(workspace);
                  }}
                  className={`shrink-0 rounded-full px-3 py-2 text-xs uppercase tracking-[0.2em] ${
                    workspace.isFavorite
                      ? 'bg-amber-300 text-stone-950'
                      : 'border border-stone-700 text-stone-300'
                  }`}
                >
                  {workspace.isFavorite ? 'Pinned' : 'Pin'}
                </button>
              </div>
              <div className="mt-6 flex items-center justify-between gap-3 text-sm text-stone-400">
                <span>
                  Last opened:{' '}
                  {workspace.lastOpenedAt ? new Date(workspace.lastOpenedAt).toLocaleString() : 'Never'}
                </span>
                <Link
                  to={`/workspaces/${workspace.id}`}
                  onClick={(event) => event.stopPropagation()}
                  className="text-amber-300 transition hover:text-amber-200"
                >
                  Open tree
                </Link>
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
    </div>
  );
}
