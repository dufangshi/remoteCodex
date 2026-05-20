import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import type {
  AgentBackendDto,
  AgentBackendIdDto,
  ProviderHostConfigArchiveDto,
  WorkspaceSettingsDto,
} from '../../../../packages/shared/src/index';
import {
  ApiError,
  applyProviderHostConfigArchive,
  buildAndRestartAgentBackend,
  createProviderHostConfigArchive,
  fetchAgentBackends,
  fetchProviderHostFile,
  fetchProviderHostConfigArchives,
  fetchWorkspaceSettings,
  renameProviderHostConfigArchive,
  restartAgentBackend,
  updateProviderHostFile,
  updateWorkspaceSettings,
} from '../lib/api';
import { type AgentBackendId, type ThemeMode, useAppShellNav } from './AppShellNavContext';

function MenuIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-4 w-4 fill-current"
    >
      <path d="M2 3.25h12v1.5H2Zm0 4h12v1.5H2Zm0 4h12v1.5H2Z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-4 w-4 fill-current"
    >
      <path d="M3.22 2.47 8 7.25l4.78-4.78 1.06 1.06L9.06 8.31l4.78 4.78-1.06 1.06L8 9.37l-4.78 4.78-1.06-1.06 4.78-4.78-4.78-4.78 1.06-1.06Z" />
    </svg>
  );
}

function menuItemClassName(disabled = false) {
  return `flex w-full items-center rounded-[0.95rem] px-3 py-2 text-left text-sm transition ${
    disabled
      ? 'cursor-not-allowed bg-[var(--theme-muted)] text-[var(--theme-fg-muted)]'
      : 'text-[var(--theme-fg)] hover:bg-[var(--theme-hover)]'
  }`;
}

const themeOptions: Array<{
  value: ThemeMode;
  label: string;
  description: string;
}> = [
  {
    value: 'light',
    label: 'Light',
    description: 'Always use the bright theme.',
  },
  {
    value: 'dark',
    label: 'Dark',
    description: 'Always use the dark theme.',
  },
  {
    value: 'system',
    label: 'System',
    description: 'Follow the operating system appearance.',
  },
];

const emptyManagementSchema: AgentBackendDto['managementSchema'] = {
  hostConfigFiles: [],
  toolboxItems: [],
  hookCommandTemplates: [],
  configArchives: false,
  buildRestart: false,
};

function unavailableBackend(provider: AgentBackendIdDto, displayName: string): AgentBackendDto {
  return {
    provider,
    displayName,
    description: `${displayName} backend descriptor is not available.`,
    enabled: false,
    isDefault: provider === 'codex',
    status: {
      state: 'stopped',
      transport: provider === 'claude' ? 'sdk' : 'none',
      lastStartedAt: null,
      lastError: 'Backend descriptor is not available.',
      restartCount: 0,
    },
    capabilities: {
      sessions: {
        list: false,
        read: false,
        resume: false,
        importLocal: false,
      },
      turns: {
        start: false,
        streamInput: false,
        steer: false,
        interrupt: false,
        compact: false,
      },
      branching: {
        fork: false,
        hardRollback: false,
        resumeAt: false,
        rewindFiles: false,
      },
      controls: {
        planMode: false,
        permissionRequests: false,
        sandboxMode: false,
        fastServiceTier: false,
        goals: false,
      },
      management: {
        models: false,
        mcpStatus: false,
        skills: false,
        hooks: false,
        hookTrust: false,
        hostConfigFiles: false,
        providerSettings: false,
      },
      usage: {
        contextWindow: false,
        tokenUsage: false,
        costUsd: false,
      },
    },
    managementSchema: emptyManagementSchema,
  };
}

const fallbackBackends: AgentBackendDto[] = [
  unavailableBackend('codex', 'Codex'),
  unavailableBackend('claude', 'Claude'),
];

