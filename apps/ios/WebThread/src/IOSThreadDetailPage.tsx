import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AgentBackendToolboxItemSchemaDto,
  AgentProviderCapabilitiesDto,
  ExportThreadPdfInput,
  ModelOptionDto,
  PromptAttachmentKindDto,
  RespondThreadActionRequestInput,
  ThreadDetailDto,
  ThreadDto,
  ThreadExportTurnOptionsDto,
  ThreadForkTurnOptionDto,
  ThreadHistoryItemDto,
  UpdateThreadSettingsInput,
} from '@remote-codex/shared';
import type {
  ThreadDetailUiAdapter,
  ThreadWorkspaceAdapter,
} from '@remote-codex/thread-ui';
import {
  ExportTranscriptDialog,
  formatLongTimestamp,
  PluginProvider,
  ThreadDetailSurface,
  threadStatusLabel,
} from '@remote-codex/thread-ui';

import {
  applyIOSTheme,
  type IOSBootstrap,
  type IOSThemeMode,
} from './IOSBootstrap';
import { IOSApiClient } from './IOSApiClient';
import {
  canLoadEarlierThreadHistory,
  IOS_THREAD_HISTORY_INITIAL_LIMIT,
  IOS_THREAD_HISTORY_PAGE_STEP,
  mergeEarlierThreadHistory,
} from './IOSHistoryPaging';
import {
  hasNativeBridge,
  type NativeAttachmentPickerResult,
  postNativeMessage,
} from './IOSNativeBridge';
import { buildOptimisticPromptDetail } from './IOSOptimisticPrompt';
import { subscribeToThreadEvents } from './IOSWebSocket';
import { projectThreadEventIntoDetail } from './IOSWebSocketProjection';
import { mockDetail, mockStatus, mockThreads } from './mockData';

interface IOSThreadDetailPageProps {
  bootstrap: IOSBootstrap;
}

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

const idleForkTurnOptionsState: PanelState<ThreadForkTurnOptionDto[]> = {
  status: 'idle',
  data: null,
  error: null,
};

function errorMessage(caught: unknown) {
  return caught instanceof Error ? caught.message : 'Thread failed to load.';
}

function threadListRevision(threads: ThreadDto[]) {
  return threads
    .map((thread) =>
      [
        thread.id,
        thread.title,
        thread.status,
        thread.model,
        thread.reasoningEffort,
        thread.fastMode,
        thread.collaborationMode,
        thread.sandboxMode,
        thread.activeTurnId,
        thread.updatedAt,
        thread.lastTurnCompletedAt,
      ].join(':'),
    )
    .join('|');
}

function threadDetailRevision(detail: ThreadDetailDto | null) {
  if (!detail) {
    return '';
  }
  const turns = detail.turns
    .map((turn) =>
      [
        turn.id,
        turn.status,
        turn.error,
        turn.items
          .map((item) =>
            [
              item.id,
              item.kind,
              item.status,
              item.text,
              item.previewText,
              item.detailText,
            ].join(':'),
          )
          .join(','),
      ].join(':'),
    )
    .join('|');
  return [
    detail.thread.id,
    detail.thread.title,
    detail.thread.status,
    detail.thread.model,
    detail.thread.reasoningEffort,
    detail.thread.fastMode,
    detail.thread.collaborationMode,
    detail.thread.sandboxMode,
    detail.thread.activeTurnId,
    detail.thread.updatedAt,
    detail.thread.lastTurnStartedAt,
    detail.thread.lastTurnCompletedAt,
    detail.totalTurnCount,
    detail.pendingRequests.map((request) => `${request.id}:${request.title}`).join(','),
    detail.pendingSteers.map((steer) => `${steer.id}:${steer.prompt}`).join(','),
    detail.livePlan?.updatedAt,
    detail.liveItems?.updatedAt,
    turns,
  ].join('|');
}

function replaceThread(threads: ThreadDto[], updated: ThreadDto) {
  return threads.map((thread) => (thread.id === updated.id ? updated : thread));
}

