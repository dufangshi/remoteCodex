import type { FormEvent } from 'react';
import { useEffect, useId, useState } from 'react';

import {
  AgentBackendDto,
  AgentBackendIdDto,
  CreateThreadInput,
  defaultAgentBackendId,
  ModelOptionDto,
  ReasoningEffortDto,
  ThreadDto,
  WorkspaceDto,
} from '@remote-codex/shared';

export interface MobileThreadCreateClient {
  listWorkspaces(): Promise<WorkspaceDto[]>;
  listAgentRuntimes(): Promise<AgentBackendDto[]>;
  listAgents(provider: AgentBackendIdDto): Promise<ModelOptionDto[]>;
  listModels(
    provider: AgentBackendIdDto,
    options?: { agentId?: string | null; cwd?: string | null },
  ): Promise<ModelOptionDto[]>;
  installAgentAdapter(provider: AgentBackendIdDto, modelId: string): Promise<AgentBackendDto>;
  createThread(input: CreateThreadInput): Promise<ThreadDto>;
}

function backendCanStartSession(backend: AgentBackendDto) {
  return backend.enabled && backend.capabilities.sessions.resume && backend.capabilities.turns.start;
}

function chooseInitialProvider(backends: AgentBackendDto[]) {
  return (
    backends.find((backend) => backend.isDefault && backendCanStartSession(backend))?.provider ??
    backends.find(backendCanStartSession)?.provider ??
    defaultAgentBackendId
  );
}

