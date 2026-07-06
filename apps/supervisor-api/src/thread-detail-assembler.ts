import type {
  AgentSessionDetail,
  AgentTurn,
} from '../../../packages/agent-runtime/src/index';
import type {
  ThreadHistoryItemDetailDto,
  ThreadHistoryItemDto,
  ReasoningEffortDto,
  ThreadTurnDto,
  ThreadTurnPricingTierDto,
} from '../../../packages/shared/src/index';
import {
  applyRecordedTurnItemOrders,
  agentTurnToThreadTurnDto,
  deferLargeHistoryItemDetails,
  mergePersistedHistoryItemsIntoTurns,
  sortHistoryItemsBySequence,
} from './thread-history-items';
import type { ThreadLiveStateStore } from './thread-live-state-store';
import {
  buildThreadTurnPricingSnapshot,
  estimateThreadTurnPrice,
  normalizePricingTier,
  parseThreadTurnTokenUsageJson,
} from './thread-usage-accounting';

export interface ThreadDetailCacheEntry {
  cachedAt: number;
  turns: ThreadTurnDto[];
  totalTurnCount: number;
  deferredDetails: Map<string, ThreadHistoryItemDetailDto>;
  isPaged: boolean;
}

interface ThreadDetailCacheBucket {
  full: ThreadDetailCacheEntry | null;
  latestPages: Map<string, ThreadDetailCacheEntry>;
}

export interface ThreadTurnMetadataRecord {
  model: string | null;
  reasoningEffort: string | null;
  reasoningEffortAvailable: boolean | null;
  pricingModelKey: string | null;
  pricingTierKey: ThreadTurnPricingTierDto | null;
  tokenUsageJson: string | null;
  displayPrompt?: string | null;
  createdAt?: string | null;
}

export interface ThreadDetailRecord {
  id: string;
  workspaceId: string;
  provider?: string | null;
  providerSessionId: string | null;
  providerTurnId?: string | null;
  collaborationMode: string | null;
  model: string | null;
  reasoningEffort: string | null;
}

interface LocalSessionLike {
  turns: ThreadTurnDto[];
}

interface ThreadDetailAssemblerCallbacks {
  buildThreadPatch(
    remoteSession: AgentSessionDetail,
    model: string | null | undefined,
    reasoningEffort: string | null | undefined,
  ): Record<string, unknown>;
  findLocalSession(providerSessionId: string): Promise<LocalSessionLike | null>;
  listPersistedHistoryItemsByTurnId(
    localThreadId: string,
  ): Map<string, ThreadHistoryItemDto[]>;
  materializeHiddenRuntimeTurns(localThreadId: string, turns: AgentTurn[]): void;
  readRemoteSession(
    record: ThreadDetailRecord,
    options: { limit?: number; beforeTurnId?: string },
  ): Promise<AgentSessionDetail | null>;
  resumeRemoteSession(record: ThreadDetailRecord): Promise<AgentSessionDetail>;
  syncAfterRemoteSession(localThreadId: string, remoteSession: AgentSessionDetail): void;
  updateThreadRecord(localThreadId: string, patch: Record<string, unknown>): void;
  getUpdatedThreadRecord(localThreadId: string): ThreadDetailRecord;
}

const THREAD_DETAIL_CACHE_TTL_MS = 5_000;

export class ThreadDetailAssembler {
  private readonly threadDetailCache = new Map<string, ThreadDetailCacheBucket>();

  constructor(
    private readonly input: {
      liveState: ThreadLiveStateStore;
      callbacks: ThreadDetailAssemblerCallbacks;
    },
  ) {}

  getCache(
    localThreadId: string,
    options: { limit?: number; beforeTurnId?: string } = {},
  ): ThreadDetailCacheEntry | null {
    const bucket = this.threadDetailCache.get(localThreadId);
    if (!bucket) {
      return null;
    }

    const key = cacheKeyForDetailOptions(options);
    if (key === 'uncached') {
      return null;
    }

    const cached = key === 'full' ? bucket.full : bucket.latestPages.get(key) ?? null;
    if (cached && !isExpiredThreadDetailCacheEntry(cached)) {
      return cached;
    }

    if (key === 'full') {
      bucket.full = null;
    } else {
      bucket.latestPages.delete(key);
    }

    if (!bucket.full && bucket.latestPages.size === 0) {
      this.threadDetailCache.delete(localThreadId);
    }

    return null;
  }

