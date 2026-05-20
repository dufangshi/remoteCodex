import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import type {
  AgentRuntimeStatusDto,
  ThreadDto,
} from '../../../../packages/shared/src/index';
import { useAppShellNav } from './AppShellNavContext';
import {
  AppShellMenuButton,
  AppShellNavigationMenu,
} from './AppShellNavigation';
import {
  formatShortTimestamp,
  threadStatusClassName,
  threadStatusLabel,
} from './threadPresentation';
import { RenameDialog } from './RenameDialog';

interface ThreadWorkspaceLayoutProps {
  threads: ThreadDto[];
  status: AgentRuntimeStatusDto | null;
  loading?: boolean;
  error?: string | null;
  viewportConstrained?: boolean;
  showMobileAppMenu?: boolean;
  showMobileThreadNavToggle?: boolean;
  showMobileNewThreadShortcut?: boolean;
  mobileHeaderAction?: ReactNode;
  currentThreadId?: string | undefined;
  currentThreadLabel?: string | null | undefined;
  currentWorkspaceId?: string | null | undefined;
  currentWorkspaceLabel?: string | null | undefined;
  workspaceLabels?: Record<string, string>;
  metaContent?: ReactNode;
  settingsContent?: ReactNode;
  onRenameThread?: ((threadId: string, title: string) => Promise<void> | void) | undefined;
  children: ReactNode;
}

interface SidebarSectionProps {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}

interface ThreadCardsProps {
  threads: ThreadDto[];
  currentThreadId?: string | undefined;
  currentWorkspaceId?: string | null | undefined;
  workspaceLabels?: Record<string, string>;
  onOpenThread: (threadId: string) => void;
  onBeginRenameThread: (thread: ThreadDto) => void;
  onDeleteThread?: (thread: ThreadDto) => void;
  scrollable?: boolean;
  maxHeightClassName?: string;
  showDeleteButton?: boolean;
  showSessionCopyButton?: boolean;
}

function NewThreadIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5 fill-none stroke-current"
      strokeWidth="1.6"
      strokeLinecap="round"
    >
      <path d="M8 3.25v9.5M3.25 8h9.5" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5 fill-current"
    >
      <path d="M5.75 1.75c-.97 0-1.75.78-1.75 1.75v.25H3.5c-.97 0-1.75.78-1.75 1.75v6c0 .97.78 1.75 1.75 1.75h4.75c.97 0 1.75-.78 1.75-1.75v-.25h.5c.97 0 1.75-.78 1.75-1.75v-6c0-.97-.78-1.75-1.75-1.75h-4.75Zm-.5 2V3.5c0-.28.22-.5.5-.5h4.75c.28 0 .5.22.5.5v6a.5.5 0 0 1-.5.5H10v-4.5c0-.97-.78-1.75-1.75-1.75h-3Zm-1.75 1.25h4.75c.28 0 .5.22.5.5v6a.5.5 0 0 1-.5.5H3.5a.5.5 0 0 1-.5-.5v-6c0-.28.22-.5.5-.5Z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-3 w-3 fill-current"
    >
      <path d="M6.1 1.75h3.8c.75 0 1.4.52 1.57 1.25h2.03c.35 0 .63.28.63.63 0 .34-.28.62-.63.62h-.66l-.62 8.03c-.08 1.09-.99 1.97-2.08 1.97H5.86c-1.09 0-2-.88-2.08-1.97l-.62-8.03H2.5a.62.62 0 1 1 0-1.25h2.03c.17-.73.82-1.25 1.57-1.25Zm0 1.25c-.07 0-.14.03-.19.08A.26.26 0 0 0 5.84 3h4.32a.26.26 0 0 0-.07-.17.26.26 0 0 0-.19-.08H6.1Zm-1.07 1.25.61 7.93c.03.44.4.79.84.79h3.04c.44 0 .81-.35.84-.79l.61-7.93H5.03Z" />
    </svg>
  );
}

function SidebarSection({
  title,
  defaultOpen = false,
  children,
}: SidebarSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="border-t border-[var(--theme-border)] pt-4 first:border-t-0 first:pt-0">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span className="text-xs uppercase tracking-[0.28em] text-[var(--theme-fg-muted)]">
          {title}
        </span>
        <span className="text-xs text-[var(--theme-fg-muted)]">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && <div className="mt-3">{children}</div>}
    </section>
  );
}

