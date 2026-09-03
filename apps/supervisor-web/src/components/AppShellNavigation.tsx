import { useEffect, useRef } from 'react';
import { FolderKanban, Import, Menu, Settings, X } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';

import { useAppShellNav } from './AppShellNavContext';
import { menuItemClassName } from './appShellNavigationModel';
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
      className={`product-icon-button text-[var(--theme-fg)] ${className}`.trim()}
    >
      {shellNav.navOpen ? <X aria-hidden="true" className="h-4 w-4" /> : <Menu aria-hidden="true" className="h-4 w-4" />}
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

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        activeNav.closeNav();
        document
          .querySelector<HTMLElement>('[aria-controls="app-shell-navigation-menu"]')
          ?.focus();
      }
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    const focusTimer = window.setTimeout(() => {
      menuRef.current?.querySelector<HTMLElement>('button, a[href]')?.focus();
    }, 0);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
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
      className={`w-64 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-panel)] p-2 shadow-[var(--theme-shadow)] ${className}`.trim()}
    >
      <div className="border-b border-[var(--theme-border)] px-3 pb-2.5 pt-1.5">
        <p className="text-sm font-semibold text-[var(--theme-fg)]">
          Remote Codex
        </p>
        <p className="mt-0.5 text-xs text-[var(--theme-fg-muted)]">
          Supervisor controls
        </p>
      </div>
      <nav aria-label="Supervisor navigation" className="mt-1 flex flex-col gap-0.5 text-sm">
        <button
          type="button"
          aria-current={isWorkspacesRoute ? 'page' : undefined}
          onClick={() => {
            if (isWorkspacesRoute) {
              shellNav.closeNav();
              return;
            }

            shellNav.closeNav();
            navigate(currentWorkspacesHref());
          }}
          className={menuItemClassName(isWorkspacesRoute)}
        >
          <FolderKanban aria-hidden="true" className="h-4 w-4" />
          Workspaces
        </button>
        <button
          type="button"
          aria-current={isImportRoute ? 'page' : undefined}
          onClick={() => {
            if (isImportRoute) {
              shellNav.closeNav();
              return;
            }

            shellNav.closeNav();
            navigate(currentRelayScopedPath('/threads/import'));
          }}
          className={menuItemClassName(isImportRoute)}
        >
          <Import aria-hidden="true" className="h-4 w-4" />
          Import Session
        </button>
        <button
          type="button"
          onClick={() => {
            shellNav.openSettings();
          }}
          className={menuItemClassName()}
        >
          <Settings aria-hidden="true" className="h-4 w-4" />
          Settings
        </button>
      </nav>
    </div>
  );
}