  setCache(
    localThreadId: string,
    options: { limit?: number; beforeTurnId?: string } = {},
    entry: Omit<ThreadDetailCacheEntry, 'cachedAt'>,
  ) {
    const bucket = this.threadDetailCache.get(localThreadId) ?? {
      full: null,
      latestPages: new Map<string, ThreadDetailCacheEntry>(),
    };
    const nextEntry = {
      ...entry,
      cachedAt: Date.now(),
    };
    const key = cacheKeyForDetailOptions(options);
    if (key === 'uncached') {
      return;
    }

    if (key === 'full') {
      bucket.full = nextEntry;
    } else {
      bucket.latestPages.set(key, nextEntry);
    }
    this.threadDetailCache.set(localThreadId, bucket);
  }

  invalidate(localThreadId: string) {
    this.threadDetailCache.delete(localThreadId);
  }

  cachedTurns(localThreadId: string) {
    const bucket = this.threadDetailCache.get(localThreadId);
    if (!bucket) {
      return [];
    }

    if (bucket.full && !isExpiredThreadDetailCacheEntry(bucket.full)) {
      return bucket.full.turns;
    }

    let newest: ThreadDetailCacheEntry | null = null;
    for (const [key, entry] of bucket.latestPages.entries()) {
      if (isExpiredThreadDetailCacheEntry(entry)) {
        bucket.latestPages.delete(key);
        continue;
      }
      if (!newest || entry.cachedAt > newest.cachedAt) {
        newest = entry;
      }
    }

    if (!bucket.full && bucket.latestPages.size === 0) {
      this.threadDetailCache.delete(localThreadId);
    }

    return newest?.turns ?? [];
  }

