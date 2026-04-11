import { KeyboardEvent, ReactNode, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import type {
  CodexStatusDto,
  ThreadDto,
} from '../../../../packages/shared/src/index';
import {
  formatShortTimestamp,
  threadStatusClassName,
  threadStatusLabel,
} from './threadPresentation';
import { RenameDialog } from './RenameDialog';

interface ThreadWorkspaceLayoutProps {
  threads: ThreadDto[];
  status: CodexStatusDto | null;
  loading?: boolean;
  error?: string | null;
  currentThreadId?: string | undefined;
  currentWorkspaceId?: string | null | undefined;
  currentWorkspaceLabel?: string | null | undefined;
  workspaceLabels?: Record<string, string>;
  metaContent?: ReactNode;
  onRenameThread?: ((threadId: string, title: string) => Promise<void> | void) | undefined;
  children: ReactNode;
}

interface SidebarSectionProps {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}

function SidebarSection({
  title,
  defaultOpen = false,
  children,
}: SidebarSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="border-t border-stone-800/80 pt-4 first:border-t-0 first:pt-0">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span className="text-xs uppercase tracking-[0.28em] text-stone-500">
          {title}
        </span>
        <span className="text-xs text-stone-500">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && <div className="mt-3">{children}</div>}
    </section>
  );
}

function supervisorSummary(status: CodexStatusDto | null) {
  if (!status) {
    return 'Checking supervisor';
  }

  switch (status.state) {
    case 'ready':
      return 'Supervisor ready';
    case 'starting':
      return 'Supervisor starting';
    case 'degraded':
      return 'Supervisor degraded';
    case 'stopped':
      return 'Supervisor stopped';
    case 'failed':
      return 'Supervisor failed';
  }
}

