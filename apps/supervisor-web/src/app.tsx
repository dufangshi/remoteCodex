import {
  BrowserRouter,
  Outlet,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom';
import { useEffect, useState } from 'react';

import { AppShellNavContext } from './components/AppShellNavContext';
import {
  AppShellMenuButton,
  AppShellNavigationMenu,
  AppShellSettingsDialog,
} from './components/AppShellNavigation';
import { LandingPage } from './pages/LandingPage';
import { ThreadDetailPage } from './pages/ThreadDetailPage';
import { ThreadImportPage } from './pages/ThreadImportPage';
import { ThreadNewPage } from './pages/ThreadNewPage';
import { ThreadsPage } from './pages/ThreadsPage';
import { WorkspaceNewPage } from './pages/WorkspaceNewPage';
import { WorkspacesPage } from './pages/WorkspacesPage';

function AppShell() {
  const [navOpen, setNavOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const location = useLocation();
  const isThreadDetailRoute = /^\/threads\/[^/]+$/.test(location.pathname);
  const isThreadsRoute = location.pathname === '/threads';
  const isViewportLockedRoute = isThreadDetailRoute || isThreadsRoute;
  const isThreadWorkspaceRoute =
    isThreadsRoute || isThreadDetailRoute;
  const isWorkspacesRoute = location.pathname === '/workspaces';
  const usesInlineTopbar = isWorkspacesRoute || isThreadsRoute;

  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname, location.search]);

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
      }}
    >
      <div
        className={`bg-stone-950 text-stone-100 ${
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
              : isWorkspacesRoute
                ? 'pt-[env(safe-area-inset-top)] sm:pt-4'
                : 'pt-4'
          } ${
            isViewportLockedRoute
              ? 'overflow-hidden overscroll-none px-0 sm:px-6'
              : 'px-4 sm:px-6'
          }`}
        >
          <section
            className={`min-w-0 ${isViewportLockedRoute ? 'h-full overflow-hidden overscroll-none' : ''}`}
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
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route element={<AppShell />}>
          <Route path="/workspaces" element={<WorkspacesPage />} />
          <Route path="/workspaces/new" element={<WorkspaceNewPage />} />
          <Route path="/threads" element={<ThreadsPage />} />
          <Route path="/threads/import" element={<ThreadImportPage />} />
          <Route path="/threads/new" element={<ThreadNewPage />} />
          <Route path="/threads/:id" element={<ThreadDetailPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
