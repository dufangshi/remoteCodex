import { FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import type { AgentBackendIdDto } from '../../../../packages/shared/src/index';
import {
  closeControlPlaneSession,
  createControlPlaneProject,
  createControlPlaneRouteToken,
  createControlPlaneSession,
  createControlPlaneWorkspace,
  fetchControlPlaneMe,
  fetchControlPlaneAdminSandboxDetail,
  fetchControlPlaneHarnessModuleRuns,
  fetchControlPlaneHarnessModuleTools,
  fetchControlPlaneHarnessStatus,
  fetchControlPlaneHarnessUsageEvents,
  fetchControlPlaneHarnessUsageSummary,
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
  ApiError,
  type ControlPlaneAuth,
  type ControlPlaneHarnessModule,
  type ControlPlaneHarnessPayload,
  type ControlPlaneHarnessStatus,
  type ControlPlaneHarnessUsageEvent,
  type ControlPlaneHarnessUsageSummary,
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
const HARNESS_MODULE_LABELS: Record<ControlPlaneHarnessModule, string> = {
  estructural: 'Estructural',
  quntur: 'Quntur',
  farmaco: 'Farmaco',
};
type CreatePanelKind = 'project' | 'workspace' | 'session';

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

function harnessState(status: ControlPlaneHarnessStatus | null, error: string | null) {
  if (error) {
    return 'unavailable';
  }
  if (!status) {
    return 'idle';
  }
  if (!status.enabled || !status.chemistryToolsEnabled) {
    return 'not configured';
  }
  if (!status.keyPresent) {
    return 'missing key';
  }
  return status.health ? 'ready' : 'degraded';
}

function harnessTone(state: string) {
  switch (state) {
    case 'ready':
      return statusTone('running');
    case 'unavailable':
    case 'missing key':
      return statusTone('failed');
    case 'not configured':
    case 'idle':
      return statusTone('stopped');
    default:
      return statusTone('starting');
  }
}

function payloadPreview(value: ControlPlaneHarnessPayload | null) {
  if (!value) {
    return '';
  }
  if (typeof value.text === 'string') {
    return value.text.trim();
  }
  if (value.payload === undefined) {
    return '';
  }
  return JSON.stringify(value.payload, null, 2);
}

function payloadItems(value: ControlPlaneHarnessPayload | null) {
  const payload = value?.payload;
  if (Array.isArray(payload)) {
    return payload;
  }
  if (payload && typeof payload === 'object') {
    for (const key of ['tools', 'runs', 'items', 'artifacts']) {
      const candidate = (payload as Record<string, unknown>)[key];
      if (Array.isArray(candidate)) {
        return candidate;
      }
    }
  }
  return [];
}

function payloadItemLabel(item: unknown, fallback: string) {
  if (!item || typeof item !== 'object') {
    return String(item ?? fallback);
  }
  const record = item as Record<string, unknown>;
  for (const key of ['name', 'tool', 'run_id', 'id', 'title', 'path']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }
  return fallback;
}

function payloadItemMeta(item: unknown) {
  if (!item || typeof item !== 'object') {
    return '';
  }
  const record = item as Record<string, unknown>;
  return ['status', 'type', 'module', 'execution_mode']
    .map((key) => {
      const value = record[key];
      return typeof value === 'string' && value.trim() ? value : null;
    })
    .filter(Boolean)
    .join(' / ');
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
  const [harnessUsage, setHarnessUsage] = useState<ControlPlaneHarnessUsageSummary | null>(null);
  const [harnessUsageEvents, setHarnessUsageEvents] = useState<ControlPlaneHarnessUsageEvent[]>([]);
  const [projects, setProjects] = useState<ControlPlaneProject[]>([]);
  const [workspaces, setWorkspaces] = useState<ControlPlaneWorkspace[]>([]);
  const [sessions, setSessions] = useState<ControlPlaneSession[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState('');
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [routeToken, setRouteToken] = useState<ControlPlaneRouteToken | null>(null);
  const [workerSocketUrl, setWorkerSocketUrl] = useState<string | null>(null);
  const [harnessStatus, setHarnessStatus] = useState<ControlPlaneHarnessStatus | null>(null);
  const [selectedHarnessModule, setSelectedHarnessModule] = useState<ControlPlaneHarnessModule>('farmaco');
  const [harnessTools, setHarnessTools] = useState<ControlPlaneHarnessPayload | null>(null);
  const [harnessRuns, setHarnessRuns] = useState<ControlPlaneHarnessPayload | null>(null);
  const [harnessError, setHarnessError] = useState<string | null>(null);
  const [projectName, setProjectName] = useState('Computational chemistry');
  const [workspaceName, setWorkspaceName] = useState('Molecule study');
  const [sessionTitle, setSessionTitle] = useState('Plan calculation');
  const [sessionProvider, setSessionProvider] = useState<AgentBackendIdDto>('codex');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [createPanelOpen, setCreatePanelOpen] = useState<CreatePanelKind | null>(null);
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
    harness: boolean;
  }>({
    projects: false,
    workspaces: false,
    sessions: false,
    usageEvents: false,
    harness: false,
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
  const createTarget: CreatePanelKind = selectedWorkspace ? 'session' : selectedProject ? 'workspace' : 'project';
  const createTargetLabel =
    createTarget === 'project' ? 'Project' : createTarget === 'workspace' ? 'Workspace' : 'Session';
  const createPanelTitle =
    createPanelOpen === 'project'
      ? 'Create project'
      : createPanelOpen === 'workspace'
        ? `Create workspace in ${selectedProject?.name ?? 'project'}`
        : createPanelOpen === 'session'
          ? `Create session in ${selectedWorkspace?.name ?? 'workspace'}`
          : '';
  const createPanelBlocker =
    createPanelOpen === 'workspace'
      ? workspaceCreateBlocker
      : createPanelOpen === 'session'
        ? sessionCreateBlocker
        : undefined;
  const selectedPath = [
    selectedProject?.name,
    selectedWorkspace?.name,
    selectedSession?.title,
  ].filter(Boolean).join(' / ');
  const harnessStatusText = harnessState(harnessStatus, harnessError);
  const harnessModules = harnessStatus?.modules.length ? harnessStatus.modules : (['farmaco', 'quntur', 'estructural'] as ControlPlaneHarnessModule[]);
  const harnessToolItems = payloadItems(harnessTools);
  const harnessRunItems = payloadItems(harnessRuns);
  const harnessToolsPreview = payloadPreview(harnessTools);
  const harnessRunsPreview = payloadPreview(harnessRuns);
  const accountInitial = (user?.displayName ?? user?.email ?? 'U').trim().charAt(0).toUpperCase() || 'U';
  const totalTokens = (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0);
  const activeSessions = sessions.filter((session) => session.status === 'active').length;
  const controlPlaneBaseUrl = auth?.baseUrl ?? readStoredControlPlaneAuth()?.baseUrl ?? 'not connected';

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
      const [projectResult, usageEventResult, harnessUsageResult, harnessUsageEventResult] = await Promise.all([
        fetchControlPlaneProjects(nextAuth),
        fetchControlPlaneUsageEvents(nextAuth, 10),
        fetchControlPlaneHarnessUsageSummary(nextAuth),
        fetchControlPlaneHarnessUsageEvents(nextAuth, 10),
      ]);
      setUser(me.user);
      setSandbox(me.sandbox);
      setUsage(me.usage);
      setUsageEvents(usageEventResult.events);
      setHarnessUsage(harnessUsageResult.usage);
      setHarnessUsageEvents(harnessUsageEventResult.events);
      setProjects(projectResult.projects);
      setProfileName(me.user.displayName ?? '');
      setSelectedProjectId((current) =>
        projectResult.projects.some((project) => project.id === current) ? current : '',
      );
    } finally {
      setMetadataLoading((current) => ({ ...current, projects: false, usageEvents: false }));
    }
  }

  async function refreshHarness(nextAuth = auth, module = selectedHarnessModule) {
    if (!nextAuth || !sandboxReady) {
      setHarnessStatus(null);
      setHarnessTools(null);
      setHarnessRuns(null);
      setHarnessError(null);
      return;
    }
    setMetadataLoading((current) => ({ ...current, harness: true }));
    setHarnessError(null);
    try {
      const status = await fetchControlPlaneHarnessStatus(nextAuth);
      setHarnessStatus(status);
      const nextModule = status.modules.includes(module)
        ? module
        : status.modules[0] ?? module;
      setSelectedHarnessModule(nextModule);
      if (status.enabled && status.keyPresent && status.chemistryToolsEnabled) {
        const [tools, runs] = await Promise.all([
          fetchControlPlaneHarnessModuleTools(nextAuth, nextModule),
          fetchControlPlaneHarnessModuleRuns(nextAuth, nextModule),
        ]);
        setHarnessTools(tools);
        setHarnessRuns(runs);
      } else {
        setHarnessTools(null);
        setHarnessRuns(null);
      }
    } catch (caught) {
      setHarnessStatus(null);
      setHarnessTools(null);
      setHarnessRuns(null);
      setHarnessError(caught instanceof Error ? caught.message : 'Harness status refresh failed.');
    } finally {
      setMetadataLoading((current) => ({ ...current, harness: false }));
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
    if (!auth || !sandboxReady) {
      setHarnessStatus(null);
      setHarnessTools(null);
      setHarnessRuns(null);
      setHarnessError(null);
      return;
    }
    void refreshHarness(auth, selectedHarnessModule);
  }, [auth, sandboxReady, sandbox?.updatedAt]);

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
    setAdminUsersForbidden(null);
    setProjects([]);
    setWorkspaces([]);
    setSessions([]);
    setHarnessUsage(null);
    setHarnessUsageEvents([]);
    setRouteToken(null);
    setAccountMenuOpen(false);
    setCreatePanelOpen(null);
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
      setCreatePanelOpen(null);
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
      setCreatePanelOpen(null);
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
      setCreatePanelOpen(null);
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

  async function handleHarnessModuleSelect(module: ControlPlaneHarnessModule) {
    setSelectedHarnessModule(module);
    if (!auth || !sandboxReady) {
      return;
    }
    setMetadataLoading((current) => ({ ...current, harness: true }));
    setHarnessError(null);
    try {
      const [tools, runs] = await Promise.all([
        fetchControlPlaneHarnessModuleTools(auth, module),
        fetchControlPlaneHarnessModuleRuns(auth, module),
      ]);
      setHarnessTools(tools);
      setHarnessRuns(runs);
    } catch (caught) {
      setHarnessTools(null);
      setHarnessRuns(null);
      setHarnessError(caught instanceof Error ? caught.message : 'Harness module refresh failed.');
    } finally {
      setMetadataLoading((current) => ({ ...current, harness: false }));
    }
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

  return (
    <div className="control-plane-console">
      <header className="control-console-header">
        <div className="control-titlebar-copy">
          <h1>Control Plane</h1>
          <span>{selectedPath || 'Select a project, workspace, or session'}</span>
        </div>
        <div className="control-header-actions">
          {sandbox ? (
            <span className={`control-status-pill ${statusTone(sandbox.state)}`}>
              {sandbox.state}
            </span>
          ) : null}
          <ActionButton onClick={() => void refresh(auth)} disabled={!auth || busy === 'Load control plane'}>
            Refresh
          </ActionButton>
          <div className="control-account-menu">
            <button
              type="button"
              className="control-avatar-button"
              onClick={() => setAccountMenuOpen((open) => !open)}
              aria-haspopup="menu"
              aria-expanded={accountMenuOpen}
              aria-label="Open account menu"
            >
              {accountInitial}
            </button>
            {accountMenuOpen ? (
              <div className="control-account-popover" role="menu">
                <div className="control-account-identity">
                  <span className="control-avatar-badge">{accountInitial}</span>
                  <div>
                    <strong>{user?.displayName || user?.email || 'Account'}</strong>
                    <span>{user?.email ?? 'Loading account'}</span>
                  </div>
                </div>
                <dl className="control-detail-list compact two">
                  <div><dt>Status</dt><dd>{user?.status ?? 'loading'}</dd></div>
                  <div><dt>Plan</dt><dd>{user?.plan ?? 'developer'}</dd></div>
                  <div><dt>Quota</dt><dd>{user?.quotaProfile ?? 'default'}</dd></div>
                  <div><dt>API</dt><dd>{controlPlaneBaseUrl}</dd></div>
                </dl>
                <form onSubmit={handleProfileSave} className="control-inline-form">
                  <Field label="Display name" value={profileName} onChange={setProfileName} />
                  <ActionButton type="submit" disabled={!auth || busy === 'Update profile'}>
                    Save
                  </ActionButton>
                </form>
                <div className="control-usage-grid compact">
                  <div><span>Requests</span><strong>{usage?.requestCount ?? 0}</strong></div>
                  <div><span>Tokens</span><strong>{totalTokens}</strong></div>
                  <div><span>Cost</span><strong>${Number(usage?.costUsd ?? 0).toFixed(2)}</strong></div>
                  <div><span>Harness</span><strong>{harnessUsage?.eventCount ?? 0}</strong></div>
                  <div><span>Compute</span><strong>{Number(harnessUsage?.computeUnits ?? 0).toFixed(1)}</strong></div>
                  <div><span>Harness cost</span><strong>${Number(harnessUsage?.costUsd ?? 0).toFixed(2)}</strong></div>
                </div>
                <div className="control-usage-events compact">
                  {metadataLoading.usageEvents ? (
                    <p className="control-empty">Loading LLM usage...</p>
                  ) : usageEvents.length === 0 ? (
                    <p className="control-empty">No LLM usage events yet.</p>
                  ) : (
                    usageEvents.slice(0, 4).map((event) => (
                      <div key={event.id}>
                        <strong>{event.model}</strong>
                        <span>{event.provider}, {event.inputTokens + event.outputTokens} tokens, ${Number(event.costUsd).toFixed(2)}</span>
                        <small>{event.occurredAt}</small>
                      </div>
                    ))
                  )}
                </div>
                <div className="control-usage-events compact">
                  {metadataLoading.usageEvents ? (
                    <p className="control-empty">Loading Harness usage...</p>
                  ) : harnessUsageEvents.length === 0 ? (
                    <p className="control-empty">No Harness usage events yet.</p>
                  ) : (
                    harnessUsageEvents.slice(0, 4).map((event) => (
                      <div key={event.id}>
                        <strong>{event.tool ?? event.module}</strong>
                        <span>{event.module}, {event.status}, ${Number(event.costUsd).toFixed(2)}</span>
                        <small>{event.occurredAt}</small>
                      </div>
                    ))
                  )}
                </div>
                <ActionButton onClick={handleLogout}>
                  Sign out
                </ActionButton>
              </div>
            ) : null}
          </div>
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

      <div className="control-console-grid">
        <aside className="control-explorer-panel">
          <div className="control-explorer-toolbar">
            <div>
              <h2>Workspace Flow</h2>
              <span>{projects.length} projects, {activeSessions} active sessions</span>
            </div>
            <button
              type="button"
              className="control-icon-button"
              onClick={() => setCreatePanelOpen(createTarget)}
              aria-label={`Open create panel for ${createTargetLabel.toLowerCase()}`}
              title={`Create ${createTargetLabel.toLowerCase()}`}
            >
              +
            </button>
          </div>

          {createPanelOpen ? (
            <div className="control-create-popover">
              <div className="control-panel-heading">
                <h2>{createPanelTitle}</h2>
                <button
                  type="button"
                  className="control-icon-button quiet"
                  onClick={() => setCreatePanelOpen(null)}
                  aria-label="Close create panel"
                >
                  x
                </button>
              </div>
              {createPanelOpen === 'project' ? (
                <form onSubmit={handleCreateProject} className="control-create-form">
                  <Field label="Project name" value={projectName} onChange={setProjectName} />
                  <ActionButton type="submit" disabled={!canUseControlPlane}>
                    Create project
                  </ActionButton>
                </form>
              ) : createPanelOpen === 'workspace' ? (
                <form onSubmit={handleCreateWorkspace} className="control-create-form">
                  <Field label="Workspace name" value={workspaceName} onChange={setWorkspaceName} />
                  {createPanelBlocker ? <p className="control-rule-note">{createPanelBlocker}</p> : null}
                  <ActionButton type="submit" disabled={!canCreateWorkspace} title={workspaceCreateBlocker}>
                    Create workspace
                  </ActionButton>
                </form>
              ) : (
                <form onSubmit={handleCreateSession} className="control-create-form">
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
                  {createPanelBlocker ? <p className="control-rule-note">{createPanelBlocker}</p> : null}
                  <ActionButton type="submit" disabled={!canCreateSession} title={sessionCreateBlocker}>
                    Create session
                  </ActionButton>
                </form>
              )}
            </div>
          ) : null}

          <div className="control-explorer-tree">
            {metadataLoading.projects ? (
              <p className="control-empty">Loading projects...</p>
            ) : projects.length === 0 ? (
              <p className="control-empty">No projects yet.</p>
            ) : (
              projects.map((project) => (
                <div key={project.id} className="control-tree-group">
                  <button
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
                    className={`control-tree-row project ${selectedProjectId === project.id ? 'selected' : ''}`}
                  >
                    <span className="control-tree-caret">{selectedProjectId === project.id ? 'v' : '>'}</span>
                    <span className="control-tree-icon">P</span>
                    <strong>{project.name}</strong>
                    <small>{project.slug}</small>
                  </button>

                  {selectedProjectId === project.id ? (
                    <div className="control-tree-children">
                      {metadataLoading.workspaces ? (
                        <p className="control-empty">Loading workspaces...</p>
                      ) : workspaces.length === 0 ? (
                        <p className="control-empty">No workspaces in this project.</p>
                      ) : (
                        workspaces.map((workspace) => (
                          <div key={workspace.id} className="control-tree-group">
                            <button
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
                              className={`control-tree-row workspace ${selectedWorkspaceId === workspace.id ? 'selected' : ''}`}
                            >
                              <span className="control-tree-caret">{selectedWorkspaceId === workspace.id ? 'v' : '>'}</span>
                              <span className="control-tree-icon">W</span>
                              <strong>{workspace.name}</strong>
                              <small>{workspace.path}</small>
                            </button>

                            {selectedWorkspaceId === workspace.id ? (
                              <div className="control-tree-children sessions">
                                {metadataLoading.sessions ? (
                                  <p className="control-empty">Loading sessions...</p>
                                ) : sessions.length === 0 ? (
                                  <p className="control-empty">No sessions for this workspace.</p>
                                ) : (
                                  sessions.map((session) => (
                                    <button
                                      key={session.id}
                                      type="button"
                                      onClick={() => void handleOpenSession(session)}
                                      className={`control-tree-row session ${selectedSessionId === session.id ? 'selected' : ''}`}
                                    >
                                      <span className="control-tree-caret" />
                                      <span className="control-tree-icon">S</span>
                                      <strong>{session.title}</strong>
                                      <small>
                                        {session.provider} / {session.status}
                                        {session.workerSessionId ? '' : ' / not started in sandbox'}
                                      </small>
                                    </button>
                                  ))
                                )}
                              </div>
                            ) : null}
                          </div>
                        ))
                      )}
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </aside>

        <main className="control-main-column">
          <section className="control-panel control-selected-panel">
            <div className="control-panel-heading">
              <h2>{selectedSession ? 'Session' : selectedWorkspace ? 'Workspace' : selectedProject ? 'Project' : 'Selection'}</h2>
              <span>{selectedSession?.status ?? selectedWorkspace?.sourceType ?? selectedProject?.status ?? 'root'}</span>
            </div>

            {selectedSession ? (
              <>
                <dl className="control-detail-list compact">
                  <div><dt>Title</dt><dd>{selectedSession.title}</dd></div>
                  <div><dt>Provider</dt><dd>{selectedSession.provider}</dd></div>
                  <div><dt>Status</dt><dd>{selectedSession.status}</dd></div>
                  <div><dt>Worker session</dt><dd>{selectedSession.workerSessionId ?? 'not started in sandbox'}</dd></div>
                  <div><dt>Created</dt><dd>{selectedSession.createdAt}</dd></div>
                  <div><dt>Updated</dt><dd>{selectedSession.updatedAt}</dd></div>
                </dl>
                <div className="control-action-row start">
                  <ActionButton
                    onClick={() => void handleResumeSession(selectedSession)}
                    disabled={!auth || !sandboxReady}
                    title={!sandboxReady ? 'Start the sandbox before opening this session.' : undefined}
                  >
                    {selectedSession.workerSessionId ? 'Resume' : 'Start in sandbox'}
                  </ActionButton>
                  <ActionButton
                    onClick={() => void handleCloseSession(selectedSession)}
                    disabled={!auth || !selectedSession.workerSessionId || !sandboxReady}
                    title={!selectedSession.workerSessionId ? 'Session has not been started in the sandbox yet.' : undefined}
                  >
                    Close
                  </ActionButton>
                </div>
              </>
            ) : selectedWorkspace ? (
              <>
                <dl className="control-detail-list compact">
                  <div><dt>Workspace</dt><dd>{selectedWorkspace.name}</dd></div>
                  <div><dt>Project</dt><dd>{selectedProject?.name ?? selectedWorkspace.projectId}</dd></div>
                  <div><dt>Path</dt><dd>{selectedWorkspace.path}</dd></div>
                  <div><dt>Source</dt><dd>{selectedWorkspace.sourceType}</dd></div>
                  <div><dt>Sessions</dt><dd>{sessions.length}</dd></div>
                  <div><dt>Sandbox</dt><dd>{sandbox?.state ?? 'unknown'}</dd></div>
                </dl>
                {sessionCreateBlocker ? <p className="control-rule-note">{sessionCreateBlocker}</p> : null}
                <div className="control-action-row start">
                  <ActionButton
                    onClick={() => setCreatePanelOpen('session')}
                    disabled={!canCreateSession}
                    title={sessionCreateBlocker}
                  >
                    Create session
                  </ActionButton>
                </div>
              </>
            ) : selectedProject ? (
              <>
                <dl className="control-detail-list compact">
                  <div><dt>Selected project</dt><dd>{selectedProject.name}</dd></div>
                  <div><dt>Slug</dt><dd>{selectedProject.slug}</dd></div>
                  <div><dt>Status</dt><dd>{selectedProject.status}</dd></div>
                  <div><dt>Workspaces</dt><dd>{workspaces.length}</dd></div>
                  <div><dt>Created</dt><dd>{selectedProject.createdAt}</dd></div>
                  <div><dt>Updated</dt><dd>{selectedProject.updatedAt}</dd></div>
                </dl>
                <div className="control-action-row start">
                  <ActionButton
                    onClick={() => setCreatePanelOpen('workspace')}
                    disabled={!canCreateWorkspace}
                    title={workspaceCreateBlocker}
                  >
                    Create workspace
                  </ActionButton>
                </div>
              </>
            ) : (
              <p className="control-empty">Select a project to open the workspace hierarchy.</p>
            )}
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

          <section className="control-panel">
            <div className="control-panel-heading">
              <h2>Harness</h2>
              <span className={`control-status-pill ${harnessTone(harnessStatusText)}`}>
                {harnessStatusText}
              </span>
            </div>
            {!sandboxReady ? (
              <p className="control-empty">Start the sandbox to inspect Harness tools.</p>
            ) : (
              <>
                <div className="control-action-row">
                  <ActionButton
                    onClick={() => void refreshHarness(auth, selectedHarnessModule)}
                    disabled={!auth || metadataLoading.harness}
                  >
                    {metadataLoading.harness ? 'Checking...' : 'Refresh'}
                  </ActionButton>
                </div>
                {harnessError ? (
                  <div className="control-alert warning">Harness unavailable: {harnessError}</div>
                ) : null}
                <dl className="control-detail-list compact">
                  <div><dt>Base URL</dt><dd>{harnessStatus?.baseUrl ?? 'not reported'}</dd></div>
                  <div><dt>Key</dt><dd>{harnessStatus?.keyPresent ? 'present' : 'not present'}</dd></div>
                  <div><dt>Chemistry</dt><dd>{harnessStatus?.chemistryToolsEnabled ? 'enabled' : 'disabled'}</dd></div>
                  <div><dt>Health</dt><dd>{harnessStatus?.health ? 'ok' : 'not available'}</dd></div>
                </dl>
                <div className="control-segment-row" role="tablist" aria-label="Harness modules">
                  {harnessModules.map((module) => (
                    <button
                      key={module}
                      type="button"
                      role="tab"
                      aria-selected={selectedHarnessModule === module}
                      className={selectedHarnessModule === module ? 'selected' : ''}
                      onClick={() => void handleHarnessModuleSelect(module)}
                      disabled={metadataLoading.harness || !harnessStatus?.enabled || !harnessStatus.keyPresent}
                    >
                      {HARNESS_MODULE_LABELS[module]}
                    </button>
                  ))}
                </div>
                <div className="control-usage-events compact">
                  <div>
                    <strong>{HARNESS_MODULE_LABELS[selectedHarnessModule]} tools</strong>
                    <small>{harnessToolItems.length} advertised</small>
                  </div>
                  {harnessToolItems.slice(0, 5).map((item, index) => (
                    <div key={`${selectedHarnessModule}-tool-${index}`}>
                      <strong>{payloadItemLabel(item, `tool-${index + 1}`)}</strong>
                      <span>{payloadItemMeta(item) || 'tool'}</span>
                    </div>
                  ))}
                  {harnessToolItems.length === 0 && harnessToolsPreview ? (
                    <div>
                      <span>{harnessToolsPreview.slice(0, 180)}</span>
                    </div>
                  ) : null}
                  {harnessToolItems.length === 0 && !harnessToolsPreview ? (
                    <p className="control-empty">No tools reported for this module.</p>
                  ) : null}
                </div>
                <div className="control-usage-events compact">
                  <div>
                    <strong>Recent runs</strong>
                    <small>{harnessRunItems.length} reported</small>
                  </div>
                  {harnessRunItems.slice(0, 4).map((item, index) => (
                    <div key={`${selectedHarnessModule}-run-${index}`}>
                      <strong>{payloadItemLabel(item, `run-${index + 1}`)}</strong>
                      <span>{payloadItemMeta(item) || 'run'}</span>
                    </div>
                  ))}
                  {harnessRunItems.length === 0 && harnessRunsPreview ? (
                    <div>
                      <span>{harnessRunsPreview.slice(0, 180)}</span>
                    </div>
                  ) : null}
                  {harnessRunItems.length === 0 && !harnessRunsPreview ? (
                    <p className="control-empty">No runs reported yet.</p>
                  ) : null}
                </div>
              </>
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