function removeThread(threads: ThreadDto[], threadId: string) {
  return threads.filter((thread) => thread.id !== threadId);
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

function fixtureExportTurns(detail: ThreadDetailDto): ThreadExportTurnOptionsDto {
  return {
    totalTurnCount: detail.totalTurnCount ?? detail.turns.length,
    turns: detail.turns.map((turn, index) => {
      const userPrompt =
        turn.items.find((item) => item.kind === 'userMessage')?.text ??
        `Turn ${index + 1}`;
      return {
        turnId: turn.id,
        turnNumber: index + 1,
        startedAt: turn.startedAt ?? null,
        status: turn.status,
        userPromptPreview: userPrompt.slice(0, 140),
      };
    }),
  };
}

async function blobToBase64(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function fileFromNativeAttachment(
  file: NonNullable<NativeAttachmentPickerResult['files']>[number],
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

export function IOSThreadDetailPage({ bootstrap }: IOSThreadDetailPageProps) {
  const [threads, setThreads] = useState<ThreadDto[]>(
    bootstrap.fixture ? mockThreads : [],
  );
  const [detail, setDetail] = useState<ThreadDetailDto | null>(
    bootstrap.fixture ? mockDetail : null,
  );
  const detailRef = useRef<ThreadDetailDto | null>(
    bootstrap.fixture ? mockDetail : null,
  );
  const [loading, setLoading] = useState(!bootstrap.fixture);
  const [submitting, setSubmitting] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [respondingRequestId, setRespondingRequestId] = useState<string | null>(
    null,
  );
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [historyLimit, setHistoryLimit] = useState(
    IOS_THREAD_HISTORY_INITIAL_LIMIT,
  );
  const historyLimitRef = useRef(IOS_THREAD_HISTORY_INITIAL_LIMIT);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [followTail, setFollowTail] = useState(true);
  const [scrollRequestKey, setScrollRequestKey] = useState(0);
  const [exportTurnsState, setExportTurnsState] =
    useState<PanelState<ThreadExportTurnOptionsDto>>(idleExportTurnsState);
  const [forkTurnOptionsState, setForkTurnOptionsState] =
    useState<PanelState<ThreadForkTurnOptionDto[]>>(
      idleForkTurnOptionsState,
    );
  const [modelOptions, setModelOptions] = useState<ModelOptionDto[]>([]);
  const [toolboxItems, setToolboxItems] = useState<
    AgentBackendToolboxItemSchemaDto[]
  >([]);
  const [capabilities, setCapabilities] =
    useState<AgentProviderCapabilitiesDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sceneActive, setSceneActive] = useState(true);
  const sceneActiveRef = useRef(true);
  const refreshFallbackDisabled = bootstrap.uiTestDisableRefreshFallback ?? false;
  const lifecycleCountersRef = useRef({
    active: 1,
    inactive: 0,
    wsOpen: 0,
    wsClose: 0,
  });
  const uiTestInitialSettingsAppliedRef = useRef(false);
  const uiTestPendingRequestsResolvedRef = useRef(false);
  const uiTestPendingRequestControlsClickedRef = useRef(false);
  const uiTestVisibleSettingsControlsClickedRef = useRef(false);
  const uiTestForkControlsClickedRef = useRef(false);
  const uiTestExportStartedRef = useRef(false);
  const uiTestVisibleExportControlsClickedRef = useRef(false);
  const uiTestWorkspaceEventsRef = useRef<string[]>([]);
  const uiTestWorkspaceLoadMoreClickedRef = useRef(false);
  const uiTestWorkspaceFileActionsStartedRef = useRef(false);
  const uiTestVisibleWorkspaceControlsStartedRef = useRef(false);
  const uiTestHistoryDetailLoadedRef = useRef(false);
  const uiTestVisibleHistoryDetailsStartedRef = useRef(false);
  const uiTestOlderHistoryLoadedRef = useRef(false);
  const uiTestImageAssetLoadedRef = useRef(false);
  const uiTestTimelineContentVerifiedRef = useRef(false);
  const uiTestSlashToolboxVerifiedRef = useRef(false);
  const uiTestAutoRenameStartedRef = useRef(false);
  const uiTestAutoDeleteStartedRef = useRef(false);
  const selectedHistoryDetailDebugRef = useRef('');
  const nativeAttachmentPickerCounterRef = useRef(0);
  const nativeAttachmentPickerHandlersRef = useRef(
    new Map<string, (result: NativeAttachmentPickerResult) => void | Promise<void>>(),
  );
  const client = useMemo(() => new IOSApiClient(bootstrap), [bootstrap]);
  const initialThemeMode = bootstrap.theme ?? 'system';
  const [themeMode, setThemeMode] = useState<IOSThemeMode>(initialThemeMode);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [metaSessionCopyState, setMetaSessionCopyState] = useState<
    'idle' | 'copied' | 'failed'
  >('idle');
  const [effectiveThemeValue, setEffectiveThemeValue] = useState(() =>
    applyIOSTheme(initialThemeMode),
  );

  useEffect(() => {
    detailRef.current = detail;
  }, [detail]);

  const resolveWorkspaceId = useCallback((workspaceId?: string | null) => {
    return (
      workspaceId ??
      detailRef.current?.workspace.id ??
      detailRef.current?.thread.workspaceId ??
      null
    );
  }, []);

  useEffect(() => {
    setThemeMode(bootstrap.theme ?? 'system');
  }, [bootstrap.theme]);

  useEffect(() => {
    const applyTheme = () => {
      setEffectiveThemeValue(applyIOSTheme(themeMode));
    };

    applyTheme();
    if (themeMode !== 'system') {
      return;
    }

    const mediaQuery = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mediaQuery) {
      return;
    }
    mediaQuery.addEventListener('change', applyTheme);
    return () => {
      mediaQuery.removeEventListener('change', applyTheme);
    };
  }, [themeMode]);

  const postLifecycleDebug = useCallback(() => {
    const counters = lifecycleCountersRef.current;
    postNativeMessage({
      type: 'threadWebDebug',
      message: [
        `scene:lifecycle:inactive=${counters.inactive}`,
        `active=${counters.active}`,
        `wsOpen=${counters.wsOpen}`,
        `wsClose=${counters.wsClose}`,
      ].join(':'),
    });
  }, []);

  useEffect(() => {
    historyLimitRef.current = historyLimit;
  }, [historyLimit]);

  useEffect(() => {
    historyLimitRef.current = IOS_THREAD_HISTORY_INITIAL_LIMIT;
    setHistoryLimit(IOS_THREAD_HISTORY_INITIAL_LIMIT);
  }, [bootstrap.threadId]);

  useEffect(() => {
    const previousBridge = window.remoteCodexIOS;
    let resumeTimer: number | null = null;
    const applySceneActive = (active: boolean) => {
      const nextActive = Boolean(active);
      if (sceneActiveRef.current === nextActive) {
        return false;
      }
      sceneActiveRef.current = nextActive;
      if (nextActive) {
        lifecycleCountersRef.current.active += 1;
      } else {
        lifecycleCountersRef.current.inactive += 1;
      }
      setSceneActive(nextActive);
      return true;
    };

    window.remoteCodexIOS = {
      ...previousBridge,
      setSceneActive(active: boolean) {
        applySceneActive(active);
      },
      resumeSceneActive() {
        if (resumeTimer !== null) {
          window.clearTimeout(resumeTimer);
          resumeTimer = null;
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
      attachmentPickerResult(result: NativeAttachmentPickerResult) {
        const handler = nativeAttachmentPickerHandlersRef.current.get(
          result.requestId,
        );
        if (!handler) {
          postNativeMessage({
            type: 'threadWebDebug',
            message: `attachment-picker:missing:${result.requestId}`,
          });
          return;
        }
        nativeAttachmentPickerHandlersRef.current.delete(result.requestId);
        Promise.resolve(handler(result)).catch((caught) => {
          const message = errorMessage(caught);
          setError(message);
          postNativeMessage({
            type: 'threadWebDebug',
            message: `attachment-picker:error:${result.requestId}:${message}`,
          });
          postNativeMessage({ type: 'reportFatalError', message });
        });
      },
      setTheme(theme: IOSThemeMode) {
        setThemeMode(theme);
      },
      openSettings() {
        setSettingsDialogOpen(true);
      },
    };

    const handlePageInactive = () => {
      applySceneActive(false);
    };
    const handlePageActive = () => {
      if (lifecycleCountersRef.current.inactive === 0 && sceneActiveRef.current) {
        return;
      }
      window.remoteCodexIOS?.resumeSceneActive?.();
    };
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
      if (previousBridge) {
        window.remoteCodexIOS = previousBridge;
      } else {
        delete window.remoteCodexIOS;
      }
    };
  }, []);

  const pickNativeFiles = useCallback(
    ({
      kind,
      defaultPick,
      onFiles,
      debugPrefix = 'attachment-picker',
    }: {
      kind: PromptAttachmentKindDto;
      defaultPick: () => void;
      onFiles: (input: {
        files: File[];
        kind: PromptAttachmentKindDto;
        requestId: string;
      }) => void | Promise<void>;
      debugPrefix?: string;
    }) => {
      if (!hasNativeBridge()) {
        defaultPick();
        return;
      }

      nativeAttachmentPickerCounterRef.current += 1;
      const requestId = `ios-attachment-${Date.now()}-${nativeAttachmentPickerCounterRef.current}`;
      nativeAttachmentPickerHandlersRef.current.set(requestId, async (result) => {
        if (result.cancelled) {
          postNativeMessage({
            type: 'threadWebDebug',
            message: `${debugPrefix}:cancelled:${requestId}`,
          });
          return;
        }
        if (result.error) {
          setError(result.error);
          postNativeMessage({ type: 'reportFatalError', message: result.error });
          return;
        }

        const files = result.files ?? [];
        await onFiles({
          files: files.map(fileFromNativeAttachment),
          kind: result.kind ?? kind,
          requestId,
        });
        postNativeMessage({
          type: 'threadWebDebug',
          message: `${debugPrefix}:received:${requestId}:${files.length}`,
        });
      });
      postNativeMessage({ type: 'pickAttachments', requestId, kind });
      postNativeMessage({
        type: 'threadWebDebug',
        message: `${debugPrefix}:requested:${requestId}:${kind}`,
      });
    },
    [],
  );

  const pickNativeAttachments = useCallback(
    ({
      kind,
      appendAttachments,
      defaultPick,
    }: {
      kind: PromptAttachmentKindDto;
      appendAttachments: (
        files: FileList | null,
        kind?: PromptAttachmentKindDto,
      ) => boolean;
      defaultPick: () => void;
    }) => {
      pickNativeFiles({
        kind,
        defaultPick,
        onFiles({ files, kind: resultKind }) {
          const transfer = new DataTransfer();
          for (const file of files) {
            transfer.items.add(file);
          }
          appendAttachments(transfer.files, resultKind);
        },
      });
    },
    [pickNativeFiles],
  );

  const refreshThreadDetail = useCallback(
    async ({
      showLoading = false,
      reportError = false,
    }: {
      showLoading?: boolean;
      reportError?: boolean;
    } = {}) => {
      if (bootstrap.fixture) {
        return;
      }
      const threadId = bootstrap.threadId;
      if (!threadId) {
        setError('No thread id was provided by the native host.');
        setLoading(false);
        return;
      }

      if (showLoading) {
        setLoading(true);
      }

      try {
        const [loadedThreads, loadedDetail] = await Promise.all([
          client.listThreads(),
          client.fetchThreadDetail(threadId, historyLimitRef.current),
        ]);
        setThreads((current) =>
          threadListRevision(current) === threadListRevision(loadedThreads)
            ? current
            : loadedThreads,
        );
        setDetail((current) => {
          if (threadDetailRevision(current) === threadDetailRevision(loadedDetail)) {
            return current;
          }
          detailRef.current = loadedDetail;
          return loadedDetail;
        });
        setError(null);
        postNativeMessage({
          type: 'setNavigationTitle',
          title: loadedDetail.thread.title,
          workspaceId: loadedDetail.workspace.id,
        });
      } catch (caught) {
        if (reportError) {
          const message = errorMessage(caught);
          setError(message);
          postNativeMessage({ type: 'reportFatalError', message });
        }
      } finally {
        if (showLoading) {
          setLoading(false);
        }
      }
    },
    [bootstrap.fixture, bootstrap.threadId, client],
  );

  useEffect(() => {
    if (bootstrap.fixture) {
      postNativeMessage({
        type: 'setNavigationTitle',
        title: mockDetail.thread.title,
        workspaceId: mockDetail.workspace.id,
      });
      return;
    }
    const threadId = bootstrap.threadId;
    if (!threadId) {
      setError('No thread id was provided by the native host.');
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    Promise.all([
      client.listThreads(),
      client.fetchThreadDetail(threadId, IOS_THREAD_HISTORY_INITIAL_LIMIT),
    ])
      .then(([loadedThreads, loadedDetail]) => {
        if (cancelled) {
          return;
        }
        setThreads(loadedThreads);
        detailRef.current = loadedDetail;
        setDetail(loadedDetail);
        postNativeMessage({
          type: 'setNavigationTitle',
          title: loadedDetail.thread.title,
          workspaceId: loadedDetail.workspace.id,
        });
      })
      .catch((caught) => {
        if (!cancelled) {
          const message = errorMessage(caught);
          setError(message);
          postNativeMessage({ type: 'reportFatalError', message });
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
  }, [bootstrap, client]);

  const loadEarlierHistory = useCallback(async () => {
    if (bootstrap.fixture || !detail) {
      return;
    }
    const threadId = bootstrap.threadId;
    if (!threadId) {
      return;
    }

    const beforeTurnId = detail.turns[0]?.id;
    if (!beforeTurnId || !canLoadEarlierThreadHistory(detail)) {
      return;
    }

    const previousLimit = historyLimitRef.current;
    setLoadingEarlier(true);
    try {
      const loadedDetail = await client.fetchThreadDetail(threadId, {
        limit: IOS_THREAD_HISTORY_PAGE_STEP,
        beforeTurnId,
      });
      const mergedDetail = mergeEarlierThreadHistory(
        detailRef.current ?? detail,
        loadedDetail,
      );
      historyLimitRef.current = mergedDetail.turns.length;
      setHistoryLimit(mergedDetail.turns.length);
      detailRef.current = mergedDetail;
      setDetail(mergedDetail);
      setError(null);
      postNativeMessage({
        type: 'threadWebDebug',
        message: `history-page:loaded:${loadedDetail.turns.length}:${mergedDetail.totalTurnCount ?? mergedDetail.turns.length}`,
      });
    } catch (caught) {
      historyLimitRef.current = previousLimit;
      setHistoryLimit(previousLimit);
      const message = errorMessage(caught);
      setError(message);
      postNativeMessage({ type: 'reportFatalError', message });
    } finally {
      setLoadingEarlier(false);
    }
  }, [bootstrap.fixture, bootstrap.threadId, client, detail]);

  useEffect(() => {
    if (bootstrap.fixture || refreshFallbackDisabled || !detail || !sceneActive) {
      return;
    }
    const intervalId = window.setInterval(() => {
      void refreshThreadDetail();
    }, THREAD_REFRESH_INTERVAL_MS);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [bootstrap.fixture, detail, refreshFallbackDisabled, refreshThreadDetail, sceneActive]);

  useEffect(() => {
    if (bootstrap.fixture || refreshFallbackDisabled || !detail || !sceneActive) {
      return;
    }
    if (lifecycleCountersRef.current.active <= 1) {
      return;
    }
    void refreshThreadDetail();
  }, [bootstrap.fixture, detail, refreshFallbackDisabled, refreshThreadDetail, sceneActive]);

  useEffect(() => {
    if (bootstrap.fixture || !detail || !sceneActive) {
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
          lifecycleCountersRef.current.wsOpen += 1;
          if (lifecycleCountersRef.current.inactive > 0) {
            postLifecycleDebug();
          } else {
            postNativeMessage({
              type: 'threadWebDebug',
              message: 'ws:open',
            });
          }
        },
        onEvent(event) {
          const currentDetail = detailRef.current;
          const projection = currentDetail
            ? projectThreadEventIntoDetail(currentDetail, event)
            : null;
          if (projection?.projected) {
            const nextDetail = projection.detail;
            detailRef.current = nextDetail;
            if (threadDetailRevision(currentDetail) !== threadDetailRevision(nextDetail)) {
              setDetail(nextDetail);
              setThreads((current) => replaceThread(current, nextDetail.thread));
            }
          }
          postNativeMessage({
            type: 'threadWebDebug',
            message: `ws:${event.type}${projection?.projected ? ':projected' : ':refresh'}`,
          });
          if (!projection?.projected && !refreshFallbackDisabled) {
            scheduleRefresh();
          }
        },
        onError(message) {
          console.warn(message);
        },
        onClose() {
          lifecycleCountersRef.current.wsClose += 1;
        },
      },
    );
    return () => {
      if (refreshTimer !== null) {
        window.clearTimeout(refreshTimer);
      }
      subscription.close();
    };
  }, [
    bootstrap,
    detail?.thread.id,
    postLifecycleDebug,
    refreshFallbackDisabled,
    refreshThreadDetail,
    sceneActive,
  ]);

  useEffect(() => {
    if (bootstrap.fixture || !detail) {
      return;
    }

    const provider = detail.thread.provider;
    let cancelled = false;
    Promise.all([
      client.listModels(provider),
      client.listAgentRuntimes(),
    ])
      .then(([loadedModelOptions, runtimes]) => {
        if (cancelled) {
          return;
        }
        setModelOptions(loadedModelOptions);
        const runtime = runtimes.find((entry) => entry.provider === provider);
        setCapabilities(runtime?.capabilities ?? null);
        setToolboxItems(runtime?.managementSchema.toolboxItems ?? []);
      })
      .catch((caught) => {
        if (!cancelled) {
          console.warn('Unable to load iOS WebView thread settings metadata.', caught);
          setModelOptions([]);
          setCapabilities(null);
          setToolboxItems([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [bootstrap.fixture, client, detail?.thread.provider]);

  useEffect(() => {
    if (!detail) {
      return;
    }
    postNativeMessage({
      type: 'threadWebReady',
      title: detail.thread.title,
      workspaceId: detail.workspace.id,
    });
  }, [detail]);

  useEffect(() => {
    if (
      bootstrap.fixture ||
      !bootstrap.uiTestAutoVerifySlashToolbox ||
      !detail ||
      uiTestSlashToolboxVerifiedRef.current
    ) {
      return;
    }

    const provider = detail.thread.provider;
    const commands = new Set(toolboxItems.map((item) => item.command));
    if (provider === 'claude') {
      if (!commands.has('/btw') || !commands.has('/mcp')) {
        return;
      }
    } else if (provider === 'opencode') {
      if (!commands.has('/compact') || !commands.has('/fork')) {
        return;
      }
    } else {
      return;
    }

    uiTestSlashToolboxVerifiedRef.current = true;
    let cancelled = false;
    let timer: number | null = null;
    const sleep = (milliseconds: number) =>
      new Promise<void>((resolve) => {
        timer = window.setTimeout(resolve, milliseconds);
      });
    const buttons = () => Array.from(document.querySelectorAll('button'));
    const buttonText = (button: HTMLButtonElement) =>
      button.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    const findButton = (text: string) =>
      buttons().find((button) => buttonText(button).includes(text));
    const waitFor = async (predicate: () => boolean, label: string) => {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (cancelled) {
          return false;
        }
        if (predicate()) {
          return true;
        }
        await sleep(100);
      }
      postNativeMessage({
        type: 'threadWebDebug',
        message: `slash:${provider}:missing:${label}`,
      });
      return false;
    };
    const openSlashToolbox = async (mode: 'button' | 'typed') => {
      if (mode === 'button') {
        document
          .querySelector<HTMLButtonElement>('button[aria-label="Open slash toolbox"]')
          ?.click();
      } else {
        const editor = document.querySelector<HTMLElement>(
          '[role="textbox"][aria-label="Prompt"]',
        );
        editor?.focus();
        editor?.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: '/',
            bubbles: true,
            cancelable: true,
          }),
        );
      }
      const anchorCommand = provider === 'claude' ? '/mcp' : '/compact';
      return waitFor(
        () => Boolean(findButton(anchorCommand)),
        `${mode}:${anchorCommand}`,
      );
    };
    const closeSlashToolbox = async () => {
      document
        .querySelector<HTMLButtonElement>('button[aria-label="Open slash toolbox"]')
        ?.click();
      await sleep(120);
    };
    const verifyOpenMenu = async (mode: 'button' | 'typed') => {
      if (!(await openSlashToolbox(mode))) {
        return false;
      }
      const mcp = findButton('/mcp');
      const btw = findButton('/btw');
      const compact = findButton('/compact');
      const fork = findButton('/fork');
      if (provider === 'claude') {
        return Boolean(mcp && btw?.disabled);
      }
      return Boolean(compact && fork && !mcp && !btw);
    };

    void (async () => {
      const buttonResult = await verifyOpenMenu('button');
      await closeSlashToolbox();
      const typedResult = await verifyOpenMenu('typed');
      postNativeMessage({
        type: 'threadWebDebug',
        message:
          `slash:${provider}:button=${buttonResult ? 'ok' : 'fail'}` +
          `:typed=${typedResult ? 'ok' : 'fail'}` +
          `:commands=${[...commands].join(',')}`,
      });
    })();

    return () => {
      cancelled = true;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [
    bootstrap.fixture,
    bootstrap.uiTestAutoVerifySlashToolbox,
    detail,
    toolboxItems,
  ]);

  const submitPromptText = useCallback(
    async (prompt: string) => {
      const currentDetail = detailRef.current;
      if (bootstrap.fixture || !currentDetail) {
        return;
      }
      const previousDetail = currentDetail;
      const optimistic = buildOptimisticPromptDetail(currentDetail, prompt);
      setSubmitting(true);
      detailRef.current = optimistic.detail;
      setDetail(optimistic.detail);
      setThreads((current) => replaceThread(current, optimistic.thread));
      setError(null);
      postNativeMessage({
        type: 'threadWebOptimisticPrompt',
        message: `optimistic-prompt:${optimistic.turn.id}:${prompt}`,
      });
      try {
        const updatedThread = await client.sendPrompt(currentDetail.thread.id, prompt);
        setThreads((current) =>
          current.map((thread) =>
            thread.id === updatedThread.id ? updatedThread : thread,
          ),
        );
        await refreshThreadDetail({ reportError: true });
      } catch (caught) {
        detailRef.current = previousDetail;
        setDetail(previousDetail);
        setThreads((current) => replaceThread(current, previousDetail.thread));
        const message = errorMessage(caught);
        setError(message);
        postNativeMessage({ type: 'reportFatalError', message });
        return false;
      } finally {
        setSubmitting(false);
      }
    },
    [bootstrap.fixture, client, refreshThreadDetail],
  );

  const updateThreadSettings = useCallback(
    async (input: UpdateThreadSettingsInput) => {
      if (bootstrap.fixture || !detail) {
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
        current
          ? {
              ...current,
              thread: optimisticThread,
            }
          : current,
      );
      setThreads((current) => replaceThread(current, optimisticThread));
      setError(null);

      try {
        const updatedThread = await client.updateThreadSettings(
          detail.thread.id,
          input,
        );
        setDetail((current) =>
          current
            ? {
                ...current,
                thread: updatedThread,
              }
            : current,
        );
        setThreads((current) => replaceThread(current, updatedThread));
        await refreshThreadDetail({ reportError: true });
      } catch (caught) {
        setDetail(previousDetail);
        setThreads((current) =>
          replaceThread(current, previousDetail.thread),
        );
        const message = errorMessage(caught);
        setError(message);
        postNativeMessage({ type: 'reportFatalError', message });
        throw caught;
      } finally {
        setSettingsBusy(false);
      }
    },
    [bootstrap.fixture, client, detail, refreshThreadDetail],
  );

  const renameThread = useCallback(
    async (threadId: string, title: string) => {
      const normalizedTitle = title.trim();
      if (!normalizedTitle) {
        return;
      }

      if (bootstrap.fixture) {
        const updatedAt = new Date().toISOString();
        const updatedThread = {
          ...(detail?.thread ?? mockDetail.thread),
          id: threadId,
          title: normalizedTitle,
          updatedAt,
        };
        setThreads((current) => replaceThread(current, updatedThread));
        setDetail((current) => {
          if (!current || current.thread.id !== threadId) {
            return current;
          }
          const updatedDetail = {
            ...current,
            thread: {
              ...current.thread,
              title: normalizedTitle,
              updatedAt,
            },
          };
          detailRef.current = updatedDetail;
          return updatedDetail;
        });
        const workspaceId = detailRef.current?.workspace.id ?? detail?.workspace.id;
        postNativeMessage({
          type: 'setNavigationTitle',
          title: normalizedTitle,
          ...(workspaceId ? { workspaceId } : {}),
        });
        postNativeMessage({
          type: 'threadWebDebug',
          message: `thread-action:renamed:${threadId}:${normalizedTitle}`,
        });
        return;
      }

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
      if (detailRef.current?.thread.id === threadId) {
        postNativeMessage({
          type: 'setNavigationTitle',
          title: updatedThread.title,
          workspaceId: detailRef.current.workspace.id,
        });
      }
      postNativeMessage({
        type: 'threadWebDebug',
        message: `thread-action:renamed:${threadId}:${updatedThread.title}`,
      });
    },
    [bootstrap.fixture, client, detail?.thread, detail?.workspace.id],
  );

  const deleteThread = useCallback(
    async (thread: ThreadDto) => {
      if (bootstrap.fixture) {
        setThreads((current) => removeThread(current, thread.id));
        if (detailRef.current?.thread.id === thread.id) {
          detailRef.current = null;
          setDetail(null);
        }
        postNativeMessage({
          type: 'threadWebDebug',
          message: `thread-action:deleted:${thread.id}`,
        });
        return;
      }

      await client.deleteThread(thread.id);
      setThreads((current) => removeThread(current, thread.id));
      postNativeMessage({
        type: 'threadWebDebug',
        message: `thread-action:deleted:${thread.id}`,
      });
      if (detailRef.current?.thread.id === thread.id) {
        detailRef.current = null;
        setDetail(null);
        postNativeMessage({ type: 'closeThread' });
      }
    },
    [bootstrap.fixture, client],
  );

  const cancelPendingSteer = useCallback(
    async (threadId: string, pendingSteerId: string) => {
      if (bootstrap.fixture) {
        setDetail((current) => {
          if (!current || current.thread.id !== threadId) {
            return current;
          }
          const updatedDetail = {
            ...current,
            pendingSteers: current.pendingSteers.filter(
              (steer) => steer.id !== pendingSteerId,
            ),
          };
          detailRef.current = updatedDetail;
          return updatedDetail;
        });
        postNativeMessage({
          type: 'threadWebDebug',
          message: `pending-steer:canceled:${pendingSteerId}`,
        });
        return;
      }

      try {
        const updatedDetail = await client.cancelPendingSteer(
          threadId,
          pendingSteerId,
        );
        detailRef.current = updatedDetail;
        setDetail(updatedDetail);
        setThreads((current) => replaceThread(current, updatedDetail.thread));
        postNativeMessage({
          type: 'threadWebDebug',
          message: `pending-steer:canceled:${pendingSteerId}`,
        });
      } catch (caught) {
        const message = errorMessage(caught);
        setError(message);
        postNativeMessage({ type: 'reportFatalError', message });
        throw caught;
      }
    },
    [bootstrap.fixture, client],
  );

  useEffect(() => {
    if (
      bootstrap.fixture ||
      !detail ||
      !bootstrap.uiTestAutoRenameTitle ||
      uiTestAutoRenameStartedRef.current
    ) {
      return;
    }
    uiTestAutoRenameStartedRef.current = true;
    void renameThread(detail.thread.id, bootstrap.uiTestAutoRenameTitle);
  }, [
    bootstrap.fixture,
    bootstrap.uiTestAutoRenameTitle,
    detail,
    renameThread,
  ]);

  useEffect(() => {
    if (
      bootstrap.fixture ||
      !detail ||
      !bootstrap.uiTestAutoDeleteThread ||
      uiTestAutoDeleteStartedRef.current
    ) {
      return;
    }
    uiTestAutoDeleteStartedRef.current = true;
    void deleteThread(detail.thread);
  }, [
    bootstrap.fixture,
    bootstrap.uiTestAutoDeleteThread,
    deleteThread,
    detail,
  ]);

  const respondToRequest = useCallback(
    async (requestId: string, input: RespondThreadActionRequestInput) => {
      if (!detail) {
        return;
      }

      setRespondingRequestId(requestId);
      setError(null);
      try {
        if (bootstrap.fixture) {
          const request = detail.pendingRequests.find(
            (entry) => entry.id === requestId,
          );
          const summaryLines = Object.values(input.answers)
            .flatMap((answer) => answer.answers)
            .filter(Boolean);

          setDetail((current) =>
            current
              ? {
                  ...current,
                  pendingRequests: current.pendingRequests.filter(
                    (entry) => entry.id !== requestId,
                  ),
                  answeredRequestNotes: [
                    ...(current.answeredRequestNotes ?? []),
                    {
                      id: `answered-${requestId}`,
                      turnId: request?.turnId ?? null,
                      title: request?.title ?? 'Answered request',
                      summaryLines,
                      createdAt: new Date().toISOString(),
                    },
                  ],
                }
              : current,
          );
          postNativeMessage({
            type: 'threadWebDebug',
            message: `pendingRequest:${requestId}:${summaryLines.join(',')}`,
          });
          return;
        }

        const updatedDetail = await client.respondToRequest(
          detail.thread.id,
          requestId,
          input,
        );
        setDetail(updatedDetail);
        setThreads((current) => replaceThread(current, updatedDetail.thread));
        postNativeMessage({
          type: 'threadWebDebug',
          message: `pendingRequest:${requestId}:resolved`,
        });
        await refreshThreadDetail({ reportError: true });
      } catch (caught) {
        const message = errorMessage(caught);
        setError(message);
        postNativeMessage({ type: 'reportFatalError', message });
        throw caught;
      } finally {
        setRespondingRequestId(null);
      }
    },
    [bootstrap.fixture, client, detail, refreshThreadDetail],
  );

  const loadExportTurns = useCallback(async () => {
    if (!detail) {
      return;
    }

    setExportTurnsState((current) => ({
      status: 'loading',
      data: current.data,
      error: null,
    }));

    if (bootstrap.fixture) {
      setExportTurnsState({
        status: 'ready',
        data: fixtureExportTurns(detail),
        error: null,
      });
      return;
    }

    try {
      const data = await client.fetchThreadExportTurns(detail.thread.id);
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
  }, [bootstrap.fixture, client, detail]);

  const exportTranscript = useCallback(
    async (input: ExportThreadPdfInput) => {
      if (!detail) {
        return;
      }

      setExportBusy(true);
      setError(null);
      try {
        const exported = bootstrap.fixture
          ? {
              blob: new Blob(
                [
                  input.format === 'html'
                    ? '<html><body>iOS WebView fixture export</body></html>'
                    : '%PDF iOS WebView fixture export',
                ],
                {
                  type:
                    input.format === 'html'
                      ? 'text/html'
                      : 'application/pdf',
                },
              ),
              filename:
                input.format === 'html'
                  ? 'ios-webview-fixture.html'
                  : 'ios-webview-fixture.pdf',
              contentType:
                input.format === 'html'
                  ? 'text/html'
                  : 'application/pdf',
            }
          : await client.downloadThreadTranscriptExport(detail.thread.id, input);
        postNativeMessage({
          type: 'shareDownloadedFile',
          filename: exported.filename,
          contentType: exported.contentType,
          base64: await blobToBase64(exported.blob),
        });
        postNativeMessage({
          type: 'threadWebDebug',
          message: `export:${exported.filename}`,
        });
        setExportDialogOpen(false);
      } catch (caught) {
        const message = errorMessage(caught);
        setError(message);
        postNativeMessage({ type: 'reportFatalError', message });
        throw caught;
      } finally {
        setExportBusy(false);
      }
    },
    [bootstrap.fixture, client, detail],
  );

  const loadForkTurnOptions = useCallback(async () => {
    if (bootstrap.fixture || !detail) {
      return;
    }
    setForkTurnOptionsState((current) => ({
      status: 'loading',
      data: current.data,
      error: null,
    }));
    try {
      const data = await client.fetchForkTurnOptions(detail.thread.id);
      setForkTurnOptionsState({
        status: 'ready',
        data,
        error: null,
      });
    } catch (caught) {
      const message = errorMessage(caught);
      setForkTurnOptionsState((current) => ({
        status: 'failed',
        data: current.data,
        error: message,
      }));
      setError(message);
      postNativeMessage({ type: 'reportFatalError', message });
      throw caught;
    }
  }, [bootstrap.fixture, client, detail]);

  const forkLatest = useCallback(async () => {
    if (bootstrap.fixture || !detail) {
      return;
    }
    try {
      const result = await client.forkThread(detail.thread.id, {
        mode: 'latest',
      });
      postNativeMessage({
        type: 'threadWebDebug',
        message: [
          'fork',
          'latest',
          result.sourceTurnId ?? 'none',
          result.sourceTurnIndex ?? 'none',
          result.thread.thread.id,
        ].join(':'),
      });
      postNativeMessage({
        type: 'openThread',
        threadId: result.thread.thread.id,
      });
    } catch (caught) {
      const message = errorMessage(caught);
      setError(message);
      postNativeMessage({ type: 'reportFatalError', message });
      throw caught;
    }
  }, [bootstrap.fixture, client, detail]);

  const forkTurn = useCallback(
    async (turnId: string) => {
      if (bootstrap.fixture || !detail) {
        return;
      }
      try {
        const result = await client.forkThread(detail.thread.id, {
          mode: 'turn',
          turnId,
        });
        postNativeMessage({
          type: 'threadWebDebug',
          message: [
            'fork',
            'selected',
            result.sourceTurnId ?? 'none',
            result.sourceTurnIndex ?? 'none',
            result.thread.thread.id,
          ].join(':'),
        });
        postNativeMessage({
          type: 'openThread',
          threadId: result.thread.thread.id,
        });
      } catch (caught) {
        const message = errorMessage(caught);
        setError(message);
        postNativeMessage({ type: 'reportFatalError', message });
        throw caught;
      }
    },
    [bootstrap.fixture, client, detail],
  );

  useEffect(() => {
    if (
      !bootstrap.fixture ||
      !bootstrap.uiTestAutoResolvePendingRequests ||
      !detail ||
      uiTestPendingRequestsResolvedRef.current
    ) {
      return;
    }

    uiTestPendingRequestsResolvedRef.current = true;
    const requests = [...detail.pendingRequests];
    void (async () => {
      const resolvedIds: string[] = [];
      for (const request of requests) {
        const question = request.questions[0];
        if (!question) {
          continue;
        }
        const answer =
          request.kind === 'planDecision'
            ? (question.options?.[0]?.label ?? 'Implement')
            : (question.options?.[0]?.label ?? 'Approved');
        await respondToRequest(request.id, {
          answers: {
            [question.id]: {
              answers: [answer],
            },
          },
        });
        resolvedIds.push(request.id);
      }
      postNativeMessage({
        type: 'threadWebDebug',
        message: `pendingRequests:auto-resolved:${resolvedIds.join(',')}`,
      });
    })();
  }, [
    bootstrap.fixture,
    bootstrap.uiTestAutoResolvePendingRequests,
    detail,
    respondToRequest,
  ]);

  useEffect(() => {
    if (
      !bootstrap.fixture ||
      !bootstrap.uiTestClickPendingRequestControls ||
      !detail ||
      uiTestPendingRequestControlsClickedRef.current
    ) {
      return;
    }

    uiTestPendingRequestControlsClickedRef.current = true;
    let cancelled = false;
    let timer: number | null = null;
    const clickLabels = [
      'thread-pending-request-option-approval-Allow',
      'thread-pending-request-submit-ios-web-approval-request',
      'thread-pending-request-option-question-1-Detailed',
      'thread-pending-request-submit-ios-web-question-request',
      'thread-pending-request-option-plan-decision-Implement-Recommended',
    ];
    const sleep = (milliseconds: number) =>
      new Promise<void>((resolve) => {
        timer = window.setTimeout(resolve, milliseconds);
      });
    const clickButton = async (label: string) => {
      for (let attempt = 0; attempt < 50; attempt += 1) {
        if (cancelled) {
          return false;
        }
        const button = document.querySelector<HTMLButtonElement>(
          `button[aria-label="${label}"]`,
        );
        if (button && !button.disabled) {
          button.click();
          await sleep(120);
          return true;
        }
        await sleep(120);
      }
      return false;
    };
    const waitForControlsGone = async () => {
      for (let attempt = 0; attempt < 50; attempt += 1) {
        if (cancelled) {
          return false;
        }
        if (
          clickLabels.every(
            (label) =>
              !document.querySelector<HTMLButtonElement>(
                `button[aria-label="${label}"]`,
              ),
          )
        ) {
          return true;
        }
        await sleep(120);
      }
      return false;
    };

    void (async () => {
      for (const label of clickLabels) {
        const clicked = await clickButton(label);
        if (!clicked) {
          postNativeMessage({
            type: 'threadWebDebug',
            message: `pendingRequests:click-controls-missing:${label}`,
          });
          return;
        }
      }

      const controlsGone = await waitForControlsGone();
      postNativeMessage({
        type: 'threadWebDebug',
        message: controlsGone
          ? 'pendingRequests:clicked-controls:ios-web-approval-request,ios-web-question-request,ios-web-plan-request'
          : 'pendingRequests:click-controls-missing:controls-still-visible',
      });
    })();

    return () => {
      cancelled = true;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [
    bootstrap.fixture,
    bootstrap.uiTestClickPendingRequestControls,
    Boolean(detail),
  ]);

  useEffect(() => {
    if (
      !bootstrap.uiTestAutoExportTranscript ||
      !detail ||
      uiTestExportStartedRef.current
    ) {
      return;
    }

    uiTestExportStartedRef.current = true;
    void exportTranscript({
      format: bootstrap.uiTestAutoExportTranscriptFormat ?? 'pdf',
      mode: 'latest',
      limit: 10,
      profile: 'review',
      options: {
        includeTokenAndPrice: true,
      },
    });
  }, [
    bootstrap.uiTestAutoExportTranscript,
    bootstrap.uiTestAutoExportTranscriptFormat,
    detail,
    exportTranscript,
  ]);

  useEffect(() => {
    if (
      !bootstrap.uiTestClickVisibleExportControls ||
      !detail ||
      uiTestVisibleExportControlsClickedRef.current
    ) {
      return;
    }

    uiTestVisibleExportControlsClickedRef.current = true;
    let cancelled = false;
    let timer: number | null = null;
    const delay = (ms: number) =>
      new Promise<void>((resolve) => {
        timer = window.setTimeout(resolve, ms);
      });
    const buttons = () => Array.from(document.querySelectorAll('button'));
    const buttonWithLabel = (label: string) =>
      buttons().find(
        (button) =>
          button.getAttribute('aria-label') === label ||
          button.getAttribute('title') === label ||
          button.textContent?.trim() === label,
      ) ?? null;
    const dialog = () =>
      document.querySelector<HTMLElement>('.thread-export-dialog-root');
    const dialogButton = (label: string) =>
      Array.from(dialog()?.querySelectorAll('button') ?? []).find(
        (button) => button.textContent?.trim() === label,
      ) ?? null;
    const clickWhenReady = async (
      findButton: () => HTMLButtonElement | null,
      label: string,
    ) => {
      for (let attempt = 0; attempt < 80; attempt += 1) {
        if (cancelled) {
          return false;
        }
        const button = findButton();
        if (button && !button.disabled) {
          button.click();
          await delay(160);
          return true;
        }
        await delay(160);
      }
      postNativeMessage({
        type: 'threadWebDebug',
        message: `visible-export:missing:${label}`,
      });
      return false;
    };
    const waitFor = async (check: () => boolean, label: string) => {
      for (let attempt = 0; attempt < 80; attempt += 1) {
        if (cancelled) {
          return false;
        }
        if (check()) {
          return true;
        }
        await delay(160);
      }
      postNativeMessage({
        type: 'threadWebDebug',
        message: `visible-export:missing:${label}`,
      });
      return false;
    };

    void (async () => {
      try {
        if (
          !(await clickWhenReady(
            () => buttonWithLabel('Export transcript'),
            'export-button',
          ))
        ) {
          return;
        }
        if (!(await clickWhenReady(() => dialogButton('Custom selection'), 'custom-selection'))) {
          return;
        }
        if (!(await waitFor(() => dialog() !== null, 'dialog'))) {
          return;
        }
        if (!(await clickWhenReady(() => dialogButton('HTML'), 'html-format'))) {
          return;
        }
        if (!(await clickWhenReady(() => dialogButton('Clear'), 'clear-turns'))) {
          return;
        }
        const selectedFirstTurn = await waitFor(() => {
          const checkbox = dialog()?.querySelector<HTMLInputElement>(
            '.thread-export-dialog-turn-row input[type="checkbox"]',
          );
          if (!checkbox) {
            return false;
          }
          if (!checkbox.checked) {
            checkbox.click();
          }
          return checkbox.checked;
        }, 'first-turn-checkbox');
        if (!selectedFirstTurn) {
          return;
        }
        const footerReady = await waitFor(
          () => dialog()?.textContent?.includes('1 turn will be exported') ?? false,
          'single-turn-footer',
        );
        if (!footerReady) {
          return;
        }
        if (!(await clickWhenReady(() => dialogButton('Export HTML'), 'export-html'))) {
          return;
        }
        await delay(400);
        postNativeMessage({
          type: 'threadWebDebug',
          message: 'visible-export:custom-html:1-turn',
        });
      } catch (caught) {
        const message = errorMessage(caught);
        setError(message);
        postNativeMessage({
          type: 'threadWebDebug',
          message: `visible-export:error:${message}`,
        });
        postNativeMessage({ type: 'reportFatalError', message });
      }
    })();

    return () => {
      cancelled = true;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [bootstrap.uiTestClickVisibleExportControls, detail]);

  const recordWorkspaceDebug = useCallback(
    (message: string) => {
      if (!bootstrap.uiTestFocusWorkspacePath) {
        return;
      }
      const next = [...uiTestWorkspaceEventsRef.current, message].slice(-20);
      uiTestWorkspaceEventsRef.current = next;
      postNativeMessage({
        type: 'threadWebDebug',
        message: `workspace:${next.join('|')}`,
      });
    },
    [bootstrap.uiTestFocusWorkspacePath],
  );

  useEffect(() => {
    if (bootstrap.uiTestInitialSettings) {
      postNativeMessage({
        type: 'threadWebDebug',
        message: 'uiTestInitialSettings:present',
      });
    }
  }, [bootstrap.uiTestInitialSettings]);

  useEffect(() => {
    if (
      bootstrap.fixture ||
      !detail ||
      !bootstrap.uiTestInitialSettings ||
      uiTestInitialSettingsAppliedRef.current
    ) {
      return;
    }
    uiTestInitialSettingsAppliedRef.current = true;
    postNativeMessage({
      type: 'threadWebDebug',
      message: 'uiTestInitialSettings:applying',
    });
    void updateThreadSettings(bootstrap.uiTestInitialSettings);
  }, [
    bootstrap.fixture,
    bootstrap.uiTestInitialSettings,
    detail,
    updateThreadSettings,
  ]);

  useEffect(() => {
    if (
      bootstrap.fixture ||
      !detail ||
      !bootstrap.uiTestClickVisibleSettingsControls ||
      uiTestVisibleSettingsControlsClickedRef.current
    ) {
      return;
    }

    uiTestVisibleSettingsControlsClickedRef.current = true;
    let cancelled = false;
    let timer: number | null = null;
    const targetModel = 'ios-e2e-alt';
    const targetReasoning = 'high';
    const targetCollaborationMode = 'plan';
    const targetSandboxMode = 'danger-full-access';
    const sleep = (milliseconds: number) =>
      new Promise<void>((resolve) => {
        timer = window.setTimeout(resolve, milliseconds);
      });
    const buttons = () => Array.from(document.querySelectorAll('button'));
    const buttonWithExactText = (text: string) =>
      buttons().find((button) => button.textContent?.trim() === text);
    const clickButton = async (
      findButton: () => HTMLButtonElement | undefined,
      missingLabel: string,
    ) => {
      for (let attempt = 0; attempt < 60; attempt += 1) {
        if (cancelled) {
          return false;
        }
        const button = findButton();
        if (button && !button.disabled) {
          button.click();
          await sleep(150);
          return true;
        }
        await sleep(150);
      }
      postNativeMessage({
        type: 'threadWebDebug',
        message: `visible-settings:missing:${missingLabel}`,
      });
      return false;
    };
    const waitForState = async () => {
      for (let attempt = 0; attempt < 60; attempt += 1) {
        if (cancelled) {
          return false;
        }
        const selectedModel = document.querySelector<HTMLButtonElement>(
          `button[aria-label="${targetModel}"]`,
        );
        const selectedReasoning = buttonWithExactText(targetReasoning);
        const selectedPlanMode = buttons().find(
          (button) =>
            button.textContent?.trim() === 'Plan' &&
            button.getAttribute('aria-pressed') === 'true',
        );
        const selectedSandboxMode = document.querySelector<HTMLButtonElement>(
          'button[aria-label="Sandbox mode: danger-full-access"][aria-pressed="true"]',
        );
        if (
          selectedModel &&
          selectedReasoning &&
          selectedPlanMode &&
          selectedSandboxMode
        ) {
          return true;
        }
        await sleep(150);
      }
      return false;
    };

    void (async () => {
      const modelOpened = await clickButton(
        () =>
          document.querySelector<HTMLButtonElement>(
            `button[aria-label="${detail.thread.model}"]`,
          ) ?? undefined,
        'model-trigger',
      );
      if (!modelOpened) {
        return;
      }

      const modelSelected = await clickButton(
        () => buttonWithExactText(targetModel),
        targetModel,
      );
      if (!modelSelected) {
        return;
      }

      const effortOpened = await clickButton(
        () =>
          document.querySelector<HTMLButtonElement>(
            'button[title="Select reasoning effort"]',
          ) ?? undefined,
        'reasoning-trigger',
      );
      if (!effortOpened) {
        return;
      }

      const reasoningSelected = await clickButton(
        () => buttonWithExactText(targetReasoning),
        targetReasoning,
      );
      if (!reasoningSelected) {
        return;
      }

      const planSelected = await clickButton(
        () => buttonWithExactText('Plan'),
        'plan-mode',
      );
      if (!planSelected) {
        return;
      }

      setSettingsDialogOpen(true);
      await sleep(250);

      const sandboxSelected = await clickButton(
        () =>
          document.querySelector<HTMLButtonElement>(
            'button[aria-label="Sandbox mode: danger-full-access"]',
          ) ?? undefined,
        'sandbox-danger-full-access',
      );
      if (!sandboxSelected) {
        return;
      }

      const ready = await waitForState();
      postNativeMessage({
        type: 'threadWebDebug',
        message: ready
          ? `visible-settings:updated:${targetModel}:${targetReasoning}:${targetCollaborationMode}:${targetSandboxMode}`
          : 'visible-settings:missing:updated-state',
      });
    })();

    return () => {
      cancelled = true;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [
    bootstrap.fixture,
    bootstrap.uiTestClickVisibleSettingsControls,
    Boolean(detail),
    setSettingsDialogOpen,
  ]);

  useEffect(() => {
    if (
      bootstrap.fixture ||
      !detail ||
      detail.thread.title.endsWith(' / fork') ||
      !bootstrap.uiTestForkMode ||
      uiTestForkControlsClickedRef.current
    ) {
      return;
    }

    uiTestForkControlsClickedRef.current = true;
    let cancelled = false;
    let timer: number | null = null;
    const sleep = (milliseconds: number) =>
      new Promise<void>((resolve) => {
        timer = window.setTimeout(resolve, milliseconds);
      });
    const buttons = () => Array.from(document.querySelectorAll('button'));
    const buttonWithExactText = (text: string) =>
      buttons().find((button) => button.textContent?.trim() === text);
    const buttonContainingText = (text: string) =>
      buttons().find((button) => button.textContent?.includes(text));
    const clickButton = async (
      findButton: () => HTMLButtonElement | undefined,
      missingLabel: string,
    ) => {
      for (let attempt = 0; attempt < 80; attempt += 1) {
        if (cancelled) {
          return false;
        }
        const button = findButton();
        if (button && !button.disabled) {
          button.click();
          await sleep(160);
          return true;
        }
        await sleep(160);
      }
      postNativeMessage({
        type: 'threadWebDebug',
        message: `fork:${bootstrap.uiTestForkMode}:missing:${missingLabel}`,
      });
      return false;
    };

    void (async () => {
      const toolboxOpened = await clickButton(
        () =>
          document.querySelector<HTMLButtonElement>(
            'button[aria-label="Open slash toolbox"]',
          ) ?? undefined,
        'slash-toolbox',
      );
      if (!toolboxOpened) {
        return;
      }

      const forkPanelOpened = await clickButton(
        () => buttonContainingText('/fork'),
        'fork-toolbox-item',
      );
      if (!forkPanelOpened) {
        return;
      }

      if (bootstrap.uiTestForkMode === 'latest') {
        await clickButton(
          () => buttonContainingText('Fork from latest'),
          'fork-latest',
        );
        return;
      }

      const selectedPanelOpened = await clickButton(
        () => buttonContainingText('Fork from selected turn'),
        'fork-selected-panel',
      );
      if (!selectedPanelOpened) {
        return;
      }

      await clickButton(
        () => buttonContainingText('Turn 1'),
        'fork-turn-1',
      );
    })();

    return () => {
      cancelled = true;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [
    bootstrap.fixture,
    bootstrap.uiTestForkMode,
    Boolean(detail),
    detail?.thread.title,
  ]);

  const adapter = useMemo<ThreadDetailUiAdapter>(
    () => {
      const workspaceAdapter: ThreadWorkspaceAdapter | null = bootstrap.fixture || bootstrap.threadId
        ? {
            listTree: async (input) => {
              const workspaceId = resolveWorkspaceId(input.workspaceId);
              if (!workspaceId) {
                throw new Error('No workspace id is available.');
              }
              const tree = await client.fetchWorkspaceTree(
                workspaceId,
                input.path ?? '',
              );
              recordWorkspaceDebug(
                `tree:${input.path ?? ''}:${
                  tree.children?.map((child) => child.name).join(',') ?? ''
                }`,
              );
              return tree;
            },
            readFile: async (input) => {
              const workspaceId = resolveWorkspaceId(input.workspaceId);
              if (!workspaceId) {
                throw new Error('No workspace id is available.');
              }
              const preview = await client.fetchWorkspaceFilePreview(
                workspaceId,
                {
                  path: input.path,
                  ...(input.offset !== undefined ? { offset: input.offset } : {}),
                  ...(input.limit !== undefined ? { limit: input.limit } : {}),
                },
              );
              recordWorkspaceDebug(
                [
                  `preview:${input.path}`,
                  `offset=${input.offset ?? 0}`,
                  `limit=${input.limit ?? 'default'}`,
                  `truncated=${preview.truncated}`,
                  `line0=${preview.content.includes('IOS_WORKSPACE_PREVIEW_MARKER line 0')}`,
                  `line500=${preview.content.includes('IOS_WORKSPACE_PREVIEW_MARKER line 500')}`,
                ].join(':'),
              );
              if (
                bootstrap.uiTestAutoLoadMoreWorkspacePreview &&
                bootstrap.uiTestFocusWorkspacePath === input.path &&
                input.offset === undefined &&
                preview.truncated &&
                !uiTestWorkspaceLoadMoreClickedRef.current
              ) {
                uiTestWorkspaceLoadMoreClickedRef.current = true;
                let attempts = 0;
                const clickLoadMoreWhenReady = () => {
                  const button = document.querySelector<HTMLButtonElement>(
                    '.thread-graph-load-more-button',
                  );
                  if (button) {
                    recordWorkspaceDebug('load-more:clicked');
                    button.click();
                    return;
                  }
                  attempts += 1;
                  if (attempts < 20) {
                    window.setTimeout(clickLoadMoreWhenReady, 150);
                  } else {
                    recordWorkspaceDebug('load-more:missing');
                  }
                };
                window.setTimeout(clickLoadMoreWhenReady, 150);
              }
              return preview;
            },
            getRawFileUrl: (input) => {
              const workspaceId = resolveWorkspaceId(input.workspaceId);
              if (!workspaceId) {
                return '';
              }
              const url = client.buildWorkspaceRawFileUrl(
                workspaceId,
                { path: input.path },
              );
              recordWorkspaceDebug(
                `raw-url:${input.path}:${/[?&](token|relaySession)=/.test(url)}`,
              );
              return url;
            },
            uploadFile: async (input) => {
              const workspaceId = resolveWorkspaceId(input.workspaceId);
              if (!workspaceId) {
                throw new Error('No workspace id is available.');
              }
              const result = await client.uploadWorkspaceFile(
                workspaceId,
                {
                  path: input.path,
                  file: input.file,
                },
              );
              recordWorkspaceDebug(
                result.kind === 'file'
                  ? `upload:${result.file.path}`
                  : `upload:${result.archiveName}:${result.extractedCount}`,
              );
              return result;
            },
            pickUploadFile: (input) => {
              recordWorkspaceDebug(
                `native-upload-picker:bridge=${hasNativeBridge()}`,
              );
              pickNativeFiles({
                kind: 'file',
                defaultPick: input.defaultPick,
                debugPrefix: 'workspace-upload-picker',
                async onFiles({ files }) {
                  recordWorkspaceDebug(`native-upload-picker:files=${files.length}`);
                  const file = files[0];
                  if (!file) {
                    return;
                  }
                  await input.upload(file);
                  recordWorkspaceDebug(`native-upload-picker:${file.name}`);
                },
              });
            },
            writeFile: async (input) => {
              const workspaceId = resolveWorkspaceId(input.workspaceId);
              if (!workspaceId) {
                throw new Error('No workspace id is available.');
              }
              await client.writeWorkspaceFile(
                workspaceId,
                {
                  path: input.path,
                  content: input.content,
                },
              );
              recordWorkspaceDebug(`write:${input.path}`);
            },
            downloadNode: async (input) => {
              const workspaceId = resolveWorkspaceId(input.workspaceId);
              if (!workspaceId) {
                throw new Error('No workspace id is available.');
              }
              const downloaded = await client.downloadWorkspaceNode(
                workspaceId,
                { path: input.path },
              );
              postNativeMessage({
                type: 'shareDownloadedFile',
                filename: downloaded.filename,
                contentType: downloaded.contentType,
                base64: await blobToBase64(downloaded.blob),
              });
              recordWorkspaceDebug(
                `download:${input.path}:${downloaded.filename}`,
              );
            },
          }
        : null;

      return {
        openThread(threadId) {
          postNativeMessage({ type: 'openThread', threadId });
        },
        getThreadHref(threadId) {
          return `#thread-${threadId}`;
        },
        renameThread,
        deleteThread,
        cancelPendingSteer,
        sendPrompt: async (input) => {
          if (bootstrap.fixture || !detailRef.current) {
            return;
          }
          return submitPromptText(input.prompt);
        },
        async loadHistoryItemDetail(itemId) {
          const currentDetail = detailRef.current;
          if (bootstrap.fixture || !currentDetail) {
            return {
              id: itemId,
              kind: 'agentMessage',
              title: 'Fixture detail',
              text: 'History detail is available once a real thread is loaded.',
            };
          }
          const loaded = await client.fetchHistoryItemDetail(
            currentDetail.thread.id,
            itemId,
          );
          postNativeMessage({
            type: 'threadWebDebug',
            message: [
              'history-detail',
              loaded.id,
              loaded.title,
              String(loaded.text.includes('IOS_HISTORY_DETAIL_FULL_OUTPUT')),
            ].join(':'),
          });
          return loaded;
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
          if (currentDetail) {
            postNativeMessage({
              type: 'openWorkspace',
              workspaceId: currentDetail.workspace.id,
            });
            console.info('Requested workspace file', input);
          }
        },
        workspace: workspaceAdapter,
        shell: null,
      };
    },
    [
      bootstrap,
      client,
      cancelPendingSteer,
      deleteThread,
      pickNativeFiles,
      recordWorkspaceDebug,
      renameThread,
      resolveWorkspaceId,
      submitPromptText,
    ],
  );
  const currentThreadId = detail?.thread.id ?? bootstrap.threadId ?? null;
  const workspaceFocusPathRequest = bootstrap.uiTestFocusWorkspacePath
    ? {
        path: bootstrap.uiTestFocusWorkspacePath,
        requestId: 1,
      }
    : null;

  useEffect(() => {
    if (
      bootstrap.fixture ||
      !detail ||
      !bootstrap.uiTestAutoLoadOlderHistory ||
      uiTestOlderHistoryLoadedRef.current
    ) {
      return;
    }

    const totalTurns = detail.totalTurnCount ?? detail.turns.length;
    if (detail.turns.length >= totalTurns) {
      return;
    }

    uiTestOlderHistoryLoadedRef.current = true;
    void loadEarlierHistory();
  }, [
    bootstrap.fixture,
    bootstrap.uiTestAutoLoadOlderHistory,
    detail,
    loadEarlierHistory,
  ]);

  useEffect(() => {
    if (
      bootstrap.fixture ||
      !detail ||
      !bootstrap.uiTestAutoLoadHistoryDetail ||
      uiTestHistoryDetailLoadedRef.current
    ) {
      return;
    }

    const item = detail.turns
      .flatMap((turn) => turn.items)
      .find((candidate) => candidate.hasDeferredDetail);
    if (!item || !adapter.loadHistoryItemDetail) {
      return;
    }

    uiTestHistoryDetailLoadedRef.current = true;
    void (async () => {
      try {
        const loaded = await adapter.loadHistoryItemDetail?.(item.id);
        postNativeMessage({
          type: 'threadWebDebug',
          message: [
            'history-detail',
            loaded?.id ?? item.id,
            loaded?.title ?? 'missing',
            String(
              loaded?.text.includes('IOS_HISTORY_DETAIL_FULL_OUTPUT') ??
                false,
            ),
          ].join(':'),
        });
      } catch (caught) {
        const message = errorMessage(caught);
        postNativeMessage({
          type: 'threadWebDebug',
          message: `history-detail:error:${message}`,
        });
        setError(message);
        postNativeMessage({ type: 'reportFatalError', message });
      }
    })();
  }, [
    adapter,
    bootstrap.fixture,
    bootstrap.uiTestAutoLoadHistoryDetail,
    detail,
  ]);

  useEffect(() => {
    if (
      bootstrap.fixture ||
      !detail ||
      !bootstrap.uiTestAutoVerifyImageAsset ||
      uiTestImageAssetLoadedRef.current
    ) {
      return;
    }

    let cancelled = false;
    let timer: number | null = null;
    let attempts = 0;
    const maxAttempts = 75;
    const checkImage = () => {
      if (cancelled || uiTestImageAssetLoadedRef.current) {
        return;
      }
      const image = document.querySelector<HTMLImageElement>(
        '.thread-graph-history-event-image',
      );
      if (image?.complete && image.naturalWidth > 0) {
        uiTestImageAssetLoadedRef.current = true;
        const hasAuthQuery = /[?&](token|relaySession)=/.test(image.currentSrc);
        postNativeMessage({
          type: 'threadWebDebug',
          message: `image-asset:loaded:${hasAuthQuery}`,
        });
        return;
      }
      attempts += 1;
      if (attempts >= maxAttempts) {
        postNativeMessage({
          type: 'threadWebDebug',
          message: 'image-asset:missing',
        });
        return;
      }
      timer = window.setTimeout(checkImage, 200);
    };

    timer = window.setTimeout(checkImage, 200);
    return () => {
      cancelled = true;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [
    bootstrap.fixture,
    bootstrap.uiTestAutoVerifyImageAsset,
    detail,
  ]);

  useEffect(() => {
    if (
      !bootstrap.fixture ||
      !detail ||
      !bootstrap.uiTestAutoVerifyTimelineContent ||
      uiTestTimelineContentVerifiedRef.current
    ) {
      return;
    }

    let cancelled = false;
    let timer: number | null = null;
    let attempts = 0;
    const expectedText = [
      'Render the shared thread UI inside the iOS WebView host.',
      'The shared React thread surface is loaded from the iOS bundle.',
      'IOS_WEBVIEW_PLAN_MARKER',
      'Context compacted',
      'Allow this command?',
      'Which plan style should I use?',
      'tool_call',
    ];
    const expectedButtons = [
      'Expand command history item',
      'Expand tool_call history item',
      'Expand web_search history item',
      'Expand file_read history item',
      'Open file change details',
    ];
    const expectedKinds: Array<ThreadHistoryItemDto['kind']> = [
      'userMessage',
      'agentMessage',
      'plan',
      'commandExecution',
      'toolCall',
      'webSearch',
      'fileRead',
      'fileChange',
      'contextCompaction',
    ];

    const checkTimelineDom = () => {
      if (cancelled || uiTestTimelineContentVerifiedRef.current) {
        return;
      }

      const bodyText = document.body.innerText;
      const buttonLabels = Array.from(document.querySelectorAll('button')).map(
        (button) =>
          [
            button.textContent ?? '',
            button.getAttribute('aria-label') ?? '',
            button.getAttribute('title') ?? '',
          ].join(' '),
      );
      const missingText = expectedText.filter((text) => !bodyText.includes(text));
      const missingButtons = expectedButtons.filter(
        (label) =>
          !buttonLabels.some((buttonLabel) => buttonLabel.includes(label)),
      );
      const renderedKinds = new Set(
        detail.turns.flatMap((turn) => turn.items.map((item) => item.kind)),
      );
      const missingKinds = expectedKinds.filter((kind) => !renderedKinds.has(kind));

      if (
        missingText.length === 0 &&
        missingButtons.length === 0 &&
        missingKinds.length === 0 &&
        detail.pendingRequests.length >= 3
      ) {
        uiTestTimelineContentVerifiedRef.current = true;
        postNativeMessage({
          type: 'threadWebDebug',
          message:
            'timeline-fixture:ready:' +
            `kinds=${expectedKinds.join(',')}:` +
            `pending=${detail.pendingRequests.length}:` +
            `buttons=${expectedButtons.length}`,
        });
        return;
      }

      attempts += 1;
      if (attempts >= 50) {
        postNativeMessage({
          type: 'threadWebDebug',
          message:
            'timeline-fixture:missing:' +
            `text=${missingText.join(',') || 'none'}:` +
            `buttons=${missingButtons.join(',') || 'none'}:` +
            `kinds=${missingKinds.join(',') || 'none'}:` +
            `pending=${detail.pendingRequests.length}`,
        });
        return;
      }

      timer = window.setTimeout(checkTimelineDom, 200);
    };

    timer = window.setTimeout(checkTimelineDom, 200);
    return () => {
      cancelled = true;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [
    bootstrap.fixture,
    bootstrap.uiTestAutoVerifyTimelineContent,
    detail,
  ]);

  useEffect(() => {
    if (
      !bootstrap.fixture ||
      !detail ||
      !bootstrap.uiTestClickVisibleHistoryDetails ||
      uiTestVisibleHistoryDetailsStartedRef.current
    ) {
      return;
    }

    uiTestVisibleHistoryDetailsStartedRef.current = true;
    let cancelled = false;
    let timer: number | null = null;
    const sleep = (milliseconds: number) =>
      new Promise<void>((resolve) => {
        timer = window.setTimeout(resolve, milliseconds);
      });
    const buttonLabel = (button: HTMLButtonElement) =>
      [
        button.getAttribute('aria-label') ?? '',
        button.getAttribute('title') ?? '',
        button.textContent ?? '',
      ].join(' ');
    const findButton = (label: string) =>
      Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
        (button) => buttonLabel(button).includes(label),
      );
    const clickButton = async (label: string) => {
      for (let attempt = 0; attempt < 80; attempt += 1) {
        if (cancelled) {
          return false;
        }
        const button = findButton(label);
        if (button && !button.disabled) {
          button.scrollIntoView({ block: 'center', inline: 'nearest' });
          await sleep(80);
          button.click();
          await sleep(180);
          return true;
        }
        await sleep(120);
      }
      return false;
    };
    const waitForBodyText = async (text: string) => {
      for (let attempt = 0; attempt < 80; attempt += 1) {
        if (cancelled) {
          return false;
        }
        if (document.body.innerText.includes(text)) {
          return true;
        }
        await sleep(120);
      }
      return false;
    };
    const waitForSelectedDebug = async (text: string) => {
      for (let attempt = 0; attempt < 80; attempt += 1) {
        if (cancelled) {
          return false;
        }
        if (selectedHistoryDetailDebugRef.current.includes(text)) {
          return true;
        }
        await sleep(120);
      }
      return false;
    };
    const closeDialog = async () => {
      await clickButton('Close dialog');
    };

    void (async () => {
      const toolExpanded = await clickButton('Expand tool_call history item');
      const toolOpened = toolExpanded
        ? await clickButton('Open full tool call')
        : false;
      const tool = toolOpened ? await waitForSelectedDebug('tool=true') : false;

      const searchExpanded = await clickButton('Expand web_search history item');
      const searchOpened = searchExpanded
        ? await clickButton('Open full web search')
        : false;
      const search = searchOpened
        ? await waitForBodyText('IOS_WEBVIEW_SEARCH_DETAIL_MARKER')
        : false;
      if (search) {
        await closeDialog();
      }

      const fileReadExpanded = await clickButton('Expand file_read history item');
      const fileReadOpened = fileReadExpanded
        ? await clickButton('Open full file read')
        : false;
      const fileRead = fileReadOpened
        ? await waitForBodyText('IOS_WEBVIEW_FILE_READ_DETAIL_MARKER')
        : false;

      postNativeMessage({
        type: 'threadWebDebug',
        message:
          `visible-history-details:tool=${tool}:search=${search}:fileRead=${fileRead}`,
      });
    })();

    return () => {
      cancelled = true;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [
    bootstrap.fixture,
    bootstrap.uiTestClickVisibleHistoryDetails,
    detail,
  ]);

  useEffect(() => {
    if (
      bootstrap.fixture ||
      !detail ||
      !adapter.workspace ||
      !bootstrap.uiTestFocusWorkspacePath ||
      !bootstrap.uiTestAutoWorkspaceFileActions ||
      uiTestWorkspaceFileActionsStartedRef.current
    ) {
      return;
    }

    uiTestWorkspaceFileActionsStartedRef.current = true;
    const workspace = adapter.workspace;
    const focusPath = bootstrap.uiTestFocusWorkspacePath;
    const workspaceIdentity = {
      threadId: detail.thread.id,
      workspaceId: detail.workspace.id,
    };
    const writePath = 'Sources/ios-webview-write.txt';
    const writeContent = 'IOS_WEBVIEW_WORKSPACE_WRITE_MARKER\n';
    const uploadPath = 'Sources/ios-webview-upload.txt';
    const uploadContent = 'IOS_WEBVIEW_WORKSPACE_UPLOAD_MARKER\n';

    void (async () => {
      try {
        await workspace.writeFile?.({
          ...workspaceIdentity,
          path: writePath,
          content: writeContent,
        });
        const written = await workspace.readFile({
          ...workspaceIdentity,
          path: writePath,
        });
        recordWorkspaceDebug(
          `write-preview:${written.path}:${written.content.includes('IOS_WEBVIEW_WORKSPACE_WRITE_MARKER')}`,
        );

        await workspace.uploadFile?.({
          ...workspaceIdentity,
          path: uploadPath,
          file: new File([uploadContent], 'ios-webview-upload.txt', {
            type: 'text/plain',
          }),
        });
        const uploaded = await workspace.readFile({
          ...workspaceIdentity,
          path: uploadPath,
        });
        recordWorkspaceDebug(
          `upload-preview:${uploaded.path}:${uploaded.content.includes('IOS_WEBVIEW_WORKSPACE_UPLOAD_MARKER')}`,
        );

        await workspace.downloadNode?.({
          ...workspaceIdentity,
          path: focusPath,
          kind: 'file',
        });
      } catch (caught) {
        const message = errorMessage(caught);
        recordWorkspaceDebug(`file-actions:error:${message}`);
        setError(message);
        postNativeMessage({ type: 'reportFatalError', message });
      }
    })();
  }, [
    adapter.workspace,
    bootstrap.fixture,
    bootstrap.uiTestAutoWorkspaceFileActions,
    bootstrap.uiTestFocusWorkspacePath,
    detail,
    recordWorkspaceDebug,
  ]);

  useEffect(() => {
    if (
      bootstrap.fixture ||
      !detail ||
      !adapter.workspace ||
      !bootstrap.uiTestFocusWorkspacePath ||
      !bootstrap.uiTestClickVisibleWorkspaceControls ||
      uiTestVisibleWorkspaceControlsStartedRef.current
    ) {
      return;
    }

    uiTestVisibleWorkspaceControlsStartedRef.current = true;
    let cancelled = false;
    let timer: number | null = null;
    const workspace = adapter.workspace;
    const workspaceIdentity = {
      threadId: detail.thread.id,
      workspaceId: detail.workspace.id,
    };
    const editablePath = 'Sources/Editable.txt';
    const editedContent = `IOS_WORKSPACE_VISIBLE_EDIT_MARKER:${Date.now()}\n`;
    const imagePath = 'Sources/Preview.png';
    const uploadPath = 'ios-webview-visible-upload.txt';
    const delay = (ms: number) =>
      new Promise<void>((resolve) => {
        timer = window.setTimeout(resolve, ms);
      });
    const buttons = () => Array.from(document.querySelectorAll('button'));
    const buttonWithLabel = (label: string) =>
      buttons().find(
        (button) =>
          button.getAttribute('aria-label') === label ||
          button.getAttribute('title') === label ||
          button.textContent?.trim() === label,
      ) ?? null;
    const previewButtonWithLabel = (label: string) =>
      document.querySelector<HTMLButtonElement>(
        `.thread-graph-file-preview-header button[aria-label="${label}"]`,
      );
    const buttonContainingText = (text: string) =>
      buttons().find((button) => button.textContent?.includes(text)) ?? null;
    const clickWhenReady = async (
      findButton: () => HTMLButtonElement | null,
      label: string,
    ) => {
      for (let attempt = 0; attempt < 80; attempt += 1) {
        if (cancelled) {
          return false;
        }
        const button = findButton();
        if (button && !button.disabled) {
          button.click();
          await delay(180);
          return true;
        }
        await delay(180);
      }
      recordWorkspaceDebug(`visible-controls:missing:${label}`);
      return false;
    };
    const waitFor = async (
      check: () => Promise<boolean> | boolean,
      label: string,
    ) => {
      for (let attempt = 0; attempt < 80; attempt += 1) {
        if (cancelled) {
          return false;
        }
        try {
          if (await check()) {
            return true;
          }
        } catch {
          // The visible-control hook polls real async adapter effects; transient
          // 404s are expected before upload/save side effects have settled.
        }
        await delay(180);
      }
      recordWorkspaceDebug(`visible-controls:missing:${label}`);
      return false;
    };

    void (async () => {
      const results = {
        raw: false,
        write: false,
        download: false,
        upload: false,
        input: 'missing',
      };

      try {
        if (
          !(await clickWhenReady(
            () => buttonContainingText('Editable.txt'),
            'editable-file',
          ))
        ) {
          return;
        }
        if (
          !(await waitFor(
            async () => {
              const editable = await workspace.readFile({
                ...workspaceIdentity,
                path: editablePath,
              });
              return typeof editable.content === 'string';
            },
            'editable-preview',
          ))
        ) {
          return;
        }
        if (
          !(await clickWhenReady(
            () => previewButtonWithLabel('Edit file'),
            'edit-file',
          ))
        ) {
          return;
        }
        const editorReady = await waitFor(() => {
          const textarea = document.querySelector<HTMLTextAreaElement>(
            'textarea[aria-label="Workspace file editor"]',
          );
          if (!textarea) {
            return false;
          }
          const setter = Object.getOwnPropertyDescriptor(
            HTMLTextAreaElement.prototype,
            'value',
          )?.set;
          setter?.call(textarea, editedContent);
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
          return true;
        }, 'file-editor');
        if (!editorReady) {
          return;
        }
        if (
          !(await clickWhenReady(
            () => previewButtonWithLabel('Save file'),
            'save-file',
          ))
        ) {
          return;
        }
        results.write = await waitFor(async () => {
          const saved = await workspace.readFile({
            ...workspaceIdentity,
            path: editablePath,
          });
          return saved.content.includes('IOS_WORKSPACE_VISIBLE_EDIT_MARKER');
        }, 'saved-edit');

        results.download = await clickWhenReady(
          () => buttonWithLabel('Download Editable.txt'),
          'download-editable',
        );

        if (
          !(await clickWhenReady(
            () => buttonContainingText('Preview.png'),
            'preview-png',
          ))
        ) {
          return;
        }
        results.raw = await waitFor(() => {
          const image = document.querySelector<HTMLImageElement>(
            `img[alt="${imagePath}"]`,
          );
          return Boolean(
            image?.complete &&
              image.naturalWidth > 0 &&
              image.currentSrc.includes('/files/raw'),
          );
        }, 'raw-image-preview');

        if (
          !(await clickWhenReady(
            () => buttonWithLabel('Upload file'),
            'upload-file',
          ))
        ) {
          return;
        }
        results.input = 'native-picker';
        results.upload = await waitFor(async () => {
          const uploaded = await workspace.readFile({
            ...workspaceIdentity,
            path: uploadPath,
          });
          return uploaded.content.includes('IOS_WORKSPACE_VISIBLE_UPLOAD_MARKER');
        }, 'uploaded-file');

        recordWorkspaceDebug(
          [
            `visible-controls:raw=${results.raw}`,
            `write=${results.write}`,
            `download=${results.download}`,
            `upload=${results.upload}`,
            `input=${results.input}`,
          ].join(':'),
        );
      } catch (caught) {
        const message = errorMessage(caught);
        recordWorkspaceDebug(`visible-controls:error:${message}`);
        setError(message);
        postNativeMessage({ type: 'reportFatalError', message });
      }
    })();

    return () => {
      cancelled = true;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [
    adapter.workspace,
    bootstrap.fixture,
    bootstrap.uiTestClickVisibleWorkspaceControls,
    bootstrap.uiTestFocusWorkspacePath,
    detail,
    recordWorkspaceDebug,
  ]);

  const handleShellThemeModeChange = useCallback((mode: IOSThemeMode) => {
    setThemeMode(mode);
    postNativeMessage({ type: 'setThemeMode', theme: mode });
  }, []);

  const handleCopyMetaSessionId = useCallback(async () => {
    const sessionId = detail?.thread.providerSessionId?.trim();
    if (!sessionId) {
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
            <span className="scale-[0.72]">
              <CopyIcon />
            </span>
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

  const settingsContent = null;

  return (
    <PluginProvider>
      <ThreadDetailSurface
        threads={threads}
        detail={detail}
        loading={loading}
        error={error}
        status={mockStatus}
        adapter={adapter}
        shellEffectiveTheme={effectiveThemeValue}
        shellThemeMode={themeMode}
        onShellThemeModeChange={handleShellThemeModeChange}
        settingsDialogOpen={settingsDialogOpen}
        onSettingsDialogOpenChange={setSettingsDialogOpen}
        metaContent={metaContent}
        settingsContent={settingsContent}
        surfaceActions={
          <button
            type="button"
            aria-label="Export transcript"
            title="Export transcript"
            onClick={() => setExportDialogOpen(true)}
            className="ios-thread-export-button"
          >
            Export
          </button>
        }
        dialogs={
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
            onExport={exportTranscript}
          />
        }
        {...(detail
          ? {
              composerProps: {
                busy: submitting,
                settingsBusy,
                model: detail.thread.model,
                reasoningEffort: detail.thread.reasoningEffort,
                fastMode: detail.thread.fastMode ?? false,
                collaborationMode: detail.thread.collaborationMode,
                sandboxMode: null,
                hideSandboxModeControl: true,
                followTail,
                modelOptions,
                toolboxItems,
                forkTurnOptionsState,
                contextUsage: detail.thread.contextUsage ?? null,
                capabilities,
                threadConnected: detail.thread.isLoaded,
                disabled: !detail.thread.isLoaded,
                shellAvailable: false,
                onPickAttachment: pickNativeAttachments,
                onUpdateSettings: updateThreadSettings,
                onToggleFollow: () => {
                  setScrollRequestKey((current) => current + 1);
                },
                onOpenForkTurns: loadForkTurnOptions,
                onForkLatest: forkLatest,
                onForkTurn: forkTurn,
              },
            }
          : {})}
        timelineProps={{
          scrollRequestKey,
          onTailVisibilityChange: setFollowTail,
          loadingEarlier,
          onLoadEarlier: loadEarlierHistory,
          respondingRequestId,
          onRespondToRequest: respondToRequest,
          onSelectHistoryItemDetail({ detail: selectedDetail }) {
            const markerSummary = [
              `command=${selectedDetail.text.includes('IOS_WEBVIEW_COMMAND_DETAIL_MARKER')}`,
              `tool=${selectedDetail.text.includes('IOS_WEBVIEW_TOOL_DETAIL_MARKER')}`,
              `search=${selectedDetail.text.includes('IOS_WEBVIEW_SEARCH_DETAIL_MARKER')}`,
              `fileRead=${selectedDetail.text.includes('IOS_WEBVIEW_FILE_READ_DETAIL_MARKER')}`,
              `fileChange=${selectedDetail.text.includes('IOS_WEBVIEW_FILE_CHANGE_DETAIL_MARKER')}`,
            ].join(':');
            const debugMessage = [
              'history-detail-selected',
              selectedDetail.id,
              selectedDetail.title,
              String(
                selectedDetail.text.includes('IOS_HISTORY_DETAIL_FULL_OUTPUT'),
              ),
              markerSummary,
            ].join(':');
            selectedHistoryDetailDebugRef.current = debugMessage;
            postNativeMessage({
              type: 'threadWebDebug',
              message: debugMessage,
            });
          },
        }}
        workspaceFocusPathRequest={workspaceFocusPathRequest}
        {...(currentThreadId ? { currentThreadId } : {})}
        currentWorkspaceId={detail?.workspace.id ?? null}
        currentWorkspaceLabel={detail?.workspace.label ?? null}
        loadingContent={
          <div className="ios-thread-message" role="status">
            Loading thread...
          </div>
        }
        emptyContent={
          <div className="ios-thread-message">
            No thread is available for this route.
          </div>
        }
        shellUnavailableContent={
          <div className="ios-thread-message">
            Shell is disabled in the first iOS WebView migration slice.
          </div>
        }
      />
    </PluginProvider>
  );
}