  async buildCacheEntry(input: {
    localThreadId: string;
    record: ThreadDetailRecord;
    turnMetadataById: Map<string, ThreadTurnMetadataRecord>;
    options?: { limit?: number; beforeTurnId?: string };
  }): Promise<ThreadDetailCacheEntry> {
    const options = input.options ?? {};
    const shouldCacheFullDetail =
      options.limit === undefined && options.beforeTurnId === undefined;
    const cacheKey = cacheKeyForDetailOptions(options);
    const isPaged = !shouldCacheFullDetail;
    const cached = this.getCache(input.localThreadId, options);
    if (cached) {
      return cached;
    }

    let remoteSession = await this.input.callbacks.readRemoteSession(
      input.record,
      options,
    );

    if (!remoteSession) {
      return this.buildLocalFallbackEntry({
        ...input,
        options,
        shouldCacheFullDetail,
      });
    }

    if (
      remoteSession.turns.length > 0 &&
      remoteSession.turns.every((turn) => turn.items.length === 0)
    ) {
      remoteSession = await this.input.callbacks.resumeRemoteSession(input.record);
    }

    const threadPatch = this.input.callbacks.buildThreadPatch(
      remoteSession,
      input.record.model,
      input.record.reasoningEffort,
    );
    const persistedItemsByTurnIdForPatch = this.input.callbacks.listPersistedHistoryItemsByTurnId(
      input.localThreadId,
    );
    const activeDisplayTurnId =
      this.input.liveState.displayTurnIdForRuntimeTurn(
        input.localThreadId,
        input.record.providerTurnId,
      ) ?? input.record.providerTurnId;
    const activeLiveItems = this.input.liveState.getLiveItemsForTurn(
      input.localThreadId,
      activeDisplayTurnId,
    );
    if (
      input.record.providerTurnId &&
      threadPatch.status === 'idle' &&
      activeLiveItems &&
      activeLiveItems.items.length > 0
    ) {
      threadPatch.status = 'running';
    }
    const latestPersistedFailure = latestPersistedFailureAfter(
      persistedItemsByTurnIdForPatch,
      input.turnMetadataById,
      newestRemoteTurnStartedAt(remoteSession.turns),
    );
    if (threadPatch.status !== 'running' && latestPersistedFailure) {
      threadPatch.status = 'failed';
      threadPatch.lastError = latestPersistedFailure.error;
    }
    const nextThreadPatch = {
      ...threadPatch,
      ...(threadPatch.status !== 'running' ? { providerTurnId: null } : {}),
    };
    this.input.callbacks.updateThreadRecord(input.record.id, nextThreadPatch);

    const updated = this.input.callbacks.getUpdatedThreadRecord(input.record.id);
    this.input.callbacks.syncAfterRemoteSession(updated.id, remoteSession);

    const deferredDetails = new Map<string, ThreadHistoryItemDetailDto>();
    const persistedItemsByTurnId = this.input.callbacks.listPersistedHistoryItemsByTurnId(
      input.localThreadId,
    );
    const fallbackMetadata = fallbackTurnMetadataForRecord(
      updated,
      latestThreadTurnMetadata(input.turnMetadataById),
    );
    this.input.callbacks.materializeHiddenRuntimeTurns(
      input.localThreadId,
      remoteSession.turns,
    );
    const visibleTurns = this.input.liveState
      .visibleRemoteTurns(input.localThreadId, remoteSession.turns)
      .map((turn) => agentTurnToThreadTurnDto(turn, deferredDetails));
    const visibleTurnsWithActiveLiveTurn = appendActiveLiveTurnIfMissing(
      visibleTurns,
      input.localThreadId,
      updated.providerTurnId,
      this.input.liveState,
      input.turnMetadataById,
    );
    const visibleTurnsWithPersistedFailures = appendPersistedFailureTurnsIfMissing(
      visibleTurnsWithActiveLiveTurn,
      persistedItemsByTurnId,
      input.turnMetadataById,
      {
        includeAllMissing: shouldCacheFullDetail,
        includeLatestMissing: options.beforeTurnId === undefined,
      },
    );
    const orderedVisibleTurns = applyLiveAgentMessageOrderingHints(
      visibleTurnsWithPersistedFailures,
      input.localThreadId,
      this.input.liveState,
    );
    const resolvedTurnMetadataById = resolveTurnMetadataByVisibleTurnId(
      orderedVisibleTurns,
      input.turnMetadataById,
    );
    const turns = mergePersistedHistoryItemsIntoTurns(
      applyRecordedTurnItemOrders(
        orderedVisibleTurns,
        this.input.liveState.turnItemOrderSnapshot(input.localThreadId),
      ),
      persistedItemsByTurnId,
      deferredDetails,
    ).map((turn) =>
      buildTurnDto(turn, resolvedTurnMetadataById.get(turn.id) ?? fallbackMetadata),
    );
    const entry = {
      cachedAt: Date.now(),
      turns,
      totalTurnCount: shouldCacheFullDetail
        ? turns.length
        : remoteSession.totalTurnCount ?? turns.length,
      deferredDetails,
      isPaged,
    };
    if (cacheKey !== 'uncached') {
      this.setCache(input.localThreadId, options, entry);
      return this.getCache(input.localThreadId, options)!;
    }
    return entry;
  }

  sliceTurns<T extends { id: string }>(
    turns: T[],
    options: { limit?: number; beforeTurnId?: string } = {},
  ) {
    return sliceTurnsForDetail(turns, options);
  }

