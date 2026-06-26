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
import {
  currentThreadHref,
  currentThreadsHref,
  currentWorkspacesHref,
} from '../lib/relayRoutes';

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
      navigate(currentThreadsHref(requestedWorkspaceId));
      return;
    }

    navigate(currentWorkspacesHref());
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
      navigate(currentThreadHref(thread.id));
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
        <p className="host-page-eyebrow text-xs uppercase tracking-[0.3em]">New Thread</p>
        <h2 className="host-page-title mt-2 text-3xl font-semibold">Start a backend session</h2>
        <p className="host-page-description mt-3 max-w-2xl text-sm leading-6">
          Choose the workspace, model, and approval mode that should back the new thread.
        </p>
      </div>

      {loading ? (
        <div className="host-empty-state rounded-3xl border px-6 py-12 text-center">
          Loading creation form...
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="host-panel space-y-5 rounded-3xl border p-6">
          <div>
            <label className="host-form-label text-sm font-medium" htmlFor="thread-backend">
              Backend
            </label>
            <select
              id="thread-backend"
              value={provider}
              onChange={(event) => {
                const next = event.target.value as AgentBackendIdDto;
                setProvider(next);
              }}
              className="host-form-control mt-2 w-full rounded-2xl border px-4 py-3 outline-none transition"
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
            <label className="host-form-label text-sm font-medium" htmlFor="thread-workspace">
              Workspace
            </label>
            <select
              id="thread-workspace"
              value={workspaceId}
              onChange={(event) => setWorkspaceId(event.target.value)}
              className="host-form-control mt-2 w-full rounded-2xl border px-4 py-3 outline-none transition"
            >
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.label} · {workspace.absPath}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="host-form-label text-sm font-medium" htmlFor="thread-model">
              Model
            </label>
            <select
              id="thread-model"
              value={model}
              onChange={(event) => setModel(event.target.value)}
              disabled={models.length === 0}
              className="host-form-control mt-2 w-full rounded-2xl border px-4 py-3 outline-none transition"
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
            <label className="host-form-label text-sm font-medium" htmlFor="thread-title">
              Title
            </label>
            <input
              id="thread-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Optional. Falls back to first prompt."
              className="host-form-control mt-2 w-full rounded-2xl border px-4 py-3 outline-none transition"
            />
          </div>
          <div>
            <label className="host-form-label text-sm font-medium" htmlFor="thread-approval-mode">
              Approval mode
            </label>
            <select
              id="thread-approval-mode"
              value={approvalMode}
              onChange={(event) => setApprovalMode(event.target.value as 'yolo' | 'guarded')}
              className="host-form-control mt-2 w-full rounded-2xl border px-4 py-3 outline-none transition"
            >
              <option value="yolo">yolo</option>
              <option value="guarded">guarded</option>
            </select>
          </div>
          {error && (
            <div className="host-error rounded-2xl border px-4 py-3 text-sm">
              {error}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={busy || !workspaceId || !model}
              className="ui-action-primary rounded-full px-5 py-3 font-medium transition disabled:cursor-not-allowed"
            >
              {busy ? 'Creating...' : 'Create Thread'}
            </button>
            <button
              type="button"
              onClick={handleCancel}
              disabled={busy}
              className="host-secondary-button rounded-full border px-5 py-3 font-medium transition disabled:cursor-not-allowed disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
