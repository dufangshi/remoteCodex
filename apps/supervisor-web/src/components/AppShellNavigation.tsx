import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import type { CodexHostFileNameDto } from '../../../../packages/shared/src/index';
import {
  ApiError,
  fetchCodexHostFile,
  restartCodexAppServer,
  updateCodexHostFile,
} from '../lib/api';
import { useAppShellNav } from './AppShellNavContext';

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
      ? 'cursor-not-allowed bg-stone-800/60 text-stone-500'
      : 'text-stone-200 hover:bg-stone-800'
  }`;
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
      className={`inline-flex h-10 w-10 shrink-0 items-center justify-center text-stone-100 transition hover:text-stone-300 ${className}`.trim()}
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
  const isWorkspacesRoute = location.pathname === '/workspaces';

  if (!shellNav?.navOpen) {
    return null;
  }

  return (
    <div
      id="app-shell-navigation-menu"
      className={`rounded-[1.8rem] border border-stone-800 bg-stone-900/94 p-4 shadow-2xl shadow-stone-950/35 backdrop-blur ${className}`.trim()}
    >
      <div>
        <p className="text-base font-semibold tracking-wide text-amber-300">
          Remote Codex
        </p>
        <p className="mt-1 text-xs uppercase tracking-[0.24em] text-stone-500">
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
  const editableFiles = useMemo(
    () =>
      [
        {
          name: 'config.toml' as const,
          label: 'config.toml',
          description: 'Codex runtime configuration',
        },
        {
          name: 'auth.json' as const,
          label: 'auth.json',
          description: 'Codex authentication state',
        },
      ] satisfies Array<{
        name: CodexHostFileNameDto;
        label: string;
        description: string;
      }>,
    [],
  );
  const [selectedFileName, setSelectedFileName] = useState<CodexHostFileNameDto | null>(null);
  const [files, setFiles] = useState<
    Record<
      CodexHostFileNameDto,
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
  >({
    'config.toml': {
      path: '~/.codex/config.toml',
      exists: false,
      originalContent: '',
      draftContent: '',
      loading: false,
      saving: false,
      error: null,
      saveMessage: null,
    },
    'auth.json': {
      path: '~/.codex/auth.json',
      exists: false,
      originalContent: '',
      draftContent: '',
      loading: false,
      saving: false,
      error: null,
      saveMessage: null,
    },
  });
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

  useEffect(() => {
    if (!shellNav?.settingsOpen) {
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

    async function loadFiles() {
      setFiles((current) => ({
        'config.toml': {
          ...current['config.toml'],
          loading: true,
          error: null,
          saveMessage: null,
        },
        'auth.json': {
          ...current['auth.json'],
          loading: true,
          error: null,
          saveMessage: null,
        },
      }));

      const results = await Promise.allSettled(
        editableFiles.map(async (file) => ({
          name: file.name,
          result: await fetchCodexHostFile(file.name),
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
            editableFiles[results.indexOf(result)]?.name ?? 'config.toml';
          next[failedName] = {
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
  }, [editableFiles, shellNav?.settingsOpen]);

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
      const status = await restartCodexAppServer();
      setRestartState({
        busy: false,
        message: status.state === 'ready' ? 'App server restarted.' : `App server state: ${status.state}`,
        error: null,
      });
    } catch (error) {
      setRestartState({
        busy: false,
        message: null,
        error:
          error instanceof ApiError ? error.message : 'Unable to restart the app server.',
      });
    }
  }

  async function handleSave(name: CodexHostFileNameDto) {
    const fileState = files[name];
    if (!fileState || fileState.saving) {
      return;
    }

    setFiles((current) => ({
      ...current,
      [name]: {
        ...current[name],
        saving: true,
        error: null,
        saveMessage: null,
      },
    }));

    try {
      const updated = await updateCodexHostFile(name, {
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
          ...current[name],
          saving: false,
          error:
            error instanceof ApiError ? error.message : 'Unable to save the file.',
          saveMessage: null,
        },
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
        className="absolute inset-0 bg-stone-950/72 backdrop-blur-sm"
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className="relative z-10 flex max-h-[calc(100vh-2rem)] w-full max-w-4xl flex-col overflow-hidden rounded-[1.8rem] border border-stone-800 bg-stone-900/96 shadow-2xl shadow-stone-950/45"
      >
        <div className="shrink-0 p-5 pb-0">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-stone-500">
                Settings
              </p>
              <h2 className="mt-2 text-xl font-semibold text-stone-100">
                Settings
              </h2>
              <p className="mt-2 text-sm leading-6 text-stone-400">
                Edit host-side Codex configuration files through supervisor.
              </p>
            </div>
            <button
              type="button"
              aria-label="Close Settings"
              onClick={shellNav.closeSettings}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-stone-700/80 bg-stone-900/88 text-stone-100 transition hover:border-stone-500 hover:bg-stone-900"
            >
              <CloseIcon />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5 pt-5">
          <div className="grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
            <div className="space-y-2">
              <div className="rounded-[1.1rem] border border-stone-800 bg-stone-950/55 px-3 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-stone-100">Codex app-server</p>
                    <p className="mt-1 text-xs leading-5 text-stone-500">
                      Restart after editing host configuration to force a fresh reload.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleRestartAppServer()}
                    disabled={restartState.busy}
                    className="shrink-0 rounded-full border border-sky-300/30 bg-sky-300/12 px-3 py-1.5 text-xs font-medium text-sky-100 transition hover:bg-sky-300/20 disabled:cursor-not-allowed disabled:border-stone-700 disabled:bg-stone-800 disabled:text-stone-500"
                  >
                    {restartState.busy ? 'Restarting...' : 'Restart'}
                  </button>
                </div>
                {restartState.error ? (
                  <p className="mt-2 text-xs text-rose-300">{restartState.error}</p>
                ) : restartState.message ? (
                  <p className="mt-2 text-xs text-emerald-300">{restartState.message}</p>
                ) : null}
              </div>

              {editableFiles.map((file) => {
                const state = files[file.name];
                const selected = selectedFileName === file.name;
                const dirty = state.draftContent !== state.originalContent;

                return (
                  <button
                    key={file.name}
                    type="button"
                    aria-expanded={selected}
                    onClick={() =>
                      setSelectedFileName((current) => (current === file.name ? null : file.name))
                    }
                    className={`block w-full rounded-[1.1rem] border px-3 py-3 text-left transition ${
                      selected
                        ? 'border-amber-300/45 bg-amber-300/[0.08]'
                        : 'border-stone-800 bg-stone-950/55 hover:bg-stone-900'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-stone-100">
                          {file.label}
                        </p>
                        <p className="mt-1 text-xs leading-5 text-stone-500">
                          {file.description}
                        </p>
                      </div>
                      <div className="shrink-0">
                        {state.loading ? (
                          <span className="text-[11px] uppercase tracking-[0.2em] text-stone-500">
                            Loading
                          </span>
                        ) : dirty ? (
                          <span className="rounded-full border border-amber-300/28 bg-amber-300/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-amber-100">
                            Unsaved
                          </span>
                        ) : state.exists ? (
                          <span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-emerald-100">
                            Ready
                          </span>
                        ) : (
                          <span className="rounded-full border border-sky-300/25 bg-sky-300/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-sky-100">
                            New
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {selectedFileName && selectedFile ? (
              <div className="min-w-0 rounded-[1.25rem] border border-stone-800 bg-stone-950/55 p-3 sm:p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-stone-100">{selectedFileName}</p>
                    <p className="mt-1 break-all font-mono text-xs text-stone-500">
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
                      onClick={() => void handleSave(selectedFileName)}
                      disabled={
                        selectedFile.loading ||
                        selectedFile.saving ||
                        selectedFile.draftContent === selectedFile.originalContent
                      }
                      className="rounded-full bg-amber-300 px-4 py-2 text-sm font-medium text-stone-950 transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:bg-stone-700 disabled:text-stone-400"
                    >
                      {selectedFile.saving ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                </div>

                <textarea
                  aria-label={`Edit ${selectedFileName}`}
                  value={selectedFile.draftContent}
                  onChange={(event) =>
                    setFiles((current) => ({
                      ...current,
                      [selectedFileName]: {
                        ...current[selectedFileName],
                        draftContent: event.target.value,
                        error: null,
                        saveMessage: null,
                      },
                    }))
                  }
                  spellCheck={false}
                  className="mt-4 min-h-[22rem] w-full rounded-[1rem] border border-stone-800 bg-stone-950 px-3 py-3 font-mono text-[13px] leading-6 text-stone-100 outline-none transition focus:border-amber-300"
                  placeholder={
                    selectedFile.loading
                      ? 'Loading...'
                      : `Edit ${selectedFileName} here`
                  }
                />
              </div>
            ) : (
              <div className="flex min-h-[12rem] items-center justify-center rounded-[1.25rem] border border-dashed border-stone-800 bg-stone-950/35 px-4 py-6 text-center">
                <p className="max-w-sm text-sm leading-6 text-stone-500">
                  Select `config.toml` or `auth.json` to open the editor.
                </p>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