  private async buildLocalFallbackEntry(input: {
    localThreadId: string;
    record: ThreadDetailRecord;
    turnMetadataById: Map<string, ThreadTurnMetadataRecord>;
    shouldCacheFullDetail: boolean;
    options: { limit?: number; beforeTurnId?: string };
  }): Promise<ThreadDetailCacheEntry> {
    const localSession = await this.input.callbacks.findLocalSession(
      input.record.providerSessionId!,
    );
    const deferredDetails = new Map<string, ThreadHistoryItemDetailDto>();
    const persistedItemsByTurnId = this.input.callbacks.listPersistedHistoryItemsByTurnId(
      input.localThreadId,
    );
    const fallbackMetadata = fallbackTurnMetadataForRecord(
      input.record,
      latestThreadTurnMetadata(input.turnMetadataById),
    );
    const localTurns =
      localSession?.turns ??
      [...persistedItemsByTurnId.entries()].map(([turnId, items]) => {
        const error = persistedTurnError(items);
        return {
          id: turnId,
          startedAt: input.turnMetadataById.get(turnId)?.createdAt ?? null,
          status: error ? ('failed' as const) : ('completed' as const),
          error,
          items: [],
        };
      });
    const turns = mergePersistedHistoryItemsIntoTurns(
      applyRecordedTurnItemOrders(
        localTurns,
        this.input.liveState.turnItemOrderSnapshot(input.localThreadId),
      ),
      persistedItemsByTurnId,
      deferredDetails,
    ).map((turn) =>
      buildTurnDto(
        deferLargeHistoryItemDetails(turn, deferredDetails),
        input.turnMetadataById.get(turn.id) ?? fallbackMetadata,
      ),
    );
    const entry = {
      cachedAt: Date.now(),
      turns,
      totalTurnCount: turns.length,
      deferredDetails,
      isPaged: !input.shouldCacheFullDetail,
    };
    const cacheOptions = input.shouldCacheFullDetail
      ? {}
      : input.options;
    if (cacheKeyForDetailOptions(cacheOptions) !== 'uncached') {
      this.setCache(input.localThreadId, cacheOptions, entry);
      return this.getCache(input.localThreadId, cacheOptions)!;
    }
    return entry;
  }
}

function isExpiredThreadDetailCacheEntry(entry: ThreadDetailCacheEntry) {
  return Date.now() - entry.cachedAt > THREAD_DETAIL_CACHE_TTL_MS;
}

function cacheKeyForDetailOptions(options: { limit?: number; beforeTurnId?: string }) {
  if (options.beforeTurnId !== undefined) {
    return 'uncached' as const;
  }

  if (options.limit === undefined) {
    return 'full' as const;
  }

  return `latest:${options.limit}` as const;
}

function applyLiveAgentMessageOrderingHints(
  turns: ThreadTurnDto[],
  localThreadId: string,
  liveState: ThreadLiveStateStore,
) {
  return turns.map((turn) => {
    const orderingHints = liveState.finalTurnAgentMessageOrderingMetadata(
      localThreadId,
      turn.id,
      turn.items,
      { allowUnmatchedFallback: false },
    );
    if (orderingHints.size === 0) {
      return turn;
    }

    let changed = false;
    const items = turn.items.map((item) => {
      if (item.kind !== 'agentMessage') {
        return item;
      }

      const metadata = orderingHints.get(item.id);
      if (!metadata) {
        return item;
      }

      let nextItem = item;
      if (nextItem.sequence !== metadata.sequence) {
        nextItem = { ...nextItem, sequence: metadata.sequence };
      }
      if (
        metadata.createdAt &&
        (!nextItem.createdAt || nextItem.createdAt === turn.startedAt)
      ) {
        nextItem = { ...nextItem, createdAt: metadata.createdAt };
      }

      if (nextItem !== item) {
        changed = true;
      }
      return nextItem;
    });

    return changed
      ? {
          ...turn,
          items: sortHistoryItemsBySequence(items),
        }
      : turn;
  });
}

function appendActiveLiveTurnIfMissing(
  turns: ThreadTurnDto[],
  localThreadId: string,
  providerTurnId: string | null | undefined,
  liveState: ThreadLiveStateStore,
  metadataById: Map<string, ThreadTurnMetadataRecord>,
) {
  const displayTurnId =
    liveState.displayTurnIdForRuntimeTurn(localThreadId, providerTurnId) ??
    providerTurnId;
  if (!displayTurnId || turns.some((turn) => turn.id === displayTurnId)) {
    return turns;
  }

  const liveItems = liveState.getLiveItemsForTurn(localThreadId, displayTurnId);
  if (!liveItems || liveItems.items.length === 0) {
    return turns;
  }

  return [
    ...turns,
    {
      id: displayTurnId,
      startedAt: metadataById.get(displayTurnId)?.createdAt ?? null,
      status: 'inProgress' as const,
      error: null,
      items: sortHistoryItemsBySequence(liveItems.items),
    },
  ];
}

