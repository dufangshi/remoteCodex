import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import type {
  AgentProviderCapabilitiesDto,
  ThreadDetailDto,
  ThreadDto,
  ThreadStatusDto,
} from '../../../../packages/shared/src/index';
import {
  AppShellMenuButton,
  AppShellNavigationMenu,
  ThreadDetailSurface,
  formatLongTimestamp,
  threadStatusLabel,
  useAppShellNav,
  type ThreadComposerProps,
  type ThreadDetailUiAdapter,
  type ThreadShellControlState,
  type ThreadTimelineProps,
} from '@remote-codex/thread-ui';
import {
  ApiError,
  createControlPlaneRouteToken,
  fetchControlPlaneMe,
  fetchControlPlaneProjects,
  fetchControlPlaneSessions,
  fetchControlPlaneWorkerThread,
  fetchControlPlaneWorkspaces,
  interruptControlPlaneWorkerThread,
  resumeControlPlaneSession,
  sendControlPlaneWorkerThreadPrompt,
  type ControlPlaneAuth,
  type ControlPlaneProject,
  type ControlPlaneRouteToken,
  type ControlPlaneSandbox,
  type ControlPlaneSession,
  type ControlPlaneWorkspace,
  type PromptAttachmentUpload,
} from '../lib/api';
import {
  appendLatestTurns,
  mergePendingRequests,
} from './threadDetailModel';
import {
  clearStoredControlPlaneAuth,
  readStoredControlPlaneAuth,
} from './controlPlaneAuthStorage';

const REMOTE_THREAD_REFRESH_INTERVAL_MS = 3000;
const ROUTE_TOKEN_REFRESH_SKEW_MS = 60_000;
const ROUTE_TOKEN_MIN_REFRESH_MS = 5_000;
const ROUTE_TOKEN_MAX_REFRESH_MS = 2_147_000_000;
const ROUTE_TOKEN_SCOPES = [
  'worker:read',
  'worker:write',
  'session:prompt',
  'provider:turn:create',
  'provider:turn:interrupt',
];

const EMPTY_ANSWERED_REQUEST_NOTES: NonNullable<
  ThreadDetailDto['answeredRequestNotes']
> = [];
const EMPTY_ACTIVITY_NOTES: NonNullable<ThreadDetailDto['activityNotes']> = [];
const EMPTY_PENDING_STEERS: NonNullable<ThreadDetailDto['pendingSteers']> = [];

const controlPlaneCapabilities: AgentProviderCapabilitiesDto = {
  sessions: { list: false, read: true, resume: true, importLocal: false },
  turns: { start: true, streamInput: false, steer: false, interrupt: true, compact: false },
  branching: { fork: false, hardRollback: false, resumeAt: false, rewindFiles: false },
  controls: {
    planMode: false,
    permissionRequests: false,
    sandboxMode: false,
    performanceMode: false,
    goals: false,
  },
  management: {
    models: false,
    mcpStatus: false,
    skills: false,
    hooks: false,
    hookTrust: false,
    hostConfigFiles: false,
    providerSettings: false,
  },
  usage: { contextWindow: true, tokenUsage: true, costUsd: false },
};

function storedAuth(): ControlPlaneAuth | null {
  const stored = readStoredControlPlaneAuth();
  if (!stored) {
    return null;
  }
  return {
    baseUrl: stored.baseUrl,
    token: stored.token,
  };
}

function normalizeThreadStatus(status: string | null | undefined): ThreadStatusDto {
  switch (status) {
    case 'idle':
    case 'running':
    case 'interrupted':
    case 'failed':
    case 'not_loaded':
    case 'system_error':
      return status;
    case 'active':
      return 'idle';
    default:
      return 'not_loaded';
  }
}

