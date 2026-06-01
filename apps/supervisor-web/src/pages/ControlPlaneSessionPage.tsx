import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import type {
  AgentProviderCapabilitiesDto,
  ThreadDetailDto,
} from '../../../../packages/shared/src/index';
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
import { formatLongTimestamp } from '../components/threadPresentation';
import { ThreadComposer } from '../components/ThreadComposer';
import { ThreadTimeline } from '../components/ThreadTimeline';
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

export function ControlPlaneSessionPage() {
  const { sessionId = '' } = useParams();
  const navigate = useNavigate();
  const auth = useMemo(storedAuth, []);
  const [sandbox, setSandbox] = useState<ControlPlaneSandbox | null>(null);
  const [project, setProject] = useState<ControlPlaneProject | null>(null);
  const [workspace, setWorkspace] = useState<ControlPlaneWorkspace | null>(null);
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
          const token = await createControlPlaneRouteToken(auth, me.sandbox.id, {
            projectId: candidateProject.id,
            workspaceId: candidateWorkspace.id,
            sessionId: resumed.session.id,
            scopes: ['worker:read', 'worker:write', 'session:prompt', 'provider:turn:create'],
          });
          setProject(candidateProject);
          setWorkspace(candidateWorkspace);
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

  return (
    <div className="control-session-page">
      <header className="control-session-header">
        <div>
          <Link to="/control-plane" className="control-back-link">Control plane</Link>
          <p className="control-kicker">Remote session</p>
          <h1>{session?.title ?? 'Opening session'}</h1>
          <p>
            {project?.name ?? 'Project'} / {workspace?.name ?? 'Workspace'} /{' '}
            {session?.provider ?? 'provider'}
          </p>
        </div>
        <div className="control-session-actions">
          <span className="control-session-status">{detail?.thread.status ?? session?.status ?? 'loading'}</span>
          <button type="button" onClick={() => void loadSession()} disabled={loading}>
            {loading ? 'Refreshing...' : 'Reconnect'}
          </button>
          <button type="button" onClick={() => void refreshThread()} disabled={!routeToken}>
            Refresh
          </button>
        </div>
      </header>

      {error ? <p className="control-alert danger">{error}</p> : null}
      {message ? <p className="control-alert success">{message}</p> : null}

      <section className="control-session-grid">
        <main className="control-chat-panel" aria-label="Control-plane chat">
          {loading && !detail ? (
            <p className="control-empty">Opening worker thread...</p>
          ) : detail ? (
            <>
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
                className="thread-timeline-surface control-session-timeline"
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
                followTail
                threadConnected={detail.thread.isLoaded}
                shellAvailable={false}
                disabled={Boolean(promptDisabledReason)}
                disabledPlaceholder={promptDisabledReason}
                draftPrompt={draft.prompt}
                draftAttachments={draft.attachments}
                onDraftChange={setDraft}
                onSubmit={handlePromptSubmit}
                canInterrupt={false}
                onToggleFollow={() => setScrollRequestKey((current) => current + 1)}
              />
            </>
          ) : (
            <p className="control-empty">No worker thread is connected yet.</p>
          )}
        </main>

        <aside className="control-session-side">
          <section className="control-panel">
            <div className="control-panel-heading">
              <h2>Session</h2>
            </div>
            <dl className="control-detail-list compact">
              <div><dt>Control session</dt><dd>{session?.id ?? sessionId}</dd></div>
              <div><dt>Worker thread</dt><dd>{session?.workerSessionId ?? 'not started'}</dd></div>
              <div><dt>Sandbox</dt><dd>{sandbox?.state ?? 'unknown'}</dd></div>
              <div><dt>Router</dt><dd>{routeToken?.routerBaseUrl ?? sandbox?.routerBaseUrl ?? 'unavailable'}</dd></div>
              <div><dt>Updated</dt><dd>{formatLongTimestamp(session?.updatedAt ?? null)}</dd></div>
            </dl>
          </section>
        </aside>
      </section>
    </div>
  );
}
