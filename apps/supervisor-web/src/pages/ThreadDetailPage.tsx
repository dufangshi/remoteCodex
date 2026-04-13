import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';

import {
  CodexStatusDto,
  ModelOptionDto,
  SandboxModeDto,
  SupervisorSocketServerEnvelope,
  ThreadActionRequestDto,
  ThreadDetailDto,
  ThreadDto,
  ThreadEventEnvelope,
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
  fetchThreadHistoryItemDetail,
  fetchSupervisorHealth,
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
const SUPERVISOR_SOCKET_RECONNECT_DELAY_MS = 1_000;
const SUPERVISOR_HEALTHCHECK_INTERVAL_MS = 2_000;
const SUPERVISOR_CONNECTION_STALE_MS = 5_500;
const ACTIVE_THREAD_REFRESH_INTERVAL_MS = 3_000;
const SOCKET_CONNECTING = 0;
const SOCKET_OPEN = 1;
const SOCKET_CLOSED = 3;
const SANDBOX_MODE_OPTIONS: SandboxModeDto[] = [
  'read-only',
  'workspace-write',
  'danger-full-access',
];

function effectiveSandboxMode(thread: Pick<ThreadDto, 'sandboxMode' | 'approvalMode'>): SandboxModeDto {
  return thread.sandboxMode ?? (thread.approvalMode === 'guarded' ? 'workspace-write' : 'danger-full-access');
}

type RealtimeConnectionStatus =
  | 'checking'
  | 'connected'
  | 'reconnecting'
  | 'offline';

type RealtimeIndicatorStatus = RealtimeConnectionStatus | 'detached';

interface RealtimeConnectionSnapshot {
  status: RealtimeConnectionStatus;
  browserOnline: boolean;
  healthOk: boolean;
  socketOpen: boolean;
  lastHealthyAt: string | null;
}

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

function mergeThreadIntoList(existing: ThreadDto[], thread: ThreadDto) {
  const remaining = existing.filter((entry) => entry.id !== thread.id);
  return [thread, ...remaining];
}

interface OptimisticTurnState {
  id: string;
  serverTurnId: string | null;
  startedAt: string;
  status: 'sending' | 'inProgress' | 'failed';
  error: string | null;
  prompt: string;
  model: string | null;
  reasoningEffort: ThreadDetailDto['thread']['reasoningEffort'];
  reasoningEffortAvailable: boolean | null;
}

interface LocalAnsweredRequestNote {
  id: string;
  turnId: string | null;
  title: string;
  summaryLines: string[];
}

function buildAnsweredRequestNote(
  request: ThreadActionRequestDto | undefined,
  input: { answers: Record<string, { answers: string[] }> },
): LocalAnsweredRequestNote | null {
  if (!request) {
    return null;
  }

  const summaryLines = request.questions
    .map((question) => {
      const answer = input.answers[question.id]?.answers[0]?.trim();
      if (!answer) {
        return null;
      }

      return `${question.header}: ${answer}`;
    })
    .filter((line): line is string => Boolean(line));

  if (summaryLines.length === 0) {
    return null;
  }

  return {
    id: request.id,
    turnId: request.turnId,
    title: request.title,
    summaryLines,
  };
}

function getReasoningEffortAvailability(
  modelOptions: ModelOptionDto[],
  model: string | null,
) {
  if (!model) {
    return null;
  }

  const matchedModel = modelOptions.find((entry) => entry.model === model);
  if (!matchedModel) {
    return null;
  }

  return matchedModel.supportedReasoningEfforts.length > 1;
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

function RealtimeConnectionIcon({
  status,
}: {
  status: RealtimeIndicatorStatus;
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-4.5 w-4.5 fill-none stroke-current"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2.5 6.75A8.22 8.22 0 0 1 8 4.5c2.14 0 4.1.8 5.5 2.25" />
      <path d="M4.75 9a4.95 4.95 0 0 1 6.5 0" />
      <path d="M6.9 11.3a1.9 1.9 0 0 1 2.2 0" />
      {status === 'connected' ? (
        <path d="m6.7 13.2.9.9 1.7-2" />
      ) : status === 'offline' ? (
        <path d="M3 3l10 10" />
      ) : status === 'detached' ? null : (
        <>
          <path d="M11.8 11.1a2.2 2.2 0 0 1-1.8 2.7" />
          <path d="m10.7 11.35 1.3-.55-.55-1.3" />
        </>
      )}
    </svg>
  );
}

function threadConnectionSummary(isLoaded: boolean, connection: RealtimeConnectionSnapshot) {
  if (!isLoaded) {
    return 'Thread disconnected';
  }

  switch (connection.status) {
    case 'connected':
      return 'Realtime updates connected';
    case 'reconnecting':
      return 'Realtime updates reconnecting';
    case 'offline':
      return 'Browser offline';
    case 'checking':
      return 'Checking realtime connection';
  }
}

export function ThreadDetailPage() {
  const { id = '' } = useParams();
  const liveOutputBufferRef = useRef('');
  const liveOutputFrameRef = useRef<number | null>(null);
  const supervisorSocketRef = useRef<WebSocket | null>(null);
  const supervisorReconnectTimerRef = useRef<number | null>(null);
  const supervisorHealthInFlightRef = useRef(false);
  const supervisorHealthOkAtRef = useRef<string | null>(null);
  const supervisorPongAtRef = useRef<number | null>(null);
  const supervisorBrowserOnlineRef = useRef(
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );
  const supervisorRecoveryPendingRef = useRef(false);
  const shellPanelRef = useRef<ThreadShellPanelHandle | null>(null);
  const composerHostRef = useRef<HTMLDivElement | null>(null);
  const loadRequestIdRef = useRef(0);
  const pageContextRequestIdRef = useRef(0);
  const terminalTurnPendingRef = useRef<string | null>(null);
  const detailRef = useRef<ThreadDetailDto | null>(null);
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
  const [mobileKeyboardInset, setMobileKeyboardInset] = useState(0);
  const [mobilePromptFocused, setMobilePromptFocused] = useState(false);
  const [shellControlState, setShellControlState] =
    useState<ThreadShellControlState | null>(null);
  const [pendingShellConnectionToggle, setPendingShellConnectionToggle] =
    useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [respondingRequestId, setRespondingRequestId] = useState<string | null>(null);
  const [metaSessionCopyState, setMetaSessionCopyState] =
    useState<'idle' | 'copied' | 'failed'>('idle');
  const [realtimeConnection, setRealtimeConnection] =
    useState<RealtimeConnectionSnapshot>({
      status: supervisorBrowserOnlineRef.current ? 'checking' : 'offline',
      browserOnline: supervisorBrowserOnlineRef.current,
      healthOk: false,
      socketOpen: false,
      lastHealthyAt: null,
    });
  const [ephemeralUserNote, setEphemeralUserNote] = useState<string | null>(null);
  const [answeredRequestNotes, setAnsweredRequestNotes] = useState<
    LocalAnsweredRequestNote[]
  >([]);
  const [optimisticTurn, setOptimisticTurn] = useState<OptimisticTurnState | null>(null);
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

  const applyDetailResponse = useCallback(
    (detailResponse: ThreadDetailDto) => {
      detailRef.current = detailResponse;
      const threadHasEnded =
        detailResponse.thread.activeTurnId === null &&
        detailResponse.thread.status !== 'running';

      setDetail((current) =>
        current
          ? {
              ...detailResponse,
              turns: appendLatestTurns(current.turns, detailResponse.turns),
            }
          : detailResponse,
      );
      setThreads((current) =>
        mergeThreadIntoList(current, detailResponse.thread),
      );
      setOptimisticTurn((current) => {
        if (!current) {
          return current;
        }

        const resolvedTurnId = current.serverTurnId ?? current.id;
        const hasMaterializedTurn = detailResponse.turns.some(
          (turn) => turn.id === resolvedTurnId,
        );
        return hasMaterializedTurn ? null : current;
      });
      if (
        threadHasEnded ||
        (terminalTurnPendingRef.current &&
          detailResponse.turns.some(
            (turn) => turn.id === terminalTurnPendingRef.current,
          ))
      ) {
        terminalTurnPendingRef.current = null;
        clearBufferedLiveOutput();
        setLiveOutput('');
        setLivePlan(null);
      }
    },
    [clearBufferedLiveOutput],
  );

  useEffect(() => {
    detailRef.current = detail;
  }, [detail]);

  const loadPageContext = useCallback(
    async ({ seedThread }: { seedThread?: ThreadDto | null } = {}) => {
      const requestId = pageContextRequestIdRef.current + 1;
      pageContextRequestIdRef.current = requestId;

      const [threadResult, statusResult, modelResult] = await Promise.allSettled([
        fetchThreads(),
        fetchCodexStatus(),
        fetchCodexModels(),
      ]);

      if (pageContextRequestIdRef.current !== requestId) {
        return;
      }

      if (threadResult.status === 'fulfilled') {
        setThreads(
          seedThread
            ? mergeThreadIntoList(threadResult.value, seedThread)
            : threadResult.value,
        );
      } else if (seedThread) {
        setThreads((current) => mergeThreadIntoList(current, seedThread));
      }

      if (statusResult.status === 'fulfilled') {
        setStatus(statusResult.value);
      }

      if (modelResult.status === 'fulfilled') {
        setModelOptions(modelResult.value);
      }
    },
    [],
  );

  const loadThreadDetail = useCallback(
    async ({
      showLoading = true,
      clearError = true,
      reportError = true,
    }: {
      showLoading?: boolean;
      clearError?: boolean;
      reportError?: boolean;
    } = {}) => {
      const requestId = loadRequestIdRef.current + 1;
      loadRequestIdRef.current = requestId;
      if (showLoading) {
        setLoading(true);
      }
      if (clearError) {
        setError(null);
      }

      try {
        const detailResponse = await fetchThreadDetail(id, {
          limit: DETAIL_TURN_PAGE_SIZE,
        });
        if (loadRequestIdRef.current !== requestId) {
          return;
        }

        applyDetailResponse(detailResponse);
      } catch (caught) {
        if (loadRequestIdRef.current !== requestId || !reportError) {
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
    },
    [applyDetailResponse, id, loadPageContext],
  );

  const syncRealtimeConnectionState = useCallback(() => {
    const socketState = supervisorSocketRef.current?.readyState ?? SOCKET_CLOSED;
    const socketOpen = socketState === SOCKET_OPEN;
    const browserOnline = supervisorBrowserOnlineRef.current;
    const now = Date.now();
    const hasRecentHealth =
      supervisorHealthOkAtRef.current !== null &&
      now - Date.parse(supervisorHealthOkAtRef.current) <= SUPERVISOR_CONNECTION_STALE_MS;
    const hasRecentPong =
      supervisorPongAtRef.current !== null &&
      now - supervisorPongAtRef.current <= SUPERVISOR_CONNECTION_STALE_MS;

    let status: RealtimeConnectionStatus;
    if (!browserOnline) {
      status = 'offline';
    } else if (socketOpen && hasRecentHealth && hasRecentPong) {
      status = 'connected';
    } else if (
      socketState === SOCKET_CONNECTING ||
      supervisorReconnectTimerRef.current !== null ||
      hasRecentHealth ||
      hasRecentPong ||
      supervisorHealthInFlightRef.current
    ) {
      status = 'reconnecting';
    } else {
      status = 'checking';
    }

    setRealtimeConnection((current) => {
      if (
        current.status === status &&
        current.browserOnline === browserOnline &&
        current.healthOk === hasRecentHealth &&
        current.socketOpen === socketOpen &&
        current.lastHealthyAt === supervisorHealthOkAtRef.current
      ) {
        return current;
      }

      return {
        status,
        browserOnline,
        healthOk: hasRecentHealth,
        socketOpen,
        lastHealthyAt: supervisorHealthOkAtRef.current,
      };
    });
  }, []);

  useEffect(() => {
    loadRequestIdRef.current += 1;
    pageContextRequestIdRef.current += 1;
    setDetail(null);
    setChatDraft({
      prompt: '',
      attachments: [],
    });
    setLoadingEarlier(false);
    setMetaSessionCopyState('idle');
    setEphemeralUserNote(null);
    setAnsweredRequestNotes([]);
    setOptimisticTurn(null);
    terminalTurnPendingRef.current = null;
    supervisorHealthOkAtRef.current = null;
    supervisorPongAtRef.current = null;
    supervisorRecoveryPendingRef.current = false;
    supervisorBrowserOnlineRef.current =
      typeof navigator === 'undefined' ? true : navigator.onLine;
    setRealtimeConnection({
      status: supervisorBrowserOnlineRef.current ? 'checking' : 'offline',
      browserOnline: supervisorBrowserOnlineRef.current,
      healthOk: false,
      socketOpen: false,
      lastHealthyAt: null,
    });
  }, [id]);

  useEffect(() => {
    if (metaSessionCopyState === 'idle') {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setMetaSessionCopyState('idle');
    }, metaSessionCopyState === 'copied' ? 1200 : 1600);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [metaSessionCopyState]);

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
      setMobileKeyboardInset(keyboardInset);
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
    if (typeof document === 'undefined') {
      return;
    }

    const updatePromptFocus = () => {
      const activeElement = document.activeElement;
      const host = composerHostRef.current;
      const promptElement = host?.querySelector('[aria-label="Prompt"]');

      setMobilePromptFocused(
        Boolean(
          activeElement &&
            promptElement &&
            (activeElement === promptElement || promptElement.contains(activeElement)),
        ),
      );
    };

    updatePromptFocus();
    document.addEventListener('focusin', updatePromptFocus);
    document.addEventListener('focusout', updatePromptFocus);

    return () => {
      document.removeEventListener('focusin', updatePromptFocus);
      document.removeEventListener('focusout', updatePromptFocus);
    };
  }, [activeView, isMobileViewport]);

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
    void loadThreadDetail({ showLoading: true });
    void loadPageContext();
  }, [loadPageContext, loadThreadDetail]);

  useEffect(() => {
    let isDisposed = false;
    let heartbeatIntervalId: number | null = null;

    const refreshThreadDetailSilently = () => {
      void loadThreadDetail({
        showLoading: false,
        clearError: false,
        reportError: false,
      });
    };

    const clearReconnectTimer = () => {
      if (supervisorReconnectTimerRef.current !== null) {
        window.clearTimeout(supervisorReconnectTimerRef.current);
        supervisorReconnectTimerRef.current = null;
      }
    };

    const scheduleReconnect = () => {
      if (
        isDisposed ||
        !supervisorBrowserOnlineRef.current ||
        supervisorReconnectTimerRef.current !== null
      ) {
        return;
      }

      supervisorReconnectTimerRef.current = window.setTimeout(() => {
        supervisorReconnectTimerRef.current = null;
        if (isDisposed) {
          return;
        }

        connectSocket();
      }, SUPERVISOR_SOCKET_RECONNECT_DELAY_MS);
      syncRealtimeConnectionState();
    };

    const closeSupervisorSocket = () => {
      const activeSocket = supervisorSocketRef.current;
      supervisorSocketRef.current = null;
      if (activeSocket) {
        try {
          activeSocket.close();
        } catch {
          // Ignore socket close errors during reconnect cleanup.
        }
      }
    };

    const handleSocketEvent = (event: ThreadEventEnvelope) => {
      if (event.threadId !== id) {
        return;
      }

      if (
        event.type === 'thread.output.delta' &&
        typeof event.payload.delta === 'string'
      ) {
        const eventTurnId =
          typeof event.payload.turnId === 'string' ? event.payload.turnId : null;
        queueLiveOutputDelta(event.payload.delta);
        if (eventTurnId) {
          setOptimisticTurn((current) =>
            current &&
            (current.serverTurnId === null || current.serverTurnId === eventTurnId)
              ? {
                  ...current,
                  serverTurnId: eventTurnId,
                  id: eventTurnId,
                  status: current.status === 'failed' ? current.status : 'inProgress',
                }
              : current,
          );
        }
      }

      if (event.type === 'thread.context.updated') {
        const nextContextUsage =
          event.payload.contextUsage &&
          typeof event.payload.contextUsage === 'object'
            ? event.payload.contextUsage
            : null;
        if (nextContextUsage) {
          const normalizedContextUsage =
            nextContextUsage as NonNullable<ThreadDto['contextUsage']>;
          setDetail((current) =>
            current
              ? {
                  ...current,
                  thread: {
                    ...current.thread,
                    contextUsage: normalizedContextUsage,
                  },
                }
              : current,
          );
          setThreads((current) =>
            current.map((entry) =>
              entry.id === id
                ? {
                    ...entry,
                    contextUsage: normalizedContextUsage,
                  }
                : entry,
            ),
          );
        }
      }

      if (
        event.type === 'thread.turn.started' ||
        event.type === 'thread.turn.completed' ||
        event.type === 'thread.turn.failed' ||
        event.type === 'thread.updated' ||
        event.type === 'thread.request.created' ||
        event.type === 'thread.request.resolved'
      ) {
        refreshThreadDetailSilently();
        if (event.type === 'thread.turn.started') {
          clearBufferedLiveOutput();
          setLiveOutput('');
          setEphemeralUserNote(null);
          terminalTurnPendingRef.current = null;
          const eventTurnId =
            typeof event.payload.turnId === 'string' ? event.payload.turnId : null;
          if (eventTurnId) {
            setOptimisticTurn((current) =>
              current
                ? {
                    ...current,
                    serverTurnId: eventTurnId,
                    id: eventTurnId,
                    status: current.status === 'failed' ? current.status : 'inProgress',
                    error: null,
                  }
                : current,
            );
          }
        }
        if (
          event.type === 'thread.turn.completed' ||
          event.type === 'thread.turn.failed'
        ) {
          setEphemeralUserNote(null);
          const eventTurnId =
            typeof event.payload.turnId === 'string' ? event.payload.turnId : null;
          if (eventTurnId) {
            terminalTurnPendingRef.current = eventTurnId;
            if (event.type === 'thread.turn.failed') {
              setOptimisticTurn((current) =>
                current &&
                (current.serverTurnId === eventTurnId ||
                  current.id === eventTurnId)
                  ? {
                      ...current,
                      status: 'failed',
                      error:
                        typeof event.payload.error === 'string'
                          ? event.payload.error
                          : 'Unable to complete the turn.',
                    }
                  : current,
              );
            }
          }
        }
        if (event.type === 'thread.request.created') {
          setEphemeralUserNote(null);
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
    };

    const sendSupervisorPing = () => {
      const activeSocket = supervisorSocketRef.current;
      if (!activeSocket || activeSocket.readyState !== SOCKET_OPEN) {
        return;
      }

      try {
        activeSocket.send(
          JSON.stringify({
            type: 'supervisor.ping',
            timestamp: new Date().toISOString(),
          }),
        );
      } catch {
        supervisorRecoveryPendingRef.current = true;
        closeSupervisorSocket();
        scheduleReconnect();
        syncRealtimeConnectionState();
      }
    };

    const connectSocket = () => {
      if (isDisposed || !supervisorBrowserOnlineRef.current) {
        syncRealtimeConnectionState();
        return;
      }

      const socketState = supervisorSocketRef.current?.readyState ?? SOCKET_CLOSED;
      if (socketState === SOCKET_CONNECTING || socketState === SOCKET_OPEN) {
        syncRealtimeConnectionState();
        return;
      }

      const nextSocket = connectSupervisorEvents(handleSocketEvent);
      supervisorSocketRef.current = nextSocket;
      syncRealtimeConnectionState();

      nextSocket.addEventListener('message', (message) => {
        if (supervisorSocketRef.current !== nextSocket) {
          return;
        }

        try {
          const parsed = JSON.parse(
            message.data as string,
          ) as SupervisorSocketServerEnvelope;
          if (
            parsed.type === 'supervisor.connected' ||
            parsed.type === 'supervisor.pong'
          ) {
            supervisorPongAtRef.current = Date.now();
            syncRealtimeConnectionState();
          }
        } catch {
          // Ignore malformed socket payloads.
        }
      });

      nextSocket.addEventListener('open', () => {
        if (supervisorSocketRef.current !== nextSocket) {
          return;
        }

        supervisorRecoveryPendingRef.current = true;
        refreshThreadDetailSilently();
        sendSupervisorPing();
        syncRealtimeConnectionState();
      });

      nextSocket.addEventListener('close', () => {
        if (supervisorSocketRef.current === nextSocket) {
          supervisorSocketRef.current = null;
        }
        supervisorRecoveryPendingRef.current = true;
        scheduleReconnect();
        syncRealtimeConnectionState();
      });

      nextSocket.addEventListener('error', () => {
        if (supervisorSocketRef.current === nextSocket) {
          supervisorSocketRef.current = null;
        }
        supervisorRecoveryPendingRef.current = true;
        scheduleReconnect();
        syncRealtimeConnectionState();
      });
    };

    const runHealthCheck = async () => {
      if (
        isDisposed ||
        !supervisorBrowserOnlineRef.current ||
        supervisorHealthInFlightRef.current
      ) {
        return;
      }

      supervisorHealthInFlightRef.current = true;
      syncRealtimeConnectionState();

      try {
        await fetchSupervisorHealth();
        const shouldRefreshFromRecovery = supervisorRecoveryPendingRef.current;
        supervisorHealthOkAtRef.current = new Date().toISOString();
        if (shouldRefreshFromRecovery) {
          supervisorRecoveryPendingRef.current = false;
          refreshThreadDetailSilently();
        }
        if ((supervisorSocketRef.current?.readyState ?? SOCKET_CLOSED) !== SOCKET_OPEN) {
          connectSocket();
        }
      } catch {
        supervisorHealthOkAtRef.current = null;
        supervisorRecoveryPendingRef.current = true;
        scheduleReconnect();
      } finally {
        supervisorHealthInFlightRef.current = false;
        syncRealtimeConnectionState();
      }
    };

    const handleBrowserOnline = () => {
      supervisorBrowserOnlineRef.current = true;
      supervisorRecoveryPendingRef.current = true;
      syncRealtimeConnectionState();
      connectSocket();
      void runHealthCheck();
    };

    const handleBrowserOffline = () => {
      supervisorBrowserOnlineRef.current = false;
      supervisorHealthOkAtRef.current = null;
      supervisorPongAtRef.current = null;
      supervisorRecoveryPendingRef.current = true;
      clearReconnectTimer();
      closeSupervisorSocket();
      syncRealtimeConnectionState();
    };

    const runHeartbeat = () => {
      if (isDisposed || !supervisorBrowserOnlineRef.current) {
        syncRealtimeConnectionState();
        return;
      }

      const socketState = supervisorSocketRef.current?.readyState ?? SOCKET_CLOSED;
      const lastPongAge =
        supervisorPongAtRef.current === null
          ? null
          : Date.now() - supervisorPongAtRef.current;

      if (
        socketState === SOCKET_OPEN &&
        lastPongAge !== null &&
        lastPongAge > SUPERVISOR_CONNECTION_STALE_MS
      ) {
        supervisorRecoveryPendingRef.current = true;
        closeSupervisorSocket();
        scheduleReconnect();
      } else if (socketState === SOCKET_OPEN) {
        sendSupervisorPing();
      } else if (socketState !== SOCKET_CONNECTING) {
        connectSocket();
      }

      void runHealthCheck();
      syncRealtimeConnectionState();
    };

    window.addEventListener('online', handleBrowserOnline);
    window.addEventListener('offline', handleBrowserOffline);
    connectSocket();
    void runHealthCheck();
    heartbeatIntervalId = window.setInterval(
      runHeartbeat,
      SUPERVISOR_HEALTHCHECK_INTERVAL_MS,
    );

    return () => {
      isDisposed = true;
      window.removeEventListener('online', handleBrowserOnline);
      window.removeEventListener('offline', handleBrowserOffline);
      clearReconnectTimer();
      if (heartbeatIntervalId !== null) {
        window.clearInterval(heartbeatIntervalId);
      }
      clearBufferedLiveOutput();
      closeSupervisorSocket();
    };
  }, [
    clearBufferedLiveOutput,
    id,
    loadThreadDetail,
    queueLiveOutputDelta,
    syncRealtimeConnectionState,
  ]);

  useEffect(() => {
    const shouldPollForTurnUpdates =
      detail?.thread.activeTurnId !== null ||
      detail?.thread.status === 'running' ||
      optimisticTurn !== null ||
      liveOutput.length > 0 ||
      livePlan !== null;

    if (!shouldPollForTurnUpdates) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void loadThreadDetail({
        showLoading: false,
        clearError: false,
        reportError: false,
      });
    }, ACTIVE_THREAD_REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [
    detail?.thread.activeTurnId,
    detail?.thread.status,
    liveOutput.length,
    livePlan,
    loadThreadDetail,
    optimisticTurn,
  ]);

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
    setEphemeralUserNote(null);
    setScrollRequestKey((current) => current + 1);
    const optimisticTurnId = `optimistic-${Date.now()}`;
    const optimisticStartedAt = new Date().toISOString();
    const activeDetail = detailRef.current;
    const optimisticModel = activeDetail?.thread.model ?? null;
    const optimisticReasoningEffort = activeDetail?.thread.reasoningEffort ?? null;
    setOptimisticTurn({
      id: optimisticTurnId,
      serverTurnId: null,
      startedAt: optimisticStartedAt,
      status: 'sending',
      error: null,
      prompt: input.prompt,
      model: optimisticModel,
      reasoningEffort: optimisticReasoningEffort,
      reasoningEffortAvailable: getReasoningEffortAvailability(
        modelOptions,
        optimisticModel,
      ),
    });

    try {
      let currentDetail = detailRef.current;
      if (currentDetail && !currentDetail.thread.isLoaded) {
        const resumed = await resumeThread(
          id,
          {
            ...(currentDetail.thread.model ? { model: currentDetail.thread.model } : {}),
            ...(currentDetail.thread.sandboxMode
              ? { sandboxMode: currentDetail.thread.sandboxMode }
              : {}),
          },
        );
        currentDetail = resumed;
        detailRef.current = resumed;
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
        ...(currentDetail?.thread.sandboxMode
          ? { sandboxMode: currentDetail.thread.sandboxMode }
          : {}),
        ...(input.attachments?.length ? { attachments: input.attachments } : {}),
      };
      const thread = await sendThreadPrompt(id, promptInput);
      setDetail((current) => (current ? { ...current, thread } : current));
      setThreads((current) =>
        current.map((entry) => (entry.id === thread.id ? thread : entry)),
      );
      setOptimisticTurn((current) =>
        current && current.id === optimisticTurnId
          ? {
              ...current,
              id: thread.activeTurnId ?? current.id,
              serverTurnId: thread.activeTurnId ?? current.serverTurnId,
              status: 'inProgress',
              error: null,
            }
          : current,
      );
      setLivePlan(null);
      setChatDraft({
        prompt: '',
        attachments: [],
      });
    } catch (caught) {
      const message =
        caught instanceof ApiError
          ? caught.payload.message
          : caught instanceof Error
            ? caught.message
            : 'Unable to send prompt.';
      if (caught instanceof ApiError) {
        setError(caught.payload.message);
      } else {
        setError(message);
      }
      setOptimisticTurn((current) =>
        current && current.id === optimisticTurnId
          ? {
              ...current,
              status: 'failed',
              error: message,
            }
          : current,
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleCopyMetaSessionId() {
    const sessionId = detail?.thread.codexThreadId;
    if (!sessionId) {
      return;
    }

    try {
      await navigator.clipboard.writeText(sessionId);
      setMetaSessionCopyState('copied');
    } catch {
      setMetaSessionCopyState('failed');
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
        {
          ...(detail.thread.model ? { model: detail.thread.model } : {}),
          ...(detail.thread.sandboxMode
            ? { sandboxMode: detail.thread.sandboxMode }
            : {}),
        },
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

  async function handleUpdateThreadSettings(input: {
    model?: string;
    reasoningEffort?: ThreadDto['reasoningEffort'];
    collaborationMode?: ThreadDto['collaborationMode'];
    sandboxMode?: ThreadDto['sandboxMode'];
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
      ...(input.sandboxMode !== undefined
        ? { sandboxMode: input.sandboxMode }
        : {}),
    };

    setSettingsBusy(true);
    detailRef.current = {
      ...detail,
      thread: optimisticThread,
    };
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
      const updated = await updateThreadSettings(id, {
        ...(input.model !== undefined ? { model: input.model } : {}),
        ...(input.reasoningEffort !== undefined
          ? { reasoningEffort: input.reasoningEffort }
          : {}),
        ...(input.collaborationMode !== undefined
          ? { collaborationMode: input.collaborationMode }
          : {}),
        ...(input.sandboxMode !== undefined
          ? { sandboxMode: input.sandboxMode }
          : {}),
      });
      detailRef.current = previousDetail
        ? {
            ...previousDetail,
            thread: updated,
          }
        : null;
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
      detailRef.current = previousDetail;
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
    const request = detail?.pendingRequests.find((entry) => entry.id === requestId);
    const answeredRequestNote = buildAnsweredRequestNote(request, input);
    setRespondingRequestId(requestId);
    setError(null);

    try {
      const selectedAnswer = Object.values(input.answers)[0]?.answers[0]?.trim().toLowerCase();
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
      setEphemeralUserNote(
        selectedAnswer === 'stay in plan mode'
          ? 'User kept plan mode active and will provide further details.'
          : null,
      );
      if (answeredRequestNote) {
        setAnsweredRequestNotes((current) => {
          const next = [
            ...current.filter((entry) => entry.id !== answeredRequestNote.id),
            answeredRequestNote,
          ];
          return next.slice(-4);
        });
      }
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

  useEffect(() => {
    if (activeView !== 'shell') {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      shellPanelRef.current?.refreshLayout({ focus: true });
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [activeView]);

  const promptDisabledReason = detail
    ? detail.workspacePathStatus === 'missing'
      ? 'Restore this workspace path on the current machine before continuing.'
      : null
    : null;
  const useFloatingMobileComposer = isMobileViewport && activeView === 'chat';
  const floatingMobileComposerBottomOffset =
    useFloatingMobileComposer && mobilePromptFocused ? mobileKeyboardInset : 0;
  const effectiveMobileComposerHeight = Math.max(mobileComposerHeight, 144);
  const timelineBottomSpacer = useFloatingMobileComposer
    ? effectiveMobileComposerHeight + 12
    : 0;

  const metaContent = detail ? (
    <dl className="space-y-4 text-sm">
      <div className="relative pr-9">
        <dt className="text-stone-500">Session ID</dt>
        <dd className="mt-1 break-all text-stone-100">
          {detail.thread.codexThreadId ?? 'Unavailable'}
        </dd>
        {detail.thread.codexThreadId && (
          <button
            type="button"
            aria-label="Copy Codex session ID"
            title={
              metaSessionCopyState === 'copied'
                ? 'Copied'
                : metaSessionCopyState === 'failed'
                  ? 'Copy failed'
                  : 'Copy Codex session ID'
            }
            onClick={() => void handleCopyMetaSessionId()}
            className={`absolute bottom-0 right-0 inline-flex h-5 w-5 items-center justify-center rounded-full border shadow-sm shadow-stone-950/25 backdrop-blur transition ${
              metaSessionCopyState === 'copied'
                ? 'border-sky-300/40 bg-sky-300/16 text-sky-100'
                : metaSessionCopyState === 'failed'
                  ? 'border-rose-300/35 bg-rose-300/12 text-rose-100'
                  : 'border-stone-700/90 bg-stone-900/60 text-stone-300 hover:bg-stone-800/92'
            }`}
          >
            <span className="scale-[0.72]">
              <CopyIcon />
            </span>
          </button>
        )}
      </div>
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

  const settingsContent = detail ? (
    <div className="space-y-3">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-stone-500">
          Sandbox Mode
        </p>
        <div className="mt-2 space-y-1.5">
          {SANDBOX_MODE_OPTIONS.map((entry) => {
            const selected = effectiveSandboxMode(detail.thread) === entry;
            return (
              <button
                key={entry}
                type="button"
                disabled={settingsBusy}
                onClick={() => void handleUpdateThreadSettings({ sandboxMode: entry })}
                className={`block w-full rounded-xl border px-3 py-2 text-left text-sm transition ${
                  selected
                    ? 'border-amber-300/35 bg-amber-300/12 text-stone-100'
                    : 'border-stone-800 bg-stone-950/40 text-stone-300 hover:bg-stone-800/80'
                } disabled:cursor-not-allowed disabled:opacity-60`}
              >
                {entry}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  ) : null;

  const timelineOptimisticTurn =
    optimisticTurn &&
    !detail?.turns.some(
      (turn) => turn.id === (optimisticTurn.serverTurnId ?? optimisticTurn.id),
    )
      ? {
          id: optimisticTurn.id,
          startedAt: optimisticTurn.startedAt,
          status: optimisticTurn.status,
          error: optimisticTurn.error,
          model: optimisticTurn.model,
          reasoningEffort: optimisticTurn.reasoningEffort,
          reasoningEffortAvailable: optimisticTurn.reasoningEffortAvailable,
          items: [
            {
              id: `${optimisticTurn.id}-user-message`,
              kind: 'userMessage' as const,
              text: optimisticTurn.prompt,
            },
          ],
        }
      : null;

  const threadLoaded = detail?.thread.isLoaded ?? false;
  const realtimeConnectionIndicatorClassName =
    !threadLoaded
      ? 'border border-stone-700/90 bg-stone-900/85 text-stone-400 shadow-lg shadow-stone-950/20'
      : realtimeConnection.status === 'connected'
      ? 'border border-emerald-300/55 bg-emerald-400 text-emerald-950 shadow-lg shadow-emerald-950/25'
      : realtimeConnection.status === 'reconnecting'
        ? 'thread-live-connection-reconnecting border border-emerald-300/34 bg-emerald-300/18 text-emerald-50 shadow-lg shadow-stone-950/20'
        : realtimeConnection.status === 'offline'
          ? 'border border-rose-300/35 bg-rose-300/12 text-rose-100 shadow-lg shadow-stone-950/20'
          : 'border border-amber-300/28 bg-amber-300/14 text-amber-50 shadow-lg shadow-stone-950/20';
  const realtimeConnectionLabel = threadConnectionSummary(
    threadLoaded,
    realtimeConnection,
  );
  const realtimeConnectionTitle = [
    realtimeConnectionLabel,
    !threadLoaded ? 'Tap to connect this thread' : null,
    realtimeConnection.lastHealthyAt
      ? `Last healthy ${formatLongTimestamp(realtimeConnection.lastHealthyAt)}`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const mobileSessionConnectionButton = !threadLoaded ? (
    <button
      type="button"
      onClick={() => void handleThreadConnectionToggle()}
      disabled={busy || !detail}
      aria-label={busy ? 'Connecting thread' : 'Connect thread'}
      title={busy ? 'Connecting thread' : realtimeConnectionTitle}
      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition ${realtimeConnectionIndicatorClassName}`}
    >
      <RealtimeConnectionIcon status="detached" />
    </button>
  ) : (
    <div
      role="status"
      aria-live="polite"
      aria-label={realtimeConnectionLabel}
      title={realtimeConnectionTitle}
      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition ${realtimeConnectionIndicatorClassName}`}
    >
      <RealtimeConnectionIcon status={realtimeConnection.status} />
    </div>
  );
  const desktopSessionConnectionIndicator = !threadLoaded ? (
    <button
      type="button"
      onClick={() => void handleThreadConnectionToggle()}
      disabled={busy || !detail}
      title={busy ? 'Connecting thread' : realtimeConnectionTitle}
      className={`hidden lg:inline-flex h-9 w-9 items-center justify-center rounded-full transition ${realtimeConnectionIndicatorClassName}`}
    >
      <RealtimeConnectionIcon status="detached" />
    </button>
  ) : (
    <div
      title={realtimeConnectionTitle}
      className={`hidden lg:inline-flex h-9 w-9 items-center justify-center rounded-full transition ${realtimeConnectionIndicatorClassName}`}
    >
      <RealtimeConnectionIcon status={realtimeConnection.status} />
    </div>
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
      settingsContent={settingsContent}
      showMobileNewThreadShortcut={false}
      mobileHeaderAction={mobileSessionConnectionButton}
      onRenameThread={handleRenameThread}
    >
      <div className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-none border-y border-stone-800 bg-stone-900/85 shadow-2xl shadow-stone-950/20 sm:flex-none sm:rounded-[2rem] sm:border">
        <div className="pointer-events-none absolute right-4 top-4 z-30 hidden lg:block">
          <div className="pointer-events-auto">
            {desktopSessionConnectionIndicator}
          </div>
        </div>
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
            <>
              <div
                className={
                  activeView === 'chat'
                    ? 'flex min-h-0 flex-1 flex-col'
                    : 'hidden'
                }
              >
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
                  onLoadHistoryItemDetail={(itemId) =>
                    fetchThreadHistoryItemDetail(detail.thread.id, itemId)
                  }
                  ephemeralUserNote={ephemeralUserNote}
                  answeredRequestNotes={answeredRequestNotes}
                  optimisticTurn={timelineOptimisticTurn}
                />
                {useFloatingMobileComposer ? (
                  <div
                    ref={composerHostRef}
                    className="fixed inset-x-0 bottom-0 z-30 sm:hidden"
                    style={{
                      bottom: `${floatingMobileComposerBottomOffset}px`,
                      paddingBottom: 'env(safe-area-inset-bottom)',
                    }}
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
                      contextUsage={detail.thread.contextUsage}
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
                      contextUsage={detail.thread.contextUsage}
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
              </div>
              <div
                className={
                  activeView === 'shell'
                    ? 'flex min-h-0 flex-1 flex-col'
                    : 'hidden'
                }
              >
                {detail.thread.isLoaded && (
                  <ThreadShellPanel
                    ref={shellPanelRef}
                    threadId={detail.thread.id}
                    isVisible={activeView === 'shell'}
                    showHeader={false}
                    showFloatingToolbox={false}
                    onStateChange={setShellControlState}
                  />
                )}
                {activeView === 'shell' && !detail.thread.isLoaded && (
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
                {activeView === 'shell' && (
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
                )}
              </div>
            </>
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
