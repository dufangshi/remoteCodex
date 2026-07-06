import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

import {
  AgentProviderCapabilitiesDto,
  AgentBackendManagementSchemaDto,
  AgentRuntimeStatusDto,
  ModelOptionDto,
  RelayEffectiveAccessDto,
  SupervisorSocketServerEnvelope,
  ThreadDetailDto,
  ThreadHistoryItemDto,
  ThreadDto,
  ThreadEventEnvelope,
  ThreadTurnPriceEstimateDto,
  ThreadTurnTokenUsageDto,
  truncateAutoThreadTitle,
} from '../../../../packages/shared/src/index';
import {
  AppShellSettingsDialog,
} from '../components/AppShellNavigation';
import { useAppShellNav } from '../components/AppShellNavContext';
import {
  ConfirmDialog,
  ThreadActionsDialog,
  ThreadDetailSurface,
  ThreadShellPanel,
  ThreadTimeline,
  type ThreadShellControlState,
  type ThreadShellPanelHandle,
  type ThreadComposerProps,
  type CreateThreadShareInput,
  type ThreadShareSummary,
  type ThreadTimelineProps,
  type ThreadGraphWorkspaceFeatures,
} from '@remote-codex/thread-ui';
import {
  formatLongTimestamp,
  threadStatusLabel,
} from '@remote-codex/thread-ui';
import { usePlugins } from '@remote-codex/thread-ui';
import {
  ApiError,
  compactThread,
  connectSupervisorEvents,
  connectShellSocket,
  createThreadShell,
  createRelayShare,
  disconnectThread,
  deleteThread,
  fetchAgentBackendModels,
  fetchAgentBackendStatus,
  fetchProviderHostFile,
  fetchRelayAccess,
  fetchRelayPortal,
  fetchThreadHistoryItemDetail,
  fetchThreadShellState,
  fetchSupervisorHealth,
  fetchThreads,
  fetchThreadDetail,
  interruptThread,
  respondToThreadRequest,
  revokeRelayShare,
  resumeThread,
  relayModeActive,
  sendThreadPrompt,
  type PromptAttachmentUpload,
  type SendThreadPromptRequestInput,
  updateThread,
  updateShell,
  updateProviderHostFile,
  updateThreadSettings,
  terminateShell,
  buildThreadImageAssetUrl,
  cancelPendingSteer,
} from '../lib/api';
import {
  appendLatestTurns,
  applyLiveItemTimestampsToTurns,
  createClientRequestId,
  findTurnWithUserMessage,
  formatGoalRuntime,
  formatGoalTokenUsage,
  getReasoningEffortAvailability,
  isThreadActionRequest,
  mergeGoalHistory,
  mergeLiveHistoryItem,
  mergePendingRequestIntoDetail,
  mergePendingRequests,
  mergeThreadIntoList,
  mergeTurnTokenUsage,
  normalizeGoalHistory,
  prependTurns,
  reconcileLiveItemsWithDetail,
  removePendingRequestFromDetail,
  turnHasPhotoAttachment,
  promptHasPhotoPlaceholder,
  turnHasPhotoPromptText,
  turnHasUserMessage,
} from './threadDetailModel';
import {
  currentNewThreadHref,
  currentRelayDeviceIdFromPath,
  currentThreadHref,
  currentThreadsHref,
  currentWorkspacesHref,
  relayDeviceIdFromPath,
} from '../lib/relayRoutes';
import { useMobileComposerLayout } from './useMobileComposerLayout';
import { useThreadAuxiliaryActions } from './useThreadAuxiliaryActions';
import { useThreadListPolling } from './useThreadListPolling';
import { useThreadWorkspaceAdapter } from './useThreadWorkspaceAdapter';
import { ThreadCreateForm } from './thread-create/ThreadCreateForm';

const INITIAL_DETAIL_TURN_PAGE_SIZE = 3;
const DETAIL_TURN_PAGE_SIZE = 3;
const SUPERVISOR_SOCKET_RECONNECT_DELAY_MS = 1_000;
const SUPERVISOR_HEALTHCHECK_INTERVAL_MS = 2_000;
const SUPERVISOR_CONNECTION_STALE_MS = 5_500;
const ACTIVE_THREAD_REFRESH_INTERVAL_MS = 3_000;
const SOCKET_CONNECTING = 0;

const SOCKET_OPEN = 1;
const SOCKET_CLOSED = 3;
const EMPTY_ANSWERED_REQUEST_NOTES: NonNullable<
  ThreadDetailDto['answeredRequestNotes']
> = [];
const EMPTY_ACTIVITY_NOTES: NonNullable<ThreadDetailDto['activityNotes']> = [];
const EMPTY_PENDING_STEERS: NonNullable<ThreadDetailDto['pendingSteers']> = [];
const SUPERVISOR_WORKSPACE_FEATURES: ThreadGraphWorkspaceFeatures = {
  workspace: true,
  toolUsage: false,
  guide: false,
  threadGraph: false,
  extensions: false,
  defaultTab: 'workspace',
};

function actionErrorMessage(caught: unknown, fallback: string) {
  return caught instanceof ApiError
    ? caught.payload.message
    : caught instanceof Error
      ? caught.message
      : fallback;
}

function relayThreadAccessLabel(access: RelayEffectiveAccessDto['threadAccess']) {
  return access === 'read' ? 'View only' : 'Collaborator';
}

function relayWorkspaceAccessLabel(access: RelayEffectiveAccessDto['workspaceAccess']) {
  switch (access) {
    case 'write':
      return 'Workspace write';
    case 'read':
      return 'Workspace read';
    case 'none':
    default:
      return 'No workspace';
  }
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

interface OptimisticTurnState {
  id: string;
  serverTurnId: string | null;
  startedAt: string;
  status: 'sending' | 'inProgress' | 'completed' | 'failed';
  error: string | null;
  prompt: string;
  attachmentPreviews: OptimisticAttachmentPreview[];
  model: string | null;
  reasoningEffort: ThreadDetailDto['thread']['reasoningEffort'];
  reasoningEffortAvailable: boolean | null;
  tokenUsage: ThreadTurnTokenUsageDto | null;
  priceEstimate: ThreadTurnPriceEstimateDto | null;
}

interface OptimisticAttachmentPreview {
  path: string;
  url: string;
}

interface OptimisticSteerState {
  id: string;
  clientRequestId: string;
  turnId: string;
  prompt: string;
  createdAt: string;
  status: 'steering' | 'accepted';
}

interface WorkspaceFocusPathRequest {
  path: string;
  line?: number;
  requestId: number;
}

type PendingThreadSettings = Partial<
  Pick<
    ThreadDto,
    'model' | 'reasoningEffort' | 'fastMode' | 'collaborationMode'
  >
>;

function photoPlaceholderPath(placeholder: string) {
  return placeholder.match(/^\[PHOTO\s+([^\]]+)\]$/)?.[1]?.trim() ?? null;
}

