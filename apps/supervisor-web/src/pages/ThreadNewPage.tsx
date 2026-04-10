import type { FormEvent } from 'react';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { ModelOptionDto, WorkspaceDto } from '../../../../packages/shared/src/index';
import { ApiError, createThread, fetchCodexModels, fetchWorkspaces } from '../lib/api';

export function ThreadNewPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [workspaces, setWorkspaces] = useState<WorkspaceDto[]>([]);
  const [models, setModels] = useState<ModelOptionDto[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');
  const [model, setModel] = useState('');
  const [title, setTitle] = useState('');
  const [approvalMode, setApprovalMode] = useState<'yolo' | 'guarded'>('yolo');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const requestedWorkspaceId = searchParams.get('workspaceId');
    Promise.all([fetchWorkspaces(), fetchCodexModels()])
      .then(([workspaceRecords, modelRecords]) => {
        setWorkspaces(workspaceRecords);
        setModels(modelRecords);
        const initialWorkspaceId =
          workspaceRecords.some((workspace) => workspace.id === requestedWorkspaceId)
            ? requestedWorkspaceId!
            : workspaceRecords[0]?.id ?? '';
        setWorkspaceId(initialWorkspaceId);
        setModel(modelRecords.find((entry) => entry.isDefault)?.model ?? modelRecords[0]?.model ?? '');
      })
      .catch((caught) => {
        setError(caught instanceof Error ? caught.message : 'Unable to load creation form data.');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [searchParams]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const thread = await createThread(
        title.trim()
          ? {
              workspaceId,
              model,
              approvalMode,
              title: title.trim()
            }
          : {
              workspaceId,
              model,
              approvalMode
            }
      );
      navigate(`/threads/${thread.id}`);
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.payload.message);
      } else {
        setError(caught instanceof Error ? caught.message : 'Unable to create thread.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-[0.3em] text-stone-500">New Thread</p>
        <h2 className="mt-2 text-3xl font-semibold text-stone-100">Start a Codex session</h2>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-stone-400">
          Choose the workspace, model, and approval mode that should back the new thread.
        </p>
      </div>

      {loading ? (
        <div className="rounded-3xl border border-stone-800 bg-stone-900 px-6 py-12 text-center text-stone-400">
          Loading creation form...
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5 rounded-3xl border border-stone-800 bg-stone-900 p-6">
          <div>
            <label className="text-sm font-medium text-stone-200" htmlFor="thread-workspace">
              Workspace
            </label>
            <select
              id="thread-workspace"
              value={workspaceId}
              onChange={(event) => setWorkspaceId(event.target.value)}
              className="mt-2 w-full rounded-2xl border border-stone-700 bg-stone-950 px-4 py-3 text-stone-100 outline-none transition focus:border-amber-300"
            >
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.label} · {workspace.absPath}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium text-stone-200" htmlFor="thread-model">
              Model
            </label>
            <select
              id="thread-model"
              value={model}
              onChange={(event) => setModel(event.target.value)}
              className="mt-2 w-full rounded-2xl border border-stone-700 bg-stone-950 px-4 py-3 text-stone-100 outline-none transition focus:border-amber-300"
            >
              {models.map((entry) => (
                <option key={entry.id} value={entry.model}>
                  {entry.displayName} · {entry.model}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium text-stone-200" htmlFor="thread-title">
              Title
            </label>
            <input
              id="thread-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Optional. Falls back to first prompt."
              className="mt-2 w-full rounded-2xl border border-stone-700 bg-stone-950 px-4 py-3 text-stone-100 outline-none transition focus:border-amber-300"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-stone-200" htmlFor="thread-approval-mode">
              Approval mode
            </label>
            <select
              id="thread-approval-mode"
              value={approvalMode}
              onChange={(event) => setApprovalMode(event.target.value as 'yolo' | 'guarded')}
              className="mt-2 w-full rounded-2xl border border-stone-700 bg-stone-950 px-4 py-3 text-stone-100 outline-none transition focus:border-amber-300"
            >
              <option value="yolo">yolo</option>
              <option value="guarded">guarded</option>
            </select>
          </div>
          {error && (
            <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={busy || !workspaceId || !model}
            className="rounded-full bg-amber-300 px-5 py-3 font-medium text-stone-950 transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:bg-stone-700 disabled:text-stone-300"
          >
            {busy ? 'Creating...' : 'Create Thread'}
          </button>
        </form>
      )}
    </div>
  );
}
