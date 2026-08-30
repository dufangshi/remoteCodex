import { useEffect, useMemo, useState } from 'react';

import type {
  AgentBackendDto,
  ApplyProviderHostConfigArchiveResultDto,
  CreateProviderHostConfigArchiveInput,
  ProviderHostConfigArchiveDto,
  ProviderHostFileDto,
  RenameProviderHostConfigArchiveInput,
  UpdateProviderHostFileInput,
} from '../../packages/shared/src/index';

type Provider = AgentBackendDto['provider'];

export interface MobileProviderSettingsClient {
  listAgentRuntimes(): Promise<AgentBackendDto[]>;
  fetchProviderHostFile(provider: Provider, name: string): Promise<ProviderHostFileDto>;
  updateProviderHostFile(
    provider: Provider,
    name: string,
    input: UpdateProviderHostFileInput,
  ): Promise<ProviderHostFileDto>;
  restartAgentBackend(provider: Provider): Promise<AgentBackendDto>;
  installOrUpdateAgentBackend(
    provider: Provider,
    action: 'install' | 'update',
  ): Promise<AgentBackendDto>;
  buildAndRestartService(): Promise<{ status: 'launched'; pid: number | null; message: string }>;
  fetchProviderHostConfigArchives(provider: Provider): Promise<ProviderHostConfigArchiveDto[]>;
  createProviderHostConfigArchive(
    provider: Provider,
    input?: CreateProviderHostConfigArchiveInput,
  ): Promise<ProviderHostConfigArchiveDto>;
  renameProviderHostConfigArchive(
    provider: Provider,
    id: string,
    input: RenameProviderHostConfigArchiveInput,
  ): Promise<ProviderHostConfigArchiveDto>;
  applyProviderHostConfigArchive(
    provider: Provider,
    id: string,
  ): Promise<ApplyProviderHostConfigArchiveResultDto>;
}

interface MobileProviderSettingsProps {
  client: MobileProviderSettingsClient;
  currentProvider?: Provider | null;
}

interface FileEditorState {
  loading: boolean;
  saving: boolean;
  path: string;
  originalContent: string;
  draftContent: string;
}

const emptyFileState: FileEditorState = {
  loading: false,
  saving: false,
  path: '',
  originalContent: '',
  draftContent: '',
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'The provider operation failed.';
}