function fallbackManagementSchema(provider: AgentBackendId) {
  return (
    fallbackBackends.find((backend) => backend.provider === provider)?.managementSchema ??
    emptyManagementSchema
  );
}

function backendSelectionDescription(backends: AgentBackendDto[]) {
  const enabledCount = backends.filter((backend) => backend.enabled).length;
  const totalCount = backends.length;

  if (enabledCount > 1) {
    return 'New threads use the selected backend. Each backend exposes its own tools and settings.';
  }

  if (totalCount > enabledCount) {
    return 'New threads use the selected backend. Additional backends appear here when configured.';
  }

  return 'New threads use the selected backend.';
}

function formatArchiveDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function defaultProviderHostFileState(name: string) {
  return {
    path: name,
    exists: false,
    originalContent: '',
    draftContent: '',
    loading: false,
    saving: false,
    error: null as string | null,
    saveMessage: null as string | null,
  };
}

export function AppShellMenuButton({
  className = '',
}: {
  className?: string;
}) {
  const shellNav = useAppShellNav();

  if (!shellNav) {
    return null;
  }

  return (
    <button
      type="button"
      aria-label={shellNav.navOpen ? 'Close Navigation' : 'Open Navigation'}
      aria-expanded={shellNav.navOpen}
      aria-controls="app-shell-navigation-menu"
      onClick={shellNav.toggleNav}
      className={`inline-flex h-10 w-10 shrink-0 items-center justify-center text-[var(--theme-fg)] transition hover:text-[var(--theme-fg-soft)] ${className}`.trim()}
    >
      {shellNav.navOpen ? <CloseIcon /> : <MenuIcon />}
    </button>
  );
}

export function AppShellNavigationMenu({
  className = '',
}: {
  className?: string;
}) {
  const shellNav = useAppShellNav();
  const location = useLocation();
  const navigate = useNavigate();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const isWorkspacesRoute = location.pathname === '/workspaces';

  useEffect(() => {
    if (!shellNav?.navOpen) {
      return;
    }

    const activeNav = shellNav;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }

      const menuNode = menuRef.current;
      if (menuNode?.contains(target)) {
        return;
      }

      const trigger = target instanceof Element
        ? target.closest('[aria-controls="app-shell-navigation-menu"]')
        : null;
      if (trigger) {
        return;
      }

      activeNav.closeNav();
    }

    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [shellNav]);

  if (!shellNav?.navOpen) {
    return null;
  }

  return (
    <div
      ref={menuRef}
      id="app-shell-navigation-menu"
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
      onMouseDown={(event) => {
        event.stopPropagation();
      }}
      onTouchStart={(event) => {
        event.stopPropagation();
      }}
      className={`rounded-[1.8rem] border border-[var(--theme-border)] bg-[var(--theme-panel)] p-4 shadow-2xl shadow-black/15 backdrop-blur ${className}`.trim()}
    >
      <div>
        <p className="text-base font-semibold tracking-wide text-[var(--theme-accent-strong)]">
          Remote Codex
        </p>
        <p className="mt-1 text-xs uppercase tracking-[0.24em] text-[var(--theme-fg-muted)]">
          Navigation
        </p>
      </div>
      <nav className="mt-4 flex flex-col gap-1.5 text-sm">
        <button
          type="button"
          disabled={isWorkspacesRoute}
          onClick={() => {
            if (isWorkspacesRoute) {
              return;
            }

            shellNav.closeNav();
            navigate('/workspaces');
          }}
          className={menuItemClassName(isWorkspacesRoute)}
        >
          Workspaces
        </button>
        <button
          type="button"
          onClick={() => {
            shellNav.openSettings();
          }}
          className={menuItemClassName()}
        >
          Settings
        </button>
      </nav>
    </div>
  );
}