function appendPersistedFailureTurnsIfMissing(
  turns: ThreadTurnDto[],
  persistedItemsByTurnId: Map<string, ThreadHistoryItemDto[]>,
  metadataById: Map<string, ThreadTurnMetadataRecord>,
  options: { includeAllMissing: boolean; includeLatestMissing: boolean },
) {
  if (persistedItemsByTurnId.size === 0) {
    return turns;
  }

  const existingTurnIds = new Set(turns.map((turn) => turn.id));
  const newestVisibleStartedAt = newestStartedAt(turns);
  const missingFailureTurns: ThreadTurnDto[] = [];
  for (const [turnId, items] of persistedItemsByTurnId.entries()) {
    if (existingTurnIds.has(turnId)) {
      continue;
    }

    const error = persistedTurnError(items);
    if (!error) {
      continue;
    }

    const startedAt =
      metadataById.get(turnId)?.createdAt ?? earliestItemCreatedAt(items);
    const shouldInclude =
      options.includeAllMissing ||
      (options.includeLatestMissing &&
        (!newestVisibleStartedAt ||
          !startedAt ||
          startedAt >= newestVisibleStartedAt));
    if (!shouldInclude) {
      continue;
    }

    missingFailureTurns.push({
      id: turnId,
      startedAt,
      status: 'failed',
      error,
      items: [],
    });
  }

  if (missingFailureTurns.length === 0) {
    return turns;
  }

  return sortTurnsByStartedAt([...turns, ...missingFailureTurns]);
}

function persistedTurnError(items: ThreadHistoryItemDto[]) {
  const failedItem = [...items].reverse().find((item) =>
    item.status === 'failed' || item.status === 'error',
  );
  return failedItem?.text?.trim() || null;
}

function earliestItemCreatedAt(items: ThreadHistoryItemDto[]) {
  return items
    .map((item) => item.createdAt)
    .filter((value): value is string => Boolean(value))
    .sort()[0] ?? null;
}

