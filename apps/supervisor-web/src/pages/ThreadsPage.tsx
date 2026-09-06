import { ProductHeader } from '../components/ProductHeader';
import { Plus, MessageSquare, Pencil, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';

import {
  ThreadDto,
  truncateAutoThreadTitle,
  WorkspaceDto,
} from '@remote-codex/shared';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { RenameDialog } from '../components/RenameDialog';
import {
  connectSupervisorEvents,
  deleteThread,
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
  const selectedWorkspaceId = searchParams.get('workspaceId');
  const [threads, setThreads] = useState<ThreadDto[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingRecentThreadId, setEditingRecentThreadId] = useState<string | null>(null);
  const [recentDraftTitle, setRecentDraftTitle] = useState('');
  const [savingRecentThreadId, setSavingRecentThreadId] = useState<string | null>(null);
  const [deletingThread, setDeletingThread] = useState<ThreadDto | null>(null);
  const [deletingThreadBusy, setDeletingThreadBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [threadResponse, workspaceResponse] =
        await Promise.all([
          fetchThreads(),
          fetchWorkspaces(),
        ]);
      setThreads(threadResponse);
      setWorkspaces(workspaceResponse);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Unable to load threads.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

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
    <div className="product-page">
      <ProductHeader title={selectedWorkspace?.label ?? 'Workspace'} backHref={currentWorkspacesHref()} backLabel="Back to workspaces" actions={<Link to={newThreadHref} aria-label="New thread" title="New thread" className="product-icon-button"><Plus size={20} /></Link>} />
      {error && <p role="alert" className="host-error rounded-lg p-3">{error}</p>}
      {loading && <p className="host-muted py-4">Loading threads…</p>}
      <>
        <div className="threads-workspace-overview flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--theme-bg)]">
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
              <div className="recent-thread-list mt-4 grid gap-3">
                {visibleThreads.map(thread => <article key={thread.id} className="recent-thread-card group flex items-center gap-3 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-panel)] p-4">
                  <Link to={currentThreadHref(thread.id)} className="flex min-w-0 flex-1 items-center gap-3">
                    <span className="rounded-lg bg-[var(--theme-hover)] p-2.5 text-[var(--theme-fg-muted)]"><MessageSquare size={18} /></span>
                    <div className="min-w-0 flex-1"><h3 className="truncate text-sm font-medium">{thread.title}</h3><div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--theme-fg-muted)]"><time>{new Date(thread.updatedAt).toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</time>{thread.status !== 'idle' && <span>{thread.status}</span>}</div></div>
                  </Link>
                  <button type="button" className="product-icon-button" aria-label={`Rename thread ${thread.title}`} onClick={() => {setEditingRecentThreadId(thread.id);setRecentDraftTitle(thread.title);}}><Pencil size={16} /></button>
                  <button type="button" className="product-icon-button" aria-label={`Delete thread ${thread.title}`} onClick={() => setDeletingThread(thread)}><Trash2 size={16} /></button>
                </article>)}
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
    </div>
  );
}
