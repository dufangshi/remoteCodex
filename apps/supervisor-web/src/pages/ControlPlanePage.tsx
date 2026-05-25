import { FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react';

import type { AgentBackendIdDto } from '../../../../packages/shared/src/index';
import {
  bootstrapControlPlaneUser,
  createControlPlaneProject,
  createControlPlaneRouteToken,
  createControlPlaneSession,
  createControlPlaneWorkspace,
  fetchControlPlaneMe,
  fetchControlPlaneProjects,
  fetchControlPlaneSandboxHealth,
  fetchControlPlaneSessions,
  fetchControlPlaneWorkspaces,
  restartControlPlaneSandbox,
  startControlPlaneSandbox,
  stopControlPlaneSandbox,
  updateControlPlaneMe,
  type ControlPlaneAuth,
  type ControlPlaneProject,
  type ControlPlaneRouteToken,
  type ControlPlaneSandbox,
  type ControlPlaneSession,
  type ControlPlaneUsageSummary,
  type ControlPlaneUser,
  type ControlPlaneWorkspace,
} from '../lib/api';

const AUTH_STORAGE_KEY = 'remote-codex-control-plane-auth';

interface StoredControlPlaneAuth {
  baseUrl: string;
  subject: string;
  email: string;
  displayName: string;
}

function slugFromName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function readStoredAuth(): StoredControlPlaneAuth {
  if (typeof window === 'undefined') {
    return {
      baseUrl: 'http://127.0.0.1:8790',
      subject: 'dev-user',
      email: 'dev@example.com',
      displayName: 'Developer',
    };
  }

  const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<StoredControlPlaneAuth>;
      return {
        baseUrl: parsed.baseUrl || 'http://127.0.0.1:8790',
        subject: parsed.subject || 'dev-user',
        email: parsed.email || 'dev@example.com',
        displayName: parsed.displayName || 'Developer',
      };
    } catch {
      // Fall through to defaults.
    }
  }

  return {
    baseUrl: 'http://127.0.0.1:8790',
    subject: 'dev-user',
    email: 'dev@example.com',
    displayName: 'Developer',
  };
}

function statusTone(state: string) {
  switch (state) {
    case 'running':
      return 'border-[var(--status-success-border)] bg-[var(--status-success-bg)] text-[var(--status-success-fg)]';
    case 'stopped':
      return 'border-[var(--status-neutral-border)] bg-[var(--status-neutral-bg)] text-[var(--status-neutral-fg)]';
    default:
      return 'border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] text-[var(--status-warning-fg)]';
  }
}

