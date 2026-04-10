import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

import {
  CodexStatusDto,
  ThreadDetailDto,
  ThreadDto,
} from '../../../../packages/shared/src/index';
import { ThreadComposer } from '../components/ThreadComposer';
import { ThreadTimeline } from '../components/ThreadTimeline';
import { ThreadWorkspaceLayout } from '../components/ThreadWorkspaceLayout';
import {
  formatLongTimestamp,
  threadStatusLabel,
} from '../components/threadPresentation';
import {
  ApiError,
  connectSupervisorEvents,
  fetchCodexStatus,
  fetchThreads,
  fetchThreadDetail,
  interruptThread,
  resumeThread,
  sendThreadPrompt,
} from '../lib/api';

export function ThreadDetailPage() {
  const { id = '' } = useParams();
  const [detail, setDetail] = useState<ThreadDetailDto | null>(null);
  const [threads, setThreads] = useState<ThreadDto[]>([]);
  const [status, setStatus] = useState<CodexStatusDto | null>(null);
  const [liveOutput, setLiveOutput] = useState('');
  const [followTail, setFollowTail] = useState(true);
  const [scrollRequestKey, setScrollRequestKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadThreadDetail(showLoading = true) {
      if (showLoading) {
        setLoading(true);
      }
      setError(null);
      try {
        const [detailResponse, threadResponse, statusResponse] =
          await Promise.all([
            fetchThreadDetail(id),
            fetchThreads(),
            fetchCodexStatus(),
          ]);
        setDetail(detailResponse);
        setThreads(threadResponse);
        setStatus(statusResponse);
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : 'Unable to load thread detail.',
        );
      } finally {
        setLoading(false);
      }
    }

    void loadThreadDetail();

    const socket = connectSupervisorEvents((event) => {
      if (event.threadId !== id) {
        return;
      }

      if (
        event.type === 'thread.output.delta' &&
        typeof event.payload.delta === 'string'
      ) {
        setLiveOutput((current) => current + event.payload.delta);
      }

      if (
        event.type === 'thread.turn.completed' ||
        event.type === 'thread.turn.failed' ||
        event.type === 'thread.updated'
      ) {
        void loadThreadDetail(false);
        setLiveOutput('');
      }
    });

    return () => {
      socket.close();
    };
  }, [id]);

  async function handlePrompt(prompt: string) {
    setBusy(true);
    setError(null);
    setLiveOutput('');
    setScrollRequestKey((current) => current + 1);

    try {
      const thread = await sendThreadPrompt(id, { prompt });
      setDetail((current) => (current ? { ...current, thread } : current));
      setThreads((current) =>
        current.map((entry) => (entry.id === thread.id ? thread : entry)),
      );
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.payload.message);
      } else {
        setError(
          caught instanceof Error ? caught.message : 'Unable to send prompt.',
        );
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleInterrupt() {
    setBusy(true);
    setError(null);

    try {
      const thread = detail?.thread.activeTurnId
        ? await interruptThread(id, { turnId: detail.thread.activeTurnId })
        : await interruptThread(id);
      setDetail((current) => (current ? { ...current, thread } : current));
      setThreads((current) =>
        current.map((entry) => (entry.id === thread.id ? thread : entry)),
      );
      setLiveOutput('');
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Unable to interrupt turn.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleResume() {
    setBusy(true);
    setError(null);

    try {
      const resumed = await resumeThread(id);
      setDetail(resumed);
      setThreads((current) =>
        current.map((entry) =>
          entry.id === resumed.thread.id ? resumed.thread : entry,
        ),
      );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Unable to resume thread.',
      );
    } finally {
      setBusy(false);
    }
  }

  const promptDisabledReason = detail
    ? detail.workspacePathStatus === 'missing'
      ? 'Restore this workspace path on the current machine before continuing.'
      : detail.thread.source === 'local_codex_import' && !detail.thread.isLoaded
        ? 'Resume / Connect this imported session before sending a new prompt.'
        : null
    : null;

  const metaContent = detail ? (
    <dl className="space-y-4 text-sm">
      <div>
        <dt className="text-stone-500">Source</dt>
        <dd className="mt-1 text-stone-100">
          {detail.thread.source === 'local_codex_import' ? 'Imported local Codex session' : 'Supervisor thread'}
        </dd>
      </div>
      <div>
        <dt className="text-stone-500">Status</dt>
        <dd className="mt-1 text-stone-100">
          {threadStatusLabel(detail.thread.status)}
        </dd>
      </div>
      <div>
        <dt className="text-stone-500">Created</dt>
        <dd className="mt-1 text-stone-100">
          {formatLongTimestamp(detail.thread.createdAt)}
        </dd>
      </div>
      <div>
        <dt className="text-stone-500">Workspace</dt>
        <dd className="mt-1 break-words text-stone-100">
          {detail.workspace.absPath}
        </dd>
      </div>
      <div>
        <dt className="text-stone-500">Workspace path</dt>
        <dd className="mt-1 text-stone-100">
          {detail.workspacePathStatus === 'present' ? 'Present' : 'Missing on this machine'}
        </dd>
      </div>
      <div>
        <dt className="text-stone-500">Session ID</dt>
        <dd className="mt-1 break-all text-stone-100">
          {detail.thread.codexThreadId ?? 'Unavailable'}
        </dd>
      </div>
      <div>
        <dt className="text-stone-500">Active turn</dt>
        <dd className="mt-1 text-stone-100">
          {detail.thread.activeTurnId ?? 'None'}
        </dd>
      </div>
      {detail.thread.lastError && (
        <div>
          <dt className="text-stone-500">Last error</dt>
          <dd className="mt-1 text-rose-200">{detail.thread.lastError}</dd>
        </div>
      )}
    </dl>
  ) : null;

  return (
    <ThreadWorkspaceLayout
      threads={threads}
      status={status}
      loading={loading}
      error={loading ? null : error}
      currentThreadId={detail?.thread.id}
      currentWorkspaceId={detail?.thread.workspaceId}
      currentWorkspaceLabel={detail?.workspace.label}
      metaContent={metaContent}
    >
      <div className="flex h-[calc(100dvh-2rem)] max-h-[calc(100dvh-2rem)] flex-col overflow-hidden rounded-[2rem] border border-stone-800 bg-stone-900/85 shadow-2xl shadow-stone-950/20">
        <header className="shrink-0 border-b border-stone-800 bg-stone-900/95 px-4 py-3 backdrop-blur sm:px-5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-lg font-medium text-stone-100 sm:text-xl">
                {detail?.thread.title ?? 'Loading thread'}
              </h2>
              <p className="mt-1 truncate text-xs text-stone-500">
                {detail?.workspace.label ?? 'Resolving workspace'}
              </p>
            </div>
            <button
              type="button"
              aria-label={`Resume Thread (${detail ? threadStatusLabel(detail.thread.status) : 'Loading'})`}
              title={
                detail
                  ? threadStatusLabel(detail.thread.status)
                  : 'Resume Thread'
              }
              onClick={() => void handleResume()}
              disabled={busy}
              className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border shadow-lg shadow-stone-950/25 transition ${
                detail?.thread.isLoaded
                  ? 'border-emerald-300/45 bg-emerald-300/18 text-emerald-50 ring-1 ring-emerald-300/20 hover:bg-emerald-300/24'
                  : 'border-stone-600 bg-stone-800/85 text-stone-300 hover:border-stone-500 hover:bg-stone-800'
              } disabled:cursor-not-allowed disabled:opacity-60`}
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 16 16"
                className="h-4.5 w-4.5 fill-none stroke-current"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {detail?.thread.isLoaded ? (
                  <>
                    <path d="M2.5 6.75A8.22 8.22 0 0 1 8 4.5c2.14 0 4.1.8 5.5 2.25" />
                    <path d="M4.75 9a4.95 4.95 0 0 1 6.5 0" />
                    <path d="M6.9 11.3a1.9 1.9 0 0 1 2.2 0" />
                    <path d="m6.7 13.2.9.9 1.7-2" />
                  </>
                ) : (
                  <>
                    <path d="M2.5 6.75A8.22 8.22 0 0 1 8 4.5c2.14 0 4.1.8 5.5 2.25" />
                    <path d="M4.75 9a4.95 4.95 0 0 1 6.5 0" />
                    <path d="M6.9 11.3a1.9 1.9 0 0 1 2.2 0" />
                    <path d="M3 3l10 10" />
                  </>
                )}
              </svg>
            </button>
          </div>
        </header>

        {error && !loading && (
          <div className="shrink-0 border-b border-rose-500/20 bg-rose-500/10 px-5 py-4 text-sm text-rose-100 sm:px-6">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex flex-1 items-center justify-center px-6 py-12 text-center text-stone-400">
            Loading thread detail...
          </div>
        ) : detail ? (
          <>
            {detail.thread.source === 'local_codex_import' && (
              <div className="shrink-0 border-b border-amber-500/20 bg-amber-500/10 px-5 py-4 text-sm text-amber-100 sm:px-6">
                <p className="font-medium text-amber-50">Imported local Codex session</p>
                <p className="mt-1 text-amber-100/90">
                  History is available immediately. Click Resume / Connect before sending a new prompt.
                </p>
              </div>
            )}
            {detail.workspacePathStatus === 'missing' && (
              <div className="shrink-0 border-b border-rose-500/20 bg-rose-500/10 px-5 py-4 text-sm text-rose-100 sm:px-6">
                <p className="font-medium text-rose-50">Workspace path missing</p>
                <p className="mt-1 break-words text-rose-100/90">
                  {detail.workspace.absPath}
                </p>
              </div>
            )}
            <ThreadTimeline
              turns={detail.turns}
              liveOutput={liveOutput}
              followTail={followTail}
              scrollRequestKey={scrollRequestKey}
              className="min-h-0 flex-1 bg-stone-900/30"
            />
            <ThreadComposer
              busy={busy}
              error={null}
              model={detail.thread.model}
              followTail={followTail}
              disabled={Boolean(promptDisabledReason)}
              disabledPlaceholder={promptDisabledReason ?? undefined}
              canInterrupt={Boolean(detail.thread.activeTurnId)}
              onSubmit={handlePrompt}
              onInterrupt={handleInterrupt}
              onToggleFollow={() => setFollowTail((current) => !current)}
            />
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center px-6 py-12 text-center text-stone-400">
            Unable to resolve this thread.
          </div>
        )}
      </div>
    </ThreadWorkspaceLayout>
  );
}
