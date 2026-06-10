import type { FormEvent } from 'react';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import {
  AgentBackendDto,
  AgentBackendIdDto,
  defaultAgentBackendId,
  ModelOptionDto,
  WorkspaceDto,
} from '@remote-codex/shared';
import { useAppShellNav } from '../components/AppShellNavContext';
import {
  ApiError,
  createThread,
  fetchAgentBackends,
  fetchAgentBackendModels,
  fetchWorkspaces,
} from '../lib/api';

function backendCanStartSession(backend: AgentBackendDto) {
  return backend.enabled && backend.capabilities.sessions.resume && backend.capabilities.turns.start;
}

function chooseInitialProvider(
  backends: AgentBackendDto[],
  preferredProvider: AgentBackendIdDto,
) {
  const preferred = backends.find((backend) => backend.provider === preferredProvider);
  if (preferred && backendCanStartSession(preferred)) {
    return preferred.provider;
  }
  return backends.find(backendCanStartSession)?.provider ?? defaultAgentBackendId;
}

export function ThreadNewPage() {
  const navigate = useNavigate();
  const shellNav = useAppShellNav();
  const [searchParams] = useSearchParams();
  const [workspaces, setWorkspaces] = useState<WorkspaceDto[]>([]);
  const [backends, setBackends] = useState<AgentBackendDto[]>([]);
  const [models, setModels] = useState<ModelOptionDto[]>([]);
  const [provider, setProvider] = useState<AgentBackendIdDto>(
    shellNav?.defaultBackend ?? defaultAgentBackendId,
  );
  const [workspaceId, setWorkspaceId] = useState('');
  const [model, setModel] = useState('');
  const requestedTitle = searchParams.get('title');
  const [title, setTitle] = useState(() => requestedTitle ?? '');
  const [approvalMode, setApprovalMode] = useState<'yolo' | 'guarded'>('yolo');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestedWorkspaceId = searchParams.get('workspaceId');
  const defaultBackend = shellNav?.defaultBackend ?? defaultAgentBackendId;

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchWorkspaces(), fetchAgentBackends()])
      .then(async ([workspaceRecords, backendRecords]) => {
        if (cancelled) {
          return;
        }
        const initialProvider = chooseInitialProvider(
          backendRecords,
          defaultBackend,
        );
        setProvider(initialProvider);
        setBackends(backendRecords);
        const modelRecords = await fetchAgentBackendModels(initialProvider);
        if (cancelled) {
          return;
        }
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
        if (cancelled) {
          return;
        }
        setError(caught instanceof Error ? caught.message : 'Unable to load creation form data.');
      })
      .finally(() => {
        if (cancelled) {
          return;
        }
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [defaultBackend, requestedWorkspaceId]);

  useEffect(() => {
    if (!provider) {
      return;
    }

    let cancelled = false;
    setModels([]);
    setModel('');
    setError(null);
    fetchAgentBackendModels(provider)
      .then((modelRecords) => {
        if (cancelled) {
          return;
        }
        setModels(modelRecords);
        setModel(modelRecords.find((entry) => entry.isDefault)?.model ?? modelRecords[0]?.model ?? '');
      })
      .catch((caught) => {
        if (cancelled) {
          return;
        }
        setModels([]);
        setModel('');
        setError(caught instanceof Error ? caught.message : 'Unable to load backend models.');
      });

    return () => {
      cancelled = true;
    };
  }, [provider]);

  function handleCancel() {
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }

    if (requestedWorkspaceId) {
      navigate(`/threads?workspaceId=${encodeURIComponent(requestedWorkspaceId)}`);
      return;
    }

    navigate('/workspaces');
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const thread = await createThread(
        title.trim()
          ? {
              workspaceId,
              provider,
              model,
              approvalMode,
              title: title.trim()
            }
          : {
              workspaceId,
              provider,
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
        <h2 className="mt-2 text-3xl font-semibold text-stone-100">Start a backend session</h2>
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
            <label className="text-sm font-medium text-stone-200" htmlFor="thread-backend">
              Backend
            </label>
            <select
              id="thread-backend"
              value={provider}
              onChange={(event) => {
                const next = event.target.value as AgentBackendIdDto;
                setProvider(next);
              }}
              className="mt-2 w-full rounded-2xl border border-stone-700 bg-stone-950 px-4 py-3 text-stone-100 outline-none transition focus:border-amber-300"
            >
              {backends.map((backend) => (
                <option
                  key={backend.provider}
                  value={backend.provider}
                  disabled={!backendCanStartSession(backend)}
                >
                  {backend.displayName}
                  {backendCanStartSession(backend) ? '' : ' (not available)'}
                </option>
              ))}
            </select>
          </div>
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
              disabled={models.length === 0}
              className="mt-2 w-full rounded-2xl border border-stone-700 bg-stone-950 px-4 py-3 text-stone-100 outline-none transition focus:border-amber-300"
            >
              {models.length === 0 ? (
                <option value="">No models available</option>
              ) : null}
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
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={busy || !workspaceId || !model}
              className="rounded-full bg-amber-300 px-5 py-3 font-medium text-stone-950 transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:bg-stone-700 disabled:text-stone-300"
            >
              {busy ? 'Creating...' : 'Create Thread'}
            </button>
            <button
              type="button"
              onClick={handleCancel}
              disabled={busy}
              className="rounded-full border border-stone-700 px-5 py-3 font-medium text-stone-200 transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:border-stone-800 disabled:text-stone-500"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