export function MobileThreadCreateDialogContent({
  client,
  initialWorkspaceId,
  initialTitle = '',
  onCancel,
  onCreated,
}: {
  client: MobileThreadCreateClient;
  initialWorkspaceId?: string | null | undefined;
  initialTitle?: string | null | undefined;
  onCancel: () => void;
  onCreated: (thread: ThreadDto) => void;
}) {
  const formId = useId();
  const [workspaces, setWorkspaces] = useState<WorkspaceDto[]>([]);
  const [backends, setBackends] = useState<AgentBackendDto[]>([]);
  const [models, setModels] = useState<ModelOptionDto[]>([]);
  const [agentOptions, setAgentOptions] = useState<ModelOptionDto[]>([]);
  const [provider, setProvider] = useState<AgentBackendIdDto>(defaultAgentBackendId);
  const [workspaceId, setWorkspaceId] = useState('');
  const [agentId, setAgentId] = useState('');
  const [model, setModel] = useState('');
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffortDto | null>(null);
  const [title, setTitle] = useState(initialTitle ?? '');
  const [approvalMode, setApprovalMode] = useState<'yolo' | 'guarded'>('yolo');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [installingAgentId, setInstallingAgentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selectedBackend = backends.find((backend) => backend.provider === provider);
  const selectedWorkspace = workspaces.find((workspace) => workspace.id === workspaceId) ?? null;
  const selectedAgent = agentOptions.find((entry) => entry.model === agentId) ?? null;
  const selectedModel = models.find((entry) => entry.model === model) ?? null;
  const isAcpAgentSelection = provider === 'acp' && agentOptions.some(
    (entry) => entry.selectionKind === 'agent',
  );

  useEffect(() => {
    setTitle(initialTitle ?? '');
  }, [initialTitle]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([client.listWorkspaces(), client.listAgentRuntimes()])
      .then(([workspaceRecords, backendRecords]) => {
        if (cancelled) {
          return;
        }
        const initialProvider = chooseInitialProvider(backendRecords);
        setWorkspaces(workspaceRecords);
        setBackends(backendRecords);
        setProvider(initialProvider);
        setWorkspaceId(
          workspaceRecords.some((workspace) => workspace.id === initialWorkspaceId)
            ? initialWorkspaceId!
            : workspaceRecords[0]?.id ?? '',
        );
      })
      .catch((caught) => {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : 'Unable to load creation form data.');
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
  }, [client, initialWorkspaceId]);

  useEffect(() => {
    if (!provider) {
      return;
    }
    let cancelled = false;
    setModels([]);
    setModel('');
    setReasoningEffort(null);
    setError(null);
    if (provider === 'acp') {
      client
        .listAgents(provider)
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
            const next =
              current ??
              agents.find(
                (entry) => entry.isDefault && entry.acpAgent?.availability === 'ready',
              ) ??
              agents.find((entry) => entry.acpAgent?.availability === 'ready') ??
              null;
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
    client
      .listModels(provider)
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
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : 'Unable to load backend models.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [client, provider]);

  useEffect(() => {
    if (provider !== 'acp' || !agentId || !selectedWorkspace) {
      return;
    }
    let cancelled = false;
    setModels([]);
    setModel('');
    setReasoningEffort(null);
    setError(null);
    client
      .listModels(provider, { agentId, cwd: selectedWorkspace.absPath })
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
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : 'Unable to load agent models.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [agentId, client, provider, selectedWorkspace]);

  async function handleInstallAgent(entry: ModelOptionDto) {
    setInstallingAgentId(entry.id);
    setError(null);
    try {
      await client.installAgentAdapter('acp', entry.id);
      const agents = await client.listAgents('acp');
      setAgentOptions(agents);
      const installed = agents.find((candidate) => candidate.id === entry.id);
      if (installed?.acpAgent?.availability === 'ready') {
        setAgentId(installed.model);
      }
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
      const thread = await client.createThread({
        workspaceId,
        provider,
        ...(provider === 'acp' ? { agentId } : {}),
        model,
        ...(reasoningEffort ? { reasoningEffort } : {}),
        approvalMode,
        ...(title.trim() ? { title: title.trim() } : {}),
      });
      onCreated(thread);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to create thread.');
    } finally {
      setBusy(false);
    }
  }

  const controlClassName =
    'mt-1.5 h-10 w-full rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface-strong)] px-3 text-sm text-[var(--theme-fg)] outline-none transition focus:border-[var(--theme-accent-border)]';
  const labelClassName = 'text-xs font-medium text-[var(--theme-fg-soft)]';

  if (loading) {
    return (
      <div className="max-h-[min(76vh,34rem)] overflow-y-auto pr-1 text-sm text-[var(--theme-fg-muted)]">
        Loading creation form...
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="max-h-[min(76vh,34rem)] space-y-3 overflow-y-auto pr-1 text-sm"
    >
      <div className="pr-8">
        <h2 className="text-base font-semibold text-[var(--theme-fg)]">
          Create New Chat
        </h2>
        <p className="mt-1 text-xs leading-5 text-[var(--theme-fg-muted)]">
          Choose the workspace, agent, and approval mode.
        </p>
      </div>
      <div>
        <label className={labelClassName} htmlFor={`${formId}-backend`}>
          Backend
        </label>
        <select
          id={`${formId}-backend`}
          value={provider}
          onChange={(event) => setProvider(event.target.value as AgentBackendIdDto)}
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
        {selectedBackend && !backendCanStartSession(selectedBackend) ? (
          <p className="mt-2 text-xs text-[var(--theme-fg-muted)]">
            Select an available backend before creating a thread.
          </p>
        ) : null}
      </div>
      <div>
        <label className={labelClassName} htmlFor={`${formId}-workspace`}>
          Workspace
        </label>
        <select
          id={`${formId}-workspace`}
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
          <legend className={labelClassName}>Agent</legend>
          <div className="mt-1.5 max-h-52 space-y-1 overflow-y-auto rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface)] p-1.5">
            {agentOptions.map((entry) => {
              const metadata = entry.acpAgent;
              const ready = metadata?.availability === 'ready';
              const installing = installingAgentId === entry.id || metadata?.busy === true;
              return (
                <div key={entry.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={entry.model === agentId}
                    disabled={!ready || installingAgentId !== null}
                    onClick={() => setAgentId(entry.model)}
                    className="min-w-0 flex-1 text-left disabled:opacity-60"
                  >
                    <span className="block truncate text-sm font-medium text-[var(--theme-fg)]">
                      {entry.displayName}
                    </span>
                    <span className="block truncate text-xs text-[var(--theme-fg-muted)]">
                      {metadata?.statusMessage ?? metadata?.availability ?? 'Unavailable'}
                    </span>
                  </button>
                  {metadata?.availability === 'adapter_missing' && metadata.installCommand ? (
                    <button
                      type="button"
                      disabled={installing || installingAgentId !== null}
                      onClick={() => void handleInstallAgent(entry)}
                      className="rounded-lg border border-[var(--theme-border)] px-2.5 py-1.5 text-xs text-[var(--theme-fg)] disabled:opacity-60"
                    >
                      {installing ? 'Installing...' : 'Install'}
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </fieldset>
      ) : null}
      <div>
        <label className={labelClassName} htmlFor={`${formId}-model`}>
          Model
        </label>
        <select
          id={`${formId}-model`}
          value={model}
          onChange={(event) => {
            const next = models.find((entry) => entry.model === event.target.value) ?? null;
            setModel(event.target.value);
            setReasoningEffort((current) =>
              current &&
              next?.supportedReasoningEfforts.some((entry) => entry.reasoningEffort === current)
                ? current
                : next?.defaultReasoningEffort ?? null,
            );
          }}
          disabled={models.length === 0}
          className={controlClassName}
        >
          {models.length === 0 ? <option value="">No models available</option> : null}
          {models.map((entry) => (
            <option key={entry.id} value={entry.model}>
              {entry.displayName} · {entry.model}
            </option>
          ))}
        </select>
      </div>
      {selectedModel && selectedModel.supportedReasoningEfforts.length > 0 ? (
        <div>
          <label className={labelClassName} htmlFor={`${formId}-reasoning-effort`}>
            Reasoning effort
          </label>
          <select
            id={`${formId}-reasoning-effort`}
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
        <label className={labelClassName} htmlFor={`${formId}-title`}>
          Title
        </label>
        <input
          id={`${formId}-title`}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Optional. Falls back to first prompt."
          className={controlClassName}
        />
      </div>
      <div>
        <label className={labelClassName} htmlFor={`${formId}-approval-mode`}>
          Approval mode
        </label>
        <select
          id={`${formId}-approval-mode`}
          value={approvalMode}
          onChange={(event) => setApprovalMode(event.target.value as 'yolo' | 'guarded')}
          className={controlClassName}
        >
          <option value="yolo">yolo</option>
          <option value="guarded">guarded</option>
        </select>
      </div>
      {error ? (
        <div className="rounded-xl border border-rose-400/35 bg-rose-400/10 px-3 py-2 text-xs text-[var(--theme-fg)]">
          {error}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          type="submit"
          disabled={
            busy ||
            !workspaceId ||
            !model ||
            (provider === 'acp' && selectedAgent?.acpAgent?.availability !== 'ready')
          }
          className="rounded-full bg-[var(--theme-accent-solid)] px-4 py-2.5 text-sm font-medium text-[var(--theme-accent-solid-fg)] transition hover:bg-[var(--theme-accent-solid-hover)] disabled:cursor-not-allowed disabled:opacity-55"
        >
          {busy ? 'Creating...' : 'Create Thread'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-full border border-[var(--theme-border)] bg-[var(--theme-surface-strong)] px-4 py-2.5 text-sm font-medium text-[var(--theme-fg-soft)] transition hover:bg-[var(--theme-hover)] hover:text-[var(--theme-fg)] disabled:cursor-not-allowed disabled:opacity-55"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