function newestStartedAt(turns: ThreadTurnDto[]) {
  return turns
    .map((turn) => turn.startedAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;
}

function newestRemoteTurnStartedAt(turns: AgentTurn[]) {
  return turns
    .map((turn) => turn.startedAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;
}

function latestPersistedFailureAfter(
  persistedItemsByTurnId: Map<string, ThreadHistoryItemDto[]>,
  metadataById: Map<string, ThreadTurnMetadataRecord>,
  timestamp: string | null,
) {
  let latest: { error: string; startedAt: string | null } | null = null;
  for (const [turnId, items] of persistedItemsByTurnId.entries()) {
    const error = persistedTurnError(items);
    if (!error) {
      continue;
    }
    const startedAt =
      metadataById.get(turnId)?.createdAt ?? earliestItemCreatedAt(items);
    if (timestamp && startedAt && startedAt < timestamp) {
      continue;
    }
    if (
      !latest ||
      (!latest.startedAt && startedAt) ||
      (latest.startedAt && startedAt && startedAt > latest.startedAt)
    ) {
      latest = { error, startedAt };
    }
  }
  return latest;
}

function sortTurnsByStartedAt(turns: ThreadTurnDto[]) {
  return turns
    .map((turn, index) => ({ turn, index }))
    .sort((left, right) => {
      const leftStartedAt = left.turn.startedAt;
      const rightStartedAt = right.turn.startedAt;
      if (!leftStartedAt && !rightStartedAt) {
        return left.index - right.index;
      }
      if (!leftStartedAt) {
        return 1;
      }
      if (!rightStartedAt) {
        return -1;
      }
      return leftStartedAt.localeCompare(rightStartedAt) || left.index - right.index;
    })
    .map(({ turn }) => turn);
}

export function buildTurnDto(
  turn: ThreadTurnDto,
  metadata: ThreadTurnMetadataRecord | undefined,
): ThreadTurnDto {
  const tokenUsage = parseThreadTurnTokenUsageJson(metadata?.tokenUsageJson);
  const displayPrompt = metadata?.displayPrompt?.trim();
  const items =
    displayPrompt && turn.items.some((item) => /\[localImage\]/.test(item.text))
      ? turn.items.map((item) =>
          item.kind === 'userMessage' && /\[localImage\]/.test(item.text)
            ? { ...item, text: displayPrompt }
            : item,
        )
      : turn.items;

  return {
    ...turn,
    items,
    startedAt: turn.startedAt ?? metadata?.createdAt ?? null,
    model: metadata?.model ?? null,
    reasoningEffort: normalizeReasoningEffort(metadata?.reasoningEffort),
    reasoningEffortAvailable: metadata?.reasoningEffortAvailable ?? null,
    tokenUsage,
    priceEstimate: estimateThreadTurnPrice(tokenUsage, {
      pricingModelKey: metadata?.pricingModelKey,
      pricingTierKey: normalizePricingTier(metadata?.pricingTierKey),
    }),
  };
}

export function fallbackTurnMetadataForRecord(
  record: {
    model: string | null;
    reasoningEffort: string | null;
  },
  latestMetadata?: ThreadTurnMetadataRecord | undefined,
): ThreadTurnMetadataRecord | undefined {
  if (!record.model && !record.reasoningEffort && !latestMetadata?.createdAt) {
    return undefined;
  }

  const pricingSnapshot = buildThreadTurnPricingSnapshot(record.model, false);
  return {
    model: record.model ?? null,
    reasoningEffort: normalizeReasoningEffort(record.reasoningEffort),
    reasoningEffortAvailable: record.reasoningEffort ? true : null,
    pricingModelKey: pricingSnapshot?.pricingModelKey ?? null,
    pricingTierKey: pricingSnapshot?.pricingTierKey ?? null,
    tokenUsageJson: null,
    createdAt: latestMetadata?.createdAt ?? null,
  };
}

export function latestThreadTurnMetadata(
  metadataById: Map<string, ThreadTurnMetadataRecord>,
) {
  return [...metadataById.values()]
    .filter((metadata) => metadata.createdAt)
    .sort((left, right) =>
      (right.createdAt ?? '').localeCompare(left.createdAt ?? ''),
    )[0];
}

function turnSortTimestamp(turn: ThreadTurnDto) {
  return turn.startedAt ?? '';
}

export function resolveTurnMetadataByVisibleTurnId(
  turns: ThreadTurnDto[],
  metadataById: Map<string, ThreadTurnMetadataRecord>,
) {
  const resolved = new Map(metadataById);
  const visibleTurnIds = new Set(turns.map((turn) => turn.id));
  const unmatchedTurns = turns.filter((turn) => !metadataById.has(turn.id));
  if (unmatchedTurns.length === 0) {
    return resolved;
  }

  const unmatchedMetadata = [...metadataById.entries()]
    .filter(([turnId]) => !visibleTurnIds.has(turnId))
    .sort((left, right) =>
      (left[1].createdAt ?? '').localeCompare(right[1].createdAt ?? ''),
    );
  if (unmatchedMetadata.length === 0) {
    return resolved;
  }

  const orderedUnmatchedTurns = [...unmatchedTurns].sort((left, right) =>
    turnSortTimestamp(left).localeCompare(turnSortTimestamp(right)),
  );
  const pairCount = Math.min(orderedUnmatchedTurns.length, unmatchedMetadata.length);

  for (let index = 0; index < pairCount; index += 1) {
    const turn = orderedUnmatchedTurns[index]!;
    const metadata = unmatchedMetadata[index]![1];
    resolved.set(turn.id, metadata);
  }

  return resolved;
}

export function sliceTurnsForDetail<T extends { id: string }>(
  turns: T[],
  options: { limit?: number; beforeTurnId?: string } = {},
) {
  const totalTurnCount = turns.length;
  const limit = options.limit ?? 10;

  if (turns.length === 0) {
    return {
      turns,
      totalTurnCount,
    };
  }

  if (options.beforeTurnId) {
    const beforeIndex = turns.findIndex((turn) => turn.id === options.beforeTurnId);
    const exclusiveEnd = beforeIndex >= 0 ? beforeIndex : turns.length;
    const start = Math.max(0, exclusiveEnd - limit);
    return {
      turns: turns.slice(start, exclusiveEnd),
      totalTurnCount,
    };
  }

  return {
    turns: turns.slice(Math.max(0, turns.length - limit)),
    totalTurnCount,
  };
}

function normalizeReasoningEffort(
  value: string | null | undefined,
): ReasoningEffortDto | null {
  switch (value) {
    case 'none':
    case 'minimal':
    case 'low':
    case 'medium':
    case 'high':
    case 'xhigh':
    case 'max':
      return value;
    default:
      return null;
  }
}
