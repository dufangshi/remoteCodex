import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import type { AgentBackendIdDto } from '@remote-codex/shared';
import {
  closeControlPlaneSession,
  createControlPlaneProject,
  createControlPlaneRouteToken,
  createControlPlaneSession,
  createControlPlaneWorkspace,
  deleteControlPlaneProject,
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
  updateControlPlaneProject,
  updateControlPlaneSession,
  updateControlPlaneWorkspace,
  updateControlPlaneMe,
  ApiError,
  type ControlPlaneAuth,
  type ControlPlaneHarnessModule,
  type ControlPlaneHarnessPayload,
  type ControlPlaneHarnessStatus,
  type ControlPlaneHarnessUsageEvent,
  type ControlPlaneHarnessUsageSummary,
  type ControlPlaneBillingSummary,
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
import {
  entityKey,
  harnessState,
  payloadItems,
  payloadPreview,
  sandboxActionPresentation,
  sandboxBanner,
  sandboxHealthLabel,
  sandboxStageLabel,
  sessionRuntimeLabel,
  slugFromName,
  statusLabel,
  type CreatePanelKind,
  type EditableEntity,
  type InspectorTab,
} from './controlPlanePresentation';

const ROUTE_TOKEN_REFRESH_SKEW_MS = 60_000;
const ROUTE_TOKEN_MIN_REFRESH_MS = 5_000;
const SANDBOX_HEALTH_POLL_MS = 3_000;

export function useControlPlanePageController() {
  const navigate = useNavigate();
  const [auth, setAuth] = useState<ControlPlaneAuth | null>(() => {
    const stored = readStoredControlPlaneAuth();
    return stored ? { baseUrl: stored.baseUrl, token: stored.token } : null;
  });
  const [user, setUser] = useState<ControlPlaneUser | null>(null);
  const [sandbox, setSandbox] = useState<ControlPlaneSandbox | null>(null);
  const [adminSandboxDetail, setAdminSandboxDetail] = useState<ControlPlaneSandboxDetail | null>(null);
  const [usage, setUsage] = useState<ControlPlaneUsageSummary | null>(null);
  const [billing, setBilling] = useState<ControlPlaneBillingSummary | null>(null);
  const [usageEvents, setUsageEvents] = useState<ControlPlaneUsageEvent[]>([]);
  const [harnessUsage, setHarnessUsage] = useState<ControlPlaneHarnessUsageSummary | null>(null);
  const [harnessUsageEvents, setHarnessUsageEvents] = useState<ControlPlaneHarnessUsageEvent[]>([]);
  const [projects, setProjects] = useState<ControlPlaneProject[]>([]);
  const [workspaces, setWorkspaces] = useState<ControlPlaneWorkspace[]>([]);
  const [sessions, setSessions] = useState<ControlPlaneSession[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState('');
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [openSessionMenuId, setOpenSessionMenuId] = useState<string | null>(null);
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
  const [editingEntity, setEditingEntity] = useState<EditableEntity | null>(null);
  const [editingName, setEditingName] = useState('');
  const [pendingDelete, setPendingDelete] = useState<EditableEntity | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [createPanelOpen, setCreatePanelOpen] = useState<CreatePanelKind | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('summary');
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
  const sandboxActions = sandboxActionPresentation(canUseControlPlane, sandbox);
  const sandboxProvisioning =
    sandbox?.state === 'starting' ||
    sandbox?.state === 'stopping' ||
    sandbox?.state === 'restarting' ||
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
  const totalCostUsd = billing?.totalCostUsd ?? Number(usage?.costUsd ?? 0) + Number(harnessUsage?.costUsd ?? 0);
  const activeSessions = sessions.filter((session) => session.status === 'active').length;
  const sessionsNeedingStart = sessions.filter((session) => !session.workerSessionId).length;
  const failedSessions = sessions.filter((session) => session.status === 'failed' || session.status === 'closed').length;
  const sessionFilters = [
    { label: 'All', value: sessions.length },
    { label: 'Active', value: activeSessions },
    { label: 'Needs runtime', value: sessionsNeedingStart },
    { label: 'Closed', value: failedSessions },
  ];
  const controlPlaneBaseUrl = auth?.baseUrl ?? readStoredControlPlaneAuth()?.baseUrl ?? 'not connected';
  const selectedSessionActivity = selectedSession?.lastActivityAt ?? selectedSession?.updatedAt ?? null;
  const sandboxActivity = sandbox?.lastSeenAt ?? sandbox?.updatedAt ?? null;
  const sandboxProgressLabel = sandboxStageLabel(sandbox);
  const sandboxHealthSummary = sandboxHealthLabel(sandbox);
  const toolbarTitle = selectedWorkspace?.name ?? selectedProject?.name ?? 'Control Plane';
  const toolbarSubtitle = selectedPath || 'Choose a project and workspace to manage sessions';

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
      setBilling(me.billing ?? null);
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

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') {
        return;
      }
      setAccountMenuOpen(false);
      setCreatePanelOpen(null);
      setOpenSessionMenuId(null);
      setInspectorOpen(false);
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

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
        setSandboxOffline('Sandbox route connection failed.');
        setWorkerConnectionState('idle');
      }
    });
    socket.addEventListener('close', (event) => {
      if (workerSocketRef.current === socket) {
        setSandboxOffline(
          event.reason || 'Sandbox route closed before the session could stay connected.',
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
        setMessage(`Sandbox health is ${statusLabel(health.status.state)}.`);
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
    setOpenSessionMenuId(null);
    setSelectedSessionId(session.id);
    setRouteToken(null);
    setWorkerSocketUrl(null);
    closeWorkerSocket();
    clearRouteTokenRefreshTimer();
    setWorkerConnectionState('idle');
    setInspectorTab('summary');
    setInspectorOpen(true);
  }

  function handleShowSessionDetails(session: ControlPlaneSession) {
    handleOpenSession(session);
    setInspectorOpen(true);
  }

  function handleCopySessionField(label: string, value: string | null | undefined) {
    if (!value) {
      return;
    }
    setOpenSessionMenuId(null);
    void navigator.clipboard?.writeText(value);
    setMessage(`${label} copied.`);
  }

  function startEditEntity(entity: EditableEntity, name: string) {
    setEditingEntity(entity);
    setEditingName(name);
    setOpenSessionMenuId(null);
  }

  function cancelEditEntity() {
    setEditingEntity(null);
    setEditingName('');
  }

  async function saveEditEntity(event: FormEvent) {
    event.preventDefault();
    if (!auth || !editingEntity) {
      return;
    }
    const nextName = editingName.trim();
    if (!nextName) {
      setError('Name is required.');
      return;
    }

    const entity = editingEntity;
    await run(`Rename ${entity.type}`, async () => {
      if (entity.type === 'project') {
        const result = await updateControlPlaneProject(auth, entity.id, {
          name: nextName,
          slug: slugFromName(nextName),
        });
        setProjects((current) =>
          current.map((project) => (project.id === result.project.id ? result.project : project)),
        );
      } else if (entity.type === 'workspace') {
        const result = await updateControlPlaneWorkspace(auth, entity.id, { name: nextName });
        setWorkspaces((current) =>
          current.map((workspace) =>
            workspace.id === result.workspace.id ? result.workspace : workspace,
          ),
        );
      } else {
        const result = await updateControlPlaneSession(auth, entity.id, { title: nextName });
        setSessions((current) =>
          current.map((session) => (session.id === result.session.id ? result.session : session)),
        );
      }
      cancelEditEntity();
      setMessage(`${statusLabel(entity.type)} renamed.`);
    });
  }

  function deleteDialogCopy(entity: EditableEntity | null) {
    if (!entity) {
      return {
        title: 'Delete item',
        description: 'This item will be removed from the active control plane view.',
      };
    }
    if (entity.type === 'project') {
      const target = projects.find((project) => project.id === entity.id);
      return {
        title: `Delete project ${target?.name ?? ''}`.trim(),
        description:
          'The project will be archived and removed from the active project list. Its existing workspace records remain in the control plane database.',
      };
    }
    if (entity.type === 'workspace') {
      const target = workspaces.find((workspace) => workspace.id === entity.id);
      return {
        title: `Delete workspace ${target?.name ?? ''}`.trim(),
        description:
          'The workspace will be marked deleted and removed from this project view. Sessions under it will no longer be shown from the active workspace browser.',
      };
    }
    const target = sessions.find((session) => session.id === entity.id);
    return {
      title: `Delete session ${target?.title ?? ''}`.trim(),
      description:
        'The session will be marked deleted and removed from this workspace view. This does not delete files in the sandbox workspace.',
    };
  }

  async function confirmDeleteEntity() {
    if (!auth || !pendingDelete) {
      return;
    }
    const entity = pendingDelete;
    await run(`Delete ${entity.type}`, async () => {
      if (entity.type === 'project') {
        const result = await deleteControlPlaneProject(auth, entity.id);
        setProjects((current) => current.filter((project) => project.id !== result.project.id));
        if (selectedProjectId === result.project.id) {
          setSelectedProjectId('');
          setSelectedWorkspaceId('');
          setSelectedSessionId('');
          setWorkspaces([]);
          setSessions([]);
        }
      } else if (entity.type === 'workspace') {
        const result = await updateControlPlaneWorkspace(auth, entity.id, { status: 'deleted' });
        setWorkspaces((current) =>
          current.filter((workspace) => workspace.id !== result.workspace.id),
        );
        if (selectedWorkspaceId === result.workspace.id) {
          setSelectedWorkspaceId('');
          setSelectedSessionId('');
          setSessions([]);
        }
      } else {
        const result = await updateControlPlaneSession(auth, entity.id, { status: 'deleted' });
        setSessions((current) => current.filter((session) => session.id !== result.session.id));
        if (selectedSessionId === result.session.id) {
          setSelectedSessionId('');
        }
      }
      if (editingEntity && entityKey(editingEntity) === entityKey(entity)) {
        cancelEditEntity();
      }
      setPendingDelete(null);
      setRouteToken(null);
      setWorkerSocketUrl(null);
      closeWorkerSocket();
      clearRouteTokenRefreshTimer();
      setWorkerConnectionState('idle');
      setMessage(`${statusLabel(entity.type)} deleted.`);
    });
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


  const deleteCopy = deleteDialogCopy(pendingDelete);

  return {
    auth,
    user,
    sandbox,
    adminSandboxDetail,
    usage,
    billing,
    usageEvents,
    harnessUsage,
    harnessUsageEvents,
    projects,
    workspaces,
    sessions,
    selectedProjectId,
    selectedWorkspaceId,
    selectedSessionId,
    openSessionMenuId,
    routeToken,
    workerSocketUrl,
    harnessStatus,
    selectedHarnessModule,
    harnessTools,
    harnessRuns,
    harnessError,
    projectName,
    workspaceName,
    sessionTitle,
    sessionProvider,
    editingEntity,
    editingName,
    pendingDelete,
    busy,
    error,
    message,
    accountMenuOpen,
    createPanelOpen,
    inspectorOpen,
    inspectorTab,
    profileName,
    gatewayUnavailable,
    quotaExceeded,
    disabledAccount,
    expiredSession,
    sandboxOffline,
    adminUsersForbidden,
    metadataLoading,
    workerConnectionState,
    canUseControlPlane,
    sandboxReady,
    sandboxActions,
    sandboxProvisioning,
    selectedProject,
    selectedWorkspace,
    selectedSession,
    canCreateWorkspace,
    canCreateSession,
    sandboxNotice,
    workspaceCreateBlocker,
    sessionCreateBlocker,
    sessionConnectBlocker,
    createTarget,
    createTargetLabel,
    createPanelTitle,
    createPanelBlocker,
    selectedPath,
    harnessStatusText,
    harnessModules,
    harnessToolItems,
    harnessRunItems,
    harnessToolsPreview,
    harnessRunsPreview,
    accountInitial,
    totalTokens,
    totalCostUsd,
    activeSessions,
    sessionsNeedingStart,
    failedSessions,
    sessionFilters,
    controlPlaneBaseUrl,
    selectedSessionActivity,
    sandboxActivity,
    sandboxProgressLabel,
    sandboxHealthSummary,
    toolbarTitle,
    toolbarSubtitle,
    setSelectedProjectId,
    setSelectedWorkspaceId,
    setSelectedSessionId,
    setOpenSessionMenuId,
    setRouteToken,
    setWorkerSocketUrl,
    setProjectName,
    setWorkspaceName,
    setSessionTitle,
    setSessionProvider,
    setEditingName,
    setPendingDelete,
    setAccountMenuOpen,
    setCreatePanelOpen,
    setInspectorOpen,
    setInspectorTab,
    setProfileName,
    setSessions,
    setWorkerConnectionState,
    refresh,
    refreshHarness,
    closeWorkerSocket,
    clearRouteTokenRefreshTimer,
    handleLogout,
    handleProfileSave,
    handleCreateProject,
    handleCreateWorkspace,
    handleCreateSession,
    sandboxAction,
    handleHarnessModuleSelect,
    handleInspectSandbox,
    handleRouteToken,
    handleOpenSession,
    handleShowSessionDetails,
    handleCopySessionField,
    startEditEntity,
    cancelEditEntity,
    saveEditEntity,
    confirmDeleteEntity,
    handleCloseSession,
    handleResumeSession,
    deleteCopy,
  };
}

export type ControlPlanePageController = ReturnType<typeof useControlPlanePageController>;
