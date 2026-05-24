import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';

import {
  AgentRuntimeStatusDto,
  defaultAgentBackendId,
  ThreadDto,
  truncateAutoThreadTitle,
  WorkspaceDto,
} from '../../../../packages/shared/src/index';
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
  fetchAgentBackendStatus,
  fetchThreads,
  fetchWorkspaces,
  updateThread,
} from '../lib/api';

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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [statusResponse, threadResponse, workspaceResponse] =
        await Promise.all([
          fetchAgentBackendStatus(defaultBackend).then(
            (backend) => backend.status,
          ),
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
  }, [defaultBackend]);

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
    ? `/threads/new?workspaceId=${encodeURIComponent(selectedWorkspaceId)}`
    : '/threads/new';

  if (selectedWorkspaceId === null) {
    return <Navigate to="/workspaces" replace />;
  }

  function supervisorDotClassName() {
    switch (status?.state) {
      case 'ready':
        return 'bg-emerald-400 shadow-[0_0_0_3px_rgba(52,211,153,0.14)]';
      case 'starting':
        return 'bg-amber-300 shadow-[0_0_0_3px_rgba(252,211,77,0.12)]';
      case 'degraded':
      case 'failed':
        return 'bg-rose-400 shadow-[0_0_0_3px_rgba(251,113,133,0.14)]';
      default:
        return 'bg-stone-500 shadow-[0_0_0_3px_rgba(120,113,108,0.14)]';
    }
  }

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
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[2rem] border border-stone-800 bg-stone-900/85 shadow-2xl shadow-stone-950/20">
          <div className="border-b border-stone-800 px-4 py-3 sm:px-6 sm:py-4">
            <div className="flex items-center justify-between gap-3">
              <h2
                className="min-w-0 truncate text-base font-semibold text-stone-100 sm:text-lg"
                title={selectedWorkspace ? `${selectedWorkspace.label} threads` : 'All threads'}
              >
                {selectedWorkspace ? selectedWorkspace.label : 'All Threads'}
              </h2>
              <Link
                to={newThreadHref}
                className="inline-flex h-9 shrink-0 items-center rounded-full bg-amber-300 px-3.5 text-xs font-medium uppercase tracking-[0.18em] text-stone-950 transition hover:bg-amber-200"
              >
                New Thread
              </Link>
            </div>
          </div>

          <div className="px-4 py-3 sm:px-6 sm:py-4">
            <article className="inline-flex min-w-[12rem] max-w-full items-center gap-3 rounded-[1.25rem] border border-stone-800 bg-stone-950/70 px-3.5 py-2.5">
              <span
                aria-hidden="true"
                className={`h-2.5 w-2.5 shrink-0 rounded-full ${supervisorDotClassName()}`}
              />
              <div className="min-w-0">
                <p className="truncate text-[11px] uppercase tracking-[0.22em] text-stone-500">
                  Supervisor
                </p>
                <p className="truncate text-sm text-stone-200">
                  {status?.lastError ?? (status?.state === 'ready' ? 'Ready' : status?.state ?? 'Checking')}
                </p>
              </div>
            </article>
          </div>

          {!loading && !error && visibleThreads.length > 0 && (
            <div className="flex min-h-0 flex-1 flex-col border-t border-stone-800 px-4 py-4 sm:px-6 sm:py-5">
              <div className="flex items-center gap-2">
                <p className="text-xs uppercase tracking-[0.28em] text-stone-500">
                  Recent Threads
                </p>
                <span className="rounded-full border border-amber-300/30 bg-amber-300/10 px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.18em] text-amber-200">
                  {visibleThreads.length} total
                </span>
                {runningThreads > 0 && (
                  <span className="text-xs text-stone-500">
                    · {runningThreads} running
                  </span>
                )}
              </div>
              <div className="mt-3 min-h-0 flex-1">
                <ThreadCards
                  threads={visibleThreads}
                  currentWorkspaceId={selectedWorkspaceId}
                  workspaceLabels={workspaceLabels}
                  onOpenThread={(threadId) => navigate(`/threads/${threadId}`)}
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
            </div>
          )}

          {!loading && !error && visibleThreads.length === 0 && (
            <div className="border-t border-stone-800 px-4 py-6 text-sm text-stone-500 sm:px-6">
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
