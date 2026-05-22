import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import {
  AgentProviderCapabilitiesDto,
  AgentBackendManagementSchemaDto,
  AgentRuntimeStatusDto,
  ModelOptionDto,
  SandboxModeDto,
  SupervisorSocketServerEnvelope,
  ThreadDetailDto,
  ThreadExportTurnOptionsDto,
  ThreadHooksDto,
  ThreadHistoryItemDto,
  ThreadMcpServersDto,
  ThreadSkillsDto,
  ThreadDto,
  ThreadEventEnvelope,
  ThreadForkTurnOptionDto,
  ThreadTurnPriceEstimateDto,
  ThreadTurnTokenUsageDto,
} from '../../../../packages/shared/src/index';
import { ExportTranscriptDialog } from '../components/ExportTranscriptDialog';
import { ConfirmDialog } from '../components/ConfirmDialog';
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
  buildThreadPdfExportUrl,
  compactThread,
  connectSupervisorEvents,
  createThreadHook,
  clearThreadGoal,
  disconnectThread,
  downloadThreadTranscriptExport,
  deleteThread,
  fetchAgentBackendModels,
  fetchAgentBackendStatus,
  fetchProviderHostFile,
  fetchThreadForkTurns,
  fetchThreadGoal,
  fetchThreadHooks,
  fetchThreadMcpServers,
  fetchThreadHistoryItemDetail,
  fetchThreadSkills,
  fetchSupervisorHealth,
  fetchThreads,
  fetchThreadDetail,
  fetchThreadExportTurns,
  forkThread,
  interruptThread,
  respondToThreadRequest,
  resumeThread,
  sendThreadPrompt,
  type PromptAttachmentUpload,
  type SendThreadPromptRequestInput,
  trustThreadHook,
  updateThread,
  updateProviderHostFile,
  updateThreadGoal,
  updateThreadHook,
  updateThreadSettings,
  untrustThreadHook,
} from '../lib/api';

const INITIAL_DETAIL_TURN_PAGE_SIZE = 3;
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

