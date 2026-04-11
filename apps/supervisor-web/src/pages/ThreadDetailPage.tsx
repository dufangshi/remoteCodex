import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';

import {
  CodexStatusDto,
  ModelOptionDto,
  ThreadDetailDto,
  ThreadDto,
} from '../../../../packages/shared/src/index';
import { ThreadComposer } from '../components/ThreadComposer';
import {
  ThreadShellPanel,
  type ThreadShellControlState,
  type ThreadShellPanelHandle,
} from '../components/ThreadShellPanel';
import { ThreadTimeline } from '../components/ThreadTimeline';
import { ThreadWorkspaceLayout } from '../components/ThreadWorkspaceLayout';
import {
  formatLongTimestamp,
  threadStatusLabel,
} from '../components/threadPresentation';
import {
  ApiError,
  connectSupervisorEvents,
  disconnectThread,
  fetchCodexModels,
  fetchCodexStatus,
  fetchThreads,
  fetchThreadDetail,
  interruptThread,
  respondToThreadRequest,
  resumeThread,
  sendThreadPrompt,
  type PromptAttachmentUpload,
  type SendThreadPromptRequestInput,
  updateThread,
  updateThreadSettings,
} from '../lib/api';

const DETAIL_TURN_PAGE_SIZE = 10;

function prependTurns(
  existing: ThreadDetailDto['turns'],
  older: ThreadDetailDto['turns'],
) {
  const olderIds = new Set(older.map((turn) => turn.id));
  return [...older, ...existing.filter((turn) => !olderIds.has(turn.id))];
}

function appendLatestTurns(
  existing: ThreadDetailDto['turns'],
  latest: ThreadDetailDto['turns'],
) {
  const latestIds = new Set(latest.map((turn) => turn.id));
  return [...existing.filter((turn) => !latestIds.has(turn.id)), ...latest];
}

