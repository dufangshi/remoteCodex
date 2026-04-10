import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import type { WorkspaceDto } from '../../../../packages/shared/src/index';
import { fetchWorkspaces, updateWorkspaceFavorite } from '../lib/api';

export function WorkspacesPage() {
  const [workspaces, setWorkspaces] = useState<WorkspaceDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
            className="rounded-full bg-amber-200 px-5 py-3 font-medium text-stone-950 transition hover:bg-amber-100"
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
              className="rounded-3xl border border-stone-800 bg-stone-900 p-6 shadow-2xl shadow-stone-950/10"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xl font-semibold text-stone-100">{workspace.label}</p>
                  <p className="mt-2 break-all text-sm text-stone-500">{workspace.absPath}</p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleFavorite(workspace)}
                  className={`rounded-full px-3 py-2 text-xs uppercase tracking-[0.2em] ${
                    workspace.isFavorite
                      ? 'bg-amber-200 text-stone-950'
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
                <Link to={`/workspaces/${workspace.id}`} className="text-amber-200 hover:text-amber-100">
                  Open tree
                </Link>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