export function MobileProviderSettings({
  client,
  currentProvider = null,
}: MobileProviderSettingsProps) {
  const [backends, setBackends] = useState<AgentBackendDto[]>([]);
  const [provider, setProvider] = useState<Provider | ''>(currentProvider ?? '');
  const [selectedFileName, setSelectedFileName] = useState('');
  const [fileState, setFileState] = useState<FileEditorState>(emptyFileState);
  const [archives, setArchives] = useState<ProviderHostConfigArchiveDto[]>([]);
  const [archiveLabels, setArchiveLabels] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeBackend = useMemo(
    () => backends.find((backend) => backend.provider === provider) ?? null,
    [backends, provider],
  );
  const configFiles = activeBackend?.managementSchema.hostConfigFiles ?? [];
  const configFileNames = configFiles.map((file) => file.name).join('\u0000');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    client
      .listAgentRuntimes()
      .then((loaded) => {
        if (cancelled) return;
        setBackends(loaded);
        setProvider((selected) => {
          if (selected && loaded.some((backend) => backend.provider === selected)) return selected;
          if (currentProvider && loaded.some((backend) => backend.provider === currentProvider)) {
            return currentProvider;
          }
          return loaded.find((backend) => backend.isDefault)?.provider ?? loaded[0]?.provider ?? '';
        });
        setLoading(false);
      })
      .catch((caught) => {
        if (cancelled) return;
        setError(errorMessage(caught));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client, currentProvider]);

  useEffect(() => {
    setSelectedFileName(configFiles[0]?.name ?? '');
    setFileState(emptyFileState);
  }, [provider, configFileNames]);

  useEffect(() => {
    if (!provider || !selectedFileName) return;
    let cancelled = false;
    setFileState({ ...emptyFileState, loading: true });
    client
      .fetchProviderHostFile(provider, selectedFileName)
      .then((file) => {
        if (cancelled) return;
        setFileState({
          loading: false,
          saving: false,
          path: file.path,
          originalContent: file.content,
          draftContent: file.content,
        });
      })
      .catch((caught) => {
        if (cancelled) return;
        setFileState(emptyFileState);
        setError(errorMessage(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [client, provider, selectedFileName]);

  useEffect(() => {
    if (!provider || activeBackend?.managementSchema.configArchives !== true) {
      setArchives([]);
      return;
    }
    let cancelled = false;
    client
      .fetchProviderHostConfigArchives(provider)
      .then((loaded) => {
        if (cancelled) return;
        setArchives(loaded);
        setArchiveLabels(Object.fromEntries(loaded.map((archive) => [archive.id, archive.label])));
      })
      .catch((caught) => {
        if (!cancelled) setError(errorMessage(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [activeBackend?.managementSchema.configArchives, client, provider]);

  function replaceBackend(updated: AgentBackendDto) {
    setBackends((current) =>
      current.map((backend) => (backend.provider === updated.provider ? updated : backend)),
    );
  }

  async function runAction(key: string, action: () => Promise<void>) {
    if (busyAction) return;
    setBusyAction(key);
    setMessage(null);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusyAction(null);
    }
  }

  async function saveFile() {
    if (!provider || !selectedFileName) return;
    await runAction('save-file', async () => {
      setFileState((current) => ({ ...current, saving: true }));
      const updated = await client.updateProviderHostFile(provider, selectedFileName, {
        content: fileState.draftContent,
      });
      setFileState({
        loading: false,
        saving: false,
        path: updated.path,
        originalContent: updated.content,
        draftContent: updated.content,
      });
      setMessage(`Saved ${selectedFileName}.`);
    });
  }

  async function createArchive() {
    if (!provider) return;
    await runAction('create-archive', async () => {
      const archive = await client.createProviderHostConfigArchive(provider);
      setArchives((current) => [archive, ...current]);
      setArchiveLabels((current) => ({ ...current, [archive.id]: archive.label }));
      setMessage(`Created backup ${archive.label}.`);
    });
  }

  if (loading) return <p role="status">Loading provider settings...</p>;
  if (!activeBackend) return <p>No provider runtime is configured.</p>;

  const installation = activeBackend.installation;
  const canInstall = !installation.installed && Boolean(installation.installCommand);
  const canUpdate = installation.installed && Boolean(installation.updateCommand);
  const dirtyFile = fileState.draftContent !== fileState.originalContent;

  return (
    <div className="grid gap-5 text-sm" data-testid="mobile-provider-settings">
      <div className="grid gap-2">
        <label className="font-medium" htmlFor="mobile-provider-select">Provider</label>
        <select
          id="mobile-provider-select"
          value={provider}
          onChange={(event) => {
            setProvider(event.target.value as Provider);
            setMessage(null);
            setError(null);
          }}
          className="min-h-10 rounded-md border border-[var(--theme-border)] bg-[var(--theme-panel)] px-3 text-[var(--theme-fg)]"
        >
          {backends.map((backend) => (
            <option key={backend.provider} value={backend.provider}>{backend.displayName}</option>
          ))}
        </select>
        <p className="text-xs text-[var(--theme-fg-muted)]">
          {activeBackend.status.state} · {installation.installedVersion ?? 'not installed'}
        </p>
      </div>

      <section className="grid gap-3 border-t border-[var(--theme-border)] pt-4" aria-labelledby="mobile-runtime-controls">
        <div>
          <h3 id="mobile-runtime-controls" className="font-semibold">Runtime controls</h3>
          <p className="mt-1 text-xs text-[var(--theme-fg-muted)]">Restart or update the selected provider runtime.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void runAction('restart', async () => {
              const updated = await client.restartAgentBackend(activeBackend.provider);
              replaceBackend(updated);
              setMessage(`${updated.displayName} restarted.`);
            })}
            disabled={busyAction !== null}
            className="inline-flex min-h-10 items-center gap-2 rounded-md border border-[var(--theme-border)] px-3"
          >
            Restart
          </button>
          {canInstall || canUpdate ? (
            <button
              type="button"
              onClick={() => void runAction('install', async () => {
                const action = canUpdate ? 'update' : 'install';
                const updated = await client.installOrUpdateAgentBackend(activeBackend.provider, action);
                replaceBackend(updated);
                setMessage(`${updated.displayName} ${action} completed.`);
              })}
              disabled={busyAction !== null}
              className="inline-flex min-h-10 items-center gap-2 rounded-md border border-[var(--theme-border)] px-3"
            >
              {canUpdate ? 'Update' : 'Install'}
            </button>
          ) : null}
          {activeBackend.managementSchema.buildRestart ? (
            <button
              type="button"
              onClick={() => void runAction('build-restart', async () => {
                await client.buildAndRestartService();
                setMessage('Build and restart launched. The connection may briefly close.');
              })}
              disabled={busyAction !== null}
              className="inline-flex min-h-10 items-center gap-2 rounded-md border border-[var(--status-warning-border)] px-3 text-[var(--status-warning-fg)]"
            >
              Build and restart
            </button>
          ) : null}
        </div>
      </section>

      {configFiles.length > 0 ? (
        <section className="grid gap-3 border-t border-[var(--theme-border)] pt-4" aria-labelledby="mobile-host-config">
          <div>
            <h3 id="mobile-host-config" className="font-semibold">Host configuration</h3>
            <p className="mt-1 text-xs text-[var(--theme-fg-muted)]">Edit files exposed by the selected provider.</p>
          </div>
          <select
            aria-label="Provider config file"
            value={selectedFileName}
            onChange={(event) => setSelectedFileName(event.target.value)}
            className="min-h-10 rounded-md border border-[var(--theme-border)] bg-[var(--theme-panel)] px-3 text-[var(--theme-fg)]"
          >
            {configFiles.map((file) => <option key={file.name} value={file.name}>{file.label}</option>)}
          </select>
          {fileState.path ? <p className="break-all font-mono text-xs text-[var(--theme-fg-muted)]">{fileState.path}</p> : null}
          <textarea
            aria-label={`${selectedFileName} content`}
            value={fileState.draftContent}
            onChange={(event) => setFileState((current) => ({ ...current, draftContent: event.target.value }))}
            disabled={fileState.loading || fileState.saving}
            spellCheck={false}
            className="min-h-48 w-full resize-y rounded-md border border-[var(--theme-border)] bg-[var(--theme-panel)] p-3 font-mono text-xs text-[var(--theme-fg)]"
          />
          <button
            type="button"
            onClick={() => void saveFile()}
            disabled={!dirtyFile || busyAction !== null || fileState.loading}
            className="inline-flex min-h-10 w-fit items-center gap-2 rounded-md bg-[var(--theme-accent-solid)] px-3 text-[var(--theme-accent-solid-fg)] disabled:opacity-50"
          >
            Save file
          </button>
        </section>
      ) : null}

      {activeBackend.managementSchema.configArchives ? (
        <section className="grid gap-3 border-t border-[var(--theme-border)] pt-4" aria-labelledby="mobile-config-archives">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 id="mobile-config-archives" className="font-semibold">Config archives</h3>
              <p className="mt-1 text-xs text-[var(--theme-fg-muted)]">Back up and restore provider host files.</p>
            </div>
            <button
              type="button"
              onClick={() => void createArchive()}
              disabled={busyAction !== null}
              className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-md border border-[var(--theme-border)] px-3"
            >
              Create backup
            </button>
          </div>
          {archives.length === 0 ? <p className="text-xs text-[var(--theme-fg-muted)]">No config backups yet.</p> : null}
          {archives.map((archive) => (
            <div key={archive.id} className="grid gap-2 border-t border-[var(--theme-border)] pt-3 sm:grid-cols-[1fr_auto]">
              <input
                aria-label={`Rename ${archive.label}`}
                value={archiveLabels[archive.id] ?? archive.label}
                onChange={(event) => setArchiveLabels((current) => ({ ...current, [archive.id]: event.target.value }))}
                className="min-h-10 min-w-0 rounded-md border border-[var(--theme-border)] bg-[var(--theme-panel)] px-3 text-[var(--theme-fg)]"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  aria-label={`Save archive name ${archive.label}`}
                  onClick={() => void runAction(`rename-${archive.id}`, async () => {
                    const label = (archiveLabels[archive.id] ?? '').trim();
                    if (!label) throw new Error('Archive name cannot be empty.');
                    const updated = await client.renameProviderHostConfigArchive(activeBackend.provider, archive.id, { label });
                    setArchives((current) => current.map((item) => item.id === updated.id ? updated : item));
                    setArchiveLabels((current) => ({ ...current, [updated.id]: updated.label }));
                    setMessage(`Renamed backup to ${updated.label}.`);
                  })}
                  disabled={busyAction !== null}
                  className="inline-flex min-h-10 items-center gap-2 rounded-md border border-[var(--theme-border)] px-3"
                >
                  Rename
                </button>
                <button
                  type="button"
                  onClick={() => void runAction(`apply-${archive.id}`, async () => {
                    const result = await client.applyProviderHostConfigArchive(activeBackend.provider, archive.id);
                    setMessage(`Applied ${result.archive.label}; runtime is ${result.status.state}.`);
                  })}
                  disabled={busyAction !== null}
                  className="min-h-10 rounded-md border border-[var(--theme-border)] px-3"
                >
                  Apply
                </button>
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {error ? <p role="alert" className="text-sm text-[var(--status-danger-fg)]">{error}</p> : null}
      {message ? <p role="status" className="text-sm text-[var(--status-success-fg)]">{message}</p> : null}
    </div>
  );
}