function sessionToThread(
  session: ControlPlaneSession,
  workspace: ControlPlaneWorkspace,
  detail: ThreadDetailDto | null,
): ThreadDto {
  const thread = detail?.thread;
  return {
    id: session.id,
    workspaceId: workspace.id,
    provider: session.provider,
    providerSessionId: session.workerSessionId ?? thread?.providerSessionId ?? null,
    source: 'supervisor',
    title: session.title || thread?.title || 'Remote session',
    model: thread?.model ?? null,
    reasoningEffort: thread?.reasoningEffort ?? null,
    fastMode: thread?.fastMode ?? false,
    collaborationMode: thread?.collaborationMode ?? 'default',
    approvalMode: thread?.approvalMode ?? 'guarded',
    sandboxMode: thread?.sandboxMode ?? null,
    status: thread?.status ?? normalizeThreadStatus(session.status),
    summaryText: thread?.summaryText ?? null,
    lastError: thread?.lastError ?? null,
    activeTurnId: thread?.activeTurnId ?? null,
    isLoaded: Boolean(thread?.isLoaded),
    isPinned: false,
    createdAt: session.createdAt,
    updatedAt: thread?.updatedAt ?? session.updatedAt,
    lastTurnStartedAt: thread?.lastTurnStartedAt ?? session.lastActivityAt,
    lastTurnCompletedAt: thread?.lastTurnCompletedAt ?? null,
    ...(thread?.contextUsage ? { contextUsage: thread.contextUsage } : {}),
  };
}

function controlPlaneWorkerAssetUrl(
  routeToken: ControlPlaneRouteToken,
  workerSessionId: string,
  path: string,
) {
  const url = new URL(
    `/api/sandboxes/${encodeURIComponent(
      routeToken.sandboxId,
    )}/api/threads/${encodeURIComponent(workerSessionId)}/assets/image`,
    routeToken.routerBaseUrl,
  );
  url.searchParams.set('path', path);
  return url.toString();
}

const remoteShellUnavailableState: ThreadShellControlState = {
  status: 'not_created',
  connectionButtonDisabled: true,
  connectionButtonLabel: 'Remote shell unavailable',
  shellInputEnabled: false,
  isConnecting: false,
  isCommandRunning: false,
  promptLabel: 'Remote shell adapter not connected',
  isMobileShell: false,
  hasShell: false,
  busy: false,
  loading: false,
  error: 'Remote sandbox shell routing is not connected yet.',
};

function isInvalidRouteTokenError(caught: unknown) {
  return (
    caught instanceof ApiError &&
    caught.statusCode === 401 &&
    caught.payload.code === 'invalid_route_token'
  );
}

function isDisconnectedWorkerThreadError(caught: unknown) {
  return caught instanceof ApiError && (caught.statusCode === 404 || caught.statusCode === 409);
}

function sameJsonValue(left: unknown, right: unknown) {
  if (Object.is(left, right)) {
    return true;
  }
  return JSON.stringify(left) === JSON.stringify(right);
}

function reuseEquivalentArrayItems<T extends { id: string }>(
  current: T[],
  incoming: T[],
) {
  let changed =
    current.length !== incoming.length ||
    current.some((entry, index) => entry.id !== incoming[index]?.id);
  const byId = new Map(current.map((entry) => [entry.id, entry] as const));
  const merged = incoming.map((entry) => {
    const existing = byId.get(entry.id);
    if (existing && sameJsonValue(existing, entry)) {
      return existing;
    }
    changed = true;
    return entry;
  });
  return changed ? merged : current;
}

function reuseEquivalentValue<T>(current: T, incoming: T) {
  return sameJsonValue(current, incoming) ? current : incoming;
}

export function mergeControlPlaneThreadDetail(
  current: ThreadDetailDto | null,
  next: ThreadDetailDto,
): ThreadDetailDto {
  if (!current) {
    return next;
  }
  const turns = reuseEquivalentArrayItems(
    current.turns,
    appendLatestTurns(current.turns, next.turns),
  );
  const pendingRequests = reuseEquivalentArrayItems(
    current.pendingRequests,
    mergePendingRequests(
      current.pendingRequests,
      next.pendingRequests,
      new Set(),
    ),
  );
  const merged: ThreadDetailDto = {
    ...next,
    turns,
    pendingRequests,
    pendingSteers: reuseEquivalentArrayItems(current.pendingSteers, next.pendingSteers),
  };
  if ('answeredRequestNotes' in next || 'answeredRequestNotes' in current) {
    merged.answeredRequestNotes = reuseEquivalentValue(
      current.answeredRequestNotes,
      next.answeredRequestNotes,
    ) ?? [];
  }
  if ('activityNotes' in next || 'activityNotes' in current) {
    merged.activityNotes = reuseEquivalentValue(current.activityNotes, next.activityNotes) ?? [];
  }
  if ('livePlan' in next || 'livePlan' in current) {
    merged.livePlan = reuseEquivalentValue(current.livePlan, next.livePlan) ?? null;
  }
  if ('liveItems' in next || 'liveItems' in current) {
    merged.liveItems = reuseEquivalentValue(current.liveItems, next.liveItems) ?? null;
  }
  return merged;
}

