import type { FormEvent } from 'react';
import { useEffect, useId, useState } from 'react';

import {
  AgentBackendDto,
  AgentBackendIdDto,
  defaultAgentBackendId,
  ModelOptionDto,
  ReasoningEffortDto,
  ThreadDto,
  WorkspaceDto,
} from '@remote-codex/shared';
import { useAppShellNav } from '../../components/AppShellNavContext';
import {
  ApiError,
  createThread,
  fetchAgentBackendAgents,
  fetchAgentBackends,
  fetchAgentBackendModels,
  fetchAgentBackendModelsFor,
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
  const [agentOptions, setAgentOptions] = useState<ModelOptionDto[]>([]);
  const [models, setModels] = useState<ModelOptionDto[]>([]);
  const [provider, setProvider] = useState<AgentBackendIdDto>(
    shellNav?.defaultBackend ?? defaultAgentBackendId,
  );
  const [workspaceId, setWorkspaceId] = useState('');
  const [agentId, setAgentId] = useState('');
  const [model, setModel] = useState('');
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffortDto | null>(null);
  const [title, setTitle] = useState(() => initialTitle ?? '');
  const [approvalMode, setApprovalMode] = useState<'yolo' | 'guarded'>('yolo');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [runtimeBusyProvider, setRuntimeBusyProvider] = useState<AgentBackendIdDto | null>(null);
  const [installingAgentId, setInstallingAgentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const defaultBackend = shellNav?.defaultBackend ?? defaultAgentBackendId;
  const selectedBackend = backends.find((backend) => backend.provider === provider);
  const acpBackendAdvertised = backends.some((backend) => backend.provider === 'acp');
  const selectedWorkspace = workspaces.find((workspace) => workspace.id === workspaceId) ?? null;
  const selectedModel = models.find((entry) => entry.model === model) ?? null;
  const isAcpAgentSelection = provider === 'acp' && agentOptions.some(
    (entry) => entry.selectionKind === 'agent',
  );
  const selectedAgent = agentOptions.find((entry) => entry.model === agentId) ?? null;
  const selectedModelAvailable = Boolean(selectedModel);
  const compact = variant === 'dialog';
  const controlClassName = compact
    ? 'host-form-control mt-1.5 h-10 w-full rounded-lg border px-3 text-sm outline-none transition'
    : 'host-form-control mt-2 w-full rounded-lg border px-4 py-3 outline-none transition';
  const secondaryButtonClassName = compact
    ? 'host-secondary-button rounded-lg border px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60'
    : 'host-secondary-button rounded-lg border px-5 py-3 font-medium transition disabled:cursor-not-allowed disabled:opacity-60';
  const primaryButtonClassName = compact
    ? 'ui-action-primary rounded-lg px-4 py-2.5 text-sm font-medium transition disabled:cursor-not-allowed'
    : 'ui-action-primary rounded-lg px-5 py-3 font-medium transition disabled:cursor-not-allowed';

  useEffect(() => {
    setTitle(initialTitle ?? '');
  }, [initialTitle]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchWorkspaces(), fetchAgentBackends()])
      .then(([workspaceRecords, backendRecords]) => {
        if (cancelled) {
          return;
        }
        const initialProvider = chooseInitialProvider(
          backendRecords,
          defaultBackend,
        );
        setProvider(initialProvider);
        setBackends(backendRecords);
        setWorkspaces(workspaceRecords);
        const normalizedInitialWorkspaceId = initialWorkspaceId ?? null;
        const nextWorkspaceId =
          workspaceRecords.some((workspace) => workspace.id === normalizedInitialWorkspaceId)
            ? normalizedInitialWorkspaceId!
            : workspaceRecords[0]?.id ?? '';
        setWorkspaceId(nextWorkspaceId);
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
    if (!workspaceId) {
      return;
    }
    setModels([]);
    setModel('');
    setReasoningEffort(null);
    setError(null);
    if (provider === 'acp') {
      fetchAgentBackendAgents(provider)
        .then((agents) => {
          if (cancelled) {
            return;
          }
          setAgentOptions(agents);
          setAgentId((currentAgentId) => {
            const current = agents.find(
              (entry) =>
                entry.model === currentAgentId && entry.acpAgent?.availability === 'ready',
            );
            const next = current ?? agents.find(
              (entry) => entry.isDefault && entry.acpAgent?.availability === 'ready',
            ) ?? agents.find((entry) => entry.acpAgent?.availability === 'ready') ?? null;
            return next?.model ?? '';
          });
        })
        .catch((caught) => {
          if (!cancelled) {
            setAgentOptions([]);
            setAgentId('');
            setError(caught instanceof Error ? caught.message : 'Unable to load ACP agents.');
          }
        });
      return () => {
        cancelled = true;
      };
    }
    setAgentOptions([]);
    setAgentId('');
    fetchAgentBackendModels(provider)
      .then((modelRecords) => {
        if (cancelled) {
          return;
        }
        setModels(modelRecords);
        const next = modelRecords.find((entry) => entry.isDefault) ?? modelRecords[0] ?? null;
        setModel(next?.model ?? '');
        setReasoningEffort(next?.defaultReasoningEffort ?? null);
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
  }, [provider, workspaceId]);

  useEffect(() => {
    if (provider !== 'acp' || !agentId || !selectedWorkspace) {
      return;
    }
    let cancelled = false;
    setModels([]);
    setModel('');
    setReasoningEffort(null);
    fetchAgentBackendModelsFor('acp', {
      agentId,
      cwd: selectedWorkspace.absPath,
    }).then((modelRecords) => {
      if (cancelled) {
        return;
      }
      setModels(modelRecords);
      const next = modelRecords.find((entry) => entry.isDefault) ?? modelRecords[0] ?? null;
      setModel(next?.model ?? '');
      setReasoningEffort(next?.defaultReasoningEffort ?? null);
    }).catch((caught) => {
      if (!cancelled) {
        setError(caught instanceof Error ? caught.message : 'Unable to load agent models.');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [agentId, provider, selectedWorkspace]);

  async function reloadBackendsAndModels(nextProvider: AgentBackendIdDto = provider) {
    const backendRecords = await fetchAgentBackends();
    setBackends(backendRecords);
    const requestedBackend = backendRecords.find((backend) => backend.provider === nextProvider);
    const selectableProvider = requestedBackend && backendCanStartSession(requestedBackend)
      ? nextProvider
      : chooseInitialProvider(backendRecords, defaultBackend);
    setProvider(selectableProvider);
    if (selectableProvider === 'acp') {
      const agents = await fetchAgentBackendAgents('acp');
      setAgentOptions(agents);
      const next = agents.find(
        (entry) => entry.isDefault && entry.acpAgent?.availability === 'ready',
      ) ?? agents.find((entry) => entry.acpAgent?.availability === 'ready') ?? null;
      setAgentId(next?.model ?? '');
      return;
    }
    const modelRecords = await fetchAgentBackendModels(selectableProvider);
    setModels(modelRecords);
    const next = modelRecords.find((entry) => entry.isDefault) ?? modelRecords[0] ?? null;
    setModel(next?.model ?? '');
    setReasoningEffort(next?.defaultReasoningEffort ?? null);
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

  async function handleAcpAgentInstall(entry: ModelOptionDto) {
    setInstallingAgentId(entry.id);
    setError(null);
    try {
      await installOrUpdateAgentBackend('acp', 'install', entry.id);
      const agents = await fetchAgentBackendAgents('acp');
      setAgentOptions(agents);
      const installed = agents.find((candidate) => candidate.id === entry.id);
      if (installed?.acpAgent?.availability === 'ready') {
        setAgentId(installed.model);
      }
      setBackends(await fetchAgentBackends());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `Unable to install ${entry.displayName}.`);
    } finally {
      setInstallingAgentId(null);
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
              ...(provider === 'acp' ? { agentId } : {}),
              model,
              ...(reasoningEffort ? { reasoningEffort } : {}),
              approvalMode,
              title: title.trim(),
            }
          : {
              workspaceId,
              provider,
              ...(provider === 'acp' ? { agentId } : {}),
              model,
              ...(reasoningEffort ? { reasoningEffort } : {}),
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
      <div className="host-empty-state rounded-lg border px-6 py-12 text-center">
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
            Choose the workspace, agent, and approval mode for this thread.
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
          {!acpBackendAdvertised ? (
            <option value="acp" disabled>
              ACP Agent (enable on device)
            </option>
          ) : null}
        </select>
        {!acpBackendAdvertised ? (
          <p className="mt-2 text-xs leading-5 text-[var(--theme-fg-muted)]">
            ACP is not enabled by this device supervisor. Update and restart Remote Codex, or add
            <code className="mx-1 font-mono">acp</code>
            to <code className="font-mono">REMOTE_CODEX_ENABLED_AGENT_PROVIDERS</code>.
          </p>
        ) : null}
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
                className={`rounded-lg border px-4 py-3 transition ${
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
                      className="host-secondary-button rounded-lg border px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60"
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
      {isAcpAgentSelection ? (
        <fieldset>
          <legend className="host-form-label text-xs font-medium">Agent</legend>
          <div
            className="mt-2 max-h-64 divide-y divide-[var(--theme-border)] overflow-y-auto rounded-lg border border-[var(--theme-border)] bg-[var(--theme-surface)]"
            role="radiogroup"
            aria-label="Agent"
          >
            {agentOptions.map((entry) => {
              const metadata = entry.acpAgent;
              const ready = metadata?.availability === 'ready';
              const adapterMissing = metadata?.availability === 'adapter_missing';
              const installing = installingAgentId === entry.id || metadata?.busy === true;
              const selected = entry.model === agentId;
              const statusLabel = metadata?.availability === 'base_missing'
                ? 'Base agent missing'
                : adapterMissing
                  ? 'Adapter needed'
                  : metadata?.availability === 'server_unavailable'
                    ? 'ACP unavailable'
                    : 'Ready';
              const transportLabel = metadata?.transport === 'native'
                ? 'Native ACP'
                : metadata?.transport === 'adapter'
                  ? 'ACP adapter'
                  : 'Custom ACP';
              const tooltipId = `${formId}-acp-agent-${entry.id}-tooltip`;

              return (
                <div
                  key={entry.id}
                  className="group/agent relative flex min-w-0 items-stretch gap-2 px-2 py-2"
                  title={metadata?.statusMessage}
                >
                  <button
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-disabled={!ready || busy || installingAgentId !== null}
                    aria-describedby={tooltipId}
                    onClick={() => {
                      if (ready && !busy && installingAgentId === null) {
                        setAgentId(entry.model);
                      }
                    }}
                    className={`min-w-0 flex-1 rounded-md px-2.5 py-2 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-[var(--theme-accent-solid)] ${
                      selected
                        ? 'bg-[var(--theme-surface-strong)] text-[var(--theme-fg)]'
                        : ready
                          ? 'text-[var(--theme-fg)] hover:bg-[var(--theme-hover)]'
                          : 'cursor-not-allowed text-[var(--theme-fg-muted)] opacity-70'
                    }`}
                  >
                    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="truncate font-medium">{entry.displayName}</span>
                      <span className="host-pill rounded-full px-2 py-0.5 text-[0.68rem]">
                        {statusLabel}
                      </span>
                      <span className="text-[0.68rem] text-[var(--theme-fg-muted)]">
                        {transportLabel}
                      </span>
                    </span>
                    <span className="mt-1 block truncate font-mono text-[0.68rem] text-[var(--theme-fg-muted)]">
                      Probe: {metadata?.baseProbeCommand ?? 'Unavailable'}
                    </span>
                    <span className="mt-0.5 block truncate font-mono text-[0.68rem] text-[var(--theme-fg-muted)]">
                      ACP: {metadata?.serverCommand ?? 'Unavailable'}
                    </span>
                  </button>
                  {adapterMissing && metadata?.installCommand ? (
                    <button
                      type="button"
                      onClick={() => void handleAcpAgentInstall(entry)}
                      disabled={busy || installing || installingAgentId !== null}
                      className="host-secondary-button my-auto shrink-0 rounded-lg border px-3 py-2 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-60"
                      aria-label={`Install ACP adapter for ${entry.displayName}`}
                    >
                      {installing ? 'Installing...' : 'Install adapter'}
                    </button>
                  ) : null}
                  <span
                    id={tooltipId}
                    role="tooltip"
                    className="pointer-events-none absolute inset-x-2 bottom-[calc(100%-0.2rem)] z-20 invisible rounded-md border border-[var(--theme-border)] bg-[var(--theme-panel)] px-3 py-2 text-xs leading-5 text-[var(--theme-fg)] opacity-0 shadow-[var(--theme-shadow)] transition group-hover/agent:visible group-hover/agent:opacity-100 group-focus-within/agent:visible group-focus-within/agent:opacity-100"
                  >
                    {metadata?.statusMessage}
                    <span className="mt-1 block font-mono text-[0.68rem] text-[var(--theme-fg-muted)]">
                      Base probe: {metadata?.baseProbeCommand}
                    </span>
                    <span className="block font-mono text-[0.68rem] text-[var(--theme-fg-muted)]">
                      ACP probe: {metadata?.serverProbeCommand}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        </fieldset>
      ) : null}
      <div>
        <label className="host-form-label text-xs font-medium" htmlFor={`${formId}-thread-model`}>
          Model
        </label>
        <select
          id={`${formId}-thread-model`}
          value={model}
          onChange={(event) => {
            const nextModel = models.find((entry) => entry.model === event.target.value) ?? null;
            setModel(event.target.value);
            setReasoningEffort((current) =>
              current && nextModel?.supportedReasoningEfforts.some(
                (entry) => entry.reasoningEffort === current,
              )
                ? current
                : nextModel?.defaultReasoningEffort ?? null,
            );
          }}
          disabled={models.length === 0}
          className={controlClassName}
        >
          {models.length === 0 ? (
            <option value="">No models available</option>
          ) : null}
          {models.map((entry) => (
            <option key={entry.id} value={entry.model}>
              {entry.displayName}
            </option>
          ))}
        </select>
      </div>
      {selectedModel && selectedModel.supportedReasoningEfforts.length > 0 ? (
        <div>
          <label className="host-form-label text-xs font-medium" htmlFor={`${formId}-thread-effort`}>
            Reasoning effort
          </label>
          <select
            id={`${formId}-thread-effort`}
            value={reasoningEffort ?? ''}
            onChange={(event) =>
              setReasoningEffort((event.target.value || null) as ReasoningEffortDto | null)
            }
            className={controlClassName}
          >
            {selectedModel.supportedReasoningEfforts.map((entry) => (
              <option key={entry.reasoningEffort} value={entry.reasoningEffort}>
                {entry.reasoningEffort}
              </option>
            ))}
          </select>
        </div>
      ) : null}
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
        <div className="host-error rounded-lg border px-4 py-3 text-sm">
          {error}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          type="submit"
          disabled={
            busy ||
            !workspaceId ||
            !model ||
            !selectedModelAvailable ||
            (provider === 'acp' && selectedAgent?.acpAgent?.availability !== 'ready')
          }
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
