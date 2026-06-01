import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import type {
  ThreadDetailDto,
  ThreadHistoryItemDto,
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
} from '../lib/api';
import { formatLongTimestamp } from '../components/threadPresentation';
import {
  clearStoredControlPlaneAuth,
  readStoredControlPlaneAuth,
} from './controlPlaneAuthStorage';

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

function itemLabel(item: ThreadHistoryItemDto) {
  switch (item.kind) {
    case 'userMessage':
      return 'You';
    case 'agentMessage':
      return 'Codex';
    case 'commandExecution':
      return 'Command';
    case 'fileChange':
      return 'File change';
    case 'reasoning':
      return 'Reasoning';
    case 'plan':
      return 'Plan';
    case 'webSearch':
      return 'Web search';
    case 'fileRead':
      return 'File read';
    default:
      return item.kind;
  }
}

function itemText(item: ThreadHistoryItemDto) {
  return item.text || item.previewText || item.detailText || '';
}

function flattenThreadItems(detail: ThreadDetailDto | null) {
  return (
    detail?.turns.flatMap((turn) =>
      turn.items.map((item) => ({
        ...item,
        turnId: turn.id,
        turnStatus: turn.status,
        startedAt: turn.startedAt,
      })),
    ) ?? []
  );
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
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function loadSession() {
    if (!auth) {
      navigate('/control-plane/login', { replace: true });
      return;
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
        return;
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
            return;
          }
          setDetail(await fetchControlPlaneWorkerThread(token, resumed.session.workerSessionId));
          setMessage('Chat session connected.');
          return;
        }
      }
      setError('Session was not found in any project workspace.');
    } catch (caught) {
      if (caught instanceof ApiError && caught.payload.code === 'unauthorized') {
        clearStoredControlPlaneAuth();
        navigate('/control-plane/login', { replace: true });
        return;
      }
      setError(caught instanceof Error ? caught.message : 'Unable to open control-plane session.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadSession();
  }, [sessionId]);

  async function refreshThread() {
    if (!routeToken || !session?.workerSessionId) {
      return;
    }
    setError(null);
    try {
      setDetail(await fetchControlPlaneWorkerThread(routeToken, session.workerSessionId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to refresh worker thread.');
    }
  }

  async function handlePromptSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = prompt.trim();
    if (!trimmed || !routeToken || !session?.workerSessionId) {
      return;
    }
    setSending(true);
    setError(null);
    setMessage(null);
    try {
      await sendControlPlaneWorkerThreadPrompt(routeToken, session.workerSessionId, {
        prompt: trimmed,
      });
      setPrompt('');
      setMessage('Prompt sent.');
      await refreshThread();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to send prompt.');
    } finally {
      setSending(false);
    }
  }

  const items = flattenThreadItems(detail);
  const canSend = Boolean(routeToken && session?.workerSessionId && prompt.trim() && !sending);

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
          {loading && items.length === 0 ? (
            <p className="control-empty">Opening worker thread...</p>
          ) : items.length === 0 ? (
            <p className="control-empty">No transcript yet. Send the first prompt below.</p>
          ) : (
            <div className="control-chat-list">
              {items.map((item) => (
                <article key={`${item.turnId}:${item.id}`} className={`control-chat-item ${item.kind}`}>
                  <div>
                    <strong>{itemLabel(item)}</strong>
                    <span>{formatLongTimestamp(item.startedAt)}</span>
                  </div>
                  <pre>{itemText(item)}</pre>
                </article>
              ))}
            </div>
          )}

          <form onSubmit={handlePromptSubmit} className="control-chat-composer">
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.currentTarget.value)}
              placeholder="Send a prompt to this sandbox session..."
              rows={4}
            />
            <div>
              <span>
                {routeToken
                  ? `Direct router token expires ${formatLongTimestamp(routeToken.expiresAt)}`
                  : 'No route token'}
              </span>
              <button type="submit" disabled={!canSend}>
                {sending ? 'Sending...' : 'Send'}
              </button>
            </div>
          </form>
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
