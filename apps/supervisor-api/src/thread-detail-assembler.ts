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
  createdAt?: string | null;
}

export interface ThreadDetailRecord {
  id: string;
  workspaceId: string;
  provider?: string | null;
  providerSessionId: string | null;
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

    this.input.callbacks.updateThreadRecord(
      input.record.id,
      this.input.callbacks.buildThreadPatch(
        remoteSession,
        input.record.model,
        input.record.reasoningEffort,
      ),
    );

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
    const orderedVisibleTurns = applyLiveAgentMessageOrderingHints(
      visibleTurns,
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
      [...persistedItemsByTurnId.keys()].map((turnId) => ({
        id: turnId,
        startedAt: null,
        status: 'completed' as const,
        error: null,
        items: [],
      }));
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
    const orderingHints = liveState.finalTurnAgentMessageOrderingHints(
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

      const sequence = orderingHints.get(item.id);
      if (sequence === undefined || item.sequence === sequence) {
        return item;
      }

      changed = true;
      return {
        ...item,
        sequence,
      };
    });

    return changed
      ? {
          ...turn,
          items: sortHistoryItemsBySequence(items),
        }
      : turn;
  });
}

export function buildTurnDto(
  turn: ThreadTurnDto,
  metadata: ThreadTurnMetadataRecord | undefined,
): ThreadTurnDto {
  const tokenUsage = parseThreadTurnTokenUsageJson(metadata?.tokenUsageJson);

  return {
    ...turn,
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
      return value;
    default:
      return null;
  }
}
