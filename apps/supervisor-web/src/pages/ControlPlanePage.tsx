import { FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';

import type { AgentBackendIdDto } from '../../../../packages/shared/src/index';
import {
  bootstrapControlPlaneUser,
  createControlPlaneProject,
  createControlPlaneRouteToken,
  createControlPlaneSession,
  createControlPlaneWorkspace,
  fetchControlPlaneAdminUsers,
  fetchControlPlaneMe,
  fetchControlPlaneAdminSandboxDetail,
  fetchControlPlaneProjects,
  fetchControlPlaneUsageEvents,
  fetchControlPlaneSandboxHealth,
  fetchControlPlaneSessions,
  fetchControlPlaneWorkspaces,
  restartControlPlaneSandbox,
  startControlPlaneSandbox,
  stopControlPlaneSandbox,
  updateControlPlaneMe,
  updateControlPlaneAdminUser,
  ApiError,
  type ControlPlaneAuth,
  type ControlPlaneAdminUserUpdate,
  type ControlPlaneSandboxDetail,
  type ControlPlaneProject,
  type ControlPlaneRouteToken,
  type ControlPlaneSandbox,
  type ControlPlaneSession,
  type ControlPlaneUsageEvent,
  type ControlPlaneUsageSummary,
  type ControlPlaneUser,
  type ControlPlaneWorkspace,
} from '../lib/api';

export const CONTROL_PLANE_AUTH_STORAGE_KEY = 'remote-codex-control-plane-auth';
const ROUTE_TOKEN_REFRESH_SKEW_MS = 60_000;
const ROUTE_TOKEN_MIN_REFRESH_MS = 5_000;

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

  const raw = window.localStorage.getItem(CONTROL_PLANE_AUTH_STORAGE_KEY);
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
    case 'failed':
    case 'degraded':
    case 'unknown':
      return 'border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] text-[var(--status-danger-fg)]';
    case 'stopped':
      return 'border-[var(--status-neutral-border)] bg-[var(--status-neutral-bg)] text-[var(--status-neutral-fg)]';
    default:
      return 'border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] text-[var(--status-warning-fg)]';
  }
}