function Section({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="border-t border-[var(--theme-border)] py-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-[var(--theme-fg)]">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <label className="grid gap-1.5 text-xs font-medium text-[var(--theme-fg-muted)]">
      <span>{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        className="h-10 rounded-[0.7rem] border border-[var(--theme-border)] bg-[var(--theme-surface)] px-3 text-sm text-[var(--theme-fg)] outline-none transition focus:border-[var(--theme-accent-border)] focus:ring-2 focus:ring-[var(--theme-accent-soft)]"
      />
    </label>
  );
}

function ActionButton({
  children,
  onClick,
  disabled = false,
  type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="h-10 rounded-[0.75rem] border border-[var(--theme-border)] bg-[var(--theme-surface-strong)] px-3 text-sm font-medium text-[var(--theme-fg)] transition hover:bg-[var(--theme-hover)] disabled:cursor-not-allowed disabled:text-[var(--theme-fg-muted)]"
    >
      {children}
    </button>
  );
}

export function ControlPlanePage() {
  const [storedAuth, setStoredAuth] = useState<StoredControlPlaneAuth>(() => readStoredAuth());
  const [auth, setAuth] = useState<ControlPlaneAuth | null>(null);
  const [user, setUser] = useState<ControlPlaneUser | null>(null);
  const [sandbox, setSandbox] = useState<ControlPlaneSandbox | null>(null);
  const [usage, setUsage] = useState<ControlPlaneUsageSummary | null>(null);
  const [projects, setProjects] = useState<ControlPlaneProject[]>([]);
  const [workspaces, setWorkspaces] = useState<ControlPlaneWorkspace[]>([]);
  const [sessions, setSessions] = useState<ControlPlaneSession[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState('');
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [routeToken, setRouteToken] = useState<ControlPlaneRouteToken | null>(null);
  const [projectName, setProjectName] = useState('Computational chemistry');
  const [workspaceName, setWorkspaceName] = useState('Molecule study');
  const [sessionTitle, setSessionTitle] = useState('Plan calculation');
  const [sessionProvider, setSessionProvider] = useState<AgentBackendIdDto>('codex');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const canUseControlPlane = Boolean(auth && user);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );
  const selectedWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? null,
    [selectedWorkspaceId, workspaces],
  );

  async function run<T>(label: string, action: () => Promise<T>) {
    setBusy(label);
    setError(null);
    setMessage(null);
    try {
      return await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `${label} failed.`);
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function refresh(nextAuth = auth) {
    if (!nextAuth) {
      return;
    }

    const me = await fetchControlPlaneMe(nextAuth);
    const projectResult = await fetchControlPlaneProjects(nextAuth);
    setUser(me.user);
    setSandbox(me.sandbox);
    setUsage(me.usage);
    setProjects(projectResult.projects);
    if (!selectedProjectId && projectResult.projects[0]) {
      setSelectedProjectId(projectResult.projects[0].id);
    }
  }

  useEffect(() => {
    if (!auth || !selectedWorkspaceId) {
      setSessions([]);
      return;
    }

    void run('Load sessions', async () => {
      const result = await fetchControlPlaneSessions(auth, selectedWorkspaceId);
      setSessions(result.sessions);
      setSelectedSessionId((current) =>
        result.sessions.some((session) => session.id === current)
          ? current
          : result.sessions[0]?.id ?? '',
      );
    });
  }, [auth, selectedWorkspaceId]);

  useEffect(() => {
    if (!auth || !selectedProjectId) {
      setWorkspaces([]);
      setSelectedWorkspaceId('');
      setSessions([]);
      setSelectedSessionId('');
      return;
    }

    void run('Load workspaces', async () => {
      const result = await fetchControlPlaneWorkspaces(auth, selectedProjectId);
      setWorkspaces(result.workspaces);
      setSelectedWorkspaceId((current) =>
        result.workspaces.some((workspace) => workspace.id === current)
          ? current
          : result.workspaces[0]?.id ?? '',
      );
    });
  }, [auth, selectedProjectId]);

  async function handleBootstrap(event: FormEvent) {
    event.preventDefault();
    const nextAuth = {
      baseUrl: storedAuth.baseUrl,
      token: `dev:${storedAuth.subject}`,
    };
    await run('Bootstrap account', async () => {
      const bootstrapped = await bootstrapControlPlaneUser(nextAuth, {
        email: storedAuth.email,
        displayName: storedAuth.displayName,
      });
      window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(storedAuth));
      setAuth(nextAuth);
      setUser(bootstrapped.user);
      setSandbox(bootstrapped.sandbox);
      await refresh(nextAuth);
      setMessage('Control plane session is ready.');
    });
  }

  async function handleLogout() {
    setAuth(null);
    setUser(null);
    setSandbox(null);
    setUsage(null);
    setProjects([]);
    setWorkspaces([]);
    setSessions([]);
    setRouteToken(null);
    setMessage('Signed out locally.');
  }

  async function handleProfileSave(event: FormEvent) {
    event.preventDefault();
    if (!auth) {
      return;
    }
    await run('Update profile', async () => {
      const result = await updateControlPlaneMe(auth, {
        displayName: storedAuth.displayName,
      });
      setUser(result.user);
      setMessage('Profile updated.');
    });
  }

  async function handleCreateProject(event: FormEvent) {
    event.preventDefault();
    if (!auth) {
      return;
    }
    await run('Create project', async () => {
      const created = await createControlPlaneProject(auth, {
        name: projectName,
        slug: slugFromName(projectName),
      });
      await refresh(auth);
      setSelectedProjectId(created.project.id);
      setMessage('Project created.');
    });
  }

  async function handleCreateWorkspace(event: FormEvent) {
    event.preventDefault();
    if (!auth) {
      return;
    }
    await run('Create workspace', async () => {
      const created = await createControlPlaneWorkspace(auth, {
        projectId: selectedProject?.id ?? null,
        name: workspaceName,
        slug: slugFromName(workspaceName),
      });
      const result = await fetchControlPlaneWorkspaces(auth, selectedProject?.id ?? undefined);
      setWorkspaces(result.workspaces);
      setSelectedWorkspaceId(created.workspace.id);
      setMessage('Workspace created.');
    });
  }

  async function handleCreateSession(event: FormEvent) {
    event.preventDefault();
    if (!auth || !selectedWorkspace) {
      return;
    }
    await run('Create session', async () => {
      const created = await createControlPlaneSession(auth, selectedWorkspace.id, {
        provider: sessionProvider,
        title: sessionTitle,
      });
      const result = await fetchControlPlaneSessions(auth, selectedWorkspace.id);
      setSessions(result.sessions);
      setSelectedSessionId(created.session.id);
      setMessage('Session created.');
    });
  }

  async function sandboxAction(action: 'start' | 'stop' | 'restart' | 'health') {
    if (!auth) {
      return;
    }
    await run(`${action} sandbox`, async () => {
      if (action === 'start') {
        setSandbox((await startControlPlaneSandbox(auth)).sandbox);
      } else if (action === 'stop') {
        setSandbox((await stopControlPlaneSandbox(auth)).sandbox);
        setRouteToken(null);
      } else if (action === 'restart') {
        setSandbox((await restartControlPlaneSandbox(auth)).sandbox);
        setRouteToken(null);
      } else {
        const health = await fetchControlPlaneSandboxHealth(auth);
        setSandbox(health.sandbox);
        setMessage(`Sandbox manager reports ${health.status.state}.`);
      }
    });
  }

  async function handleRouteToken() {
    if (!auth || !sandbox) {
      return;
    }
    await run('Create route token', async () => {
      const routeTokenInput: {
        workspaceId?: string;
        sessionId?: string;
        scopes: string[];
      } = {
        scopes: ['worker:read', 'worker:write', 'session:prompt'],
      };
      if (selectedWorkspaceId) {
        routeTokenInput.workspaceId = selectedWorkspaceId;
      }
      if (selectedSessionId) {
        routeTokenInput.sessionId = selectedSessionId;
      }
      const token = await createControlPlaneRouteToken(auth, sandbox.id, routeTokenInput);
      setRouteToken(token);
      setMessage('Route token is available in memory.');
    });
  }

  return (
    <div className="mx-auto grid max-w-6xl gap-5 py-2 text-[var(--theme-fg)]">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--theme-border)] pb-5">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--theme-fg-muted)]">
            Control plane
          </p>
          <h1 className="mt-2 text-2xl font-semibold text-[var(--theme-fg)]">
            Product account and sandbox registry
          </h1>
          <p className="mt-2 max-w-[68ch] text-sm leading-6 text-[var(--theme-fg-muted)]">
            This panel exercises the cloud-facing Remote Codex control plane: product auth,
            projects, workspaces, sessions, sandbox lifecycle, and route-token issuance.
          </p>
        </div>
        {sandbox ? (
          <span className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${statusTone(sandbox.state)}`}>
            {sandbox.state}
          </span>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-[0.9rem] border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-4 py-3 text-sm text-[var(--status-danger-fg)]">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="rounded-[0.9rem] border border-[var(--status-success-border)] bg-[var(--status-success-bg)] px-4 py-3 text-sm text-[var(--status-success-fg)]">
          {message}
        </div>
      ) : null}

      <Section
        title="Account"
        action={
          user ? (
            <ActionButton onClick={handleLogout}>
              Logout
            </ActionButton>
          ) : null
        }
      >
        <form onSubmit={handleBootstrap} className="grid gap-3 md:grid-cols-4">
          <Field
            label="Control plane URL"
            value={storedAuth.baseUrl}
            onChange={(baseUrl) => setStoredAuth((current) => ({ ...current, baseUrl }))}
          />
          <Field
            label="Dev subject"
            value={storedAuth.subject}
            onChange={(subject) => setStoredAuth((current) => ({ ...current, subject }))}
          />
          <Field
            label="Email"
            type="email"
            value={storedAuth.email}
            onChange={(email) => setStoredAuth((current) => ({ ...current, email }))}
          />
          <div className="flex items-end">
            <ActionButton type="submit" disabled={busy === 'Bootstrap account'}>
              {user ? 'Reconnect' : 'Login / register'}
            </ActionButton>
          </div>
        </form>
        {user ? (
          <form onSubmit={handleProfileSave} className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
            <Field
              label="Display name"
              value={storedAuth.displayName}
              onChange={(displayName) => setStoredAuth((current) => ({ ...current, displayName }))}
            />
            <div className="flex items-end">
              <ActionButton type="submit" disabled={busy === 'Update profile'}>
                Save profile
              </ActionButton>
            </div>
          </form>
        ) : null}
        {user ? (
          <div className="mt-4 grid gap-2 text-sm text-[var(--theme-fg-muted)] sm:grid-cols-3">
            <p><span className="text-[var(--theme-fg)]">User:</span> {user.email}</p>
            <p><span className="text-[var(--theme-fg)]">Plan:</span> {user.plan}</p>
            <p><span className="text-[var(--theme-fg)]">Usage:</span> {usage?.requestCount ?? 0} requests</p>
          </div>
        ) : null}
      </Section>

      <Section
        title="Sandbox"
        action={
          <div className="flex flex-wrap gap-2">
            <ActionButton onClick={() => void sandboxAction('start')} disabled={!canUseControlPlane}>
              Start
            </ActionButton>
            <ActionButton onClick={() => void sandboxAction('stop')} disabled={!canUseControlPlane}>
              Stop
            </ActionButton>
            <ActionButton onClick={() => void sandboxAction('restart')} disabled={!canUseControlPlane}>
              Restart
            </ActionButton>
            <ActionButton onClick={() => void sandboxAction('health')} disabled={!canUseControlPlane}>
              Health
            </ActionButton>
          </div>
        }
      >
        {sandbox ? (
          <div className="grid gap-3 text-sm text-[var(--theme-fg-muted)] md:grid-cols-2">
            <p><span className="text-[var(--theme-fg)]">Sandbox id:</span> {sandbox.id}</p>
            <p><span className="text-[var(--theme-fg)]">Image:</span> {sandbox.image}</p>
            <p><span className="text-[var(--theme-fg)]">Router:</span> {sandbox.routerBaseUrl ?? 'not assigned'}</p>
            <p><span className="text-[var(--theme-fg)]">S3 prefix:</span> {sandbox.s3Prefix}</p>
          </div>
        ) : (
          <p className="text-sm text-[var(--theme-fg-muted)]">Login to bootstrap the user sandbox.</p>
        )}
      </Section>

      <Section title="Projects">
        <form onSubmit={handleCreateProject} className="mb-4 grid gap-3 md:grid-cols-[1fr_auto]">
          <Field label="Project name" value={projectName} onChange={setProjectName} />
          <div className="flex items-end">
            <ActionButton type="submit" disabled={!canUseControlPlane}>
              Create project
            </ActionButton>
          </div>
        </form>
        <div className="grid gap-2">
          {projects.length === 0 ? (
            <p className="text-sm text-[var(--theme-fg-muted)]">No projects yet.</p>
          ) : (
            projects.map((project) => (
              <button
                key={project.id}
                type="button"
                onClick={() => setSelectedProjectId(project.id)}
                className={`rounded-[0.85rem] border px-3 py-2 text-left text-sm transition ${
                  selectedProjectId === project.id
                    ? 'border-[var(--theme-accent-border)] bg-[var(--theme-accent-soft)] text-[var(--theme-accent-strong)]'
                    : 'border-[var(--theme-border)] bg-[var(--theme-surface)] text-[var(--theme-fg)] hover:bg-[var(--theme-hover)]'
                }`}
              >
                <span className="font-medium">{project.name}</span>
                <span className="ml-2 text-xs text-[var(--theme-fg-muted)]">{project.slug}</span>
              </button>
            ))
          )}
        </div>
      </Section>

      <Section title="Workspaces">
        <form onSubmit={handleCreateWorkspace} className="mb-4 grid gap-3 md:grid-cols-[1fr_auto]">
          <Field label="Workspace name" value={workspaceName} onChange={setWorkspaceName} />
          <div className="flex items-end">
            <ActionButton type="submit" disabled={!canUseControlPlane}>
              Create workspace
            </ActionButton>
          </div>
        </form>
        <div className="grid gap-2">
          {workspaces.length === 0 ? (
            <p className="text-sm text-[var(--theme-fg-muted)]">No workspaces yet.</p>
          ) : (
            workspaces.map((workspace) => (
              <button
                key={workspace.id}
                type="button"
                onClick={() => setSelectedWorkspaceId(workspace.id)}
                className={`rounded-[0.85rem] border px-3 py-2 text-left text-sm transition ${
                  selectedWorkspaceId === workspace.id
                    ? 'border-[var(--theme-accent-border)] bg-[var(--theme-accent-soft)] text-[var(--theme-accent-strong)]'
                    : 'border-[var(--theme-border)] bg-[var(--theme-surface)] text-[var(--theme-fg)] hover:bg-[var(--theme-hover)]'
                }`}
              >
                <span className="font-medium">{workspace.name}</span>
                <span className="ml-2 text-xs text-[var(--theme-fg-muted)]">{workspace.path}</span>
              </button>
            ))
          )}
        </div>
      </Section>

      <Section
        title="Sessions"
        action={
          <ActionButton onClick={handleRouteToken} disabled={!sandbox || sandbox.state !== 'running'}>
            Create route token
          </ActionButton>
        }
      >
        <form onSubmit={handleCreateSession} className="mb-4 grid gap-3 md:grid-cols-[1fr_12rem_auto]">
          <Field label="Session title" value={sessionTitle} onChange={setSessionTitle} />
          <label className="grid gap-1.5 text-xs font-medium text-[var(--theme-fg-muted)]">
            <span>Provider</span>
            <select
              value={sessionProvider}
              onChange={(event) => setSessionProvider(event.currentTarget.value as AgentBackendIdDto)}
              className="h-10 rounded-[0.7rem] border border-[var(--theme-border)] bg-[var(--theme-surface)] px-3 text-sm text-[var(--theme-fg)] outline-none"
            >
              <option value="codex">Codex</option>
              <option value="claude">Claude</option>
              <option value="opencode">OpenCode</option>
            </select>
          </label>
          <div className="flex items-end">
            <ActionButton type="submit" disabled={!selectedWorkspace}>
              Create session
            </ActionButton>
          </div>
        </form>
        <div className="grid gap-2">
          {sessions.length === 0 ? (
            <p className="text-sm text-[var(--theme-fg-muted)]">No sessions for this workspace.</p>
          ) : (
            sessions.map((session) => (
              <button
                key={session.id}
                type="button"
                onClick={() => setSelectedSessionId(session.id)}
                className={`rounded-[0.85rem] border px-3 py-2 text-left text-sm transition ${
                  selectedSessionId === session.id
                    ? 'border-[var(--theme-accent-border)] bg-[var(--theme-accent-soft)] text-[var(--theme-accent-strong)]'
                    : 'border-[var(--theme-border)] bg-[var(--theme-surface)] text-[var(--theme-fg)] hover:bg-[var(--theme-hover)]'
                }`}
              >
                <span className="font-medium">{session.title}</span>
                <span className="ml-2 text-xs text-[var(--theme-fg-muted)]">
                  {session.provider} / {session.status}
                </span>
              </button>
            ))
          )}
        </div>
        {routeToken ? (
          <div className="mt-4 rounded-[0.9rem] border border-[var(--theme-border)] bg-[var(--theme-surface)] p-3 text-xs text-[var(--theme-fg-muted)]">
            <p><span className="text-[var(--theme-fg)]">Router:</span> {routeToken.routerBaseUrl}</p>
            <p><span className="text-[var(--theme-fg)]">WebSocket:</span> {routeToken.wsBaseUrl}</p>
            <p><span className="text-[var(--theme-fg)]">Expires:</span> {routeToken.expiresAt}</p>
          </div>
        ) : null}
      </Section>
    </div>
  );
}
