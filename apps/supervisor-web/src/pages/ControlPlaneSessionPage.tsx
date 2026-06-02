import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import type {
  AgentProviderCapabilitiesDto,
  ThreadDetailDto,
  ThreadDto,
  ThreadStatusDto,
} from '../../../../packages/shared/src/index';
import { TERMINAL_PLUGIN_ID } from '../../../../packages/plugin-terminal/src/index';
import {
  ApiError,
  createControlPlaneRouteToken,
  fetchControlPlaneMe,
  fetchControlPlaneProjects,
  fetchControlPlaneSessions,
  fetchControlPlaneWorkerThread,
  fetchControlPlaneWorkspaces,
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
  formatLongTimestamp,
  threadStatusLabel,
} from '../components/threadPresentation';
import { ThreadComposer } from '../components/ThreadComposer';
import { ThreadTimeline } from '../components/ThreadTimeline';
import { ThreadWorkspaceLayout } from '../components/ThreadWorkspaceLayout';
import type { ThreadShellControlState } from '../components/ThreadShellPanel';
import { usePlugins } from '../plugins/usePlugins';
import {
  clearStoredControlPlaneAuth,
  readStoredControlPlaneAuth,
} from './controlPlaneAuthStorage';

const REMOTE_THREAD_REFRESH_INTERVAL_MS = 3000;

