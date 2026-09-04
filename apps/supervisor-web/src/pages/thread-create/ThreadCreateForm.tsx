import type { FormEvent, ReactNode } from 'react';
import { useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';

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
import { currentRelayScopedPath } from '../../lib/relayRoutes';

function canStart(backend: AgentBackendDto) {
  return backend.enabled && backend.capabilities.sessions.resume && backend.capabilities.turns.start;
}

function chooseProvider(backends: AgentBackendDto[], preferred: AgentBackendIdDto) {
  const match = backends.find((backend) => backend.provider === preferred);
  if (match && canStart(match)) {
    return match.provider;
  }
  return backends.find(canStart)?.provider ?? defaultAgentBackendId;
}

function pickModel(models: ModelOptionDto[]) {
  return models.find((entry) => entry.isDefault) ?? models[0] ?? null;
}

function pickReadyAgent(agents: ModelOptionDto[], preferred?: string) {
  const ready = (entry: ModelOptionDto) => entry.acpAgent?.availability === 'ready';
  return (
    agents.find((entry) => entry.model === preferred && ready(entry)) ??
    agents.find((entry) => entry.isDefault && ready(entry)) ??
    agents.find(ready) ??
    null
  );
}

function errorText(caught: unknown, fallback: string) {
  if (caught instanceof ApiError) {
    return caught.payload.message;
  }
  return caught instanceof Error ? caught.message : fallback;
}

function Field({
  id,
  label,
  children,
}: {
  id?: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="host-form-label text-xs font-medium" htmlFor={id}>
        {label}
      </label>
      {children}
    </div>
  );
}

export function ThreadCreateForm({
  initialWorkspaceId,
  onCreated,
  onCancel,
  variant = 'panel',
}: {
  initialWorkspaceId?: string | null | undefined;
  onCreated: (thread: ThreadDto) => void;
  onCancel?: () => void;
  variant?: 'panel' | 'dialog';
}) {
  const shellNav = useAppShellNav();
  const formId = useId();
  const compact = variant === 'dialog';
  const controlClass = compact
    ? 'host-form-control mt-1.5 h-10 w-full rounded-lg border px-3 text-sm outline-none transition'
    : 'host-form-control mt-2 w-full rounded-lg border px-4 py-3 outline-none transition';
  const defaultBackend = shellNav?.defaultBackend ?? defaultAgentBackendId;

  const [workspaces, setWorkspaces] = useState<WorkspaceDto[]>([]);
  const [backends, setBackends] = useState<AgentBackendDto[]>([]);
  const [agentOptions, setAgentOptions] = useState<ModelOptionDto[]>([]);
  const [models, setModels] = useState<ModelOptionDto[]>([]);
  const [provider, setProvider] = useState<AgentBackendIdDto>(defaultBackend);
  const [workspaceId, setWorkspaceId] = useState('');
  const [agentId, setAgentId] = useState('');
  const [model, setModel] = useState('');
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffortDto | null>(null);
  const [approvalMode, setApprovalMode] = useState<'yolo' | 'guarded'>('yolo');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [runtimeBusyProvider, setRuntimeBusyProvider] = useState<AgentBackendIdDto | null>(null);
  const [installingAgentId, setInstallingAgentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedBackend = backends.find((backend) => backend.provider === provider);
  const acpAdvertised = backends.some((backend) => backend.provider === 'acp');
  const selectedWorkspace = workspaces.find((workspace) => workspace.id === workspaceId) ?? null;
  const selectedModel = models.find((entry) => entry.model === model) ?? null;
  const isAcpAgentSelection =
    provider === 'acp' && agentOptions.some((entry) => entry.selectionKind === 'agent');
  const selectedAgent = agentOptions.find((entry) => entry.model === agentId) ?? null;

  function applyModels(records: ModelOptionDto[]) {
    const next = pickModel(records);
    setModels(records);
    setModel(next?.model ?? '');
    setReasoningEffort(next?.defaultReasoningEffort ?? null);
  }

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchWorkspaces(), fetchAgentBackends()])
      .then(([workspaceRecords, backendRecords]) => {
        if (cancelled) {
          return;
        }
        setProvider(chooseProvider(backendRecords, defaultBackend));
        setBackends(backendRecords);
        setWorkspaces(workspaceRecords);
        const requested = initialWorkspaceId ?? null;
        setWorkspaceId(
          requested === null
            ? (workspaceRecords[0]?.id ?? '')
            : workspaceRecords.some((workspace) => workspace.id === requested)
              ? requested
              : '',
        );
      })
      .catch((caught) => {
        if (!cancelled) {
          setError(errorText(caught, 'Unable to load creation form data.'));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [defaultBackend, initialWorkspaceId]);

  useEffect(() => {
    if (!provider || !workspaceId) {
      return;
    }
    let cancelled = false;
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
          setAgentId((current) => pickReadyAgent(agents, current)?.model ?? '');
        })
        .catch((caught) => {
          if (!cancelled) {
            setAgentOptions([]);
            setAgentId('');
            setError(errorText(caught, 'Unable to load ACP agents.'));
          }
        });
      return () => {
        cancelled = true;
      };
    }
    setAgentOptions([]);
    setAgentId('');
    fetchAgentBackendModelsFor(
      provider,
      selectedWorkspace ? { cwd: selectedWorkspace.absPath } : {},
    )
      .then((records) => {
        if (!cancelled) {
          applyModels(records);
        }
      })
      .catch((caught) => {
        if (!cancelled) {
          applyModels([]);
          setError(errorText(caught, 'Unable to load backend models.'));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [provider, workspaceId, selectedWorkspace?.absPath]);

  useEffect(() => {
    if (provider !== 'acp' || !agentId || !selectedWorkspace) {
      return;
    }
    let cancelled = false;
    setModels([]);
    setModel('');
    setReasoningEffort(null);
    setError(null);
    fetchAgentBackendModelsFor('acp', { agentId, cwd: selectedWorkspace.absPath })
      .then((records) => {
        if (!cancelled) {
          applyModels(records);
        }
      })
      .catch((caught) => {
        if (!cancelled) {
          setError(errorText(caught, 'Unable to load agent models.'));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [agentId, provider, selectedWorkspace]);

  async function reloadBackends(nextProvider: AgentBackendIdDto = provider) {
    const records = await fetchAgentBackends();
    setBackends(records);
    const requested = records.find((backend) => backend.provider === nextProvider);
    const selected =
      requested && canStart(requested)
        ? nextProvider
        : chooseProvider(records, defaultBackend);
    setProvider(selected);
    if (selected === 'acp') {
      const agents = await fetchAgentBackendAgents('acp');
      setAgentOptions(agents);
      setAgentId(pickReadyAgent(agents)?.model ?? '');
      return;
    }
    applyModels(await fetchAgentBackendModels(selected));
  }

  async function handleRuntimeAction(backend: AgentBackendDto) {
    const action = backend.installation.installed ? 'update' : 'install';
    setRuntimeBusyProvider(backend.provider);
    setError(null);
    try {
      await installOrUpdateAgentBackend(backend.provider, action);
      await reloadBackends(backend.provider);
    } catch (caught) {
      setError(errorText(caught, `Unable to ${action} ${backend.displayName}.`));
      try {
        await reloadBackends(provider);
      } catch {
        /* keep install error */
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
      setError(errorText(caught, `Unable to install ${entry.displayName}.`));
    } finally {
      setInstallingAgentId(null);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedBackend || !canStart(selectedBackend)) {
      setError('Choose an available backend before creating a thread.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onCreated(
        await createThread({
          workspaceId,
          provider,
          ...(provider === 'acp' ? { agentId } : {}),
          model,
          ...(reasoningEffort ? { reasoningEffort } : {}),
          approvalMode,
        }),
      );
    } catch (caught) {
      setError(errorText(caught, 'Unable to create thread.'));
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

  const backendUnavailable = selectedBackend && !canStart(selectedBackend);
  const selectedBackendAction = selectedBackend?.installation.installed ? 'Update' : 'Install';
  const selectedBackendActionAvailable = selectedBackend
    ? selectedBackend.installation.installed
      ? Boolean(selectedBackend.installation.updateCommand)
      : Boolean(selectedBackend.installation.installCommand)
    : false;
  const selectedBackendBusy = selectedBackend
    ? runtimeBusyProvider === selectedBackend.provider || selectedBackend.installation.busy
    : false;
  const selectedBackendBusyLabel = selectedBackend?.installation.installed
    ? 'Updating...'
    : 'Installing...';

  return (
    <form
      onSubmit={handleSubmit}
      className={compact ? 'max-h-[min(76vh,36rem)] space-y-3 overflow-y-auto pr-1 text-sm' : 'space-y-5'}
    >
      {compact ? (
        <div className="pr-8">
          <h2 className="text-base font-semibold text-[var(--theme-fg)]">Create New Chat</h2>
          <p className="mt-1 text-xs leading-5 text-[var(--theme-fg-muted)]">
            Choose the workspace, agent, and approval mode for this thread.
          </p>
        </div>
      ) : null}

      <fieldset>
        <legend className="host-form-label text-xs font-medium">Backend</legend>
        {compact ? (
          <select
            id={`${formId}-thread-backend`}
            disabled={busy || runtimeBusyProvider !== null}
            value={provider}
            onChange={(event) => setProvider(event.target.value as AgentBackendIdDto)}
            className={controlClass}
          >
            {backends.map((backend) => (
              <option key={backend.provider} value={backend.provider} disabled={!canStart(backend)}>
                {backend.displayName}
                {canStart(backend) ? '' : ' (not available)'}
              </option>
            ))}
            {!acpAdvertised ? (
              <option value="acp" disabled>
                ACP Agent (enable on device)
              </option>
            ) : null}
          </select>
        ) : (
          <div aria-label="Backend" className="product-segmented mt-2 !grid w-full grid-cols-2 sm:!flex" role="radiogroup">
            {backends.map((backend) => {
              const selected = backend.provider === provider;
              return (
                <label
                  className="product-segment min-w-0 flex-1 disabled:cursor-not-allowed disabled:opacity-45"
                  key={backend.provider}
                >
                  <input
                    checked={selected}
                    className="sr-only"
                    disabled={!canStart(backend) || busy || runtimeBusyProvider !== null}
                    name={`${formId}-backend`}
                    onChange={() => setProvider(backend.provider)}
                    type="radio"
                    value={backend.provider}
                  />
                  {backend.displayName}
                </label>
              );
            })}
          </div>
        )}

        {selectedBackend ? (
          <div className="mt-3 flex flex-col gap-2 border-b border-[var(--theme-border)] pb-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="min-w-0 text-xs leading-5 text-[var(--theme-fg-muted)]">
              {selectedBackend.installation.installed
                ? `Installed${selectedBackend.installation.installedVersion ? `, version ${selectedBackend.installation.installedVersion}` : ''}`
                : selectedBackend.installation.lastError ?? selectedBackend.status.lastError ?? 'Runtime is not installed.'}
            </p>
            {selectedBackendActionAvailable ? (
              <button
                aria-label={`${selectedBackendAction} ${selectedBackend.displayName}`}
                className="host-secondary-button min-h-10 shrink-0 rounded-md border px-3 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50"
                disabled={busy || selectedBackendBusy || runtimeBusyProvider !== null}
                onClick={() => void handleRuntimeAction(selectedBackend)}
                type="button"
              >
                {selectedBackendBusy ? selectedBackendBusyLabel : `${selectedBackendAction} runtime`}
              </button>
            ) : null}
          </div>
        ) : null}
        {!acpAdvertised ? (
          <p className="mt-2 text-xs leading-5 text-[var(--theme-fg-muted)]">
            ACP is not enabled on this supervisor. Add
            <code className="mx-1 font-mono">acp</code>
            to <code className="font-mono">REMOTE_CODEX_ENABLED_AGENT_PROVIDERS</code>.
          </p>
        ) : null}
        {backendUnavailable ? (
          <p className={`mt-2 ${compact ? 'text-xs text-[var(--theme-fg-muted)]' : 'text-sm opacity-75'}`}>
            Select an available backend before creating a thread.
          </p>
        ) : null}
      </fieldset>

      <Field id={`${formId}-thread-workspace`} label="Workspace">
        <select
          id={`${formId}-thread-workspace`}
          disabled={busy}
          value={workspaceId}
          onChange={(event) => setWorkspaceId(event.target.value)}
          className={controlClass}
        >
          {!workspaceId ? <option value="">Choose a workspace</option> : null}
          {workspaces.map((workspace) => (
            <option key={workspace.id} value={workspace.id}>
              {workspace.label} · {workspace.absPath}
            </option>
          ))}
        </select>
        {workspaces.length === 0 ? (
          <p className="mt-2 text-xs leading-5 text-[var(--theme-fg-muted)]">
            Add a workspace before creating a thread.{' '}
            <Link className="font-semibold text-[var(--theme-accent-strong)] hover:underline" to={currentRelayScopedPath('/workspaces/new')}>
              Add workspace
            </Link>
          </p>
        ) : initialWorkspaceId && !workspaces.some((workspace) => workspace.id === initialWorkspaceId) ? (
          <p className="mt-2 text-xs leading-5 text-[var(--status-warning-fg)]" role="status">
            The requested workspace is unavailable. Choose another workspace to continue.
          </p>
        ) : null}
      </Field>

      {isAcpAgentSelection ? (
        <fieldset>
          <legend className="host-form-label text-xs font-medium">Agent</legend>
          <div
            className="mt-2 max-h-64 divide-y divide-[var(--theme-border)] overflow-y-auto rounded-lg border border-[var(--theme-border)] bg-[var(--theme-surface)]"
            role="radiogroup"
            aria-label="Agent"
          >
            {agentOptions.map((entry) => {
              const meta = entry.acpAgent;
              const ready = meta?.availability === 'ready';
              const adapterMissing = meta?.availability === 'adapter_missing';
              const installing = installingAgentId === entry.id || meta?.busy === true;
              const selected = entry.model === agentId;
              const statusLabel =
                meta?.availability === 'base_missing'
                  ? 'Base agent missing'
                  : adapterMissing
                    ? 'Adapter needed'
                    : meta?.availability === 'server_unavailable'
                      ? 'ACP unavailable'
                      : 'Ready';
              return (
                <div key={entry.id} className="flex min-w-0 items-stretch gap-2 px-2 py-2">
                  <label
                    title={meta?.statusMessage}
                    className={`product-radio-option min-w-0 flex-1 rounded-md px-2.5 py-2 text-left outline-none transition ${
                      selected
                        ? 'bg-[var(--theme-surface-strong)] text-[var(--theme-fg)]'
                        : ready
                          ? 'text-[var(--theme-fg)] hover:bg-[var(--theme-hover)]'
                          : 'cursor-not-allowed text-[var(--theme-fg-muted)] opacity-70'
                    }`}
                  >
                    <input
                      checked={selected}
                      className="sr-only"
                      disabled={!ready || busy || installingAgentId !== null}
                      name={`${formId}-agent`}
                      onChange={() => setAgentId(entry.model)}
                      type="radio"
                      value={entry.model}
                    />
                    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="truncate font-medium">{entry.displayName}</span>
                      <span className="host-pill rounded-full px-2 py-0.5 text-[0.68rem]">{statusLabel}</span>
                    </span>
                    <span className="mt-1 block truncate font-mono text-[0.68rem] text-[var(--theme-fg-muted)]">
                      {meta?.serverCommand ?? 'Unavailable'}
                    </span>
                  </label>
                  {adapterMissing && meta?.installCommand ? (
                    <button
                      type="button"
                      onClick={() => void handleAcpAgentInstall(entry)}
                      disabled={busy || installing || installingAgentId !== null}
                      className="host-secondary-button my-auto min-h-11 shrink-0 rounded-md border px-3 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {installing ? 'Installing...' : 'Install adapter'}
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </fieldset>
      ) : null}

      <div className={selectedModel?.supportedReasoningEfforts.length ? 'grid gap-5 sm:grid-cols-2' : ''}>
        <Field id={`${formId}-thread-model`} label="Model">
          <select
            id={`${formId}-thread-model`}
            value={model}
            disabled={busy || models.length === 0}
            onChange={(event) => {
              const next = models.find((entry) => entry.model === event.target.value) ?? null;
              setModel(event.target.value);
              setReasoningEffort((current) =>
                current && next?.supportedReasoningEfforts.some((entry) => entry.reasoningEffort === current)
                  ? current
                  : (next?.defaultReasoningEffort ?? null),
              );
            }}
            className={controlClass}
          >
            {models.length === 0 ? <option value="">No models available</option> : null}
            {models.map((entry) => (
              <option key={entry.id} value={entry.model}>
                {entry.displayName}
              </option>
            ))}
          </select>
        </Field>

        {selectedModel && selectedModel.supportedReasoningEfforts.length > 0 ? (
          <Field id={`${formId}-thread-effort`} label="Reasoning effort">
            <select
              id={`${formId}-thread-effort`}
              disabled={busy}
              value={reasoningEffort ?? ''}
              onChange={(event) =>
                setReasoningEffort((event.target.value || null) as ReasoningEffortDto | null)
              }
              className={controlClass}
            >
              {selectedModel.supportedReasoningEfforts.map((entry) => (
                <option key={entry.reasoningEffort} value={entry.reasoningEffort}>
                  {entry.reasoningEffort}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
      </div>

      <fieldset>
        <legend className="host-form-label text-xs font-medium">Approval mode</legend>
        <div aria-label="Approval mode" className="product-segmented mt-2 w-full" role="radiogroup">
          <label className="product-segment flex-1">
            <input
              checked={approvalMode === 'guarded'}
              className="sr-only"
              disabled={busy}
              name={`${formId}-approval`}
              onChange={() => setApprovalMode('guarded')}
              type="radio"
              value="guarded"
            />
            Guarded
          </label>
          <label className="product-segment flex-1">
            <input
              checked={approvalMode === 'yolo'}
              className="sr-only"
              disabled={busy}
              name={`${formId}-approval`}
              onChange={() => setApprovalMode('yolo')}
              type="radio"
              value="yolo"
            />
            Full access
          </label>
        </div>
        <p className="mt-2 text-xs leading-5 text-[var(--theme-fg-muted)]">
          {approvalMode === 'guarded'
            ? 'Pauses when an action needs your approval.'
            : 'Runs tool actions without approval prompts. Use only in a trusted workspace.'}
        </p>
      </fieldset>

      {error ? <div className="host-error rounded-md border px-4 py-3 text-sm" role="alert">{error}</div> : null}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          type="submit"
          disabled={
            busy ||
            !selectedBackend ||
            !canStart(selectedBackend) ||
            !workspaceId ||
            !model ||
            !selectedModel ||
            (provider === 'acp' && selectedAgent?.acpAgent?.availability !== 'ready')
          }
          className={
            compact
              ? 'ui-action-primary min-h-11 rounded-md px-4 text-sm font-semibold transition disabled:cursor-not-allowed'
              : 'ui-action-primary min-h-11 rounded-md px-5 font-semibold transition disabled:cursor-not-allowed'
          }
        >
          {busy ? 'Creating...' : 'Create Thread'}
        </button>
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className={
              compact
                ? 'host-secondary-button min-h-11 rounded-md border px-3 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60'
                : 'host-secondary-button min-h-11 rounded-md border px-5 font-medium transition disabled:cursor-not-allowed disabled:opacity-60'
            }
          >
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}
