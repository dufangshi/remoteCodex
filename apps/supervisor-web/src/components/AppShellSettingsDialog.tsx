import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { X } from 'lucide-react';

import type {
  AgentBackendDto,
  AgentBackendIdDto,
  ProviderHostConfigArchiveDto,
  WorkspaceSettingsDto,
} from '../../../../packages/shared/src/index';
import { defaultAgentBackendId } from '../../../../packages/shared/src/index';
import {
  ApiError,
  applyProviderHostConfigArchive,
  buildAndRestartService,
  createProviderHostConfigArchive,
  fetchAgentBackends,
  fetchProviderHostFile,
  fetchProviderHostConfigArchives,
  fetchWorkspaceSettings,
  installOrUpdateAgentBackend,
  renameProviderHostConfigArchive,
  restartAgentBackend,
  updateProviderHostFile,
  updateWorkspaceSettings,
} from '../lib/api';
import { usePlugins } from '@remote-codex/thread-ui';
import { useAppShellNav } from './AppShellNavContext';
import { useDialogLifecycle } from './useDialogLifecycle';
import {
  apiErrorMessage,
  defaultProviderHostFileState,
  fallbackBackends,
  fallbackManagementSchema,
  formatArchiveDate,
  normalizeBackendDescriptor,
  themeOptions,
} from './appShellNavigationModel';

function unavailablePluginReason(plugin: unknown) {
  if (!plugin || typeof plugin !== 'object') {
    return null;
  }
  const availability = plugin as {
    available?: unknown;
    unavailableReason?: unknown;
  };
  return availability.available === false && typeof availability.unavailableReason === 'string'
    ? availability.unavailableReason
    : null;
}

