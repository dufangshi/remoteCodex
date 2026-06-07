import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import type {
  AgentProviderCapabilitiesDto,
  ThreadArtifactDto,
  ThreadDetailDto,
  ThreadHistoryItemDetailDto,
  ThreadHistoryItemDto,
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
  usePlugins,
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
  fetchControlPlaneWorkerThreadHistoryItemDetail,
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

function formatRelativeTime(value: string | null | undefined) {
  if (!value) {
    return 'no activity yet';
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return value;
  }
  const deltaMs = Date.now() - timestamp;
  const absMs = Math.abs(deltaMs);
  const suffix = deltaMs >= 0 ? 'ago' : 'from now';
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (absMs < minute) {
    return 'just now';
  }
  if (absMs < hour) {
    return `${Math.round(absMs / minute)}m ${suffix}`;
  }
  if (absMs < day) {
    return `${Math.round(absMs / hour)}h ${suffix}`;
  }
  return `${Math.round(absMs / day)}d ${suffix}`;
}

function MetadataDisclosure({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section className="control-metadata-disclosure">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="control-metadata-trigger"
      >
        <span>{title}</span>
        <span>{open ? 'Hide' : 'Show'}</span>
      </button>
      {open ? children : null}
    </section>
  );
}

function CopyField({ label, value }: { label: string; value: string | null | undefined }) {
  const printable = value && value.trim() ? value : 'not assigned';
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        <span>{printable}</span>
        {value ? (
          <button
            type="button"
            className="control-copy-button"
            onClick={() => {
              void navigator.clipboard?.writeText(value);
            }}
          >
            Copy
          </button>
        ) : null}
      </dd>
    </div>
  );
}

type SelectedArtifact = {
  kind: 'artifact';
  item: ThreadHistoryItemDto & { kind: 'artifact' };
  artifact: ThreadArtifactDto;
};

type SelectedHistoryDetail = {
  kind: 'historyDetail';
  item: ThreadHistoryItemDto;
  detail: ThreadHistoryItemDetailDto;
};

type SelectedInspectorItem = SelectedArtifact | SelectedHistoryDetail;

function artifactPayloadSource(payload: unknown) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const record = payload as {
    content?: unknown;
    format?: unknown;
    name?: unknown;
  };
  const content = Array.isArray(record.content)
    ? record.content.filter((entry): entry is string => typeof entry === 'string')
    : typeof record.content === 'string'
      ? [record.content]
      : [];
  if (content.length === 0) {
    return null;
  }
  return {
    content: content.join('\n'),
    format: typeof record.format === 'string' ? record.format : 'text',
    name: typeof record.name === 'string' ? record.name : null,
  };
}