function supervisorSummary(status: AgentRuntimeStatusDto | null) {
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

function ThreadCard({
  thread,
  currentThreadId,
  currentWorkspaceId,
  workspaceLabels = {},
  onOpenThread,
  onBeginRenameThread,
  onDeleteThread,
  showDeleteButton = false,
  showSessionCopyButton = false,
}: {
  thread: ThreadDto;
  currentThreadId?: string | undefined;
  currentWorkspaceId?: string | null | undefined;
  workspaceLabels?: Record<string, string>;
  onOpenThread: (threadId: string) => void;
  onBeginRenameThread: (thread: ThreadDto) => void;
  onDeleteThread?: (thread: ThreadDto) => void;
  showDeleteButton?: boolean;
  showSessionCopyButton?: boolean;
}) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const resetTimerRef = useRef<number | null>(null);
  const workspaceLabel = workspaceLabels[thread.workspaceId];
  const isCurrentThread = currentThreadId === thread.id;

  useEffect(() => {
    return () => {
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  async function handleCopySessionId() {
    const sessionId = thread.providerSessionId;
    if (!sessionId) {
      return;
    }

    try {
      await navigator.clipboard.writeText(sessionId);
      setCopyState('copied');
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
      resetTimerRef.current = window.setTimeout(() => setCopyState('idle'), 1200);
    } catch {
      setCopyState('failed');
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
      resetTimerRef.current = window.setTimeout(() => setCopyState('idle'), 1600);
    }
  }

  return (
    <div
      role="link"
      tabIndex={0}
      onClick={() => onOpenThread(thread.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpenThread(thread.id);
        }
      }}
      className={`thread-sidebar-card relative block rounded-[1.2rem] border px-3 py-2.5 transition ${
        isCurrentThread
          ? 'thread-sidebar-card-active shadow-lg shadow-stone-950/12'
          : ''
      } ${showSessionCopyButton && (thread.providerSessionId) ? 'pb-4' : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <p
              className="min-w-0 w-fit max-w-[calc(100%-2rem)] truncate text-[13px] font-medium leading-5 text-[var(--theme-fg)]"
              title={thread.title}
            >
              {thread.title}
            </p>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onBeginRenameThread(thread);
              }}
              aria-label={`Rename thread ${thread.title}`}
              className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-[var(--theme-fg-muted)] transition hover:text-[var(--theme-fg)]"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 16 16"
                className="h-3 w-3 fill-current"
              >
                <path d="m11.9 1.6 2.5 2.5-8.2 8.2-3.3.7.7-3.3 8.3-8.1Zm-7.3 8.7-.3 1.3 1.3-.3 6.9-6.9-1-1-6.9 6.9Zm8.8-7.8-1-1-1 1 1 1 1-1Z" />
              </svg>
            </button>
            {showDeleteButton && onDeleteThread && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onDeleteThread(thread);
                }}
                aria-label={`Delete thread ${thread.title}`}
                className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-rose-300/90 transition hover:text-rose-200"
              >
                <TrashIcon />
              </button>
            )}
          </div>
          {workspaceLabel && !currentWorkspaceId && (
            <p className="mt-1 truncate text-xs text-[var(--theme-fg-muted)]">
              {workspaceLabel}
            </p>
          )}
        </div>
        <span
          className={`rounded-full border px-2 py-0.5 text-[9px] uppercase tracking-[0.18em] ${threadStatusClassName(thread.status)}`}
        >
          {threadStatusLabel(thread.status)}
        </span>
      </div>
      <div className={`mt-2 flex items-center justify-between gap-3 text-[11px] text-[var(--theme-fg-muted)] ${showSessionCopyButton && (thread.providerSessionId) ? 'pr-9' : ''}`}>
        <time dateTime={thread.lastTurnStartedAt ?? thread.updatedAt}>
          {formatShortTimestamp(thread.lastTurnStartedAt ?? thread.updatedAt)}
        </time>
        <span>{thread.model ?? 'No model'}</span>
      </div>
      {showSessionCopyButton && (thread.providerSessionId) && (
        <button
          type="button"
          aria-label="Copy session ID"
          title={
            copyState === 'copied'
              ? 'Copied'
              : copyState === 'failed'
                ? 'Copy failed'
                : 'Copy session ID'
          }
          onClick={(event) => {
            event.stopPropagation();
            void handleCopySessionId();
          }}
          className={`absolute bottom-2.5 right-2.5 inline-flex h-7 w-7 items-center justify-center rounded-full border shadow-sm shadow-stone-950/25 backdrop-blur transition ${
            copyState === 'copied'
              ? 'border-sky-300/40 bg-sky-300/16 text-sky-100'
              : copyState === 'failed'
                ? 'border-rose-300/35 bg-rose-300/12 text-rose-100'
                : 'border-[var(--theme-border-strong)] bg-[var(--theme-surface-strong)] text-[var(--theme-fg-soft)] hover:bg-[var(--theme-hover)]'
          }`}
        >
          <CopyIcon />
        </button>
      )}
    </div>
  );
}

export function ThreadCards({
  threads,
  currentThreadId,
  currentWorkspaceId,
  workspaceLabels = {},
  onOpenThread,
  onBeginRenameThread,
  onDeleteThread,
  scrollable = false,
  maxHeightClassName = 'max-h-full',
  showDeleteButton = false,
  showSessionCopyButton = false,
}: ThreadCardsProps) {
  const containerClassName = scrollable
    ? `min-h-0 overflow-y-auto overscroll-contain pr-1 ${maxHeightClassName}`
    : '';

  return (
    <div className={containerClassName}>
      <div className="space-y-1.5">
        {threads.map((thread) => (
          <ThreadCard
            key={thread.id}
            thread={thread}
            currentThreadId={currentThreadId}
            currentWorkspaceId={currentWorkspaceId}
            workspaceLabels={workspaceLabels}
            onOpenThread={onOpenThread}
            onBeginRenameThread={onBeginRenameThread}
            showDeleteButton={showDeleteButton}
            showSessionCopyButton={showSessionCopyButton}
            {...(onDeleteThread ? { onDeleteThread } : {})}
          />
        ))}
      </div>
    </div>
  );
}

export function ThreadWorkspaceLayout({
  threads,
  status,
  loading = false,
  error,
  viewportConstrained = false,
  showMobileAppMenu = true,
  showMobileThreadNavToggle = true,
  showMobileNewThreadShortcut = true,
  mobileHeaderAction,
  currentThreadId,
  currentThreadLabel = null,
  currentWorkspaceId = null,
  currentWorkspaceLabel = null,
  workspaceLabels = {},
  metaContent,
  settingsContent,
  onRenameThread,
  children,
}: ThreadWorkspaceLayoutProps) {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [editingThreadId, setEditingThreadId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [renamingThreadId, setRenamingThreadId] = useState<string | null>(null);
  const navigate = useNavigate();
  const shellNav = useAppShellNav();

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

  const baseThreadScopeLabel =
    currentWorkspaceLabel ??
    (currentWorkspaceId ? 'Current workspace' : 'All threads');
  const threadScopeLabel =
    currentThreadLabel && currentThreadLabel.trim()
      ? `${baseThreadScopeLabel} / ${currentThreadLabel.trim()}`
      : baseThreadScopeLabel;
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
    shellNav?.closeNav();
  }

  function renderSidebarContent() {
    return (
      <div className="space-y-4">
        <section>
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-xs uppercase tracking-[0.28em] text-[var(--theme-fg-muted)]">
              Thread List
            </p>
            <div className="flex items-center gap-2">
              {loading && (
                <span className="text-xs text-[var(--theme-fg-muted)]">Refreshing...</span>
              )}
              <Link
                to={newThreadHref}
                onClick={() => {
                  setMobileSidebarOpen(false);
                  shellNav?.closeNav();
                }}
                className="inline-flex h-7 items-center rounded-full bg-[var(--theme-accent-solid)] px-2.5 text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--theme-accent-solid-fg)] transition hover:bg-[var(--theme-accent-solid-hover)]"
              >
                New Thread
              </Link>
            </div>
          </div>

          {error && (
            <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-3 py-3 text-sm text-rose-100">
              {error}
            </div>
          )}

          {!error && visibleThreads.length === 0 && !loading && (
            <div className="rounded-2xl border border-dashed border-[var(--theme-border)] bg-[var(--theme-surface)] px-4 py-6 text-sm text-[var(--theme-fg-muted)]">
              No threads available in this view.
            </div>
          )}

          {visibleThreads.length > 0 && (
            <ThreadCards
              threads={visibleThreads}
              currentThreadId={currentThreadId}
              currentWorkspaceId={currentWorkspaceId}
              workspaceLabels={workspaceLabels}
              onOpenThread={openThread}
              onBeginRenameThread={beginRenameThread}
            />
          )}
        </section>

        <SidebarSection title="Thread Meta" defaultOpen>
          {metaContent ?? (
            <p className="text-sm text-[var(--theme-fg-muted)]">
              Select a thread to inspect metadata.
            </p>
          )}
        </SidebarSection>

        <SidebarSection title="Settings">
          {settingsContent ?? (
            <p className="text-sm text-[var(--theme-fg-muted)]">
              No thread settings available.
            </p>
          )}
        </SidebarSection>
      </div>
    );
  }

  return (
    <>
      <div
        className={
          viewportConstrained
            ? 'flex h-full max-h-full min-h-0 flex-col gap-2 overflow-hidden overscroll-none sm:gap-4 lg:grid lg:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[340px_minmax(0,1fr)]'
            : 'flex min-h-[calc(100dvh-2rem)] flex-col gap-4 lg:grid lg:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[340px_minmax(0,1fr)]'
        }
      >
        <div className="lg:hidden">
          <div className="relative">
            <div
              className={`thread-topbar-surface grid h-10 items-center gap-1.5 border-b px-2.5 backdrop-blur ${
                showMobileAppMenu && (showMobileNewThreadShortcut || mobileHeaderAction)
                  ? 'grid-cols-[2.5rem_minmax(0,1fr)_auto]'
                  : showMobileAppMenu
                    ? 'grid-cols-[2.5rem_minmax(0,1fr)]'
                  : 'grid-cols-[minmax(0,1fr)]'
              }`}
            >
              {showMobileAppMenu && (
                <AppShellMenuButton />
              )}

              {showMobileThreadNavToggle ? (
                <button
                  type="button"
                  onClick={() => setMobileSidebarOpen((current) => !current)}
                  aria-expanded={mobileSidebarOpen}
                  aria-label={
                    mobileSidebarOpen
                      ? 'Collapse thread navigation'
                      : 'Expand thread navigation'
                  }
                  className="inline-flex min-w-0 items-center justify-center gap-1 px-1 text-center text-sm font-medium text-[var(--theme-fg)]"
                  title={threadScopeLabel}
                >
                  <span className="min-w-0 truncate">{threadScopeLabel}</span>
                  <span
                    aria-hidden="true"
                    className={`inline-flex h-4 w-4 shrink-0 items-center justify-center text-[var(--theme-fg-muted)] transition ${
                      mobileSidebarOpen ? 'rotate-180' : ''
                    }`}
                  >
                    <svg
                      viewBox="0 0 16 16"
                      className="h-3.5 w-3.5 fill-none stroke-current"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="m4.5 6.25 3.5 3.5 3.5-3.5" />
                    </svg>
                  </span>
                </button>
              ) : (
                <p
                  className="min-w-0 truncate px-1 text-center text-sm font-medium text-[var(--theme-fg)]"
                  title={threadScopeLabel}
                >
                  {threadScopeLabel}
                </p>
              )}

              {showMobileAppMenu &&
                (mobileHeaderAction ? (
                  mobileHeaderAction
                ) : showMobileNewThreadShortcut ? (
                  <Link
                    to={newThreadHref}
                    onClick={() => {
                      shellNav?.closeNav();
                      setMobileSidebarOpen(false);
                    }}
                    aria-label="New Thread"
                    className="inline-flex h-8 min-w-0 shrink-0 items-center justify-center gap-1 rounded-full bg-[var(--theme-accent-solid)] px-2 text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--theme-accent-solid-fg)] transition hover:bg-[var(--theme-accent-solid-hover)]"
                  >
                    <NewThreadIcon />
                    <span className="hidden sm:inline">New</span>
                  </Link>
                ) : null)}
            </div>

            {showMobileAppMenu && (
              <AppShellNavigationMenu className="absolute left-2 top-[calc(100%+0.45rem)] z-20 w-[min(18rem,calc(100vw-1rem))]" />
            )}

            {showMobileThreadNavToggle && mobileSidebarOpen && (
              <aside className="thread-sidebar-surface absolute inset-x-2 top-[calc(100%+0.35rem)] z-10 max-h-[40dvh] overflow-y-auto rounded-[1.35rem] border p-4 shadow-2xl shadow-stone-950/18 backdrop-blur">
                {renderSidebarContent()}
              </aside>
            )}
          </div>
        </div>

        <aside className="hidden min-h-0 lg:block">
          <div
            className={`thread-sidebar-surface sticky top-4 rounded-[2rem] border p-4 shadow-2xl shadow-stone-950/12 backdrop-blur ${
              viewportConstrained
                ? 'h-full max-h-full overflow-y-auto'
                : ''
            }`}
          >
            {renderSidebarContent()}
          </div>
        </aside>

        <section
          className={
            viewportConstrained
              ? 'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden'
              : 'min-w-0'
          }
        >
          {children}
        </section>
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
