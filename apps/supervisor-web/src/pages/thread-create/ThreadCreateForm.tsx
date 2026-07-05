import type { FormEvent } from 'react';
import { useEffect, useId, useState } from 'react';

import {
  AgentBackendDto,
  AgentBackendIdDto,
  defaultAgentBackendId,
  ModelOptionDto,
  ThreadDto,
  WorkspaceDto,
} from '@remote-codex/shared';
import { useAppShellNav } from '../../components/AppShellNavContext';
import {
  ApiError,
  createThread,
  fetchAgentBackends,
  fetchAgentBackendModels,
  fetchWorkspaces,
  installOrUpdateAgentBackend,
} from '../../lib/api';

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

export function ThreadCreateForm({
  initialWorkspaceId,
  initialTitle = '',
  onCreated,
  onCancel,
  variant = 'panel',
}: {
  initialWorkspaceId?: string | null | undefined;
  initialTitle?: string | null | undefined;
  onCreated: (thread: ThreadDto) => void;
  onCancel?: () => void;
  variant?: 'panel' | 'dialog';
}) {
  const shellNav = useAppShellNav();
  const formId = useId();
  const [workspaces, setWorkspaces] = useState<WorkspaceDto[]>([]);
  const [backends, setBackends] = useState<AgentBackendDto[]>([]);
  const [models, setModels] = useState<ModelOptionDto[]>([]);
  const [provider, setProvider] = useState<AgentBackendIdDto>(
    shellNav?.defaultBackend ?? defaultAgentBackendId,
  );
  const [workspaceId, setWorkspaceId] = useState('');
  const [model, setModel] = useState('');
  const [title, setTitle] = useState(() => initialTitle ?? '');
  const [approvalMode, setApprovalMode] = useState<'yolo' | 'guarded'>('yolo');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [runtimeBusyProvider, setRuntimeBusyProvider] = useState<AgentBackendIdDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const defaultBackend = shellNav?.defaultBackend ?? defaultAgentBackendId;
  const selectedBackend = backends.find((backend) => backend.provider === provider);
  const compact = variant === 'dialog';
  const controlClassName = compact
    ? 'host-form-control mt-1.5 h-10 w-full rounded-xl border px-3 text-sm outline-none transition'
    : 'host-form-control mt-2 w-full rounded-2xl border px-4 py-3 outline-none transition';
  const secondaryButtonClassName = compact
    ? 'host-secondary-button rounded-full border px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60'
    : 'host-secondary-button rounded-full border px-5 py-3 font-medium transition disabled:cursor-not-allowed disabled:opacity-60';
  const primaryButtonClassName = compact
    ? 'ui-action-primary rounded-full px-4 py-2.5 text-sm font-medium transition disabled:cursor-not-allowed'
    : 'ui-action-primary rounded-full px-5 py-3 font-medium transition disabled:cursor-not-allowed';

  useEffect(() => {
    setTitle(initialTitle ?? '');
  }, [initialTitle]);

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
        const normalizedInitialWorkspaceId = initialWorkspaceId ?? null;
        const nextWorkspaceId =
          workspaceRecords.some((workspace) => workspace.id === normalizedInitialWorkspaceId)
            ? normalizedInitialWorkspaceId!
            : workspaceRecords[0]?.id ?? '';
        setWorkspaceId(nextWorkspaceId);
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
  }, [defaultBackend, initialWorkspaceId]);

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

  async function reloadBackendsAndModels(nextProvider: AgentBackendIdDto = provider) {
    const backendRecords = await fetchAgentBackends();
    setBackends(backendRecords);
    const requestedBackend = backendRecords.find((backend) => backend.provider === nextProvider);
    const selectableProvider = requestedBackend && backendCanStartSession(requestedBackend)
      ? nextProvider
      : chooseInitialProvider(backendRecords, defaultBackend);
    setProvider(selectableProvider);
    const modelRecords = await fetchAgentBackendModels(selectableProvider);
    setModels(modelRecords);
    setModel(modelRecords.find((entry) => entry.isDefault)?.model ?? modelRecords[0]?.model ?? '');
  }

  async function handleRuntimeAction(backend: AgentBackendDto) {
    const action = backend.installation.installed ? 'update' : 'install';
    setRuntimeBusyProvider(backend.provider);
    setError(null);
    try {
      await installOrUpdateAgentBackend(backend.provider, action);
      await reloadBackendsAndModels(backend.provider);
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.payload.message);
      } else {
        setError(caught instanceof Error ? caught.message : `Unable to ${action} ${backend.displayName}.`);
      }
      try {
        await reloadBackendsAndModels(provider);
      } catch {
        // Keep the original install/update error visible.
      }
    } finally {
      setRuntimeBusyProvider(null);
    }
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
              title: title.trim(),
            }
          : {
              workspaceId,
              provider,
              model,
              approvalMode,
            },
      );
      onCreated(thread);
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

  if (loading) {
    return (
      <div className="host-empty-state rounded-3xl border px-6 py-12 text-center">
        Loading creation form...
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={compact ? 'max-h-[min(76vh,36rem)] space-y-3 overflow-y-auto pr-1 text-sm' : 'space-y-5'}
    >
      {compact ? (
        <div className="pr-8">
          <h2 className="text-base font-semibold text-[var(--theme-fg)]">
            Create New Chat
          </h2>
          <p className="mt-1 text-xs leading-5 text-[var(--theme-fg-muted)]">
            Choose the workspace, model, and approval mode for this thread.
          </p>
        </div>
      ) : null}
      <div>
        <label className="host-form-label text-xs font-medium" htmlFor={`${formId}-thread-backend`}>
          Backend
        </label>
        <select
          id={`${formId}-thread-backend`}
          value={provider}
          onChange={(event) => {
            const next = event.target.value as AgentBackendIdDto;
            setProvider(next);
          }}
          className={controlClassName}
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
        {!compact ? (
        <div className="mt-3 space-y-2">
          {backends.map((backend) => {
            const canStart = backendCanStartSession(backend);
            const isSelected = backend.provider === provider;
            const installAvailable = backend.installation.installed
              ? Boolean(backend.installation.updateCommand)
              : Boolean(backend.installation.installCommand);
            const actionLabel = backend.installation.installed ? 'Update' : 'Install';
            const rowBusy = runtimeBusyProvider === backend.provider || backend.installation.busy;

            return (
              <div
                key={backend.provider}
                className={`rounded-2xl border px-4 py-3 transition ${
                  isSelected ? 'host-surface-strong' : 'host-surface'
                } ${canStart ? '' : 'opacity-75'}`}
              >
                <div className="flex flex-wrap items-start gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      if (canStart) {
                        setProvider(backend.provider);
                      }
                    }}
                    disabled={!canStart || busy || rowBusy}
                    className="min-w-0 flex-1 text-left disabled:cursor-not-allowed"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{backend.displayName}</span>
                      {isSelected ? (
                        <span className="host-pill rounded-full px-2 py-0.5 text-xs">Selected</span>
                      ) : null}
                      {!canStart ? (
                        <span className="host-pill rounded-full px-2 py-0.5 text-xs">Not available</span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm opacity-75">
                      {backend.installation.installed
                        ? `Installed${backend.installation.installedVersion ? `: ${backend.installation.installedVersion}` : ''}`
                        : backend.installation.lastError ?? backend.status.lastError ?? 'Runtime is not installed.'}
                    </p>
                    {!canStart && backend.installation.lastError ? (
                      <p className="mt-1 text-xs opacity-70">{backend.installation.lastError}</p>
                    ) : null}
                  </button>
                  {installAvailable ? (
                    <button
                      type="button"
                      onClick={() => handleRuntimeAction(backend)}
                      disabled={busy || rowBusy || runtimeBusyProvider !== null}
                      className="host-secondary-button rounded-full border px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60"
                      aria-label={`${actionLabel} ${backend.displayName}`}
                    >
                      {rowBusy ? `${actionLabel}ing...` : actionLabel}
                    </button>
                  ) : null}
                </div>
                {!canStart && installAvailable ? (
                  <p className="mt-2 text-xs opacity-70">
                    Relay connections install or update the runtime on the selected device.
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
        ) : selectedBackend && !backendCanStartSession(selectedBackend) ? (
          <p className="mt-2 text-xs text-[var(--theme-fg-muted)]">
            Select an available backend before creating a thread.
          </p>
        ) : null}
        {!compact && selectedBackend && !backendCanStartSession(selectedBackend) ? (
          <p className="mt-2 text-sm opacity-75">
            Select an available backend, or install this runtime before creating a thread.
          </p>
        ) : null}
      </div>
      <div>
        <label className="host-form-label text-xs font-medium" htmlFor={`${formId}-thread-workspace`}>
          Workspace
        </label>
        <select
          id={`${formId}-thread-workspace`}
          value={workspaceId}
          onChange={(event) => setWorkspaceId(event.target.value)}
          className={controlClassName}
        >
          {workspaces.map((workspace) => (
            <option key={workspace.id} value={workspace.id}>
              {workspace.label} · {workspace.absPath}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="host-form-label text-xs font-medium" htmlFor={`${formId}-thread-model`}>
          Model
        </label>
        <select
          id={`${formId}-thread-model`}
          value={model}
          onChange={(event) => setModel(event.target.value)}
          disabled={models.length === 0}
          className={controlClassName}
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
        <label className="host-form-label text-xs font-medium" htmlFor={`${formId}-thread-title`}>
          Title
        </label>
        <input
          id={`${formId}-thread-title`}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Optional. Falls back to first prompt."
          className={controlClassName}
        />
      </div>
      <div>
        <label className="host-form-label text-xs font-medium" htmlFor={`${formId}-thread-approval-mode`}>
          Approval mode
        </label>
        <select
          id={`${formId}-thread-approval-mode`}
          value={approvalMode}
          onChange={(event) => setApprovalMode(event.target.value as 'yolo' | 'guarded')}
          className={controlClassName}
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
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          type="submit"
          disabled={busy || !workspaceId || !model}
          className={primaryButtonClassName}
        >
          {busy ? 'Creating...' : 'Create Thread'}
        </button>
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className={secondaryButtonClassName}
          >
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}
