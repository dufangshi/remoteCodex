import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AgentBackendToolboxItemSchemaDto,
  AgentProviderCapabilitiesDto,
  AgentSubscriptionUsageDto,
  ExportThreadPdfInput,
  ModelOptionDto,
  RelayEffectiveAccessDto,
  ThreadDetailDto,
  ThreadDto,
  ThreadExportTurnOptionsDto,
  UpdateThreadGoalInput,
  UpdateThreadSettingsInput,
} from '@remote-codex/shared';
import type {
  CreateThreadShareInput,
  ThreadDetailUiAdapter,
  ThreadShareSummary,
  ThreadWorkspaceAdapter,
} from '@remote-codex/thread-ui';
import {
  ConfirmDialog,
  formatLongTimestamp,
  PluginProvider,
  ThreadActionsDialog,
  ThreadDetailSurface,
  threadStatusLabel,
} from '@remote-codex/thread-ui';
import { Copy, Share2 } from 'lucide-react';

import { AndroidApiClient } from './AndroidApiClient';
import {
  applyAndroidTheme,
  type AndroidThemeMode,
  type AndroidThreadBootstrap,
} from './AndroidBootstrap';
import {
  hasNativeFilePickerBridge,
  pickNativeFile,
  type NativeFilePickResult,
} from './AndroidNativeHttp';
import { postAndroidMessage } from './AndroidNativeBridge';
import { buildOptimisticPromptDetail } from './AndroidOptimisticPrompt';
import { subscribeToThreadEvents } from './AndroidWebSocket';
import { projectThreadEventIntoDetail } from './AndroidWebSocketProjection';
import { MobileThreadCreateDialogContent } from './MobileThreadCreateDialogContent';

interface AndroidThreadDetailPageProps {
  bootstrap: AndroidThreadBootstrap;
}

const THREAD_HISTORY_INITIAL_LIMIT = 3;
const THREAD_HISTORY_PAGE_SIZE = 3;
const THREAD_REFRESH_INTERVAL_MS = 1500;

type PanelState<T> = {
  status: 'idle' | 'loading' | 'ready' | 'failed';
  data: T | null;
  error: string | null;
};

const idleExportTurnsState: PanelState<ThreadExportTurnOptionsDto> = {
  status: 'idle',
  data: null,
  error: null,
};

function errorMessage(caught: unknown) {
  return caught instanceof Error ? caught.message : 'Thread failed to load.';
}

function replaceThread(threads: ThreadDto[], updated: ThreadDto) {
  return threads.map((thread) => (thread.id === updated.id ? updated : thread));
}

