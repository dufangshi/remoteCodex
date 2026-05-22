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
  private readonly threadDetailCache = new Map<string, ThreadDetailCacheEntry>();

  constructor(
    private readonly input: {
      liveState: ThreadLiveStateStore;
      callbacks: ThreadDetailAssemblerCallbacks;
    },
  ) {}

  getCache(localThreadId: string): ThreadDetailCacheEntry | null {
    const cached = this.threadDetailCache.get(localThreadId);
    if (!cached) {
      return null;
    }

    if (Date.now() - cached.cachedAt > THREAD_DETAIL_CACHE_TTL_MS) {
      this.threadDetailCache.delete(localThreadId);
      return null;
    }

    return cached;
  }

  setCache(localThreadId: string, entry: Omit<ThreadDetailCacheEntry, 'cachedAt'>) {
    this.threadDetailCache.set(localThreadId, {
      ...entry,
      cachedAt: Date.now(),
    });
  }

  invalidate(localThreadId: string) {
    this.threadDetailCache.delete(localThreadId);
  }

  cachedTurns(localThreadId: string) {
    return this.threadDetailCache.get(localThreadId)?.turns ?? [];
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
    const cached = this.getCache(input.localThreadId);
    if (cached && shouldCacheFullDetail) {
      return cached;
    }

    let remoteSession = await this.input.callbacks.readRemoteSession(
      input.record,
      options,
    );

    if (!remoteSession) {
      return this.buildLocalFallbackEntry({
        ...input,
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
    const resolvedTurnMetadataById = resolveTurnMetadataByVisibleTurnId(
      visibleTurns,
      input.turnMetadataById,
    );
    const turns = mergePersistedHistoryItemsIntoTurns(
      applyRecordedTurnItemOrders(
        visibleTurns,
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
        : remoteSession.totalTurnCount ?? Math.max(cached?.totalTurnCount ?? 0, turns.length),
      deferredDetails,
    };
    if (shouldCacheFullDetail) {
      this.setCache(input.localThreadId, entry);
      return this.threadDetailCache.get(input.localThreadId)!;
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
      [...persistedItemsByTurnId.entries()].map(([turnId, items]) => ({
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
    };
    if (input.shouldCacheFullDetail) {
      this.setCache(input.localThreadId, entry);
      return this.threadDetailCache.get(input.localThreadId)!;
    }
    return entry;
  }
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
