import { ReactNode, useMemo, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';

import type {
  CodexStatusDto,
  ThreadDto,
} from '../../../../packages/shared/src/index';
import {
  formatShortTimestamp,
  threadStatusClassName,
  threadStatusLabel,
} from './threadPresentation';

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
  children,
}: ThreadWorkspaceLayoutProps) {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

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

  function renderSidebarContent() {
    return (
      <div className="space-y-4">
        <div className="rounded-[1.5rem] border border-stone-800 bg-stone-950/70 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.28em] text-stone-500">
                Threads
              </p>
              <p className="mt-2 text-base font-semibold text-stone-100">
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
              to="/threads/new"
              onClick={() => setMobileSidebarOpen(false)}
              className="rounded-full bg-amber-200 px-3 py-2 font-medium text-stone-950 transition hover:bg-amber-100"
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

                return (
                  <NavLink
                    key={thread.id}
                    to={`/threads/${thread.id}`}
                    onClick={() => setMobileSidebarOpen(false)}
                    className={({ isActive }) =>
                      `block rounded-[1.35rem] border px-4 py-3 transition ${
                        isActive
                          ? 'border-amber-300/40 bg-amber-300/10 shadow-lg shadow-stone-950/20'
                          : 'border-stone-800 bg-stone-900/75 hover:border-stone-700 hover:bg-stone-900'
                      }`
                    }
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-stone-100">
                          {thread.title}
                        </p>
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
                  </NavLink>
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
    <div className="flex min-h-[calc(100dvh-2rem)] flex-col gap-4 lg:grid lg:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[340px_minmax(0,1fr)]">
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
          <aside className="mt-3 rounded-[1.8rem] border border-stone-800 bg-stone-900/95 p-4 shadow-2xl shadow-stone-950/20">
            {renderSidebarContent()}
          </aside>
        )}
      </div>

      <aside className="hidden lg:block">
        <div className="sticky top-4 rounded-[2rem] border border-stone-800 bg-stone-900/85 p-4 shadow-2xl shadow-stone-950/15 backdrop-blur">
          {renderSidebarContent()}
        </div>
      </aside>

      <section className="min-w-0">{children}</section>
    </div>
  );
}