export function AppShellSettingsDialog() {
  const shellNav = useAppShellNav();
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
  }>({
    loading: false,
    saving: false,
    error: null,
  });
  const [workspaceSettings, setWorkspaceSettings] = useState<WorkspaceSettingsDto | null>(null);
  const [workspaceSettingsState, setWorkspaceSettingsState] = useState<{
    devHomeDraft: string;
    backendDraft: AgentBackendIdDto;
    loading: boolean;
    saving: boolean;
    message: string | null;
    error: string | null;
  }>({
    devHomeDraft: '',
    backendDraft: 'codex',
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
    renameDraft: string;
    message: string | null;
    error: string | null;
  }>({
    loading: false,
    creating: false,
    applyingId: null,
    renamingId: null,
    renameDraft: '',
    message: null,
    error: null,
  });
  const selectedThemeMode = shellNav?.themeMode ?? 'system';
  const effectiveTheme = shellNav?.effectiveTheme ?? 'dark';
  const selectedBackend = shellNav?.defaultBackend ?? 'codex';
  const activeBackend =
    backends.find((backend) => backend.provider === selectedBackend) ??
    fallbackBackends.find((backend) => backend.provider === selectedBackend) ??
    fallbackBackends[0]!;
  const activeManagementSchema =
    activeBackend.managementSchema ?? fallbackManagementSchema(activeBackend.provider);
  const editableFiles = activeManagementSchema.hostConfigFiles;

  useEffect(() => {
    if (!shellNav?.settingsOpen || !activeManagementSchema.configArchives) {
      return;
    }

    const activeNav = shellNav;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        activeNav.closeSettings();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [shellNav]);

  useEffect(() => {
    if (!shellNav?.settingsOpen) {
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
          ...records,
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
  }, [shellNav?.settingsOpen]);

  useEffect(() => {
    if (!shellNav?.settingsOpen) {
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
        shellNav.setDefaultBackend(settings.defaultBackend);
        setWorkspaceSettingsState((current) => ({
          ...current,
          devHomeDraft: settings.devHome,
          backendDraft: settings.defaultBackend,
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
  }, [shellNav]);

  useEffect(() => {
    if (!shellNav?.settingsOpen || !activeBackend.capabilities.management.hostConfigFiles) {
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
          result: await fetchProviderHostFile(activeBackend.provider, file.name),
        })),
      );

      if (cancelled) {
        return;
      }

      setFiles((current) => {
        const next = { ...current };

        for (const result of results) {
          if (result.status === 'fulfilled') {
            const {
              name,
              result: fileResult,
            } = result.value;
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
            editableFiles[results.indexOf(result)]?.name ?? editableFiles[0]?.name;
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
    shellNav?.settingsOpen,
  ]);

  useEffect(() => {
    if (!shellNav?.settingsOpen) {
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
        const results = await fetchProviderHostConfigArchives(activeBackend.provider);
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
  }, [activeBackend.provider, activeManagementSchema.configArchives, shellNav?.settingsOpen]);

  async function handleRestartAppServer() {
    if (restartState.busy) {
      return;
    }

    setRestartState({
      busy: true,
      message: null,
      error: null,
    });

    try {
      const runtime = await restartAgentBackend(activeBackend.provider);
      setRestartState({
        busy: false,
        message:
          runtime.status.state === 'ready'
            ? `${runtime.displayName} backend restarted.`
            : `${runtime.displayName} backend state: ${runtime.status.state}`,
        error: null,
      });
      setBackends((current) =>
        current.map((backend) =>
          backend.provider === runtime.provider ? runtime : backend,
        ),
      );
    } catch (error) {
      setRestartState({
        busy: false,
        message: null,
        error:
          error instanceof ApiError ? error.message : 'Unable to restart the app server.',
      });
    }
  }

  async function handleBuildAndRestartService() {
    if (restartState.busy) {
      return;
    }

    setRestartState({
      busy: true,
      message: null,
      error: null,
    });

    try {
      await buildAndRestartAgentBackend(activeBackend.provider);
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
        defaultBackend: workspaceSettingsState.backendDraft,
      });
      setWorkspaceSettings(updated);
      shellNav?.setDefaultBackend(updated.defaultBackend);
      setWorkspaceSettingsState((current) => ({
        ...current,
        devHomeDraft: updated.devHome,
        backendDraft: updated.defaultBackend,
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
      const updated = await updateProviderHostFile(activeBackend.provider, name, {
        content: fileState.draftContent,
      });

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
            error instanceof ApiError ? error.message : 'Unable to save the file.',
          saveMessage: null,
        },
      }));
    }
  }

  async function handleCreateArchive() {
    if (archivesState.creating) {
      return;
    }

    setArchivesState((current) => ({
      ...current,
      creating: true,
      message: null,
      error: null,
    }));

    try {
      const archive = await createProviderHostConfigArchive(activeBackend.provider);
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
    if (archivesState.applyingId) {
      return;
    }

    setArchivesState((current) => ({
      ...current,
      applyingId: archive.id,
      message: null,
      error: null,
    }));

    try {
      const result = await applyProviderHostConfigArchive(activeBackend.provider, archive.id);
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
    if (!label || archivesState.renamingId !== archive.id) {
      return;
    }

    setArchivesState((current) => ({
      ...current,
      message: null,
      error: null,
    }));

    try {
      const updated = await renameProviderHostConfigArchive(activeBackend.provider, archive.id, { label });
      setArchives((current) =>
        current.map((entry) => (entry.id === archive.id ? updated : entry)),
      );
      setArchivesState((current) => ({
        ...current,
        renamingId: null,
        renameDraft: '',
        message: 'Backup renamed.',
      }));
    } catch (error) {
      setArchivesState((current) => ({
        ...current,
        error:
          error instanceof ApiError
            ? error.message
            : 'Unable to rename the config backup.',
      }));
    }
  }

  if (!shellNav?.settingsOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center p-4 pt-[max(env(safe-area-inset-top),1rem)] sm:items-center">
      <button
        type="button"
        aria-label="Close Settings"
        onClick={shellNav.closeSettings}
        className="ui-overlay-scrim absolute inset-0 backdrop-blur-sm"
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className="relative z-10 flex max-h-[calc(100vh-2rem)] w-full max-w-4xl flex-col overflow-hidden rounded-[1.8rem] border border-[var(--theme-border)] bg-[var(--theme-panel)] shadow-2xl shadow-black/20"
      >
        <div className="shrink-0 p-5 pb-0">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-[var(--theme-fg-muted)]">
                Settings
              </p>
              <h2 className="mt-2 text-xl font-semibold text-[var(--theme-fg)]">
                Settings
              </h2>
              <p className="mt-2 text-sm leading-6 text-[var(--theme-fg-soft)]">
                Choose the default backend and manage host-side runtime files.
              </p>
            </div>
            <button
              type="button"
              aria-label="Close Settings"
              onClick={shellNav.closeSettings}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[var(--theme-border-strong)] bg-[var(--theme-surface-strong)] text-[var(--theme-fg)] transition hover:border-[var(--theme-border-contrast)] hover:bg-[var(--theme-hover)]"
            >
              <CloseIcon />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5 pt-5">
          <div className="space-y-2">
            <div className="rounded-[1.1rem] border border-[var(--theme-border)] bg-[var(--theme-surface)] px-3 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[var(--theme-fg)]">Appearance</p>
                  <p className="mt-1 text-xs leading-5 text-[var(--theme-fg-muted)]">
                    Choose light, dark, or follow the system setting. Active: {effectiveTheme}.
                  </p>
                </div>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                {themeOptions.map((option) => {
                  const active = selectedThemeMode === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => shellNav.setThemeMode(option.value)}
                      className={`block rounded-[1rem] border px-3 py-2.5 text-left transition ${
                        active
                          ? 'border-[var(--theme-accent-border)] bg-[var(--theme-accent-soft)]'
                          : 'border-[var(--theme-border)] bg-[var(--theme-surface-strong)] hover:bg-[var(--theme-hover)]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm font-medium text-[var(--theme-fg)]">
                          {option.label}
                        </span>
                        {active ? (
                          <span className="rounded-full border border-[var(--theme-accent-border)] bg-[var(--theme-accent-soft)] px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-[var(--theme-accent-strong)]">
                            Active
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-xs leading-5 text-[var(--theme-fg-muted)]">
                        {option.description}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-[1.1rem] border border-[var(--theme-border)] bg-[var(--theme-surface)] px-3 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[var(--theme-fg)]">Backend</p>
                  <p className="mt-1 text-xs leading-5 text-[var(--theme-fg-muted)]">
                    {backendSelectionDescription(backends)}
                  </p>
                </div>
                {backendState.loading ? (
                  <span className="text-[11px] uppercase tracking-[0.18em] text-[var(--theme-fg-muted)]">
                    Loading
                  </span>
                ) : null}
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {backends.map((backend) => {
                  const active = workspaceSettingsState.backendDraft === backend.provider;
                  return (
                    <button
                      key={backend.provider}
                      type="button"
                      disabled={!backend.enabled}
                      onClick={() => {
                        setWorkspaceSettingsState((current) => ({
                          ...current,
                          backendDraft: backend.provider,
                          message: null,
                          error: null,
                        }));
                      }}
                      className={`block rounded-[1rem] border px-3 py-2.5 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${
                        active
                          ? 'border-[var(--theme-accent-border)] bg-[var(--theme-accent-soft)]'
                          : 'border-[var(--theme-border)] bg-[var(--theme-surface-strong)] hover:bg-[var(--theme-hover)]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm font-medium text-[var(--theme-fg)]">
                          {backend.displayName}
                        </span>
                        <span className="rounded-full border border-[var(--theme-border)] bg-[var(--theme-panel)] px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-[var(--theme-fg-muted)]">
                          {backend.enabled ? backend.status.state : 'Unavailable'}
                        </span>
                      </div>
                      <p className="mt-1 text-xs leading-5 text-[var(--theme-fg-muted)]">
                        {backend.description}
                      </p>
                    </button>
                  );
                })}
              </div>
              {backendState.error ? (
                <p className="mt-2 text-xs text-rose-300">{backendState.error}</p>
              ) : null}
            </div>

            <div className="rounded-[1.1rem] border border-[var(--theme-border)] bg-[var(--theme-surface)] px-3 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[var(--theme-fg)]">Workspace defaults</p>
                  <p className="mt-1 text-xs leading-5 text-[var(--theme-fg-muted)]">
                    Git projects clone into dev home. New workspace directories can create one
                    missing child under this path.
                  </p>
                </div>
              </div>
              <div className="mt-3 grid gap-3">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--theme-fg-muted)]">
                    Workspace root
                  </p>
                  <p
                    title={workspaceSettings?.workspaceRoot ?? 'Loading workspace root'}
                    className="mt-1 truncate rounded-[0.9rem] border border-[var(--theme-border)] bg-[var(--theme-surface-strong)] px-3 py-2 font-mono text-xs text-[var(--theme-fg-soft)]"
                  >
                    {workspaceSettingsState.loading && !workspaceSettings
                      ? 'Loading...'
                      : workspaceSettings?.workspaceRoot ?? 'Unavailable'}
                  </p>
                </div>
                <div>
                  <label
                    htmlFor="settings-dev-home"
                    className="text-[11px] uppercase tracking-[0.18em] text-[var(--theme-fg-muted)]"
                  >
                    Dev home
                  </label>
                  <div className="mt-1 flex flex-col gap-2 sm:flex-row">
                    <input
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
                      className="min-w-0 flex-1 rounded-full border border-[var(--theme-border)] bg-[var(--theme-panel)] px-3 py-2 text-sm text-[var(--theme-fg)] outline-none focus:border-[var(--theme-accent-border)]"
                    />
                    <input
                      type="hidden"
                      value={workspaceSettingsState.backendDraft}
                      readOnly
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
                      className="rounded-full bg-[var(--theme-accent-solid)] px-4 py-2 text-xs font-medium text-[var(--theme-accent-solid-fg)] transition hover:bg-[var(--theme-accent-solid-hover)] disabled:cursor-not-allowed disabled:bg-[var(--theme-muted)] disabled:text-[var(--theme-fg-muted)]"
                    >
                      {workspaceSettingsState.saving ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                </div>
              </div>
              {workspaceSettingsState.error ? (
                <p className="mt-2 text-xs text-rose-300">{workspaceSettingsState.error}</p>
              ) : workspaceSettingsState.message ? (
                <p className="mt-2 text-xs text-emerald-300">{workspaceSettingsState.message}</p>
              ) : null}
            </div>

            <div className="rounded-[1.1rem] border border-[var(--theme-border)] bg-[var(--theme-surface)] px-3 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[var(--theme-fg)]">
                    {activeBackend.displayName} runtime
                  </p>
                  <p className="mt-1 text-xs leading-5 text-[var(--theme-fg-muted)]">
                    Restart the selected backend after editing host configuration to force a fresh reload.
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => void handleRestartAppServer()}
                    disabled={restartState.busy}
                    className="rounded-full border border-sky-400/35 bg-sky-400/10 px-3 py-1.5 text-xs font-medium text-sky-500 transition hover:bg-sky-400/16 disabled:cursor-not-allowed disabled:border-[var(--theme-border)] disabled:bg-[var(--theme-muted)] disabled:text-[var(--theme-fg-muted)]"
                  >
                    {restartState.busy ? 'Restarting...' : 'Restart'}
                  </button>
                  {activeManagementSchema.buildRestart ? (
                    <button
                      type="button"
                      onClick={() => void handleBuildAndRestartService()}
                      disabled={restartState.busy}
                      className="rounded-full border border-amber-400/35 bg-amber-400/10 px-3 py-1.5 text-xs font-medium text-amber-500 transition hover:bg-amber-400/16 disabled:cursor-not-allowed disabled:border-[var(--theme-border)] disabled:bg-[var(--theme-muted)] disabled:text-[var(--theme-fg-muted)]"
                    >
                      {restartState.busy ? 'Working...' : 'Build and restart'}
                    </button>
                  ) : null}
                </div>
              </div>
              {restartState.error ? (
                <p className="mt-2 text-xs text-rose-300">{restartState.error}</p>
              ) : restartState.message ? (
                <p className="mt-2 text-xs text-emerald-300">{restartState.message}</p>
              ) : null}
            </div>

            <div className="rounded-[1.1rem] border border-[var(--theme-border)] bg-[var(--theme-surface)] px-3 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[var(--theme-fg)]">Provider host files</p>
                  <p className="mt-1 text-xs leading-5 text-[var(--theme-fg-muted)]">
                    {activeBackend.displayName} exposes these editable files through its backend schema.
                  </p>
                </div>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
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
                      className="block rounded-[1.1rem] border border-[var(--theme-border)] bg-[var(--theme-surface-strong)] px-3 py-3 text-left transition hover:bg-[var(--theme-hover)]"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-[var(--theme-fg)]">
                            {file.label}
                          </p>
                          <p className="mt-1 text-xs leading-5 text-[var(--theme-fg-muted)]">
                            {file.description}
                          </p>
                        </div>
                        <div className="shrink-0">
                          {state.loading ? (
                            <span className="text-[11px] uppercase tracking-[0.2em] text-[var(--theme-fg-muted)]">
                              Loading
                            </span>
                          ) : dirty ? (
                            <span className="rounded-full border border-[var(--theme-accent-border)] bg-[var(--theme-accent-soft)] px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-[var(--theme-accent-strong)]">
                              Unsaved
                            </span>
                          ) : state.exists ? (
                            <span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-emerald-600 dark:text-emerald-100">
                              Ready
                            </span>
                          ) : (
                            <span className="rounded-full border border-sky-300/25 bg-sky-300/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-sky-600 dark:text-sky-100">
                              New
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
                {editableFiles.length === 0 ? (
                  <p className="rounded-[1rem] border border-[var(--theme-border)] bg-[var(--theme-surface-strong)] px-3 py-3 text-xs text-[var(--theme-fg-muted)]">
                    This backend does not expose editable host files.
                  </p>
                ) : null}
              </div>
            </div>

            {activeManagementSchema.configArchives ? (
            <div className="rounded-[1.1rem] border border-[var(--theme-border)] bg-[var(--theme-surface)] px-3 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[var(--theme-fg)]">Config archives</p>
                  <p className="mt-1 text-xs leading-5 text-[var(--theme-fg-muted)]">
                    Backup the selected backend host files, then apply a saved archive with a backend restart.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleCreateArchive()}
                  disabled={archivesState.creating}
                  className="shrink-0 rounded-full border border-[var(--theme-accent-border)] bg-[var(--theme-accent-soft)] px-3 py-1.5 text-xs font-medium text-[var(--theme-accent-strong)] transition hover:bg-[var(--theme-hover)] disabled:cursor-not-allowed disabled:border-[var(--theme-border)] disabled:bg-[var(--theme-muted)] disabled:text-[var(--theme-fg-muted)]"
                >
                  {archivesState.creating ? 'Creating...' : 'Create backup'}
                </button>
              </div>
              {archivesState.error ? (
                <p className="mt-2 text-xs text-rose-300">{archivesState.error}</p>
              ) : archivesState.message ? (
                <p className="mt-2 text-xs text-emerald-300">{archivesState.message}</p>
              ) : null}
              <div className="mt-3 space-y-2">
                {archivesState.loading ? (
                  <p className="rounded-[1rem] border border-[var(--theme-border)] bg-[var(--theme-surface-strong)] px-3 py-3 text-xs text-[var(--theme-fg-muted)]">
                    Loading backups...
                  </p>
                ) : archives.length === 0 ? (
                  <p className="rounded-[1rem] border border-[var(--theme-border)] bg-[var(--theme-surface-strong)] px-3 py-3 text-xs text-[var(--theme-fg-muted)]">
                    No config backups yet.
                  </p>
                ) : (
                  archives.map((archive) => {
                    const renaming = archivesState.renamingId === archive.id;
                    return (
                      <div
                        key={archive.id}
                        className="rounded-[1.1rem] border border-[var(--theme-border)] bg-[var(--theme-surface-strong)] px-3 py-3"
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            {renaming ? (
                              <div className="flex max-w-xl gap-2">
                                <input
                                  aria-label={`Rename ${archive.label}`}
                                  value={archivesState.renameDraft}
                                  onChange={(event) =>
                                    setArchivesState((current) => ({
                                      ...current,
                                      renameDraft: event.target.value,
                                      error: null,
                                      message: null,
                                    }))
                                  }
                                  className="min-w-0 flex-1 rounded-full border border-[var(--theme-border)] bg-[var(--theme-panel)] px-3 py-1.5 text-sm text-[var(--theme-fg)] outline-none focus:border-[var(--theme-accent-border)]"
                                />
                                <button
                                  type="button"
                                  aria-label={`Save archive name ${archive.label}`}
                                  onClick={() => void handleRenameArchive(archive)}
                                  className="rounded-full bg-[var(--theme-accent-solid)] px-3 py-1.5 text-xs font-medium text-[var(--theme-accent-solid-fg)] transition hover:bg-[var(--theme-accent-solid-hover)]"
                                >
                                  Save
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
                                  className="rounded-full border border-[var(--theme-border)] bg-[var(--theme-panel)] px-3 py-1.5 text-xs font-medium text-[var(--theme-fg)] transition hover:bg-[var(--theme-hover)]"
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
                              <span>Created {formatArchiveDate(archive.createdAt)}</span>
                              {editableFiles.map((file) => (
                                <span
                                  key={file.name}
                                  className="rounded-full border border-[var(--theme-border)] bg-[var(--theme-panel)] px-2 py-0.5 font-mono"
                                >
                                  {file.name}: {archive.files[file.name as keyof typeof archive.files]?.exists ? 'saved' : 'missing'}
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
                              disabled={renaming}
                              className="rounded-full border border-[var(--theme-border)] bg-[var(--theme-panel)] px-3 py-1.5 text-xs font-medium text-[var(--theme-fg)] transition hover:bg-[var(--theme-hover)] disabled:cursor-not-allowed disabled:text-[var(--theme-fg-muted)]"
                            >
                              Rename
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleApplyArchive(archive)}
                              disabled={archivesState.applyingId !== null}
                              className="rounded-full border border-emerald-400/35 bg-emerald-400/10 px-3 py-1.5 text-xs font-medium text-emerald-600 transition hover:bg-emerald-400/16 disabled:cursor-not-allowed disabled:border-[var(--theme-border)] disabled:bg-[var(--theme-muted)] disabled:text-[var(--theme-fg-muted)] dark:text-emerald-100"
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
            </div>
            ) : null}
          </div>
        </div>
      </section>

      {selectedFileName && selectedFile ? (
        <div className="pointer-events-none fixed inset-0 z-[71] flex items-center justify-center p-4">
          <div className="pointer-events-auto relative z-10 flex max-h-[min(88vh,56rem)] w-full max-w-3xl flex-col overflow-hidden rounded-[1.6rem] border border-[var(--theme-border)] bg-[var(--theme-panel)] shadow-2xl shadow-black/25">
            <div className="flex items-start justify-between gap-3 border-b border-[var(--theme-border)] px-4 py-3 sm:px-5">
              <div className="min-w-0">
                <p className="text-sm font-medium text-[var(--theme-fg)]">{selectedFileName}</p>
                <p className="mt-1 break-all font-mono text-xs text-[var(--theme-fg-muted)]">
                  {selectedFile.path}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {selectedFile.error ? (
                  <span className="text-xs text-rose-300">{selectedFile.error}</span>
                ) : selectedFile.saveMessage ? (
                  <span className="text-xs text-emerald-300">{selectedFile.saveMessage}</span>
                ) : null}
                <button
                  type="button"
                  aria-label={`Save ${selectedFileName}`}
                  onClick={() => void handleSave(selectedFileName)}
                  disabled={
                    selectedFile.loading ||
                    selectedFile.saving ||
                    selectedFile.draftContent === selectedFile.originalContent
                  }
                  className="rounded-full bg-[var(--theme-accent-solid)] px-4 py-2 text-sm font-medium text-[var(--theme-accent-solid-fg)] transition hover:bg-[var(--theme-accent-solid-hover)] disabled:cursor-not-allowed disabled:bg-[var(--theme-muted)] disabled:text-[var(--theme-fg-muted)]"
                >
                  {selectedFile.saving ? 'Saving...' : 'Save'}
                </button>
                <button
                  type="button"
                  aria-label="Close File Editor"
                  onClick={() => setSelectedFileName(null)}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[var(--theme-border-strong)] bg-[var(--theme-surface-strong)] text-[var(--theme-fg)] transition hover:border-[var(--theme-border-contrast)] hover:bg-[var(--theme-hover)]"
                >
                  <CloseIcon />
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
              <textarea
                aria-label={`Edit ${selectedFileName}`}
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
                className="min-h-[28rem] w-full rounded-[1rem] border border-[var(--theme-border)] bg-[var(--theme-surface-strong)] px-3 py-3 font-mono text-[13px] leading-6 text-[var(--theme-fg)] outline-none transition focus:border-[var(--theme-accent-border)]"
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
