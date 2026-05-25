import {
  BrowserRouter,
  Outlet,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom';
import { useEffect, useState } from 'react';

import type { AgentBackendIdDto } from '../../../packages/shared/src/index';
import {
  defaultAgentBackendId,
  normalizeAgentBackendId,
} from '../../../packages/shared/src/index';
import {
  AppShellNavContext,
  type ThemeMode,
} from './components/AppShellNavContext';
import {
  AppShellMenuButton,
  AppShellNavigationMenu,
  AppShellSettingsDialog,
} from './components/AppShellNavigation';
import { ControlPlanePage } from './pages/ControlPlanePage';
import { LandingPage } from './pages/LandingPage';
import { ThreadDetailPage } from './pages/ThreadDetailPage';
import { ThreadImportPage } from './pages/ThreadImportPage';
import { ThreadNewPage } from './pages/ThreadNewPage';
import { ThreadsPage } from './pages/ThreadsPage';
import { WorkspaceNewPage } from './pages/WorkspaceNewPage';
import { WorkspacesPage } from './pages/WorkspacesPage';
import { PluginProvider } from './plugins/PluginProvider';

const THEME_STORAGE_KEY = 'remote-codex-theme-mode';
const BACKEND_STORAGE_KEY = 'remote-codex-default-backend';

function readInitialThemeMode(): ThemeMode {
  if (typeof window === 'undefined') {
    return 'system';
  }

  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === 'light' || stored === 'dark' || stored === 'system') {
    return stored;
  }

  return 'system';
}

function readInitialBackend(): AgentBackendIdDto {
  if (typeof window === 'undefined') {
    return defaultAgentBackendId;
  }

  const stored = window.localStorage.getItem(BACKEND_STORAGE_KEY);
  return normalizeAgentBackendId(stored) ?? defaultAgentBackendId;
}

function systemThemePreference(): 'light' | 'dark' {
  if (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  ) {
    return 'dark';
  }

  return 'light';
}

function AppShell({
  themeMode,
  setThemeMode,
  effectiveTheme,
}: {
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  effectiveTheme: 'light' | 'dark';
}) {
  const [navOpen, setNavOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [defaultBackend, setDefaultBackendState] = useState<AgentBackendIdDto>(readInitialBackend);
  const location = useLocation();
  const isThreadDetailRoute = /^\/threads\/[^/]+$/.test(location.pathname);
  const isThreadsRoute = location.pathname === '/threads';
  const isViewportLockedRoute = isThreadDetailRoute || isThreadsRoute;
  const isThreadWorkspaceRoute =
    isThreadsRoute || isThreadDetailRoute;
  const isWorkspacesRoute = location.pathname === '/workspaces';
  const isControlPlaneRoute = location.pathname === '/control-plane';
  const usesInlineTopbar = isWorkspacesRoute || isThreadsRoute || isControlPlaneRoute;

  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname, location.search]);

  function setDefaultBackend(backend: AgentBackendIdDto) {
    setDefaultBackendState(backend);
    window.localStorage.setItem(BACKEND_STORAGE_KEY, backend);
  }

  return (
    <AppShellNavContext.Provider
      value={{
        navOpen,
        openNav: () => setNavOpen(true),
        toggleNav: () => setNavOpen((current) => !current),
        closeNav: () => setNavOpen(false),
        settingsOpen,
        openSettings: () => {
          setNavOpen(false);
          setSettingsOpen(true);
        },
        closeSettings: () => setSettingsOpen(false),
        themeMode,
        setThemeMode,
        effectiveTheme,
        defaultBackend,
        setDefaultBackend,
      }}
    >
      <div
        className={`bg-[var(--app-bg)] text-[var(--app-fg)] ${
          isViewportLockedRoute
            ? 'fixed inset-0 overflow-hidden overscroll-none'
            : 'min-h-screen'
        }`}
      >
        {!usesInlineTopbar && (
          <div
            className={`fixed left-4 top-4 z-50 ${
              isThreadDetailRoute ? 'hidden sm:block' : ''
            }`}
          >
            <AppShellMenuButton />
            <AppShellNavigationMenu className="mt-3 w-[min(22rem,calc(100vw-2rem))]" />
          </div>
        )}

        <main
          className={`mx-auto w-full max-w-[1600px] ${
            isViewportLockedRoute ? 'absolute inset-0 pb-0 sm:pb-4' : 'pb-4'
          } ${
            isThreadWorkspaceRoute
              ? isThreadDetailRoute
                ? 'pt-[env(safe-area-inset-top)] sm:pt-4'
                : isThreadsRoute
                  ? 'pt-[env(safe-area-inset-top)] sm:pt-4'
                  : 'pt-[calc(env(safe-area-inset-top)+4rem)] sm:pt-4'
              : isWorkspacesRoute || isControlPlaneRoute
                ? 'pt-[env(safe-area-inset-top)] sm:pt-4'
                : 'pt-4'
          } ${
            isViewportLockedRoute
              ? 'overflow-hidden overscroll-none px-0 sm:px-6'
              : 'px-4 sm:px-6'
          }`}
        >
          <section
            className={`min-w-0 ${
              isViewportLockedRoute
                ? isThreadDetailRoute
                  ? 'h-full min-h-0 overflow-hidden overscroll-none'
                  : 'h-full overflow-hidden overscroll-none'
                : ''
            }`}
          >
            <Outlet />
          </section>
        </main>
      </div>
      <AppShellSettingsDialog />
    </AppShellNavContext.Provider>
  );
}

export function App() {
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => readInitialThemeMode());
  const [systemTheme, setSystemTheme] = useState<'light' | 'dark'>(() =>
    systemThemePreference(),
  );
  const effectiveTheme = themeMode === 'system' ? systemTheme : themeMode;

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => {
      setSystemTheme(mediaQuery.matches ? 'dark' : 'light');
    };

    update();
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', update);
    } else {
      mediaQuery.addListener(update);
    }
    return () => {
      if (typeof mediaQuery.removeEventListener === 'function') {
        mediaQuery.removeEventListener('change', update);
      } else {
        mediaQuery.removeListener(update);
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
  }, [themeMode]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.themeMode = themeMode;
    root.dataset.themeEffective = effectiveTheme;
    root.style.colorScheme = effectiveTheme;
  }, [effectiveTheme, themeMode]);

  return (
    <div className="theme-shell theme-scrollbar">
      <PluginProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route
              element={
                <AppShell
                  themeMode={themeMode}
                  setThemeMode={setThemeMode}
                  effectiveTheme={effectiveTheme}
                />
              }
            >
              <Route path="/workspaces" element={<WorkspacesPage />} />
              <Route path="/workspaces/new" element={<WorkspaceNewPage />} />
              <Route path="/control-plane" element={<ControlPlanePage />} />
              <Route path="/threads" element={<ThreadsPage />} />
              <Route path="/threads/import" element={<ThreadImportPage />} />
              <Route path="/threads/new" element={<ThreadNewPage />} />
              <Route path="/threads/:id" element={<ThreadDetailPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </PluginProvider>
    </div>
  );
}