function removeThread(threads: ThreadDto[], threadId: string) {
  return threads.filter((thread) => thread.id !== threadId);
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

function mergeEarlierThreadHistory(
  current: ThreadDetailDto,
  earlier: ThreadDetailDto,
) {
  const existingIds = new Set(current.turns.map((turn) => turn.id));
  const mergedTurns = [
    ...earlier.turns.filter((turn) => !existingIds.has(turn.id)),
    ...current.turns,
  ];

  return {
    ...earlier,
    turns: mergedTurns,
    totalTurnCount: Math.max(
      current.totalTurnCount ?? current.turns.length,
      earlier.totalTurnCount ?? earlier.turns.length,
      mergedTurns.length,
    ),
  };
}

function fileFromNativePick(
  file: NonNullable<NativeFilePickResult['file']>,
) {
  const binary = atob(file.base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new File([bytes], file.filename, {
    type: file.contentType ?? 'application/octet-stream',
  });
}

export function AndroidThreadDetailPage({
  bootstrap,
}: AndroidThreadDetailPageProps) {
  const [threads, setThreads] = useState<ThreadDto[]>([]);
  const [detail, setDetail] = useState<ThreadDetailDto | null>(null);
  const detailRef = useRef<ThreadDetailDto | null>(null);
  const promptSubmissionInFlightRef = useRef(false);
  const projectedEventRevisionRef = useRef(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [followTail, setFollowTail] = useState(true);
  const [scrollRequestKey, setScrollRequestKey] = useState(0);
  const [previousTurnScrollRequestKey, setPreviousTurnScrollRequestKey] = useState(0);
  const [nextTurnScrollRequestKey, setNextTurnScrollRequestKey] = useState(0);
  const [canJumpToPreviousTurn, setCanJumpToPreviousTurn] = useState(false);
  const [canJumpToNextTurn, setCanJumpToNextTurn] = useState(false);
  const [historyLimit, setHistoryLimit] = useState(THREAD_HISTORY_INITIAL_LIMIT);
  const historyLimitRef = useRef(THREAD_HISTORY_INITIAL_LIMIT);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [deletingThread, setDeletingThread] = useState<ThreadDto | null>(null);
  const [deletingThreadBusy, setDeletingThreadBusy] = useState(false);
  const [exportTurnsState, setExportTurnsState] =
    useState<PanelState<ThreadExportTurnOptionsDto>>(idleExportTurnsState);
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
  const [metaSessionCopyState, setMetaSessionCopyState] =
    useState<'idle' | 'copied' | 'failed'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [modelOptions, setModelOptions] = useState<ModelOptionDto[]>([]);
  const [toolboxItems, setToolboxItems] = useState<
    AgentBackendToolboxItemSchemaDto[]
  >([]);
  const [capabilities, setCapabilities] =
    useState<AgentProviderCapabilitiesDto | null>(null);
  const [subscriptionUsage, setSubscriptionUsage] =
    useState<AgentSubscriptionUsageDto | null>(null);
  const [subscriptionUsageRefreshKey, setSubscriptionUsageRefreshKey] =
    useState(0);
  const [sceneActive, setSceneActive] = useState(true);
  const sceneActiveRef = useRef(true);
  const [sceneActivationKey, setSceneActivationKey] = useState(0);
  const [themeMode, setThemeMode] = useState<AndroidThemeMode>(
    bootstrap.theme ?? 'system',
  );
  const [effectiveThemeValue, setEffectiveThemeValue] = useState(() =>
    applyAndroidTheme(bootstrap.theme ?? 'system'),
  );
  const client = useMemo(() => new AndroidApiClient(bootstrap), [bootstrap]);
  const relayDeviceId = bootstrap.mode === 'relay' ? bootstrap.relayDeviceId : null;
  const relayShareAvailable = Boolean(relayDeviceId);

  useEffect(() => {
    detailRef.current = detail;
  }, [detail]);

  useEffect(() => {
    const provider = detail?.thread.provider;
    if (!provider || (provider !== 'codex' && provider !== 'claude')) {
      setSubscriptionUsage(null);
      return;
    }
    let cancelled = false;
    const refresh = async () => {
      try {
        const result = await client.fetchAgentSubscriptionUsage(provider);
        if (!cancelled) {
          setSubscriptionUsage(
            result.usage?.authKind === 'subscription' && result.usage.windows.length
              ? result.usage
              : null,
          );
        }
      } catch {
        if (!cancelled) {
          setSubscriptionUsage((current) => current ? { ...current, stale: true } : null);
        }
      }
    };
    void refresh();
    const interval = window.setInterval(refresh, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [
    client,
    detail?.thread.lastTurnCompletedAt,
    detail?.thread.provider,
    subscriptionUsageRefreshKey,
  ]);

  useEffect(() => {
    historyLimitRef.current = historyLimit;
  }, [historyLimit]);

  useEffect(() => {
    historyLimitRef.current = THREAD_HISTORY_INITIAL_LIMIT;
    setHistoryLimit(THREAD_HISTORY_INITIAL_LIMIT);
  }, [bootstrap.threadId]);

  useEffect(() => {
    setThemeMode(bootstrap.theme ?? 'system');
  }, [bootstrap.theme]);

  useEffect(() => {
    const applyTheme = () => {
      setEffectiveThemeValue(applyAndroidTheme(themeMode));
    };
    applyTheme();
    if (themeMode !== 'system') {
      return;
    }
    const mediaQuery = window.matchMedia?.('(prefers-color-scheme: dark)');
    mediaQuery?.addEventListener('change', applyTheme);
    return () => {
      mediaQuery?.removeEventListener('change', applyTheme);
    };
  }, [themeMode]);

  useEffect(() => {
    const previousHost = window.remoteCodexAndroidHost;
    let resumeTimer: number | null = null;
    const applySceneActive = (active: boolean) => {
      const nextActive = Boolean(active);
      if (sceneActiveRef.current === nextActive) {
        return false;
      }
      sceneActiveRef.current = nextActive;
      setSceneActive(nextActive);
      if (nextActive) {
        setSceneActivationKey((current) => current + 1);
      }
      postAndroidMessage({
        type: 'threadWebDebug',
        message: `scene:${nextActive ? 'active' : 'inactive'}`,
      });
      return true;
    };
    window.remoteCodexAndroidHost = {
      ...previousHost,
      setSceneActive(active: boolean) {
        applySceneActive(active);
      },
      resumeSceneActive() {
        if (resumeTimer !== null) {
          window.clearTimeout(resumeTimer);
        }
        if (sceneActiveRef.current) {
          applySceneActive(false);
          resumeTimer = window.setTimeout(() => {
            resumeTimer = null;
            applySceneActive(true);
          }, 0);
          return;
        }
        applySceneActive(true);
      },
      setTheme(theme: AndroidThemeMode) {
        setThemeMode(theme);
      },
      openSettings() {
        setSettingsDialogOpen(true);
      },
    };

    const handlePageInactive = () => applySceneActive(false);
    const handlePageActive = () =>
      window.remoteCodexAndroidHost?.resumeSceneActive?.();
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        handlePageInactive();
      } else if (document.visibilityState === 'visible') {
        handlePageActive();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageInactive);
    window.addEventListener('pageshow', handlePageActive);
    return () => {
      if (resumeTimer !== null) {
        window.clearTimeout(resumeTimer);
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageInactive);
      window.removeEventListener('pageshow', handlePageActive);
      if (previousHost) {
        window.remoteCodexAndroidHost = previousHost;
      } else {
        delete window.remoteCodexAndroidHost;
      }
    };
  }, []);

  const refreshThreadDetail = useCallback(
    async ({
      showLoading = false,
      reportError = false,
    }: {
      showLoading?: boolean;
      reportError?: boolean;
    } = {}) => {
      if (!bootstrap.threadId) {
        setError('No thread id was provided by the native host.');
        setLoading(false);
        return;
      }
      if (showLoading) {
        setLoading(true);
      }
      const projectionRevision = projectedEventRevisionRef.current;
      try {
        const loadedDetail = await client.fetchThreadDetail(
          bootstrap.threadId,
          historyLimitRef.current,
        );
        const projectionStillCurrent =
          projectionRevision === projectedEventRevisionRef.current;
        if (projectionStillCurrent) {
          detailRef.current = loadedDetail;
          setDetail(loadedDetail);
        }
        setThreads((current) =>
          replaceThread(
            current,
            projectionStillCurrent
              ? loadedDetail.thread
              : (detailRef.current?.thread ?? loadedDetail.thread),
          ),
        );
        setError(null);
        postAndroidMessage({
          type: 'setNavigationTitle',
          title: loadedDetail.thread.title,
          workspaceId: loadedDetail.workspace.id,
        });
        void client
          .listThreads()
          .then((loadedThreads) => {
            const liveThread = detailRef.current?.thread;
            setThreads(
              liveThread ? replaceThread(loadedThreads, liveThread) : loadedThreads,
            );
          })
          .catch((caught) => {
            console.warn('Unable to refresh Android room list.', caught);
          });
      } catch (caught) {
        if (reportError) {
          const message = errorMessage(caught);
          setError(message);
          postAndroidMessage({ type: 'reportFatalError', message });
        }
      } finally {
        if (showLoading) {
          setLoading(false);
        }
      }
    },
    [bootstrap.threadId, client],
  );

  useEffect(() => {
    let cancelled = false;
    if (!bootstrap.threadId) {
      setError('No thread id was provided by the native host.');
      setLoading(false);
      return;
    }
    setLoading(true);
    const loadInitialDetail = async () => {
      let lastError: unknown;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          return await client.fetchThreadDetail(
            bootstrap.threadId!,
            THREAD_HISTORY_INITIAL_LIMIT,
          );
        } catch (caught) {
          lastError = caught;
          if (attempt < 2) {
            await new Promise((resolve) =>
              window.setTimeout(resolve, 350 * (attempt + 1)),
            );
          }
        }
      }
      throw lastError;
    };
    loadInitialDetail()
      .then((loadedDetail) => {
        if (cancelled) {
          return;
        }
        setThreads((current) => replaceThread(current, loadedDetail.thread));
        detailRef.current = loadedDetail;
        setDetail(loadedDetail);
        setError(null);
        postAndroidMessage({
          type: 'setNavigationTitle',
          title: loadedDetail.thread.title,
          workspaceId: loadedDetail.workspace.id,
        });
        void client
          .listThreads()
          .then((loadedThreads) => {
            if (!cancelled) {
              setThreads(loadedThreads);
            }
          })
          .catch((caught) => {
            console.warn('Unable to load Android room list.', caught);
          });
      })
      .catch((caught) => {
        if (!cancelled) {
          const message = errorMessage(caught);
          setError(message);
          postAndroidMessage({ type: 'reportFatalError', message });
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [bootstrap.threadId, client]);

  useEffect(() => {
    if (!detail || !sceneActive) {
      return;
    }
    const intervalId = window.setInterval(() => {
      void refreshThreadDetail();
    }, THREAD_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [detail?.thread.id, refreshThreadDetail, sceneActive]);

  useEffect(() => {
    if (!detail || !sceneActive || sceneActivationKey === 0) {
      return;
    }
    void refreshThreadDetail();
  }, [detail?.thread.id, refreshThreadDetail, sceneActivationKey, sceneActive]);

  useEffect(() => {
    if (!detail || !sceneActive) {
      return;
    }
    let refreshTimer: number | null = null;
    const scheduleRefresh = () => {
      if (refreshTimer !== null) {
        return;
      }
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        void refreshThreadDetail();
      }, 250);
    };
    const subscription = subscribeToThreadEvents(
      bootstrap,
      detail.thread.id,
      {
        onOpen() {
          setSubscriptionUsageRefreshKey((current) => current + 1);
          postAndroidMessage({ type: 'threadWebDebug', message: 'ws:open' });
          void refreshThreadDetail();
        },
        onEvent(event) {
          const currentDetail = detailRef.current;
          const projection = currentDetail
            ? projectThreadEventIntoDetail(currentDetail, event)
            : null;
          if (projection?.projected) {
            projectedEventRevisionRef.current += 1;
            detailRef.current = projection.detail;
            setDetail(projection.detail);
            setThreads((current) =>
              replaceThread(current, projection.detail.thread),
            );
          }
          postAndroidMessage({
            type: 'threadWebDebug',
            message: `ws:${event.type}${projection?.projected ? ':projected' : ':refresh'}`,
          });
          if (!projection?.projected) {
            scheduleRefresh();
          }
        },
        onError(message) {
          console.warn(message);
        },
      },
    );
    return () => {
      if (refreshTimer !== null) {
        window.clearTimeout(refreshTimer);
      }
      subscription.close();
    };
  }, [bootstrap, detail?.thread.id, refreshThreadDetail, sceneActive, sceneActivationKey]);

  useEffect(() => {
    if (!detail) {
      return;
    }
    let cancelled = false;
    const provider = detail.thread.provider;
    Promise.all([
      client.listModels(provider),
      client.listAgentRuntimes(),
    ])
      .then(([loadedModelOptions, runtimes]) => {
        if (cancelled) {
          return;
        }
        const runtime = runtimes.find((entry) => entry.provider === provider);
        setModelOptions(loadedModelOptions);
        setCapabilities(runtime?.capabilities ?? null);
        setToolboxItems(runtime?.managementSchema.toolboxItems ?? []);
      })
      .catch((caught) => {
        if (!cancelled) {
          console.warn('Unable to load Android WebView thread metadata.', caught);
          setModelOptions([]);
          setCapabilities(null);
          setToolboxItems([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [client, detail?.thread.provider]);

  useEffect(() => {
    if (!detail) {
      return;
    }
    postAndroidMessage({
      type: 'threadWebReady',
      title: detail.thread.title,
      workspaceId: detail.workspace.id,
    });
  }, [detail]);

  const submitPromptText = useCallback(
    async (prompt: string) => {
      if (promptSubmissionInFlightRef.current) {
        return false;
      }
      const currentDetail = detailRef.current;
      if (!currentDetail) {
        return false;
      }
      promptSubmissionInFlightRef.current = true;
      const previousDetail = currentDetail;
      const optimistic = buildOptimisticPromptDetail(currentDetail, prompt);
      setSubmitting(true);
      detailRef.current = optimistic.detail;
      setDetail(optimistic.detail);
      setThreads((current) => replaceThread(current, optimistic.thread));
      setError(null);
      try {
        const updatedThread = await client.sendPrompt(
          currentDetail.thread.id,
          prompt,
        );
        setThreads((current) => replaceThread(current, updatedThread));
        await refreshThreadDetail({ reportError: true });
      } catch (caught) {
        detailRef.current = previousDetail;
        setDetail(previousDetail);
        setThreads((current) => replaceThread(current, previousDetail.thread));
        const message = errorMessage(caught);
        setError(message);
        postAndroidMessage({ type: 'reportFatalError', message });
        return false;
      } finally {
        setSubmitting(false);
        promptSubmissionInFlightRef.current = false;
      }
    },
    [client, refreshThreadDetail],
  );

  const loadEarlierHistory = useCallback(async () => {
    const currentDetail = detailRef.current;
    if (!currentDetail || loadingEarlier) {
      return;
    }
    const beforeTurnId = currentDetail.turns[0]?.id;
    const totalTurnCount =
      currentDetail.totalTurnCount ?? currentDetail.turns.length;
    if (
      !bootstrap.threadId ||
      !beforeTurnId ||
      currentDetail.turns.length >= totalTurnCount
    ) {
      return;
    }

    setLoadingEarlier(true);
    try {
      const loadedDetail = await client.fetchThreadDetail(bootstrap.threadId, {
        limit: THREAD_HISTORY_PAGE_SIZE,
        beforeTurnId,
      });
      const mergedDetail = mergeEarlierThreadHistory(
        detailRef.current ?? currentDetail,
        loadedDetail,
      );
      historyLimitRef.current = mergedDetail.turns.length;
      setHistoryLimit(mergedDetail.turns.length);
      detailRef.current = mergedDetail;
      setDetail(mergedDetail);
      setThreads((current) => replaceThread(current, mergedDetail.thread));
      setError(null);
      postAndroidMessage({
        type: 'threadWebDebug',
        message: `history-page:loaded:${loadedDetail.turns.length}:${mergedDetail.totalTurnCount ?? mergedDetail.turns.length}`,
      });
    } catch (caught) {
      const message = errorMessage(caught);
      setError(message);
      postAndroidMessage({ type: 'reportFatalError', message });
    } finally {
      setLoadingEarlier(false);
    }
  }, [bootstrap.threadId, client, loadingEarlier]);

  const updateThreadSettings = useCallback(
    async (input: UpdateThreadSettingsInput) => {
      if (!detail) {
        return;
      }
      const previousDetail = detail;
      const optimisticThread: ThreadDto = {
        ...detail.thread,
        ...(input.model !== undefined ? { model: input.model } : {}),
        ...(input.reasoningEffort !== undefined
          ? { reasoningEffort: input.reasoningEffort }
          : {}),
        ...(input.fastMode !== undefined ? { fastMode: input.fastMode } : {}),
        ...(input.collaborationMode !== undefined
          ? { collaborationMode: input.collaborationMode }
          : {}),
      };
      setSettingsBusy(true);
      setDetail((current) =>
        current ? { ...current, thread: optimisticThread } : current,
      );
      setThreads((current) => replaceThread(current, optimisticThread));
      setError(null);
      try {
        const updatedThread = await client.updateThreadSettings(
          detail.thread.id,
          input,
        );
        setDetail((current) =>
          current ? { ...current, thread: updatedThread } : current,
        );
        setThreads((current) => replaceThread(current, updatedThread));
        await refreshThreadDetail({ reportError: true });
      } catch (caught) {
        setDetail(previousDetail);
        setThreads((current) => replaceThread(current, previousDetail.thread));
        const message = errorMessage(caught);
        setError(message);
        postAndroidMessage({ type: 'reportFatalError', message });
        throw caught;
      } finally {
        setSettingsBusy(false);
      }
    },
    [client, detail, refreshThreadDetail],
  );

  const openThreadGoals = useCallback(async () => {
    const currentDetail = detailRef.current;
    if (!currentDetail) return;
    try {
      const result = await client.fetchThreadGoal(currentDetail.thread.id);
      setDetail((current) =>
        current ? { ...current, goal: result.goal } : current,
      );
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, [client]);

  const updateThreadGoal = useCallback(
    async (input: UpdateThreadGoalInput) => {
      const currentDetail = detailRef.current;
      if (!currentDetail) return;
      await client.updateThreadGoal(currentDetail.thread.id, input);
      await refreshThreadDetail({ reportError: true });
    },
    [client, refreshThreadDetail],
  );

  const renameThread = useCallback(
    async (threadId: string, title: string) => {
      const normalizedTitle = title.trim();
      if (!normalizedTitle) {
        return;
      }
      try {
        const updatedThread = await client.renameThread(threadId, normalizedTitle);
        setThreads((current) => replaceThread(current, updatedThread));
        setDetail((current) => {
          if (!current || current.thread.id !== threadId) {
            return current;
          }
          const updatedDetail = {
            ...current,
            thread: updatedThread,
          };
          detailRef.current = updatedDetail;
          return updatedDetail;
        });
        const currentDetail = detailRef.current;
        if (currentDetail?.thread.id === threadId) {
          postAndroidMessage({
            type: 'setNavigationTitle',
            title: updatedThread.title,
            workspaceId: currentDetail.workspace.id,
          });
        }
        postAndroidMessage({
          type: 'threadWebDebug',
          message: `thread-action:renamed:${threadId}:${updatedThread.title}`,
        });
      } catch (caught) {
        const message = errorMessage(caught);
        setError(message);
        postAndroidMessage({ type: 'reportFatalError', message });
        throw caught;
      }
    },
    [client],
  );

  const confirmDeleteThread = useCallback(
    async () => {
      const thread = deletingThread;
      if (!thread) {
        return;
      }
      setDeletingThreadBusy(true);
      try {
        await client.deleteThread(thread.id);
        setThreads((current) => removeThread(current, thread.id));
        setDeletingThread(null);
        postAndroidMessage({
          type: 'threadWebDebug',
          message: `thread-action:deleted:${thread.id}`,
        });
        if (detailRef.current?.thread.id === thread.id) {
          detailRef.current = null;
          setDetail(null);
          postAndroidMessage({ type: 'closeThread' });
        }
      } catch (caught) {
        const message = errorMessage(caught);
        setError(message);
        postAndroidMessage({ type: 'reportFatalError', message });
        throw caught;
      } finally {
        setDeletingThreadBusy(false);
      }
    },
    [client, deletingThread],
  );

  const cancelPendingSteer = useCallback(
    async (threadId: string, pendingSteerId: string) => {
      try {
        const updatedDetail = await client.cancelPendingSteer(
          threadId,
          pendingSteerId,
        );
        detailRef.current = updatedDetail;
        setDetail(updatedDetail);
        setThreads((current) => replaceThread(current, updatedDetail.thread));
        postAndroidMessage({
          type: 'threadWebDebug',
          message: `pending-steer:canceled:${pendingSteerId}`,
        });
      } catch (caught) {
        const message = errorMessage(caught);
        setError(message);
        postAndroidMessage({ type: 'reportFatalError', message });
        throw caught;
      }
    },
    [client],
  );

  const loadExportTurns = useCallback(async () => {
    const currentDetail = detailRef.current;
    if (!currentDetail) {
      return;
    }

    setExportTurnsState((current) => ({
      status: 'loading',
      data: current.data,
      error: null,
    }));

    try {
      const data = await client.fetchThreadExportTurns(currentDetail.thread.id);
      setExportTurnsState({
        status: 'ready',
        data,
        error: null,
      });
    } catch (caught) {
      setExportTurnsState((current) => ({
        status: 'failed',
        data: current.data,
        error:
          caught instanceof Error
            ? caught.message
            : 'Unable to load export turns.',
      }));
    }
  }, [client]);

  const exportTranscript = useCallback(
    async (input: ExportThreadPdfInput) => {
      const currentDetail = detailRef.current;
      if (!currentDetail) {
        return;
      }

      setExportBusy(true);
      setError(null);
      try {
        const exported = await client.downloadThreadTranscriptExport(
          currentDetail.thread.id,
          input,
        );
        postAndroidMessage({
          type: 'shareDownloadedFile',
          filename: exported.filename,
          contentType: exported.contentType,
          base64: exported.base64,
        });
        postAndroidMessage({
          type: 'threadWebDebug',
          message: `export:${exported.filename}`,
        });
        setExportDialogOpen(false);
      } catch (caught) {
        const message = errorMessage(caught);
        setError(message);
        postAndroidMessage({ type: 'reportFatalError', message });
        throw caught;
      } finally {
        setExportBusy(false);
      }
    },
    [client],
  );

  const loadThreadShares = useCallback(async () => {
    const currentDetail = detailRef.current;
    if (!relayShareAvailable || !relayDeviceId || !currentDetail) {
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
      const portal = await client.fetchRelayPortal();
      const shares = portal.sharedByMe
        .filter(
          (share) =>
            share.deviceId === relayDeviceId &&
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
        error:
          caught instanceof Error
            ? caught.message
            : 'Unable to load active shares.',
      }));
    }
  }, [client, relayDeviceId, relayShareAvailable]);

  const createThreadShare = useCallback(async (input: CreateThreadShareInput) => {
    const currentDetail = detailRef.current;
    if (!relayShareAvailable || !relayDeviceId || !currentDetail) {
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
        : currentDetail.workspace.id ?? currentDetail.thread.workspaceId ?? null;
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
      await client.createRelayShare({
        targetIdentifier: input.targetIdentifier,
        deviceId: relayDeviceId,
        threadId: currentDetail.thread.id,
        workspaceId,
        label: input.label ?? null,
        threadAccess: input.threadAccess,
        workspaceAccess: input.workspaceAccess,
      });
      await loadThreadShares();
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : 'Unable to create share.';
      setThreadShareState((current) => ({
        ...current,
        status: 'failed',
        error: message,
      }));
      setError(message);
    } finally {
      setShareBusy(false);
    }
  }, [client, loadThreadShares, relayDeviceId, relayShareAvailable]);

  const revokeThreadShare = useCallback(async (shareId: string) => {
    setShareBusy(true);
    setThreadShareState((current) => ({
      ...current,
      error: null,
    }));
    try {
      await client.revokeRelayShare(shareId);
      await loadThreadShares();
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : 'Unable to revoke share.';
      setThreadShareState((current) => ({
        ...current,
        status: 'failed',
        error: message,
      }));
      setError(message);
    } finally {
      setShareBusy(false);
    }
  }, [client, loadThreadShares]);

  useEffect(() => {
    if (exportDialogOpen) {
      void loadThreadShares();
    }
  }, [exportDialogOpen, loadThreadShares]);

  useEffect(() => {
    const currentDetail = detailRef.current;
    if (!relayShareAvailable || !relayDeviceId || !currentDetail) {
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
    client
      .fetchRelayAccess({
        deviceId: relayDeviceId,
        threadId: currentDetail.thread.id,
        workspaceId: currentDetail.workspace.id ?? currentDetail.thread.workspaceId ?? null,
      })
      .then((access) => {
        if (!cancelled) {
          setRelayAccessState({
            status: 'ready',
            access,
            error: null,
          });
        }
      })
      .catch((caught) => {
        if (!cancelled) {
          setRelayAccessState({
            status: 'failed',
            access: null,
            error:
              caught instanceof Error
                ? caught.message
                : 'Unable to load relay permissions.',
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    client,
    detail?.thread.id,
    detail?.thread.workspaceId,
    detail?.workspace.id,
    relayDeviceId,
    relayShareAvailable,
  ]);

  const resolveWorkspaceId = useCallback(
    (workspaceId?: string | null) =>
      workspaceId ??
      detailRef.current?.workspace.id ??
      detailRef.current?.thread.workspaceId ??
      null,
    [],
  );

  const currentWorkspaceId =
    detail?.workspace.id ?? detail?.thread.workspaceId ?? null;
  const relayAccess = relayAccessState.access;
  const effectiveThreadIsOwner =
    !relayShareAvailable || relayAccess?.kind === 'owner';
  const effectiveThreadCanControl =
    effectiveThreadIsOwner ||
    (relayAccess?.kind === 'shared' && relayAccess.threadAccess === 'control');
  const effectiveThreadCanShare =
    relayShareAvailable && relayAccess?.kind === 'owner';
  const effectiveWorkspaceAccess: 'none' | 'read' | 'write' =
    !relayShareAvailable
      ? 'write'
      : relayAccess?.kind === 'owner'
        ? 'write'
        : relayAccess?.kind === 'shared' &&
            relayAccess.workspaceId &&
            relayAccess.workspaceId === currentWorkspaceId
          ? relayAccess.workspaceAccess
          : 'none';
  const relayAccessBadge = useMemo(
    () =>
      relayAccess?.kind === 'shared' ? (
        <div
          className="inline-flex max-w-[10rem] items-center gap-1.5 rounded-full border border-[var(--theme-border)] bg-[var(--theme-surface-strong)] px-2.5 py-1 text-[11px] font-medium text-[var(--theme-fg-soft)]"
          title={`${relayThreadAccessLabel(relayAccess.threadAccess)} / ${relayWorkspaceAccessLabel(relayAccess.workspaceAccess)}`}
        >
          <span>{relayThreadAccessLabel(relayAccess.threadAccess)}</span>
          <span className="text-[var(--theme-fg-muted)]">/</span>
          <span className="truncate">
            {relayWorkspaceAccessLabel(relayAccess.workspaceAccess)}
          </span>
        </div>
      ) : null,
    [relayAccess],
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
      <MobileThreadCreateDialogContent
        client={client}
        initialWorkspaceId={
          currentWorkspaceId ??
          detailRef.current?.workspace.id ??
          detailRef.current?.thread.workspaceId ??
          null
        }
        onCancel={close}
        onCreated={(thread) => {
          setThreads((current) => [
            thread,
            ...current.filter((entry) => entry.id !== thread.id),
          ]);
          close();
          closeNavigation();
          postAndroidMessage({ type: 'openThread', threadId: thread.id });
        }}
      />
    ),
    [client],
  );

  const adapter = useMemo<ThreadDetailUiAdapter>(() => {
    const workspaceAdapter: ThreadWorkspaceAdapter | null =
      effectiveWorkspaceAccess === 'none'
        ? null
        : {
            async listTree(input) {
              const workspaceId = resolveWorkspaceId(input.workspaceId);
              if (!workspaceId) {
                throw new Error('No workspace id is available.');
              }
              return client.fetchWorkspaceTree(workspaceId, input.path ?? '');
            },
            async readFile(input) {
              const workspaceId = resolveWorkspaceId(input.workspaceId);
              if (!workspaceId) {
                throw new Error('No workspace id is available.');
              }
              return client.fetchWorkspaceFilePreview(workspaceId, {
                path: input.path,
                ...(input.offset !== undefined ? { offset: input.offset } : {}),
                ...(input.limit !== undefined ? { limit: input.limit } : {}),
              });
            },
            getRawFileUrl(input) {
              const workspaceId = resolveWorkspaceId(input.workspaceId);
              if (!workspaceId) {
                return '';
              }
              return client.buildWorkspaceRawFileUrl(workspaceId, {
                path: input.path,
              });
            },
            async downloadNode(input) {
              const workspaceId = resolveWorkspaceId(input.workspaceId);
              if (!workspaceId) {
                throw new Error('No workspace id is available.');
              }
              const downloaded = await client.downloadWorkspaceNode(workspaceId, {
                path: input.path,
              });
              postAndroidMessage({
                type: 'shareDownloadedFile',
                filename: downloaded.filename,
                contentType: downloaded.contentType,
                base64: downloaded.base64,
              });
            },
            async uploadFile(input) {
              if (effectiveWorkspaceAccess !== 'write') {
                throw new Error('This shared workspace is read-only.');
              }
              const workspaceId = resolveWorkspaceId(input.workspaceId);
              if (!workspaceId) {
                throw new Error('No workspace id is available.');
              }
              return client.uploadWorkspaceFile(workspaceId, {
                path: input.path,
                file: input.file,
              });
            },
            async pickUploadFile(input) {
              if (effectiveWorkspaceAccess !== 'write') {
                throw new Error('This shared workspace is read-only.');
              }
              if (!hasNativeFilePickerBridge()) {
                input.defaultPick();
                return;
              }
              postAndroidMessage({
                type: 'threadWebDebug',
                message: 'workspace-upload-picker:requested',
              });
              const result = await pickNativeFile();
              if (result.cancelled) {
                postAndroidMessage({
                  type: 'threadWebDebug',
                  message: `workspace-upload-picker:cancelled:${result.requestId}`,
                });
                return;
              }
              if (!result.file) {
                return;
              }
              await input.upload(fileFromNativePick(result.file));
              postAndroidMessage({
                type: 'threadWebDebug',
                message: `workspace-upload-picker:received:${result.file.filename}`,
              });
            },
          };

    return {
      openThread(threadId) {
        postAndroidMessage({ type: 'openThread', threadId });
      },
      getThreadHref(threadId) {
        return `#thread-${threadId}`;
      },
      renderNewThreadDialogContent,
      sendPrompt(input) {
        if (!effectiveThreadCanControl) {
          return false;
        }
        return submitPromptText(input.prompt);
      },
      ...(effectiveThreadIsOwner ? { renameThread } : {}),
      ...(effectiveThreadIsOwner ? { deleteThread: setDeletingThread } : {}),
      cancelPendingSteer,
      ...(effectiveThreadIsOwner ? { updateSettings: updateThreadSettings } : {}),
      async loadHistoryItemDetail(itemId) {
        const currentDetail = detailRef.current;
        if (!currentDetail) {
          return {
            id: itemId,
            kind: 'agentMessage',
            title: 'History detail',
            text: 'History detail is available once a real thread is loaded.',
          };
        }
        return client.fetchHistoryItemDetail(currentDetail.thread.id, itemId);
      },
      getImageAssetUrl(path) {
        const currentDetail = detailRef.current;
        if (!currentDetail) {
          return '';
        }
        return client.buildThreadImageAssetUrl(currentDetail.thread.id, { path });
      },
      openWorkspaceFile(input) {
        const currentDetail = detailRef.current;
        if (!currentDetail) {
          return;
        }
        postAndroidMessage({
          type: 'openWorkspace',
          workspaceId: currentDetail.workspace.id,
        });
        console.info('Requested workspace file', input);
      },
      workspace: workspaceAdapter,
      shell: null,
    };
  }, [
    client,
    cancelPendingSteer,
    effectiveThreadCanControl,
    effectiveThreadIsOwner,
    effectiveWorkspaceAccess,
    renameThread,
    renderNewThreadDialogContent,
    resolveWorkspaceId,
    submitPromptText,
    updateThreadSettings,
  ]);

  const settingsContent = null;

  const handleShellThemeModeChange = useCallback((mode: AndroidThemeMode) => {
    setThemeMode(mode);
    postAndroidMessage({ type: 'setThemeMode', theme: mode });
  }, []);

  const handleCopyMetaSessionId = useCallback(async () => {
    const sessionId = detail?.thread.providerSessionId?.trim();
    if (!sessionId) {
      return;
    }
    if (window.remoteCodexAndroid?.postMessage) {
      postAndroidMessage({
        type: 'copyText',
        text: sessionId,
        label: 'Remote Codex session ID',
      });
      setMetaSessionCopyState('copied');
      window.setTimeout(() => setMetaSessionCopyState('idle'), 1200);
      return;
    }
    try {
      await navigator.clipboard.writeText(sessionId);
      setMetaSessionCopyState('copied');
      window.setTimeout(() => setMetaSessionCopyState('idle'), 1200);
    } catch {
      setMetaSessionCopyState('failed');
      window.setTimeout(() => setMetaSessionCopyState('idle'), 1800);
    }
  }, [detail?.thread.providerSessionId]);

  const metaContent = detail ? (
    <dl className="space-y-4 text-sm">
      <div className="relative pr-9">
        <dt className="text-[var(--theme-fg-muted)]">Session ID</dt>
        <dd className="mt-1 break-all text-[var(--theme-fg)]">
          {detail.thread.providerSessionId ?? 'Unavailable'}
        </dd>
        {detail.thread.providerSessionId ? (
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
            className={`thread-mobile-hit-target absolute bottom-0 right-0 inline-flex h-5 w-5 items-center justify-center rounded-full border text-[0.65rem] shadow-sm shadow-stone-950/25 transition ${
              metaSessionCopyState === 'copied'
                ? 'ui-status-info'
                : metaSessionCopyState === 'failed'
                  ? 'ui-status-danger'
                  : 'border-[var(--theme-border)] bg-[var(--theme-surface-strong)] text-[var(--theme-fg-soft)] hover:bg-[var(--theme-hover)] hover:text-[var(--theme-fg)]'
            }`}
          >
            <Copy className="h-3 w-3" />
          </button>
        ) : null}
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
          {detail.workspacePathStatus === 'present'
            ? 'Present'
            : 'Missing on this machine'}
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

  return (
    <PluginProvider>
      <ThreadDetailSurface
        threads={threads}
        detail={detail}
        loading={loading}
        error={error}
        adapter={adapter}
        shellEffectiveTheme={effectiveThemeValue}
        shellThemeMode={themeMode}
        onShellThemeModeChange={handleShellThemeModeChange}
        useFloatingMobileComposer
        floatingMobileComposerBottomOffset={0}
        settingsDialogOpen={settingsDialogOpen}
        onSettingsDialogOpenChange={setSettingsDialogOpen}
        metaContent={metaContent}
        settingsContent={settingsContent}
        surfaceActions={relayAccessBadge}
        mobileHeaderAction={relayAccessBadge}
        threadActionsButton={
          <button
            type="button"
            aria-label="Export or share thread"
            title="Export or share thread"
            onClick={() => setExportDialogOpen(true)}
            className="android-thread-export-button thread-mobile-hit-target inline-flex h-10 w-10 items-center justify-center rounded-full bg-[var(--theme-surface-strong)] text-base font-semibold text-[var(--theme-fg-soft)] shadow-sm shadow-stone-950/20 transition hover:bg-[var(--theme-hover)] hover:text-[var(--theme-fg)]"
          >
            <Share2 className="h-4 w-4" aria-hidden="true" />
          </button>
        }
        dialogs={
          <>
            <ThreadActionsDialog
              open={exportDialogOpen}
              busy={exportBusy || shareBusy}
              turnsState={exportTurnsState}
              shareAvailable={effectiveThreadCanShare}
              {...(relayShareAvailable && relayAccess?.kind === 'shared'
                ? { shareUnavailableMessage: 'Only the owner can share this session.' }
                : {})}
              shareState={threadShareState}
              onCancel={() => {
                if (!exportBusy && !shareBusy) {
                  setExportDialogOpen(false);
                }
              }}
              onLoadTurns={loadExportTurns}
              onExport={exportTranscript}
              {...(effectiveThreadCanShare
                ? {
                    onCreateShare: createThreadShare,
                    onRevokeShare: revokeThreadShare,
                  }
                : {})}
            />
            <ConfirmDialog
              open={deletingThread !== null}
              title="Delete Thread"
              description={
                deletingThread
                  ? `Delete ${deletingThread.title} from supervisor. This cannot be undone.`
                  : ''
              }
              confirmLabel="Delete Thread"
              busy={deletingThreadBusy}
              onCancel={() => {
                if (!deletingThreadBusy) {
                  setDeletingThread(null);
                }
              }}
              onConfirm={() => void confirmDeleteThread()}
            />
          </>
        }
        currentThreadId={detail?.thread.id ?? bootstrap.threadId ?? undefined}
        currentWorkspaceId={detail?.workspace.id ?? null}
        currentWorkspaceLabel={detail?.workspace.label ?? null}
        composerProps={
          detail
            ? {
                busy: submitting,
                settingsBusy,
                model: detail.thread.model,
                reasoningEffort: detail.thread.reasoningEffort,
                fastMode: detail.thread.fastMode ?? false,
                collaborationMode: detail.thread.collaborationMode,
                sandboxMode: null,
                hideSandboxModeControl: true,
                modelOptions,
                toolboxItems,
                goalState: {
                  status: 'ready',
                  data: detail.goal,
                  error: null,
                },
                goalHistory: detail.goalHistory ?? [],
                contextUsage: detail.thread.contextUsage ?? null,
                subscriptionUsage,
                capabilities,
                threadConnected: detail.thread.isLoaded,
                disabled:
                  detail.workspacePathStatus === 'missing' ||
                  !effectiveThreadCanControl,
                ...(detail.workspacePathStatus === 'missing'
                  ? {
                      disabledPlaceholder:
                        'Restore this workspace path on the current machine before continuing.',
                    }
                  : !effectiveThreadCanControl
                    ? {
                        disabledPlaceholder:
                          'This shared session is view-only.',
                      }
                    : {}),
                shellAvailable: false,
                followTail,
                onToggleFollow: () => {
                  setFollowTail(true);
                  setScrollRequestKey((current) => current + 1);
                },
                canJumpToPreviousTurn,
                onJumpToPreviousTurn: () =>
                  setPreviousTurnScrollRequestKey((current) => current + 1),
                canJumpToNextTurn,
                onJumpToNextTurn: () =>
                  setNextTurnScrollRequestKey((current) => current + 1),
                ...(effectiveThreadIsOwner
                  ? { onUpdateSettings: updateThreadSettings }
                  : {}),
                ...(effectiveThreadCanControl
                  ? {
                      onOpenGoal: openThreadGoals,
                      onUpdateGoal: updateThreadGoal,
                    }
                  : {}),
              }
            : undefined
        }
        timelineProps={{
          autoCollapseCompletedTurns: true,
          scrollRequestKey,
          previousTurnScrollRequestKey,
          nextTurnScrollRequestKey,
          onTailVisibilityChange: setFollowTail,
          onPreviousTurnAvailabilityChange: setCanJumpToPreviousTurn,
          onNextTurnAvailabilityChange: setCanJumpToNextTurn,
          loadingEarlier,
          onLoadEarlier: loadEarlierHistory,
        }}
        shellUnavailableContent={
          <div className="android-thread-message">
            Shell is disabled in the Android WebView migration slice.
          </div>
        }
        loadingContent={
          <div className="android-thread-message" role="status">
            Loading thread...
          </div>
        }
        emptyContent={
          <div className="android-thread-message">
            No thread is available for this route.
          </div>
        }
      />
    </PluginProvider>
  );
}