export function ThreadWorkspaceLayout({
  threads,
  status,
  loading = false,
  error,
  currentThreadId,
  currentWorkspaceId = null,
  currentWorkspaceLabel = null,
  workspaceLabels = {},
  metaContent,
  onRenameThread,
  children,
}: ThreadWorkspaceLayoutProps) {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [editingThreadId, setEditingThreadId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [renamingThreadId, setRenamingThreadId] = useState<string | null>(null);
  const navigate = useNavigate();

  const visibleThreads = useMemo(() => {
    const scopedThreads = currentWorkspaceId
      ? threads.filter((thread) => thread.workspaceId === currentWorkspaceId)
      : threads;

    return [...scopedThreads].sort((left, right) => {
      if (left.id === currentThreadId) {
        return -1;
      }

      if (right.id === currentThreadId) {
        return 1;
      }

      const leftTimestamp = Date.parse(
        left.lastTurnStartedAt ?? left.updatedAt,
      );
      const rightTimestamp = Date.parse(
        right.lastTurnStartedAt ?? right.updatedAt,
      );
      return rightTimestamp - leftTimestamp;
    });
  }, [currentThreadId, currentWorkspaceId, threads]);

  const threadScopeLabel =
    currentWorkspaceLabel ??
    (currentWorkspaceId ? 'Current workspace' : 'All threads');
  const newThreadHref = currentWorkspaceId
    ? `/threads/new?workspaceId=${encodeURIComponent(currentWorkspaceId)}`
    : '/threads/new';

  async function handleRenameThread(threadId: string) {
    if (!onRenameThread) {
      return;
    }

    const normalizedTitle = draftTitle.trim();
    if (!normalizedTitle) {
      return;
    }

    setRenamingThreadId(threadId);
    try {
      await onRenameThread(threadId, normalizedTitle);
      setEditingThreadId(null);
      setDraftTitle('');
    } finally {
      setRenamingThreadId(null);
    }
  }

  function beginRenameThread(thread: ThreadDto) {
    setEditingThreadId(thread.id);
    setDraftTitle(thread.title);
  }

  function cancelRenameThread() {
    setEditingThreadId(null);
    setDraftTitle('');
  }

  function openThread(threadId: string) {
    navigate(`/threads/${threadId}`);
    setMobileSidebarOpen(false);
  }

  function handleCardKeyDown(event: KeyboardEvent<HTMLDivElement>, threadId: string) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openThread(threadId);
    }
  }

  function renderSidebarContent() {
    return (
      <div className="space-y-4">
        <div className="rounded-[1.5rem] border border-stone-800 bg-stone-950/70 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs uppercase tracking-[0.28em] text-stone-500">
                Threads
              </p>
              <p className="mt-2 truncate text-base font-semibold text-stone-100" title={threadScopeLabel}>
                {threadScopeLabel}
              </p>
              <p className="mt-1 text-sm text-stone-400">
                {supervisorSummary(status)}
              </p>
            </div>
            <span className="rounded-full border border-stone-700 px-2.5 py-1 text-[11px] uppercase tracking-[0.2em] text-stone-300">
              {status?.state ?? '...'}
            </span>
          </div>
          <div className="mt-4 flex items-center justify-between gap-3 text-xs text-stone-500">
            <span>
              {visibleThreads.length} thread
              {visibleThreads.length === 1 ? '' : 's'}
            </span>
            <Link
              to={newThreadHref}
              onClick={() => setMobileSidebarOpen(false)}
              className="rounded-full bg-amber-300 px-3 py-2 font-medium text-stone-950 transition hover:bg-amber-200"
            >
              New Thread
            </Link>
          </div>
        </div>

        <section>
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-xs uppercase tracking-[0.28em] text-stone-500">
              Thread List
            </p>
            {loading && (
              <span className="text-xs text-stone-500">Refreshing...</span>
            )}
          </div>

          {error && (
            <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-3 py-3 text-sm text-rose-100">
              {error}
            </div>
          )}

          {!error && visibleThreads.length === 0 && !loading && (
            <div className="rounded-2xl border border-dashed border-stone-700 bg-stone-950/50 px-4 py-6 text-sm text-stone-500">
              No threads available in this view.
            </div>
          )}

          {visibleThreads.length > 0 && (
            <div className="space-y-2">
              {visibleThreads.map((thread) => {
                const workspaceLabel = workspaceLabels[thread.workspaceId];
                const isCurrentThread = currentThreadId === thread.id;

                return (
                  <div
                    key={thread.id}
                    role="link"
                    tabIndex={0}
                    onClick={() => openThread(thread.id)}
                    onKeyDown={(event) => handleCardKeyDown(event, thread.id)}
                    className={`block rounded-[1.35rem] border px-4 py-3 transition ${
                      isCurrentThread
                        ? 'border-amber-300/40 bg-amber-300/10 shadow-lg shadow-stone-950/20'
                        : 'border-stone-800 bg-stone-900/75 hover:border-stone-700 hover:bg-stone-900'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1">
                          <p
                            className="min-w-0 w-fit max-w-[calc(100%-1.1rem)] truncate text-sm font-medium text-stone-100"
                            title={thread.title}
                          >
                            {thread.title}
                          </p>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              beginRenameThread(thread);
                            }}
                            aria-label={`Rename thread ${thread.title}`}
                            className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-stone-500 transition hover:text-stone-100"
                          >
                            <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3 w-3 fill-current">
                              <path d="m11.9 1.6 2.5 2.5-8.2 8.2-3.3.7.7-3.3 8.3-8.1Zm-7.3 8.7-.3 1.3 1.3-.3 6.9-6.9-1-1-6.9 6.9Zm8.8-7.8-1-1-1 1 1 1 1-1Z" />
                            </svg>
                          </button>
                        </div>
                        {workspaceLabel && !currentWorkspaceId && (
                          <p className="mt-1 truncate text-xs text-stone-500">
                            {workspaceLabel}
                          </p>
                        )}
                      </div>
                      <span
                        className={`rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.2em] ${threadStatusClassName(thread.status)}`}
                      >
                        {threadStatusLabel(thread.status)}
                      </span>
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-3 text-xs text-stone-500">
                      <time
                        dateTime={thread.lastTurnStartedAt ?? thread.updatedAt}
                      >
                        {formatShortTimestamp(
                          thread.lastTurnStartedAt ?? thread.updatedAt,
                        )}
                      </time>
                      <span>{thread.model ?? 'No model'}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <SidebarSection title="Thread Meta">
          {metaContent ?? (
            <p className="text-sm text-stone-500">
              Select a thread to inspect metadata.
            </p>
          )}
        </SidebarSection>

        <SidebarSection title="Settings">
          <p className="text-sm leading-6 text-stone-400">
            Settings will land in a later phase. This entry is kept here so the
            sidebar structure matches the long-term layout.
          </p>
        </SidebarSection>
      </div>
    );
  }

  return (
    <>
      <div className="flex h-[calc(100dvh-2rem)] max-h-[calc(100dvh-2rem)] min-h-0 flex-col gap-4 overflow-hidden lg:grid lg:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[340px_minmax(0,1fr)]">
        <div className="lg:hidden">
          <button
            type="button"
            onClick={() => setMobileSidebarOpen((current) => !current)}
            aria-expanded={mobileSidebarOpen}
            className="flex w-full items-center justify-between rounded-[1.4rem] border border-stone-800 bg-stone-900/80 px-4 py-3 text-left"
          >
            <div>
              <p className="text-xs uppercase tracking-[0.28em] text-stone-500">
                Navigation
              </p>
              <p className="mt-1 text-sm font-medium text-stone-100">
                {threadScopeLabel}
              </p>
            </div>
            <span className="text-sm text-stone-400">
              {mobileSidebarOpen ? 'Close' : 'Open'}
            </span>
          </button>

          {mobileSidebarOpen && (
            <aside className="mt-3 max-h-[40dvh] overflow-y-auto rounded-[1.8rem] border border-stone-800 bg-stone-900/95 p-4 shadow-2xl shadow-stone-950/20">
              {renderSidebarContent()}
            </aside>
          )}
        </div>

        <aside className="hidden min-h-0 lg:block">
          <div className="sticky top-4 max-h-[calc(100dvh-4rem)] overflow-y-auto rounded-[2rem] border border-stone-800 bg-stone-900/85 p-4 shadow-2xl shadow-stone-950/15 backdrop-blur">
            {renderSidebarContent()}
          </div>
        </aside>

        <section className="min-h-0 min-w-0 overflow-hidden">{children}</section>
      </div>

      <RenameDialog
        open={editingThreadId !== null}
        title="Rename Thread"
        label="Thread Title"
        value={draftTitle}
        busy={renamingThreadId !== null}
        onChange={setDraftTitle}
        onCancel={cancelRenameThread}
        onSubmit={() => editingThreadId ? handleRenameThread(editingThreadId) : undefined}
      />
    </>
  );
}
