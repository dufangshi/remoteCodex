import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import type { WorkspaceDto, WorkspaceTreeDto } from '../../../../packages/shared/src/index';
import { WorkspaceTree } from '../components/WorkspaceTree';
import { fetchWorkspace, fetchWorkspaceTree, markWorkspaceOpened } from '../lib/api';

export function WorkspaceDetailPage() {
  const { id = '' } = useParams();
  const [workspace, setWorkspace] = useState<WorkspaceDto | null>(null);
  const [tree, setTree] = useState<WorkspaceTreeDto | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);

      try {
        const workspaceRecord = await fetchWorkspace(id);
        const openedWorkspace = await markWorkspaceOpened(id);
        setWorkspace(openedWorkspace);
        setTree(await fetchWorkspaceTree(workspaceRecord.absPath, showHidden));
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Unable to load workspace details.');
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, [id, showHidden]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-stone-500">Workspace Detail</p>
          <h2 className="mt-2 text-3xl font-semibold text-stone-100">
            {workspace?.label ?? 'Loading workspace'}
          </h2>
          <p className="mt-3 max-w-3xl break-all text-sm leading-6 text-stone-400">
            {workspace?.absPath ?? 'Resolving path...'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 rounded-full border border-stone-700 px-4 py-2 text-sm text-stone-300">
            <input
              type="checkbox"
              checked={showHidden}
              onChange={(event) => setShowHidden(event.target.checked)}
            />
            Show hidden
          </label>
          <Link to="/workspaces" className="rounded-full border border-stone-700 px-4 py-2 text-stone-300 hover:bg-stone-800">
            Back
          </Link>
        </div>
      </div>

      {loading && (
        <div className="rounded-3xl border border-stone-800 bg-stone-900 px-6 py-12 text-center text-stone-400">
          Loading workspace tree...
        </div>
      )}

      {error && (
        <div className="rounded-3xl border border-rose-500/30 bg-rose-500/10 px-6 py-5 text-rose-100">
          {error}
        </div>
      )}

      {!loading && !error && tree && workspace && (
        <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
          <section className="rounded-3xl border border-stone-800 bg-stone-900 p-6">
            <p className="text-xs uppercase tracking-[0.3em] text-stone-500">Workspace Meta</p>
            <dl className="mt-4 space-y-4 text-sm">
              <div>
                <dt className="text-stone-500">ID</dt>
                <dd className="mt-1 break-all text-stone-100">{workspace.id}</dd>
              </div>
              <div>
                <dt className="text-stone-500">Favorite</dt>
                <dd className="mt-1 text-stone-100">{workspace.isFavorite ? 'Yes' : 'No'}</dd>
              </div>
              <div>
                <dt className="text-stone-500">Last Opened</dt>
                <dd className="mt-1 text-stone-100">
                  {workspace.lastOpenedAt
                    ? new Date(workspace.lastOpenedAt).toLocaleString()
                    : 'Just opened for the first time'}
                </dd>
              </div>
            </dl>
          </section>
          <WorkspaceTree rootPath={tree.currentPath} initialNodes={tree.nodes} showHidden={showHidden} />
        </div>
      )}
    </div>
  );
}
