import {
  BrowserRouter,
  Link,
  NavLink,
  Outlet,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom';
import { useState } from 'react';

import { LandingPage } from './pages/LandingPage';
import { ThreadDetailPage } from './pages/ThreadDetailPage';
import { ThreadImportPage } from './pages/ThreadImportPage';
import { ThreadNewPage } from './pages/ThreadNewPage';
import { ThreadsPage } from './pages/ThreadsPage';
import { WorkspaceDetailPage } from './pages/WorkspaceDetailPage';
import { WorkspaceNewPage } from './pages/WorkspaceNewPage';
import { WorkspacesPage } from './pages/WorkspacesPage';

function AppShell() {
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();
  const isThreadDetailRoute = /^\/threads\/[^/]+$/.test(location.pathname);
  const isThreadWorkspaceRoute =
    location.pathname === '/threads' || isThreadDetailRoute;

  const navLinkClassName = ({ isActive }: { isActive: boolean }) =>
    `rounded-full px-3 py-2 transition ${
      isActive
        ? 'bg-amber-300 text-stone-950'
        : 'text-stone-300 hover:bg-stone-800'
    }`;

  return (
    <div className="min-h-screen bg-stone-950 text-stone-100">
      <div className="fixed left-4 top-4 z-50">
        <button
          type="button"
          aria-label={navOpen ? 'Close Navigation' : 'Open Navigation'}
          aria-expanded={navOpen}
          onClick={() => setNavOpen((current) => !current)}
          className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-stone-700/80 bg-stone-900/88 text-stone-100 shadow-xl shadow-stone-950/35 backdrop-blur transition hover:border-stone-500 hover:bg-stone-900"
        >
          {navOpen ? (
            <svg
              aria-hidden="true"
              viewBox="0 0 16 16"
              className="h-4 w-4 fill-current"
            >
              <path d="M3.22 2.47 8 7.25l4.78-4.78 1.06 1.06L9.06 8.31l4.78 4.78-1.06 1.06L8 9.37l-4.78 4.78-1.06-1.06 4.78-4.78-4.78-4.78 1.06-1.06Z" />
            </svg>
          ) : (
            <svg
              aria-hidden="true"
              viewBox="0 0 16 16"
              className="h-4 w-4 fill-current"
            >
              <path d="M2 3.25h12v1.5H2Zm0 4h12v1.5H2Zm0 4h12v1.5H2Z" />
            </svg>
          )}
        </button>

        {navOpen && (
          <div className="mt-3 w-[min(22rem,calc(100vw-2rem))] rounded-[1.8rem] border border-stone-800 bg-stone-900/94 p-4 shadow-2xl shadow-stone-950/35 backdrop-blur">
            <div className="flex items-start justify-between gap-3">
              <div>
                <Link
                  to="/workspaces"
                  onClick={() => setNavOpen(false)}
                  className="text-base font-semibold tracking-wide text-amber-300"
                >
                  Remote Codex
                </Link>
                <p className="mt-1 text-xs uppercase tracking-[0.24em] text-stone-500">
                  Navigation
                </p>
              </div>
            </div>
            <nav className="mt-4 flex flex-wrap gap-2 text-sm">
              <NavLink
                to="/workspaces"
                onClick={() => setNavOpen(false)}
                className={navLinkClassName}
              >
                Workspaces
              </NavLink>
              <NavLink
                to="/threads"
                onClick={() => setNavOpen(false)}
                className={navLinkClassName}
              >
                Threads
              </NavLink>
            </nav>
          </div>
        )}
      </div>

      <main
        className={`mx-auto w-full max-w-[1600px] pb-4 ${
          isThreadWorkspaceRoute ? 'pt-[4.75rem] sm:pt-4' : 'pt-4'
        } ${isThreadDetailRoute ? 'px-0 sm:px-6' : 'px-4 sm:px-6'}`}
      >
        <section className="min-w-0">
          <Outlet />
        </section>
      </main>
    </div>
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
          <Route path="/workspaces/:id" element={<WorkspaceDetailPage />} />
          <Route path="/threads" element={<ThreadsPage />} />
          <Route path="/threads/import" element={<ThreadImportPage />} />
          <Route path="/threads/new" element={<ThreadNewPage />} />
          <Route path="/threads/:id" element={<ThreadDetailPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