export function ControlPlaneSessionPage() {
  return <ControlPlaneSessionSurface />;
}

function ControlPlaneSessionSurface() {
  const { sessionId = '' } = useParams();
  const navigate = useNavigate();
  const shellNav = useAppShellNav();
  const auth = useMemo(storedAuth, []);
  const [sandbox, setSandbox] = useState<ControlPlaneSandbox | null>(null);
  const [project, setProject] = useState<ControlPlaneProject | null>(null);
  const [workspace, setWorkspace] = useState<ControlPlaneWorkspace | null>(null);
  const [workspaceSessions, setWorkspaceSessions] = useState<ControlPlaneSession[]>([]);
  const [session, setSession] = useState<ControlPlaneSession | null>(null);
  const [routeToken, setRouteToken] = useState<ControlPlaneRouteToken | null>(null);
  const [detail, setDetail] = useState<ThreadDetailDto | null>(null);
  const [draft, setDraft] = useState<{ prompt: string; attachments: PromptAttachmentUpload[] }>({
    prompt: '',
    attachments: [],
  });
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [scrollRequestKey, setScrollRequestKey] = useState(0);
  const [activeView, setActiveView] = useState<'chat' | 'shell'>('chat');
  const [followTail, setFollowTail] = useState(true);
  const reconnectingRef = useRef(false);
  const routeTokenRefreshTimerRef = useRef<number | null>(null);
  const detailRef = useRef<ThreadDetailDto | null>(null);

  const applyDetailResponse = useCallback((nextDetail: ThreadDetailDto) => {
    setDetail((current) => {
      const merged = mergeControlPlaneThreadDetail(current, nextDetail);
      detailRef.current = merged;
      return merged;
    });
  }, []);

  const issueRouteToken = useCallback(async (
    input: {
      sandbox: ControlPlaneSandbox;
      project: ControlPlaneProject;
      workspace: ControlPlaneWorkspace;
      session: ControlPlaneSession;
    },
  ) => {
    if (!auth) {
      return null;
    }
    const token = await createControlPlaneRouteToken(auth, input.sandbox.id, {
      projectId: input.project.id,
      workspaceId: input.workspace.id,
      sessionId: input.session.id,
      scopes: ROUTE_TOKEN_SCOPES,
    });
    setRouteToken(token);
    return token;
  }, [auth]);

  const refreshRouteToken = useCallback(async () => {
    if (!sandbox || !project || !workspace || !session || sandbox.state !== 'running') {
      return null;
    }
    return issueRouteToken({ sandbox, project, workspace, session });
  }, [issueRouteToken, project, sandbox, session, workspace]);

  const loadSession = useCallback(async () => {
    if (!auth) {
      navigate('/control-plane/login', { replace: true });
      return null;
    }
    setLoading(true);
    setError(null);
    try {
      const me = await fetchControlPlaneMe(auth);
      setSandbox(me.sandbox);
      if (me.sandbox.state !== 'running') {
        setSession(null);
        setRouteToken(null);
        setDetail(null);
        detailRef.current = null;
        setError('Sandbox is not running. Start the sandbox from the control plane before opening chat.');
        return null;
      }

      const projectsResult = await fetchControlPlaneProjects(auth);
      for (const candidateProject of projectsResult.projects) {
        const workspacesResult = await fetchControlPlaneWorkspaces(auth, candidateProject.id);
        for (const candidateWorkspace of workspacesResult.workspaces) {
          const sessionsResult = await fetchControlPlaneSessions(auth, candidateWorkspace.id);
          const candidateSession = sessionsResult.sessions.find((item) => item.id === sessionId);
          if (!candidateSession) {
            continue;
          }

          const resumed = await resumeControlPlaneSession(auth, candidateSession.id);
          const nextSessions = sessionsResult.sessions.map((item) =>
            item.id === resumed.session.id ? resumed.session : item,
          );
          const token = await issueRouteToken({
            sandbox: me.sandbox,
            project: candidateProject,
            workspace: candidateWorkspace,
            session: resumed.session,
          });
          if (!token) {
            setError('Unable to issue a router token for this session.');
            return null;
          }
          setProject(candidateProject);
          setWorkspace(candidateWorkspace);
          setWorkspaceSessions(nextSessions);
          setSession(resumed.session);
          if (!resumed.session.workerSessionId) {
            setDetail(null);
            detailRef.current = null;
            setError('Session resumed, but the worker did not return a thread id.');
            return null;
          }
          const thread = await fetchControlPlaneWorkerThread(token, resumed.session.workerSessionId);
          applyDetailResponse(thread);
          setScrollRequestKey((current) => current + 1);
          setMessage('Chat session connected.');
          return { session: resumed.session, token, detail: thread };
        }
      }
      setError('Session was not found in any project workspace.');
      return null;
    } catch (caught) {
      if (caught instanceof ApiError && caught.payload.code === 'unauthorized') {
        clearStoredControlPlaneAuth();
        navigate('/control-plane/login', { replace: true });
        return null;
      }
      setError(caught instanceof Error ? caught.message : 'Unable to open control-plane session.');
      return null;
    } finally {
      setLoading(false);
    }
  }, [applyDetailResponse, auth, issueRouteToken, navigate, sessionId]);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  useEffect(() => {
    if (routeTokenRefreshTimerRef.current) {
      window.clearTimeout(routeTokenRefreshTimerRef.current);
      routeTokenRefreshTimerRef.current = null;
    }
    if (!routeToken) {
      return;
    }
    const expiresAtMs = Date.parse(routeToken.expiresAt);
    if (!Number.isFinite(expiresAtMs)) {
      return;
    }
    const delayMs = Math.max(
      ROUTE_TOKEN_MIN_REFRESH_MS,
      Math.min(
        ROUTE_TOKEN_MAX_REFRESH_MS,
        expiresAtMs - Date.now() - ROUTE_TOKEN_REFRESH_SKEW_MS,
      ),
    );
    routeTokenRefreshTimerRef.current = window.setTimeout(() => {
      void refreshRouteToken().catch((caught) => {
        setError(caught instanceof Error ? caught.message : 'Unable to refresh router token.');
      });
    }, delayMs);

    return () => {
      if (routeTokenRefreshTimerRef.current) {
        window.clearTimeout(routeTokenRefreshTimerRef.current);
        routeTokenRefreshTimerRef.current = null;
      }
    };
  }, [refreshRouteToken, routeToken]);

  const refreshThread = useCallback(async (input: { silent?: boolean } = {}) => {
    if (!routeToken || !session?.workerSessionId) {
      return;
    }
    if (!input.silent) {
      setError(null);
    }
    try {
      applyDetailResponse(await fetchControlPlaneWorkerThread(routeToken, session.workerSessionId));
    } catch (caught) {
      if (isInvalidRouteTokenError(caught)) {
        try {
          const token = await refreshRouteToken();
          if (token && session.workerSessionId) {
            applyDetailResponse(await fetchControlPlaneWorkerThread(token, session.workerSessionId));
            return;
          }
        } catch (retryError) {
          setError(retryError instanceof Error ? retryError.message : 'Unable to refresh worker thread.');
          return;
        }
      }
      if (isDisconnectedWorkerThreadError(caught) && !reconnectingRef.current) {
        reconnectingRef.current = true;
        try {
          setMessage('Worker thread was not found. Reconnecting this session...');
          await loadSession();
          return;
        } finally {
          reconnectingRef.current = false;
        }
      }
      setError(caught instanceof Error ? caught.message : 'Unable to refresh worker thread.');
    }
  }, [applyDetailResponse, loadSession, refreshRouteToken, routeToken, session?.workerSessionId]);

  useEffect(() => {
    const active =
      detail?.thread.status === 'running' || Boolean(detail?.thread.activeTurnId) || sending;
    if (!active || !routeToken || !session?.workerSessionId) {
      return;
    }
    const interval = window.setInterval(() => {
      void refreshThread({ silent: true });
    }, REMOTE_THREAD_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [
    detail?.thread.activeTurnId,
    detail?.thread.status,
    refreshThread,
    routeToken,
    sending,
    session?.workerSessionId,
  ]);

  async function handlePromptSubmit(input: {
    prompt: string;
    attachments?: PromptAttachmentUpload[];
  }) {
    const trimmed = input.prompt.trim();
    if (!trimmed || !routeToken || !session?.workerSessionId) {
      return false;
    }
    setSending(true);
    setError(null);
    setMessage(null);
    try {
      await sendControlPlaneWorkerThreadPrompt(routeToken, session.workerSessionId, {
        prompt: trimmed,
      });
      setDraft({ prompt: '', attachments: [] });
      await refreshThread();
      setScrollRequestKey((current) => current + 1);
      return true;
    } catch (caught) {
      if (isInvalidRouteTokenError(caught)) {
        try {
          const token = await refreshRouteToken();
          if (!token || !session.workerSessionId) {
            throw caught;
          }
          await sendControlPlaneWorkerThreadPrompt(token, session.workerSessionId, {
            prompt: trimmed,
          });
          const thread = await fetchControlPlaneWorkerThread(token, session.workerSessionId);
          applyDetailResponse(thread);
          setDraft({ prompt: '', attachments: [] });
          setScrollRequestKey((current) => current + 1);
          return true;
        } catch (retryError) {
          setError(retryError instanceof Error ? retryError.message : 'Unable to send prompt.');
          return false;
        }
      }
      if (isDisconnectedWorkerThreadError(caught) && !reconnectingRef.current) {
        reconnectingRef.current = true;
        try {
          setMessage('Worker thread was not found. Reconnecting this session...');
          const reconnected = await loadSession();
          if (!reconnected?.session.workerSessionId) {
            throw caught;
          }
          await sendControlPlaneWorkerThreadPrompt(
            reconnected.token,
            reconnected.session.workerSessionId,
            {
              prompt: trimmed,
            },
          );
          const thread = await fetchControlPlaneWorkerThread(
            reconnected.token,
            reconnected.session.workerSessionId,
          );
          applyDetailResponse(thread);
          setDraft({ prompt: '', attachments: [] });
          setScrollRequestKey((current) => current + 1);
          return true;
        } catch (retryError) {
          setError(retryError instanceof Error ? retryError.message : 'Unable to send prompt.');
          return false;
        } finally {
          reconnectingRef.current = false;
        }
      }
      setError(caught instanceof Error ? caught.message : 'Unable to send prompt.');
      return false;
    } finally {
      setSending(false);
    }
  }

  async function handleInterrupt() {
    if (!routeToken || !session?.workerSessionId) {
      return;
    }
    setSending(true);
    setError(null);
    try {
      const activeTurnId = detailRef.current?.thread.activeTurnId ?? undefined;
      const thread = await interruptControlPlaneWorkerThread(
        routeToken,
        session.workerSessionId,
        activeTurnId ? { turnId: activeTurnId } : {},
      );
      setDetail((current) => (current ? { ...current, thread } : current));
      await refreshThread({ silent: true });
    } catch (caught) {
      if (isInvalidRouteTokenError(caught)) {
        try {
          const token = await refreshRouteToken();
          if (!token || !session.workerSessionId) {
            throw caught;
          }
          const activeTurnId = detailRef.current?.thread.activeTurnId ?? undefined;
          const thread = await interruptControlPlaneWorkerThread(
            token,
            session.workerSessionId,
            activeTurnId ? { turnId: activeTurnId } : {},
          );
          setDetail((current) => (current ? { ...current, thread } : current));
          applyDetailResponse(await fetchControlPlaneWorkerThread(token, session.workerSessionId));
          return;
        } catch (retryError) {
          setError(retryError instanceof Error ? retryError.message : 'Unable to interrupt turn.');
          return;
        }
      }
      setError(caught instanceof Error ? caught.message : 'Unable to interrupt turn.');
    } finally {
      setSending(false);
    }
  }

  const promptDisabledReason = !routeToken
    ? 'Waiting for a router token...'
    : !session?.workerSessionId
      ? 'Reconnect this session before sending a prompt.'
      : undefined;
  const sidebarThreads = workspace
    ? workspaceSessions.map((item) => sessionToThread(item, workspace, item.id === session?.id ? detail : null))
    : [];
  const activeThread = session && workspace ? sessionToThread(session, workspace, detail) : null;
  const threads = activeThread && sidebarThreads.every((item) => item.id !== activeThread.id)
    ? [activeThread, ...sidebarThreads]
    : sidebarThreads;

  const metaContent = (
    <dl className="space-y-4 text-sm">
      <div>
        <dt className="text-[var(--theme-fg-muted)]">Control Session</dt>
        <dd className="mt-1 break-all text-[var(--theme-fg)]">{session?.id ?? sessionId}</dd>
      </div>
      <div>
        <dt className="text-[var(--theme-fg-muted)]">Worker Thread</dt>
        <dd className="mt-1 break-all text-[var(--theme-fg)]">
          {session?.workerSessionId ?? 'Not started'}
        </dd>
      </div>
      <div>
        <dt className="text-[var(--theme-fg-muted)]">Source</dt>
        <dd className="mt-1 text-[var(--theme-fg)]">
          {session?.provider ?? detail?.thread.provider ?? 'codex'} remote sandbox session
        </dd>
      </div>
      <div>
        <dt className="text-[var(--theme-fg-muted)]">Status</dt>
        <dd className="mt-1 text-[var(--theme-fg)]">
          {threadStatusLabel(detail?.thread.status ?? normalizeThreadStatus(session?.status))}
        </dd>
      </div>
      <div>
        <dt className="text-[var(--theme-fg-muted)]">Workspace</dt>
        <dd className="mt-1 break-words text-[var(--theme-fg)]">
          {workspace?.path ?? detail?.workspace.absPath ?? 'Unavailable'}
        </dd>
      </div>
      <div>
        <dt className="text-[var(--theme-fg-muted)]">Project</dt>
        <dd className="mt-1 text-[var(--theme-fg)]">
          {project?.name ?? 'None'}
        </dd>
      </div>
      <div>
        <dt className="text-[var(--theme-fg-muted)]">Sandbox</dt>
        <dd className="mt-1 text-[var(--theme-fg)]">
          {sandbox?.state ?? 'Unknown'}
        </dd>
      </div>
      <div>
        <dt className="text-[var(--theme-fg-muted)]">Router</dt>
        <dd className="mt-1 break-all text-[var(--theme-fg)]">
          {routeToken?.routerBaseUrl ?? sandbox?.routerBaseUrl ?? 'Unavailable'}
        </dd>
      </div>
      <div>
        <dt className="text-[var(--theme-fg-muted)]">Updated</dt>
        <dd className="mt-1 text-[var(--theme-fg)]">
          {formatLongTimestamp(session?.updatedAt ?? null)}
        </dd>
      </div>
    </dl>
  );

  const settingsContent = (
    <div className="space-y-4 text-sm">
      <section className="space-y-2">
        <p className="text-xs uppercase tracking-[0.2em] text-[var(--theme-fg-muted)]">
          Remote Session
        </p>
        <button
          type="button"
          onClick={() => void loadSession()}
          disabled={loading}
          className="block w-full rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface-strong)] px-3 py-2 text-left text-sm text-[var(--theme-fg)] transition hover:bg-[var(--theme-hover)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? 'Reconnecting...' : 'Reconnect session'}
        </button>
        <button
          type="button"
          onClick={() => void refreshThread()}
          disabled={!routeToken}
          className="block w-full rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface-strong)] px-3 py-2 text-left text-sm text-[var(--theme-fg)] transition hover:bg-[var(--theme-hover)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          Refresh worker thread
        </button>
      </section>
    </div>
  );

  const timelineProps = useMemo<Partial<ThreadTimelineProps>>(
    () => ({
      scrollRequestKey,
      className: 'thread-timeline-surface min-h-0 flex-1',
      onTailVisibilityChange: setFollowTail,
      answeredRequestNotes:
        detail?.answeredRequestNotes ?? EMPTY_ANSWERED_REQUEST_NOTES,
      activityNotes: detail?.activityNotes ?? EMPTY_ACTIVITY_NOTES,
      pendingSteers: detail?.pendingSteers ?? EMPTY_PENDING_STEERS,
    }),
    [
      detail?.activityNotes,
      detail?.answeredRequestNotes,
      detail?.pendingSteers,
      scrollRequestKey,
    ],
  );

  const composerProps = detail
    ? ({
        busy: sending,
        error,
        model: detail.thread.model,
        reasoningEffort: detail.thread.reasoningEffort,
        fastMode: detail.thread.fastMode ?? false,
        collaborationMode: detail.thread.collaborationMode,
        contextUsage: detail.thread.contextUsage,
        capabilities: controlPlaneCapabilities,
        toolboxItems: [],
        followTail,
        threadConnected: detail.thread.isLoaded,
        disabled: Boolean(promptDisabledReason),
        ...(promptDisabledReason
          ? { disabledPlaceholder: promptDisabledReason }
          : {}),
        draftPrompt: draft.prompt,
        draftAttachments: draft.attachments,
        onDraftChange: setDraft,
        canInterrupt: Boolean(detail.thread.activeTurnId),
        onInterrupt: handleInterrupt,
        shellControlState: remoteShellUnavailableState,
        onToggleView: () => setActiveView('shell'),
        onToggleFollow: () => setScrollRequestKey((current) => current + 1),
      } satisfies Omit<ThreadComposerProps, 'activeView' | 'onSubmit'>)
    : null;

  const surfaceActions = (
    <span className="rounded-full border border-[var(--theme-border)] bg-[var(--theme-surface-strong)] px-3 py-2 text-xs font-medium text-[var(--theme-fg)] shadow-lg shadow-stone-950/20">
      {detail?.thread.status ?? session?.status ?? 'loading'}
    </span>
  );

  const beforeTimelineContent = message && !error ? (
    <div className="shrink-0 border-b border-emerald-500/20 bg-emerald-500/10 px-5 py-3 text-sm text-emerald-100 sm:px-6">
      {message}
    </div>
  ) : null;

  const shellUnavailableContent = (
    <div className="flex min-h-0 flex-1 items-center justify-center p-4 sm:p-6">
      <div className="thread-empty-surface max-w-md rounded-[1.6rem] border px-6 py-8 text-center">
        <p className="text-base font-medium text-[var(--theme-fg)]">
          Remote shell transport unavailable
        </p>
        <p className="mt-3 text-sm leading-6 text-[var(--theme-fg-muted)]">
          The Terminal plugin is enabled, but this control-plane route does not yet provide
          the remote shell API adapter used by the main supervisor thread page.
        </p>
        <button
          type="button"
          onClick={() => setActiveView('chat')}
          className="mt-5 inline-flex h-9 items-center rounded-full border border-[var(--theme-border)] bg-[var(--theme-surface-strong)] px-4 text-sm font-medium text-[var(--theme-fg)] transition hover:bg-[var(--theme-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--theme-ring)] focus:ring-offset-2 focus:ring-offset-[var(--theme-surface)]"
        >
          Switch to chat
        </button>
      </div>
    </div>
  );

  const getImageAssetUrl = useCallback(
    (path: string) =>
      routeToken && session?.workerSessionId
        ? controlPlaneWorkerAssetUrl(routeToken, session.workerSessionId, path)
        : '',
    [routeToken, session?.workerSessionId],
  );

  const surfaceAdapter = useMemo<ThreadDetailUiAdapter>(
    () => ({
      openThread: (threadId: string) => {
        navigate(`/control-plane/sessions/${threadId}`);
      },
      getThreadHref: (threadId: string) => `/control-plane/sessions/${threadId}`,
      getNewThreadHref: () => '/control-plane',
      sendPrompt: handlePromptSubmit,
      interrupt: handleInterrupt,
      getImageAssetUrl,
      shell: null,
    }),
    [getImageAssetUrl, navigate],
  );

  return (
    <ThreadDetailSurface
      threads={threads}
      detail={detail}
      status={null}
      loading={loading}
      error={loading ? null : error}
      adapter={surfaceAdapter}
      currentWorkspaceId={workspace?.id ?? null}
      currentWorkspaceLabel={workspace?.name ?? detail?.workspace.label ?? null}
      metaContent={metaContent}
      settingsContent={settingsContent}
      surfaceActions={surfaceActions}
      beforeTimelineContent={beforeTimelineContent}
      appMenuButton={<AppShellMenuButton />}
      appNavigationMenu={
        <AppShellNavigationMenu
          currentPath={`/control-plane/sessions/${sessionId}`}
          items={[
            { label: 'Control Plane', href: '/control-plane' },
            { label: 'Workspaces', href: '/workspaces' },
          ]}
          onNavigate={navigate}
        />
      }
      onCloseAppNavigation={shellNav?.closeNav ?? (() => {})}
      activeView={activeView}
      timelineProps={timelineProps}
      shellUnavailableContent={shellUnavailableContent}
      shellDisconnectedContent={shellUnavailableContent}
      shellContent={shellUnavailableContent}
      loadingContent={
        <div className="flex flex-1 items-center justify-center px-6 py-12 text-center text-[var(--theme-fg-muted)]">
          Opening worker thread...
        </div>
      }
      emptyContent={
        <div className="flex flex-1 items-center justify-center px-6 py-12 text-center text-[var(--theme-fg-muted)]">
          No worker thread is connected yet.
        </div>
      }
      {...(session ? { currentThreadId: session.id } : {})}
      {...(composerProps ? { composerProps } : {})}
    />
  );
}