function buildOptimisticAttachmentPreviews(
  attachments: PromptAttachmentUpload[] | undefined,
): OptimisticAttachmentPreview[] {
  if (!attachments?.length || typeof URL.createObjectURL !== 'function') {
    return [];
  }

  return attachments.flatMap((attachment) => {
    if (attachment.kind !== 'photo') {
      return [];
    }

    const path = photoPlaceholderPath(attachment.placeholder);
    if (!path) {
      return [];
    }

    return [
      {
        path,
        url: URL.createObjectURL(attachment.file),
      },
    ];
  });
}

function revokeOptimisticAttachmentPreviews(
  previews: OptimisticAttachmentPreview[],
) {
  if (typeof URL.revokeObjectURL !== 'function') {
    return;
  }

  for (const preview of previews) {
    URL.revokeObjectURL(preview.url);
  }
}

function relativeWorkspaceLinkPath(path: string, workspaceAbsPath: string) {
  const normalizedPath = path.trim().replace(/\\/g, '/').replace(/\/+$/, '');
  const normalizedRoot = workspaceAbsPath.trim().replace(/\\/g, '/').replace(/\/+$/, '');
  if (!normalizedPath) {
    return null;
  }
  if (!normalizedPath.startsWith('/')) {
    return normalizedPath.replace(/^\.\/+/, '').replace(/^\/+/, '');
  }
  if (normalizedPath === normalizedRoot) {
    return '';
  }
  const rootPrefix = `${normalizedRoot}/`;
  if (!normalizedPath.startsWith(rootPrefix)) {
    return null;
  }
  return normalizedPath.slice(rootPrefix.length);
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
  const location = useLocation();
  const navigate = useNavigate();
  const shellNav = useAppShellNav();
  const plugins = usePlugins();
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
  const liveItemsRef = useRef<
    NonNullable<ThreadDetailDto['liveItems']> | null
  >(null);
  const [followTail, setFollowTail] = useState(true);
  const [scrollRequestKey, setScrollRequestKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [busy, setBusy] = useState(false);
  const [activeView, setActiveView] = useState<'chat' | 'shell'>('chat');
  const [workspaceFocusPathRequest, setWorkspaceFocusPathRequest] =
    useState<WorkspaceFocusPathRequest | null>(null);
  const terminalPluginEnabled = plugins.getThreadPanels().some(
    (panel) => panel.kind === 'terminal',
  );

  useEffect(() => {
    liveItemsRef.current = liveItems;
  }, [liveItems]);

  const localShellAdapter = useMemo(
    () => ({
      fetchState: fetchThreadShellState,
      createShell: createThreadShell,
      terminateShell,
      updateShell,
      connectSocket: connectShellSocket,
    }),
    [],
  );
  const getThreadHref = useCallback(
    (threadId: string) => currentThreadHref(threadId),
    [],
  );
  const openThread = useCallback(
    (threadId: string) => {
      navigate(currentThreadHref(threadId));
    },
    [navigate],
  );
  const getNewThreadHref = useCallback(
    (workspaceId?: string | null) => currentNewThreadHref(workspaceId),
    [],
  );
  const renderNewThreadDialogContent = useCallback(
    ({
      close,
      closeNavigation,
      currentWorkspaceId,
    }: {
      close: () => void;
      closeNavigation: () => void;
      currentWorkspaceId?: string | null;
    }) => (
      <ThreadCreateForm
        variant="dialog"
        initialWorkspaceId={currentWorkspaceId}
        onCancel={close}
        onCreated={(thread) => {
          close();
          closeNavigation();
          navigate(currentThreadHref(thread.id));
        }}
      />
    ),
    [navigate],
  );
  const getThreadImageAssetUrl = useCallback(
    ({ threadId, path }: { threadId: string; path: string }) =>
      buildThreadImageAssetUrl(threadId, { path }),
    [],
  );
  const [chatDraft, setChatDraft] = useState<{
    prompt: string;
    attachments: PromptAttachmentUpload[];
  }>({
    prompt: '',
    attachments: [],
  });
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
  useEffect(() => {
    const previews = optimisticTurn?.attachmentPreviews ?? [];
    return () => {
      revokeOptimisticAttachmentPreviews(previews);
    };
  }, [optimisticTurn]);
  const [deletingThread, setDeletingThread] = useState<ThreadDto | null>(null);
  const [deletingThreadBusy, setDeletingThreadBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mcpProviderConfigFileName =
    backendManagementSchema?.hostConfigFiles.find((file) => file.roles?.includes('mcp'))
      ?.name ?? null;
  const {
    expandedGoalIds,
    exportBusy,
    exportDialogOpen,
    exportTurnsState,
    forkTurnOptionsState,
    goalActionBusy,
    goalMonitorOpen,
    goalState,
    handleCreateHook,
    handleExportTranscript,
    handleForkLatest,
    handleForkTurn,
    handleGoalStatusAction,
    handleOpenForkTurns,
    handleOpenGoal,
    handleOpenHooks,
    handleOpenMcp,
    handleOpenSkills,
    handleTerminateGoal,
    handleTrustHook,
    handleUntrustHook,
    handleUpdateGoal,
    handleUpdateHook,
    hooksState,
    loadExportTurns,
    mcpState,
    setExpandedGoalIds,
    setExportDialogOpen,
    setGoalMonitorOpen,
    setGoalState,
    skillsState,
  } = useThreadAuxiliaryActions({
    detailRef,
    id,
    navigate,
    setDetail,
    setError,
    setThreads,
  });
  const [shareBusy, setShareBusy] = useState(false);
  const [threadShareState, setThreadShareState] = useState<{
    status: 'idle' | 'loading' | 'ready' | 'failed';
    shares: ThreadShareSummary[];
    error: string | null;
  }>({
    status: 'idle',
    shares: [],
    error: null,
  });
  const [relayAccessState, setRelayAccessState] = useState<{
    status: 'idle' | 'loading' | 'ready' | 'failed';
    access: RelayEffectiveAccessDto | null;
    error: string | null;
  }>({
    status: 'idle',
    access: null,
    error: null,
  });
  const relayRouteDeviceId = relayDeviceIdFromPath(location.pathname);
  const relayDeviceRouteActive =
    relayModeActive() && Boolean(relayRouteDeviceId);
  const relayAccess = relayAccessState.access;
  const relayThreadIsOwner =
    !relayDeviceRouteActive || relayAccess?.kind === 'owner';
  const relayThreadCanControl =
    relayThreadIsOwner ||
    (relayAccess?.kind === 'shared' && relayAccess.threadAccess === 'control');
  const relayThreadCanShare =
    relayDeviceRouteActive && relayAccess?.kind === 'owner';
  const currentWorkspaceId =
    detail?.workspace.id ?? detail?.thread.workspaceId ?? null;
  const effectiveWorkspaceAccess: 'none' | 'read' | 'write' =
    !relayDeviceRouteActive
      ? 'write'
      : relayAccess?.kind === 'owner'
        ? 'write'
        : relayAccess?.kind === 'shared' &&
            relayAccess.workspaceId &&
            relayAccess.workspaceId === currentWorkspaceId
          ? relayAccess.workspaceAccess
          : 'none';
  const loadThreadShares = useCallback(async () => {
    const currentDetail = detailRef.current;
    const deviceId = currentRelayDeviceIdFromPath();
    if (!relayModeActive() || !currentDetail || !deviceId) {
      setThreadShareState({
        status: 'ready',
        shares: [],
        error: null,
      });
      return;
    }

    setThreadShareState((current) => ({
      ...current,
      status: 'loading',
      error: null,
    }));
    try {
      const portal = await fetchRelayPortal();
      const shares = portal.sharedByMe
        .filter(
          (share) =>
            share.deviceId === deviceId &&
            share.threadId === currentDetail.thread.id,
        )
        .map((share) => ({
          id: share.id,
          targetUsername: share.targetUsername,
          label: share.label,
          threadAccess: share.threadAccess,
          workspaceAccess: share.workspaceAccess,
          createdAt: share.createdAt,
        }));
      setThreadShareState({
        status: 'ready',
        shares,
        error: null,
      });
    } catch (caught) {
      setThreadShareState((current) => ({
        ...current,
        status: 'failed',
        error: actionErrorMessage(caught, 'Unable to load active shares.'),
      }));
    }
  }, [detailRef]);
  const handleCreateThreadShare = useCallback(
    async (input: CreateThreadShareInput) => {
      const currentDetail = detailRef.current;
      const deviceId = currentRelayDeviceIdFromPath();
      if (!relayModeActive() || !currentDetail || !deviceId) {
        setThreadShareState((current) => ({
          ...current,
          status: 'failed',
          error: 'Relay sharing is only available from a relay device route.',
        }));
        return;
      }

      const workspaceId =
        input.workspaceAccess === 'none'
          ? null
          : currentDetail.workspace.id ??
            currentDetail.thread.workspaceId ??
            null;
      if (input.workspaceAccess !== 'none' && !workspaceId) {
        setThreadShareState((current) => ({
          ...current,
          status: 'failed',
          error: 'This thread is not attached to a workspace.',
        }));
        return;
      }

      setShareBusy(true);
      setThreadShareState((current) => ({
        ...current,
        error: null,
      }));
      try {
        await createRelayShare({
          targetIdentifier: input.targetIdentifier,
          deviceId,
          threadId: currentDetail.thread.id,
          workspaceId,
          label: input.label ?? null,
          threadAccess: input.threadAccess,
          workspaceAccess: input.workspaceAccess,
        });
        await loadThreadShares();
      } catch (caught) {
        const message = actionErrorMessage(caught, 'Unable to create share.');
        setThreadShareState((current) => ({
          ...current,
          status: 'failed',
          error: message,
        }));
        setError(message);
      } finally {
        setShareBusy(false);
      }
    },
    [detailRef, loadThreadShares],
  );
  const handleRevokeThreadShare = useCallback(async (shareId: string) => {
    setShareBusy(true);
    setThreadShareState((current) => ({
      ...current,
      error: null,
    }));
    try {
      await revokeRelayShare(shareId);
      await loadThreadShares();
    } catch (caught) {
      const message = actionErrorMessage(caught, 'Unable to revoke share.');
      setThreadShareState((current) => ({
        ...current,
        status: 'failed',
        error: message,
      }));
      setError(message);
    } finally {
      setShareBusy(false);
    }
  }, [loadThreadShares]);
  useEffect(() => {
    if (exportDialogOpen) {
      void loadThreadShares();
    }
  }, [exportDialogOpen, loadThreadShares]);
  useEffect(() => {
    const currentDetail = detailRef.current;
    const deviceId = currentRelayDeviceIdFromPath();
    if (!relayModeActive() || !currentDetail || !deviceId) {
      setRelayAccessState({
        status: 'idle',
        access: null,
        error: null,
      });
      return;
    }

    let cancelled = false;
    setRelayAccessState((current) => ({
      ...current,
      status: 'loading',
      error: null,
    }));
    fetchRelayAccess({
      deviceId,
      threadId: currentDetail.thread.id,
    })
      .then((access) => {
        if (cancelled) {
          return;
        }
        setRelayAccessState({
          status: 'ready',
          access,
          error: null,
        });
      })
      .catch((caught) => {
        if (cancelled) {
          return;
        }
        setRelayAccessState({
          status: 'failed',
          access: null,
          error: actionErrorMessage(caught, 'Unable to verify relay permissions.'),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [detail?.thread.id, detail?.workspace.id, detailRef]);
  useThreadListPolling({
    enabled: Boolean(id),
    setThreads,
  });

  const flushBufferedLiveOutput = useCallback(() => {
    const buffered = liveOutputBufferRef.current;
    liveOutputBufferRef.current = '';
    liveOutputFrameRef.current = null;

    if (!buffered) {
      return;
    }

    startTransition(() => {
      setLiveOutput((current) => current + buffered);
    });
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
        const existingIndex = currentItems.findIndex((entry) => entry.id === item.id);
        const nextItem = mergeLiveHistoryItem(currentItems[existingIndex], item);
        const nextItems =
          existingIndex >= 0
            ? currentItems.map((entry, index) => (index === existingIndex ? nextItem : entry))
            : [...currentItems, nextItem];
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
    (
      turnId: string,
      itemId: string,
      delta: string,
      sequence: number | null,
      createdAt?: string | null,
    ) => {
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
                createdAt: createdAt ?? new Date().toISOString(),
                kind: 'agentMessage',
                text: delta,
                sequence,
              };
        const existingIndex = currentItems.findIndex((item) => item.id === itemId);
        const items =
          existingIndex >= 0
            ? currentItems.map((item, index) =>
                index === existingIndex ? nextItem : item,
              )
            : [...currentItems, nextItem];
        return {
          turnId,
          items,
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
      const nextDetailWithLiveTimestamps = {
        ...nextDetail,
        turns: applyLiveItemTimestampsToTurns(nextDetail.turns, liveItemsRef.current),
      };
      const previousDetail = detailRef.current;
      detailRef.current = nextDetailWithLiveTimestamps;
      setLivePlan(nextDetailWithLiveTimestamps.livePlan ?? null);
      const mergedTurns = previousDetail
        ? appendLatestTurns(previousDetail.turns, nextDetailWithLiveTimestamps.turns)
        : nextDetailWithLiveTimestamps.turns;
      setLiveItems((current) =>
        reconcileLiveItemsWithDetail(
          current,
          nextDetailWithLiveTimestamps.liveItems ?? null,
          mergedTurns,
        ),
      );
      setGoalState((current) =>
        current.status === 'idle'
          ? current
          : {
              ...current,
              data: nextDetailWithLiveTimestamps.goal ?? null,
            },
      );
      const threadHasEnded =
        nextDetailWithLiveTimestamps.thread.activeTurnId === null &&
        nextDetailWithLiveTimestamps.thread.status !== 'running';

      setDetail((current) =>
        current && !nextDetailWithLiveTimestamps.goalHistory
          ? {
              ...nextDetailWithLiveTimestamps,
              turns: appendLatestTurns(current.turns, nextDetailWithLiveTimestamps.turns),
              pendingRequests: mergePendingRequests(
                current.pendingRequests,
                nextDetailWithLiveTimestamps.pendingRequests,
                resolvedRequestIdsRef.current,
              ),
              ...(current.goalHistory ? { goalHistory: current.goalHistory } : {}),
            }
          : current
            ? {
                ...nextDetailWithLiveTimestamps,
                turns: appendLatestTurns(current.turns, nextDetailWithLiveTimestamps.turns),
                pendingRequests: mergePendingRequests(
                  current.pendingRequests,
                  nextDetailWithLiveTimestamps.pendingRequests,
                  resolvedRequestIdsRef.current,
                ),
              }
            : nextDetailWithLiveTimestamps,
      );
      setThreads((current) =>
        mergeThreadIntoList(current, nextDetailWithLiveTimestamps.thread),
      );
      const nextTurnsById = new Map(
        nextDetailWithLiveTimestamps.turns.map((turn) => [turn.id, turn] as const),
      );
      const pendingSteerRequestIds = new Set(
        (nextDetailWithLiveTimestamps.pendingSteers ?? [])
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
            nextDetailWithLiveTimestamps.thread.activeTurnId !== steer.turnId &&
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
        const hasMaterializedTurn = nextDetailWithLiveTimestamps.turns.some(
          (turn) => turn.id === resolvedTurnId,
        );
        const materializedTurn = nextTurnsById.get(resolvedTurnId) ?? null;
        const promptTurn = findTurnWithUserMessage(
          nextDetailWithLiveTimestamps.turns,
          current.prompt,
        );
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
          const materializedTurnHasPrompt =
            turnHasUserMessage(materializedTurn, current.prompt) ||
            (
              promptHasPhotoPlaceholder(current.prompt) &&
              (
                turnHasPhotoPromptText(materializedTurn, current.prompt) ||
                turnHasPhotoAttachment(materializedTurn)
              )
            );

          if (!materializedTurnHasPrompt) {
            return {
              ...current,
              id: materializedTurn.id,
              serverTurnId: materializedTurn.id,
              status: current.status === 'failed' ? current.status : 'inProgress',
            };
          }

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
          promptHasPhotoPlaceholder(current.prompt) &&
          nextDetailWithLiveTimestamps.thread.activeTurnId &&
          nextDetailWithLiveTimestamps.thread.status === 'running'
        ) {
          const activeTurn = nextTurnsById.get(
            nextDetailWithLiveTimestamps.thread.activeTurnId,
          );
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
          nextDetailWithLiveTimestamps.turns.some(
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
      limit = INITIAL_DETAIL_TURN_PAGE_SIZE,
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
    setError(null);
    setLoading(true);
    setChatDraft({
      prompt: '',
      attachments: [],
    });
    setLoadingEarlier(false);
    setMetaSessionCopyState('idle');
    setOptimisticTurn(null);
    setOptimisticSteers([]);
    setLiveItems(null);
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
  }, [id, relayRouteDeviceId]);

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
    void loadThreadDetail({
      showLoading: true,
      limit: INITIAL_DETAIL_TURN_PAGE_SIZE,
    });
  }, [loadThreadDetail]);

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
            event.payload.createdAt ?? event.timestamp,
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

  const handleLoadEarlierTurns = useCallback(async () => {
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
  }, [detail, id, loadingEarlier]);

  async function handlePrompt(input: SendThreadPromptRequestInput) {
    if (activeView === 'shell') {
      if (detail?.thread.isLoaded === false) {
        await handleThreadConnectionToggle({ attachShell: true });
        return false;
      }

      let attemptedShellConnection = false;
      if (shellControlState?.shellInputEnabled !== true) {
        if (
          shellControlState?.loading === false &&
          shellControlState?.isConnecting !== true &&
          shellControlState?.status !== 'creating' &&
          shellControlState?.status !== 'workspace_missing'
        ) {
          await shellPanelRef.current?.toggleConnection();
          attemptedShellConnection = true;
        }
        if (shellControlState?.isConnecting === true) {
          setError('Connecting to the shell. Try again after it attaches.');
          return false;
        }
      }

      const sent = shellPanelRef.current?.sendCommand(input.prompt) ?? false;
      if (!sent) {
        setError(
          attemptedShellConnection
            ? 'Shell is still attaching. Try again after it connects.'
            : 'Connect the shell before sending commands.',
        );
        return false;
      } else {
        setError(null);
      }
      return true;
    }

    if (promptDisabledReason) {
      setError(promptDisabledReason);
      return false;
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
    let optimisticAttachmentPreviews: OptimisticAttachmentPreview[] = [];

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
        optimisticAttachmentPreviews = buildOptimisticAttachmentPreviews(
          input.attachments,
        );
        clearBufferedLiveOutput();
        setLiveOutput('');
        setOptimisticTurn({
          id: optimisticTurnId,
          serverTurnId: null,
          startedAt: optimisticStartedAt,
          status: 'sending',
          error: null,
          prompt: input.prompt,
          attachmentPreviews: optimisticAttachmentPreviews,
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
          optimisticAttachmentPreviews = buildOptimisticAttachmentPreviews(
            input.attachments,
          );
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
            attachmentPreviews: optimisticAttachmentPreviews,
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

  async function ensureThreadConnectedForGoal() {
    const currentDetail = detailRef.current;
    if (!currentDetail) {
      setError('Thread detail is still loading.');
      return false;
    }

    if (currentDetail.thread.isLoaded) {
      return true;
    }

    setBusy(true);
    setError(null);

    try {
      const resumed = await resumeThread(
        id,
        {
          ...(currentDetail.thread.model ? { model: currentDetail.thread.model } : {}),
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
      return true;
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Unable to connect this thread before setting its goal.',
      );
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleComposerGoalSubmit(input: {
    objective?: string | null;
    status?: NonNullable<ThreadDetailDto['goal']>['status'] | null;
    tokenBudget?: number | null;
  }) {
    const objective = input.objective?.trim() ?? '';
    const optimisticTurnId = objective
      ? `optimistic-goal-${Date.now()}`
      : null;
    const startedAt = new Date().toISOString();
    const currentDetail = detailRef.current;
    const optimisticThread = currentDetail?.thread ?? null;

    if (optimisticTurnId) {
      setScrollRequestKey((current) => current + 1);
      setOptimisticTurn({
        id: optimisticTurnId,
        serverTurnId: null,
        startedAt,
        status: 'sending',
        error: null,
        prompt: objective,
        attachmentPreviews: [],
        model: optimisticThread?.model ?? null,
        reasoningEffort: optimisticThread?.reasoningEffort ?? null,
        reasoningEffortAvailable: getReasoningEffortAvailability(
          modelOptions,
          optimisticThread?.model ?? null,
        ),
        tokenUsage: null,
        priceEstimate: null,
      });
    }

    try {
      await handleUpdateGoal(input);
      if (optimisticTurnId) {
        setOptimisticTurn((current) =>
          current && current.id === optimisticTurnId
            ? {
                ...current,
                status: 'completed',
                error: null,
              }
            : current,
        );
      }
    } catch (caught) {
      const message =
        caught instanceof ApiError
          ? caught.payload.message
          : caught instanceof Error
            ? caught.message
            : 'Unable to set goal.';
      setError(message);
      if (optimisticTurnId) {
        setOptimisticTurn((current) =>
          current && current.id === optimisticTurnId
            ? {
                ...current,
                status: 'failed',
                error: message,
              }
            : current,
        );
      }
      throw caught;
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

  const handleRespondToRequest = useCallback(async (
    requestId: string,
    input: { answers: Record<string, { answers: string[] }> },
  ) => {
    if (relayAccess?.kind === 'shared' && relayAccess.threadAccess === 'read') {
      setError('This shared session is view only.');
      return;
    }
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
  }, [id]);

  const handleLoadHistoryItemDetail = useCallback(
    (itemId: string) => fetchThreadHistoryItemDetail(id, itemId),
    [id],
  );

  const handleCancelPendingSteer = useCallback(
    async (threadId: string, pendingSteerId: string) => {
      setError(null);
      try {
        const updated = await cancelPendingSteer(threadId, pendingSteerId);
        setDetail((current) =>
          current
            ? {
                ...updated,
                turns: appendLatestTurns(current.turns, updated.turns),
              }
            : updated,
        );
        setThreads((current) =>
          current.map((entry) =>
            entry.id === updated.thread.id ? updated.thread : entry,
          ),
        );
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : 'Unable to cancel queued prompt.',
        );
        throw caught;
      }
    },
    [],
  );

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
        navigate(nextThread ? currentThreadHref(nextThread.id) : currentThreadsHref());
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
      shellPanelRef.current?.refreshLayout({ syncBackendSize: false });
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [activeView]);

  const promptDisabledReason = detail
    ? detail.workspacePathStatus === 'missing'
      ? 'Restore this workspace path on the current machine before continuing.'
      : relayDeviceRouteActive && relayAccessState.status === 'loading'
        ? 'Checking relay permissions...'
      : relayDeviceRouteActive && relayAccessState.status === 'failed'
        ? relayAccessState.error ?? 'Unable to verify relay permissions.'
      : relayAccess?.kind === 'shared' && relayAccess.threadAccess === 'read'
        ? 'This shared session is view only.'
      : null
    : null;
  const {
    floatingMobileComposerBottomOffset,
    timelineBottomSpacer,
    useFloatingMobileComposer,
  } = useMobileComposerLayout({
    activeView,
    composerHostRef,
    threadId: detail?.thread.id ?? id,
  });

  const metaContent = detail ? (
    <dl className="space-y-4 text-sm">
      <div className="relative pr-9">
        <dt className="text-[var(--theme-fg-muted)]">Session ID</dt>
        <dd className="mt-1 break-all text-[var(--theme-fg)]">
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
            className={`thread-mobile-hit-target absolute bottom-0 right-0 inline-flex h-5 w-5 items-center justify-center rounded-full border shadow-sm backdrop-blur transition ${
              metaSessionCopyState === 'copied'
                ? 'ui-status-info'
                : metaSessionCopyState === 'failed'
                  ? 'ui-status-danger'
                  : 'border-[var(--theme-border)] bg-[var(--theme-surface-strong)] text-[var(--theme-fg-soft)] hover:bg-[var(--theme-hover)] hover:text-[var(--theme-fg)]'
            }`}
          >
            <span className="scale-[0.72]">
              <CopyIcon />
            </span>
          </button>
        )}
      </div>
      <div>
        <dt className="text-[var(--theme-fg-muted)]">Source</dt>
        <dd className="mt-1 text-[var(--theme-fg)]">
          {detail.thread.source === 'local_codex_import'
            ? `Imported local ${detail.thread.provider} session`
            : `${detail.thread.provider} supervisor thread`}
        </dd>
      </div>
      <div>
        <dt className="text-[var(--theme-fg-muted)]">Status</dt>
        <dd className="mt-1 text-[var(--theme-fg)]">
          {threadStatusLabel(detail.thread.status)}
        </dd>
      </div>
      <div>
        <dt className="text-[var(--theme-fg-muted)]">Created</dt>
        <dd className="mt-1 text-[var(--theme-fg)]">
          {formatLongTimestamp(detail.thread.createdAt)}
        </dd>
      </div>
      <div>
        <dt className="text-[var(--theme-fg-muted)]">Workspace</dt>
        <dd className="mt-1 break-words text-[var(--theme-fg)]">
          {detail.workspace.absPath}
        </dd>
      </div>
      <div>
        <dt className="text-[var(--theme-fg-muted)]">Workspace path</dt>
        <dd className="mt-1 text-[var(--theme-fg)]">
          {detail.workspacePathStatus === 'present' ? 'Present' : 'Missing on this machine'}
        </dd>
      </div>
      <div>
        <dt className="text-[var(--theme-fg-muted)]">Active turn</dt>
        <dd className="mt-1 text-[var(--theme-fg)]">
          {detail.thread.activeTurnId ?? 'None'}
        </dd>
      </div>
    </dl>
  ) : null;

  const settingsContent = null;

  const optimisticServerTurnId = optimisticTurn?.serverTurnId ?? null;
  const optimisticMaterializedTurn =
    optimisticTurn && detail
      ? detail.turns.find(
          (turn) => {
            const hasOptimisticPrompt =
              turnHasUserMessage(turn, optimisticTurn.prompt) ||
              (
                promptHasPhotoPlaceholder(optimisticTurn.prompt) &&
                (
                  turnHasPhotoPromptText(turn, optimisticTurn.prompt) ||
                  turnHasPhotoAttachment(turn)
                )
              );

            return (
              hasOptimisticPrompt &&
              (
                (optimisticServerTurnId && turn.id === optimisticServerTurnId) ||
                turn.id === optimisticTurn.id ||
                turnHasUserMessage(turn, optimisticTurn.prompt) ||
                (
                  promptHasPhotoPlaceholder(optimisticTurn.prompt) &&
                  turnHasPhotoPromptText(turn, optimisticTurn.prompt)
                )
              )
            );
          },
        ) ?? null
      : null;
  const timelineOptimisticTurn = useMemo(
    () =>
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
                attachmentPreviewUrls: Object.fromEntries(
                  optimisticTurn.attachmentPreviews.map((preview) => [
                    preview.path,
                    preview.url,
                  ]),
                ),
              },
            ],
          }
        : null,
    [optimisticMaterializedTurn, optimisticTurn],
  );

  const threadLoaded = detail?.thread.isLoaded ?? false;
  const realtimeConnectionIndicatorClassName =
    !threadLoaded
      ? 'host-icon-button border shadow-[var(--theme-shadow)]'
    : realtimeConnection.status === 'connected'
      ? 'ui-action-success shadow-[var(--theme-shadow)]'
    : realtimeConnection.status === 'reconnecting'
        ? 'thread-live-connection-reconnecting ui-status-success shadow-[var(--theme-shadow)]'
        : realtimeConnection.status === 'offline'
          ? 'ui-status-danger shadow-[var(--theme-shadow)]'
          : 'ui-status-warning shadow-[var(--theme-shadow)]';
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
    <div className="host-dialog w-96 max-w-[calc(100vw-1.5rem)] rounded-lg border p-3 text-left shadow-[var(--theme-shadow)] backdrop-blur">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="host-page-title text-sm font-semibold">Goal monitor</p>
          <p className="host-muted text-xs">Current thread only</p>
        </div>
        <button
          type="button"
          onClick={() => setGoalMonitorOpen(false)}
          className="host-secondary-button rounded-md border px-2.5 py-1 text-xs transition"
        >
          Close
        </button>
      </div>
      {goalState.error ? (
        <p className="host-error mt-3 rounded-lg border px-3 py-2 text-xs">
          {goalState.error}
        </p>
      ) : null}
      <div className="mt-3 max-h-[28rem] space-y-2 overflow-auto pr-1">
        {monitorGoals.length === 0 ? (
          <p className="host-empty-state rounded-lg border px-3 py-3 text-sm">
            No goals in this thread yet.
          </p>
        ) : (
          monitorGoals.map((goal) => {
            const key = `${goal.threadId}:${goal.objective}:${goal.createdAt}`;
            const expanded = expandedGoalIds.has(key);
            const active = ['active', 'paused', 'budgetLimited'].includes(goal.status);
            return (
              <div
                key={key}
                className={`rounded-lg border px-3 py-3 ${
                  active
                    ? 'ui-status-info'
                    : 'host-surface-strong'
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
                  <span className="host-muted shrink-0 rounded-full border border-[var(--theme-border)] px-2 py-1 text-[10px] uppercase tracking-[0.14em]">
                    {goal.status}
                  </span>
                </div>
                <div className="host-muted mt-2 flex flex-wrap gap-2 text-[11px]">
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
                      className="ui-status-info rounded-md px-3 py-1.5 text-xs transition disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Continue
                    </button>
                    <button
                      type="button"
                      disabled={goalActionBusy || goal.status === 'paused'}
                      onClick={() => void handleGoalStatusAction('paused')}
                      className="host-secondary-button rounded-md border px-3 py-1.5 text-xs transition disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Pause
                    </button>
                    <button
                      type="button"
                      disabled={goalActionBusy}
                      onClick={() => void handleTerminateGoal()}
                      className="rounded-md border border-[var(--status-danger-border)] px-3 py-1.5 text-xs text-[var(--status-danger-fg)] transition hover:bg-[var(--status-danger-bg)] disabled:cursor-not-allowed disabled:opacity-50"
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
      className="ui-status-info inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full shadow-[var(--theme-shadow)] transition lg:h-9 lg:w-9"
    >
      {goalIndicatorIcon}
    </button>
  ) : null;
  const relayAccessBadge = useMemo(
    () =>
      relayAccess?.kind === 'shared' ? (
        <div
          className="host-secondary-button inline-flex max-w-[10rem] items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium sm:max-w-[16rem]"
          title={`${relayThreadAccessLabel(relayAccess.threadAccess)} / ${relayWorkspaceAccessLabel(relayAccess.workspaceAccess)}`}
        >
          <span>{relayThreadAccessLabel(relayAccess.threadAccess)}</span>
          <span className="host-muted">/</span>
          <span className="truncate">
            {relayWorkspaceAccessLabel(relayAccess.workspaceAccess)}
          </span>
        </div>
      ) : null,
    [relayAccess],
  );
  const threadActionsButton = useMemo(
    () => (
      <button
        type="button"
        aria-label="Thread actions"
        title="Thread actions"
        onClick={() => setExportDialogOpen(true)}
        disabled={!detail}
        className="host-icon-button inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border shadow-[var(--theme-shadow)] transition disabled:cursor-not-allowed disabled:opacity-50 lg:h-9 lg:w-9"
      >
        <ExportIcon />
      </button>
    ),
    [detail],
  );
  const mobileSessionConnectionButton = useMemo(
    () => (
      <div className="relative flex items-center justify-end gap-1.5">
        {goalMonitorButton}
        {relayAccessBadge}
        {mobileSessionConnectionControl}
      </div>
    ),
    [goalMonitorButton, mobileSessionConnectionControl, relayAccessBadge],
  );
  const surfaceActions = useMemo(
    () => (
      <div className="flex items-center justify-end gap-2">
        {relayAccessBadge}
        {goalMonitorButton}
        {desktopSessionConnectionIndicator}
      </div>
    ),
    [desktopSessionConnectionIndicator, goalMonitorButton, relayAccessBadge],
  );
  const timelineProps = useMemo<Partial<ThreadTimelineProps>>(
    () => ({
      livePlan,
      liveItems,
      respondingRequestId,
      onRespondToRequest: handleRespondToRequest,
      scrollRequestKey,
      bottomSpacer: timelineBottomSpacer,
      className: 'thread-timeline-surface min-h-0 flex-1',
      onTailVisibilityChange: setFollowTail,
      loadingEarlier,
      onLoadEarlier: handleLoadEarlierTurns,
      onOpenThread: openThread,
      answeredRequestNotes:
        detail?.answeredRequestNotes ?? EMPTY_ANSWERED_REQUEST_NOTES,
      activityNotes: detail?.activityNotes ?? EMPTY_ACTIVITY_NOTES,
      pendingSteers: detail?.pendingSteers ?? EMPTY_PENDING_STEERS,
      optimisticSteers,
      optimisticTurn: timelineOptimisticTurn,
    }),
    [
      detail?.answeredRequestNotes,
      detail?.activityNotes,
      detail?.pendingSteers,
      handleLoadEarlierTurns,
      handleRespondToRequest,
      liveItems,
      livePlan,
      loadingEarlier,
      openThread,
      optimisticSteers,
      respondingRequestId,
      scrollRequestKey,
      timelineBottomSpacer,
      timelineOptimisticTurn,
    ],
  );
  const chatComposerProps = detail
    ? ({
        busy: activeView === 'chat' ? busy : false,
        settingsBusy,
        error: null,
        model: detail.thread.model,
        reasoningEffort: detail.thread.reasoningEffort,
        fastMode: detail.thread.fastMode ?? false,
        collaborationMode: detail.thread.collaborationMode,
        sandboxMode: null,
        modelOptions,
        contextUsage: detail.thread.contextUsage,
        capabilities: backendCapabilities,
        toolboxItems: backendManagementSchema?.toolboxItems ?? [],
        hookCommandTemplates:
          backendManagementSchema?.hookCommandTemplates ?? [],
        mcpConfigFormat: backendManagementSchema?.mcpConfigFormat ?? 'none',
        followTail,
        threadConnected: detail.thread.isLoaded,
        shellAvailable: terminalPluginEnabled,
        disabled: Boolean(promptDisabledReason),
        ...(promptDisabledReason
          ? { disabledPlaceholder: promptDisabledReason }
          : {}),
        shellControlState,
        draftPrompt: chatDraft.prompt,
        draftAttachments: chatDraft.attachments,
        onDraftChange: setChatDraft,
        canInterrupt: Boolean(
          detail.thread.activeTurnId && relayThreadCanControl,
        ),
        ...(relayThreadCanControl ? { onInterrupt: handleInterrupt } : {}),
        ...(relayThreadCanControl
          ? {
              onCompact: handleCompactThread,
              onOpenForkTurns: handleOpenForkTurns,
              onForkLatest: handleForkLatest,
              onForkTurn: handleForkTurn,
              onOpenSkills: handleOpenSkills,
              onOpenMcp: handleOpenMcp,
              onOpenHooks: handleOpenHooks,
              onCreateHook: handleCreateHook,
              onUpdateHook: handleUpdateHook,
              onTrustHook: handleTrustHook,
              onUntrustHook: handleUntrustHook,
            }
          : {}),
        goalState,
        ...(relayThreadCanControl
          ? {
              onOpenGoal: handleOpenGoal,
              onPrepareGoalSubmit: ensureThreadConnectedForGoal,
              onUpdateGoal: handleComposerGoalSubmit,
            }
          : {}),
        ...(mcpProviderConfigFileName
          ? {
              ...(relayThreadIsOwner
                ? {
                    onReadProviderConfig: () =>
                      fetchProviderHostFile(
                        detail.thread.provider,
                        mcpProviderConfigFileName,
                      ),
                    onWriteProviderConfig: (content: string) =>
                      updateProviderHostFile(
                        detail.thread.provider,
                        mcpProviderConfigFileName,
                        { content },
                      ),
                  }
                : {}),
            }
          : {}),
        onToggleFollow: () => setScrollRequestKey((current) => current + 1),
        ...(relayThreadCanControl
          ? { onUpdateSettings: handleUpdateThreadSettings }
          : {}),
        onToggleView: handleToggleView,
        onShellCopy: handleShellCopy,
        ...(relayThreadCanControl ? { onShellControl: handleShellControl } : {}),
        compactBusy,
        skillsState,
        mcpState,
        hooksState,
        forkTurnOptionsState,
      } satisfies Omit<ThreadComposerProps, 'activeView' | 'onSubmit'>)
    : null;
  const shellComposerProps = detail
    ? ({
        busy,
        settingsBusy: false,
        error: detail.thread.isLoaded ? shellControlState?.error ?? null : null,
        followTail: false,
        capabilities: backendCapabilities,
        toolboxItems: backendManagementSchema?.toolboxItems ?? [],
        hookCommandTemplates:
          backendManagementSchema?.hookCommandTemplates ?? [],
        mcpConfigFormat: backendManagementSchema?.mcpConfigFormat ?? 'none',
        threadConnected: detail.thread.isLoaded,
        shellAvailable: terminalPluginEnabled,
        shellControlState,
        canInterrupt: Boolean(
          detail.thread.isLoaded &&
            shellControlState?.isCommandRunning &&
            relayThreadCanControl,
        ),
        ...(relayThreadCanControl ? { onInterrupt: handleInterrupt } : {}),
        onToggleView: handleToggleView,
        onShellCopy: handleShellCopy,
        ...(relayThreadCanControl ? { onShellControl: handleShellControl } : {}),
      } satisfies Omit<ThreadComposerProps, 'activeView' | 'onSubmit'>)
    : null;
  const getCurrentThreadImageAssetUrl = useCallback(
    (path: string) =>
      detail
        ? getThreadImageAssetUrl({ threadId: detail.thread.id, path })
        : '',
    [detail?.thread.id, getThreadImageAssetUrl],
  );
  const workspaceAdapter = useThreadWorkspaceAdapter({
    setError,
    workspaceId: detail?.workspace.id ?? null,
    access: effectiveWorkspaceAccess,
  });
  const handleOpenWorkspaceFile = useCallback(
    (input: { path: string; line?: number }) => {
      const currentDetail = detailRef.current;
      if (!currentDetail) {
        return;
      }

      const relativePath = relativeWorkspaceLinkPath(
        input.path,
        currentDetail.workspace.absPath,
      );
      if (relativePath === null) {
        setError(`Cannot open ${input.path}; it is outside this workspace.`);
        return;
      }

      setActiveView('chat');
      setWorkspaceFocusPathRequest((current) => ({
        path: relativePath,
        ...(input.line !== undefined ? { line: input.line } : {}),
        requestId: (current?.requestId ?? 0) + 1,
      }));
    },
    [],
  );
  const surfaceAdapter = useMemo(
    () => ({
      openThread,
      getThreadHref,
      getNewThreadHref,
      renderNewThreadDialogContent,
      ...(relayThreadIsOwner ? { renameThread: handleRenameThread } : {}),
      ...(relayThreadIsOwner ? { deleteThread: setDeletingThread } : {}),
      cancelPendingSteer: handleCancelPendingSteer,
      sendPrompt: handlePrompt,
      ...(relayThreadCanControl ? { interrupt: handleInterrupt } : {}),
      ...(relayThreadCanControl ? { compact: handleCompactThread } : {}),
      ...(relayThreadCanControl
        ? { updateSettings: handleUpdateThreadSettings }
        : {}),
      loadHistoryItemDetail: handleLoadHistoryItemDetail,
      getImageAssetUrl: getCurrentThreadImageAssetUrl,
      openWorkspaceFile: handleOpenWorkspaceFile,
      workspace: workspaceAdapter,
      shell: localShellAdapter,
    }),
    [
      getCurrentThreadImageAssetUrl,
      getNewThreadHref,
      getThreadHref,
      renderNewThreadDialogContent,
      handleCompactThread,
      handleCancelPendingSteer,
      handleInterrupt,
      handleLoadHistoryItemDetail,
      handleOpenWorkspaceFile,
      handlePrompt,
      handleRenameThread,
      handleUpdateThreadSettings,
      localShellAdapter,
      openThread,
      relayThreadCanControl,
      relayThreadIsOwner,
      workspaceAdapter,
    ],
  );
  const workspaceReturnHref = detail?.thread.workspaceId
    ? currentThreadsHref(detail.thread.workspaceId)
    : currentWorkspacesHref();
  const dialogs = useMemo(
    () => (
      <>
        <ThreadActionsDialog
          open={exportDialogOpen}
          busy={exportBusy || shareBusy}
          turnsState={exportTurnsState}
          shareAvailable={relayThreadCanShare}
          {...(relayDeviceRouteActive && relayAccess?.kind === 'shared'
            ? { shareUnavailableMessage: 'Only the owner can share this session.' }
            : {})}
          shareState={threadShareState}
          onCancel={() => {
            if (!exportBusy && !shareBusy) {
              setExportDialogOpen(false);
            }
          }}
          onLoadTurns={loadExportTurns}
          onExport={handleExportTranscript}
          {...(relayThreadCanShare
            ? {
                onCreateShare: handleCreateThreadShare,
                onRevokeShare: handleRevokeThreadShare,
              }
            : {})}
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
    ),
    [
      deletingThread,
      deletingThreadBusy,
      exportBusy,
      exportDialogOpen,
      exportTurnsState,
      handleCreateThreadShare,
      handleDeleteThread,
      handleExportTranscript,
      handleRevokeThreadShare,
      loadExportTurns,
      relayDeviceRouteActive,
      shareBusy,
      threadShareState,
    ],
  );

  return (
    <ThreadDetailSurface
      threads={threads}
      detail={detail}
      status={status}
      loading={loading}
      error={loading ? null : error}
      plugins={plugins}
      adapter={surfaceAdapter}
      metaContent={metaContent}
      settingsContent={settingsContent}
      globalSettingsContent={<AppShellSettingsDialog embedded />}
      mobileHeaderAction={mobileSessionConnectionButton}
      workspaceReturnHref={workspaceReturnHref}
      onCloseAppNavigation={shellNav?.closeNav ?? (() => {})}
      threadActionsButton={threadActionsButton}
      surfaceActions={surfaceActions}
      floatingPanel={goalMonitorPanel}
      workspaceFeatures={SUPERVISOR_WORKSPACE_FEATURES}
      workspaceFocusPathRequest={workspaceFocusPathRequest}
      activeView={activeView}
      liveOutput={liveOutput}
      timelineProps={timelineProps}
      timelineComponent={ThreadTimeline}
      useFloatingMobileComposer={useFloatingMobileComposer}
      floatingMobileComposerBottomOffset={floatingMobileComposerBottomOffset}
      composerHostRef={composerHostRef}
      shellPanelRef={shellPanelRef}
      shellPanelComponent={ThreadShellPanel}
      shellEffectiveTheme={shellNav?.effectiveTheme ?? 'dark'}
      shellThemeMode={shellNav?.themeMode ?? 'system'}
      {...(shellNav?.setThemeMode
        ? { onShellThemeModeChange: shellNav.setThemeMode }
        : {})}
      onShellStateChange={setShellControlState}
      loadingContent={
        <div className="host-muted flex flex-1 items-center justify-center px-6 py-12 text-center">
          Loading thread detail...
        </div>
      }
      emptyContent={
        <div className="host-muted flex flex-1 items-center justify-center px-6 py-12 text-center">
          Unable to resolve this thread.
        </div>
      }
      dialogs={dialogs}
      {...(chatComposerProps ? { composerProps: chatComposerProps } : {})}
      {...(shellComposerProps ? { shellComposerProps } : {})}
    />
  );
}
