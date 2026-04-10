import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSearchParams } from 'react-router-dom';

import {
  CodexStatusDto,
  ThreadDto,
  WorkspaceDto,
} from '../../../../packages/shared/src/index';
import { ThreadWorkspaceLayout } from '../components/ThreadWorkspaceLayout';
import {
  threadStatusClassName,
  threadStatusLabel,
} from '../components/threadPresentation';
import {
  connectSupervisorEvents,
  fetchCodexStatus,
  fetchThreads,
  fetchWorkspaces,
  updateThread,
} from '../lib/api';

export function ThreadsPage() {
  const [searchParams] = useSearchParams();
  const [threads, setThreads] = useState<ThreadDto[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceDto[]>([]);
  const [status, setStatus] = useState<CodexStatusDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);

    try {
      const [statusResponse, threadResponse, workspaceResponse] =
        await Promise.all([
          fetchCodexStatus(),
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
  }

  useEffect(() => {
    void load();

    const socket = connectSupervisorEvents((event) => {
      setThreads((current) =>
        current.map((thread) =>
          thread.id === event.threadId
            ? {
                ...thread,
                status:
                  typeof event.payload.status === 'string'
                    ? (event.payload.status as ThreadDto['status'])
                    : thread.status,
                lastError:
                  typeof event.payload.error === 'string'
                    ? event.payload.error
                    : thread.lastError,
                title:
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
  }, []);

  const workspaceLabels = Object.fromEntries(
    workspaces.map((workspace) => [workspace.id, workspace.label]),
  );
  const selectedWorkspaceId = searchParams.get('workspaceId');
  const selectedWorkspace = workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? null;
  const visibleThreads = useMemo(
    () =>
      selectedWorkspaceId
        ? threads.filter((thread) => thread.workspaceId === selectedWorkspaceId)
        : threads,
    [selectedWorkspaceId, threads],
  );
  const runningThreads = visibleThreads.filter(
    (thread) => thread.status === 'running',
  ).length;
  const newThreadHref = selectedWorkspaceId
    ? `/threads/new?workspaceId=${encodeURIComponent(selectedWorkspaceId)}`
    : '/threads/new';

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

  return (
    <ThreadWorkspaceLayout
      threads={threads}
      workspaceLabels={workspaceLabels}
      status={status}
      loading={loading}
      error={error}
      currentWorkspaceId={selectedWorkspaceId}
      currentWorkspaceLabel={selectedWorkspace?.label ?? null}
      onRenameThread={handleRenameThread}
    >
      <div className="overflow-hidden rounded-[2rem] border border-stone-800 bg-stone-900/85 shadow-2xl shadow-stone-950/20">
        <div className="border-b border-stone-800 px-5 py-5 sm:px-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-xs uppercase tracking-[0.28em] text-stone-500">
                Threads
              </p>
              <h2
                className="mt-2 truncate text-3xl font-semibold text-stone-100"
                title={selectedWorkspace ? `${selectedWorkspace.label} threads` : 'Codex control plane'}
              >
                {selectedWorkspace ? `${selectedWorkspace.label} threads` : 'Codex control plane'}
              </h2>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-stone-400">
                {selectedWorkspace
                  ? 'This view is scoped to a single workspace. Use the left rail to open or rename a thread, or create a new one for this workspace.'
                  : 'Select a thread from the left rail to continue chatting, or create a new thread for another workspace. Prompt entry and history now live in a single conversation view.'}
              </p>
            </div>
            <Link
              to={newThreadHref}
              className="rounded-full bg-amber-300 px-5 py-3 font-medium text-stone-950 transition hover:bg-amber-200"
            >
              New Thread
            </Link>
          </div>
        </div>

        <div className="grid gap-4 px-5 py-5 sm:px-6 xl:grid-cols-3">
          <article className="rounded-[1.6rem] border border-stone-800 bg-stone-950/70 p-4">
            <p className="text-xs uppercase tracking-[0.28em] text-stone-500">
              Supervisor
            </p>
            <div className="mt-3 flex items-start justify-between gap-3">
              <div>
                <p className="text-lg font-semibold text-stone-100">
                  {status?.state ?? 'Loading'}
                </p>
                <p className="mt-1 text-sm text-stone-400">
                  {status?.lastError ?? 'codex app-server over stdio'}
                </p>
              </div>
              {status && (
                <span className="rounded-full border border-stone-700 px-2.5 py-1 text-[11px] uppercase tracking-[0.2em] text-stone-300">
                  {status.transport}
                </span>
              )}
            </div>
          </article>

          <article className="rounded-[1.6rem] border border-stone-800 bg-stone-950/70 p-4">
            <p className="text-xs uppercase tracking-[0.28em] text-stone-500">
              Thread Count
            </p>
            <p className="mt-3 text-3xl font-semibold text-stone-100">
              {visibleThreads.length}
            </p>
            <p className="mt-2 text-sm text-stone-400">
              {runningThreads} active, {visibleThreads.length - runningThreads} waiting
              or finished.
            </p>
          </article>

          <article className="rounded-[1.6rem] border border-stone-800 bg-stone-950/70 p-4">
            <p className="text-xs uppercase tracking-[0.28em] text-stone-500">
              Next Step
            </p>
            <p className="mt-3 text-lg font-semibold text-stone-100">
              {visibleThreads.length > 0
                ? 'Open a thread from the sidebar.'
                : 'Create the first thread.'}
            </p>
            <p className="mt-2 text-sm text-stone-400">
              The right side becomes a full chat workspace once a thread is
              selected.
            </p>
          </article>
        </div>

        {!loading && !error && visibleThreads.length > 0 && (
          <div className="border-t border-stone-800 px-5 py-5 sm:px-6">
            <p className="text-xs uppercase tracking-[0.28em] text-stone-500">
              Recent Threads
            </p>
            <div className="mt-4 space-y-2">
              {visibleThreads.slice(0, 5).map((thread) => (
                <Link
                  key={thread.id}
                  to={`/threads/${thread.id}`}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-[1.3rem] border border-stone-800 bg-stone-950/60 px-4 py-3 transition hover:border-stone-700 hover:bg-stone-950"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-stone-100">
                      {thread.title}
                    </p>
                    <p className="mt-1 text-sm text-stone-500">
                      {workspaceLabels[thread.workspaceId] ??
                        'Unknown workspace'}{' '}
                      · {thread.model ?? 'No model'}
                    </p>
                  </div>
                  <span
                    className={`rounded-full border px-2.5 py-1 text-[11px] uppercase tracking-[0.2em] ${threadStatusClassName(thread.status)}`}
                  >
                    {threadStatusLabel(thread.status)}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </ThreadWorkspaceLayout>
  );
}
