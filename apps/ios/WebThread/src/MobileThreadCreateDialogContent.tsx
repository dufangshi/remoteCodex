import type { FormEvent } from 'react';
import { useEffect, useId, useState } from 'react';

import {
  AgentBackendDto,
  AgentBackendIdDto,
  CreateThreadInput,
  defaultAgentBackendId,
  ModelOptionDto,
  ThreadDto,
  WorkspaceDto,
} from '@remote-codex/shared';

export interface MobileThreadCreateClient {
  listWorkspaces(): Promise<WorkspaceDto[]>;
  listAgentRuntimes(): Promise<AgentBackendDto[]>;
  listModels(provider: AgentBackendIdDto): Promise<ModelOptionDto[]>;
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
  const [provider, setProvider] = useState<AgentBackendIdDto>(defaultAgentBackendId);
  const [workspaceId, setWorkspaceId] = useState('');
  const [model, setModel] = useState('');
  const [title, setTitle] = useState(initialTitle ?? '');
  const [approvalMode, setApprovalMode] = useState<'yolo' | 'guarded'>('yolo');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedBackend = backends.find((backend) => backend.provider === provider);

  useEffect(() => {
    setTitle(initialTitle ?? '');
  }, [initialTitle]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([client.listWorkspaces(), client.listAgentRuntimes()])
      .then(async ([workspaceRecords, backendRecords]) => {
        if (cancelled) {
          return;
        }
        const initialProvider = chooseInitialProvider(backendRecords);
        const modelRecords = await client.listModels(initialProvider);
        if (cancelled) {
          return;
        }
        setWorkspaces(workspaceRecords);
        setBackends(backendRecords);
        setProvider(initialProvider);
        setModels(modelRecords);
        setWorkspaceId(
          workspaceRecords.some((workspace) => workspace.id === initialWorkspaceId)
            ? initialWorkspaceId!
            : workspaceRecords[0]?.id ?? '',
        );
        setModel(modelRecords.find((entry) => entry.isDefault)?.model ?? modelRecords[0]?.model ?? '');
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
    setError(null);
    client
      .listModels(provider)
      .then((modelRecords) => {
        if (cancelled) {
          return;
        }
        setModels(modelRecords);
        setModel(modelRecords.find((entry) => entry.isDefault)?.model ?? modelRecords[0]?.model ?? '');
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const thread = await client.createThread({
        workspaceId,
        provider,
        model,
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
          Choose the workspace, model, and approval mode.
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
      <div>
        <label className={labelClassName} htmlFor={`${formId}-model`}>
          Model
        </label>
        <select
          id={`${formId}-model`}
          value={model}
          onChange={(event) => setModel(event.target.value)}
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
          disabled={busy || !workspaceId || !model}
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