function sandboxBanner(sandbox: ControlPlaneSandbox | null) {
  if (!sandbox) {
    return null;
  }
  if (sandbox.state === 'degraded') {
    return {
      tone: 'warning',
      text: sandbox.statusReason ?? 'Sandbox is reachable but not fully ready.',
    };
  }
  if (sandbox.state === 'failed') {
    return {
      tone: 'danger',
      text: sandbox.lastFailureMessage ?? sandbox.statusReason ?? 'Sandbox startup failed.',
    };
  }
  if (sandbox.state === 'unknown') {
    return {
      tone: 'warning',
      text: sandbox.statusReason ?? 'Sandbox state is unknown.',
    };
  }
  if (!['running', 'starting', 'stopping'].includes(sandbox.state)) {
    return {
      tone: 'neutral',
      text: 'Sandbox is offline.',
    };
  }
  return null;
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

const USER_STATUSES = ['active', 'suspended', 'deleted'] as const;

export function ControlPlanePage() {
  const [storedAuth, setStoredAuth] = useState<StoredControlPlaneAuth>(() => readStoredAuth());
  const [auth, setAuth] = useState<ControlPlaneAuth | null>(null);
  const [user, setUser] = useState<ControlPlaneUser | null>(null);
  const [sandbox, setSandbox] = useState<ControlPlaneSandbox | null>(null);
  const [adminSandboxDetail, setAdminSandboxDetail] = useState<ControlPlaneSandboxDetail | null>(null);
  const [usage, setUsage] = useState<ControlPlaneUsageSummary | null>(null);
  const [usageEvents, setUsageEvents] = useState<ControlPlaneUsageEvent[]>([]);
  const [adminUsers, setAdminUsers] = useState<ControlPlaneUser[]>([]);
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
  const [gatewayUnavailable, setGatewayUnavailable] = useState<string | null>(null);
  const [quotaExceeded, setQuotaExceeded] = useState<string | null>(null);
  const [disabledAccount, setDisabledAccount] = useState<string | null>(null);
  const [expiredSession, setExpiredSession] = useState<string | null>(null);
  const [adminUsersForbidden, setAdminUsersForbidden] = useState<string | null>(null);
  const [metadataLoading, setMetadataLoading] = useState<{
    projects: boolean;
    workspaces: boolean;
    sessions: boolean;
    usageEvents: boolean;
    adminUsers: boolean;
  }>({
    projects: false,
    workspaces: false,
    sessions: false,
    usageEvents: false,
    adminUsers: false,
  });
  const [workerConnectionState, setWorkerConnectionState] = useState<'idle' | 'ready' | 'reconnecting'>('idle');
  const routeTokenRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canUseControlPlane = Boolean(auth && user);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );
  const selectedWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? null,
    [selectedWorkspaceId, workspaces],
  );
  const sandboxNotice = sandboxBanner(sandbox);

  async function run<T>(label: string, action: () => Promise<T>) {
    setBusy(label);
    setError(null);
    setMessage(null);
    setGatewayUnavailable(null);
    setQuotaExceeded(null);
    setDisabledAccount(null);
    setExpiredSession(null);
    setAdminUsersForbidden(null);
    try {
      return await action();
    } catch (caught) {
      if (caught instanceof ApiError && caught.payload.code === 'gateway_unavailable') {
        setGatewayUnavailable(caught.message);
      }
      if (caught instanceof ApiError && caught.payload.code === 'quota_exceeded') {
        const details = caught.payload.details ?? {};
        const limit = typeof details.limit === 'number' ? details.limit : null;
        const used = typeof details.used === 'number' ? details.used : null;
        const quotaProfile =
          typeof details.quotaProfile === 'string' ? details.quotaProfile : user?.quotaProfile ?? 'current';
        setQuotaExceeded(
          limit !== null && used !== null
            ? `${quotaProfile} quota exhausted (${used}/${limit}).`
            : 'Quota exceeded.',
        );
      }
      if (caught instanceof ApiError && caught.payload.code === 'account_inactive') {
        setDisabledAccount(caught.message);
      }
      if (
        caught instanceof ApiError &&
        (caught.statusCode === 401 || caught.payload.code === 'unauthorized')
      ) {
        setExpiredSession(caught.message);
      }
      if (caught instanceof ApiError && caught.payload.code === 'forbidden') {
        setAdminUsersForbidden(caught.message);
      }
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

    setMetadataLoading((current) => ({ ...current, projects: true, usageEvents: true }));
    try {
      const me = await fetchControlPlaneMe(nextAuth);
      const [projectResult, usageEventResult] = await Promise.all([
        fetchControlPlaneProjects(nextAuth),
        fetchControlPlaneUsageEvents(nextAuth, 10),
      ]);
      setUser(me.user);
      setSandbox(me.sandbox);
      setUsage(me.usage);
      setUsageEvents(usageEventResult.events);
      setProjects(projectResult.projects);
      if (!selectedProjectId && projectResult.projects[0]) {
        setSelectedProjectId(projectResult.projects[0].id);
      }
    } finally {
      setMetadataLoading((current) => ({ ...current, projects: false, usageEvents: false }));
    }
  }

  useEffect(() => {
    if (!auth || !selectedWorkspaceId) {
      setSessions([]);
      return;
    }

    setMetadataLoading((current) => ({ ...current, sessions: true }));
    void run('Load sessions', async () => {
      try {
        const result = await fetchControlPlaneSessions(auth, selectedWorkspaceId);
        setSessions(result.sessions);
        setSelectedSessionId((current) =>
          result.sessions.some((session) => session.id === current)
            ? current
            : result.sessions[0]?.id ?? '',
        );
      } finally {
        setMetadataLoading((current) => ({ ...current, sessions: false }));
      }
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

    setMetadataLoading((current) => ({ ...current, workspaces: true }));
    void run('Load workspaces', async () => {
      try {
        const result = await fetchControlPlaneWorkspaces(auth, selectedProjectId);
        setWorkspaces(result.workspaces);
        setSelectedWorkspaceId((current) =>
          result.workspaces.some((workspace) => workspace.id === current)
            ? current
            : result.workspaces[0]?.id ?? '',
        );
      } finally {
        setMetadataLoading((current) => ({ ...current, workspaces: false }));
      }
    });
  }, [auth, selectedProjectId]);

  useEffect(
    () => () => {
      if (routeTokenRefreshTimerRef.current) {
        clearTimeout(routeTokenRefreshTimerRef.current);
      }
    },
    [],
  );

  function clearRouteTokenRefreshTimer() {
    if (routeTokenRefreshTimerRef.current) {
      clearTimeout(routeTokenRefreshTimerRef.current);
      routeTokenRefreshTimerRef.current = null;
    }
  }

  function scheduleRouteTokenRefresh(token: ControlPlaneRouteToken | null) {
    clearRouteTokenRefreshTimer();
    if (!token) {
      return;
    }
    const expiresAtMs = Date.parse(token.expiresAt);
    if (!Number.isFinite(expiresAtMs)) {
      return;
    }
    const delayMs = Math.max(
      ROUTE_TOKEN_MIN_REFRESH_MS,
      expiresAtMs - Date.now() - ROUTE_TOKEN_REFRESH_SKEW_MS,
    );
    routeTokenRefreshTimerRef.current = setTimeout(() => {
      void refreshRouteTokenBeforeExpiry();
    }, delayMs);
  }

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
      window.localStorage.setItem(CONTROL_PLANE_AUTH_STORAGE_KEY, JSON.stringify(storedAuth));
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
    setAdminSandboxDetail(null);
    setUsage(null);
    setUsageEvents([]);
    setAdminUsers([]);
    setAdminUsersForbidden(null);
    setProjects([]);
    setWorkspaces([]);
    setSessions([]);
    setRouteToken(null);
    clearRouteTokenRefreshTimer();
    setWorkerConnectionState('idle');
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
        clearRouteTokenRefreshTimer();
        setWorkerConnectionState('idle');
      } else if (action === 'restart') {
        setSandbox((await restartControlPlaneSandbox(auth)).sandbox);
        setRouteToken(null);
        clearRouteTokenRefreshTimer();
        setWorkerConnectionState('idle');
      } else {
        const health = await fetchControlPlaneSandboxHealth(auth);
        setSandbox(health.sandbox);
        setMessage(`Sandbox manager reports ${health.status.state}.`);
      }
    });
  }

  async function handleInspectSandbox() {
    if (!auth || !sandbox) {
      return;
    }
    await run('Inspect sandbox', async () => {
      const detail = await fetchControlPlaneAdminSandboxDetail(auth, sandbox.id);
      setAdminSandboxDetail(detail);
      setMessage('Sandbox detail loaded.');
    });
  }

  async function handleLoadAdminUsers() {
    if (!auth) {
      return;
    }
    setAdminUsersForbidden(null);
    setMetadataLoading((current) => ({ ...current, adminUsers: true }));
    const result = await run('Load admin users', async () => fetchControlPlaneAdminUsers(auth));
    if (result) {
      setAdminUsers(result.users);
      setMessage('Admin users loaded.');
    }
    setMetadataLoading((current) => ({ ...current, adminUsers: false }));
  }

  async function handleAdminUserUpdate(
    targetUser: ControlPlaneUser,
    input: ControlPlaneAdminUserUpdate,
  ) {
    if (!auth) {
      return;
    }
    setAdminUsersForbidden(null);
    const result = await run('Update admin user', async () =>
      updateControlPlaneAdminUser(auth, targetUser.id, input),
    );
    if (result) {
      setAdminUsers((current) =>
        current.map((adminUser) =>
          adminUser.id === result.user.id ? result.user : adminUser,
        ),
      );
      if (user?.id === result.user.id) {
        setUser(result.user);
      }
      setMessage(`Updated ${result.user.email}.`);
    }
  }

  async function handleRouteToken() {
    if (!auth || !sandbox) {
      return null;
    }
    return run('Create route token', async () => {
      const routeTokenInput: {
        projectId?: string;
        workspaceId?: string;
        sessionId?: string;
        scopes: string[];
      } = {
        scopes: ['worker:read', 'worker:write', 'session:prompt'],
      };
      if (selectedProject?.id) {
        routeTokenInput.projectId = selectedProject.id;
      }
      if (selectedWorkspaceId) {
        routeTokenInput.workspaceId = selectedWorkspaceId;
      }
      if (selectedSessionId) {
        routeTokenInput.sessionId = selectedSessionId;
      }
      const token = await createControlPlaneRouteToken(auth, sandbox.id, routeTokenInput);
      setRouteToken(token);
      scheduleRouteTokenRefresh(token);
      setWorkerConnectionState('ready');
      setMessage('Route token is available in memory.');
      return token;
    });
  }

  async function refreshRouteTokenBeforeExpiry() {
    if (!auth || !sandbox || sandbox.state !== 'running' || !selectedSessionId) {
      return;
    }
    setWorkerConnectionState('reconnecting');
    const token = await handleRouteToken();
    setWorkerConnectionState(token ? 'ready' : 'idle');
  }

  async function handleOpenSession(session: ControlPlaneSession) {
    setSelectedSessionId(session.id);
    if (!sandbox || sandbox.state !== 'running') {
      setRouteToken(null);
      setError('Sandbox must be running before opening a worker session.');
      return;
    }
    await handleRouteToken();
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
      {gatewayUnavailable ? (
        <div className="rounded-[0.9rem] border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-4 py-3 text-sm text-[var(--status-warning-fg)]">
          LLM gateway unavailable: {gatewayUnavailable}
        </div>
      ) : null}
      {quotaExceeded ? (
        <div className="rounded-[0.9rem] border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-4 py-3 text-sm text-[var(--status-danger-fg)]">
          LLM quota exceeded: {quotaExceeded}
        </div>
      ) : null}
      {disabledAccount ? (
        <div className="rounded-[0.9rem] border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-4 py-3 text-sm text-[var(--status-danger-fg)]">
          Account disabled: {disabledAccount}
        </div>
      ) : null}
      {expiredSession ? (
        <div className="rounded-[0.9rem] border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-4 py-3 text-sm text-[var(--status-warning-fg)]">
          Session expired: {expiredSession}
        </div>
      ) : null}
      {adminUsersForbidden ? (
        <div className="rounded-[0.9rem] border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-4 py-3 text-sm text-[var(--status-warning-fg)]">
          Admin access denied: {adminUsersForbidden}
        </div>
      ) : null}
      {workerConnectionState === 'reconnecting' ? (
        <div className="rounded-[0.9rem] border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-4 py-3 text-sm text-[var(--status-warning-fg)]">
          Reconnecting worker route.
        </div>
      ) : null}
      {sandboxNotice ? (
        <div
          className={`rounded-[0.9rem] border px-4 py-3 text-sm ${
            sandboxNotice.tone === 'danger'
              ? 'border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] text-[var(--status-danger-fg)]'
              : sandboxNotice.tone === 'warning'
                ? 'border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] text-[var(--status-warning-fg)]'
                : 'border-[var(--status-neutral-border)] bg-[var(--status-neutral-bg)] text-[var(--status-neutral-fg)]'
          }`}
        >
          {sandboxNotice.text}
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
            <p><span className="text-[var(--theme-fg)]">Quota:</span> {user.quotaProfile ?? 'default'}</p>
            <p><span className="text-[var(--theme-fg)]">LLM requests:</span> {usage?.requestCount ?? 0}</p>
            <p><span className="text-[var(--theme-fg)]">LLM tokens:</span> {(usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0)} total</p>
            <p><span className="text-[var(--theme-fg)]">LLM cost:</span> ${Number(usage?.costUsd ?? 0).toFixed(2)}</p>
          </div>
        ) : null}
      </Section>

      <Section title="LLM usage">
        {metadataLoading.usageEvents ? (
          <p className="text-sm text-[var(--theme-fg-muted)]">Loading LLM usage...</p>
        ) : !user ? (
          <p className="text-sm text-[var(--theme-fg-muted)]">Login to inspect LLM usage.</p>
        ) : usageEvents.length === 0 ? (
          <p className="text-sm text-[var(--theme-fg-muted)]">No LLM usage events yet.</p>
        ) : (
          <div className="grid gap-2">
            {usageEvents.map((event) => (
              <div
                key={event.id}
                className="grid gap-2 rounded-[0.85rem] border border-[var(--theme-border)] bg-[var(--theme-surface)] px-3 py-2 text-sm text-[var(--theme-fg-muted)] md:grid-cols-[1.1fr_0.8fr_0.8fr_0.7fr]"
              >
                <div>
                  <p className="font-medium text-[var(--theme-fg)]">{event.model}</p>
                  <p className="text-xs">{event.provider}</p>
                </div>
                <p>
                  <span className="text-[var(--theme-fg)]">Tokens:</span>{' '}
                  {event.inputTokens + event.outputTokens} total
                </p>
                <p>
                  <span className="text-[var(--theme-fg)]">Cost:</span>{' '}
                  ${Number(event.costUsd).toFixed(2)}
                </p>
                <p className="text-xs">{event.occurredAt}</p>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section
        title="Admin users"
        action={
          <ActionButton
            onClick={() => void handleLoadAdminUsers()}
            disabled={!canUseControlPlane || metadataLoading.adminUsers}
          >
            Load users
          </ActionButton>
        }
      >
        {metadataLoading.adminUsers ? (
          <p className="text-sm text-[var(--theme-fg-muted)]">Loading admin users...</p>
        ) : adminUsers.length === 0 ? (
          <p className="text-sm text-[var(--theme-fg-muted)]">No admin users loaded.</p>
        ) : (
          <div className="grid gap-3">
            {adminUsers.map((adminUser) => (
              <div
                key={adminUser.id}
                className="grid gap-3 rounded-[0.85rem] border border-[var(--theme-border)] bg-[var(--theme-surface)] p-3 text-sm text-[var(--theme-fg-muted)] lg:grid-cols-[1.2fr_0.8fr_0.9fr_auto]"
              >
                <div>
                  <p className="font-medium text-[var(--theme-fg)]">{adminUser.email}</p>
                  <p className="text-xs">{adminUser.displayName ?? 'No display name'}</p>
                </div>
                <label className="grid gap-1.5 text-xs font-medium">
                  <span>Status</span>
                  <select
                    value={adminUser.status}
                    onChange={(event) => {
                      const status = event.currentTarget.value as (typeof USER_STATUSES)[number];
                      void handleAdminUserUpdate(adminUser, { status });
                    }}
                    className="h-10 rounded-[0.7rem] border border-[var(--theme-border)] bg-[var(--theme-surface)] px-3 text-sm text-[var(--theme-fg)] outline-none"
                  >
                    {USER_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1.5 text-xs font-medium">
                  <span>Quota profile</span>
                  <input
                    aria-label={`Quota profile for ${adminUser.email}`}
                    defaultValue={adminUser.quotaProfile ?? 'default'}
                    onBlur={(event) => {
                      const quotaProfile = event.currentTarget.value.trim();
                      if (quotaProfile && quotaProfile !== adminUser.quotaProfile) {
                        void handleAdminUserUpdate(adminUser, { quotaProfile });
                      }
                    }}
                    className="h-10 rounded-[0.7rem] border border-[var(--theme-border)] bg-[var(--theme-surface)] px-3 text-sm text-[var(--theme-fg)] outline-none"
                  />
                </label>
                <div className="grid content-center gap-1 text-xs">
                  <p><span className="text-[var(--theme-fg)]">Plan:</span> {adminUser.plan}</p>
                  <p><span className="text-[var(--theme-fg)]">Last seen:</span> {adminUser.lastSeenAt ?? 'never'}</p>
                </div>
              </div>
            ))}
          </div>
        )}
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
            <ActionButton onClick={handleInspectSandbox} disabled={!canUseControlPlane || !sandbox}>
              Inspect
            </ActionButton>
          </div>
        }
      >
        {sandbox ? (
          <div className="grid gap-4">
            <div className="grid gap-3 text-sm text-[var(--theme-fg-muted)] md:grid-cols-2">
              <p><span className="text-[var(--theme-fg)]">Sandbox id:</span> {sandbox.id}</p>
              <p><span className="text-[var(--theme-fg)]">Image:</span> {sandbox.image}</p>
              <p><span className="text-[var(--theme-fg)]">Resource:</span> {sandbox.resourceProfile}</p>
              <p><span className="text-[var(--theme-fg)]">Owner:</span> {sandbox.userId}</p>
              <p><span className="text-[var(--theme-fg)]">Router:</span> {sandbox.routerBaseUrl ?? 'not assigned'}</p>
              <p><span className="text-[var(--theme-fg)]">Worker:</span> {sandbox.workerServiceName ?? 'not assigned'}</p>
              <p><span className="text-[var(--theme-fg)]">S3 prefix:</span> {sandbox.s3Prefix}</p>
              {sandbox.statusReason ? (
                <p><span className="text-[var(--theme-fg)]">Status:</span> {sandbox.statusReason}</p>
              ) : null}
              {sandbox.lastFailureCode ? (
                <p><span className="text-[var(--theme-fg)]">Failure:</span> {sandbox.lastFailureCode}</p>
              ) : null}
            </div>
            {typeof sandbox.startupProgress === 'number' && sandbox.startupProgress > 0 && sandbox.startupProgress < 100 ? (
              <div className="grid gap-2">
                <div className="flex items-center justify-between text-xs text-[var(--theme-fg-muted)]">
                  <span>Startup progress</span>
                  <span>{sandbox.startupProgress}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-[var(--theme-muted)]">
                  <div
                    className="h-full rounded-full bg-[var(--theme-accent-solid)]"
                    style={{ width: `${sandbox.startupProgress}%` }}
                  />
                </div>
              </div>
            ) : null}
            {adminSandboxDetail ? (
              <div className="grid gap-4 border-t border-[var(--theme-border)] pt-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-[var(--theme-fg)]">Admin inspection</h3>
                    <p className="mt-1 text-xs text-[var(--theme-fg-muted)]">
                      Runtime status, endpoint, and recent lifecycle audit for this sandbox.
                    </p>
                  </div>
                  <span className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${statusTone(adminSandboxDetail.runtimeStatus.state)}`}>
                    {adminSandboxDetail.runtimeStatus.state}
                  </span>
                </div>
                <div className="grid gap-3 text-sm text-[var(--theme-fg-muted)] md:grid-cols-2">
                  <p><span className="text-[var(--theme-fg)]">Namespace:</span> {adminSandboxDetail.sandbox.k8sNamespace ?? adminSandboxDetail.runtimeStatus.k8sNamespace ?? 'not assigned'}</p>
                  <p><span className="text-[var(--theme-fg)]">Pod:</span> {adminSandboxDetail.sandbox.k8sPodName ?? adminSandboxDetail.runtimeStatus.k8sPodName ?? 'not assigned'}</p>
                  <p><span className="text-[var(--theme-fg)]">Endpoint:</span> {adminSandboxDetail.endpoint.routerBaseUrl ?? 'not assigned'}</p>
                  <p><span className="text-[var(--theme-fg)]">Worker URL:</span> {adminSandboxDetail.workerBaseUrl ?? 'not assigned'}</p>
                  <p><span className="text-[var(--theme-fg)]">Last seen:</span> {adminSandboxDetail.sandbox.lastSeenAt ?? 'never'}</p>
                  <p><span className="text-[var(--theme-fg)]">Failure:</span> {adminSandboxDetail.runtimeStatus.lastFailureCode ?? adminSandboxDetail.sandbox.lastFailureCode ?? 'none'}</p>
                </div>
                {adminSandboxDetail.runtimeStatus.statusReason ? (
                  <p className="rounded-[0.75rem] border border-[var(--status-neutral-border)] bg-[var(--status-neutral-bg)] px-3 py-2 text-sm text-[var(--status-neutral-fg)]">
                    {adminSandboxDetail.runtimeStatus.statusReason}
                  </p>
                ) : null}
                <div className="grid gap-2">
                  <h4 className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--theme-fg-muted)]">
                    Lifecycle audit
                  </h4>
                  {adminSandboxDetail.recentLifecycleErrors.length === 0 ? (
                    <p className="text-sm text-[var(--theme-fg-muted)]">No lifecycle audit entries.</p>
                  ) : (
                    adminSandboxDetail.recentLifecycleErrors.slice(0, 5).map((entry) => (
                      <div
                        key={entry.id}
                        className="rounded-[0.75rem] border border-[var(--theme-border)] bg-[var(--theme-surface)] px-3 py-2 text-xs text-[var(--theme-fg-muted)]"
                      >
                        <p className="font-medium text-[var(--theme-fg)]">{entry.action}</p>
                        <p>{entry.createdAt}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ) : null}
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
          {metadataLoading.projects ? (
            <p className="text-sm text-[var(--theme-fg-muted)]">Loading projects...</p>
          ) : projects.length === 0 ? (
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
        {selectedProject ? (
          <div className="mt-4 grid gap-2 rounded-[0.85rem] border border-[var(--theme-border)] bg-[var(--theme-surface)] p-3 text-sm text-[var(--theme-fg-muted)]">
            <h3 className="text-sm font-semibold text-[var(--theme-fg)]">Project detail</h3>
            <p><span className="text-[var(--theme-fg)]">Name:</span> {selectedProject.name}</p>
            <p><span className="text-[var(--theme-fg)]">Slug:</span> {selectedProject.slug}</p>
            <p><span className="text-[var(--theme-fg)]">Status:</span> {selectedProject.status}</p>
            <p><span className="text-[var(--theme-fg)]">Workspaces:</span> {workspaces.length}</p>
          </div>
        ) : null}
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
          {metadataLoading.workspaces ? (
            <p className="text-sm text-[var(--theme-fg-muted)]">Loading workspaces...</p>
          ) : workspaces.length === 0 ? (
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
          {metadataLoading.sessions ? (
            <p className="text-sm text-[var(--theme-fg-muted)]">Loading sessions...</p>
          ) : sessions.length === 0 ? (
            <p className="text-sm text-[var(--theme-fg-muted)]">No sessions for this workspace.</p>
          ) : (
            sessions.map((session) => (
              <button
                key={session.id}
                type="button"
                onClick={() => void handleOpenSession(session)}
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
