import { FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import type { AgentBackendIdDto } from '../../../../packages/shared/src/index';
import {
  closeControlPlaneSession,
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
  resumeControlPlaneSession,
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
import {
  clearStoredControlPlaneAuth,
  readStoredControlPlaneAuth,
  writeStoredControlPlaneAuth,
} from './controlPlaneAuthStorage';

const ROUTE_TOKEN_REFRESH_SKEW_MS = 60_000;
const ROUTE_TOKEN_MIN_REFRESH_MS = 5_000;
const SANDBOX_HEALTH_POLL_MS = 3_000;

function slugFromName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
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
  if (sandbox.state === 'running' && sandbox.idleTimeoutAt) {
    const timeoutMs = Date.parse(sandbox.idleTimeoutAt);
    if (Number.isFinite(timeoutMs) && timeoutMs > Date.now()) {
      return {
        tone: 'warning',
        text: `Sandbox will stop after idle timeout at ${sandbox.idleTimeoutAt}.`,
      };
    }
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
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: 'button' | 'submit';
  title?: string | undefined;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="h-10 rounded-[0.75rem] border border-[var(--theme-border)] bg-[var(--theme-surface-strong)] px-3 text-sm font-medium text-[var(--theme-fg)] transition hover:bg-[var(--theme-hover)] disabled:cursor-not-allowed disabled:text-[var(--theme-fg-muted)]"
    >
      {children}
    </button>
  );
}

const USER_STATUSES = ['active', 'suspended', 'deleted'] as const;

export function ControlPlanePage() {
  const navigate = useNavigate();
  const [auth, setAuth] = useState<ControlPlaneAuth | null>(() => {
    const stored = readStoredControlPlaneAuth();
    return stored ? { baseUrl: stored.baseUrl, token: stored.token } : null;
  });
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
  const [workerSocketUrl, setWorkerSocketUrl] = useState<string | null>(null);
  const [projectName, setProjectName] = useState('Computational chemistry');
  const [workspaceName, setWorkspaceName] = useState('Molecule study');
  const [sessionTitle, setSessionTitle] = useState('Plan calculation');
  const [sessionProvider, setSessionProvider] = useState<AgentBackendIdDto>('codex');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [profileName, setProfileName] = useState(() => readStoredControlPlaneAuth()?.displayName ?? '');
  const [gatewayUnavailable, setGatewayUnavailable] = useState<string | null>(null);
  const [quotaExceeded, setQuotaExceeded] = useState<string | null>(null);
  const [disabledAccount, setDisabledAccount] = useState<string | null>(null);
  const [expiredSession, setExpiredSession] = useState<string | null>(null);
  const [sandboxOffline, setSandboxOffline] = useState<string | null>(null);
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
  const [workerConnectionState, setWorkerConnectionState] = useState<'idle' | 'connecting' | 'ready' | 'reconnecting'>('idle');
  const routeTokenRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const workerSocketRef = useRef<WebSocket | null>(null);

  const canUseControlPlane = Boolean(auth && user);
  const sandboxReady = sandbox?.state === 'running';
  const sandboxStarting = sandbox?.state === 'starting';
  const sandboxStopping = sandbox?.state === 'stopping';
  const canStartSandbox = canUseControlPlane && Boolean(sandbox) && !sandboxReady && !sandboxStarting && !sandboxStopping;
  const startSandboxLabel = sandboxStarting ? 'Starting...' : sandboxReady ? 'Running' : 'Start';
  const sandboxProvisioning =
    sandbox?.state === 'starting' ||
    sandbox?.state === 'stopping' ||
    sandbox?.state === 'degraded' ||
    (typeof sandbox?.startupProgress === 'number' &&
      sandbox.startupProgress > 0 &&
      sandbox.startupProgress < 100);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );
  const selectedWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? null,
    [selectedWorkspaceId, workspaces],
  );
  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId) ?? null,
    [selectedSessionId, sessions],
  );
  const canCreateWorkspace = canUseControlPlane && Boolean(selectedProject);
  const canCreateSession = canUseControlPlane && Boolean(selectedWorkspace) && sandboxReady;
  const sandboxNotice = sandboxBanner(sandbox);
  const workspaceCreateBlocker = !selectedProject
    ? 'Select a project before creating a workspace.'
    : undefined;
  const sessionCreateBlocker = !selectedWorkspace
    ? 'Select a workspace before creating a session.'
    : !sandboxReady
      ? 'Start the sandbox before creating a session.'
      : undefined;
  const sessionConnectBlocker = !selectedSession
    ? 'Select a session before connecting.'
    : !sandboxReady
      ? 'Start the sandbox before connecting a session.'
      : undefined;

  async function run<T>(label: string, action: () => Promise<T>) {
    setBusy(label);
    setError(null);
    setMessage(null);
    setGatewayUnavailable(null);
    setQuotaExceeded(null);
    setDisabledAccount(null);
    setExpiredSession(null);
    setSandboxOffline(null);
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
        clearStoredControlPlaneAuth();
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
      setProfileName(me.user.displayName ?? '');
      setSelectedProjectId((current) =>
        projectResult.projects.some((project) => project.id === current) ? current : '',
      );
    } finally {
      setMetadataLoading((current) => ({ ...current, projects: false, usageEvents: false }));
    }
  }

  useEffect(() => {
    if (!auth) {
      return;
    }
    void run('Load control plane', async () => {
      await refresh(auth);
      setMessage('Control plane session is ready.');
    });
  }, []);

  useEffect(() => {
    if (!auth || !selectedWorkspaceId) {
      setSessions([]);
      setSelectedSessionId('');
      return;
    }

    setSelectedSessionId('');
    setMetadataLoading((current) => ({ ...current, sessions: true }));
    void run('Load sessions', async () => {
      try {
        const result = await fetchControlPlaneSessions(auth, selectedWorkspaceId);
        setSessions(result.sessions);
      } finally {
        setMetadataLoading((current) => ({ ...current, sessions: false }));
      }
    });
  }, [auth, selectedWorkspaceId]);

  useEffect(() => {
    if (!auth || !sandbox || !sandboxProvisioning) {
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void fetchControlPlaneSandboxHealth(auth)
        .then((health) => {
          if (!cancelled) {
            setSandbox(health.sandbox);
          }
        })
        .catch((caught) => {
          if (!cancelled) {
            setSandboxOffline(caught instanceof Error ? caught.message : 'Sandbox health refresh failed.');
          }
        });
    }, SANDBOX_HEALTH_POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [auth, sandbox?.state, sandbox?.startupProgress, sandbox?.updatedAt, sandboxProvisioning]);

  useEffect(() => {
    if (!auth || !selectedProjectId) {
      setWorkspaces([]);
      setSelectedWorkspaceId('');
      setSessions([]);
      setSelectedSessionId('');
      return;
    }

    setSelectedWorkspaceId('');
    setSessions([]);
    setSelectedSessionId('');
    setMetadataLoading((current) => ({ ...current, workspaces: true }));
    void run('Load workspaces', async () => {
      try {
        const result = await fetchControlPlaneWorkspaces(auth, selectedProjectId);
        setWorkspaces(result.workspaces);
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
      closeWorkerSocket();
    },
    [],
  );

  function closeWorkerSocket() {
    const socket = workerSocketRef.current;
    workerSocketRef.current = null;
    if (socket && socket.readyState !== WebSocket.CLOSED) {
      socket.close();
    }
  }

  function clearRouteTokenRefreshTimer() {
    if (routeTokenRefreshTimerRef.current) {
      clearTimeout(routeTokenRefreshTimerRef.current);
      routeTokenRefreshTimerRef.current = null;
    }
  }

  function workerWebSocketUrlForToken(token: ControlPlaneRouteToken) {
    const base = token.wsBaseUrl.replace(/\/+$/, '');
    return `${base}/api/sandboxes/${encodeURIComponent(token.sandboxId)}/ws?token=${encodeURIComponent(token.token)}`;
  }

  function connectWorkerSocket(token: ControlPlaneRouteToken, state: 'connecting' | 'reconnecting' = 'connecting') {
    closeWorkerSocket();
    const socketUrl = workerWebSocketUrlForToken(token);
    setWorkerSocketUrl(socketUrl);
    setSandboxOffline(null);
    setWorkerConnectionState(state);
    const socket = new WebSocket(socketUrl);
    workerSocketRef.current = socket;
    socket.addEventListener('open', () => {
      if (workerSocketRef.current === socket) {
        setWorkerConnectionState('ready');
      }
    });
    socket.addEventListener('error', () => {
      if (workerSocketRef.current === socket) {
        setSandboxOffline('Worker route connection failed.');
        setWorkerConnectionState('idle');
      }
    });
    socket.addEventListener('close', (event) => {
      if (workerSocketRef.current === socket) {
        setSandboxOffline(
          event.reason || 'Worker route closed before the session could stay connected.',
        );
        setWorkerConnectionState('idle');
      }
    });
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

  async function handleLogout() {
    clearStoredControlPlaneAuth();
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
        displayName: profileName,
      });
      setUser(result.user);
      const stored = readStoredControlPlaneAuth();
      if (stored) {
        writeStoredControlPlaneAuth({
          ...stored,
          email: result.user.email,
          displayName: result.user.displayName,
        });
      }
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
      setMessage(`Project "${created.project.name}" created. Select it before creating a workspace.`);
    });
  }

  async function handleCreateWorkspace(event: FormEvent) {
    event.preventDefault();
    if (!auth || !selectedProject) {
      return;
    }
    await run('Create workspace', async () => {
      const created = await createControlPlaneWorkspace(auth, {
        projectId: selectedProject.id,
        name: workspaceName,
        slug: slugFromName(workspaceName),
      });
      const result = await fetchControlPlaneWorkspaces(auth, selectedProject.id);
      setWorkspaces(result.workspaces);
      setSelectedWorkspaceId('');
      setSessions([]);
      setSelectedSessionId('');
      setMessage(`Workspace "${created.workspace.name}" created. Select it before creating a session.`);
    });
  }

  async function handleCreateSession(event: FormEvent) {
    event.preventDefault();
    if (!auth || !selectedWorkspace || !sandboxReady) {
      return;
    }
    await run('Create session', async () => {
      const created = await createControlPlaneSession(auth, selectedWorkspace.id, {
        provider: sessionProvider,
        title: sessionTitle,
      });
      const result = await fetchControlPlaneSessions(auth, selectedWorkspace.id);
      setSessions(result.sessions);
      setSelectedSessionId('');
      setMessage(`Session "${created.session.title}" created. Select it before connecting.`);
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
        setWorkerSocketUrl(null);
        closeWorkerSocket();
        clearRouteTokenRefreshTimer();
        setWorkerConnectionState('idle');
      } else if (action === 'restart') {
        setSandbox((await restartControlPlaneSandbox(auth)).sandbox);
        setRouteToken(null);
        setWorkerSocketUrl(null);
        closeWorkerSocket();
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

  async function handleRouteToken(
    connectionState: 'connecting' | 'reconnecting' = 'connecting',
    sessionId = selectedSessionId,
  ) {
    if (!auth || !sandbox || !sandboxReady) {
      return null;
    }
    return run('Create route token', async () => {
      const routeTokenInput: {
        projectId?: string;
        workspaceId?: string;
        sessionId?: string;
        scopes: string[];
      } = {
        scopes: ['worker:read', 'worker:write', 'session:prompt', 'provider:turn:create'],
      };
      if (selectedProject?.id) {
        routeTokenInput.projectId = selectedProject.id;
      }
      if (selectedWorkspaceId) {
        routeTokenInput.workspaceId = selectedWorkspaceId;
      }
      if (sessionId) {
        routeTokenInput.sessionId = sessionId;
      }
      const token = await createControlPlaneRouteToken(auth, sandbox.id, routeTokenInput);
      setRouteToken(token);
      scheduleRouteTokenRefresh(token);
      connectWorkerSocket(token, connectionState);
      setMessage('Route token is available in memory.');
      return token;
    });
  }

  async function refreshRouteTokenBeforeExpiry() {
    if (!auth || !sandbox || sandbox.state !== 'running' || !selectedSessionId) {
      return;
    }
    setWorkerConnectionState('reconnecting');
    const token = await handleRouteToken('reconnecting', selectedSessionId);
    if (!token) {
      setWorkerConnectionState('idle');
    }
  }

  function handleOpenSession(session: ControlPlaneSession) {
    setSelectedSessionId(session.id);
    setRouteToken(null);
    setWorkerSocketUrl(null);
    closeWorkerSocket();
    clearRouteTokenRefreshTimer();
    setWorkerConnectionState('idle');
  }

  async function handleCloseSession(session: ControlPlaneSession) {
    if (!auth || !sandboxReady) {
      return;
    }
    await run('Close session', async () => {
      const result = await closeControlPlaneSession(auth, session.id);
      setSessions((current) =>
        current.map((item) => (item.id === result.session.id ? result.session : item)),
      );
      setSelectedSessionId(result.session.id);
      setRouteToken(null);
      setWorkerSocketUrl(null);
      closeWorkerSocket();
      clearRouteTokenRefreshTimer();
      setWorkerConnectionState('idle');
      setMessage('Session finalized and disconnected.');
    });
  }

  async function handleResumeSession(session: ControlPlaneSession) {
    if (!auth || !sandboxReady) {
      return;
    }
    await run('Resume session', async () => {
      const result = await resumeControlPlaneSession(auth, session.id);
      setSessions((current) =>
        current.map((item) => (item.id === result.session.id ? result.session : item)),
      );
      setSelectedSessionId(result.session.id);
      await handleRouteToken('connecting', result.session.id);
      setMessage('Session resumed.');
      navigate(`/control-plane/sessions/${encodeURIComponent(result.session.id)}`);
    });
  }
  const totalTokens = (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0);
  const activeSessions = sessions.filter((session) => session.status === 'active').length;
  const controlPlaneBaseUrl = auth?.baseUrl ?? readStoredControlPlaneAuth()?.baseUrl ?? 'not connected';

  return (
    <div className="control-plane-console">
      <header className="control-console-header">
        <div>
          <p className="control-kicker">Control plane</p>
          <h1>Product account and sandbox registry</h1>
          <p>
            Account, sandbox lifecycle, workspace inventory, sessions, and route-token access in
            one operator surface.
          </p>
        </div>
        <div className="control-header-actions">
          {sandbox ? (
            <span className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${statusTone(sandbox.state)}`}>
              {sandbox.state}
            </span>
          ) : null}
          <ActionButton onClick={() => void refresh(auth)} disabled={!auth || busy === 'Load control plane'}>
            Refresh
          </ActionButton>
          <ActionButton onClick={handleLogout}>
            Sign out
          </ActionButton>
        </div>
      </header>

      <div className="control-alert-stack">
        {error ? <div className="control-alert danger">{error}</div> : null}
        {message ? <div className="control-alert success">{message}</div> : null}
        {gatewayUnavailable ? <div className="control-alert warning">LLM gateway unavailable: {gatewayUnavailable}</div> : null}
        {quotaExceeded ? <div className="control-alert danger">LLM quota exceeded: {quotaExceeded}</div> : null}
        {disabledAccount ? <div className="control-alert danger">Account disabled: {disabledAccount}</div> : null}
        {expiredSession ? <div className="control-alert warning">Session expired: {expiredSession}</div> : null}
        {adminUsersForbidden ? <div className="control-alert warning">Admin access denied: {adminUsersForbidden}</div> : null}
        {workerConnectionState === 'reconnecting' ? <div className="control-alert warning">Reconnecting worker route.</div> : null}
        {workerConnectionState === 'connecting' ? <div className="control-alert neutral">Connecting worker route.</div> : null}
        {sandboxOffline ? <div className="control-alert danger">Sandbox offline: {sandboxOffline}</div> : null}
        {sandboxNotice ? <div className={`control-alert ${sandboxNotice.tone}`}>{sandboxNotice.text}</div> : null}
      </div>

      <section className="control-summary-strip" aria-label="Control plane summary">
        <div>
          <span>Account</span>
          <strong>{user?.email ?? 'Loading'}</strong>
        </div>
        <div>
          <span>Sandbox</span>
          <strong>{sandbox?.state ?? 'unknown'}</strong>
        </div>
        <div>
          <span>Projects</span>
          <strong>{projects.length}</strong>
        </div>
        <div>
          <span>Active sessions</span>
          <strong>{activeSessions}</strong>
        </div>
        <div>
          <span>LLM cost</span>
          <strong>${Number(usage?.costUsd ?? 0).toFixed(2)}</strong>
        </div>
      </section>

      <div className="control-console-grid">
        <aside className="control-sidebar-column">
          <section className="control-panel">
            <div className="control-panel-heading">
              <h2>Account</h2>
              <span>{user?.status ?? 'loading'}</span>
            </div>
            <dl className="control-detail-list">
              <div><dt>User</dt><dd>{user?.email ?? 'Loading account'}</dd></div>
              <div><dt>Name</dt><dd>{user?.displayName ?? 'No display name'}</dd></div>
              <div><dt>Plan</dt><dd>{user?.plan ?? 'developer'}</dd></div>
              <div><dt>Quota</dt><dd>{user?.quotaProfile ?? 'default'}</dd></div>
              <div><dt>API</dt><dd>{controlPlaneBaseUrl}</dd></div>
            </dl>
            <form onSubmit={handleProfileSave} className="control-inline-form">
              <Field label="Display name" value={profileName} onChange={setProfileName} />
              <ActionButton type="submit" disabled={!auth || busy === 'Update profile'}>
                Save profile
              </ActionButton>
            </form>
          </section>

          <section className="control-panel">
            <div className="control-panel-heading">
              <h2>Sandbox</h2>
              {sandbox ? <span>{sandbox.resourceProfile}</span> : null}
            </div>
            <div className="control-action-row">
              <ActionButton
                onClick={() => void sandboxAction('start')}
                disabled={!canStartSandbox}
                title={
                  sandboxStarting
                    ? 'Sandbox startup is already in progress.'
                    : sandboxReady
                      ? 'Sandbox is already running.'
                      : sandboxStopping
                        ? 'Wait for sandbox shutdown to finish before starting again.'
                        : undefined
                }
              >
                {startSandboxLabel}
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
            {sandbox ? (
              <>
                <dl className="control-detail-list">
                  <div><dt>Sandbox id</dt><dd>{sandbox.id}</dd></div>
                  <div><dt>Image</dt><dd>{sandbox.image}</dd></div>
                  <div><dt>Router</dt><dd>{sandbox.routerBaseUrl ?? 'not assigned'}</dd></div>
                  <div><dt>Worker</dt><dd>{sandbox.workerServiceName ?? 'not assigned'}</dd></div>
                  <div><dt>S3 prefix</dt><dd>{sandbox.s3Prefix}</dd></div>
                  {sandbox.statusReason ? <div><dt>Status</dt><dd>{sandbox.statusReason}</dd></div> : null}
                  {sandbox.lastFailureCode ? <div><dt>Failure</dt><dd>{sandbox.lastFailureCode}</dd></div> : null}
                </dl>
                {typeof sandbox.startupProgress === 'number' && sandbox.startupProgress > 0 && sandbox.startupProgress < 100 ? (
                  <div className="control-progress">
                    <span>Startup progress</span>
                    <span>{sandbox.startupProgress}%</span>
                    <div><i style={{ width: `${sandbox.startupProgress}%` }} /></div>
                  </div>
                ) : null}
              </>
            ) : (
              <p className="control-empty">Loading sandbox registry.</p>
            )}
          </section>
        </aside>

        <main className="control-main-column">
          <section className="control-panel control-flow-panel">
            <div className="control-panel-heading">
              <h2>Workspace flow</h2>
              <span>Project to workspace to session</span>
            </div>

            <div className="control-flow-stack">
              <section className="control-flow-step">
                <div className="control-step-heading">
                  <span className="control-step-index">1</span>
                  <div>
                    <h3>Project</h3>
                    <p>{selectedProject ? `Selected: ${selectedProject.name}` : 'Create or select a project first.'}</p>
                  </div>
                  <span className="control-count-pill">{projects.length} total</span>
                </div>
                <form onSubmit={handleCreateProject} className="control-compose-row">
                  <Field label="Project name" value={projectName} onChange={setProjectName} />
                  <ActionButton type="submit" disabled={!canUseControlPlane}>
                    Create project
                  </ActionButton>
                </form>
                <div className="control-list">
                  {metadataLoading.projects ? (
                    <p className="control-empty">Loading projects...</p>
                  ) : projects.length === 0 ? (
                    <p className="control-empty">No projects yet.</p>
                  ) : (
                    projects.map((project) => (
                      <button
                        key={project.id}
                        type="button"
                        onClick={() => {
                          setSelectedProjectId(project.id);
                          setSelectedWorkspaceId('');
                          setSessions([]);
                          setSelectedSessionId('');
                          setRouteToken(null);
                          setWorkerSocketUrl(null);
                          closeWorkerSocket();
                          clearRouteTokenRefreshTimer();
                          setWorkerConnectionState('idle');
                        }}
                        className={selectedProjectId === project.id ? 'selected' : ''}
                      >
                        <strong>{project.name}</strong>
                        <span>{project.slug}</span>
                      </button>
                    ))
                  )}
                </div>
                {selectedProject ? (
                  <dl className="control-detail-list compact">
                    <div><dt>Selected project</dt><dd>{selectedProject.name}</dd></div>
                    <div><dt>Status</dt><dd>{selectedProject.status}</dd></div>
                    <div><dt>Workspaces</dt><dd>{workspaces.length}</dd></div>
                  </dl>
                ) : null}
              </section>

              <section className={`control-flow-step ${!selectedProject ? 'disabled' : ''}`}>
                <div className="control-step-heading">
                  <span className="control-step-index">2</span>
                  <div>
                    <h3>Workspace</h3>
                    <p>
                      {selectedWorkspace
                        ? `Selected: ${selectedWorkspace.name} in ${selectedProject?.name ?? 'project'}`
                        : selectedProject
                          ? `Scoped to ${selectedProject.name}.`
                          : 'Select a project before workspaces are available.'}
                    </p>
                  </div>
                  <span className="control-count-pill">{workspaces.length} in project</span>
                </div>
                <form onSubmit={handleCreateWorkspace} className="control-compose-row">
                  <Field label="Workspace name" value={workspaceName} onChange={setWorkspaceName} />
                  <ActionButton
                    type="submit"
                    disabled={!canCreateWorkspace}
                    title={workspaceCreateBlocker}
                  >
                    Create workspace
                  </ActionButton>
                </form>
                {workspaceCreateBlocker ? <p className="control-rule-note">{workspaceCreateBlocker}</p> : null}
                <div className="control-list">
                  {!selectedProject ? (
                    <p className="control-empty">Select a project to load its workspaces.</p>
                  ) : metadataLoading.workspaces ? (
                    <p className="control-empty">Loading workspaces...</p>
                  ) : workspaces.length === 0 ? (
                    <p className="control-empty">No workspaces in this project.</p>
                  ) : (
                    workspaces.map((workspace) => (
                      <button
                        key={workspace.id}
                        type="button"
                        onClick={() => {
                          setSelectedWorkspaceId(workspace.id);
                          setSelectedSessionId('');
                          setRouteToken(null);
                          setWorkerSocketUrl(null);
                          closeWorkerSocket();
                          clearRouteTokenRefreshTimer();
                          setWorkerConnectionState('idle');
                        }}
                        className={selectedWorkspaceId === workspace.id ? 'selected' : ''}
                      >
                        <strong>{workspace.name}</strong>
                        <span>{workspace.path}</span>
                      </button>
                    ))
                  )}
                </div>
              </section>

              <section className={`control-flow-step ${!selectedWorkspace ? 'disabled' : ''}`}>
                <div className="control-step-heading">
                  <span className="control-step-index">3</span>
                  <div>
                    <h3>Session</h3>
                    <p>
                      {selectedSession
                        ? `Selected: ${selectedSession.title} (${selectedSession.status})`
                        : selectedWorkspace
                          ? `Scoped to ${selectedWorkspace.name}. Sandbox must be running.`
                          : 'Select a workspace before sessions are available.'}
                    </p>
                  </div>
                  <span className={`control-count-pill ${sandboxReady ? 'ready' : 'blocked'}`}>
                    sandbox {sandbox?.state ?? 'unknown'}
                  </span>
                </div>
                <form onSubmit={handleCreateSession} className="control-compose-row session">
                  <Field label="Session title" value={sessionTitle} onChange={setSessionTitle} />
                  <label className="control-field">
                    <span>Provider</span>
                    <select
                      value={sessionProvider}
                      onChange={(event) => setSessionProvider(event.currentTarget.value as AgentBackendIdDto)}
                      disabled={!canCreateSession}
                    >
                      <option value="codex">Codex</option>
                      <option value="claude">Claude</option>
                      <option value="opencode">OpenCode</option>
                    </select>
                  </label>
                  <ActionButton
                    type="submit"
                    disabled={!canCreateSession}
                    title={sessionCreateBlocker}
                  >
                    Create session
                  </ActionButton>
                </form>
                {sessionCreateBlocker ? <p className="control-rule-note">{sessionCreateBlocker}</p> : null}
                <div className="control-session-list">
                  {!selectedWorkspace ? (
                    <p className="control-empty">Select a workspace to load its sessions.</p>
                  ) : metadataLoading.sessions ? (
                    <p className="control-empty">Loading sessions...</p>
                  ) : sessions.length === 0 ? (
                    <p className="control-empty">No sessions for this workspace.</p>
                  ) : (
                    sessions.map((session) => (
                      <div key={session.id} className={selectedSessionId === session.id ? 'selected' : ''}>
                        <button type="button" onClick={() => void handleOpenSession(session)}>
                          <strong>{session.title}</strong>
                          <span>
                            {session.provider} / {session.status}
                            {session.workerSessionId ? '' : ' / not started in sandbox'}
                          </span>
                        </button>
                        <div>
                          <ActionButton
                            onClick={() => void handleResumeSession(session)}
                            disabled={!auth || !sandboxReady}
                            title={!sandboxReady ? 'Start the sandbox before opening this session.' : undefined}
                          >
                            {session.workerSessionId ? 'Resume' : 'Start in sandbox'}
                          </ActionButton>
                          <ActionButton
                            onClick={() => void handleCloseSession(session)}
                            disabled={!auth || !session.workerSessionId || !sandboxReady}
                            title={!session.workerSessionId ? 'Session has not been started in the sandbox yet.' : undefined}
                          >
                            Close
                          </ActionButton>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </section>
            </div>
          </section>

          <section className="control-panel">
            <div className="control-panel-heading">
              <h2>Connection</h2>
              <ActionButton
                onClick={() => void handleRouteToken('connecting', selectedSessionId)}
                disabled={!sandboxReady || !selectedSession}
                title={sessionConnectBlocker}
              >
                Create route token
              </ActionButton>
            </div>
            {routeToken ? (
              <dl className="control-detail-list compact route-token">
                <div><dt>Session</dt><dd>{selectedSession?.title ?? selectedSessionId}</dd></div>
                <div><dt>Router</dt><dd>{routeToken.routerBaseUrl}</dd></div>
                <div><dt>WebSocket</dt><dd>{routeToken.wsBaseUrl}</dd></div>
                <div><dt>Connection</dt><dd>{workerConnectionState}</dd></div>
                <div><dt>Worker socket</dt><dd>{workerSocketUrl ?? 'not connected'}</dd></div>
                <div><dt>Expires</dt><dd>{routeToken.expiresAt}</dd></div>
              </dl>
            ) : selectedSession ? (
              <p className="control-empty">
                Selected session: {selectedSession.title}. Use Resume or Create route token after the
                sandbox is running.
              </p>
            ) : (
              <p className="control-empty">Select a session before opening a worker route.</p>
            )}
          </section>
        </main>

        <aside className="control-right-column">
          <section className="control-panel">
            <div className="control-panel-heading">
              <h2>LLM usage</h2>
              <span>{usage?.requestCount ?? 0} requests</span>
            </div>
            <div className="control-usage-grid">
              <div><span>Tokens</span><strong>{totalTokens}</strong></div>
              <div><span>Cached</span><strong>{usage?.cachedTokens ?? 0}</strong></div>
              <div><span>Cost</span><strong>${Number(usage?.costUsd ?? 0).toFixed(2)}</strong></div>
            </div>
            <div className="control-usage-events">
              {metadataLoading.usageEvents ? (
                <p className="control-empty">Loading LLM usage...</p>
              ) : usageEvents.length === 0 ? (
                <p className="control-empty">No LLM usage events yet.</p>
              ) : (
                usageEvents.map((event) => (
                  <div key={event.id}>
                    <strong>{event.model}</strong>
                    <span>{event.provider}, {event.inputTokens + event.outputTokens} tokens, ${Number(event.costUsd).toFixed(2)}</span>
                    <small>{event.occurredAt}</small>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="control-panel">
            <div className="control-panel-heading">
              <h2>Admin users</h2>
              <ActionButton
                onClick={() => void handleLoadAdminUsers()}
                disabled={!canUseControlPlane || metadataLoading.adminUsers}
              >
                Load users
              </ActionButton>
            </div>
            {metadataLoading.adminUsers ? (
              <p className="control-empty">Loading admin users...</p>
            ) : adminUsers.length === 0 ? (
              <p className="control-empty">No admin users loaded.</p>
            ) : (
              <div className="control-admin-list">
                {adminUsers.map((adminUser) => (
                  <div key={adminUser.id}>
                    <strong>{adminUser.email}</strong>
                    <span>{adminUser.displayName ?? 'No display name'}</span>
                    <select
                      value={adminUser.status}
                      onChange={(event) => {
                        const status = event.currentTarget.value as (typeof USER_STATUSES)[number];
                        void handleAdminUserUpdate(adminUser, { status });
                      }}
                    >
                      {USER_STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </select>
                    <input
                      aria-label={`Quota profile for ${adminUser.email}`}
                      defaultValue={adminUser.quotaProfile ?? 'default'}
                      onBlur={(event) => {
                        const quotaProfile = event.currentTarget.value.trim();
                        if (quotaProfile && quotaProfile !== adminUser.quotaProfile) {
                          void handleAdminUserUpdate(adminUser, { quotaProfile });
                        }
                      }}
                    />
                  </div>
                ))}
              </div>
            )}
          </section>

          {adminSandboxDetail ? (
            <section className="control-panel">
              <div className="control-panel-heading">
                <h2>Admin inspection</h2>
                <span>{adminSandboxDetail.runtimeStatus.state}</span>
              </div>
              <dl className="control-detail-list">
                <div><dt>Namespace</dt><dd>{adminSandboxDetail.sandbox.k8sNamespace ?? adminSandboxDetail.runtimeStatus.k8sNamespace ?? 'not assigned'}</dd></div>
                <div><dt>Pod</dt><dd>{adminSandboxDetail.sandbox.k8sPodName ?? adminSandboxDetail.runtimeStatus.k8sPodName ?? 'not assigned'}</dd></div>
                <div><dt>Endpoint</dt><dd>{adminSandboxDetail.endpoint.routerBaseUrl ?? 'not assigned'}</dd></div>
                <div><dt>Worker URL</dt><dd>{adminSandboxDetail.workerBaseUrl ?? 'not assigned'}</dd></div>
              </dl>
              {adminSandboxDetail.runtimeStatus.statusReason ? (
                <p className="control-empty">{adminSandboxDetail.runtimeStatus.statusReason}</p>
              ) : null}
              <div className="control-usage-events">
                {adminSandboxDetail.recentLifecycleErrors.length === 0 ? (
                  <p className="control-empty">No lifecycle audit entries.</p>
                ) : (
                  adminSandboxDetail.recentLifecycleErrors.slice(0, 5).map((entry) => (
                    <div key={entry.id}>
                      <strong>{entry.action}</strong>
                      <small>{entry.createdAt}</small>
                    </div>
                  ))
                )}
              </div>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