export function AppShellSettingsDialog({
  embedded = false,
}: {
  embedded?: boolean;
} = {}) {
  const shellNav = useAppShellNav();
  const plugins = usePlugins();
  const [pluginImportDraft, setPluginImportDraft] = useState('');
  const [pluginImportState, setPluginImportState] = useState<{
    busy: boolean;
    message: string | null;
    error: string | null;
  }>({
    busy: false,
    message: null,
    error: null,
  });
  const [pluginsPanelOpen, setPluginsPanelOpen] = useState(false);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [files, setFiles] = useState<
    Record<
      string,
      {
        path: string;
        exists: boolean;
        originalContent: string;
        draftContent: string;
        loading: boolean;
        saving: boolean;
        error: string | null;
        saveMessage: string | null;
      }
    >
  >({});
  const selectedFile = selectedFileName ? files[selectedFileName] : null;
  const [restartState, setRestartState] = useState<{
    busy: boolean;
    message: string | null;
    error: string | null;
  }>({
    busy: false,
    message: null,
    error: null,
  });
  const [archives, setArchives] = useState<ProviderHostConfigArchiveDto[]>([]);
  const [backends, setBackends] = useState<AgentBackendDto[]>(fallbackBackends);
  const [backendState, setBackendState] = useState<{
    loading: boolean;
    saving: boolean;
    error: string | null;
    operatingProvider: AgentBackendIdDto | null;
    operatingAction: 'install' | 'update' | null;
    message: string | null;
  }>({
    loading: false,
    saving: false,
    error: null,
    operatingProvider: null,
    operatingAction: null,
    message: null,
  });
  const [workspaceSettings, setWorkspaceSettings] =
    useState<WorkspaceSettingsDto | null>(null);
  const [workspaceSettingsState, setWorkspaceSettingsState] = useState<{
    devHomeDraft: string;
    loading: boolean;
    saving: boolean;
    message: string | null;
    error: string | null;
  }>({
    devHomeDraft: '',
    loading: false,
    saving: false,
    message: null,
    error: null,
  });
  const [archivesState, setArchivesState] = useState<{
    loading: boolean;
    creating: boolean;
    applyingId: string | null;
    renamingId: string | null;
    renamingBusyId: string | null;
    renameDraft: string;
    message: string | null;
    error: string | null;
  }>({
    loading: false,
    creating: false,
    applyingId: null,
    renamingId: null,
    renamingBusyId: null,
    renameDraft: '',
    message: null,
    error: null,
  });
  const selectedThemeMode = shellNav?.themeMode ?? 'system';
  const settingsVisible = embedded || Boolean(shellNav?.settingsOpen);
  const settingsDialogRef = useRef<HTMLElement>(null);
  const settingsCloseRef = useRef<HTMLButtonElement>(null);
  const pluginsDialogRef = useRef<HTMLElement>(null);
  const pluginsCloseRef = useRef<HTMLButtonElement>(null);
  const fileDialogRef = useRef<HTMLDivElement>(null);
  const fileCloseRef = useRef<HTMLButtonElement>(null);
  const settingsTitleId = useId();
  const pluginsTitleId = useId();
  const fileTitleId = useId();
  const shellNavRef = useRef(shellNav);
  shellNavRef.current = shellNav;

  const closeSettings = useCallback(() => {
    shellNavRef.current?.closeSettings();
    window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>('[aria-controls="app-shell-navigation-menu"]')
        ?.focus();
    });
  }, []);
  const closePluginsPanel = useCallback(() => {
    setPluginsPanelOpen(false);
  }, []);
  const closeFileEditor = useCallback(() => {
    setSelectedFileName(null);
  }, []);

  useDialogLifecycle({
    busy: true,
    containerRef: settingsDialogRef,
    initialFocusRef: settingsCloseRef,
    onClose: closeSettings,
    open: settingsVisible && !embedded,
  });
  useDialogLifecycle({
    containerRef: pluginsDialogRef,
    initialFocusRef: pluginsCloseRef,
    onClose: closePluginsPanel,
    open: embedded && pluginsPanelOpen,
  });
  useDialogLifecycle({
    containerRef: fileDialogRef,
    initialFocusRef: fileCloseRef,
    onClose: closeFileEditor,
    open: !embedded && settingsVisible && Boolean(selectedFileName && selectedFile),
  });

  useEffect(() => {
    if (!settingsVisible || embedded || selectedFileName) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeSettings();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [closeSettings, embedded, selectedFileName, settingsVisible]);

  async function handleImportPlugin() {
    const manifestJson = pluginImportDraft.trim();
    if (!manifestJson || pluginImportState.busy) {
      return;
    }

    setPluginImportState({
      busy: true,
      message: null,
      error: null,
    });
    try {
      await plugins.importPluginManifest({
        manifestJson,
        enabled: true,
      });
      setPluginImportDraft('');
      setPluginImportState({
        busy: false,
        message: 'Plugin manifest imported.',
        error: null,
      });
    } catch (error) {
      setPluginImportState({
        busy: false,
        message: null,
        error:
          error instanceof Error
            ? error.message
            : 'Unable to import plugin manifest.',
      });
    }
  }
  const effectiveTheme = shellNav?.effectiveTheme ?? 'dark';
  const autoCollapseCompletedTurns =
    shellNav?.autoCollapseCompletedTurns ?? true;
  const selectedBackend = shellNav?.defaultBackend ?? defaultAgentBackendId;
  const enabledPluginCount = plugins.plugins.filter(
    (plugin) => plugin.enabled,
  ).length;
  const pluginCountLabel = plugins.loading
    ? 'Loading...'
    : `${enabledPluginCount}/${plugins.plugins.length} enabled`;
  const activeBackend =
    backends.find((backend) => backend.provider === selectedBackend) ??
    fallbackBackends.find((backend) => backend.provider === selectedBackend) ??
    fallbackBackends[0]!;
  const activeManagementSchema =
    activeBackend.managementSchema ??
    fallbackManagementSchema(activeBackend.provider);
  const editableFiles = activeManagementSchema.hostConfigFiles;

  useEffect(() => {
    if (!settingsVisible) {
      return;
    }

    let cancelled = false;
    setBackendState((current) => ({
      ...current,
      loading: true,
      error: null,
    }));

    fetchAgentBackends()
      .then((records) => {
        if (cancelled) {
          return;
        }
        const merged = [
          ...records.map(normalizeBackendDescriptor),
          ...fallbackBackends.filter(
            (fallback) =>
              !records.some((record) => record.provider === fallback.provider),
          ),
        ];
        setBackends(merged);
        setBackendState((current) => ({
          ...current,
          loading: false,
        }));
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setBackends(fallbackBackends);
        setBackendState((current) => ({
          ...current,
          loading: false,
          error:
            error instanceof ApiError
              ? error.message
              : 'Unable to load backend settings.',
        }));
      });

    return () => {
      cancelled = true;
    };
  }, [settingsVisible]);

  useEffect(() => {
    if (!settingsVisible) {
      return;
    }

    let cancelled = false;
    setWorkspaceSettingsState((current) => ({
      ...current,
      loading: true,
      message: null,
      error: null,
    }));

    fetchWorkspaceSettings()
      .then((settings) => {
        if (cancelled) {
          return;
        }

        setWorkspaceSettings(settings);
        setWorkspaceSettingsState((current) => ({
          ...current,
          devHomeDraft: settings.devHome,
          loading: false,
        }));
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setWorkspaceSettingsState((current) => ({
          ...current,
          loading: false,
          error:
            error instanceof ApiError
              ? error.message
              : 'Unable to load workspace settings.',
        }));
      });

    return () => {
      cancelled = true;
    };
  }, [settingsVisible]);

  useEffect(() => {
    if (
      !settingsVisible ||
      !activeBackend.capabilities.management.hostConfigFiles
    ) {
      return;
    }

    let cancelled = false;

    async function loadFiles() {
      setFiles((current) => {
        const next = { ...current };
        for (const file of editableFiles) {
          next[file.name] = {
            ...defaultProviderHostFileState(file.name),
            ...current[file.name],
            loading: true,
            saving: false,
            error: null,
            saveMessage: null,
          };
        }
        return next;
      });

      const results = await Promise.allSettled(
        editableFiles.map(async (file) => ({
          name: file.name,
          result: await fetchProviderHostFile(
            activeBackend.provider,
            file.name,
          ),
        })),
      );

      if (cancelled) {
        return;
      }

      setFiles((current) => {
        const next = { ...current };

        for (const result of results) {
          if (result.status === 'fulfilled') {
            const { name, result: fileResult } = result.value;
            next[name] = {
              path: fileResult.path,
              exists: fileResult.exists,
              originalContent: fileResult.content,
              draftContent: fileResult.content,
              loading: false,
              saving: false,
              error: null,
              saveMessage: null,
            };
            continue;
          }

          const message =
            result.reason instanceof ApiError
              ? result.reason.message
              : 'Unable to load the file.';
          const failedName =
            editableFiles[results.indexOf(result)]?.name ??
            editableFiles[0]?.name;
          if (!failedName) {
            continue;
          }
          next[failedName] = {
            ...defaultProviderHostFileState(failedName),
            ...next[failedName],
            loading: false,
            saving: false,
            error: message,
            saveMessage: null,
          };
        }

        return next;
      });
    }

    void loadFiles();

    return () => {
      cancelled = true;
    };
  }, [
    activeBackend.capabilities.management.hostConfigFiles,
    activeBackend.provider,
    editableFiles,
    settingsVisible,
  ]);

  useEffect(() => {
    if (!settingsVisible) {
      return;
    }

    let cancelled = false;

    async function loadArchives() {
      setArchivesState((current) => ({
        ...current,
        loading: true,
        error: null,
        message: null,
      }));

      try {
        const results = await fetchProviderHostConfigArchives(
          activeBackend.provider,
        );
        if (cancelled) {
          return;
        }

        setArchives(results);
        setArchivesState((current) => ({
          ...current,
          loading: false,
        }));
      } catch (error) {
        if (cancelled) {
          return;
        }

        setArchivesState((current) => ({
          ...current,
          loading: false,
          error:
            error instanceof ApiError
              ? error.message
              : 'Unable to load config archives.',
        }));
      }
    }

    void loadArchives();

    return () => {
      cancelled = true;
    };
  }, [
    activeBackend.provider,
    activeManagementSchema.configArchives,
    settingsVisible,
  ]);

  async function handleRestartAppServer() {
    if (restartState.busy || backendState.saving) {
      return;
    }

    setRestartState({
      busy: true,
      message: null,
      error: null,
    });

    try {
      const runtime = await restartAgentBackend(activeBackend.provider);
      const normalizedRuntime = normalizeBackendDescriptor(runtime);
      setRestartState({
        busy: false,
        message:
          normalizedRuntime.status.state === 'ready'
            ? `${normalizedRuntime.displayName} backend restarted.`
            : `${normalizedRuntime.displayName} backend state: ${normalizedRuntime.status.state}`,
        error: null,
      });
      setBackends((current) =>
        current.map((backend) =>
          backend.provider === normalizedRuntime.provider
            ? normalizedRuntime
            : backend,
        ),
      );
    } catch (error) {
      setRestartState({
        busy: false,
        message: null,
        error:
          error instanceof ApiError
            ? error.message
            : 'Unable to restart the app server.',
      });
    }
  }

  async function handleInstallOrUpdateBackend(
    provider: AgentBackendIdDto,
    action: 'install' | 'update',
  ) {
    if (restartState.busy || backendState.saving) {
      return;
    }

    const backend = backends.find((entry) => entry.provider === provider);
    setBackendState((current) => ({
      ...current,
      saving: true,
      operatingProvider: provider,
      operatingAction: action,
      message: null,
      error: null,
    }));

    try {
      const runtime = await installOrUpdateAgentBackend(provider, action);
      const normalizedRuntime = normalizeBackendDescriptor(runtime);
      setBackends((current) =>
        current.map((entry) =>
          entry.provider === normalizedRuntime.provider
            ? normalizedRuntime
            : entry,
        ),
      );
      setBackendState((current) => ({
        ...current,
        saving: false,
        operatingProvider: null,
        operatingAction: null,
        message: normalizedRuntime.installation.lastError
          ? `${normalizedRuntime.displayName} ${action === 'install' ? 'installed' : 'updated'}, but requires attention:\n${normalizedRuntime.installation.lastError}`
          : `${normalizedRuntime.displayName} ${action === 'install' ? 'installed' : 'updated'}.`,
        error: null,
      }));
    } catch (error) {
      setBackendState((current) => ({
        ...current,
        saving: false,
        operatingProvider: null,
        operatingAction: null,
        message: null,
        error:
          error instanceof ApiError
            ? apiErrorMessage(error)
            : `Unable to ${action} ${backend?.displayName ?? provider}.`,
      }));
    }
  }

  async function handleBuildAndRestartService() {
    if (restartState.busy || backendState.saving) {
      return;
    }

    setRestartState({
      busy: true,
      message: null,
      error: null,
    });

    try {
      await buildAndRestartService();
      setRestartState({
        busy: false,
        message: 'Build and restart launched. The page may disconnect briefly.',
        error: null,
      });
    } catch (error) {
      setRestartState({
        busy: false,
        message: null,
        error:
          error instanceof ApiError
            ? error.message
            : 'Unable to launch build and restart.',
      });
    }
  }

  async function handleSaveWorkspaceSettings() {
    const devHome = workspaceSettingsState.devHomeDraft.trim();
    if (!devHome || workspaceSettingsState.saving) {
      return;
    }

    setWorkspaceSettingsState((current) => ({
      ...current,
      saving: true,
      message: null,
      error: null,
    }));

    try {
      const updated = await updateWorkspaceSettings({
        devHome,
      });
      setWorkspaceSettings(updated);
      setWorkspaceSettingsState((current) => ({
        ...current,
        devHomeDraft: updated.devHome,
        saving: false,
        message: 'Workspace defaults saved.',
      }));
    } catch (error) {
      setWorkspaceSettingsState((current) => ({
        ...current,
        saving: false,
        error:
          error instanceof ApiError
            ? error.message
            : 'Unable to save workspace settings.',
      }));
    }
  }

  async function handleSave(name: string) {
    const fileState = files[name];
    if (!fileState || fileState.saving) {
      return;
    }

    setFiles((current) => ({
      ...current,
      [name]: {
        ...defaultProviderHostFileState(name),
        ...current[name],
        saving: true,
        error: null,
        saveMessage: null,
      },
    }));

    try {
      const updated = await updateProviderHostFile(
        activeBackend.provider,
        name,
        {
          content: fileState.draftContent,
        },
      );

      setFiles((current) => ({
        ...current,
        [name]: {
          path: updated.path,
          exists: updated.exists,
          originalContent: updated.content,
          draftContent: updated.content,
          loading: false,
          saving: false,
          error: null,
          saveMessage: 'Saved',
        },
      }));
    } catch (error) {
      setFiles((current) => ({
        ...current,
        [name]: {
          ...defaultProviderHostFileState(name),
          ...current[name],
          saving: false,
          error:
            error instanceof ApiError
              ? error.message
              : 'Unable to save the file.',
          saveMessage: null,
        },
      }));
    }
  }

  async function handleCreateArchive() {
    if (
      archivesState.creating ||
      archivesState.applyingId !== null ||
      archivesState.renamingBusyId !== null
    ) {
      return;
    }

    setArchivesState((current) => ({
      ...current,
      creating: true,
      message: null,
      error: null,
    }));

    try {
      const archive = await createProviderHostConfigArchive(
        activeBackend.provider,
      );
      setArchives((current) => [archive, ...current]);
      setArchivesState((current) => ({
        ...current,
        creating: false,
        message: 'Backup created.',
      }));
    } catch (error) {
      setArchivesState((current) => ({
        ...current,
        creating: false,
        error:
          error instanceof ApiError
            ? error.message
            : 'Unable to create a config backup.',
      }));
    }
  }

  async function handleApplyArchive(archive: ProviderHostConfigArchiveDto) {
    if (
      archivesState.applyingId ||
      archivesState.creating ||
      archivesState.renamingBusyId !== null
    ) {
      return;
    }

    setArchivesState((current) => ({
      ...current,
      applyingId: archive.id,
      message: null,
      error: null,
    }));

    try {
      const result = await applyProviderHostConfigArchive(
        activeBackend.provider,
        archive.id,
      );
      setArchivesState((current) => ({
        ...current,
        applyingId: null,
        message:
          result.status.state === 'ready'
            ? `Applied "${result.archive.label}" and restarted ${activeBackend.displayName}.`
            : `Applied "${result.archive.label}". ${activeBackend.displayName} state: ${result.status.state}.`,
      }));
    } catch (error) {
      setArchivesState((current) => ({
        ...current,
        applyingId: null,
        error:
          error instanceof ApiError
            ? error.message
            : 'Unable to apply the config archive.',
      }));
    }
  }

  async function handleRenameArchive(archive: ProviderHostConfigArchiveDto) {
    const label = archivesState.renameDraft.trim();
    if (
      !label ||
      archivesState.renamingId !== archive.id ||
      archivesState.renamingBusyId !== null ||
      archivesState.creating ||
      archivesState.applyingId !== null
    ) {
      return;
    }

    setArchivesState((current) => ({
      ...current,
      renamingBusyId: archive.id,
      message: null,
      error: null,
    }));

    try {
      const updated = await renameProviderHostConfigArchive(
        activeBackend.provider,
        archive.id,
        { label },
      );
      setArchives((current) =>
        current.map((entry) => (entry.id === archive.id ? updated : entry)),
      );
      setArchivesState((current) => ({
        ...current,
        renamingId: null,
        renamingBusyId: null,
        renameDraft: '',
        message: 'Backup renamed.',
      }));
    } catch (error) {
      setArchivesState((current) => ({
        ...current,
        renamingBusyId: null,
        error:
          error instanceof ApiError
            ? error.message
            : 'Unable to rename the config backup.',
      }));
    }
  }

  if (!settingsVisible) {
    return null;
  }

  const pluginsManagementNode = (
    <>
      <div className="mt-3 divide-y divide-[var(--theme-border)] border-y border-[var(--theme-border)]">
        {plugins.plugins.map((plugin) => (
          <label
            key={plugin.id}
            className="flex min-h-11 cursor-pointer items-start justify-between gap-4 py-3"
          >
            <span className="min-w-0">
              <span className="block text-sm font-medium text-[var(--theme-fg)]">
                {plugin.name}
              </span>
              <span className="mt-1 block text-xs leading-5 text-[var(--theme-fg-muted)]">
                {plugin.description}
              </span>
              <span className="mt-2 block text-[11px] leading-5 text-[var(--theme-fg-muted)]">
                {[
                  ...plugin.capabilities.artifactTypes.map((type) => type.type),
                  ...plugin.capabilities.threadPanels.map(
                    (panel) => panel.kind ?? panel.id,
                  ),
                ].join(', ') || 'utility'}
              </span>
              <span className="mt-0.5 block text-[11px] leading-5 text-[var(--theme-fg-muted)]">
                {plugin.source === 'imported'
                  ? 'Imported manifest'
                  : 'Built-in module'}
              </span>
              {unavailablePluginReason(plugin) ? (
                <span className="mt-1 block text-xs leading-5 text-[var(--status-warning-fg)]">
                  {unavailablePluginReason(plugin)}
                </span>
              ) : null}
            </span>
            <input
              className="mt-1 h-5 w-5 shrink-0 accent-[var(--theme-accent-solid)] disabled:cursor-not-allowed disabled:opacity-50"
              checked={plugin.enabled}
              disabled={unavailablePluginReason(plugin) !== null}
              aria-label={`${plugin.name} enabled`}
              onChange={(event) =>
                void plugins.setPluginEnabled(
                  plugin.id,
                  event.currentTarget.checked,
                )
              }
              type="checkbox"
            />
          </label>
        ))}
        {plugins.plugins.length === 0 && (
          <p className="py-4 text-xs text-[var(--theme-fg-muted)]">
            No plugins are registered.
          </p>
        )}
      </div>
      <div className="mt-3 border-t border-[var(--theme-border)] pt-3">
        <label className="block text-xs font-medium text-[var(--theme-fg)]">
          Import manifest JSON
        </label>
        <textarea
          disabled={pluginImportState.busy}
          value={pluginImportDraft}
          onChange={(event) => {
            setPluginImportDraft(event.currentTarget.value);
            if (pluginImportState.message || pluginImportState.error) {
              setPluginImportState({
                busy: false,
                message: null,
                error: null,
              });
            }
          }}
          placeholder='{"id":"example.viewer","name":"Example Viewer","version":"0.1.0",...}'
          rows={4}
          className="mt-2 min-h-28 w-full resize-y rounded-md border border-[var(--theme-border-strong)] bg-[var(--theme-surface-strong)] px-3 py-2 font-mono text-xs leading-5 text-[var(--theme-fg)] outline-none transition placeholder:text-[var(--theme-fg-muted)] focus-visible:border-[var(--theme-accent-border)] focus-visible:ring-2 focus-visible:ring-[var(--theme-accent-ring)] disabled:cursor-wait disabled:opacity-60"
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <p className="max-w-[42rem] text-xs leading-5 text-[var(--theme-fg-muted)]">
            Imports register manifest-declared artifact types. Rendering code
            still needs a trusted built-in frontend module.
          </p>
          <button
            type="button"
            onClick={() => void handleImportPlugin()}
            disabled={!pluginImportDraft.trim() || pluginImportState.busy}
            className="host-secondary-button min-h-11 shrink-0 rounded-md border px-3 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pluginImportState.busy ? 'Importing...' : 'Import'}
          </button>
        </div>
        {pluginImportState.error && (
          <p className="host-error mt-2 rounded-md border px-3 py-2 text-xs" role="alert">
            {pluginImportState.error}
          </p>
        )}
        {pluginImportState.message && (
          <p className="mt-2 rounded-md bg-[var(--status-success-bg)] px-3 py-2 text-xs text-[var(--status-success-fg)]" role="status">
            {pluginImportState.message}
          </p>
        )}
      </div>
      {plugins.error && (
        <p className="host-error mt-2 rounded-md border px-3 py-2 text-xs" role="alert">{plugins.error}</p>
      )}
    </>
  );

  const settingsContentNode = (
    <>
      {!embedded ? (
        <div className="shrink-0 border-b border-[var(--theme-border)] p-4 pt-[max(1rem,env(safe-area-inset-top))] sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 id={settingsTitleId} className="text-xl font-semibold text-[var(--theme-fg)]">
                Settings
              </h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--theme-fg-soft)]">
                Configure appearance, workspaces, plugins, and host runtimes.
              </p>
            </div>
            <button
              aria-label="Close Settings"
              className="host-icon-button inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border transition sm:h-9 sm:w-9"
              onClick={closeSettings}
              ref={settingsCloseRef}
              type="button"
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : null}
      <div
        className={`min-h-0 flex-1 overflow-y-auto ${embedded ? 'p-0' : 'px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-5'}`}
      >
        <div className="divide-y divide-[var(--theme-border)]">
          {!embedded ? (
            <fieldset className="py-5">
              <legend className="text-sm font-semibold text-[var(--theme-fg)]">Appearance</legend>
              <p className="mt-1 text-xs leading-5 text-[var(--theme-fg-muted)]">
                Choose a theme for this browser. The active display is {effectiveTheme}.
              </p>
              <div className="product-segmented mt-3 grid w-full grid-cols-3 sm:w-auto">
                {themeOptions.map((option) => {
                  return (
                    <label className="product-segment min-h-11 flex-1 cursor-pointer" key={option.value}>
                      <input
                        checked={selectedThemeMode === option.value}
                        className="sr-only"
                        name="settings-theme"
                        onChange={() => shellNav?.setThemeMode(option.value)}
                        type="radio"
                        value={option.value}
                      />
                      <span>{option.label}</span>
                    </label>
                  );
                })}
              </div>
              <p className="mt-2 text-xs leading-5 text-[var(--theme-fg-muted)]">
                {themeOptions.find((option) => option.value === selectedThemeMode)?.description}
              </p>
            </fieldset>
          ) : null}

          {shellNav?.setAutoCollapseCompletedTurns ? (
            <section className="py-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-[var(--theme-fg)]">
                    Thread timeline
                  </h3>
                  <p className="mt-1 text-xs leading-5 text-[var(--theme-fg-muted)]">
                    Collapse completed turns into prompt, elapsed work, and final reply.
                  </p>
                </div>
                <label className="inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-2 text-xs font-medium text-[var(--theme-fg-soft)]">
                  <input
                    checked={autoCollapseCompletedTurns}
                    className="h-5 w-5 accent-[var(--theme-accent-solid)]"
                    onChange={(event) =>
                      shellNav.setAutoCollapseCompletedTurns?.(
                        event.currentTarget.checked,
                      )
                    }
                    type="checkbox"
                  />
                  <span>Auto collapse</span>
                </label>
              </div>
            </section>
          ) : null}

          <section className="py-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-[var(--theme-fg)]">
                  Plugins
                </h3>
                <p className="mt-1 text-xs leading-5 text-[var(--theme-fg-muted)]">
                  Enable renderers and thread extensions loaded by this
                  supervisor.
                </p>
              </div>
              {!embedded ? (
                <button
                  className="host-secondary-button min-h-11 shrink-0 rounded-md border px-3 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={plugins.loading}
                  onClick={() => void plugins.refresh()}
                  type="button"
                >
                  {plugins.loading ? 'Loading...' : 'Refresh'}
                </button>
              ) : null}
            </div>
            {embedded ? (
              <div className="mt-3 flex min-h-11 flex-wrap items-center justify-between gap-2 border-y border-[var(--theme-border)] py-2">
                <span className="text-xs text-[var(--theme-fg-muted)]">
                  {pluginCountLabel}
                </span>
                <button
                  type="button"
                  onClick={() => setPluginsPanelOpen(true)}
                  className="host-secondary-button min-h-11 rounded-md border px-3 text-xs font-medium transition"
                >
                  Manage
                </button>
              </div>
            ) : (
              pluginsManagementNode
            )}
          </section>

          <section className="py-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-[var(--theme-fg)]">
                  Workspace defaults
                </h3>
                <p className="mt-1 text-xs leading-5 text-[var(--theme-fg-muted)]">
                  Git projects clone into dev home. New workspace directories
                  can create one missing child under this path.
                </p>
              </div>
            </div>
            <div className="mt-3 grid gap-4">
              <div className="border-y border-[var(--theme-border)] py-3">
                <p className="text-xs font-medium text-[var(--theme-fg-muted)]">
                  Workspace root
                </p>
                <p
                  title={
                    workspaceSettings?.workspaceRoot ?? 'Loading workspace root'
                  }
                  className="mt-1 truncate font-mono text-xs leading-5 text-[var(--theme-fg-soft)]"
                >
                  {workspaceSettingsState.loading && !workspaceSettings
                    ? 'Loading...'
                    : (workspaceSettings?.workspaceRoot ?? 'Unavailable')}
                </p>
              </div>
              <div>
                <label
                  htmlFor="settings-dev-home"
                  className="text-xs font-medium text-[var(--theme-fg-soft)]"
                >
                  Dev home
                </label>
                <div className="mt-1 flex flex-col gap-2 sm:flex-row">
                  <input
                    disabled={workspaceSettingsState.loading || workspaceSettingsState.saving}
                    id="settings-dev-home"
                    value={workspaceSettingsState.devHomeDraft}
                    onChange={(event) =>
                      setWorkspaceSettingsState((current) => ({
                        ...current,
                        devHomeDraft: event.target.value,
                        message: null,
                        error: null,
                      }))
                    }
                    placeholder="/Users/name/dev"
                    className="relay-input min-h-11 min-w-0 flex-1 rounded-md disabled:cursor-wait disabled:opacity-60"
                  />
                  <button
                    type="button"
                    aria-label="Save workspace defaults"
                    onClick={() => void handleSaveWorkspaceSettings()}
                    disabled={
                      workspaceSettingsState.loading ||
                      workspaceSettingsState.saving ||
                      !workspaceSettingsState.devHomeDraft.trim()
                    }
                    className="relay-button-primary min-h-11 shrink-0 rounded-md px-4"
                  >
                    {workspaceSettingsState.saving ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </div>
            </div>
            {workspaceSettingsState.error ? (
              <p className="host-error mt-3 rounded-md border px-3 py-2 text-xs" role="alert">
                {workspaceSettingsState.error}
              </p>
            ) : workspaceSettingsState.message ? (
              <p className="mt-3 rounded-md bg-[var(--status-success-bg)] px-3 py-2 text-xs text-[var(--status-success-fg)]" role="status">
                {workspaceSettingsState.message}
              </p>
            ) : null}
          </section>

          <section className="py-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-[var(--theme-fg)]">
                  Runtime controls
                </h3>
                <p className="mt-1 text-xs leading-5 text-[var(--theme-fg-muted)]">
                  Inspect installed backend versions, install optional runtimes,
                  or restart the selected backend.
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
                <button
                  type="button"
                  onClick={() => void handleRestartAppServer()}
                  disabled={restartState.busy || backendState.saving}
                  className="host-secondary-button min-h-11 rounded-md border px-3 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {restartState.busy ? 'Restarting...' : 'Restart'}
                </button>
                <button
                  type="button"
                  onClick={() => void handleBuildAndRestartService()}
                  disabled={restartState.busy || backendState.saving}
                  className="min-h-11 rounded-md border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-3 text-xs font-medium text-[var(--status-warning-fg)] transition hover:bg-[var(--theme-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {restartState.busy ? 'Working...' : 'Build and restart'}
                </button>
              </div>
            </div>
            <div className="mt-3 divide-y divide-[var(--theme-border)] border-y border-[var(--theme-border)]">
              {backends.map((backend) => {
                const installation = backend.installation;
                const canInstall =
                  !installation.installed &&
                  Boolean(installation.installCommand);
                const canUpdate =
                  installation.installed && Boolean(installation.updateCommand);
                const operationInProgress =
                  backendState.saving &&
                  backendState.operatingProvider === backend.provider;
                const operationLabel = canInstall ? 'Install' : 'Update';
                return (
                  <div key={backend.provider} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-[var(--theme-fg)]">
                          {backend.displayName}
                        </span>
                        <span
                          className={`text-[11px] font-medium ${
                            backend.enabled
                              ? 'text-[var(--status-success-fg)]'
                              : 'text-[var(--theme-fg-muted)]'
                          }`}
                        >
                          {backend.enabled
                            ? backend.provider === 'acp' && backend.status.state !== 'ready'
                              ? 'Needs agent'
                              : 'Ready'
                            : installation.installed
                              ? backend.status.state
                              : 'Not installed'}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-xs text-[var(--theme-fg-muted)]">
                        Version:{' '}
                        {installation.installedVersion ??
                          (installation.installed
                            ? 'Installed'
                            : 'Unavailable')}
                        {installation.latestVersion
                          ? ` · Latest: ${installation.latestVersion}`
                          : ''}
                      </p>
                      {installation.lastError ? (
                        <p className="mt-1 line-clamp-2 text-xs text-[var(--status-danger-fg)]">
                          {installation.lastError}
                        </p>
                      ) : null}
                    </div>
                    {canInstall || canUpdate ? (
                      <button
                        type="button"
                        aria-label={`${canInstall ? 'Install' : 'Update'} ${backend.displayName}`}
                        onClick={() =>
                          void handleInstallOrUpdateBackend(
                            backend.provider,
                            canInstall ? 'install' : 'update',
                          )
                        }
                        disabled={
                          restartState.busy ||
                          backendState.saving ||
                          (!canInstall && !canUpdate)
                        }
                        className="host-secondary-button min-h-11 shrink-0 rounded-md border px-3 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {operationInProgress
                          ? backendState.operatingAction === 'install'
                            ? 'Installing...'
                            : 'Updating...'
                          : operationLabel}
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
            {backendState.loading ? (
              <p className="mt-3 text-xs text-[var(--theme-fg-muted)]" role="status">Refreshing backend status...</p>
            ) : null}
            {restartState.error ? (
              <p className="host-error mt-3 rounded-md border px-3 py-2 text-xs" role="alert">{restartState.error}</p>
            ) : restartState.message ? (
              <p className="mt-3 rounded-md bg-[var(--status-success-bg)] px-3 py-2 text-xs text-[var(--status-success-fg)]" role="status">
                {restartState.message}
              </p>
            ) : backendState.message ? (
              <p
                className={`mt-3 whitespace-pre-line rounded-md px-3 py-2 text-xs ${
                  backendState.message.includes('requires attention')
                    ? 'bg-[var(--status-warning-bg)] text-[var(--status-warning-fg)]'
                    : 'bg-[var(--status-success-bg)] text-[var(--status-success-fg)]'
                }`}
                role="status"
              >
                {backendState.message}
              </p>
            ) : backendState.error ? (
              <p className="host-error mt-3 whitespace-pre-line rounded-md border px-3 py-2 text-xs" role="alert">
                {backendState.error}
              </p>
            ) : null}
          </section>

          <section className="py-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-[var(--theme-fg)]">
                  Provider host files
                </h3>
                <p className="mt-1 text-xs leading-5 text-[var(--theme-fg-muted)]">
                  {activeBackend.displayName} exposes these editable files
                  through its backend schema.
                </p>
              </div>
            </div>
            <div className="mt-3 divide-y divide-[var(--theme-border)] border-y border-[var(--theme-border)]">
              {editableFiles.map((file) => {
                const state = files[file.name] ?? {
                  path: file.name,
                  exists: false,
                  originalContent: '',
                  draftContent: '',
                  loading: false,
                  saving: false,
                  error: null,
                  saveMessage: null,
                };
                const dirty = state.draftContent !== state.originalContent;

                return (
                  <button
                    key={file.name}
                    type="button"
                    onClick={() => setSelectedFileName(file.name)}
                    className="block min-h-11 w-full px-2 py-3 text-left transition hover:bg-[var(--theme-hover)] focus:outline-none focus-visible:bg-[var(--theme-hover)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--theme-accent-ring)]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-[var(--theme-fg)]">
                          {file.label}
                        </p>
                        <p className="mt-1 text-xs leading-5 text-[var(--theme-fg-muted)]">
                          {file.description}
                        </p>
                        {state.error ? (
                          <p className="mt-1 text-xs text-[var(--status-danger-fg)]" role="alert">{state.error}</p>
                        ) : null}
                      </div>
                      <div className="shrink-0">
                        {state.loading ? (
                          <span className="text-[11px] font-medium text-[var(--theme-fg-muted)]">
                            Loading
                          </span>
                        ) : dirty ? (
                          <span className="text-[11px] font-medium text-[var(--theme-accent-strong)]">
                            Unsaved
                          </span>
                        ) : state.exists ? (
                          <span className="text-[11px] font-medium text-[var(--status-success-fg)]">
                            Ready
                          </span>
                        ) : (
                          <span className="text-[11px] font-medium text-[var(--status-info-fg)]">
                            New
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
              {editableFiles.length === 0 ? (
                <p className="py-4 text-xs text-[var(--theme-fg-muted)]">
                  This backend does not expose editable host files.
                </p>
              ) : null}
            </div>
          </section>

          {activeManagementSchema.configArchives ? (
            <section className="py-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-[var(--theme-fg)]">
                    Config archives
                  </h3>
                  <p className="mt-1 text-xs leading-5 text-[var(--theme-fg-muted)]">
                    Backup the selected backend host files, then apply a saved
                    archive with a backend restart.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleCreateArchive()}
                  disabled={
                    archivesState.creating ||
                    archivesState.applyingId !== null ||
                    archivesState.renamingBusyId !== null
                  }
                  className="host-secondary-button min-h-11 shrink-0 rounded-md border px-3 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {archivesState.creating ? 'Creating...' : 'Create backup'}
                </button>
              </div>
              {archivesState.error ? (
                <p className="host-error mt-3 rounded-md border px-3 py-2 text-xs" role="alert">
                  {archivesState.error}
                </p>
              ) : archivesState.message ? (
                <p className="mt-3 rounded-md bg-[var(--status-success-bg)] px-3 py-2 text-xs text-[var(--status-success-fg)]" role="status">
                  {archivesState.message}
                </p>
              ) : null}
              <div className="mt-3 divide-y divide-[var(--theme-border)] border-y border-[var(--theme-border)]">
                {archivesState.loading ? (
                  <p className="py-4 text-xs text-[var(--theme-fg-muted)]" role="status">
                    Loading backups...
                  </p>
                ) : archives.length === 0 ? (
                  <p className="py-4 text-xs text-[var(--theme-fg-muted)]">
                    No config backups yet.
                  </p>
                ) : (
                  archives.map((archive) => {
                    const renaming = archivesState.renamingId === archive.id;
                    return (
                      <div
                        key={archive.id}
                        className="py-3"
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            {renaming ? (
                              <div className="flex max-w-xl flex-col gap-2 sm:flex-row">
                                <input
                                  aria-label={`Rename ${archive.label}`}
                                  disabled={archivesState.renamingBusyId === archive.id}
                                  value={archivesState.renameDraft}
                                  onChange={(event) =>
                                    setArchivesState((current) => ({
                                      ...current,
                                      renameDraft: event.target.value,
                                      error: null,
                                      message: null,
                                    }))
                                  }
                                  className="relay-input min-h-11 min-w-0 flex-1 rounded-md disabled:cursor-wait disabled:opacity-60"
                                />
                                <button
                                  type="button"
                                  aria-label={`Save archive name ${archive.label}`}
                                  onClick={() =>
                                    void handleRenameArchive(archive)
                                  }
                                  disabled={
                                    archivesState.renamingBusyId === archive.id ||
                                    !archivesState.renameDraft.trim()
                                  }
                                  className="relay-button-primary min-h-11 rounded-md px-3"
                                >
                                  {archivesState.renamingBusyId === archive.id ? 'Saving...' : 'Save'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setArchivesState((current) => ({
                                      ...current,
                                      renamingId: null,
                                      renameDraft: '',
                                    }))
                                  }
                                  disabled={archivesState.renamingBusyId === archive.id}
                                  className="host-secondary-button min-h-11 rounded-md border px-3 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <p className="truncate text-sm font-medium text-[var(--theme-fg)]">
                                {archive.label}
                              </p>
                            )}
                            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-[var(--theme-fg-muted)]">
                              <span>
                                Created {formatArchiveDate(archive.createdAt)}
                              </span>
                              {editableFiles.map((file) => (
                                <span
                                  key={file.name}
                                  className="font-mono"
                                >
                                  {file.name}:{' '}
                                  {archive.files[
                                    file.name as keyof typeof archive.files
                                  ]?.exists
                                    ? 'saved'
                                    : 'missing'}
                                </span>
                              ))}
                            </div>
                          </div>
                          <div className="flex shrink-0 flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                setArchivesState((current) => ({
                                  ...current,
                                  renamingId: archive.id,
                                  renameDraft: archive.label,
                                  message: null,
                                  error: null,
                                }))
                              }
                              disabled={
                                renaming ||
                                archivesState.creating ||
                                archivesState.renamingBusyId !== null ||
                                archivesState.applyingId !== null
                              }
                              className="host-secondary-button min-h-11 rounded-md border px-3 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Rename
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleApplyArchive(archive)}
                              disabled={
                                archivesState.applyingId !== null ||
                                archivesState.creating ||
                                archivesState.renamingBusyId !== null
                              }
                              className="host-secondary-button min-h-11 rounded-md border px-3 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {archivesState.applyingId === archive.id
                                ? 'Applying...'
                                : 'Apply'}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </>
  );

  if (embedded) {
    return (
      <div className="flex min-h-0 flex-col overflow-hidden">
        {settingsContentNode}
        {pluginsPanelOpen ? (
          <div className="fixed inset-0 z-[90] flex items-end justify-center sm:items-center sm:p-4">
            <button
              aria-label="Close plugins panel"
              className="ui-overlay-scrim absolute inset-0 backdrop-blur-[2px]"
              onClick={closePluginsPanel}
              tabIndex={-1}
              type="button"
            />
            <section
              aria-labelledby={pluginsTitleId}
              aria-modal="true"
              className="product-dialog relative z-10 flex max-h-[calc(100dvh-1rem)] w-full max-w-2xl flex-col overflow-hidden rounded-t-lg border border-[var(--theme-border)] bg-[var(--theme-panel)] shadow-[var(--theme-shadow)] sm:max-h-[min(82vh,42rem)] sm:rounded-lg"
              ref={pluginsDialogRef}
              role="dialog"
              tabIndex={-1}
            >
              <div className="flex items-center justify-between gap-3 border-b border-[var(--theme-border)] px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-[var(--theme-fg)]" id={pluginsTitleId}>
                    Plugins
                  </h2>
                  <p className="mt-1 text-xs text-[var(--theme-fg-muted)]">
                    {pluginCountLabel}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void plugins.refresh()}
                    disabled={plugins.loading}
                    className="host-secondary-button min-h-11 rounded-md border px-3 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {plugins.loading ? 'Loading...' : 'Refresh'}
                  </button>
                  <button
                    aria-label="Close plugins panel"
                    className="host-icon-button inline-flex h-11 w-11 items-center justify-center rounded-md border transition sm:h-9 sm:w-9"
                    onClick={closePluginsPanel}
                    ref={pluginsCloseRef}
                    type="button"
                  >
                    <X aria-hidden="true" className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                {pluginsManagementNode}
              </div>
            </section>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center sm:p-4">
      <button
        aria-label="Close Settings"
        className="ui-overlay-scrim absolute inset-0 backdrop-blur-sm"
        onClick={closeSettings}
        tabIndex={-1}
        type="button"
      />
      <section
        aria-labelledby={settingsTitleId}
        aria-modal="true"
        className="product-dialog relative z-10 flex h-[100dvh] max-h-[100dvh] w-full max-w-4xl flex-col overflow-hidden bg-[var(--theme-panel)] shadow-[var(--theme-shadow)] sm:h-auto sm:max-h-[calc(100vh-2rem)] sm:rounded-lg sm:border sm:border-[var(--theme-border)]"
        ref={settingsDialogRef}
        role="dialog"
        tabIndex={-1}
      >
        {settingsContentNode}
      </section>

      {selectedFileName && selectedFile ? (
        <div className="fixed inset-0 z-[71] flex items-center justify-center sm:p-4">
          <button
            aria-label="Close file editor"
            className="ui-overlay-scrim absolute inset-0 backdrop-blur-[2px]"
            onClick={closeFileEditor}
            tabIndex={-1}
            type="button"
          />
          <div
            aria-labelledby={fileTitleId}
            aria-modal="true"
            className="product-dialog relative z-10 flex h-[100dvh] max-h-[100dvh] w-full max-w-3xl flex-col overflow-hidden bg-[var(--theme-panel)] shadow-[var(--theme-shadow)] sm:h-auto sm:max-h-[min(88vh,56rem)] sm:rounded-lg sm:border sm:border-[var(--theme-border)]"
            ref={fileDialogRef}
            role="dialog"
            tabIndex={-1}
          >
            <div className="flex items-start justify-between gap-3 border-b border-[var(--theme-border)] px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-5">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-[var(--theme-fg)]" id={fileTitleId}>
                  {selectedFileName}
                </h2>
                <p className="mt-1 break-all font-mono text-xs text-[var(--theme-fg-muted)]">
                  {selectedFile.path}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  aria-label={`Save ${selectedFileName}`}
                  className="relay-button-primary min-h-11 rounded-md px-4"
                  disabled={
                    selectedFile.loading ||
                    selectedFile.saving ||
                    selectedFile.draftContent === selectedFile.originalContent
                  }
                  onClick={() => void handleSave(selectedFileName)}
                  type="button"
                >
                  {selectedFile.saving ? 'Saving...' : 'Save'}
                </button>
                <button
                  aria-label="Close File Editor"
                  className="host-icon-button inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border transition sm:h-9 sm:w-9"
                  onClick={closeFileEditor}
                  ref={fileCloseRef}
                  type="button"
                >
                  <X aria-hidden="true" className="h-4 w-4" />
                </button>
              </div>
            </div>
            {selectedFile.error ? (
              <p className="host-error mx-4 mt-3 rounded-md border px-3 py-2 text-xs sm:mx-5" role="alert">
                {selectedFile.error}
              </p>
            ) : selectedFile.saveMessage ? (
              <p className="mx-4 mt-3 rounded-md bg-[var(--status-success-bg)] px-3 py-2 text-xs text-[var(--status-success-fg)] sm:mx-5" role="status">
                {selectedFile.saveMessage}
              </p>
            ) : null}
            <div className="flex min-h-0 flex-1 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-5">
              <textarea
                aria-label={`Edit ${selectedFileName}`}
                disabled={selectedFile.loading || selectedFile.saving}
                value={selectedFile.draftContent}
                onChange={(event) =>
                  setFiles((current) => ({
                    ...current,
                    [selectedFileName]: {
                      ...defaultProviderHostFileState(selectedFileName),
                      ...current[selectedFileName],
                      draftContent: event.target.value,
                      error: null,
                      saveMessage: null,
                    },
                  }))
                }
                spellCheck={false}
                className="min-h-[20rem] w-full flex-1 resize-none rounded-md border border-[var(--theme-border-strong)] bg-[var(--theme-surface-strong)] px-3 py-3 font-mono text-[13px] leading-6 text-[var(--theme-fg)] outline-none transition focus-visible:border-[var(--theme-accent-border)] focus-visible:ring-2 focus-visible:ring-[var(--theme-accent-ring)] disabled:cursor-wait disabled:opacity-60 sm:min-h-[28rem]"
                placeholder={
                  selectedFile.loading
                    ? 'Loading...'
                    : `Edit ${selectedFileName} here`
                }
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