const controlPlaneCapabilities: AgentProviderCapabilitiesDto = {
  sessions: { list: false, read: true, resume: true, importLocal: false },
  turns: { start: true, streamInput: false, steer: false, interrupt: false, compact: false },
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

export function ControlPlaneSessionPage() {
  const { sessionId = '' } = useParams();
  const navigate = useNavigate();
  const plugins = usePlugins();
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
  const [pluginBusy, setPluginBusy] = useState<string | null>(null);
  const reconnectingRef = useRef(false);

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
          const token = await createControlPlaneRouteToken(auth, me.sandbox.id, {
            projectId: candidateProject.id,
            workspaceId: candidateWorkspace.id,
            sessionId: resumed.session.id,
            scopes: ['worker:read', 'worker:write', 'session:prompt', 'provider:turn:create'],
          });
          setProject(candidateProject);
          setWorkspace(candidateWorkspace);
          setWorkspaceSessions(nextSessions);
          setSession(resumed.session);
          setRouteToken(token);
          if (!resumed.session.workerSessionId) {
            setDetail(null);
            setError('Session resumed, but the worker did not return a thread id.');
            return null;
          }
          const thread = await fetchControlPlaneWorkerThread(token, resumed.session.workerSessionId);
          setDetail(thread);
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
  }, [auth, navigate, sessionId]);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  const refreshThread = useCallback(async (input: { silent?: boolean } = {}) => {
    if (!routeToken || !session?.workerSessionId) {
      return;
    }
    if (!input.silent) {
      setError(null);
    }
    try {
      setDetail(await fetchControlPlaneWorkerThread(routeToken, session.workerSessionId));
    } catch (caught) {
      if (
        caught instanceof ApiError &&
        (caught.statusCode === 404 || caught.statusCode === 409) &&
        !reconnectingRef.current
      ) {
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
  }, [loadSession, routeToken, session?.workerSessionId]);

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
      setMessage('Prompt sent. Waiting for worker updates...');
      await refreshThread();
      setScrollRequestKey((current) => current + 1);
      return true;
    } catch (caught) {
      if (
        caught instanceof ApiError &&
        (caught.statusCode === 404 || caught.statusCode === 409) &&
        !reconnectingRef.current
      ) {
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
          setDetail(thread);
          setDraft({ prompt: '', attachments: [] });
          setMessage('Prompt sent after reconnect. Waiting for worker updates...');
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

  const threadRunning = detail?.thread.status === 'running' || Boolean(detail?.thread.activeTurnId);
  const promptDisabledReason = !routeToken
    ? 'Waiting for a router token...'
    : !session?.workerSessionId
      ? 'Reconnect this session before sending a prompt.'
      : undefined;
  const terminalPluginEnabled = plugins.getThreadPanels().some((panel) => panel.kind === 'terminal');
  const sidebarThreads = workspace
    ? workspaceSessions.map((item) => sessionToThread(item, workspace, item.id === session?.id ? detail : null))
    : [];
  const workspaceLabels = workspace ? { [workspace.id]: workspace.name } : {};
  const activeThread = session && workspace ? sessionToThread(session, workspace, detail) : null;

  async function handleTogglePlugin(pluginId: string, enabled: boolean) {
    setPluginBusy(pluginId);
    setError(null);
    try {
      await plugins.setPluginEnabled(pluginId, enabled);
      await plugins.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to update plugin.');
    } finally {
      setPluginBusy(null);
    }
  }

  async function handleUnsupportedShellSubmit() {
    setError('Remote sandbox shell routing is not connected yet. Use chat prompts for this session.');
    return false;
  }

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
          Plugins
        </p>
        <div className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface)] px-3 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium text-[var(--theme-fg)]">Session Plugins</p>
              <p className="mt-1 text-xs leading-5 text-[var(--theme-fg-muted)]">
                Enable renderers and thread extensions loaded by the remote worker UI.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void plugins.refresh()}
              disabled={plugins.loading}
              className="inline-flex h-8 shrink-0 items-center rounded-full border border-[var(--theme-border)] bg-[var(--theme-surface-strong)] px-3 text-xs font-medium text-[var(--theme-fg)] transition hover:bg-[var(--theme-hover)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {plugins.loading ? 'Loading' : 'Refresh'}
            </button>
          </div>
          <div className="mt-3 grid gap-2">
            {plugins.plugins.map((plugin) => {
              const capabilitySummary = [
                ...plugin.capabilities.artifactTypes.map((type) => type.type),
                ...plugin.capabilities.threadPanels.map((panel) => panel.kind ?? panel.id),
              ].join(', ') || 'utility';
              const saving = pluginBusy === plugin.id;
              return (
                <div
                  key={plugin.id}
                  className="rounded-[1rem] border border-[var(--theme-border)] bg-[var(--theme-surface-strong)] px-3 py-2.5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[var(--theme-fg)]">
                        {plugin.name}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-[var(--theme-fg-muted)]">
                        {plugin.description}
                      </p>
                      {plugin.id === TERMINAL_PLUGIN_ID && plugin.enabled ? (
                        <p className="mt-1 text-xs leading-5 text-[var(--theme-fg-muted)]">
                          Terminal appears in the composer, but remote shell transport still needs a router adapter.
                        </p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      disabled={saving || plugins.loading}
                      onClick={() => void handleTogglePlugin(plugin.id, !plugin.enabled)}
                      className={`inline-flex h-8 shrink-0 items-center rounded-full border px-3 text-xs font-medium transition ${
                        plugin.enabled
                          ? 'ui-status-success'
                          : 'border-[var(--theme-border)] bg-[var(--theme-surface)] text-[var(--theme-fg)] hover:bg-[var(--theme-hover)]'
                      } disabled:cursor-not-allowed disabled:opacity-60`}
                    >
                      {saving ? 'Saving' : plugin.enabled ? 'Enabled' : 'Enable'}
                    </button>
                  </div>
                  <p className="mt-2 text-[10px] uppercase tracking-[0.16em] text-[var(--theme-fg-muted)]">
                    {capabilitySummary}
                  </p>
                  <p className="mt-1 text-[10px] uppercase tracking-[0.16em] text-[var(--theme-fg-muted)]">
                    {plugin.source === 'imported' ? 'Imported manifest' : 'Built-in module'} · {plugin.id} {plugin.version}
                  </p>
                </div>
              );
            })}
          </div>
          {plugins.plugins.length === 0 ? (
            <p className="mt-3 rounded-[1rem] border border-[var(--theme-border)] bg-[var(--theme-surface-strong)] px-3 py-3 text-xs text-[var(--theme-fg-muted)]">
              No plugins are registered.
            </p>
          ) : null}
        </div>
        {plugins.error ? (
          <p className="text-xs leading-5 text-rose-200">{plugins.error}</p>
        ) : null}
      </section>
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

  return (
    <ThreadWorkspaceLayout
      threads={activeThread && sidebarThreads.every((item) => item.id !== activeThread.id)
        ? [activeThread, ...sidebarThreads]
        : sidebarThreads}
      status={null}
      loading={loading}
      error={loading ? null : error}
      viewportConstrained
      currentThreadId={session?.id}
      currentThreadLabel={session?.title ?? detail?.thread.title}
      currentWorkspaceId={workspace?.id ?? null}
      currentWorkspaceLabel={workspace?.name ?? detail?.workspace.label}
      workspaceLabels={workspaceLabels}
      metaContent={metaContent}
      settingsContent={settingsContent}
      showMobileNewThreadShortcut={false}
      newThreadHref="/control-plane"
      newThreadLabel="Control Plane"
      getThreadHref={(threadId) => `/control-plane/sessions/${threadId}`}
    >
      <div className="thread-detail-surface relative flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-none border-y shadow-2xl shadow-stone-950/20 sm:flex-none sm:rounded-[2rem] sm:border">
        <div className="pointer-events-none absolute right-4 top-4 z-30 hidden lg:block">
          <div className="pointer-events-auto flex items-center gap-2">
            <span className="rounded-full border border-[var(--theme-border)] bg-[var(--theme-surface-strong)] px-3 py-2 text-xs font-medium text-[var(--theme-fg)] shadow-lg shadow-stone-950/20">
              {detail?.thread.status ?? session?.status ?? 'loading'}
            </span>
          </div>
        </div>
        {error && !loading ? (
          <div className="shrink-0 border-b border-rose-500/20 bg-rose-500/10 px-5 py-4 text-sm text-rose-100 sm:px-6">
            {error}
          </div>
        ) : null}
        {message && !error ? (
          <div className="shrink-0 border-b border-emerald-500/20 bg-emerald-500/10 px-5 py-3 text-sm text-emerald-100 sm:px-6">
            {message}
          </div>
        ) : null}

        {loading && !detail ? (
          <div className="flex flex-1 items-center justify-center px-6 py-12 text-center text-[var(--theme-fg-muted)]">
            Opening worker thread...
          </div>
        ) : detail ? (
          <>
            <div
              aria-hidden={activeView !== 'chat'}
              className={activeView === 'chat' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}
            >
              <ThreadTimeline
                threadId={detail.thread.id}
                turns={detail.turns}
                {...(detail.totalTurnCount === undefined
                  ? {}
                  : { totalTurnCount: detail.totalTurnCount })}
                pendingRequests={detail.pendingRequests}
                activeTurnId={detail.thread.activeTurnId}
                threadRunning={threadRunning}
                liveOutput=""
                scrollRequestKey={scrollRequestKey}
                className="thread-timeline-surface min-h-0 flex-1"
                onTailVisibilityChange={setFollowTail}
                answeredRequestNotes={detail.answeredRequestNotes ?? []}
                activityNotes={detail.activityNotes ?? []}
                pendingSteers={detail.pendingSteers ?? []}
              />
              <ThreadComposer
                activeView="chat"
                busy={sending}
                error={error}
                model={detail.thread.model}
                reasoningEffort={detail.thread.reasoningEffort}
                fastMode={detail.thread.fastMode ?? false}
                collaborationMode={detail.thread.collaborationMode}
                contextUsage={detail.thread.contextUsage}
                capabilities={controlPlaneCapabilities}
                toolboxItems={[]}
                followTail={followTail}
                threadConnected={detail.thread.isLoaded}
                shellAvailable={terminalPluginEnabled}
                disabled={Boolean(promptDisabledReason)}
                disabledPlaceholder={promptDisabledReason}
                draftPrompt={draft.prompt}
                draftAttachments={draft.attachments}
                onDraftChange={setDraft}
                onSubmit={handlePromptSubmit}
                canInterrupt={false}
                shellControlState={remoteShellUnavailableState}
                onToggleView={() => setActiveView('shell')}
                onToggleFollow={() => setScrollRequestKey((current) => current + 1)}
              />
            </div>
            <div
              aria-hidden={activeView !== 'shell'}
              className={activeView === 'shell' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}
            >
              <div className="flex min-h-0 flex-1 items-center justify-center p-4 sm:p-6">
                <div className="thread-empty-surface max-w-md rounded-[1.6rem] border px-6 py-8 text-center">
                  <p className="text-base font-medium text-[var(--theme-fg)]">
                    Remote shell transport unavailable
                  </p>
                  <p className="mt-3 text-sm leading-6 text-[var(--theme-fg-muted)]">
                    The Terminal plugin is enabled, but this control-plane route does not yet provide
                    the remote shell API adapter used by the main supervisor thread page.
                  </p>
                </div>
              </div>
              <ThreadComposer
                activeView={activeView}
                busy={false}
                error={remoteShellUnavailableState.error}
                capabilities={controlPlaneCapabilities}
                toolboxItems={[]}
                followTail={false}
                threadConnected={detail.thread.isLoaded}
                shellAvailable={terminalPluginEnabled}
                shellControlState={remoteShellUnavailableState}
                canInterrupt={false}
                onSubmit={handleUnsupportedShellSubmit}
                onToggleView={() => setActiveView('chat')}
              />
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center px-6 py-12 text-center text-[var(--theme-fg-muted)]">
            No worker thread is connected yet.
          </div>
        )}
      </div>
    </ThreadWorkspaceLayout>
  );
}
