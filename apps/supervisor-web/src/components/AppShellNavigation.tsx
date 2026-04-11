import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

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
        className="relative z-10 w-full max-w-md rounded-[1.8rem] border border-stone-800 bg-stone-900/96 p-5 shadow-2xl shadow-stone-950/45"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-stone-500">
              Settings
            </p>
            <h2 className="mt-2 text-xl font-semibold text-stone-100">
              Settings
            </h2>
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
        <p className="mt-4 text-sm leading-6 text-stone-400">
          Settings content will land here in a later pass.
        </p>
      </section>
    </div>
  );
}
