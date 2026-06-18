import {
  BrowserRouter,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { PluginProvider } from '@remote-codex/thread-ui';

import type {
  AgentBackendIdDto,
  AuthSessionDto,
  RelaySessionDto,
} from '../../../packages/shared/src/index';
import {
  defaultAgentBackendId,
  normalizeAgentBackendId,
} from '@remote-codex/shared';
import {
  AppShellNavContext,
  type ThemeMode,
} from './components/AppShellNavContext';
import {
  AppShellMenuButton,
  AppShellNavigationMenu,
  AppShellSettingsDialog,
} from './components/AppShellNavigation';
import { RelayUserMenu } from './components/RelayUserMenu';
import { ControlPlanePage } from './pages/ControlPlanePage';
import {
  ControlPlaneAuthGuard,
  ControlPlaneLoginPage,
} from './pages/ControlPlaneLoginPage';
import { ControlPlaneSessionPage } from './pages/ControlPlaneSessionPage';
import { LoginPage } from './pages/LoginPage';
import { RelayAccountPage } from './pages/RelayAccountPage';
import { RelayAdminPage } from './pages/RelayAdminPage';
import { RelayDevicesPage } from './pages/RelayDevicesPage';
import { RelayPortalPage } from './pages/RelayPortalPage';
import { ThreadDetailPage } from './pages/ThreadDetailPage';
import { ThreadImportPage } from './pages/ThreadImportPage';
import { ThreadNewPage } from './pages/ThreadNewPage';
import { ThreadsPage } from './pages/ThreadsPage';
import { WorkspaceNewPage } from './pages/WorkspaceNewPage';
import { WorkspacesPage } from './pages/WorkspacesPage';
import {
  ApiError,
  deletePlugin,
  fetchAuthSession,
  fetchPlugins,
  fetchRelaySession,
  importPlugin,
  login,
  relayModeActive,
  updatePlugin,
} from './lib/api';

const THEME_STORAGE_KEY = 'remote-codex-theme-mode';
const BACKEND_STORAGE_KEY = 'remote-codex-default-backend';

function controlPlaneDefaultEnabled() {
  return Boolean(import.meta.env.VITE_CONTROL_PLANE_BASE_URL);
}

function RootPage() {
  return controlPlaneDefaultEnabled() ? <Navigate to="/control-plane" replace /> : <Navigate to="/workspaces" replace />;
}

function RoutePluginProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const isControlPlaneRoute =
    location.pathname.startsWith('/control-plane') ||
    (location.pathname === '/' && controlPlaneDefaultEnabled());
  const adapter = useMemo(
    () =>
      isControlPlaneRoute
        ? {}
        : {
            fetchPlugins,
            importPlugin,
            updatePlugin,
            deletePlugin,
          },
    [isControlPlaneRoute],
  );

  return <PluginProvider adapter={adapter}>{children}</PluginProvider>;
}

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
  const isControlPlaneSessionRoute = /^\/control-plane\/sessions\/[^/]+$/.test(location.pathname);
  const isThreadsRoute = location.pathname === '/threads';
  const isViewportLockedRoute = isThreadDetailRoute || isControlPlaneSessionRoute || isThreadsRoute;
  const isThreadWorkspaceRoute =
    isThreadsRoute || isThreadDetailRoute || isControlPlaneSessionRoute;
  const ownsNavigationShell = isThreadDetailRoute || isControlPlaneSessionRoute;
  const isWorkspacesRoute = location.pathname === '/workspaces';
  const isControlPlaneRoute = location.pathname.startsWith('/control-plane');
  const usesInlineTopbar = isWorkspacesRoute || isThreadsRoute || isControlPlaneRoute;

  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname, location.search]);

  function setDefaultBackend(backend: AgentBackendIdDto) {
    setDefaultBackendState(backend);
    window.localStorage.setItem(BACKEND_STORAGE_KEY, backend);
  }

  const shellNavValue = {
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
  };

  return (
    <AppShellNavContext.Provider value={shellNavValue}>
      <div
        className={`bg-[var(--app-bg)] text-[var(--app-fg)] ${
          isViewportLockedRoute
            ? 'fixed inset-0 overflow-hidden overscroll-none'
            : 'min-h-screen'
        }`}
      >
        {isWorkspacesRoute ? <RelayUserMenu /> : null}
        {!usesInlineTopbar && !ownsNavigationShell && (
          <div className="fixed left-4 top-4 z-50">
            <AppShellMenuButton />
            <AppShellNavigationMenu className="mt-3 w-[min(22rem,calc(100vw-2rem))]" />
          </div>
        )}

        <main
          className={`mx-auto w-full ${
            isThreadWorkspaceRoute ? 'max-w-none' : 'max-w-[1600px]'
          } ${
            isViewportLockedRoute ? 'absolute inset-0 pb-0 sm:pb-4' : 'pb-4'
          } ${
            isThreadWorkspaceRoute
              ? isThreadDetailRoute || isControlPlaneSessionRoute
                ? 'pt-0'
                : isThreadsRoute
                  ? 'pt-[env(safe-area-inset-top)] sm:pt-4'
                  : 'pt-[calc(env(safe-area-inset-top)+4rem)] sm:pt-4'
              : isWorkspacesRoute || isControlPlaneRoute
                ? 'pt-[env(safe-area-inset-top)] sm:pt-4'
                : 'pt-4'
          } ${
            isViewportLockedRoute
              ? isThreadDetailRoute || isControlPlaneSessionRoute
                ? 'overflow-hidden overscroll-none px-0'
                : 'overflow-hidden overscroll-none px-0 sm:px-6'
              : 'px-4 sm:px-6'
          }`}
        >
          <section
            className={`min-w-0 ${
              isViewportLockedRoute
                ? isThreadDetailRoute || isControlPlaneSessionRoute
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

function AuthGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<
    | { status: 'checking' }
    | { status: 'authenticated' }
    | { status: 'loginRequired'; session: AuthSessionDto; error: string | null }
    | { status: 'unavailable'; error: string }
  >({ status: 'checking' });

  async function checkSession(cancelled?: () => boolean) {
    try {
      const session = await fetchAuthSession();
      if (cancelled?.()) {
        return;
      }
      setState(
        !session.authRequired || session.authenticated
          ? { status: 'authenticated' }
          : { status: 'loginRequired', session, error: null },
      );
    } catch (caught) {
      if (cancelled?.()) {
        return;
      }
      if (caught instanceof ApiError && caught.statusCode === 401) {
        setState({
          status: 'loginRequired',
          session: {
            authenticated: false,
            username: null,
            expiresAt: null,
            mode: 'server',
            authRequired: true,
          },
          error: null,
        });
        return;
      }
      setState({
        status: 'unavailable',
        error: caught instanceof Error ? caught.message : 'Unable to check supervisor access.',
      });
    }
  }

  useEffect(() => {
    let cancelled = false;
    void checkSession(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLogin(input: { username: string; password: string }) {
    await login(input);
    setState({ status: 'authenticated' });
  }

  function handleRetry() {
    setState({ status: 'checking' });
    void checkSession();
  }

  if (state.status === 'checking') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--app-bg)] px-4 text-sm text-[var(--theme-muted)]">
        Checking supervisor access...
      </main>
    );
  }

  if (state.status === 'unavailable') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--app-bg)] px-4 text-[var(--app-fg)]">
        <section className="w-full max-w-md rounded-[1.35rem] border border-[var(--theme-border)] bg-[var(--theme-panel)] p-5 shadow-2xl shadow-[color-mix(in_oklch,var(--app-fg)_14%,transparent)] sm:p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--theme-muted)]">
            Supervisor Access
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-normal text-[var(--theme-fg)]">
            Unable to reach supervisor
          </h1>
          <p className="mt-3 text-sm leading-6 text-[var(--theme-muted)]">
            {state.error}
          </p>
          <button
            className="mt-5 h-11 rounded-xl bg-[var(--theme-accent-solid)] px-4 text-sm font-semibold text-[var(--theme-accent-solid-fg)] transition hover:bg-[var(--theme-accent-solid-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--theme-accent-border)]"
            onClick={handleRetry}
            type="button"
          >
            Retry
          </button>
        </section>
      </main>
    );
  }

  if (state.status === 'loginRequired') {
    return (
      <>
        {state.error && (
          <div className="fixed left-1/2 top-4 z-50 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 rounded-xl border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-3 py-2 text-sm text-[var(--status-warning-fg)]">
            {state.error}
          </div>
        )}
        <LoginPage onLogin={handleLogin} />
      </>
    );
  }

  return children;
}

function RelayGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<
    | { status: 'checking' }
    | { status: 'authenticated'; session: RelaySessionDto }
    | { status: 'loginRequired' }
  >({ status: 'checking' });

  useEffect(() => {
    let cancelled = false;
    fetchRelaySession()
      .then((session) => {
        if (cancelled) {
          return;
        }
        setState(
          session.authenticated
            ? { status: 'authenticated', session }
            : { status: 'loginRequired' },
        );
      })
      .catch(() => {
        if (!cancelled) {
          setState({ status: 'loginRequired' });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === 'checking') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--app-bg)] px-4 text-sm text-[var(--theme-muted)]">
        Checking relay access...
      </main>
    );
  }

  if (state.status === 'loginRequired') {
    return <RelayPortalPage />;
  }

  return children;
}

function SupervisorAccessGate({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  if (location.pathname.startsWith('/control-plane')) {
    return children;
  }

  return relayModeActive() ? <RelayGate>{children}</RelayGate> : <AuthGate>{children}</AuthGate>;
}

function SupervisorRoutes({
  themeMode,
  setThemeMode,
  effectiveTheme,
}: {
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  effectiveTheme: 'light' | 'dark';
}) {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/workspaces" replace />} />
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
        <Route path="/relay-account" element={<RelayAccountPage />} />
        <Route path="/relay-devices" element={<RelayDevicesPage />} />
        <Route path="/control-plane/login" element={<ControlPlaneLoginPage />} />
        <Route
          path="/control-plane"
          element={
            <ControlPlaneAuthGuard>
              <ControlPlanePage />
            </ControlPlaneAuthGuard>
          }
        />
        <Route
          path="/control-plane/sessions/:sessionId"
          element={
            <ControlPlaneAuthGuard>
              <ControlPlaneSessionPage />
            </ControlPlaneAuthGuard>
          }
        />
        <Route path="/threads" element={<ThreadsPage />} />
        <Route path="/threads/import" element={<ThreadImportPage />} />
        <Route path="/threads/new" element={<ThreadNewPage />} />
        <Route path="/threads/:id" element={<ThreadDetailPage />} />
      </Route>
    </Routes>
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
      <BrowserRouter>
        <RoutePluginProvider>
          <Routes>
            <Route path="/" element={<RootPage />} />
            <Route path="/relay-portal" element={<RelayPortalPage />} />
            <Route path="/relay-admin" element={<RelayAdminPage />} />
            <Route
              path="/*"
              element={
                <SupervisorAccessGate>
                  <SupervisorRoutes
                    themeMode={themeMode}
                    setThemeMode={setThemeMode}
                    effectiveTheme={effectiveTheme}
                  />
                </SupervisorAccessGate>
              }
            />
          </Routes>
        </RoutePluginProvider>
      </BrowserRouter>
    </div>
  );
}