function ThreadInspector({
  selected,
  onClose,
}: {
  selected: SelectedInspectorItem;
  onClose: () => void;
}) {
  const plugins = usePlugins();
  const [activeTab, setActiveTab] = useState<'preview' | 'source' | 'logs' | 'metadata'>(
    selected.kind === 'artifact' ? 'preview' : 'logs',
  );
  const [expanded, setExpanded] = useState(true);
  const artifact = selected.kind === 'artifact' ? selected.artifact : null;
  const historyDetail = selected.kind === 'historyDetail' ? selected.detail : null;
  const item = selected.item;
  const source = artifact ? artifactPayloadSource(artifact.payload) : null;
  const preview = artifact
    ? plugins.renderArtifact({
        artifact,
        expanded,
        onToggleExpanded: () => setExpanded((current) => !current),
      })
    : null;
  const tabs = [
    { id: 'preview', label: 'Preview' },
    { id: 'source', label: 'Source' },
    { id: 'logs', label: 'Logs' },
    { id: 'metadata', label: 'Metadata' },
  ] as const;

  return (
    <aside className="control-artifact-inspector" aria-label="Thread inspector">
      <header className="control-artifact-inspector-header">
        <div className="min-w-0">
          <p>{artifact?.type ?? item.kind}</p>
          <h2>{artifact?.title ?? historyDetail?.title ?? item.text ?? 'Timeline detail'}</h2>
        </div>
        <button type="button" onClick={onClose} aria-label="Close thread inspector">
          x
        </button>
      </header>

      <div className="control-artifact-tabs" role="tablist" aria-label="Thread details">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="control-artifact-panel">
        {activeTab === 'preview' ? (
          selected.kind !== 'artifact' ? (
            <div className="control-artifact-empty">
              Preview is available for artifacts. Open Logs for this item detail.
            </div>
          ) : preview ? (
            <div className="control-artifact-preview">{preview}</div>
          ) : (
            <div className="control-artifact-empty">
              No renderer is enabled for this artifact type.
            </div>
          )
        ) : null}

        {activeTab === 'source' ? (
          historyDetail ? (
            <pre className="control-artifact-source-raw">{historyDetail.text}</pre>
          ) : source ? (
            <div className="control-artifact-source">
              <div>
                <span>{source.format}</span>
                {source.name ? <strong>{source.name}</strong> : null}
              </div>
              <pre>{source.content}</pre>
            </div>
          ) : (
            <pre className="control-artifact-source-raw">
              {JSON.stringify(artifact?.payload, null, 2)}
            </pre>
          )
        ) : null}

        {activeTab === 'logs' ? (
          <div className="control-artifact-logs">
            {historyDetail ? (
              <pre>{historyDetail.text}</pre>
            ) : (
              <dl className="control-detail-list">
                <div>
                  <dt>Timeline item</dt>
                  <dd>{item.text || item.previewText || artifact?.summaryText || 'Artifact created'}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>{item.status ?? 'completed'}</dd>
                </div>
                <div>
                  <dt>Source turn</dt>
                  <dd>{artifact?.sourceTurnId ?? item.sourceTurnId ?? 'not assigned'}</dd>
                </div>
                <div>
                  <dt>Source item</dt>
                  <dd>{artifact?.sourceItemId ?? item.id}</dd>
                </div>
              </dl>
            )}
          </div>
        ) : null}

        {activeTab === 'metadata' ? (
          <dl className="control-detail-list">
            <CopyField label="Timeline item id" value={item.id} />
            <CopyField label="Timeline kind" value={item.kind} />
            {artifact ? (
              <>
                <CopyField label="Artifact id" value={artifact.id} />
                <CopyField label="Plugin id" value={artifact.pluginId} />
                <CopyField label="Artifact type" value={artifact.type} />
                <CopyField label="Created" value={formatLongTimestamp(artifact.createdAt)} />
                <CopyField label="Source turn" value={artifact.sourceTurnId} />
                <CopyField label="Source item" value={artifact.sourceItemId} />
              </>
            ) : (
              <>
                <CopyField label="Detail id" value={historyDetail?.id} />
                <CopyField label="Detail kind" value={historyDetail?.kind} />
              </>
            )}
            <div>
              <dt>Payload</dt>
              <dd>
                <pre>
                  {artifact
                    ? JSON.stringify(artifact.payload, null, 2)
                    : JSON.stringify({ item, detail: historyDetail }, null, 2)}
                </pre>
              </dd>
            </div>
          </dl>
        ) : null}
      </div>
    </aside>
  );
}

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
  const [selectedInspectorItem, setSelectedInspectorItem] = useState<SelectedInspectorItem | null>(null);
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
    setSelectedInspectorItem(null);
  }, [sessionId]);

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

  const currentStatus = detail?.thread.status ?? normalizeThreadStatus(session?.status);
  const currentStatusLabel = threadStatusLabel(currentStatus);
  const currentActivityAt =
    detail?.thread.lastTurnStartedAt ??
    detail?.thread.updatedAt ??
    session?.lastActivityAt ??
    session?.updatedAt ??
    null;
  const currentProvider = session?.provider ?? detail?.thread.provider ?? 'codex';
  const currentModel = detail?.thread.model ?? 'default model';
  const routeTokenExpiresAt = routeToken?.expiresAt ?? null;

  const metaContent = (
    <div className="control-session-meta">
      <dl className="control-detail-list compact summary two">
        <div>
          <dt>Status</dt>
          <dd>{currentStatusLabel}</dd>
        </div>
        <div>
          <dt>Provider</dt>
          <dd>{currentProvider}</dd>
        </div>
        <div>
          <dt>Workspace</dt>
          <dd>{workspace?.name ?? detail?.workspace.label ?? 'Unavailable'}</dd>
        </div>
        <div>
          <dt>Project</dt>
          <dd>{project?.name ?? 'None'}</dd>
        </div>
        <div>
          <dt>Model</dt>
          <dd>{currentModel}</dd>
        </div>
        <div>
          <dt>Last activity</dt>
          <dd>{formatRelativeTime(currentActivityAt)}</dd>
        </div>
      </dl>

      <MetadataDisclosure title="Diagnostics">
        <dl className="control-detail-list">
          <CopyField label="Control session id" value={session?.id ?? sessionId} />
          <CopyField label="Worker thread id" value={session?.workerSessionId} />
          <CopyField label="Workspace path" value={workspace?.path ?? detail?.workspace.absPath} />
          <CopyField label="Workspace id" value={workspace?.id} />
          <CopyField label="Project id" value={project?.id} />
          <CopyField label="Sandbox id" value={sandbox?.id} />
          <CopyField label="Router URL" value={routeToken?.routerBaseUrl ?? sandbox?.routerBaseUrl} />
          <CopyField label="Image" value={sandbox?.image} />
          <CopyField label="Worker service" value={sandbox?.workerServiceName} />
          <CopyField label="Session updated" value={formatLongTimestamp(session?.updatedAt ?? null)} />
          <CopyField label="Route token expires" value={formatLongTimestamp(routeTokenExpiresAt)} />
        </dl>
      </MetadataDisclosure>
    </div>
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

  const handleSelectArtifact = useCallback((input: Omit<SelectedArtifact, 'kind'>) => {
    setSelectedInspectorItem({ kind: 'artifact', ...input });
  }, []);

  const handleSelectHistoryItemDetail = useCallback(
    (input: Omit<SelectedHistoryDetail, 'kind'>) => {
      setSelectedInspectorItem({ kind: 'historyDetail', ...input });
    },
    [],
  );

  const loadHistoryItemDetail = useCallback(
    async (itemId: string) => {
      if (!routeToken || !session?.workerSessionId) {
        throw new Error('Reconnect this session before loading item details.');
      }
      return fetchControlPlaneWorkerThreadHistoryItemDetail(
        routeToken,
        session.workerSessionId,
        itemId,
      );
    },
    [routeToken, session?.workerSessionId],
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
      onLoadHistoryItemDetail: loadHistoryItemDetail,
      onSelectArtifact: handleSelectArtifact,
      onSelectHistoryItemDetail: handleSelectHistoryItemDetail,
    }),
    [
      detail?.activityNotes,
      detail?.answeredRequestNotes,
      detail?.pendingSteers,
      handleSelectArtifact,
      handleSelectHistoryItemDetail,
      loadHistoryItemDetail,
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
    <span className="control-session-status-badge">
      {currentStatusLabel}
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
    <div className={`control-chat-workspace ${selectedInspectorItem ? 'artifact-open' : ''}`}>
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
      {selectedInspectorItem ? (
        <ThreadInspector
          selected={selectedInspectorItem}
          onClose={() => setSelectedInspectorItem(null)}
        />
      ) : null}
    </div>
  );
}
