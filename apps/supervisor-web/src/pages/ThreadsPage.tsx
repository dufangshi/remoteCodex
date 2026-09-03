import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';

import {
  AgentRuntimeStatusDto,
  defaultAgentBackendId,
  ThreadDto,
  truncateAutoThreadTitle,
  WorkspaceDto,
} from '@remote-codex/shared';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useAppShellNav } from '../components/AppShellNavContext';
import {
  ThreadCards,
  ThreadWorkspaceLayout,
} from '../components/ThreadWorkspaceLayout';
import { RenameDialog } from '../components/RenameDialog';
import {
  connectSupervisorEvents,
  deleteThread,
  fetchAgentBackends,
  fetchAgentBackendStatus,
  fetchThreads,
  fetchWorkspaces,
  updateThread,
} from '../lib/api';
import {
  currentNewThreadHref,
  currentThreadHref,
  currentWorkspacesHref,
} from '../lib/relayRoutes';
import { useThreadListPolling } from './useThreadListPolling';

export function ThreadsPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const shellNav = useAppShellNav();
  const selectedWorkspaceId = searchParams.get('workspaceId');
  const [threads, setThreads] = useState<ThreadDto[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceDto[]>([]);
  const [status, setStatus] = useState<AgentRuntimeStatusDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingRecentThreadId, setEditingRecentThreadId] = useState<string | null>(null);
  const [recentDraftTitle, setRecentDraftTitle] = useState('');
  const [savingRecentThreadId, setSavingRecentThreadId] = useState<string | null>(null);
  const [deletingThread, setDeletingThread] = useState<ThreadDto | null>(null);
  const [deletingThreadBusy, setDeletingThreadBusy] = useState(false);
  const defaultBackend = shellNav?.defaultBackend ?? defaultAgentBackendId;

  const fetchRuntimeStatus = useCallback(async () => {
    try {
      return (await fetchAgentBackendStatus(defaultBackend)).status;
    } catch (error) {
      const backends = await fetchAgentBackends();
      const fallback = backends.find(
        (backend) =>
          backend.enabled &&
          backend.capabilities.sessions.resume &&
          backend.capabilities.turns.start,
      );
      if (fallback) {
        return fallback.status;
      }
      throw error;
    }
  }, [defaultBackend]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [statusResponse, threadResponse, workspaceResponse] =
        await Promise.all([
          fetchRuntimeStatus(),
          fetchThreads(),
          fetchWorkspaces(),
        ]);
      setStatus(statusResponse);
      setThreads(threadResponse);
      setWorkspaces(workspaceResponse);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Unable to load threads.',
      );
    } finally {
      setLoading(false);
    }
  }, [fetchRuntimeStatus]);

  useEffect(() => {
    if (selectedWorkspaceId === null) {
      return;
    }

    void load();

    const socket = connectSupervisorEvents((event) => {
      setThreads((current) =>
        current.map((thread) =>
          thread.id === event.threadId
            ? {
                ...thread,
                status:
                  event.type === 'thread.updated' &&
                  typeof event.payload.status === 'string'
                    ? (event.payload.status as ThreadDto['status'])
                    : thread.status,
                lastError:
                  (event.type === 'thread.turn.failed' ||
                    event.type === 'thread.turn.completed') &&
                  typeof event.payload.error === 'string'
                    ? event.payload.error
                    : thread.lastError,
                title:
                  event.type === 'thread.updated' &&
                  typeof event.payload.title === 'string'
                    ? event.payload.title
                    : thread.title,
              }
            : thread,
        ),
      );
    });

    return () => {
      socket.close();
    };
  }, [load, selectedWorkspaceId]);

  const workspaceLabels = Object.fromEntries(
    workspaces.map((workspace) => [workspace.id, workspace.label]),
  );
  const selectedWorkspace = workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? null;
  const visibleThreads = useMemo(
    () =>
      selectedWorkspaceId
        ? threads.filter((thread) => thread.workspaceId === selectedWorkspaceId)
        : [],
    [selectedWorkspaceId, threads],
  );
  const runningThreads = visibleThreads.filter(
    (thread) => thread.status === 'running',
  ).length;
  const newThreadHref = selectedWorkspaceId
    ? currentNewThreadHref(selectedWorkspaceId)
    : currentNewThreadHref();
  useThreadListPolling({
    enabled: selectedWorkspaceId !== null,
    setThreads,
  });

  if (selectedWorkspaceId === null) {
    return <Navigate to={currentWorkspacesHref()} replace />;
  }

  const supervisorDotClassName =
    status?.state === 'ready'
      ? 'bg-teal-300 shadow-[0_0_0_3px_rgba(94,234,212,0.14)]'
      : status?.state === 'starting'
        ? 'bg-[var(--status-warning-fg)] shadow-[0_0_0_3px_var(--status-warning-bg)]'
        : status?.state === 'degraded' || status?.state === 'failed'
          ? 'bg-rose-400 shadow-[0_0_0_3px_rgba(251,113,133,0.14)]'
          : 'bg-slate-500 shadow-[0_0_0_3px_rgba(100,116,139,0.14)]';

  async function handleRenameThread(threadId: string, title: string) {
    try {
      const updated = await updateThread(threadId, { title });
      setThreads((current) =>
        current.map((thread) =>
          thread.id === updated.id
            ? { ...thread, title: updated.title, updatedAt: updated.updatedAt }
            : thread,
        ),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to rename thread.');
      throw caught;
    }
  }

  async function handleSaveRecentThreadRename() {
    if (!editingRecentThreadId) {
      return;
    }

    const normalizedTitle = recentDraftTitle.trim();
    if (!normalizedTitle) {
      return;
    }

    setSavingRecentThreadId(editingRecentThreadId);
    try {
      await handleRenameThread(editingRecentThreadId, normalizedTitle);
      setEditingRecentThreadId(null);
      setRecentDraftTitle('');
    } finally {
      setSavingRecentThreadId(null);
    }
  }

  async function handleDeleteThread() {
    if (!deletingThread) {
      return;
    }

    setDeletingThreadBusy(true);
    try {
      await deleteThread(deletingThread.id);
      setThreads((current) =>
        current.filter((thread) => thread.id !== deletingThread.id),
      );
      setDeletingThread(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to delete thread.');
    } finally {
      setDeletingThreadBusy(false);
    }
  }

  return (
    <ThreadWorkspaceLayout
      threads={threads}
      workspaceLabels={workspaceLabels}
      status={status}
      loading={loading}
      error={error}
      viewportConstrained={selectedWorkspaceId !== null}
      showMobileAppMenu
      showMobileThreadNavToggle={false}
      showMobileNewThreadShortcut={false}
      currentWorkspaceId={selectedWorkspaceId}
      currentWorkspaceLabel={selectedWorkspace?.label ?? null}
      onRenameThread={handleRenameThread}
      onDeleteThread={setDeletingThread}
    >
      <>
        <div className="threads-workspace-overview flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--theme-bg)]">
          <div className="border-b border-[var(--theme-border)] px-4 py-3.5 sm:px-6">
            <div className="flex items-center justify-between gap-3">
              <h2
                className="host-page-title min-w-0 truncate text-base font-semibold sm:text-lg"
                title={selectedWorkspace ? `${selectedWorkspace.label} threads` : 'All threads'}
              >
                {selectedWorkspace ? selectedWorkspace.label : 'All Threads'}
              </h2>
              <Link
                to={newThreadHref}
                className="ui-action-primary inline-flex h-10 shrink-0 items-center rounded-md px-3.5 text-sm font-medium transition"
              >
                New Thread
              </Link>
            </div>
          </div>

          <div className="flex min-h-12 items-center gap-3 border-b border-[var(--theme-border)] px-4 py-2.5 sm:px-6">
              <span
                aria-hidden="true"
                className={`h-2 w-2 shrink-0 rounded-full ${supervisorDotClassName}`}
              />
              <span className="shrink-0 text-sm font-medium text-[var(--theme-fg)]">Supervisor</span>
              <span className="host-muted min-w-0 truncate text-sm">
                {status?.lastError ?? (status?.state === 'ready' ? 'Ready' : status?.state ?? 'Checking')}
              </span>
          </div>

          {!loading && !error && visibleThreads.length > 0 && (
            <section className="flex min-h-0 flex-1 flex-col px-4 py-4 sm:px-6 sm:py-5">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-[var(--theme-fg)]">
                  Recent Threads
                </h3>
                <span className="host-muted text-xs tabular-nums">
                  {visibleThreads.length} total
                </span>
                {runningThreads > 0 && (
                  <span className="host-muted text-xs">
                    {runningThreads} running
                  </span>
                )}
              </div>
              <div className="threads-product-list mt-3 min-h-0 flex-1 overflow-hidden rounded-md border border-[var(--theme-border)]">
                <ThreadCards
                  threads={visibleThreads}
                  currentWorkspaceId={selectedWorkspaceId}
                  workspaceLabels={workspaceLabels}
                  onOpenThread={(threadId) => navigate(currentThreadHref(threadId))}
                  onBeginRenameThread={(thread) => {
                    setEditingRecentThreadId(thread.id);
                    setRecentDraftTitle(thread.title);
                  }}
                  onDeleteThread={(thread) => setDeletingThread(thread)}
                  scrollable
                  maxHeightClassName="max-h-full"
                  showDeleteButton
                  showSessionCopyButton
                />
              </div>
            </section>
          )}

          {!loading && !error && visibleThreads.length === 0 && (
            <div className="host-muted px-4 py-6 text-sm sm:px-6">
              No threads available in this workspace.
            </div>
          )}
        </div>

        <RenameDialog
          open={editingRecentThreadId !== null}
          title="Rename Thread"
          label="Thread Title"
          value={recentDraftTitle}
          busy={savingRecentThreadId !== null}
          onChange={setRecentDraftTitle}
          onCancel={() => {
            setEditingRecentThreadId(null);
            setRecentDraftTitle('');
          }}
          onSubmit={() => void handleSaveRecentThreadRename()}
        />
        <ConfirmDialog
          open={deletingThread !== null}
          title="Delete Thread"
          description={
            deletingThread
              ? `Delete ${truncateAutoThreadTitle(deletingThread.title)} from supervisor. The backend session id will no longer appear in this workspace list.`
              : ''
          }
          confirmLabel="Delete Thread"
          busy={deletingThreadBusy}
          onCancel={() => {
            if (!deletingThreadBusy) {
              setDeletingThread(null);
            }
          }}
          onConfirm={() => void handleDeleteThread()}
        />
      </>
    </ThreadWorkspaceLayout>
  );
}