export function ThreadDetailPage() {
  const { id = '' } = useParams();
  const liveOutputBufferRef = useRef('');
  const liveOutputFrameRef = useRef<number | null>(null);
  const shellPanelRef = useRef<ThreadShellPanelHandle | null>(null);
  const composerHostRef = useRef<HTMLDivElement | null>(null);
  const loadRequestIdRef = useRef(0);
  const [detail, setDetail] = useState<ThreadDetailDto | null>(null);
  const [threads, setThreads] = useState<ThreadDto[]>([]);
  const [modelOptions, setModelOptions] = useState<ModelOptionDto[]>([]);
  const [status, setStatus] = useState<CodexStatusDto | null>(null);
  const [liveOutput, setLiveOutput] = useState('');
  const [livePlan, setLivePlan] = useState<{
    turnId: string;
    explanation: string | null;
    plan: Array<{ step: string; status: string }>;
  } | null>(null);
  const [followTail, setFollowTail] = useState(true);
  const [scrollRequestKey, setScrollRequestKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [busy, setBusy] = useState(false);
  const [activeView, setActiveView] = useState<'chat' | 'shell'>('chat');
  const [chatDraft, setChatDraft] = useState<{
    prompt: string;
    attachments: PromptAttachmentUpload[];
  }>({
    prompt: '',
    attachments: [],
  });
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [mobileComposerHeight, setMobileComposerHeight] = useState(0);
  const [shellControlState, setShellControlState] =
    useState<ThreadShellControlState | null>(null);
  const [pendingShellConnectionToggle, setPendingShellConnectionToggle] =
    useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [respondingRequestId, setRespondingRequestId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const flushBufferedLiveOutput = useCallback(() => {
    const buffered = liveOutputBufferRef.current;
    liveOutputBufferRef.current = '';
    liveOutputFrameRef.current = null;

    if (!buffered) {
      return;
    }

    setLiveOutput((current) => current + buffered);
  }, []);

  const queueLiveOutputDelta = useCallback(
    (delta: string) => {
      liveOutputBufferRef.current += delta;
      if (liveOutputFrameRef.current !== null) {
        return;
      }

      liveOutputFrameRef.current = window.requestAnimationFrame(() => {
        flushBufferedLiveOutput();
      });
    },
    [flushBufferedLiveOutput],
  );

  const clearBufferedLiveOutput = useCallback(() => {
    liveOutputBufferRef.current = '';
    if (liveOutputFrameRef.current !== null) {
      window.cancelAnimationFrame(liveOutputFrameRef.current);
      liveOutputFrameRef.current = null;
    }
  }, []);

  useEffect(() => {
    setDetail(null);
    setChatDraft({
      prompt: '',
      attachments: [],
    });
    setLoadingEarlier(false);
  }, [id]);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    const { documentElement, body } = document;
    documentElement.classList.add('thread-detail-scroll-locked');
    body.classList.add('thread-detail-scroll-locked');

    return () => {
      documentElement.classList.remove('thread-detail-scroll-locked');
      body.classList.remove('thread-detail-scroll-locked');
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const mediaQuery = window.matchMedia('(max-width: 639px)');
    const update = () => setIsMobileViewport(mediaQuery.matches);
    update();
    mediaQuery.addEventListener('change', update);
    return () => {
      mediaQuery.removeEventListener('change', update);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const updateKeyboardInset = () => {
      const viewport = window.visualViewport;
      const keyboardInset = viewport
        ? Math.max(
            0,
            Math.round(window.innerHeight - viewport.height - viewport.offsetTop),
          )
        : 0;
      document.documentElement.style.setProperty(
        '--thread-detail-keyboard-inset',
        `${keyboardInset}px`,
      );
    };

    updateKeyboardInset();
    window.visualViewport?.addEventListener('resize', updateKeyboardInset);
    window.visualViewport?.addEventListener('scroll', updateKeyboardInset);
    window.addEventListener('resize', updateKeyboardInset);

    return () => {
      window.visualViewport?.removeEventListener('resize', updateKeyboardInset);
      window.visualViewport?.removeEventListener('scroll', updateKeyboardInset);
      window.removeEventListener('resize', updateKeyboardInset);
      document.documentElement.style.removeProperty('--thread-detail-keyboard-inset');
    };
  }, []);

  useEffect(() => {
    const node = composerHostRef.current;
    if (!node || typeof ResizeObserver === 'undefined') {
      return;
    }

    const measuredNode =
      (node.querySelector('form') as HTMLFormElement | null) ?? node;

    const updateHeight = () => {
      setMobileComposerHeight(
        Math.max(
          node.getBoundingClientRect().height,
          measuredNode.getBoundingClientRect().height,
        ),
      );
    };

    updateHeight();
    const observer = new ResizeObserver(() => {
      updateHeight();
    });
    observer.observe(measuredNode);
    return () => {
      observer.disconnect();
    };
  }, [activeView, isMobileViewport]);

  useEffect(() => {
    async function loadThreadDetail(showLoading = true) {
      const requestId = loadRequestIdRef.current + 1;
      loadRequestIdRef.current = requestId;
      if (showLoading) {
        setLoading(true);
      }
      setError(null);
      try {
        const [detailResponse, threadResponse, statusResponse, modelResponse] =
          await Promise.all([
            fetchThreadDetail(id, { limit: DETAIL_TURN_PAGE_SIZE }),
            fetchThreads(),
            fetchCodexStatus(),
            fetchCodexModels(),
          ]);
        if (loadRequestIdRef.current !== requestId) {
          return;
        }
        setDetail((current) =>
          current
            ? {
                ...detailResponse,
                turns: appendLatestTurns(current.turns, detailResponse.turns),
              }
            : detailResponse,
        );
        setThreads(threadResponse);
        setStatus(statusResponse);
        setModelOptions(modelResponse);
      } catch (caught) {
        if (loadRequestIdRef.current !== requestId) {
          return;
        }
        setError(
          caught instanceof Error
            ? caught.message
            : 'Unable to load thread detail.',
        );
      } finally {
        if (loadRequestIdRef.current === requestId) {
          setLoading(false);
        }
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
        queueLiveOutputDelta(event.payload.delta);
      }

      if (
        event.type === 'thread.turn.started' ||
        event.type === 'thread.turn.completed' ||
        event.type === 'thread.turn.failed' ||
        event.type === 'thread.updated' ||
        event.type === 'thread.request.created' ||
        event.type === 'thread.request.resolved'
      ) {
        void loadThreadDetail(false);
        if (event.type === 'thread.turn.started') {
          clearBufferedLiveOutput();
          setLiveOutput('');
        }
        if (
          event.type === 'thread.turn.completed' ||
          event.type === 'thread.turn.failed'
        ) {
          clearBufferedLiveOutput();
          setLiveOutput('');
          setLivePlan(null);
        }
      }

      if (
        event.type === 'thread.plan.updated' &&
        Array.isArray(event.payload.plan)
      ) {
        setLivePlan({
          turnId: String(event.payload.turnId ?? ''),
          explanation:
            typeof event.payload.explanation === 'string'
              ? event.payload.explanation
              : null,
          plan: event.payload.plan as Array<{ step: string; status: string }>,
        });
      }
    });

    return () => {
      clearBufferedLiveOutput();
      socket.close();
    };
  }, [clearBufferedLiveOutput, id, queueLiveOutputDelta]);

  async function handleLoadEarlierTurns() {
    if (!detail || detail.turns.length === 0 || loadingEarlier) {
      return;
    }

    setLoadingEarlier(true);
    setError(null);

    try {
      const earliestLoadedTurnId = detail.turns[0]?.id;
      const earlier = await fetchThreadDetail(id, {
        limit: DETAIL_TURN_PAGE_SIZE,
        ...(earliestLoadedTurnId ? { beforeTurnId: earliestLoadedTurnId } : {}),
      });
      setDetail((current) =>
        current
          ? {
              ...earlier,
              turns: prependTurns(current.turns, earlier.turns),
            }
          : earlier,
      );
      setThreads((current) =>
        current.map((entry) =>
          entry.id === earlier.thread.id ? earlier.thread : entry,
        ),
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Unable to load earlier turns.',
      );
    } finally {
      setLoadingEarlier(false);
    }
  }

  async function handlePrompt(input: SendThreadPromptRequestInput) {
    if (activeView === 'shell') {
      if (detail?.thread.isLoaded === false) {
        await handleThreadConnectionToggle({ attachShell: true });
        return;
      }

      const sent = shellPanelRef.current?.sendCommand(input.prompt) ?? false;
      if (!sent) {
        setError('Connect the shell before sending commands.');
      } else {
        setError(null);
      }
      return;
    }

    setBusy(true);
    setError(null);
    clearBufferedLiveOutput();
    setLiveOutput('');
    setScrollRequestKey((current) => current + 1);

    try {
      let currentDetail = detail;
      if (currentDetail && !currentDetail.thread.isLoaded) {
        const resumed = await resumeThread(
          id,
          currentDetail.thread.model ? { model: currentDetail.thread.model } : {},
        );
        currentDetail = resumed;
        setDetail((current) =>
          current
            ? {
                ...resumed,
                turns: appendLatestTurns(current.turns, resumed.turns),
              }
            : resumed,
        );
        setThreads((current) =>
          current.map((entry) =>
            entry.id === resumed.thread.id ? resumed.thread : entry,
          ),
        );
      }

      const promptInput = {
        prompt: input.prompt,
        ...(currentDetail?.thread.model ? { model: currentDetail.thread.model } : {}),
        ...(currentDetail?.thread.reasoningEffort
          ? { reasoningEffort: currentDetail.thread.reasoningEffort }
          : {}),
        ...(currentDetail?.thread.collaborationMode
          ? { collaborationMode: currentDetail.thread.collaborationMode }
          : {}),
        ...(input.attachments?.length ? { attachments: input.attachments } : {}),
      };
      const thread = await sendThreadPrompt(id, promptInput);
      setDetail((current) => (current ? { ...current, thread } : current));
      setThreads((current) =>
        current.map((entry) => (entry.id === thread.id ? thread : entry)),
      );
      setLivePlan(null);
      setChatDraft({
        prompt: '',
        attachments: [],
      });
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

  async function handleThreadConnectionToggle(options?: { attachShell?: boolean }) {
    if (!detail) {
      return;
    }

    setBusy(true);
    setError(null);
    clearBufferedLiveOutput();
    setLiveOutput('');

    try {
      if (detail.thread.isLoaded) {
        const disconnected = await disconnectThread(id);
        setDetail((current) =>
          current
            ? {
                ...disconnected,
                turns: appendLatestTurns(current.turns, disconnected.turns),
              }
            : disconnected,
        );
        setShellControlState(null);
        setThreads((current) =>
          current.map((entry) =>
            entry.id === disconnected.thread.id ? disconnected.thread : entry,
          ),
        );
        setPendingShellConnectionToggle(false);
        return;
      }

      const resumed = await resumeThread(
        id,
        detail.thread.model ? { model: detail.thread.model } : {},
      );
      setDetail((current) =>
        current
          ? {
              ...resumed,
              turns: appendLatestTurns(current.turns, resumed.turns),
            }
          : resumed,
      );
      setThreads((current) =>
        current.map((entry) =>
          entry.id === resumed.thread.id ? resumed.thread : entry,
        ),
      );
      if (options?.attachShell && activeView === 'shell') {
        setPendingShellConnectionToggle(true);
      }
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Unable to change connection state.',
      );
    } finally {
        setBusy(false);
    }
  }

  async function handleInterrupt() {
    if (activeView === 'shell') {
      const sent = shellPanelRef.current?.sendControl('ctrl_c') ?? false;
      if (!sent) {
        setError('Connect the shell before sending Ctrl-C.');
      } else {
        setError(null);
      }
      return;
    }

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
      clearBufferedLiveOutput();
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
    await handleThreadConnectionToggle({ attachShell: activeView === 'shell' });
  }

  async function handleUpdateThreadSettings(input: {
    model?: string;
    reasoningEffort?: ThreadDto['reasoningEffort'];
    collaborationMode?: ThreadDto['collaborationMode'];
  }) {
    if (!detail) {
      return;
    }

    const previousDetail = detail;
    const optimisticThread = {
      ...detail.thread,
      ...(input.model !== undefined ? { model: input.model } : {}),
      ...(input.reasoningEffort !== undefined
        ? { reasoningEffort: input.reasoningEffort }
        : {}),
      ...(input.collaborationMode !== undefined
        ? { collaborationMode: input.collaborationMode }
        : {}),
    };

    setSettingsBusy(true);
    setDetail((current) =>
      current
        ? {
            ...current,
            thread: optimisticThread,
          }
        : current,
    );
    setThreads((current) =>
      current.map((entry) =>
        entry.id === optimisticThread.id ? { ...entry, ...optimisticThread } : entry,
      ),
    );

    try {
      const updated = await updateThreadSettings(id, input);
      setDetail((current) =>
        current
          ? {
              ...current,
              thread: updated,
            }
          : current,
      );
      setThreads((current) =>
        current.map((entry) => (entry.id === updated.id ? updated : entry)),
      );
    } catch (caught) {
      setDetail(previousDetail);
      setThreads((current) =>
        current.map((entry) =>
          entry.id === previousDetail.thread.id ? previousDetail.thread : entry,
        ),
      );
      setError(
        caught instanceof Error
          ? caught.message
          : 'Unable to update thread settings.',
      );
    } finally {
      setSettingsBusy(false);
    }
  }

  async function handleRespondToRequest(
    requestId: string,
    input: { answers: Record<string, { answers: string[] }> },
  ) {
    setRespondingRequestId(requestId);
    setError(null);

    try {
      const updated = await respondToThreadRequest(id, requestId, input);
      setDetail((current) =>
        current
          ? {
              ...updated,
              turns: appendLatestTurns(current.turns, updated.turns),
            }
          : updated,
      );
      setLivePlan(null);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Unable to answer this request.',
      );
    } finally {
      setRespondingRequestId(null);
    }
  }

  async function handleRenameThread(threadId: string, title: string) {
    try {
      const updated = await updateThread(threadId, { title });
      setThreads((current) =>
        current.map((entry) =>
          entry.id === updated.id
            ? {
                ...entry,
                title: updated.title,
                updatedAt: updated.updatedAt,
              }
            : entry,
        ),
      );
      setDetail((current) =>
        current && current.thread.id === updated.id
          ? {
              ...current,
              thread: {
                ...current.thread,
                title: updated.title,
                updatedAt: updated.updatedAt,
              },
            }
          : current,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to rename thread.');
      throw caught;
    }
  }

  function handleToggleView() {
    setActiveView((current) => {
      if (current === 'chat') {
        if (detail?.thread.isLoaded) {
          setPendingShellConnectionToggle(true);
        }
        return 'shell';
      }

      return 'chat';
    });
  }

  async function handleShellCopy() {
    const copied = await shellPanelRef.current?.copyLastCommandOutput();
    if (!copied) {
      setError('Unable to copy the last shell command output.');
    } else {
      setError(null);
    }
  }

  function handleShellControl(
    action: 'ctrl_c' | 'ctrl_d' | 'esc' | 'tab' | 'up' | 'down' | 'clear',
  ) {
    const sent =
      action === 'clear'
        ? (shellPanelRef.current?.sendCommand('clear') ?? false)
        : (shellPanelRef.current?.sendControl(action) ?? false);
    if (!sent) {
      setError('Connect the shell before sending control input.');
    } else {
      setError(null);
    }
  }

  useEffect(() => {
    if (
      !pendingShellConnectionToggle ||
      activeView !== 'shell' ||
      !shellPanelRef.current ||
      detail?.thread.isLoaded === false ||
      shellControlState?.loading !== false
    ) {
      return;
    }

    if (shellControlState?.status === 'attached') {
      setPendingShellConnectionToggle(false);
      return;
    }

    setPendingShellConnectionToggle(false);
    void shellPanelRef.current.toggleConnection();
  }, [
    activeView,
    detail?.thread.isLoaded,
    pendingShellConnectionToggle,
    shellControlState?.loading,
    shellControlState?.status,
  ]);

  const promptDisabledReason = detail
    ? detail.workspacePathStatus === 'missing'
      ? 'Restore this workspace path on the current machine before continuing.'
      : null
    : null;
  const useFloatingMobileComposer = isMobileViewport && activeView === 'chat';
  const effectiveMobileComposerHeight = Math.max(mobileComposerHeight, 144);
  const timelineBottomSpacer = useFloatingMobileComposer
    ? effectiveMobileComposerHeight + 12
    : 0;

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

  const sessionConnectionButtonClassName =
    busy && !detail?.thread.isLoaded
      ? 'thread-connection-pending border border-emerald-300/28 bg-stone-700/92 text-emerald-50 shadow-lg shadow-stone-950/20'
      : detail?.thread.isLoaded
        ? 'border border-emerald-300/55 bg-emerald-400 text-emerald-950 shadow-lg shadow-emerald-950/25 hover:bg-emerald-300'
        : 'border border-stone-600 bg-stone-800/92 text-stone-200 hover:border-stone-500 hover:bg-stone-700/95';

  const mobileSessionConnectionButton = (
    <button
      type="button"
      aria-label={`${detail?.thread.isLoaded ? 'Disconnect' : 'Connect'} Thread (${detail ? threadStatusLabel(detail.thread.status) : 'Loading'})`}
      title={
        detail
          ? `${detail.thread.isLoaded ? 'Disconnect' : 'Connect'} thread`
          : 'Connect Thread'
      }
      onClick={() => void handleResume()}
      disabled={busy}
      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-60 ${sessionConnectionButtonClassName}`}
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
  );

  return (
    <ThreadWorkspaceLayout
      threads={threads}
      status={status}
      loading={loading}
      error={loading ? null : error}
      viewportConstrained
      currentThreadId={detail?.thread.id}
      currentThreadLabel={detail?.thread.title}
      currentWorkspaceId={detail?.thread.workspaceId}
      currentWorkspaceLabel={detail?.workspace.label}
      metaContent={metaContent}
      showMobileNewThreadShortcut={false}
      mobileHeaderAction={mobileSessionConnectionButton}
      onRenameThread={handleRenameThread}
    >
      <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-none border-y border-stone-800 bg-stone-900/85 shadow-2xl shadow-stone-950/20 sm:flex-none sm:rounded-[2rem] sm:border">
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
            {detail.workspacePathStatus === 'missing' && (
              <div className="shrink-0 border-b border-rose-500/20 bg-rose-500/10 px-5 py-4 text-sm text-rose-100 sm:px-6">
                <p className="font-medium text-rose-50">Workspace path missing</p>
                <p className="mt-1 break-words text-rose-100/90">
                  {detail.workspace.absPath}
                </p>
              </div>
            )}
            {activeView === 'chat' ? (
              <>
                <ThreadTimeline
                  threadId={detail.thread.id}
                  turns={detail.turns}
                  totalTurnCount={detail.totalTurnCount ?? detail.turns.length}
                  pendingRequests={detail.pendingRequests}
                  livePlan={livePlan}
                  respondingRequestId={respondingRequestId}
                  onRespondToRequest={handleRespondToRequest}
                  liveOutput={liveOutput}
                  scrollRequestKey={scrollRequestKey}
                  bottomSpacer={timelineBottomSpacer}
                  className="min-h-0 flex-1 bg-stone-900/30"
                  onTailVisibilityChange={setFollowTail}
                  loadingEarlier={loadingEarlier}
                  onLoadEarlier={handleLoadEarlierTurns}
                />
                {useFloatingMobileComposer ? (
                  <div
                    ref={composerHostRef}
                    className="fixed inset-x-0 bottom-[var(--thread-detail-keyboard-inset,0px)] z-30 sm:hidden"
                    style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
                  >
                    <ThreadComposer
                      activeView={activeView}
                      edgeToEdgeMobile
                      busy={activeView === 'chat' ? busy : false}
                      settingsBusy={settingsBusy}
                      error={null}
                      model={detail.thread.model}
                      reasoningEffort={detail.thread.reasoningEffort}
                      collaborationMode={detail.thread.collaborationMode}
                      modelOptions={modelOptions}
                      followTail={followTail}
                      threadConnected={detail.thread.isLoaded}
                      disabled={Boolean(promptDisabledReason)}
                      disabledPlaceholder={promptDisabledReason ?? undefined}
                      shellControlState={shellControlState}
                      draftPrompt={chatDraft.prompt}
                      draftAttachments={chatDraft.attachments}
                      onDraftChange={setChatDraft}
                      canInterrupt={Boolean(detail.thread.activeTurnId)}
                      onSubmit={handlePrompt}
                      onInterrupt={handleInterrupt}
                      onToggleFollow={() => setScrollRequestKey((current) => current + 1)}
                      onUpdateSettings={handleUpdateThreadSettings}
                      onToggleView={handleToggleView}
                      onShellCopy={handleShellCopy}
                      onShellControl={handleShellControl}
                    />
                  </div>
                ) : (
                  <div ref={composerHostRef}>
                    <ThreadComposer
                      activeView={activeView}
                      busy={activeView === 'chat' ? busy : false}
                      settingsBusy={settingsBusy}
                      error={null}
                      model={detail.thread.model}
                      reasoningEffort={detail.thread.reasoningEffort}
                      collaborationMode={detail.thread.collaborationMode}
                      modelOptions={modelOptions}
                      followTail={followTail}
                      threadConnected={detail.thread.isLoaded}
                      disabled={Boolean(promptDisabledReason)}
                      disabledPlaceholder={promptDisabledReason ?? undefined}
                      shellControlState={shellControlState}
                      draftPrompt={chatDraft.prompt}
                      draftAttachments={chatDraft.attachments}
                      onDraftChange={setChatDraft}
                      canInterrupt={Boolean(detail.thread.activeTurnId)}
                      onSubmit={handlePrompt}
                      onInterrupt={handleInterrupt}
                      onToggleFollow={() => setScrollRequestKey((current) => current + 1)}
                      onUpdateSettings={handleUpdateThreadSettings}
                      onToggleView={handleToggleView}
                      onShellCopy={handleShellCopy}
                      onShellControl={handleShellControl}
                    />
                  </div>
                )}
              </>
            ) : (
              <>
                {detail.thread.isLoaded ? (
                  <ThreadShellPanel
                    ref={shellPanelRef}
                    threadId={detail.thread.id}
                    showHeader={false}
                    showFloatingToolbox={false}
                    onStateChange={setShellControlState}
                  />
                ) : (
                  <div className="flex min-h-0 flex-1 items-center justify-center p-4 sm:p-6">
                    <div className="max-w-md rounded-[1.6rem] border border-stone-800 bg-stone-950/55 px-6 py-8 text-center">
                      <p className="text-base font-medium text-stone-100">
                        Thread disconnected
                      </p>
                      <p className="mt-3 text-sm leading-6 text-stone-400">
                        Reconnect this thread before creating or attaching a shell.
                      </p>
                    </div>
                  </div>
                )}
                <ThreadComposer
                  activeView={activeView}
                  busy={busy}
                  settingsBusy={false}
                  error={detail.thread.isLoaded ? shellControlState?.error ?? null : null}
                  followTail={false}
                  threadConnected={detail.thread.isLoaded}
                  shellControlState={shellControlState}
                  canInterrupt={Boolean(detail.thread.isLoaded && shellControlState?.isCommandRunning)}
                  onSubmit={handlePrompt}
                  onInterrupt={handleInterrupt}
                  onToggleView={handleToggleView}
                  onShellCopy={handleShellCopy}
                  onShellControl={handleShellControl}
                />
              </>
            )}
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
