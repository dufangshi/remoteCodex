import { BrowserRouter, Link, NavLink, Outlet, Route, Routes } from 'react-router-dom';

import { LandingPage } from './pages/LandingPage';
import { WorkspaceDetailPage } from './pages/WorkspaceDetailPage';
import { WorkspaceNewPage } from './pages/WorkspaceNewPage';
import { WorkspacesPage } from './pages/WorkspacesPage';

function AppShell() {
  return (
    <div className="min-h-screen bg-stone-950 text-stone-100">
      <header className="border-b border-stone-800 bg-stone-900/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link to="/workspaces" className="text-lg font-semibold tracking-wide text-amber-200">
            Remote Codex
          </Link>
          <nav className="flex items-center gap-2 text-sm">
            <NavLink
              to="/workspaces"
              className={({ isActive }) =>
                `rounded-full px-3 py-2 transition ${
                  isActive ? 'bg-amber-200 text-stone-950' : 'text-stone-300 hover:bg-stone-800'
                }`
              }
            >
              Workspaces
            </NavLink>
            <NavLink
              to="/workspaces/new"
              className={({ isActive }) =>
                `rounded-full px-3 py-2 transition ${
                  isActive ? 'bg-amber-200 text-stone-950' : 'text-stone-300 hover:bg-stone-800'
                }`
              }
            >
              Add Workspace
            </NavLink>
          </nav>
        </div>
      </header>
      <main className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="rounded-3xl border border-stone-800 bg-stone-900 p-5">
          <p className="text-xs uppercase tracking-[0.3em] text-stone-500">Supervisor</p>
          <h1 className="mt-3 text-2xl font-semibold text-stone-100">Phase 1 Console</h1>
          <p className="mt-3 text-sm leading-6 text-stone-400">
            Local supervisor shell for workspace onboarding, health checks, and read-only tree
            browsing.
          </p>
        </aside>
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
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
