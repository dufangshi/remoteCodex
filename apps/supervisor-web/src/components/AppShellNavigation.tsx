import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { useAppShellNav } from './AppShellNavContext';
import {
  CloseIcon,
  MenuIcon,
  menuItemClassName,
} from './appShellNavigationModel';
import {
  currentRelayScopedPath,
  currentWorkspacesHref,
} from '../lib/relayRoutes';
export { AppShellSettingsDialog } from './AppShellSettingsDialog';

export function AppShellMenuButton({ className = '' }: { className?: string }) {
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
  const isWorkspacesRoute =
    location.pathname === '/workspaces' ||
    /^\/devices\/[^/]+\/workspaces$/.test(location.pathname);
  const isImportRoute =
    location.pathname === '/threads/import' ||
    /^\/devices\/[^/]+\/threads\/import$/.test(location.pathname);

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

      const trigger =
        target instanceof Element
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
            navigate(currentWorkspacesHref());
          }}
          className={menuItemClassName(isWorkspacesRoute)}
        >
          Workspaces
        </button>
        <button
          type="button"
          disabled={isImportRoute}
          onClick={() => {
            if (isImportRoute) {
              return;
            }

            shellNav.closeNav();
            navigate(currentRelayScopedPath('/threads/import'));
          }}
          className={menuItemClassName(isImportRoute)}
        >
          Import Session
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