function truncateDialogThreadTitle(title: string) {
  const normalized = title.replace(/\s+/g, ' ').trim();
  const characters = Array.from(normalized);
  if (characters.length <= 15) {
    return normalized;
  }

  return `${characters.slice(0, 15).join('')}...`;
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

function mergePendingRequestIntoDetail(
  detail: ThreadDetailDto,
  request: ThreadDetailDto['pendingRequests'][number],
): ThreadDetailDto {
  return {
    ...detail,
    pendingRequests: [
      ...detail.pendingRequests.filter((entry) => entry.id !== request.id),
      request,
    ],
  };
}

function removePendingRequestFromDetail(
  detail: ThreadDetailDto,
  requestId: string,
): ThreadDetailDto {
  const pendingRequests = detail.pendingRequests.filter(
    (entry) => entry.id !== requestId,
  );
  return pendingRequests.length === detail.pendingRequests.length
    ? detail
    : {
        ...detail,
        pendingRequests,
      };
}

function mergePendingRequests(
  current: ThreadDetailDto['pendingRequests'],
  incoming: ThreadDetailDto['pendingRequests'],
  resolvedRequestIds: ReadonlySet<string>,
) {
  const filteredIncoming = incoming.filter(
    (request) => !resolvedRequestIds.has(request.id),
  );
  const filteredCurrent = current.filter(
    (request) => !resolvedRequestIds.has(request.id),
  );

  if (filteredCurrent.length === 0) {
    return filteredIncoming;
  }

  const incomingById = new Map(
    filteredIncoming.map((request) => [request.id, request] as const),
  );
  const merged = [
    ...filteredCurrent.map((request) => incomingById.get(request.id) ?? request),
    ...filteredIncoming.filter(
      (request) => !filteredCurrent.some((entry) => entry.id === request.id),
    ),
  ];

  return merged.sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
}

function isThreadActionRequest(
  value: unknown,
): value is ThreadDetailDto['pendingRequests'][number] {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const request = value as Partial<ThreadDetailDto['pendingRequests'][number]>;
  return (
    typeof request.id === 'string' &&
    (request.kind === 'requestUserInput' || request.kind === 'planDecision') &&
    typeof request.title === 'string' &&
    typeof request.createdAt === 'string' &&
    Array.isArray(request.questions)
  );
}

function mergeLiveHistoryItem(
  current: ThreadHistoryItemDto | undefined,
  incoming: ThreadHistoryItemDto,
): ThreadHistoryItemDto {
  if (!current || current.kind !== incoming.kind) {
    return incoming;
  }

  if (current.kind === 'agentMessage' && incoming.kind === 'agentMessage') {
    return current.text.length > incoming.text.length
      ? {
          ...incoming,
          text: current.text,
          sequence: incoming.sequence ?? current.sequence ?? null,
        }
      : incoming;
  }

  const currentText = current.detailText?.trim() || current.text.trim();
  const incomingText = incoming.detailText?.trim() || incoming.text.trim();
  return currentText.length > incomingText.length ? current : incoming;
}

function reconcileLiveItemsWithDetail(
  current: NonNullable<ThreadDetailDto['liveItems']> | null,
  incoming: NonNullable<ThreadDetailDto['liveItems']> | null,
  turns: ThreadDetailDto['turns'],
): NonNullable<ThreadDetailDto['liveItems']> | null {
  if (!current) {
    return incoming;
  }

  if (incoming && incoming.turnId !== current.turnId) {
    return incoming;
  }

  const materializedTurn = turns.find((turn) => turn.id === current.turnId);
  const materializedItemsById = new Map(
    materializedTurn?.items.map((item) => [item.id, item]) ?? [],
  );
  const materializedAgentTexts =
    materializedTurn?.items
      .filter((item) => item.kind === 'agentMessage')
      .map((item) => item.text.trim())
      .filter(Boolean) ?? [];
  const isCoveredByMaterializedAgentText = (item: ThreadHistoryItemDto) =>
    item.kind === 'agentMessage' &&
    item.text.trim().length > 0 &&
    materializedAgentTexts.some((text) => text.includes(item.text.trim()));

  if (!incoming) {
    const remainingItems = current.items.filter((item) => {
      const materialized = materializedItemsById.get(item.id);
      if (!materialized) {
        return !isCoveredByMaterializedAgentText(item);
      }
      return materialized.kind !== item.kind;
    });
    return remainingItems.length === 0
      ? null
      : {
          ...current,
          items: remainingItems,
        };
  }

  const currentItemsById = new Map(current.items.map((item) => [item.id, item]));
  const incomingItemsById = new Map(incoming.items.map((item) => [item.id, item]));
  const orderedIds = [
    ...current.items.map((item) => item.id),
    ...incoming.items
      .map((item) => item.id)
      .filter((id) => !currentItemsById.has(id)),
  ];
  const items = orderedIds
    .map((id) => {
      const incomingItem = incomingItemsById.get(id);
      const currentItem = currentItemsById.get(id);
      if (!incomingItem) {
        const materialized = materializedItemsById.get(id);
        if (!materialized && currentItem && isCoveredByMaterializedAgentText(currentItem)) {
          return null;
        }
        return materialized?.kind === currentItem?.kind ? null : currentItem ?? null;
      }
      return mergeLiveHistoryItem(currentItem, incomingItem);
    })
    .filter((item): item is ThreadHistoryItemDto => Boolean(item));

  return items.length === 0
    ? null
    : {
        turnId: incoming.turnId,
        items,
        updatedAt:
          incoming.updatedAt.localeCompare(current.updatedAt) >= 0
            ? incoming.updatedAt
            : current.updatedAt,
      };
}

function mergeThreadIntoList(existing: ThreadDto[], thread: ThreadDto) {
  const remaining = existing.filter((entry) => entry.id !== thread.id);
  return [thread, ...remaining];
}

function goalKey(goal: NonNullable<ThreadDetailDto['goal']>) {
  return `${goal.threadId}:${goal.objective}:${goal.createdAt}`;
}

function mergeGoalEntry(
  existing: NonNullable<ThreadDetailDto['goal']>,
  incoming: NonNullable<ThreadDetailDto['goal']>,
) {
  const existingUpdatedAt = Date.parse(existing.updatedAt) || 0;
  const incomingUpdatedAt = Date.parse(incoming.updatedAt) || 0;
  const latest = incomingUpdatedAt >= existingUpdatedAt ? incoming : existing;
  const fallback = latest === incoming ? existing : incoming;
  return {
    ...latest,
    localGoalId: latest.localGoalId ?? fallback.localGoalId ?? null,
  };
}

function normalizeGoalHistory(
  goals: NonNullable<ThreadDetailDto['goalHistory']>,
) {
  const byKey = new Map<string, NonNullable<ThreadDetailDto['goal']>>();
  for (const goal of goals) {
    const key = goalKey(goal);
    const existing = byKey.get(key);
    byKey.set(key, existing ? mergeGoalEntry(existing, goal) : goal);
  }
  return [...byKey.values()].sort(
    (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
  );
}

function mergeGoalHistory(
  existing: NonNullable<ThreadDetailDto['goalHistory']>,
  goal: NonNullable<ThreadDetailDto['goal']>,
) {
  return normalizeGoalHistory([goal, ...existing]);
}

function formatGoalTokenUsage(goal: NonNullable<ThreadDetailDto['goal']>) {
  const formatter = new Intl.NumberFormat(undefined, {
    notation: 'compact',
    maximumFractionDigits: 1,
  });
  return goal.tokenBudget === null
    ? `${formatter.format(goal.tokensUsed)} tok`
    : `${formatter.format(goal.tokensUsed)}/${formatter.format(goal.tokenBudget)} tok`;
}

function formatGoalRuntime(seconds: number) {
  const minutes = Math.max(0, Math.floor(seconds / 60));
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return hours > 0 ? `${hours}h ${remainingMinutes}m` : `${minutes}m`;
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
  tokenUsage: ThreadTurnTokenUsageDto | null;
  priceEstimate: ThreadTurnPriceEstimateDto | null;
}

interface OptimisticSteerState {
  id: string;
  clientRequestId: string;
  turnId: string;
  prompt: string;
  createdAt: string;
  status: 'steering' | 'accepted';
}

interface SlashPanelState<T> {
  status: 'idle' | 'loading' | 'ready' | 'failed';
  data: T | null;
  error: string | null;
}

type PendingThreadSettings = Partial<
  Pick<
    ThreadDto,
    'model' | 'reasoningEffort' | 'fastMode' | 'collaborationMode' | 'sandboxMode'
  >
>;

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

function createClientRequestId() {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }

  return `client-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function turnHasUserMessage(
  turn: ThreadDetailDto['turns'][number] | undefined,
  prompt: string,
) {
  return (
    turn?.items.some(
      (item) => item.kind === 'userMessage' && item.text.trim() === prompt,
    ) ?? false
  );
}

function promptWithoutPhotoTokens(prompt: string) {
  return prompt.replace(/\s*\[PHOTO\s+[^\]]+\]\s*/g, ' ').replace(/\s+/g, ' ').trim();
}

function turnHasPhotoPromptText(
  turn: ThreadDetailDto['turns'][number] | undefined,
  prompt: string,
) {
  const normalizedPrompt = promptWithoutPhotoTokens(prompt);
  if (!normalizedPrompt) {
    return false;
  }

  return (
    turn?.items.some(
      (item) =>
        item.kind === 'userMessage' &&
        promptWithoutPhotoTokens(item.text) === normalizedPrompt,
    ) ?? false
  );
}

function turnHasPhotoAttachment(
  turn: ThreadDetailDto['turns'][number] | undefined,
) {
  return (
    turn?.items.some(
      (item) =>
        item.kind === 'userMessage' &&
        /\[PHOTO\s+\.\/\.temp\/threads\/[^\]]+\]/.test(item.text),
    ) ?? false
  );
}

function findTurnWithUserMessage(
  turns: ThreadDetailDto['turns'],
  prompt: string,
) {
  return (
    turns.find((turn) => turnHasUserMessage(turn, prompt)) ??
    (prompt.includes('[PHOTO ')
      ? turns.find((turn) => turnHasPhotoPromptText(turn, prompt)) ?? null
      : null)
  );
}

function mergeTurnTokenUsage(
  turns: ThreadDetailDto['turns'],
  turnId: string,
  tokenUsage: ThreadTurnTokenUsageDto,
  priceEstimate: ThreadTurnPriceEstimateDto | null,
) {
  let changed = false;
  const nextTurns = turns.map((turn) => {
    if (turn.id !== turnId) {
      return turn;
    }

    changed = true;
    return {
      ...turn,
      tokenUsage,
      priceEstimate,
    };
  });

  return changed ? nextTurns : turns;
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

function ExportIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-4 w-4 fill-none stroke-current"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4.25 2.25h5.2l2.3 2.3v9.2h-7.5a2 2 0 0 1-2-2v-7.5a2 2 0 0 1 2-2Z" />
      <path d="M9.25 2.5v2.25h2.25" />
      <path d="M7 6.75v4" />
      <path d="m5.45 9.35 1.55 1.55 1.55-1.55" />
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
  const navigate = useNavigate();
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
  const pageContextProviderRef = useRef<ThreadDto['provider'] | null>(null);
  const terminalTurnPendingRef = useRef<string | null>(null);
  const backgroundHistoryCursorRef = useRef<{
    threadId: string;
    beforeTurnId: string;
  } | null>(null);
  const backgroundHistoryLoadingRef = useRef(false);
  const detailRef = useRef<ThreadDetailDto | null>(null);
  const pendingThreadSettingsRef = useRef<PendingThreadSettings | null>(null);
  const resolvedRequestIdsRef = useRef<Set<string>>(new Set());
  const [detail, setDetail] = useState<ThreadDetailDto | null>(null);
  const [threads, setThreads] = useState<ThreadDto[]>([]);
  const [modelOptions, setModelOptions] = useState<ModelOptionDto[]>([]);
  const [status, setStatus] = useState<AgentRuntimeStatusDto | null>(null);
  const [backendCapabilities, setBackendCapabilities] = useState<AgentProviderCapabilitiesDto | null>(null);
  const [backendManagementSchema, setBackendManagementSchema] =
    useState<AgentBackendManagementSchemaDto | null>(null);
  const [liveOutput, setLiveOutput] = useState('');
  const [livePlan, setLivePlan] = useState<{
    turnId: string;
    explanation: string | null;
    plan: Array<{ step: string; status: string }>;
  } | null>(null);
  const [liveItems, setLiveItems] = useState<
    NonNullable<ThreadDetailDto['liveItems']> | null
  >(null);
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
  const [mobileComposerOverlap, setMobileComposerOverlap] = useState(0);
  const [mobileKeyboardInset, setMobileKeyboardInset] = useState(0);
  const [mobilePromptFocused, setMobilePromptFocused] = useState(false);
  const [shellControlState, setShellControlState] =
    useState<ThreadShellControlState | null>(null);
  const [pendingShellConnectionToggle, setPendingShellConnectionToggle] =
    useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [compactBusy, setCompactBusy] = useState(false);
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
  const [optimisticTurn, setOptimisticTurn] = useState<OptimisticTurnState | null>(null);
  const [optimisticSteers, setOptimisticSteers] = useState<OptimisticSteerState[]>(
    [],
  );
  const [skillsState, setSkillsState] = useState<SlashPanelState<ThreadSkillsDto>>({
    status: 'idle',
    data: null,
    error: null,
  });
  const [mcpState, setMcpState] = useState<SlashPanelState<ThreadMcpServersDto>>({
    status: 'idle',
    data: null,
    error: null,
  });
  const [hooksState, setHooksState] = useState<SlashPanelState<ThreadHooksDto>>({
    status: 'idle',
    data: null,
    error: null,
  });
  const [forkTurnOptionsState, setForkTurnOptionsState] = useState<
    SlashPanelState<ThreadForkTurnOptionDto[]>
  >({
    status: 'idle',
    data: null,
    error: null,
  });
  const [goalState, setGoalState] = useState<
    SlashPanelState<ThreadDetailDto['goal']>
  >({
    status: 'idle',
    data: null,
    error: null,
  });
  const [goalMonitorOpen, setGoalMonitorOpen] = useState(false);
  const [goalActionBusy, setGoalActionBusy] = useState(false);
  const [expandedGoalIds, setExpandedGoalIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportTurnsState, setExportTurnsState] = useState<
    SlashPanelState<ThreadExportTurnOptionsDto>
  >({
    status: 'idle',
    data: null,
    error: null,
  });
  const [deletingThread, setDeletingThread] = useState<ThreadDto | null>(null);
  const [deletingThreadBusy, setDeletingThreadBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mcpProviderConfigFileName =
    backendManagementSchema?.hostConfigFiles.find((file) => file.roles?.includes('mcp'))
      ?.name ?? null;

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

  const upsertLiveTimelineItem = useCallback(
    (turnId: string, item: ThreadHistoryItemDto) => {
      setLiveItems((current) => {
        const currentItems =
          current?.turnId === turnId ? current.items : [];
        const nextItems = [
          ...currentItems.filter((entry) => entry.id !== item.id),
          item,
        ];
        return {
          turnId,
          items: nextItems,
          updatedAt: new Date().toISOString(),
        };
      });
    },
    [],
  );

  const appendLiveAgentDelta = useCallback(
    (turnId: string, itemId: string, delta: string, sequence: number | null) => {
      setLiveItems((current) => {
        const currentItems =
          current?.turnId === turnId ? current.items : [];
        const existing = currentItems.find((item) => item.id === itemId);
        const nextItem: ThreadHistoryItemDto =
          existing?.kind === 'agentMessage'
            ? {
                ...existing,
                text: `${existing.text}${delta}`,
                sequence: sequence ?? existing.sequence ?? null,
              }
            : {
                id: itemId,
                kind: 'agentMessage',
                text: delta,
                sequence,
              };
        return {
          turnId,
          items: [
            ...currentItems.filter((item) => item.id !== itemId),
            nextItem,
          ],
          updatedAt: new Date().toISOString(),
        };
      });
    },
    [],
  );

  const clearBufferedLiveOutput = useCallback(() => {
    liveOutputBufferRef.current = '';
    if (liveOutputFrameRef.current !== null) {
      window.cancelAnimationFrame(liveOutputFrameRef.current);
      liveOutputFrameRef.current = null;
    }
  }, []);

  useEffect(() => {
    setSkillsState({
      status: 'idle',
      data: null,
      error: null,
    });
    setMcpState({
      status: 'idle',
      data: null,
      error: null,
    });
    setHooksState({
      status: 'idle',
      data: null,
      error: null,
    });
    setForkTurnOptionsState({
      status: 'idle',
      data: null,
      error: null,
    });
    setGoalState({
      status: 'idle',
      data: null,
      error: null,
    });
    setExportDialogOpen(false);
    setExportTurnsState({
      status: 'idle',
      data: null,
      error: null,
    });
  }, [id]);

  const loadExportTurns = useCallback(async () => {
    if (!id) {
      return;
    }

    setExportTurnsState((current) => ({
      status: 'loading',
      data: current.data,
      error: null,
    }));

    try {
      const next = await fetchThreadExportTurns(id);
      setExportTurnsState({
        status: 'ready',
        data: next,
        error: null,
      });
    } catch (requestError) {
      const message =
        requestError instanceof ApiError
          ? requestError.payload.message
          : 'Unable to load export turns.';
      setExportTurnsState((current) => ({
        status: 'failed',
        data: current.data,
        error: message,
      }));
    }
  }, [id]);

  async function handleExportTranscript(input: Parameters<typeof buildThreadPdfExportUrl>[1]) {
    if (!id) {
      return;
    }

    setError(null);
    setExportBusy(true);

    try {
      const { blob, filename } = await downloadThreadTranscriptExport(id, input);
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.download = filename;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(href), 30_000);
      setExportDialogOpen(false);
    } catch (requestError) {
      const message =
        requestError instanceof ApiError
          ? requestError.payload.message
          : 'Unable to export transcript.';
      setError(message);
    } finally {
      setExportBusy(false);
    }
  }

  async function handleOpenGoal() {
    if (!id) {
      return;
    }

    setGoalState((current) => ({
      status: 'loading',
      data: current.data ?? detailRef.current?.goal ?? null,
      error: null,
    }));

    try {
      const next = await fetchThreadGoal(id);
      setGoalState({
        status: 'ready',
        data: next.goal,
        error: null,
      });
      setDetail((current) =>
        current
          ? next.goal
            ? {
                ...current,
                goal: next.goal,
                goalHistory: mergeGoalHistory(current.goalHistory ?? [], next.goal),
              }
            : {
                ...current,
                goal: next.goal,
              }
          : current,
      );
    } catch (requestError) {
      setGoalState((current) => ({
        status: 'failed',
        data: current.data,
        error:
          requestError instanceof ApiError
            ? requestError.payload.message
            : 'Unable to load goal.',
      }));
    }
  }

  async function handleUpdateGoal(input: {
    objective?: string | null;
    status?: NonNullable<ThreadDetailDto['goal']>['status'] | null;
    tokenBudget?: number | null;
  }) {
    if (!id) {
      return;
    }

    setGoalState((current) => ({
      status: 'loading',
      data: current.data ?? detailRef.current?.goal ?? null,
      error: null,
    }));

    try {
      const next = await updateThreadGoal(id, input);
      setGoalState({
        status: 'ready',
        data: next.goal,
        error: null,
      });
      setDetail((current) =>
        current
          ? next.goal
            ? {
                ...current,
                goal: next.goal,
                goalHistory: mergeGoalHistory(current.goalHistory ?? [], next.goal),
              }
            : {
                ...current,
                goal: next.goal,
              }
          : current,
      );
    } catch (requestError) {
      setGoalState((current) => ({
        status: 'failed',
        data: current.data,
        error:
          requestError instanceof ApiError
            ? requestError.payload.message
            : 'Unable to update goal.',
      }));
      throw requestError;
    }
  }

  async function handleClearGoal() {
    if (!id) {
      return;
    }

    setGoalState((current) => ({
      status: 'loading',
      data: current.data ?? detailRef.current?.goal ?? null,
      error: null,
    }));

    try {
      const next = await clearThreadGoal(id);
      setGoalState({
        status: 'ready',
        data: null,
        error: null,
      });
      setDetail((current) =>
        current
          ? next.goalHistory
            ? {
                ...current,
                goal: null,
                goalHistory: next.goalHistory,
              }
            : {
                ...current,
                goal: null,
              }
          : current,
      );
    } catch (requestError) {
      setGoalState((current) => ({
        status: 'failed',
        data: current.data,
        error:
          requestError instanceof ApiError
            ? requestError.payload.message
            : 'Unable to clear goal.',
      }));
      throw requestError;
    }
  }

  async function handleGoalStatusAction(
    status: NonNullable<ThreadDetailDto['goal']>['status'],
  ) {
    setGoalActionBusy(true);
    try {
      await handleUpdateGoal({ status });
    } finally {
      setGoalActionBusy(false);
    }
  }

  async function handleTerminateGoal() {
    setGoalActionBusy(true);
    try {
      await handleClearGoal();
    } finally {
      setGoalActionBusy(false);
    }
  }

  async function handleOpenSkills() {
    if (!id) {
      return;
    }

    setSkillsState((current) => ({
      status: 'loading',
      data: current.data,
      error: null,
    }));

    try {
      const next = await fetchThreadSkills(id);
      setSkillsState({
        status: 'ready',
        data: next,
        error: null,
      });
    } catch (requestError) {
      setSkillsState((current) => ({
        status: 'failed',
        data: current.data,
        error:
          requestError instanceof ApiError
            ? requestError.payload.message
            : 'Unable to load skills.',
      }));
    }
  }

  async function handleOpenMcp() {
    if (!id) {
      return;
    }

    setMcpState((current) => ({
      status: 'loading',
      data: current.data,
      error: null,
    }));

    try {
      const next = await fetchThreadMcpServers(id);
      setMcpState({
        status: 'ready',
        data: next,
        error: null,
      });
    } catch (requestError) {
      setMcpState((current) => ({
        status: 'failed',
        data: current.data,
        error:
          requestError instanceof ApiError
            ? requestError.payload.message
            : 'Unable to load MCP servers.',
      }));
    }
  }

  async function handleOpenHooks() {
    if (!id) {
      return;
    }

    setHooksState((current) => ({
      status: 'loading',
      data: current.data,
      error: null,
    }));

    try {
      const next = await fetchThreadHooks(id);
      setHooksState({
        status: 'ready',
        data: next,
        error: null,
      });
    } catch (requestError) {
      setHooksState((current) => ({
        status: 'failed',
        data: current.data,
        error:
          requestError instanceof ApiError
            ? requestError.payload.message
            : 'Unable to load hooks.',
      }));
    }
  }

  async function handleCreateHook(input: Parameters<typeof createThreadHook>[1]) {
    if (!id) {
      return;
    }

    setHooksState((current) => ({
      status: 'loading',
      data: current.data,
      error: null,
    }));

    try {
      const next = await createThreadHook(id, input);
      setHooksState({
        status: 'ready',
        data: next,
        error: null,
      });
    } catch (requestError) {
      setHooksState((current) => ({
        status: 'failed',
        data: current.data,
        error:
          requestError instanceof ApiError
            ? requestError.payload.message
            : 'Unable to create hook.',
      }));
      throw requestError;
    }
  }

  async function handleUpdateHook(input: Parameters<typeof updateThreadHook>[1]) {
    if (!id) {
      return;
    }

    setHooksState((current) => ({
      status: 'loading',
      data: current.data,
      error: null,
    }));

    try {
      const next = await updateThreadHook(id, input);
      setHooksState({
        status: 'ready',
        data: next,
        error: null,
      });
    } catch (requestError) {
      setHooksState((current) => ({
        status: 'failed',
        data: current.data,
        error:
          requestError instanceof ApiError
            ? requestError.payload.message
            : 'Unable to update hook.',
      }));
      throw requestError;
    }
  }

  async function handleTrustHook(input: Parameters<typeof trustThreadHook>[1]) {
    if (!id) {
      return;
    }

    setHooksState((current) => ({
      status: 'loading',
      data: current.data,
      error: null,
    }));

    try {
      const next = await trustThreadHook(id, input);
      setHooksState({
        status: 'ready',
        data: next,
        error: null,
      });
    } catch (requestError) {
      setHooksState((current) => ({
        status: 'failed',
        data: current.data,
        error:
          requestError instanceof ApiError
            ? requestError.payload.message
            : 'Unable to trust hook.',
      }));
      throw requestError;
    }
  }

  async function handleUntrustHook(input: Parameters<typeof untrustThreadHook>[1]) {
    if (!id) {
      return;
    }

    setHooksState((current) => ({
      status: 'loading',
      data: current.data,
      error: null,
    }));

    try {
      const next = await untrustThreadHook(id, input);
      setHooksState({
        status: 'ready',
        data: next,
        error: null,
      });
    } catch (requestError) {
      setHooksState((current) => ({
        status: 'failed',
        data: current.data,
        error:
          requestError instanceof ApiError
            ? requestError.payload.message
            : 'Unable to untrust hook.',
      }));
      throw requestError;
    }
  }

  async function handleOpenForkTurns() {
    if (!id) {
      return;
    }

    setForkTurnOptionsState((current) => ({
      status: 'loading',
      data: current.data,
      error: null,
    }));

    try {
      const next = await fetchThreadForkTurns(id);
      setForkTurnOptionsState({
        status: 'ready',
        data: next,
        error: null,
      });
    } catch (requestError) {
      setForkTurnOptionsState((current) => ({
        status: 'failed',
        data: current.data,
        error:
          requestError instanceof ApiError
            ? requestError.payload.message
            : 'Unable to load turns for forking.',
      }));
    }
  }

  async function handleForkLatest() {
    if (!id) {
      return;
    }

    const result = await forkThread(id, { mode: 'latest' });
    setThreads((current) => mergeThreadIntoList(current, result.thread.thread));
    navigate(`/threads/${result.thread.thread.id}`);
  }

  async function handleForkTurn(turnId: string) {
    if (!id) {
      return;
    }

    const result = await forkThread(id, { mode: 'turn', turnId });
    setThreads((current) => mergeThreadIntoList(current, result.thread.thread));
    navigate(`/threads/${result.thread.thread.id}`);
  }

  const applyDetailResponse = useCallback(
    (detailResponse: ThreadDetailDto) => {
      const pendingThreadSettings = pendingThreadSettingsRef.current;
      const nextDetail =
        pendingThreadSettings && Object.keys(pendingThreadSettings).length > 0
          ? {
              ...detailResponse,
              thread: {
                ...detailResponse.thread,
                ...pendingThreadSettings,
              },
            }
          : detailResponse;
      const previousDetail = detailRef.current;
      detailRef.current = nextDetail;
      setLivePlan(nextDetail.livePlan ?? null);
      const mergedTurns = previousDetail
        ? appendLatestTurns(previousDetail.turns, nextDetail.turns)
        : nextDetail.turns;
      setLiveItems((current) =>
        reconcileLiveItemsWithDetail(current, nextDetail.liveItems ?? null, mergedTurns),
      );
      setGoalState((current) =>
        current.status === 'idle'
          ? current
          : {
              ...current,
              data: nextDetail.goal ?? null,
            },
      );
      const threadHasEnded =
        nextDetail.thread.activeTurnId === null &&
        nextDetail.thread.status !== 'running';

      setDetail((current) =>
        current && !nextDetail.goalHistory
          ? {
              ...nextDetail,
              turns: appendLatestTurns(current.turns, nextDetail.turns),
              pendingRequests: mergePendingRequests(
                current.pendingRequests,
                nextDetail.pendingRequests,
                resolvedRequestIdsRef.current,
              ),
              ...(current.goalHistory ? { goalHistory: current.goalHistory } : {}),
            }
          : current
            ? {
                ...nextDetail,
                turns: appendLatestTurns(current.turns, nextDetail.turns),
                pendingRequests: mergePendingRequests(
                  current.pendingRequests,
                  nextDetail.pendingRequests,
                  resolvedRequestIdsRef.current,
                ),
              }
            : nextDetail,
      );
      setThreads((current) =>
        mergeThreadIntoList(current, nextDetail.thread),
      );
      const nextTurnsById = new Map(
        nextDetail.turns.map((turn) => [turn.id, turn] as const),
      );
      const pendingSteerRequestIds = new Set(
        (nextDetail.pendingSteers ?? [])
          .map((steer) => steer.clientRequestId)
          .filter((value): value is string => Boolean(value)),
      );
      setOptimisticSteers((current) =>
        current.filter((steer) => {
          if (pendingSteerRequestIds.has(steer.clientRequestId)) {
            return false;
          }

          const targetTurn = nextTurnsById.get(steer.turnId);
          if (!targetTurn) {
            return false;
          }

          if (turnHasUserMessage(targetTurn, steer.prompt)) {
            return false;
          }

          if (
            nextDetail.thread.activeTurnId !== steer.turnId &&
            targetTurn.status !== 'inProgress'
          ) {
            return false;
          }

          return true;
        }),
      );
      setOptimisticTurn((current) => {
        if (!current) {
          return current;
        }

        const resolvedTurnId = current.serverTurnId ?? current.id;
        const hasMaterializedTurn = nextDetail.turns.some(
          (turn) => turn.id === resolvedTurnId,
        );
        const materializedTurn = nextTurnsById.get(resolvedTurnId) ?? null;
        const promptTurn = findTurnWithUserMessage(nextDetail.turns, current.prompt);
        const hasMaterializedPrompt = Boolean(promptTurn);
        if (promptTurn && !current.serverTurnId) {
          return {
            ...current,
            id: promptTurn.id,
            serverTurnId: promptTurn.id,
            status:
              current.status === 'failed'
                ? current.status
                : promptTurn.status === 'inProgress'
                  ? 'inProgress'
                  : current.status,
          };
        }
        if (materializedTurn && current.serverTurnId) {
          return materializedTurn.status === 'inProgress'
            ? {
                ...current,
                id: materializedTurn.id,
                serverTurnId: materializedTurn.id,
                status: current.status === 'failed' ? current.status : 'inProgress',
              }
            : null;
        }
        if (
          !current.serverTurnId &&
          current.prompt.includes('[PHOTO ') &&
          nextDetail.thread.activeTurnId &&
          nextDetail.thread.status === 'running'
        ) {
          const activeTurn = nextTurnsById.get(nextDetail.thread.activeTurnId);
          if (activeTurn && turnHasPhotoAttachment(activeTurn)) {
            return {
              ...current,
              id: activeTurn.id,
              serverTurnId: activeTurn.id,
              status: current.status === 'failed' ? current.status : 'inProgress',
            };
          }
        }
        return hasMaterializedTurn || (threadHasEnded && hasMaterializedPrompt)
          ? null
          : current;
      });
      if (
        threadHasEnded ||
        (terminalTurnPendingRef.current &&
          nextDetail.turns.some(
            (turn) => turn.id === terminalTurnPendingRef.current,
          ))
      ) {
        terminalTurnPendingRef.current = null;
        clearBufferedLiveOutput();
        setLiveOutput('');
        setLivePlan(null);
        setLiveItems(null);
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
      const provider =
        seedThread?.provider ?? detailRef.current?.thread.provider ?? 'codex';

      const [threadResult, statusResult, modelResult] = await Promise.allSettled([
        fetchThreads(),
        fetchAgentBackendStatus(provider),
        fetchAgentBackendModels(provider),
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
        pageContextProviderRef.current = provider;
        setStatus(statusResult.value.status);
        setBackendCapabilities(statusResult.value.capabilities);
        setBackendManagementSchema(statusResult.value.managementSchema);
      }

      if (modelResult.status === 'fulfilled') {
        pageContextProviderRef.current = provider;
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
      limit = DETAIL_TURN_PAGE_SIZE,
    }: {
      showLoading?: boolean;
      clearError?: boolean;
      reportError?: boolean;
      limit?: number;
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
          limit,
        });
        if (loadRequestIdRef.current !== requestId) {
          return;
        }

        applyDetailResponse(detailResponse);
        if (pageContextProviderRef.current !== detailResponse.thread.provider) {
          void loadPageContext({ seedThread: detailResponse.thread });
        }
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
    } else if (socketOpen && hasRecentPong) {
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
    setOptimisticTurn(null);
    setOptimisticSteers([]);
    setLiveItems(null);
    backgroundHistoryCursorRef.current = null;
    backgroundHistoryLoadingRef.current = false;
    pendingThreadSettingsRef.current = null;
    terminalTurnPendingRef.current = null;
    resolvedRequestIdsRef.current = new Set();
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
  }, [activeView, detail?.thread.id, isMobileViewport]);

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
    const node = composerHostRef.current;
    if (!node || !isMobileViewport || activeView !== 'chat') {
      setMobileComposerOverlap(0);
      return;
    }

    const updateOverlap = () => {
      const rect = node.getBoundingClientRect();
      setMobileComposerOverlap(Math.max(0, Math.ceil(window.innerHeight - rect.top)));
    };

    updateOverlap();
    window.addEventListener('resize', updateOverlap);
    window.visualViewport?.addEventListener('resize', updateOverlap);
    window.visualViewport?.addEventListener('scroll', updateOverlap);

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(updateOverlap);
      observer.observe(node);
    }

    return () => {
      window.removeEventListener('resize', updateOverlap);
      window.visualViewport?.removeEventListener('resize', updateOverlap);
      window.visualViewport?.removeEventListener('scroll', updateOverlap);
      observer?.disconnect();
    };
  }, [
    activeView,
    detail?.thread.id,
    isMobileViewport,
    mobileKeyboardInset,
    mobilePromptFocused,
  ]);

  useEffect(() => {
    void loadThreadDetail({
      showLoading: true,
      limit: INITIAL_DETAIL_TURN_PAGE_SIZE,
    });
    void loadPageContext();
  }, [loadPageContext, loadThreadDetail]);

  useEffect(() => {
    if (
      !detail ||
      detail.turns.length === 0 ||
      loadingEarlier ||
      backgroundHistoryLoadingRef.current
    ) {
      return;
    }

    const totalTurnCount = detail.totalTurnCount ?? detail.turns.length;
    if (detail.turns.length >= totalTurnCount) {
      backgroundHistoryCursorRef.current = null;
      return;
    }

    const earliestLoadedTurnId = detail.turns[0]?.id;
    if (!earliestLoadedTurnId) {
      return;
    }

    const cursor = {
      threadId: detail.thread.id,
      beforeTurnId: earliestLoadedTurnId,
    };
    const previousCursor = backgroundHistoryCursorRef.current;
    if (
      previousCursor?.threadId === cursor.threadId &&
      previousCursor.beforeTurnId === cursor.beforeTurnId
    ) {
      return;
    }
    backgroundHistoryCursorRef.current = cursor;

    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      void (async () => {
        backgroundHistoryLoadingRef.current = true;
        try {
          const earlier = await fetchThreadDetail(id, {
            limit: DETAIL_TURN_PAGE_SIZE,
            beforeTurnId: earliestLoadedTurnId,
          });
          if (cancelled) {
            return;
          }
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
        } catch {
          // Manual "Load earlier" still reports recoverable paging errors.
        } finally {
          if (backgroundHistoryCursorRef.current?.threadId === cursor.threadId) {
            backgroundHistoryLoadingRef.current = false;
          }
        }
      })();
    }, 120);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [detail?.totalTurnCount, detail?.turns, id, loadingEarlier]);

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
        const itemId =
          typeof event.payload.itemId === 'string' ? event.payload.itemId : null;
        const sequence =
          typeof event.payload.sequence === 'number' &&
          Number.isFinite(event.payload.sequence)
            ? event.payload.sequence
            : null;
        if (eventTurnId && itemId) {
          appendLiveAgentDelta(
            eventTurnId,
            itemId,
            event.payload.delta,
            sequence,
          );
        } else {
          queueLiveOutputDelta(event.payload.delta);
        }
        if (eventTurnId) {
          setOptimisticTurn((current) =>
            current &&
            (current.serverTurnId === null || current.serverTurnId === eventTurnId)
              ? {
                  ...current,
                  serverTurnId: eventTurnId,
                  id: eventTurnId,
                  status: current.status === 'failed' ? current.status : 'inProgress',
                  tokenUsage: current.tokenUsage,
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
        event.type === 'thread.turn.token.updated' &&
        typeof event.payload.turnId === 'string' &&
        event.payload.tokenUsage &&
        typeof event.payload.tokenUsage === 'object'
      ) {
        const eventTurnId = event.payload.turnId;
        const tokenUsage = event.payload.tokenUsage as ThreadTurnTokenUsageDto;
        const priceEstimate =
          event.payload.priceEstimate &&
          typeof event.payload.priceEstimate === 'object'
            ? (event.payload.priceEstimate as ThreadTurnPriceEstimateDto)
            : null;

        setDetail((current) => {
          if (!current) {
            return current;
          }

          const nextTurns = mergeTurnTokenUsage(
            current.turns,
            eventTurnId,
            tokenUsage,
            priceEstimate,
          );

          return nextTurns === current.turns
            ? current
            : {
                ...current,
                turns: nextTurns,
              };
        });

        setOptimisticTurn((current) =>
          current &&
          (current.serverTurnId === eventTurnId || current.id === eventTurnId)
            ? {
                ...current,
                tokenUsage,
                priceEstimate,
              }
            : current,
        );
      }

      if (
        event.type === 'thread.turn.started' ||
        event.type === 'thread.turn.completed' ||
        event.type === 'thread.turn.failed' ||
        event.type === 'thread.updated' ||
        event.type === 'thread.goal.updated' ||
        event.type === 'thread.goal.cleared' ||
        event.type === 'thread.request.created' ||
        event.type === 'thread.request.resolved'
      ) {
        if (event.type === 'thread.goal.updated') {
          const goal =
            event.payload.goal && typeof event.payload.goal === 'object'
              ? (event.payload.goal as NonNullable<ThreadDetailDto['goal']>)
              : null;
          const goalHistory =
            Array.isArray(event.payload.goalHistory)
              ? (event.payload.goalHistory as NonNullable<ThreadDetailDto['goalHistory']>)
              : null;
          setGoalState({
            status: 'ready',
            data: goal,
            error: null,
          });
          setDetail((current) =>
            current
              ? goalHistory
                ? {
                    ...current,
                    goal,
                    goalHistory,
                  }
                : goal
                  ? {
                      ...current,
                      goal,
                      goalHistory: mergeGoalHistory(current.goalHistory ?? [], goal),
                    }
                  : {
                      ...current,
                      goal,
                    }
              : current,
          );
        }
        if (event.type === 'thread.goal.cleared') {
          const goalHistory =
            Array.isArray(event.payload.goalHistory)
              ? (event.payload.goalHistory as NonNullable<ThreadDetailDto['goalHistory']>)
              : null;
          setGoalState({
            status: 'ready',
            data: null,
            error: null,
          });
          setDetail((current) =>
            current
              ? goalHistory
                ? {
                    ...current,
                    goal: null,
                    goalHistory,
                  }
                : {
                    ...current,
                    goal: null,
                  }
              : current,
          );
        }
        refreshThreadDetailSilently();
        if (event.type === 'thread.turn.started') {
          clearBufferedLiveOutput();
          setLiveOutput('');
          setLiveItems(null);
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
                    tokenUsage: current.tokenUsage,
                  }
                : current,
            );
          }
        }
        if (
          event.type === 'thread.turn.completed' ||
          event.type === 'thread.turn.failed'
        ) {
          clearBufferedLiveOutput();
          setLiveOutput('');
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
                      tokenUsage: current.tokenUsage,
                    }
                  : current,
              );
            }
          }
        }
      }

      if (
        event.type === 'thread.request.created' &&
        isThreadActionRequest(event.payload.request)
      ) {
        resolvedRequestIdsRef.current.delete(event.payload.request.id);
        setDetail((current) =>
          current ? mergePendingRequestIntoDetail(current, event.payload.request) : current,
        );
      }

      if (
        event.type === 'thread.request.resolved' &&
        typeof event.payload.requestId === 'string'
      ) {
        const requestId = event.payload.requestId;
        resolvedRequestIdsRef.current.add(requestId);
        setDetail((current) =>
          current ? removePendingRequestFromDetail(current, requestId) : current,
        );
      }

      if (
        (event.type === 'thread.item.started' ||
          event.type === 'thread.item.completed') &&
        event.payload.item &&
        typeof event.payload.item === 'object' &&
        typeof event.payload.turnId === 'string'
      ) {
        const eventTurnId = event.payload.turnId;
        const liveItem = event.payload.item as ThreadDetailDto['turns'][number]['items'][number];
        if (typeof liveItem.id === 'string' && typeof liveItem.text === 'string') {
          upsertLiveTimelineItem(eventTurnId, liveItem);
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
    appendLiveAgentDelta,
    clearBufferedLiveOutput,
    id,
    loadThreadDetail,
    queueLiveOutputDelta,
    syncRealtimeConnectionState,
    upsertLiveTimelineItem,
  ]);

  useEffect(() => {
    const shouldPollForTurnUpdates =
      detail?.thread.activeTurnId !== null ||
      detail?.thread.status === 'running' ||
      optimisticTurn !== null ||
      optimisticSteers.length > 0 ||
      liveOutput.length > 0 ||
      livePlan !== null ||
      liveItems !== null;

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
    liveItems,
    livePlan,
    loadThreadDetail,
    optimisticSteers.length,
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
    setScrollRequestKey((current) => current + 1);
    const activeDetail = detailRef.current;
    const effectiveThread = activeDetail
      ? {
          ...activeDetail.thread,
          ...(pendingThreadSettingsRef.current ?? {}),
        }
      : null;
    const optimisticModel = effectiveThread?.model ?? null;
    const optimisticReasoningEffort = effectiveThread?.reasoningEffort ?? null;
    const clientRequestId = createClientRequestId();
    const optimisticTurnId = `optimistic-${Date.now()}`;
    const optimisticSteerId = `optimistic-steer-${clientRequestId}`;
    const optimisticStartedAt = new Date().toISOString();

    try {
      let currentDetail = detailRef.current;
      if (currentDetail && !currentDetail.thread.isLoaded) {
        const resumeSeedThread = {
          ...currentDetail.thread,
          ...(pendingThreadSettingsRef.current ?? {}),
        };
        const resumed = await resumeThread(
          id,
          {
            ...(currentDetail.thread.model ? { model: currentDetail.thread.model } : {}),
            ...(currentDetail.thread.sandboxMode
              ? { sandboxMode: currentDetail.thread.sandboxMode }
              : {}),
          },
        );
        const resumedDetail = {
          ...resumed,
          thread: {
            ...resumed.thread,
            model: resumeSeedThread.model ?? resumed.thread.model,
            reasoningEffort:
              resumeSeedThread.reasoningEffort ?? resumed.thread.reasoningEffort,
            collaborationMode:
              resumeSeedThread.collaborationMode ??
              resumed.thread.collaborationMode,
            sandboxMode:
              resumeSeedThread.sandboxMode ?? resumed.thread.sandboxMode ?? null,
          },
        };
        currentDetail = resumedDetail;
        detailRef.current = resumedDetail;
        setDetail((current) =>
          current
            ? {
                ...resumedDetail,
                turns: appendLatestTurns(current.turns, resumedDetail.turns),
              }
            : resumedDetail,
        );
        setThreads((current) =>
          current.map((entry) =>
            entry.id === resumedDetail.thread.id ? resumedDetail.thread : entry,
          ),
        );
      }

      const currentEffectiveThread = currentDetail
        ? {
            ...currentDetail.thread,
            ...(pendingThreadSettingsRef.current ?? {}),
          }
        : null;
      const steerTargetTurnId =
        currentEffectiveThread?.status === 'running'
          ? currentEffectiveThread.activeTurnId
          : null;
      const shouldSteer =
        activeView === 'chat' && Boolean(steerTargetTurnId);

      if (shouldSteer && steerTargetTurnId) {
        setOptimisticSteers((current) => [
          ...current,
          {
            id: optimisticSteerId,
            clientRequestId,
            turnId: steerTargetTurnId,
            prompt: input.prompt,
            createdAt: optimisticStartedAt,
            status: 'steering',
          },
        ]);
      } else {
        clearBufferedLiveOutput();
        setLiveOutput('');
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
          tokenUsage: null,
          priceEstimate: null,
        });
      }

      const promptInput = {
        prompt: input.prompt,
        clientRequestId,
        ...(currentEffectiveThread?.model ? { model: currentEffectiveThread.model } : {}),
        ...(currentEffectiveThread?.reasoningEffort
          ? { reasoningEffort: currentEffectiveThread.reasoningEffort }
          : {}),
        ...(currentEffectiveThread?.collaborationMode
          ? { collaborationMode: currentEffectiveThread.collaborationMode }
          : {}),
        ...(currentEffectiveThread?.sandboxMode
          ? { sandboxMode: currentEffectiveThread.sandboxMode }
          : {}),
        ...(input.attachments?.length ? { attachments: input.attachments } : {}),
      };
      const thread = await sendThreadPrompt(id, promptInput);
      const nextThread =
        pendingThreadSettingsRef.current &&
        Object.keys(pendingThreadSettingsRef.current).length > 0
          ? {
              ...thread,
              ...pendingThreadSettingsRef.current,
            }
          : thread;
      setDetail((current) => (current ? { ...current, thread: nextThread } : current));
      setThreads((current) =>
        current.map((entry) => (entry.id === nextThread.id ? nextThread : entry)),
      );
      if (shouldSteer && steerTargetTurnId) {
        const fellBackToNewTurn =
          nextThread.activeTurnId !== null &&
          nextThread.activeTurnId !== steerTargetTurnId &&
          nextThread.lastTurnStartedAt !== currentEffectiveThread?.lastTurnStartedAt;

        if (fellBackToNewTurn) {
          clearBufferedLiveOutput();
          setLiveOutput('');
          setLivePlan(null);
          setOptimisticSteers((current) =>
            current.filter((steer) => steer.id !== optimisticSteerId),
          );
          setOptimisticTurn({
            id: optimisticTurnId,
            serverTurnId: nextThread.activeTurnId,
            startedAt: nextThread.lastTurnStartedAt ?? optimisticStartedAt,
            status: 'inProgress',
            error: null,
            prompt: input.prompt,
            model: optimisticModel,
            reasoningEffort: optimisticReasoningEffort,
            reasoningEffortAvailable: getReasoningEffortAvailability(
              modelOptions,
              optimisticModel,
            ),
            tokenUsage: null,
            priceEstimate: null,
          });
        } else {
          setOptimisticSteers((current) =>
            current.map((steer) =>
              steer.id === optimisticSteerId
                ? {
                    ...steer,
                    turnId: nextThread.activeTurnId ?? steer.turnId,
                    status: 'accepted',
                  }
                : steer,
            ),
          );
        }
      } else {
        setOptimisticTurn((current) =>
          current && current.id === optimisticTurnId
            ? {
                ...current,
                id: nextThread.activeTurnId ?? current.id,
                serverTurnId: nextThread.activeTurnId ?? current.serverTurnId,
                status: 'inProgress',
                error: null,
                tokenUsage: current.tokenUsage,
                priceEstimate: current.priceEstimate,
              }
            : current,
        );
        setLivePlan(null);
      }
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
      setOptimisticSteers((current) =>
        current.filter((steer) => steer.clientRequestId !== clientRequestId),
      );
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
    const sessionId = detail?.thread.providerSessionId;
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
    fastMode?: boolean;
    collaborationMode?: ThreadDto['collaborationMode'];
    sandboxMode?: ThreadDto['sandboxMode'];
  }) {
    if (!detail) {
      return;
    }

    const previousDetail = detail;
    const mergedPendingThreadSettings: PendingThreadSettings = {
      ...(pendingThreadSettingsRef.current ?? {}),
      ...(input.model !== undefined ? { model: input.model } : {}),
      ...(input.reasoningEffort !== undefined
        ? { reasoningEffort: input.reasoningEffort }
        : {}),
      ...(input.fastMode !== undefined ? { fastMode: input.fastMode } : {}),
      ...(input.collaborationMode !== undefined
        ? { collaborationMode: input.collaborationMode }
        : {}),
      ...(input.sandboxMode !== undefined
        ? { sandboxMode: input.sandboxMode }
        : {}),
    };
    const optimisticThread = {
      ...detail.thread,
      ...mergedPendingThreadSettings,
    };

    setSettingsBusy(true);
    pendingThreadSettingsRef.current = mergedPendingThreadSettings;
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
        ...(input.fastMode !== undefined ? { fastMode: input.fastMode } : {}),
        ...(input.collaborationMode !== undefined
          ? { collaborationMode: input.collaborationMode }
          : {}),
        ...(input.sandboxMode !== undefined
          ? { sandboxMode: input.sandboxMode }
          : {}),
      });
      pendingThreadSettingsRef.current = null;
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
      pendingThreadSettingsRef.current = null;
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
      setLivePlan(updated.livePlan ?? null);
      setLiveItems(updated.liveItems ?? null);
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

  async function handleCompactThread() {
    if (!detail) {
      return;
    }

    setCompactBusy(true);
    setError(null);

    try {
      const updated = await compactThread(id);
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
      setError(
        caught instanceof Error
          ? caught.message
          : 'Unable to compact this thread context.',
      );
    } finally {
      setCompactBusy(false);
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

  async function handleDeleteThread() {
    if (!deletingThread) {
      return;
    }

    setDeletingThreadBusy(true);
    setError(null);
    try {
      await deleteThread(deletingThread.id);
      setThreads((current) =>
        current.filter((thread) => thread.id !== deletingThread.id),
      );
      const deletedCurrentThread = deletingThread.id === detail?.thread.id;
      setDeletingThread(null);
      if (deletedCurrentThread) {
        const nextThread = threads.find((thread) =>
          thread.id !== deletingThread.id &&
          thread.workspaceId === detail?.thread.workspaceId
        ) ?? threads.find((thread) => thread.id !== deletingThread.id);
        navigate(nextThread ? `/threads/${nextThread.id}` : '/threads');
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to delete thread.');
    } finally {
      setDeletingThreadBusy(false);
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
  const effectiveMobileComposerOverlap = Math.max(
    mobileComposerOverlap,
    effectiveMobileComposerHeight + floatingMobileComposerBottomOffset,
  );
  const timelineBottomSpacer = useFloatingMobileComposer
    ? effectiveMobileComposerOverlap + 12
    : 0;

  const metaContent = detail ? (
    <dl className="space-y-4 text-sm">
      <div className="relative pr-9">
        <dt className="text-stone-500">Session ID</dt>
        <dd className="mt-1 break-all text-stone-100">
          {detail.thread.providerSessionId ?? 'Unavailable'}
        </dd>
        {(detail.thread.providerSessionId) && (
          <button
            type="button"
            aria-label="Copy session ID"
            title={
              metaSessionCopyState === 'copied'
                ? 'Copied'
                : metaSessionCopyState === 'failed'
                  ? 'Copy failed'
                  : 'Copy session ID'
            }
            onClick={() => void handleCopyMetaSessionId()}
            className={`thread-mobile-hit-target absolute bottom-0 right-0 inline-flex h-5 w-5 items-center justify-center rounded-full border shadow-sm shadow-stone-950/25 backdrop-blur transition ${
              metaSessionCopyState === 'copied'
                ? 'ui-status-info'
                : metaSessionCopyState === 'failed'
                  ? 'ui-status-danger'
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
          {detail.thread.source === 'local_codex_import'
            ? `Imported local ${detail.thread.provider} session`
            : `${detail.thread.provider} supervisor thread`}
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
    </dl>
  ) : null;

  const settingsContent = detail && backendCapabilities?.controls.sandboxMode ? (
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
                    ? 'ui-status-warning'
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

  const optimisticServerTurnId = optimisticTurn?.serverTurnId ?? null;
  const optimisticMaterializedTurn =
    optimisticTurn && detail
      ? detail.turns.find(
          (turn) =>
            (optimisticServerTurnId && turn.id === optimisticServerTurnId) ||
            turn.id === optimisticTurn.id ||
            turnHasUserMessage(turn, optimisticTurn.prompt) ||
            (optimisticTurn.prompt.includes('[PHOTO ') &&
              turnHasPhotoPromptText(turn, optimisticTurn.prompt)),
        ) ?? null
      : null;
  const timelineOptimisticTurn =
    optimisticTurn && !optimisticMaterializedTurn
      ? {
          id: optimisticTurn.id,
          startedAt: optimisticTurn.startedAt,
          status: optimisticTurn.status,
          error: optimisticTurn.error,
          model: optimisticTurn.model,
          reasoningEffort: optimisticTurn.reasoningEffort,
          reasoningEffortAvailable: optimisticTurn.reasoningEffortAvailable,
          tokenUsage: optimisticTurn.tokenUsage,
          priceEstimate: optimisticTurn.priceEstimate,
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
      ? 'ui-action-success shadow-lg shadow-stone-950/20'
      : realtimeConnection.status === 'reconnecting'
        ? 'thread-live-connection-reconnecting ui-status-success shadow-lg shadow-stone-950/20'
        : realtimeConnection.status === 'offline'
          ? 'ui-status-danger shadow-lg shadow-stone-950/20'
          : 'ui-status-warning shadow-lg shadow-stone-950/20';
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

  const mobileSessionConnectionControl = !threadLoaded ? (
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
  const currentGoal = goalState.data ?? detail?.goal ?? null;
  const goalHistory = detail?.goalHistory ?? [];
  const monitorGoals = currentGoal
    ? mergeGoalHistory(goalHistory, currentGoal)
    : normalizeGoalHistory(goalHistory);
  const supportsGoals = backendCapabilities?.controls.goals ?? false;
  const goalIndicatorIcon = (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-4 w-4 fill-none stroke-current"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="8" cy="8" r="5.5" />
      <circle cx="8" cy="8" r="2" />
      <path d="M8 1.7v2M8 12.3v2M1.7 8h2M12.3 8h2" />
    </svg>
  );
  const goalMonitorPanel = goalMonitorOpen && supportsGoals ? (
    <div className="w-96 max-w-[calc(100vw-1.5rem)] rounded-3xl border border-stone-700/80 bg-stone-950/92 p-3 text-left text-stone-100 shadow-2xl shadow-stone-950/35 backdrop-blur-xl">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Goal monitor</p>
          <p className="text-xs text-stone-500">Current thread only</p>
        </div>
        <button
          type="button"
          onClick={() => setGoalMonitorOpen(false)}
          className="rounded-full border border-stone-700 px-2.5 py-1 text-xs text-stone-300 transition hover:bg-stone-800"
        >
          Close
        </button>
      </div>
      {goalState.error ? (
        <p className="mt-3 rounded-2xl border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-xs text-rose-100">
          {goalState.error}
        </p>
      ) : null}
      <div className="mt-3 max-h-[28rem] space-y-2 overflow-auto pr-1">
        {monitorGoals.length === 0 ? (
          <p className="rounded-2xl border border-stone-800 bg-stone-900/60 px-3 py-3 text-sm text-stone-400">
            No goals in this thread yet.
          </p>
        ) : (
          monitorGoals.map((goal) => {
            const key = goalKey(goal);
            const expanded = expandedGoalIds.has(key);
            const active = ['active', 'paused', 'budgetLimited'].includes(goal.status);
            return (
              <div
                key={key}
                className={`rounded-2xl border px-3 py-3 ${
                  active
                    ? 'ui-status-info'
                    : 'border-stone-800 bg-stone-900/60'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedGoalIds((current) => {
                        const next = new Set(current);
                        if (next.has(key)) {
                          next.delete(key);
                        } else {
                          next.add(key);
                        }
                        return next;
                      })
                    }
                    className="min-w-0 flex-1 text-left"
                  >
                    <p
                      className={`text-sm font-medium leading-5 ${
                        expanded ? '' : 'line-clamp-2'
                      }`}
                    >
                      {goal.objective}
                    </p>
                  </button>
                  <span className="shrink-0 rounded-full border border-stone-700 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-stone-300">
                    {goal.status}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-stone-400">
                  <span>{formatGoalRuntime(goal.timeUsedSeconds)}</span>
                  <span>{formatGoalTokenUsage(goal)}</span>
                  <span title={formatLongTimestamp(goal.updatedAt)}>
                    Updated {new Date(goal.updatedAt).toLocaleTimeString()}
                  </span>
                </div>
                {active ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={goalActionBusy || goal.status === 'active'}
                      onClick={() => void handleGoalStatusAction('active')}
                      className="ui-status-info rounded-full px-3 py-1.5 text-xs transition disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Continue
                    </button>
                    <button
                      type="button"
                      disabled={goalActionBusy || goal.status === 'paused'}
                      onClick={() => void handleGoalStatusAction('paused')}
                      className="rounded-full border border-stone-700 px-3 py-1.5 text-xs text-stone-300 transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Pause
                    </button>
                    <button
                      type="button"
                      disabled={goalActionBusy}
                      onClick={() => void handleTerminateGoal()}
                      className="rounded-full border border-rose-400/35 px-3 py-1.5 text-xs text-rose-100 transition hover:bg-rose-400/10 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Terminate
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </div>
  ) : null;
  const goalMonitorButton = supportsGoals ? (
    <button
      type="button"
      aria-label="Open goal monitor"
      title="Open goal monitor"
      onClick={() => {
        setGoalMonitorOpen((current) => !current);
        void handleOpenGoal();
      }}
      className="ui-status-info inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full shadow-lg shadow-stone-950/20 transition lg:h-9 lg:w-9"
    >
      {goalIndicatorIcon}
    </button>
  ) : null;
  const exportTranscriptButton = (
    <button
      type="button"
      aria-label="Export transcript"
      title="Export transcript"
      onClick={() => setExportDialogOpen(true)}
      disabled={!detail}
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-stone-700/90 bg-stone-900/85 text-stone-300 shadow-lg shadow-stone-950/20 transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-50 lg:h-9 lg:w-9"
    >
      <ExportIcon />
    </button>
  );
  const mobileSessionConnectionButton = (
    <div className="relative flex items-center justify-end gap-1.5">
      {exportTranscriptButton}
      {goalMonitorButton}
      {mobileSessionConnectionControl}
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
      onDeleteThread={setDeletingThread}
    >
      <div className="thread-detail-surface relative flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-none border-y shadow-2xl shadow-stone-950/20 sm:flex-none sm:rounded-[2rem] sm:border">
        <div className="pointer-events-none absolute right-4 top-4 z-30 hidden lg:block">
          <div className="pointer-events-auto flex flex-col items-end gap-2">
            <div className="flex items-center justify-end gap-2">
              {exportTranscriptButton}
              {goalMonitorButton}
              {desktopSessionConnectionIndicator}
            </div>
          </div>
        </div>
        {goalMonitorPanel ? (
          <div className="fixed right-3 top-20 z-50 lg:absolute lg:top-16 lg:right-4">
            {goalMonitorPanel}
          </div>
        ) : null}
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
                  activeTurnId={detail.thread.activeTurnId}
                  threadRunning={
                    detail.thread.status === 'running' ||
                    detail.thread.activeTurnId !== null
                  }
                  livePlan={livePlan}
                  liveItems={liveItems}
                  respondingRequestId={respondingRequestId}
                  onRespondToRequest={handleRespondToRequest}
                  liveOutput={liveOutput}
                  scrollRequestKey={scrollRequestKey}
                  bottomSpacer={timelineBottomSpacer}
                  className="thread-timeline-surface min-h-0 flex-1"
                  onTailVisibilityChange={setFollowTail}
                  loadingEarlier={loadingEarlier}
                  onLoadEarlier={handleLoadEarlierTurns}
                  onLoadHistoryItemDetail={(itemId) =>
                    fetchThreadHistoryItemDetail(detail.thread.id, itemId)
                  }
                  answeredRequestNotes={detail.answeredRequestNotes ?? []}
                  activityNotes={detail.activityNotes ?? []}
                  pendingSteers={detail.pendingSteers ?? []}
                  optimisticSteers={optimisticSteers}
                  optimisticTurn={timelineOptimisticTurn}
                />
                {useFloatingMobileComposer ? (
                  <div
                    ref={composerHostRef}
                    className="fixed inset-x-0 bottom-0 z-40 max-h-[min(58dvh,24rem)] overflow-y-auto overscroll-contain sm:hidden"
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
                      fastMode={detail.thread.fastMode ?? false}
                      collaborationMode={detail.thread.collaborationMode}
                      modelOptions={modelOptions}
                      contextUsage={detail.thread.contextUsage}
                      capabilities={backendCapabilities}
                      toolboxItems={backendManagementSchema?.toolboxItems ?? []}
                      hookCommandTemplates={backendManagementSchema?.hookCommandTemplates ?? []}
                      mcpConfigFormat={backendManagementSchema?.mcpConfigFormat ?? 'none'}
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
                      onCompact={handleCompactThread}
                      onOpenForkTurns={handleOpenForkTurns}
                      onForkLatest={handleForkLatest}
                      onForkTurn={handleForkTurn}
                      onOpenSkills={handleOpenSkills}
                      onOpenMcp={handleOpenMcp}
                      onOpenHooks={handleOpenHooks}
                      onCreateHook={handleCreateHook}
                      onUpdateHook={handleUpdateHook}
                      onTrustHook={handleTrustHook}
                      onUntrustHook={handleUntrustHook}
                      goalState={goalState}
                      onOpenGoal={handleOpenGoal}
                      onUpdateGoal={handleUpdateGoal}
                      onReadProviderConfig={
                        mcpProviderConfigFileName
                          ? () =>
                              fetchProviderHostFile(
                                detail.thread.provider,
                                mcpProviderConfigFileName,
                              )
                          : undefined
                      }
                      onWriteProviderConfig={
                        mcpProviderConfigFileName
                          ? (content) =>
                              updateProviderHostFile(
                                detail.thread.provider,
                                mcpProviderConfigFileName,
                                { content },
                              )
                          : undefined
                      }
                      onToggleFollow={() => setScrollRequestKey((current) => current + 1)}
                      onUpdateSettings={handleUpdateThreadSettings}
                      onToggleView={handleToggleView}
                      onShellCopy={handleShellCopy}
                      onShellControl={handleShellControl}
                      compactBusy={compactBusy}
                      skillsState={skillsState}
                      mcpState={mcpState}
                      hooksState={hooksState}
                      forkTurnOptionsState={forkTurnOptionsState}
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
                      fastMode={detail.thread.fastMode ?? false}
                      collaborationMode={detail.thread.collaborationMode}
                      modelOptions={modelOptions}
                      contextUsage={detail.thread.contextUsage}
                      capabilities={backendCapabilities}
                      toolboxItems={backendManagementSchema?.toolboxItems ?? []}
                      hookCommandTemplates={backendManagementSchema?.hookCommandTemplates ?? []}
                      mcpConfigFormat={backendManagementSchema?.mcpConfigFormat ?? 'none'}
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
                      onCompact={handleCompactThread}
                      onOpenForkTurns={handleOpenForkTurns}
                      onForkLatest={handleForkLatest}
                      onForkTurn={handleForkTurn}
                      onOpenSkills={handleOpenSkills}
                      onOpenMcp={handleOpenMcp}
                      onOpenHooks={handleOpenHooks}
                      onCreateHook={handleCreateHook}
                      onUpdateHook={handleUpdateHook}
                      onTrustHook={handleTrustHook}
                      onUntrustHook={handleUntrustHook}
                      goalState={goalState}
                      onOpenGoal={handleOpenGoal}
                      onUpdateGoal={handleUpdateGoal}
                      onReadProviderConfig={
                        mcpProviderConfigFileName
                          ? () =>
                              fetchProviderHostFile(
                                detail.thread.provider,
                                mcpProviderConfigFileName,
                              )
                          : undefined
                      }
                      onWriteProviderConfig={
                        mcpProviderConfigFileName
                          ? (content) =>
                              updateProviderHostFile(
                                detail.thread.provider,
                                mcpProviderConfigFileName,
                                { content },
                              )
                          : undefined
                      }
                      onToggleFollow={() => setScrollRequestKey((current) => current + 1)}
                      onUpdateSettings={handleUpdateThreadSettings}
                      onToggleView={handleToggleView}
                      onShellCopy={handleShellCopy}
                      onShellControl={handleShellControl}
                      compactBusy={compactBusy}
                      skillsState={skillsState}
                      mcpState={mcpState}
                      hooksState={hooksState}
                      forkTurnOptionsState={forkTurnOptionsState}
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
                    <div className="thread-empty-surface max-w-md rounded-[1.6rem] border px-6 py-8 text-center">
                      <p className="text-base font-medium text-[var(--theme-fg)]">
                        Thread disconnected
                      </p>
                      <p className="mt-3 text-sm leading-6 text-[var(--theme-fg-soft)]">
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
                    capabilities={backendCapabilities}
                    toolboxItems={backendManagementSchema?.toolboxItems ?? []}
                    hookCommandTemplates={backendManagementSchema?.hookCommandTemplates ?? []}
                    mcpConfigFormat={backendManagementSchema?.mcpConfigFormat ?? 'none'}
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
        <ExportTranscriptDialog
          open={exportDialogOpen}
          busy={exportBusy}
          turnsState={exportTurnsState}
          onCancel={() => {
            if (!exportBusy) {
              setExportDialogOpen(false);
            }
          }}
          onLoadTurns={loadExportTurns}
          onExport={handleExportTranscript}
        />
        <ConfirmDialog
          open={deletingThread !== null}
          title="Delete Thread"
          description={
            deletingThread
              ? `Delete ${truncateDialogThreadTitle(deletingThread.title)} from supervisor. The backend session id will no longer appear in this workspace list.`
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
      </div>
    </ThreadWorkspaceLayout>
  );
}
